---
layout: post
title:  "Android进程绝杀技--forceStop"
date:   2016-10-22 10:30:00
catalog:  true
tags:
    - android
    - 进程系列

---

> 基于Android 6.0源码剖析，force-stop的全过程

## 一.概述

### 1.1 引言
话说Android开源系统拥有着App不计其数，百家争鸣，都想在这“大争之世”寻得系统存活的一席之地。然则系统资源有限，如若都割据为王，再强劲的CPU也会忙不过来，再庞大的内存终会消耗殆尽，再大容量的电池续航终会昙花一现。

面对芸芸众生，无尽变数，系统以不变应万变，一招绝杀神技forceStop腾空出世，此处以adb指令的方式为例来说说其内部机理：

    am force-stop pkgName
    am force-stop --user 2 pkgName //只杀用户userId=2的相关信息

force-stop命令杀掉所有用户空间下的包名pkgName相关的信息，也可以通过`--user`来指定用户Id。 当执行上述am指令时，则会触发调用Am.java的main()方法，接下来从main方法开始说起。

### 1.2 Am.main
[-> Am.java]

    public static void main(String[] args) {
         (new Am()).run(args); //【见小节1.3】
    }

### 1.3 Am.run
[-> Am.java]

    public void run(String[] args) {
        ...
        mArgs = args;
        mNextArg = 0;
        mCurArgData = null;
        onRun(); //【见小节1.4】
        ...
    }

### 1.4 Am.onRun
[-> Am.java]

    public void onRun() throws Exception {
        //获取的是Binder proxy对象AMP
        mAm = ActivityManagerNative.getDefault();
        String op = nextArgRequired();

        if (op.equals("start")) {
            ...
        } else if (op.equals("force-stop")) {
            runForceStop(); //【见小节1.5】
        }
        ...
    }

### 1.5 Am.runForceStop
[-> Am.java]

    private void runForceStop() throws Exception {
        int userId = UserHandle.USER_ALL;

        String opt;
        // 当指定用户时，则解析相应userId
        while ((opt=nextOption()) != null) {
            if (opt.equals("--user")) {
                userId = parseUserArg(nextArgRequired());
            }
        }
        //【见小节1.6】
        mAm.forceStopPackage(nextArgRequired(), userId);
    }

当不指定userId时，则默认为UserHandle.USER_ALL。

### 1.6 AMP.forceStopPackage
[-> ActivityManagerNative.java ::AMP]

    public void forceStopPackage(String packageName, int userId) throws RemoteException {
         Parcel data = Parcel.obtain();
         Parcel reply = Parcel.obtain();
         data.writeInterfaceToken(IActivityManager.descriptor);
         data.writeString(packageName);
         data.writeInt(userId);
         //【见小节1.7】
         mRemote.transact(FORCE_STOP_PACKAGE_TRANSACTION, data, reply, 0);
         reply.readException();
         data.recycle();
         reply.recycle();
     }

### 1.7 AMN.onTransact
[-> ActivityManagerNative.java]

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
            throws RemoteException {
        switch (code) {
          case FORCE_STOP_PACKAGE_TRANSACTION: {
               data.enforceInterface(IActivityManager.descriptor);
               String packageName = data.readString();
               int userId = data.readInt();
               //【见小节2.1】
               forceStopPackage(packageName, userId);
               reply.writeNoException();
               return true;
          }
          ...
        }
    }

AMP.forceStopPackage来运行在执行adb时所创建的进程，经过Binder Driver后，进入system_server进程的一个binder线程来执行AMN.forceStopPackage，从这开始的操作(包括当前操作)便都运行在system_server系统进程。

### 1.8 小节

![am_force_stop](/images/process/am_force_stop.jpg)

进程绝杀技force-stop，并非任意app可直接调用, 否则App间可以相互停止对方，则岂非天下大乱。该方法的存在便是供系统差遣。一般地，点击home弹出的清理用户最近使用app采取的策略便是force-stop.

至于force-stop的触发方式，除了adb的方式，还可通过获取ActivityManager再调用其方法forceStopPackage()，不过这是@hide隐藏方法，同样是需要具有FORCE_STOP_PACKAGES权限。虽然第三方普通app不能直接调用，但对于深入理解Android，还是很有必要知道系统是如何彻底清理进程的过程。接下来，进入AMS来深入探查force-stop的内部机理。

## 二. force-stop内部机理

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
                        //根据包名和userId来查询相应的uid
                        pkgUid = pm.getPackageUid(packageName, user);
                        //设置包的状态为stopped
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

这里有一个过程非常重要，那就是setPackageStoppedState()将包的状态设置为stopped，那么所有广播都无法接收，除非带有标记`FLAG_INCLUDE_STOPPED_PACKAGES`的广播，系统默认的广播几乎都是不带有该标志，也就意味着被force-stop的应用是无法通过建立手机网络状态或者亮灭的广播来拉起进程。

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
        //发送广播用于停止alarm以及通知 【见小节8.1】
        broadcastIntentLocked(null, null, intent,
                        null, null, 0, null, null, null, AppOpsManager.OP_NONE,
                        null, false, false, MY_PID, Process.SYSTEM_UID, UserHandle.getUserId(uid));
    }

清理跟该包名相关的进程和四大组件之外，还会发送广播ACTION_PACKAGE_RESTARTED，用于清理已注册的alarm,notification信息。

### 2.3 AMS.forceStopPackageLocked

    //callerWillRestart = false, doit = true;
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
              //清理providers [见流程6.3]
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

接下来,从这5个角度来分别说说force-stop的执行过程.

## 三. Process

### 3.1 AMS.killPackageProcessesLocked

    //callerWillRestart = false, allowRestart = true, doit = true;
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
                    //已标记removed的进程，便是需要被杀的进程，加入procs队列
                    if (doit) {
                        procs.add(app);
                    }
                    continue;
                }

                if (app.setAdj < minOomAdj) {
                    continue; //不杀adj低于预期的进程
                }

                if (packageName == null) {
                    ...
                //已指定包名的情况
                } else {
                    //pkgDeps: 该进程所依赖的包名
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

一般地force-stop会指定包名，该方法会遍历当前所有运行中的进程`mProcessNames`，以下条件同时都不满足的进程，则会成为被杀的目标进程：(也就是说满足以下任一条件都可以免死)

1. persistent进程：
2. 进程setAdj < minOomAdj(默认为-100)：
3. 非UserHandle.USER_ALL同时, 且进程的userId不相等：多用户模型下，不同用户下不能相互杀；
4. 进程没有依赖该packageName, 且进程的AppId不相等;
5. 进程没有依赖该packageName, 且该packageName没有运行在该进程.

通俗地来说就是：

- forceStop不杀系统persistent进程；
- 当指定用户userId时，不杀其他用户空间的进程；

除此之外，以下情况则必然会成为被杀进程：

- 进程已标记`remove`=true的进程，则会被杀；
- 进程的`pkgDeps`中包含该`packageName`，则会被杀；
- 进程的`pkgList`中包含该`packageName`，且该进程与包名所指定的AppId相等则会被杀；

进程的`pkgList`是在启动组件或者创建进程的过程向该队列添加的，代表的是该应用下有组件运行在该进程。那么`pkgDeps`是指该进程所依赖的包名，调用ClassLoader的过程添加。


### 3.2 AMS.removeProcessLocked

    //callerWillRestart = false, allowRestart = true
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
                     willRestart = true; //用于标记persistent进程则需重启进程
                 } else {
                     needRestart = true; //用于返回值，作用不大
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
- 调用app.kill()来杀进程会同时调用Process.kill和Process.killProcessGroup, 该过程详见[理解杀进程的实现原理](http://gityuan.com/2016/04/16/kill-signal/)
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
            //[见流程4.3.6]
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

#### 4.3.6 AS.destroyActivityLocked

    final boolean destroyActivityLocked(ActivityRecord r, boolean removeFromApp, String reason) {

         boolean removedFromHistory = false;

         cleanUpActivityLocked(r, false, false);
         final boolean hadApp = r.app != null;

         if (hadApp) {
             if (removeFromApp) {
                 r.app.activities.remove(r);
                 if (mService.mHeavyWeightProcess == r.app && r.app.activities.size() <= 0) {
                     mService.mHeavyWeightProcess = null;
                     mService.mHandler.sendEmptyMessage(ActivityManagerService.CANCEL_HEAVY_NOTIFICATION_MSG);
                 }
                 if (r.app.activities.isEmpty()) {
                     mService.mServices.updateServiceConnectionActivitiesLocked(r.app);
                     mService.updateLruProcessLocked(r.app, false, null);
                     mService.updateOomAdjLocked();
                 }
             }

             boolean skipDestroy = false;

             try {
                 r.app.thread.scheduleDestroyActivity(r.appToken, r.finishing,
                         r.configChangeFlags);
             } catch (Exception e) {
                 if (r.finishing) {
                     //当发生crash,则将该activity从history移除
                     removeActivityFromHistoryLocked(r, reason + " exceptionInScheduleDestroy");
                     removedFromHistory = true;
                     skipDestroy = true;
                 }
             }

             r.nowVisible = false;

             if (r.finishing && !skipDestroy) {
                 r.state = ActivityState.DESTROYING;
                 Message msg = mHandler.obtainMessage(DESTROY_TIMEOUT_MSG, r);
                 mHandler.sendMessageDelayed(msg, DESTROY_TIMEOUT);
             } else {
                 r.state = ActivityState.DESTROYED;
                 r.app = null;
             }
         } else {
             if (r.finishing) {
                 removeActivityFromHistoryLocked(r, reason + " hadNoApp");
                 removedFromHistory = true;
             } else {
                 r.state = ActivityState.DESTROYED;
                 r.app = null;
             }
         }

         r.configChangeFlags = 0;
         return removedFromHistory;
     }



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
            // 【见流程7.2】
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

该方法主要功能：

- 清理并行广播队列mParallelBroadcasts；
- 清理有序广播队列mOrderedBroadcasts

### 7.2 BR.cleanupDisabledPackageReceiversLocked
[-> BroadcastRecord.java]

    boolean cleanupDisabledPackageReceiversLocked(
           String packageName, Set<String> filterByClasses, int userId, boolean doit) {
       if ((userId != UserHandle.USER_ALL && this.userId != userId) || receivers == null) {
           return false;
       }

       boolean didSomething = false;
       Object o;
       for (int i = receivers.size() - 1; i >= 0; i--) {
           o = receivers.get(i);
           if (!(o instanceof ResolveInfo)) {
               continue;
           }
           ActivityInfo info = ((ResolveInfo)o).activityInfo;

           final boolean sameComponent = packageName == null
                   || (info.applicationInfo.packageName.equals(packageName)
                   && (filterByClasses == null || filterByClasses.contains(info.name)));
           if (sameComponent) {
               ...
               didSomething = true;
               //移除该广播receiver
               receivers.remove(i);
               if (i < nextReceiver) {
                   nextReceiver--;
               }
           }
       }
       nextReceiver = Math.min(nextReceiver, receivers.size());
       return didSomething;
    }

## 八. Alarm和Notification

在前面[小节2.2]介绍到处理完forceStopPackageLocked()，紧接着便是发送广播`ACTION_PACKAGE_RESTARTED`，经过[Broadcast广播分发](http://gityuan.com/2016/06/04/broadcast-receiver/)，最终调用到注册过该广播的接收者。

### 8.1 Alarm清理
[-> AlarmManagerService.java]

    class UninstallReceiver extends BroadcastReceiver {
       public UninstallReceiver() {
           IntentFilter filter = new IntentFilter();
           filter.addAction(Intent.ACTION_PACKAGE_REMOVED);
           //监听ACTION_PACKAGE_RESTARTED
           filter.addAction(Intent.ACTION_PACKAGE_RESTARTED);
           filter.addAction(Intent.ACTION_QUERY_PACKAGE_RESTART);
           filter.addDataScheme("package");
           getContext().registerReceiver(this, filter);
           ...
       }

       @Override
       public void onReceive(Context context, Intent intent) {
           synchronized (mLock) {
               String action = intent.getAction();
               String pkgList[] = null;
               if (Intent.ACTION_QUERY_PACKAGE_RESTART.equals(action)) {
                   ...
               } else {
                   ...
                   Uri data = intent.getData();
                   if (data != null) {
                       String pkg = data.getSchemeSpecificPart();
                       if (pkg != null) {
                           pkgList = new String[]{pkg};
                       }
                   }
               }
               if (pkgList != null && (pkgList.length > 0)) {
                   for (String pkg : pkgList) {
                       //移除alarm
                       removeLocked(pkg);
                       mPriorities.remove(pkg);
                       for (int i=mBroadcastStats.size()-1; i>=0; i--) {
                           ArrayMap<String, BroadcastStats> uidStats = mBroadcastStats.valueAt(i);
                           if (uidStats.remove(pkg) != null) {
                               if (uidStats.size() <= 0) {
                                   mBroadcastStats.removeAt(i);
                               }
                           }
                       }
                   }
               }
           }
       }
   }

调用AlarmManagerService中的removeLocked()方法，从`mAlarmBatches`和`mPendingWhileIdleAlarms`队列中移除包所相关的alarm.

### 8.2 Notification清理
[-> NotificationManagerService.java]

    private final BroadcastReceiver mPackageIntentReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            String action = intent.getAction();
            ...

            if (action.equals(Intent.ACTION_PACKAGE_ADDED)
                    || (queryRemove=action.equals(Intent.ACTION_PACKAGE_REMOVED))
                    || action.equals(Intent.ACTION_PACKAGE_RESTARTED)
                    || (packageChanged=action.equals(Intent.ACTION_PACKAGE_CHANGED))
                    || (queryRestart=action.equals(Intent.ACTION_QUERY_PACKAGE_RESTART))
                    || action.equals(Intent.ACTION_EXTERNAL_APPLICATIONS_UNAVAILABLE)) {
                int changeUserId = intent.getIntExtra(Intent.EXTRA_USER_HANDLE,
                        UserHandle.USER_ALL);
                String pkgList[] = null;
                boolean queryReplace = queryRemove &&
                        intent.getBooleanExtra(Intent.EXTRA_REPLACING, false);
                if (action.equals(Intent.ACTION_EXTERNAL_APPLICATIONS_UNAVAILABLE)) {
                    ...
                } else {
                    Uri uri = intent.getData();
                    ...
                    String pkgName = uri.getSchemeSpecificPart();
                    if (packageChanged) {
                        ...
                    }
                    pkgList = new String[]{pkgName};
                }

                if (pkgList != null && (pkgList.length > 0)) {
                    for (String pkgName : pkgList) {
                        if (cancelNotifications) {
                            //移除Notification
                            cancelAllNotificationsInt(MY_UID, MY_PID, pkgName, 0, 0, !queryRestart,
                                    changeUserId, REASON_PACKAGE_CHANGED, null);
                        }
                    }
                }
                mListeners.onPackagesChanged(queryReplace, pkgList);
                mConditionProviders.onPackagesChanged(queryReplace, pkgList);
                mRankingHelper.onPackagesChanged(queryReplace, pkgList);
            }
        }
    };

调用NotificationManagerService.java
中的cancelAllNotificationsInt()方法，从`mNotificationList`队列中移除包所相关的Notification.

## 九. 级联诛杀

这里就跟大家分享一段经历吧，记得之前有BAT的某浏览器大厂(具体名称就匿了)，浏览器会因为另一个app被杀而导致自己无辜被牵连所杀，并怀疑是ROM定制化导致的bug，于是发邮件向我厂请教缘由。

遇到这个问题，首先将两个app安装到Google原生系统，结果是依然会被级联诛杀，很显然可以排除厂商ROM定制的缘故，按常理说bug应该可以让app自行解决。出于好奇，帮他们进一步调查了下这个问题，发现并非无辜被杀，而是force-stop的级联诛杀所导致的。

简单来说就是App1调用了getClassLoader()来加载App2，那么App1所运行的进程便会在其`pkgDeps`队列中增加App2的包名，在前面[小节3.2]已经提到`pkgDeps`，杀进程的过程中会遍历该队列，当App2被forceStop所杀时，便是级联诛杀App1。App1既然会调用App2的ClassLoader来加载其方法，那么就建立了一定的联系，这是Google有意赋予forceStop这个强力杀的功能。

这个故事是想告诉大家在插件化或者反射的过程中要注意这种情况，防止不必要的误伤。接下来具体说说这个过程是如何建立依赖的。

### 9.1 CI.getClassLoader
[-> ContextImpl.java]

    public ClassLoader getClassLoader() {
        //【见小节9.2】
       return mPackageInfo != null ?
                 mPackageInfo.getClassLoader() : ClassLoader.getSystemClassLoader();
     }

### 9.2 LA.getClassLoader
[-> LoadedApk.java]

    public ClassLoader getClassLoader() {
        synchronized (this) {
            if (mClassLoader != null) {
                return mClassLoader;
            }

            if (mPackageName.equals("android")) {
                if (mBaseClassLoader == null) {
                    mClassLoader = ClassLoader.getSystemClassLoader();
                } else {
                    mClassLoader = mBaseClassLoader;
                }
                return mClassLoader;
            }

            if (mRegisterPackage) {
                //经过Binder，最终调用到AMS.addPackageDependency 【见小节9.3】
                ActivityManagerNative.getDefault().addPackageDependency(mPackageName);
            }

            ...
            mClassLoader = ApplicationLoaders.getDefault().getClassLoader(zip,
                    mApplicationInfo.targetSdkVersion, isBundledApp, librarySearchPath,
                    libraryPermittedPath, mBaseClassLoader);

            return mClassLoader;
        }
    }

### 9.3 AMS.addPackageDependency

    public void addPackageDependency(String packageName) {
        synchronized (this) {
            int callingPid = Binder.getCallingPid();
            if (callingPid == Process.myPid()) {
                return;
            }
            ProcessRecord proc;
            synchronized (mPidsSelfLocked) {
                proc = mPidsSelfLocked.get(Binder.getCallingPid());
            }
            if (proc != null) {
                if (proc.pkgDeps == null) {
                    proc.pkgDeps = new ArraySet<String>(1);
                }
                //将该包名添加到pkgDeps
                proc.pkgDeps.add(packageName);
            }
        }
    }

调用ClassLoader来加载启动包名时，则会将该包名加入到进程的pkgDeps。

## 十. 总结

forceStop的功能如下：

![force_stop](/images/process/force_stop.jpg)

1. Process: 调用AMS.killPackageProcessesLocked()清理该package所涉及的进程;
2. Activity: 调用ASS.finishDisabledPackageActivitiesLocked()清理该package所涉及的Activity;
3. Service: 调用AS.bringDownDisabledPackageServicesLocked()清理该package所涉及的Service;
4. Provider: 调用AMS.removeDyingProviderLocked()清理该package所涉及的Provider;
5. BroadcastRecevier: 调用BQ.cleanupDisabledPackageReceiversLocked()清理该package所涉及的广播
6. 发送广播ACTION_PACKAGE_RESTARTED，用于停止已注册的alarm,notification.

persistent进程的特殊待遇:

- 进程: AMS.killPackageProcessesLocked()不杀进程
- Service: ActiveServices.collectPackageServicesLocked()不移除不清理service
- Provider: ProviderMap.collectPackageProvidersLocked()不收集不清理provider. 且不杀该provider所连接的client的persistent进程;
- 

**功能点归纳：**

1. force-stop并不会杀persistent进程；
2. 当app被force-stop后，无法接收到任何普通广播，那么也就常见的监听手机网络状态的变化或者屏幕亮灭的广播来拉起进程肯定是不可行；
3. 当app被force-stop后，那么alarm闹钟一并被清理，无法实现定时响起的功能；
4. app被force-stop后，四大组件以及相关进程都被一一剪除清理，即便多进程架构的app也无法拉起自己；
5. 级联诛杀：当app通过ClassLoader加载另一个app，则会在force-stop的过程中会被级联诛杀；
6. 生死与共：当app与另个app使用了share uid，则会在force-stop的过程，任意一方被杀则另一方也被杀，建立起生死与共的强关系。


既然force-stop多次提到杀进程，那最后简单说两句关于保活：**正确的保活姿态，应该是在用户需要时保证千万别被杀，用户不需要时别强保活，一切以用户为出发点。**

- 进程是否需要存活，系统上层有AMS来管理缓存进程和空进程，底层有LowMemoryKiller来根据系统可用内存的情况来管理进程是否存活，这样的策略是从系统整体性角度考虑，为了是给用户提供更好更流畅的用户体验。
- 用户需要的时候千万别被杀：谨慎使用插件化和共享uid，除非愿意接受级联诛杀和生死与共的场景；还有就是提高自身app的稳定性，减少crash和anr的发生频率，这才是正道。
- 用户不需要的时候别强保活：为了保活，多进程架构，利用各种小技巧来提升优先级等都是不可取的，一招force-stop足以干掉90%以上的保活策略，当然还有一些其他手段及漏洞来保活，系统层面往往还会采取一些特别的方法来禁止保活。博主曾经干过手机底层的性能与功耗优化工作，深知不少app的流氓行径，严重系统的流畅度与手机续航能力。

为了android有更好的用户体验，为了不影响手机系统性能，为了不降低手机续航能力，建议大家花更多时间精力在如何提高app的稳健性，如何优化app性能，共同打造Android的良好生态圈。
