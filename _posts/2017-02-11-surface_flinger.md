---
layout: post
title:  "SurfaceFlinger原理(一)"
date:   2017-02-11 20:30:00
catalog:  true
tags:
    - android
---

> 基于Android 6.0源码， 分析SurfaceFlinger原理

    frameworks/native/services/surfaceflinger/
      - main_surfaceflinger.cpp
      - SurfaceFlinger.cpp
      - DispSync.cpp
      - MessageQueue.cpp
      - DisplayHardware/HWComposer.cpp
      
    frameworks/native/libs/gui/
      - DisplayEventReceiver.cpp
      - BitTube.cpp
    
## 一. 概述

Android系统的图形处理相关的模块，就不得不提surfaceflinger，这是由init进程所启动的
守护进程，在init.rc中该服务如下：

    service surfaceflinger /system/bin/surfaceflinger
        class core
        user system
        group graphics drmrpc
        onrestart restart zygote
        writepid /dev/cpuset/system-background/tasks

surfaceflinger服务属于核心类(core class)，另外，当surfaceflinger重启时会触发zygote的重启。
surfaceflinger服务启动的起点便是如下的main()函数。

## 二. 启动过程

### 2.1 main
[-> main_surfaceflinger.cpp]

    int main(int, char**) {
        ProcessState::self()->setThreadPoolMaxThreadCount(4);

        sp<ProcessState> ps(ProcessState::self());
        ps->startThreadPool();

        //实例化surfaceflinger【见小节2.2】
        sp<SurfaceFlinger> flinger =  new SurfaceFlinger();

        setpriority(PRIO_PROCESS, 0, PRIORITY_URGENT_DISPLAY);
        set_sched_policy(0, SP_FOREGROUND);

        //初始化【见小节2.3】
        flinger->init();

        //发布surface flinger，注册到Service Manager
        sp<IServiceManager> sm(defaultServiceManager());
        sm->addService(String16(SurfaceFlinger::getServiceName()), flinger, false);

        // 运行在当前线程【见小节2.11】
        flinger->run();

        return 0;
    }

该方法的主要功能：

- 设定surfaceflinger进程的binder线程池个数上限为4，并启动binder线程池；
- 创建SurfaceFlinger对象；【见小节2.1】
- 设置surfaceflinger进程为高优先级以及前台调度策略；
- 初始化SurfaceFlinger；【见小节2.3】
- 将"SurfaceFlinger"服务注册到Service Manager;
- 在当前主线程执行SurfaceFlinger的run方法。【见小节2.11】

### 2.2 创建SurfaceFlinger
[-> SurfaceFlinger.cpp]

    SurfaceFlinger::SurfaceFlinger()
        :   BnSurfaceComposer(),
            mTransactionFlags(0),
            mTransactionPending(false),
            mAnimTransactionPending(false),
            mLayersRemoved(false),
            mRepaintEverything(0),
            mRenderEngine(NULL),
            mBootTime(systemTime()),
            mVisibleRegionsDirty(false),
            mHwWorkListDirty(false),
            mAnimCompositionPending(false),
            mDebugRegion(0),
            mDebugDDMS(0),
            mDebugDisableHWC(0),
            mDebugDisableTransformHint(0),
            mDebugInSwapBuffers(0),
            mLastSwapBufferTime(0),
            mDebugInTransaction(0),
            mLastTransactionTime(0),
            mBootFinished(false),
            mForceFullDamage(false),
            mPrimaryHWVsyncEnabled(false),
            mHWVsyncAvailable(false),
            mDaltonize(false),
            mHasColorMatrix(false),
            mHasPoweredOff(false),
            mFrameBuckets(),
            mTotalTime(0),
            mLastSwapTime(0)
    {
        ALOGI("SurfaceFlinger is starting");
        char value[PROPERTY_VALUE_MAX];

        property_get("ro.bq.gpu_to_cpu_unsupported", value, "0");
        mGpuToCpuSupported = !atoi(value);

        property_get("debug.sf.showupdates", value, "0");
        mDebugRegion = atoi(value);

        property_get("debug.sf.ddms", value, "0");
        mDebugDDMS = atoi(value);       
    }

SurfaceFlinger继承于BnSurfaceComposer,IBinder::DeathRecipient,HWComposer::EventHandler

flinger的数据类型为sp<SurfaceFlinger>强指针类型，当首次被强指针引用时则执行OnFirstRef()

#### 2.2.1 SF.onFirstRef

    void SurfaceFlinger::onFirstRef()
    {
        mEventQueue.init(this);
    }

#### 2.2.2 MQ.init
[-> MessageQueue.cpp]

    void MessageQueue::init(const sp<SurfaceFlinger>& flinger)
    {
        mFlinger = flinger;
        mLooper = new Looper(true);
        mHandler = new Handler(*this); //【见小节2.2.3】
    }

这个Handler是MessageQueue的内部类Handler，此处传递的*this便是MessageQueue本身。

#### 2.2.3 MQ.Handler
[-> MessageQueue.cpp]

    class MessageQueue {
        class Handler : public MessageHandler {
            enum {
                eventMaskInvalidate     = 0x1,
                eventMaskRefresh        = 0x2,
                eventMaskTransaction    = 0x4
            };
            MessageQueue& mQueue;
            int32_t mEventMask;
        public:
            Handler(MessageQueue& queue) : mQueue(queue), mEventMask(0) { }
            virtual void handleMessage(const Message& message);
            void dispatchRefresh();
            void dispatchInvalidate();
            void dispatchTransaction();
        };
        ...
    }
    
### 2.3 SF.init
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::init() {
        Mutex::Autolock _l(mStateLock);

        //初始化EGL，作为默认的显示
        mEGLDisplay = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        eglInitialize(mEGLDisplay, NULL, NULL);

        // 初始化硬件composer对象【见小节2.4】
        mHwc = new HWComposer(this, *static_cast<HWComposer::EventHandler *>(this));

        //获取RenderEngine引擎
        mRenderEngine = RenderEngine::create(mEGLDisplay, mHwc->getVisualID());

        //检索创建的EGL上下文
        mEGLContext = mRenderEngine->getEGLContext();

        //初始化非虚拟显示屏【见小节2.5】
        for (size_t i=0 ; i<DisplayDevice::NUM_BUILTIN_DISPLAY_TYPES ; i++) {
            DisplayDevice::DisplayType type((DisplayDevice::DisplayType)i);
            //建立已连接的显示设备
            if (mHwc->isConnected(i) || type==DisplayDevice::DISPLAY_PRIMARY) {
                bool isSecure = true;
                createBuiltinDisplayLocked(type);
                wp<IBinder> token = mBuiltinDisplays[i];

                sp<IGraphicBufferProducer> producer;
                sp<IGraphicBufferConsumer> consumer;
                //创建BufferQueue的生产者和消费者
                BufferQueue::createBufferQueue(&producer, &consumer,
                        new GraphicBufferAlloc());

                sp<FramebufferSurface> fbs = new FramebufferSurface(*mHwc, i, consumer);
                int32_t hwcId = allocateHwcDisplayId(type);
                //创建显示设备
                sp<DisplayDevice> hw = new DisplayDevice(this,
                        type, hwcId, mHwc->getFormat(hwcId), isSecure, token,
                        fbs, producer,
                        mRenderEngine->getEGLConfig());
                if (i > DisplayDevice::DISPLAY_PRIMARY) {
                    hw->setPowerMode(HWC_POWER_MODE_NORMAL);
                }
                mDisplays.add(token, hw);
            }
        }

        getDefaultDisplayDevice()->makeCurrent(mEGLDisplay, mEGLContext);

        //当应用和sf的vsync偏移量一致时，则只创建一个EventThread线程
        if (vsyncPhaseOffsetNs != sfVsyncPhaseOffsetNs) {
            sp<VSyncSource> vsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                    vsyncPhaseOffsetNs, true, "app");
            mEventThread = new EventThread(vsyncSrc);
            sp<VSyncSource> sfVsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                    sfVsyncPhaseOffsetNs, true, "sf");
            mSFEventThread = new EventThread(sfVsyncSrc);
            mEventQueue.setEventThread(mSFEventThread);
        } else {
            //创建DispSyncSource对象【2.6】
            sp<VSyncSource> vsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                    vsyncPhaseOffsetNs, true, "sf-app");
            //创建线程EventThread 【见小节2.7】
            mEventThread = new EventThread(vsyncSrc);
            //设置EventThread 【见小节2.8】
            mEventQueue.setEventThread(mEventThread);
        }

        //【见小节2.9】
        mEventControlThread = new EventControlThread(this);
        mEventControlThread->run("EventControl", PRIORITY_URGENT_DISPLAY);

        //当不存在HWComposer时，则设置软件vsync
        if (mHwc->initCheck() != NO_ERROR) {
            mPrimaryDispSync.setPeriod(16666667);
        }

        //初始化绘图状态
        mDrawingState = mCurrentState;

        //初始化显示设备
        initializeDisplays();

        //启动开机动画【2.10】
        startBootAnim();
    }

主要功能：

- 初始化EGL相关；
- 创建HWComposer对象；
- 初始化非虚拟显示屏；
- 启动app和sf两个EventThread线程；
- 启动开机动画；

另外，当应用和sf的vsync偏移量一致时，则只创建一个EventThread线程；否则会创建两个DispSyncSource对象，分别是用于绘制(app)和合成(SurfaceFlinger)。

### 2.4 创建HWComposer
[-> HWComposer.cpp]

    HWComposer::HWComposer(
            const sp<SurfaceFlinger>& flinger,
            EventHandler& handler)
        : mFlinger(flinger),
          mFbDev(0), mHwc(0), mNumDisplays(1),
          mCBContext(new cb_context),
          mEventHandler(handler),
          mDebugForceFakeVSync(false)
    {
        ...
        bool needVSyncThread = true;
        int fberr = loadFbHalModule(); //加载framebuffer的HAL层模块
        loadHwcModule(); //加载HWComposer模块

        //标记已分配的display ID
        for (size_t i=0 ; i<NUM_BUILTIN_DISPLAYS ; i++) {
            mAllocatedDisplayIDs.markBit(i);
        }

        if (mHwc) {
            if (mHwc->registerProcs) {
                mCBContext->hwc = this;
                mCBContext->procs.invalidate = &hook_invalidate;
                //VSYNC信号的回调方法
                mCBContext->procs.vsync = &hook_vsync;
                if (hwcHasApiVersion(mHwc, HWC_DEVICE_API_VERSION_1_1))
                    mCBContext->procs.hotplug = &hook_hotplug;
                else
                    mCBContext->procs.hotplug = NULL;
                memset(mCBContext->procs.zero, 0, sizeof(mCBContext->procs.zero));
                //注册回调函数
                mHwc->registerProcs(mHwc, &mCBContext->procs);
            }

            //进入此处，说明已成功打开硬件composer设备，则不再需要vsync线程
            needVSyncThread = false;
            eventControl(HWC_DISPLAY_PRIMARY, HWC_EVENT_VSYNC, 0);
            ...
        }
        ...

        if (needVSyncThread) {
            //不支持硬件的VSYNC，则会创建线程来模拟定时VSYNC信号
            mVSyncThread = new VSyncThread(*this);
        }
    }

HWComposer代表着硬件显示设备，注册了VSYNC信号的回调。VSYNC信号本身是由显示驱动产生的，
在不支持硬件的VSYNC，则会创建“VSyncThread”线程来模拟定时VSYNC信号。

### 2.5 显示设备
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::init() {
        ...
        for (size_t i=0 ; i<DisplayDevice::NUM_BUILTIN_DISPLAY_TYPES ; i++) {
            DisplayDevice::DisplayType type((DisplayDevice::DisplayType)i);
            //建立已连接的显示设备
            if (mHwc->isConnected(i) || type==DisplayDevice::DISPLAY_PRIMARY) {
                bool isSecure = true;
                createBuiltinDisplayLocked(type);
                wp<IBinder> token = mBuiltinDisplays[i];

                sp<IGraphicBufferProducer> producer;
                sp<IGraphicBufferConsumer> consumer;
                //创建BufferQueue的生产者和消费者
                BufferQueue::createBufferQueue(&producer, &consumer,
                        new GraphicBufferAlloc());

                sp<FramebufferSurface> fbs = new FramebufferSurface(*mHwc, i, consumer);
                int32_t hwcId = allocateHwcDisplayId(type);
                //创建显示设备
                sp<DisplayDevice> hw = new DisplayDevice(this,
                        type, hwcId, mHwc->getFormat(hwcId), isSecure, token,
                        fbs, producer,
                        mRenderEngine->getEGLConfig());
                if (i > DisplayDevice::DISPLAY_PRIMARY) {
                    hw->setPowerMode(HWC_POWER_MODE_NORMAL);
                }
                mDisplays.add(token, hw);
            }
        }
        ...
    }
    
创建IGraphicBufferProducer和IGraphicBufferConsumer，以及FramebufferSurface，DisplayDevice对象。另外，
显示设备有3类：主设备，扩展设备，虚拟设备。其中前两个都是内置显示设备，故NUM_BUILTIN_DISPLAY_TYPES=2，

### 2.6 DispSyncSource
[-> SurfaceFlinger.cpp]

    class DispSyncSource : public VSyncSource, private DispSync::Callback {
      DispSyncSource(DispSync* dispSync, nsecs_t phaseOffset, bool traceVsync,
          const char* label) :
              mValue(0),
              mTraceVsync(traceVsync),
              mVsyncOnLabel(String8::format("VsyncOn-%s", label)),
              mVsyncEventLabel(String8::format("VSYNC-%s", label)),
              mDispSync(dispSync),
              mCallbackMutex(),
              mCallback(),
              mVsyncMutex(),
              mPhaseOffset(phaseOffset),
              mEnabled(false) {}
      ...
  }

### 2.7 EventThread线程
[-> EventThread.cpp]

    EventThread::EventThread(const sp<VSyncSource>& src)
        : mVSyncSource(src),
          mUseSoftwareVSync(false),
          mVsyncEnabled(false),
          mDebugVsyncEnabled(false),
          mVsyncHintSent(false) {

        for (int32_t i=0 ; i<DisplayDevice::NUM_BUILTIN_DISPLAY_TYPES ; i++) {
            mVSyncEvent[i].header.type = DisplayEventReceiver::DISPLAY_EVENT_VSYNC;
            mVSyncEvent[i].header.id = 0;
            mVSyncEvent[i].header.timestamp = 0;
            mVSyncEvent[i].vsync.count =  0;
        }
        struct sigevent se;
        se.sigev_notify = SIGEV_THREAD;
        se.sigev_value.sival_ptr = this;
        se.sigev_notify_function = vsyncOffCallback;
        se.sigev_notify_attributes = NULL;
        timer_create(CLOCK_MONOTONIC, &se, &mTimerId);
    }

EventThread继承于Thread和VSyncSource::Callback两个类。

#### 2.7.1 ET.onFirstRef
[-> EventThread.cpp]

    void EventThread::onFirstRef() {
        //运行EventThread线程【见小节2.7.2】
        run("EventThread", PRIORITY_URGENT_DISPLAY + PRIORITY_MORE_FAVORABLE);
    }

#### 2.7.2 ET.threadLoop
[-> EventThread.cpp]

    bool EventThread::threadLoop() {
        DisplayEventReceiver::Event event;
        Vector< sp<EventThread::Connection> > signalConnections;
        // 等待事件【见小节2.7.3】
        signalConnections = waitForEvent(&event); 

        //分发事件给所有的监听者
        const size_t count = signalConnections.size();
        for (size_t i=0 ; i<count ; i++) {
            const sp<Connection>& conn(signalConnections[i]);
            //传递事件【见小节3.10】
            status_t err = conn->postEvent(event);
            if (err == -EAGAIN || err == -EWOULDBLOCK) {
                //可能此时connection已满，则直接抛弃事件
                ALOGW("EventThread: dropping event (%08x) for connection %p",
                        event.header.type, conn.get());
            } else if (err < 0) {
                //发生致命错误，则清理该连接
                removeDisplayEventConnection(signalConnections[i]);
            }
        }
        return true;
    }

#### 2.7.3 waitForEvent
[-> EventThread.cpp]

    Vector< sp<EventThread::Connection> > EventThread::waitForEvent(
            DisplayEventReceiver::Event* event)
    {
        Mutex::Autolock _l(mLock);
        Vector< sp<EventThread::Connection> > signalConnections;

        do {
            bool eventPending = false;
            bool waitForVSync = false;

            size_t vsyncCount = 0;
            nsecs_t timestamp = 0;
            for (int32_t i=0 ; i<DisplayDevice::NUM_BUILTIN_DISPLAY_TYPES ; i++) {
                timestamp = mVSyncEvent[i].header.timestamp;
                if (timestamp) {
                    *event = mVSyncEvent[i];
                    mVSyncEvent[i].header.timestamp = 0;
                    vsyncCount = mVSyncEvent[i].vsync.count;
                    break;
                }
            }

            if (!timestamp) {
                //没有vsync事件，则查看其它事件
                eventPending = !mPendingEvents.isEmpty();
                if (eventPending) {
                    //存在其它事件可用于分发
                    *event = mPendingEvents[0];
                    mPendingEvents.removeAt(0);
                }
            }

            //查找正在等待事件的连接
            size_t count = mDisplayEventConnections.size();
            for (size_t i=0 ; i<count ; i++) {
                sp<Connection> connection(mDisplayEventConnections[i].promote());
                if (connection != NULL) {
                    bool added = false;
                    if (connection->count >= 0) {
                        //需要vsync事件，由于至少存在一个连接正在等待vsync
                        waitForVSync = true;
                        if (timestamp) {
                            if (connection->count == 0) {
                                connection->count = -1;
                                signalConnections.add(connection);
                                added = true;
                            } else if (connection->count == 1 ||
                                    (vsyncCount % connection->count) == 0) {
                                signalConnections.add(connection);
                                added = true;
                            }
                        }
                    }

                    if (eventPending && !timestamp && !added) {
                        //没有vsync事件需要处理(timestamp==0),但存在pending消息
                        signalConnections.add(connection);
                    }
                } else {
                    //该连接已死亡，则直接清理
                    mDisplayEventConnections.removeAt(i);
                    --i; --count;
                }
            }

            if (timestamp && !waitForVSync) {
                //接收到VSYNC，但没有client需要它，则直接关闭VSYNC
                disableVSyncLocked();
            } else if (!timestamp && waitForVSync) {
                //至少存在一个client，则需要使能VSYNC
                enableVSyncLocked();
            }

            if (!timestamp && !eventPending) {
                if (waitForVSync) {
                    bool softwareSync = mUseSoftwareVSync;
                    nsecs_t timeout = softwareSync ? ms2ns(16) : ms2ns(1000);
                    if (mCondition.waitRelative(mLock, timeout) == TIMED_OUT) {
                        mVSyncEvent[0].header.type = DisplayEventReceiver::DISPLAY_EVENT_VSYNC;
                        mVSyncEvent[0].header.id = DisplayDevice::DISPLAY_PRIMARY;
                        mVSyncEvent[0].header.timestamp = systemTime(SYSTEM_TIME_MONOTONIC);
                        mVSyncEvent[0].vsync.count++;
                    }
                } else {
                    //不存在对vsync感兴趣的连接，即将要进入休眠
                    mCondition.wait(mLock);
                }
            }
        } while (signalConnections.isEmpty());

        //到此处，则保证存在timestamp以及连接
        return signalConnections;
    }

EventThread线程，进入mCondition的wait()方法，等待唤醒。

### 2.8 setEventThread
[-> MessageQueue.cpp]

    void MessageQueue::setEventThread(const sp<EventThread>& eventThread)
    {
        mEventThread = eventThread;
        //创建连接
        mEvents = eventThread->createEventConnection();
        //获取BitTube对象
        mEventTube = mEvents->getDataChannel();
        //监听BitTube，一旦有数据到来则调用cb_eventReceiver()
        mLooper->addFd(mEventTube->getFd(), 0, Looper::EVENT_INPUT,
                MessageQueue::cb_eventReceiver, this);
    }

此处mEvents的数据类型为sp<IDisplayEventConnection>，mEventTube的数据类型为sp<BitTube>。

### 2.9 EventControlThread线程
[-> EventControlThread.cpp]

    EventControlThread::EventControlThread(const sp<SurfaceFlinger>& flinger):
            mFlinger(flinger),
            mVsyncEnabled(false) {
    }
    
    bool EventControlThread::threadLoop() {
        Mutex::Autolock lock(mMutex);
        bool vsyncEnabled = mVsyncEnabled;

        mFlinger->eventControl(HWC_DISPLAY_PRIMARY, SurfaceFlinger::EVENT_VSYNC,
                mVsyncEnabled);

        while (true) {
            status_t err = mCond.wait(mMutex);
            ...
            
            if (vsyncEnabled != mVsyncEnabled) {
                mFlinger->eventControl(HWC_DISPLAY_PRIMARY,
                        SurfaceFlinger::EVENT_VSYNC, mVsyncEnabled);
                vsyncEnabled = mVsyncEnabled;
            }
        }

        return false;
    }
    
EventControlThread也是继承于Thread。

### 2.10 startBootAnim
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::startBootAnim() {
        property_set("service.bootanim.exit", "0");
        property_set("ctl.start", "bootanim");
    }
    
通过控制ctl.start属性，设置成bootanim值，则触发init进程来创建开机动画进程bootanim，
到此，则开始显示开机过程的动画。 从小节[2.4 ~2.9]都是介绍SurfaceFlinger的init()过程，
紧接着便执行其run()方法。

### 2.11 SF.run
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::run() {
        do {
            //不断循环地等待事件【见小节2.12】
            waitForEvent(); 
        } while (true);
    }

### 2.12 SF.waitForEvent
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::waitForEvent() {
        mEventQueue.waitMessage(); //【2.13】
    }

mEventQueue的数据类型为MessageQueue。
 
### 2.13 MQ.waitMessage
[-> MessageQueue.cpp]

    void MessageQueue::waitMessage() {
        do {
            IPCThreadState::self()->flushCommands();
            int32_t ret = mLooper->pollOnce(-1);
            ...
        } while (true);
    }

可见SurfaceFlinger主线程进入waitMessage来等待消息的到来。

## 三. Vsync信号

HWComposer对象创建过程，会注册一些回调方法，当硬件产生VSYNC信号时，则会回调hook_vsync()方法。

### 3.1 HWC.hook_vsync
[-> HWComposer.cpp]

    void HWComposer::hook_vsync(const struct hwc_procs* procs, int disp,
            int64_t timestamp) {
        cb_context* ctx = reinterpret_cast<cb_context*>(
                const_cast<hwc_procs_t*>(procs));
        ctx->hwc->vsync(disp, timestamp); //【见小节3.2】
    }

### 3.2 HWC.vsync
[-> HWComposer.cpp]

    void HWComposer::vsync(int disp, int64_t timestamp) {
        if (uint32_t(disp) < HWC_NUM_PHYSICAL_DISPLAY_TYPES) {
            {
                Mutex::Autolock _l(mLock);
                if (timestamp == mLastHwVSync[disp]) {
                    return; //忽略重复的VSYNC信号
                }
                mLastHwVSync[disp] = timestamp;
            }
            //【见小节3.3】
            mEventHandler.onVSyncReceived(disp, timestamp);
        }
    }

当收到VSYNC信号则会回调EventHandler的onVSyncReceived()方法，此处mEventHandler是指SurfaceFlinger对象。

### 3.3 SF.onVSyncReceived
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::onVSyncReceived(int type, nsecs_t timestamp) {
        bool needsHwVsync = false;

        {
            Mutex::Autolock _l(mHWVsyncLock);
            if (type == 0 && mPrimaryHWVsyncEnabled) {
                // 此处mPrimaryDispSync为DispSync类【见小节3.4】
                needsHwVsync = mPrimaryDispSync.addResyncSample(timestamp);
            }
        }

        if (needsHwVsync) {
            enableHardwareVsync();
        } else {
            disableHardwareVsync(false);
        }
    }

### 3.4 DS.addResyncSample

此处调用addResyncSample对象的addResyncSample方法，那么先来看看DispSync对象的初始化过程

#### 3.4.1 创建DispSync
[-> DispSync.cpp]

    DispSync::DispSync() :
            mRefreshSkipCount(0),
            mThread(new DispSyncThread()) {
        //【见小节3.4.2】
        mThread->run("DispSync", PRIORITY_URGENT_DISPLAY + PRIORITY_MORE_FAVORABLE);

        reset();
        beginResync();
        ...
    }
    
#### 3.4.2 DispSyncThread线程
[-> DispSync.cpp]

    virtual bool threadLoop() {
         status_t err;
         nsecs_t now = systemTime(SYSTEM_TIME_MONOTONIC);
         nsecs_t nextEventTime = 0;

         while (true) {
             Vector<CallbackInvocation> callbackInvocations;

             nsecs_t targetTime = 0;
             { // Scope for lock
                 Mutex::Autolock lock(mMutex);
                 if (mStop) {
                     return false;
                 }

                 if (mPeriod == 0) {
                     err = mCond.wait(mMutex);
                     continue;
                 }

                 nextEventTime = computeNextEventTimeLocked(now);
                 targetTime = nextEventTime;
                 bool isWakeup = false;

                 if (now < targetTime) {
                     err = mCond.waitRelative(mMutex, targetTime - now);
                     if (err == TIMED_OUT) {
                         isWakeup = true;
                     } else if (err != NO_ERROR) {
                         return false;
                     }
                 }

                 now = systemTime(SYSTEM_TIME_MONOTONIC);

                 if (isWakeup) {
                     mWakeupLatency = ((mWakeupLatency * 63) +
                             (now - targetTime)) / 64;
                     if (mWakeupLatency > 500000) {
                         mWakeupLatency = 500000;
                     }
                 }
                 //收集vsync信号的所有回调方法
                 callbackInvocations = gatherCallbackInvocationsLocked(now);
             }

             if (callbackInvocations.size() > 0) {
                 //回调所有对象的onDispSyncEvent方法
                 fireCallbackInvocations(callbackInvocations);
             }
         }

         return false;
     }   

线程"DispSync"停留在mCond的wait()过程，等待被唤醒。

#### 3.4.3  addResyncSample
[-> DispSync.cpp]

    bool DispSync::addResyncSample(nsecs_t timestamp) {
        Mutex::Autolock lock(mMutex);

        size_t idx = (mFirstResyncSample + mNumResyncSamples) % MAX_RESYNC_SAMPLES;
        mResyncSamples[idx] = timestamp;

        if (mNumResyncSamples < MAX_RESYNC_SAMPLES) {
            mNumResyncSamples++;
        } else {
            mFirstResyncSample = (mFirstResyncSample + 1) % MAX_RESYNC_SAMPLES;
        }

        updateModelLocked(); //【见小节3.5】

        if (mNumResyncSamplesSincePresent++ > MAX_RESYNC_SAMPLES_WITHOUT_PRESENT) {
            resetErrorLocked();
        }

        if (kIgnorePresentFences) {
            return mThread->hasAnyEventListeners();
        }

        return mPeriod == 0 || mError > kErrorThreshold;
    }

### 3.5 DS.updateModelLocked
[-> DispSync.cpp]


    void DispSync::updateModelLocked() {
        ...
        //【见小节3.6】
        mThread->updateModel(mPeriod, mPhase);
    }
    
### 3.6 DST.updateModel
[-> DispSyncThread.cpp]

    class DispSyncThread: public Thread {
        void updateModel(nsecs_t period, nsecs_t phase) {
            Mutex::Autolock lock(mMutex);
            mPeriod = period;
            mPhase = phase;
            mCond.signal(); //唤醒目标线程
        }
    }

唤醒DispSyncThread线程，接下里进入DispSyncThread线程。

### 3.7 DispSyncThread线程
[-> DispSync.cpp]

    virtual bool threadLoop() {
         ...
         while (true) {
             Vector<CallbackInvocation> callbackInvocations;

             nsecs_t targetTime = 0;
             { // Scope for lock
                 Mutex::Autolock lock(mMutex);
                ...
                 if (now < targetTime) {
                     err = mCond.waitRelative(mMutex, targetTime - now);
                     ...
                 }
                 ...
                 //收集vsync信号的所有回调方法
                 callbackInvocations = gatherCallbackInvocationsLocked(now);
             }

             if (callbackInvocations.size() > 0) {
                 //回调所有对象的onDispSyncEvent方法 【见小节3.7.1】
                 fireCallbackInvocations(callbackInvocations);
             }
         }

         return false;
     } 
 
#### 3.7.1 fireCallbackInvocations
 
    void fireCallbackInvocations(const Vector<CallbackInvocation>& callbacks) {
        for (size_t i = 0; i < callbacks.size(); i++) {
            //【见小节3.8】
            callbacks[i].mCallback->onDispSyncEvent(callbacks[i].mEventTime);
        }
    }

在前面小节【2.3】SurfaceFlinger调用init()的过程，创建过DispSyncSource对象。接下里便是回调该对象的
onDispSyncEvent。

### 3.8 DSS.onDispSyncEvent
[-> SurfaceFlinger.cpp  ::DispSyncSource]

    virtual void onDispSyncEvent(nsecs_t when) {
        sp<VSyncSource::Callback> callback;
        {
           Mutex::Autolock lock(mCallbackMutex);
           callback = mCallback;
        }

        if (callback != NULL) {
          callback->onVSyncEvent(when); //【见小节3.9】
        }
    }

### 3.9 ET.onVSyncEvent
[-> EventThread.java]

    void EventThread::onVSyncEvent(nsecs_t timestamp) {
        Mutex::Autolock _l(mLock);
        mVSyncEvent[0].header.type = DisplayEventReceiver::DISPLAY_EVENT_VSYNC;
        mVSyncEvent[0].header.id = 0;
        mVSyncEvent[0].header.timestamp = timestamp;
        mVSyncEvent[0].vsync.count++;
        mCondition.broadcast(); //唤醒EventThread线程
    }

mCondition.broadcast能够唤醒处理waitForEvent()过程的EventThread【见小节2.7.2】，并往下执行conn的postEvent().

### 3.10 ET.postEvent
[-> EventThread.java]

    status_t EventThread::Connection::postEvent(
            const DisplayEventReceiver::Event& event) {
        ssize_t size = DisplayEventReceiver::sendEvents(mChannel, &event, 1);
        return size < 0 ? status_t(size) : status_t(NO_ERROR);
    }

### 3.11 DER.sendEvents
[-> DisplayEventReceiver.cpp]

    ssize_t DisplayEventReceiver::sendEvents(const sp<BitTube>& dataChannel,
            Event const* events, size_t count)
    {
        return BitTube::sendObjects(dataChannel, events, count);
    }
  
根据小节【2.8】可知监听BitTube，此处调用BitTube来sendObjects。一旦收到数据，则调用MQ.cb_eventReceiver()方法。
  
#### 3.11.1 MQ.cb_eventReceiver
[-> MessageQueue.cpp]

    int MessageQueue::cb_eventReceiver(int fd, int events, void* data) {
        MessageQueue* queue = reinterpret_cast<MessageQueue *>(data);
        return queue->eventReceiver(fd, events);
    }

#### 3.11.2 MQ.eventReceiver
[-> MessageQueue.cpp]

    int MessageQueue::eventReceiver(int /*fd*/, int /*events*/) {
        ssize_t n;
        DisplayEventReceiver::Event buffer[8];
        while ((n = DisplayEventReceiver::getEvents(mEventTube, buffer, 8)) > 0) {
            for (int i=0 ; i<n ; i++) {
                if (buffer[i].header.type == DisplayEventReceiver::DISPLAY_EVENT_VSYNC) {
    #if INVALIDATE_ON_VSYNC
                    mHandler->dispatchInvalidate();
    #else
                    mHandler->dispatchRefresh(); //【见小节3.12】
    #endif
                    break;
                }
            }
        }
        return 1;
    }

### 3.12 MQ.dispatchRefresh

    void MessageQueue::Handler::dispatchRefresh() {
        if ((android_atomic_or(eventMaskRefresh, &mEventMask) & eventMaskRefresh) == 0) {
            //发送消息，则进入handleMessage过程【见小节3.13】
            mQueue.mLooper->sendMessage(this, Message(MessageQueue::REFRESH));
        }
    }

### 3.13 MQ.handleMessage

    void MessageQueue::Handler::handleMessage(const Message& message) {
        switch (message.what) {
            case INVALIDATE:
                android_atomic_and(~eventMaskInvalidate, &mEventMask);
                mQueue.mFlinger->onMessageReceived(message.what);
                break;
            case REFRESH:
                android_atomic_and(~eventMaskRefresh, &mEventMask);
                mQueue.mFlinger->onMessageReceived(message.what);//【见小节3.14】
                break;
            case TRANSACTION:
                android_atomic_and(~eventMaskTransaction, &mEventMask);
                mQueue.mFlinger->onMessageReceived(message.what);
                break;
        }
    }
    
对于REFRESH操作，则进入onMessageReceived().

### 3.14 SF.onMessageReceived
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::onMessageReceived(int32_t what) {
        ATRACE_CALL();
        switch (what) {
            case MessageQueue::TRANSACTION: {
                handleMessageTransaction();
                break;
            }
            case MessageQueue::INVALIDATE: {
                bool refreshNeeded = handleMessageTransaction();
                refreshNeeded |= handleMessageInvalidate();
                refreshNeeded |= mRepaintEverything;
                if (refreshNeeded) {
                    signalRefresh();
                }
                break;
            }
            case MessageQueue::REFRESH: {
                handleMessageRefresh();
                break;
            }
        }
    }

### 3.15 SF.handleMessageRefresh
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::handleMessageRefresh() {
        ATRACE_CALL();
        preComposition();
        rebuildLayerStacks();
        setUpHWComposer();
        doDebugFlashRegions();
        doComposition();
        postComposition();
    }

下一篇文章，再来介绍图形输出过程。

## 四 总结

前面讲述过程中所涉及到的线程情况：

- 主线程“/system/bin/surfaceflinger”: 主线程
- 线程"EventThread"：EventThread
- 线程"EventControl"： EventControlThread
- 线程"DispSync"：DispSyncThread

Vsync处理流程图：点击查看[大图](http://gityuan.com/images/surfaceFlinger/vsync.jpg)

![vsync](/images/surfaceFlinger/vsync.jpg)

1. 底层vsync信号发送过来，一路执行到【小节3.6】DispSyncThread.updateModel()方法中调用mCond.signal()
来唤醒DispSyncThread线程；
2. DispSyncThread线程：执行到【小节3.9】EventThread::onVSyncEvent()方法中调用mCondition.broadcast()
唤醒EventThread线程；
3. EventThread线程：执行到【小节3.11】DisplayEventReceiver::sendEvents()方法中调用BitTube::sendObjects()；
由【小节2.8】可知当收到数据则调用MQ.cb_eventReceiver()，然后再经过handler消息机制，进入SurfaceFlinger主线程；
4.SurfaceFlinger主线程：【小节3.13】进入到MesageQueue的handleMessage()，最终调用SurfaceFlinger的handleMessageRefresh()。
