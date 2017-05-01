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

    frameworks/base/services/java/com/android/server/
      - SystemServer.java
    
    frameworks/base/services/core/java/com/android/server/
      - SystemServiceManager.java
      - ServiceThread.java
      - am/ActivityManagerService.java

    frameworks/base/core/java/android/app/
      - ActivityThread.java
      - LoadedApk.java
      - ContextImpl.java

## 一. SystemServer启动

上篇文章[Android系统启动-systemServer上篇](http://gityuan.com/2016/02/14/android-system-server/) 从Zygote一路启动到SystemServer的过程。
简单回顾下，在RuntimeInit.java中invokeStaticMain方法通过创建并抛出异常ZygoteInit.MethodAndArgsCaller，在`ZygoteInit.java`中的main()方法会捕捉该异常，并调用`caller.run()`，再通过反射便会调用到SystemServer.main()方法，该方法主要执行流程：

    SystemServer.main
        SystemServer.run
            createSystemContext
            startBootstrapServices();
            startCoreServices();
            startOtherServices();
            Looper.loop();

接下来，从其main方法说起。

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

        if (SamplingProfilerIntegration.isEnabled()) {
            ...
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
    
### 1.3 createSystemContext
[-->SystemServer.java]

    private void createSystemContext() {
        //创建system_server进程的上下文信息
        ActivityThread activityThread = ActivityThread.systemMain();
        mSystemContext = activityThread.getSystemContext();
        //设置主题
        mSystemContext.setTheme(android.R.style.Theme_DeviceDefault_Light_DarkActionBar);
    }

[理解Application创建过程](http://gityuan.com/2017/04/02/android-application/)已介绍过createSystemContext()过程，
该过程会创建对象有ActivityThread，Instrumentation, ContextImpl，LoadedApk，Application。

### 1.4 startBootstrapServices
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


### 1.5 startCoreServices

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

### 1.6 startOtherServices

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
            
            //重头戏[见小节2.1]
            mActivityManagerService.systemReady(new Runnable() {
                public void run() {
                  ...
                }
            });
        }

SystemServer启动各种服务中最后的一个环节便是AMS.systemReady()，详见[ActivityManagerService启动过程](http://gityuan.com/2016/02/21/activity-manager-service/).


到此, System_server主线程的启动工作总算完成, 进入Looper.loop()状态,等待其他线程通过handler发送消息到主线再处理.

    
## 二、服务启动阶段

SystemServiceManager的startBootPhase()贯穿system_server进程的整个启动过程：

![system_server服务启动流程](/images/boot/systemServer/system_server_boot_process.jpg)

其中`PHASE_BOOT_COMPLETED=1000`，该阶段是发生在Boot完成和home应用启动完毕。系统服务更倾向于监听该阶段，而不是注册广播ACTION_BOOT_COMPLETED，从而降低系统延迟。

**各个启动阶段所在源码的大致位置：**

    public final class SystemServer {

        private void startBootstrapServices() {
          ...
          //phase100
          mSystemServiceManager.startBootPhase(SystemService.PHASE_WAIT_FOR_DEFAULT_DISPLAY);
          ...
        }

        private void startCoreServices() {
          ...
        }

        private void startOtherServices() {
          ...
          //phase480 && 500
          mSystemServiceManager.startBootPhase(SystemService.PHASE_LOCK_SETTINGS_READY);
          mSystemServiceManager.startBootPhase(SystemService.PHASE_SYSTEM_SERVICES_READY);
          
          ...
          mActivityManagerService.systemReady(new Runnable() {
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
    
接下来再说说简单每个阶段的大概完成的工作：

#### 2.1 Phase0

创建四大引导服务:

- ActivityManagerService
- PowerManagerService
- LightsService
- DisplayManagerService

#### 2.2 Phase100
进入阶段`PHASE_WAIT_FOR_DEFAULT_DISPLAY`=100回调服务

onBootPhase(100)

- DisplayManagerService

然后创建大量服务下面列举部分:

- PackageManagerService
- WindowManagerService
- InputManagerService
- NetworkManagerService
- DropBoxManagerService
- FingerprintService
- LauncherAppsService
- ...

#### 2.3 Phase480
进入阶段`PHASE_LOCK_SETTINGS_READY`=480回调服务

onBootPhase(480)

- DevicePolicyManagerService

阶段480后马上就进入阶段500.

#### 2.4 Phase500

`PHASE_SYSTEM_SERVICES_READY`=500，进入该阶段服务能安全地调用核心系统服务.

onBootPhase(500)

- AlarmManagerService
- JobSchedulerService
- NotificationManagerService
- BackupManagerService
- UsageStatsService
- DeviceIdleController
- TrustManagerService
- UiModeManagerService

- BluetoothService
- BluetoothManagerService
- EthernetService
- WifiP2pService
- WifiScanningService
- WifiService
- RttService

各大服务执行systemReady():

- WindowManagerService.systemReady():
- PowerManagerService.systemReady():
- PackageManagerService.systemReady():
- DisplayManagerService.systemReady():

接下来就绪AMS.systemReady方法.

#### 2.5 Phase550

`PHASE_ACTIVITY_MANAGER_READY`=550， AMS.mSystemReady=true, 
已准备就绪,进入该阶段服务能广播Intent;但是system_server主线程并没有就绪.

onBootPhase(550)

- MountService
- TelecomLoaderService
- UsbService
- WebViewUpdateService
- DockObserver
- BatteryService

接下来执行: (AMS启动native crash监控, 加载WebView，启动SystemUi等),如下

- mActivityManagerService.startObservingNativeCrashes();
- WebViewFactory.prepareWebViewInSystemServer();
- startSystemUi(context);

- networkScoreF.systemReady();
- networkManagementF.systemReady();
- networkStatsF.systemReady();
- networkPolicyF.systemReady();
- connectivityF.systemReady();
- audioServiceF.systemReady();
- Watchdog.getInstance().start();
            
#### 2.6 Phase600
`PHASE_THIRD_PARTY_APPS_CAN_START`=600

onBootPhase(600)

- JobSchedulerService
- NotificationManagerService
- BackupManagerService
- AppWidgetService
- GestureLauncherService
- DreamManagerService
- TrustManagerService
- VoiceInteractionManagerService

接下来,各种服务的systemRunning过程:

WallpaperManagerService、InputMethodManagerService、LocationManagerService、CountryDetectorService、NetworkTimeUpdateService、CommonTimeManagementService、TextServicesManagerService、AssetAtlasService、InputManagerService、TelephonyRegistry、MediaRouterService、MmsServiceBroker这些服务依次执行其`systemRunning()`方法。

#### 2.7 Phase1000
在经过一系列流程，再调用`AMS.finishBooting()`时，则进入阶段`Phase1000`。

到此，系统服务启动阶段完成就绪，system_server进程启动完成则进入`Looper.loop()`状态，随时待命，等待消息队列MessageQueue中的消息到来，则马上进入执行状态。

### 三、服务类别

system_server进程，从源码角度划分为引导服务、核心服务、其他服务3类。 以下这些系统服务的注册过程, 见[Android系统服务的注册方式](http://gityuan.com/2016/10/01/system_service_common/)

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
