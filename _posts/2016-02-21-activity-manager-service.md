---
layout: post
title:  "ActivityManagerService启动过程(一)"
date:   2016-02-21 21:12:40
catalog:  true
tags:
    - android
    - boot
    - AMSs

---

> 基于Android 6.0的源码剖析， 分析Android系统服务ActivityManagerService，简称AMS

	frameworks/base/core/java/android/app/ActivityThread.java
	frameworks/base/core/java/android/app/LoadedApk.java
	frameworks/base/core/java/android/app/ContextImpl.java
	frameworks/base/core/java/com/android/server/LocalServices.java
	frameworks/base/services/java/com/android/server/SystemServer.java
	frameworks/base/services/core/java/com/android/server/SystemServiceManager.java
	frameworks/base/services/core/java/com/android/server/ServiceThread.java
	frameworks/base/services/core/java/com/android/server/pm/Installer.java
	frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java


### 一、概述

[Android系统启动-SystemServer篇(二)](http://gityuan.com/2016/02/20/android-system-server-2/)中有讲到AMS，本文以AMS为主线，讲述system_server进程中AMS服务的启动过程，以startBootstrapServices()方法为起点，紧跟着startCoreServices(), startOtherServices()共3个方法。


### 1. startBootstrapServices

[-->SystemServer.java]

    private void startBootstrapServices() {
		...
        //启动AMS服务【见小节2】
        mActivityManagerService = mSystemServiceManager.startService(
                ActivityManagerService.Lifecycle.class).getService();
        //设置AMS的系统服务管理器
        mActivityManagerService.setSystemServiceManager(mSystemServiceManager);

        //设置AMS的APP安装器
        mActivityManagerService.setInstaller(installer);

        //初始化AMS相关的PMS
        mActivityManagerService.initPowerManagement();
        ...

        //设置SystemServer【见小节4】
        mActivityManagerService.setSystemProcess();

    }

### 2. SystemServiceManager

**2-1. startService**

[-->SystemServiceManager.java]

    public SystemService startService(String className) {
        final Class<SystemService> serviceClass;
        try {
            serviceClass = (Class<SystemService>)Class.forName(className);
        } catch (ClassNotFoundException ex) {
            ...
        }
        return startService(serviceClass); //启动服务【小节2-2】
    }

**2-2. startService**

    public <T extends SystemService> T startService(Class<T> serviceClass) {
        final String name = serviceClass.getName();

        if (!SystemService.class.isAssignableFrom(serviceClass)) {
            throw new RuntimeException("");
        }
        final T service;
        try {
            Constructor<T> constructor = serviceClass.getConstructor(Context.class);
            // 创建ActivityManagerService.Lifecycle对象 【见小节2-3】
            service = constructor.newInstance(mContext);
        } catch (Exception ex) {
            throw new RuntimeException();
            ...
        }
        //注册Lifecycle服务，并添加到成员变量mServices
        mServices.add(service);
        
        try {
            //启动ActivityManagerService.Lifecycle的onStart() 【见小节2-3】
            service.onStart(); 
        } catch (RuntimeException ex) {
            throw new RuntimeException("",ex);
        }
        return service;
    }

mSystemServiceManager.startService(xxx.class) 功能主要：

1. 创建xxx类的对象；
2. 将刚创建的对象添加到mSystemServiceManager的成员变量mServices；
3. 调用刚创建对象的onStart()方法。

**2-3. Lifecycle**

[-->ActivityManagerService.java]

    public static final class Lifecycle extends SystemService {
        private final ActivityManagerService mService;

        public Lifecycle(Context context) {
            super(context);
            //创建ActivityManagerService【见小节3-1】
            mService = new ActivityManagerService(context);
        }

        @Override
        public void onStart() {
            mService.start();  //【见小节3-2】
        }

        public ActivityManagerService getService() {
            return mService;
        }
    }

该过程： 

1. 创建AMS内部类的Lifecycle对象，以及创建AMS对象；
2. 将Lifecycle对象添加到mSystemServiceManager的成员变量mServices；
3. 调用AMS.start();

### 3 ActivityManagerService

**3-1 构造函数**

    public ActivityManagerService(Context systemContext) {
        mContext = systemContext;
        mFactoryTest = FactoryTest.getMode();//默认为FACTORY_TEST_OFF
        mSystemThread = ActivityThread.currentActivityThread();

        //创建名为TAG（值为"ActivityManager"）的线程，并获取mHandler
        mHandlerThread = new ServiceThread(TAG, android.os.Process.THREAD_PRIORITY_FOREGROUND, false);
        mHandlerThread.start();

        mHandler = new MainHandler(mHandlerThread.getLooper());

        //通过UiThread类，创建名为"android.ui"的线程
        mUiHandler = new UiHandler();

        //前台广播接收器，在运行超过10s将放弃执行
        mFgBroadcastQueue = new BroadcastQueue(this, mHandler,
                "foreground", BROADCAST_FG_TIMEOUT, false);

        //后台广播接收器，在运行超过60s将放弃执行
        mBgBroadcastQueue = new BroadcastQueue(this, mHandler,
                "background", BROADCAST_BG_TIMEOUT, true);
        mBroadcastQueues[0] = mFgBroadcastQueue;
        mBroadcastQueues[1] = mBgBroadcastQueue;

        //创建ActiveServices，其中非低内存手机mMaxStartingBackground为8
        mServices = new ActiveServices(this);
        mProviderMap = new ProviderMap(this);

        //新建目录/data/system
        File dataDir = Environment.getDataDirectory();
        File systemDir = new File(dataDir, "system");
        systemDir.mkdirs();

        //创建服务BatteryStatsService
        mBatteryStatsService = new BatteryStatsService(systemDir, mHandler);
        mBatteryStatsService.getActiveStatistics().readLocked();
        mBatteryStatsService.scheduleWriteToDisk(); //回写到磁盘
        mOnBattery = DEBUG_POWER ? true
                : mBatteryStatsService.getActiveStatistics().getIsOnBattery();
        mBatteryStatsService.getActiveStatistics().setCallback(this);

        //创建进程统计服务，信息保存在目录/data/system/procstats，
        mProcessStats = new ProcessStatsService(this, new File(systemDir, "procstats"));

        mAppOpsService = new AppOpsService(new File(systemDir, "appops.xml"), mHandler);

        mGrantFile = new AtomicFile(new File(systemDir, "urigrants.xml"));

        // User 0是第一个，也是唯一的一个开机过程中运行的用户
        mStartedUsers.put(UserHandle.USER_OWNER, new UserState(UserHandle.OWNER, true));
        mUserLru.add(UserHandle.USER_OWNER);
        updateStartedUserArrayLocked();

        GL_ES_VERSION = SystemProperties.getInt("ro.opengles.version",
            ConfigurationInfo.GL_ES_VERSION_UNDEFINED);
        mTrackingAssociations = "1".equals(SystemProperties.get("debug.track-associations"));

        mConfiguration.setToDefaults();
        mConfiguration.setLocale(Locale.getDefault());
        mConfigurationSeq = mConfiguration.seq = 1;

        //进程CPU使用情况的追踪器的初始化
        mProcessCpuTracker.init();

        mCompatModePackages = new CompatModePackages(this, systemDir, mHandler);
        mIntentFirewall = new IntentFirewall(new IntentFirewallInterface(), mHandler);
        mRecentTasks = new RecentTasks(this);
        // 创建Activity栈的对象
        mStackSupervisor = new ActivityStackSupervisor(this, mRecentTasks);
        mTaskPersister = new TaskPersister(systemDir, mStackSupervisor, mRecentTasks);

        //创建名为"CpuTracker"的线程
        mProcessCpuThread = new Thread("CpuTracker") {
            @Override
            public void run() {
                while (true) {
                    try {
                        try {
                            synchronized(this) {
                                final long now = SystemClock.uptimeMillis();
                                long nextCpuDelay = (mLastCpuTime.get()+MONITOR_CPU_MAX_TIME)-now;
                                long nextWriteDelay = (mLastWriteTime+BATTERY_STATS_TIME)-now;
                                if (nextWriteDelay < nextCpuDelay) {
                                    nextCpuDelay = nextWriteDelay;
                                }
                                if (nextCpuDelay > 0) {
                                    mProcessCpuMutexFree.set(true);
                                    this.wait(nextCpuDelay);
                                }
                            }
                        } catch (InterruptedException e) {
                        }
                        updateCpuStatsNow(); //更新CPU状态
                    } catch (Exception e) { 
                        Slog.e(TAG, "Unexpected exception collecting process stats", e);
                    }
                }
            }
        };

        //Watchdog添加对AMS的监控
        Watchdog.getInstance().addMonitor(this);
        Watchdog.getInstance().addThread(mHandler);
    }

该过程共创建了3个线程：分别为"ActivityManager"，"android.ui"，"CpuTracker"。

**3-2. AMS.start()**

    private void start() {
        Process.removeAllProcessGroups(); //移除所有的进程组
        mProcessCpuThread.start(); //启动CpuTracker线程

        mBatteryStatsService.publish(mContext); //启动电池统计服务
        mAppOpsService.publish(mContext);
        //创建LocalService，并添加到LocalServices
        LocalServices.addService(ActivityManagerInternal.class, new LocalService());
    }


### 4 setSystemProcess

[-->ActivityManagerService.java]

    public void setSystemProcess() {
        try {
            ServiceManager.addService(Context.ACTIVITY_SERVICE, this, true);
            ServiceManager.addService(ProcessStats.SERVICE_NAME, mProcessStats);
            ServiceManager.addService("meminfo", new MemBinder(this));
            ServiceManager.addService("gfxinfo", new GraphicsBinder(this));
            ServiceManager.addService("dbinfo", new DbBinder(this));
            if (MONITOR_CPU_USAGE) {
                ServiceManager.addService("cpuinfo", new CpuBinder(this));
            }
            ServiceManager.addService("permission", new PermissionController(this));
            ServiceManager.addService("processinfo", new ProcessInfoService(this));
            ApplicationInfo info = mContext.getPackageManager().getApplicationInfo(
                    "android", STOCK_PM_FLAGS);

            //调用ActivityThread的installSystemApplicationInfo()方法 【见小节4-2】
            mSystemThread.installSystemApplicationInfo(info, getClass().getClassLoader());
            synchronized (this) {
                //创建ProcessRecord对象 【见小节4-3】
                ProcessRecord app = newProcessRecordLocked(info, info.processName, false, 0);
                app.persistent = true;
                app.pid = MY_PID;
                app.maxAdj = ProcessList.SYSTEM_ADJ;
                app.makeActive(mSystemThread.getApplicationThread(), mProcessStats);
                synchronized (mPidsSelfLocked) {
                    mPidsSelfLocked.put(app.pid, app);
                }
                updateLruProcessLocked(app, false, null);//维护进程lru
                updateOomAdjLocked(); //更新adj
            }
        } catch (PackageManager.NameNotFoundException e) {
            throw new RuntimeException("", e);
        }
    }

该方法主要工作，注册下面的服务：

|服务名|类名|功能
|---|----|
|activity|ActivityManagerService|AMS
|procstats|ProcessStatsService|进程统计
|meminfo|MemBinder|内存
|gfxinfo|GraphicsBinder|graphics
|dbinfo|DbBinder|数据库
|cpuinfo|CpuBinder|CPU
|permission|PermissionController|权限
|processinfo|ProcessInfoService|进程服务

想要查看这些服务的信息，可通过`dumpsys <服务名>`命令。比如查看CPU信息命令`dumpsys cpuinfo`，查看graphics信息命令`dumpsys gfxinfo`。

**4-2 installSystemApplicationInfo**

[-->ActivityThread.java]

    public void installSystemApplicationInfo(ApplicationInfo info, ClassLoader classLoader) {
        synchronized (this) {
            //调用ContextImpl的nstallSystemApplicationInfo()方法，
            //最终调用LoadedApk的installSystemApplicationInfo，加载名为“android”的package
            getSystemContext().installSystemApplicationInfo(info, classLoader);

            //创建用于性能统计的Profiler对象
            mProfiler = new Profiler();
        }
    }

**4-3 newProcessRecordLocked**

    final ProcessRecord newProcessRecordLocked(ApplicationInfo info, String customProcess,
            boolean isolated, int isolatedUid) {
        String proc = customProcess != null ? customProcess : info.processName;
        BatteryStatsImpl stats = mBatteryStatsService.getActiveStatistics();
        final int userId = UserHandle.getUserId(info.uid);
        int uid = info.uid;
        if (isolated) {
            if (isolatedUid == 0) {
                int stepsLeft = Process.LAST_ISOLATED_UID - Process.FIRST_ISOLATED_UID + 1;
                while (true) {
                    if (mNextIsolatedProcessUid < Process.FIRST_ISOLATED_UID
                            || mNextIsolatedProcessUid > Process.LAST_ISOLATED_UID) {
                        mNextIsolatedProcessUid = Process.FIRST_ISOLATED_UID;
                    }
                    uid = UserHandle.getUid(userId, mNextIsolatedProcessUid);
                    mNextIsolatedProcessUid++;
                    if (mIsolatedProcesses.indexOfKey(uid) < 0) {
                        //该uid下没有进程，则使用该uid
                        break;
                    }
                    stepsLeft--;
                    if (stepsLeft <= 0) {
                        return null;
                    }
                }
            } else {
                uid = isolatedUid;
            }
        }
        // 创建ProcessRecord对象
        final ProcessRecord r = new ProcessRecord(stats, info, proc, uid);
        if (!mBooted && !mBooting
                && userId == UserHandle.USER_OWNER
                && (info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
            r.persistent = true; //设置该进程常驻内存，被杀后会自动重启。
        }
        addProcessNameLocked(r);
        return r;
    }

### 5. startCoreServices

	private void startCoreServices() {
	        //设置AMS的App使用情况统计服务
	        mActivityManagerService.setUsageStatsManager(
	                LocalServices.getService(UsageStatsManagerInternal.class));
	}

可通过`dumpys usagestats`查看用户的每个应用的使用情况

### 6. startOtherServices

    private void startOtherServices() {
        //安装系统Provider 【见小节7】
        mActivityManagerService.installSystemProviders();

        //初始看门狗，来监控AMS
        final Watchdog watchdog = Watchdog.getInstance();
        watchdog.init(context, mActivityManagerService);

        //初始化WMS，并设置到AMS中
        wm = WindowManagerService.main(context, inputManager,
                mFactoryTestMode != FactoryTest.FACTORY_TEST_LOW_LEVEL,
                !mFirstBoot, mOnlyCore);
        mActivityManagerService.setWindowManager(wm);

        ...
        mActivityManagerService.systemReady(new Runnable() {
            @Override
            public void run() {
                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_ACTIVITY_MANAGER_READY);

                mActivityManagerService.startObservingNativeCrashes();

                WebViewFactory.prepareWebViewInSystemServer();
                //启动系统UI 【8】
                startSystemUi(context);
                // 执行一系列服务的systemReady方法
                if (networkScoreF != null) networkScoreF.systemReady();
                if (networkManagementF != null) networkManagementF.systemReady();
                if (networkStatsF != null) networkStatsF.systemReady();
                if (networkPolicyF != null) networkPolicyF.systemReady();
                if (connectivityF != null) connectivityF.systemReady();
                if (audioServiceF != null) audioServiceF.systemReady();
                Watchdog.getInstance().start();

                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_THIRD_PARTY_APPS_CAN_START);

                if (wallpaperF != null) wallpaperF.systemRunning();
                if (immF != null) immF.systemRunning(statusBarF);
                if (locationF != null) locationF.systemRunning();
                if (countryDetectorF != null) countryDetectorF.systemRunning();
                if (networkTimeUpdaterF != null) networkTimeUpdaterF.systemRunning();
                if (commonTimeMgmtServiceF != null) {
                    commonTimeMgmtServiceF.systemRunning();
                }
                if (textServiceManagerServiceF != null)
                    textServiceManagerServiceF.systemRunning();
                if (atlasF != null) atlasF.systemRunning();
                if (inputManagerF != null) inputManagerF.systemRunning();
                if (telephonyRegistryF != null) telephonyRegistryF.systemRunning();
                if (mediaRouterF != null) mediaRouterF.systemRunning();
                if (mmsServiceF != null) mmsServiceF.systemRunning();
            }
        });
    }

### 7. installSystemProviders

    public final void installSystemProviders() {
        List<ProviderInfo> providers;
        synchronized (this) {
            ProcessRecord app = mProcessNames.get("system", Process.SYSTEM_UID);
            providers = generateApplicationProvidersLocked(app);
            if (providers != null) {
                for (int i=providers.size()-1; i>=0; i--) {
                    ProviderInfo pi = (ProviderInfo)providers.get(i);
                    if ((pi.applicationInfo.flags&ApplicationInfo.FLAG_SYSTEM) == 0) {
                        providers.remove(i);
                    }
                }
            }
        }
        if (providers != null) {
            //为ActivityThread安装系统provider【】
            mSystemThread.installSystemProviders(providers);
        }

        // 创建核心Settings Observer，用于监控Settings的改变。
        mCoreSettingsObserver = new CoreSettingsObserver(this);
    }

启动SettingsProvider

### 8. startSystemUi

    static final void startSystemUi(Context context) {
        Intent intent = new Intent();
        intent.setComponent(new ComponentName("com.android.systemui",
                    "com.android.systemui.SystemUIService"));
        context.startServiceAsUser(intent, UserHandle.OWNER);
    }

启动服务"com.android.systemui/.SystemUIService"


### AMS总结

1. 创建AMS实例对象，创建Andoid Runtime，ActivityThread和Context对象；
2. setSystemProcess：注册AMS、meminfo、cpuinfo等服务到ServiceManager；再创建ProcessRecord对象；
3. installSystemProviderss，加载SettingsProvider；
4. 启动SystemUIService，再调用一系列服务的systemReady()方法；

当这些都创建完毕后，便启动HomeActivity界面。

先写到这，后面再继续更新。