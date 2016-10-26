---
layout: post
title:  "以Binder视角来看Service启动"
date:   2016-09-04 11:30:00
catalog:  true
tags:
    - android
    - binder
---

## 一. 概述

在前面的文章[startService流程分析](http://gityuan.com/2016/03/06/start-service/)，从系统framework层详细介绍Service启动流程，首先在发起方进程调用startService，经过binder驱动，最终进入system_server进程的binder线程来执行ActivityManagerService模块的代码。见下图：

![Activity_Manager_Service](/images/android-service/am/Activity_Manager_Service.png)

本文将进一步展开**AMP.startService是如何调用到AMS.startService, 在这个过程中Binder是如何发挥其进程间通信的功能.**

### 继承关系

先来看看AMP(ActivityManagerProxy)和AMS(ActivityManagerService)两者之间的关系。

![activity_manager_classes](/images/android-service/am/activity_manager_classes.png)

从上图可知：

- AMP也实现IActivityManager接口；
- AMN实现了IActivityManager接口，继承于Binder对象(Binder服务端)；
- AMS继承于AMN(抽象类);

## 二. 分析

### 2.1 AMP.startService

    public ComponentName startService(IApplicationThread caller, Intent service,
                String resolvedType, String callingPackage, int userId) throws RemoteException
    {
        //获取或创建Parcel对象【见小节2.2】
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(caller != null ? caller.asBinder() : null);
        service.writeToParcel(data, 0);
        //写入Parcel数据 【见小节2.3】
        data.writeString(resolvedType);
        data.writeString(callingPackage);
        data.writeInt(userId);

        //通过Binder传递数据【见小节2.5】
        mRemote.transact(START_SERVICE_TRANSACTION, data, reply, 0);
        //读取应答消息的异常情况
        reply.readException();
        //根据reply数据来创建ComponentName对象
        ComponentName res = ComponentName.readFromParcel(reply);
        //【见小节2.2.3】
        data.recycle();
        reply.recycle();
        return res;
    }

主要功能:

- 获取或创建两个Parcel对象,data用于发送数据，reply用于接收应答数据.
- 将startService相关数据都封装到Parcel对象data, 其中descriptor = "android.app.IActivityManager";
- 通过Binder传递数据,并将应答消息写入reply;
- 读取reply应答消息的异常情况和组件对象;

### 2.2 Parcel.obtain

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
        //当缓存池没有现成的Parcel对象，则直接创建[见流程2.2.1]
        return new Parcel(0);
    }

`sOwnedPool`是一个大小为6，存放着parcel对象的缓存池,这样设计的目标是用于节省每次都创建Parcel对象的开销。obtain()方法的作用：

1. 先尝试从缓存池`sOwnedPool`中查询是否存在缓存Parcel对象，当存在则直接返回该对象;
2. 如果没有可用的Parcel对象，则直接创建Parcel对象。


#### 2.2.1 new Parcel
[-> Parcel.java]

    private Parcel(long nativePtr) {
        //初始化本地指针
        init(nativePtr);
    }

    private void init(long nativePtr) {
        if (nativePtr != 0) {
            mNativePtr = nativePtr;
            mOwnsNativeParcelObject = false;
        } else {
            // 首次创建,进入该分支[见流程2.2.2]
            mNativePtr = nativeCreate();
            mOwnsNativeParcelObject = true;
        }
    }

nativeCreate这是native方法,经过JNI进入native层, 调用android_os_Parcel_create()方法.

#### 2.2.2  android_os_Parcel_create
[-> android_os_Parcel.cpp]

    static jlong android_os_Parcel_create(JNIEnv* env, jclass clazz)
    {
        Parcel* parcel = new Parcel();
        return reinterpret_cast<jlong>(parcel);
    }

创建C++层的Parcel对象, 该对象指针强制转换为long型, 并保存到Java层的`mNativePtr`对象. 创建完Parcel对象利用Parcel对象写数据. 接下来以writeString为例.


#### 2.2.3 Parcel.recycle

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

将不再使用的Parcel对象放入缓存池，可回收重复利用，当缓存池已满则不再加入缓存池。这里有两个Parcel线程池,`mOwnsNativeParcelObject`变量来决定:

- `mOwnsNativeParcelObject`=true,  即调用不带参数obtain()方法获取的对象, 回收时会放入`sOwnedPool`对象池;
- `mOwnsNativeParcelObject`=false, 即调用带nativePtr参数的obtain(long)方法获取的对象, 回收时会放入`sHolderPool`对象池;

### 2.3 writeString
[-> Parcel.java]

    public final void writeString(String val) {
        //[见流程2.3.1]
        nativeWriteString(mNativePtr, val);
    }

#### 2.3.1 nativeWriteString
[-> android_os_Parcel.cpp]

    static void android_os_Parcel_writeString(JNIEnv* env, jclass clazz, jlong nativePtr, jstring val)
    {
        Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr);
        if (parcel != NULL) {
            status_t err = NO_MEMORY;
            if (val) {
                const jchar* str = env->GetStringCritical(val, 0);
                if (str) {
                    //[见流程2.3.2]
                    err = parcel->writeString16(
                        reinterpret_cast<const char16_t*>(str),
                        env->GetStringLength(val));
                    env->ReleaseStringCritical(val, str);
                }
            } else {
                err = parcel->writeString16(NULL, 0);
            }
            if (err != NO_ERROR) {
                signalExceptionForError(env, clazz, err);
            }
        }
    }

#### 2.3.2 writeString16
[-> Parcel.cpp]

    status_t Parcel::writeString16(const char16_t* str, size_t len)
    {
        if (str == NULL) return writeInt32(-1);

        status_t err = writeInt32(len);
        if (err == NO_ERROR) {
            len *= sizeof(char16_t);
            uint8_t* data = (uint8_t*)writeInplace(len+sizeof(char16_t));
            if (data) {
                //数据拷贝到data所指向的位置
                memcpy(data, str, len);
                *reinterpret_cast<char16_t*>(data+len) = 0;
                return NO_ERROR;
            }
            err = mError;
        }
        return err;
    }


**Tips:** 除了writeString(),在`Parcel.java`中大量的native方法, 都是调用`android_os_Parcel.cpp`相对应的方法, 该方法再调用`Parcel.cpp`中对应的方法.    
调用流程:    Parcel.java -->  android_os_Parcel.cpp  --> Parcel.cpp.

    /frameworks/base/core/java/android/os/Parcel.java
    /frameworks/base/core/jni/android_os_Parcel.cpp
    /frameworks/native/libs/binder/Parcel.cpp


简单说,就是

### 2.4 mRemote究竟为何物

mRemote的出生,要出先说说ActivityManagerProxy对象(简称AMP)创建说起, AMP是通过ActivityManagerNative.getDefault()来获取的.

#### 2.4.1 AMN.getDefault
[-> ActivityManagerNative.java]

    static public IActivityManager getDefault() {
        // [见流程2.4.2]
        return gDefault.get();
    }

gDefault的数据类型为`Singleton<IActivityManager>`, 这是一个单例模式, 接下来看看Singleto.get()的过程

#### 2.4.2 gDefault.get

    public abstract class Singleton<IActivityManager> {
        public final IActivityManager get() {
            synchronized (this) {
                if (mInstance == null) {
                    //首次调用create()来获取AMP对象[见流程2.4.3]
                    mInstance = create();
                }
                return mInstance;
            }
        }
    }

首次调用时需要创建,创建完之后保持到mInstance对象,之后可直接使用.

#### 2.4.3 gDefault.create

    private static final Singleton<IActivityManager> gDefault = new Singleton<IActivityManager>() {
        protected IActivityManager create() {
            //获取名为"activity"的服务
            IBinder b = ServiceManager.getService("activity");
            //创建AMP对象[见流程2.4.4]
            IActivityManager am = asInterface(b);
            return am;
        }
    };

文章[Binder系列7—framework层分析](http://gityuan.com/2015/11/21/binder-framework/#section-4)，可知ServiceManager.getService("activity")返回的是指向目标服务AMS的代理对象`BinderProxy`对象，由该代理对象可以找到目标服务AMS所在进程

#### 2.4.4 AMN.asInterface
[-> ActivityManagerNative.java]

    public abstract class ActivityManagerNative extends Binder implements IActivityManager
    {
        static public IActivityManager asInterface(IBinder obj) {
            if (obj == null) {
                return null;
            }
            //此处obj = BinderProxy,  descriptor = "android.app.IActivityManager"; [见流程2.4.5]
            IActivityManager in = (IActivityManager)obj.queryLocalInterface(descriptor);
            if (in != null) { //此处为null
                return in;
            }
            //[见流程2.4.6]
            return new ActivityManagerProxy(obj);
        }
        ...
    }

此时obj为BinderProxy对象, 记录着远程进程system_server中AMS服务的binder线程的handle.

#### 2.4.5  queryLocalInterface
[Binder.java]

    public class Binder implements IBinder {
        //对于Binder对象的调用,则返回值不为空
        public IInterface queryLocalInterface(String descriptor) {
            //mDescriptor的初始化在attachInterface()过程中赋值
            if (mDescriptor.equals(descriptor)) {
                return mOwner;
            }
            return null;
        }
    }

    //由上一小节[2.4.4]调用的流程便是此处,返回Null
    final class BinderProxy implements IBinder {
        //BinderProxy对象的调用, 则返回值为空
        public IInterface queryLocalInterface(String descriptor) {
            return null;
        }
    }

对于Binder IPC的过程中, 同一个进程的调用则会是asInterface()方法返回的便是本地的Binder对象;对于不同进程的调用则会是远程代理对象BinderProxy.


#### 2.4.6 创建AMP
[-> ActivityManagerNative.java :: AMP]

    class ActivityManagerProxy implements IActivityManager
    {
        public ActivityManagerProxy(IBinder remote)
        {
            mRemote = remote;
        }
    }

可知`mRemote`便是指向AMS服务的`BinderProxy`对象。

### 2.5 mRemote.transact
[-> Binder.java ::BinderProxy]

    final class BinderProxy implements IBinder {
        public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            //用于检测Parcel大小是否大于800k
            Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
            //【见2.6】
            return transactNative(code, data, reply, flags);
        }
    }

mRemote.transact()方法中的code=START_SERVICE_TRANSACTION, data保存了`descriptor`，`caller`, `intent`, `resolvedType`, `callingPackage`, `userId`这6项信息。

transactNative是native方法，经过jni调用android_os_BinderProxy_transact方法。

### 2.6 android_os_BinderProxy_transact
[-> android_util_Binder.cpp]

    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        ...
        //将java Parcel转为c++ Parcel
        Parcel* data = parcelForJavaObject(env, dataObj);
        Parcel* reply = parcelForJavaObject(env, replyObj);

        //gBinderProxyOffsets.mObject中保存的是new BpBinder(handle)对象
        IBinder* target = (IBinder*) env->GetLongField(obj, gBinderProxyOffsets.mObject);
        ...

        //此处便是BpBinder::transact()【见小节2.7】
        status_t err = target->transact(code, *data, reply, flags);
        ...

        //最后根据transact执行具体情况，抛出相应的Exception
        signalExceptionForError(env, obj, err, true , data->dataSize());
        return JNI_FALSE;
    }

gBinderProxyOffsets.mObject中保存的是`BpBinder`对象, 这是开机时Zygote调用`AndroidRuntime::startReg`方法来完成jni方法的注册.

其中register_android_os_Binder()过程就有一个初始并注册BinderProxy的操作,完成gBinderProxyOffsets的赋值过程. 接下来就进入该方法.

### 2.7 BpBinder.transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            // 【见小节2.8】
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

IPCThreadState::self()采用单例模式，保证每个线程只有一个实例对象。

### 2.8 IPC.transact
[-> IPCThreadState.cpp]

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....
        if (err == NO_ERROR) {
             // 传输数据 【见小节2.9】
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }

        if (err != NO_ERROR) {
            if (reply) reply->setError(err);
            return (mLastError = err);
        }

        // 默认情况下,都是采用非oneway的方式, 也就是需要等待服务端的返回结果
        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                //reply对象不为空 【见小节2.10】
                err = waitForResponse(reply);
            }else {
                Parcel fakeReply;
                err = waitForResponse(&fakeReply);
            }
        } else {
            err = waitForResponse(NULL, NULL);
        }
        return err;
    }

transact主要过程:

- 先执行writeTransactionData()已向Parcel数据类型的`mOut`写入数据，此时`mIn`还没有数据；
- 然后执行waitForResponse()方法，循环执行，直到收到应答消息. 调用talkWithDriver()跟驱动交互，收到应答消息，便会写入`mIn`, 则根据收到的不同响应吗，执行相应的操作。

此处调用waitForResponse根据是否有设置`TF_ONE_WAY`的标记:

- 当已设置oneway时, 则调用waitForResponse(NULL, NULL);
- 当未设置oneway时, 则调用waitForResponse(reply) 或 waitForResponse(&fakeReply)


### 2.9 IPC.writeTransactionData
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
            tr.data_size = data.ipcDataSize();   // mDataSize
            tr.data.ptr.buffer = data.ipcData(); // mData指针
            tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t); //mObjectsSize
            tr.data.ptr.offsets = data.ipcObjects(); //mObjects指针
        }
        ...
        mOut.writeInt32(cmd);         //cmd = BC_TRANSACTION
        mOut.write(&tr, sizeof(tr));  //写入binder_transaction_data数据
        return NO_ERROR;
    }

将数据写入mOut

### 2.10 IPC.waitForResponse

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;

        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见小节2.11】
            err = mIn.errorCheck();
            if (err < NO_ERROR) break; //当存在error则退出循环

            if (mIn.dataAvail() == 0) continue;  //mIn有数据则往下执行

            cmd = mIn.readInt32();

            switch (cmd) {
            case BR_TRANSACTION_COMPLETE: ... goto finish;
            case BR_DEAD_REPLY: ...           goto finish;
            case BR_FAILED_REPLY: ...         goto finish;
            case BR_REPLY: ...                goto finish;


            default:
                err = executeCommand(cmd);  //【见小节2.10.1】
                if (err != NO_ERROR) goto finish;
                break;
            }
        }

    finish:
        if (err != NO_ERROR) {
            if (reply) reply->setError(err); //将发送的错误代码返回给最初的调用者
        }
        return err;
    }

在这个过程中, 常见的几个BR_命令:

- BR_TRANSACTION_COMPLETE: binder驱动收到BC_TRANSACTION事件后的应答消息; 对于oneway transaction,当收到该消息,则完成了本次Binder通信;
- BR_DEAD_REPLY: 回复失败，往往是线程或节点为空. 则结束本次通信Binder;
- BR_FAILED_REPLY:回复失败，往往是transaction出错导致. 则结束本次通信Binder;
- BR_REPLY: Binder驱动向Client端发送回应消息; 对于非oneway transaction时,当收到该消息,则完整地完成本次Binder通信;

**规律:** BC_TRANSACTION +  BC_REPLY =  BR_TRANSACTION_COMPLETE +  BR_DEAD_REPLY +  BR_FAILED_REPLY

#### 2.10.1  IPC.executeCommand

    status_t IPCThreadState::executeCommand(int32_t cmd)
    {
        BBinder* obj;
        RefBase::weakref_type* refs;
        status_t result = NO_ERROR;

        switch ((uint32_t)cmd) {
        case BR_ERROR: ...
        case BR_OK: ...
        case BR_ACQUIRE: ...
        case BR_RELEASE: ...
        case BR_INCREFS: ...
        case BR_TRANSACTION: ... //Binder驱动向Server端发送消息
        case BR_DEAD_BINDER: ...
        case BR_CLEAR_DEATH_NOTIFICATION_DONE: ...
        case BR_NOOP: ...
        case BR_SPAWN_LOOPER: ... //创建新binder线程
        default: ...
        }
    }

处于剩余的BR_命令.

### 2.11  IPC.talkWithDriver


    //mOut有数据，mIn还没有数据。doReceive默认值为true
    status_t IPCThreadState::talkWithDriver(bool doReceive)
    {
        binder_write_read bwr;

        const bool needRead = mIn.dataPosition() >= mIn.dataSize();
        const size_t outAvail = (!doReceive || needRead) ? mOut.dataSize() : 0;

        bwr.write_size = outAvail;
        bwr.write_buffer = (uintptr_t)mOut.data();

        if (doReceive && needRead) {
            //接收数据缓冲区信息的填充。当收到驱动的数据，则写入mIn
            bwr.read_size = mIn.dataCapacity();
            bwr.read_buffer = (uintptr_t)mIn.data();
        } else {
            bwr.read_size = 0;
            bwr.read_buffer = 0;
        }

        // 当同时没有输入和输出数据则直接返回
        if ((bwr.write_size == 0) && (bwr.read_size == 0)) return NO_ERROR;

        bwr.write_consumed = 0;
        bwr.read_consumed = 0;
        status_t err;
        do {
            //ioctl不停的读写操作，经过syscall，进入Binder驱动。调用Binder_ioctl【小节3.1】
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


[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。 ioctl()方法经过syscall最终调用到Binder_ioctl()方法.

## 三、Binder driver

### 3.1 binder_ioctl
[-> Binder.c]

由【小节2.11】传递过出来的参数 cmd=`BINDER_WRITE_READ`

    static long binder_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
    {
        int ret;
        struct binder_proc *proc = filp->private_data;
        struct binder_thread *thread;

        //当binder_stop_on_user_error>=2时，则该线程加入等待队列并进入休眠状态. 该值默认为0
        ret = wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);
        ...
        binder_lock(__func__);
        //查找或创建binder_thread结构体
        thread = binder_get_thread(proc);
        ...
        switch (cmd) {
            case BINDER_WRITE_READ:
                //【见小节3.2】
                ret = binder_ioctl_write_read(filp, cmd, arg, thread);
                break;
            ...
        }
        ret = 0;

    err:
        if (thread)
            thread->looper &= ~BINDER_LOOPER_STATE_NEED_RETURN;
        binder_unlock(__func__);
        wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);
        return ret;
    }

首先,根据传递过来的文件句柄指针获取相应的binder_proc结构体, 再从中查找binder_thread,如果当前线程已经加入到proc的线程队列则直接返回，
如果不存在则创建binder_thread，并将当前线程添加到当前的proc.


- 当返回值为-ENOMEM，则意味着内存不足，往往会出现创建binder_thread对象失败;
- 当返回值为-EINVAL，则意味着CMD命令参数无效；

### 3.2  binder_ioctl_write_read

    static int binder_ioctl_write_read(struct file *filp,
                    unsigned int cmd, unsigned long arg,
                    struct binder_thread *thread)
    {
        int ret = 0;
        struct binder_proc *proc = filp->private_data;
        unsigned int size = _IOC_SIZE(cmd);
        void __user *ubuf = (void __user *)arg;
        struct binder_write_read bwr;
        if (size != sizeof(struct binder_write_read)) {
            ret = -EINVAL;
            goto out;
        }
        //将用户空间bwr结构体拷贝到内核空间
        if (copy_from_user(&bwr, ubuf, sizeof(bwr))) {
            ret = -EFAULT;
            goto out;
        }

        if (bwr.write_size > 0) {
            //将数据放入目标进程【见小节3.3】
            ret = binder_thread_write(proc, thread,
                          bwr.write_buffer,
                          bwr.write_size,
                          &bwr.write_consumed);
            //当执行失败，则直接将内核bwr结构体写回用户空间，并跳出该方法
            if (ret < 0) {
                bwr.read_consumed = 0;
                if (copy_to_user_preempt_disabled(ubuf, &bwr, sizeof(bwr)))
                    ret = -EFAULT;
                goto out;
            }
        }
        if (bwr.read_size > 0) {
            //读取自己队列的数据 【见小节3.5】
            ret = binder_thread_read(proc, thread, bwr.read_buffer,
                 bwr.read_size,
                 &bwr.read_consumed,
                 filp->f_flags & O_NONBLOCK);
            //当进程的todo队列有数据,则唤醒在该队列等待的进程
            if (!list_empty(&proc->todo))
                wake_up_interruptible(&proc->wait);
            //当执行失败，则直接将内核bwr结构体写回用户空间，并跳出该方法
            if (ret < 0) {
                if (copy_to_user_preempt_disabled(ubuf, &bwr, sizeof(bwr)))
                    ret = -EFAULT;
                goto out;
            }
        }

        if (copy_to_user(ubuf, &bwr, sizeof(bwr))) {
            ret = -EFAULT;
            goto out;
        }
    out:
        return ret;
    }   

此时arg是一个`binder_write_read`结构体，`mOut`数据保存在write_buffer，所以write_size>0，但此时read_size=0。首先,将用户空间bwr结构体拷贝到内核空间,然后执行binder_thread_write()操作.

### 3.3 binder_thread_write

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
            case BC_TRANSACTION:{
                struct binder_transaction_data tr;
                //拷贝用户空间的binder_transaction_data
                if (copy_from_user(&tr, ptr, sizeof(tr)))   return -EFAULT;
                ptr += sizeof(tr);
                //【见小节3.4】
                binder_transaction(proc, thread, &tr, cmd == BC_REPLY);
                break;
            }
            ...
        }
        *consumed = ptr - buffer;
      }
      return 0;
    }

不断从binder_buffer所指向的地址，获取并处理相应的binder_transaction_data。

### 3.4 binder_transaction

发送的是BC_TRANSACTION时，此时reply=0。

    static void binder_transaction(struct binder_proc *proc,
                   struct binder_thread *thread,
                   struct binder_transaction_data *tr, int reply){
         struct binder_transaction *t;
         struct binder_work *tcomplete;
         binder_size_t *offp, *off_end;
         binder_size_t off_min;
         struct binder_proc *target_proc;
         struct binder_thread *target_thread = NULL;
         struct binder_node *target_node = NULL;
         struct list_head *target_list;
         wait_queue_head_t *target_wait;
         struct binder_transaction *in_reply_to = NULL;

        if (reply) {
            ...
        }else {
            if (tr->target.handle) {
                struct binder_ref *ref;
                // 由handle 找到相应 binder_ref, 由binder_ref 找到相应 binder_node
                ref = binder_get_ref(proc, tr->target.handle);
                target_node = ref->node;
            } else {
                target_node = binder_context_mgr_node;
            }
            // 由binder_node 找到相应 binder_proc
            target_proc = target_node->proc;
        }


        if (target_thread) {
            e->to_thread = target_thread->pid;
            target_list = &target_thread->todo;
            target_wait = &target_thread->wait;
        } else {
            //首次执行target_thread为空
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
        t->to_proc = target_proc; //此次通信目标进程为system_server
        t->to_thread = target_thread;
        t->code = tr->code;  //此次通信code = START_SERVICE_TRANSACTION
        t->flags = tr->flags;  // 此次通信flags = 0
        t->priority = task_nice(current);

        //从目标进程中分配内存空间
        t->buffer = binder_alloc_buf(target_proc, tr->data_size,
            tr->offsets_size, !reply && (t->flags & TF_ONE_WAY));

        t->buffer->allow_user_free = 0;
        t->buffer->transaction = t;
        t->buffer->target_node = target_node;

        if (target_node)
            binder_inc_node(target_node, 1, 0, NULL); //引用计数加1
        offp = (binder_size_t *)(t->buffer->data + ALIGN(tr->data_size, sizeof(void *)));

        //分别拷贝用户空间的binder_transaction_data中ptr.buffer和ptr.offsets到内核
        copy_from_user(t->buffer->data, (const void __user *)(uintptr_t)tr->data.ptr.buffer, tr->data_size);
        copy_from_user(offp, (const void __user *)(uintptr_t)tr->data.ptr.offsets, tr->offsets_size);

        off_end = (void *)offp + tr->offsets_size;

        for (; offp < off_end; offp++) {
            struct flat_binder_object *fp;
            fp = (struct flat_binder_object *)(t->buffer->data + *offp);
            off_min = *offp + sizeof(struct flat_binder_object);
            switch (fp->type) {
            ...
            case BINDER_TYPE_HANDLE:
            case BINDER_TYPE_WEAK_HANDLE: {
                //处理引用计数情况
                struct binder_ref *ref = binder_get_ref(proc, fp->handle);
                if (ref->node->proc == target_proc) {
                    if (fp->type == BINDER_TYPE_HANDLE)
                        fp->type = BINDER_TYPE_BINDER;
                    else
                        fp->type = BINDER_TYPE_WEAK_BINDER;
                    fp->binder = ref->node->ptr;
                    fp->cookie = ref->node->cookie;
                    binder_inc_node(ref->node, fp->type == BINDER_TYPE_BINDER, 0, NULL);
                } else {    
                    struct binder_ref *new_ref;
                    new_ref = binder_get_ref_for_node(target_proc, ref->node);
                    fp->handle = new_ref->desc;
                    binder_inc_ref(new_ref, fp->type == BINDER_TYPE_HANDLE, NULL);
                }
            } break;
            ...

            default:
                return_error = BR_FAILED_REPLY;
                goto err_bad_object_type;
            }
        }

        if (reply) {
            binder_pop_transaction(target_thread, in_reply_to);
        } else if (!(t->flags & TF_ONE_WAY)) {
            //非reply 且 非oneway,则设置事务栈信息
            t->need_reply = 1;
            t->from_parent = thread->transaction_stack;
            thread->transaction_stack = t;
        } else {
            //非reply 且 oneway,则加入异步todo队列
            if (target_node->has_async_transaction) {
                target_list = &target_node->async_todo;
                target_wait = NULL;
            } else
                target_node->has_async_transaction = 1;
        }

        //将新事务添加到目标队列
        t->work.type = BINDER_WORK_TRANSACTION;
        list_add_tail(&t->work.entry, target_list);

        //将BINDER_WORK_TRANSACTION_COMPLETE添加到当前线程的todo队列
        tcomplete->type = BINDER_WORK_TRANSACTION_COMPLETE;
        list_add_tail(&tcomplete->entry, &thread->todo);
        if (target_wait)
            wake_up_interruptible(target_wait); //唤醒等待队列
        return;
    }


主要功能:

1. 查询目标进程的过程： handle -> binder_ref -> binder_node -> binder_proc
2. 将新事务添加到目标队列target_list, 首次发起事务则目标队列为`target_proc->todo`, reply事务时则为`target_thread->todo`;  oneway的非reply事务,则为target_node->async_todo.
3. 将BINDER_WORK_TRANSACTION_COMPLETE添加到当前线程的todo队列

此时当前线程的todo队列已经有事务, 接下来便会进入binder_thread_read（）来处理相关的事务.

### 3.5 binder_thread_read

    binder_thread_read（）{
        //当已使用字节数为0时，将BR_NOOP响应码放入指针ptr
        if (*consumed == 0) {
                if (put_user(BR_NOOP, (uint32_t __user *)ptr))
                    return -EFAULT;
                ptr += sizeof(uint32_t);
            }
    retry:
        //todo队列有数据,则为false
        wait_for_proc_work = thread->transaction_stack == NULL &&
                list_empty(&thread->todo);
        if (wait_for_proc_work) {
            binder_set_nice(proc->default_priority);
            if (non_block) {
                if (!binder_has_proc_work(proc, thread))
                    ret = -EAGAIN;
            } else
                //当todo队列没有数据,则线程便在此处等待数据的到来
                ret = wait_event_freezable_exclusive(proc->wait, binder_has_proc_work(proc, thread));
        } else {
            if (non_block) {
                if (!binder_has_thread_work(thread))
                    ret = -EAGAIN;
            } else
                //进入此分支,  当线程没有todo队列没有数据, 则进入当前线程wait队列等待
                ret = wait_event_freezable(thread->wait, binder_has_thread_work(thread));
        }
        if (ret)
            return ret; //对于非阻塞的调用，直接返回

        while (1) {
            当&thread->todo和&proc->todo都为空时，goto到retry标志处，否则往下执行：

            uint32_t cmd;
            struct binder_transaction_data tr;
            struct binder_work *w;
            struct binder_transaction *t = NULL;
            //先考虑从线程todo队列获取事务数据
            if (!list_empty(&thread->todo)) {
                w = list_first_entry(&thread->todo, struct binder_work, entry);
            // 线程todo队列没有数据, 则从进程todo对获取事务数据
            } else if (!list_empty(&proc->todo) && wait_for_proc_work) {
                w = list_first_entry(&proc->todo, struct binder_work, entry);
            } else {
                //没有数据,则返回retry
                if (ptr - buffer == 4 &&
                    !(thread->looper & BINDER_LOOPER_STATE_NEED_RETURN))
                    goto retry;
                break;
            }

            switch (w->type) {
                case BINDER_WORK_TRANSACTION:
                    //获取transaction数据
                    t = container_of(w, struct binder_transaction, work);
                    break;

                case BINDER_WORK_TRANSACTION_COMPLETE:
                    cmd = BR_TRANSACTION_COMPLETE;
                    put_user(cmd, (uint32_t __user *)ptr)； //将BR_TRANSACTION_COMPLETE写入*ptr.
                    list_del(&w->entry);
                    kfree(w);
                    break;

                case BINDER_WORK_NODE: ...    break;
                case BINDER_WORK_DEAD_BINDER:
                case BINDER_WORK_DEAD_BINDER_AND_CLEAR:
                case BINDER_WORK_CLEAR_DEATH_NOTIFICATION: ...   break;
            }

            if (!t)
                continue; //只有BINDER_WORK_TRANSACTION命令才能继续往下执行

            if (t->buffer->target_node) {
                //获取目标node
                struct binder_node *target_node = t->buffer->target_node;
                tr.target.ptr = target_node->ptr;
                tr.cookie =  target_node->cookie;
                t->saved_priority = task_nice(current);
                ...
                cmd = BR_TRANSACTION;  //BR_TRANSACTION
            } else {
                tr.target.ptr = NULL;
                tr.cookie = NULL;
                cmd = BR_REPLY; //应答事务
            }
            tr.code = t->code;
            tr.flags = t->flags;
            tr.sender_euid = t->sender_euid;

            if (t->from) {
                struct task_struct *sender = t->from->proc->tsk;
                tr.sender_pid = task_tgid_nr_ns(sender,
                                current->nsproxy->pid_ns);
            } else {
                tr.sender_pid = 0;
            }

            tr.data_size = t->buffer->data_size;
            tr.offsets_size = t->buffer->offsets_size;
            tr.data.ptr.buffer = (void *)t->buffer->data +
                        proc->user_buffer_offset;
            tr.data.ptr.offsets = tr.data.ptr.buffer +
                        ALIGN(t->buffer->data_size,
                            sizeof(void *));

            //将cmd和数据写回用户空间
            if (put_user(cmd, (uint32_t __user *)ptr))
                return -EFAULT;
            ptr += sizeof(uint32_t);
            if (copy_to_user(ptr, &tr, sizeof(tr)))
                return -EFAULT;
            ptr += sizeof(tr);

            list_del(&t->work.entry);
            t->buffer->allow_user_free = 1;
            if (cmd == BR_TRANSACTION && !(t->flags & TF_ONE_WAY)) {
                t->to_parent = thread->transaction_stack;
                t->to_thread = thread;
                thread->transaction_stack = t;
            } else {
                t->buffer->transaction = NULL;
                kfree(t); //通信完成,则运行释放
            }
            break;
        }
    done:
        *consumed = ptr - buffer;
        //当满足请求线程加已准备线程数等于0，已启动线程数小于最大线程数(15)，
        //且looper状态为已注册或已进入时创建新的线程。
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

## 四. 回到用户空间

### 4.1

### 其他

    AMP.startService
        BinderProxy.transact
            android_os_BinderProxy_transact.android_os_BinderProxy_transact
                BpBinder.transact
                    IPC.transact
                        IPC.writeTransactionData
                        IPC.waitForResponse
                            IPC.talkWithDriver
                                Binder_ioctl
