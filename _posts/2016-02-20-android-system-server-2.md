---
layout: post
title:  "Android系统启动-SystemServer下篇"
date:   2016-02-20 21:12:40
catalog:  true
tags:
    - android
    - 系统启动

---

> 基于Android 6.0的源码剖析， 分析Android启动过程的system_server进程

    frameworks/base/core/java/android/app/ActivityThread.java
    frameworks/base/core/java/android/app/LoadedApk.java
    frameworks/base/core/java/android/app/ContextImpl.java
    frameworks/base/core/java/com/android/server/LocalServices.java
    frameworks/base/services/java/com/android/server/SystemServer.java
    frameworks/base/services/core/java/com/android/server/SystemServiceManager.java
    frameworks/base/services/core/java/com/android/server/ServiceThread.java
    frameworks/base/services/core/java/com/android/server/pm/Installer.java
    frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java


## 一、 流程分析

上篇文章[Android系统启动-systemServer上篇](http://gityuan.com/2016/02/14/android-system-server/) 从Zygote一路启动到SystemServer的过程。
简单回顾下，在RuntimeInit.java中invokeStaticMain方法通过创建并抛出异常ZygoteInit.MethodAndArgsCaller，在`ZygoteInit.java`中的main()方法会捕捉该异常，并调用`caller.run()`，再通过反射便会调用到SystemServer.main()方法.

那么本文就接着该方法执行流程,整个方法调用栈:

    SystemServer.main
        SystemServer.run
            createSystemContext
                ActivityThread.systemMain
                    ActivityThread.attach
                        LoadedApk.makeApplication
                ActivityThread.getSystemContext
                    ContextImpl.createSystemContext
            startBootstrapServices();
            startCoreServices();
            startOtherServices();
            Looper.loop();
            

### 1.1 SystemServer.main

    public final class SystemServer {
        ...
        public static void main(String[] args) {
            //先初始化SystemServer对象，再调用对象的run()方法， 【见小节1.2】
            new SystemServer().run();
        }
    }

### 1.2 SystemServer.run

    private void run() {
        //当系统时间比1970年更早，就设置当前系统时间为1970年
        if (System.currentTimeMillis() < EARLIEST_SUPPORTED_TIME) {
            SystemClock.setCurrentTimeMillis(EARLIEST_SUPPORTED_TIME);
        }

        //变更虚拟机的库文件，对于Android 6.0默认采用的是libart.so
        SystemProperties.set("persist.sys.dalvik.vm.lib.2", VMRuntime.getRuntime().vmLibrary());

        //isEnabled()为true，则开启采用分析器
        if (SamplingProfilerIntegration.isEnabled()) {
            SamplingProfilerIntegration.start();
            mProfilerSnapshotTimer = new Timer();
            //system_server每隔1小时采用一次，并保存结果到system_server文件
            mProfilerSnapshotTimer.schedule(new TimerTask() {

                public void run() {
                    SamplingProfilerIntegration.writeSnapshot("system_server", null);
                }
            }, SNAPSHOT_INTERVAL, SNAPSHOT_INTERVAL);
        }

        //清除vm内存增长上限，由于启动过程需要较多的虚拟机内存空间
        VMRuntime.getRuntime().clearGrowthLimit();

        //设置内存的可能有效使用率为0.8
        VMRuntime.getRuntime().setTargetHeapUtilization(0.8f);
        // 针对部分设备依赖于运行时就产生指纹信息，因此需要在开机完成前已经定义
        Build.ensureFingerprintProperty();

        //访问环境变量前，需要明确地指定用户
        Environment.setUserRequired(true);

        //确保当前系统进程的binder调用，总是运行在前台优先级(foreground priority)
        BinderInternal.disableBackgroundScheduling(true);
        android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_FOREGROUND);
        android.os.Process.setCanSelfBackground(false);

        // 主线程looper就在当前线程运行
        Looper.prepareMainLooper();

        //加载android_servers.so库，该库包含的源码在frameworks/base/services/目录下
        System.loadLibrary("android_servers");

        //检测上次关机过程是否失败，该方法可能不会返回[见小节1.2.1]
        performPendingShutdown();

        //初始化系统上下文 【见小节1.3】
        createSystemContext();

        //创建系统服务管理
        mSystemServiceManager = new SystemServiceManager(mSystemContext);
        //将mSystemServiceManager添加到本地服务的成员sLocalServiceObjects
        LocalServices.addService(SystemServiceManager.class, mSystemServiceManager);


        //启动各种系统服务
        try {
            startBootstrapServices(); // 启动引导服务【见小节1.4】
            startCoreServices();      // 启动核心服务【见小节1.5】
            startOtherServices();     // 启动其他服务【见小节1.6】
        } catch (Throwable ex) {
            Slog.e("System", "************ Failure starting system services", ex);
            throw ex;
        }

        //用于debug版本，将log事件不断循环地输出到dropbox（用于分析）
        if (StrictMode.conditionallyEnableDebugLogging()) {
            Slog.i(TAG, "Enabled StrictMode for system server main thread.");
        }
        //一直循环执行
        Looper.loop();
        throw new RuntimeException("Main thread loop unexpectedly exited");
    }

LocalServices通过用静态Map变量sLocalServiceObjects，来保存以服务类名为key，以具体服务对象为value的Map结构。

#### 1.2.1  performPendingShutdown
[-->SystemServer.java]

    private void performPendingShutdown() {
        final String shutdownAction = SystemProperties.get(
                ShutdownThread.SHUTDOWN_ACTION_PROPERTY, "");
        if (shutdownAction != null && shutdownAction.length() > 0) {
            boolean reboot = (shutdownAction.charAt(0) == '1');

            final String reason;
            if (shutdownAction.length() > 1) {
                reason = shutdownAction.substring(1, shutdownAction.length());
            } else {
                reason = null;
            }
            // 当"sys.shutdown.requested"值不为空,则会重启或者关机
            ShutdownThread.rebootOrShutdown(null, reboot, reason);
        }
    }
    
### 1.3 SS.createSystemContext
[-->SystemServer.java]

    private void createSystemContext() {
        //创建ActivityThread对象【见小节1.3.1】
        ActivityThread activityThread = ActivityThread.systemMain();
        //创建ContextImpl、LoadedApk对象【见小节1.3.2】
        mSystemContext = activityThread.getSystemContext();
        //设置主题
        mSystemContext.setTheme(android.R.style.Theme_DeviceDefault_Light_DarkActionBar);
    }

#### 1.3.1  AT.systemMain
[-> ActivityThread.java]

    public static ActivityThread systemMain() {
        //对于低内存的设备，禁用硬件加速
        if (!ActivityManager.isHighEndGfx()) {
            HardwareRenderer.disable(true);
        } else {
            HardwareRenderer.enableForegroundTrimming();
        }
        // 创建ActivityThread
        ActivityThread thread = new ActivityThread();
        // 创建Application以及调用其onCreate()方法【见小节1.3.1.1】
        thread.attach(true);
        return thread;
    }

##### 1.3.1.1  AT.attach
[-> ActivityThread.java]

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system;

        if (!system) {
        ...

        } else {
            //system=true,进入此分支
            android.ddm.DdmHandleAppName.setAppName("system_process", UserHandle.myUserId());
            mInstrumentation = new Instrumentation();
            // 创建应用上下文
            ContextImpl context = ContextImpl.createAppContext(
                    this, getSystemContext().mPackageInfo);
            //创建Application 【见小节1.3.1.2】
            mInitialApplication = context.mPackageInfo.makeApplication(true, null);
            //调用Application.onCreate()方法
            mInitialApplication.onCreate();
            ...
        }

        //添加dropbox log信息到libcore
        DropBox.setReporter(new DropBoxReporter());

        // 设置回调方法
        ViewRootImpl.addConfigCallback(new ComponentCallbacks2() {
            public void onConfigurationChanged(Configuration newConfig) {...}
            public void onLowMemory() {}
            public void onTrimMemory(int level) {}
        });
    }

主要工作是创建应用上下文ContextImpl，创建Application以及调用其onCreate()方法，设置DropBox以及ComponentCallbacks2回调方法。

##### 1.3.1.2  makeApplication
[-> LoadedApk.java]

    public Application makeApplication(boolean forceDefaultAppClass,
            Instrumentation instrumentation) {
        if (mApplication != null) {
            return mApplication;
        }

        Application app = null;
        String appClass = mApplicationInfo.className;
        if (forceDefaultAppClass || (appClass == null)) {
            appClass = "android.app.Application"; //设置class名
        }

        java.lang.ClassLoader cl = getClassLoader();
        if (!mPackageName.equals("android")) {
            initializeJavaContextClassLoader(); //不进入该分支
        }
        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        // 创建Application
        app = mActivityThread.mInstrumentation.newApplication(cl, appClass, appContext);
        appContext.setOuterContext(app);
        //Application添加到应用列表。
        mActivityThread.mAllApplications.add(app);
        mApplication = app;
        ...

        return app;
    }

在该方法调用之前，已经创建了LoadedApk对象，该对象的成员变量mPackageName="android"; mClassLoader = ClassLoader.getSystemClassLoader();


#### 1.3.2 AT.getSystemContext
[-> ActivityThread.java]

    public ContextImpl getSystemContext() {
        synchronized (this) {
            if (mSystemContext == null) {
                //创建ContextImpl对象【见小节1.3.2.1】
                mSystemContext = ContextImpl.createSystemContext(this);
            }
            return mSystemContext;
        }
    }

##### 1.3.2.1 CI.createSystemContext
[-> ContextImpl.java]

    static ContextImpl createSystemContext(ActivityThread mainThread) {
        //创建LoadedApk对象
        LoadedApk packageInfo = new LoadedApk(mainThread);
        //创建ContextImpl对象
        ContextImpl context = new ContextImpl(null, mainThread,
                packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
        context.mResources.updateConfiguration(context.mResourcesManager.getConfiguration(),
                context.mResourcesManager.getDisplayMetricsLocked());
        return context;
    }

运行到这里，system_server的准备环境基本完成，接下来开始system_server中最为核心的过程，启动系统服务。
通过`startBootstrapServices()`, `startCoreServices()`, `startOtherServices()`3个方法。

### 1.4 SS.startBootstrapServices
[-->SystemServer.java]

    private void startBootstrapServices() {
        //阻塞等待与installd建立socket通道
        Installer installer = mSystemServiceManager.startService(Installer.class);

        //启动服务ActivityManagerService
        mActivityManagerService = mSystemServiceManager.startService(
                ActivityManagerService.Lifecycle.class).getService();
        mActivityManagerService.setSystemServiceManager(mSystemServiceManager);
        mActivityManagerService.setInstaller(installer);

        //启动服务PowerManagerService
        mPowerManagerService = mSystemServiceManager.startService(PowerManagerService.class);

        //初始化power management
        mActivityManagerService.initPowerManagement();

        //启动服务LightsService
        mSystemServiceManager.startService(LightsService.class);

        //启动服务DisplayManagerService
        mDisplayManagerService = mSystemServiceManager.startService(DisplayManagerService.class);

        //Phase100: 在初始化package manager之前，需要默认的显示.
        mSystemServiceManager.startBootPhase(SystemService.PHASE_WAIT_FOR_DEFAULT_DISPLAY);

        //当设备正在加密时，仅运行核心
        String cryptState = SystemProperties.get("vold.decrypt");
        if (ENCRYPTING_STATE.equals(cryptState)) {
            mOnlyCore = true;
        } else if (ENCRYPTED_STATE.equals(cryptState)) {
            mOnlyCore = true;
        }

        //启动服务PackageManagerService
        mPackageManagerService = PackageManagerService.main(mSystemContext, installer,
                mFactoryTestMode != FactoryTest.FACTORY_TEST_OFF, mOnlyCore);
        mFirstBoot = mPackageManagerService.isFirstBoot();
        mPackageManager = mSystemContext.getPackageManager();

        //启动服务UserManagerService，新建目录/data/user/
        ServiceManager.addService(Context.USER_SERVICE, UserManagerService.getInstance());

        AttributeCache.init(mSystemContext);

        //设置AMS
        mActivityManagerService.setSystemProcess();

        //启动传感器服务
        startSensorService();
    }

该方法所创建的服务：ActivityManagerService, PowerManagerService, LightsService, DisplayManagerService， PackageManagerService， UserManagerService， sensor服务.


### 1.5 SS.startCoreServices

    private void startCoreServices() {
        //启动服务BatteryService，用于统计电池电量，需要LightService.
        mSystemServiceManager.startService(BatteryService.class);

        //启动服务UsageStatsService，用于统计应用使用情况
        mSystemServiceManager.startService(UsageStatsService.class);
        mActivityManagerService.setUsageStatsManager(
                LocalServices.getService(UsageStatsManagerInternal.class));

        mPackageManagerService.getUsageStatsIfNoPackageUsageInfo();

        //启动服务WebViewUpdateService
        mSystemServiceManager.startService(WebViewUpdateService.class);
    }

启动服务BatteryService，UsageStatsService，WebViewUpdateService。

### 1.6 SS.startOtherServices

该方法比较长，有近千行代码，逻辑很简单，主要是启动一系列的服务，这里就不具体列举源码了，在第四节直接对其中的服务进行一个简单分类。


        private void startOtherServices() {
            ...
            SystemConfig.getInstance();
            mContentResolver = context.getContentResolver(); // resolver
            ...
            mActivityManagerService.installSystemProviders(); //provider
            mSystemServiceManager.startService(AlarmManagerService.class); // alarm
            // watchdog
            watchdog.init(context, mActivityManagerService); 
            inputManager = new InputManagerService(context); // input
            wm = WindowManagerService.main(...); // window
            inputManager.start();  //启动input
            mDisplayManagerService.windowManagerAndInputReady();
            ...
            mSystemServiceManager.startService(MOUNT_SERVICE_CLASS); // mount
            mPackageManagerService.performBootDexOpt();  // dexopt操作
            ActivityManagerNative.getDefault().showBootMessage(...); //显示启动界面
            ...
            statusBar = new StatusBarManagerService(context, wm); //statusBar
            //dropbox
            ServiceManager.addService(Context.DROPBOX_SERVICE,
                        new DropBoxManagerService(context, new File("/data/system/dropbox")));
             mSystemServiceManager.startService(JobSchedulerService.class); //JobScheduler
             lockSettings.systemReady(); //lockSettings

            //phase480 和phase500
            mSystemServiceManager.startBootPhase(SystemService.PHASE_LOCK_SETTINGS_READY);
            mSystemServiceManager.startBootPhase(SystemService.PHASE_SYSTEM_SERVICES_READY);
            ...
            // 准备好window, power, package, display服务
            wm.systemReady();
            mPowerManagerService.systemReady(...);
            mPackageManagerService.systemReady();
            mDisplayManagerService.systemReady(...);
            
            //[见小节1.6.1]
            mActivityManagerService.systemReady(new Runnable() {...});
        }

#### 1.6.1 AMS.systemReady
AMS.systemReady()的过程并非立刻执行Runnable中的run()方法, 如下方法:

    public void systemReady(final Runnable goingCallback) {
        synchronized(this) {
            ...
            mLocalDeviceIdleController
                    = LocalServices.getService(DeviceIdleController.LocalService.class);
            if (!mDidUpdate) {
                ...
                mWaitingUpdate = deliverPreBootCompleted(new Runnable() {
                    public void run() {
                        synchronized (ActivityManagerService.this) {
                            mDidUpdate = true;
                        }
                        showBootMessage(mContext.getText(
                                R.string.android_upgrading_complete),
                                false);
                        writeLastDonePreBootReceivers(doneReceivers);
                        systemReady(goingCallback);
                    }
                }, doneReceivers, UserHandle.USER_OWNER);
                ...
                mDidUpdate = true;
            }
            
            mAppOpsService.systemReady();
            mSystemReady = true; //system处于ready状态
        }

        ArrayList<ProcessRecord> procsToKill = null;
        synchronized(mPidsSelfLocked) {
            for (int i=mPidsSelfLocked.size()-1; i>=0; i--) {
                ProcessRecord proc = mPidsSelfLocked.valueAt(i);
                //非persistent进程,加入procsToKill
                if (!isAllowedWhileBooting(proc.info)){
                    if (procsToKill == null) {
                        procsToKill = new ArrayList<ProcessRecord>();
                    }
                    procsToKill.add(proc);
                }
            }
        }

        synchronized(this) {
            if (procsToKill != null) {
                //杀掉procsToKill中的进程, 杀掉进程且不允许重启
                for (int i=procsToKill.size()-1; i>=0; i--) {
                    ProcessRecord proc = procsToKill.get(i);
                    removeProcessLocked(proc, true, false, "system update done");
                }
            }
            mProcessesReady = true; //process处于ready状态
        }

        Slog.i(TAG, "System now ready");
        ...

        //[见小节1.6.2]
        if (goingCallback != null) goingCallback.run();
        ...

        mSystemServiceManager.startUser(mCurrentUserId);
        synchronized (this) {
            if (mFactoryTest != FactoryTest.FACTORY_TEST_LOW_LEVEL) {
                //通过pms获取所有的persistent进程
                List apps = AppGlobals.getPackageManager().
                    getPersistentApplications(STOCK_PM_FLAGS);
                if (apps != null) {
                    int N = apps.size();
                    int i;
                    for (i=0; i<N; i++) {
                        ApplicationInfo info = (ApplicationInfo)apps.get(i);
                        if (info != null && !info.packageName.equals("android")) {
                            //启动persistent进程
                            addAppLocked(info, false, null);
                        }
                    }
                }
            }

            mBooting = true; // 启动初始Activity
            startHomeActivityLocked(mCurrentUserId, "systemReady");

            ...
            long ident = Binder.clearCallingIdentity();
            try {
                //system发送广播UUSER_STARTED
                Intent intent = new Intent(Intent.ACTION_USER_STARTED);
                intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY
                        | Intent.FLAG_RECEIVER_FOREGROUND);
                intent.putExtra(Intent.EXTRA_USER_HANDLE, mCurrentUserId);
                broadcastIntentLocked(...);  

                //system发送广播USER_STARTING
                intent = new Intent(Intent.ACTION_USER_STARTING);
                intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY);
                intent.putExtra(Intent.EXTRA_USER_HANDLE, mCurrentUserId);
                broadcastIntentLocked(...); 
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
            
            mStackSupervisor.resumeTopActivitiesLocked();
            sendUserSwitchBroadcastsLocked(-1, mCurrentUserId);
        }
    }

#### 1.6.2 goingCallback.run()
此处的goingCallback,便是在startOtherServices()过程中传递进来的参数

    private void startOtherServices() {
        ...
        mActivityManagerService.systemReady(new Runnable() {
            public void run() {
                
              //phase550
                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_ACTIVITY_MANAGER_READY);

                mActivityManagerService.startObservingNativeCrashes();
                //启动WebView
                WebViewFactory.prepareWebViewInSystemServer();
                //启动系统UI
                startSystemUi(context);

                // 执行一系列服务的systemReady方法
                networkScoreF.systemReady();
                networkManagementF.systemReady();
                networkStatsF.systemReady();
                networkPolicyF.systemReady();
                connectivityF.systemReady();
                audioServiceF.systemReady();
                Watchdog.getInstance().start(); //Watchdog开始工作
                
              //phase600
                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_THIRD_PARTY_APPS_CAN_START);
                        
                // 执行一系列服务的systemRunning方法
                wallpaper.systemRunning();
                inputMethodManager.systemRunning(statusBarF);
                location.systemRunning();
                countryDetector.systemRunning();
                networkTimeUpdater.systemRunning();
                commonTimeMgmtService.systemRunning();
                textServiceManagerService.systemRunning();
                assetAtlasService.systemRunning();
                inputManager.systemRunning();
                telephonyRegistry.systemRunning();
                mediaRouter.systemRunning();
                mmsService.systemRunning();
            }
        });
    }

到此, System_server主线程的启动工作,总算完成, 进入Looper.loop()状态,等待其他线程通过handler发送消息再处理.

### 1.7 小结

**各个启动阶段所在源码位置：**

    public final class SystemServer {

        private void startBootstrapServices() {
          ...
          //phase100
          mSystemServiceManager.startBootPhase(SystemService.PHASE_WAIT_FOR_DEFAULT_DISPLAY);
          ...
        }

        private void startOtherServices() {
            ...
            //phase480 和phase500
            mSystemServiceManager.startBootPhase(SystemService.PHASE_LOCK_SETTINGS_READY);
            mSystemServiceManager.startBootPhase(SystemService.PHASE_SYSTEM_SERVICES_READY);
            ...
            mActivityManagerService.systemReady(new Runnable() {
               @Override
               public void run() {
                   //phase550
                   mSystemServiceManager.startBootPhase(
                           SystemService.PHASE_ACTIVITY_MANAGER_READY);
                   ...
                   //phase600
                   mSystemServiceManager.startBootPhase(
                           SystemService.PHASE_THIRD_PARTY_APPS_CAN_START);
                }
            }
        }
    }
    
其中AMS.systemReady()的大致过程如下:

    public final class ActivityManagerService extends ActivityManagerNative
        implements Watchdog.Monitor, BatteryStatsImpl.BatteryCallback {
            
        public void systemReady(final Runnable goingCallback) {
            ... //update相关
            mSystemReady = true;
            
            //杀掉所有非persistent进程
            removeProcessLocked(proc, true, false, "system update done");
            mProcessesReady = true; 

            goingCallback.run();  //[见小节1.6.2]
            
            addAppLocked(info, false, null); //启动所有的persistent进程
            mBooting = true; 
            
            //启动home
            startHomeActivityLocked(mCurrentUserId, "systemReady"); 
            //恢复栈顶的Activity
            mStackSupervisor.resumeTopActivitiesLocked();
        }
    }
    
## 二、启动系统服务

### 2.1 启动阶段
SystemServiceManager的`startBootPhase(）`方法贯穿整个阶段，启动阶段从`PHASE_WAIT_FOR_DEFAULT_DISPLAY`到`PHASE_BOOT_COMPLETED`，如下图：

![system_server服务启动流程](/images/boot/systemServer/system_server_boot_process.jpg)

**启动阶段顺序：**

1. `PHASE_WAIT_FOR_DEFAULT_DISPLAY=100`，该阶段等待Display有默认显示
2. `PHASE_LOCK_SETTINGS_READY=480`，进入该阶段服务能获取锁屏设置的数据
3. `PHASE_SYSTEM_SERVICES_READY=500`，进入该阶段服务能安全地调用核心系统服务，如PMS;
4. `PHASE_ACTIVITY_MANAGER_READY=550`，进入该阶段服务能广播Intent;
5. `PHASE_THIRD_PARTY_APPS_CAN_START=600`，启动完WebView, systemui, Watchdog,进入该阶段服务能start/bind第三方apps，app能通过Binder调用service;
6. `PHASE_BOOT_COMPLETED=1000`，该阶段是发生在Boot完成和home应用启动完毕。系统服务更倾向于监听该阶段，而不是注册广播ACTION_BOOT_COMPLETED，从而降低系统延迟。


接下来再说说简单每个阶段的大概完成的工作：

#### 2.1.1 Phase100

创建ActivityManagerService、PowerManagerService、LightsService、DisplayManagerService共4项服务；
接着则进入阶段`Phase100`，该阶段调用DisplayManagerService的`onBootPhase()`方法。

#### 2.1.2 Phase480

创建PackageManagerService、WindowManagerService、InputManagerService、NetworkManagerService、DropBoxManagerService/FingerprintService等服务
接着则进入阶段`Phase480`，该阶段调用DevicePolicyManagerService的`onBootPhase()`方法；

#### 2.1.3 Phase500

阶段480后,紧接着进入阶段500，中间并没有等待,实现该阶段的回调方法的服务较多，此处先省略。

#### 2.1.4 Phase550

WindowManagerService、PowerManagerService、PackageManagerService、DisplayManagerService分别依次执行`systemReady()`方法；然后ActivityManagerService进入`systemReady()`方法;
接着则进入阶段`Phase550`，实现该阶段的回调方法的服务较多，此处先省略

#### 2.1.5 Phase600

AMS启动native crash监控,，加载WebView，启动SystemUi；然后是NetworkScoreService、NetworkManagementService、NetworkStatsService、NetworkPolicyManagerService、ConnectivityService、AudioService分别依次执行`systemReady()`方法，然后是启动Watchdog。
接着则进入阶段`Phase600`，实现该阶段的回调方法的服务较多。

#### 2.1.6 Phase1000

WallpaperManagerService、InputMethodManagerService、LocationManagerService、CountryDetectorService、NetworkTimeUpdateService、CommonTimeManagementService、TextServicesManagerService、AssetAtlasService、InputManagerService、TelephonyRegistry、MediaRouterService、MmsServiceBroker这些服务依次执行其`systemRunning()`方法。
在经过一系列流程，再调用`AMS.finishBooting()`时，则进入阶段`Phase1000`。

到此，系统服务启动阶段完成就绪，system_server进程启动完成则进入`Looper.loop()`状态，随时待命，等待消息队列MessageQueue中的消息到来，则马上进入执行状态。

### 2.2 启动方式
system_server进程中的服务启动方式有两种，分别是SystemServiceManager的`startService()`和ServiceManager的`addService`

#### 2.2.1 startService

通过SystemServiceManager的`startService(Class<T> serviceClass)`用于启动继承于`SystemService`的服务。主要功能：

- 创建`serviceClass`类对象，将新建对象注册到SystemServiceManager的成员变量mServices;
- 调用新建对象的onStart()方法，即调用`serviceClass.onStart()`；
- 当系统启动到一个新的阶段Phase时，SystemServiceManager的`startBootPhase()`会循环遍历所有向`SystemServiceManager`注册过服务的`onBootPhase()`方法，即调用`serviceClass.onBootPhase()`。

例如：`mSystemServiceManager.startService(PowerManagerService.class);`

#### 2.2.2 addService

通过ServiceManager的`addService(String name, IBinder service)`用于初始化继承于`IBinder`的服务。主要功能:

- 将该服务向Native层的[serviceManager注册服务](http://gityuan.com/2015/11/14/binder-add-service/#addservice)。

例如：`ServiceManager.addService(Context.WINDOW_SERVICE, wm);`


### 三、服务类别

system_server进程，从源码角度划分为引导服务、核心服务、其他服务3类。

1. 引导服务(7个)：ActivityManagerService、PowerManagerService、LightsService、DisplayManagerService、PackageManagerService、UserManagerService、SensorService；
2. 核心服务(3个)：BatteryService、UsageStatsService、WebViewUpdateService；
3. 其他服务(70个+)：AlarmManagerService、VibratorService等。

合计总大约80个系统服务：

|---|---|---|
|`ActivityManagerService`|`PackageManagerService`|`WindowManagerService`|
|`PowerManagerService`|`BatteryService`|`BatteryStatsService`|
|`DreamManagerService`|`DropBoxManagerService`|`SamplingProfilerService`|
|`UsageStatsService`|`DiskStatsService`|`DeviceStorageMonitorService`|
|SchedulingPolicyService|`AlarmManagerService`|DeviceIdleController|
|ThermalObserver|JobSchedulerService|`AccessibilityManagerService`|
|DisplayManagerService|LightsService|`GraphicsStatsService`|
|StatusBarManagerService|NotificationManagerService|WallpaperManagerService|
|UiModeManagerService|AppWidgetService|LauncherAppsService|
|TextServicesManagerService|ContentService|LockSettingsService|
|InputMethodManagerService|InputManagerService|`MountService`|
|FingerprintService|TvInputManagerService|DockObserver|
|NetworkManagementService|NetworkScoreService|`NetworkStatsService`|
|NetworkPolicyManagerService|ConnectivityService|BluetoothService|
|WifiP2pService|WifiService|WifiScanningService|
|AudioService|MediaRouterService|VoiceInteractionManagerService|
|MediaProjectionManagerService|MediaSessionService|
|DevicePolicyManagerService|PrintManagerService|`BackupManagerService`|
|`UserManagerService`|AccountManagerService|`TrustManagerService`|
|`SensorService`|LocationManagerService|VibratorService|
|CountryDetectorService|GestureLauncherService|PersistentDataBlockService|
|EthernetService|WebViewUpdateService|ClipboardService|
|TelephonyRegistry|TelecomLoaderService|NsdService
|UpdateLockService|SerialService|SearchManagerService|
|CommonTimeManagementService|AssetAtlasService|ConsumerIrService|
|MidiServiceCameraService|TwilightService|RestrictionsManagerService|
|MmsServiceBroker|RttService|UsbService|

Service类别众多，其中表中加粗项是指博主挑选的较重要或者较常见的Service，并且在本博客中已经展开或者计划展开讲解的Service，当然如果有精力会讲解更多service，后续再更新。
