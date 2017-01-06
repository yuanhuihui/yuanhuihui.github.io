---
layout: post
title:  "WindowManagerService启动篇"
date:   2015-05-31 20:30:00
catalog:  true
tags:
    - android
    - 组件
---

## 一. 概述

- Surface:代表画布
- WMS: 添加window的过程主要功能是添加Surface,管理所有的Surface布局,以及Z轴排序问题;
- SurfaceFinger: 将Surface按次序混合并显示到物理屏幕上;

## 二. 启动过程

    private void startOtherServices() {
        ...
        // [见小节2.1]
        WindowManagerService wm = WindowManagerService.main(context, inputManager,
        mFactoryTestMode != FactoryTest.FACTORY_TEST_LOW_LEVEL,
        !mFirstBoot, mOnlyCore);
        
        wm.displayReady(); // [见小节2.5]
        ...
        wm.systemReady(); // [见小节2.6]
    }


### 2.1 WMS.main
[-> WindowManagerService.java]

    public static WindowManagerService main(final Context context,
            final InputManagerService im,
            final boolean haveInputMethods, final boolean showBootMsgs,
            final boolean onlyCore) {

        final WindowManagerService[] holder = new WindowManagerService[1];
        
        DisplayThread.getHandler().runWithScissors(new Runnable() {
            @Override
            public void run() {
                //运行在"android.display"线程[见小节2.2]
                holder[0] = new WindowManagerService(context, im,
                        haveInputMethods, showBootMsgs, onlyCore);
            }
        }, 0);
        return holder[0];
    }


### 2.2 WindowManagerService

    private WindowManagerService(Context context, InputManagerService inputManager,
            boolean haveInputMethods, boolean showBootMsgs, boolean onlyCore) {
        mContext = context;
        mHaveInputMethods = haveInputMethods;
        mAllowBootMessages = showBootMsgs;
        mOnlyCore = onlyCore;
        ...
        mInputManager = inputManager; 
        mDisplayManagerInternal = LocalServices.getService(DisplayManagerInternal.class);
        mDisplaySettings = new DisplaySettings();
        mDisplaySettings.readSettingsLocked();

        LocalServices.addService(WindowManagerPolicy.class, mPolicy);
        mPointerEventDispatcher = new PointerEventDispatcher(mInputManager.monitorInput(TAG));

        mFxSession = new SurfaceSession();
        mDisplayManager = (DisplayManager)context.getSystemService(Context.DISPLAY_SERVICE);
        mDisplays = mDisplayManager.getDisplays();

        for (Display display : mDisplays) {
            //创建DisplayContent[见小节2.2.1]
            createDisplayContentLocked(display);
        }

        mKeyguardDisableHandler = new KeyguardDisableHandler(mContext, mPolicy);
        ...

        mAppTransition = new AppTransition(context, mH);
        mAppTransition.registerListenerLocked(mActivityManagerAppTransitionNotifier);
        mActivityManager = ActivityManagerNative.getDefault();
        ...
        mAnimator = new WindowAnimator(this);
        

        LocalServices.addService(WindowManagerInternal.class, new LocalService());
        //初始化策略[见小节2.3]
        initPolicy();

        Watchdog.getInstance().addMonitor(this);

        SurfaceControl.openTransaction();
        try {
            createWatermarkInTransaction();
            mFocusedStackFrame = new FocusedStackFrame(
                    getDefaultDisplayContentLocked().getDisplay(), mFxSession);
        } finally {
            SurfaceControl.closeTransaction();
        }

        updateCircularDisplayMaskIfNeeded();
        showEmulatorDisplayOverlayIfNeeded();
    }

#### 2.2.1  WMS.createDisplayContentLocked

    public DisplayContent getDisplayContentLocked(final int displayId) {
        DisplayContent displayContent = mDisplayContents.get(displayId);
        if (displayContent == null) {
            final Display display = mDisplayManager.getDisplay(displayId);
            if (display != null) {
                displayContent = newDisplayContentLocked(display);
            }
        }
        return displayContent;
    }

创建DisplayContent,用于支持多屏幕的功能.比如目前除了本身真实的屏幕之外,还有Wifi display虚拟屏幕.

### 2.3 WMS.initPolicy

    private void initPolicy() {
        //运行在"android.ui"线程
        UiThread.getHandler().runWithScissors(new Runnable() {
            @Override
            public void run() {
                WindowManagerPolicyThread.set(Thread.currentThread(), Looper.myLooper());
                //此处mPolicy为PhoneWindowManager.[见小节2.4]
                mPolicy.init(mContext, WindowManagerService.this, WindowManagerService.this);
            }
        }, 0);
    }

#### 2.3.1 Handler.runWithScissors
[-> Handler.java]

    public final boolean runWithScissors(final Runnable r, long timeout) {
        //当前线程跟当前Handler都指向同一个Looper, 则直接运行
        if (Looper.myLooper() == mLooper) {
            r.run();
            return true;
        }

        BlockingRunnable br = new BlockingRunnable(r);
        //[见小节2.3.2]
        return br.postAndWait(this, timeout);
    }
    
#### 2.3.2 postAndWait
[-> Handler.java ::BlockingRunnable]

    private static final class BlockingRunnable implements Runnable {
        private final Runnable mTask;
        private boolean mDone;

        public BlockingRunnable(Runnable task) {
            mTask = task;
        }

        public void run() {
            try {
                mTask.run();
            } finally {
                synchronized (this) {
                    mDone = true;
                    notifyAll();
                }
            }
        }

        public boolean postAndWait(Handler handler, long timeout) {
            if (!handler.post(this)) {
                return false;
            }

            synchronized (this) {
                if (timeout > 0) {
                    final long expirationTime = SystemClock.uptimeMillis() + timeout;
                    while (!mDone) {
                        long delay = expirationTime - SystemClock.uptimeMillis();
                        if (delay <= 0) {
                            return false; // timeout
                        }
                        try {
                            wait(delay);
                        } catch (InterruptedException ex) {
                        }
                    }
                } else {
                    while (!mDone) {
                        try {
                            wait();
                        } catch (InterruptedException ex) {
                        }
                    }
                }
            }
            return true;
        }
    }

由此可见, BlockingRunnable.postAndWait()方法是阻塞操作,就是先将消息放入Handler所指向的线程,
此处是指"android.ui"线程, 由于该方法本身运行在system_server主线程. 也就意味着system_server线程会进入等待状态,
直到handler线程执行完成后再唤醒system_server主线程. 那么PWM.init()便是运行在"android.ui"线程,属于同步阻塞操作.

### 2.4 PWM.init
[-> PhoneWindowManager.java]

    public void init(Context context, IWindowManager windowManager,
        WindowManagerFuncs windowManagerFuncs) {
        mContext = context;
        mWindowManager = windowManager;
        mWindowManagerFuncs = windowManagerFuncs;
        mWindowManagerInternal = LocalServices.getService(WindowManagerInternal.class);
        mActivityManagerInternal = LocalServices.getService(ActivityManagerInternal.class);
        mDreamManagerInternal = LocalServices.getService(DreamManagerInternal.class);
        mPowerManagerInternal = LocalServices.getService(PowerManagerInternal.class);
        mAppOpsManager = (AppOpsManager) mContext.getSystemService(Context.APP_OPS_SERVICE);
        ...

        mHandler = new PolicyHandler(); //运行在"android.ui"线程
        mWakeGestureListener = new MyWakeGestureListener(mContext, mHandler);
        mOrientationListener = new MyOrientationListener(mContext, mHandler);
        ...

        mPowerManager = (PowerManager)context.getSystemService(Context.POWER_SERVICE);
        mBroadcastWakeLock = mPowerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "PhoneWindowManager.mBroadcastWakeLock");
        mPowerKeyWakeLock = mPowerManager.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK,
                "PhoneWindowManager.mPowerKeyWakeLock");
        ...
   
        mGlobalKeyManager = new GlobalKeyManager(mContext);
        ...
        
        if (!mPowerManager.isInteractive()) {
            startedGoingToSleep(WindowManagerPolicy.OFF_BECAUSE_OF_USER);
            finishedGoingToSleep(WindowManagerPolicy.OFF_BECAUSE_OF_USER);
        }

        mWindowManagerInternal.registerAppTransitionListener(
                mStatusBarController.getAppTransitionListener());
    }

执行完[2.1]WMS.main()方法,接下来便是开始执行WMS.systemReady().

### 2.5 WMS.displayReady

    public void displayReady() {
        for (Display display : mDisplays) {
            displayReady(display.getDisplayId());
        }

        synchronized(mWindowMap) {
            final DisplayContent displayContent = getDefaultDisplayContentLocked();
            readForcedDisplayPropertiesLocked(displayContent);
            mDisplayReady = true;
        }

        mActivityManager.updateConfiguration(null);

        synchronized(mWindowMap) {
            mIsTouchDevice = mContext.getPackageManager().hasSystemFeature(
                    PackageManager.FEATURE_TOUCHSCREEN);
            configureDisplayPolicyLocked(getDefaultDisplayContentLocked());
        }

        mActivityManager.updateConfiguration(null);
    }

### 2.6 WMS.systemReady

    public void systemReady() {
        mPolicy.systemReady();
    }
    
#### 2.6.1  PWM.systemReady
[-> PhoneWindowManager.java]

    public void systemReady() {
        mKeyguardDelegate = new KeyguardServiceDelegate(mContext);
        mKeyguardDelegate.onSystemReady();

        readCameraLensCoverState();
        updateUiMode();
        boolean bindKeyguardNow;
        synchronized (mLock) {
            updateOrientationListenerLp();
            mSystemReady = true;
            
            mHandler.post(new Runnable() {
                public void run() {
                    updateSettings();
                }
            });

            bindKeyguardNow = mDeferBindKeyguard;
            if (bindKeyguardNow) {
                mDeferBindKeyguard = false;
            }
        }

        if (bindKeyguardNow) {
            mKeyguardDelegate.bindService(mContext);
            mKeyguardDelegate.onBootCompleted();
        }
        mSystemGestures.systemReady();
    }