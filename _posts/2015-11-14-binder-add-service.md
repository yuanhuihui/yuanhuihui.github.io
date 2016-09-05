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

    /framework/native/libs/binder/IServiceManager.cpp
    /framework/native/libs/binder/BpBinder.cpp
    /framework/native/libs/binder/IPCThreadState.cpp
    /framework/native/libs/binder/Binder.cpp
    /framework/native/libs/binder/ProcessState.cpp

    /framework/av/media/libmediaplayerservice/MediaPlayerService.cpp


###  入口

在Native层的服务以media服务为例，注册服务media的入口函数是`main_mediaserver.cpp`中的`main()`方法，代码如下：

    int main(int argc __unused, char** argv)
    {
        ...
        InitializeIcuOrDie();  //初始化ICU，国际通用编码方案。
        //获得ProcessState实例对象
        sp<ProcessState> proc(ProcessState::self());
        //获取ServiceManager实例对象 【见文章《获取ServiceManager》】
        sp<IServiceManager> sm = defaultServiceManager();
        AudioFlinger::instantiate();
        //多媒体服务  【见流程1~13】
        MediaPlayerService::instantiate();
        ResourceManagerService::instantiate();
        CameraService::instantiate();
        AudioPolicyService::instantiate();
        SoundTriggerHwService::instantiate();
        RadioService::instantiate();
        registerExtensions();
        //创建Binder线程，并加入线程池【见流程14】
        ProcessState::self()->startThreadPool();
        //当前线程加入到线程池 【见流程16】
        IPCThreadState::self()->joinThreadPool();
     }

该过程的主要流程如下所示：

![workflow](/images/binder/addService/workflow.jpg)

其中ProcessState::self()和defaultServiceManager()过程在上一篇文章[获取ServiceManager](http://gityuan.com/2015/11/08/binder-get-sm/#defaultservicemanager)已讲过，下面说说后3个方法的具体工作内容。

----------

**类图：**

在Native层的服务注册，我们选择以media为例来展开讲解，先来看看media的类关系图。

点击查看[大图](http://gityuan.com/images/binder/addService/add_media_player_service.png)

![add_media_player_service](/images/binder/addService/add_media_player_service.png)

图解：

- 蓝色代表的是注册MediaPlayerService服务所涉及的类
- 绿色代表的是Binder架构中与Binder驱动通信过程中的最为核心的两个类；
- 紫色代表的是注册服务和[获取服务](http://gityuan.com/2015/11/15/binder-get-service/)的公共接口/父类；



**时序图**

点击查看[大图](http://gityuan.com/images/binder/addService/addService.jpg)

![addService](/images/binder/addService/addService.jpg)

注意每小节前的**[ 数字 ]** 是与时序图所处的**顺序编号**一一对应，中间会省略部分方法，所以看到的小节可能并非连续的，建议读者一个窗口打开时序图，另一个窗口顺着文章往下读，这样不至于迷糊。另外，为了让每小节标题更加紧凑，下面流程采用如下简称：

    MPS: MediaPlayerService
    IPC: IPCThreadState
    PS:  ProcessState
    ISM: IServiceManager

### 1. MPS:instantiate
==> `/framework/av/media/libmediaplayerservice/MediaPlayerService.cpp`

    void MediaPlayerService::instantiate() {
        defaultServiceManager()->addService(
               String16("media.player"), new MediaPlayerService()); 【见流程3】
    }

注册服务MediaPlayerService：由[defaultServiceManager()](http://gityuan.com/2015/11/08/binder-get-sm/)返回的是BpServiceManager，同时会创建ProcessState对象和BpBinder对象。故此处等价于调用BpServiceManager->addService。关于`MediaPlayerService`创建过程，此处就省略后面有时间会单独介绍，接下来进入流程[3]。

### 3. ISM.addService
==> `/framework/native/libs/binder/IServiceManager.cpp`

    virtual status_t addService(const String16& name, const sp<IBinder>& service,
            bool allowIsolated)
    {
        Parcel data, reply; //Parcel是数据通信包
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());   //写入RPC头信息
        data.writeString16(name);        // name为 "media.player"
        data.writeStrongBinder(service); // MediaPlayerService对象
        data.writeInt32(allowIsolated ? 1 : 0); // allowIsolated= false
        status_t err = remote()->transact(ADD_SERVICE_TRANSACTION, data, &reply); //【见流程4】
        return err == NO_ERROR ? reply.readExceptionCode() : err;
    }


服务注册过程

- 将名叫"media.player"的MediaPlayerService服务注册到ServiceManager；
- RPC头信息为 "android.os.IServiceManager"；
- remote()就是BpBinder()；

### 4. BpBinder::transact
==> `/framework/native/libs/binder/BpBinder.cpp`

由【流程3】传递过来的参数：transact(ADD_SERVICE_TRANSACTION, data, &reply, 0);

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            // 【见流程5和7】
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

Binder代理类调用transact()方法，真正工作还是交给IPCThreadState来进行transact工作，


### 5. IPCThreadState::self
==> `/framework/native/libs/binder/IPCThreadState.cpp`

    IPCThreadState* IPCThreadState::self()
    {
        if (gHaveTLS) {
    restart:
            const pthread_key_t k = gTLS;
            IPCThreadState* st = (IPCThreadState*)pthread_getspecific(k);
            if (st) return st;
            return new IPCThreadState;  //初始IPCThreadState 【见流程6】
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


获取IPCThreadState对象


TLS是指Thread local storage(线程本地储存空间)，每个线程都拥有自己的TLS，并且是私有空间，线程之间不会共享。通过pthread_getspecific/pthread_setspecific函数可以获取/设置这些空间中的内容。从线程本地存储空间中获得保存在其中的IPCThreadState对象。

### 6. new IPCThreadState
==> `/framework/native/libs/binder/IPCThreadState.cpp`

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

### 7. IPC::transact
==> `/framework/native/libs/binder/IPCThreadState.cpp`

由【流程4】传递过来的参数：transact (0，ADD_SERVICE_TRANSACTION, data, &reply, 0);

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....
        if (err == NO_ERROR) {
             // 传输数据 【见流程8】
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }

        if (err != NO_ERROR) {
            if (reply) reply->setError(err);
            return (mLastError = err);
        }

        if ((flags & TF_ONE_WAY) == 0) {
            //需要等待reply的场景
            if (reply) {
                //等待响应  【见流程9】
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

### 8. IPC.writeTransactionData
==> `/framework/native/libs/binder/IPCThreadState.cpp`

由【流程7】传递过来的参数：writeTransactionData(BC_TRANSACTION, 0, 0, ADD_SERVICE_TRANSACTION, data, NULL)

    status_t IPCThreadState::writeTransactionData(int32_t cmd, uint32_t binderFlags,
        int32_t handle, uint32_t code, const Parcel& data, status_t* statusBuffer)
    {
        binder_transaction_data tr;

        tr.target.ptr = 0;
        tr.target.handle = handle; // handle=0
        tr.code = code;            // ADD_SERVICE_TRANSACTION
        tr.flags = binderFlags;    // 0
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
            tr.flags |= TF_STATUS_CODE;
            *statusBuffer = err;
            tr.data_size = sizeof(status_t);
            tr.data.ptr.buffer = reinterpret_cast<uintptr_t>(statusBuffer);
            tr.offsets_size = 0;
            tr.data.ptr.offsets = 0;
        } else {
            return (mLastError = err);
        }

        mOut.writeInt32(cmd);         //cmd = BC_TRANSACTION
        mOut.write(&tr, sizeof(tr));  //写入binder_transaction_data数据

        return NO_ERROR;
    }


其中handle的值用来标识目的端，注册服务过程的目的端为service manager，此处handle=0所对应的是binder_context_mgr_node对象，正是service manager所对应的binder实体对象。[binder_transaction_data结构体](http://gityuan.com/2015/11/01/binder-driver/#bindertransactiondata)是binder驱动通信的数据结构，该过程最终是把Binder请求码BC_TRANSACTION和binder_transaction_data结构体写入到`mOut`。


### 9. IPC.waitForResponse
==> `/framework/native/libs/binder/IPCThreadState.cpp`

【流程7】传递过来的参数：waitForResponse(&reply, NULL);

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;

        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见流程10】
            err = mIn.errorCheck();
            if (err < NO_ERROR) break;
            if (mIn.dataAvail() == 0) continue;

            cmd = mIn.readInt32();

            switch (cmd) {
            case BR_TRANSACTION_COMPLETE:
                if (!reply && !acquireResult) goto finish;
                break;

            case BR_DEAD_REPLY:
                err = DEAD_OBJECT;
                goto finish;

            case BR_FAILED_REPLY:
                err = FAILED_TRANSACTION;
                goto finish;

            case BR_ACQUIRE_RESULT:
                {
                    const int32_t result = mIn.readInt32();
                    if (!acquireResult) continue;
                    *acquireResult = result ? NO_ERROR : INVALID_OPERATION;
                }
                goto finish;

            case BR_REPLY:
                {
                    binder_transaction_data tr;
                    err = mIn.read(&tr, sizeof(tr));
                    if (err != NO_ERROR) goto finish;

                    if (reply) {
                        if ((tr.flags & TF_STATUS_CODE) == 0) {
                            reply->ipcSetDataReference(
                                reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                                tr.data_size,
                                reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                                tr.offsets_size/sizeof(binder_size_t),
                                freeBuffer, this);
                        } else {
                            err = *reinterpret_cast<const status_t*>(tr.data.ptr.buffer);
                            freeBuffer(NULL,
                                reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                                tr.data_size,
                                reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                                tr.offsets_size/sizeof(binder_size_t), this);
                        }
                    } else {
                        freeBuffer(NULL,
                            reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                            tr.data_size,
                            reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                            tr.offsets_size/sizeof(binder_size_t), this);
                        continue;
                    }
                }
                goto finish;

            default:
                err = executeCommand(cmd);  //【见流程11】
                if (err != NO_ERROR) goto finish;
                break;
            }
        }

    finish:
        if (err != NO_ERROR) {
            if (acquireResult) *acquireResult = err;
            if (reply) reply->setError(err);
            mLastError = err;
        }

        return err;
    }

不断循环地与Binder驱动设备交互，获取响应信息

### 10. IPC.talkWithDriver
==> `/framework/native/libs/binder/IPCThreadState.cpp`

    status_t IPCThreadState::talkWithDriver(bool doReceive)
    {
        if (mProcess->mDriverFD <= 0) {
            return -EBADF;
        }

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

        } while (err == -EINTR);

        if (err >= NO_ERROR) {
            if (bwr.write_consumed > 0) {
                if (bwr.write_consumed < mOut.dataSize())
                    mOut.remove(0, bwr.write_consumed);
                else
                    mOut.setDataSize(0);
            }
            if (bwr.read_consumed > 0) {
                mIn.setDataSize(bwr.read_consumed);
                mIn.setDataPosition(0);
            }
            return NO_ERROR;
        }
        return err;
    }


[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。 主要是操作mOut和mIn变量。

### 11. IPC.executeCommand
==> `/framework/native/libs/binder/IPCThreadState.cpp`

根据收到的响应消息，执行相应的操作

【流程9】传递过来的参数：executeCommand(BR_TRANSACTION)

    status_t IPCThreadState::executeCommand(int32_t cmd)
    {
        BBinder* obj;
        RefBase::weakref_type* refs;
        status_t result = NO_ERROR;

        switch (cmd) {
        case BR_ERROR:
            result = mIn.readInt32();
            break;

        case BR_OK:
            break;

        case BR_ACQUIRE:
            refs = (RefBase::weakref_type*)mIn.readPointer();
            obj = (BBinder*)mIn.readPointer();
            obj->incStrong(mProcess.get());
            mOut.writeInt32(BC_ACQUIRE_DONE);
            mOut.writePointer((uintptr_t)refs);
            mOut.writePointer((uintptr_t)obj);
            break;

        case BR_RELEASE:
            refs = (RefBase::weakref_type*)mIn.readPointer();
            obj = (BBinder*)mIn.readPointer();
            mPendingStrongDerefs.push(obj);
            break;

        case BR_INCREFS:
            refs = (RefBase::weakref_type*)mIn.readPointer();
            obj = (BBinder*)mIn.readPointer();
            refs->incWeak(mProcess.get());
            mOut.writeInt32(BC_INCREFS_DONE);
            mOut.writePointer((uintptr_t)refs);
            mOut.writePointer((uintptr_t)obj);
            break;

        case BR_DECREFS:
            refs = (RefBase::weakref_type*)mIn.readPointer();
            obj = (BBinder*)mIn.readPointer();
            mPendingWeakDerefs.push(refs);
            break;

        case BR_ATTEMPT_ACQUIRE:
            refs = (RefBase::weakref_type*)mIn.readPointer();
            obj = (BBinder*)mIn.readPointer();
            const bool success = refs->attemptIncStrong(mProcess.get());
            mOut.writeInt32(BC_ACQUIRE_RESULT);
            mOut.writeInt32((int32_t)success);
            break;

        case BR_TRANSACTION:
            {
                binder_transaction_data tr;
                result = mIn.read(&tr, sizeof(tr));
                if (result != NO_ERROR) break;

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

                mCallingPid = tr.sender_pid;
                mCallingUid = tr.sender_euid;
                mLastTransactionBinderFlags = tr.flags;

                int curPrio = getpriority(PRIO_PROCESS, mMyThreadId);
                if (gDisableBackgroundScheduling) {
                    if (curPrio > ANDROID_PRIORITY_NORMAL) {
                        setpriority(PRIO_PROCESS, mMyThreadId, ANDROID_PRIORITY_NORMAL);
                    }
                } else {
                    if (curPrio >= ANDROID_PRIORITY_BACKGROUND) {
                        set_sched_policy(mMyThreadId, SP_BACKGROUND);
                    }
                }

                Parcel reply;
                status_t error;
                // tr.cookie里存放的是BBinder，此处b是BBinder的实现子类
                if (tr.target.ptr) {
                    sp<BBinder> b((BBinder*)tr.cookie);
                    error = b->transact(tr.code, buffer, &reply, tr.flags); //【见流程12】

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

        case BR_DEAD_BINDER:
            {  //收到binder驱动发来的service死掉的消息，只有Bp端能收到。
                BpBinder *proxy = (BpBinder*)mIn.readPointer();
                proxy->sendObituary();
                mOut.writeInt32(BC_DEAD_BINDER_DONE);
                mOut.writePointer((uintptr_t)proxy);
            } break;

        case BR_CLEAR_DEATH_NOTIFICATION_DONE:
            {
                BpBinder *proxy = (BpBinder*)mIn.readPointer();
                proxy->getWeakRefs()->decWeak(proxy);
            } break;

        case BR_FINISHED:
            result = TIMED_OUT;
            break;

        case BR_NOOP:
            break;

        case BR_SPAWN_LOOPER:
            //收到来自驱动的指示以创建一个新线程，用于和Binder通信 【见流程17】
            mProcess->spawnPooledThread(false);
            break;

        default:
            result = UNKNOWN_ERROR;
            break;
        }

        if (result != NO_ERROR) {
            mLastError = result;
        }

        return result;
    }

### 12. BBinder::transact
==> `/framework/native/libs/binder/Binder.cpp`

服务端transact事务处理

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
                err = onTransact(code, data, reply, flags); //【见流程13】
                break;
        }

        if (reply != NULL) {
            reply->setDataPosition(0);
        }

        return err;
    }

### 13. BBinder::onTransact
==> `/framework/native/libs/binder/Binder.cpp`

服务端事务回调处理函数

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

对于MediaPlayerService的场景下，事实上BnMediaPlayerService继承了BBinder类，且重载了onTransact()方法，故实际调用的是BnMediaPlayerService::onTransact()方法。


----------

### 小结

从流程1到流程13，整个过程是`MediaPlayerService`服务向`Service Manager`进程进行服务注册的过程。在整个过程涉及到MediaPlayerService(作为Client进程)和Service Manager(作为Service进程)，通信流程图如下所示：

![media_player_service_ipc](/images/binder/addService/media_player_service_ipc.png)


过程分析：

1. MediaPlayerService进程调用`ioctl()`向Binder驱动发送IPC数据，该过程可以理解成一个事务`binder_transaction`(记为`T1`)，执行当前操作的线程binder_thread(记为`thread1`)，则T1->from_parent=NULL，T1->from = `thread1`，thread1->transaction_stack=T1。其中IPC数据内容包含：
    - Binder协议为BC_TRANSACTION；
    - Handle等于0；
    - RPC代码为ADD_SERVICE；
    - RPC数据为"media.player"。

2. Binder驱动收到该Binder请求，生成`BR_TRANSACTION`命令，选择目标处理该请求的线程，即ServiceManager的binder线程(记为`thread2`)，则 T1->to_parent = NULL，T1->to_thread = `thread2`。并将整个binder_transaction数据(记为`T2`)插入到目标线程的todo队列；

3. Service Manager的线程`thread2`收到`T2`后，调用服务注册函数将服务"media.player"注册到服务目录中。当服务注册完成后，生成IPC应答数据(`BC_REPLY`)，T2->form_parent = T1，T2->from = thread2, thread2-)->transaction_stack = T2。

4. Binder驱动收到该Binder应答请求，生成`BR_REPLY`命令，T2->to_parent = T1，T2->to_thread = thread1, thread1->transaction_stack = T2。 在MediaPlayerService收到该命令后，知道服务注册完成便可以正常使用。

整个过程中，BC_TRANSACTION和BR_TRANSACTION过程是一个完整的事务过程；BC_REPLY和BR_REPLY是一个完整的事务过程。
到此，其他进行便可以获取该服务，使用服务提供的方法，下一篇文章将会讲述[如何获取服务](http://gityuan.com/2015/11/15/binder-get-service/)。

### 14 PS.startThreadPool
==> `/framework/native/libs/binder/ProcessState.cpp`

先通过ProcessState::self()，来获取单例对象ProcessState，再进行启动线程池

    void ProcessState::startThreadPool()
    {
        AutoMutex _l(mLock);    //多线程同步 自动锁
        if (!mThreadPoolStarted) {
            mThreadPoolStarted = true;
            spawnPooledThread(true);  【见流程15】
        }
    }

通过变量mThreadPoolStarted来保证每个应用进程只允许主动创建一个binder线程，其余binder线程池中的线程都是由Binder驱动来控制创建的。

### 15. PS.spawnPooledThread
==> `/framework/native/libs/binder/ProcessState.cpp`

    void ProcessState::spawnPooledThread(bool isMain)
    {
        if (mThreadPoolStarted) {
            String8 name = makeBinderThreadName(); //获取Binder线程名
            sp<Thread> t = new PoolThread(isMain); //isMain=true
            t->run(name.string());
        }
    }

- 获取Binder线程名，格式为`Binder_x`, 其中x为整数。每个进程中的binder编码是从1开始，依次递增;
- 在终端通过 `ps -t | grep Binder`，能看到当前所有的Binder线程。

从函数名看起来是创建线程池，其实就只是创建一个线程，该PoolThread继承Thread类。t->run()方法最终调用 PoolThread的threadLoop()方法。


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
            IPCThreadState::self()->joinThreadPool(mIsMain); // 【见流程16】
            return false;
        }

        const bool mIsMain;
    };


### 16 IPC.joinThreadPool()
==> `/framework/native/libs/binder/IPCThreadState.cpp`

    void IPCThreadState::joinThreadPool(bool isMain)
    {
        //创建Binder线程
        mOut.writeInt32(isMain ? BC_ENTER_LOOPER : BC_REGISTER_LOOPER);
        set_sched_policy(mMyThreadId, SP_FOREGROUND); //设置前台调度策略

        status_t result;
        do {
            processPendingDerefs(); //清除队列的引用
            result = getAndExecuteCommand(); //处理下一条指令 【见流程17】

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


先通过IPCThreadState::self()，来获取单例对象IPCThreadState，再join到线程池中。对于前面新创建的线程
`new PoolThread()`以及当前线程，都会调用到该方法。

将线程调度策略设置SP_FOREGROUND，当已启动的线程由后台的scheduling group创建，可以避免由后台线程优先级来执行初始化的transaction。

对于参数`isMain`=true的情况下，command为BC_ENTER_LOOPER，表示是程序主动创建的线程；而对于`isMain`=false的情况下，command为BC_REGISTER_LOOPER，表示是由binder驱动强制创建的线程。Binder设计架构中，只有第一个Binder线程是由应用层主动创建，对于Binder线程池其他的线程都是由Binder驱动根据IPC通信需求来控制创建的。


### 17 IPC.getAndExecuteCommand
==> `/framework/native/libs/binder/IPCThreadState.cpp`

获取并处理指令

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

### 总结

MediaPlayerService服务注册

- 前面13个步骤的功能是MediaPlayerService服务向ServiceManager进行服务注册的过程
- 接下来，通过startThreadPool()方法创建了一个binder线程，该线程在不断跟Binder驱动进行交互；
- 最后，当前主线程通过joinThreadPool，也实现了Binder进行交互；

故至少有两个线程与Binder驱动进行交互，后续更加需求Binder驱动会增加binder线程个数，线程池默认上限为16个。
