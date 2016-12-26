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
        ...
        {
            AutoMutex _l(mLock);
            uint32_t changes = mConfigurationChangesToRefresh;
            if (changes) {
                timeoutMillis = 0;
                ...
            } else if (mNextTimeout != LLONG_MAX) {
                nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
                timeoutMillis = toMillisecondTimeoutDelay(now, mNextTimeout);
            }
        }

        //从EventHub读取事件，其中EVENT_BUFFER_SIZE = 256【见小节2.3】
        size_t count = mEventHub->getEvents(timeoutMillis, mEventBuffer, EVENT_BUFFER_SIZE);
        
        { // acquire lock
            AutoMutex _l(mLock);
            if (count) { //处理事件【见小节2.8】
                processEventsLocked(mEventBuffer, count);
            }
            if (oldGeneration != mGeneration) {
                inputDevicesChanged = true;
                getInputDevicesLocked(inputDevices);
            }
            ...
        } // release lock

        
        if (inputDevicesChanged) { //输入设备发生改变
            mPolicy->notifyInputDevicesChanged(inputDevices);
        }
        //发送事件到nputDispatcher【见小节2.6】
        mQueuedListener->flush();
    }

该方法主要功能：

1. 调用getEvents()从EventHub读取事件
2. 调用processEventsLocked()来处理事件；
2. 调用QueuedListener->flush()，发送事件到InputDispatcher线程；

另外，整个过程还会检测配置是否改变，输出设备是否改变，如果改变则调用policy来通知。

### 2.3 getEvents
[-> EventHub.cpp]

    size_t EventHub::getEvents(int timeoutMillis, RawEvent* buffer, size_t bufferSize) {
        AutoMutex _l(mLock); //加锁

        struct input_event readBuffer[bufferSize];
        RawEvent* event = buffer; //原始事件
        size_t capacity = bufferSize; //容量大小为256
        bool awoken = false;
        for (;;) {
            nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
            ...
            while (mClosingDevices) {
                ...
            }

            if (mNeedToScanDevices) {
                mNeedToScanDevices = false;
                scanDevicesLocked(); //扫描设备【见小节2.4】
                mNeedToSendFinishedDeviceScan = true;
            }

            while (mOpeningDevices != NULL) {
                Device* device = mOpeningDevices;
                mOpeningDevices = device->next;
                event->when = now;
                event->deviceId = device->id == mBuiltInKeyboardId ? 0 : device->id;
                event->type = DEVICE_ADDED; //添加设备的事件
                event += 1;
                mNeedToSendFinishedDeviceScan = true;
                if (--capacity == 0) {
                    break;
                }
            }
            ...

            bool deviceChanged = false;
            while (mPendingEventIndex < mPendingEventCount) {
                const struct epoll_event& eventItem = mPendingEventItems[mPendingEventIndex++];
                if (eventItem.data.u32 == EPOLL_ID_INOTIFY) {
                    ...
                    continue;
                }
                if (eventItem.data.u32 == EPOLL_ID_WAKE) {
                    ...
                    continue;
                }
                //获取设备ID所对应的device
                ssize_t deviceIndex = mDevices.indexOfKey(eventItem.data.u32);
                Device* device = mDevices.valueAt(deviceIndex);
                if (eventItem.events & EPOLLIN) {
                    //从设备不断读取事件，放入到readBuffer
                    int32_t readSize = read(device->fd, readBuffer,
                            sizeof(struct input_event) * capacity);
                    if (readSize == 0 || (readSize < 0 && errno == ENODEV)) {
                        deviceChanged = true; 
                        closeDeviceLocked(device);//设备已被移除则执行关闭操作
                    } else if (readSize < 0) {
                        ...
                    } else if ((readSize % sizeof(struct input_event)) != 0) {
                        ...
                    } else {
                        int32_t deviceId = device->id == mBuiltInKeyboardId ? 0 : device->id;
                        size_t count = size_t(readSize) / sizeof(struct input_event);
                        
                        for (size_t i = 0; i < count; i++) {
                            struct input_event& iev = readBuffer[i];
                            ...
                            event->when = nsecs_t(iev.time.tv_sec) * 1000000000LL
                                    + nsecs_t(iev.time.tv_usec) * 1000LL;
                            event->deviceId = deviceId;
                            event->type = iev.type;
                            event->code = iev.code;
                            event->value = iev.value;
                            event += 1;
                            capacity -= 1;
                        }
                        if (capacity == 0) {
                            mPendingEventIndex -= 1;
                            break;
                        }
                    }
                }
                ...
            }
            ...

            //立刻报告设备增加或移除事件
            if (deviceChanged) {
                continue;
            }

            if (event != buffer || awoken) {
                break;
            }
            mPendingEventIndex = 0;

            mLock.unlock(); //poll之前先释放锁
            release_wake_lock(WAKE_LOCK_ID);
            //等待input事件的到来
            int pollResult = epoll_wait(mEpollFd, mPendingEventItems, EPOLL_MAX_EVENTS, timeoutMillis);

            acquire_wake_lock(PARTIAL_WAKE_LOCK, WAKE_LOCK_ID);
            mLock.lock(); //poll之后再次请求锁

            
            if (pollResult < 0) {
                //出现错误
                mPendingEventCount = 0;
                if (errno != EINTR) {
                    usleep(100000); //系统发生错误，则休眠1s
                }
            } else {
                mPendingEventCount = size_t(pollResult);
            }
        }

        //返回所读取的事件个数
        return event - buffer;
    }
    
EventHub采用INotify + epoll机制实现监听目录/dev/input下的备节点，从而获取输入事件RawEvent

### 2.4 scanDevicesLocked

    void EventHub::scanDevicesLocked() {
        //【见小节2.5】
        status_t res = scanDirLocked(DEVICE_PATH);
        ...
    }
此处DEVICE_PATH="/dev/input" 

### 2.5 scanDirLocked

    status_t EventHub::scanDirLocked(const char *dirname)
    {
        char devname[PATH_MAX];
        char *filename;
        DIR *dir;
        struct dirent *de;
        dir = opendir(dirname);
        
        strcpy(devname, dirname);
        filename = devname + strlen(devname);
        *filename++ = '/';
        //读取/dev/input/目录下所有的设备节点
        while((de = readdir(dir))) {
            if(de->d_name[0] == '.' &&
               (de->d_name[1] == '\0' ||
                (de->d_name[1] == '.' && de->d_name[2] == '\0')))
                continue;
            strcpy(filename, de->d_name);
            //打开相应的设备节点【2.6】
            openDeviceLocked(devname);
        }
        closedir(dir);
        return 0;
    }

### 2.6 openDeviceLocked

    status_t EventHub::openDeviceLocked(const char *devicePath) {
        char buffer[80];
        //打开设备文件
        int fd = open(devicePath, O_RDWR | O_CLOEXEC);
        InputDeviceIdentifier identifier;
        //获取设备名
        if(ioctl(fd, EVIOCGNAME(sizeof(buffer) - 1), &buffer) < 1){
        } else {
            buffer[sizeof(buffer) - 1] = '\0';
            identifier.name.setTo(buffer);
        }
        
        identifier.bus = inputId.bustype;
        identifier.product = inputId.product;
        identifier.vendor = inputId.vendor;
        identifier.version = inputId.version;
        
        //获取设备物理地址
        if(ioctl(fd, EVIOCGPHYS(sizeof(buffer) - 1), &buffer) < 1) {
        } else {
            buffer[sizeof(buffer) - 1] = '\0';
            identifier.location.setTo(buffer);
        }

        //获取设备唯一ID
        if(ioctl(fd, EVIOCGUNIQ(sizeof(buffer) - 1), &buffer) < 1) {
        } else {
            buffer[sizeof(buffer) - 1] = '\0';
            identifier.uniqueId.setTo(buffer);
        }
        //将identifier信息填充到fd
        assignDescriptorLocked(identifier);
        //设置fd为非阻塞方式
        fcntl(fd, F_SETFL, O_NONBLOCK);
        
        //获取设备ID，分配设备对象内存
        int32_t deviceId = mNextDeviceId++;
        Device* device = new Device(fd, deviceId, String8(devicePath), identifier);
        ...
        
        //注册epoll
        struct epoll_event eventItem;
        memset(&eventItem, 0, sizeof(eventItem));
        eventItem.events = EPOLLIN;
        if (mUsingEpollWakeup) {
            eventItem.events |= EPOLLWAKEUP;
        }
        eventItem.data.u32 = deviceId;
        if (epoll_ctl(mEpollFd, EPOLL_CTL_ADD, fd, &eventItem)) {
            delete device; //添加失败则删除该设备
            return -1;
        }
        ...
        //【见小节2.7】
        addDeviceLocked(device);
    }

### 2.7 addDeviceLocked

    void EventHub::addDeviceLocked(Device* device) {
        mDevices.add(device->id, device);
        device->next = mOpeningDevices;
        mOpeningDevices = device;
    }

前面小节[2.3-2.7]介绍了EventHub从设备节点获取事件的流程，当收到事件后接下里便进入事件处理过程。
    
### 2.8 processEventsLocked
[-> InputReader.cpp]

    void InputReader::processEventsLocked(const RawEvent* rawEvents, size_t count) {
        for (const RawEvent* rawEvent = rawEvents; count;) {
            int32_t type = rawEvent->type;
            size_t batchSize = 1;
            if (type < EventHubInterface::FIRST_SYNTHETIC_EVENT) {
                int32_t deviceId = rawEvent->deviceId;
                while (batchSize < count) {
                    if (rawEvent[batchSize].type >= EventHubInterface::FIRST_SYNTHETIC_EVENT
                            || rawEvent[batchSize].deviceId != deviceId) {
                        break;
                    }
                    batchSize += 1; //同一设备的事件打包处理
                }
                // 【见小节2.11】
                processEventsForDeviceLocked(deviceId, rawEvent, batchSize);
            } else {
                switch (rawEvent->type) {
                case EventHubInterface::DEVICE_ADDED:
                    //【见小节2.9】
                    addDeviceLocked(rawEvent->when, rawEvent->deviceId);
                    break;
                case EventHubInterface::DEVICE_REMOVED:
                    removeDeviceLocked(rawEvent->when, rawEvent->deviceId);
                    break;
                case EventHubInterface::FINISHED_DEVICE_SCAN:
                    handleConfigurationChangedLocked(rawEvent->when);
                    break;
                default:
                    ALOG_ASSERT(false);//不会发生
                    break;
                }
            }
            count -= batchSize;
            rawEvent += batchSize;
        }
    }

事件处理总共哟以下几类类型：

- DEVICE_ADDED(设备增加)
- DEVICE_REMOVED(设备移除)
- FINISHED_DEVICE_SCAN(设备扫描完成)
- 数据事件

先来说说DEVICE_ADDED设备增加的过程。

### 2.9 addDeviceLocked

    void InputReader::addDeviceLocked(nsecs_t when, int32_t deviceId) {
        ssize_t deviceIndex = mDevices.indexOfKey(deviceId);
        if (deviceIndex >= 0) {
            //已添加的相同设备则不再添加
            return;
        }

        InputDeviceIdentifier identifier = mEventHub->getDeviceIdentifier(deviceId);
        uint32_t classes = mEventHub->getDeviceClasses(deviceId);
        int32_t controllerNumber = mEventHub->getDeviceControllerNumber(deviceId);
        //【见小节2.10】
        InputDevice* device = createDeviceLocked(deviceId, controllerNumber, identifier, classes);
        device->configure(when, &mConfig, 0);
        device->reset(when);

        mDevices.add(deviceId, device);
        bumpGenerationLocked();
        ...
    }

### 2.10 createDeviceLocked

    InputDevice* InputReader::createDeviceLocked(int32_t deviceId, int32_t controllerNumber,
            const InputDeviceIdentifier& identifier, uint32_t classes) {
        //创建InputDevice对象
        InputDevice* device = new InputDevice(&mContext, deviceId, bumpGenerationLocked(),
                controllerNumber, identifier, classes);
        ...
        
        // 键盘类设备
        uint32_t keyboardSource = 0;
        int32_t keyboardType = AINPUT_KEYBOARD_TYPE_NON_ALPHABETIC;
        if (classes & INPUT_DEVICE_CLASS_KEYBOARD) {
            keyboardSource |= AINPUT_SOURCE_KEYBOARD;
        }
        if (classes & INPUT_DEVICE_CLASS_ALPHAKEY) {
            keyboardType = AINPUT_KEYBOARD_TYPE_ALPHABETIC;
        }
        if (classes & INPUT_DEVICE_CLASS_DPAD) {
            keyboardSource |= AINPUT_SOURCE_DPAD;
        }
        if (classes & INPUT_DEVICE_CLASS_GAMEPAD) {
            keyboardSource |= AINPUT_SOURCE_GAMEPAD;
        }

        if (keyboardSource != 0) {
            device->addMapper(new KeyboardInputMapper(device, keyboardSource, keyboardType));
        }

        //鼠标类设备
        if (classes & INPUT_DEVICE_CLASS_CURSOR) {
            device->addMapper(new CursorInputMapper(device));
        }

        //触摸屏设备
        if (classes & INPUT_DEVICE_CLASS_TOUCH_MT) {
            device->addMapper(new MultiTouchInputMapper(device));
        } else if (classes & INPUT_DEVICE_CLASS_TOUCH) {
            device->addMapper(new SingleTouchInputMapper(device));
        }
        ...
        return device;
    }

该方法主要功能：
    
- 创建InputDevice对象；
- 根据设备类型来创建并添加相对应的InputMapper。

input设备类型有很多种，以上代码只列举常见的设备以及相应的InputMapper：

- 键盘类设备：KeyboardInputMapper
- 触摸屏设备：MultiTouchInputMapper或SingleTouchInputMapper
- 鼠标类设备：CursorInputMapper

介绍完设备增加过程，继续回到[小节2.8]，除了设备的增删，更多的时候都是数据事件，那么接下来介绍数据事件的
处理过程。

### 2.11 processEventsForDeviceLocked

    void InputReader::processEventsForDeviceLocked(int32_t deviceId,
            const RawEvent* rawEvents, size_t count) {
        ssize_t deviceIndex = mDevices.indexOfKey(deviceId);
        ...
        
        InputDevice* device = mDevices.valueAt(deviceIndex);
        if (device->isIgnored()) {
            return; //可忽略则直接返回
        }
        //【见小节2.12】
        device->process(rawEvents, count);
    }

### 2.12 device->process

    void InputDevice::process(const RawEvent* rawEvents, size_t count) {
        size_t numMappers = mMappers.size();
        for (const RawEvent* rawEvent = rawEvents; count--; rawEvent++) {
            if (mDropUntilNextSync) {
                if (rawEvent->type == EV_SYN && rawEvent->code == SYN_REPORT) {
                    mDropUntilNextSync = false;
                } 
            } else if (rawEvent->type == EV_SYN && rawEvent->code == SYN_DROPPED) {
                mDropUntilNextSync = true; 
                reset(rawEvent->when);
            } else {
                for (size_t i = 0; i < numMappers; i++) {
                    InputMapper* mapper = mMappers[i];
                    //调用具体mapper来处理
                    mapper->process(rawEvent);
                }
            }
        }
    }

这里以key

#### process
    void KeyboardInputMapper::process(const RawEvent* rawEvent) {
        switch (rawEvent->type) {
        case EV_KEY: {
            int32_t scanCode = rawEvent->code;
            int32_t usageCode = mCurrentHidUsage;
            mCurrentHidUsage = 0;

            if (isKeyboardOrGamepadKey(scanCode)) {
                int32_t keyCode;
                uint32_t flags;
                if (getEventHub()->mapKey(getDeviceId(), scanCode, usageCode, &keyCode, &flags)) {
                    keyCode = AKEYCODE_UNKNOWN;
                    flags = 0;
                }
                //【见小节】
                processKey(rawEvent->when, rawEvent->value != 0, keyCode, scanCode, flags);
            }
            break;
        }
        case EV_MSC: ...; break;
        case EV_SYN: ...
        
        }
    }

#### processKey

    void KeyboardInputMapper::processKey(nsecs_t when, bool down, int32_t keyCode,
            int32_t scanCode, uint32_t policyFlags) {

        if (down) {
            if (mParameters.orientationAware && mParameters.hasAssociatedDisplay) {
                keyCode = rotateKeyCode(keyCode, mOrientation);
            }

            ssize_t keyDownIndex = findKeyDown(scanCode);
            if (keyDownIndex >= 0) {
                keyCode = mKeyDowns.itemAt(keyDownIndex).keyCode;
            } else {
                // key down
                if ((policyFlags & POLICY_FLAG_VIRTUAL)
                        && mContext->shouldDropVirtualKey(when,
                                getDevice(), keyCode, scanCode)) {
                    return;
                }
                if (policyFlags & POLICY_FLAG_GESTURE) {
                    mDevice->cancelTouch(when);
                }

                mKeyDowns.push();
                KeyDown& keyDown = mKeyDowns.editTop();
                keyDown.keyCode = keyCode;
                keyDown.scanCode = scanCode;
            }

            mDownTime = when;
        } else {
            //移除key down事件
            ssize_t keyDownIndex = findKeyDown(scanCode);
            if (keyDownIndex >= 0) {
                // key up
                keyCode = mKeyDowns.itemAt(keyDownIndex).keyCode;
                mKeyDowns.removeAt(size_t(keyDownIndex));
            } else {
                //键盘没有按下操作，则直接忽略本次抬起操作
                return;
            }
        }

        int32_t oldMetaState = mMetaState;
        int32_t newMetaState = updateMetaState(keyCode, down, oldMetaState);
        bool metaStateChanged = oldMetaState != newMetaState;
        if (metaStateChanged) {
            mMetaState = newMetaState;
            updateLedState(false);
        }

        nsecs_t downTime = mDownTime;

        if (down && getDevice()->isExternal()) {
            policyFlags |= POLICY_FLAG_WAKE;
        }

        if (mParameters.handlesKeyRepeat) {
            policyFlags |= POLICY_FLAG_DISABLE_KEY_REPEAT;
        }

        if (metaStateChanged) {
            getContext()->updateGlobalMetaState();
        }

        if (down && !isMetaKey(keyCode)) {
            getContext()->fadePointer();
        }

        NotifyKeyArgs args(when, getDeviceId(), mSource, policyFlags,
                down ? AKEY_EVENT_ACTION_DOWN : AKEY_EVENT_ACTION_UP,
                AKEY_EVENT_FLAG_FROM_SYSTEM, keyCode, scanCode, newMetaState, downTime);
        //发生事件【见小节】
        getListener()->notifyKey(&args);
    }
    
#### notifyKey

    void QueuedInputListener::notifyKey(const NotifyKeyArgs* args) {
        mArgsQueue.push(new NotifyKeyArgs(*args));
    }

后面再看看TP的mapper处理过程。

### 2.13 QueuedListener->flush
[-> InputListener.cpp]

    void QueuedInputListener::flush() {
        size_t count = mArgsQueue.size();
        for (size_t i = 0; i < count; i++) {
            NotifyArgs* args = mArgsQueue[i];
            args->notify(mInnerListener);
            delete args;
        }
        mArgsQueue.clear();
    }


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

inputReader -> inputDispacher,  add in mInboundQueue, add wake up InputDispacher。

好文: 
http://blog.csdn.net/laisse/article/details/47259485
http://blog.csdn.net/u012719256/article/details/52945534
