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

先来看看Native Binder IPC的两个重量级对象：BpBinder(客户端)和BBinder(服务端)都是Android中Binder通信相关的代表，它们都从IBinder类中派生而来，关系图如下：

![Binder关系图](/images/binder/prepare/Ibinder_classes.jpg)

- IBinder有一个重要方法queryLocalInterface， 默认返回值为NULL；
  - BBinder/BpBinder都没有实现，默认返回NULL；BnInterface重写该方法；
  - BinderProxy(Java)默认返回NULL；Binder(Java)重写该方法；
- IInterface有一个重要方法asBinder；
- IInterface子类(服务端)会有一个方法asInterface；

Native层通过宏IMPLEMENT_META_INTERFACE来完成asInterface实现和descriptor的赋值过程；

Tips: 对于Java层跟Native一样，也有完全对应的一套对象和方法。
例如ActivityManagerNative， 通过实现asInterface方法，以及其通过其构造函数
调用attachInterface()，完成descriptor的赋值过程。再比如AIDL全自动生成asInterface和descriptor赋值过程。

同一个进程，请求binder服务，是否需要经过binder call，取决于descriptor是否设置。

#### 1.1 类图

在Native层的服务以media服务为例，来说一说服务注册过程，先来看看media的整个的类关系图。

点击查看[大图](http://gityuan.com/images/binder/addService/add_media_player_service.png)

![add_media_player_service](/images/binder/addService/add_media_player_service.png)

图解：

- 蓝色代表的是注册MediaPlayerService服务所涉及的类
- 绿色代表的是Binder架构中与Binder驱动通信过程中的最为核心的两个类；
- 紫色代表的是注册服务和[获取服务](http://gityuan.com/2015/11/15/binder-get-service/)的公共接口/父类；


#### 1.2 时序图

先通过一幅图来说说，media服务启动过程是如何向servicemanager注册服务的。

点击查看[大图](http://gityuan.com/images/binder/addService/addService.jpg)

![addService](/images/binder/addService/addService.jpg)

为了让每小节标题更加紧凑，下面流程采用如下简称：

    MPS: MediaPlayerService
    IPC: IPCThreadState
    PS:  ProcessState
    ISM: IServiceManager

## 二. 启动过程

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
        //创建Binder线程，并加入线程池【小节4.1】
        ProcessState::self()->startThreadPool();
        //当前线程加入到线程池 【见小节4.3】
        IPCThreadState::self()->joinThreadPool();
     }

[获取ServiceManager](http://gityuan.com/2015/11/08/binder-get-sm/#defaultservicemanager)
已介绍过defaultServiceManager()返回的是BpServiceManager对象，用于跟/system/bin/servicemanager进程通信。

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
            //采用内存映射函数mmap，给binder分配一块虚拟地址空间,用来接收事务
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

## 三. 服务注册

### 3.1 MPS.instantiate
[-> MediaPlayerService.cpp]

    void MediaPlayerService::instantiate() {
        //注册服务【见小节3.2】
        defaultServiceManager()->addService(
               String16("media.player"), new MediaPlayerService()); 
    }

注册服务MediaPlayerService：由[defaultServiceManager()](http://gityuan.com/2015/11/08/binder-get-sm/)返回的是BpServiceManager，同时会创建ProcessState对象和BpBinder对象。故此处等价于调用BpServiceManager->addService。
其中MediaPlayerService位于libmediaplayerservice库，其创建过程此处就省略后面有时间会单独介绍，接下来进入流程[2]。

### 3.2 addService
[-> IServiceManager.cp BpServiceManager]

    virtual status_t addService(const String16& name, const sp<IBinder>& service,
            bool allowIsolated)
    {
        Parcel data, reply; //Parcel是数据通信包
        //写入头信息"android.os.IServiceManager"
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());   
        data.writeString16(name);        // name为 "media.player"
        data.writeStrongBinder(service); // MediaPlayerService对象
        data.writeInt32(allowIsolated ? 1 : 0); // allowIsolated= false
        //remote()指向的是BpBinder对象【见小节3.3】
        status_t err = remote()->transact(ADD_SERVICE_TRANSACTION, data, &reply);
        return err == NO_ERROR ? reply.readExceptionCode() : err;
    }


服务注册过程：向ServiceManager注册服务MediaPlayerService，服务名为"media.player"；

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

        const status_t err = data.errorCheck();
        if (err == NO_ERROR) {
            tr.data_size = data.ipcDataSize();  // data为Media服务相关的parcel通信数据包
            tr.data.ptr.buffer = data.ipcData();
            tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t);
            tr.data.ptr.offsets = data.ipcObjects();
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

transact过程，先写完binder_transaction_data数据， 接下来执行waitForResponse()方法。

### 3.6 IPC.waitForResponse
[-> IPCThreadState.cpp]

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;
        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见小节3.6.1】
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
                    err = executeCommand(cmd);  //【见小节3.6.2】
                    if (err != NO_ERROR) goto finish;
                    break;
            }
        }
        ...
        return err;
    }

不断循环地与Binder驱动设备交互，获取响应信息

#### 3.6.1 IPC.talkWithDriver
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
            else
                err = -errno;
            if (mProcess->mDriverFD <= 0) {
                err = -EBADF;
            }
        } while (err == -EINTR); //当被中断，则继续执行
        ...
        return err;
    }


[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。 主要是操作mOut和mIn变量。

在waitForResponse过程, 首先执行BR_TRANSACTION_COMPLETE；另外，目标进程收到事务后，处理BR_TRANSACTION事务。
然后发送给当前进程，再执行BR_REPLY命令。

此处省略若干过程...， 当服务注册完成后，其他进程请求该服务时则会执行到BR_TRANSACTION过程：

### 3.7 IPC.executeCommand
[-> IPCThreadState.cpp]

    status_t IPCThreadState::executeCommand(int32_t cmd)
    {
        BBinder* obj;
        RefBase::weakref_type* refs;
        status_t result = NO_ERROR;

        switch (cmd) {
          case BR_TRANSACTION:
          {
            binder_transaction_data tr;
            result = mIn.read(&tr, sizeof(tr));
            ...
            Parcel buffer;
            buffer.ipcSetDataReference(
                reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                tr.data_size,
                reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                tr.offsets_size/sizeof(binder_size_t), freeBuffer, this);

            const pid_t origPid = mCallingPid;
            const uid_t origUid = mCallingUid;
            const int32_t origStrictModePolicy = mStrictModePolicy;
            const int32_t origTransactionBinderFlags = mLastTransactionBinderFlags;

            mCallingPid = tr.sender_pid; //发起端的pid
            mCallingUid = tr.sender_euid; //发起端的uid
            mLastTransactionBinderFlags = tr.flags;

            int curPrio = getpriority(PRIO_PROCESS, mMyThreadId);
            ... //调整优先级

            Parcel reply;
            status_t error;
            // tr.cookie里存放的是BBinder，此处b是BBinder的实现子类
            if (tr.target.ptr) {
                sp<BBinder> b((BBinder*)tr.cookie);
                error = b->transact(tr.code, buffer, &reply, tr.flags); //【见小节3.8】
            } else {
                error = the_context_object->transact(tr.code, buffer, &reply, tr.flags);
            }

            if ((tr.flags & TF_ONE_WAY) == 0) {
                if (error < NO_ERROR) reply.setError(error);
                sendReply(reply, 0);
            }

            mCallingPid = origPid;
            mCallingUid = origUid;
            mStrictModePolicy = origStrictModePolicy;
            mLastTransactionBinderFlags = origTransactionBinderFlags;
          }
          break;
          ...
        }
        ...
        return result;
    }

    
### 3.8 BBinder::transact
[-> Binder.cpp]

    status_t BBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        data.setDataPosition(0);

        status_t err = NO_ERROR;
        switch (code) {
            case PING_TRANSACTION:
                reply->writeInt32(pingBinder());
                break;
            default:
                err = onTransact(code, data, reply, flags); //【见小节3.9】
                break;
        }

        if (reply != NULL) {
            reply->setDataPosition(0);
        }

        return err;
    }

服务端transact事务处理

### 3.9 BBinder::onTransact
[-> Binder.cpp]

    status_t BBinder::onTransact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t /*flags*/)
    {
        switch (code) {
            case INTERFACE_TRANSACTION:
                reply->writeString16(getInterfaceDescriptor());
                return NO_ERROR;

            case DUMP_TRANSACTION: {
                int fd = data.readFileDescriptor();
                int argc = data.readInt32();
                Vector<String16> args;
                for (int i = 0; i < argc && data.dataAvail() > 0; i++) {
                   args.add(data.readString16());
                }
                return dump(fd, args);
            }

            case SYSPROPS_TRANSACTION: {
                report_sysprop_change();
                return NO_ERROR;
            }

            default:
                return UNKNOWN_TRANSACTION;
        }
    }

以上只是默认处理过程，但对于本文的MediaPlayerService继承于BnMediaPlayerService,由间接继承于BBinder对象，
在BnMediaPlayerService重载了onTransact()方法，故实际调用的是BnMediaPlayerService::onTransact()方法。

##  四. Binder线程池

### 4.1 PS.startThreadPool
[-> ProcessState.cpp]

    void ProcessState::startThreadPool()
    {
        AutoMutex _l(mLock);    //多线程同步 自动锁
        if (!mThreadPoolStarted) {
            mThreadPoolStarted = true;
            spawnPooledThread(true);  【见流程4.2】
        }
    }

通过ProcessState::self()，来获取单例对象ProcessState，再进行启动线程池。
使用变量mThreadPoolStarted来保证每个应用进程只允许主动创建一个binder线程，其余binder线程池中的线程都是由Binder驱动来控制创建的。

### 4.2 PS.spawnPooledThread
[-> ProcessState.cpp]

    void ProcessState::spawnPooledThread(bool isMain)
    {
        if (mThreadPoolStarted) {
            String8 name = makeBinderThreadName(); //获取Binder线程名
            sp<Thread> t = new PoolThread(isMain); //isMain=true 【见小节4.2.1】
            t->run(name.string());
        }
    }

- 获取Binder线程名，格式为`Binder_x`, 其中x为整数。每个进程中的binder编码是从1开始，依次递增;
- 在终端通过 `ps -t | grep Binder`，能看到当前所有的Binder线程。

从函数名看起来是创建线程池，其实就只是创建一个线程，该PoolThread继承Thread类，t->run()方法最终调用PoolThread的threadLoop()方法。

#### 4.2.1 PoolThread

    class PoolThread : public Thread
    {
    public:
        PoolThread(bool isMain)
            : mIsMain(isMain)
        {
        }

    protected:
        virtual bool threadLoop()
        {
            IPCThreadState::self()->joinThreadPool(mIsMain); //【见小节4.3】
            return false;
        }
        const bool mIsMain;
    };

在新创建的线程里面执行joinThreadPool()方法，加入到Binder线程池，执行binder操作。

### 4.3 IPC.joinThreadPool
[-> IPCThreadState.cpp]

    void IPCThreadState::joinThreadPool(bool isMain)
    {
        //创建Binder线程
        mOut.writeInt32(isMain ? BC_ENTER_LOOPER : BC_REGISTER_LOOPER);
        set_sched_policy(mMyThreadId, SP_FOREGROUND); //设置前台调度策略

        status_t result;
        do {
            processPendingDerefs(); //清除队列的引用
            result = getAndExecuteCommand(); //处理下一条指令 【见小节4.4】

            if (result < NO_ERROR && result != TIMED_OUT && result != -ECONNREFUSED && result != -EBADF) {
                abort();
            }

            if(result == TIMED_OUT && !isMain) {
                break;
            }
        } while (result != -ECONNREFUSED && result != -EBADF);

        mOut.writeInt32(BC_EXIT_LOOPER);  // 线程退出循环
        talkWithDriver(false); //false代表bwr数据的read_buffer为空 【见流程10】
    }

将线程调度策略设置SP_FOREGROUND，当已启动的线程由后台的scheduling group创建，可以避免由后台线程优先级来执行初始化的transaction。
Binder设计架构中，只有第一个Binder线程是由应用层主动创建，对于Binder线程池其他的线程都是由Binder驱动根据IPC通信需求来控制创建的。

- 对于参数`isMain`=true时，command为BC_ENTER_LOOPER，表示是程序主动创建的线程；
- 对于参数`isMain`=false时，command为BC_REGISTER_LOOPER，表示是由binder驱动强制创建的线程。

另外，此处有timeout退出机制，当binder线程长时间没有执行任务，则退出该线程。

### 4.4 IPC.getAndExecuteCommand
[-> IPCThreadState.cpp]

    status_t IPCThreadState::getAndExecuteCommand()
    {
        status_t result;
        int32_t cmd;

        result = talkWithDriver(); //与binder进行交互 【见流程10】
        if (result >= NO_ERROR) {
            size_t IN = mIn.dataAvail();
            if (IN < sizeof(int32_t)) return result;
            cmd = mIn.readInt32();

            pthread_mutex_lock(&mProcess->mThreadCountLock);
            mProcess->mExecutingThreadsCount++;
            pthread_mutex_unlock(&mProcess->mThreadCountLock);

            result = executeCommand(cmd); //执行Binder响应码  【见流程11】

            pthread_mutex_lock(&mProcess->mThreadCountLock);
            mProcess->mExecutingThreadsCount--;
            pthread_cond_broadcast(&mProcess->mThreadCountDecrement);
            pthread_mutex_unlock(&mProcess->mThreadCountLock);

            set_sched_policy(mMyThreadId, SP_FOREGROUND);
        }
        return result;
    }

## 五.总结

MediaPlayerService服务注册

- 前面13个步骤的功能是MediaPlayerService服务向ServiceManager进行服务注册的过程
- 再通过startThreadPool()方法创建了一个binder线程，该线程在不断跟Binder驱动进行交互；
- 最后將当前主线程通过joinThreadPool，也实现了Binder进行交互；


从流程1到流程13，整个过程是`MediaPlayerService`服务向`Service Manager`进程进行服务注册的过程。在整个过程涉及到MediaPlayerService(作为Client进程)和Service Manager(作为Service进程)，通信流程图如下所示：

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
