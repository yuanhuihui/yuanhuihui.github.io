---
layout: post
title:  "Input输入系统(工作篇)"
date:   2016-12-09 20:09:12
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析InputManagerService的启动过程

    frameworks/base/services/core/java/com/android/server/input/InputManagerService.java
    frameworks/base/services/core/java/com/android/server/wm/InputMonitor.java
    frameworks/base/services/core/jni/com_android_server_input_InputManagerService.cpp
    
    frameworks/base/core/java/android/view/InputChannel.java
    
    frameworks/native/services/inputflinger/
      - InputManager.cpp
      - InputReader.cpp
      - InputDispatcher.cpp
      - EventHub.cpp
      - InputWindow.cpp
      - InputListener.cpp
      - InputApplication.cpp
      
      
## 一. 概述

上一篇文章[]()，介绍IMS服务的启动过程会创建两个native线程，分别是`android.display`，`InputReader`,`InputDispatcher`


## 二. InputReader线程

`InputReader`是native线程，并且是可以调用Java代码的native线程。

### 2.1 threadLoop
[-> InputReader.cpp]

    bool InputReaderThread::threadLoop() {
        mReader->loopOnce(); //【见小节2.2】
        return true;
    }

threadLoop返回值为true代表的是会不断地循环调用loopOnce()。另外，如果当返回值为false则会
退出循环。

### 2.2 loopOnce
[-> InputReader.cpp]

    void InputReader::loopOnce() {
        int32_t oldGeneration;
        int32_t timeoutMillis;
        bool inputDevicesChanged = false;
        Vector<InputDeviceInfo> inputDevices;
        { // acquire lock
            AutoMutex _l(mLock);

            oldGeneration = mGeneration;
            timeoutMillis = -1;

            uint32_t changes = mConfigurationChangesToRefresh;
            if (changes) {
                mConfigurationChangesToRefresh = 0;
                timeoutMillis = 0;
                refreshConfigurationLocked(changes);
            } else if (mNextTimeout != LLONG_MAX) {
                nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
                //获取超时时间戳
                timeoutMillis = toMillisecondTimeoutDelay(now, mNextTimeout);
            }
        } // release lock

        //从EventHub读取事件，其中EVENT_BUFFER_SIZE = 256【见小节2.3】
        size_t count = mEventHub->getEvents(timeoutMillis, mEventBuffer, EVENT_BUFFER_SIZE);

        { // acquire lock
            AutoMutex _l(mLock);
            mReaderIsAliveCondition.broadcast();

            if (count) {
                //处理事件【见小节2.4】
                processEventsLocked(mEventBuffer, count);
            }

            if (mNextTimeout != LLONG_MAX) {
                nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
                if (now >= mNextTimeout) {
                    mNextTimeout = LLONG_MAX;
                    //事件处理发生超时【见小节2.5】
                    timeoutExpiredLocked(now);
                }
            }

            if (oldGeneration != mGeneration) {
                inputDevicesChanged = true;
                //当设备改变则重新获取输入设备
                getInputDevicesLocked(inputDevices);
            }
        } // release lock

        //发送输入设备改变的消息
        if (inputDevicesChanged) {
            mPolicy->notifyInputDevicesChanged(inputDevices);
        }
        //发送事件到nputDispatcher【见小节2.6】
        mQueuedListener->flush();
    }

该方法主要功能：

1. 调用getEvents()从EventHub读取事件
2. 调用processEventsLocked()来处理事件；
3. 如果处理过程发生超时，则调用timeoutExpiredLocked();
4. 调用QueuedListener->flush()，发送事件到InputDispatcher线程；

另外，整个过程还会检测配置是否改变，输出设备是否改变，如果改变则调用policy来通知。

### 2.3 getEvents
主要功能是从"/dev/input"目录下的设备节点读取事件


## 三. InputDispatcher线程 
[-> InputDispatcher.cpp]


InputDispatcherThread::threadLoop
dispatchOnce
dispatchOnceInnerLocked
dispatchKeyLocked
findFocusedWindowTargetsLocked  / 另一个case便会进程findTouchedWindowTargetsLocked()
handleTargetsNotReadyLocked


在InputDispatcher::updateDispatchStatisticsLocked() 可以做点什么呢?


InputDispatcher.injectInputEvent,

mInboundQueue

## 其他

### 命令

    getevent
    sendevent

节点：

/dev/input/event0
...
/dev/input/event8


inputReader -> inputDispacher,  add in mInboundQueue, add wake up InputDispacher。

好文: http://blog.csdn.net/laisse/article/details/47259485
