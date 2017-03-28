---
layout: post
title:  "Binder系列6—获取服务(getService)"
date:   2015-11-15 21:11:50
catalog:  true
tags:
    - android
    - binder


---
> 基于Android 6.0的源码剖析， 本文Client如何向Server获取服务的过程。


## 一、 获取服务
在Native层的服务注册，我们选择以media为例来展开讲解，先来看看media的类关系图。

#### 1.1 类图

点击查看[大图](http://gityuan.com/images/binder/addService/add_media_player_service.png)

![get_media_player_service](/images/binder/getService/get_media_player_service.png)

图解：

- 蓝色: 代表获取MediaPlayerService服务相关的类；
- 绿色: 代表Binder架构中与Binder驱动通信过程中的最为核心的两个类；
- 紫色: 代表[注册服务](http://gityuan.com/2015/11/14/binder-add-service/)和获取服务的公共接口/父类；


## 二. 获取Media服务

### 2.1 getMediaPlayerService
[-> framework/av/media/libmedia/IMediaDeathNotifier.cpp]

    sp<IMediaPlayerService>&
    IMediaDeathNotifier::getMediaPlayerService()
    {
        Mutex::Autolock _l(sServiceLock);
        if (sMediaPlayerService == 0) {
            sp<IServiceManager> sm = defaultServiceManager(); //获取ServiceManager
            sp<IBinder> binder;
            do {
                //获取名为"media.player"的服务 【见2.2】
                binder = sm->getService(String16("media.player"));
                if (binder != 0) {
                    break;
                }
                usleep(500000); // 0.5s
            } while (true);

            if (sDeathNotifier == NULL) {
                sDeathNotifier = new DeathNotifier(); //创建死亡通知对象
            }

            //将死亡通知连接到binder 【见流程14】
            binder->linkToDeath(sDeathNotifier);
            sMediaPlayerService = interface_cast<IMediaPlayerService>(binder);
        }
        return sMediaPlayerService;
    }


其中defaultServiceManager()过程在上一篇文章[获取ServiceManager](http://gityuan.com/2015/11/08/binder-get-sm/#defaultservicemanager)已讲过，返回BpServiceManager。

在请求获取名为"media.player"的服务过程中，采用不断循环获取的方法。由于MediaPlayerService服务可能还没向ServiceManager注册完成或者尚未启动完成等情况，故则binder返回为NULL，休眠0.5s后继续请求，直到获取服务为止。


### 2.2 BpSM.getService
[-> IServiceManager.cpp ::BpServiceManager]

    virtual sp<IBinder> getService(const String16& name) const
        {
            unsigned n;
            for (n = 0; n < 5; n++){
                sp<IBinder> svc = checkService(name); //【见2.3】
                if (svc != NULL) return svc;
                sleep(1);
            }
            return NULL;
        }

通过BpServiceManager来获取MediaPlayer服务：检索服务是否存在，当服务存在则返回相应的服务，当服务不存在则休眠1s再继续检索服务。该循环进行5次。为什么是循环5次呢，这估计跟Android的ANR时间为5s相关。如果每次都无法获取服务，循环5次，每次循环休眠1s，忽略`checkService()`的时间，差不多就是5s的时间


### 2.3 BpSM.checkService
[-> IServiceManager.cpp ::BpServiceManager]

    virtual sp<IBinder> checkService( const String16& name) const
    {
        Parcel data, reply;
        //写入RPC头
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());
        //写入服务名
        data.writeString16(name);
        remote()->transact(CHECK_SERVICE_TRANSACTION, data, &reply); //【见2.4】
        return reply.readStrongBinder(); //【见小节2.9】
    }

检索指定服务是否存在, 其中remote()为BpBinder。

### 2.4 BpBinder::transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            //【见流程2.5】
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

Binder代理类调用transact()方法，真正工作还是交给IPCThreadState来进行transact工作，

#### 2.4.1 IPCThreadState::self
[-> IPCThreadState.cpp]

    IPCThreadState* IPCThreadState::self()
    {
        if (gHaveTLS) {
    restart:
            const pthread_key_t k = gTLS;
            IPCThreadState* st = (IPCThreadState*)pthread_getspecific(k);
            if (st) return st;
            return new IPCThreadState;  //初始IPCThreadState 【见小节2.4.2】
        }

        if (gShutdown) return NULL;
        pthread_mutex_lock(&gTLSMutex);
        if (!gHaveTLS) { //首次进入gHaveTLS为false
            if (pthread_key_create(&gTLS, threadDestructor) != 0) { //创建线程的TLS
                pthread_mutex_unlock(&gTLSMutex);
                return NULL;
            }
            gHaveTLS = true;
        }
        pthread_mutex_unlock(&gTLSMutex);
        goto restart;
    }

TLS是指Thread local storage(线程本地储存空间)，每个线程都拥有自己的TLS，并且是私有空间，线程之间不会共享。通过pthread_getspecific/pthread_setspecific函数可以获取/设置这些空间中的内容。从线程本地存储空间中获得保存在其中的IPCThreadState对象。

#### 2.4.2 IPCThreadState初始化
[-> IPCThreadState.cpp]

    IPCThreadState::IPCThreadState()
        : mProcess(ProcessState::self()),
          mMyThreadId(gettid()),
          mStrictModePolicy(0),
          mLastTransactionBinderFlags(0)
    {
        pthread_setspecific(gTLS, this);
        clearCaller();
        mIn.setDataCapacity(256);
        mOut.setDataCapacity(256);
    }

每个线程都有一个`IPCThreadState`，每个`IPCThreadState`中都有一个mIn、一个mOut。成员变量mProcess保存了ProcessState变量(每个进程只有一个)。

- mIn 用来接收来自Binder设备的数据，默认大小为256字节；
- mOut用来存储发往Binder设备的数据，默认大小为256字节。


### 2.5 IPC::transact
[-> IPCThreadState.cpp]

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....
        if (err == NO_ERROR) {
             // 传输数据 【见流程2.6】
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }

        if (err != NO_ERROR) {
            if (reply) reply->setError(err);
            return (mLastError = err);
        }

        if ((flags & TF_ONE_WAY) == 0) { //flgs=0进入该分支
            if (reply) {
                //等待响应  【见流程2.7】
                err = waitForResponse(reply);
            } else {
                Parcel fakeReply;
                err = waitForResponse(&fakeReply);
            }

        } else {
            //不需要响应消息的binder则进入该分支
            err = waitForResponse(NULL, NULL);
        }
        return err;
    }


### 2.6 IPC.writeTransactionData
[-> IPCThreadState.cpp]

    status_t IPCThreadState::writeTransactionData(int32_t cmd, uint32_t binderFlags,
        int32_t handle, uint32_t code, const Parcel& data, status_t* statusBuffer)
    {
        binder_transaction_data tr;
        tr.target.ptr = 0;
        tr.target.handle = handle; // handle = 0
        tr.code = code;            // code = CHECK_SERVICE_TRANSACTION
        tr.flags = binderFlags;    // binderFlags = 0
        tr.cookie = 0;
        tr.sender_pid = 0;
        tr.sender_euid = 0;

        // data为记录Media服务信息的Parcel对象
        const status_t err = data.errorCheck();
        if (err == NO_ERROR) {
            tr.data_size = data.ipcDataSize();  // mDataSize
            tr.data.ptr.buffer = data.ipcData(); //mData
            tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t); //mObjectsSize
            tr.data.ptr.offsets = data.ipcObjects(); //mObjects
        } else if (statusBuffer) {
            ...
        } else {
            return (mLastError = err);
        }

        mOut.writeInt32(cmd);         //cmd = BC_TRANSACTION
        mOut.write(&tr, sizeof(tr));  //写入binder_transaction_data数据
        return NO_ERROR;
    }

其中handle的值用来标识目的端，注册服务过程的目的端为service manager，此处handle=0所对应的是binder_context_mgr_node对象，正是service manager所对应的binder实体对象。[binder_transaction_data结构体](http://gityuan.com/2015/11/01/binder-driver/#bindertransactiondata)是binder驱动通信的数据结构，该过程最终是把Binder请求码BC_TRANSACTION和binder_transaction_data结构体写入到`mOut`。


### 2.7 IPC.waitForResponse
[-> IPCThreadState.cpp]

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;

        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见流程2.8】
            err = mIn.errorCheck();
            if (err < NO_ERROR) break;
            if (mIn.dataAvail() == 0) continue;

            cmd = mIn.readInt32();
            switch (cmd) {
                case BR_TRANSACTION_COMPLETE: ...
                case BR_DEAD_REPLY: ...
                case BR_FAILED_REPLY: ...
                case BR_ACQUIRE_RESULT: ...
                case BR_REPLY: 
                {
                  binder_transaction_data tr;
                  err = mIn.read(&tr, sizeof(tr));
                  if (reply) {
                      if ((tr.flags & TF_STATUS_CODE) == 0) {
                          reply->ipcSetDataReference(
                              reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                              tr.data_size,
                              reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                              tr.offsets_size/sizeof(binder_size_t),
                              freeBuffer, this);
                      } else {
                          ...
                      }
                  }
                }
                goto finish;

                default:
                    err = executeCommand(cmd); 
                    if (err != NO_ERROR) goto finish;
                    break;
            }
        }
        ...
        return err;
    }

### 2.8 IPC.talkWithDriver
[-> IPCThreadState.cpp]

    status_t IPCThreadState::talkWithDriver(bool doReceive)
    {
        ...
        binder_write_read bwr;
        const bool needRead = mIn.dataPosition() >= mIn.dataSize();
        const size_t outAvail = (!doReceive || needRead) ? mOut.dataSize() : 0;

        bwr.write_size = outAvail;
        bwr.write_buffer = (uintptr_t)mOut.data();

        if (doReceive && needRead) {
            //接收数据缓冲区信息的填充。如果以后收到数据，就直接填在mIn中了。
            bwr.read_size = mIn.dataCapacity();
            bwr.read_buffer = (uintptr_t)mIn.data();
        } else {
            bwr.read_size = 0;
            bwr.read_buffer = 0;
        }
        //当读缓冲和写缓冲都为空，则直接返回
        if ((bwr.write_size == 0) && (bwr.read_size == 0)) return NO_ERROR;

        bwr.write_consumed = 0;
        bwr.read_consumed = 0;
        status_t err;
        do {
            //通过ioctl不停的读写操作，跟Binder Driver进行通信【2.8.1】
            if (ioctl(mProcess->mDriverFD, BINDER_WRITE_READ, &bwr) >= 0)
                err = NO_ERROR;
            ...
        } while (err == -EINTR); //当被中断，则继续执行
        ...
        return err;
    }

[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。 先向service manager进程发送查询服务的请求(BR_TRANSACTION)，见[Binder系列3—启动ServiceManager](http://gityuan.com/2015/11/07/binder-start-sm/)。当service manager进程收到该命令后，会执行do_find_service()
查询服务所对应的handle，然后再binder_send_reply()应答 发起者，发送BC_REPLY协议，然后调用binder_transaction()，再向服务请求者的Todo队列
插入事务。

#### 2.8.1 binder_thread_read

    binder_thread_read（...）{
        ...
        //当线程todo队列有数据则执行往下执行；当线程todo队列没有数据，则进入休眠等待状态
        ret = wait_event_freezable(thread->wait, binder_has_thread_work(thread));
        ...
        while (1) {
            uint32_t cmd;
            struct binder_transaction_data tr;
            struct binder_work *w;
            struct binder_transaction *t = NULL;
            //先从线程todo队列获取事务数据
            if (!list_empty(&thread->todo)) {
                w = list_first_entry(&thread->todo, struct binder_work, entry);
            // 线程todo队列没有数据, 则从进程todo对获取事务数据
            } else if (!list_empty(&proc->todo) && wait_for_proc_work) {
                ...
            }
            switch (w->type) {
                case BINDER_WORK_TRANSACTION:
                    //获取transaction数据
                    t = container_of(w, struct binder_transaction, work);
                    break;
                    
                case : ...  
            }

            //只有BINDER_WORK_TRANSACTION命令才能继续往下执行
            if (!t) continue;

            if (t->buffer->target_node) {
                ...
            } else {
                tr.target.ptr = NULL;
                tr.cookie = NULL;
                cmd = BR_REPLY; //设置命令为BR_REPLY
            }
            tr.code = t->code;
            tr.flags = t->flags;
            tr.sender_euid = t->sender_euid;

            if (t->from) {
                struct task_struct *sender = t->from->proc->tsk;
                //当非oneway的情况下,将调用者进程的pid保存到sender_pid
                tr.sender_pid = task_tgid_nr_ns(sender, current->nsproxy->pid_ns);
            } else {
                ...
            }

            tr.data_size = t->buffer->data_size;
            tr.offsets_size = t->buffer->offsets_size;
            tr.data.ptr.buffer = (void *)t->buffer->data +
                        proc->user_buffer_offset;
            tr.data.ptr.offsets = tr.data.ptr.buffer +
                        ALIGN(t->buffer->data_size,
                            sizeof(void *));

            //将cmd和数据写回用户空间
            put_user(cmd, (uint32_t __user *)ptr);
            ptr += sizeof(uint32_t);
            copy_to_user(ptr, &tr, sizeof(tr));
            ptr += sizeof(tr);

            list_del(&t->work.entry);
            t->buffer->allow_user_free = 1;
            if (cmd == BR_TRANSACTION && !(t->flags & TF_ONE_WAY)) {
                ...
            } else {
                t->buffer->transaction = NULL;
                kfree(t); //通信完成则运行释放
            }
            break;
        }
    done:
        *consumed = ptr - buffer;
        if (proc->requested_threads + proc->ready_threads == 0 &&
            proc->requested_threads_started < proc->max_threads &&
            (thread->looper & (BINDER_LOOPER_STATE_REGISTERED |
             BINDER_LOOPER_STATE_ENTERED))) {
            proc->requested_threads++;
            // 生成BR_SPAWN_LOOPER命令，用于创建新的线程
            put_user(BR_SPAWN_LOOPER, (uint32_t __user *)buffer)；
        }
        return 0;
    }

### 2.9 readStrongBinder
[-> Parcel.cpp]

    sp<IBinder> Parcel::readStrongBinder() const
    {
        sp<IBinder> val;
        //【见小节2.9.1】
        unflatten_binder(ProcessState::self(), *this, &val);
        return val;
    }

#### 2.9.1 unflatten_binder
[-> Parcel.cpp]

    status_t unflatten_binder(const sp<ProcessState>& proc,
        const Parcel& in, sp<IBinder>* out)
    {
        const flat_binder_object* flat = in.readObject(false);
        if (flat) {
            switch (flat->type) {
                case BINDER_TYPE_BINDER:
                    *out = reinterpret_cast<IBinder*>(flat->cookie);
                    return finish_unflatten_binder(NULL, *flat, in);
                case BINDER_TYPE_HANDLE:
                    //进入该分支【见2.9.2】
                    *out = proc->getStrongProxyForHandle(flat->handle);
                    //创建BpBinder对象
                    return finish_unflatten_binder(
                        static_cast<BpBinder*>(out->get()), *flat, in);
            }
        }
        return BAD_TYPE;
    }

#### 2.9.2 getStrongProxyForHandle
[-> ProcessState.cpp]

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

readStrongBinder的功能是flat_binder_object解析并创建BpBinder对象.

## 二、 死亡通知

死亡通知是为了让Bp端能知道Bn端的生死情况。

- 定义：DeathNotifier是继承IBinder::DeathRecipient类，主要需要实现其binderDied()来进行死亡通告。
- 注册：binder->linkToDeath(sDeathNotifier)是为了将sDeathNotifier死亡通知注册到Binder上。

Bp端只需要覆写binderDied()方法，实现一些后尾清除类的工作，则在Bn端死掉后，会回调binderDied()进行相应处理。


### 2.1 linkToDeath
[-> BpBinder.cpp]

    status_t BpBinder::linkToDeath(
        const sp<DeathRecipient>& recipient, void* cookie, uint32_t flags)
    {
        Obituary ob;
        ob.recipient = recipient;
        ob.cookie = cookie;
        ob.flags = flags;

        {
            AutoMutex _l(mLock);
            if (!mObitsSent) {
                if (!mObituaries) {
                    mObituaries = new Vector<Obituary>;
                    if (!mObituaries) {
                        return NO_MEMORY;
                    }
                    getWeakRefs()->incWeak(this);
                    IPCThreadState* self = IPCThreadState::self();
                    //[见小节2.2]
                    self->requestDeathNotification(mHandle, this);
                    self->flushCommands();
                }
                ssize_t res = mObituaries->add(ob);
                return res >= (ssize_t)NO_ERROR ? (status_t)NO_ERROR : res;
            }
        }

        return DEAD_OBJECT;
    }

### 2.2 requestDeathNotification
[-> IPCThreadState.cpp]

    status_t IPCThreadState::requestDeathNotification(int32_t handle, BpBinder* proxy)
    {
        mOut.writeInt32(BC_REQUEST_DEATH_NOTIFICATION);
        mOut.writeInt32((int32_t)handle);
        mOut.writePointer((uintptr_t)proxy);
        return NO_ERROR;
    }

向binder driver发送BC_REQUEST_DEATH_NOTIFICATION命令. 后面的处理流程,类似于文章[Binder系列3—启动ServiceManager](http://gityuan.com/2015/11/07/binder-start-sm/)
的[小节3.3]binder_link_to_death()的过程.

### 2.3 binderDied

    void IMediaDeathNotifier::DeathNotifier::binderDied(const wp<IBinder>& who __unused) {
        SortedVector< wp<IMediaDeathNotifier> > list;
        {
            Mutex::Autolock _l(sServiceLock);
            sMediaPlayerService.clear();   //把Bp端的MediaPlayerService清除掉
            list = sObitRecipients;
        }

        size_t count = list.size();
        for (size_t iter = 0; iter < count; ++iter) {
            sp<IMediaDeathNotifier> notifier = list[iter].promote();
            if (notifier != 0) {
                notifier->died();  //当MediaServer挂了则通知应用程序，应用程序回调该方法。
            }
        }
    }

客户端进程通过Binder驱动获得Binder的代理（BpBinder），死亡通知注册的过程就是客户端进程向Binder驱动注册一个死亡通知，该死亡通知关联BBinder，即与BpBinder所对应的服务端。

### 2.4 unlinkToDeath

当Bp在收到服务端的死亡通知之前先挂了，那么需要在对象的销毁方法内，调用`unlinkToDeath()`来取消死亡通知；

    IMediaDeathNotifier::DeathNotifier::~DeathNotifier()
    {
        Mutex::Autolock _l(sServiceLock);
        sObitRecipients.clear();
        if (sMediaPlayerService != 0) {
            IInterface::asBinder(sMediaPlayerService)->unlinkToDeath(this);
        }
    }

###  2.5  触发时机

每当service进程退出时，service manager会收到来自Binder驱动的死亡通知。
这项工作是在[启动Service Manager](http://gityuan.com/2015/11/07/binder-start-sm/)时通过`binder_link_to_death(bs, ptr, &si->death)`完成。另外，每个Bp端也可以自己注册死亡通知，能获取Binder的死亡消息，比如前面的`IMediaDeathNotifier`。

那么问题来了，Binder死亡通知是如何触发的呢？对于Binder IPC进程都会打开/dev/binder文件，当进程异常退出时，Binder驱动会保证释放将要退出的进程中没有正常关闭的/dev/binder文件，实现机制是binder驱动通过调用/dev/binder文件所对应的release回调函数，执行清理工作，并且检查BBinder是否有注册死亡通知，当发现存在死亡通知时，那么就向其对应的BpBinder端发送死亡通知消息。
