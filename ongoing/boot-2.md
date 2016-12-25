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
        cont.go(); //见下文
        return true;
    }

PreBootContinuation.go

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






### 进程相关

进程启动的场景hostingType所对应的值

addAppLocked,  "added application"

attachApplicationLocked,  "link fail"
cleanUpApplicationRecordLocked, "restart"
finishBooting,  "on-hold",    这个是在finishBooting()之后处理的

startIsolatedProcess, ""


AS.bringUpServiceLocked, "service"
ASS.startSpecificActivityLocked, "activity"
getContentProviderImpl "content provider"
BQ.processNextBroadcast, "broadcast"
appDiedLocked, "activity"
bindBackupAgent, "backup"

hostingNameStr值一般地是组件名

#### 创建进程

当执行完fork()则马上输出:

EventLog.writeEvent(EventLogTags.AM_PROC_START,
                    UserHandle.getUserId(uid), startResult.pid, uid,
                    app.processName, hostingType,
                    hostingNameStr != null ? hostingNameStr : "");
                    

Slog.i(TAG,"Start proc " pid, processName, uid, hostingType,  hostingNameStr);

#### 杀进程

Slog.i(TAG, "Killing " + toShortString() + " (adj " + setAdj + "): " + reason);
EventLog.writeEvent(EventLogTags.AM_KILL, userId, pid, processName, setAdj, reason);

是binder线程
12-16 10:00:38.503 24654 25606 I ActivityManager: 	at com.android.server.am.ActivityStackSupervisor.checkFinishBootingLocked(ActivityStackSupervisor.java:2608)
12-16 10:00:38.503 24654 25606 I ActivityManager: 	at com.android.server.am.ActivityStackSupervisor.activityIdleInternalLocked(ActivityStackSupervisor.java:2653)
12-16 10:00:38.503 24654 25606 I ActivityManager: 	at com.android.server.am.ActivityManagerService.activityIdle(ActivityManagerService.java:6387)
12-16 10:00:38.503 24654 25606 I ActivityManager: 	at android.app.ActivityManagerNative.onTransact(ActivityManagerNative.java:522)
12-16 10:00:38.503 24654 25606 I ActivityManager: 	at com.android.server.am.ActivityManagerService.onTransact(ActivityManagerService.java:2519)
12-16 10:00:38.503 24654 25606 I ActivityManager: 	at android.os.Binder.execTransact(Binder.java:453)



case 1:
1294是android.display线程

12-16 10:19:19.102  1275  1294 I ActivityManager: 	at com.android.server.am.ActivityManagerService.finishBooting(ActivityManagerService.java:6524)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at com.android.server.am.ActivityManagerService.bootAnimationComplete(ActivityManagerService.java:6595)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at com.android.server.wm.WindowManagerService.performEnableScreen(WindowManagerService.java:5912)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at com.android.server.wm.WindowManagerService$H.handleMessage(WindowManagerService.java:8091)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at android.os.Handler.dispatchMessage(Handler.java:102)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at android.os.Looper.loop(Looper.java:148)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at android.os.HandlerThread.run(HandlerThread.java:61)
12-16 10:19:19.102  1275  1294 I ActivityManager: 	at com.android.server.ServiceThread.run(ServiceThread.java:46)
12-16 10:19:19.102  1275  1294 I SystemServiceManager: Starting phase 1000


case 2:
2652是"ActivityManager"线程
12-16 13:28:36.456  2621  2652 I ActivityManager: 	at com.android.server.am.ActivityManagerService.finishBooting(ActivityManagerService.java:6524)
12-16 13:28:36.456  2621  2652 I ActivityManager: 	at com.android.server.am.ActivityManagerService$MainHandler.handleMessage(ActivityManagerService.java:1934)
12-16 13:28:36.456  2621  2652 I ActivityManager: 	at android.os.Handler.dispatchMessage(Handler.java:102)
12-16 13:28:36.456  2621  2652 I ActivityManager: 	at android.os.Looper.loop(Looper.java:148)
12-16 13:28:36.456  2621  2652 I ActivityManager: 	at android.os.HandlerThread.run(HandlerThread.java:61)
12-16 13:28:36.456  2621  2652 I ActivityManager: 	at com.android.server.ServiceThread.run(ServiceThread.java:46)
12-16 13:28:36.456  2621  2652 I SystemServiceManager: Starting phase 1000
### 其他

lsof,这是一个重要的命令


kill -3, gc都是suspend进程

- logcat -b all
- dmesg 或者 cat /proc/kmsg
- 上一次: cat /proc/last_kmsg
- 上一次: logcat -L
- /d/binder/目录下记录的binder输出信息.