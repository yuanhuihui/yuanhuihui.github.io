---
layout: post
title:  "WMS之启动篇"
date:   2017-01-08 20:32:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析WMS的启动过程。


## 一. 概述

- Surface:代表画布
- WMS: 添加window的过程主要功能是添加Surface,管理所有的Surface布局,以及Z轴排序问题;
- SurfaceFinger: 将Surface按次序混合并显示到物理屏幕上;

### 1.1 类图


![wms_relation](/images/wms/wms_relation.jpg)

说明: [点击查看大图](http://gityuan.com/images/wms/wms_relation.jpg)

- WMS继承于`IWindowManager.Stub`, 作为Binder服务端;
- WMS的成员变量mSessions保存着所有的Session对象,Session继承于`IWindowSession.Stub`, 作为Binder服务端;
- 成员变量mPolicy: 实例对象为PhoneWindowManager,用于实现各种窗口相关的策略;
- 成员变量mChoreographer: 用于控制窗口动画,屏幕旋转等操作;
- 成员变量mDisplayContents: 记录一组DisplayContent对象,这个跟多屏输出相关;
- 成员变量mTokenMap: 保存所有的WindowToken对象; 以IBinder为key,可以是IAppWindowToken或者其他Binder的Bp端;
    - 另一端情况:ActivityRecord.Token extends IApplicationToken.Stub
- 成员变量mWindowMap: 保存所有的WindowState对象;以IBinder为key, 是IWindow的Bp端;
    - 另一端情况: ViewRootImpl.W extends IWindow.Stub
- 一般地,每一个窗口都对应一个WindowState对象, 该对象的成员变量mClient用于跟应用端交互,成员变量mToken用于跟AMS交互.

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
    
在“android.display”线程中执行WindowManagerService对象的初始化过程，其中`final H mH = new H();`此处H继承于Handler，无参初始化的过程，便会采用当前所在线程
的Looper。那就是说WindowManagerService.H.handleMessage()方法运行在“android.display”线程。 

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
        //当前线程跟当前Handler都指向同一个Looper,则直接运行
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
此处是指"android.ui"线程, 由于该方法本身运行在"android.display"线程. 也就意味着"android.display"线程会进入等待状态,
直到handler线程执行完成后再唤醒"android.display"线程. 那么PWM.init()便是运行在"android.ui"线程,属于同步阻塞操作.

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

前面小节[2.1 ~ 2.4]介绍了WMS.main()方法, 接下来便是开始执行WMS.displayReady().

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
    
## 三. 总结

整个启动过程涉及3个线程: system_server主线程, "android.display", "android.ui", 整个过程是采用阻塞方式(利用Handler.runWithScissors)执行的.
其中WindowManagerService.mH的Looper运行在 "android.display"进程，也就意味着WMS.H.handleMessage()在该线程执行。
流程如下:

![wms_startup](/images/wms/wms_startup.jpg)
