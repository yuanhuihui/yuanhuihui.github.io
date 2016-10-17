---
layout: post
title:  "force-stop分析"
date:   2016-05-31 20:30:00
catalog:  true
tags:
    - android

---

## 一.概述

    am force-stop pkgName  杀掉各个用户空间的app进程
    am force-stop --user 999 pkgName 杀掉指定用户空间的app进程


## 二. 流程分析

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

         if (userId == UserHandle.USER_ALL && packageName == null) {
             Slog.w(TAG, "Can't force stop all processes of all users, that is insane!");
         }

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

         //当至少杀过一个进程,则返回true [见流程2.4]
         boolean didSomething = killPackageProcessesLocked(packageName, appId, userId,
                 -100, callerWillRestart, true, doit, evenPersistent,
                 packageName == null ? ("stop user " + userId) : ("stop " + packageName));

         // 结束该包中的Activity[见流程2.6]
         if (mStackSupervisor.finishDisabledPackageActivitiesLocked(
                 packageName, null, doit, evenPersistent, userId)) {
             ...
             didSomething = true;
         }

         // 结束该包中的Service [见流程2.8]
         if (mServices.bringDownDisabledPackageServicesLocked(
                 packageName, null, userId, evenPersistent, true, doit)) {
             ...
             didSomething = true;
         }

         //当包名为空, 则移除当前用户的所有sticky broadcasts
         if (packageName == null) {
             mStickyBroadcasts.remove(userId);
         }

         ArrayList<ContentProviderRecord> providers = new ArrayList<>();
         if (mProviderMap.collectPackageProvidersLocked(packageName, null, doit, evenPersistent,
                 userId, providers)) {
              ...
             didSomething = true;
         }
         for (i = providers.size() - 1; i >= 0; i--) {
             //移除该包中所有的providers信息[见流程2.9]
             removeDyingProviderLocked(null, providers.get(i), true);
         }

         //移除已获取的跟该package/user相关的临时权限
         removeUriPermissionsForPackageLocked(packageName, userId, false);

         if (doit) {
             // 结束该包中的Broadcast [见流程2.10]
             for (i = mBroadcastQueues.length - 1; i >= 0; i--) {
                 didSomething |= mBroadcastQueues[i].cleanupDisabledPackageReceiversLocked(
                         packageName, null, userId, doit);
             }
         }

         if (packageName == null || uninstalling) {
             if (mIntentSenderRecords.size() > 0) {
                 Iterator<WeakReference<PendingIntentRecord>> it
                         = mIntentSenderRecords.values().iterator();
                 while (it.hasNext()) {
                     WeakReference<PendingIntentRecord> wpir = it.next();
                     if (wpir == null) {
                         it.remove();
                         continue;
                     }
                     PendingIntentRecord pir = wpir.get();
                     if (pir == null) {
                         it.remove();
                         continue;
                     }
                     if (packageName == null) {
                         // Stopping user, remove all objects for the user.
                         if (pir.key.userId != userId) {
                             // Not the same user, skip it.
                             continue;
                         }
                     } else {
                         if (UserHandle.getAppId(pir.uid) != appId) {
                             // Different app id, skip it.
                             continue;
                         }
                         if (userId != UserHandle.USER_ALL && pir.key.userId != userId) {
                             // Different user, skip it.
                             continue;
                         }
                         if (!pir.key.packageName.equals(packageName)) {
                             // Different package, skip it.
                             continue;
                         }
                     }
                     if (!doit) {
                         return true;
                     }
                     didSomething = true;
                     it.remove();
                     pir.canceled = true;
                     if (pir.key.activity != null && pir.key.activity.pendingResults != null) {
                         pir.key.activity.pendingResults.remove(pir.ref);
                     }
                 }
             }
         }

         if (doit) {
             if (purgeCache && packageName != null) {
                 AttributeCache ac = AttributeCache.instance();
                 if (ac != null) {
                     ac.removePackage(packageName);
                 }
             }
             if (mBooted) {
                 mStackSupervisor.resumeTopActivitiesLocked();
                 mStackSupervisor.scheduleIdleLocked();
             }
         }

         return didSomething;
     }

### 2.4 AMS.killPackageProcessesLocked

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
            // [见流程2.5]
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

此处reason取值:

- 当包名为空,  则为"stop user " + userId;
- 当包名不为包, 则为"stop " + packageName;


### 2.5 AMS.removeProcessLocked

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

### 2.6 ASS.finishDisabledPackageActivitiesLocked

    boolean finishDisabledPackageActivitiesLocked(String packageName, Set<String> filterByClasses,
            boolean doit, boolean evenPersistent, int userId) {
        boolean didSomething = false;
        for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
            final ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
            final int numStacks = stacks.size();
            for (int stackNdx = 0; stackNdx < numStacks; ++stackNdx) {
                final ActivityStack stack = stacks.get(stackNdx);
                // [见流程2.7]
                if (stack.finishDisabledPackageActivitiesLocked(
                        packageName, filterByClasses, doit, evenPersistent, userId)) {
                    didSomething = true;
                }
            }
        }
        return didSomething;
    }

### 2.7 AS.finishDisabledPackageActivitiesLocked
[-> ActivityStack.java]

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
                    if (!doit) {
                        ... //doit = true不仅人该分支
                    }
                    if (r.isHomeActivity()) {
                        if (homeActivity != null && homeActivity.equals(r.realActivity)) {
                            continue; //跳过home
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
                    //强制结束该Activity
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

### 2.8 bringDownDisabledPackageServicesLocked
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
                didSomething |= collectPackageServicesLocked(packageName, filterByClasses,
                        evenPersistent, doit, killProcess, mServiceMap.valueAt(i).mServicesByName);
                if (!doit && didSomething) {
                    return true;
                }
            }
        } else {
            ServiceMap smap = mServiceMap.get(userId);
            if (smap != null) {
                ArrayMap<ComponentName, ServiceRecord> items = smap.mServicesByName;
                //收集该包中所有的Service
                didSomething = collectPackageServicesLocked(packageName, filterByClasses,
                        evenPersistent, doit, killProcess, items);
            }
        }

        if (mTmpCollectionResults != null) {
            //结束掉所有收集到的Service
            for (int i = mTmpCollectionResults.size() - 1; i >= 0; i--) {
                bringDownServiceLocked(mTmpCollectionResults.get(i));
            }
            mTmpCollectionResults.clear();
        }
        return didSomething;
    }

### 2.9 AMS.removeDyingProviderLocked

    private final boolean removeDyingProviderLocked(ProcessRecord proc,
             ContentProviderRecord cpr, boolean always) {
         final boolean inLaunching = mLaunchingProviders.contains(cpr);

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
                 // If this connection is waiting for the provider, then we don't
                 // need to mess with its process unless we are always removing
                 // or for some reason the provider is not currently launching.
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

### 2.10  BQ.cleanupDisabledPackageReceiversLocked
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
