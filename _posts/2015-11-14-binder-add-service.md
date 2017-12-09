---
layout: post
title:  "Binder系列5—注册服务(addService)"
date:   2015-11-14 13:10:54
catalog:  true
tags:
    - android
    - binder


---
> 基于Android 6.0的源码剖析， 本文讲解如何向ServiceManager注册Native层的服务的过程。

    framework/native/libs/binder/
      - Binder.cpp
      - BpBinder.cpp
      - IPCThreadState.cpp
      - ProcessState.cpp
      - IServiceManager.cpp
      - IInterface.cpp
      - Parcel.cpp

    frameworks/native/include/binder/
      - IInterface.h (包括BnInterface, BpInterface)

##  一.概述

#### 1.1 media服务注册

media入口函数是`main_mediaserver.cpp`中的`main()`方法，代码如下：

    int main(int argc __unused, char** argv)
    {
        ...
        InitializeIcuOrDie();
        //获得ProcessState实例对象【见小节2.1】
        sp<ProcessState> proc(ProcessState::self());
        //获取BpServiceManager对象
        sp<IServiceManager> sm = defaultServiceManager();
        AudioFlinger::instantiate();
        //注册多媒体服务  【见小节3.1】
        MediaPlayerService::instantiate();
        ResourceManagerService::instantiate();
        CameraService::instantiate();
        AudioPolicyService::instantiate();
        SoundTriggerHwService::instantiate();
        RadioService::instantiate();
        registerExtensions();
        //启动Binder线程池
        ProcessState::self()->startThreadPool();
        //当前线程加入到线程池
        IPCThreadState::self()->joinThreadPool();
     }

过程说明:

1. [获取ServiceManager](http://gityuan.com/2015/11/08/binder-get-sm/#defaultservicemanager):
讲解了defaultServiceManager()返回的是BpServiceManager对象， 用于跟servicemanager进程通信;
2. [理解Binder线程池的管理](http://gityuan.com/2016/10/29/binder-thread-pool/), 讲解了startThreadPool和joinThreadPool过程.

本文的重点就是讲解Native层服务注册的过程.

#### 1.2 类图

在Native层的服务以media服务为例，来说一说服务注册过程，先来看看media的整个的类关系图。
点击查看[大图](http://gityuan.com/images/binder/addService/add_media_player_service.png)

![add_media_player_service](/images/binder/addService/add_media_player_service.png)

图解：

- 蓝色代表的是注册MediaPlayerService服务所涉及的类
- 绿色代表的是Binder架构中与Binder驱动通信过程中的最为核心的两个类；
- 紫色代表的是注册服务和[获取服务](http://gityuan.com/2015/11/15/binder-get-service/)的公共接口/父类；


#### 1.3 时序图

先通过一幅图来说说，media服务启动过程是如何向servicemanager注册服务的。

点击查看[大图](http://gityuan.com/images/binder/addService/addService.jpg)

![addService](/images/binder/addService/addService.jpg)

## 二. ProcessState

#### 2.1 ProcessState::self
[-> ProcessState.cpp]

    sp<ProcessState> ProcessState::self()
    {
        Mutex::Autolock _l(gProcessMutex);
        if (gProcess != NULL) {
            return gProcess;
        }

        //实例化ProcessState 【见小节2.2】
        gProcess = new ProcessState;
        return gProcess;
    }


获得ProcessState对象: 这也是**单例模式**，从而保证每一个进程只有一个`ProcessState`对象。其中`gProcess`和`gProcessMutex`是保存在`Static.cpp`类的全局变量。

#### 2.2  ProcessState初始化
[-> ProcessState.cpp]

    ProcessState::ProcessState()
        : mDriverFD(open_driver()) // 打开Binder驱动【见小节2.3】
        , mVMStart(MAP_FAILED)
        , mThreadCountLock(PTHREAD_MUTEX_INITIALIZER)
        , mThreadCountDecrement(PTHREAD_COND_INITIALIZER)
        , mExecutingThreadsCount(0)
        , mMaxThreads(DEFAULT_MAX_BINDER_THREADS)
        , mManagesContexts(false)
        , mBinderContextCheckFunc(NULL)
        , mBinderContextUserData(NULL)
        , mThreadPoolStarted(false)
        , mThreadPoolSeq(1)
    {
        if (mDriverFD >= 0) {
            //采用内存映射函数mmap，给binder分配一块虚拟地址空间【见小节2.4】
            mVMStart = mmap(0, BINDER_VM_SIZE, PROT_READ, MAP_PRIVATE | MAP_NORESERVE, mDriverFD, 0);
            if (mVMStart == MAP_FAILED) {
                close(mDriverFD); //没有足够空间分配给/dev/binder,则关闭驱动
                mDriverFD = -1;
            }
        }
    }

- `ProcessState`的单例模式的惟一性，因此一个进程只打开binder设备一次,其中ProcessState的成员变量`mDriverFD`记录binder驱动的fd，用于访问binder设备。
- `BINDER_VM_SIZE = (1*1024*1024) - (4096 *2)`, binder分配的默认内存大小为1M-8k。
- `DEFAULT_MAX_BINDER_THREADS = 15`，binder默认的最大可并发访问的线程数为16。

#### 2.3  open_driver
[-> ProcessState.cpp]

    static int open_driver()
    {
        // 打开/dev/binder设备，建立与内核的Binder驱动的交互通道
        int fd = open("/dev/binder", O_RDWR);
        if (fd >= 0) {
            fcntl(fd, F_SETFD, FD_CLOEXEC);
            int vers = 0;
            status_t result = ioctl(fd, BINDER_VERSION, &vers);
            if (result == -1) {
                close(fd);
                fd = -1;
            }
            if (result != 0 || vers != BINDER_CURRENT_PROTOCOL_VERSION) {
                close(fd);
                fd = -1;
            }
            size_t maxThreads = DEFAULT_MAX_BINDER_THREADS;

            // 通过ioctl设置binder驱动，能支持的最大线程数
            result = ioctl(fd, BINDER_SET_MAX_THREADS, &maxThreads);
            if (result == -1) {
                ALOGE("Binder ioctl to set max threads failed: %s", strerror(errno));
            }
        } else {
            ALOGW("Opening '/dev/binder' failed: %s\n", strerror(errno));
        }
        return fd;
    }

open_driver作用是打开/dev/binder设备，设定binder支持的最大线程数。关于binder驱动的相应方法，见文章[Binder Driver初探](http://gityuan.com/2015/11/01/binder-driver/)。

ProcessState采用单例模式，保证每一个进程都只打开一次Binder Driver。

#### 2.4 mmap

    //原型
    void* mmap(void* addr, size_t size, int prot, int flags, int fd, off_t offset)
    //此处
    mmap(0, BINDER_VM_SIZE, PROT_READ, MAP_PRIVATE | MAP_NORESERVE, mDriverFD, 0);

参数说明：

- addr: 代表映射到进程地址空间的起始地址，当值等于0则由内核选择合适地址，此处为0；
- size: 代表需要映射的内存地址空间的大小，此处为1M-8K；
- prot: 代表内存映射区的读写等属性值，此处为PROT_READ(可读取);
- flags: 标志位，此处为MAP_PRIVATE(私有映射，多进程间不共享内容的改变)和 MAP_NORESERVE(不保留交换空间)
- fd: 代表mmap所关联的文件描述符，此处为mDriverFD；
- offset：偏移量，此处为0。

mmap()经过系统调用，执行[binder_mmap](http://gityuan.com/2015/11/01/binder-driver/)过程。

## 三. 服务注册

### 3.1 instantiate
[-> MediaPlayerService.cpp]

    void MediaPlayerService::instantiate() {
        //注册服务【见小节3.2】
        defaultServiceManager()->addService(String16("media.player"), new MediaPlayerService());
    }

注册服务MediaPlayerService：由[defaultServiceManager()](http://gityuan.com/2015/11/08/binder-get-sm/)返回的是BpServiceManager，同时会创建ProcessState对象和BpBinder对象。
故此处等价于调用BpServiceManager->addService。其中MediaPlayerService位于libmediaplayerservice库.

### 3.2 BpSM.addService
[-> IServiceManager.cpp  ::BpServiceManager]

    virtual status_t addService(const String16& name, const sp<IBinder>& service,
            bool allowIsolated)
    {
        Parcel data, reply; //Parcel是数据通信包
        //写入头信息"android.os.IServiceManager"
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());   
        data.writeString16(name);        // name为 "media.player"
        data.writeStrongBinder(service); // MediaPlayerService对象【见小节3.2.1】
        data.writeInt32(allowIsolated ? 1 : 0); // allowIsolated= false
        //remote()指向的是BpBinder对象【见小节3.3】
        status_t err = remote()->transact(ADD_SERVICE_TRANSACTION, data, &reply);
        return err == NO_ERROR ? reply.readExceptionCode() : err;
    }

服务注册过程：向ServiceManager注册服务MediaPlayerService，服务名为"media.player"；

#### 3.2.1 writeStrongBinder
[-> parcel.cpp]

    status_t Parcel::writeStrongBinder(const sp<IBinder>& val)
    {
        return flatten_binder(ProcessState::self(), val, this);
    }

#### 3.2.2 flatten_binder
[-> parcel.cpp]

    status_t flatten_binder(const sp<ProcessState>& /*proc*/,
        const sp<IBinder>& binder, Parcel* out)
    {
        flat_binder_object obj;

        obj.flags = 0x7f | FLAT_BINDER_FLAG_ACCEPTS_FDS;
        if (binder != NULL) {
            IBinder *local = binder->localBinder(); //本地Binder不为空
            if (!local) {
                BpBinder *proxy = binder->remoteBinder();
                const int32_t handle = proxy ? proxy->handle() : 0;
                obj.type = BINDER_TYPE_HANDLE;
                obj.binder = 0;
                obj.handle = handle;
                obj.cookie = 0;
            } else { //进入该分支
                obj.type = BINDER_TYPE_BINDER;
                obj.binder = reinterpret_cast<uintptr_t>(local->getWeakRefs());
                obj.cookie = reinterpret_cast<uintptr_t>(local);
            }
        } else {
            ...
        }
        //【见小节3.2.3】
        return finish_flatten_binder(binder, obj, out);
    }

将Binder对象扁平化，转换成flat_binder_object对象。

- 对于Binder实体，则cookie记录Binder实体的指针；
- 对于Binder代理，则用handle记录Binder代理的句柄；

关于localBinder，代码见Binder.cpp。

    BBinder* BBinder::localBinder()
    {
        return this;
    }

    BBinder* IBinder::localBinder()
    {
        return NULL;
    }

#### 3.2.3 finish_flatten_binder

    inline static status_t finish_flatten_binder(
        const sp<IBinder>& , const flat_binder_object& flat, Parcel* out)
    {
        return out->writeObject(flat, false);
    }

将flat_binder_object写入out。

### 3.3 BpBinder::transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            // code=ADD_SERVICE_TRANSACTION【见小节3.4】
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

Binder代理类调用transact()方法，真正工作还是交给IPCThreadState来进行transact工作。先来
看看IPCThreadState::self的过程。

#### 3.3.1 IPCThreadState::self
[-> IPCThreadState.cpp]

    IPCThreadState* IPCThreadState::self()
    {
        if (gHaveTLS) {
    restart:
            const pthread_key_t k = gTLS;
            IPCThreadState* st = (IPCThreadState*)pthread_getspecific(k);
            if (st) return st;
            return new IPCThreadState;  //初始IPCThreadState 【见小节3.3.2】
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

#### 3.3.2 IPCThreadState初始化
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

### 3.4 IPC::transact
[-> IPCThreadState.cpp]

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....
        if (err == NO_ERROR) { // 传输数据 【见小节3.5】
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }
        ...

        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                //等待响应 【见小节3.6】
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


IPCThreadState进行transact事务处理分3部分：

- errorCheck()           //数据错误检查
- writeTransactionData() // 传输数据
- waitForResponse()      //f等待响应

### 3.5 IPC.writeTransactionData
[-> IPCThreadState.cpp]

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

transact过程，先写完binder_transaction_data数据，其中Parcel data的重要成员变量：

- mDataSize:保存再data_size，binder_transaction的数据大小；
- mData: 保存在ptr.buffer, binder_transaction的数据的起始地址；
- mObjectsSize:保存在ptr.offsets_size，记录着flat_binder_object结构体的个数；
- mObjects: 保存在offsets, 记录着flat_binder_object结构体在数据偏移量；


接下来执行waitForResponse()方法。

### 3.6 IPC.waitForResponse
[-> IPCThreadState.cpp]

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;
        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见小节3.7】
            ...
            if (mIn.dataAvail() == 0) continue;

            cmd = mIn.readInt32();
            switch (cmd) {
                case BR_TRANSACTION_COMPLETE: ...
                case BR_DEAD_REPLY: ...
                case BR_FAILED_REPLY: ...
                case BR_ACQUIRE_RESULT: ...
                case BR_REPLY: ...
                    goto finish;

                default:
                    err = executeCommand(cmd);  //【见小节3.x】
                    if (err != NO_ERROR) goto finish;
                    break;
            }
        }
        ...
        return err;
    }

在waitForResponse过程, 首先执行BR_TRANSACTION_COMPLETE；另外，目标进程收到事务后，处理BR_TRANSACTION事务。
然后发送给当前进程，再执行BR_REPLY命令。

### 3.7 IPC.talkWithDriver
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
            //通过ioctl不停的读写操作，跟Binder Driver进行通信
            if (ioctl(mProcess->mDriverFD, BINDER_WRITE_READ, &bwr) >= 0)
                err = NO_ERROR;
            ...
        } while (err == -EINTR); //当被中断，则继续执行
        ...
        return err;
    }


[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。 主要是操作mOut和mIn变量。

ioctl()经过系统调用后进入Binder Driver.

## 四. Binder Driver

ioctl -> binder_ioctl -> binder_ioctl_write_read

### 4.1 binder_ioctl_write_read
[-> binder.c]

    static int binder_ioctl_write_read(struct file *filp,
                    unsigned int cmd, unsigned long arg,
                    struct binder_thread *thread)
    {
        struct binder_proc *proc = filp->private_data;
        void __user *ubuf = (void __user *)arg;
        struct binder_write_read bwr;

        //将用户空间bwr结构体拷贝到内核空间
        copy_from_user(&bwr, ubuf, sizeof(bwr));
        ...

        if (bwr.write_size > 0) {
            //将数据放入目标进程【见小节4.2】
            ret = binder_thread_write(proc, thread,
                          bwr.write_buffer,
                          bwr.write_size,
                          &bwr.write_consumed);
            ...
        }
        if (bwr.read_size > 0) {
            //读取自己队列的数据 【见小节】
            ret = binder_thread_read(proc, thread, bwr.read_buffer,
                 bwr.read_size,
                 &bwr.read_consumed,
                 filp->f_flags & O_NONBLOCK);
            if (!list_empty(&proc->todo))
                wake_up_interruptible(&proc->wait);
            ...
        }

        //将内核空间bwr结构体拷贝到用户空间
        copy_to_user(ubuf, &bwr, sizeof(bwr));
        ...
    }   

### 4.2 binder_thread_write

    static int binder_thread_write(struct binder_proc *proc,
                struct binder_thread *thread,
                binder_uintptr_t binder_buffer, size_t size,
                binder_size_t *consumed)
    {
        uint32_t cmd;
        void __user *buffer = (void __user *)(uintptr_t)binder_buffer;
        void __user *ptr = buffer + *consumed;
        void __user *end = buffer + size;
        while (ptr < end && thread->return_error == BR_OK) {
            //拷贝用户空间的cmd命令，此时为BC_TRANSACTION
            if (get_user(cmd, (uint32_t __user *)ptr)) -EFAULT;
            ptr += sizeof(uint32_t);
            switch (cmd) {
            case BC_TRANSACTION:
            case BC_REPLY: {
                struct binder_transaction_data tr;
                //拷贝用户空间的binder_transaction_data
                if (copy_from_user(&tr, ptr, sizeof(tr)))   return -EFAULT;
                ptr += sizeof(tr);
                // 见小节4.3】
                binder_transaction(proc, thread, &tr, cmd == BC_REPLY);
                break;
            }
            ...
        }
        *consumed = ptr - buffer;
      }
      return 0;
    }

### 4.3 binder_transaction

    static void binder_transaction(struct binder_proc *proc,
                   struct binder_thread *thread,
                   struct binder_transaction_data *tr, int reply){
        struct binder_transaction *t;
       	struct binder_work *tcomplete;
        ...

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

        t->buffer->allow_user_free = 0;
        t->buffer->transaction = t;
        t->buffer->target_node = target_node;

        if (target_node)
            binder_inc_node(target_node, 1, 0, NULL); //引用计数加1
        offp = (binder_size_t *)(t->buffer->data + ALIGN(tr->data_size, sizeof(void *)));

        //分别拷贝用户空间的binder_transaction_data中ptr.buffer和ptr.offsets到内核
        copy_from_user(t->buffer->data,
            (const void __user *)(uintptr_t)tr->data.ptr.buffer, tr->data_size);
        copy_from_user(offp,
            (const void __user *)(uintptr_t)tr->data.ptr.offsets, tr->offsets_size);

        off_end = (void *)offp + tr->offsets_size;

        for (; offp < off_end; offp++) {
            struct flat_binder_object *fp;
            fp = (struct flat_binder_object *)(t->buffer->data + *offp);
            off_min = *offp + sizeof(struct flat_binder_object);
            switch (fp->type) {
                case BINDER_TYPE_BINDER:
                case BINDER_TYPE_WEAK_BINDER: {
                  struct binder_ref *ref;
                  //【见4.3.1】
                  struct binder_node *node = binder_get_node(proc, fp->binder);
                  if (node == NULL) {
                    //服务所在进程 创建binder_node实体【见4.3.2】
                    node = binder_new_node(proc, fp->binder, fp->cookie);
                    ...
                  }
                  //servicemanager进程binder_ref【见4.3.3】
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
                  binder_inc_ref(ref, fp->type == BINDER_TYPE_HANDLE,
                           &thread->todo);
                } break;
                case :...
        }

        if (reply) {
            ..
        } else if (!(t->flags & TF_ONE_WAY)) {
            //BC_TRANSACTION 且 非oneway,则设置事务栈信息
            t->need_reply = 1;
            t->from_parent = thread->transaction_stack;
            thread->transaction_stack = t;
        } else {
            ...
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

注册服务的过程，传递的是BBinder对象，故[小节3.2.1]的writeStrongBinder()过程中localBinder不为空，
从而flat_binder_object.type等于BINDER_TYPE_BINDER。

服务注册过程是在服务所在进程创建binder_node，在servicemanager进程创建binder_ref。
对于同一个binder_node，每个进程只会创建一个binder_ref对象。

向servicemanager的binder_proc->todo添加BINDER_WORK_TRANSACTION事务，接下来进入ServiceManager进程。

#### 4.3.1 binder_get_node

    static struct binder_node *binder_get_node(struct binder_proc *proc,
                 binder_uintptr_t ptr)
    {
      struct rb_node *n = proc->nodes.rb_node;
      struct binder_node *node;

      while (n) {
        node = rb_entry(n, struct binder_node, rb_node);

        if (ptr < node->ptr)
          n = n->rb_left;
        else if (ptr > node->ptr)
          n = n->rb_right;
        else
          return node;
      }
      return NULL;
    }

从binder_proc来根据binder指针ptr值，查询相应的binder_node。


#### 4.3.2 binder_new_node

    static struct binder_node *binder_new_node(struct binder_proc *proc,
                           binder_uintptr_t ptr,
                           binder_uintptr_t cookie)
    {
        struct rb_node **p = &proc->nodes.rb_node;
        struct rb_node *parent = NULL;
        struct binder_node *node;
        ... //红黑树位置查找

        //给新创建的binder_node 分配内核空间
        node = kzalloc(sizeof(*node), GFP_KERNEL);

        // 将新创建的node添加到proc红黑树；
        rb_link_node(&node->rb_node, parent, p);
        rb_insert_color(&node->rb_node, &proc->nodes);
        node->debug_id = ++binder_last_id;
        node->proc = proc;
        node->ptr = ptr;
        node->cookie = cookie;
        node->work.type = BINDER_WORK_NODE; //设置binder_work的type
        INIT_LIST_HEAD(&node->work.entry);
        INIT_LIST_HEAD(&node->async_todo);
        return node;
    }

#### 4.3.3 binder_get_ref_for_node

    static struct binder_ref *binder_get_ref_for_node(struct binder_proc *proc,
                  struct binder_node *node)
    {
      struct rb_node *n;
      struct rb_node **p = &proc->refs_by_node.rb_node;
      struct rb_node *parent = NULL;
      struct binder_ref *ref, *new_ref;
      //从refs_by_node红黑树，找到binder_ref则直接返回。
      while (*p) {
        parent = *p;
        ref = rb_entry(parent, struct binder_ref, rb_node_node);

        if (node < ref->node)
          p = &(*p)->rb_left;
        else if (node > ref->node)
          p = &(*p)->rb_right;
        else
          return ref;
      }

      //创建binder_ref
      new_ref = kzalloc_preempt_disabled(sizeof(*ref));

      new_ref->debug_id = ++binder_last_id;
      new_ref->proc = proc; //记录进程信息
      new_ref->node = node; //记录binder节点
      rb_link_node(&new_ref->rb_node_node, parent, p);
      rb_insert_color(&new_ref->rb_node_node, &proc->refs_by_node);

      //计算binder引用的handle值，该值返回给target_proc进程
      new_ref->desc = (node == binder_context_mgr_node) ? 0 : 1;
      //从红黑树最最左边的handle对比，依次递增，直到红黑树遍历结束或者找到更大的handle则结束。
      for (n = rb_first(&proc->refs_by_desc); n != NULL; n = rb_next(n)) {
        //根据binder_ref的成员变量rb_node_desc的地址指针n，来获取binder_ref的首地址
        ref = rb_entry(n, struct binder_ref, rb_node_desc);
        if (ref->desc > new_ref->desc)
          break;
        new_ref->desc = ref->desc + 1;
      }

      // 将新创建的new_ref 插入proc->refs_by_desc红黑树
      p = &proc->refs_by_desc.rb_node;
      while (*p) {
        parent = *p;
        ref = rb_entry(parent, struct binder_ref, rb_node_desc);

        if (new_ref->desc < ref->desc)
          p = &(*p)->rb_left;
        else if (new_ref->desc > ref->desc)
          p = &(*p)->rb_right;
        else
          BUG();
      }
      rb_link_node(&new_ref->rb_node_desc, parent, p);
      rb_insert_color(&new_ref->rb_node_desc, &proc->refs_by_desc);
      if (node) {
        hlist_add_head(&new_ref->node_entry, &node->refs);
      }
      return new_ref;
    }


handle值计算方法规律：

- 每个进程binder_proc所记录的binder_ref的handle值是从1开始递增的；
- 所有进程binder_proc所记录的handle=0的binder_ref都指向service manager；
- 同一个服务的binder_node在不同进程的binder_ref的handle值可以不同；

## 五. ServiceManager

由[Binder系列3—启动ServiceManager](http://gityuan.com/2015/11/07/binder-start-sm/)已介绍其原理，循环在binder_loop()过程，
会调用binder_parse()方法。

### 5.1 binder_parse
[-> servicemanager/binder.c]

    int binder_parse(struct binder_state *bs, struct binder_io *bio,
                     uintptr_t ptr, size_t size, binder_handler func)
    {
        int r = 1;
        uintptr_t end = ptr + (uintptr_t) size;

        while (ptr < end) {
            uint32_t cmd = *(uint32_t *) ptr;
            ptr += sizeof(uint32_t);
            switch(cmd) {
            case BR_TRANSACTION: {
                struct binder_transaction_data *txn = (struct binder_transaction_data *) ptr;
                ...
                binder_dump_txn(txn);
                if (func) {
                    unsigned rdata[256/4];
                    struct binder_io msg;
                    struct binder_io reply;
                    int res;

                    bio_init(&reply, rdata, sizeof(rdata), 4);
                    bio_init_from_txn(&msg, txn); //从txn解析出binder_io信息
                     // 收到Binder事务 【见小节5.2】
                    res = func(bs, txn, &msg, &reply);
                    // 发送reply事件【见小节5.4】
                    binder_send_reply(bs, &reply, txn->data.ptr.buffer, res);
                }
                ptr += sizeof(*txn);
                break;
            }
            case : ...
        }
        return r;
    }

### 5.2 svcmgr_handler
[-> service_manager.c]

    int svcmgr_handler(struct binder_state *bs,
                       struct binder_transaction_data *txn,
                       struct binder_io *msg,
                       struct binder_io *reply)
    {
        struct svcinfo *si;
        uint16_t *s;
        size_t len;
        uint32_t handle;
        uint32_t strict_policy;
        int allow_isolated;
        ...
        strict_policy = bio_get_uint32(msg);
        s = bio_get_string16(msg, &len);
        ...

        switch(txn->code) {
          case SVC_MGR_ADD_SERVICE:
              s = bio_get_string16(msg, &len);
              ...
              handle = bio_get_ref(msg); //获取handle
              allow_isolated = bio_get_uint32(msg) ? 1 : 0;
               //注册指定服务 【见小节5.3】
              if (do_add_service(bs, s, len, handle, txn->sender_euid,
                  allow_isolated, txn->sender_pid))
                  return -1;
              break;
           case :...
        }

        bio_put_uint32(reply, 0);
        return 0;
    }

### 5.3 do_add_service
[-> service_manager.c]

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
                svcinfo_death(bs, si); //服务已注册时，释放相应的服务
            }
            si->handle = handle;
        } else {
            si = malloc(sizeof(*si) + (len + 1) * sizeof(uint16_t));
            if (!si) {  //内存不足，无法分配足够内存
                return -1;
            }
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

        //以BC_ACQUIRE命令，handle为目标的信息，通过ioctl发送给binder驱动
        binder_acquire(bs, handle);
        //以BC_REQUEST_DEATH_NOTIFICATION命令的信息，通过ioctl发送给binder驱动，主要用于清理内存等收尾工作。
        binder_link_to_death(bs, handle, &si->death);
        return 0;
    }

svcinfo记录着服务名和handle信息，保存到svclist列表。

### 5.4  binder_send_reply
[-> servicemanager/binder.c]

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
        //向Binder驱动通信
        binder_write(bs, &data, sizeof(data));
    }

binder_write进入binder驱动后，将BC_FREE_BUFFER和BC_REPLY命令协议发送给Binder驱动，
向client端发送reply.

## 六. 总结

服务注册过程(addService)核心功能：在服务所在进程创建binder_node，在servicemanager进程创建binder_ref。
其中binder_ref的desc再同一个进程内是唯一的：

- 每个进程binder_proc所记录的binder_ref的handle值是从1开始递增的；
- 所有进程binder_proc所记录的handle=0的binder_ref都指向service manager；
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

整个过程中，BC_TRANSACTION和BR_TRANSACTION过程是一个完整的事务过程；BC_REPLY和BR_REPLY是一个完整的事务过程。
到此，其他进行便可以获取该服务，使用服务提供的方法，下一篇文章将会讲述[如何获取服务](http://gityuan.com/2015/11/15/binder-get-service/)。
