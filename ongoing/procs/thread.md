---
layout: post
title:  "理解Android线程创建过程"
date:   2016-02-27 20:55:51
categories: android tool
excerpt:  Thread底层机制
---

* content
{:toc}


---

  /android/libcore/libart/src/main/java/java/lang/Thread.java
  /art/runtime/native/java_lang_Thread.cc
  /art/runtime/thread.cc
  /art/runtime/thread.h
    
  /android/libcore/libart/src/main/java/java/lang/ThreadGroup.java
  /android/libcore/luni/src/main/java/java/lang/Runnable.java
  
  /frameworks/native/libs/utils/Threads.cpp
  /frameworks/base/core/jni/AndroidRuntime.cpp


## 一.概述

Android线程，一般地也就是指Android虚拟机线程，而虚拟机线程由是通过系统调用而创建的Linux线程。
纯粹的Linux线程与虚拟机线程的区别在于虚拟机线程具有运行Java代码的runtime.

对于线程的创建，分为Java线程与C/C++线程的创建。先来说说Java线程的创建过程。


## 二. Java线程创建


### 2.1 Thead.start
[-> Thread.java]

    public synchronized void start() {
         checkNotStarted(); //保证线程只有启动一次
         hasBeenStarted = true;
         //[见流程2.2]
         nativeCreate(this, stackSize, daemon);
    }

### 2.2 java_lang_Thread.Thread_nativeCreate
[-> java_lang_Thread.cc]

    static void Thread_nativeCreate(JNIEnv* env, jclass, jobject java_thread, jlong stack_size,
                                    jboolean daemon) {
      Thread::CreateNativeThread(env, java_thread, stack_size, daemon == JNI_TRUE);
    }

### 2.3 thread.CreateNativeThread
[-> thread.cc]



### 四. 设置

**Step 1.**

[AndroidRuntime.cpp]

  int AndroidRuntime::startReg(JNIEnv* env)
  {
    // 设置Thread线程创建函数为javaCreateThreadEtc
    androidSetCreateThreadFunc((android_create_thread_fn) javaCreateThreadEtc);
    ...
  }

**Step 2.**

[Threads.cpp]

  void androidSetCreateThreadFunc(android_create_thread_fn func)
  {
      gCreateThreadFn = func;
  }

### 流程

[AndroidRuntime.cpp]

  createJavaThread
    javaCreateThreadEtc
      androidCreateRawThreadEtc



**Step 1.**

[AndroidRuntime.cpp]

  android_thread_id_t AndroidRuntime::createJavaThread(const char* name,
      void (*start)(void *), void* arg)
  {
      android_thread_id_t threadId = 0;
      javaCreateThreadEtc((android_thread_func_t) start, arg, name,
          ANDROID_PRIORITY_DEFAULT, 0, &threadId);
      return threadId;
  }

**Step 2.**

[AndroidRuntime.cpp]

  int AndroidRuntime::javaCreateThreadEtc(
                                  android_thread_func_t entryFunction,
                                  void* userData,
                                  const char* threadName,
                                  int32_t threadPriority,
                                  size_t threadStackSize,
                                  android_thread_id_t* threadId)
  {
      void** args = (void**) malloc(3 * sizeof(void*));   // javaThreadShell must free
      int result;
      args[0] = (void*) entryFunction;
      args[1] = userData;
      args[2] = (void*) strdup(threadName);   
      result = androidCreateRawThreadEtc(AndroidRuntime::javaThreadShell, args,
          threadName, threadPriority, threadStackSize, threadId);
      return result;
  }


#### case 1
`#if defined(HAVE_PTHREADS)`

  int androidCreateRawThreadEtc(android_thread_func_t entryFunction,
                                 void *userData,
                                 const char* threadName,
                                 int32_t threadPriority,
                                 size_t threadStackSize,
                                 android_thread_id_t *threadId)
  {
      pthread_attr_t attr; 
      pthread_attr_init(&attr);
      pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED);
  #ifdef HAVE_ANDROID_OS
      if (threadPriority != PRIORITY_DEFAULT || threadName != NULL) {
          thread_data_t* t = new thread_data_t;
          t->priority = threadPriority;
          t->threadName = threadName ? strdup(threadName) : NULL;
          t->entryFunction = entryFunction;
          t->userData = userData;
          entryFunction = (android_thread_func_t)&thread_data_t::trampoline;
          userData = t;            
      }
  #endif
      if (threadStackSize) {
          pthread_attr_setstacksize(&attr, threadStackSize);
      }
      
      errno = 0;
      pthread_t thread;
      int result = pthread_create(&thread, &attr,
                      (android_pthread_entry)entryFunction, userData);
      pthread_attr_destroy(&attr);
      if (result != 0) {
          return 0;
      }
      if (threadId != NULL) {
          *threadId = (android_thread_id_t)thread; // XXX: this is not portable
      }
      return 1;
  }

pthread_create方式创建线程

#### case 2

`#elif defined(HAVE_WIN32_THREADS)`

  int androidCreateRawThreadEtc(android_thread_func_t fn,
                                 void *userData,
                                 const char* threadName,
                                 int32_t threadPriority,
                                 size_t threadStackSize,
                                 android_thread_id_t *threadId)
  {
      return doCreateThread(  fn, userData, threadId);
  }

  static bool doCreateThread(android_thread_func_t fn, void* arg, android_thread_id_t *id)
  {
      HANDLE hThread;
      struct threadDetails* pDetails = new threadDetails; // must be on heap
      unsigned int thrdaddr;
      pDetails->func = fn;
      pDetails->arg = arg;
  #if defined(HAVE__BEGINTHREADEX)
      hThread = (HANDLE) _beginthreadex(NULL, 0, threadIntermediary, pDetails, 0,
                      &thrdaddr);
      if (hThread == 0)
  #elif defined(HAVE_CREATETHREAD)
      hThread = CreateThread(NULL, 0,
                      (LPTHREAD_START_ROUTINE) threadIntermediary,
                      (void*) pDetails, 0, (DWORD*) &thrdaddr);
      if (hThread == NULL)
  #endif
      {
          ALOG(LOG_WARN, "thread", "WARNING: thread create failed\n");
          return false;
      }
  #if defined(HAVE_CREATETHREAD)
      /* close the management handle */
      CloseHandle(hThread);
  #endif
      if (id != NULL) {
          *id = (android_thread_id_t)thrdaddr;
      }
      return true;
  }
    
