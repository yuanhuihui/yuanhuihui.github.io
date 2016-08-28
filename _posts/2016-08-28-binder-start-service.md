---
layout: post
title:  "以Binder视角来看Service启动(二)"
date:   2016-08-28 11:30:00
catalog:  true
tags:
    - android
    - binder
---

## 一. 概述

在前面的文章[startService流程分析](http://gityuan.com/2016/03/06/start-service/)，从系统framework层详细介绍Service启动流程，见下图：

![Activity_Manager_Service](/images/android-service/am/Activity_Manager_Service.png)

Service启动过程中，首先在发起方进程调用startService，经过binder驱动，最终进入system_server进程的binder线程来执行ActivityManagerService模块的代码。本文将以Binder视角来深入讲解其中地这一个过程：如何由AMP.startService 调用到 AMS.startService。

### 继承关系

这里涉及AMP(ActivityManagerProxy)和AMS(ActivityManagerService)，先来看看这两者之间的关系。

![activity_manager_classes](/images/android-service/am/activity_manager_classes.png)

从上图，可知：

- AMS继承于AMN(抽象类);
- AMN实现了IActivityManager接口，继承于Binder对象(Binder服务端)；
- AMP也实现IActivityManager接口；
- Binder对象实现了IBinder接口，IActivityManager继承于IInterface。

## 二. 分析

### 2.1 AMP.startService

    public ComponentName startService(IApplicationThread caller, Intent service,
                String resolvedType, String callingPackage, int userId) throws RemoteException
    {
        //【见小节2.1.1】
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(caller != null ? caller.asBinder() : null);
        service.writeToParcel(data, 0);
        data.writeString(resolvedType);
        data.writeString(callingPackage);
        data.writeInt(userId);

        //通过Binder 传递数据　【见小节2.2】
        mRemote.transact(START_SERVICE_TRANSACTION, data, reply, 0);
        //读取应答消息的异常情况
        reply.readException();
        //根据reply数据来创建ComponentName对象
        ComponentName res = ComponentName.readFromParcel(reply);
        //【见小节2.1.2】
        data.recycle();
        reply.recycle();
        return res;
    }

创建两个Parcel对象，data用于发送数据，reply用于接收应答数据。其中descriptor = "android.app.IActivityManager";

- 将startService相关数据都封装到Parcel对象data；通过mRemote发送到Binder驱动；
- Binder应答消息都封装到reply对象，从reply解析出ComponentName.

#### 2.1.1 Parcel.obtain

[-> Parcel.java]

    public static Parcel obtain() {
        final Parcel[] pool = sOwnedPool;
        synchronized (pool) {
            Parcel p;
            //POOL_SIZE = 6
            for (int i=0; i<POOL_SIZE; i++) {
                p = pool[i];
                if (p != null) {
                    pool[i] = null;
                    return p;
                }
            }
        }
        //当缓存池没有现成的Parcel对象，则直接创建
        return new Parcel(0);
    }

sOwnedPool是一个大小为6，存放着parcel缓存对象的数组池。obtain()方法首先尝试从缓存池sOwnedPool获取Parcel对象，当缓存池没有现成的Parcel对象，则直接创建Parcel对象。这样设计的目标是用于节省每次都创建Parcel对象的开销。

#### 2.1.2 Parcel.recycle

    public final void recycle() {
        //释放native parcel对象
        freeBuffer();
        final Parcel[] pool;
        //根据情况来选择加入相应池
        if (mOwnsNativeParcelObject) {
            pool = sOwnedPool;
        } else {
            mNativePtr = 0;
            pool = sHolderPool;
        }
        synchronized (pool) {
            for (int i=0; i<POOL_SIZE; i++) {
                if (pool[i] == null) {
                    pool[i] = this;
                    return;
                }
            }
        }
    }

将不再使用的Parcel对象放入缓存池，可回收重复利用，当缓存池已满则不再加入缓存池。

`mOwnsNativeParcelObject`变量来决定是加入`sOwnedPool`，还是`sHolderPool`池。该变量值取决于Parcel初始化init()过程是否存在native指针。

    private void init(long nativePtr) {
        if (nativePtr != 0) {
            //native指针不为0，则采用sOwnedPool
            mNativePtr = nativePtr;
            mOwnsNativeParcelObject = false;
        } else {
            //否则，采用sHolderPool
            mNativePtr = nativeCreate();
            mOwnsNativeParcelObject = true;
        }
    }

### 2.2 mRemote.transact

#### 2.2.1 mRemote

`mRemote`是在AMP对象创建的时候由构造函数赋值的，而AMP的创建是由ActivityManagerNative.getDefault()来获取的，核心实现是由如下代码：

    protected IActivityManager create(){
        //查询activity服务所对应的binder，此次b为BinderProxy对象
        IBinder b = ServiceManager.getService("activity");
        //创建AMP对象
        IActivityManager am = asInterface(b);
        return am;
    }

看过文章[Binder系列7—framework层分析](http://gityuan.com/2015/11/21/binder-framework/)，应该知道ServiceManager.getService("activity")返回的是指向目标服务AMS的代理对象BinderProxy.

    static public IActivityManager asInterface(IBinder obj) {
        if (obj == null) {
            return null;
        }
        IActivityManager in =
            (IActivityManager)obj.queryLocalInterface(descriptor);
        if (in != null) { //此处为null
            return in;
        }
        // 此处调用AMP的构造函数，obj为BinderProxy对象
        return new ActivityManagerProxy(obj);
    }

接下来，进入AMP的构造方法：

    class ActivityManagerProxy implements IActivityManager
    {
        public ActivityManagerProxy(IBinder remote)
        {
            mRemote = remote;
        }
    }

到此，可知mRemote便是指向AMS服务的BinderProxy对象。

#### 2.2.2 mRemote.transact

mRemote.transact(START_SERVICE_TRANSACTION, data, reply, 0);其中data保存了descriptor，caller, intent, resolvedType, callingPackage, userId这6项信息。

    final class BinderProxy implements IBinder {
        public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            //用于检测Parcel大小是否大于800k
            Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
            //【见2.3】
            return transactNative(code, data, reply, flags);
        }
    }

transactNative这是native方法，经过jni调用android_os_BinderProxy_transact方法。

### 2.3 android_os_BinderProxy_transact
[-> android_util_Binder.cpp]

    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        ...
        //将java Parcel转为native Parcel
        Parcel* data = parcelForJavaObject(env, dataObj);
        Parcel* reply = parcelForJavaObject(env, replyObj);

        //gBinderProxyOffsets.mObject中保存的是new BpBinder(handle)对象
        IBinder* target = (IBinder*) env->GetLongField(obj, gBinderProxyOffsets.mObject);

        ...
        if (kEnableBinderSample）{
            time_binder_calls = should_time_binder_calls();
            if (time_binder_calls) {
                start_millis = uptimeMillis();
            }
        }
        //此处便是BpBinder::transact(), 经过native层，进入Binder驱动程序【见小节2.4】
        status_t err = target->transact(code, *data, reply, flags);

        if (kEnableBinderSample) {
            if (time_binder_calls) {
                conditionally_log_binder_call(start_millis, target, code);
            }
        }
        if (err == NO_ERROR) {
            return JNI_TRUE;
        } else if (err == UNKNOWN_TRANSACTION) {
            return JNI_FALSE;
        }
        signalExceptionForError(env, obj, err, true /*canThrowRemoteException*/, data->dataSize());
        return JNI_FALSE;
    }

kEnableBinderSample这是调试开关，用于打开调试主线程执行一次transact所花时长的统计。接下来进入native层BpBinder

### 2.4 BpBinder.transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            // 【见小节2.5】
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

IPCThreadState::self()采用单例模式，保证每个线程只有一个实例对象。

### 2.5 IPC.transact
[-> IPCThreadState.cpp]

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....
        if (err == NO_ERROR) {
             // 传输数据 【见小节2.6】
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }

        if (err != NO_ERROR) {
            if (reply) reply->setError(err);
            return (mLastError = err);
        }

        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                //进入等待响应 【见小节2.7】
                err = waitForResponse(reply);
            }
            ...
        }
        ...
        return err;
    }

### 2.6 IPC.writeTransactionData
[-> IPCThreadState.cpp]

    status_t IPCThreadState::writeTransactionData(int32_t cmd, uint32_t binderFlags,
        int32_t handle, uint32_t code, const Parcel& data, status_t* statusBuffer)
    {
        binder_transaction_data tr;

        tr.target.ptr = 0;
        tr.target.handle = handle; // handle指向AMS
        tr.code = code;            // START_SERVICE_TRANSACTION
        tr.flags = binderFlags;    // 0
        tr.cookie = 0;
        tr.sender_pid = 0;
        tr.sender_euid = 0;

        const status_t err = data.errorCheck();
        if (err == NO_ERROR) {
            // data为startService相关信息
            tr.data_size = data.ipcDataSize();  
            tr.data.ptr.buffer = data.ipcData();
            tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t);
            tr.data.ptr.offsets = data.ipcObjects();
        }
        ...
        mOut.writeInt32(cmd);         //cmd = BC_TRANSACTION
        mOut.write(&tr, sizeof(tr));  //写入binder_transaction_data数据，保存到Parcel类对象mOut
        return NO_ERROR;
    }

其中

    size_t Parcel::ipcDataSize() ==> (mDataSize > mDataPos ? mDataSize : mDataPos);
    size_t Parcel::ipcObjectsCount() ==> mObjectsSize;
    uintptr_t Parcel::ipcData() ==>  reinterpret_cast<uintptr_t>(mData);
    uintptr_t Parcel::ipcObjects() ==> reinterpret_cast<uintptr_t>(mObjects);

### 2.7 IPC.waitForResponse

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;

        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见小节2.8】
            err = mIn.errorCheck();
            //当存在error则退出循环
            if (err < NO_ERROR) break;
            //当mDataSize > mDataPos则代表有可用数据，往下执行
            if (mIn.dataAvail() == 0) continue;

            cmd = mIn.readInt32();

            switch (cmd) {
            case BR_TRANSACTION_COMPLETE:
                if (!reply && !acquireResult) goto finish;
                break;

            ...

            default:
                err = executeCommand(cmd);  //【见小节2.9】
                if (err != NO_ERROR) goto finish;
                break;
            }
        }

    finish:
        if (err != NO_ERROR) {
            if (reply) reply->setError(err);
        }
        return err;
    }

### 2.8  IPC.talkWithDriver

    status_t IPCThreadState::talkWithDriver(bool doReceive)
    {
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
            //ioctl不停的读写操作
            if (ioctl(mProcess->mDriverFD, BINDER_WRITE_READ, &bwr) >= 0)
                err = NO_ERROR;
            else
                err = -errno;
            ...
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


[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。

### 2.9 IPC.executeCommand

[add Service](http://gityuan.com/2015/11/14/binder-add-service/)

...

未完，先占位。
