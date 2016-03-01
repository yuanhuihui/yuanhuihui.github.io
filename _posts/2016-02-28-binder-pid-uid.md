---
layout: post
title:  "Binder IPC通信的UID和PID"
date:   2016-02-28 20:12:45
categories: android binder
excerpt:  Binder IPC通信的UID和PID
---

* content
{:toc}


---

> 基于Android 6.0的源码剖析， 分析Binder IPC通信的clearCallingIdentity和restoreCallingIdentity的原理和用途。

	/frameworks/base/core/java/android/os/Binder.java
	/frameworks/base/core/jni/android_util_Binder.cpp
	/frameworks/native/libs/binder/IPCThreadState.cpp

## 一、概述

在[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)中通过十篇文章，深入探讨了Android M的Binder IPC机制。看过Android系统源代码，一定看到过`Binder.clearCallingIdentity()`和`Binder.restoreCallingIdentity()`这两个方法，这两个方法而且往往都是成对的出现，本文讲述其实现原理与用途。


首先，这2个方法定义在`Binder.java`文件：

	public static final native long clearCallingIdentity();
	public static final native void restoreCallingIdentity(long token);


从定义知道这是native方法，通过[Binder的JNI调用](http://www.yuanhh.com/2015/11/21/binder-framework/#registerandroidosbinder)，在`android_util_Binder.cpp`文件中定义了native方法所对应的jni方法。

## 二、原理

### 2.1 clearCallingIdentity

**[-->android_util_Binder.cpp]**

	static jlong android_os_Binder_clearCallingIdentity(JNIEnv* env, jobject clazz)
	{
	    //调用IPCThreadState类的方法执行
	    return IPCThreadState::self()->clearCallingIdentity();
	}


**[-->IPCThreadState.cpp]**

	int64_t IPCThreadState::clearCallingIdentity()
	{
	    int64_t token = ((int64_t)mCallingUid<<32) | mCallingPid;
	    clearCaller();
	    return token;
	}

	void IPCThreadState::clearCaller()
	{
	    mCallingPid = getpid(); //当前进程pid赋值给mCallingPid
	    mCallingUid = getuid(); //当前进程uid赋值给mCallingUid
	}

- mCallingUid(记为UID)，保存Binder IPC通信的调用方进程的Uid；
- mCallingPid(记为PID)，保存Binder IPC通信的调用方进程的Pid；

UID和PID是IPCThreadState的成员变量， 都是32位的int型数据，通过移位操作，将UID和PID的信息保存到`token`，其中高32位保存UID，低32位保存PID。然后调用clearCaller()方法将当前本地进程pid和uid分别赋值给PID和UID，最后返回`token`。

### 2.2 restoreCallingIdentity

**[-->android_util_Binder.cpp]**

	static void android_os_Binder_restoreCallingIdentity(JNIEnv* env, jobject clazz, jlong token)
	{
	    //token记录着uid信息，将其右移32位得到的是uid
	    int uid = (int)(token>>32);
	    if (uid > 0 && uid < 999) {
	        //目前Android中不存在小于999的uid，当uid<999则抛出异常。
	        char buf[128];
	        jniThrowException(env, "java/lang/IllegalStateException", buf);
	        return;
	    }
	    //调用IPCThreadState类的方法执行
	    IPCThreadState::self()->restoreCallingIdentity(token);
	}

**[-->IPCThreadState.cpp]**

	void IPCThreadState::restoreCallingIdentity(int64_t token)
	{
	    mCallingUid = (int)(token>>32);
	    mCallingPid = (int)token;
	}

从`token`中解析出PID和UID，并赋值给相应的变量。该方法正好是`clearCallingIdentity`的反过程。

## 三、用途

- clearCallingIdentity：远程调用方的uid和pid清除，用当前本地进程的uid和pid替代；
- restoreCallingIdentity：恢复远程电泳方的uid和pid信息。

这两个方法涉及的uid和pid，每个线程都有自己独一无二的`IPCThreadState`对象，记录当前线程的pid和uid，可通过方法`Binder.getCallingPid()`和`Binder.getCallingUid()`获取相应的数据。


clearCallingIdentity(), restoreCallingIdentity()这两个方法使用过程都是成对使用的，这两个方法配合使用，用于权限检测功能。

### 3.1 场景分析

**场景：**首先线程A通过Binder远程调用线程B，然后线程B通过Binder调用当前线程的另一个service或者activity之类的组件。

**分析：**

1. 线程A通过Binder远程调用线程B：则线程B的IPCThreadState中的`mCallingUid`和`mCallingPid`保存的就是线程A的UID和PID。这时在线程B中调用`Binder.getCallingPid()`和`Binder.getCallingUid()`方法便可获取线程A的UID和PID，然后利用UID和PID进行权限比对，判断线程A是否有权限调用线程B的某个方法。
2. 线程B通过Binder调用当前线程的某个组件：此时线程B是线程B某个组件的调用端，则`mCallingUid`和`mCallingPid`应该保存当前线程B的PID和UID，故需要调用`clearCallingIdentity()`方法完成这个功能。当线程B调用完某个组件，由于线程B仍然处于线程A的被调用端，因此`mCallingUid`和`mCallingPid`需要恢复成线程A的UID和PID，这是调用`restoreCallingIdentity`即可完成。

### 3.2 实例分析

上述过程主要在system_server进程的各个线程中比较常见（普通的app应用很少出现），比如system_server进程中的ActivityManagerService子线程，代码如下：

[-->ActivityManagerService.java]

    @Override
    public final void attachApplication(IApplicationThread thread) {
        synchronized (this) {
            //获取远程Binder调用端的pid
            int callingPid = Binder.getCallingPid();
            //清除远程Binder调用端uid和pid信息，并保存到origId变量
            final long origId = Binder.clearCallingIdentity();
            attachApplicationLocked(thread, callingPid);
            //通过origId变量，还原远程Binder调用端的uid和pid信息
            Binder.restoreCallingIdentity(origId);
        }
    }

文章[startService流程分析](http://www.yuanhh.com/2016/02/21/start-service/#activitymanagerproxyattachapplication)中有讲到`attachApplication()`的调用。该方法一般是system_server进程的子线程调用远程进程时使用，而`attachApplicationLocked`方法则是在同一个线程中，故需要在调用该方法前清空远程调用者的uid和pid，调用结束后恢复远程调用者的uid和pid。