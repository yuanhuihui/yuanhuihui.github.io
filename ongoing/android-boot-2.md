开机过程的进程启动顺序



## 一. 进程启动

    final ProcessRecord startProcessLocked(String processName,...){
        if (!mProcessesReady
                && !isAllowedWhileBooting(info)
                && !allowWhileBooting) {
            if (!mProcessesOnHold.contains(app)) {
                mProcessesOnHold.add(app);
            }
            return app;
        }
    }

    final ProcessRecord newProcessRecordLocked(...){
        if (((!mBooted && !mBooting) ||ProcessPolicyManager.isDelayBootPersistentApp(r.processName))
                && userId == UserHandle.USER_OWNER
                && (info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
            r.persistent = true;
            r.maxAdj = ProcessList.PERSISTENT_PROC_ADJ;
        }
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

- addAppLocked()启动persistent进程; //此时已经mProcessesReady
- finishBooting()启动on-hold进程; //此时已经mProcessesReady
- cleanUpApplicationRecordLock() 启动需要restart进程; //前提是进程已创建
- attachApplicationLocked() //绑定Bind死亡通告失败,则启动进程;






### 进程相关

进程启动的场景hostingType取值：

    addAppLocked,  "added application"
    attachApplicationLocked,  "link fail"
    cleanUpApplicationRecordLocked, "restart"
    finishBooting,  "on-hold"
    startIsolatedProcess, ""

    ASS.startSpecificActivityLocked, "activity"
    AS.bringUpServiceLocked, "service"
    getContentProviderImpl "content provider"
    BQ.processNextBroadcast, "broadcast"
    appDiedLocked, "activity"
    bindBackupAgent, "backup"

hostingNameStr值一般地是组件名

#### 启进程

当执行完fork()则马上输出:

EventLog.writeEvent(EventLogTags.AM_PROC_START,
                    UserHandle.getUserId(uid), startResult.pid, uid,
                    app.processName, hostingType,
                    hostingNameStr != null ? hostingNameStr : "");


Slog.i(TAG,"Start proc " pid, processName, uid, hostingType,  hostingNameStr);

#### 杀进程

Slog.i(TAG, "Killing " + toShortString() + " (adj " + setAdj + "): " + reason);
EventLog.writeEvent(EventLogTags.AM_KILL, userId, pid, processName, setAdj, reason);


#### 其他

运行在binder线程

ActivityManager: 	at com.android.server.am.ActivityStackSupervisor.checkFinishBootingLocked(ActivityStackSupervisor.java:2608)
ActivityManager: 	at com.android.server.am.ActivityStackSupervisor.activityIdleInternalLocked(ActivityStackSupervisor.java:2653)
ActivityManager: 	at com.android.server.am.ActivityManagerService.activityIdle(ActivityManagerService.java:6387)
ActivityManager: 	at android.app.ActivityManagerNative.onTransact(ActivityManagerNative.java:522)
ActivityManager: 	at com.android.server.am.ActivityManagerService.onTransact(ActivityManagerService.java:2519)
ActivityManager: 	at android.os.Binder.execTransact(Binder.java:453)





case 1:
1294是"android.display"线程

ActivityManager: 	at com.android.server.am.ActivityManagerService.finishBooting(ActivityManagerService.java:6524)
ActivityManager: 	at com.android.server.am.ActivityManagerService.bootAnimationComplete(ActivityManagerService.java:6595)
ActivityManager: 	at com.android.server.wm.WindowManagerService.performEnableScreen(WindowManagerService.java:5912)
ActivityManager: 	at com.android.server.wm.WindowManagerService$H.handleMessage(WindowManagerService.java:8091)
ActivityManager: 	at android.os.Handler.dispatchMessage(Handler.java:102)
ActivityManager: 	at android.os.Looper.loop(Looper.java:148)
ActivityManager: 	at android.os.HandlerThread.run(HandlerThread.java:61)
ActivityManager: 	at com.android.server.ServiceThread.run(ServiceThread.java:46)
SystemServiceManager: Starting phase 1000


case 2:
2652是"ActivityManager"线程 （常规）

ActivityManager: 	at com.android.server.am.ActivityManagerService.finishBooting(ActivityManagerService.java:6524)
ActivityManager: 	at com.android.server.am.ActivityManagerService$MainHandler.handleMessage(ActivityManagerService.java:1934)
ActivityManager: 	at android.os.Handler.dispatchMessage(Handler.java:102)
ActivityManager: 	at android.os.Looper.loop(Looper.java:148)
ActivityManager: 	at android.os.HandlerThread.run(HandlerThread.java:61)
ActivityManager: 	at com.android.server.ServiceThread.run(ServiceThread.java:46)
SystemServiceManager: Starting phase 1000
