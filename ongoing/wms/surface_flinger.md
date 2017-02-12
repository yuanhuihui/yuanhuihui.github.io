

    frameworks/native/services/surfaceflinger/
      - main_surfaceflinger.cpp
      - SurfaceFlinger.cpp
      - DispSync.cpp
      - MessageQueue.cpp
      - DisplayHardware/HWComposer.cpp


## 一. 概述

Android系统的图形处理相关的模块，就不得不提surfaceflinger，这是由init进程所启动的
守护进程，在init.rc中该服务如下：

    service surfaceflinger /system/bin/surfaceflinger
        class core
        user system
        group graphics drmrpc
        onrestart restart zygote
        writepid /dev/cpuset/system-background/tasks

属于core class组别，当surfaceflinger重启时会触发zygote的重启。surfaceflinger服务启动的起点
便是如下的main()函数。

## 二. 流程

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

        // 运行在当前线程【见小节2.4】
        flinger->run();

        return 0;
    }

该方法的主要功能：

- 设定surfaceflinger进程的binder线程池个数上限为4，并启动binder线程池；
- 创建SurfaceFlinger对象；
- 设置surfaceflinger进程为高优先级以及前台调度策略；
- 初始化SurfaceFlinger，并将"SurfaceFlinger"注册到Service Manager;
- 在当前主线程执行SurfaceFlinger的run方法。

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

### 2.3 init
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

        //初始化非虚拟显示屏【见小节2.6】
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

        //创建DispSyncSource对象【2.7】
        sp<VSyncSource> vsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                vsyncPhaseOffsetNs, true, "app");
        //创建线程EventThread 【见小节2.8】
        mEventThread = new EventThread(vsyncSrc); 
        
        sp<VSyncSource> sfVsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                sfVsyncPhaseOffsetNs, true, "sf");
        mSFEventThread = new EventThread(sfVsyncSrc);
        
        mEventQueue.setEventThread(mSFEventThread);

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

### 2.5 VSync信号
[-> HWComposer.cpp]

HWComposer对象创建过程，会注册一些回调方法，当硬件产生VSYNC信号时，则会回调hook_vsync()方法。

    void HWComposer::hook_vsync(const struct hwc_procs* procs, int disp,
            int64_t timestamp) {
        cb_context* ctx = reinterpret_cast<cb_context*>(
                const_cast<hwc_procs_t*>(procs));
        ctx->hwc->vsync(disp, timestamp);
    }
    
    void HWComposer::vsync(int disp, int64_t timestamp) {
        if (uint32_t(disp) < HWC_NUM_PHYSICAL_DISPLAY_TYPES) {
            {
                Mutex::Autolock _l(mLock);
                if (timestamp == mLastHwVSync[disp]) {
                    return; //忽略重复的VSYNC信号
                }
                mLastHwVSync[disp] = timestamp;
            }

            mEventHandler.onVSyncReceived(disp, timestamp);
        }
    }

但收到VSYNC信号，则会回调EventHandler的onVSyncReceived()方法，此处mEventHandler是指SurfaceFlinger对象。

#### 2.5.1 onVSyncReceived
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::onVSyncReceived(int type, nsecs_t timestamp) {
        bool needsHwVsync = false;

        { // Scope for the lock
            Mutex::Autolock _l(mHWVsyncLock);
            if (type == 0 && mPrimaryHWVsyncEnabled) {
                // 此处mPrimaryDispSync为DispSync类【见小节2.5.2/2.5.4】
                needsHwVsync = mPrimaryDispSync.addResyncSample(timestamp);
            }
        }

        if (needsHwVsync) {
            enableHardwareVsync();
        } else {
            disableHardwareVsync(false);
        }
    }

#### 2.5.2 创建DispSync
[-> DispSync.cpp]

    DispSync::DispSync() :
            mRefreshSkipCount(0),
            mThread(new DispSyncThread()) {
        //【见小节2.5.3】
        mThread->run("DispSync", PRIORITY_URGENT_DISPLAY + PRIORITY_MORE_FAVORABLE);

        reset();
        beginResync();

        if (kTraceDetailedInfo) {
            if (!kIgnorePresentFences) {
                addEventListener(0, new ZeroPhaseTracer());
            }
        }
    }
    
#### 2.5.3 DispSyncThread
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

#### 2.5.4  addResyncSample
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

        updateModelLocked(); //【见小节2.5.5】

        if (mNumResyncSamplesSincePresent++ > MAX_RESYNC_SAMPLES_WITHOUT_PRESENT) {
            resetErrorLocked();
        }

        if (kIgnorePresentFences) {
            return mThread->hasAnyEventListeners();
        }

        return mPeriod == 0 || mError > kErrorThreshold;
    }

#### 2.5.5 updateModelLocked
[-> DispSync.cpp]


    void DispSync::updateModelLocked() {
        ...
        mThread->updateModel(mPeriod, mPhase);
    }
    
#### 2.5.6 updateModel
[-> DispSync.cpp]

    class DispSyncThread: public Thread {
        void updateModel(nsecs_t period, nsecs_t phase) {
            Mutex::Autolock lock(mMutex);
            mPeriod = period;
            mPhase = phase;
            mCond.signal();
        }
    }
    
### 2.6 显示设备
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

### 2.7 DispSyncSource
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

### 2.8 创建EventThread
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
      
### 2.9 创建EventControlThread
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
    
EventControlThread也是继承于Thread

### 2.10 startBootAnim
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::startBootAnim() {
        property_set("service.bootanim.exit", "0");
        property_set("ctl.start", "bootanim");
    }
    

### 2.4 run

    void SurfaceFlinger::run() {
        do {
            waitForEvent(); //【见小节2.4.1】
        } while (true);
    }

## 三 总结

- 线程：EventThread （2个）
- 线程"EventControl"： EventControlThread
- 线程"DispSync"：DispSyncThread


  HWComposer.hook_vsync
    HWComposer.vsync
      SurfaceFlinger.onVSyncReceived
        DispSync.addResyncSample
          DispSync.updateModelLocked
            DispSyncThread.updateModel
              DispSyncThread.threadLoop (换线程"DispSync")
                DispSyncSource.onDispSyncEvent
                  EventThread.onVSyncEvent
                     EventThread.waitForEvent(换线程"EventThread")
                      EventThread.Connection.postEvent
                        DisplayEventReceiver.sendEvents
                          ...
                          MessageQueue::eventReceiver
                            MessageQueue::Handler::dispatchRefresh
                              ...
                              MessageQueue::Handler::handleMessage
                                SurfaceFlinger.onMessageReceived
                                  SurfaceFlinger.handleMessageRefresh
