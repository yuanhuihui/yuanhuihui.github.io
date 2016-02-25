---
layout: post
title:  "Android系统启动-SystemServer篇(二)"
date:   2016-02-20 21:12:40
categories: android
excerpt:  Android系统启动-SystemServer篇(二)
---

* content
{:toc}


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



### 1.概述

system_server进程是由zygote进程fork生成的，本文是在讲述system_server承载了java framework的哪些系统服务。从上一篇文章[Android系统启动-systemServer上篇](http://www.yuanhh.com/22016/02/14/android-system-server/#methodandargscaller)，可知接下来进入main()方法。

[-->SystemServer.java]

    public static void main(String[] args) {
        //先初始化SystemServer对象，再调用对象的run()方法， 【见小节2】
        new SystemServer().run(); 
    }

### 2. run()

[-->SystemServer.java]

    private void run() {
        //当系统时间比1970年更早，就设置当前系统时间为1970年
        if (System.currentTimeMillis() < EARLIEST_SUPPORTED_TIME) {
            Slog.w(TAG, "System clock is before 1970; setting to 1970.");
            SystemClock.setCurrentTimeMillis(EARLIEST_SUPPORTED_TIME);
        }

        if (!SystemProperties.get("persist.sys.language").isEmpty()) {
            final String languageTag = Locale.getDefault().toLanguageTag();
            SystemProperties.set("persist.sys.locale", languageTag);
            SystemProperties.set("persist.sys.language", "");
            SystemProperties.set("persist.sys.country", "");
            SystemProperties.set("persist.sys.localevar", "");
        }

        Slog.i(TAG, "Entered the Android system server!");
        EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_SYSTEM_RUN, SystemClock.uptimeMillis());

        //变更虚拟机的库文件，对于Android 6.0一般采用的是libart.so
        SystemProperties.set("persist.sys.dalvik.vm.lib.2", VMRuntime.getRuntime().vmLibrary());

        //isEnabled()为true，则开启采用分析器
        if (SamplingProfilerIntegration.isEnabled()) {
            SamplingProfilerIntegration.start();
            mProfilerSnapshotTimer = new Timer();
            //system_server每隔1小时采用一次，并保存结果到system_server文件
            mProfilerSnapshotTimer.schedule(new TimerTask() {
                @Override
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

        // main looper线程就在当前线程运行
        Looper.prepareMainLooper();

        //加载android_servers.so库，该库包含的源码在frameworks/base/services/目录下
        System.loadLibrary("android_servers");

        //检测上次关机过程是否失败，该方法可能不会返回
        performPendingShutdown();

        //初始化系统上下文 【见小节3】
        createSystemContext();

        //创建系统服务管理
        mSystemServiceManager = new SystemServiceManager(mSystemContext);
        //将mSystemServiceManager添加到本地服务 【见小节4】
        LocalServices.addService(SystemServiceManager.class, mSystemServiceManager);

        
        try {
            startBootstrapServices(); //引导服务 //启动服务 【见小节5】
            startCoreServices();      //核心服务 //启动服务 【见小节6】
            startOtherServices();     //其他服务 //启动服务 【见小节7】
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



### 3. createSystemContext

[-->SystemServer.java]

    private void createSystemContext() {
        //【见小节3.1】
        ActivityThread activityThread = ActivityThread.systemMain();
        //【见小节3.4】
        mSystemContext = activityThread.getSystemContext();
        // 设置主题
        mSystemContext.setTheme(android.R.style.Theme_DeviceDefault_Light_DarkActionBar);
    }

#### 3.1 systemMain

[-->ActivityThread.java]

    public static ActivityThread systemMain() {
        //对于低内存的设备，禁用硬件加速
        if (!ActivityManager.isHighEndGfx()) {
            HardwareRenderer.disable(true);
        } else {
            HardwareRenderer.enableForegroundTrimming();
        }
        // 创建ActivityThread
        ActivityThread thread = new ActivityThread();
        // 【见小节3.2】
        thread.attach(true);
        return thread;
    }

#### 3.2 attach

[-->ActivityThread.java]

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system;

        if (!system) {
        ...

        } else {
            //system=true,进入此分支
            android.ddm.DdmHandleAppName.setAppName("system_process",
                    UserHandle.myUserId());
            try {
                mInstrumentation = new Instrumentation();
                // 创建应用上下文
                ContextImpl context = ContextImpl.createAppContext(
                        this, getSystemContext().mPackageInfo);
                //创建Application 【见小节3.3】
                mInitialApplication = context.mPackageInfo.makeApplication(true, null);
                //调用Application.onCreate()方法
                mInitialApplication.onCreate();
            } catch (Exception e) {
                throw new RuntimeException(
                        "Unable to instantiate Application():" + e.toString(), e);
            }
        }

        //添加dropbox log信息到libcore
        DropBox.setReporter(new DropBoxReporter());

        // 设置回调方法
        ViewRootImpl.addConfigCallback(new ComponentCallbacks2() {
            @Override
            public void onConfigurationChanged(Configuration newConfig) {
                synchronized (mResourcesManager) {
                    if (mResourcesManager.applyConfigurationToResourcesLocked(newConfig, null)) {
                        if (mPendingConfiguration == null ||
                                mPendingConfiguration.isOtherSeqNewer(newConfig)) {
                            mPendingConfiguration = newConfig;

                            sendMessage(H.CONFIGURATION_CHANGED, newConfig);
                        }
                    }
                }
            }
            @Override
            public void onLowMemory() {
            }
            @Override
            public void onTrimMemory(int level) {
            }
        });
    }

主要工作是创建应用上下文ContextImpl，创建Application以及调用其onCreate()方法，设置DropBox以及ComponentCallbacks2回调方法。

#### 3.3 makeApplication

[-->LoadedApk.java]

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

        try {
            java.lang.ClassLoader cl = getClassLoader();
            if (!mPackageName.equals("android")) {
                initializeJavaContextClassLoader(); //不进入该分支
            }
            ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
            // 创建Application
            app = mActivityThread.mInstrumentation.newApplication(
                    cl, appClass, appContext);
            appContext.setOuterContext(app);
        } catch (Exception e) {
    		...
        }
        // 将前面创建的app添加到应用列表。
        mActivityThread.mAllApplications.add(app);
        mApplication = app;
        ...

        return app;
    }

在该方法调用之前，已经创建了LoadedApk对象，该对象的成员变量mPackageName="android"; mClassLoader = ClassLoader.getSystemClassLoader();

#### 3.4 getSystemContext

[-->ActivityThread.java]

    public ContextImpl getSystemContext() {
        synchronized (this) {
            if (mSystemContext == null) {
                mSystemContext = ContextImpl.createSystemContext(this);
            }
            return mSystemContext;
        }
    }

[-->ContextImpl.java]

    static ContextImpl createSystemContext(ActivityThread mainThread) {
        LoadedApk packageInfo = new LoadedApk(mainThread);
        ContextImpl context = new ContextImpl(null, mainThread,
                packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
        context.mResources.updateConfiguration(context.mResourcesManager.getConfiguration(), 
                context.mResourcesManager.getDisplayMetricsLocked());
        return context;
    }

创建LoadedApk和ContextImpl对象。

### 4.  addService

[--> LocalServices.java]

    public static <T> void addService(Class<T> type, T service) {
        synchronized (sLocalServiceObjects) {
            if (sLocalServiceObjects.containsKey(type)) {
                throw new IllegalStateException("Overriding service registration");
            }
            sLocalServiceObjects.put(type, service);
        }
    }

用静态Map变量sLocalServiceObjects，来保存以服务类名为key，以具体服务对象为value的Map结构。

### 5. startBootstrapServices

[-->SystemServer.java]

    private void startBootstrapServices() {
        //阻塞等待，直到与服务端installd建立socket通道
        Installer installer = mSystemServiceManager.startService(Installer.class);

        //启动服务ActivityManagerService
        mActivityManagerService = mSystemServiceManager.startService(
                ActivityManagerService.Lifecycle.class).getService();
        mActivityManagerService.setSystemServiceManager(mSystemServiceManager);
        mActivityManagerService.setInstaller(installer);

        //启动服务PowerManagerService
        mPowerManagerService = mSystemServiceManager.startService(PowerManagerService.class);
        mActivityManagerService.initPowerManagement();

        //启动服务LightsService
        mSystemServiceManager.startService(LightsService.class);

        //启动服务DisplayManagerService
        mDisplayManagerService = mSystemServiceManager.startService(DisplayManagerService.class);

        //调用DisplayManagerService.onBootPhase()，初始化package manager前需要有默认显示。
        //【BootPhase阶段1】，会进入wait()状态，直到Display默认显示完成。
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

        //注册一些系统服务
        mActivityManagerService.setSystemProcess();

        //调用native方法，启动传感器服务
        startSensorService();
    }

引导服务：

|---|
|ActivityManagerService|
|PowerManagerService|
|LightsService|
|DisplayManagerService|
|PackageManagerService|
|UserManagerService|
|SensorService|


(1) mSystemServiceManager.startService(Class<T> serviceClass)，继承于SystemService的服务是通过这种方法初始化服务，功能主要：

1. 创建serviceClass类的对象；
2. 将刚创建的对象添加到mSystemServiceManager的成员变量mServices；
3. 调用刚创建对象的onStart()方法。

(2) ServiceManager.addService(String name, IBinder service)， 继承于IBinder的服务是通过该方式，主要功能将创建的Binder服务service向native的[service Manager注册](http://www.yuanhh.com/2015/11/14/binder-add-service/#addservice)。


### 6. startCoreServices

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

核心服务：

|---|
|BatteryService
|UsageStatsService
|WebViewUpdateService

### 7. startOtherServices

startOtherServices()会初始化并启动大概70多个Service，分类以下两大类：

#### 服务类型1

通过ServiceManager.addService(String name, IBinder service)方法注册的服务

|---|
|SchedulingPolicyService
|TelephonyRegistry
|AccountManagerService
|ContentService
|VibratorService
|ConsumerIrService
|InputManagerService
|WindowManagerService
|InputMethodManagerService
|AccessibilityManagerService
|LockSettingsService
|StatusBarManagerService
|ClipboardService
|NetworkManagementService
|TextServicesManagerService
|NetworkScoreService
|NetworkStatsService
|NetworkPolicyManagerService
|ConnectivityService
|NsdService
|UpdateLockService
|LocationManagerService
|CountryDetectorService
|SearchManagerService
|DropBoxManagerService
|WallpaperManagerService
|AudioService
|SerialService
|DiskStatsService
|SamplingProfilerService
|CommonTimeManagementService
|AssetAtlasService
|GraphicsStatsService
|MediaRouterService


#### 服务类型2

通过mSystemServiceManager.startService(Class<T> serviceClass)方法启动的服务

|---|
|TelecomLoaderService
|CameraService
|AlarmManagerService
|BluetoothService
|MountService$Lifecycle
|UiModeManagerService
|PersistentDataBlockService
|DeviceIdleController
|DevicePolicyManagerService$Lifecycle
|WifiP2pService
|WifiService
|WifiScanningService
|RttService
|EthernetService
|NotificationManagerService
|DeviceStorageMonitorService
|DockObserver
|ThermalObserver
|MidiService.Lifecycle
|UsbService.Lifecycle
|TwilightService
|JobSchedulerService
|BackupManagerService$Lifecycle
|AppWidgetService
|VoiceInteractionManagerService
|GestureLauncherService
|DreamManagerService
|PrintManagerService
|RestrictionsManagerService
|MediaSessionService
|MediaSessionService
|TvInputManagerService
|TrustManagerService
|FingerprintService
|LauncherAppsService
|MediaProjectionManagerService
|MmsServiceBroker

其中WindowManagerServi创建新线程；DropBoxManagerService会将结果保存在/data/system/dropbox。

#### BootPhase

该方法有近千行代码，除了启动上述的大量方法，还有一些比较重要的逻辑

    private void startOtherServices() {
        ...
        entropyMixer = new EntropyMixer(context);
        //安装SystemProvider
        mActivityManagerService.installSystemProviders();
        //初始化Watchdog（继承于Thread）
        final Watchdog watchdog = Watchdog.getInstance();
        watchdog.init(context, mActivityManagerService);
        //执行dex优化操作
        mPackageManagerService.performBootDexOpt();
        //显示app更新窗口
        ActivityManagerNative.getDefault().showBootMessage(
                context.getResources().getText(
                        com.android.internal.R.string.android_upgrading_starting_apps),
                false);

        final boolean safeMode = wm.detectSafeMode();
        if (safeMode) {
            mActivityManagerService.enterSafeMode();
            VMRuntime.getRuntime().disableJitCompilation();
        } else {
            VMRuntime.getRuntime().startJitCompilation();
        }

        vibrator.systemReady();
        lockSettings.systemReady();

        //【BootPhase阶段2、3】
        mSystemServiceManager.startBootPhase(SystemService.PHASE_LOCK_SETTINGS_READY);
        mSystemServiceManager.startBootPhase(SystemService.PHASE_SYSTEM_SERVICES_READY);

        wm.systemReady();
        mPowerManagerService.systemReady(mActivityManagerService.getAppOpsService());
        mPackageManagerService.systemReady();
        mDisplayManagerService.systemReady(safeMode, mOnlyCore);

        mActivityManagerService.systemReady(new Runnable() {
            @Override
            public void run() {
                //【BootPhase阶段4】
                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_ACTIVITY_MANAGER_READY);

                mActivityManagerService.startObservingNativeCrashes();
                WebViewFactory.prepareWebViewInSystemServer();

                startSystemUi(context);
                if (networkScoreF != null) networkScoreF.systemReady();
                if (networkManagementF != null) networkManagementF.systemReady();
                if (networkStatsF != null) networkStatsF.systemReady();
                if (networkPolicyF != null) networkPolicyF.systemReady();
                if (connectivityF != null) connectivityF.systemReady();
                if (audioServiceF != null) audioServiceF.systemReady();
                Watchdog.getInstance().start();
                //【BootPhase阶段5】
                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_THIRD_PARTY_APPS_CAN_START);

                if (wallpaperF != null) wallpaperF.systemRunning();
                ...
            }
        });
    }

在上述方法中，有一个mSystemServiceManager.startBootPhase(）方法贯穿整个流程。启动阶段从PHASE_WAIT_FOR_DEFAULT_DISPLAY到PHASE_BOOT_COMPLETED，具体如下：

|阶段|值|解释|
|---|---|
|PHASE_WAIT_FOR_DEFAULT_DISPLAY|100|进入该阶段，等待Display有默认显示
|PHASE_LOCK_SETTINGS_READY|480|进入该阶段，服务能获取设置数据的锁
|PHASE_SYSTEM_SERVICES_READY|500|进入该阶段，服务能安全地调用核心系统服务，比如PowerManager/PackageManager
|PHASE_ACTIVITY_MANAGER_READY|550|进入该阶段，服务能广播Intent
|PHASE_THIRD_PARTY_APPS_CAN_START|600|进入该阶段，服务能start/bind第三方apps，app能通过BInder调用service
|PHASE_BOOT_COMPLETED|1000|该阶段是发生在Boot完成和home应用启动完毕。系统服务更倾向于监听该阶段，而不是注册广播ACTION_BOOT_COMPLETED，从而降低系统延迟。

接下来的文章，会重点分析system_server中比较重要的服务，比如ActivityManagerService, PowerManagerService, PackageManagerService等。