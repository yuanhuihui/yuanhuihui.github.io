---
layout: post
title:  "Input系统—InputDispatcher线程"
date:   2016-12-17 22:19:12
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析InputManagerService的启动过程

    frameworks/base/services/core/java/com/android/server/input/InputManagerService.java
    frameworks/base/services/core/jni/com_android_server_input_InputManagerService.cpp
    frameworks/native/services/inputflinger/InputDispatcher.cpp
    frameworks/native/include/android/input.h
    frameworks/native/include/input/InputTransport.h
    frameworks/native/libs/input/InputTransport.cpp
    
## 一. InputDispatcher起点

上篇文章[输入系统之InputReader线程](http://gityuan.com/2016/12/11/input-reader/)，介绍InputReader利用EventHub获取数据后生成EventEntry事件，加入到InputDispatcher的mInboundQueue队列，再唤醒InputDispatcher线程。本文将介绍
InputDispatcher，同样从threadLoop为起点开始分析。

#### 1.1 InputDispatcher执行流
整体调用链：

    InputDispatcherThread.threadLoop
      InputDispatcher.dispatchOnce
        InputDispatcher.dispatchOnceInnerLocked
        runCommandsLockedInterruptible
        Looper->pollOnce
        
先来回顾一下InputDispatcher对象的初始化过程:

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

#### 1.2 threadLoop
[-> InputDispatcher.cpp]

    bool InputDispatcherThread::threadLoop() {
        mDispatcher->dispatchOnce(); //【见小节1.3】
        return true;
    }

整个过程不断循环地调用InputDispatcher的dispatchOnce()来分发事件

#### 1.3 dispatchOnce
[-> InputDispatcher.cpp]

    void InputDispatcher::dispatchOnce() {
        nsecs_t nextWakeupTime = LONG_LONG_MAX;
        {
            AutoMutex _l(mLock);
            //唤醒等待线程，monitor()用于监控dispatcher是否发生死锁
            mDispatcherIsAliveCondition.broadcast();

            
            if (!haveCommandsLocked()) {
                //当mCommandQueue不为空时处理【见小节2.1】
                dispatchOnceInnerLocked(&nextWakeupTime);
            }

            //【见小节3.1】
            if (runCommandsLockedInterruptible()) {
                nextWakeupTime = LONG_LONG_MIN;
            }
        }

        nsecs_t currentTime = now();
        int timeoutMillis = toMillisecondTimeoutDelay(currentTime, nextWakeupTime);
        mLooper->pollOnce(timeoutMillis); //进入epoll_wait
    }

线程执行Looper->pollOnce，进入epoll_wait等待状态，当发生以下任一情况则退出等待状态：

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
        ...

        if (!mPendingEvent) {
            if (mInboundQueue.isEmpty()) {
                ...
                if (!mPendingEvent) {
                    return; //没有事件需要处理，则直接返回
                }
            } else {
                //从mInboundQueue取出头部的事件【重点】
                mPendingEvent = mInboundQueue.dequeueAtHead();
            }
            resetANRTimeoutsLocked(); //重置ANR信息
        }
        ...

        switch (mPendingEvent->type) {
          case EventEntry::TYPE_KEY: {
              KeyEntry* typedEntry = static_cast<KeyEntry*>(mPendingEvent);
              ...
              // 分发按键事件[见小节2.2]
              done = dispatchKeyLocked(currentTime, typedEntry, &dropReason, nextWakeupTime);
              break;
          }
          ...
        }
        
        if (done) { //分发操作完成，则进入该分支
            ...
            releasePendingEventLocked(); //释放pending事件[2.10]
            *nextWakeupTime = LONG_LONG_MIN; //强制立刻执行轮询
        }
    }

该方法主要功能:

-  mDispatchFrozen: 决定是否冻结事件分发工作不再往下执行;
  - 当mDispatchFrozen == true，则不再分发；
-  mPendingEvent：决定是否需要再取一次事件，从mInboundQueue头部取出事件,放入mPendingEvent变量;并重置ANR时间;
  - 当mPendingEvent为空，则不再分发；
- 根据EventEntry的type类型分别处理:
    - TYPE_KEY: 则调用dispatchKeyLocked分发事件;
    - TYPE_MOTION: 则调用dispatchMotionLocked分发事件;

接下来以按键为例来展开说明, 则进入[小节2.2]dispatchKeyLocked。

### 2.2 dispatchKeyLocked

    bool InputDispatcher::dispatchKeyLocked(nsecs_t currentTime, KeyEntry* entry,
            DropReason* dropReason, nsecs_t* nextWakeupTime) {
        ...
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
            }
        }
        ...
        //获取目标聚焦窗口【见小节2.3】
        Vector<InputTarget> inputTargets;
        int32_t injectionResult = findFocusedWindowTargetsLocked(currentTime,
                entry, inputTargets, nextWakeupTime);
                
        ...
        if (injectionResult == INPUT_EVENT_INJECTION_PENDING) {
            return false;
        }

        setInjectionResultLocked(entry, injectionResult);
        if (injectionResult != INPUT_EVENT_INJECTION_SUCCEEDED) {
            return true;
        }
        
        //只有injectionResult成功，才有机会执行分发事件【见小节2.4】
        dispatchEventLocked(currentTime, entry, inputTargets);
        return true;
    }
    
先找到当前focused目标窗口，则将事件分发该目标窗口；

### 2.3 findFocusedWindowTargetsLocked

    int32_t InputDispatcher::findFocusedWindowTargetsLocked(nsecs_t currentTime,
            const EventEntry* entry, Vector<InputTarget>& inputTargets, nsecs_t* nextWakeupTime) {
        ...
        //成功找到目标窗口，添加到目标窗口【见小节2.3.1】
        injectionResult = INPUT_EVENT_INJECTION_SUCCEEDED;
        addWindowTargetLocked(mFocusedWindowHandle,
                InputTarget::FLAG_FOREGROUND | InputTarget::FLAG_DISPATCH_AS_IS, BitSet32(0),
                inputTargets);
        ...
        return injectionResult;
    }
    
mFocusedWindowHandle是何处赋值呢？是在InputDispatcher.setInputWindows()方法，具体见下一篇文章[Input系统—UI线程]()

#### 2.3.1 addWindowTargetLocked

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

### 2.4 dispatchEventLocked

    void InputDispatcher::dispatchEventLocked(nsecs_t currentTime,
            EventEntry* eventEntry, const Vector<InputTarget>& inputTargets) {
        //【见小节2.4.1】向mCommandQueue队列添加doPokeUserActivityLockedInterruptible命令
        pokeUserActivityLocked(eventEntry);

        for (size_t i = 0; i < inputTargets.size(); i++) {
            const InputTarget& inputTarget = inputTargets.itemAt(i);
            //[见小节2.4.3]
            ssize_t connectionIndex = getConnectionIndexLocked(inputTarget.inputChannel);
            if (connectionIndex >= 0) {
                sp<Connection> connection = mConnectionsByFd.valueAt(connectionIndex);
                //找到目标连接[见小节２.5]
                prepareDispatchCycleLocked(currentTime, connection, eventEntry, &inputTarget);
            }
        }
    }

该方法主要功能是将eventEntry发送到目标inputTargets．

其中pokeUserActivityLocked(eventEntry)方法最终会调用到Java层的PowerManagerService.java中的`userActivityFromNative()`方法．
这也是PMS中唯一的native call方法．

#### 2.4.1  pokeUserActivityLocked

    void InputDispatcher::pokeUserActivityLocked(const EventEntry* eventEntry) {
        if (mFocusedWindowHandle != NULL) {
            const InputWindowInfo* info = mFocusedWindowHandle->getInfo();
            if (info->inputFeatures & InputWindowInfo::INPUT_FEATURE_DISABLE_USER_ACTIVITY) {
                return;
            }
        }
        ...
        //【见小节2.4.2】
        CommandEntry* commandEntry = postCommandLocked(
                & InputDispatcher::doPokeUserActivityLockedInterruptible);
        commandEntry->eventTime = eventEntry->eventTime;
        commandEntry->userActivityEventType = eventType;
    }
    
#### 2.4.2 postCommandLocked

    InputDispatcher::CommandEntry* InputDispatcher::postCommandLocked(Command command) {
        CommandEntry* commandEntry = new CommandEntry(command);
        // 将命令加入mCommandQueue队尾
        mCommandQueue.enqueueAtTail(commandEntry);
        return commandEntry;
    }
    
#### 2.4.3 getConnectionIndexLocked

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

根据inputChannel的fd从`mConnectionsByFd`队列中查询目标connection.

### 2.5 prepareDispatchCycleLocked

    void InputDispatcher::prepareDispatchCycleLocked(nsecs_t currentTime,
            const sp<Connection>& connection, EventEntry* eventEntry, const InputTarget* inputTarget) {

        if (connection->status != Connection::STATUS_NORMAL) {
            return;　//当连接已破坏,则直接返回
        }
        ...
        
        //[见小节2.6] 
        enqueueDispatchEntriesLocked(currentTime, connection, eventEntry, inputTarget);
    }

当connection状态不正确，则直接返回。

### 2.6 enqueueDispatchEntriesLocked

    void InputDispatcher::enqueueDispatchEntriesLocked(nsecs_t currentTime,
            const sp<Connection>& connection, EventEntry* eventEntry, const InputTarget* inputTarget) {
        bool wasEmpty = connection->outboundQueue.isEmpty();

        //[见小节2.7]
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
            //当原先的outbound队列为空, 且当前outbound不为空的情况执行.[见小节2.8]
            startDispatchCycleLocked(currentTime, connection);
        }
    }

该方法主要功能：

- 根据dispatchMode来分别执行DispatchEntry事件加入队列的操作。
- 当起初connection.outboundQueue等于空, 经enqueueDispatchEntryLocked处理后, outboundQueue不等于空情况下,
则执行startDispatchCycleLocked()方法.

### 2.7 enqueueDispatchEntryLocked

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
            ...
        }
        ...

        //添加到outboundQueue队尾
        connection->outboundQueue.enqueueAtTail(dispatchEntry);
    }
    
该方法主要功能:

- 根据dispatchMode来决定是否需要加入outboundQueue队列;
- 根据EventEntry,来生成DispatchEntry事件;
- 将dispatchEntry加入到connection的outbound队列.

执行到这里,其实等于由做了一次搬运的工作,将InputDispatcher中mInboundQueue中的事件取出后, 
找到目标window后,封装dispatchEntry加入到connection的outbound队列. 

### 2.8 startDispatchCycleLocked

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

                  //发布Key事件 [见小节2.9]
                  status = connection->inputPublisher.publishKeyEvent(dispatchEntry->seq,
                          keyEntry->deviceId, keyEntry->source,
                          dispatchEntry->resolvedAction, dispatchEntry->resolvedFlags,
                          keyEntry->keyCode, keyEntry->scanCode,
                          keyEntry->metaState, keyEntry->repeatCount, keyEntry->downTime,
                          keyEntry->eventTime);
                  break;
              }
              ...
            }

            if (status) { //publishKeyEvent失败情况
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

- startDispatchCycleLocked触发时机：当起初connection.outboundQueue等于空, 经enqueueDispatchEntryLocked处理后, outboundQueue不等于空。
- startDispatchCycleLocked主要功能: 从outboundQueue中取出事件,重新放入waitQueue队列
- publishKeyEvent执行结果status不等于OK的情况下：
  - WOULD_BLOCK，且waitQueue等于空，则调用abortBrokenDispatchCycleLocked()，该方法最终会调用到Java层的IMS.notifyInputChannelBroken().
  - WOULD_BLOCK，且waitQueue不等于空，则处于阻塞状态，即inputPublisherBlocked=true
  - 其他情况，则调用abortBrokenDispatchCycleLocked
    
### 2.9  inputPublisher.publishKeyEvent
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
        //通过InputChannel来发送消息
        return mChannel->sendMessage(&msg);
    }
    
InputChannel通过socket向远端的socket发送消息。socket通道是如何建立的呢？
InputDispatcher又是如何与前台的window通信的呢？ 见下一篇文章[]()

### 2.10 releasePendingEventLocked

    void InputDispatcher::releasePendingEventLocked() {
        if (mPendingEvent) {
            resetANRTimeoutsLocked(); //重置ANR超时时间
            releaseInboundEventLocked(mPendingEvent); //释放mPendingEvent对象,并记录到mRecentQueue队列
            mPendingEvent = NULL; //置空mPendingEvent变量.
        }
    }

## 三. 处理Comand

### 3.1 runCommandsLockedInterruptible

    bool InputDispatcher::runCommandsLockedInterruptible() {
        if (mCommandQueue.isEmpty()) {
            return false;
        }

        do {
            //从mCommandQueue队列的头部取出第一个元素
            CommandEntry* commandEntry = mCommandQueue.dequeueAtHead();

            Command command = commandEntry->command;
            //此处调用的命令隐式地包含'LockedInterruptible' 
            (this->*command)(commandEntry); 

            commandEntry->connection.clear();
            delete commandEntry;
        } while (! mCommandQueue.isEmpty());
        return true;
    }

通过循环方式处理完mCommandQueue队列的所有命令，处理过程从mCommandQueue中取出CommandEntry.

    typedef void (InputDispatcher::*Command)(CommandEntry* commandEntry);
    struct CommandEntry : Link<CommandEntry> {
        CommandEntry(Command command);
      
        Command command;
        sp<Connection> connection;
        nsecs_t eventTime;
        KeyEntry* keyEntry;
        sp<InputApplicationHandle> inputApplicationHandle;
        sp<InputWindowHandle> inputWindowHandle;
        String8 reason;
        int32_t userActivityEventType;
        uint32_t seq;
        bool handled;
    };

前面小节【2.4.1】添加的doPokeUserActivityLockedInterruptible命令. 接下来进入该方法：

### 3.2 doPokeUserActivityLockedInterruptible
[-> InputDispatcher]

    void InputDispatcher::doPokeUserActivityLockedInterruptible(CommandEntry* commandEntry) {
        mLock.unlock();
        //【见小节4.3】
        mPolicy->pokeUserActivity(commandEntry->eventTime, commandEntry->userActivityEventType);

        mLock.lock();
    }

### 3.3 pokeUserActivity
[-> com_android_server_input_InputManagerService.cpp]

    void NativeInputManager::pokeUserActivity(nsecs_t eventTime, int32_t eventType) {
        //[见小节4.4]
        android_server_PowerManagerService_userActivity(eventTime, eventType);
    }

### 3.4 android_server_PowerManagerService_userActivity
[-> com_android_server_power_PowerManagerService.cpp]

    void android_server_PowerManagerService_userActivity(nsecs_t eventTime, int32_t eventType) {
        // Tell the power HAL when user activity occurs.
        if (gPowerModule && gPowerModule->powerHint) {
            gPowerModule->powerHint(gPowerModule, POWER_HINT_INTERACTION, NULL);
        }

        if (gPowerManagerServiceObj) {
            ...
            //[见小节4.5]
            env->CallVoidMethod(gPowerManagerServiceObj,
                    gPowerManagerServiceClassInfo.userActivityFromNative,
                    nanoseconds_to_milliseconds(eventTime), eventType, 0);
        }
    }

### 3.5 PMS.userActivityFromNative
[-> PowerManagerService.java]

    private void userActivityFromNative(long eventTime, int event, int flags) {
        userActivityInternal(eventTime, event, flags, Process.SYSTEM_UID);
    }

    private void userActivityInternal(long eventTime, int event, int flags, int uid) {
        synchronized (mLock) {
            if (userActivityNoUpdateLocked(eventTime, event, flags, uid)) {
                updatePowerStateLocked();
            }
        }
    }
    
runCommandsLockedInterruptible是不断地从mCommandQueue队列取出命令，然后执行直到全部执行完成。 除了doPokeUserActivityLockedInterruptible，还有其他如下命令：

- doNotifyANRLockedInterruptible
- doInterceptKeyBeforeDispatchingLockedInterruptible
- doDispatchCycleFinishedLockedInterruptible
- doNotifyInputChannelBrokenLockedInterruptible
- doNotifyConfigurationChangedInterruptible

## 四. 总结

用一张图来整体概况InputDispatcher线程的主要工作：

![input_dispatcher](/images/input/input_dispatcher.jpg)

1. dispatchOnceInnerLocked(): 从InputDispatcher的`mInboundQueue`队列，取出事件EventEntry。另外该方法开始执行的时间点(currentTime)便是后续事件dispatchEntry的分发时间(deliveryTime）
2. dispatchKeyLocked()：满足一定条件时会添加命令doInterceptKeyBeforeDispatchingLockedInterruptible；
3. enqueueDispatchEntryLocked()：生成事件DispatchEntry并加入connection的`outbound`队列
4. startDispatchCycleLocked()：从outboundQueue中取出事件DispatchEntry, 重新放入connection的`waitQueue`队列；
5. InputChannel.sendMessage通过socket方式将消息发送给远程进程；
6. runCommandsLockedInterruptible()：通过循环遍历地方式，依次处理mCommandQueue队列中的所有命令。而mCommandQueue队列中的命令是通过postCommandLocked()方式向该队列添加的。
