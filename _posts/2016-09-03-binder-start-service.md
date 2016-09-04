---
layout: post
title:  "以Binder视角来看Service启动(二)"
date:   2016-09-03 11:30:00
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

`sOwnedPool`是一个大小为6，存放着parcel对象的缓存池. obtain()方法的作用：

1. 先尝试从缓存池`sOwnedPool`中查询是否存在缓存Parcel对象，当存在则直接返回该对象；否则执行下面操作；
2. 当不存在Parcel对象，则直接创建Parcel对象。

这样设计的目标是用于节省每次都创建Parcel对象的开销。

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

`mOwnsNativeParcelObject`变量来决定是将Parcel对象存放到`sOwnedPool`，还是`sHolderPool`池。该变量值取决于Parcel初始化`init()`过程是否存在native指针。

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

recycle()操作用于向池中添加parcel对象，obtain()则是从池中取对象的操作。


### 2.2 mRemote.transact

#### 2.2.1 mRemote

`mRemote`是在AMP对象创建的时候由构造函数赋值的，而AMP的创建是由ActivityManagerNative.getDefault()来获取的，核心实现是由如下代码：

    static public IActivityManager getDefault() {
        return gDefault.get();
    }

`gDefault`为Singleton类型对象，此次采用单例模式.

    public abstract class Singleton<T> {
        public final T get() {
            synchronized (this) {
                if (mInstance == null) {
                    //首次调用create()来获取AMP对象
                    mInstance = create();
                }
                return mInstance;
            }
        }
    }

get()方法获取的便是`mInstance`，再来看看create()的过程：

    private static final Singleton<IActivityManager> gDefault = new Singleton<IActivityManager>() {
        protected IActivityManager create() {
            //获取名为"activity"的服务
            IBinder b = ServiceManager.getService("activity");
            //创建AMP对象
            IActivityManager am = asInterface(b);
            return am;
        }
    };


看过文章[Binder系列7—framework层分析](http://gityuan.com/2015/11/21/binder-framework/#section-4)，可知ServiceManager.getService("activity")返回的是指向目标服务AMS的代理对象`BinderProxy`对象，由该代理对象可以找到目标服务AMS所在进程，这个过程就不再重复了。接下来，再来看看`asInterface`的功能：

    public abstract class ActivityManagerNative extends Binder implements IActivityManager
    {
        static public IActivityManager asInterface(IBinder obj) {
            if (obj == null) {
                return null;
            }
            IActivityManager in = (IActivityManager)obj.queryLocalInterface(descriptor);
            if (in != null) { //此处为null
                return in;
            }
            // 此处调用AMP的构造函数，obj为BinderProxy对象(记录远程AMS的handle)
            return new ActivityManagerProxy(obj);
        }

        public ActivityManagerNative() {
            //调用父类binder对象的方法，保存
            attachInterface(this, descriptor);
        }

        ...
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
        if (dataObj == NULL) {
            jniThrowNullPointerException(env, NULL);
            return JNI_FALSE;
        }

        ...
        //将java Parcel转为native Parcel
        Parcel* data = parcelForJavaObject(env, dataObj);
        Parcel* reply = parcelForJavaObject(env, replyObj);

        //gBinderProxyOffsets.mObject中保存的是new BpBinder(handle)对象
        IBinder* target = (IBinder*) env->GetLongField(obj, gBinderProxyOffsets.mObject);
        if (target == NULL) {
            jniThrowException(env, "java/lang/IllegalStateException", "Binder has been finalized!");
            return JNI_FALSE;
        }

        ...
        if (kEnableBinderSample）{
            time_binder_calls = should_time_binder_calls();
            if (time_binder_calls) {
                start_millis = uptimeMillis();
            }
        }
        //此处便是BpBinder::transact()【见小节2.4】
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
        //最后根据transact执行具体情况，抛出相应的Exception
        signalExceptionForError(env, obj, err, true , data->dataSize());
        return JNI_FALSE;
    }

kEnableBinderSample这是调试开关，用于打开调试主线程执行一次transact所花时长的统计。接下来进入native层BpBinder

这里会有异常抛出：

- `NullPointerException`：当dataObj对象为空，则抛该异常；
- `IllegalStateException`：当BpBinder对象为空，则抛该异常
- `signalExceptionForError()`: 根据transact执行具体情况，抛出相应的异常。


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

transact主要过程:

- 先执行writeTransactionData()已向`mOut`写入数据，此时`mIn`还没有数据；
- 然后执行waitForResponse()方法，循环执行，直到收到应答消息：
  - talkWithDriver()跟驱动交互，收到应答消息，便会写入`mIn`；
  - 当`mIn`存在数据，则根据不同的响应吗，执行相应的操作。

`mOut`和`mIn`都是parcel对象。

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

### 2.7 IPC.waitForResponse

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;

        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见小节2.8】
            err = mIn.errorCheck();
            //当存在error则退出循环，最终将error返回给transact过程
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

这里有了真正跟binder driver大交道的地方，那就是talkWithDriver.

### 2.8  IPC.talkWithDriver

此时mOut有数据，mIn还没有数据。doReceive默认值为true

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


[binder_write_read结构体](http://gityuan.com/2015/11/01/binder-driver/#binderwriteread)用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信，是真正与Binder驱动进行数据读写交互的过程。

### 2.9 IPC.executeCommand

[add Service](http://gityuan.com/2015/11/14/binder-add-service/)

...

## 三、Binder driver

### 3.1 Binder_ioctl

由【小节2.8】传递过出来的参数cmd=BINDER_WRITE_READ

    static long binder_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
    {
    	int ret;
    	struct binder_proc *proc = filp->private_data;
    	struct binder_thread *thread;

      //当binder_stop_on_user_error>=2，则该线程加入等待队列，进入休眠状态
    	ret = wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);
      ...
    	binder_lock(__func__);
      // 从binder_proc中查找binder_thread,如果当前线程已经加入到proc的线程队列则直接返回，
      // 如果不存在则创建binder_thread，并将当前线程添加到当前的proc
    	thread = binder_get_thread(proc);
    	if (thread == NULL) {
    		ret = -ENOMEM;
    		goto err;
    	}
    	switch (cmd) {
    	case BINDER_WRITE_READ:
        //【见小节3.2】
    		ret = binder_ioctl_write_read(filp, cmd, arg, thread);
    		if (ret)
    			goto err;
    		break;
    	...
    	}
    	default:
    		ret = -EINVAL;
    		goto err;
    	}
    	ret = 0;
    err:
    	if (thread)
    		thread->looper &= ~BINDER_LOOPER_STATE_NEED_RETURN;
    	binder_unlock(__func__);
      //当binder_stop_on_user_error>=2，则该线程加入等待队列，进入休眠状态
    	wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);
    	return ret;
    }


- 当返回值为-ENOMEM，则意味着内存不足，无法创建binder_thread对象。
- 当返回值为-EINVAL，则意味着CMD命令参数无效；

### 3.2  binder_ioctl_write_read

此时arg是一个`binder_write_read`结构体，`mOut`数据保存在write_buffer，所以write_size>0，但此时read_size=0。

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
        //【见小节3.3】
    		ret = binder_thread_write(proc, thread,
    					  bwr.write_buffer,
    					  bwr.write_size,
    					  &bwr.write_consumed);
        //当执行失败，则直接将内核bwr结构体写回用户空间，并跳出该方法
    		if (ret < 0) {
    			bwr.read_consumed = 0;
    			if (copy_to_user(ubuf, &bwr, sizeof(bwr)))
    				ret = -EFAULT;
    			goto out;
    		}
    	}
    	if (bwr.read_size > 0) {
        ...
    	}

    	if (copy_to_user(ubuf, &bwr, sizeof(bwr))) {
    		ret = -EFAULT;
    		goto out;
    	}
    out:
    	return ret;
    }   

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
    		if (get_user(cmd, (uint32_t __user *)ptr))
    			return -EFAULT;
    		ptr += sizeof(uint32_t);
    		switch (cmd) {
          case BC_TRANSACTION:{
            struct binder_transaction_data tr;
            //拷贝用户空间的binder_transaction_data
            if (copy_from_user(&tr, ptr, sizeof(tr)))
              return -EFAULT;
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
            //查询目标进程的过程： handle -> binder_ref -> binder_node -> binder_proc
            if (tr->target.handle) {
                struct binder_ref *ref;
                ref = binder_get_ref(proc, tr->target.handle);
                target_node = ref->node;
            }
            target_proc = target_node->proc;
            ...
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
        t->to_proc = target_proc; //目标进程为system_server
        t->to_thread = target_thread;
        t->code = tr->code;  //code = START_SERVICE_TRANSACTION
        t->flags = tr->flags;  // flags = 0
        t->priority = task_nice(current);

        //从目标进程中分配内存空间
        t->buffer = binder_alloc_buf(target_proc, tr->data_size,
            tr->offsets_size, !reply && (t->flags & TF_ONE_WAY));

        t->buffer->allow_user_free = 0;
        t->buffer->transaction = t;
        t->buffer->target_node = target_node;

        if (target_node)
            binder_inc_node(target_node, 1, 0, NULL);
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
                    trace_binder_transaction_ref_to_ref(t, ref, new_ref);
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
            t->need_reply = 1;
            t->from_parent = thread->transaction_stack;
            thread->transaction_stack = t;
        } else {
            if (target_node->has_async_transaction) {
                target_list = &target_node->async_todo;
                target_wait = NULL;
            } else
                target_node->has_async_transaction = 1;
        }
        t->work.type = BINDER_WORK_TRANSACTION;
        list_add_tail(&t->work.entry, target_list);
        tcomplete->type = BINDER_WORK_TRANSACTION_COMPLETE;
        list_add_tail(&tcomplete->entry, &thread->todo);
        if (target_wait)
            wake_up_interruptible(target_wait);
        return;
    }


未完待续。。。
