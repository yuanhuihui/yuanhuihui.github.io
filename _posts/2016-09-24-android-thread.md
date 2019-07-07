---
layout: post
title:  "理解Android线程创建流程"
date:   2016-09-24 10:30:00
catalog:  true
tags:
    - android
    - 进程系列

---

> 基于Android 6.0源码剖析，分析Android线程的创建过程

    /android/libcore/libart/src/main/java/java/lang/Thread.java
    /art/runtime/native/java_lang_Thread.cc
    /art/runtime/native/java_lang_Object.cc
    /art/runtime/thread.cc

    /system/core/libutils/Threads.cpp
    /system/core/include/utils/AndroidThreads.h
    /frameworks/base/core/jni/AndroidRuntime.cpp

## 一.概述

Android平台上的Java线程，就是Android虚拟机线程，而虚拟机线程由是通过系统调用而创建的Linux线程。纯粹的Linux线程与虚拟机线程的区别在于虚拟机线程具有运行Java代码的Runtime. 除了虚拟机线程，还有Native线程，对于Native线程有分为是否具有访问Java代码的两类线程。接下来，本文分析介绍这3类线程的创建过程。

## 二. Java线程

### 2.1 Thread.start
[-> Thread.java]

    public synchronized void start() {
         checkNotStarted(); //保证线程只有启动一次
         hasBeenStarted = true;
         //[见流程2.2]
         nativeCreate(this, stackSize, daemon);
    }

`nativeCreate`()这是一个native方法，那么其所对应的JNI方法在哪呢？在java_lang_Thread.cc中通过gMethods是一个JNINativeMethod数组，其中一项为：

    NATIVE_METHOD(Thread, nativeCreate, "(Ljava/lang/Thread;JZ)V"),

这里的NATIVE_METHOD定义在java_lang_Object.cc文件，如下：

    #define NATIVE_METHOD(className, functionName, signature) \
        { #functionName, signature, reinterpret_cast<void*>(className ## _ ## functionName) }

将宏定义展开并代入，可得所对应的方法名为`Thread_nativeCreate`,那么接下来进入该方法。

### 2.2 Thread_nativeCreate
[-> java_lang_Thread.cc]

    static void Thread_nativeCreate(JNIEnv* env, jclass, jobject java_thread,
                                      jlong stack_size, jboolean daemon) {
      //【见小节2.3】
      Thread::CreateNativeThread(env, java_thread, stack_size, daemon == JNI_TRUE);
    }

### 2.3 CreateNativeThread
[-> thread.cc]

    void Thread::CreateNativeThread(JNIEnv* env, jobject java_peer, size_t stack_size, bool is_daemon) {
      Thread* self = static_cast<JNIEnvExt*>(env)->self;
      Runtime* runtime = Runtime::Current();

      ...
      Thread* child_thread = new Thread(is_daemon);
      child_thread->tlsPtr_.jpeer = env->NewGlobalRef(java_peer);
      stack_size = FixStackSize(stack_size);

      env->SetLongField(java_peer, WellKnownClasses::java_lang_Thread_nativePeer,
                        reinterpret_cast<jlong>(child_thread));

      std::unique_ptr<JNIEnvExt> child_jni_env_ext(
          JNIEnvExt::Create(child_thread, Runtime::Current()->GetJavaVM()));

      int pthread_create_result = 0;
      if (child_jni_env_ext.get() != nullptr) {
        pthread_t new_pthread;
        pthread_attr_t attr;
        child_thread->tlsPtr_.tmp_jni_env = child_jni_env_ext.get();
        //创建线程【见小节2.4】
        pthread_create_result = pthread_create(&new_pthread,
                             &attr, Thread::CreateCallback, child_thread);

        if (pthread_create_result == 0) {
          child_jni_env_ext.release();
          return;
        }
      }

      ...
    }

### 2.4 pthread_create

pthread_create是pthread库中的函数，通过syscall再调用到clone来请求内核创建线程，该方法头文件：#include  <pthread.h>，其原型如下：

`int  pthread_create（（pthread_t  *thread,  pthread_attr_t  *attr,  void  *（*start_routine）（void  *）,  void  *arg）`

说明：

- 输入参数：
    - thread：线程标识符；
    - attr：线程属性设置；
    - start_routine：线程函数的起始地址；
    - arg：传递给start_routine的参数；
- 返回值：成功则返回0；出错则返回-1。
- 功能：创建线程，并调用线程起始地址所指向的函数start_routine。

更多关于pthread_create分析，见[Linux进程创建](http://gityuan.com/2017/08/05/linux-process-fork/)

## 三.  Native线程(C/C++)

### 3.1 Thread.run
[-> Threads.cpp]

```Java
status_t Thread::run(const char* name, int32_t priority, size_t stack)
{
    Mutex::Autolock _l(mLock);
    //保证只会启动一次
    if (mRunning) {
        return INVALID_OPERATION;
    }
    ...
    mRunning = true;

    bool res;

    if (mCanCallJava) {
        //还能调用Java代码的Native线程【见小节4.1】
        res = createThreadEtc(_threadLoop,
                this, name, priority, stack, &mThread);
    } else {
        //只能调用C/C++代码的Native线程【见小节3.2】
        res = androidCreateRawThreadEtc(_threadLoop,
                this, name, priority, stack, &mThread);
    }

    if (res == false) {
        ...//清理
        return UNKNOWN_ERROR;
    }
    return NO_ERROR;
}
```

mCanCallJava在Thread对象创建时，在构造函数中默认设置mCanCallJava=true.

- 当mCanCallJava=true,则代表是不仅能调用C/C++代码，还能调用Java代码的Native线程;
- 当mCanCallJava=false,则代表是只能调用C/C++代码的Native线程。

### 3.2 androidCreateRawThreadEtc
[-> Threads.cpp]

    int androidCreateRawThreadEtc(android_thread_func_t entryFunction,
                                   void *userData,
                                   const char* threadName __android_unused,
                                   int32_t threadPriority,
                                   size_t threadStackSize,
                                   android_thread_id_t *threadId)
    {
        pthread_attr_t attr;
        pthread_attr_init(&attr);
        pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);

        if (threadPriority != PRIORITY_DEFAULT || threadName != NULL) {
            thread_data_t* t = new thread_data_t;
            t->priority = threadPriority;
            t->threadName = threadName ? strdup(threadName) : NULL;
            t->entryFunction = entryFunction;
            t->userData = userData;
            entryFunction = (android_thread_func_t)&thread_data_t::trampoline;
            userData = t;
        }

        if (threadStackSize) {
            pthread_attr_setstacksize(&attr, threadStackSize);
        }

        errno = 0;
        pthread_t thread;
        //通过pthread_create创建线程
        int result = pthread_create(&thread, &attr,
                        (android_pthread_entry)entryFunction, userData);
        pthread_attr_destroy(&attr);
        if (result != 0) {
            ... //创建失败，则返回
            return 0;
        }

        if (threadId != NULL) {
            *threadId = (android_thread_id_t)thread;
        }
        return 1;
    }

此处entryFunction所指向的是由[小节3.1]传递进来的，其值为_threadLoop。

### 3.3 _threadLoop
[-> Threads.cpp]

    int Thread::_threadLoop(void* user)
    {
        //user是指Thread对象
        Thread* const self = static_cast<Thread*>(user);

        sp<Thread> strong(self->mHoldSelf);
        wp<Thread> weak(strong);
        self->mHoldSelf.clear();

        //该参数对于gdb调试很有作用
        self->mTid = gettid();

        bool first = true;
        do {
            bool result;
            if (first) {
                first = false;
                //首次运行时会调用readyToRun()做一些初始化准备工作
                self->mStatus = self->readyToRun();
                result = (self->mStatus == NO_ERROR);
                if (result && !self->exitPending()) {
                    result = self->threadLoop();
                }
            } else {
                result = self->threadLoop();
            }

            {
              Mutex::Autolock _l(self->mLock);
              if (result == false || self->mExitPending) {
                  self->mExitPending = true;
                  self->mRunning = false;
                  self->mThread = thread_id_t(-1);
                  self->mThreadExitedCondition.broadcast();
                  break;
              }
            }

            strong.clear(); //释放强引用
            strong = weak.promote(); //重新请求强引用，用于下一次的循环
        } while(strong != 0);

        return 0;
    }

不断循环地调用成员方法threadLoop()。当满足以下任一条件，则该线程将退出循环：

1. 当前线程状态存在错误，即mStatus != NO_ERROR；
2. 当前线程即将退出， 即mExitPending = true; 调用Thread::requestExit()可触发该过程。
3. 当前线程的强引用释放后，无法将弱引用提升成强引用的情况。

对于Native线程的实现方法，往往是通过继承Thread对象，通过覆写父类的readyToRun()和threadLoop()完成自定义线程的功能。


## 四. Native线程(Java)

### 4.1 createThreadEtc
[-> AndroidThreads.h]

    inline bool createThreadEtc(thread_func_t entryFunction,
                                void *userData,
                                const char* threadName = "android:unnamed_thread",
                                int32_t threadPriority = PRIORITY_DEFAULT,
                                size_t threadStackSize = 0,
                                thread_id_t *threadId = 0)
    {
        //【见小节4.2】
        return androidCreateThreadEtc(entryFunction, userData, threadName,
            threadPriority, threadStackSize, threadId) ? true : false;
    }

### 4.2 androidCreateThreadEtc
[-> Threads.cpp]

    int androidCreateThreadEtc(android_thread_func_t entryFunction,
                                void *userData,
                                const char* threadName,
                                int32_t threadPriority,
                                size_t threadStackSize,
                                android_thread_id_t *threadId)
    {
        //【见小节4.3】
        return gCreateThreadFn(entryFunction, userData, threadName,
            threadPriority, threadStackSize, threadId);
    }

此处`gCreateThreadFn`默认指向androidCreateRawThreadEtc函数。 文章[Android系统启动-zygote篇](http://gityuan.com/2016/02/13/android-zygote/)的小节[3.3.1]已介绍
通过androidSetCreateThreadFunc()方法，gCreateThreadFn指向javaCreateThreadEtc函数。

### 4.3 javaCreateThreadEtc
[-> AndroidRuntime.cpp]

    int AndroidRuntime::javaCreateThreadEtc(
                                   android_thread_func_t entryFunction,
                                   void* userData,
                                   const char* threadName,
                                   int32_t threadPriority,
                                   size_t threadStackSize,
                                   android_thread_id_t* threadId)
    {
       void** args = (void**) malloc(3 * sizeof(void*));
       int result;

       if (!threadName)
           threadName = "unnamed thread";

       args[0] = (void*) entryFunction;
       args[1] = userData;
       args[2] = (void*) strdup(threadName);

       //【见小节4.4】
       result = androidCreateRawThreadEtc(AndroidRuntime::javaThreadShell, args,
           threadName, threadPriority, threadStackSize, threadId);
       return result;
    }

### 4.4 androidCreateRawThreadEtc
[-> Threads.cpp]

    int androidCreateRawThreadEtc(android_thread_func_t entryFunction,
                                   void *userData,
                                   const char* threadName __android_unused,
                                   int32_t threadPriority,
                                   size_t threadStackSize,
                                   android_thread_id_t *threadId)
    {
        ...
        if (threadStackSize) {
            pthread_attr_setstacksize(&attr, threadStackSize);
        }

        ...
        //通过pthread_create创建线程
        int result = pthread_create(&thread, &attr,
                        (android_pthread_entry)entryFunction, userData);
        pthread_attr_destroy(&attr);

        ...
        return 1;
    }

此处entryFunction所指向的是由[小节4.3]传递进来的AndroidRuntime::javaThreadShell，接下来，进入该方法。

### 4.5 javaThreadShell
[-> AndroidRuntime.cpp]

    int AndroidRuntime::javaThreadShell(void* args) {
        void* start = ((void**)args)[0]; //指向_threadLoop
        void* userData = ((void **)args)[1]; //线程对象
        char* name = (char*) ((void **)args)[2]; //线程名    
        free(args);
        JNIEnv* env;
        int result;

        //hook虚拟机【见小节4.5.1】
        if (javaAttachThread(name, &env) != JNI_OK)
            return -1;

        // 调用_threadLoop()方法见小节4.5.2】
        result = (*(android_thread_func_t)start)(userData);

        //unhook虚拟机见小节4.5.3】
        javaDetachThread();
        free(name);

        return result;
    }

该方法主要功能：

1. 调用javaAttachThread()：将当前线程hook到当前进程所在的虚拟机，从而既能执行C/C++代码，也能执行Java代码。
2. 调用_threadLoop()：执行当前线程的核心逻辑代码；
3. 调用javaDetachThread()：到此说明线程_threadLoop方法执行完成，则从当前进程的虚拟机中移除该线程。

#### 4.5.1 javaAttachThread
[-> AndroidRuntime.cpp]

    static int javaAttachThread(const char* threadName, JNIEnv** pEnv)
    {
        JavaVMAttachArgs args;
        JavaVM* vm;
        jint result;

        vm = AndroidRuntime::getJavaVM();

        args.version = JNI_VERSION_1_4;
        args.name = (char*) threadName;
        args.group = NULL;
        // 将当前线程hook到当前进程所在的虚拟机
        result = vm->AttachCurrentThread(pEnv, (void*) &args);

        return result;
    }


#### 4.5.2 _threadLoop
[-> Threads.cpp]

    int Thread::_threadLoop(void* user)
    {
        ...
        do {
            if (first) {
                ...
                self->mStatus = self->readyToRun();
                result = (self->mStatus == NO_ERROR);
                if (result && !self->exitPending()) {
                    result = self->threadLoop();
                }
            } else {
                result = self->threadLoop();
            }

            Mutex::Autolock _l(self->mLock);
            //当result=false则退出该线程
            if (result == false || self->mExitPending) {
                self->mExitPending = true;
                self->mRunning = false;
                self->mThread = thread_id_t(-1);
                self->mThreadExitedCondition.broadcast();
                break;
            }
            }

            //释放强引用，让线程有机会退出
            strong.clear();
            //再次获取强引用，用于下一轮循环
            strong = weak.promote();
        } while(strong != 0);
        return 0;
    }

该过程与【小节3.3】完全一致，见上文。

#### 4.5.3 javaDetachThread
[-> AndroidRuntime.cpp]

    static int javaDetachThread(void)
    {
        JavaVM* vm;
        jint result;

        vm = AndroidRuntime::getJavaVM();
        //当前进程的虚拟机中移除该线程
        result = vm->DetachCurrentThread();
        return result;
    }

在创建Native进程的整个过程，涉及到JavaVM的AttachCurrentThread和DetachCurrentThread方法，都已深入虚拟机内部原理，本文就先讲到这里。

## 五. 总结

本文介绍了3类线程的创建过程，它们都有一个共同的特点，那就是真正的线程创建过程都是通过调用`pthread_create`方法(见小节[2.3],[3.2],[4.4])，该方法经过层层调用，最终都会进入clone系统调用，这是linux创建线程或进程的通用接口。

Native线程中是否可以执行Java代码的区别，在于通过javaThreadShell()方法从而实现在_threadLoop()执行前后增加分别将当前线程增加hook到虚拟机和从虚拟机移除的功能。调用过程：

![android_thread_create](/images/process/android-thread-create.jpg)

说明：

1. Native线程(还能执行Java)：该过程相对比较复杂，见上面的流程图：
2. Native线程(只能执行C/C++)： 只有上图中的紫色部分：thread.run ->  androidCreateRawThreadEtc ->   _threadLoop        
3. Java线程： Thread.start -> Thread_nativeCreate -> CreateNativeThread
