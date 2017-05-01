---
layout: post
title:  "ActivityManagerService启动过程"
date:   2016-02-21 21:12:40
catalog:  true
tags:
    - android
    - 系统启动
    - AMS

---

> 基于Android 6.0的源码剖析， 分析Android系统服务ActivityManagerService，简称AMS

    frameworks/base/core/java/android/app/
      - ActivityThread.java
      - LoadedApk.java
      - ContextImpl.java
      
    frameworks/base/services/java/com/android/server/
      - SystemServer.java
    
    frameworks/base/services/core/java/com/android/server/
      - SystemServiceManager.java
      - ServiceThread.java
      - pm/Installer.java
      - am/ActivityManagerService.java


## 一、概述

[Android系统启动-SystemServer篇(二)](http://gityuan.com/2016/02/20/android-system-server-2/)中有讲到AMS，本文以AMS为主线，讲述system_server进程中AMS服务的启动过程，以startBootstrapServices()方法为起点，紧跟着startCoreServices(), startOtherServices()共3个方法。


## 二. AMS启动过程

### 2.1 startBootstrapServices
[-> SystemServer.java]

    private void startBootstrapServices() {
        ...
        //启动AMS服务【见小节2.2】
        mActivityManagerService = mSystemServiceManager.startService(
                ActivityManagerService.Lifecycle.class).getService();
                
        //设置AMS的系统服务管理器
        mActivityManagerService.setSystemServiceManager(mSystemServiceManager);
        //设置AMS的APP安装器
        mActivityManagerService.setInstaller(installer);
        //初始化AMS相关的PMS
        mActivityManagerService.initPowerManagement();
        ...

        //设置SystemServer【见小节2.3】
        mActivityManagerService.setSystemProcess();
    }

### 2.2 启动AMS服务

SystemServiceManager.startService(ActivityManagerService.Lifecycle.class) 功能主要：

1. 创建ActivityManagerService.Lifecycle对象；
2. 调用Lifecycle.onStart()方法。

#### 2.1.1 AMS.Lifecycle
[-> ActivityManagerService.java]

    public static final class Lifecycle extends SystemService {
        private final ActivityManagerService mService;

        public Lifecycle(Context context) {
            super(context);
            //创建ActivityManagerService【见小节2.1.2】
            mService = new ActivityManagerService(context);
        }

        @Override
        public void onStart() {
            mService.start();  //【见小节2.1.3】
        }

        public ActivityManagerService getService() {
            return mService;
        }
    }

该过程：创建AMS内部类的Lifecycle，已经创建AMS对象，并调用AMS.start();

#### 2.1.2 AMS创建

    public ActivityManagerService(Context systemContext) {
        mContext = systemContext;
        mFactoryTest = FactoryTest.getMode();//默认为FACTORY_TEST_OFF
        mSystemThread = ActivityThread.currentActivityThread();

        //创建名为"ActivityManager"的前台线程，并获取mHandler
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

        //创建目录/data/system
        File dataDir = Environment.getDataDirectory();
        File systemDir = new File(dataDir, "system");
        systemDir.mkdirs();

        //创建服务BatteryStatsService
        mBatteryStatsService = new BatteryStatsService(systemDir, mHandler);
        mBatteryStatsService.getActiveStatistics().readLocked();
        ...
        
        //创建进程统计服务，信息保存在目录/data/system/procstats，
        mProcessStats = new ProcessStatsService(this, new File(systemDir, "procstats"));

        mAppOpsService = new AppOpsService(new File(systemDir, "appops.xml"), mHandler);
        mGrantFile = new AtomicFile(new File(systemDir, "urigrants.xml"));

        // User 0是第一个，也是唯一的一个开机过程中运行的用户
        mStartedUsers.put(UserHandle.USER_OWNER, new UserState(UserHandle.OWNER, true));
        mUserLru.add(UserHandle.USER_OWNER);
        updateStartedUserArrayLocked();
        ...
            
        //CPU使用情况的追踪器执行初始化
        mProcessCpuTracker.init();
        ...
        mRecentTasks = new RecentTasks(this);
        // 创建ActivityStackSupervisor对象
        mStackSupervisor = new ActivityStackSupervisor(this, mRecentTasks);
        mTaskPersister = new TaskPersister(systemDir, mStackSupervisor, mRecentTasks);

        //创建名为"CpuTracker"的线程
        mProcessCpuThread = new Thread("CpuTracker") {
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
                }
              }
            }
        };
        ...
    }

该过程共创建了3个线程，分别为"ActivityManager"，"android.ui"，"CpuTracker"。

#### 2.1.3 AMS.start

    private void start() {
        Process.removeAllProcessGroups(); //移除所有的进程组
        mProcessCpuThread.start(); //启动CpuTracker线程

        mBatteryStatsService.publish(mContext); //启动电池统计服务
        mAppOpsService.publish(mContext);
        //创建LocalService，并添加到LocalServices
        LocalServices.addService(ActivityManagerInternal.class, new LocalService());
    }


### 2.3 AMS.setSystemProcess

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

            //【见小节2.3.1】
            mSystemThread.installSystemApplicationInfo(info, getClass().getClassLoader());
            synchronized (this) {
                //创建ProcessRecord对象
                ProcessRecord app = newProcessRecordLocked(info, info.processName, false, 0);
                app.persistent = true; //设置为persistent进程
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

该方法主要工作是注册各种服务。

#### 2.3.1 AT.installSystemApplicationInfo
[-> ActivityThread.java]

    public void installSystemApplicationInfo(ApplicationInfo info, ClassLoader classLoader) {
        synchronized (this) {
            //
            getSystemContext().installSystemApplicationInfo(info, classLoader);
            //创建用于性能统计的Profiler对象
            mProfiler = new Profiler();
        }
    }
    
该方法调用ContextImpl的nstallSystemApplicationInfo()方法，最终调用LoadedApk的installSystemApplicationInfo，加载名为“android”的package

#### 2.3.2  installSystemApplicationInfo
[-> LoadedApk.java]

    void installSystemApplicationInfo(ApplicationInfo info, ClassLoader classLoader) {
        assert info.packageName.equals("android");
        mApplicationInfo = info; //将包名为"android"的应用信息保存到mApplicationInfo
        mClassLoader = classLoader;
    }

### 2.4 startOtherServices

    private void startOtherServices() {
      ...
      //安装系统Provider 【见小节2.4.1】
      mActivityManagerService.installSystemProviders();
      ...
      
      //phase480 && 500
      mSystemServiceManager.startBootPhase(SystemService.PHASE_LOCK_SETTINGS_READY);
      mSystemServiceManager.startBootPhase(SystemService.PHASE_SYSTEM_SERVICES_READY);
      ...
      
      //【见小节3.1】
      mActivityManagerService.systemReady(new Runnable() {
         public void run() {
             //phase550
             mSystemServiceManager.startBootPhase(
                     SystemService.PHASE_ACTIVITY_MANAGER_READY);
             ...
             //phase600
             mSystemServiceManager.startBootPhase(
                     SystemService.PHASE_THIRD_PARTY_APPS_CAN_START);
             ...
          }
      }
    }
    
#### 2.4.1 AMS.installSystemProviders

    public final void installSystemProviders() {
        List<ProviderInfo> providers;
        synchronized (this) {
            ProcessRecord app = mProcessNames.get("system", Process.SYSTEM_UID);
            providers = generateApplicationProvidersLocked(app);
            if (providers != null) {
                for (int i=providers.size()-1; i>=0; i--) {
                    ProviderInfo pi = (ProviderInfo)providers.get(i);
                    //移除非系统的provider
                    if ((pi.applicationInfo.flags&ApplicationInfo.FLAG_SYSTEM) == 0) {
                        providers.remove(i);
                    }
                }
            }
        }
        if (providers != null) {
            //安装所有的系统provider
            mSystemThread.installSystemProviders(providers);
        }

        // 创建核心Settings Observer，用于监控Settings的改变。
        mCoreSettingsObserver = new CoreSettingsObserver(this);
    }
    
## 三. AMS.systemReady

AMS.systemReady()方法的参数为Runable类型的goingCallback， 该方法执行简单划分以下几部分：

    public void systemReady(final Runnable goingCallback) {
        before goingCallback;
        goingCallback.run();
        after goingCallback;
    }
    
### 3.1 before goingCallback

    synchronized(this) {
        if (mSystemReady) { //首次为flase，则不进入该分支
            if (goingCallback != null) {
                    goingCallback.run();
                }
            return;
        }

        mRecentTasks.clear();
        //恢复最近任务栏的task
        mRecentTasks.addAll(mTaskPersister.restoreTasksLocked());
        mRecentTasks.cleanupLocked(UserHandle.USER_ALL);
        mTaskPersister.startPersisting();

        if (!mDidUpdate) {
            if (mWaitingUpdate) {
                return;
            }
            final ArrayList<ComponentName> doneReceivers = new ArrayList<ComponentName>();
            //处于升级过程【见小节3.1.1】
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

            if (mWaitingUpdate) {
                return;
            }
            mDidUpdate = true;
        }

        mAppOpsService.systemReady();
        mSystemReady = true;
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

该阶段的主要功能：

- 向PRE_BOOT_COMPLETED的接收者发送广播；
- 杀掉procsToKill中的进程, 杀掉进程且不允许重启；
- 此时，系统和进程都处于ready状态；

#### 3.1.1 deliverPreBootCompleted

    private boolean deliverPreBootCompleted(final Runnable onFinishCallback,
            ArrayList<ComponentName> doneReceivers, int userId) {
        Intent intent = new Intent(Intent.ACTION_PRE_BOOT_COMPLETED);
        List<ResolveInfo> ris = AppGlobals.getPackageManager().queryIntentReceivers(
                    intent, null, 0, userId);

        //对于FLAG_SYSTEM=false的app直接过滤掉
        for (int i=ris.size()-1; i>=0; i--) {
            if ((ris.get(i).activityInfo.applicationInfo.flags
                    &ApplicationInfo.FLAG_SYSTEM) == 0) {
                ris.remove(i);
            }
        }
        intent.addFlags(Intent.FLAG_RECEIVER_BOOT_UPGRADE);

        if (userId == UserHandle.USER_OWNER) {
            ArrayList<ComponentName> lastDoneReceivers = readLastDonePreBootReceivers();
            for (int i=0; i<ris.size(); i++) {
                ActivityInfo ai = ris.get(i).activityInfo;
                ComponentName comp = new ComponentName(ai.packageName, ai.name);
                if (lastDoneReceivers.contains(comp)) {
                    ris.remove(i);
                    i--;
                    doneReceivers.add(comp);
                }
            }
        }
        ...

        PreBootContinuation cont = new PreBootContinuation(intent, onFinishCallback, 
                doneReceivers, ris, users);  //【见小节3.1.2】
        cont.go(); //【见小节3.1.3】
        return true;
    }

#### 3.1.2 PreBootContinuation
[-> ActivityManagerService.java ::PreBootContinuation]

    final class PreBootContinuation extends IIntentReceiver.Stub {

        PreBootContinuation(Intent _intent, Runnable _onFinishCallback,
                ArrayList<ComponentName> _doneReceivers, List<ResolveInfo> _ris, int[] _users) {
            intent = _intent;
            onFinishCallback = _onFinishCallback;
            doneReceivers = _doneReceivers;
            ris = _ris;
            users = _users;
        }
    }

#### 3.1.3 PreBootContinuation.go

    void go() {
        if (lastRi != curRi) {
            ActivityInfo ai = ris.get(curRi).activityInfo;
            ComponentName comp = new ComponentName(ai.packageName, ai.name);
            intent.setComponent(comp);
            doneReceivers.add(comp);
            lastRi = curRi;
            CharSequence label = ai.loadLabel(mContext.getPackageManager());
            showBootMessage(mContext.getString(R.string.android_preparing_apk, label), false);
        }
        
        Slog.i(TAG, "Pre-boot of " + intent.getComponent().toShortString()
                            + " for user " + users[curUser]);
        EventLogTags.writeAmPreBoot(users[curUser], intent.getComponent().getPackageName());
        //发送广播
        broadcastIntentLocked(null, null, intent, null, this,
                0, null, null, null, AppOpsManager.OP_NONE,
                null, true, false, MY_PID, Process.SYSTEM_UID, users[curUser]);
    }

### 3.2 goingCallback.run()

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
          //启动系统UI【见小节3.2.1】
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
                  
          //执行一系列服务的systemRunning方法
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

该过程启动各种进程：

- 启动阶段550，回调相应onBootPhase()方法；
- 启动WebView，并且会创建进程，这是zygote正式创建的第一个进程；
- 启动systemui服务；
- ...

#### 3.2.1 startSystemUi

    static final void startSystemUi(Context context) {
        Intent intent = new Intent();
        intent.setComponent(new ComponentName("com.android.systemui",
                    "com.android.systemui.SystemUIService"));
        context.startServiceAsUser(intent, UserHandle.OWNER);
    }

启动服务"com.android.systemui/.SystemUIService"

### 3.3 after goingCallback

    //启动【见小节3.3.1】
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

        mBooting = true; 
        // 启动桌面Activity 【见小节3.3.2】
        startHomeActivityLocked(mCurrentUserId, "systemReady");

        ...
        long ident = Binder.clearCallingIdentity();
        try {
            //system发送广播USER_STARTED
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

该阶段主要功能：

- 回调所有SystemService的onStartUser()方法；
- 启动persistent进程；
- 启动home Activity;
- 发送广播USER_STARTED和USER_STARTING；
- 恢复栈顶Activity;
- 发送广播USER_SWITCHED；

#### 3.3.1 SSM.startUser
[-> SystemServiceManager.java]

    public void startUser(final int userHandle) {
        final int serviceLen = mServices.size();
        for (int i = 0; i < serviceLen; i++) {
            final SystemService service = mServices.get(i);
            try {
                //回调所有SystemService的onStartUser()方法
                service.onStartUser(userHandle);
            } catch (Exception ex) {
                ...
            }
        }
    }

#### 3.3.2 AMS.startHomeActivityLocked

    boolean startHomeActivityLocked(int userId, String reason) {
        //home intent有CATEGORY_HOME
        Intent intent = getHomeIntent();
        ActivityInfo aInfo = resolveActivityInfo(intent, STOCK_PM_FLAGS, userId);
        if (aInfo != null) {
            intent.setComponent(new ComponentName(
                    aInfo.applicationInfo.packageName, aInfo.name));
            aInfo = new ActivityInfo(aInfo);
            aInfo.applicationInfo = getAppInfoForUser(aInfo.applicationInfo, userId);
            ProcessRecord app = getProcessRecordLocked(aInfo.processName,
                    aInfo.applicationInfo.uid, true);
            if (app == null || app.instrumentationClass == null) {
                intent.setFlags(intent.getFlags() | Intent.FLAG_ACTIVITY_NEW_TASK);
                //启动桌面Activity
                mStackSupervisor.startHomeActivity(intent, aInfo, reason);
            }
        }
        return true;
    }


### 小节

#### 3.8.4 mProcessesReady

startProcessLocked()过程对于非persistent进程必须等待mProcessesReady = true才会真正创建进程，否则进程放入mProcessesOnHold队列。
当然以下情况不会判断mProcessesReady：

- addAppLocked()启动persistent进程; //但此时已经mProcessesReady；
- finishBooting()启动on-hold进程; //但此时已经mProcessesReady；
- cleanUpApplicationRecordLock() //启动需要restart进程，前提是进程已创建；
- attachApplicationLocked() //绑定Bind死亡通告失败，前台同样是进程要已创建。

还有一个特殊情况，可以创建进程：processNextBroadcast()过程对于flag为FLAG_RECEIVER_BOOT_UPGRADE的广播拉进程
，只在小节3.1.1的升级过程会出现。

由此可见，mProcessesReady为没有处于ready状态之前则基本没有其他进程。

## 四. 总结

1. 创建AMS实例对象，创建Andoid Runtime，ActivityThread和Context对象；
2. setSystemProcess：注册AMS、meminfo、cpuinfo等服务到ServiceManager；
3. installSystemProviderss，加载SettingsProvider；
4. 启动SystemUIService，再调用一系列服务的systemReady()方法；

### 4.1 发布Binder服务

[小节2.3]的AMS.setSystemProcess()过程向servicemanager注册了如下这个binder服务

|服务名|类名|功能
|---|----|
|activity|ActivityManagerService|AMS
|procstats|ProcessStatsService|进程统计
|meminfo|MemBinder|内存
|gfxinfo|GraphicsBinder|图像信息
|dbinfo|DbBinder|数据库
|cpuinfo|CpuBinder|CPU
|permission|PermissionController|权限
|processinfo|ProcessInfoService|进程服务
|usagestats|UsageStatsService|应用的使用情况

想要查看这些服务的信息，可通过`dumpsys <服务名>`命令。比如查看CPU信息命令`dumpsys cpuinfo`。

### 4.2 AMS.systemReady
另外，AMS.systemReady()的大致过程如下:

    public final class ActivityManagerService{
            
        public void systemReady(final Runnable goingCallback) {
            ...//更新操作
            mSystemReady = true; //系统处于ready状态
            removeProcessLocked(proc, true, false, "system update done");//杀掉所有非persistent进程
            mProcessesReady = true;  //进程处于ready状态

            goingCallback.run(); //这里有可能启动进程
            
            addAppLocked(info, false, null); //启动所有的persistent进程
            mBooting = true;  //正在启动中
            startHomeActivityLocked(mCurrentUserId, "systemReady"); //启动桌面
            mStackSupervisor.resumeTopActivitiesLocked(); //恢复栈顶的Activity
        }
    }
