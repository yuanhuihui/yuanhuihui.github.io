---
layout: post
title:  "Binder死亡通知机制之linkToDeath"
date:   2017-05-31 20:30:00
catalog:  true
tags:
    - android
    - 组件
---

> 基于Android 6.0源码, 涉及相关源码

    frameworks/base/core/java/android/os/Binder.java
    frameworks/base/core/jni/android_util_Binder.cpp
    frameworks/native/libs/binder/BpBinder.cpp

## 一. 概述

死亡通知是为了让Bp端(客户端进程)进能知晓Bn端(服务端进程)的生死情况，当Bn端进程死亡后能通知到Bp端。

- 定义：AppDeathRecipient是继承IBinder::DeathRecipient类，主要需要实现其binderDied()来进行死亡通告。
- 注册：binder->linkToDeath(AppDeathRecipient)是为了将AppDeathRecipient死亡通知注册到Binder上。

Bp端只需要覆写binderDied()方法，实现一些后尾清除类的工作，则在Bn端死掉后，会回调binderDied()进行相应处理。

### 1.1 实例说明

    public final class ActivityManagerService {
        private final boolean attachApplicationLocked(IApplicationThread thread, int pid) {
            ...
            //创建IBinder.DeathRecipient子类对象
            AppDeathRecipient adr = new AppDeathRecipient(app, pid, thread);
            //建立binder死亡回调
            thread.asBinder().linkToDeath(adr, 0);
            app.deathRecipient = adr;
            ...
            //取消binder死亡回调
            app.unlinkDeathRecipient();
        }

        private final class AppDeathRecipient implements IBinder.DeathRecipient {
            ...
            public void binderDied() {
                synchronized(ActivityManagerService.this) {
                    appDiedLocked(mApp, mPid, mAppThread, true);
                }
            }
        }
    }

前面涉及到linkToDeath和unlinkToDeath方法, 对于这个两个方法只有BinderProxy代理端才能有效使用,
如果是Binder服务端, 那么这两个方法内容为空.

[/android/os/Binder.java]

    public class Binder implements IBinder {
        public void linkToDeath(DeathRecipient recipient, int flags) {
        }

        public boolean unlinkToDeath(DeathRecipient recipient, int flags) {
            return true;
        }
    }

    final class BinderProxy implements IBinder {
        public native void linkToDeath(DeathRecipient recipient, int flags)
                throws RemoteException;
        public native boolean unlinkToDeath(DeathRecipient recipient, int flags);
    }

## 二. linkToDeath原理

### 2.1 linkToDeath
[-> android_util_Binder.cpp]

BinderProxy调用linkToDeath()方法是一个native方法, 通过jni进入该方法

    static void android_os_BinderProxy_linkToDeath(JNIEnv* env, jobject obj,
            jobject recipient, jint flags)
    {
        if (recipient == NULL) {
            jniThrowNullPointerException(env, NULL);
            return;
        }

        //获取BinderProxy.mObject成员变量值, 即BpBinder对象
        IBinder* target = (IBinder*)env->GetLongField(obj, gBinderProxyOffsets.mObject);
        ...

        //只有Binder代理对象才会进入该对象
        if (!target->localBinder()) {
            DeathRecipientList* list = (DeathRecipientList*)
                    env->GetLongField(obj, gBinderProxyOffsets.mOrgue);
            //创建JavaDeathRecipient对象[见小节2.1.1]
            sp<JavaDeathRecipient> jdr = new JavaDeathRecipient(env, recipient, list);
            //建立死亡通知[见小节2.2]
            status_t err = target->linkToDeath(jdr, NULL, flags);
            if (err != NO_ERROR) {
                //添加死亡通告失败, 则从list移除引用[见小节2.1.3]
                jdr->clearReference();
                signalExceptionForError(env, obj, err, true /*canThrowRemoteException*/);
            }
        }
    }

过程说明:

- DeathRecipientList: 利用成员变量mList, 记录该BinderProxy的JavaDeathRecipient列表信息；
    - 也就是受一个BpBinder可以注册多个死亡回调
- JavaDeathRecipient: 基础IBinder::DeathRecipient类;

见图【】

#### 2.1.1 JavaDeathRecipient
[-> android_util_Binder.cpp]

    class JavaDeathRecipient : public IBinder::DeathRecipient
    {
    public:
        JavaDeathRecipient(JNIEnv* env, jobject object, const sp<DeathRecipientList>& list)
            : mVM(jnienv_to_javavm(env)), mObject(env->NewGlobalRef(object)),
              mObjectWeak(NULL), mList(list)
        {
            //将当前对象sp添加到列表DeathRecipientList
            list->add(this);
            android_atomic_inc(&gNumDeathRefs);
            incRefsCreated(env); //[见小节2.1.2]
        }
    }

为jobject类型的对象recipient来创建global reference, 保存到mObject成员变量；

#### 2.1.2 incRefsCreated
[-> android_util_Binder.cpp]

    static void incRefsCreated(JNIEnv* env)
    {
        int old = android_atomic_inc(&gNumRefsCreated);
        if (old == 2000) {
            android_atomic_and(0, &gNumRefsCreated);
            //触发forceGc
            env->CallStaticVoidMethod(gBinderInternalOffsets.mClass,
                    gBinderInternalOffsets.mForceGc);
        }
    }

该方法的主要是增加引用计数incRefsCreated，每计数增加2000则执行一次forceGc;

会触发调用该方法的场景有：

- JavaBBinder对象创建过程
- JavaDeathRecipient对象创建过程；
- javaObjectForIBinder()方法：将native层BpBinder对象转换为Java层BinderProxy对象的过程；

#### 2.1.3  clearReference
[-> android_util_Binder.cpp]

    void clearReference()
     {
         sp<DeathRecipientList> list = mList.promote();
         if (list != NULL) {
             list->remove(this); //从列表中移除引用
         }
     }
     
### 2.2 linkToDeath
[-> BpBinder.cpp]

    status_t BpBinder::linkToDeath(
        const sp<DeathRecipient>& recipient, void* cookie, uint32_t flags)
    {
        Obituary ob;
        ob.recipient = recipient; //该对象为JavaDeathRecipient
        ob.cookie = cookie; // cookie=NULL
        ob.flags = flags; // flags=0
        {
            AutoMutex _l(mLock);
            if (!mObitsSent) { //没有执行过sendObituary，则进入该方法
                if (!mObituaries) {
                    mObituaries = new Vector<Obituary>;
                    if (!mObituaries) {
                        return NO_MEMORY;
                    }
                    getWeakRefs()->incWeak(this);
                    IPCThreadState* self = IPCThreadState::self();
                    //[见小节2.3]
                    self->requestDeathNotification(mHandle, this);
                    //[见小节2.4]
                    self->flushCommands();
                }
                ssize_t res = mObituaries->add(ob);
                return res >= (ssize_t)NO_ERROR ? (status_t)NO_ERROR : res;
            }
        }
        return DEAD_OBJECT;
    }

### 2.3 requestDeathNotification
[-> IPCThreadState.cpp]

    status_t IPCThreadState::requestDeathNotification(int32_t handle, BpBinder* proxy)
    {
        mOut.writeInt32(BC_REQUEST_DEATH_NOTIFICATION);
        mOut.writeInt32((int32_t)handle);
        mOut.writePointer((uintptr_t)proxy);
        return NO_ERROR;
    }

### 2.4  flushCommands
[-> IPCThreadState.cpp]

    void IPCThreadState::flushCommands()
    {
        if (mProcess->mDriverFD <= 0)
            return;
        talkWithDriver(false);
    }

向binder driver发送BC_REQUEST_DEATH_NOTIFICATION命令，经过ioctl执行到
binder_ioctl_write_read()方法。

### 2.5 BC_REQUEST_DEATH_NOTIFICATION

    static int binder_ioctl_write_read(struct file *filp,
                    unsigned int cmd, unsigned long arg,
                    struct binder_thread *thread)
    {
        int ret = 0;
        struct binder_proc *proc = filp->private_data;
        void __user *ubuf = (void __user *)arg;
        struct binder_write_read bwr;

        if (copy_from_user(&bwr, ubuf, sizeof(bwr))) { //把用户空间数据ubuf拷贝到bwr
            ...
        }
        if (bwr.write_size > 0) { //此时写缓存有数据【见小节3.3.2】
            ret = binder_thread_write(proc, thread,
                      bwr.write_buffer, bwr.write_size, &bwr.write_consumed);
            ...
        }

        if (bwr.read_size > 0) { //此时读缓存有数据【见小节3.3.3】
            ret = binder_thread_read(proc, thread, bwr.read_buffer,
                     bwr.read_size,
                     &bwr.read_consumed,
                     filp->f_flags & O_NONBLOCK);
            if (!list_empty(&proc->todo))  //进程todo队列不为空,则唤醒该队列中的线程
                wake_up_interruptible(&proc->wait);
            ...
        }

        if (copy_to_user(ubuf, &bwr, sizeof(bwr))) { //将内核数据bwr拷贝到用户空间ubuf
            ...
        }
    }
    
后面的处理流程,类似于文章[Binder系列3—启动ServiceManager](http://gityuan.com/2015/11/07/binder-start-sm/)
的[小节3.3]binder_link_to_death()的过程.

## 三. 死亡回调

### 3.1 release
[-> binder.c]

    static const struct file_operations binder_fops = {
    	.owner = THIS_MODULE,
    	.poll = binder_poll,
    	.unlocked_ioctl = binder_ioctl,
    	.compat_ioctl = binder_ioctl,
    	.mmap = binder_mmap,
    	.open = binder_open,
    	.flush = binder_flush,
    	.release = binder_release, //对应于release的方法
    };

### 3.2 binder_release



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




### 1.1 release

binder_deferred_release

    binder_free_thread(proc, thread)

    binder_node_release(node, incoming_refs);
    binder_delete_ref(ref);

    binder_release_work(&proc->todo);
	binder_release_work(&proc->delivered_death);

    binder_free_buf(proc, buffer);

## 四. 结论

- 死亡回调DeathRecipient只有Bp才能正确使用，因为DeathRecipient用于监控Bn端挂掉的情况，
如果Bn建立跟自己的死亡通知，自己进程都挂了，也就无法通知。
