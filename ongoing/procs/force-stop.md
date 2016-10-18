---
layout: post
title:  "force-stop内部机理"
date:   2016-05-31 20:30:00
catalog:  true
tags:
    - android

---

## 一.概述

    am force-stop pkgName  杀掉各个用户空间的app进程
    am force-stop --user 999 pkgName 杀掉指定用户空间的app进程


## 二. force-stop原理

### 2.1 AMS.forceStopPackage
[-> ActivityManagerService.java]

    public void forceStopPackage(final String packageName, int userId) {
        if (checkCallingPermission(android.Manifest.permission.FORCE_STOP_PACKAGES)
                        != PackageManager.PERMISSION_GRANTED) {
            //需要权限permission.FORCE_STOP_PACKAGES
            throw new SecurityException();
        }
        final int callingPid = Binder.getCallingPid();
        userId = handleIncomingUser(callingPid, Binder.getCallingUid(),
                        userId, true, ALLOW_FULL_ONLY, "forceStopPackage", null);
        long callingId = Binder.clearCallingIdentity();
        try {
            IPackageManager pm = AppGlobals.getPackageManager();
            synchronized(this) {
                int[] users = userId == UserHandle.USER_ALL
                                ? getUsersLocked() : new int[] { userId };
                for (int user : users) {
                        int pkgUid = -1;
                        pkgUid = pm.getPackageUid(packageName, user);
                        //设置应用包的状态
                        pm.setPackageStoppedState(packageName, true, user);

                        if (isUserRunningLocked(user, false)) {
                                //【见流程2.2】
                                forceStopPackageLocked(packageName, pkgUid, "from pid " + callingPid);
                        }
                }
            }
        } finally {
                Binder.restoreCallingIdentity(callingId);
        }
    }

当使用force stop方式来结束进程时, reason一般都是"from pid " + callingPid. 当然也有另外,那就是AMS.clearApplicationUserData方法调用forceStopPackageLocked的reason为"clear data".

### 2.2 AMS.forceStopPackageLocked

    private void forceStopPackageLocked(final String packageName, int uid, String reason) {
        //[见流程2.3]
        forceStopPackageLocked(packageName, UserHandle.getAppId(uid), false,
                    false, true, false, false, UserHandle.getUserId(uid), reason);

        Intent intent = new Intent(Intent.ACTION_PACKAGE_RESTARTED,
                    Uri.fromParts("package", packageName, null));
        //系统启动完毕后,则mProcessesReady=true
        if (!mProcessesReady) {
                intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY
                            | Intent.FLAG_RECEIVER_FOREGROUND);
        }
        intent.putExtra(Intent.EXTRA_UID, uid);
        intent.putExtra(Intent.EXTRA_USER_HANDLE, UserHandle.getUserId(uid));
        //发送广播ACTION_PACKAGE_RESTARTED
        broadcastIntentLocked(null, null, intent,
                        null, null, 0, null, null, null, AppOpsManager.OP_NONE,
                        null, false, false, MY_PID, Process.SYSTEM_UID, UserHandle.getUserId(uid));
    }

### 2.3 AMS.forceStopPackageLocked

    private final boolean forceStopPackageLocked(String packageName, int appId,
             boolean callerWillRestart, boolean purgeCache, boolean doit,
             boolean evenPersistent, boolean uninstalling, int userId, String reason) {
         int i;

         if (appId < 0 && packageName != null) {
             // 重新获取正确的appId
             appId = UserHandle.getAppId(
                     AppGlobals.getPackageManager().getPackageUid(packageName, 0));
         }

         // doit =true能进入该分支
         if (doit) {
             final ArrayMap<String, SparseArray<Long>> pmap = mProcessCrashTimes.getMap();
             for (int ip = pmap.size() - 1; ip >= 0; ip--) {
                 SparseArray<Long> ba = pmap.valueAt(ip);
                 for (i = ba.size() - 1; i >= 0; i--) {
                     boolean remove = false;
                     final int entUid = ba.keyAt(i);
                     if (packageName != null) {
                         if (userId == UserHandle.USER_ALL) {
                             if (UserHandle.getAppId(entUid) == appId) {
                                 remove = true;
                             }
                         } else {
                             if (entUid == UserHandle.getUid(userId, appId)) {
                                 remove = true;
                             }
                         }
                     } else if (UserHandle.getUserId(entUid) == userId) {
                         remove = true;
                     }
                     if (remove) {
                         ba.removeAt(i);
                     }
                 }
                 if (ba.size() == 0) {
                     pmap.removeAt(ip);
                 }
             }
         }

         //清理Process [见流程3.1]
         boolean didSomething = killPackageProcessesLocked(packageName, appId, userId,
                 -100, callerWillRestart, true, doit, evenPersistent,
                 packageName == null ? ("stop user " + userId) : ("stop " + packageName));

         //清理Activity [见流程4.1]
         if (mStackSupervisor.finishDisabledPackageActivitiesLocked(
                 packageName, null, doit, evenPersistent, userId)) {
             ...
             didSomething = true;
         }

         // 结束该包中的Service [见流程5.1]
         if (mServices.bringDownDisabledPackageServicesLocked(
                 packageName, null, userId, evenPersistent, true, doit)) {
             ...
             didSomething = true;
         }

         if (packageName == null) {
             //当包名为空, 则移除当前用户的所有sticky broadcasts
             mStickyBroadcasts.remove(userId);
         }

         //收集providers [见流程6.1]
         ArrayList<ContentProviderRecord> providers = new ArrayList<>();
         if (mProviderMap.collectPackageProvidersLocked(packageName, null, doit, evenPersistent,
                 userId, providers)) {
              ...
             didSomething = true;
         }
         for (i = providers.size() - 1; i >= 0; i--) {
              //清理providers [见流程6.2]
             removeDyingProviderLocked(null, providers.get(i), true);
         }

         //移除已获取的跟该package/user相关的临时权限
         removeUriPermissionsForPackageLocked(packageName, userId, false);

         if (doit) {
             // 清理Broadcast [见流程7.1]
             for (i = mBroadcastQueues.length - 1; i >= 0; i--) {
                 didSomething |= mBroadcastQueues[i].cleanupDisabledPackageReceiversLocked(
                         packageName, null, userId, doit);
             }
         }

         if (packageName == null || uninstalling) {
             ... //包名为空的情况
         }

         if (doit) {
             if (purgeCache && packageName != null) {
                ... //不进入该分支
             }
             if (mBooted) {
                 //恢复栈顶的activity
                 mStackSupervisor.resumeTopActivitiesLocked();
                 mStackSupervisor.scheduleIdleLocked();
             }
         }

         return didSomething;
     }

对于`didSomething`只指当方法中所有行为,则返回true.比如killPackageProcessesLocked(),只要杀过一个进程则代表didSomething为true.

该方法的主要功能:

1. Process: 调用AMS.killPackageProcessesLocked()清理该package所涉及的进程;
2. Activity: 调用ASS.finishDisabledPackageActivitiesLocked()清理该package所涉及的Activity;
3. Service: 调用AS.bringDownDisabledPackageServicesLocked()清理该package所涉及的Service;
4. Provider: 调用AMS.removeDyingProviderLocked()清理该package所涉及的Provider;
5. BroadcastRecevier: 调用BQ.cleanupDisabledPackageReceiversLocked()清理该package所涉及的广播

接下来,从这5个角度来一一结束force-stop的执行过程.

## 三. Process

### 3.1 AMS.killPackageProcessesLocked

    private final boolean killPackageProcessesLocked(String packageName, int appId,
            int userId, int minOomAdj, boolean callerWillRestart, boolean allowRestart,
            boolean doit, boolean evenPersistent, String reason) {
        ArrayList<ProcessRecord> procs = new ArrayList<>();

        //遍历当前所有运行中的进程
        final int NP = mProcessNames.getMap().size();
        for (int ip=0; ip<NP; ip++) {
            SparseArray<ProcessRecord> apps = mProcessNames.getMap().valueAt(ip);
            final int NA = apps.size();
            for (int ia=0; ia<NA; ia++) {
                ProcessRecord app = apps.valueAt(ia);
                if (app.persistent && !evenPersistent) {
                    continue; //不杀persistent进程
                }
                if (app.removed) {
                    if (doit) {
                        procs.add(app);
                    }
                    continue; //不杀已标记的进程
                }

                if (app.setAdj < minOomAdj) {
                    continue; //不杀adj低于预期的进程
                }

                if (packageName == null) {
                    if (userId != UserHandle.USER_ALL && app.userId != userId) {
                        continue;
                    }
                    if (appId >= 0 && UserHandle.getAppId(app.uid) != appId) {
                        continue;
                    }
                //已指定包名的情况
                } else {
                    //pkgDeps: 该进程所依赖的包名;
                    final boolean isDep = app.pkgDeps != null
                            && app.pkgDeps.contains(packageName);
                    if (!isDep && UserHandle.getAppId(app.uid) != appId) {
                        continue;
                    }
                    if (userId != UserHandle.USER_ALL && app.userId != userId) {
                        continue;
                    }
                    //pkgList: 运行在该进程的所有包名;
                    if (!app.pkgList.containsKey(packageName) && !isDep) {
                        continue;
                    }
                }

                //通过前面所有条件,则意味着该进程需要被杀, 添加到procs队列
                app.removed = true;
                procs.add(app);
            }
        }

        int N = procs.size();
        for (int i=0; i<N; i++) {
            // [见流程3.2]
            removeProcessLocked(procs.get(i), callerWillRestart, allowRestart, reason);
        }
        updateOomAdjLocked();
        return N > 0;
    }

该方法会遍历当前所有运行中的进程`mProcessNames`, 这里只说说最常见的指定了packageName情况:

1. persistent进程
2. 进程setAdj < minOomAdj(默认为-100)
3. 进程没有依赖该packageName, 且进程的AppId不相等;
4. 非UserHandle.USER_ALL同时, 且进程的userId不相等;
5. 进程没有依赖该packageName, 且该packageName没有运行在该进程.

对于以上条件同时都不满足的进程会成为即将被杀的进程, 换个角度来说,也就是非persistent进程,且为同一个用户的情况下: 当packageName存在于进程的`pkgList`或`pkgDeps`的情况下都会被杀.


### 3.2 AMS.removeProcessLocked

    private final boolean removeProcessLocked(ProcessRecord app,
             boolean callerWillRestart, boolean allowRestart, String reason) {
         final String name = app.processName;
         final int uid = app.uid;
         //从mProcessNames移除该进程
         removeProcessNameLocked(name, uid);
         if (mHeavyWeightProcess == app) {
            ...
         }
         boolean needRestart = false;
         if (app.pid > 0 && app.pid != MY_PID) {
             int pid = app.pid;
             synchronized (mPidsSelfLocked) {
                 mPidsSelfLocked.remove(pid);
                 mHandler.removeMessages(PROC_START_TIMEOUT_MSG, app);
             }

             if (app.isolated) {
                 mBatteryStatsService.removeIsolatedUid(app.uid, app.info.uid);
             }
             boolean willRestart = false;
             if (app.persistent && !app.isolated) {
                 if (!callerWillRestart) {
                     willRestart = true;
                 } else {
                     needRestart = true;
                 }
             }
             //杀掉该进程
             app.kill(reason, true);
             //清理该进程相关的信息
             handleAppDiedLocked(app, willRestart, allowRestart);

             //对于persistent进程,则需要重新启动该进程
             if (willRestart) {
                 removeLruProcessLocked(app);
                 addAppLocked(app.info, false, null /* ABI override */);
             }
         } else {
             mRemovedProcesses.add(app);
         }

         return needRestart;
     }

该方法的主要功能:

- 从mProcessNames, mPidsSelfLocked队列移除该进程;
- 移除进程启动超时的消息PROC_START_TIMEOUT_MSG;
- 调用app.kill)来杀进程, 该过程详见[理解杀进程的实现原理](http://gityuan.com/2016/04/16/kill-signal/)
- 调用handleAppDiedLocked()来清理进程相关的信息, 该过程详见[binderDied()过程分析](http://gityuan.com/2016/10/02/binder-died/)

## 四. Activity

### 4.1 ASS.finishDisabledPackageActivitiesLocked
[-> ActivityStackSupervisor.java]

    boolean finishDisabledPackageActivitiesLocked(String packageName, Set<String> filterByClasses,
            boolean doit, boolean evenPersistent, int userId) {
        boolean didSomething = false;
        for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
            final ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
            final int numStacks = stacks.size();
            for (int stackNdx = 0; stackNdx < numStacks; ++stackNdx) {
                final ActivityStack stack = stacks.get(stackNdx);
                // [见流程4.2]
                if (stack.finishDisabledPackageActivitiesLocked(
                        packageName, filterByClasses, doit, evenPersistent, userId)) {
                    didSomething = true;
                }
            }
        }
        return didSomething;
    }

### 4.2 AS.finishDisabledPackageActivitiesLocked
[-> ActivityStack.java]

    // doit = true;
    boolean finishDisabledPackageActivitiesLocked(String packageName, Set<String> filterByClasses,
            boolean doit, boolean evenPersistent, int userId) {
        boolean didSomething = false;
        TaskRecord lastTask = null;
        ComponentName homeActivity = null;

        for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
            final ArrayList<ActivityRecord> activities = mTaskHistory.get(taskNdx).mActivities;
            int numActivities = activities.size();
            for (int activityNdx = 0; activityNdx < numActivities; ++activityNdx) {
                ActivityRecord r = activities.get(activityNdx);
                final boolean sameComponent =
                        (r.packageName.equals(packageName) && (filterByClasses == null
                                || filterByClasses.contains(r.realActivity.getClassName())))
                        || (packageName == null && r.userId == userId);
                if ((userId == UserHandle.USER_ALL || r.userId == userId)
                        && (sameComponent || r.task == lastTask)
                        && (r.app == null || evenPersistent || !r.app.persistent)) {
                    ...
                    if (r.isHomeActivity()) {
                        if (homeActivity != null && homeActivity.equals(r.realActivity)) {
                            continue; //不结束home activity
                        } else {
                            homeActivity = r.realActivity;
                        }
                    }
                    didSomething = true;

                    if (sameComponent) {
                        if (r.app != null) {
                            r.app.removed = true;
                        }
                        r.app = null;
                    }
                    lastTask = r.task;
                    //强制结束该Activity [见流程4.3]
                    if (finishActivityLocked(r, Activity.RESULT_CANCELED, null, "force-stop",
                            true)) {
                        // r已从mActivities中移除
                        --numActivities;
                        --activityNdx;
                    }
                }
            }
        }
        return didSomething;
    }

### 4.3 AS.finishActivityLocked
[-> ActivityStack.java]

    final boolean finishActivityLocked(ActivityRecord r, int resultCode, Intent resultData,
            String reason, boolean oomAdj) {
        if (r.finishing) {
            return false;
        }

        //[见流程4.3.1]
        r.makeFinishingLocked();
        final TaskRecord task = r.task;

        final ArrayList<ActivityRecord> activities = task.mActivities;
        final int index = activities.indexOf(r);
        if (index < (activities.size() - 1)) {
            //[见流程4.3.3]
            task.setFrontOfTask();
            if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_CLEAR_WHEN_TASK_RESET) != 0) {
                //当该activity会被移除,则将该activity信息传播给下一个activity
                ActivityRecord next = activities.get(index+1);
                next.intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_WHEN_TASK_RESET);
            }
        }

        //暂停按键事件的分发
        r.pauseKeyDispatchingLocked();

        //调整聚焦的activity [见流程4.3.4]
        adjustFocusedActivityLocked(r, "finishActivity");
        //重置activity的回调结果信息
        finishActivityResultsLocked(r, resultCode, resultData);

        //当r为前台可见的activity时
        if (mResumedActivity == r) {
            boolean endTask = index <= 0;
            //准备关闭该transition
            mWindowManager.prepareAppTransition(endTask
                    ? AppTransition.TRANSIT_TASK_CLOSE
                    : AppTransition.TRANSIT_ACTIVITY_CLOSE, false);

            //告知wms来准备从窗口移除该activity
            mWindowManager.setAppVisibility(r.appToken, false);

            if (mPausingActivity == null) {
                //暂停该activity
                startPausingLocked(false, false, false, false);
            }

            if (endTask) {
                mStackSupervisor.removeLockedTaskLocked(task);
            }
        } else if (r.state != ActivityState.PAUSING) {
            //当r不可见的情况 [见流程4.3.5]
            return finishCurrentActivityLocked(r, FINISH_AFTER_PAUSE, oomAdj) == null;
        }

        return false;
    }

#### 4.3.1 AR.makeFinishingLocked
[-> ActivityRecord.java]

    void makeFinishingLocked() {
        if (!finishing) {
            if (task != null && task.stack != null
                    && this == task.stack.getVisibleBehindActivity()) {
                //处于finishing的activity不应该在后台保留可见性 [见流程4.3.2]
                mStackSupervisor.requestVisibleBehindLocked(this, false);
            }
            finishing = true;
            if (stopped) {
                clearOptionsLocked();
            }
        }
    }

#### 4.3.2 ASS.requestVisibleBehindLocked

    boolean requestVisibleBehindLocked(ActivityRecord r, boolean visible) {
        final ActivityStack stack = r.task.stack;
        if (stack == null) {
            return false; //r所在栈为空,则直接返回
        }
        final boolean isVisible = stack.hasVisibleBehindActivity();

        final ActivityRecord top = topRunningActivityLocked();
        if (top == null || top == r || (visible == isVisible)) {
            stack.setVisibleBehindActivity(visible ? r : null);
            return true;
        }

        if (visible && top.fullscreen) {
            ...
        } else if (!visible && stack.getVisibleBehindActivity() != r) {
            //设置不可见,且当前top activity跟该activity相同时返回
            return false;
        }

        stack.setVisibleBehindActivity(visible ? r : null);
        if (!visible) {
            //将activity置于不透明的r之上
            final ActivityRecord next = stack.findNextTranslucentActivity(r);
            if (next != null) {
                mService.convertFromTranslucent(next.appToken);
            }
        }
        if (top.app != null && top.app.thread != null) {
            //将改变通知给top应用
            top.app.thread.scheduleBackgroundVisibleBehindChanged(top.appToken, visible);
        }
        return true;
    }

#### 4.3.3 TaskRecord.setFrontOfTask
[-> TaskRecord.java]

    final void setFrontOfTask() {
        boolean foundFront = false;
        final int numActivities = mActivities.size();
        for (int activityNdx = 0; activityNdx < numActivities; ++activityNdx) {
            final ActivityRecord r = mActivities.get(activityNdx);
            if (foundFront || r.finishing) {
                r.frontOfTask = false;
            } else {
                r.frontOfTask = true;
                foundFront = true;
            }
        }
        //所有activity都处于finishing状态.
        if (!foundFront && numActivities > 0) {
            mActivities.get(0).frontOfTask = true;
        }
    }

- 将该Task中从底部往上查询, 第一个处于非finishing状态的ActivityRecord,则设置为根Activity(即r.frontOfTask = true),其他都为false;
- 当所有的activity都处于finishing状态,则把最底部的activity设置成跟Activity.


#### 4.3.4 AS.adjustFocusedActivityLocked
[-> ActivityStack.java]

    private void adjustFocusedActivityLocked(ActivityRecord r, String reason) {
        if (mStackSupervisor.isFrontStack(this) && mService.mFocusedActivity == r) {
            ActivityRecord next = topRunningActivityLocked(null);
            final String myReason = reason + " adjustFocus";
            if (next != r) {
                final TaskRecord task = r.task;
                boolean adjust = false;
                //当下一个activity为空, 或者下一个与当前的task不同, 或者要结束的r为根activity.
                if ((next == null || next.task != task) && r.frontOfTask) {
                    if (task.isOverHomeStack() && task == topTask()) {
                        adjust = true;
                    } else {
                        for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
                            final TaskRecord tr = mTaskHistory.get(taskNdx);
                            if (tr.getTopActivity() != null) {
                                break;
                            } else if (tr.isOverHomeStack()) {
                                adjust = true;
                                break;
                            }
                        }
                    }
                }
                // 需要调整Activity的聚焦情况
                if (adjust) {
                    // 对于非全屏的stack, 则移动角度到下一个可见的栈,而不是直接移动到home栈而屏蔽其他可见的栈.
                    if (!mFullscreen
                            && adjustFocusToNextVisibleStackLocked(null, myReason)) {
                        return;
                    }
                    //当该栈为全屏,或者没有其他可见栈时, 则把home栈移至顶部
                    if (mStackSupervisor.moveHomeStackTaskToTop(
                            task.getTaskToReturnTo(), myReason)) {
                        //聚焦已调整完整,则直接返回
                        return;
                    }
                }
            }

            final ActivityRecord top = mStackSupervisor.topRunningActivityLocked();
            if (top != null) {
                mService.setFocusedActivityLocked(top, myReason);
            }
        }
    }

#### 4.3.5 AS.finishCurrentActivityLocked

    final ActivityRecord finishCurrentActivityLocked(ActivityRecord r, int mode, boolean oomAdj) {
        if (mode == FINISH_AFTER_VISIBLE && r.nowVisible) {
            if (!mStackSupervisor.mStoppingActivities.contains(r)) {
                mStackSupervisor.mStoppingActivities.add(r);
                if (mStackSupervisor.mStoppingActivities.size() > 3
                        || r.frontOfTask && mTaskHistory.size() <= 1) {
                    mStackSupervisor.scheduleIdleLocked();
                } else {
                    mStackSupervisor.checkReadyForSleepLocked();
                }
            }
            //设置状态为stopping
            r.state = ActivityState.STOPPING;
            if (oomAdj) {
                mService.updateOomAdjLocked();
            }
            return r;
        }

        //清除相关信息
        mStackSupervisor.mStoppingActivities.remove(r);
        mStackSupervisor.mGoingToSleepActivities.remove(r);
        mStackSupervisor.mWaitingVisibleActivities.remove(r);
        if (mResumedActivity == r) {
            mResumedActivity = null;
        }
        final ActivityState prevState = r.state;
        //设置状态为finishing
        r.state = ActivityState.FINISHING;

        if (mode == FINISH_IMMEDIATELY
                || (mode == FINISH_AFTER_PAUSE && prevState == ActivityState.PAUSED)
                || prevState == ActivityState.STOPPED
                || prevState == ActivityState.INITIALIZING) {
            r.makeFinishingLocked();
            boolean activityRemoved = destroyActivityLocked(r, true, "finish-imm");
            if (activityRemoved) {
                mStackSupervisor.resumeTopActivitiesLocked();
            }
            return activityRemoved ? null : r;
        }

        //需要等到activity执行完pause,进入stopped状态,才会finish
        mStackSupervisor.mFinishingActivities.add(r);
        r.resumeKeyDispatchingLocked();
        mStackSupervisor.getFocusedStack().resumeTopActivityLocked(null);
        return r;
    }

满足下面其中之一的条件,则会执行finish以及destroy Activity.

1. 模式为FINISH_IMMEDIATELY
2. 模式为FINISH_AFTER_PAUSE, 且Activity状态已处于PAUSED;
3. Activity的状态为STOPPED或INITIALIZING.

## 五. Service

### 5.1 bringDownDisabledPackageServicesLocked
[-> ActiveServices.java]

    //killProcess = true;  doit = true;
    boolean bringDownDisabledPackageServicesLocked(String packageName, Set<String> filterByClasses,
            int userId, boolean evenPersistent, boolean killProcess, boolean doit) {
        boolean didSomething = false;

        if (mTmpCollectionResults != null) {
            mTmpCollectionResults.clear();
        }

        if (userId == UserHandle.USER_ALL) {
            for (int i = mServiceMap.size() - 1; i >= 0; i--) {
                //从mServiceMap中查询到所有属于该包下的service [见流程5.2]
                didSomething |= collectPackageServicesLocked(packageName, filterByClasses,
                        evenPersistent, doit, killProcess, mServiceMap.valueAt(i).mServicesByName);
                if (!doit && didSomething) {
                    ...
                }
            }
        } else {
            ServiceMap smap = mServiceMap.get(userId);
            if (smap != null) {
                ArrayMap<ComponentName, ServiceRecord> items = smap.mServicesByName;
                //从mServiceMap中查询到所有属于该包下的service [见流程5.2]
                didSomething = collectPackageServicesLocked(packageName, filterByClasses,
                        evenPersistent, doit, killProcess, items);
            }
        }

        if (mTmpCollectionResults != null) {
            //结束掉所有收集到的Service [见流程5.3]
            for (int i = mTmpCollectionResults.size() - 1; i >= 0; i--) {
                bringDownServiceLocked(mTmpCollectionResults.get(i));
            }
            mTmpCollectionResults.clear();
        }
        return didSomething;
    }


### 5.2 collectPackageServicesLocked
[-> ActiveServices.java]

    //killProcess = true;  doit = true;
    private boolean collectPackageServicesLocked(String packageName, Set<String> filterByClasses,
            boolean evenPersistent, boolean doit, boolean killProcess,
            ArrayMap<ComponentName, ServiceRecord> services) {
        boolean didSomething = false;
        for (int i = services.size() - 1; i >= 0; i--) {
            ServiceRecord service = services.valueAt(i);
            final boolean sameComponent = packageName == null
                    || (service.packageName.equals(packageName)
                        && (filterByClasses == null
                            || filterByClasses.contains(service.name.getClassName())));
            if (sameComponent
                    && (service.app == null || evenPersistent || !service.app.persistent)) {
                if (!doit) {
                    ...
                }
                didSomething = true;

                if (service.app != null) {
                    service.app.removed = killProcess;
                    if (!service.app.persistent) {
                        service.app.services.remove(service);
                    }
                }
                service.app = null;
                service.isolatedProc = null;
                if (mTmpCollectionResults == null) {
                    mTmpCollectionResults = new ArrayList<>();
                }
                //将满足条件service放入mTmpCollectionResults
                mTmpCollectionResults.add(service);
            }
        }
        return didSomething;
    }

该方法的主要功能就是收集该满足条件service放入mTmpCollectionResults.

### 5.3  bringDownServiceLocked
[-> ActiveServices.java]

    private final void bringDownServiceLocked(ServiceRecord r) {
        for (int conni=r.connections.size()-1; conni>=0; conni--) {
            ArrayList<ConnectionRecord> c = r.connections.valueAt(conni);
            for (int i=0; i<c.size(); i++) {
                ConnectionRecord cr = c.get(i);
                cr.serviceDead = true;
                // 断开service的连接
                cr.conn.connected(r.name, null);
            }
        }

        if (r.app != null && r.app.thread != null) {
            for (int i=r.bindings.size()-1; i>=0; i--) {
                IntentBindRecord ibr = r.bindings.valueAt(i);

                if (ibr.hasBound) {
                    bumpServiceExecutingLocked(r, false, "bring down unbind");
                    mAm.updateOomAdjLocked(r.app);
                    ibr.hasBound = false;
                    //最终调用目标Service.onUnbind()方法
                    r.app.thread.scheduleUnbindService(r, ibr.intent.getIntent());
                }
            }
        }

        r.destroyTime = SystemClock.uptimeMillis();

        final ServiceMap smap = getServiceMap(r.userId);
        smap.mServicesByName.remove(r.name);
        smap.mServicesByIntent.remove(r.intent);
        r.totalRestartCount = 0;
        // [见流程5.4]
        unscheduleServiceRestartLocked(r, 0, true);

        //确保service不在pending队列
        for (int i=mPendingServices.size()-1; i>=0; i--) {
            if (mPendingServices.get(i) == r) {
                mPendingServices.remove(i);
            }
        }

        //取消service相关的通知
        r.cancelNotification();
        r.isForeground = false;
        r.foregroundId = 0;
        r.foregroundNoti = null;

        r.clearDeliveredStartsLocked();
        r.pendingStarts.clear();

        if (r.app != null) {
            synchronized (r.stats.getBatteryStats()) {
                r.stats.stopLaunchedLocked();
            }
            r.app.services.remove(r);
            if (r.app.thread != null) {
                updateServiceForegroundLocked(r.app, false);

                bumpServiceExecutingLocked(r, false, "destroy");
                mDestroyingServices.add(r);
                r.destroying = true;
                mAm.updateOomAdjLocked(r.app);
                // 最终调用目标service的onDestroy()
                r.app.thread.scheduleStopService(r);

            }
        }

        if (r.bindings.size() > 0) {
            r.bindings.clear();
        }

        if (r.restarter instanceof ServiceRestarter) {
           ((ServiceRestarter)r.restarter).setService(null);
        }

        int memFactor = mAm.mProcessStats.getMemFactorLocked();
        long now = SystemClock.uptimeMillis();
        if (r.tracker != null) {
            r.tracker.setStarted(false, memFactor, now);
            r.tracker.setBound(false, memFactor, now);
            if (r.executeNesting == 0) {
                r.tracker.clearCurrentOwner(r, false);
                r.tracker = null;
            }
        }

        smap.ensureNotStartingBackground(r);
    }

### 5.4 unscheduleServiceRestartLocked

    private final boolean unscheduleServiceRestartLocked(ServiceRecord r, int callingUid,
            boolean force) {
        if (!force && r.restartDelay == 0) {
            return false;
        }

        //将Services从重启列表移除,并重置重启计数器
        boolean removed = mRestartingServices.remove(r);
        if (removed || callingUid != r.appInfo.uid) {
            r.resetRestartCounter();
        }
        if (removed) {
            clearRestartingIfNeededLocked(r);
        }
        mAm.mHandler.removeCallbacks(r.restarter);
        return true;
    }

## 六. Provider

### 6.1  PM.collectPackageProvidersLocked
[-> ProviderMap.java]

    boolean collectPackageProvidersLocked(String packageName, Set<String> filterByClasses,
            boolean doit, boolean evenPersistent, int userId,
            ArrayList<ContentProviderRecord> result) {
        boolean didSomething = false;
        if (userId == UserHandle.USER_ALL || userId == UserHandle.USER_OWNER) {
            // [见流程6.2]
            didSomething = collectPackageProvidersLocked(packageName, filterByClasses,
                    doit, evenPersistent, mSingletonByClass, result);
        }
        if (!doit && didSomething) {
            ... //不进入该分支
        }

        if (userId == UserHandle.USER_ALL) {
            for (int i = 0; i < mProvidersByClassPerUser.size(); i++) {
                if (collectPackageProvidersLocked(packageName, filterByClasses,
                        doit, evenPersistent, mProvidersByClassPerUser.valueAt(i), result)) {
                    ...
                    didSomething = true;
                }
            }
        } else {
            //从mProvidersByClassPerUser查询
            HashMap<ComponentName, ContentProviderRecord> items
                    = getProvidersByClass(userId);
            if (items != null) {
                didSomething |= collectPackageProvidersLocked(packageName, filterByClasses,
                        doit, evenPersistent, items, result);
            }
        }
        return didSomething;
    }

- 当userId = UserHandle.USER_ALL时, 则会`mSingletonByClass`和`mProvidersByClassPerUser`结构中查询所有属于该package的providers.
- 当userId = UserHandle.USER_OWNER时,则会从`mSingletonByClass`和`mProvidersByClassPerUser`中userId相等的 数据结构中查询所有属于该package的providers.
- 当userId不属于上述两者之一时,则会从`mProvidersByClassPerUser`中userId相等的查询所有属于该package的providers.

### 6.2 PM.collectPackageProvidersLocked
[-> ProviderMap.java]

    private boolean collectPackageProvidersLocked(String packageName,
            Set<String> filterByClasses, boolean doit, boolean evenPersistent,
            HashMap<ComponentName, ContentProviderRecord> providers,
            ArrayList<ContentProviderRecord> result) {
        boolean didSomething = false;
        for (ContentProviderRecord provider : providers.values()) {
            final boolean sameComponent = packageName == null
                    || (provider.info.packageName.equals(packageName)
                        && (filterByClasses == null
                            || filterByClasses.contains(provider.name.getClassName())));
            if (sameComponent
                    && (provider.proc == null || evenPersistent || !provider.proc.persistent)) {
                if (!doit) {
                    ...
                }
                didSomething = true;
                result.add(provider);
            }
        }
        return didSomething;
    }


### 6.3 AMS.removeDyingProviderLocked

    private final boolean removeDyingProviderLocked(ProcessRecord proc,
             ContentProviderRecord cpr, boolean always) {
         final boolean inLaunching = mLaunchingProviders.contains(cpr);

         //唤醒cpr, 并从mProviderMap中移除provider相关信息
         if (!inLaunching || always) {
             synchronized (cpr) {
                 cpr.launchingApp = null;
                 cpr.notifyAll();
             }
             mProviderMap.removeProviderByClass(cpr.name, UserHandle.getUserId(cpr.uid));
             String names[] = cpr.info.authority.split(";");
             for (int j = 0; j < names.length; j++) {
                 mProviderMap.removeProviderByName(names[j], UserHandle.getUserId(cpr.uid));
             }
         }

         for (int i = cpr.connections.size() - 1; i >= 0; i--) {
             ContentProviderConnection conn = cpr.connections.get(i);
             if (conn.waiting) {
                 //always = true,不进入该分支
                 if (inLaunching && !always) {
                     continue;
                 }
             }
             ProcessRecord capp = conn.client;
             conn.dead = true;
             if (conn.stableCount > 0) {
                 if (!capp.persistent && capp.thread != null
                         && capp.pid != 0
                         && capp.pid != MY_PID) {
                     //杀掉依赖该provider的client进程
                     capp.kill("depends on provider "
                             + cpr.name.flattenToShortString()
                             + " in dying proc " + (proc != null ? proc.processName : "??"), true);
                 }
             } else if (capp.thread != null && conn.provider.provider != null) {
                 capp.thread.unstableProviderDied(conn.provider.provider.asBinder());
                 cpr.connections.remove(i);
                 if (conn.client.conProviders.remove(conn)) {
                     stopAssociationLocked(capp.uid, capp.processName, cpr.uid, cpr.name);
                 }
             }
         }

         if (inLaunching && always) {
             mLaunchingProviders.remove(cpr);
         }
         return inLaunching;
     }

当其他app使用该provider, 且建立stable的连接, 那么对于非persistent进程,则会由于依赖该provider的缘故而被杀.


## 七. Broadcast

### 7.1  BQ.cleanupDisabledPackageReceiversLocked
[-> BroadcastQueue.java]

    boolean cleanupDisabledPackageReceiversLocked(
            String packageName, Set<String> filterByClasses, int userId, boolean doit) {
        boolean didSomething = false;
        for (int i = mParallelBroadcasts.size() - 1; i >= 0; i--) {
            didSomething |= mParallelBroadcasts.get(i).cleanupDisabledPackageReceiversLocked(
                    packageName, filterByClasses, userId, doit);
            if (!doit && didSomething) {
                return true;
            }
        }

        for (int i = mOrderedBroadcasts.size() - 1; i >= 0; i--) {
            didSomething |= mOrderedBroadcasts.get(i).cleanupDisabledPackageReceiversLocked(
                    packageName, filterByClasses, userId, doit);
            if (!doit && didSomething) {
                return true;
            }
        }

        return didSomething;
    }
