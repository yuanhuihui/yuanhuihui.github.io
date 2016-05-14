---
layout: post
title:  "Binder系列7—framework层分析"
date:   2015-11-21 21:11:50
catalog:  true
tags:
    - android
    - binder
    - framework

---

> 主要分析Binder在java framework层的框架，相关源码：


	/framework/base/core/java/android/os/IInterface.java
	/framework/base/core/java/android/os/IServiceManager.java
	/framework/base/core/java/android/os/ServiceManager.java
	/framework/base/core/java/android/os/ServiceManagerNative.java(包含内部类ServiceManagerProxy)

	/framework/base/core/java/android/os/IBinder.java
	/framework/base/core/java/android/os/Binder.java(包含内部类BinderProxy)
	/framework/base/core/java/android/os/Parcel.java
	/framework/base/core/java/com/android/internal/os/BinderInternal.java

	/framework/base/core/jni/android_os_Binder.cpp
	/framework/base/core/jni/android_os_Parcel.cpp
	/framework/base/core/jni/AndroidRuntime.cpp
	/framework/base/core/jni/android_util_Binder.cpp

## 一、概述

### 1.1 Binder架构

binder在framework层，采用JNI技术来调用native(C/C++)层的binder架构，从而为上层应用程序提供服务。 看过binder系列之前的文章，我们知道native层中，binder是C/S架构，分为Bn端(Server)和Bp端(Client)。对于java层在命名与架构上非常相近，同样实现了一套IPC通信架构。


framework Binder架构图：

点击查看[大图](http://gityuan.com/images/binder/java_binder/java_binder.jpg)

![java_binder](/images/binder/java_binder/java_binder.jpg)

**图解：**

- 图中红色代表整个framework层 binder架构相关组件；
	- Binder类代表Server端，BinderProxy类代码Client端；
- 图中蓝色代表Native层Binder架构相关组件；
- 上层framework层的Binder逻辑是建立在Native层架构基础之上的，核心逻辑都是交予Native层方法来处理。
- framework层的ServiceManager类与Native层的功能并不完全对应，framework层的ServiceManager类的实现最终是通过BinderProxy传递给Native层来完成的，后面会详细说明。

### 1.2 Binder类图  

下面列举framework的binder类关系图

点击查看[大图](http://gityuan.com/images/binder/java_binder/class_ServiceManager.jpg)

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


注册	Binder类的jni方法，其中：

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

### 3.1 addService

==> ServiceManager.java

    public static void addService(String name, IBinder service, boolean allowIsolated) {
        try {
            getIServiceManager().addService(name, service, allowIsolated); //【见3.2和3.3】
        } catch (RemoteException e) {
            Log.e(TAG, "error in addService", e);
        }
    }

首先分析getIServiceManager()过程【见3.2】，再分析addService()过程【见3.3】。

### 3.2 getIServiceManager

==> ServiceManager.java

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

==> BinderInternal.java

	public static final native IBinder getContextObject(); 

这是一个native方法，根据BinderInternal进行的jni注册方式，可知具体工作交给了下面方法：

==> android_util_binder.cpp

	static jobject android_os_BinderInternal_getContextObject(JNIEnv* env, jobject clazz)
	{
	    sp<IBinder> b = ProcessState::self()->getContextObject(NULL);
	    return javaObjectForIBinder(env, b);  //【见3.2.2】
	}

对于ProcessState::self()->getContextObject()，在[获取Service Manager](http://gityuan.com/2015/11/08/binder-get-sm/)中详细介绍过。此处直接使用其结论：`ProcessState::self()->getContextObject()`等价于 `new BpBinder(0)`; 

#### 3.2.2 javaObjectForIBinder

==> android_util_binder.cpp

将Java对象转换为native对象，更准确地说是将BpBinder(Java对象)转换成一个BinderProxy(C++对象)。

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

BinderProxy.mObject成员变量记录着BpBinder对象.

到此，可知ServiceManagerNative.asInterface(BinderInternal.getContextObject()) 等价于

	ServiceManagerNative.asInterface(new BinderProxy()) 

#### 3.2.3 asInterface

==> ServiceManagerNative.java

	 static public IServiceManager asInterface(IBinder obj)
    {
        if (obj == null) { //obj为BpBinder
            return null;
        }

        IServiceManager in = (IServiceManager)obj.queryLocalInterface(descriptor);
        if (in != null) { //in ==null
            return in;
        }
        
        return new ServiceManagerProxy(obj);
    }
 
由此，可知ServiceManagerNative.asInterface(new BinderProxy())  等价于

	new ServiceManagerProxy(new BinderProxy()) 

**getIServiceManager小结:**

`ServiceManager.getIServiceManager`最终等价于`new ServiceManagerProxy(new BinderProxy())`；
framework层的ServiceManager的调用实际的工作确实交给远程接口ServiceManagerProxy的成员变量BinderProxy；而BinderProxy通过jni方式，最终会调用BpBinder对象；可见上层binder架构的核心功能基本都是靠native架构的服务来完成的。

也就意味着【3.1】中的 getIServiceManager().addService()，等价于ServiceManagerProxy.addService()，ServiceManagerProxy简称为SMP，接下来再看SMP.addService方法。

### 3.3 SMP.addService

==> ServiceManagerNative.java

	public void addService(String name, IBinder service, boolean allowIsolated)
            throws RemoteException {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IServiceManager.descriptor);
        data.writeString(name);
        data.writeStrongBinder(service); //【见3.4】
        data.writeInt(allowIsolated ? 1 : 0);
        //mRemote为BinderProxy【见3.9】
        mRemote.transact(ADD_SERVICE_TRANSACTION, data, reply, 0);
        reply.recycle();
        data.recycle();
    }

### 3.4 writeStrongBinder

==> Parcel.java

	public writeStrongBinder(IBinder val){
	    //此处为Native调用【见3.5】
		nativewriteStrongBinder(mNativePtr, val);
	}

### 3.5 android_os_Parcel_writeStrongBinder
==> android_os_Parcel.cpp

	static void android_os_Parcel_writeStrongBinder(JNIEnv* env, jclass clazz, jlong nativePtr, jobject object)
	{
	    //将java层Parcel转换为native层Parcel
	    Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr); 
	    if (parcel != NULL) {
	        //【见3.6】
	        const status_t err = parcel->writeStrongBinder(ibinderForJavaObject(env, object)); 
	        if (err != NO_ERROR) {
	            signalExceptionForError(env, clazz, err);
	        }
	    }
	}

### 3.6 ibinderForJavaObject
==> android_os_Binder.cpp

	sp<IBinder> ibinderForJavaObject(JNIEnv* env, jobject obj)
	{
	    if (obj == NULL) return NULL;
	
	    if (env->IsInstanceOf(obj, gBinderOffsets.mClass)) {
	        JavaBBinderHolder* jbh = (JavaBBinderHolder*)
	            env->GetLongField(obj, gBinderOffsets.mObject);
	        return jbh != NULL ? jbh->get(env, obj) : NULL; //【见3.7】
	    }
	
	    if (env->IsInstanceOf(obj, gBinderProxyOffsets.mClass)) {
	        return (IBinder*)env->GetLongField(obj, gBinderProxyOffsets.mObject);
	    }
	    return NULL;
	}

### 3.7 JavaBBinderHolder.get()
==> android_os_Binder.cpp

	sp<JavaBBinder> get(JNIEnv* env, jobject obj)
    {
        AutoMutex _l(mLock);
        sp<JavaBBinder> b = mBinder.promote();
        if (b == NULL) {
            //首次进来，创建JavaBBinder对象【见3.8】
            b = new JavaBBinder(env, obj); 
            mBinder = b;
        }
        return b;
    }

JavaBBinderHolder有一个成员变量mBinder，保存当前创建的JavaBBinder对象，这是一个wp类型的，可能会被垃圾回收器给回收，所以每次使用前，都需要先判断是否存在。

### 3.8 new JavaBBinder()
==> android_os_Binder.cpp

创建JavaBBinder，该对象继承于BBinder

    JavaBBinder(JNIEnv* env, jobject object)
        : mVM(jnienv_to_javavm(env)), mObject(env->NewGlobalRef(object))
    {
        android_atomic_inc(&gNumLocalRefs);
        incRefsCreated(env);
    }


从【3.4~3.8】，可知【3.3】中的data.writeStrongBinder(service)最终等价于`parcel->writeStrongBinder(new JavaBBinder(env, obj))`;接着再看看transact过程。


### 3.9 mRemote.transact
==> Binder.java

回到ServiceManagerProxy.addService，其成员变量mRemote是BinderProxy。BinderProxy.transact如下：
	
	public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
        //用于检测Parcel大小是否大于800k
        Binder.checkParcel(this, code, data, "Unreasonably large binder buffer");
        return transactNative(code, data, reply, flags); //【见3.10】
    }

transactNative经过jni调用，进入下面的方法

### 3.10 android_os_BinderProxy_transact
==> android_os_Binder.cpp

    //该方法可抛出RemoteException
    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
	{
	    if (dataObj == NULL) {
	        jniThrowNullPointerException(env, NULL);
	        return JNI_FALSE;
	    }
	    //java Parcel转为native Parcel
	    Parcel* data = parcelForJavaObject(env, dataObj); 
	    if (data == NULL) {
	        return JNI_FALSE;
	    }
	    Parcel* reply = parcelForJavaObject(env, replyObj);
	    if (reply == NULL && replyObj != NULL) {
	        return JNI_FALSE;
	    }
	    //gBinderProxyOffsets.mObject中保存的是new BpBinder(0)对象
	    IBinder* target = (IBinder*)
	        env->GetLongField(obj, gBinderProxyOffsets.mObject); 
	    if (target == NULL) {
	        jniThrowException(env, "java/lang/IllegalStateException", "Binder has been finalized!");
	        return JNI_FALSE;
	    }
	
	    //此处便是BpBinder::transact(), 经过native层，进入Binder驱动程序
	    status_t err = target->transact(code, *data, reply, flags);
	    ...
	    return JNI_FALSE;
	}

Java层的BinderProxy.transact()最终交由Native层的BpBinder::transact()完成。Native Binder的[注册服务(addService)](http://gityuan.com/2015/11/14/binder-add-service/)中有详细说明BpBinder执行过程。

### 3.11 小结

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
==> ServiceManager.java

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


### 4.2 SMN.getService

==> ServiceManagerNative.java

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

mRemote.transact()在前面，已经说明过，通过JNI调用，最终调用的是BpBinder::transact（)方法。

### 4.3 readStrongBinder
==> Parcel.java

readStrongBinder的过程基本与前面的writeStrongBinder时逆过程。

	static jobject android_os_Parcel_readStrongBinder(JNIEnv* env, jclass clazz, jlong nativePtr)
	{
	    Parcel* parcel = reinterpret_cast<Parcel*>(nativePtr);
	    if (parcel != NULL) {
	        return javaObjectForIBinder(env, parcel->readStrongBinder());
	    }
	    return NULL;
	}

javaObjectForIBinder在第【3.3】中已经介绍过javaObjectForIBinder(env, new BpBinder(handle));  


### 4.4 小结

getServicee的核心过程：

	public static IBinder getService(String name) {
        ...
		Parcel reply = Parcel.obtain(); //此处还需要将java层的Parcel转为Native层的Parcel
		BpBinder::transact(GET_SERVICE_TRANSACTION, *data, reply, 0);  //与Binder驱动交互
		IBinder binder = javaObjectForIBinder(env, new BpBinder(handle)); 
		...
    }

javaObjectForIBinder作用是创建BinderProxy对象，并将BpBinder对象的地址保存到BinderProxy对象的mObjects中。

获取服务过程就是通过BpBinder来发送`GET_SERVICE_TRANSACTION`命令，与实现与binder驱动进行数据交互。


