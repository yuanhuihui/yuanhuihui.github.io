### adj

adj的3大护法

- updateOomAdjLocked：更新
- computeOomAdjLocked:计算
- applyOomAdjLocked：应用

核心方法

    private final int computeOomAdjLocked(ProcessRecord app, int cachedAdj, ProcessRecord TOP_APP,
            boolean doingAll, long now)
    private final boolean applyOomAdjLocked(ProcessRecord app, boolean doingAll, long now,
            long nowElapsed)

    private final boolean updateOomAdjLocked(ProcessRecord app, int cachedAdj,
        ProcessRecord TOP_APP, boolean doingAll, long now)

    final void updateOomAdjLocked()

    final boolean updateOomAdjLocked(ProcessRecord app)


调用链：

    updateOomAdjLocked(ProcessRecord app)

        updateOomAdjLocked(ProcessRecord app, int cachedAdj,
            ProcessRecord TOP_APP, boolean doingAll, long now)
            - computeOomAdjLocked
            - applyOomAdjLocked

        updateOomAdjLocked()
            - computeOomAdjLocked
            - applyOomAdjLocked

更新adj，外部则是通过调用：

    updateOomAdjLocked()
    updateOomAdjLocked(ProcessRecord app)

## ADJ算法分析

### 1. AMS.updateOomAdjLocked

    final boolean updateOomAdjLocked(ProcessRecord app) {
        //【见小节1.1】
        final ActivityRecord TOP_ACT = resumedAppLocked();
        final ProcessRecord TOP_APP = TOP_ACT != null ? TOP_ACT.app : null;
        final boolean wasCached = app.cached;

        mAdjSeq++;

        //确保cachedAdj>=9
        final int cachedAdj = app.curRawAdj >= ProcessList.CACHED_APP_MIN_ADJ
                ? app.curRawAdj : ProcessList.UNKNOWN_ADJ;
        //【见小节2】
        boolean success = updateOomAdjLocked(app, cachedAdj, TOP_APP, false,
                SystemClock.uptimeMillis());
        if (wasCached != app.cached || app.curRawAdj == ProcessList.UNKNOWN_ADJ) {
            //【见小节3】
            updateOomAdjLocked();
        }
        return success;
    }

#### 1.1 AMS.resumedAppLocked

    private final ActivityRecord resumedAppLocked() {
        //【见小节1.2】
        ActivityRecord act = mStackSupervisor.resumedAppLocked();
        ...
        return act;
    }

#### 1.2 ASS.resumedAppLocked

    ActivityRecord resumedAppLocked() {
        //获取当前正在接收input或者启动下一个activity的栈
        ActivityStack stack = mFocusedStack;
        if (stack == null) {
            return null;
        }
        ActivityRecord resumedActivity = stack.mResumedActivity;
        if (resumedActivity == null || resumedActivity.app == null) {
            resumedActivity = stack.mPausingActivity;
            if (resumedActivity == null || resumedActivity.app == null) {
                resumedActivity = stack.topRunningActivityLocked(null);
            }
        }
        return resumedActivity;
    }

mTaskHistory -> TaskRecord -> ActivityRecord

### 2.  AMS.updateOomAdjLocked

    private final boolean updateOomAdjLocked(ProcessRecord app, int cachedAdj,
            ProcessRecord TOP_APP, boolean doingAll, long now) {
        if (app.thread == null) {
            return false;
        }
        //【见小节2.1】
        computeOomAdjLocked(app, cachedAdj, TOP_APP, doingAll, now);

        //【见小节2.2】
        return applyOomAdjLocked(app, doingAll, now, SystemClock.elapsedRealtime());
    }

#### 2.1  AMS.computeOomAdjLocked

private final int computeOomAdjLocked(ProcessRecord app, int cachedAdj, ProcessRecord TOP_APP,
         boolean doingAll, long now) {
     if (mAdjSeq == app.adjSeq) {
          //已经调整完成
         return app.curRawAdj;
     }

     // 当进程对象为空时，则设置curProcState=16， curAdj=15 【这是一个可疑点】
     if (app.thread == null) {
         app.adjSeq = mAdjSeq;
         app.curSchedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
         app.curProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
         return (app.curAdj=app.curRawAdj=ProcessList.CACHED_APP_MAX_ADJ);
     }

     app.adjTypeCode = ActivityManager.RunningAppProcessInfo.REASON_UNKNOWN;
     app.adjSource = null;
     app.adjTarget = null;
     app.empty = false;
     app.cached = false;

     final int activitiesSize = app.activities.size();

     //当maxAdj <=0的情况
     if (app.maxAdj <= ProcessList.FOREGROUND_APP_ADJ) {
         app.adjType = "fixed";
         app.adjSeq = mAdjSeq;
         app.curRawAdj = app.maxAdj;
         app.foregroundActivities = false;
         app.curSchedGroup = Process.THREAD_GROUP_DEFAULT;
         app.curProcState = ActivityManager.PROCESS_STATE_PERSISTENT;

         app.systemNoUi = true;
         if (app == TOP_APP) {
             app.systemNoUi = false;
         } else if (activitiesSize > 0) {
             for (int j = 0; j < activitiesSize; j++) {
                 final ActivityRecord r = app.activities.get(j);
                 if (r.visible) {
                     app.systemNoUi = false;
                 }
             }
         }
         if (!app.systemNoUi) {
             app.curProcState = ActivityManager.PROCESS_STATE_PERSISTENT_UI;
         }
         return (app.curAdj=app.maxAdj);
     }

     app.systemNoUi = false;
     final int PROCESS_STATE_TOP = mTopProcessState;

     int adj;
     int schedGroup;
     int procState;
     boolean foregroundActivities = false;
     BroadcastQueue queue;
     if (app == TOP_APP) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = Process.THREAD_GROUP_DEFAULT;
         app.adjType = "top-activity";
         foregroundActivities = true;
         procState = PROCESS_STATE_TOP;
         if(app == mHomeProcess) {
             mHomeKilled = false;
             mHomeProcessName = mHomeProcess.processName;
         }
     } else if (app.instrumentationClass != null) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = Process.THREAD_GROUP_DEFAULT;
         app.adjType = "instrumentation";
         procState = ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE;
     } else if ((queue = isReceivingBroadcast(app)) != null) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = (queue == mFgBroadcastQueue)
                 ? Process.THREAD_GROUP_DEFAULT : Process.THREAD_GROUP_BG_NONINTERACTIVE;
         app.adjType = "broadcast";
         procState = ActivityManager.PROCESS_STATE_RECEIVER;
     } else if (app.executingServices.size() > 0) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = app.execServicesFg ?
                 Process.THREAD_GROUP_DEFAULT : Process.THREAD_GROUP_BG_NONINTERACTIVE;
         app.adjType = "exec-service";
         procState = ActivityManager.PROCESS_STATE_SERVICE;
     } else {
         //top app; isReceivingBroadcast；executingServices；除此之外则为PROCESS_STATE_CACHED_EMPTY【】
         schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
         adj = cachedAdj;
         procState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
         app.cached = true;
         app.empty = true;
         app.adjType = "cch-empty";

         if (mHomeKilled && app.processName.equals(mHomeProcessName)) {
             adj = ProcessList.PERSISTENT_PROC_ADJ;
             schedGroup = Process.THREAD_GROUP_DEFAULT;
             app.cached = false;
             app.empty = false;
             app.adjType = "top-activity";
         }
     }

     //针对所有activity都没有处于前台的情况
     if (!foregroundActivities && activitiesSize > 0) {
         for (int j = 0; j < activitiesSize; j++) {
             final ActivityRecord r = app.activities.get(j);
             if (r.app != app) {
                 continue;
             }
             if (r.visible) {
                 if (adj > ProcessList.VISIBLE_APP_ADJ) {
                     adj = ProcessList.VISIBLE_APP_ADJ;
                     app.adjType = "visible";
                 }
                 if (procState > PROCESS_STATE_TOP) {
                     procState = PROCESS_STATE_TOP;
                 }
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
                 app.cached = false;
                 app.empty = false;
                 foregroundActivities = true;
                 break;
             } else if (r.state == ActivityState.PAUSING || r.state == ActivityState.PAUSED) {
                 if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                     adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                     app.adjType = "pausing";
                 }
                 if (procState > PROCESS_STATE_TOP) {
                     procState = PROCESS_STATE_TOP;
                 }
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
                 app.cached = false;
                 app.empty = false;
                 foregroundActivities = true;
             } else if (r.state == ActivityState.STOPPING) {
                 if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                     adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                     app.adjType = "stopping";
                 }

                 if (!r.finishing) {
                     if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
                         procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
                     }
                 }
                 app.cached = false;
                 app.empty = false;
                 foregroundActivities = true;
             } else {
                 if (procState > ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                     procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY;
                     app.adjType = "cch-act";
                 }
             }
         }
     }

     当adj > 2的情况下
     if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
         if (app.foregroundServices) {
             adj = ProcessList.PERCEPTIBLE_APP_ADJ;
             procState = ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE;
             app.cached = false;
             app.adjType = "fg-service";
             schedGroup = Process.THREAD_GROUP_DEFAULT;
         } else if (app.forcingToForeground != null) {
             adj = ProcessList.PERCEPTIBLE_APP_ADJ;
             procState = ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
             app.cached = false;
             app.adjType = "force-fg";
             app.adjSource = app.forcingToForeground;
             schedGroup = Process.THREAD_GROUP_DEFAULT;
         }
     }

     if (app == mHeavyWeightProcess) {
         if (adj > ProcessList.HEAVY_WEIGHT_APP_ADJ) {
             adj = ProcessList.HEAVY_WEIGHT_APP_ADJ;
             schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
             app.cached = false;
             app.adjType = "heavy";
         }
         if (procState > ActivityManager.PROCESS_STATE_HEAVY_WEIGHT) {
             procState = ActivityManager.PROCESS_STATE_HEAVY_WEIGHT;
         }
     }

     if (app == mHomeProcess) {
         if (adj > ProcessList.HOME_APP_ADJ) {
             adj = ProcessList.HOME_APP_ADJ;
             schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
             app.cached = false;
             app.adjType = "home";
         }
         if (procState > ActivityManager.PROCESS_STATE_HOME) {
             procState = ActivityManager.PROCESS_STATE_HOME;
         }
     }

     if (app == mPreviousProcess && app.activities.size() > 0) {
         if (adj > ProcessList.PREVIOUS_APP_ADJ) {
             adj = ProcessList.PREVIOUS_APP_ADJ;
             schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
             app.cached = false;
             app.adjType = "previous";
         }
         if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
             procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
         }
     }

     app.adjSeq = mAdjSeq;
     app.curRawAdj = adj;
     app.hasStartedServices = false;

     if (mBackupTarget != null && app == mBackupTarget.app) {
         if (adj > ProcessList.BACKUP_APP_ADJ) {
             adj = ProcessList.BACKUP_APP_ADJ;
             if (procState > ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND) {
                 procState = ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND;
             }
             app.adjType = "backup";
             app.cached = false;
         }
         if (procState > ActivityManager.PROCESS_STATE_BACKUP) {
             procState = ActivityManager.PROCESS_STATE_BACKUP;
         }
     }

     boolean mayBeTop = false;

     for (int is = app.services.size()-1;
             is >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                     || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                     || procState > ActivityManager.PROCESS_STATE_TOP);
             is--) {
         ServiceRecord s = app.services.valueAt(is);
         if (s.startRequested) {
             app.hasStartedServices = true;
             if (procState > ActivityManager.PROCESS_STATE_SERVICE) {
                 procState = ActivityManager.PROCESS_STATE_SERVICE;
             }
             if (app.hasShownUi && app != mHomeProcess) {
                 if (adj > ProcessList.SERVICE_ADJ) {
                     app.adjType = "cch-started-ui-services";
                 }
             } else {
                 if (now < (s.lastActivity + ActiveServices.MAX_SERVICE_INACTIVITY)) {
                     if (adj > ProcessList.SERVICE_ADJ) {
                         adj = ProcessList.SERVICE_ADJ;
                         app.adjType = "started-services";
                         app.cached = false;
                     }
                 }
                 if (adj > ProcessList.SERVICE_ADJ) {
                     app.adjType = "cch-started-services";
                 }
             }
         }
         for (int conni = s.connections.size()-1;
                 conni >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                         || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                         || procState > ActivityManager.PROCESS_STATE_TOP);
                 conni--) {
             ArrayList<ConnectionRecord> clist = s.connections.valueAt(conni);
             for (int i = 0;
                     i < clist.size() && (adj > ProcessList.FOREGROUND_APP_ADJ
                             || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                             || procState > ActivityManager.PROCESS_STATE_TOP);
                     i++) {
                 ConnectionRecord cr = clist.get(i);
                 if (cr.binding.client == app) {
                     continue;
                 }
                 if ((cr.flags&Context.BIND_WAIVE_PRIORITY) == 0) {
                     ProcessRecord client = cr.binding.client;
                     int clientAdj = computeOomAdjLocked(client, cachedAdj,
                             TOP_APP, doingAll, now);
                     int clientProcState = client.curProcState;
                     if (clientProcState >= ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                         clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
                     }
                     String adjType = null;
                     if ((cr.flags&Context.BIND_ALLOW_OOM_MANAGEMENT) != 0) {
                         if (app.hasShownUi && app != mHomeProcess) {
                             if (adj > clientAdj) {
                                 adjType = "cch-bound-ui-services";
                             }
                             app.cached = false;
                             clientAdj = adj;
                             clientProcState = procState;
                         } else {
                             if (now >= (s.lastActivity
                                     + ActiveServices.MAX_SERVICE_INACTIVITY)) {
                                 if (adj > clientAdj) {
                                     adjType = "cch-bound-services";
                                 }
                                 clientAdj = adj;
                             }
                         }
                     }
                     if (adj > clientAdj) {
                         if (app.hasShownUi && app != mHomeProcess
                                 && clientAdj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                             adjType = "cch-bound-ui-services";
                         } else {
                             if ((cr.flags&(Context.BIND_ABOVE_CLIENT
                                     |Context.BIND_IMPORTANT)) != 0) {
                                 adj = clientAdj >= ProcessList.PERSISTENT_SERVICE_ADJ
                                         ? clientAdj : ProcessList.PERSISTENT_SERVICE_ADJ;
                             } else if ((cr.flags&Context.BIND_NOT_VISIBLE) != 0
                                     && clientAdj < ProcessList.PERCEPTIBLE_APP_ADJ
                                     && adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                                 adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                             } else if (clientAdj > ProcessList.VISIBLE_APP_ADJ) {
                                 adj = clientAdj;
                             } else {
                                 if (adj > ProcessList.VISIBLE_APP_ADJ) {
                                     adj = ProcessList.VISIBLE_APP_ADJ;
                                 }
                             }
                             if (!client.cached) {
                                 app.cached = false;
                             }
                             adjType = "service";
                         }
                     }
                     if ((cr.flags&Context.BIND_NOT_FOREGROUND) == 0) {
                         if (client.curSchedGroup == Process.THREAD_GROUP_DEFAULT) {
                             schedGroup = Process.THREAD_GROUP_DEFAULT;
                         }
                         if (clientProcState <= ActivityManager.PROCESS_STATE_TOP) {
                             if (clientProcState == ActivityManager.PROCESS_STATE_TOP) {
                                 mayBeTop = true;
                                 clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
                             } else {
                                 if ((cr.flags&Context.BIND_FOREGROUND_SERVICE) != 0) {
                                     clientProcState =
                                             ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                                 } else if (mWakefulness
                                                 == PowerManagerInternal.WAKEFULNESS_AWAKE &&
                                         (cr.flags&Context.BIND_FOREGROUND_SERVICE_WHILE_AWAKE)
                                                 != 0) {
                                     clientProcState =
                                             ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                                 } else {
                                     clientProcState =
                                             ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
                                 }
                             }
                         }
                     } else {
                         if (clientProcState <
                                 ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND) {
                             clientProcState =
                                     ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND;
                         }
                     }
                     if (procState > clientProcState) {
                         procState = clientProcState;
                     }
                     if (procState < ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND
                             && (cr.flags&Context.BIND_SHOWING_UI) != 0) {
                         app.pendingUiClean = true;
                     }
                     if (adjType != null) {
                         app.adjType = adjType;
                         app.adjTypeCode = ActivityManager.RunningAppProcessInfo
                                 .REASON_SERVICE_IN_USE;
                         app.adjSource = cr.binding.client;
                         app.adjSourceProcState = clientProcState;
                         app.adjTarget = s.name;
                     }
                 }
                 if ((cr.flags&Context.BIND_TREAT_LIKE_ACTIVITY) != 0) {
                     app.treatLikeActivity = true;
                 }
                 final ActivityRecord a = cr.activity;
                 if ((cr.flags&Context.BIND_ADJUST_WITH_ACTIVITY) != 0) {
                     if (a != null && adj > ProcessList.FOREGROUND_APP_ADJ &&
                             (a.visible || a.state == ActivityState.RESUMED
                              || a.state == ActivityState.PAUSING)) {
                         adj = ProcessList.FOREGROUND_APP_ADJ;
                         if ((cr.flags&Context.BIND_NOT_FOREGROUND) == 0) {
                             schedGroup = Process.THREAD_GROUP_DEFAULT;
                         }
                         app.cached = false;
                         app.adjType = "service";
                         app.adjTypeCode = ActivityManager.RunningAppProcessInfo
                                 .REASON_SERVICE_IN_USE;
                         app.adjSource = a;
                         app.adjSourceProcState = procState;
                         app.adjTarget = s.name;
                     }
                 }
             }
         }
     }

     //content provider情况
     for (int provi = app.pubProviders.size()-1;
             provi >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                     || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                     || procState > ActivityManager.PROCESS_STATE_TOP);
             provi--) {
         ContentProviderRecord cpr = app.pubProviders.valueAt(provi);
         for (int i = cpr.connections.size()-1;
                 i >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                         || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                         || procState > ActivityManager.PROCESS_STATE_TOP);
                 i--) {
             ContentProviderConnection conn = cpr.connections.get(i);
             ProcessRecord client = conn.client;
             if (client == app) {
                 continue;
             }
             int clientAdj = computeOomAdjLocked(client, cachedAdj, TOP_APP, doingAll, now);
             int clientProcState = client.curProcState;
             if (clientProcState >= ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                 clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY; 【】
             }
             if (adj > clientAdj) {
                 if (app.hasShownUi && app != mHomeProcess
                         && clientAdj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                     app.adjType = "cch-ui-provider";
                 } else {
                     adj = clientAdj > ProcessList.FOREGROUND_APP_ADJ
                             ? clientAdj : ProcessList.FOREGROUND_APP_ADJ;
                     app.adjType = "provider";
                 }
                 app.cached &= client.cached;
                 app.adjTypeCode = ActivityManager.RunningAppProcessInfo
                         .REASON_PROVIDER_IN_USE;
                 app.adjSource = client;
                 app.adjSourceProcState = clientProcState;
                 app.adjTarget = cpr.name;
             }
             if (clientProcState <= ActivityManager.PROCESS_STATE_TOP) {
                 if (clientProcState == ActivityManager.PROCESS_STATE_TOP) {
                     mayBeTop = true;
                     //设置为空进程【】
                     clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
                 } else {
                     clientProcState = ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                 }
             }
             //进程状态 比client端的状态值更大时，则取client端的状态值。
             if (procState > clientProcState) {
                 procState = clientProcState;
             }
             if (client.curSchedGroup == Process.THREAD_GROUP_DEFAULT) {
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
             }
         }

         if (cpr.hasExternalProcessHandles()) {
             if (adj > ProcessList.FOREGROUND_APP_ADJ) {
                 adj = ProcessList.FOREGROUND_APP_ADJ;
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
                 app.cached = false;
                 app.adjType = "provider";
                 app.adjTarget = cpr.name;
             }
             if (procState > ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND) {
                 procState = ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
             }
         }
     }

     // client进程处于top状态，则将当前进程状态也设置成PROCESS_STATE_TOP
     if (mayBeTop && procState > ActivityManager.PROCESS_STATE_TOP) {
         switch (procState) {
             case ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND:
             case ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND:
             case ActivityManager.PROCESS_STATE_SERVICE:
                 procState = ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                 break;
             default:
                 procState = ActivityManager.PROCESS_STATE_TOP;
                 break;
         }
     }

     if (procState >= ActivityManager.PROCESS_STATE_CACHED_EMPTY) {
         if (app.hasClientActivities) {
             procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT;
             app.adjType = "cch-client-act";
         } else if (app.treatLikeActivity) {
             procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY;
             app.adjType = "cch-as-act";
         }
     }

     if (adj == ProcessList.SERVICE_ADJ) {
         if (doingAll) {
             app.serviceb = mNewNumAServiceProcs > (mNumServiceProcs/3);
             mNewNumServiceProcs++;
             if (!app.serviceb) {
                 if (mLastMemoryLevel > ProcessStats.ADJ_MEM_FACTOR_NORMAL
                         && app.lastPss >= mProcessList.getCachedRestoreThresholdKb()) {
                     app.serviceHighRam = true;
                     app.serviceb = true;
                 } else {
                     mNewNumAServiceProcs++;
                 }
             } else {
                 app.serviceHighRam = false;
             }
         }
         if (app.serviceb) {
             adj = ProcessList.SERVICE_B_ADJ;
         }
     }

     app.curRawAdj = adj;

     if (adj > app.maxAdj) {
         adj = app.maxAdj;
         if (app.maxAdj <= ProcessList.PERCEPTIBLE_APP_ADJ) {
             schedGroup = Process.THREAD_GROUP_DEFAULT;
         }
     }

     app.curAdj = app.modifyRawOomAdj(adj);
     app.curSchedGroup = schedGroup;
     app.curProcState = procState;
     app.foregroundActivities = foregroundActivities;

     return app.curRawAdj;
 }

注意下面3种情况：

 // 当进程对象为空时，则设置curProcState=16， curAdj=15 【这是一个可疑点】
 //top app; isReceivingBroadcast；executingServices；除此之外则为PROCESS_STATE_CACHED_EMPTY【】
 //content provider情况 ，设置为空进程【】


#### 2.2  AMS.applyOomAdjLocked

    private final boolean applyOomAdjLocked(ProcessRecord app, boolean doingAll, long now,
            long nowElapsed) {
        boolean success = true;

        if (app.curRawAdj != app.setRawAdj) {
            app.setRawAdj = app.curRawAdj;
        }

        int changes = 0;

        if (app.curAdj != app.setAdj) {
            //将adj值 发送给lmkd守护进程
            ProcessList.setOomAdj(app.pid, app.info.uid, app.curAdj);
            app.setAdj = app.curAdj;
        }

        //情况为： waitingToKill
        if (app.setSchedGroup != app.curSchedGroup) {
            app.setSchedGroup = app.curSchedGroup;
            if (app.waitingToKill != null && app.curReceiver == null
                    && app.setSchedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE) {
                //杀进程
                app.kill(app.waitingToKill, true);
                success = false;
            } else {
                long oldId = Binder.clearCallingIdentity();
                try {
                    Process.setProcessGroup(app.pid, app.curSchedGroup);
                } catch (Exception e) {
                } finally {
                    Binder.restoreCallingIdentity(oldId);
                }
                Process.setSwappiness(app.pid,
                        app.curSchedGroup <= Process.THREAD_GROUP_BG_NONINTERACTIVE);
            }
        }
        if (app.repForegroundActivities != app.foregroundActivities) {
            app.repForegroundActivities = app.foregroundActivities;
            changes |= ProcessChangeItem.CHANGE_ACTIVITIES;
        }
        if (app.repProcState != app.curProcState) {
            app.repProcState = app.curProcState;
            changes |= ProcessChangeItem.CHANGE_PROCESS_STATE;
            if (app.thread != null) {
                app.thread.setProcessState(app.repProcState);
            }
        }

        if (app.setProcState == ActivityManager.PROCESS_STATE_NONEXISTENT
                || ProcessList.procStatesDifferForMem(app.curProcState, app.setProcState)) {
            app.lastStateTime = now;
            app.nextPssTime = ProcessList.computeNextPssTime(app.curProcState, true,
                    mTestPssMode, isSleeping(), now);
        } else {
            if (now > app.nextPssTime || (now > (app.lastPssTime+ProcessList.PSS_MAX_INTERVAL)
                    && now > (app.lastStateTime+ProcessList.minTimeFromStateChange(
                    mTestPssMode)))) {
                requestPssLocked(app, app.setProcState);
                app.nextPssTime = ProcessList.computeNextPssTime(app.curProcState, false,
                        mTestPssMode, isSleeping(), now);
            }
        }

        if (app.setProcState != app.curProcState) {
            boolean setImportant = app.setProcState < ActivityManager.PROCESS_STATE_SERVICE;
            boolean curImportant = app.curProcState < ActivityManager.PROCESS_STATE_SERVICE;
            if (setImportant && !curImportant) {
                BatteryStatsImpl stats = mBatteryStatsService.getActiveStatistics();
                synchronized (stats) {
                    app.lastWakeTime = stats.getProcessWakeTime(app.info.uid,
                            app.pid, nowElapsed);
                }
                app.lastCpuTime = app.curCpuTime;

            }
            maybeUpdateUsageStatsLocked(app, nowElapsed);

            app.setProcState = app.curProcState;
            if (app.setProcState >= ActivityManager.PROCESS_STATE_HOME) {
                app.notCachedSinceIdle = false;
            }
            if (!doingAll) {
                setProcessTrackerStateLocked(app, mProcessStats.getMemFactorLocked(), now);
            } else {
                app.procStateChanged = true;
            }
        } else if (app.reportedInteraction && (nowElapsed-app.interactionEventTime)
                > USAGE_STATS_INTERACTION_INTERVAL) {
            maybeUpdateUsageStatsLocked(app, nowElapsed);
        }

        if (changes != 0) {
            int i = mPendingProcessChanges.size()-1;
            ProcessChangeItem item = null;
            while (i >= 0) {
                item = mPendingProcessChanges.get(i);
                if (item.pid == app.pid) {
                    break;
                }
                i--;
            }
            if (i < 0) {
                final int NA = mAvailProcessChanges.size();
                if (NA > 0) {
                    item = mAvailProcessChanges.remove(NA-1);
                } else {
                    item = new ProcessChangeItem();
                }
                item.changes = 0;
                item.pid = app.pid;
                item.uid = app.info.uid;
                if (mPendingProcessChanges.size() == 0) {
                    mUiHandler.obtainMessage(DISPATCH_PROCESSES_CHANGED).sendToTarget();
                }
                mPendingProcessChanges.add(item);
            }
            item.changes |= changes;
            item.processState = app.repProcState;
            item.foregroundActivities = app.repForegroundActivities;
        }

        return success;
    }

### 3.  AMS.updateOomAdjLocked


    final void updateOomAdjLocked() {
        final ActivityRecord TOP_ACT = resumedAppLocked();
        final ProcessRecord TOP_APP = TOP_ACT != null ? TOP_ACT.app : null;
        final long now = SystemClock.uptimeMillis();
        final long nowElapsed = SystemClock.elapsedRealtime();
        final long oldTime = now - ProcessList.MAX_EMPTY_TIME;
        final int N = mLruProcesses.size();

        //重置所有uid记录，把curProcState设置成PROCESS_STATE_CACHED_EMPTY
        for (int i=mActiveUids.size()-1; i>=0; i--) {
            final UidRecord uidRec = mActiveUids.valueAt(i);
            uidRec.reset();
        }

        mAdjSeq++;
        mNewNumServiceProcs = 0;
        mNewNumAServiceProcs = 0;

        final int emptyProcessLimit;
        final int cachedProcessLimit;
        // mProcessLimit默认值等于32
        if (mProcessLimit <= 0) {
            emptyProcessLimit = cachedProcessLimit = 0;
        } else if (mProcessLimit == 1) {
            emptyProcessLimit = 1;
            cachedProcessLimit = 0;
        } else {
            //则emptyProcessLimit = 16， cachedProcessLimit = 16
            emptyProcessLimit = ProcessList.computeEmptyProcessLimit(mProcessLimit);
            cachedProcessLimit = mProcessLimit - emptyProcessLimit;
        }

        // numSlots =3
        int numSlots = (ProcessList.CACHED_APP_MAX_ADJ
                - ProcessList.CACHED_APP_MIN_ADJ + 1) / 2;
        int numEmptyProcs = N - mNumNonCachedProcs - mNumCachedHiddenProcs;
        if (numEmptyProcs > cachedProcessLimit) {
            numEmptyProcs = cachedProcessLimit;
        }
        int emptyFactor = numEmptyProcs/numSlots;
        if (emptyFactor < 1) emptyFactor = 1;
        int cachedFactor = (mNumCachedHiddenProcs > 0 ? mNumCachedHiddenProcs : 1)/numSlots;
        if (cachedFactor < 1) cachedFactor = 1;
        int stepCached = 0;
        int stepEmpty = 0;
        int numCached = 0;
        int numEmpty = 0;
        int numTrimming = 0;

        mNumNonCachedProcs = 0;
        mNumCachedHiddenProcs = 0;

        //更新所有进程状态(基于当前状态)
        int curCachedAdj = ProcessList.CACHED_APP_MIN_ADJ;
        int nextCachedAdj = curCachedAdj+1;
        int curEmptyAdj = ProcessList.CACHED_APP_MIN_ADJ;
        int nextEmptyAdj = curEmptyAdj+2;
        ProcessRecord selectedAppRecord = null;
        long serviceLastActivity = 0;
        int numBServices = 0;
        for (int i=N-1; i>=0; i--) {
            ProcessRecord app = mLruProcesses.get(i);
            if (mEnableBServicePropagation && app.serviceb
                    && (app.curAdj == ProcessList.SERVICE_B_ADJ)) {
                numBServices++;
                for (int s = app.services.size() - 1; s >= 0; s--) {
                    ServiceRecord sr = app.services.valueAt(s);
                    //上次活跃时间距离现在小于5s，则不会迁移到BService
                    if (SystemClock.uptimeMillis() - sr.lastActivity
                            < mMinBServiceAgingTime) {
                        continue;
                    }
                    if (serviceLastActivity == 0) {
                        serviceLastActivity = sr.lastActivity;
                        selectedAppRecord = app;
                    } else if (sr.lastActivity < serviceLastActivity) {
                        serviceLastActivity = sr.lastActivity;
                        selectedAppRecord = app;
                    }
                }
            }

            if (!app.killedByAm && app.thread != null) {
                app.procStateChanged = false;
                // 计算app的adj值【】
                computeOomAdjLocked(app, ProcessList.UNKNOWN_ADJ, TOP_APP, true, now);

                //当进程未分配adj，则进入该分支来更新curCachedAdj值
                if (app.curAdj >= ProcessList.UNKNOWN_ADJ) {
                    switch (app.curProcState) {
                        case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY:
                        case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT:
                            app.curRawAdj = curCachedAdj;
                            app.curAdj = app.modifyRawOomAdj(curCachedAdj);
                            //更新curCachedAdj值
                            if (curCachedAdj != nextCachedAdj) {
                                stepCached++;
                                if (stepCached >= cachedFactor) {
                                    stepCached = 0;
                                    curCachedAdj = nextCachedAdj;
                                    nextCachedAdj += 2;
                                    if (nextCachedAdj > ProcessList.CACHED_APP_MAX_ADJ) {
                                        nextCachedAdj = ProcessList.CACHED_APP_MAX_ADJ;
                                    }
                                }
                            }
                            break;
                        default:
                            app.curRawAdj = curEmptyAdj;
                            app.curAdj = app.modifyRawOomAdj(curEmptyAdj);
                            //更新curCachedAdj值
                            if (curEmptyAdj != nextEmptyAdj) {
                                stepEmpty++;
                                if (stepEmpty >= emptyFactor) {
                                    stepEmpty = 0;
                                    curEmptyAdj = nextEmptyAdj;
                                    nextEmptyAdj += 2;
                                    if (nextEmptyAdj > ProcessList.CACHED_APP_MAX_ADJ) {
                                        nextEmptyAdj = ProcessList.CACHED_APP_MAX_ADJ;
                                    }
                                }
                            }
                            break;
                    }
                }

                //应用adj【】
                applyOomAdjLocked(app, true, now, nowElapsed);

                switch (app.curProcState) {
                    case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY:
                    case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT:
                        mNumCachedHiddenProcs++;
                        numCached++;
                        // cached进程超过上限，则杀掉该进程
                        if (numCached > cachedProcessLimit) {
                            app.kill("cached #" + numCached, true);
                        }
                        break;
                    case ActivityManager.PROCESS_STATE_CACHED_EMPTY:
                        // 空进程超过8个，且空闲时间超过30分钟，则杀掉该进程
                        if (numEmpty > ProcessList.TRIM_EMPTY_APPS
                                && app.lastActivityTime < oldTime) {
                            app.kill("empty for "
                                    + ((oldTime + ProcessList.MAX_EMPTY_TIME - app.lastActivityTime)
                                    / 1000) + "s", true);
                        } else {
                            // 空进程超过16个，则杀掉该进程
                            numEmpty++;
                            if (numEmpty > emptyProcessLimit) {
                                if (!CT_PROTECTED_PROCESS.equals(app.processName))
                                    app.kill("empty #" + numEmpty, true);
                            }
                        }
                        break;
                    default:
                        mNumNonCachedProcs++;
                        break;
                }

                if (app.isolated && app.services.size() <= 0) {
                    //没有services运行的孤立进程，则直接杀掉
                    app.kill("isolated not needed", true);
                } else {
                    final UidRecord uidRec = app.uidRecord;
                    if (uidRec != null && uidRec.curProcState > app.curProcState) {
                        uidRec.curProcState = app.curProcState;
                    }
                }

                if (app.curProcState >= ActivityManager.PROCESS_STATE_HOME
                        && !app.killedByAm) {
                    numTrimming++;
                }
            }
        }

        //当BServices个数超过5个
        if ((numBServices > mBServiceAppThreshold) && (true == mAllowLowerMemLevel)
                && (selectedAppRecord != null)) {
            ProcessList.setOomAdj(selectedAppRecord.pid, selectedAppRecord.info.uid,
                    ProcessList.CACHED_APP_MAX_ADJ);
            selectedAppRecord.setAdj = selectedAppRecord.curAdj;
        }
        mNumServiceProcs = mNewNumServiceProcs;

        //调整内存因子memFactor
        final int numCachedAndEmpty = numCached + numEmpty;
        int memFactor;
        if (numCached <= ProcessList.TRIM_CACHED_APPS
                && numEmpty <= ProcessList.TRIM_EMPTY_APPS) {
            if (numCachedAndEmpty <= ProcessList.TRIM_CRITICAL_THRESHOLD) {
                memFactor = ProcessStats.ADJ_MEM_FACTOR_CRITICAL;
            } else if (numCachedAndEmpty <= ProcessList.TRIM_LOW_THRESHOLD) {
                memFactor = ProcessStats.ADJ_MEM_FACTOR_LOW;
            } else {
                memFactor = ProcessStats.ADJ_MEM_FACTOR_MODERATE;
            }
        } else {
            memFactor = ProcessStats.ADJ_MEM_FACTOR_NORMAL;
        }

        if (memFactor > mLastMemoryLevel) {
            if (!mAllowLowerMemLevel || mLruProcesses.size() >= mLastNumProcesses) {
                memFactor = mLastMemoryLevel;
            }
        }
        mLastMemoryLevel = memFactor;
        mLastNumProcesses = mLruProcesses.size();
        boolean allChanged = mProcessStats.setMemFactorLocked(memFactor, !isSleeping(), now);
        final int trackerMemFactor = mProcessStats.getMemFactorLocked();
        if (memFactor != ProcessStats.ADJ_MEM_FACTOR_NORMAL) {
            if (mLowRamStartTime == 0) {
                mLowRamStartTime = now;
            }
            int step = 0;
            int fgTrimLevel;
            switch (memFactor) {
                case ProcessStats.ADJ_MEM_FACTOR_CRITICAL:
                    fgTrimLevel = ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL;
                    break;
                case ProcessStats.ADJ_MEM_FACTOR_LOW:
                    fgTrimLevel = ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW;
                    break;
                default:
                    fgTrimLevel = ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE;
                    break;
            }
            int factor = numTrimming/3;
            int minFactor = 2;
            if (mHomeProcess != null) minFactor++;
            if (mPreviousProcess != null) minFactor++;
            if (factor < minFactor) factor = minFactor;
            int curLevel = ComponentCallbacks2.TRIM_MEMORY_COMPLETE;
            for (int i=N-1; i>=0; i--) {
                ProcessRecord app = mLruProcesses.get(i);
                if (allChanged || app.procStateChanged) {
                    setProcessTrackerStateLocked(app, trackerMemFactor, now);
                    app.procStateChanged = false;
                }
                if (app.curProcState >= ActivityManager.PROCESS_STATE_HOME
                        && !app.killedByAm) {
                    if (app.trimMemoryLevel < curLevel && app.thread != null) {
                        app.thread.scheduleTrimMemory(curLevel);
                    }
                    app.trimMemoryLevel = curLevel;
                    step++;
                    if (step >= factor) {
                        step = 0;
                        switch (curLevel) {
                            case ComponentCallbacks2.TRIM_MEMORY_COMPLETE:
                                curLevel = ComponentCallbacks2.TRIM_MEMORY_MODERATE;
                                break;
                            case ComponentCallbacks2.TRIM_MEMORY_MODERATE:
                                curLevel = ComponentCallbacks2.TRIM_MEMORY_BACKGROUND;
                                break;
                        }
                    }
                } else if (app.curProcState == ActivityManager.PROCESS_STATE_HEAVY_WEIGHT) {
                    if (app.trimMemoryLevel < ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
                            && app.thread != null) {
                        app.thread.scheduleTrimMemory(
                                ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);
                    }
                    app.trimMemoryLevel = ComponentCallbacks2.TRIM_MEMORY_BACKGROUND;
                } else {
                    if ((app.curProcState >= ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND
                            || app.systemNoUi) && app.pendingUiClean) {
                        final int level = ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN;
                        if (app.trimMemoryLevel < level && app.thread != null) {
                            app.thread.scheduleTrimMemory(level);
                        }
                        app.pendingUiClean = false;
                    }
                    if (app.trimMemoryLevel < fgTrimLevel && app.thread != null) {
                        app.thread.scheduleTrimMemory(fgTrimLevel);
                    }
                    app.trimMemoryLevel = fgTrimLevel;
                }
            }
        } else {
            if (mLowRamStartTime != 0) {
                mLowRamTimeSinceLastIdle += now - mLowRamStartTime;
                mLowRamStartTime = 0;
            }
            for (int i=N-1; i>=0; i--) {
                ProcessRecord app = mLruProcesses.get(i);
                if (allChanged || app.procStateChanged) {
                    setProcessTrackerStateLocked(app, trackerMemFactor, now);
                    app.procStateChanged = false;
                }
                if ((app.curProcState >= ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND
                        || app.systemNoUi) && app.pendingUiClean) {
                    if (app.trimMemoryLevel < ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN
                            && app.thread != null) {
                        app.thread.scheduleTrimMemory(
                                ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);
                    }
                    app.pendingUiClean = false;
                }
                app.trimMemoryLevel = 0;
            }
        }

        if (mAlwaysFinishActivities) {
            mStackSupervisor.scheduleDestroyAllActivities(null, "always-finish");
        }

        if (allChanged) {
            requestPssAllProcsLocked(now, false, mProcessStats.isMemFactorLowered());
        }

        //更新uid状态的改变
        for (int i=mActiveUids.size()-1; i>=0; i--) {
            final UidRecord uidRec = mActiveUids.valueAt(i);
            if (uidRec.setProcState != uidRec.curProcState) {
                uidRec.setProcState = uidRec.curProcState;
                enqueueUidChangeLocked(uidRec, false);
            }
        }

        if (mProcessStats.shouldWriteNowLocked(now)) {
            mHandler.post(new Runnable() {
                public void run() {
                    synchronized (ActivityManagerService.this) {
                        mProcessStats.writeStateAsyncLocked();
                    }
                }
            });
        }
    }



### mLruProcesses

- updateLruProcessLocked
- updateLruProcessInternalLocked
- removeLruProcessLocked


### 调试神技

1. 开发者选项

后台进程限制

#### 其他

updateOomAdjLocked() 杀空进程

yellowpage 是如何成为ActivityManager.PROCESS_STATE_CACHED_EMPTY的？ 需要查找哪些地方能修改app.curProcState ？

答案是： computeOomAdjLocked()过程导致的修改。


NOT top/recevier/services  =>  2 变成 16

一旦client成为top => 16变成2
