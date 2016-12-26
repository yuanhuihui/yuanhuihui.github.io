---
layout: post
title:  "输入系统之InputDispatcher"
date:   2016-12-17 22:19:12
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析InputManagerService的启动过程


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
                //当mCommandQueue不为空，开始处理【见小节2.2】
                dispatchOnceInnerLocked(&nextWakeupTime);
            }

            //【见小节2.4】
            if (runCommandsLockedInterruptible()) {
                nextWakeupTime = LONG_LONG_MIN;
            }
        }

        nsecs_t currentTime = now();
        int timeoutMillis = toMillisecondTimeoutDelay(currentTime, nextWakeupTime);
        mLooper->pollOnce(timeoutMillis); //进入epoll_wait
    }

该方法主要功能：

1. 调用dispatchOnceInnerLocked()
2. 

退出epoll_wait有3种情况：

1. callback：通过回调方法来唤醒；
2. timeout：到达nextWakeupTime时间，超时唤醒；
3. wake: 主动调用Looper的wake()方法；

## 二. InputDispatcher

#### 2.1 haveCommandsLocked

    bool InputDispatcher::haveCommandsLocked() const {
        return !mCommandQueue.isEmpty();
    }

#### 2.2 dispatchOnceInnerLocked

    void InputDispatcher::dispatchOnceInnerLocked(nsecs_t* nextWakeupTime) {
        nsecs_t currentTime = now();

        if (!mDispatchEnabled) { //初始值为false
            //
            resetKeyRepeatLocked();
        }

        if (mDispatchFrozen) {
            return; //当分发被冻结，则不再处理超时和分发事件的工作，直接返回
        }

        //优化app切换延迟，当切换超时，则抢占分发，丢弃其他所有即将要处理的事件。
        bool isAppSwitchDue = mAppSwitchDueTime <= currentTime;
        if (mAppSwitchDueTime < *nextWakeupTime) {
            *nextWakeupTime = mAppSwitchDueTime;
        }

        //准备开始一个新事件
        if (! mPendingEvent) {
            if (mInboundQueue.isEmpty()) {
                if (isAppSwitchDue) {
                    //当超时500ms，
                     The inbound queue is empty so the app switch key we were waiting
                    // for will never arrive.  Stop waiting for it.
                    resetPendingAppSwitchLocked(false);
                    isAppSwitchDue = false;
                }

                // Synthesize a key repeat if appropriate.
                if (mKeyRepeatState.lastKeyEntry) {
                    if (currentTime >= mKeyRepeatState.nextRepeatTime) {
                        mPendingEvent = synthesizeKeyRepeatLocked(currentTime);
                    } else {
                        if (mKeyRepeatState.nextRepeatTime < *nextWakeupTime) {
                            *nextWakeupTime = mKeyRepeatState.nextRepeatTime;
                        }
                    }
                }

                // Nothing to do if there is no pending event.
                if (!mPendingEvent) {
                    return;
                }
            } else {
                // Inbound queue has at least one entry.
                mPendingEvent = mInboundQueue.dequeueAtHead();
                traceInboundQueueLengthLocked();
            }

            // Poke user activity for this event.
            if (mPendingEvent->policyFlags & POLICY_FLAG_PASS_TO_USER) {
                pokeUserActivityLocked(mPendingEvent);
            }

            // Get ready to dispatch the event.
            resetANRTimeoutsLocked();
        }

        // Now we have an event to dispatch.
        // All events are eventually dequeued and processed this way, even if we intend to drop them.
        bool done = false;
        DropReason dropReason = DROP_REASON_NOT_DROPPED;
        if (!(mPendingEvent->policyFlags & POLICY_FLAG_PASS_TO_USER)) {
            dropReason = DROP_REASON_POLICY;
        } else if (!mDispatchEnabled) {
            dropReason = DROP_REASON_DISABLED;
        }

        if (mNextUnblockedEvent == mPendingEvent) {
            mNextUnblockedEvent = NULL;
        }

        switch (mPendingEvent->type) {
        case EventEntry::TYPE_CONFIGURATION_CHANGED: {
            ConfigurationChangedEntry* typedEntry =
                    static_cast<ConfigurationChangedEntry*>(mPendingEvent);
            done = dispatchConfigurationChangedLocked(currentTime, typedEntry);
            dropReason = DROP_REASON_NOT_DROPPED; // configuration changes are never dropped
            break;
        }

        case EventEntry::TYPE_DEVICE_RESET: {
            DeviceResetEntry* typedEntry =
                    static_cast<DeviceResetEntry*>(mPendingEvent);
            done = dispatchDeviceResetLocked(currentTime, typedEntry);
            dropReason = DROP_REASON_NOT_DROPPED; // device resets are never dropped
            break;
        }

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
            done = dispatchMotionLocked(currentTime, typedEntry,
                    &dropReason, nextWakeupTime);
            break;
        }

        default:
            ALOG_ASSERT(false);
            break;
        }

        if (done) {
            if (dropReason != DROP_REASON_NOT_DROPPED) {
                dropInboundEventLocked(mPendingEvent, dropReason);
            }
            mLastDropReason = dropReason;

            releasePendingEventLocked();
            *nextWakeupTime = LONG_LONG_MIN;  // force next poll to wake up immediately
        }
    }

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

            Command command = commandEntry->command;
            (this->*command)(commandEntry); // commands are implicitly 'LockedInterruptible'

            commandEntry->connection.clear();
            delete commandEntry;
        } while (! mCommandQueue.isEmpty());
        return true;
    }

#### 3.2 postCommandLocked

    InputDispatcher::CommandEntry* InputDispatcher::postCommandLocked(Command command) {
        CommandEntry* commandEntry = new CommandEntry(command);
        // 将命令实体加入mCommandQueue队列的尾部
        mCommandQueue.enqueueAtTail(commandEntry);
        return commandEntry;
    }
