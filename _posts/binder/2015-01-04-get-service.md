---
layout: post
title:  "5.4 查询服务"
date:   2014-01-04 20:30:00
catalog:  true
---

## 5.4 查询服务

### 5.4.1 用C++查询服务

查询服务是向ServiceManager进程来查询后得到对应服务的代理对象， 不论是Java层注册的服务，还是Native注册的服务，都是可以在Native层用C++来查询的。

#### 1. BpServiceManager

这里再次以media为例，从上一小节的内容，可知MediaPlayerService服务名为"media.player"， 查询该服务获取其代理，采用如下代码：

    sp<IBinder> binder = defaultServiceManager()->getService(String16("media.player"));

其中defaultServiceManager返回的是BpServiceManager

    // IServiceManager.cpp
    virtual sp<IBinder> getService(const String16& name) const
    {
        unsigned n;
        for (n = 0; n < 5; n++){
            if (n > 0) {
                sleep(1);
            }
            sp<IBinder> svc = checkService(name); //见下文
            if (svc != NULL) return svc;
        }
        return NULL;
    }

通过BpServiceManager来获取MediaPlayer服务：检索服务是否存在，当服务存在则返回相应的服务，当服务不存在则休眠1s再继续检索服务。该循环进行5次。为什么是循环5次呢，可能跟Android的ANR时间为5s相关。如果每次都无法获取服务，循环5次，每次循环休眠1s，忽略checkService()的时间，差不多就是5s的时间


    // IServiceManager.cpp
    virtual sp<IBinder> checkService( const String16& name) const
    {
        Parcel data, reply;
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());
        data.writeString16(name);     //写入服务名
        remote()->transact(CHECK_SERVICE_TRANSACTION, data, &reply);
        return reply.readStrongBinder(); //见下文6
    }

其中remote()为handle=0的BpBinder代理， 对于CODE为CHECK_SERVICE_TRANSACTION和GET_SERVICE_TRANSACTION这两个完全一样的效果。

#### 2. BpBinder

    // BpBinder.cpp
    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags); //见下文
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

Binder代理类调用transact()方法，真正工作还是交给IPCThreadState来进行transact工作，


#### 3. IPCThreadState

    // IPCThreadState.cpp
    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....

        if (err == NO_ERROR) {
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }
        ...

        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                err = waitForResponse(reply);  //等待响应
            }
        } else {
            ...
        }
        return err;
    }

查询服务跟注册服务的过程，最终都是交给IPCThreadState来跟驱动进行交互，这个过程将数据写入到binder_transaction_data结构体，然后再进一步封装到binder_write_read结构体，binder_write_read结构体用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。关于数据封装过程，如图所示。

![查询服务的数据转换](/images/book/binder/5-4-1-get-service-data.jpg)

Client进程发送BC_TRANSACTION到驱动，驱动处理后转换为BR_TRANSACTION，ServiceManager进程接收到BR_TRANSACTION，然后就进入ServiceManager进程，如图所示。

![查询服务](/images/book/binder/5-4-2-get_service.jpg)

#### 4. ServiceManager

该进程收到对端发送过程的Binder数据后调用binder_parse方法来处理，会调用svcmgr_handler()根据是注册服务，再根据SVC_MGR_GET_SERVICE会执行do_find_service()， 根据服务名查询所对应的handle，如图所示。


![ServiceManager查询服务](/images/book/binder/5-4-3-do-get-service.jpg)

先来看看binder_parse()的过程，代码如下。

    // servicemanager/binder.c
    int binder_parse(struct binder_state *bs, struct binder_io *bio,
                     uintptr_t ptr, size_t size, binder_handler func)
    {
        ...
        while (ptr < end) {
            uint32_t cmd = *(uint32_t *) ptr; //指向readbuf
            switch(cmd) {
            case BR_TRANSACTION: {
                struct binder_transaction_data *txn = (struct binder_transaction_data *) ptr;
                if (func) { //func是指svcmgr_handler()函数
                    ...
                    bio_init_from_txn(&msg, txn); //将binder_transaction_data信息解析成binder_io
                    res = func(bs, txn, &msg, &reply);  //执行svcmgr_handler(), 见下文
                    if (txn->flags & TF_ONE_WAY) {
                        binder_free_buffer(bs, txn->data.ptr.buffer);
                    } else {
                        binder_send_reply(bs, &reply, txn->data.ptr.buffer, res); //发送应答数据, 见下文
                    }
                }
                break;
            }
            ...
            }
        }
        return r;
    }

上述方法主要工作是执行svcmgr_handler()，然后再发送应答数据给对端进程。

    // service_manager.c
    int svcmgr_handler(struct binder_state *bs,
                       struct binder_transaction_data *txn,
                       struct binder_io *msg,
                       struct binder_io *reply)
    {
        ...
        switch(txn->code) {
            case SVC_MGR_GET_SERVICE:
            case SVC_MGR_CHECK_SERVICE:
                s = bio_get_string16(msg, &len); //服务名
                //根据名称查找相应服务, 见下文
                handle = do_find_service(bs, s, len, txn->sender_euid, txn->sender_pid);
                //将handle发送到请求服务的进程， 见下文
                bio_put_ref(reply, handle);
                return 0;
        }
        ...
    }

经过层层传输进入到do_find_service()方法，可以看出查询服务的getService 对应于ServiceManager中的do_find_service。

    // service_manager.c
    uint32_t do_find_service(struct binder_state *bs, const uint16_t *s, size_t len, uid_t uid, pid_t spid)
    {
        struct svcinfo *si = find_svc(s, len); //查询服务
        if (!si || !si->handle) {
            return 0;
        }
        ...
        if (!svc_can_find(s, len, spid)) { //服务是否满足查询条件
            return 0;
        }
        return si->handle;
    }

查询服务是从svclist服务列表中，根据服务名遍历查找是否已经注册。服务列表svclist找到同名的服务，则返回其对对应的handle值，找不找则返回NULL。另外，这个过程会监测应用是否有查询的selinux权限，一般应用都有该权限。
do_find_service()后找到服务在ServiceManager进程所对应的handle值, 然后调用bio_put_ref(reply, handle)，将handle封装到reply.

    // service_manager.c
    void bio_put_ref(struct binder_io *bio, uint32_t handle)
    {
        struct flat_binder_object *obj;
        if (handle)
            obj = bio_alloc_obj(bio);
        else
            obj = bio_alloc(bio, sizeof(*obj));

        if (!obj)
            return;
        obj->flags = 0x7f | FLAT_BINDER_FLAG_ACCEPTS_FDS;
        obj->type = BINDER_TYPE_HANDLE; //返回的是HANDLE类型
        obj->handle = handle;  //handle值
        obj->cookie = 0;
    }


svcmgr_handler执行完，之后然后再binder_send_reply()发送应答数据BC_REPLY协议，然后调用binder_transaction()，再向服务请求者的Todo队列， 下面来看看 binder_send_reply()，代码如下。

    // servicemanager/binder.c
    void binder_send_reply(struct binder_state *bs,
                           struct binder_io *reply,
                           binder_uintptr_t buffer_to_free,
                           int status)
    {
        struct {
            uint32_t cmd_free;
            binder_uintptr_t buffer;
            uint32_t cmd_reply;
            struct binder_transaction_data txn;
        } __attribute__((packed)) data;

        data.cmd_free = BC_FREE_BUFFER; //free buffer命令
        data.buffer = buffer_to_free;
        data.cmd_reply = BC_REPLY; // reply命令
        data.txn.target.ptr = 0;
        data.txn.cookie = 0;
        data.txn.code = 0;
        if (status) {
            ...
        } else {
            data.txn.flags = 0;
            data.txn.data_size = reply->data - reply->data0;
            data.txn.offsets_size = ((char*) reply->offs) - ((char*) reply->offs0);
            data.txn.data.ptr.buffer = (uintptr_t)reply->data0;
            data.txn.data.ptr.offsets = (uintptr_t)reply->offs0;
        }
        //向Binder驱动通信， 见下文
        binder_write(bs, &data, sizeof(data));
    }

binder_write进入binder驱动后，将BC_FREE_BUFFER和BC_REPLY命令协议发送给Binder驱动，向client端发送reply.


    int binder_write(struct binder_state *bs, void *data, size_t len)
    {
        struct binder_write_read bwr;
        int res;

        bwr.write_size = len;
        bwr.write_consumed = 0;
        bwr.write_buffer = (uintptr_t) data;
        bwr.read_size = 0;
        bwr.read_consumed = 0;
        bwr.read_buffer = 0;
        res = ioctl(bs->fd, BINDER_WRITE_READ, &bwr);
        return res;
    }

上一节介绍的注册服务的过程核心逻辑在于从服务所在进程向ServiceManager发起Binder事务，将服务名和handle建立映射，并放入svclist列表；
而查询服务的过程，向ServiceManager查询到了具体服务名所对应的handle才完成一半工作， 接下来需要把handle数据发送给服务请求所在进程，并建立目标服务的代理对象。

#### 5. Binder Driver

ServiceManager进程向服务查询方传输所查询到的服务信息

    static void binder_transaction(struct binder_proc *proc,
                   struct binder_thread *thread,
                   struct binder_transaction_data *tr, int reply){
        ...
        //从target_proc分配一块buffer
        t->buffer = binder_alloc_buf(target_proc, tr->data_size,

        for (; offp < off_end; offp++) {
            switch (fp->type) {
            case BINDER_TYPE_HANDLE:
            case BINDER_TYPE_WEAK_HANDLE: {
              struct binder_ref *ref = binder_get_ref(proc, fp->handle,
                    fp->type == BINDER_TYPE_HANDLE);
              ...
              //此时运行在servicemanager进程，ref->node是指服务所在进程的binder实体，
              //而target_proc为请求服务所在的进程，此时并不相等。
              if (ref->node->proc == target_proc) {
                if (fp->type == BINDER_TYPE_HANDLE)
                  fp->type = BINDER_TYPE_BINDER;
                else
                  fp->type = BINDER_TYPE_WEAK_BINDER;
                fp->binder = ref->node->ptr;
                fp->cookie = ref->node->cookie; //BBinder服务的地址
                binder_inc_node(ref->node, fp->type == BINDER_TYPE_BINDER, 0, NULL);

              } else {
                struct binder_ref *new_ref;
                //请求服务所在进程并非服务所在进程，则为请求服务所在进程创建binder_ref
                new_ref = binder_get_ref_for_node(target_proc, ref->node);
                fp->binder = 0;
                fp->handle = new_ref->desc; //重新赋予handle值
                fp->cookie = 0;
                binder_inc_ref(new_ref, fp->type == BINDER_TYPE_HANDLE, NULL);
              }
            } break;
            }
        }
        //分别target_list和当前线程TODO队列插入事务
        t->work.type = BINDER_WORK_TRANSACTION;
        list_add_tail(&t->work.entry, target_list);
        tcomplete->type = BINDER_WORK_TRANSACTION_COMPLETE;
        list_add_tail(&tcomplete->entry, &thread->todo);
        if (target_wait)
            wake_up_interruptible(target_wait);
        return;
    }

这个过程非常重要，分两种情况来说：

1. 当请求服务的进程与服务属于不同进程，则为请求服务所在进程创建binder_ref对象，指向服务进程中的binder_node;
2. 当请求服务的进程与服务属于同一进程，则不再创建新对象，只是引用计数加1，并且修改type为BINDER_TYPE_BINDER或BINDER_TYPE_WEAK_BINDER。



####  6. readStrongBinder

    // Parcel.cpp
    sp<IBinder> Parcel::readStrongBinder() const
    {
        sp<IBinder> val;
        unflatten_binder(ProcessState::self(), *this, &val); //见下文
        return val;
    }

readStrongBinder的功能是flat_binder_object解析并创建BpBinder对象

    // Parcel.cpp
    status_t unflatten_binder(const sp<ProcessState>& proc,
        const Parcel& in, sp<IBinder>* out)
    {
        const flat_binder_object* flat = in.readObject(false);
        if (flat) {
            switch (flat->type) {
                case BINDER_TYPE_BINDER:
                    // 当请求服务的进程与服务属于同一进程
                    *out = reinterpret_cast<IBinder*>(flat->cookie);
                    return finish_unflatten_binder(NULL, *flat, in);
                case BINDER_TYPE_HANDLE:
                    //请求服务的进程与服务属于不同进程, 见下文
                    *out = proc->getStrongProxyForHandle(flat->handle);
                    //创建BpBinder对象
                    return finish_unflatten_binder(
                        static_cast<BpBinder*>(out->get()), *flat, in);
            }
        }
        return BAD_TYPE;
    }

getStrongProxyForHandle()的过程根据handle值从当前进程的mHandleToObject列表查询。

    // ProcessState.cpp
    sp<IBinder> ProcessState::getStrongProxyForHandle(int32_t handle)
    {
        sp<IBinder> result;

        AutoMutex _l(mLock);
        //查找handle对应的资源项
        handle_entry* e = lookupHandleLocked(handle);

        if (e != NULL) {
            IBinder* b = e->binder;
            if (b == NULL || !e->refs->attemptIncWeak(this)) {
                ...
                //当handle值所对应的IBinder不存在或弱引用无效时，则创建BpBinder对象
                b = new BpBinder(handle);
                e->binder = b;
                if (b) e->refs = b->getWeakRefs();
                result = b;
            } else {
                result.force_set(b);
                e->refs->decWeak(this);
            }
        }
        return result;
    }

经过该方法，最终创建了指向Binder服务端的BpBinder代理对象。

- 当handle大于mHandleToObject的长度时，则向mHandleToObject中插入(handle+1-N)个handle_entry对象到队列，然后再创建该handle所对应的BpBinder对象；
- 否则，说明该handle所应对的BpBinder对象已存在，则不必再创建。同一个Binder服务实体，在一个进程里面只会有唯一的BpBinder对象。

#### 7. 小结

请求服务(getService)过程，就是向servicemanager进程查询指定服务，当执行binder_transaction()时，会区分请求服务所属进程情况。

1. 当请求服务的进程与服务属于不同进程，则为请求服务所在进程创建binder_ref对象，指向服务进程中的binder_node;
  - 最终readStrongBinder()，返回的是BpBinder对象；
2. 当请求服务的进程与服务属于同一进程，则不再创建新对象，只是引用计数加1，并且修改type为BINDER_TYPE_BINDER或BINDER_TYPE_WEAK_BINDER。
  - 最终readStrongBinder()，返回的是BBinder对象的真实子类；

### 5.4.2 用Java查询服务

从Java层查询服务，则是通过ServiceManager类的getService()方法，指定服务名便可从系统中查询到相应的服务代理对象。

#### 1. ServiceManagerProxy

    // ServiceManager.java
    public static IBinder getService(String name) {
        try {
            IBinder service = sCache.get(name); //先从缓存中查看
            if (service != null) {
                return service;
            } else {
                return getIServiceManager().getService(name); //见下文
            }
        } catch (RemoteException e) {
            ...
        }
        return null;
    }

关于getIServiceManager()在前面已经讲述了，等价于new ServiceManagerProxy(new BinderProxy())。
其中sCache = new HashMap<String, IBinder>()以hashmap格式缓存已组成的名称。请求获取服务过程中，先从缓存中查询是否存在，如果缓存中不存在的话，再通过binder交互来查询相应的服务。
接下来看看ServiceManagerProxy查询服务，代码如下：

    // ServiceManagerNative.java
    class ServiceManagerProxy implements IServiceManager {
        public IBinder getService(String name) throws RemoteException {
            Parcel data = Parcel.obtain();
            Parcel reply = Parcel.obtain();
            data.writeInterfaceToken(IServiceManager.descriptor);
            data.writeString(name);
            //mRemote为BinderProxy，见下文
            mRemote.transact(GET_SERVICE_TRANSACTION, data, reply, 0);
            //从reply里面解析出获取的IBinder对象，见下文
            IBinder binder = reply.readStrongBinder();
            reply.recycle();
            data.recycle();
            return binder;
        }
    }

可见，从Java层来查询服务，传递的数据跟C++层的是一样的，都是IServiceManager描述信息和服务名，然后在交给BinderProxy对象将数据传递到底层。经过层层处理后，通过readStrongBinder()获取目标服务的代理对象。

#### 2.  BinderProxy

    // Binder.java
    final class BinderProxy implements IBinder {
        public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
            return transactNative(code, data, reply, flags); //见下文
        }
    }

这个过程会检查一下，传递的Parcel数据超过800KB，如果超过则会输出一个致命警告的日志，并输出相应的调用栈。因为通过Binder是不允许一次性传递大数据的，默认上限是1M-8K的大小，这是在初始化Binder框架的时候决定的。
transactNative()是一个Native方法，所对应的JNI方法是android_os_BinderProxy_transact()，代码如下:

    // android_util_Binder.cpp
    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        ...
        //java Parcel转为native Parcel
        Parcel* data = parcelForJavaObject(env, dataObj);
        Parcel* reply = parcelForJavaObject(env, replyObj);
        ...

        //gBinderProxyOffsets.mObject中保存的是new BpBinder(0)对象
        IBinder* target = (IBinder*)
            env->GetLongField(obj, gBinderProxyOffsets.mObject);
        ...

        //此处便是BpBinder::transact(),
        status_t err = target->transact(code, *data, reply, flags);
        ...
        return JNI_FALSE;
    }



#### 3. readStrongBinder

readStrongBinder的过程基本是writeStrongBinder逆过程。

    // Parcel.java
    static jobject android_os_Parcel_readStrongBinder(JNIEnv* env, jclass clazz, jlong nativePtr)
    {
        Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr);
        if (parcel != NULL) {
            return javaObjectForIBinder(env, parcel->readStrongBinder());
        }
        return NULL;
    }


先经过readStrongBinder(C++)，获取BpBinder对象，经过javaObjectForIBinder将native层BpBinder对象转换为Java层BinderProxy对象。 也就是说通过getService()最终获取了指向目标Binder服务端的代理对象BinderProxy。


#### 4. 小结

getService的核心过程：

    public static IBinder getService(String name) {
        ...
        Parcel reply = Parcel.obtain(); //此处还需要将java层的Parcel转为Native层的Parcel
        BpBinder::transact(GET_SERVICE_TRANSACTION, *data, reply, 0);  //与Binder驱动交互
        IBinder binder = javaObjectForIBinder(env, new BpBinder(handle));
        ...
    }

javaObjectForIBinder作用是创建BinderProxy对象，并将BpBinder对象的地址保存到BinderProxy对象的mObjects中。
获取服务过程就是通过BpBinder来发送`GET_SERVICE_TRANSACTION`命令，与实现与binder驱动进行数据交互，如图所示。

![查询服务对比](/images/book/binder/5-4-4-get-service-summary.jpg)

C++层的查询服务调用getService()，先执行BpBinder.transact()路经Binder驱动到达ServiceManager进程，根据服务名找到所对应服务，并把相关信息回传到服务请求进程;
服务请求方再通过readStrongBinder()获取对应的sp<IBinder>对象。

Java层的查询服务，主要是进行一个Java与C++的封装转换过程， BinderProxy对象的transact()通过JNI最终调用BpBinder的transact()，Java层的readStrongBinder()的核心实现同样是依靠C++层的逻辑。
