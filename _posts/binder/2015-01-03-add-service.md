---
layout: post
title:  "5.3 注册服务"
date:   2014-01-03 8:30:00
catalog:  true
---

## 5.3 注册服务

### 5.3.2 注册C++层服务

这里不妨以MediaPlayerService服务过程为例，来说一说服务注册过程，先来看看media的整个的类关系图。

![add_media_player_service](/images/binder/addService/add_media_player_service.png)

图解：

- 蓝色代表的是注册MediaPlayerService服务所涉及的类
- 绿色代表的是Binder架构中与Binder驱动通信过程中的最为核心的两个类；
- 紫色代表的是注册服务和[获取服务](http://gityuan.com/2015/11/15/binder-get-service/)的公共接口/父类；

#### 1. BpServiceManager

从MediaPlayerService服务初始化开始，代码如下：

    // MediaPlayerService.cpp
    void MediaPlayerService::instantiate() {
        defaultServiceManager()->addService(
              String16("media.player"), new MediaPlayerService());
    }

注册服务MediaPlayerService的过程， defaultServiceManager()会创建ProcessState，BpBinder以及BpServiceManager对象，
最终返回的是BpServiceManager对象。

看看BpServiceManager的addService()的处理国瓷，代码如下：

    // IServiceManager.cpp
    virtual status_t addService(const String16& name, const sp<IBinder>& service,
            bool allowIsolated)
    {
        Parcel data, reply; //Parcel是数据通信包
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());   
        data.writeString16(name);        // name为 "media.player"
        data.writeStrongBinder(service); // MediaPlayerService服务
        data.writeInt32(allowIsolated ? 1 : 0); // allowIsolated= false
        //此处remote()指向的是BpBinder对象
        status_t err = remote()->transact(ADD_SERVICE_TRANSACTION, data, &reply);
        return err == NO_ERROR ? reply.readExceptionCode() : err;
    }

服务注册过程：向ServiceManager注册服务MediaPlayerService，将相关数据都封装到Parcel对象，把Parcel和code数据传递到下一层BpBinder，Parcel对象的数据填充情况如图所示

![Parcel数据](/images/book/binder/5-3-1-parcel.jpg)

- 接口Token值： “android.os.IServiceManager“
- 服务名：“media.player“
- 服务对象：MediaPlayerService对象

把ADD_SERVICE_TRANSACTION和Parcel数据交给BpBinder来处理，经过BpBinder.transact()从对端得到的返回数据放到Parcel类型的reply数据包，并通过readExceptionCode读取对端执行过程是否发现过异常。
对于Binder服务对象经过writeStrongBinder()方法进行扁平化才能用于进程间通信, 将IBinder转换成flat_binder_object对象，该对象的成员变量type=BINDER_TYPE_BINDER，成员变量cookie记录Binder实体的指针，成员变量binder记录Binder实体的引用计数对象weakref_impl。

#### 2. BpBinder

    // BpBinder.cpp
    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

向ServiceManager注册服务，此次mHandle=0, Binder平台中，针对handle=0的情况会特殊处理，可以自动找到ServiceManager进程。注册服务的code便是ADD_SERVICE_TRANSACTION，该过程的真正工作交给IPCThreadState来进行transact工作。先来看看IPCThreadState::self的过程。

#### 3. IPCThreadState

先来看看IPCThreadState初始化过程，代码如下：

    // IPCThreadState.cpp
    IPCThreadState* IPCThreadState::self()
    {
        if (gHaveTLS) {
    restart:
            const pthread_key_t k = gTLS;
            IPCThreadState* st = (IPCThreadState*)pthread_getspecific(k);
            if (st) return st;
            return new IPCThreadState;  //初始IPCThreadState
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

TLS是指Thread local storage(线程本地储存空间)，每个线程都拥有自己的TLS，并且是私有空间，线程之间不会共享。通过pthread_getspecific/pthread_setspecific函数可以获取/设置这些空间中的内容。从线程本地存储空间中获得保存在其中的IPCThreadState对象。再来看看IPCThreadState初始化过程.

    IPCThreadState::IPCThreadState()
        : mProcess(ProcessState::self()),
          mStrictModePolicy(0),
          mLastTransactionBinderFlags(0)
    {
        pthread_setspecific(gTLS, this);
        clearCaller();
        mIn.setDataCapacity(256);
        mOut.setDataCapacity(256);
    }

    void IPCThreadState::clearCaller()
    {
        mCallingPid = getpid(); //初始化pid
        mCallingUid = getuid(); //初始化uid
    }

每个线程都有一个IPCThreadState，每个IPCThreadState中都有一个mIn和mOut。成员变量mProcess保存了ProcessState变量(每个进程只有一个)。

- mCallingPid和mCallingUid 设置成当前进程的pid和uid;
- mIn用来接收来自Binder设备的数据，默认大小为256字节；
- mOut用来存储发往Binder设备的数据，默认大小为256字节。

再来看看IPCThreadState::transact过程：

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS; //允许应答数据中带有文件描述符号
        if (err == NO_ERROR) { // 传输数据
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }
        ...

        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                //等待响应
                err = waitForResponse(reply);
            } else {
                Parcel fakeReply;
                err = waitForResponse(&fakeReply);
            }

        } else {
            //oneway，则不需要等待reply的场景
            err = waitForResponse(NULL, NULL);
        }
        return err;
    }

IPCThreadState进行transact事务处理过程，会检查Parcel数据是否存在错误，比如内存不足的情况下，通信数据包并没有能封装到Parcel对象，当存在错误则直接返回。接着，flags默认是采用同步的方式，这里再增加允许应答数据中带有文件描述符号的功能。 有了前面封装好的Parcel数据， 再进行二次封装，将handle, code,  parcel数据一并打包封装到binder_transaction_data结构体， 这个结构体在Binde驱动里面也有完全一样的结构体，经过这样封装的数据，驱动层并可以正确的识别，这里需要注意的是sender_pid和sender_euid的初值默认为0，而非当前进程的pid和uid。 将这些数据再加上通信协议BC_TRANSACTION，都写入到数据类型为Parcel的mOut对象。

服务注册过程采用的是同步的Binder调用，传入reply对象，跟Binder驱动交互，然后等待从数据传回的数据。接下来，重点看看writeTransactionData和waitForResponse过程。

（1）IPC.writeTransactionData

    status_t IPCThreadState::writeTransactionData(int32_t cmd, uint32_t binderFlags,
        int32_t handle, uint32_t code, const Parcel& data, status_t* statusBuffer)
    {
        binder_transaction_data tr;
        tr.target.ptr = 0;
        tr.target.handle = handle; // handle = 0
        tr.code = code;            // code = ADD_SERVICE_TRANSACTION
        tr.flags = binderFlags;    // binderFlags = 0
        tr.cookie = 0;
        tr.sender_pid = 0;
        tr.sender_euid = 0;

        // data为记录Media服务信息的Parcel对象
        const status_t err = data.errorCheck();
        if (err == NO_ERROR) {
            tr.data_size = data.ipcDataSize();  // mDataSize
            tr.data.ptr.buffer = data.ipcData(); //mData地址
            tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t); //mObjectsSize
            tr.data.ptr.offsets = data.ipcObjects(); //mObjects地址
        } else if (statusBuffer) {
            ...
        } else {
            return (mLastError = err);
        }

        mOut.writeInt32(cmd);         //协议BC_TRANSACTION
        mOut.write(&tr, sizeof(tr));  //写入binder_transaction_data数据
        return NO_ERROR;
    }


其中handle的值用来标识目的端，注册服务过程的目的端为service manager，此处handle=0所对应的是binder_context_mgr_node对象，正是service manager所对应的binder实体对象。binder_transaction_data结构体是binder驱动通信的数据结构，该过程最终是把Binder请求码BC_TRANSACTION和binder_transaction_data结构体写入到mOut。对于binder_transaction_data数据的核心成员，如图5-2所示。

![binder_transaction_data](/images/book/binder/5-3-2-binder_transaction_data.jpg)

- handle = 0
- code = ADD_SERVICE_TRANSACTION
- data组成：
    - 接口Token值 = “android.os.IServiceManager“
    - 服务名 = “media.player“
    - 服务对象 = MediaPlayerService对象

把BC_TRANSACTION协议和binder_transaction_data数据写入到mOut对象。

（2）IPC.waitForResponse

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;
        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break;
            ...
            if (mIn.dataAvail() == 0) continue;

            cmd = mIn.readInt32();
            switch (cmd) {
                case BR_TRANSACTION_COMPLETE:
                    if (!reply && !acquireResult) goto finish;
                    break;
                case BR_DEAD_REPLY: ...
                case BR_FAILED_REPLY: ...
                case BR_ACQUIRE_RESULT: ...
                case BR_REPLY: ...
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

在waitForResponse是直接跟Binder驱动打交道的过程，通过talkWithDriver来跟Binder驱动进行数据交互。
首先经过Binder驱动处理后，首先返回回来的BR_TRANSACTION_COMPLETE协议，reply不为空则会继续等待，直到收到Binder驱动返回的BR_REPLY协议或者是数据出在错误。
而另一个端目标进程收到当前进程发送的BC_TRANSACTION事务后，经过驱动转换为BR_TRANSACTION事务。将服务注册到ServiceManager进程，再然后发送BC_REPLY给驱动， 驱动处理后向当前进程发送BR_REPLY命令。
先来看看talkWithDriver()的过程。

    status_t IPCThreadState::talkWithDriver(bool doReceive)
    {
        ...
        binder_write_read bwr;
        //当mDataSize <= mDataPos，则有数据可读
        const bool needRead = mIn.dataPosition() >= mIn.dataSize();
        const size_t outAvail = (!doReceive || needRead) ? mOut.dataSize() : 0;

        bwr.write_size = outAvail;
        bwr.write_buffer = (uintptr_t)mOut.data(); // mData地址

        if (doReceive && needRead) {
            //接收数据缓冲区信息的填充。如果以后收到数据，就直接填在mIn中。
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
            //通过ioctl不停的读写操作，跟Binder Driver进行通信
            if (ioctl(mProcess->mDriverFD, BINDER_WRITE_READ, &bwr) >= 0)
                err = NO_ERROR;
            ...
        } while (err == -EINTR);
        ...
        return err;
    }

talkWithDriver，顾名思义，就是用于跟驱动交谈，交谈就需要听和说两个过程，对应到软件工程来说就是读与写的操作。读写之前先需要准备好读写的数据格式，binder_write_read结构体用来与Binder设备交换数据的结构，通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。 在执行一次读写之前，需要先把要读和写的数据都封装到binder_write_read结构体用，当读写数据区的大小都为零，则本次交谈可以直接结束。有一种场景，只需要把自己的写缓存区的数据传入到驱动，而不关心驱动返回回来的数据， 那么可通过设置参数doReceive为false来做到，默认情况下doReceive等于true。

再来回顾下，整个过程的数据封装流程，如图所示。

![数据封装过程](/images/book/binder/5-3-3-data-transact.jpg)

1. 首先，addService()过程，将服务名和服务对象封装到Parcel对象， 跟着ADD_SERVICE_TRANSACTION一并交给handle=0的BpBinder
2. 其次，writeTransactionData()过程， 将步骤1的数据都整合到binder_transaction_data，跟着BC_TRANSACTION协议一并写入到mOut
3. 最后，talkWithDriver()过程，将步骤2的数据都整合到mOut对象，再加上mIn对象一并写入到binder_write_read结构体， 把该结构体以命令BINDER_WRITE_READ的方式向Binder驱动发送ioctl来交互。

可见，经过整个过程从最上至下的传递，最为核心的数据块保存在Parcel结构体。


#### 4. Binder Driver

本节大致说下Binder Driver的主要工作内容，后面章节会详细说明。 通过ioctl()系统调用进入到Binder驱动， 反向不断拆解用户空间传递过来的数据。

![数据拆解过程](/images/book/binder/5-3-4-data-transact_driver.jpg)

- binder_ioctl()过程解析ioctl参数BINDER_WRITE_READ，则调用binder_ioctl_write_read()方法；
- binder_ioctl_write_read()过程将用户空间binder_write_read结构体拷贝到内核空间, 写缓存中存在数据，则调用binder_thread_write()方法；
- binder_thread_write()过程解析到传输协议为BC_TRANSACTION，则调用binder_transaction()方法；
- binder_transaction()过程将用户空间binder_transaction_data结构体拷贝到内核空间，内核创建一个binder_transaction结构体，

binder_transaction()过程根据target.handle为0，所找到目标实体就是binder_context_mgr_node，所对应的是servicemanager进程。于是便在接收端servicemanager进程开辟一块buffer，然后将Parcel数据拷贝到该buffer。此次通信为同步Binder调用，会将服务所在的线程以及接收端进程等信息都会记录下来。是驱动处理这个过程最为精华的部分，还是很有必要先来说说其功能，代码非常关键，这里先贴一下，代码如下：


    static void binder_transaction(struct binder_proc *proc,
                   struct binder_thread *thread,
                   struct binder_transaction_data *tr, int reply){
        struct binder_transaction *t;
       	struct binder_work *tcomplete;

        if (reply) {
            ...
        }else {
            if (tr->target.handle) {
                ...
            } else {
                // handle=0则找到servicemanager实体
                target_node = binder_context_mgr_node;
            }
            //target_proc为servicemanager进程
            target_proc = target_node->proc;
        }

        if (target_thread) {
            ...
        } else {
            //找到servicemanager进程的todo队列
            target_list = &target_proc->todo;
            target_wait = &target_proc->wait;
        }

        t = kzalloc(sizeof(*t), GFP_KERNEL);
        tcomplete = kzalloc(sizeof(*tcomplete), GFP_KERNEL);

        //非oneway的通信方式，把当前thread保存到transaction的from字段
        if (!reply && !(tr->flags & TF_ONE_WAY))
            t->from = thread;
        else
            t->from = NULL;

        t->sender_euid = task_euid(proc->tsk);
        t->to_proc = target_proc; //此次通信目标进程为servicemanager进程
        t->to_thread = target_thread;
        t->code = tr->code;  //此次通信code = ADD_SERVICE_TRANSACTION
        t->flags = tr->flags;  // 此次通信flags = 0
        t->priority = task_nice(current);

        //从servicemanager进程中分配buffer
        t->buffer = binder_alloc_buf(target_proc, tr->data_size,
            tr->offsets_size, !reply && (t->flags & TF_ONE_WAY));
        ...

        for (; offp < off_end; offp++) {
            struct flat_binder_object *fp;
            fp = (struct flat_binder_object *)(t->buffer->data + *offp);
            off_min = *offp + sizeof(struct flat_binder_object);
            switch (fp->type) {
                case BINDER_TYPE_BINDER:
                case BINDER_TYPE_WEAK_BINDER: {
                  struct binder_ref *ref;
                  //根据binder查询binder实体对象
                  struct binder_node *node = binder_get_node(proc, fp->binder);
                  if (node == NULL) {
                    //服务所在进程 创建binder_node实体
                    node = binder_new_node(proc, fp->binder, fp->cookie);
                    ...
                  }
                  //创建servicemanager进程binder_ref
                  ref = binder_get_ref_for_node(target_proc, node);
                  ...
                  //调整type为HANDLE类型
                  if (fp->type == BINDER_TYPE_BINDER)
                    fp->type = BINDER_TYPE_HANDLE;
                  else
                    fp->type = BINDER_TYPE_WEAK_HANDLE;
                  fp->binder = 0;
                  fp->handle = ref->desc; //设置handle值
                  fp->cookie = 0;
                  binder_inc_ref(ref, fp->type == BINDER_TYPE_HANDLE, &thread->todo);
                } break;
                case :...
        }

        //将BINDER_WORK_TRANSACTION添加到目标队列，本次通信的目标队列为target_proc->todo
        t->work.type = BINDER_WORK_TRANSACTION;
        list_add_tail(&t->work.entry, target_list);

        //将BINDER_WORK_TRANSACTION_COMPLETE添加到当前线程的todo队列
        tcomplete->type = BINDER_WORK_TRANSACTION_COMPLETE;
        list_add_tail(&tcomplete->entry, &thread->todo);

        //唤醒等待队列，本次通信的目标队列为target_proc->wait
        if (target_wait)
            wake_up_interruptible(target_wait);
        return;
    }

binder_transaction（）过程，会在服务所在进程创建binder_node, 在ServiceManager进程创建binder_ref，创建binder_ref过程来决定当前新的handle值， 该值从从1开始不断递增的。
注册的服务是MediaPlayerService，该对象经过writeStrongBinder()处理后扁平化为flat_binder_object对象，其类型为BINDER_TYPE_BINDER。binder_transaction()拆解过程，查询发起端进程是否为该服务创建过Binder实体对象，如果没有则需要新建Binder实体对象。然后在目标接收进程servicemanager创建指向该实体对象的Binder引用对象，并调整扁平化对象的handle值为刚创建的Binder引用对象中的值。
服务注册过程是在服务所在进程创建binder_node，在servicemanager进程创建binder_ref。对于同一个binder_node，每个进程只会创建一个binder_ref对象。

向当前线程todo队列添加BINDER_WORK_TRANSACTION_COMPLETE事务，表示驱动层已接收到用户空间发送的事务； 向servicemanager的todo添加BINDER_WORK_TRANSACTION事务，接下来进入ServiceManager进程。

小节5.2已介绍过ServiceManager进程启动后成为守护进程，等待其他进程通过binder发送请求， 服务进程将binder_transaction_data转换为binder_transaction结构体数据，ServiceManager进程再根据binder_transaction数据生成相应的binder_transaction_data结构体数据，回到ServiceManager进程用户空间收到数据则调用binder_parse来解析，根据BR_TRANSACTION协议，进入到svcmgr_handler过程，注册服务则对应do_add_service()方法。过程如图所示

![服务注册过程](/images/book/binder/5-3-5-add_service.jpg)


#### 5. ServiceManager


ServiceManager进程收到对端发送过程的Binder数据后调用binder_parse方法来处理，会调用svcmgr_handler()根据是注册服务，再进入do_add_service()方法，如果对底层不感兴趣的同学，只需要知道服务进程调用addService()方法，那么在整个过程不发生异常的情况下，则会执行service_manager中的do_add_service()方法。

![ServiceManager注册服务](/images/book/binder/5-3-6-do-add-service.jpg)

如果是你从事系统相关工作，那么往往需要分析的就是异常情况，所以知道其整个流程还是有必要的，先来看看binder_parse()，代码如下。

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
            case SVC_MGR_ADD_SERVICE:
                s = bio_get_string16(msg, &len); //服务名
                handle = bio_get_ref(msg); //服务实体在servicemanager中的handle
                allow_isolated = bio_get_uint32(msg) ? 1 : 0;
                 //注册指定服务, 见下文
                if (do_add_service(bs, s, len, handle, txn->sender_euid,
                    allow_isolated, txn->sender_pid))
                    return -1;
                break;
            ...
        }
        bio_put_uint32(reply, 0); //没有数据需要写入reply
        return 0;
    }

将服务名和服务实体在servicemanager进程中的handle值，一并写入到传入到do_add_service()方法

    // service_manager.c
    int do_add_service(struct binder_state *bs,
                       const uint16_t *s, size_t len,
                       uint32_t handle, uid_t uid, int allow_isolated,
                       pid_t spid)
    {
        struct svcinfo *si;
        if (!handle || (len == 0) || (len > 127))
            return -1;

        //权限检查
        if (!svc_can_register(s, len, spid)) {
            return -1;
        }

        //服务检索
        si = find_svc(s, len);
        if (si) {
            if (si->handle) {
                svcinfo_death(bs, si); //服务已注册时释放相应的服务，对应BC_RELEASE
            }
            si->handle = handle;
        } else {
            si = malloc(sizeof(*si) + (len + 1) * sizeof(uint16_t));
            si->handle = handle;
            si->len = len;
            memcpy(si->name, s, (len + 1) * sizeof(uint16_t)); //内存拷贝服务信息
            si->name[len] = '\0';
            si->death.func = (void*) svcinfo_death;
            si->death.ptr = si;
            si->allow_isolated = allow_isolated;
            si->next = svclist; // svclist保存所有已注册的服务
            svclist = si;
        }

        //发送BC_ACQUIRE， 增加强引用计数
        binder_acquire(bs, handle);
        //发送BC_REQUEST_DEATH_NOTIFICATION，注册死亡通知
        binder_link_to_death(bs, handle, &si->death);
        return 0;
    }

注册服务的过程，handle不能为0，由于0在全局有着特殊的意义，代表着servicemanager服务；服务名的长度也是有限制的，不允许服务名长度超过127个字节； 还有权限检查，并不是所有的进程都有权限向servicemanager进程注册服务， 必须同时满足应用uid小于10000，且具备注册服务的selinux权限要求。

先根据服务名在servicemanager进程的svclist列表来查询是否存在服务名等于"media.player"的svcinfo结构体，如果存在则先向驱动发送协议BC_RELEASE来释放该服务，并更新handle值；如果不存在，则分配内存创建新的svcinfo结构体，并填充handle，服务名等信息，以及加入到服务列表svclist。

发送BC_ACQUIRE，增加强引用计数保证目标服务不会提前被释放；发送BC_REQUEST_DEATH_NOTIFICATION，注册死亡通知，当目标服务所在进程被杀后会通知servicemanager进程，执行svcinfo_death()，发送BC_RELEASE用于释放对应服务的引用计数。


#### 6. 小结

服务注册核心工作：在服务所在进程创建binder_node，在ServiceManager进程创建binder_ref。
其中binder_transaction()，将buffer区域中类型为BINDER_TYPE_BINDER的flat_binder_object数据转为变为BINDER_TYPE_HANDLE，
依据fp->binder, fp->cookie在当前进程创建binder_node结构体， 并在对端进程(此处为servicemanager进程)来创建binder_ref结构体， 在创建binder_ref结构体的过程会为其分配handle值；
并且修改其类型为BINDER_TYPE_HANDLE，以及清零fp->binder和fp->cookie。

- 每个进程binder_proc所记录的binder_ref的handle值是从1开始递增的；
- 所有进程binder_proc所记录的handle=0的binder_ref都指向ServiceManager
- 同一个服务的binder_node在不同进程的binder_ref的handle值可以不同；


Media服务注册的过程涉及到MediaPlayerService(作为Client进程)和Service Manager(作为Service进程)，通信流程图如下所示：

![media_player_service_ipc](/images/binder/addService/media_player_service_ipc.png)


过程分析：

1. MediaPlayerService进程调用`ioctl()`向Binder驱动发送IPC数据，该过程可以理解成一个事务`binder_transaction`(记为`T1`)，执行当前操作的线程binder_thread(记为`thread1`)，则T1->from_parent=NULL，T1->from = `thread1`，thread1->transaction_stack=T1。其中IPC数据内容包含：
    - Binder协议为BC_TRANSACTION；
    - Handle等于0；
    - RPC代码为ADD_SERVICE；
    - RPC数据为"media.player"。

2. Binder驱动收到该Binder请求，生成`BR_TRANSACTION`命令，选择目标处理该请求的线程，即ServiceManager的binder线程(记为`thread2`)，则 T1->to_parent = NULL，T1->to_thread = `thread2`。并将整个binder_transaction数据(记为`T2`)插入到目标线程的todo队列；

3. Service Manager的线程`thread2`收到`T2`后，调用服务注册函数将服务"media.player"注册到服务目录中。当服务注册完成后，生成IPC应答数据(`BC_REPLY`)，T2->form_parent = T1，T2->from = thread2, thread2->transaction_stack = T2。

4. Binder驱动收到该Binder应答请求，生成`BR_REPLY`命令，T2->to_parent = T1，T2->to_thread = thread1, thread1->transaction_stack = T2。 在MediaPlayerService收到该命令后，知道服务注册完成便可以正常使用。



先通过一幅图来说说，media服务启动过程是如何向servicemanager注册服务的。

![addService流程](/images/book/binder/5-3-7-add-service-seq.jpg)



### 5.3.3 注册Java层服务

在Android系统开机过程中，Zygote启动时会有一个虚拟机注册过程，该过程调用AndroidRuntime.cpp中的startReg方法来完成jni方法的注册, gRegJNI是一个全局的数组，记录所有需要注册的jni方法。
其中一项REG_JNI(register_android_os_Binder)，建立Java与JNI之间的关联，以便提供JNI与Java相互访问的功能。 Java层注册服务，最为核心的逻辑其实还是C++注册服务的过程，如图所示。

![Binder的JNI注册映射](/images/book/binder/5-3-8-binder_resigter_jni.jpg)


gBinderOffsets记录着Binder类， gBinderProxyOffsets记录着BinderProxy类，除了图中的其实还有gBinderInternalOffsets记录BinderInternal，这些映射都是为了用于JNI方法之间调用Java方法来提供通道。
Binder的REG_JNI过程，还有另一个功能是建立Java调用JNI提供通道， 其中gBinderMethods，gBinderProxyOffsets，gBinderInternalMethods依次分别记录Binder，BinderProxy, BinderInternal类中Java与JNI的映射关系；


#### 1. ServiceManager

以WindowManagerService服务的注册过程为例， 代码如下所示。

    // SystemServer.java
    private void startOtherServices() {
        ...
        ServiceManager.addService(Context.WINDOW_SERVICE, wm);
        ...
    }

其中WINDOW_SERVICE值为”window“，wm代表的是WindowManagerService的实例化对象。


    // ServiceManager.java
    public static void addService(String name, IBinder service, boolean allowIsolated) {
        try {
            //先获取SMP对象，则执行注册服务操作
            getIServiceManager().addService(name, service, allowIsolated);
        } catch (RemoteException e) {
            Log.e(TAG, "error in addService", e);
        }
    }

前面小节5.2.2介绍了C++层的defaultServiceManager等价于new BpServiceManager(new BpBinder(0))，
这里Java层的getIServiceManager()等价于new ServiceManagerProxy(new BinderProxy())。可见Java层逻辑跟C++层极为相近，事实也的确如此，Java注册服务的过程只是在Java层做了一个封装，将Java转换为C++后，交给C++层负责完成服务注册的核心逻辑。

#### 2. 获取ServiceManager的Java层代理

    // ServiceManager.java
    private static IServiceManager getIServiceManager() {
        if (sServiceManager != null) {
            return sServiceManager;
        }
        sServiceManager = ServiceManagerNative.asInterface(BinderInternal.getContextObject());
        return sServiceManager;
    }

BinderInternal.java中有一个native方法getContextObject()，JNI调用后执行的便是如下方法。


    // android_util_binder.cpp
    static jobject android_os_BinderInternal_getContextObject(JNIEnv* env, jobject clazz)
    {
        sp<IBinder> b = ProcessState::self()->getContextObject(NULL);
        return javaObjectForIBinder(env, b); //见下文
    }

前面小节5.2.2已介绍过ProcessState::self()->getContextObject()等价于new BpBinder(0)。 再经过javaObjectForIBinder转换，
根据BpBinder(C++)生成BinderProxy(Java)对象.

    // android_util_binder.cpp
    jobject javaObjectForIBinder(JNIEnv* env, const sp<IBinder>& val)
    {
        AutoMutex _l(mProxyLock);
        jobject object = (jobject)val->findObject(&gBinderProxyOffsets);
        if (object != NULL) { //第一次object为null
            jobject res = jniGetReferent(env, object);
            if (res != NULL) {
                return res;
            }
            android_atomic_dec(&gNumProxyRefs);
            val->detachObject(&gBinderProxyOffsets);
            env->DeleteGlobalRef(object);
        }

        //创建BinderProxy对象
        object = env->NewObject(gBinderProxyOffsets.mClass, gBinderProxyOffsets.mConstructor);
        if (object != NULL) {
            //BinderProxy.mObject成员变量记录BpBinder对象，
            env->SetLongField(object, gBinderProxyOffsets.mObject, (jlong)val.get());
            val->incStrong((void*)javaObjectForIBinder);

            jobject refObject = env->NewGlobalRef(
                    env->GetObjectField(object, gBinderProxyOffsets.mSelf));
            //将BinderProxy对象信息附加到BpBinder的成员变量mObjects
            val->attachObject(&gBinderProxyOffsets, refObject,
                    jnienv_to_javavm(env), proxy_cleanup);

            sp<DeathRecipientList> drl = new DeathRecipientList;
            drl->incStrong((void*)javaObjectForIBinder);
            //BinderProxy.mOrgue成员变量记录死亡通知对象
            env->SetLongField(object, gBinderProxyOffsets.mOrgue, reinterpret_cast<jlong>(drl.get()));

            android_atomic_inc(&gNumProxyRefs);
            incRefsCreated(env);
        }
        return object;
    }

主要工作是创建BinderProxy对象, 然后进行如下设置：

- 通过BinderProxy.mObject记录BpBinder对象地址，实现了proxy拥有了native对象的引用
- 通过BpBinder的成员变量mObjects记录BinderProxy对象信息， 实现了native对象需要保存proxy对象的弱引用，当proxy还存在的时候，可以检索到同一个proxy。
- BinderProxy.mOrgue记录死亡通知对象DeathRecipientList

由此，可知ServiceManagerNative.asInterface(new BinderProxy()) 等价于new ServiceManagerProxy(new BinderProxy())，再来看看asInterface的过程。

    // ServiceManagerNative.java
    static public IServiceManager asInterface(IBinder obj)
    {
        if (obj == null) { //obj为BpBinder
            return null;
        }
        //由于obj为BpBinder，该方法默认返回null
        IServiceManager in = (IServiceManager)obj.queryLocalInterface(descriptor);
        if (in != null) {
            return in;
        }
        return new ServiceManagerProxy(obj); //见下文
    }

    class ServiceManagerProxy implements IServiceManager {
        public ServiceManagerProxy(IBinder remote) {
            mRemote = remote; //将BinderProxy保存到mRemote
        }
    }

由此，可知ServiceManagerNative.asInterface(new BinderProxy())等价于new ServiceManagerProxy(new BinderProxy()).
mRemote为BinderProxy对象，该BinderProxy对象的成员变量mObject记录着BpBinder(0)，其作为binder代理端，指向大管家serviceManager进程的服务。

ServiceManager.getIServiceManager最终等价于new ServiceManagerProxy(new BinderProxy())，此处ServiceManagerProxy简称为SMP。framework层的ServiceManager的调用实际的工作确实交给SMP的成员变量BinderProxy；而BinderProxy通过jni方式，最终会调用BpBinder对象；可见上层binder架构的核心功能依赖native架构的服务来完成的。

#### 3. SMP.addService

    // ServiceManagerNative.java
    public void addService(String name, IBinder service, boolean allowIsolated)
            throws RemoteException {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IServiceManager.descriptor);
        data.writeString(name);
        data.writeStrongBinder(service); //见下文
        data.writeInt(allowIsolated ? 1 : 0);
        //mRemote为BinderProxy，见下文
        mRemote.transact(ADD_SERVICE_TRANSACTION, data, reply, 0);
        reply.recycle();
        data.recycle();
    }

先来看看Java层的writeStrongBinder方法

    // Parcel.java
    public writeStrongBinder(IBinder val){
        nativewriteStrongBinder(mNativePtr, val);  //此处为Native调用
    }

nativewriteStrongBinder此为Native调用所对应android_os_Parcel_writeStrongBinder方法，Parcel对象中的mNativePtr是在其init()过程赋值，记录C++的Parcel对象。

    // android_os_Parcel.cpp
    static void android_os_Parcel_writeStrongBinder(JNIEnv* env, jclass clazz, jlong nativePtr, jobject object)
    {
        Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr);
        if (parcel != NULL) {
            //将java层Parcel转换为native层Parcel，见下文
            const status_t err = parcel->writeStrongBinder(ibinderForJavaObject(env, object));
            if (err != NO_ERROR) {
                signalExceptionForError(env, clazz, err);
            }
        }
    }

ibinderForJavaObject将Binder(Java)转换为Binder(C++)对象。

    // android_util_Binder.cpp
    sp<IBinder> ibinderForJavaObject(JNIEnv* env, jobject obj)
    {
        if (obj == NULL) return NULL;
        //Java层的Binder对象
        if (env->IsInstanceOf(obj, gBinderOffsets.mClass)) {
            JavaBBinderHolder* jbh = (JavaBBinderHolder*)
                env->GetLongField(obj, gBinderOffsets.mObject);
            return jbh != NULL ? jbh->get(env, obj) : NULL;  //见下文
        }
        //Java层的BinderProxy对象
        if (env->IsInstanceOf(obj, gBinderProxyOffsets.mClass)) {
            return (IBinder*)env->GetLongField(obj, gBinderProxyOffsets.mObject);
        }
        return NULL;
    }

根据Binde(Java)生成JavaBBinderHolder(C++)对象. 主要工作是创建JavaBBinderHolder对象,并把JavaBBinderHolder对象地址保存到Binder.mObject成员变量.

    // android_util_Binder.cpp
    sp<JavaBBinder> get(JNIEnv* env, jobject obj)
    {
        AutoMutex _l(mLock);
        sp<JavaBBinder> b = mBinder.promote();
        if (b == NULL) {
            b = new JavaBBinder(env, obj); //首次进来，创建JavaBBinder对象
            mBinder = b;
        }
        return b;
    }

    //JavaBBinder的初始化
    JavaBBinder(JNIEnv* env, jobject object)
        : mVM(jnienv_to_javavm(env)), mObject(env->NewGlobalRef(object))
    {
        android_atomic_inc(&gNumLocalRefs);
        incRefsCreated(env);
    }

创建JavaBBinder对象，该对象承于BBinder对象。再将JavaBBinder保存在Holder有一个成员变量mBinder，这是一个wp类型的，可能会被垃圾回收器给回收，所以每次使用前，都需要先判断是否存在。


data.writeStrongBinder(service)最终等价于parcel->writeStrongBinder(new JavaBBinder(env, obj))， 而对于writeStrongBinder()过程，前面小节5.2已介绍过。


再回到SMP.addService()过程，则接下来进入transact。

#### 4. BinderProxy.transact

    // Binder.java
    public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
        //用于检测Parcel大小是否大于800k
        Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
        return transactNative(code, data, reply, flags); //Native方法， 见下文
    }

transactNative()所对应的方法为android_os_BinderProxy_transact

    //android_util_Binder.cpp
    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        ...
        //java Parcel转为native Parcel
        Parcel* data = parcelForJavaObject(env, dataObj);
        Parcel* reply = parcelForJavaObject(env, replyObj);
        ...

        //gBinderProxyOffsets.mObject中保存的是new BpBinder(0)对象
        IBinder* target = (IBinder*)env->GetLongField(obj, gBinderProxyOffsets.mObject);
        ...

        //此处便是BpBinder::transact(), 经过native层进入Binder驱动程序
        status_t err = target->transact(code, *data, reply, flags);
        return JNI_FALSE;
    }

Java层的BinderProxy.transact()最终交由C++层的BpBinder的transact()来完成。可见，Java层注册服务的过程主要是需要将Java世界的东西转换到C++层，然后调用C++层祝注册服务的方法。


总结下， Java层的addService的核心过程，其主干代码等价于如下。

    public void addService(String name, IBinder service, boolean allowIsolated)
            throws RemoteException {
        ...
        Parcel data = Parcel.obtain(); //此处还需要将java层的Parcel转为Native层的Parcel
        data->writeStrongBinder(new JavaBBinder(env, obj));
        BpBinder::transact(ADD_SERVICE_TRANSACTION, *data, reply, 0); //与Binder驱动交互
        ...
    }

注册服务过程就是通过BpBinder来发送ADD_SERVICE_TRANSACTION命令，与实现与binder驱动进行数据交互。
