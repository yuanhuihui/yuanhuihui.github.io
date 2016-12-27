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
    frameworks/native/include/android/input.h
    frameworks/native/include/input/InputTransport.h
    
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
        nsecs_t currentTime = now(); //当前时间

        if (!mDispatchEnabled) { //默认值为false
            resetKeyRepeatLocked(); //重置操作
        }
        if (mDispatchFrozen) { //默认值为false
            return; //当分发被冻结，则不再处理超时和分发事件的工作，直接返回
        }

        //优化app切换延迟，当切换超时，则抢占分发，丢弃其他所有即将要处理的事件。
        bool isAppSwitchDue = mAppSwitchDueTime <= currentTime;
        ...

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
        ...
        }
        
        //分发操作完成，则进入该分支
        if (done) {
            if (dropReason != DROP_REASON_NOT_DROPPED) {
                //[见小节2.1.2]
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

1. mDispatchFrozen用于决定是否冻结事件分发工作不再往下执行;
2. 当事件分发的时间点距离该事件加入mInboundQueue的时间超过500ms,则认为app切换过期,即isAppSwitchDue=true;
3. mInboundQueue不为空,则取出头部的事件,放入mPendingEvent变量;并重置ANR时间;
4. 根据情况设置dropReason;
5. 根据EventEntry的type类型分别处理:
    - TYPE_KEY: 则调用dispatchKeyLocked分发事件;
    - TYPE_MOTION: 则调用dispatchMotionLocked分发事件;
6. 执行完成后，根据dropReason来决定是否丢失事件，以及释放当前事件；

接下来以按键为例来展开说明, 则进入[小节2.2] dispatchKeyLocked

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

事件需要丢弃的原因有以下5类：

1. DROP_REASON_POLICY: "inbound event was dropped because the policy consumed it";
2. DROP_REASON_DISABLED: "inbound event was dropped because input dispatch is disabled";
3. DROP_REASON_APP_SWITCH: "inbound event was dropped because of pending overdue app switch";
4. DROP_REASON_BLOCKED: "inbound event was dropped because the current application is not responding
    and the user has started interacting with a different application"";
5. DROP_REASON_STALE: "inbound event was dropped because it is stale";

### 2.2 dispatchKeyLocked

    bool InputDispatcher::dispatchKeyLocked(nsecs_t currentTime, KeyEntry* entry,
            DropReason* dropReason, nsecs_t* nextWakeupTime) {
        if (! entry->dispatchInProgress) {
            ...
        }

        if (entry->interceptKeyResult == KeyEntry::INTERCEPT_KEY_RESULT_TRY_AGAIN_LATER) {
            //当前时间小于唤醒时间，则进入等待状态。
            if (currentTime < entry->interceptKeyWakeupTime) {
                if (entry->interceptKeyWakeupTime < *nextWakeupTime) {
                    *nextWakeupTime = entry->interceptKeyWakeupTime;
                }
                return false; //直接返回
            }
            entry->interceptKeyResult = KeyEntry::INTERCEPT_KEY_RESULT_UNKNOWN;
            entry->interceptKeyWakeupTime = 0;
        }

        if (entry->interceptKeyResult == KeyEntry::INTERCEPT_KEY_RESULT_UNKNOWN) {
            //让policy有机会执行拦截操作
            if (entry->policyFlags & POLICY_FLAG_PASS_TO_USER) {
                CommandEntry* commandEntry = postCommandLocked(
                        & InputDispatcher::doInterceptKeyBeforeDispatchingLockedInterruptible);
                if (mFocusedWindowHandle != NULL) {
                    commandEntry->inputWindowHandle = mFocusedWindowHandle;
                }
                commandEntry->keyEntry = entry;
                entry->refCount += 1;
                return false; //直接返回
            } else {
                entry->interceptKeyResult = KeyEntry::INTERCEPT_KEY_RESULT_CONTINUE;
            }
        } else if (entry->interceptKeyResult == KeyEntry::INTERCEPT_KEY_RESULT_SKIP) {
            if (*dropReason == DROP_REASON_NOT_DROPPED) {
                *dropReason = DROP_REASON_POLICY;
            }
        }

        //如果需要丢弃该事件，则执行清理操作
        if (*dropReason != DROP_REASON_NOT_DROPPED) {
            setInjectionResultLocked(entry, *dropReason == DROP_REASON_POLICY
                    ? INPUT_EVENT_INJECTION_SUCCEEDED : INPUT_EVENT_INJECTION_FAILED);
            return true; //直接返回
        }

        Vector<InputTarget> inputTargets;
        // 【见小节2.3】
        int32_t injectionResult = findFocusedWindowTargetsLocked(currentTime,
                entry, inputTargets, nextWakeupTime);
        if (injectionResult == INPUT_EVENT_INJECTION_PENDING) {
            return false; //直接返回
        }

        setInjectionResultLocked(entry, injectionResult);
        if (injectionResult != INPUT_EVENT_INJECTION_SUCCEEDED) {
            return true; //直接返回
        }
        addMonitoringTargetsLocked(inputTargets);

        //只有injectionResult是成功，才有机会执行分发事件【见小节2.5】
        dispatchEventLocked(currentTime, entry, inputTargets);
        return true;
    }
    
在以下场景下，有可能无法分发事件：

- 当前时间小于唤醒时间的情况；
- policy需要提前拦截事件的情况；
- 需要drop事件的情况；
- 寻找聚焦窗口失败的情况；

如果成功跳过以上所有情况，则会进入执行事件分发的过程。
    
### 2.3 findFocusedWindowTargetsLocked

    int32_t InputDispatcher::findFocusedWindowTargetsLocked(nsecs_t currentTime,
            const EventEntry* entry, Vector<InputTarget>& inputTargets, nsecs_t* nextWakeupTime) {
        int32_t injectionResult;
        String8 reason;

        if (mFocusedWindowHandle == NULL) {
            if (mFocusedApplicationHandle != NULL) {
                //【见小节2.4】
                injectionResult = handleTargetsNotReadyLocked(currentTime, entry,
                        mFocusedApplicationHandle, NULL, nextWakeupTime,
                        "Waiting because no window has focus but there is a "
                        "focused application that may eventually add a window "
                        "when it finishes starting up.");
                goto Unresponsive;
            }

            ALOGI("Dropping event because there is no focused window or focused application.");
            injectionResult = INPUT_EVENT_INJECTION_FAILED;
            goto Failed;
        }

        //权限检查
        if (! checkInjectionPermission(mFocusedWindowHandle, entry->injectionState)) {
            injectionResult = INPUT_EVENT_INJECTION_PERMISSION_DENIED;
            goto Failed;
        }

        //检测窗口是否为更多的输入操作而准备就绪【见小节2.3.1】
        reason = checkWindowReadyForMoreInputLocked(currentTime,
                mFocusedWindowHandle, entry, "focused");
        if (!reason.isEmpty()) {
            //【见小节2.3.2】
            injectionResult = handleTargetsNotReadyLocked(currentTime, entry,
                    mFocusedApplicationHandle, mFocusedWindowHandle, nextWakeupTime, reason.string());
            goto Unresponsive;
        }

        injectionResult = INPUT_EVENT_INJECTION_SUCCEEDED;
        //成功找到目标窗口，添加到目标窗口【见小节2.4】
        addWindowTargetLocked(mFocusedWindowHandle,
                InputTarget::FLAG_FOREGROUND | InputTarget::FLAG_DISPATCH_AS_IS, BitSet32(0),
                inputTargets);

    Failed:
    Unresponsive:
        ...
        return injectionResult;
    }
    
寻找聚焦窗口失败的情况：

- 无窗口，无应用：Dropping event because there is no focused window or focused application.
- 无窗口, 有应用：Waiting because no window has focus but there is a focused application that may eventually add a window when it finishes starting up.

另外，还有更多大的失败场景见checkWindowReadyForMoreInputLocked的过程，如下。
   
#### 2.3.1 checkWindowReadyForMoreInputLocked

    String8 InputDispatcher::checkWindowReadyForMoreInputLocked(nsecs_t currentTime,
            const sp<InputWindowHandle>& windowHandle, const EventEntry* eventEntry,
            const char* targetType) {
        //当窗口暂停的情况，则保持等待
        if (windowHandle->getInfo()->paused) {
            return String8::format("Waiting because the %s window is paused.", targetType);
        }

        //当窗口连接未注册，则保持等待
        ssize_t connectionIndex = getConnectionIndexLocked(windowHandle->getInputChannel());
        if (connectionIndex < 0) {
            return String8::format("Waiting because the %s window's input channel is not "
                    "registered with the input dispatcher.  The window may be in the process "
                    "of being removed.", targetType);
        }

        //当窗口连接已死亡，则保持等待
        sp<Connection> connection = mConnectionsByFd.valueAt(connectionIndex);
        if (connection->status != Connection::STATUS_NORMAL) {
            return String8::format("Waiting because the %s window's input connection is %s."
                    "The window may be in the process of being removed.", targetType,
                    connection->getStatusLabel());
        }

        // 当窗口连接已满，则保持等待
        if (connection->inputPublisherBlocked) {
            return String8::format("Waiting because the %s window's input channel is full.  "
                    "Outbound queue length: %d.  Wait queue length: %d.",
                    targetType, connection->outboundQueue.count(), connection->waitQueue.count());
        }

        //确保分发队列，并没有存储过多事件
        if (eventEntry->type == EventEntry::TYPE_KEY) {
            if (!connection->outboundQueue.isEmpty() || !connection->waitQueue.isEmpty()) {
                return String8::format("Waiting to send key event because the %s window has not "
                        "finished processing all of the input events that were previously "
                        "delivered to it.  Outbound queue length: %d.  Wait queue length: %d.",
                        targetType, connection->outboundQueue.count(), connection->waitQueue.count());
            }
        } else {
            if (!connection->waitQueue.isEmpty()
                    && currentTime >= connection->waitQueue.head->deliveryTime
                            + STREAM_AHEAD_EVENT_TIMEOUT) {
                return String8::format("Waiting to send non-key event because the %s window has not "
                        "finished processing certain input events that were delivered to it over "
                        "%0.1fms ago.  Wait queue length: %d.  Wait queue head age: %0.1fms.",
                        targetType, STREAM_AHEAD_EVENT_TIMEOUT * 0.000001f,
                        connection->waitQueue.count(),
                        (currentTime - connection->waitQueue.head->deliveryTime) * 0.000001f);
            }
        }
        return String8::empty();
    }
    
该方法的返回值代表的是NotReady的原因，主要如下：

- 窗口连接已死亡：Waiting because the [targetType] window's input connection is [Connection.Status]. The window may be in the process of being removed.
- 窗口连接已满：Waiting because the [targetType] window's input channel is full.  Outbound queue length: [outboundQueue长度].  Wait queue length: [waitQueue长度].
- 按键事件，输出队列或事件等待队列不为空：Waiting to send key event because the [targetType] window has not finished processing all of the input events that were previously delivered to it.  Outbound queue length: [outboundQueue长度].  Wait queue length: [waitQueue长度].
- 非按键事件，事件等待队列不为空且头事件分发超时500ms：Waiting to send non-key event because the [targetType] window has not finished processing certain input events that were delivered to it over 500ms ago.  Wait queue length: [waitQueue长度].  Wait queue head age: [等待时长].

其中

- targetType的取值为"focused"或者"touched"
- Connection.Status的取值为"NORMAL"，"BROKEN"，"ZOMBIE"

#### 2.3.2 handleTargetsNotReadyLocked

    int32_t InputDispatcher::handleTargetsNotReadyLocked(nsecs_t currentTime,
        const EventEntry* entry,
        const sp<InputApplicationHandle>& applicationHandle,
        const sp<InputWindowHandle>& windowHandle,
        nsecs_t* nextWakeupTime, const char* reason) {
        if (applicationHandle == NULL && windowHandle == NULL) {
            if (mInputTargetWaitCause != INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY) {
                mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY;
                mInputTargetWaitStartTime = currentTime; //当前时间
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
                    timeout = DEFAULT_INPUT_DISPATCHING_TIMEOUT; // 5s
                }

                mInputTargetWaitCause = INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY;
                mInputTargetWaitStartTime = currentTime; //当前时间
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
            return INPUT_EVENT_INJECTION_TIMED_OUT; //等待超时已过期
        }
        
        //当超时5s则进入ANR流程
        if (currentTime >= mInputTargetWaitTimeoutTime) {
            onANRLocked(currentTime, applicationHandle, windowHandle,
                    entry->eventTime, mInputTargetWaitStartTime, reason);

            *nextWakeupTime = LONG_LONG_MIN; //强制立刻执行轮询来执行ANR策略
            return INPUT_EVENT_INJECTION_PENDING;
        } else {
            if (mInputTargetWaitTimeoutTime < *nextWakeupTime) {
                *nextWakeupTime = mInputTargetWaitTimeoutTime; //当触发超时则强制执行轮询
            }
            return INPUT_EVENT_INJECTION_PENDING;
        }
    }

- 当applicationHandle和windowHandle同时为空, 且system准备就绪的情况下
    - 设置等待理由 INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY;
    - 设置超时等待时长为无限大;
    - 设置TimeoutExpired= false
    - 清空等待队列;
- 当applicationHandle和windowHandle至少一个不为空, 且application准备就绪的情况下:
    - 设置等待理由 INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY;
    - 设置超时等待时长为5s;
    - 设置TimeoutExpired= false
    - 清空等待队列;

关于ANR先说到这，后文再展开。 继续回到[小节2.3]findFocusedWindowTargetsLocked，如果没有发生ANR，则将该事件添加到inputTargets。

### 2.4 addWindowTargetLocked

    void InputDispatcher::addWindowTargetLocked(const sp<InputWindowHandle>& windowHandle,
            int32_t targetFlags, BitSet32 pointerIds, Vector<InputTarget>& inputTargets) {
        inputTargets.push();

        const InputWindowInfo* windowInfo = windowHandle->getInfo();
        InputTarget& target = inputTargets.editTop();
        target.inputChannel = windowInfo->inputChannel;
        target.flags = targetFlags;
        target.xOffset = - windowInfo->frameLeft;
        target.yOffset = - windowInfo->frameTop;
        target.scaleFactor = windowInfo->scaleFactor;
        target.pointerIds = pointerIds;
    }
    
将当前聚焦窗口mFocusedWindowHandle的inputChannel传递到inputTargets。

### 2.5 dispatchEventLocked

    void InputDispatcher::dispatchEventLocked(nsecs_t currentTime,
            EventEntry* eventEntry, const Vector<InputTarget>& inputTargets) {
        pokeUserActivityLocked(eventEntry);

        for (size_t i = 0; i < inputTargets.size(); i++) {
            const InputTarget& inputTarget = inputTargets.itemAt(i);

            ssize_t connectionIndex = getConnectionIndexLocked(inputTarget.inputChannel);
            if (connectionIndex >= 0) {
                sp<Connection> connection = mConnectionsByFd.valueAt(connectionIndex);
                prepareDispatchCycleLocked(currentTime, connection, eventEntry, &inputTarget);
            }
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

## 重要结构体

#### InputDispatcher
[-> InputDispatcher.h]

    enum DropReason {
       DROP_REASON_NOT_DROPPED = 0, //不丢弃
       DROP_REASON_POLICY = 1, //策略
       DROP_REASON_APP_SWITCH = 2, //应用切换
       DROP_REASON_DISABLED = 3, //disable
       DROP_REASON_BLOCKED = 4, //阻塞
       DROP_REASON_STALE = 5, //过时
    };
    
    enum InputTargetWaitCause {
        INPUT_TARGET_WAIT_CAUSE_NONE,
        INPUT_TARGET_WAIT_CAUSE_SYSTEM_NOT_READY, //系统没有准备就绪
        INPUT_TARGET_WAIT_CAUSE_APPLICATION_NOT_READY, //应用没有准备就绪
    };
    
    EventEntry* mPendingEvent;
    Queue<EventEntry> mInboundQueue; //需要InputDispatcher分发的事件队列
    Queue<EventEntry> mRecentQueue;
    Queue<CommandEntry> mCommandQueue;
    
    Vector<sp<InputWindowHandle> > mWindowHandles;
    sp<InputWindowHandle> mFocusedWindowHandle; //聚焦窗口
    sp<InputApplicationHandle> mFocusedApplicationHandle; //聚焦应用
    String8 mLastANRState; //上一次ANR时的分发状态
    
    InputTargetWaitCause mInputTargetWaitCause;
    nsecs_t mInputTargetWaitStartTime;
    nsecs_t mInputTargetWaitTimeoutTime;
    bool mInputTargetWaitTimeoutExpired;
    //目标等待的应用
    sp<InputApplicationHandle> mInputTargetWaitApplicationHandle;
    
#### Connection
[-> InputDispatcher.h]

    class Connection : public RefBase {
        enum Status {
            STATUS_NORMAL, //正常状态
            STATUS_BROKEN, //发生无法恢复的错误
            STATUS_ZOMBIE  //input channel被注销掉
        };
        Status status; //状态
        sp<InputChannel> inputChannel; //永不为空
        sp<InputWindowHandle> inputWindowHandle; //可能为空
        bool monitor;
        InputPublisher inputPublisher;
        InputState inputState;
        
        //当socket占满的同时，应用消费某些输入事件之前无法发布事件，则值为true.
        bool inputPublisherBlocked; 
        
        //需要被发布到connection的事件队列
        Queue<DispatchEntry> outboundQueue;
        
        //已发布到connection，但还没有收到来自应用的“finished”响应的事件队列
        Queue<DispatchEntry> waitQueue;
    }
    
#### EventEntry
[-> InputDispatcher.h]

    struct EventEntry : Link<EventEntry> {
         enum {
             TYPE_CONFIGURATION_CHANGED,
             TYPE_DEVICE_RESET,
             TYPE_KEY,
             TYPE_MOTION
         };

         mutable int32_t refCount;
         int32_t type;
         nsecs_t eventTime; //事件时间
         uint32_t policyFlags;
         InjectionState* injectionState;

         bool dispatchInProgress; //初始值为false, 分发过程则设置成true
     };
     
#### InputChannel
[-> InputTransport.h]

    class InputChannel : public RefBase {
        // 创建一对input channels
        static status_t openInputChannelPair(const String8& name,
                sp<InputChannel>& outServerChannel, sp<InputChannel>& outClientChannel);

        /* Sends a message to the other endpoint.
         *
         * If the channel is full then the message is guaranteed not to have been sent at all.
         * Try again after the consumer has sent a finished signal indicating that it has
         * consumed some of the pending messages from the channel.
         *
         * Returns OK on success.
         * Returns WOULD_BLOCK if the channel is full.
         * Returns DEAD_OBJECT if the channel's peer has been closed.
         * Other errors probably indicate that the channel is broken.
         */
        status_t sendMessage(const InputMessage* msg);

        /* Receives a message sent by the other endpoint.
         *
         * If there is no message present, try again after poll() indicates that the fd
         * is readable.
         *
         * Returns OK on success.
         * Returns WOULD_BLOCK if there is no message present.
         * Returns DEAD_OBJECT if the channel's peer has been closed.
         * Other errors probably indicate that the channel is broken.
         */
        status_t receiveMessage(InputMessage* msg);

        /* Returns a new object that has a duplicate of this channel's fd. */
        sp<InputChannel> dup() const;

    private:
        String8 mName;
        int mFd;
    };
