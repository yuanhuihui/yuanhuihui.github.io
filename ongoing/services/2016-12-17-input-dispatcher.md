---
layout: post
title:  "输入系统之InputDispatcher"
date:   2016-12-17 22:19:12
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析InputManagerService的启动过程

    frameworks/native/services/inputflinger/InputDispatcher.cpp
    frameworks/base/services/core/jni/com_android_server_input_InputManagerService.cpp
    
## 一. InputDispatcher起点

上篇文章，介绍InputReader利用EventHub获取数据后生成EventEntry事件，加入到InputDispatcher的mInboundQueue队列，再唤醒InputDispatcher线程。本文将介绍
InputDispatcher，同样从threadLoop为起点开始分析。

#### 1.1 threadLoop
[-> InputDispatcher.cpp]

    bool InputDispatcherThread::threadLoop() {
        mDispatcher->dispatchOnce(); //【见小节1.3】
        return true;
    }

整个过程不断循环地调用InputDispatcher的dispatchOnce()来分发事件，先来回顾一下InputDispatcher对象构造方法。

#### 1.2 InputDispatcher实例化
[-> InputDispatcher.cpp]

    InputDispatcher::InputDispatcher(const sp<InputDispatcherPolicyInterface>& policy) :
        mPolicy(policy),
        mPendingEvent(NULL), mLastDropReason(DROP_REASON_NOT_DROPPED),
        mAppSwitchSawKeyDown(false), mAppSwitchDueTime(LONG_LONG_MAX),
        mNextUnblockedEvent(NULL),
        mDispatchEnabled(false), mDispatchFrozen(false), mInputFilterEnabled(false),
        mInputTargetWaitCause(INPUT_TARGET_WAIT_CAUSE_NONE) {
        //创建Looper对象
        mLooper = new Looper(false);

        mKeyRepeatState.lastKeyEntry = NULL;
        //获取分发超时参数
        policy->getDispatcherConfiguration(&mConfig);
    }
    
该方法主要工作：

- 创建属于自己线程的Looper对象；
- 超时参数来自于IMS，参数默认值keyRepeatTimeout = 500，keyRepeatDelay = 50。

#### 1.3 dispatchOnce
[-> InputDispatcher.cpp]

    void InputDispatcher::dispatchOnce() {
        nsecs_t nextWakeupTime = LONG_LONG_MAX;
        {
            AutoMutex _l(mLock);
            //唤醒等待线程，monitor()用于监控dispatcher是否发生死锁
            mDispatcherIsAliveCondition.broadcast();

            
            if (!haveCommandsLocked()) {
                //当mCommandQueue不为空，开始处理【见小节3.1】
                dispatchOnceInnerLocked(&nextWakeupTime);
            }

            //【见小节4.1】
            if (runCommandsLockedInterruptible()) {
                nextWakeupTime = LONG_LONG_MIN;
            }
        }

        nsecs_t currentTime = now();
        int timeoutMillis = toMillisecondTimeoutDelay(currentTime, nextWakeupTime);
        mLooper->pollOnce(timeoutMillis); //进入epoll_wait
    }

该方法主要功能：

1. 处理事件: 调用dispatchOnceInnerLocked
2. 处理命令: 调用runCommandsLockedInterruptible

退出epoll_wait有3种情况：

1. callback：通过回调方法来唤醒；
2. timeout：到达nextWakeupTime时间，超时唤醒；
3. wake: 主动调用Looper的wake()方法；


## 二. InputDispatcher

### 2.1 dispatchOnceInnerLocked

    void InputDispatcher::dispatchOnceInnerLocked(nsecs_t* nextWakeupTime) {
        nsecs_t currentTime = now();

        if (!mDispatchEnabled) { //默认值为false
            resetKeyRepeatLocked(); //重置操作
        }

        if (mDispatchFrozen) { //默认值为false
            return; //当分发被冻结，则不再处理超时和分发事件的工作，直接返回
        }

        //优化app切换延迟，当切换超时，则抢占分发，丢弃其他所有即将要处理的事件。
        bool isAppSwitchDue = mAppSwitchDueTime <= currentTime;
        ...

        //准备开始一个新事件
        if (!mPendingEvent) {
            if (mInboundQueue.isEmpty()) {
                ...
            } else {
                //从mInboundQueue取出头部的事件
                mPendingEvent = mInboundQueue.dequeueAtHead();
            }
            ...
            resetANRTimeoutsLocked(); //重置ANR信息[见小节2.1.1]
        }

        bool done = false;
        DropReason dropReason = DROP_REASON_NOT_DROPPED;
        if (!(mPendingEvent->policyFlags & POLICY_FLAG_PASS_TO_USER)) {
            dropReason = DROP_REASON_POLICY;
        } else if (!mDispatchEnabled) {
            dropReason = DROP_REASON_DISABLED;
        }
        ...

        switch (mPendingEvent->type) {
        case EventEntry::TYPE_CONFIGURATION_CHANGED: ...
        case EventEntry::TYPE_DEVICE_RESET: ...
        
        case EventEntry::TYPE_KEY: {
            KeyEntry* typedEntry = static_cast<KeyEntry*>(mPendingEvent);
            if (isAppSwitchDue) {
                if (isAppSwitchKeyEventLocked(typedEntry)) {
                    resetPendingAppSwitchLocked(true);
                    isAppSwitchDue = false;
                } else if (dropReason == DROP_REASON_NOT_DROPPED) {
                    dropReason = DROP_REASON_APP_SWITCH;
                }
            }
            if (dropReason == DROP_REASON_NOT_DROPPED
                    && isStaleEventLocked(currentTime, typedEntry)) {
                dropReason = DROP_REASON_STALE;
            }
            if (dropReason == DROP_REASON_NOT_DROPPED && mNextUnblockedEvent) {
                dropReason = DROP_REASON_BLOCKED;
            }
            // 分发按键事件[见小节2.2]
            done = dispatchKeyLocked(currentTime, typedEntry, &dropReason, nextWakeupTime);
            break;
        }

        case EventEntry::TYPE_MOTION: {
            MotionEntry* typedEntry = static_cast<MotionEntry*>(mPendingEvent);
            if (dropReason == DROP_REASON_NOT_DROPPED && isAppSwitchDue) {
                dropReason = DROP_REASON_APP_SWITCH;
            }
            if (dropReason == DROP_REASON_NOT_DROPPED
                    && isStaleEventLocked(currentTime, typedEntry)) {
                dropReason = DROP_REASON_STALE;
            }
            if (dropReason == DROP_REASON_NOT_DROPPED && mNextUnblockedEvent) {
                dropReason = DROP_REASON_BLOCKED;
            }
            //分发移动事件
            done = dispatchMotionLocked(currentTime, typedEntry,
                    &dropReason, nextWakeupTime);
            break;
        }

        default:
            break;
        }

        if (done) {
            if (dropReason != DROP_REASON_NOT_DROPPED) {
                // [见小节2.1.2]
                dropInboundEventLocked(mPendingEvent, dropReason);
            }
            mLastDropReason = dropReason;

            releasePendingEventLocked(); //释放pending事件
            *nextWakeupTime = LONG_LONG_MIN; //强制立刻执行轮询
        }
    }

在enqueueInboundEventLocked()的过程中已设置mAppSwitchDueTime等于eventTime加上500ms:

    mAppSwitchDueTime = keyEntry->eventTime + APP_SWITCH_TIMEOUT;

该方法主要功能:

1. mDispatchFrozen用于决定是否冻结事件分发工作;
2. 当事件分发的时间点距离该事件加入mInboundQueue的时间超过500ms,则认为app切换过期,即isAppSwitchDue=true;
3. mInboundQueue不为空,则取出头部的事件,放入mPendingEvent变量;并重置ANR时间;
4. 根据情况设置dropReason;
5. 根据EventEntry的type类型分别处理:
    - TYPE_KEY: 则调用dispatchKeyLocked分发事件;
    - TYPE_MOTION: 则调用dispatchMotionLocked分发事件;

接下来以按键为例来展开说明, 则进入[小节2.2] dispatchKeyLocked()

#### 2.1.1 resetANRTimeoutsLocked

    void InputDispatcher::resetANRTimeoutsLocked() {
        // 重置等待超时cause和handle
        mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_NONE;
        mInputTargetWaitApplicationHandle.clear();
    }

#### 2.1.2 dropInboundEventLocked

    void InputDispatcher::dropInboundEventLocked(EventEntry* entry, DropReason dropReason) {
        const char* reason;
        switch (dropReason) {
        case DROP_REASON_POLICY:
            reason = "inbound event was dropped because the policy consumed it";
            break;
        case DROP_REASON_DISABLED:
            if (mLastDropReason != DROP_REASON_DISABLED) {
                ALOGI("Dropped event because input dispatch is disabled.");
            }
            reason = "inbound event was dropped because input dispatch is disabled";
            break;
        case DROP_REASON_APP_SWITCH:
            ALOGI("Dropped event because of pending overdue app switch.");
            reason = "inbound event was dropped because of pending overdue app switch";
            break;
        case DROP_REASON_BLOCKED:
            ALOGI("Dropped event because the current application is not responding and the user "
                    "has started interacting with a different application.");
            reason = "inbound event was dropped because the current application is not responding "
                    "and the user has started interacting with a different application";
            break;
        case DROP_REASON_STALE:
            ALOGI("Dropped event because it is stale.");
            reason = "inbound event was dropped because it is stale";
            break;
        default:
            return;
        }

        switch (entry->type) {
        case EventEntry::TYPE_KEY: {
            CancelationOptions options(CancelationOptions::CANCEL_NON_POINTER_EVENTS, reason);
            synthesizeCancelationEventsForAllConnectionsLocked(options);
            break;
        }
        case EventEntry::TYPE_MOTION: {
            MotionEntry* motionEntry = static_cast<MotionEntry*>(entry);
            if (motionEntry->source & AINPUT_SOURCE_CLASS_POINTER) {
                CancelationOptions options(CancelationOptions::CANCEL_POINTER_EVENTS, reason);
                synthesizeCancelationEventsForAllConnectionsLocked(options);
            } else {
                CancelationOptions options(CancelationOptions::CANCEL_NON_POINTER_EVENTS, reason);
                synthesizeCancelationEventsForAllConnectionsLocked(options);
            }
            break;
        }
        }
    }

事件被丢失的原因有:

1. DROP_REASON_POLICY: "inbound event was dropped because the policy consumed it";
2. DROP_REASON_DISABLED: "inbound event was dropped because input dispatch is disabled";
3. DROP_REASON_APP_SWITCH: "inbound event was dropped because of pending overdue app switch";
4. DROP_REASON_BLOCKED: "inbound event was dropped because the current application is not responding
    and the user has started interacting with a different application"";
5. DROP_REASON_STALE: "inbound event was dropped because it is stale";

### 2.2 dispatchKeyLocked



#### handleTargetsNotReadyLocked

int32_t InputDispatcher::handleTargetsNotReadyLocked(nsecs_t currentTime,
        const EventEntry* entry,
        const sp<InputApplicationHandle>& applicationHandle,
        const sp<InputWindowHandle>& windowHandle,
        nsecs_t* nextWakeupTime, const char* reason) {
    if (applicationHandle == NULL && windowHandle == NULL) {
        if (mInputTargetWaitCause != INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY) {
            mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY;
            mInputTargetWaitStartTime = currentTime;
            mInputTargetWaitTimeoutTime = LONG_LONG_MAX;
            mInputTargetWaitTimeoutExpired = false;
            mInputTargetWaitApplicationHandle.clear();
        }
    } else {
        if (mInputTargetWaitCause != INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY) {
            nsecs_t timeout;
            if (windowHandle != NULL) {
                timeout = windowHandle->getDispatchingTimeout(DEFAULT_INPUT_DISPATCHING_TIMEOUT);
            } else if (applicationHandle != NULL) {
                timeout = applicationHandle->getDispatchingTimeout(DEFAULT_INPUT_DISPATCHING_TIMEOUT);
            } else {
                timeout = DEFAULT_INPUT_DISPATCHING_TIMEOUT;
            }

            mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY;
            mInputTargetWaitStartTime = currentTime;
            // timeout = 5s
            mInputTargetWaitTimeoutTime = currentTime + timeout;
            mInputTargetWaitTimeoutExpired = false;
            mInputTargetWaitApplicationHandle.clear();

            if (windowHandle != NULL) {
                mInputTargetWaitApplicationHandle = windowHandle->inputApplicationHandle;
            }
            if (mInputTargetWaitApplicationHandle == NULL && applicationHandle != NULL) {
                mInputTargetWaitApplicationHandle = applicationHandle;
            }
        }
    }

    if (mInputTargetWaitTimeoutExpired) {
        return INPUT_EVENT_INJECTION_TIMED_OUT;
    }

    if (currentTime >= mInputTargetWaitTimeoutTime) {
        onANRLocked(currentTime, applicationHandle, windowHandle,
                entry->eventTime, mInputTargetWaitStartTime, reason);

        *nextWakeupTime = LONG_LONG_MIN;
        return INPUT_EVENT_INJECTION_PENDING;
    } else {
        if (mInputTargetWaitTimeoutTime < *nextWakeupTime) {
            *nextWakeupTime = mInputTargetWaitTimeoutTime;
        }
        return INPUT_EVENT_INJECTION_PENDING;
    }
}


## 三. command

#### 3.1 runCommandsLockedInterruptible

    bool InputDispatcher::runCommandsLockedInterruptible() {
        if (mCommandQueue.isEmpty()) {
            return false;
        }

        do {
            //从mCommandQueue队列的头部取出第一个元素
            CommandEntry* commandEntry = mCommandQueue.dequeueAtHead();

            Command command = commandEntry->command; // & InputDispatcher::doNotifyANRLockedInterruptible
            //此处调用的命令隐式地包含'LockedInterruptible' 
            (this->*command)(commandEntry); 

            commandEntry->connection.clear();
            delete commandEntry;
        } while (! mCommandQueue.isEmpty());
        return true;
    }

通过循环方式,处理完mCommandQueue队列的所有命令. 处理过程从mCommandQueue中取出CommandEntry,在

    
    
#### 3.1  handleTargetsNotReadyLocked

    int32_t InputDispatcher::handleTargetsNotReadyLocked(nsecs_t currentTime,
            const EventEntry* entry,
            const sp<InputApplicationHandle>& applicationHandle,
            const sp<InputWindowHandle>& windowHandle,
            nsecs_t* nextWakeupTime, const char* reason) {
        if (applicationHandle == NULL && windowHandle == NULL) {
            if (mInputTargetWaitCause != INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY) {
                mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY;
                mInputTargetWaitStartTime = currentTime;
                mInputTargetWaitTimeoutTime = LONG_LONG_MAX;
                mInputTargetWaitTimeoutExpired = false;
                mInputTargetWaitApplicationHandle.clear();
            }
        } else {
            if (mInputTargetWaitCause != INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY) {
                nsecs_t timeout;
                if (windowHandle != NULL) {
                    timeout = windowHandle->getDispatchingTimeout(DEFAULT_INPUT_DISPATCHING_TIMEOUT);
                } else if (applicationHandle != NULL) {
                    timeout = applicationHandle->getDispatchingTimeout(
                            DEFAULT_INPUT_DISPATCHING_TIMEOUT);
                } else {
                    timeout = DEFAULT_INPUT_DISPATCHING_TIMEOUT;
                }

                mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY;
                mInputTargetWaitStartTime = currentTime;
                mInputTargetWaitTimeoutTime = currentTime + timeout;
                mInputTargetWaitTimeoutExpired = false;
                mInputTargetWaitApplicationHandle.clear();

                if (windowHandle != NULL) {
                    mInputTargetWaitApplicationHandle = windowHandle->inputApplicationHandle;
                }
                if (mInputTargetWaitApplicationHandle == NULL && applicationHandle != NULL) {
                    mInputTargetWaitApplicationHandle = applicationHandle;
                }
            }
        }

        if (mInputTargetWaitTimeoutExpired) {
            return INPUT_EVENT_INJECTION_TIMED_OUT;
        }

        if (currentTime >= mInputTargetWaitTimeoutTime) {
            onANRLocked(currentTime, applicationHandle, windowHandle,
                    entry->eventTime, mInputTargetWaitStartTime, reason);

            // Force poll loop to wake up immediately on next iteration once we get the
            // ANR response back from the policy.
            *nextWakeupTime = LONG_LONG_MIN;
            return INPUT_EVENT_INJECTION_PENDING;
        } else {
            // Force poll loop to wake up when timeout is due.
            if (mInputTargetWaitTimeoutTime < *nextWakeupTime) {
                *nextWakeupTime = mInputTargetWaitTimeoutTime;
            }
            return INPUT_EVENT_INJECTION_PENDING;
        }
    }
#### 3.2  onANRLocked

    void InputDispatcher::onANRLocked(
            nsecs_t currentTime, const sp<InputApplicationHandle>& applicationHandle,
            const sp<InputWindowHandle>& windowHandle,
            nsecs_t eventTime, nsecs_t waitStartTime, const char* reason) {
        float dispatchLatency = (currentTime - eventTime) * 0.000001f;
        float waitDuration = (currentTime - waitStartTime) * 0.000001f;
        
        ALOGI("Application is not responding: %s.  "
                "It has been %0.1fms since event, %0.1fms since wait started.  Reason: %s",
                getApplicationWindowLabelLocked(applicationHandle, windowHandle).string(),
                dispatchLatency, waitDuration, reason);

        // Capture a record of the InputDispatcher state at the time of the ANR.
        time_t t = time(NULL);
        struct tm tm;
        localtime_r(&t, &tm);
        char timestr[64];
        strftime(timestr, sizeof(timestr), "%F %T", &tm);
        mLastANRState.clear();
        mLastANRState.append(INDENT "ANR:\n");
        mLastANRState.appendFormat(INDENT2 "Time: %s\n", timestr);
        mLastANRState.appendFormat(INDENT2 "Window: %s\n",
                getApplicationWindowLabelLocked(applicationHandle, windowHandle).string());
        mLastANRState.appendFormat(INDENT2 "DispatchLatency: %0.1fms\n", dispatchLatency);
        mLastANRState.appendFormat(INDENT2 "WaitDuration: %0.1fms\n", waitDuration);
        mLastANRState.appendFormat(INDENT2 "Reason: %s\n", reason);
        dumpDispatchStateLocked(mLastANRState);

        //[见小节3.3]
        CommandEntry* commandEntry = postCommandLocked(
                & InputDispatcher::doNotifyANRLockedInterruptible);
        commandEntry->inputApplicationHandle = applicationHandle;
        commandEntry->inputWindowHandle = windowHandle;
        commandEntry->reason = reason;
    }


#### 3.3 postCommandLocked

    InputDispatcher::CommandEntry* InputDispatcher::postCommandLocked(Command command) {
        CommandEntry* commandEntry = new CommandEntry(command);
        mCommandQueue.enqueueAtTail(commandEntry); // 将命令实体加入mCommandQueue队列的尾部
        return commandEntry;
    }
    
#### 3.4 doNotifyANRLockedInterruptible

    void InputDispatcher::doNotifyANRLockedInterruptible(
            CommandEntry* commandEntry) {
        mLock.unlock();

        //[见小节3.5]
        nsecs_t newTimeout = mPolicy->notifyANR(
                commandEntry->inputApplicationHandle, commandEntry->inputWindowHandle,
                commandEntry->reason);

        mLock.lock();
        // [见小节3.7]
        resumeAfterTargetsNotReadyTimeoutLocked(newTimeout,
                commandEntry->inputWindowHandle != NULL
                        ? commandEntry->inputWindowHandle->getInputChannel() : NULL);
    }

mPolicy是指NativeInputManager

#### 3.5 notifyANR
[-> com_android_server_input_InputManagerService.cpp]

    nsecs_t NativeInputManager::notifyANR(const sp<InputApplicationHandle>& inputApplicationHandle,
            const sp<InputWindowHandle>& inputWindowHandle, const String8& reason) {
        JNIEnv* env = jniEnv();

        jobject inputApplicationHandleObj =
                getInputApplicationHandleObjLocalRef(env, inputApplicationHandle);
        jobject inputWindowHandleObj =
                getInputWindowHandleObjLocalRef(env, inputWindowHandle);
        jstring reasonObj = env->NewStringUTF(reason.string());

        //调用Java方法[见小节3.6]
        jlong newTimeout = env->CallLongMethod(mServiceObj,
                    gServiceClassInfo.notifyANR, inputApplicationHandleObj, inputWindowHandleObj,
                    reasonObj);
        if (checkAndClearExceptionFromCallback(env, "notifyANR")) {
            newTimeout = 0; //抛出异常,则清理并重置timeout
        } else {
            assert(newTimeout >= 0);
        }

        env->DeleteLocalRef(reasonObj);
        env->DeleteLocalRef(inputWindowHandleObj);
        env->DeleteLocalRef(inputApplicationHandleObj);
        return newTimeout;
    }
    
    int register_android_server_InputManager(JNIEnv* env) {
        int res = jniRegisterNativeMethods(env, "com/android/server/input/InputManagerService",
                gInputManagerMethods, NELEM(gInputManagerMethods));

        jclass clazz;
        FIND_CLASS(clazz, "com/android/server/input/InputManagerService");
        ...
        GET_METHOD_ID(gServiceClassInfo.notifyANR, clazz,
                "notifyANR",
                "(Lcom/android/server/input/InputApplicationHandle;Lcom/android/server/input/InputWindowHandle;Ljava/lang/String;)J");
        ...
    }
    
    #define FIND_CLASS(var, className) \
        var = env->FindClass(className); \
        LOG_FATAL_IF(! var, "Unable to find class " className);

    #define GET_METHOD_ID(var, clazz, methodName, methodDescriptor) \
        var = env->GetMethodID(clazz, methodName, methodDescriptor); \
        LOG_FATAL_IF(! var, "Unable to find method " methodName);
        

可知,gServiceClassInfo.notifyANR是指IMS.notifyANR

### 3.6  IMS.notifyANR
[-> InputManagerService.java]

    private long notifyANR(InputApplicationHandle inputApplicationHandle,
            InputWindowHandle inputWindowHandle, String reason) {
        //[见小节3.7]
        return mWindowManagerCallbacks.notifyANR(
                inputApplicationHandle, inputWindowHandle, reason);
    }
    
此处mWindowManagerCallbacks是指InputMonitor


    inputManager.setWindowManagerCallbacks(wm.getInputMonitor());

    public void setWindowManagerCallbacks(WindowManagerCallbacks callbacks) {
        mWindowManagerCallbacks = callbacks;
    }

### resumeAfterTargetsNotReadyTimeoutLocked

    void InputDispatcher::resumeAfterTargetsNotReadyTimeoutLocked(nsecs_t newTimeout,
            const sp<InputChannel>& inputChannel) {
        if (newTimeout > 0) {
            mInputTargetWaitTimeoutTime = now() + newTimeout; //扩展超时时长
        } else {
            mInputTargetWaitTimeoutExpired = true; //放弃

            //输入状态不真实.
            if (inputChannel.get()) {
                ssize_t connectionIndex = getConnectionIndexLocked(inputChannel);
                if (connectionIndex >= 0) {
                    sp<Connection> connection = mConnectionsByFd.valueAt(connectionIndex);
                    sp<InputWindowHandle> windowHandle = connection->inputWindowHandle;

                    if (windowHandle != NULL) {
                        const InputWindowInfo* info = windowHandle->getInfo();
                        if (info) {
                            ssize_t stateIndex = mTouchStatesByDisplay.indexOfKey(info->displayId);
                            if (stateIndex >= 0) {
                                mTouchStatesByDisplay.editValueAt(stateIndex).removeWindow(
                                        windowHandle);
                            }
                        }
                    }

                    if (connection->status == Connection::STATUS_NORMAL) {
                        CancelationOptions options(CancelationOptions::CANCEL_ALL_EVENTS,
                                "application not responding");
                        synthesizeCancelationEventsForConnectionLocked(connection, options);
                    }
                }
            }
        }
    }
    
//
#### 2.1 haveCommandsLocked

    bool InputDispatcher::haveCommandsLocked() const {
        return !mCommandQueue.isEmpty();
    }
## 其他

    InputDispatcherThread::threadLoop
    dispatchOnce
    dispatchOnceInnerLocked
    dispatchKeyLocked // dispatchMotionLocked
    findFocusedWindowTargetsLocked  //findTouchedWindowTargetsLocked
    handleTargetsNotReadyLocked
