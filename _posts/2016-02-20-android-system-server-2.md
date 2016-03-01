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


## 一、启动调用栈


System_server启动函数调用类的栈关系：

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


### 二、 SystemServer分析

上一篇文章[Android系统启动-systemServer篇(一)](http://www.yuanhh.com/2016/02/14/android-system-server/)讲解了从Zygote一路启动到SystemServer的过程，本文重要是讲述system_server所承载的java framework的系统服务框架，是如何一路路启动的。

**Step 1.** SystemServer.main

    public static void main(String[] args) {
        //先初始化SystemServer对象，再调用对象的run()方法， 【见Step 2】
        new SystemServer().run(); 
    }

**Step 2.** SystemServer.run

    private void run() {
        //当系统时间比1970年更早，就设置当前系统时间为1970年
        if (System.currentTimeMillis() < EARLIEST_SUPPORTED_TIME) {
            Slog.w(TAG, "System clock is before 1970; setting to 1970.");
            SystemClock.setCurrentTimeMillis(EARLIEST_SUPPORTED_TIME);
        }

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

        // 主线程looper就在当前线程运行
        Looper.prepareMainLooper();

        //加载android_servers.so库，该库包含的源码在frameworks/base/services/目录下
        System.loadLibrary("android_servers");

        //检测上次关机过程是否失败，该方法可能不会返回
        performPendingShutdown();

        //初始化系统上下文 【见Step 3】
        createSystemContext();

        //创建系统服务管理
        mSystemServiceManager = new SystemServiceManager(mSystemContext);
        //将mSystemServiceManager添加到本地服务的成员sLocalServiceObjects
        LocalServices.addService(SystemServiceManager.class, mSystemServiceManager);

        
        //启动各种系统服务 【见Step 4】
        try {
            startBootstrapServices(); // 启动引导服务
            startCoreServices();      // 启动核心服务
            startOtherServices();     // 启动其他服务  
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

**Step 3.** SystemServer.createSystemContext

    private void createSystemContext() {
        //创建ActivityThread对象【见Step 3-1】
        ActivityThread activityThread = ActivityThread.systemMain();
        //创建ContextImpl、LoadedApk对象【见Step 3-2】
        mSystemContext = activityThread.getSystemContext();
        //设置主题
        mSystemContext.setTheme(android.R.style.Theme_DeviceDefault_Light_DarkActionBar);
    }

**Step 3-1.**  ActivityThread.systemMain

    public static ActivityThread systemMain() {
        //对于低内存的设备，禁用硬件加速
        if (!ActivityManager.isHighEndGfx()) {
            HardwareRenderer.disable(true);
        } else {
            HardwareRenderer.enableForegroundTrimming();
        }
        // 创建ActivityThread
        ActivityThread thread = new ActivityThread();
        // 创建Application以及调用其onCreate()方法【见Step 3-1-1】
        thread.attach(true);
        return thread;
    }

**Step 3-1-1.**  ActivityThread.attach

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
                //创建Application 【见Step 3-1-1-1】
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

**Step 3-1-1-1.**  LoadedApk.makeApplication

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


**Step 3-2.** ActivityThread.getSystemContext

    public ContextImpl getSystemContext() {
        synchronized (this) {
            if (mSystemContext == null) {
                //创建ContextImpl对象【见Step 3-2-1】
                mSystemContext = ContextImpl.createSystemContext(this);
            }
            return mSystemContext;
        }
    }

**Step 3-2-1.** ContextImpl.createSystemContext

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


### 三、系统服务

#### 3.1 服务启动阶段

接下来，开始正式进入启动系统服务的过程，从大的方向来看分为引导服务（BootstrapServices），核心服务（CoreServices），其他服务（OtherServices）。

- 引导服务：ActivityManagerService、PowerManagerService、LightsService、DisplayManagerService、PackageManagerService、UserManagerService、SensorService共7项服务；
- 核心服务：BatteryService、UsageStatsService、WebViewUpdateService共3项服务；
- 其他服务：AlarmManagerService、VibratorService等共71项其他服务


整个服务的启动流程中mSystemServiceManager的`startBootPhase(）`方法贯穿整个阶段，启动阶段从`PHASE_WAIT_FOR_DEFAULT_DISPLAY`到`PHASE_BOOT_COMPLETED`，具体启动阶段：


1. `PHASE_WAIT_FOR_DEFAULT_DISPLAY=100`，该阶段等待Display有默认显示;
2. `PHASE_LOCK_SETTINGS_READY=480`，进入该阶段服务能获取锁屏设置的数据;
3. `PHASE_SYSTEM_SERVICES_READY=500`，进入该阶段服务能安全地调用核心系统服务，如PMS;
4. `PHASE_ACTIVITY_MANAGER_READY=550`，进入该阶段服务能广播Intent;
5. `PHASE_THIRD_PARTY_APPS_CAN_START=600`，进入该阶段服务能start/bind第三方apps，app能通过BInder调用service;
6. `PHASE_BOOT_COMPLETED=1000`，该阶段是发生在Boot完成和home应用启动完毕。系统服务更倾向于监听该阶段，而不是注册广播ACTION_BOOT_COMPLETED，从而降低系统延迟。


#### 3.2 启动流程

在讲服务启动流程之前，先说说SystemServiceManager的`startService(Class<T> serviceClass)`。该方法用于初始化那些继承自SystemService类的服务，主要功能是创建serviceClass类的对象，将刚创建对象添加到SystemServiceManager的成员变量mServices，再调用刚创建对象的onStart()方法。对于服务启动到一定阶段，进入相应的Phase时，会调用SystemServiceManager的`startBootPhase()`回调方法，该方法会循环遍历所有向SystemServiceManager注册过的service的`onBootPhase()`方法。

另外，还有服务是通过ServiceManager的addService(String name, IBinder service)方法。该方法一般用于初始化那些继承于IBinder类的服务，主要功能将Binder服务向native的[service Manager注册](http://www.yuanhh.com/2015/11/14/binder-add-service/#addservice)，名为name的服务。


**Phase 1**

创建ActivityManagerService、PowerManagerService、LightsService、DisplayManagerService共4项服务；

接着则进入阶段`PHASE_WAIT_FOR_DEFAULT_DISPLAY=100`，该阶段调用DisplayManagerService的`onBootPhase()`方法。

**Phase 2&& Phase3**

创建PackageManagerService、DevicePolicyManagerService、UserManagerService、SensorService、BatteryService、UsageStatsService、WebViewUpdateService等等服务（此处省略...），初始化Watchdog，优化dex文件，显示开机动画（showBootMessage），再就是VibratorService和LockSettingsService执行`systemReady()`方法；

接着则进入阶段`PHASE_LOCK_SETTINGS_READY=480`，该阶段调用DevicePolicyManagerService的`onBootPhase()`方法；紧接着进入阶段`PHASE_SYSTEM_SERVICES_READY=500`，实现该阶段的回调方法的服务较多。


**Phase 4**

WindowManagerService、PowerManagerService、PackageManagerService、DisplayManagerService分别依次执行`systemReady()`方法；然后ActivityManagerService进入`systemReady()`方法; 

接着则进入阶段`PHASE_ACTIVITY_MANAGER_READY=550`，实现该阶段的回调方法的服务较多。

**Phase 5**

AMS启动native crash监控,，加载WebView，启动SystemUi；然后是NetworkScoreService、NetworkManagementService、NetworkStatsService、NetworkPolicyManagerService、ConnectivityService、AudioService分别依次执行`systemReady()`方法，然后是启动Watchdog。

接着则进入阶段`PHASE_THIRD_PARTY_APPS_CAN_START=600`，实现该阶段的回调方法的服务较多。


**Phase 6**

WallpaperManagerService、InputMethodManagerService、LocationManagerService、CountryDetectorService、NetworkTimeUpdateService、CommonTimeManagementService、TextServicesManagerService、AssetAtlasService、InputManagerService、TelephonyRegistry、MediaRouterService、MmsServiceBroker这些服务依次执行其`systemRunning()`方法。经过一定流程，当ActivityManagerServer进入`finishBooting()`时，则启动流程进入阶段`PHASE_BOOT_COMPLETED=1000`。

到此整个system_server进程已全部启动完成。

### 四、服务分类

system_server进程在整个过程，会启动大概81个服务，下面对其简单分类：

1. **重量级服务：**ActivityManagerService、PackageManagerService、WindowManagerService
2. **统计调度相关：**DropBoxManagerService、SamplingProfilerService、UsageStatsService、DiskStatsService、SchedulingPolicyService、DeviceStorageMonitorService、AlarmManagerService、DeviceIdleController、DockObserver、ThermalObserver、JobSchedulerService
3. **功耗相关：**PowerManagerService、BatteryService、DreamManagerService
4. **网络相关：**NetworkManagementService、NetworkScoreService、NetworkStatsService、NetworkPolicyManagerService、ConnectivityService、BluetoothService、WifiP2pService、WifiService、WifiScanningService、EthernetService、
5. **多媒体相关：**AudioService、MediaRouterService、VoiceInteractionManagerService、MediaProjectionManagerService、MediaSessionService、
6. **电话相关：** TelephonyRegistry、TelecomLoaderService
7. **IO相关：**InputManagerService、InputMethodManagerServiceMountService、PersistentDataBlockService、UsbService、TvInputManagerService、FingerprintService
8. **显示相关：**DisplayManagerService、LightsService、GraphicsStatsService、StatusBarManagerService、NotificationManagerService、WallpaperManagerService、UiModeManagerService、AppWidgetService、LauncherAppsService、TextServicesManagerService、
ContentService、LockSettingsService、
9. **传感器相关：**SensorService、LocationManagerService、VibratorService、CountryDetectorService、WebViewUpdateService、GestureLauncherService
10. **辅助类：** AccessibilityManagerService、ClipboardService、DevicePolicyManagerService、PrintManagerService、BackupManagerService、UserManagerService、AccountManagerService、TrustManagerService
11. **其他：**、NsdService、UpdateLockService、SerialService、SearchManagerService、CommonTimeManagementService、AssetAtlasService、ConsumerIrService、MidiServiceCameraService、TwilightService、RestrictionsManagerService、MmsServiceBroker、RttService

后续，会针对其中比较重要的服务进行展开讲解。
