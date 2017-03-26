---
layout: post
title:  "Binder系列7—framework层分析"
date:   2015-11-21 21:11:50
catalog:  true
tags:
    - android
    - binder

---

> 主要分析Binder在java framework层的框架，相关源码：

    framework/base/core/java/android/os/
      - IInterface.java
      - IServiceManager.java
      - ServiceManager.java
      - ServiceManagerNative.java(包含内部类ServiceManagerProxy)

    framework/base/core/java/android/os/
      - IBinder.java
      - Binder.java(包含内部类BinderProxy)
      - Parcel.java
    
    framework/base/core/java/com/android/internal/os/
      - BinderInternal.java

    framework/base/core/jni/
      - AndroidRuntime.cpp
      - android_os_Parcel.cpp
      - android_util_Binder.cpp

## 一、概述

### 1.1 Binder架构

binder在framework层，采用JNI技术来调用native(C/C++)层的binder架构，从而为上层应用程序提供服务。 看过binder系列之前的文章，我们知道native层中，binder是C/S架构，分为Bn端(Server)和Bp端(Client)。对于java层在命名与架构上非常相近，同样实现了一套IPC通信架构。


framework Binder架构图：查看[大图](http://gityuan.com/images/binder/java_binder/java_binder.jpg)

![java_binder](/images/binder/java_binder/java_binder.jpg)

**图解：**

- 图中红色代表整个framework层 binder架构相关组件；
    - Binder类代表Server端，BinderProxy类代码Client端；
- 图中蓝色代表Native层Binder架构相关组件；
- 上层framework层的Binder逻辑是建立在Native层架构基础之上的，核心逻辑都是交予Native层方法来处理。
- framework层的ServiceManager类与Native层的功能并不完全对应，framework层的ServiceManager类的实现最终是通过BinderProxy传递给Native层来完成的，后面会详细说明。

### 1.2 Binder类图

下面列举framework的binder类关系图：查看[大图](http://gityuan.com/images/binder/java_binder/class_ServiceManager.jpg)

![class_java_binder](/images/binder/java_binder/class_ServiceManager.jpg)

图解：(图中浅蓝色都是Interface，其余都是Class)

1. **ServiceManager：**通过getIServiceManager方法获取的是ServiceManagerProxy对象； ServiceManager的addService, getService实际工作都交由ServiceManagerProxy的相应方法来处理；
2. **ServiceManagerProxy：**其成员变量mRemote指向BinderProxy对象，ServiceManagerProxy的addService, getService方法最终是交由mRemote来完成。
3. **ServiceManagerNative**：其方法asInterface()返回的是ServiceManagerProxy对象，ServiceManager便是借助ServiceManagerNative类来找到ServiceManagerProxy；
4. **Binder：**其成员变量mObject和方法execTransact()用于native方法
5. **BinderInternal：**内部有一个GcWatcher类，用于处理和调试与Binder相关的垃圾回收。
6. **IBinder：**接口中常量FLAG_ONEWAY：客户端利用binder跟服务端通信是阻塞式的，但如果设置了FLAG_ONEWAY，这成为非阻塞的调用方式，客户端能立即返回，服务端采用回调方式来通知客户端完成情况。另外IBinder接口有一个内部接口DeathDecipient(死亡通告)。


### 1.3 Binder类分层

整个Binder从kernel至，native，JNI，Framework层所涉及的全部类

点击查看[大图](http://gityuan.com/images/binder/java_binder_framework.jpg)

![java_binder_framework](/images/binder/java_binder_framework.jpg)


## 二、初始化

在Android系统开机过程中，Zygote启动时会有一个[虚拟机注册过程](http://gityuan.com/2016/02/13/android-zygote/#jnistartreg)，该过程调用AndroidRuntime::`startReg`方法来完成jni方法的注册。

### 2.1 startReg

==> AndroidRuntime.cpp

    int AndroidRuntime::startReg(JNIEnv* env)
    {
        androidSetCreateThreadFunc((android_create_thread_fn) javaCreateThreadEtc);

        env->PushLocalFrame(200);

        //注册jni方法【见2.2】
        if (register_jni_procs(gRegJNI, NELEM(gRegJNI), env) < 0) {
            env->PopLocalFrame(NULL);
            return -1;
        }
        env->PopLocalFrame(NULL);

        return 0;
    }

注册JNI方法，其中`gRegJNI`是一个数组，记录所有需要注册的jni方法，其中有一项便是REG_JNI(register_android_os_Binder)，下面说说`register_android_os_Binder`过程。

### 2.2 register_android_os_Binder

==> android_util_Binder.cpp

    int register_android_os_Binder(JNIEnv* env)
    {
        // 注册Binder类的jni方法【见2.3】
        if (int_register_android_os_Binder(env) < 0)
            return -1;

        // 注册BinderInternal类的jni方法【见2.4】
        if (int_register_android_os_BinderInternal(env) < 0)
            return -1;

        // 注册BinderProxy类的jni方法【见2.5】
        if (int_register_android_os_BinderProxy(env) < 0)
            return -1;
        ...
        return 0;
    }

### 2.3 注册Binder

==> android_util_Binder.cpp

    static int int_register_android_os_Binder(JNIEnv* env)
    {
        //其中kBinderPathName = "android/os/Binder";查找kBinderPathName路径所属类
        jclass clazz = FindClassOrDie(env, kBinderPathName);

        //将Java层Binder类保存到mClass变量；
        gBinderOffsets.mClass = MakeGlobalRefOrDie(env, clazz);
        //将Java层execTransact()方法保存到mExecTransact变量；
        gBinderOffsets.mExecTransact = GetMethodIDOrDie(env, clazz, "execTransact", "(IJJI)Z");
        //将Java层mObject属性保存到mObject变量
        gBinderOffsets.mObject = GetFieldIDOrDie(env, clazz, "mObject", "J");

        //注册JNI方法
        return RegisterMethodsOrDie(env, kBinderPathName, gBinderMethods,
            NELEM(gBinderMethods));
    }


注册    Binder类的jni方法，其中：

- FindClassOrDie(env, kBinderPathName) 基本等价于 env->FindClass(kBinderPathName)
- MakeGlobalRefOrDie() 等价于 env->NewGlobalRef()
- GetMethodIDOrDie() 等价于 env->GetMethodID()
- GetFieldIDOrDie() 等价于 env->GeFieldID()
- RegisterMethodsOrDie() 等价于 Android::registerNativeMethods();

**(1)`gBinderOffsets`**

`gBinderOffsets`是全局静态结构体(struct)，定义如下：

    static struct bindernative_offsets_t
    {
        jclass mClass; //记录Binder类
        jmethodID mExecTransact; //记录execTransact()方法
        jfieldID mObject; //记录mObject属性

    } gBinderOffsets;

`gBinderOffsets`保存了`Binder.java`类本身以及其成员方法`execTransact()`和成员属性`mObject`，这为JNI层访问Java层提供通道。另外通过查询获取Java层 binder信息后保存到`gBinderOffsets`，而不再需要每次查找binder类信息的方式能大幅度提高效率，是由于每次查询需要花费较多的CPU时间，尤其是频繁访问时，但用额外的结构体来保存这些信息，是以空间换时间的方法。

**(2)gBinderMethods**

    static const JNINativeMethod gBinderMethods[] = {
         /* 名称, 签名, 函数指针 */
        { "getCallingPid", "()I", (void*)android_os_Binder_getCallingPid },
        { "getCallingUid", "()I", (void*)android_os_Binder_getCallingUid },
        { "clearCallingIdentity", "()J", (void*)android_os_Binder_clearCallingIdentity },
        { "restoreCallingIdentity", "(J)V", (void*)android_os_Binder_restoreCallingIdentity },
        { "setThreadStrictModePolicy", "(I)V", (void*)android_os_Binder_setThreadStrictModePolicy },
        { "getThreadStrictModePolicy", "()I", (void*)android_os_Binder_getThreadStrictModePolicy },
        { "flushPendingCommands", "()V", (void*)android_os_Binder_flushPendingCommands },
        { "init", "()V", (void*)android_os_Binder_init },
        { "destroy", "()V", (void*)android_os_Binder_destroy },
        { "blockUntilThreadAvailable", "()V", (void*)android_os_Binder_blockUntilThreadAvailable }
    };

通过RegisterMethodsOrDie()，将为gBinderMethods数组中的方法建立了一一映射关系，从而为Java层访问JNI层提供通道。

总之，`int_register_android_os_Binder`方法的主要功能：

- 通过gBinderOffsets，保存Java层Binder类的信息，为JNI层访问Java层提供通道；
- 通过RegisterMethodsOrDie，将gBinderMethods数组完成映射关系，从而为Java层访问JNI层提供通道。

也就是说该过程建立了Binder类在Native层与framework层之间的相互调用的桥梁。


### 2.4 注册BinderInternal

==> android_util_Binder.cpp

    static int int_register_android_os_BinderInternal(JNIEnv* env)
    {
        //其中kBinderInternalPathName = "com/android/internal/os/BinderInternal"
        jclass clazz = FindClassOrDie(env, kBinderInternalPathName);

        gBinderInternalOffsets.mClass = MakeGlobalRefOrDie(env, clazz);
        gBinderInternalOffsets.mForceGc = GetStaticMethodIDOrDie(env, clazz, "forceBinderGc", "()V");

        return RegisterMethodsOrDie(
            env, kBinderInternalPathName,
            gBinderInternalMethods, NELEM(gBinderInternalMethods));
    }


注册BinderInternal类的jni方法，`gBinderInternalOffsets`保存了BinderInternal的`forceBinderGc()`方法。

下面是BinderInternal类的JNI方法注册：

    static const JNINativeMethod gBinderInternalMethods[] = {
        { "getContextObject", "()Landroid/os/IBinder;", (void*)android_os_BinderInternal_getContextObject },
        { "joinThreadPool", "()V", (void*)android_os_BinderInternal_joinThreadPool },
        { "disableBackgroundScheduling", "(Z)V", (void*)android_os_BinderInternal_disableBackgroundScheduling },
        { "handleGc", "()V", (void*)android_os_BinderInternal_handleGc }
    };

该过程其【2.3】非常类似，也就是说该过程建立了是BinderInternal类在Native层与framework层之间的相互调用的桥梁。

### 2.5 注册BinderProxy

==> android_util_Binder.cpp

    static int int_register_android_os_BinderProxy(JNIEnv* env)
    {
        //gErrorOffsets保存了Error类信息
        jclass clazz = FindClassOrDie(env, "java/lang/Error");
        gErrorOffsets.mClass = MakeGlobalRefOrDie(env, clazz);

        //gBinderProxyOffsets保存了BinderProxy类的信息
        //其中kBinderProxyPathName = "android/os/BinderProxy"
        clazz = FindClassOrDie(env, kBinderProxyPathName);
        gBinderProxyOffsets.mClass = MakeGlobalRefOrDie(env, clazz);
        gBinderProxyOffsets.mConstructor = GetMethodIDOrDie(env, clazz, "<init>", "()V");
        gBinderProxyOffsets.mSendDeathNotice = GetStaticMethodIDOrDie(env, clazz, "sendDeathNotice", "(Landroid/os/IBinder$DeathRecipient;)V");
        gBinderProxyOffsets.mObject = GetFieldIDOrDie(env, clazz, "mObject", "J");
        gBinderProxyOffsets.mSelf = GetFieldIDOrDie(env, clazz, "mSelf", "Ljava/lang/ref/WeakReference;");
        gBinderProxyOffsets.mOrgue = GetFieldIDOrDie(env, clazz, "mOrgue", "J");

        //gClassOffsets保存了Class.getName()方法
        clazz = FindClassOrDie(env, "java/lang/Class");
        gClassOffsets.mGetName = GetMethodIDOrDie(env, clazz, "getName", "()Ljava/lang/String;");

        return RegisterMethodsOrDie(
            env, kBinderProxyPathName,
            gBinderProxyMethods, NELEM(gBinderProxyMethods));
    }

注册BinderProxy类的jni方法，`gBinderProxyOffsets`保存了BinderProxy的<init>构造方法，sendDeathNotice(), mObject, mSelf, mOrgue信息。

下面BinderProxy类的JNI方法注册：

    static const JNINativeMethod gBinderProxyMethods[] = {
         /* 名称, 签名, 函数指针 */
        {"pingBinder",          "()Z", (void*)android_os_BinderProxy_pingBinder},
        {"isBinderAlive",       "()Z", (void*)android_os_BinderProxy_isBinderAlive},
        {"getInterfaceDescriptor", "()Ljava/lang/String;", (void*)android_os_BinderProxy_getInterfaceDescriptor},
        {"transactNative",      "(ILandroid/os/Parcel;Landroid/os/Parcel;I)Z", (void*)android_os_BinderProxy_transact},
        {"linkToDeath",         "(Landroid/os/IBinder$DeathRecipient;I)V", (void*)android_os_BinderProxy_linkToDeath},
        {"unlinkToDeath",       "(Landroid/os/IBinder$DeathRecipient;I)Z", (void*)android_os_BinderProxy_unlinkToDeath},
        {"destroy",             "()V", (void*)android_os_BinderProxy_destroy},
    };

该过程其【2.3】非常类似，也就是说该过程建立了是BinderProxy类在Native层与framework层之间的相互调用的桥梁。

## 三、注册服务

### 3.1 SM.addService
[-> ServiceManager.java]

    public static void addService(String name, IBinder service, boolean allowIsolated) {
        try {
            //先获取SMP对象，则执行注册服务操作【见小节3.2/3.4】
            getIServiceManager().addService(name, service, allowIsolated); 
        } catch (RemoteException e) {
            Log.e(TAG, "error in addService", e);
        }
    }

先来看看getIServiceManager()过程，如下：

### 3.2 getIServiceManager
[-> ServiceManager.java]

    private static IServiceManager getIServiceManager() {
        if (sServiceManager != null) {
            return sServiceManager;
        }
        //【分别见3.2.1和3.2.3】
        sServiceManager = ServiceManagerNative.asInterface(BinderInternal.getContextObject());
        return sServiceManager;
    }

采用了单例模式获取ServiceManager  getIServiceManager()返回的是ServiceManagerProxy(简称SMP)对象

#### 3.2.1 getContextObject()
[-> android_util_binder.cpp]

    static jobject android_os_BinderInternal_getContextObject(JNIEnv* env, jobject clazz)
    {
        sp<IBinder> b = ProcessState::self()->getContextObject(NULL);
        return javaObjectForIBinder(env, b);  //【见3.2.2】
    }

BinderInternal.java中有一个native方法getContextObject()，JNI调用执行上述方法。

对于ProcessState::self()->getContextObject()，在[获取ServiceManager](http://gityuan.com/2015/11/08/binder-get-sm/)的第3节已详细解决，即`ProcessState::self()->getContextObject()`等价于 `new BpBinder(0)`;

#### 3.2.2 javaObjectForIBinder
[-> android_util_binder.cpp]

    jobject javaObjectForIBinder(JNIEnv* env, const sp<IBinder>& val)
    {
        if (val == NULL) return NULL;

        if (val->checkSubclass(&gBinderOffsets)) { //返回false
            jobject object = static_cast<JavaBBinder*>(val.get())->object();
            return object;
        }

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
            //BinderProxy.mObject成员变量记录BpBinder对象
            env->SetLongField(object, gBinderProxyOffsets.mObject, (jlong)val.get());
            val->incStrong((void*)javaObjectForIBinder);

            jobject refObject = env->NewGlobalRef(
                    env->GetObjectField(object, gBinderProxyOffsets.mSelf));
            //将BinderProxy对象信息附加到BpBinder的成员变量mObjects中
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

    
根据BpBinder(C++)生成BinderProxy(Java)对象. 主要工作是创建BinderProxy对象,并把BpBinder对象地址保存到BinderProxy.mObject成员变量.
到此，可知ServiceManagerNative.asInterface(BinderInternal.getContextObject()) 等价于

    ServiceManagerNative.asInterface(new BinderProxy())

### 3.3  SMN.asInterface
[-> ServiceManagerNative.java]

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
        return new ServiceManagerProxy(obj); //【见小节3.3.1】
    }

由此，可知ServiceManagerNative.asInterface(new BinderProxy()) 等价于`new ServiceManagerProxy(new BinderProxy())`. 为了方便，ServiceManagerProxy简称为SMP。

#### 3.3.1 ServiceManagerProxy初始化
[-> ServiceManagerNative.java  ::ServiceManagerProxy]

    class ServiceManagerProxy implements IServiceManager {
        public ServiceManagerProxy(IBinder remote) {
            mRemote = remote;
        }
    }

mRemote为BinderProxy对象，该BinderProxy对象对应于BpBinder(0)，其作为binder代理端，指向native层大管家service Manager。

`ServiceManager.getIServiceManager`最终等价于`new ServiceManagerProxy(new BinderProxy())`,意味着【3.1】中的getIServiceManager().addService()，等价于SMP.addService().

framework层的ServiceManager的调用实际的工作确实交给SMP的成员变量BinderProxy；而BinderProxy通过jni方式，最终会调用BpBinder对象；可见上层binder架构的核心功能依赖native架构的服务来完成的。

### 3.4 SMP.addService
[-> ServiceManagerNative.java  ::ServiceManagerProxy]

    public void addService(String name, IBinder service, boolean allowIsolated)
            throws RemoteException {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IServiceManager.descriptor);
        data.writeString(name);
        //【见小节3.5】
        data.writeStrongBinder(service);
        data.writeInt(allowIsolated ? 1 : 0);
        //mRemote为BinderProxy【见小节3.7】
        mRemote.transact(ADD_SERVICE_TRANSACTION, data, reply, 0);
        reply.recycle();
        data.recycle();
    }

### 3.5 writeStrongBinder(Java)
[-> Parcel.java]

    public writeStrongBinder(IBinder val){
        //此处为Native调用【见3.5.1】
        nativewriteStrongBinder(mNativePtr, val);
    }

#### 3.5.1 android_os_Parcel_writeStrongBinder
[-> android_os_Parcel.cpp]

    static void android_os_Parcel_writeStrongBinder(JNIEnv* env, jclass clazz, jlong nativePtr, jobject object)
    {
        //将java层Parcel转换为native层Parcel
        Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr);
        if (parcel != NULL) {
            //【见3.5.2】
            const status_t err = parcel->writeStrongBinder(ibinderForJavaObject(env, object));
            if (err != NO_ERROR) {
                signalExceptionForError(env, clazz, err);
            }
        }
    }

#### 3.5.2 ibinderForJavaObject
[-> android_util_Binder.cpp]

    sp<IBinder> ibinderForJavaObject(JNIEnv* env, jobject obj)
    {
        if (obj == NULL) return NULL;

        //Java层的Binder对象
        if (env->IsInstanceOf(obj, gBinderOffsets.mClass)) {
            JavaBBinderHolder* jbh = (JavaBBinderHolder*)
                env->GetLongField(obj, gBinderOffsets.mObject);
            return jbh != NULL ? jbh->get(env, obj) : NULL; //【见3.5.3】
        }
        //Java层的BinderProxy对象
        if (env->IsInstanceOf(obj, gBinderProxyOffsets.mClass)) {
            return (IBinder*)env->GetLongField(obj, gBinderProxyOffsets.mObject);
        }
        return NULL;
    }

根据Binde(Java)生成JavaBBinderHolder(C++)对象. 主要工作是创建JavaBBinderHolder对象,并把JavaBBinderHolder对象地址保存到Binder.mObject成员变量.

#### 3.5.3 JavaBBinderHolder.get()
[-> android_util_Binder.cpp]

    sp<JavaBBinder> get(JNIEnv* env, jobject obj)
    {
        AutoMutex _l(mLock);
        sp<JavaBBinder> b = mBinder.promote();
        if (b == NULL) {
            //首次进来，创建JavaBBinder对象【见3.5.4】
            b = new JavaBBinder(env, obj);
            mBinder = b;
        }
        return b;
    }

JavaBBinderHolder有一个成员变量mBinder，保存当前创建的JavaBBinder对象，这是一个wp类型的，可能会被垃圾回收器给回收，所以每次使用前，都需要先判断是否存在。

#### 3.5.4 JavaBBinder初始化
==> [-> android_util_Binder.cpp]

    JavaBBinder(JNIEnv* env, jobject object)
        : mVM(jnienv_to_javavm(env)), mObject(env->NewGlobalRef(object))
    {
        android_atomic_inc(&gNumLocalRefs);
        incRefsCreated(env);
    }

创建JavaBBinder，该对象继承于BBinder对象。

data.writeStrongBinder(service)最终等价于`parcel->writeStrongBinder(new JavaBBinder(env, obj))`;

### 3.6 writeStrongBinder(C++)
[-> parcel.cpp]

    status_t Parcel::writeStrongBinder(const sp<IBinder>& val)
    {
        return flatten_binder(ProcessState::self(), val, this);
    }

#### 3.6.1 flatten_binder
[-> parcel.cpp]

    status_t flatten_binder(const sp<ProcessState>& /*proc*/,
        const sp<IBinder>& binder, Parcel* out)
    {
        flat_binder_object obj;

        obj.flags = 0x7f | FLAT_BINDER_FLAG_ACCEPTS_FDS;
        if (binder != NULL) {
            IBinder *local = binder->localBinder();
            if (!local) {
                BpBinder *proxy = binder->remoteBinder();
                const int32_t handle = proxy ? proxy->handle() : 0;
                obj.type = BINDER_TYPE_HANDLE; //远程Binder
                obj.binder = 0; 
                obj.handle = handle;
                obj.cookie = 0;
            } else {
                obj.type = BINDER_TYPE_BINDER; //本地Binder，进入该分支
                obj.binder = reinterpret_cast<uintptr_t>(local->getWeakRefs());
                obj.cookie = reinterpret_cast<uintptr_t>(local);
            }
        } else {
            obj.type = BINDER_TYPE_BINDER;  //本地Binder
            obj.binder = 0;
            obj.cookie = 0;
        }
        //【见小节3.6.2】
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
    
#### 3.6.2 finish_flatten_binder

    inline static status_t finish_flatten_binder(
        const sp<IBinder>& , const flat_binder_object& flat, Parcel* out)
    {
        return out->writeObject(flat, false);
    }
    
再回到小节3.4的addService过程，则接下来进入transact。

### 3.7 BinderProxy.transact
[-> Binder.java ::BinderProxy]

    public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
        //用于检测Parcel大小是否大于800k
        Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
        return transactNative(code, data, reply, flags); //【见3.8】
    }

回到ServiceManagerProxy.addService，其成员变量mRemote是BinderProxy。transactNative经过jni调用，进入下面的方法

### 3.8 android_os_BinderProxy_transact
[-> android_util_Binder.cpp]

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

        //此处便是BpBinder::transact(), 经过native层，进入Binder驱动程序
        status_t err = target->transact(code, *data, reply, flags);
        ...
        return JNI_FALSE;
    }

Java层的BinderProxy.transact()最终交由Native层的BpBinder::transact()完成。Native Binder的[注册服务(addService)](http://gityuan.com/2015/11/14/binder-add-service/)中有详细说明BpBinder执行过程。另外，该方法可抛出RemoteException。

### 3.9 小结

addService的核心过程：

    public void addService(String name, IBinder service, boolean allowIsolated)
            throws RemoteException {
        ...
        Parcel data = Parcel.obtain(); //此处还需要将java层的Parcel转为Native层的Parcel
        data->writeStrongBinder(new JavaBBinder(env, obj));
        BpBinder::transact(ADD_SERVICE_TRANSACTION, *data, reply, 0); //与Binder驱动交互
        ...
    }

注册服务过程就是通过BpBinder来发送`ADD_SERVICE_TRANSACTION`命令，与实现与binder驱动进行数据交互。

## 四、获取服务

### 4.1 getService
[-> ServiceManager.java]

    public static IBinder getService(String name) {
        try {
            IBinder service = sCache.get(name); //先从缓存中查看
            if (service != null) {
                return service;
            } else {
                return getIServiceManager().getService(name); 【见4.2】
            }
        } catch (RemoteException e) {
            Log.e(TAG, "error in getService", e);
        }
        return null;
    }

关于getIServiceManager()，在前面[小节3.2](http://gityuan.com/2015/11/21/binder-framework/#getiservicemanager)已经讲述了，等价于new ServiceManagerProxy(new BinderProxy())。
其中sCache = new HashMap<String, IBinder>()以hashmap格式缓存已组成的名称。请求获取服务过程中，先从缓存中查询是否存在，如果缓存中不存在的话，再通过binder交互来查询相应的服务。


### 4.2 SMP.getService
[-> ServiceManagerNative.java ::ServiceManagerProxy]

    class ServiceManagerProxy implements IServiceManager {
        public IBinder getService(String name) throws RemoteException {
            Parcel data = Parcel.obtain();
            Parcel reply = Parcel.obtain();
            data.writeInterfaceToken(IServiceManager.descriptor);
            data.writeString(name);
            mRemote.transact(GET_SERVICE_TRANSACTION, data, reply, 0); //mRemote为BinderProxy
            IBinder binder = reply.readStrongBinder(); //【见4.3】
            reply.recycle();
            data.recycle();
            return binder;
        }
    }

从reply里面解析出获取的IBinder对象

### 4.3  BinderProxy.transact
[-> Binder.java]

    final class BinderProxy implements IBinder {
        public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
            return transactNative(code, data, reply, flags);
        }
    }

### 4.4 android_os_BinderProxy_transact
[-> android_util_Binder.cpp]

    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        ...
        //java Parcel转为native Parcel
        Parcel* data = parcelForJavaObject(env, dataObj);
        ...

        Parcel* reply = parcelForJavaObject(env, replyObj);
        ...

        //gBinderProxyOffsets.mObject中保存的是new BpBinder(0)对象
        IBinder* target = (IBinder*)
            env->GetLongField(obj, gBinderProxyOffsets.mObject);
        ...

        //此处便是BpBinder::transact(), 经过native层[见小节4.5]
        status_t err = target->transact(code, *data, reply, flags);
        ...
        return JNI_FALSE;
    }

### 4.5  BpBinder.transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            // [见小节4.6]
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }

        return DEAD_OBJECT;
    }

### 4.6 IPC.transact
[-> IPCThreadState.cpp]

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //数据错误检查
        flags |= TF_ACCEPT_FDS;
        ....
        if (err == NO_ERROR) {
             // 传输数据
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }
        ...

        // 默认情况下,都是采用非oneway的方式, 也就是需要等待服务端的返回结果
        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                //等待回应事件
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

### 4.7 IPC.waitForResponse

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        int32_t cmd;
        int32_t err;
        while (1) {
            if ((err=talkWithDriver()) < NO_ERROR) break; // 【见小节2.11】
            ...

            cmd = mIn.readInt32();
            switch (cmd) {
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
                            err = *reinterpret_cast<const status_t*>(tr.data.ptr.buffer);
                            freeBuffer(NULL,
                                reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
                                tr.data_size,
                                reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
                                tr.offsets_size/sizeof(binder_size_t), this);
                        }
                    } else {
                        ...
                    }
                }
                goto finish;
                ...
            }
        }

    finish:
        if (err != NO_ERROR) {
            if (reply) reply->setError(err); //将发送的错误代码返回给最初的调用者
        }
        return err;
    }


### 4.3 readStrongBinder
==> Parcel.java

readStrongBinder的过程基本是writeStrongBinder逆过程。

    static jobject android_os_Parcel_readStrongBinder(JNIEnv* env, jclass clazz, jlong nativePtr)
    {
        Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr);
        if (parcel != NULL) {
            //【见小节4.4】
            return javaObjectForIBinder(env, parcel->readStrongBinder());
        }
        return NULL;
    }

javaObjectForIBinder将native层BpBinder对象转换为Java层BinderProxy对象。

### 4.4 parcel->readStrongBinder
==> Parcel.cpp

    sp<IBinder> Parcel::readStrongBinder() const
    {
        sp<IBinder> val;
        //【见小节4.5】
        unflatten_binder(ProcessState::self(), *this, &val);
        return val;
    }

### 4.5 unflatten_binder
==> Parcel.cpp

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
                    //进入该分支【见4.6】
                    *out = proc->getStrongProxyForHandle(flat->handle);
                    //创建BpBinder对象
                    return finish_unflatten_binder(
                        static_cast<BpBinder*>(out->get()), *flat, in);
            }
        }
        return BAD_TYPE;
    }

### 4.6 getStrongProxyForHandle
==> ProcessState.cpp

    sp<IBinder> ProcessState::getStrongProxyForHandle(int32_t handle)
    {
        sp<IBinder> result;

        AutoMutex _l(mLock);
        //查找handle对应的资源项
        handle_entry* e = lookupHandleLocked(handle);

        if (e != NULL) {
            IBinder* b = e->binder;
            if (b == NULL || !e->refs->attemptIncWeak(this)) {
                if (handle == 0) {
                    Parcel data;
                    //通过ping操作测试binder是否准备就绪
                    status_t status = IPCThreadState::self()->transact(
                            0, IBinder::PING_TRANSACTION, data, NULL, 0);
                    if (status == DEAD_OBJECT)
                       return NULL;
                }
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

经过该方法，最终创建了指向Binder服务端的BpBinder代理对象。回到[小节4.3] 经过javaObjectForIBinder将native层BpBinder对象转换为Java层BinderProxy对象。 也就是说通过getService()最终获取了指向目标Binder服务端的代理对象BinderProxy。


### 4.4 小结

getService的核心过程：

    public static IBinder getService(String name) {
        ...
        Parcel reply = Parcel.obtain(); //此处还需要将java层的Parcel转为Native层的Parcel
        BpBinder::transact(GET_SERVICE_TRANSACTION, *data, reply, 0);  //与Binder驱动交互
        IBinder binder = javaObjectForIBinder(env, new BpBinder(handle));
        ...
    }

javaObjectForIBinder作用是创建BinderProxy对象，并将BpBinder对象的地址保存到BinderProxy对象的mObjects中。
获取服务过程就是通过BpBinder来发送`GET_SERVICE_TRANSACTION`命令，与实现与binder驱动进行数据交互。

## 五. 实例

以IWindowManager为例

    public interface IWindowManager extends android.os.IInterface {

        public static abstract class Stub extends android.os.Binder implements android.view.IWindowManager {
            private static final java.lang.String DESCRIPTOR = "android.view.IWindowManager";

            public Stub() {
                this.attachInterface(this, DESCRIPTOR);
            }

            public static android.view.IWindowManager asInterface(android.os.IBinder obj) {
                if ((obj == null)) {
                    return null;
                }
                android.os.IInterface iin = obj.queryLocalInterface(DESCRIPTOR);
                if (((iin != null) && (iin instanceof android.view.IWindowManager))) {
                    return ((android.view.IWindowManager) iin);
                }
                return new android.view.IWindowManager.Stub.Proxy(obj);
            }

            public android.os.IBinder asBinder() {
                return this;
            }

            private static class Proxy implements android.view.IWindowManager {
                private android.os.IBinder mRemote;

                Proxy(android.os.IBinder remote) {
                    mRemote = remote;
                }

                public android.os.IBinder asBinder() {
                    return mRemote;
                }
            }
            ...
        }
    }


### 5.1 Binder
[-> Binder.java]

    public class Binder implements IBinder {
        public void attachInterface(IInterface owner, String descriptor) {
            mOwner = owner;
            mDescriptor = descriptor;
        }

        public IInterface queryLocalInterface(String descriptor) {
            if (mDescriptor.equals(descriptor)) {
                return mOwner;
            }
            return null;
        }
    }

### 5.2 BinderProxy

    final class BinderProxy implements IBinder {
        public IInterface queryLocalInterface(String descriptor) {
            return null;
        }
    }
