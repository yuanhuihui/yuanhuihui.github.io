

    frameworks/native/services/surfaceflinger/
      - main_surfaceflinger.cpp
      - SurfaceFlinger.cpp


## 一. 概述

    service surfaceflinger /system/bin/surfaceflinger
        class core
        user system
        group graphics drmrpc
        onrestart restart zygote
        writepid /dev/cpuset/system-background/tasks

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

### 2.2
### 2.3 init

    void SurfaceFlinger::init() {
        ALOGI(  "SurfaceFlinger's main thread ready to run. "
                "Initializing graphics H/W...");

        Mutex::Autolock _l(mStateLock);

        // initialize EGL for the default display
        mEGLDisplay = eglGetDisplay(EGL_DEFAULT_DISPLAY);
        eglInitialize(mEGLDisplay, NULL, NULL);

        // Initialize the H/W composer object.  There may or may not be an
        // actual hardware composer underneath.
        mHwc = new HWComposer(this,
                *static_cast<HWComposer::EventHandler *>(this));

        // get a RenderEngine for the given display / config (can't fail)
        mRenderEngine = RenderEngine::create(mEGLDisplay, mHwc->getVisualID());

        // retrieve the EGL context that was selected/created
        mEGLContext = mRenderEngine->getEGLContext();

        LOG_ALWAYS_FATAL_IF(mEGLContext == EGL_NO_CONTEXT,
                "couldn't create EGLContext");

        // initialize our non-virtual displays
        for (size_t i=0 ; i<DisplayDevice::NUM_BUILTIN_DISPLAY_TYPES ; i++) {
            DisplayDevice::DisplayType type((DisplayDevice::DisplayType)i);
            // set-up the displays that are already connected
            if (mHwc->isConnected(i) || type==DisplayDevice::DISPLAY_PRIMARY) {
                // All non-virtual displays are currently considered secure.
                bool isSecure = true;
                createBuiltinDisplayLocked(type);
                wp<IBinder> token = mBuiltinDisplays[i];

                sp<IGraphicBufferProducer> producer;
                sp<IGraphicBufferConsumer> consumer;
                BufferQueue::createBufferQueue(&producer, &consumer,
                        new GraphicBufferAlloc());

                sp<FramebufferSurface> fbs = new FramebufferSurface(*mHwc, i,
                        consumer);
                int32_t hwcId = allocateHwcDisplayId(type);
                sp<DisplayDevice> hw = new DisplayDevice(this,
                        type, hwcId, mHwc->getFormat(hwcId), isSecure, token,
                        fbs, producer,
                        mRenderEngine->getEGLConfig());
                if (i > DisplayDevice::DISPLAY_PRIMARY) {
                    // FIXME: currently we don't get blank/unblank requests
                    // for displays other than the main display, so we always
                    // assume a connected display is unblanked.
                    ALOGD("marking display %zu as acquired/unblanked", i);
                    hw->setPowerMode(HWC_POWER_MODE_NORMAL);
                }
                mDisplays.add(token, hw);
            }
        }

        // make the GLContext current so that we can create textures when creating Layers
        // (which may happens before we render something)
        getDefaultDisplayDevice()->makeCurrent(mEGLDisplay, mEGLContext);

        // start the EventThread
        sp<VSyncSource> vsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                vsyncPhaseOffsetNs, true, "app");
        mEventThread = new EventThread(vsyncSrc);
        sp<VSyncSource> sfVsyncSrc = new DispSyncSource(&mPrimaryDispSync,
                sfVsyncPhaseOffsetNs, true, "sf");
        mSFEventThread = new EventThread(sfVsyncSrc);
        mEventQueue.setEventThread(mSFEventThread);

        mEventControlThread = new EventControlThread(this);
        mEventControlThread->run("EventControl", PRIORITY_URGENT_DISPLAY);

        // set a fake vsync period if there is no HWComposer
        if (mHwc->initCheck() != NO_ERROR) {
            mPrimaryDispSync.setPeriod(16666667);
        }

        // initialize our drawing state
        mDrawingState = mCurrentState;

        // set initial conditions (e.g. unblank default device)
        initializeDisplays();

        // start boot animation
        startBootAnim();
    }

### 2.4 run

    void SurfaceFlinger::run() {
        do {
            waitForEvent();
        } while (true);
    }
