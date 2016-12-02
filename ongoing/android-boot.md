.x以调试的视角来看待系统启动

## 一. 概述


## 二. Zygote

    App_main.main
        AR.start
            AR.startVm
            AR.startReg
            ZygoteInit.main (首次进入Java世界)
                registerZygoteSocket
                preload
                startSystemServer
                runSelectLoop

### 2.1 App_main
[-> App_main.cpp]

    int main(int argc, char* const argv[])
    {
        AppRuntime runtime(argv[0], computeArgBlockSize(argc, argv));
        ...

        while (i < argc) {
            const char* arg = argv[i++];
            if (strcmp(arg, "--zygote") == 0) {
                zygote = true;
                niceName = ZYGOTE_NICE_NAME; //对于64位系统nice_name为zygote64; 32位系统为zygote
            } else if (strcmp(arg, "--start-system-server") == 0) {
                startSystemServer = true;
            } else if (strcmp(arg, "--application") == 0) {
                application = true;
            } else if (strncmp(arg, "--nice-name=", 12) == 0) {
                niceName.setTo(arg + 12); //设置进程名
            } else if (strncmp(arg, "--", 2) != 0) {
                className.setTo(arg);
                break;
            } else {
                --i;
                break;
            }
        }
        ...

        //设置进程名
        if (!niceName.isEmpty()) {
            runtime.setArgv0(niceName.string());
            set_process_name(niceName.string());
        }

        if (zygote) {
            // 启动AppRuntime 【见小节2.2】
            runtime.start("com.android.internal.os.ZygoteInit", args, zygote);
        } else if (className) {
            ...
        } else {
            ...
        }
    }

### 2.2 AndroidRuntime::start
[-> AndroidRuntime.cpp]

    void AndroidRuntime::start(const char* className, const Vector<String8>& options)
    {
        ALOGD("\n>>>>>> AndroidRuntime START %s <<<<<<\n",
                className != NULL ? className : "(unknown)");
        ...
        // 虚拟机创建
        if (startVm(&mJavaVM, &env, zygote) != 0) {
            return;
        }
        onVmCreated(env);

        // JNI方法注册
        if (startReg(env) < 0) {
            return;
        }
        ...
        // 调用ZygoteInit.main()方法[见小节2.3]
        env->CallStaticVoidMethod(startClass, startMeth, strArray);

### 2.3 ZygoteInit.main
[-->ZygoteInit.java]

    public static void main(String argv[]) {
        try {
            ...

            registerZygoteSocket(socketName); //为Zygote注册socket
            preload(); // 预加载类和资源[见小节2.4]
            SamplingProfilerIntegration.writeZygoteSnapshot();
            gcAndFinalize();
            if (startSystemServer) {
                startSystemServer(abiList, socketName);//启动system_server【见小节3.1】
            }
            Log.i(TAG, "Accepting command socket connections");
            runSelectLoop(abiList); //进入循环模式[见小节2.5]
            closeServerSocket();
        } catch (MethodAndArgsCaller caller) {
            caller.run(); //启动system_server中会讲到。
        } catch (RuntimeException ex) {
            closeServerSocket();
            throw ex;
        }
    }

### 2.4 preload
[-->ZygoteInit.java]

    static void preload() {
        Log.d(TAG, "begin preload");
        preloadClasses();
        preloadResources();
        preloadOpenGL();
        preloadSharedLibraries();
        WebViewFactory.prepareWebViewInZygote();
        Log.d(TAG, "end preload");
    }

### 2.5 runSelectLoop
[-->ZygoteInit.java]

    private static void runSelectLoop(String abiList) throws MethodAndArgsCaller {
        ArrayList<FileDescriptor> fds = new ArrayList<FileDescriptor>();
        ArrayList<ZygoteConnection> peers = new ArrayList<ZygoteConnection>();
        //sServerSocket是socket通信中的服务端，即zygote进程
        fds.add(sServerSocket.getFileDescriptor());
        peers.add(null);

        while (true) {
            StructPollfd[] pollFds = new StructPollfd[fds.size()];
            for (int i = 0; i < pollFds.length; ++i) {
                pollFds[i] = new StructPollfd();
                pollFds[i].fd = fds.get(i);
                pollFds[i].events = (short) POLLIN;
            }
            ...
            Os.poll(pollFds, -1);

            for (int i = pollFds.length - 1; i >= 0; --i) {
                //采用I/O多路复用机制，当客户端发出连接请求或者数据处理请求时，跳过continue，执行后面的代码
                if ((pollFds[i].revents & POLLIN) == 0) {
                    continue;
                }
                if (i == 0) {
                    //创建客户端连接
                    ZygoteConnection newPeer = acceptCommandPeer(abiList);
                    peers.add(newPeer);
                    fds.add(newPeer.getFileDesciptor());
                } else {
                    //处理客户端数据事务
                    boolean done = peers.get(i).runOnce();
                    if (done) {
                        peers.remove(i);
                        fds.remove(i);
                    }
                }
            }
        }
    }

## 三. system_server

### 3.1 startSystemServer
[–>ZygoteInit.java]

    private static boolean startSystemServer(String abiList, String socketName)
            throws MethodAndArgsCaller, RuntimeException {
        ...

        // fork子进程system_server
        pid = Zygote.forkSystemServer(
                parsedArgs.uid, parsedArgs.gid,
                parsedArgs.gids,
                parsedArgs.debugFlags,
                null,
                parsedArgs.permittedCapabilities,
                parsedArgs.effectiveCapabilities);
        ...

        if (pid == 0) {
            if (hasSecondZygote(abiList)) {
                waitForSecondaryZygote(socketName);
            }
            //进入system_server进程[见小节3.2]
            handleSystemServerProcess(parsedArgs);
        }
        return true;
    }

### 3.2 handleSystemServerProcess
[-->ZygoteInit.java]

    private static void handleSystemServerProcess(
            ZygoteConnection.Arguments parsedArgs)
            throws ZygoteInit.MethodAndArgsCaller {
        ...
        if (parsedArgs.niceName != null) {
             //设置当前进程名为"system_server"
            Process.setArgV0(parsedArgs.niceName);
        }

        final String systemServerClasspath = Os.getenv("SYSTEMSERVERCLASSPATH");
        if (systemServerClasspath != null) {
            //执行dex优化操作,比如services.jar
            performSystemServerDexOpt(systemServerClasspath);
        }

        if (parsedArgs.invokeWith != null) {
            ...
        } else {
            ClassLoader cl = null;
            if (systemServerClasspath != null) {
                cl = new PathClassLoader(systemServerClasspath, ClassLoader.getSystemClassLoader());
                Thread.currentThread().setContextClassLoader(cl);
            }
            //[见小节3.3]
            RuntimeInit.zygoteInit(parsedArgs.targetSdkVersion, parsedArgs.remainingArgs, cl);
        }
    }

### 3.3 zygoteInit
[-->ZygoteInit.java]

    public static final void zygoteInit(int targetSdkVersion, String[] argv, ClassLoader classLoader)
            throws ZygoteInit.MethodAndArgsCaller {

        Trace.traceBegin(Trace.TRACE_TAG_ACTIVITY_MANAGER, "RuntimeInit");
        redirectLogStreams(); //重定向log输出

        commonInit(); // 通用的一些初始化
        nativeZygoteInit(); // zygote初始化
        applicationInit(targetSdkVersion, argv, classLoader); // [见小节3.4]
    }

nativeZygoteInit()方法经过层层调用,会进入app_main.cpp中的onZygoteInit()方法, Binder线程池的创建也是在这个过程,如下:

    virtual void onZygoteInit()
    {
        sp<ProcessState> proc = ProcessState::self();
        proc->startThreadPool(); //启动新binder线程
    }

### 3.4 ZygoteInit.main
[–>ZygoteInit.java]

applicationInit()方法经过层层调用,会抛出异常ZygoteInit.MethodAndArgsCaller(m, argv),

    public static void main(String argv[]) {
        try {
            startSystemServer(abiList, socketName); //抛出MethodAndArgsCaller异常
            ....
        } catch (MethodAndArgsCaller caller) {
            caller.run(); //此处通过反射,会调用SystemServer.main()方法
        } catch (RuntimeException ex) {
            ...
        }
    }

采用抛出异常的方式,用于栈帧清空,提供利用率, 以至于现在大家看到的每个Java进程的调用栈如下:

    at com.android.server.SystemServer.main(SystemServer.java:175)
    at java.lang.reflect.Method.invoke!(Native method)
    at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:738)
    at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:628)

### 3.5 SystemServer.main
[-->SystemServer.java]

    public final class SystemServer {
        ...
        public static void main(String[] args) {
            //先初始化SystemServer对象，再调用对象的run()方法
            new SystemServer().run();
        }
    }

### 3.6 SystemServer.run
[-->SystemServer.java]

    private void run() {
        if (System.currentTimeMillis() < EARLIEST_SUPPORTED_TIME) {
            Slog.w(TAG, "System clock is before 1970; setting to 1970.");
            SystemClock.setCurrentTimeMillis(EARLIEST_SUPPORTED_TIME);
        }
        ...

        Slog.i(TAG, "Entered the Android system server!");
        EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_SYSTEM_RUN, SystemClock.uptimeMillis());

        Looper.prepareMainLooper();// 准备主线程looper

        //加载android_servers.so库，该库包含的源码在frameworks/base/services/目录下
        System.loadLibrary("android_servers");

        //检测上次关机过程是否失败，该方法可能不会返回[见小节3.6.1]
        performPendingShutdown();

        createSystemContext(); //初始化系统上下文

        //创建系统服务管理
        mSystemServiceManager = new SystemServiceManager(mSystemContext);
        LocalServices.addService(SystemServiceManager.class, mSystemServiceManager);

        //启动各种系统服务[见小节3.7]
        try {
            startBootstrapServices(); // 启动引导服务
            startCoreServices();      // 启动核心服务
            startOtherServices();     // 启动其他服务
        } catch (Throwable ex) {
            Slog.e("System", "************ Failure starting system services", ex);
            throw ex;
        }

        //一直循环执行
        Looper.loop();
        throw new RuntimeException("Main thread loop unexpectedly exited");
    }

#### 3.6.1  performPendingShutdown
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


### 3.7 服务启动

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

- start: 创建AMS, PMS, LightsService, DMS.
- phase100: 进入Phase100, 创建PKMS, WMS, IMS, DBMS, LockSettingsService, JobSchedulerService, MmsService等服务;
- phase480 && 500: 进入Phase480, 调用WMS, PMS, PKMS, DisplayManagerService这4个服务的systemReady();
- Phase550: 进入phase550, 执行AMS.systemReady(), 启动SystemUI, WebViewFactory, Watchdog.
- Phase600: 进入phase600, 执行AMS.systemReady(), 执行各种服务的systemRunning().
- Phase1000: 进入1000, 执行finishBooting, 启动启动on-hold进程.

### 3.8 AMS.systemReady

#### 3.8.0 deliverPreBootCompleted

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

        PreBootContinuation cont = new PreBootContinuation(intent, onFinishCallback, doneReceivers,
                ris, users);
        cont.go();
        return true;
    }

##### 3.8.1 cont.go

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
        broadcastIntentLocked(null, null, intent, null, this,
                0, null, null, null, AppOpsManager.OP_NONE,
                null, true, false, MY_PID, Process.SYSTEM_UID, users[curUser]);
    }

#### 3.8.1 removeProcessLocked

    //callerWillRestart = true,  allowRestart = false;
    private final boolean removeProcessLocked(ProcessRecord app,
            boolean callerWillRestart, boolean allowRestart, String reason) {
        ...
        boolean needRestart = false;
        if (app.pid > 0 && app.pid != MY_PID) {
            int pid = app.pid;
            ...
            boolean willRestart = false;
            if (app.persistent && !app.isolated) {
                if (!callerWillRestart) {
                    willRestart = true;
                } else {
                    needRestart = true; //执行此分支
                }
            }
            app.kill(reason, true);
            handleAppDiedLocked(app, willRestart, allowRestart);
            if (willRestart) {
                ....
            }
        } else {
            mRemovedProcesses.add(app);
        }

        return needRestart;
    }

#### 3.8.2 addAppLocked

    final ProcessRecord addAppLocked(ApplicationInfo info, boolean isolated,
            String abiOverride) {
        ProcessRecord app;
        if (!isolated) {
            //查询进程
            app = getProcessRecordLocked(info.processName, info.uid, true);
        } else {
            app = null;
        }

        if (app == null) {
            //创建进程
            app = newProcessRecordLocked(info, null, isolated, 0);
            updateLruProcessLocked(app, false, null);
            updateOomAdjLocked();
        }


        AppGlobals.getPackageManager().setPackageStoppedState(
                info.packageName, false, UserHandle.getUserId(app.uid));


        if ((info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
            app.persistent = true;
            app.maxAdj = ProcessList.PERSISTENT_PROC_ADJ;
        }

        if (app.thread == null && mPersistentStartingProcesses.indexOf(app) < 0) {
            mPersistentStartingProcesses.add(app);
            //启动进程
            startProcessLocked(app, "added application", app.processName, abiOverride,
                    null, null);
        }

        return app;
    }

#### 3.8.3 goingCallback.run

    private void startOtherServices() {
        ...
        mActivityManagerService.systemReady(new Runnable() {

            public void run() {
                mSystemServiceManager.startBootPhase(
                        SystemService.PHASE_ACTIVITY_MANAGER_READY);

                mActivityManagerService.startObservingNativeCrashes();
                //启动WebView
                WebViewFactory.prepareWebViewInSystemServer();
                //启动系统UI
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
                if (commonTimeMgmtServiceF != null)   commonTimeMgmtServiceF.systemRunning();
                if (textServiceManagerServiceF != null)  textServiceManagerServiceF.systemRunning();
                if (atlasF != null) atlasF.systemRunning();
                if (inputManagerF != null) inputManagerF.systemRunning();
                if (telephonyRegistryF != null) telephonyRegistryF.systemRunning();
                if (mediaRouterF != null) mediaRouterF.systemRunning();
                if (mmsServiceF != null) mmsServiceF.systemRunning();
            }
        });
    }

#### 3.8.4 startProcessLocked

    final ProcessRecord startProcessLocked(String processName, ApplicationInfo info,
            boolean knownToBeDead, int intentFlags, String hostingType, ComponentName hostingName,
            boolean allowWhileBooting, boolean isolated, int isolatedUid, boolean keepIfLarge,
            String abiOverride, String entryPoint, String[] entryPointArgs, Runnable crashHandler) {
        ProcessRecord app = getProcessRecordLocked(processName, info.uid, keepIfLarge);
        ...

        if (app == null) {
            app = newProcessRecordLocked(info, processName, isolated, isolatedUid);
            ...
        }

        //对于非persistent进程,AMS还没执行systemReady时,不允许启动进程
        if (!mProcessesReady
                && !isAllowedWhileBooting(info)
                && !allowWhileBooting) {
            if (!mProcessesOnHold.contains(app)) {
                mProcessesOnHold.add(app);
            }
            return app;
        }
        //启动进程
        startProcessLocked(app, hostingType, hostingNameStr, abiOverride, entryPoint, entryPointArgs);
        return (app.pid != 0) ? app : null;
    }

只有以下场景会跳过上述检查过程,其他场景非persistent进程必须等待mProcessesReady = true. 可以看出几乎所有进程都需要这个监测.

- addAppLocked()启动persistent进程;
- finishBooting()启动on-hold进程;
- cleanUpApplicationRecordLock() 启动需要restart进程;
- attachApplicationLocked() 绑定Bind死亡通告失败,则启动进程;


#### 3.8.5 AMS.systemReady

    public void systemReady(final Runnable goingCallback) {
        synchronized(this) {
            ...
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
                    Slog.i(TAG, "Removing system update proc: " + proc);
                    removeProcessLocked(proc, true, false, "system update done");
                }
            }

            mProcessesReady = true; //进程处于ready状态
        }

        Slog.i(TAG, "System now ready");
        EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_AMS_READY,
            SystemClock.uptimeMillis());
        ...

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
                Intent intent = new Intent(Intent.ACTION_USER_STARTED);
                intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY
                        | Intent.FLAG_RECEIVER_FOREGROUND);
                intent.putExtra(Intent.EXTRA_USER_HANDLE, mCurrentUserId);
                broadcastIntentLocked(null, null, intent,
                        null, null, 0, null, null, null, AppOpsManager.OP_NONE,
                        null, false, false, MY_PID, Process.SYSTEM_UID, mCurrentUserId);

                intent = new Intent(Intent.ACTION_USER_STARTING);
                intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY);
                intent.putExtra(Intent.EXTRA_USER_HANDLE, mCurrentUserId);
                broadcastIntentLocked(null, null, intent,
                        null, new IIntentReceiver.Stub() {
                            @Override
                            public void performReceive(Intent intent, int resultCode, String data,
                                    Bundle extras, boolean ordered, boolean sticky, int sendingUser)
                                    throws RemoteException {
                            }
                        }, 0, null, null,
                        new String[] {INTERACT_ACROSS_USERS}, AppOpsManager.OP_NONE,
                        null, true, false, MY_PID, Process.SYSTEM_UID, UserHandle.USER_ALL);
            } catch (Throwable t) {
                ...
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
            mStackSupervisor.resumeTopActivitiesLocked();
            sendUserSwitchBroadcastsLocked(-1, mCurrentUserId);
        }
    }

## 四. app

### ActivityThread.main

at android.app.ActivityThread.main(ActivityThread.java:5442)
at java.lang.reflect.Method.invoke!(Native method)
at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:738)
at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:628)



## 五. 总结

dwwdddd

|进程|起点|
|---|---|
|Zygote进程|ZygoteInit.main()|
|system_server进程|SystemServer.main()|
|app进程|ActivityThread.main()|

### Log

#### 1. before zygote

//启动vold, 再列举当前系统所支持的文件系统.  执行到system/vold/main.cpp的main()
11-23 14:36:47.474   383   383 I vold    : Vold 3.0 (the awakening) firing up  
11-23 14:36:47.475   383   383 V vold    : Detected support for: ext4 vfat   
//使用内核的lmk策略
11-23 14:36:47.927   432   432 I lowmemorykiller: Using in-kernel low memory killer interface
//启动SurfaceFlinger
11-23 14:36:48.041   434   434 I SurfaceFlinger: SurfaceFlinger is starting
11-23 14:36:48.042   434   434 I SurfaceFlinger: SurfaceFlinger's main thread ready to run. Initializing graphics H/W...
// 开机动画
11-23 14:36:48.583   508   508 I BootAnimation: bootanimation launching ...
// debuggerd
11-23 14:36:50.306   537   537 I         : debuggerd: starting
// installd启动
11-23 14:36:50.311   541   541 I installd: installd firing up
// thermal守护进程
11-23 14:36:50.369   552   552 I ThermalEngine: Thermal daemon started
...

#### 2. zygote

// Zygote64进程(Zygote):  AndroidRuntime::start
11-23 14:36:51.260   557   557 D AndroidRuntime: >>>>>> START com.android.internal.os.ZygoteInit uid 0 <<<<<<
// Zygote64进程:  AndroidRuntime::startVm
11-23 14:36:51.304   557   557 D AndroidRuntime: CheckJNI is OFF

// 执行ZygoteInit.preload()
11-23 14:36:52.134   557   557 D Zygote  : begin preload
// 执行ZygoteInit.preloadClasses(), 预加载3860个classes, 花费时长746ms
11-23 14:36:52.134   557   557 I Zygote  : Preloading classes...
11-23 14:36:52.881   557   557 I Zygote  : ...preloaded 3860 classes in 746ms.

// 执行ZygoteInit.preloadClasses(), 预加载86组资源, 花费时长179ms
11-23 14:36:53.114   557   557 I Zygote  : Preloading resources...
11-23 14:36:53.293   557   557 I Zygote  : ...preloaded 86 resources in 179ms.

// 执行ZygoteInit.preloadSharedLibraries()
11-23 14:36:53.494   557   557 I Zygote  : Preloading shared libraries...
11-23 14:36:53.503   557   557 D Zygote  : end preload

// 执行com_android_internal_os_Zygote_nativeForkSystemServer(),成功fork出system_server进程
11-23 14:36:53.544   557   557 I Zygote  : System server process 1274 has been created
// Zygote开始进入runSelectLoop()
11-23 14:36:53.546   557   557 I Zygote  : Accepting command socket connections
...

#### 3. system_server

//进入system_server, 建立跟Zygote进程的socket通道
11-23 14:36:53.586  1274  1274 I Zygote  : Process: zygote socket opened, supported ABIS: armeabi-v7a,armeabi
// 执行SystemServer.run()
11-23 14:36:53.618  1274  1274 I SystemServer: Entered the Android system server!   <===> boot_progress_system_run
// 等待installd准备就绪
11-23 14:36:53.707  1274  1274 I Installer: Waiting for installd to be ready.

//服务启动
11-23 14:36:53.732  1274  1274 I ActivityManager: Memory class: 192

//phase100
11-23 14:36:53.883  1274  1274 I SystemServiceManager: Starting phase 100
11-23 14:36:53.902  1274  1274 I SystemServer: Package Manager
11-23 14:37:03.816  1274  1274 I SystemServer: User Service
...
11-23 14:37:03.940  1274  1274 I SystemServer: Init Watchdog
11-23 14:37:03.941  1274  1274 I SystemServer: Input Manager
11-23 14:37:03.946  1274  1274 I SystemServer: Window Manager
...
11-23 14:37:04.081  1274  1274 I SystemServiceManager: Starting com.android.server.MountService$Lifecycle
11-23 14:37:04.088  1274  2717 D MountService: Thinking about reset, mSystemReady=false, mDaemonConnected=true
11-23 14:37:04.088  1274  1274 I SystemServiceManager: Starting com.android.server.UiModeManagerService
11-23 14:37:04.520  1274  1274 I SystemServer: NetworkTimeUpdateService

//phase480 && 500
11-23 14:37:05.056  1274  1274 I SystemServiceManager: Starting phase 480
11-23 14:37:05.061  1274  1274 I SystemServiceManager: Starting phase 500
11-23 14:37:05.231  1274  1274 I ActivityManager: System now ready  <==> boot_progress_ams_ready
11-23 14:37:05.234  1274  1274 I SystemServer: Making services ready
11-23 14:37:05.243  1274  1274 I SystemServer: WebViewFactory preparation

//phase550
11-23 14:37:05.234  1274  1274 I SystemServiceManager: Starting phase 550
11-23 14:37:05.237  1274  1288 I ActivityManager: Force stopping com.android.providers.media appid=10010 user=-1: vold reset

//Phase600
11-23 14:37:06.066  1274  1274 I SystemServiceManager: Starting phase 600
11-23 14:37:06.236  1274  1274 D MountService: onStartUser 0

#### 进程信息

/system/bin/vold: 383
/system/bin/lmkd: 432
/system/bin/surfaceflinger: 434
/system/bin/debuggerd64: 537
/system/bin/mediaserver: 540
/system/bin/installd: 541
/system/vendor/bin/thermal-engine: 552

zygote: 443 (隐私空间)
zygote64: 557
zygote: 558
system_server: 1274



#### 几个重要的现场调试命令

1. cat proc/[pid]/stack
2. debuggerd -b [pid] ==> 也不可以不带参数-b, 则直接输出到/data/tombstones/目录
3. kill -3 [pid]   ==> 出现问题无法创建的话, 则先手动创建/data/anr/traces.txt文件 (权限问题)

关于traces有两个文件, traces.txt.bugreport代表的是抓bugreport额时候的traces, 而traces.txt文件则是上次发生anr或者手动发送signal 3而输出的问题.

- adb bugreport

- logcat -b all
- dmesg 或者 cat /proc/kmsg
- 上一次: cat /proc/last_kmsg
- 上一次: logcat -L

- /d/binder/目录下记录的binder输出信息.


### 分析技巧

先看zygote释放起来, 再看system_server主线程的运行情况.

adb logcat -s Zygote
adb logcat -s SystemServer
adb logcat | grep "1359  1359" //system_server情况
adb logcat -s ActivityManager