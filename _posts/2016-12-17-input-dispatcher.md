---
layout: post
title:  "输入系统之InputDispatcher线程"
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
    frameworks/native/libs/input/InputTransport.cpp
    
## 一. InputDispatcher起点

上篇文章[输入系统之InputReader线程](http://gityuan.com/2016/12/11/input-reader/)，介绍InputReader利用EventHub获取数据后生成EventEntry事件，加入到InputDispatcher的mInboundQueue队列，再唤醒InputDispatcher线程。本文将介绍
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

- 当前时间小于唤醒时间(nextWakeupTime)的情况；
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
                //【见小节2.3.2】
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

- **窗口连接已死亡**：Waiting because the [targetType] window's input connection is [Connection.Status]. The window may be in the process of being removed.
- **窗口连接已满**：Waiting because the [targetType] window's input channel is full.  Outbound queue length: [outboundQueue长度].  Wait queue length: [waitQueue长度].
- **按键事件，输出队列或事件等待队列不为空**：Waiting to send key event because the [targetType] window has not finished processing all of the input events that were previously delivered to it.  Outbound queue length: [outboundQueue长度].  Wait queue length: [waitQueue长度].
- **非按键事件，事件等待队列不为空且头事件分发超时500ms**：Waiting to send non-key event because the [targetType] window has not finished processing certain input events that were delivered to it over 500ms ago.  Wait queue length: [waitQueue长度].  Wait queue head age: [等待时长].

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
            return INPUT_EVENT_INJECTION_TIMED_OUT; //等待超时已过期,则直接返回
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

关于ANR先说到这，后文再展开。 继续回到[小节2.3]findFocusedWindowTargetsLocked，如果没有发生ANR，则addWindowTargetLocked()将该事件添加到inputTargets。

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
        //向mCommandQueue队列添加doPokeUserActivityLockedInterruptible命令
        pokeUserActivityLocked(eventEntry);

        for (size_t i = 0; i < inputTargets.size(); i++) {
            const InputTarget& inputTarget = inputTargets.itemAt(i);
            //[见小节2.5.1]
            ssize_t connectionIndex = getConnectionIndexLocked(inputTarget.inputChannel);
            if (connectionIndex >= 0) {
                sp<Connection> connection = mConnectionsByFd.valueAt(connectionIndex);
                //找到目标连接[见小节２.6]
                prepareDispatchCycleLocked(currentTime, connection, eventEntry, &inputTarget);
            }
        }
    }

该方法主要功能是将eventEntry发送到目标inputTargets．

其中pokeUserActivityLocked(eventEntry)方法最终会调用到Java层的PowerManagerService.jva中的`userActivityFromNative()`方法．
这也是PMS中唯一的native all方法．

#### 2.5.1 getConnectionIndexLocked

    ssize_t InputDispatcher::getConnectionIndexLocked(const sp<InputChannel>& inputChannel) {
        ssize_t connectionIndex = mConnectionsByFd.indexOfKey(inputChannel->getFd());
        if (connectionIndex >= 0) {
            sp<Connection> connection = mConnectionsByFd.valueAt(connectionIndex);
            if (connection->inputChannel.get() == inputChannel.get()) {
                return connectionIndex;
            }
        }

        return -1;
    }

根据inputChannel的fd，从mConnectionsByFd队列中查询目标connection，

### 2.6 prepareDispatchCycleLocked

    void InputDispatcher::prepareDispatchCycleLocked(nsecs_t currentTime,
            const sp<Connection>& connection, EventEntry* eventEntry, const InputTarget* inputTarget) {

        if (connection->status != Connection::STATUS_NORMAL) {
            return;　//当连接已破坏,则直接返回
        }

        //如果需要,则分割motion事件
        if (inputTarget->flags & InputTarget::FLAG_SPLIT) {
            MotionEntry* originalMotionEntry = static_cast<MotionEntry*>(eventEntry);
            if (inputTarget->pointerIds.count() != originalMotionEntry->pointerCount) {
                MotionEntry* splitMotionEntry = splitMotionEvent(
                        originalMotionEntry, inputTarget->pointerIds);
                if (!splitMotionEntry) {
                    return; // split event was dropped
                }
                //[见小节2.7]
                enqueueDispatchEntriesLocked(currentTime, connection,
                        splitMotionEntry, inputTarget);
                splitMotionEntry->release();
                return;
            }
        }

        //没有分割的情况 [//[见小节2.7]] 
        enqueueDispatchEntriesLocked(currentTime, connection, eventEntry, inputTarget);
    }


### 2.7 enqueueDispatchEntriesLocked

    void InputDispatcher::enqueueDispatchEntriesLocked(nsecs_t currentTime,
            const sp<Connection>& connection, EventEntry* eventEntry, const InputTarget* inputTarget) {
        bool wasEmpty = connection->outboundQueue.isEmpty();

        //[见小节2.8]
        enqueueDispatchEntryLocked(connection, eventEntry, inputTarget,
                InputTarget::FLAG_DISPATCH_AS_HOVER_EXIT);
        enqueueDispatchEntryLocked(connection, eventEntry, inputTarget,
                InputTarget::FLAG_DISPATCH_AS_OUTSIDE);
        enqueueDispatchEntryLocked(connection, eventEntry, inputTarget,
                InputTarget::FLAG_DISPATCH_AS_HOVER_ENTER);
        enqueueDispatchEntryLocked(connection, eventEntry, inputTarget,
                InputTarget::FLAG_DISPATCH_AS_IS);
        enqueueDispatchEntryLocked(connection, eventEntry, inputTarget,
                InputTarget::FLAG_DISPATCH_AS_SLIPPERY_EXIT);
        enqueueDispatchEntryLocked(connection, eventEntry, inputTarget,
                InputTarget::FLAG_DISPATCH_AS_SLIPPERY_ENTER);

        if (wasEmpty && !connection->outboundQueue.isEmpty()) {
            //当原先的outbound队列为空, 且当前outbound不为空的情况执行.[见小节2.9]
            startDispatchCycleLocked(currentTime, connection);
        }
    }
    
### 2.8 enqueueDispatchEntryLocked

    void InputDispatcher::enqueueDispatchEntryLocked(
            const sp<Connection>& connection, EventEntry* eventEntry, const InputTarget* inputTarget,
            int32_t dispatchMode) {
        int32_t inputTargetFlags = inputTarget->flags;
        if (!(inputTargetFlags & dispatchMode)) {
            return; //分发模式不匹配,则直接返回
        }
        inputTargetFlags = (inputTargetFlags & ~InputTarget::FLAG_DISPATCH_MASK) | dispatchMode;

        //生成新的事件, 加入connection的outbound队列
        DispatchEntry* dispatchEntry = new DispatchEntry(eventEntry, 
                inputTargetFlags, inputTarget->xOffset, inputTarget->yOffset,
                inputTarget->scaleFactor);

        switch (eventEntry->type) {
            case EventEntry::TYPE_KEY: {
                KeyEntry* keyEntry = static_cast<KeyEntry*>(eventEntry);
                dispatchEntry->resolvedAction = keyEntry->action;
                dispatchEntry->resolvedFlags = keyEntry->flags;

                if (!connection->inputState.trackKey(keyEntry,
                        dispatchEntry->resolvedAction, dispatchEntry->resolvedFlags)) {
                    delete dispatchEntry;
                    return; //忽略不连续的事件
                }
                break;
            }

            case EventEntry::TYPE_MOTION: ...
        }

        //记录当前正在等待分发完成
        if (dispatchEntry->hasForegroundTarget()) {
            incrementPendingForegroundDispatchesLocked(eventEntry);
        }

        //添加到outboundQueue队尾
        connection->outboundQueue.enqueueAtTail(dispatchEntry);
    }
    
该方法主要功能:

- 根据dispatchMode来决定是否需要加入outboundQueue队列;
- 根据EventEntry,来生成DispatchEntry事件;
- 将dispatchEntry加入到connection的outbound队列.

执行到这里,其实等于由做了一次搬运的工作,将InputDispatcher中mInboundQueue中的事件取出后, 
找到目标window后,封装dispatchEntry加入到connection的outbound队列. 

如果当connection原先的outbound队列为空, 经过enqueueDispatchEntryLocked处理后, 该outbound不为空的情况下,
则执行startDispatchCycleLocked()方法.

### 2.9 startDispatchCycleLocked

    void InputDispatcher::startDispatchCycleLocked(nsecs_t currentTime,
            const sp<Connection>& connection) {

        //当Connection状态正常,且outboundQueue不为空
        while (connection->status == Connection::STATUS_NORMAL
                && !connection->outboundQueue.isEmpty()) {
            DispatchEntry* dispatchEntry = connection->outboundQueue.head;
            dispatchEntry->deliveryTime = currentTime; //设置deliveryTime时间

            status_t status;
            EventEntry* eventEntry = dispatchEntry->eventEntry;
            switch (eventEntry->type) {
            case EventEntry::TYPE_KEY: {
                KeyEntry* keyEntry = static_cast<KeyEntry*>(eventEntry);

                //发布按键时间 [见小节2.10]
                status = connection->inputPublisher.publishKeyEvent(dispatchEntry->seq,
                        keyEntry->deviceId, keyEntry->source,
                        dispatchEntry->resolvedAction, dispatchEntry->resolvedFlags,
                        keyEntry->keyCode, keyEntry->scanCode,
                        keyEntry->metaState, keyEntry->repeatCount, keyEntry->downTime,
                        keyEntry->eventTime);
                break;
            }

            case EventEntry::TYPE_MOTION: {
                ...
                status = connection->inputPublisher.publishMotionEvent(...);
                break;
            }

            default:
                return;
            }

            //发布结果分析
            if (status) {
                if (status == WOULD_BLOCK) {
                    if (connection->waitQueue.isEmpty()) {
                        //pipe已满,但waitQueue为空. 不正常的行为
                        abortBrokenDispatchCycleLocked(currentTime, connection, true /*notify*/);
                    } else {
                        // 处于阻塞状态
                        connection->inputPublisherBlocked = true;
                    }
                } else {
                    //不不正常的行为
                    abortBrokenDispatchCycleLocked(currentTime, connection, true /*notify*/);
                }
                return;
            }

            //从outboundQueue中取出事件,重新放入waitQueue队列
            connection->outboundQueue.dequeue(dispatchEntry);
            connection->waitQueue.enqueueAtTail(dispatchEntry);

        }
    }

startDispatchCycleLocked的主要功能: 从outboundQueue中取出事件,重新放入waitQueue队列

- abortBrokenDispatchCycleLocked()方法最终会调用到Java层的IMS.notifyInputChannelBroken().

    
### 2.10  inputPublisher.publishKeyEvent
[-> InputTransport.cpp]

    status_t InputPublisher::publishKeyEvent(...) {
        if (!seq) {
            return BAD_VALUE;
        }

        InputMessage msg;
        msg.header.type = InputMessage::TYPE_KEY;
        msg.body.key.seq = seq;
        msg.body.key.deviceId = deviceId;
        msg.body.key.source = source;
        msg.body.key.action = action;
        msg.body.key.flags = flags;
        msg.body.key.keyCode = keyCode;
        msg.body.key.scanCode = scanCode;
        msg.body.key.metaState = metaState;
        msg.body.key.repeatCount = repeatCount;
        msg.body.key.downTime = downTime;
        msg.body.key.eventTime = eventTime;
        //通过InputChannel来发送消息[见小节2.11]
        return mChannel->sendMessage(&msg);
    }
    

### 2.111 doDispatchCycleFinishedLockedInterruptible

    void InputDispatcher::doDispatchCycleFinishedLockedInterruptible(
            CommandEntry* commandEntry) {
        sp<Connection> connection = commandEntry->connection;
        nsecs_t finishTime = commandEntry->eventTime;
        uint32_t seq = commandEntry->seq;
        bool handled = commandEntry->handled;

        DispatchEntry* dispatchEntry = connection->findWaitQueueEntry(seq);
        if (dispatchEntry) {
            nsecs_t eventDuration = finishTime - dispatchEntry->deliveryTime;
            if (eventDuration > SLOW_EVENT_PROCESSING_WARNING_TIMEOUT) {
                String8 msg;
                msg.appendFormat("Window '%s' spent %0.1fms processing the last input event: ",
                        connection->getWindowName(), eventDuration * 0.000001f);
                dispatchEntry->eventEntry->appendDescription(msg);
                ALOGI("%s", msg.string());
            }

            bool restartEvent;
            if (dispatchEntry->eventEntry->type == EventEntry::TYPE_KEY) {
                KeyEntry* keyEntry = static_cast<KeyEntry*>(dispatchEntry->eventEntry);
                restartEvent = afterKeyEventLockedInterruptible(connection,
                        dispatchEntry, keyEntry, handled);
            } else if (dispatchEntry->eventEntry->type == EventEntry::TYPE_MOTION) {
                MotionEntry* motionEntry = static_cast<MotionEntry*>(dispatchEntry->eventEntry);
                restartEvent = afterMotionEventLockedInterruptible(connection,
                        dispatchEntry, motionEntry, handled);
            } else {
                restartEvent = false;
            }

            if (dispatchEntry == connection->findWaitQueueEntry(seq)) {
                //从等待队列移除
                connection->waitQueue.dequeue(dispatchEntry);
                traceWaitQueueLengthLocked(connection);
                if (restartEvent && connection->status == Connection::STATUS_NORMAL) {
                    connection->outboundQueue.enqueueAtHead(dispatchEntry);
                    traceOutboundQueueLengthLocked(connection);
                } else {
                    releaseDispatchEntryLocked(dispatchEntry);
                }
            }

            // Start the next dispatch cycle for this connection.
            startDispatchCycleLocked(now(), connection);
        }
    }
    
    
## 三. InputChannel

Activity对应一个应用窗口, 每一个窗口对应一个ViewRootImpl.


### 3.1 setContentView
[-> Activity.java]

    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_account_bind);
        ...
    }

1. handleLaunchActivity()会调用Activity.onCreate(), 该方法内再调用setContentView(),经过AMS与WMS的各种交互,层层调用后,进入step2
2. handleResumeActivity()会调用Activity.makeVisible(),该方法继续调用便会执行到WindowManagerImpl.addView(),之后调用step 3;
3. WindowManagerGlobal.addView(),那么就从这里开始说起.

### 3.2 addView
[-> WindowManagerGlobal.java]

    public void addView(View view, ViewGroup.LayoutParams params,
            Display display, Window parentWindow) {
        ...
        //[见小节3.3]
        ViewRootImpl root = new ViewRootImpl(view.getContext(), display);
        root.setView(view, wparams, panelParentView);
        ...
    }

### 3.3 ViewRootImpl.setView
[-> ViewRootImpl.java]

    public ViewRootImpl(Context context, Display display) {
        mContext = context;
        mWindowSession = WindowManagerGlobal.getWindowSession();
        mDisplay = display;
        mThread = Thread.currentThread(); //主线程
        mWindow = new W(this);
        mChoreographer = Choreographer.getInstance();
        ...
    }
    
    public void setView(View view, WindowManager.LayoutParams attrs, View panelParentView) {
        synchronized (this) {
        ...
            if ((mWindowAttributes.inputFeatures
                & WindowManager.LayoutParams.INPUT_FEATURE_NO_INPUT_CHANNEL) == 0) {
                mInputChannel = new InputChannel(); //创建InputChannel对象
            }
            //将mInputChannel添加到WMS[见小节3.4]
            res = mWindowSession.addToDisplay(mWindow, mSeq, mWindowAttributes,
                        getHostVisibility(), mDisplay.getDisplayId(),
                        mAttachInfo.mContentInsets, mAttachInfo.mStableInsets,
                        mAttachInfo.mOutsets, mInputChannel);
            ...
            if (mInputChannel != null) {
                if (mInputQueueCallback != null) {
                    mInputQueue = new InputQueue();
                    mInputQueueCallback.onInputQueueCreated(mInputQueue);
                }
                //创建WindowInputEventReceiver对象[见]
                mInputEventReceiver = new WindowInputEventReceiver(mInputChannel,
                        Looper.myLooper());
            }
        }
    }

该方法主要功能:

1. 创建Java InputChannel对象
2. 将mInputChannel添加到WMS
3. 创建WindowInputEventReceiver对象

### 3.4 Session.addToDisplay
[-> Session.java]

    final class Session extends IWindowSession.Stub implements IBinder.DeathRecipient {

        public int add(IWindow window, int seq, WindowManager.LayoutParams attrs,
                int viewVisibility, Rect outContentInsets, Rect outStableInsets,
                InputChannel outInputChannel) {
            //[见小节3.5]
            return addToDisplay(window, seq, attrs, viewVisibility, Display.DEFAULT_DISPLAY,
                    outContentInsets, outStableInsets, null /* outOutsets */, outInputChannel);
        }
    }

### 3.5 WMS.addToDisplay
[-> WindowManagerService.java]

    public int addWindow(Session session, IWindow client, int seq,
               WindowManager.LayoutParams attrs, int viewVisibility, int displayId,
               Rect outContentInsets, Rect outStableInsets, Rect outOutsets,
               InputChannel outInputChannel) {
        ...
        //创建WindowState
        WindowState win = new WindowState(this, session, client, token,
                    attachedWindow, appOp[0], seq, attrs, viewVisibility, displayContent);
        if (outInputChannel != null && (attrs.inputFeatures
                & WindowManager.LayoutParams.INPUT_FEATURE_NO_INPUT_CHANNEL) == 0) {
             //根据WindowState的HashCode以及title来生成input管道名
            String name = win.makeInputChannelName();
            
            //创建一对InputChannel[见小节3.6]
            InputChannel[] inputChannels = InputChannel.openInputChannelPair(name);
            //将socket服务端保存到WindowState的mInputChannel
            win.setInputChannel(inputChannels[0]);
            //socket客户端传递给outInputChannel [见小节3.7]
            inputChannels[1].transferTo(outInputChannel);
            //[见小节3.8]
            mInputManager.registerInputChannel(win.mInputChannel, win.mInputWindowHandle);
        }
    }

#### 3.5.1 创建WindowState
[-> WindowState.java]

    WindowState(WindowManagerService service, Session s, IWindow c, WindowToken token,
           WindowState attachedWindow, int appOp, int seq, WindowManager.LayoutParams a,
           int viewVisibility, final DisplayContent displayContent) {
        ...
        WindowState appWin = this;
        while (appWin.mAttachedWindow != null) {
           appWin = appWin.mAttachedWindow;
        }
        WindowToken appToken = appWin.mToken;
        while (appToken.appWindowToken == null) {
           WindowToken parent = mService.mTokenMap.get(appToken.token);
           if (parent == null || appToken == parent) {
               break;
           }
           appToken = parent;
        }
        mAppToken = appToken.appWindowToken;
        mInputWindowHandle = new InputWindowHandle(
                mAppToken != null ? mAppToken.mInputApplicationHandle : null, this,
                displayContent.getDisplayId());
    }
    
### 3.6 创建socket pair

### 3.6.1  openInputChannelPair
[-> InputChannel.java]

    public static InputChannel[] openInputChannelPair(String name) {
        return nativeOpenInputChannelPair(name);
    }
    
这个过程的主要功能

1. 创建两个socket通道(非阻塞, buffer上限32KB)
2. 创建两个InputChannel对象;
3. 创建两个NativeInputChannel对象;
4. 将nativeInputChannel保存到Java层的InputChannel的成员变量mPtr
    
#### 3.6.2 nativeOpenInputChannelPair
[-> android_view_InputChannel.cpp]

    static jobjectArray android_view_InputChannel_nativeOpenInputChannelPair(JNIEnv* env,
            jclass clazz, jstring nameObj) {
        const char* nameChars = env->GetStringUTFChars(nameObj, NULL);
        String8 name(nameChars);
        env->ReleaseStringUTFChars(nameObj, nameChars);

        sp<InputChannel> serverChannel;
        sp<InputChannel> clientChannel;
        //创建一对socket[见小节3.6.3]
        status_t result = InputChannel::openInputChannelPair(name, serverChannel, clientChannel);

        //创建Java数组
        jobjectArray channelPair = env->NewObjectArray(2, gInputChannelClassInfo.clazz, NULL);
        ...

        //创建NativeInputChannel对象[见小节3.6.5]
        jobject serverChannelObj = android_view_InputChannel_createInputChannel(env,
                new NativeInputChannel(serverChannel));
        ...

        jobject clientChannelObj = android_view_InputChannel_createInputChannel(env,
                new NativeInputChannel(clientChannel));
        ...
        
        //将client和server 两个插入到channelPair
        env->SetObjectArrayElement(channelPair, 0, serverChannelObj);
        env->SetObjectArrayElement(channelPair, 1, clientChannelObj);
        return channelPair;
    }

#### 3.6.3 openInputChannelPair
[-> InputTransport.cpp]

    status_t InputChannel::openInputChannelPair(const String8& name,
            sp<InputChannel>& outServerChannel, sp<InputChannel>& outClientChannel) {
        int sockets[2];
        //真正创建socket对的地方
        if (socketpair(AF_UNIX, SOCK_SEQPACKET, 0, sockets)) {
            ...
            return result;
        }

        int bufferSize = SOCKET_BUFFER_SIZE; //32k
        setsockopt(sockets[0], SOL_SOCKET, SO_SNDBUF, &bufferSize, sizeof(bufferSize));
        setsockopt(sockets[0], SOL_SOCKET, SO_RCVBUF, &bufferSize, sizeof(bufferSize));
        setsockopt(sockets[1], SOL_SOCKET, SO_SNDBUF, &bufferSize, sizeof(bufferSize));
        setsockopt(sockets[1], SOL_SOCKET, SO_RCVBUF, &bufferSize, sizeof(bufferSize));

        String8 serverChannelName = name;
        serverChannelName.append(" (server)");
        //[见小节3.6.4]
        outServerChannel = new InputChannel(serverChannelName, sockets[0]);

        String8 clientChannelName = name;
        clientChannelName.append(" (client)");
        //[见小节3.6.4]
        outClientChannel = new InputChannel(clientChannelName, sockets[1]);
        return OK;
    }

该方法主要功能:

1. 创建socket pair; (非阻塞式的socket)
2. 设置两个socket的接收和发送的buffer上限为32KB;
3. 创建client和server的Native层InputChannel对象;


#### 3.6.4 InputChannel
[-> InputTransport.cpp]

    InputChannel::InputChannel(const String8& name, int fd) :
            mName(name), mFd(fd) {
        //将socket设置成非阻塞方式
        int result = fcntl(mFd, F_SETFL, O_NONBLOCK);
    }


#### 3.6.5 android_view_InputChannel_createInputChannel
[-> android_view_InputChannel.cpp]

    static jobject android_view_InputChannel_createInputChannel(JNIEnv* env,
            NativeInputChannel* nativeInputChannel) {
        //创建Java的InputChannel
        jobject inputChannelObj = env->NewObject(gInputChannelClassInfo.clazz,
                gInputChannelClassInfo.ctor);
        if (inputChannelObj) {
            //将nativeInputChannel保存到Java层的InputChannel的成员变量mPtr
            android_view_InputChannel_setNativeInputChannel(env, inputChannelObj, nativeInputChannel);
        }
        return inputChannelObj;
    }

    static void android_view_InputChannel_setNativeInputChannel(JNIEnv* env, jobject inputChannelObj,
            NativeInputChannel* nativeInputChannel) {
        env->SetLongField(inputChannelObj, gInputChannelClassInfo.mPtr,
                 reinterpret_cast<jlong>(nativeInputChannel));
    }
    
此处: 

- gInputChannelClassInfo.clazz是指Java层的InputChannel类
- gInputChannelClassInfo.ctor是指Java层的InputChannel构造方法;
- gInputChannelClassInfo.mPtr是指Java层的InputChannel的成员变量mPtr;

### 3.7 input通道转移

inputChannels[1].transferTo(outInputChannel)主要功能:

1. 当outInputChannel.mPtr不为空,则直接返回;否则进入step2;
2. 将inputChannels[1].mPtr的值赋给outInputChannel..mPtr;
3. 清空inputChannels[1].mPtr值;

#### 3.7.1 transferTo
[-> InputChannel.java]

    public void transferTo(InputChannel outParameter) {    
        nativeTransferTo(outParameter);
    }

#### 3.7.2 nativeTransferTo
[-> android_view_InputChannel.cpp]

    static void android_view_InputChannel_nativeTransferTo(JNIEnv* env, jobject obj,
            jobject otherObj) {
        
        if (android_view_InputChannel_getNativeInputChannel(env, otherObj) != NULL) {
            return; //当Java层的InputChannel.mPtr不为空,则返回
        }
        
        //将当前inputChannels[1]的mPtr赋值给nativeInputChannel
        NativeInputChannel* nativeInputChannel =
                android_view_InputChannel_getNativeInputChannel(env, obj);
        // 将该nativeInputChannel保存到outInputChannel的参数
        android_view_InputChannel_setNativeInputChannel(env, otherObj, nativeInputChannel);
        android_view_InputChannel_setNativeInputChannel(env, obj, NULL);
    }
    
    
    
### 3.8 注册inputChannel


#### 3.8.1 IMS.registerInputChannel
[-> InputManagerService.java]

    public void registerInputChannel(InputChannel inputChannel,
            InputWindowHandle inputWindowHandle) {
        nativeRegisterInputChannel(mPtr, inputChannel, inputWindowHandle, false);
    }

- inputChannel是指inputChannels[0],即
- inputWindowHandle是指WindowState.mInputWindowHandle;

#### 3.8.2 nativeRegisterInputChannel
[-> com_android_server_input_InputManagerService.cpp]

    static void nativeRegisterInputChannel(JNIEnv* env, jclass /* clazz */,
            jlong ptr, jobject inputChannelObj, jobject inputWindowHandleObj, jboolean monitor) {
        NativeInputManager* im = reinterpret_cast<NativeInputManager*>(ptr);

        sp<InputChannel> inputChannel = android_view_InputChannel_getInputChannel(env,
                inputChannelObj);

        sp<InputWindowHandle> inputWindowHandle =
                android_server_InputWindowHandle_getHandle(env, inputWindowHandleObj);
        
        //[见小节3.8.3]
        status_t status = im->registerInputChannel(
                env, inputChannel, inputWindowHandle, monitor);
        ...

        if (! monitor) {
            android_view_InputChannel_setDisposeCallback(env, inputChannelObj,
                    handleInputChannelDisposed, im);
        }
    }
    
#### 3.8.3 registerInputChannel
[-> com_android_server_input_InputManagerService.cpp]

    status_t NativeInputManager::registerInputChannel(JNIEnv* /* env */,
            const sp<InputChannel>& inputChannel,
            const sp<InputWindowHandle>& inputWindowHandle, bool monitor) {
        //[见小节3.8.4]
        return mInputManager->getDispatcher()->registerInputChannel(
                inputChannel, inputWindowHandle, monitor);
    }
    
mInputManager是指[NativeInputManager](http://gityuan.com/2016/12/10/input-manager/)初始化过程创建的InputManager对象.

#### 3.8.4 registerInputChannel
[-> InputDispatcher.cpp]

    status_t InputDispatcher::registerInputChannel(const sp<InputChannel>& inputChannel,
            const sp<InputWindowHandle>& inputWindowHandle, bool monitor) {
        { 
            AutoMutex _l(mLock);
            ...
            
            //创建Connection[见小节3.8.5]
            sp<Connection> connection = new Connection(inputChannel, inputWindowHandle, monitor);

            int fd = inputChannel->getFd();
            mConnectionsByFd.add(fd, connection);
            ...
            //将该fd添加到Looper监听[见小节3.8.6]
            mLooper->addFd(fd, 0, ALOOPER_EVENT_INPUT, handleReceiveCallback, this);
        }

        mLooper->wake(); //connection改变, 则唤醒looper
        return OK;
    }

将新创建的connection保存到mConnectionsByFd成员变量.

#### 3.8.5 Connection初始化
[-> InputDispatcher.cpp]

    InputDispatcher::Connection::Connection(const sp<InputChannel>& inputChannel,
            const sp<InputWindowHandle>& inputWindowHandle, bool monitor) :
            status(STATUS_NORMAL), inputChannel(inputChannel), inputWindowHandle(inputWindowHandle),
            monitor(monitor),
            inputPublisher(inputChannel), inputPublisherBlocked(false) {
    }


其中InputPublisher初始化位于文件InputTransport.cpp

    InputPublisher:: InputPublisher(const sp<InputChannel>& channel) :
            mChannel(channel) {
    }
    
#### 3.8.6 Looper.addFd
[-> system/core/libutils/Looper.cpp]

    int Looper::addFd(int fd, int ident, int events, Looper_callbackFunc callback, void* data) {
        // 此处的callback为handleReceiveCallback 
        return addFd(fd, ident, events, callback ? new SimpleLooperCallback(callback) : NULL, data);
    }

    int Looper::addFd(int fd, int ident, int events, const sp<LooperCallback>& callback, void* data) {
        {
            AutoMutex _l(mLock);
            Request request;
            request.fd = fd;
            request.ident = ident;
            request.events = events;
            request.seq = mNextRequestSeq++;
            request.callback = callback; //是指handleReceiveCallback 
            request.data = data;
            if (mNextRequestSeq == -1) mNextRequestSeq = 0; // reserve sequence number -1

            struct epoll_event eventItem;
            request.initEventItem(&eventItem);

            ssize_t requestIndex = mRequests.indexOfKey(fd);
            if (requestIndex < 0) {
                //通过epoll监听fd
                int epollResult = epoll_ctl(mEpollFd, EPOLL_CTL_ADD, fd, & eventItem);
                ...
                mRequests.add(fd, request); //该fd的request加入到mRequests队列
            } else {
                int epollResult = epoll_ctl(mEpollFd, EPOLL_CTL_MOD, fd, & eventItem);
                ...
                mRequests.replaceValueAt(requestIndex, request);
            }
        } 
        return 1;
    }

[Android消息机制](http://gityuan.com/2015/12/27/handler-message-native/)在获取下一条消息的时候,会调用lnativePollOnce(),最终进入到Looper::pollInner()过程.



## 四. 总结

Server端的InputChannel注册到InputDispatcher
Client端的InputChannel返回给ViewRootImpl

未整理完成...