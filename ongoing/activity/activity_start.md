---
layout: post
title:  "startActivity流程分析"
date:   2016-03-06 20:12:50
catalog:  true
tags:
    - android
    - 组件

---

> 基于Android 6.0的源码剖析， 分析android Activity启动流程中ActivityManagerService所扮演的角色

## 一. 概述

Context.startActivity
  ...
  AMS.startActivityAsUser
      ASS.startActivityMayWait  (使用ASS.mFocusedStack)
        ASS.startActivityUncheckedLocked
          AS.startActivityLocked
            ASS.resumeTopActivitiesLocked
              AS.resumeTopActivitiesLocked
                AS.resumeTopActivityInnerLocked （scheduleNewIntent, scheduleResumeActivity）
                    ASS.startSpecificActivityLocked

## 二. 启动流程

### 2.1 Activity.startActivity

[-> Activity.java]

    public void startActivity(Intent intent) {
        this.startActivity(intent, null);
    }

    public void startActivity(Intent intent, @Nullable Bundle options) {
        if (options != null) {
            startActivityForResult(intent, -1, options);
        } else {
            //[见小节2.2]
            startActivityForResult(intent, -1);
        }
    }

### 2.2  startActivityForResult
[-> Activity.java]

    public void startActivityForResult(Intent intent, int requestCode) {
        startActivityForResult(intent, requestCode, null);
    }

    public void startActivityForResult(Intent intent, int requestCode, @Nullable Bundle options) {
        if (mParent == null) {
            //[见小节2.3]
            Instrumentation.ActivityResult ar =
                mInstrumentation.execStartActivity(
                    this, mMainThread.getApplicationThread(), mToken, this,
                    intent, requestCode, options);
            if (ar != null) {
                mMainThread.sendActivityResult(
                    mToken, mEmbeddedID, requestCode, ar.getResultCode(),
                    ar.getResultData());
            }
            //此时requestCode =-1
            if (requestCode >= 0) {
                mStartedActivity = true;
            }
            cancelInputsAndStartExitTransition(options);
        } else {
            ...
        }
    }

execStartActivity()方法的参数:

- `mAppThread`: 数据类型为ApplicationThread，通过mMainThread.getApplicationThread()方法获取。
- `mToken`: 数据类型为IBinder.

### 2.3 execStartActivity
[-> Instrumentation.java]

    public ActivityResult execStartActivity(
            Context who, IBinder contextThread, IBinder token, Activity target,
            Intent intent, int requestCode, Bundle options) {

        IApplicationThread whoThread = (IApplicationThread) contextThread;
        ...

        if (mActivityMonitors != null) {
            synchronized (mSync) {
                final int N = mActivityMonitors.size();
                for (int i=0; i<N; i++) {
                    final ActivityMonitor am = mActivityMonitors.get(i);
                    if (am.match(who, null, intent)) {
                        am.mHits++;
                        //当该monitor阻塞activity启动,则直接返回
                        if (am.isBlocking()) {
                            return requestCode >= 0 ? am.getResult() : null;
                        }
                        break;
                    }
                }
            }
        }
        try {
            intent.migrateExtraStreamToClipData();
            intent.prepareToLeaveProcess();
            //[见小节2.4]
            int result = ActivityManagerNative.getDefault()
                .startActivity(whoThread, who.getBasePackageName(), intent,
                        intent.resolveTypeIfNeeded(who.getContentResolver()),
                        token, target != null ? target.mEmbeddedID : null,
                        requestCode, 0, null, options);
            //检查activity是否启动成功
            checkStartActivityResult(result, intent);
        } catch (RemoteException e) {
            throw new RuntimeException("Failure from system", e);
        }
        return null;
    }

关于 ActivityManagerNative.getDefault()返回的是ActivityManagerProxy对象. 此处startActivity()的共有10个参数, 下面说说每个参数传递AMP.startActivity()每一项的对应值:


- caller: 当前应用的ApplicationThread对象mAppThread;
- callingPackage: 调用当前ContextImpl.getBasePackageName(),获取当前Activity所在包名;
- intent: 这便是启动Activity时,传递过来的参数;
- resolvedType: 调用intent.resolveTypeIfNeeded而获取;
- resultTo: 来自于当前Activity.mToken
- resultWho: 来自于当前Activity.mEmbeddedID
- requestCode = -1;
- startFlags = 0;
- profilerInfo = null;
- options = null;

### 2.4 AMP.startActivity
[-> ActivityManagerNative.java :: ActivityManagerProxy]

    class ActivityManagerProxy implements IActivityManager
    {
        ...
        public int startActivity(IApplicationThread caller, String callingPackage, Intent intent,
                String resolvedType, IBinder resultTo, String resultWho, int requestCode,
                int startFlags, ProfilerInfo profilerInfo, Bundle options) throws RemoteException {
            Parcel data = Parcel.obtain();
            Parcel reply = Parcel.obtain();
            data.writeInterfaceToken(IActivityManager.descriptor);
            data.writeStrongBinder(caller != null ? caller.asBinder() : null);
            data.writeString(callingPackage);
            intent.writeToParcel(data, 0);
            data.writeString(resolvedType);
            data.writeStrongBinder(resultTo);
            data.writeString(resultWho);
            data.writeInt(requestCode);
            data.writeInt(startFlags);
            if (profilerInfo != null) {
                data.writeInt(1);
                profilerInfo.writeToParcel(data, Parcelable.PARCELABLE_WRITE_RETURN_VALUE);
            } else {
                data.writeInt(0);
            }
            if (options != null) {
                data.writeInt(1);
                options.writeToParcel(data, 0);
            } else {
                data.writeInt(0);
            }
            //[见流程2.5]
            mRemote.transact(START_ACTIVITY_TRANSACTION, data, reply, 0);
            reply.readException();
            int result = reply.readInt();
            reply.recycle();
            data.recycle();
            return result;
        }
        ...
    }

AMP经过binder IPC,进入ActivityManagerNative(简称AMN)。接下来程序进入了system_servr进程，开始继续执行。

### 2.5  AMN.onTransact
[-> ActivityManagerNative.java]

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
          throws RemoteException {
        switch (code) {
        case START_ACTIVITY_TRANSACTION:
        {
          data.enforceInterface(IActivityManager.descriptor);
          IBinder b = data.readStrongBinder();
          IApplicationThread app = ApplicationThreadNative.asInterface(b);
          String callingPackage = data.readString();
          Intent intent = Intent.CREATOR.createFromParcel(data);
          String resolvedType = data.readString();
          IBinder resultTo = data.readStrongBinder();
          String resultWho = data.readString();
          int requestCode = data.readInt();
          int startFlags = data.readInt();
          ProfilerInfo profilerInfo = data.readInt() != 0
                  ? ProfilerInfo.CREATOR.createFromParcel(data) : null;
          Bundle options = data.readInt() != 0
                  ? Bundle.CREATOR.createFromParcel(data) : null;
          //[见流程2.6]
          int result = startActivity(app, callingPackage, intent, resolvedType,
                  resultTo, resultWho, requestCode, startFlags, profilerInfo, options);
          reply.writeNoException();
          reply.writeInt(result);
          return true;
        }
        ...
        }
   }

### 2.6 AMS.startActivity
[-> ActivityManagerService.java]

    public final int startActivity(IApplicationThread caller, String callingPackage,
            Intent intent, String resolvedType, IBinder resultTo, String resultWho, int requestCode,
            int startFlags, ProfilerInfo profilerInfo, Bundle options) {
        return startActivityAsUser(caller, callingPackage, intent, resolvedType, resultTo,
            resultWho, requestCode, startFlags, profilerInfo, options,
            UserHandle.getCallingUserId());
    }

    public final int startActivityAsUser(IApplicationThread caller, String callingPackage,
        Intent intent, String resolvedType, IBinder resultTo, String resultWho, int requestCode,
        int startFlags, ProfilerInfo profilerInfo, Bundle options, int userId) {
        enforceNotIsolatedCaller("startActivity");
        userId = handleIncomingUser(Binder.getCallingPid(), Binder.getCallingUid(), userId,
                false, ALLOW_FULL_ONLY, "startActivity", null);
        //[见小节2.7]
        return mStackSupervisor.startActivityMayWait(caller, -1, callingPackage, intent,
                resolvedType, null, null, resultTo, resultWho, requestCode, startFlags,
                profilerInfo, null, null, options, false, userId, null, null);
    }

此处mStackSupervisor的数据类型为`ActivityStackSupervisor`

### 2.7 ASS.startActivityMayWait

当程序运行到这里时, ASS.startActivityMayWait的各个参数取值如下:

- caller = ApplicationThreadProxy, 用于跟调用者进程ApplicationThread进行通信的binder代理类.
- callingUid = -1;
- callingPackage = ContextImpl.getBasePackageName(),获取调用者Activity所在包名
- intent: 这是启动Activity时传递过来的参数;
- resolvedType = intent.resolveTypeIfNeeded
- voiceSession = null;
- voiceInteractor = null;
- resultTo = Activity.mToken, 其中Activity是指调用者所在Activity, mToken对象保存自己所处的ActivityRecord信息
- resultWho = Activity.mEmbeddedID, 其中Activity是指调用者所在Activity
- requestCode = -1;
- startFlags = 0;
- profilerInfo = null;
- outResult = null;
- config = null;
- options = null;
- ignoreTargetSecurity = false;
- userId = AMS.handleIncomingUser, 当调用者userId跟当前处于同一个userId,则直接返回该userId;当不相等时则根据调用者userId来决定是否需要将callingUserId转换为mCurrentUserId.
- iContainer = null;
- inTask = null;

再来看看这个方法的源码:

[-> ActivityStackSupervisor.java]

    final int startActivityMayWait(IApplicationThread caller, int callingUid,
            String callingPackage, Intent intent, String resolvedType,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
            IBinder resultTo, String resultWho, int requestCode, int startFlags,
            ProfilerInfo profilerInfo, WaitResult outResult, Configuration config,
            Bundle options, boolean ignoreTargetSecurity, int userId,
            IActivityContainer iContainer, TaskRecord inTask) {
        ...
        boolean componentSpecified = intent.getComponent() != null;
        intent = new Intent(intent);

        //收集Intent所指向的Activity信息, 当存在多个可供选择的Activity,则直接向用户弹出resolveActivity [见2.7.1]
        ActivityInfo aInfo = resolveActivity(intent, resolvedType, startFlags, profilerInfo, userId);

        ActivityContainer container = (ActivityContainer)iContainer;
        synchronized (mService) {
            if (container != null && container.mParentActivity != null &&
                    container.mParentActivity.state != RESUMED) {
                ... //不进入该分支, container == nul
            }

            final int realCallingPid = Binder.getCallingPid();
            final int realCallingUid = Binder.getCallingUid();
            int callingPid;
            if (callingUid >= 0) {
                callingPid = -1;
            } else if (caller == null) {
                callingPid = realCallingPid;
                callingUid = realCallingUid;
            } else {
                callingPid = callingUid = -1;
            }

            final ActivityStack stack;
            if (container == null || container.mStack.isOnHomeDisplay()) {
                stack = mFocusedStack; // 进入该分支
            } else {
                stack = container.mStack;
            }

            //此时mConfigWillChange = false
            stack.mConfigWillChange = config != null && mService.mConfiguration.diff(config) != 0;

            final long origId = Binder.clearCallingIdentity();

            if (aInfo != null &&
                    (aInfo.applicationInfo.privateFlags
                            &ApplicationInfo.PRIVATE_FLAG_CANT_SAVE_STATE) != 0) {
                // heavy-weight进程处理流程, 一般情况下不进入该分支
                if (aInfo.processName.equals(aInfo.applicationInfo.packageName)) {
                    ...
                }
            }

            //[见流程2.8]
            int res = startActivityLocked(caller, intent, resolvedType, aInfo,
                    voiceSession, voiceInteractor, resultTo, resultWho,
                    requestCode, callingPid, callingUid, callingPackage,
                    realCallingPid, realCallingUid, startFlags, options, ignoreTargetSecurity,
                    componentSpecified, null, container, inTask);

            Binder.restoreCallingIdentity(origId);

            if (stack.mConfigWillChange) {
                ... //不进入该分支
            }

            if (outResult != null) {
                ... //不进入该分支
            }

            return res;
        }
    }

该过程主要功能：通过resolveActivity来获取ActivityInfo信息, 然后再进入ASS.startActivityLocked().先来看看

#### 2.7.1 ASS.resolveActivity
    
    // startFlags = 0; profilerInfo = null; userId代表caller UserId
    ActivityInfo resolveActivity(Intent intent, String resolvedType, int startFlags,
            ProfilerInfo profilerInfo, int userId) {
        ActivityInfo aInfo;
        ResolveInfo rInfo =
            AppGlobals.getPackageManager().resolveIntent(
                    intent, resolvedType,
                    PackageManager.MATCH_DEFAULT_ONLY
                                | ActivityManagerService.STOCK_PM_FLAGS, userId);
        aInfo = rInfo != null ? rInfo.activityInfo : null;
        if (aInfo != null) {
            intent.setComponent(new ComponentName(
                    aInfo.applicationInfo.packageName, aInfo.name));

            if (!aInfo.processName.equals("system")) {
                ... //对于非system进程，根据flags来设置相应的debug信息
            }
        }
        return aInfo;
    }

ActivityManager类有如下4个flags用于调试：

- START_FLAG_DEBUG：用于调试debug app
- START_FLAG_OPENGL_TRACES：用于调试OpenGL tracing
- START_FLAG_NATIVE_DEBUGGING：用于调试native
- START_FLAG_TRACK_ALLOCATION: 用于调试allocation tracking


#### 2.7.2 PKMS.resolveIntent
AppGlobals.getPackageManager()经过函数层层调用，获取的是ApplicationPackageManager对象。经过binder IPC调用，最终会调用PackageManagerService对象。故此时调用方法为PMS.resolveIntent().

[-> PackageManagerService.java]

  public ResolveInfo resolveIntent(Intent intent, String resolvedType,
           int flags, int userId) {
       if (!sUserManager.exists(userId)) return null;
       enforceCrossUserPermission(Binder.getCallingUid(), userId, false, false, "resolve intent");
       //[见流程2.7.3]
       List<ResolveInfo> query = queryIntentActivities(intent, resolvedType, flags, userId);
       //根据priority，preferred选择最佳的Activity
       return chooseBestActivity(intent, resolvedType, flags, query, userId);
   }

#### 2.7.3 PMS.queryIntentActivities

    public List<ResolveInfo> queryIntentActivities(Intent intent,
            String resolvedType, int flags, int userId) {
        ...
        ComponentName comp = intent.getComponent();
        if (comp == null) {
            if (intent.getSelector() != null) {
                intent = intent.getSelector();
                comp = intent.getComponent();
            }
        }

        if (comp != null) {
            final List<ResolveInfo> list = new ArrayList<ResolveInfo>(1);
            //获取Activity信息
            final ActivityInfo ai = getActivityInfo(comp, flags, userId);
            if (ai != null) {
                final ResolveInfo ri = new ResolveInfo();
                ri.activityInfo = ai;
                list.add(ri);
            }
            return list;
        }
        ...
    }

ASS.resolveActivity()方法的核心功能是找到相应的Activity组件，并保存到intent对象。

### 2.8 ASS.startActivityLocked
[-> ActivityStackSupervisor.java]

    final int startActivityLocked(IApplicationThread caller,
            Intent intent, String resolvedType, ActivityInfo aInfo,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor,
            IBinder resultTo, String resultWho, int requestCode,
            int callingPid, int callingUid, String callingPackage,
            int realCallingPid, int realCallingUid, int startFlags, Bundle options,
            boolean ignoreTargetSecurity, boolean componentSpecified, ActivityRecord[] outActivity,
            ActivityContainer container, TaskRecord inTask) {
        int err = ActivityManager.START_SUCCESS;

        //获取调用者的进程记录对象
        ProcessRecord callerApp = null;
        if (caller != null) {
            callerApp = mService.getRecordForAppLocked(caller);
            if (callerApp != null) {
                callingPid = callerApp.pid;
                callingUid = callerApp.info.uid;
            } else {
                err = ActivityManager.START_PERMISSION_DENIED;
            }
        }

        final int userId = aInfo != null ?  UserHandle.getUserId(aInfo.applicationInfo.uid) : 0;

        ActivityRecord sourceRecord = null;
        ActivityRecord resultRecord = null;
        if (resultTo != null) {
            //获取调用者所在的Activity
            sourceRecord = isInAnyStackLocked(resultTo);
            if (sourceRecord != null) {
                if (requestCode >= 0 && !sourceRecord.finishing) {
                    ... //requestCode = -1 则不进入
                }
            }
        }

        final int launchFlags = intent.getFlags();

        if ((launchFlags & Intent.FLAG_ACTIVITY_FORWARD_RESULT) != 0 && sourceRecord != null) {
            ... // activity执行结果的返回由源Activity转换到新Activity, 不需要返回结果则不会进入该分支
        }

        if (err == ActivityManager.START_SUCCESS && intent.getComponent() == null) {
            //从Intent中无法找到相应的Component
            err = ActivityManager.START_INTENT_NOT_RESOLVED;
        }

        if (err == ActivityManager.START_SUCCESS && aInfo == null) {
            //从Intent中无法找到相应的ActivityInfo
            err = ActivityManager.START_INTENT_NOT_RESOLVED;
        }

        if (err == ActivityManager.START_SUCCESS
                && !isCurrentProfileLocked(userId)
                && (aInfo.flags & FLAG_SHOW_FOR_ALL_USERS) == 0) {
            //尝试启动一个后台Activity, 但该Activity对当前用户不可见
            err = ActivityManager.START_NOT_CURRENT_USER_ACTIVITY;
        }
        ...

        //执行后resultStack = null
        final ActivityStack resultStack = resultRecord == null ? null : resultRecord.task.stack;

        if (err != ActivityManager.START_SUCCESS) {
            ... //前面步骤存在err,执行到这里将会直接返回
            return err;
        }

        ... //权限检查

        // ActivityController不为空的情况
        if (mService.mController != null) {
            Intent watchIntent = intent.cloneFilter();
            abort |= !mService.mController.activityStarting(watchIntent,
                    aInfo.applicationInfo.packageName);
        }

        if (abort) {
            ... //权限检查不满足,才进入该分支则直接返回；
            return ActivityManager.START_SUCCESS;
        }

        // 创建Activity记录对象
        ActivityRecord r = new ActivityRecord(mService, callerApp, callingUid, callingPackage,
                intent, resolvedType, aInfo, mService.mConfiguration, resultRecord, resultWho,
                requestCode, componentSpecified, voiceSession != null, this, container, options);
        if (outActivity != null) {
            outActivity[0] = r;
        }

        if (r.appTimeTracker == null && sourceRecord != null) {
            r.appTimeTracker = sourceRecord.appTimeTracker;
        }
        // 将mFocusedStack赋予当前stack
        final ActivityStack stack = mFocusedStack;

        if (voiceSession == null && (stack.mResumedActivity == null
                || stack.mResumedActivity.info.applicationInfo.uid != callingUid)) {
            // 前台stack还没有resume状态的Activity时, 则检查app切换是否允许 [见流程2.8.1]
            if (!mService.checkAppSwitchAllowedLocked(callingPid, callingUid,
                    realCallingPid, realCallingUid, "Activity start")) {
                PendingActivityLaunch pal =
                        new PendingActivityLaunch(r, sourceRecord, startFlags, stack);
                // 当不允许切换,则把要启动的Activity添加到mPendingActivityLaunches对象, 并且直接返回.
                mPendingActivityLaunches.add(pal);
                ActivityOptions.abort(options);
                return ActivityManager.START_SWITCHES_CANCELED;
            }
        }

        if (mService.mDidAppSwitch) {
            //从上次禁止app切换以来,这是第二次允许app切换,因此将允许切换时间设置为0,则表示可以任意切换app
            mService.mAppSwitchesAllowedTime = 0;
        } else {
            mService.mDidAppSwitch = true;
        }

        //处理 pendind Activity的启动, 这些Activity是由于app switch禁用从而被hold的等待启动activity [见流程2.8.2]
        doPendingActivityLaunchesLocked(false);

        //[见流程2.9]
        err = startActivityUncheckedLocked(r, sourceRecord, voiceSession, voiceInteractor,
                startFlags, true, options, inTask);

        if (err < 0) {
            notifyActivityDrawnForKeyguard();
        }
        return err;
    }

其中有两个返回值代表启动Activity失败：

- START_INTENT_NOT_RESOLVED: 从Intent中无法找到相应的Component或者ActivityInfo
- START_NOT_CURRENT_USER_ACTIVITY：该Activity对当前用户不可见
    
#### 2.8.1 AMS.checkAppSwitchAllowedLocked

    boolean checkAppSwitchAllowedLocked(int sourcePid, int sourceUid,
            int callingPid, int callingUid, String name) {
        if (mAppSwitchesAllowedTime < SystemClock.uptimeMillis()) {
            return true;
        }

        int perm = checkComponentPermission(
                android.Manifest.permission.STOP_APP_SWITCHES, sourcePid,
                sourceUid, -1, true);
        if (perm == PackageManager.PERMISSION_GRANTED) {
            return true;
        }

        if (callingUid != -1 && callingUid != sourceUid) {
            perm = checkComponentPermission(
                    android.Manifest.permission.STOP_APP_SWITCHES, callingPid,
                    callingUid, -1, true);
            if (perm == PackageManager.PERMISSION_GRANTED) {
                return true;
            }
        }

        return false;
    }

当mAppSwitchesAllowedTime时间小于当前时长,或者具有STOP_APP_SWITCHES的权限,则允许app发生切换操作.

其中mAppSwitchesAllowedTime, 在`AMS.stopAppSwitches()`的过程中会设置为:`mAppSwitchesAllowedTime = SystemClock.uptimeMillis() + APP_SWITCH_DELAY_TIME`. 禁止app切换的timeout时长为5s(APP_SWITCH_DELAY_TIME = 5s).

当发送5秒超时或者执行`AMS.resumeAppSwitches()`过程会将mAppSwitchesAllowedTime设置0, 都会开启允许app执行切换的操作.

另外,禁止App切换的操作,对于同一个app是不受影响的,有兴趣可以进一步查看`checkComponentPermission`过程.

#### 2.8.2 ASS.doPendingActivityLaunchesLocked
[-> ActivityStackSupervisor.java]

    final void doPendingActivityLaunchesLocked(boolean doResume) {
        while (!mPendingActivityLaunches.isEmpty()) {
            PendingActivityLaunch pal = mPendingActivityLaunches.remove(0);

            try {
                //[见流程2.9]
                startActivityUncheckedLocked(pal.r, pal.sourceRecord, null, null, pal.startFlags,
                                             doResume && mPendingActivityLaunches.isEmpty(), null, null);
            } catch (Exception e) {
                Slog.w(TAG, "Exception during pending activity launch pal=" + pal, e);
            }
        }
    }

`mPendingActivityLaunches`记录着所有将要启动的Activity, 是由于在`startActivityLocked`的过程时App切换功能被禁止, 也就是不运行切换Activity, 那么此时便会把相应的Activity加入到`mPendingActivityLaunches`队列. 该队列的成员在执行完`doPendingActivityLaunchesLocked`便会清空.

启动mPendingActivityLaunches中所有的Activity, 由于doResume = false, 那么这些activtity并不会进入resume状态,而是设置delayedResume = true, 会延迟resume.

### 2.9 ASS.startActivityUncheckedLocked
[-> ActivityStackSupervisor.java]

    final int startActivityUncheckedLocked(final ActivityRecord r, ActivityRecord sourceRecord,
            IVoiceInteractionSession voiceSession, IVoiceInteractor voiceInteractor, int startFlags,
            boolean doResume, Bundle options, TaskRecord inTask) {
        final Intent intent = r.intent;
        final int callingUid = r.launchedFromUid;

        if (inTask != null && !inTask.inRecents) {
            inTask = null;
        }

        final boolean launchSingleTop = r.launchMode == ActivityInfo.LAUNCH_SINGLE_TOP;
        final boolean launchSingleInstance = r.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE;
        final boolean launchSingleTask = r.launchMode == ActivityInfo.LAUNCH_SINGLE_TASK;

        int launchFlags = intent.getFlags();
        // 当intent和activity manifest存在冲突，则manifest优先
        if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0 &&
                (launchSingleInstance || launchSingleTask)) {
            launchFlags &=
                    ~(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        } else {
            ...
        }

        final boolean launchTaskBehind = r.mLaunchTaskBehind
                && !launchSingleTask && !launchSingleInstance
                && (launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0;

        if (r.resultTo != null && (launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0
                && r.resultTo.task.stack != null) {
            r.resultTo.task.stack.sendActivityResultLocked(-1,
                    r.resultTo, r.resultWho, r.requestCode,
                    Activity.RESULT_CANCELED, null);
            r.resultTo = null;
        }

        if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0 && r.resultTo == null) {
            launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
        }

        // If we are actually going to launch in to a new task, there are some cases where
        // we further want to do multiple task.
        if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
            if (launchTaskBehind
                    || r.info.documentLaunchMode == ActivityInfo.DOCUMENT_LAUNCH_ALWAYS) {
                launchFlags |= Intent.FLAG_ACTIVITY_MULTIPLE_TASK;
            }
        }

        // We'll invoke onUserLeaving before onPause only if the launching
        // activity did not explicitly state that this is an automated launch.
        mUserLeaving = (launchFlags & Intent.FLAG_ACTIVITY_NO_USER_ACTION) == 0;
        if (DEBUG_USER_LEAVING) Slog.v(TAG_USER_LEAVING,
                "startActivity() => mUserLeaving=" + mUserLeaving);

        // If the caller has asked not to resume at this point, we make note
        // of this in the record so that we can skip it when trying to find
        // the top running activity.
        if (!doResume) {
            r.delayedResume = true;
        }

        ActivityRecord notTop =
                (launchFlags & Intent.FLAG_ACTIVITY_PREVIOUS_IS_TOP) != 0 ? r : null;

        // If the onlyIfNeeded flag is set, then we can do this if the activity
        // being launched is the same as the one making the call...  or, as
        // a special case, if we do not know the caller then we count the
        // current top activity as the caller.
        if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
            ActivityRecord checkedCaller = sourceRecord;
            if (checkedCaller == null) {
                checkedCaller = mFocusedStack.topRunningNonDelayedActivityLocked(notTop);
            }
            if (!checkedCaller.realActivity.equals(r.realActivity)) {
                // Caller is not the same as launcher, so always needed.
                startFlags &= ~ActivityManager.START_FLAG_ONLY_IF_NEEDED;
            }
        }

        boolean addingToTask = false;
        TaskRecord reuseTask = null;

        // If the caller is not coming from another activity, but has given us an
        // explicit task into which they would like us to launch the new activity,
        // then let's see about doing that.
        if (sourceRecord == null && inTask != null && inTask.stack != null) {
            final Intent baseIntent = inTask.getBaseIntent();
            final ActivityRecord root = inTask.getRootActivity();
            if (baseIntent == null) {
                ActivityOptions.abort(options);
                throw new IllegalArgumentException("Launching into task without base intent: "
                        + inTask);
            }

            // If this task is empty, then we are adding the first activity -- it
            // determines the root, and must be launching as a NEW_TASK.
            if (launchSingleInstance || launchSingleTask) {
                if (!baseIntent.getComponent().equals(r.intent.getComponent())) {
                    ActivityOptions.abort(options);
                    throw new IllegalArgumentException("Trying to launch singleInstance/Task "
                            + r + " into different task " + inTask);
                }
                if (root != null) {
                    ActivityOptions.abort(options);
                    throw new IllegalArgumentException("Caller with inTask " + inTask
                            + " has root " + root + " but target is singleInstance/Task");
                }
            }

            // If task is empty, then adopt the interesting intent launch flags in to the
            // activity being started.
            if (root == null) {
                final int flagsOfInterest = Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_MULTIPLE_TASK | Intent.FLAG_ACTIVITY_NEW_DOCUMENT
                        | Intent.FLAG_ACTIVITY_RETAIN_IN_RECENTS;
                launchFlags = (launchFlags&~flagsOfInterest)
                        | (baseIntent.getFlags()&flagsOfInterest);
                intent.setFlags(launchFlags);
                inTask.setIntent(r);
                addingToTask = true;

            // If the task is not empty and the caller is asking to start it as the root
            // of a new task, then we don't actually want to start this on the task.  We
            // will bring the task to the front, and possibly give it a new intent.
            } else if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
                addingToTask = false;

            } else {
                addingToTask = true;
            }

            reuseTask = inTask;
        } else {
            inTask = null;
        }

        if (inTask == null) {
            if (sourceRecord == null) {
                // This activity is not being started from another...  in this
                // case we -always- start a new task.
                if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0 && inTask == null) {
                    Slog.w(TAG, "startActivity called from non-Activity context; forcing " +
                            "Intent.FLAG_ACTIVITY_NEW_TASK for: " + intent);
                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
                }
            } else if (sourceRecord.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE) {
                // The original activity who is starting us is running as a single
                // instance...  this new activity it is starting must go on its
                // own task.
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            } else if (launchSingleInstance || launchSingleTask) {
                // The activity being started is a single instance...  it always
                // gets launched into its own task.
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            }
        }

        ActivityInfo newTaskInfo = null;
        Intent newTaskIntent = null;
        ActivityStack sourceStack;
        if (sourceRecord != null) {
            if (sourceRecord.finishing) {
                // If the source is finishing, we can't further count it as our source.  This
                // is because the task it is associated with may now be empty and on its way out,
                // so we don't want to blindly throw it in to that task.  Instead we will take
                // the NEW_TASK flow and try to find a task for it. But save the task information
                // so it can be used when creating the new task.
                if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0) {
                    Slog.w(TAG, "startActivity called from finishing " + sourceRecord
                            + "; forcing " + "Intent.FLAG_ACTIVITY_NEW_TASK for: " + intent);
                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
                    newTaskInfo = sourceRecord.info;
                    newTaskIntent = sourceRecord.task.intent;
                }
                sourceRecord = null;
                sourceStack = null;
            } else {
                sourceStack = sourceRecord.task.stack;
            }
        } else {
            sourceStack = null;
        }

        boolean movedHome = false;
        ActivityStack targetStack;

        intent.setFlags(launchFlags);
        final boolean noAnimation = (launchFlags & Intent.FLAG_ACTIVITY_NO_ANIMATION) != 0;

        // We may want to try to place the new activity in to an existing task.  We always
        // do this if the target activity is singleTask or singleInstance; we will also do
        // this if NEW_TASK has been requested, and there is not an additional qualifier telling
        // us to still place it in a new task: multi task, always doc mode, or being asked to
        // launch this as a new task behind the current one.
        if (((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0 &&
                (launchFlags & Intent.FLAG_ACTIVITY_MULTIPLE_TASK) == 0)
                || launchSingleInstance || launchSingleTask) {
            // If bring to front is requested, and no result is requested and we have not
            // been given an explicit task to launch in to, and
            // we can find a task that was started with this same
            // component, then instead of launching bring that one to the front.
            if (inTask == null && r.resultTo == null) {
                // See if there is a task to bring to the front.  If this is
                // a SINGLE_INSTANCE activity, there can be one and only one
                // instance of it in the history, and it is always in its own
                // unique task, so we do a special search.
                ActivityRecord intentActivity = !launchSingleInstance ?
                        findTaskLocked(r) : findActivityLocked(intent, r.info);
                if (intentActivity != null) {
                    // When the flags NEW_TASK and CLEAR_TASK are set, then the task gets reused
                    // but still needs to be a lock task mode violation since the task gets
                    // cleared out and the device would otherwise leave the locked task.
                    if (isLockTaskModeViolation(intentActivity.task,
                            (launchFlags & (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))
                            == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))) {
                        showLockTaskToast();
                        Slog.e(TAG, "startActivityUnchecked: Attempt to violate Lock Task Mode");
                        return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
                    }
                    if (r.task == null) {
                        r.task = intentActivity.task;
                    }
                    if (intentActivity.task.intent == null) {
                        // This task was started because of movement of
                        // the activity based on affinity...  now that we
                        // are actually launching it, we can assign the
                        // base intent.
                        intentActivity.task.setIntent(r);
                    }
                    targetStack = intentActivity.task.stack;
                    targetStack.mLastPausedActivity = null;
                    // If the target task is not in the front, then we need
                    // to bring it to the front...  except...  well, with
                    // SINGLE_TASK_LAUNCH it's not entirely clear.  We'd like
                    // to have the same behavior as if a new instance was
                    // being started, which means not bringing it to the front
                    // if the caller is not itself in the front.
                    final ActivityStack focusStack = getFocusedStack();
                    ActivityRecord curTop = (focusStack == null)
                            ? null : focusStack.topRunningNonDelayedActivityLocked(notTop);
                    boolean movedToFront = false;
                    if (curTop != null && (curTop.task != intentActivity.task ||
                            curTop.task != focusStack.topTask())) {
                        r.intent.addFlags(Intent.FLAG_ACTIVITY_BROUGHT_TO_FRONT);
                        if (sourceRecord == null || (sourceStack.topActivity() != null &&
                                sourceStack.topActivity().task == sourceRecord.task)) {
                            // We really do want to push this one into the user's face, right now.
                            if (launchTaskBehind && sourceRecord != null) {
                                intentActivity.setTaskToAffiliateWith(sourceRecord.task);
                            }
                            movedHome = true;
                            targetStack.moveTaskToFrontLocked(intentActivity.task, noAnimation,
                                    options, r.appTimeTracker, "bringingFoundTaskToFront");
                            movedToFront = true;
                            if ((launchFlags &
                                    (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME))
                                    == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME)) {
                                // Caller wants to appear on home activity.
                                intentActivity.task.setTaskToReturnTo(HOME_ACTIVITY_TYPE);
                            }
                            options = null;
                        }
                    }
                    if (!movedToFront) {
                        if (DEBUG_TASKS) Slog.d(TAG_TASKS, "Bring to front target: " + targetStack
                                + " from " + intentActivity);
                        targetStack.moveToFront("intentActivityFound");
                    }

                    // If the caller has requested that the target task be
                    // reset, then do so.
                    if ((launchFlags&Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                        intentActivity = targetStack.resetTaskIfNeededLocked(intentActivity, r);
                    }
                    if ((startFlags & ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
                        // We don't need to start a new activity, and
                        // the client said not to do anything if that
                        // is the case, so this is it!  And for paranoia, make
                        // sure we have correctly resumed the top activity.
                        if (doResume) {
                            resumeTopActivitiesLocked(targetStack, null, options);

                            // Make sure to notify Keyguard as well if we are not running an app
                            // transition later.
                            if (!movedToFront) {
                                notifyActivityDrawnForKeyguard();
                            }
                        } else {
                            ActivityOptions.abort(options);
                        }
                        return ActivityManager.START_RETURN_INTENT_TO_CALLER;
                    }
                    if ((launchFlags & (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))
                            == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK)) {
                        // The caller has requested to completely replace any
                        // existing task with its new activity.  Well that should
                        // not be too hard...
                        reuseTask = intentActivity.task;
                        reuseTask.performClearTaskLocked();
                        reuseTask.setIntent(r);
                    } else if ((launchFlags & FLAG_ACTIVITY_CLEAR_TOP) != 0
                            || launchSingleInstance || launchSingleTask) {
                        // In this situation we want to remove all activities
                        // from the task up to the one being started.  In most
                        // cases this means we are resetting the task to its
                        // initial state.
                        ActivityRecord top =
                                intentActivity.task.performClearTaskLocked(r, launchFlags);
                        if (top != null) {
                            if (top.frontOfTask) {
                                // Activity aliases may mean we use different
                                // intents for the top activity, so make sure
                                // the task now has the identity of the new
                                // intent.
                                top.task.setIntent(r);
                            }
                            ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT,
                                    r, top.task);
                            top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                        } else {
                            // A special case: we need to start the activity because it is not
                            // currently running, and the caller has asked to clear the current
                            // task to have this activity at the top.
                            addingToTask = true;
                            // Now pretend like this activity is being started by the top of its
                            // task, so it is put in the right place.
                            sourceRecord = intentActivity;
                            TaskRecord task = sourceRecord.task;
                            if (task != null && task.stack == null) {
                                // Target stack got cleared when we all activities were removed
                                // above. Go ahead and reset it.
                                targetStack = computeStackFocus(sourceRecord, false /* newTask */);
                                targetStack.addTask(
                                        task, !launchTaskBehind /* toTop */, false /* moving */);
                            }

                        }
                    } else if (r.realActivity.equals(intentActivity.task.realActivity)) {
                        // In this case the top activity on the task is the
                        // same as the one being launched, so we take that
                        // as a request to bring the task to the foreground.
                        // If the top activity in the task is the root
                        // activity, deliver this new intent to it if it
                        // desires.
                        if (((launchFlags&Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0 || launchSingleTop)
                                && intentActivity.realActivity.equals(r.realActivity)) {
                            ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, r,
                                    intentActivity.task);
                            if (intentActivity.frontOfTask) {
                                intentActivity.task.setIntent(r);
                            }
                            intentActivity.deliverNewIntentLocked(callingUid, r.intent,
                                    r.launchedFromPackage);
                        } else if (!r.intent.filterEquals(intentActivity.task.intent)) {
                            // In this case we are launching the root activity
                            // of the task, but with a different intent.  We
                            // should start a new instance on top.
                            addingToTask = true;
                            sourceRecord = intentActivity;
                        }
                    } else if ((launchFlags&Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) == 0) {
                        // In this case an activity is being launched in to an
                        // existing task, without resetting that task.  This
                        // is typically the situation of launching an activity
                        // from a notification or shortcut.  We want to place
                        // the new activity on top of the current task.
                        addingToTask = true;
                        sourceRecord = intentActivity;
                    } else if (!intentActivity.task.rootWasReset) {
                        // In this case we are launching in to an existing task
                        // that has not yet been started from its front door.
                        // The current task has been brought to the front.
                        // Ideally, we'd probably like to place this new task
                        // at the bottom of its stack, but that's a little hard
                        // to do with the current organization of the code so
                        // for now we'll just drop it.
                        intentActivity.task.setIntent(r);
                    }
                    if (!addingToTask && reuseTask == null) {
                        // We didn't do anything...  but it was needed (a.k.a., client
                        // don't use that intent!)  And for paranoia, make
                        // sure we have correctly resumed the top activity.
                        if (doResume) {
                            targetStack.resumeTopActivityLocked(null, options);
                            if (!movedToFront) {
                                // Make sure to notify Keyguard as well if we are not running an app
                                // transition later.
                                notifyActivityDrawnForKeyguard();
                            }
                        } else {
                            ActivityOptions.abort(options);
                        }
                        return ActivityManager.START_TASK_TO_FRONT;
                    }
                }
            }
        }

        //String uri = r.intent.toURI();
        //Intent intent2 = new Intent(uri);
        //Slog.i(TAG, "Given intent: " + r.intent);
        //Slog.i(TAG, "URI is: " + uri);
        //Slog.i(TAG, "To intent: " + intent2);

        if (r.packageName != null) {
            // If the activity being launched is the same as the one currently
            // at the top, then we need to check if it should only be launched
            // once.
            ActivityStack topStack = mFocusedStack;
            ActivityRecord top = topStack.topRunningNonDelayedActivityLocked(notTop);
            if (top != null && r.resultTo == null) {
                if (top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                    if (top.app != null && top.app.thread != null) {
                        if ((launchFlags & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0
                            || launchSingleTop || launchSingleTask) {
                            ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, top,
                                    top.task);
                            // For paranoia, make sure we have correctly
                            // resumed the top activity.
                            topStack.mLastPausedActivity = null;
                            if (doResume) {
                                resumeTopActivitiesLocked();
                            }
                            ActivityOptions.abort(options);
                            if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
                                // We don't need to start a new activity, and
                                // the client said not to do anything if that
                                // is the case, so this is it!
                                return ActivityManager.START_RETURN_INTENT_TO_CALLER;
                            }
                            top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                            return ActivityManager.START_DELIVERED_TO_TOP;
                        }
                    }
                }
            }

        } else {
            if (r.resultTo != null && r.resultTo.task.stack != null) {
                r.resultTo.task.stack.sendActivityResultLocked(-1, r.resultTo, r.resultWho,
                        r.requestCode, Activity.RESULT_CANCELED, null);
            }
            ActivityOptions.abort(options);
            return ActivityManager.START_CLASS_NOT_FOUND;
        }

        boolean newTask = false;
        boolean keepCurTransition = false;

        TaskRecord taskToAffiliate = launchTaskBehind && sourceRecord != null ?
                sourceRecord.task : null;

        // Should this be considered a new task?
        if (r.resultTo == null && inTask == null && !addingToTask
                && (launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
            newTask = true;
            targetStack = computeStackFocus(r, newTask);
            targetStack.moveToFront("startingNewTask");

            if (reuseTask == null) {
                r.setTask(targetStack.createTaskRecord(getNextTaskId(),
                        newTaskInfo != null ? newTaskInfo : r.info,
                        newTaskIntent != null ? newTaskIntent : intent,
                        voiceSession, voiceInteractor, !launchTaskBehind /* toTop */),
                        taskToAffiliate);
                if (DEBUG_TASKS) Slog.v(TAG_TASKS,
                        "Starting new activity " + r + " in new task " + r.task);
            } else {
                r.setTask(reuseTask, taskToAffiliate);
            }
            if (isLockTaskModeViolation(r.task)) {
                Slog.e(TAG, "Attempted Lock Task Mode violation r=" + r);
                return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
            }
            if (!movedHome) {
                if ((launchFlags &
                        (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME))
                        == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME)) {
                    // Caller wants to appear on home activity, so before starting
                    // their own activity we will bring home to the front.
                    r.task.setTaskToReturnTo(HOME_ACTIVITY_TYPE);
                }
            }
        } else if (sourceRecord != null) {
            final TaskRecord sourceTask = sourceRecord.task;
            if (isLockTaskModeViolation(sourceTask)) {
                Slog.e(TAG, "Attempted Lock Task Mode violation r=" + r);
                return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
            }
            targetStack = sourceTask.stack;
            targetStack.moveToFront("sourceStackToFront");
            final TaskRecord topTask = targetStack.topTask();
            if (topTask != sourceTask) {
                targetStack.moveTaskToFrontLocked(sourceTask, noAnimation, options,
                        r.appTimeTracker, "sourceTaskToFront");
            }
            if (!addingToTask && (launchFlags&Intent.FLAG_ACTIVITY_CLEAR_TOP) != 0) {
                // In this case, we are adding the activity to an existing
                // task, but the caller has asked to clear that task if the
                // activity is already running.
                ActivityRecord top = sourceTask.performClearTaskLocked(r, launchFlags);
                keepCurTransition = true;
                if (top != null) {
                    ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, r, top.task);
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                    // For paranoia, make sure we have correctly
                    // resumed the top activity.
                    targetStack.mLastPausedActivity = null;
                    if (doResume) {
                        targetStack.resumeTopActivityLocked(null);
                    }
                    ActivityOptions.abort(options);
                    return ActivityManager.START_DELIVERED_TO_TOP;
                }
            } else if (!addingToTask &&
                    (launchFlags&Intent.FLAG_ACTIVITY_REORDER_TO_FRONT) != 0) {
                // In this case, we are launching an activity in our own task
                // that may already be running somewhere in the history, and
                // we want to shuffle it to the front of the stack if so.
                final ActivityRecord top = sourceTask.findActivityInHistoryLocked(r);
                if (top != null) {
                    final TaskRecord task = top.task;
                    task.moveActivityToFrontLocked(top);
                    ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, r, task);
                    top.updateOptionsLocked(options);
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                    targetStack.mLastPausedActivity = null;
                    if (doResume) {
                        targetStack.resumeTopActivityLocked(null);
                    }
                    return ActivityManager.START_DELIVERED_TO_TOP;
                }
            }
            // An existing activity is starting this new activity, so we want
            // to keep the new one in the same task as the one that is starting
            // it.
            r.setTask(sourceTask, null);
            if (DEBUG_TASKS) Slog.v(TAG_TASKS, "Starting new activity " + r
                    + " in existing task " + r.task + " from source " + sourceRecord);

        } else if (inTask != null) {
            // The caller is asking that the new activity be started in an explicit
            // task it has provided to us.
            if (isLockTaskModeViolation(inTask)) {
                Slog.e(TAG, "Attempted Lock Task Mode violation r=" + r);
                return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
            }
            targetStack = inTask.stack;
            targetStack.moveTaskToFrontLocked(inTask, noAnimation, options, r.appTimeTracker,
                    "inTaskToFront");

            // Check whether we should actually launch the new activity in to the task,
            // or just reuse the current activity on top.
            ActivityRecord top = inTask.getTopActivity();
            if (top != null && top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                if ((launchFlags & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0
                        || launchSingleTop || launchSingleTask) {
                    ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, top, top.task);
                    if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
                        // We don't need to start a new activity, and
                        // the client said not to do anything if that
                        // is the case, so this is it!
                        return ActivityManager.START_RETURN_INTENT_TO_CALLER;
                    }
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                    return ActivityManager.START_DELIVERED_TO_TOP;
                }
            }

            if (!addingToTask) {
                // We don't actually want to have this activity added to the task, so just
                // stop here but still tell the caller that we consumed the intent.
                ActivityOptions.abort(options);
                return ActivityManager.START_TASK_TO_FRONT;
            }

            r.setTask(inTask, null);
            if (DEBUG_TASKS) Slog.v(TAG_TASKS, "Starting new activity " + r
                    + " in explicit task " + r.task);

        } else {
            // This not being started from an existing activity, and not part
            // of a new task...  just put it in the top task, though these days
            // this case should never happen.
            targetStack = computeStackFocus(r, newTask);
            targetStack.moveToFront("addingToTopTask");
            ActivityRecord prev = targetStack.topActivity();
            r.setTask(prev != null ? prev.task : targetStack.createTaskRecord(getNextTaskId(),
                            r.info, intent, null, null, true), null);
            mWindowManager.moveTaskToTop(r.task.taskId);
            if (DEBUG_TASKS) Slog.v(TAG_TASKS, "Starting new activity " + r
                    + " in new guessed " + r.task);
        }

        mService.grantUriPermissionFromIntentLocked(callingUid, r.packageName,
                intent, r.getUriPermissionsLocked(), r.userId);

        if (sourceRecord != null && sourceRecord.isRecentsActivity()) {
            r.task.setTaskToReturnTo(RECENTS_ACTIVITY_TYPE);
        }
        if (newTask) {
            EventLog.writeEvent(EventLogTags.AM_CREATE_TASK, r.userId, r.task.taskId);
        }
        ActivityStack.logStartActivity(EventLogTags.AM_CREATE_ACTIVITY, r, r.task);
        targetStack.mLastPausedActivity = null;
        // [见流程2.10]
        targetStack.startActivityLocked(r, newTask, doResume, keepCurTransition, options);
        if (!launchTaskBehind) {
            mService.setFocusedActivityLocked(r, "startedActivity");
        }
        return ActivityManager.START_SUCCESS;
    }

找到或创建新的ActivityTask对象, 然后进入targetStack.startActivityLocked()方法

### 2.10 AS.startActivityLocked
[-> ActivityStack.java]



    final void startActivityLocked(ActivityRecord r, boolean newTask,
            boolean doResume, boolean keepCurTransition, Bundle options) {
        TaskRecord rTask = r.task;
        final int taskId = rTask.taskId;
        // mLaunchTaskBehind tasks get placed at the back of the task stack.
        if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
            // Last activity in task had been removed or ActivityManagerService is reusing task.
            // Insert or replace.
            // Might not even be in.
            insertTaskAtTop(rTask, r);
            mWindowManager.moveTaskToTop(taskId);
        }
        TaskRecord task = null;
        if (!newTask) {
            // If starting in an existing task, find where that is...
            boolean startIt = true;
            for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
                task = mTaskHistory.get(taskNdx);
                if (task.getTopActivity() == null) {
                    // All activities in task are finishing.
                    continue;
                }
                if (task == r.task) {
                    // Here it is!  Now, if this is not yet visible to the
                    // user, then just add it without starting; it will
                    // get started when the user navigates back to it.
                    if (!startIt) {
                        if (DEBUG_ADD_REMOVE) Slog.i(TAG, "Adding activity " + r + " to task "
                                + task, new RuntimeException("here").fillInStackTrace());
                        task.addActivityToTop(r);
                        r.putInHistory();
                        mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                                r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                                (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0,
                                r.userId, r.info.configChanges, task.voiceSession != null,
                                r.mLaunchTaskBehind);
                        if (VALIDATE_TOKENS) {
                            validateAppTokensLocked();
                        }
                        ActivityOptions.abort(options);
                        return;
                    }
                    break;
                } else if (task.numFullscreen > 0) {
                    startIt = false;
                }
            }
        }

        // Place a new activity at top of stack, so it is next to interact
        // with the user.

        // If we are not placing the new activity frontmost, we do not want
        // to deliver the onUserLeaving callback to the actual frontmost
        // activity
        if (task == r.task && mTaskHistory.indexOf(task) != (mTaskHistory.size() - 1)) {
            mStackSupervisor.mUserLeaving = false;
            if (DEBUG_USER_LEAVING) Slog.v(TAG_USER_LEAVING,
                    "startActivity() behind front, mUserLeaving=false");
        }

        task = r.task;

        // Slot the activity into the history stack and proceed
        if (DEBUG_ADD_REMOVE) Slog.i(TAG, "Adding activity " + r + " to stack to task " + task,
                new RuntimeException("here").fillInStackTrace());
        task.addActivityToTop(r);
        task.setFrontOfTask();

        r.putInHistory();
        mActivityTrigger.activityStartTrigger(r.intent, r.info, r.appInfo);
        if (!isHomeStack() || numActivities() > 0) {
            // We want to show the starting preview window if we are
            // switching to a new task, or the next activity's process is
            // not currently running.
            boolean showStartingIcon = newTask;
            ProcessRecord proc = r.app;
            if (proc == null) {
                proc = mService.mProcessNames.get(r.processName, r.info.applicationInfo.uid);
            }

            if (proc == null || proc.thread == null) {
                showStartingIcon = true;
            }
            if (DEBUG_TRANSITION) Slog.v(TAG_TRANSITION,
                    "Prepare open transition: starting " + r);
            if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_NO_ANIMATION) != 0) {
                mWindowManager.prepareAppTransition(AppTransition.TRANSIT_NONE, keepCurTransition);
                mNoAnimActivities.add(r);
            } else {
                mWindowManager.prepareAppTransition(newTask
                        ? r.mLaunchTaskBehind
                                ? AppTransition.TRANSIT_TASK_OPEN_BEHIND
                                : AppTransition.TRANSIT_TASK_OPEN
                        : AppTransition.TRANSIT_ACTIVITY_OPEN, keepCurTransition);
                mNoAnimActivities.remove(r);
            }
            mWindowManager.addAppToken(task.mActivities.indexOf(r),
                    r.appToken, r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                    (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0, r.userId,
                    r.info.configChanges, task.voiceSession != null, r.mLaunchTaskBehind);
            boolean doShow = true;
            if (newTask) {
                // Even though this activity is starting fresh, we still need
                // to reset it to make sure we apply affinities to move any
                // existing activities from other tasks in to it.
                // If the caller has requested that the target task be
                // reset, then do so.
                if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                    resetTaskIfNeededLocked(r, r);
                    doShow = topRunningNonDelayedActivityLocked(null) == r;
                }
            } else if (options != null && new ActivityOptions(options).getAnimationType()
                    == ActivityOptions.ANIM_SCENE_TRANSITION) {
                doShow = false;
            }
            if (r.mLaunchTaskBehind) {
                // Don't do a starting window for mLaunchTaskBehind. More importantly make sure we
                // tell WindowManager that r is visible even though it is at the back of the stack.
                mWindowManager.setAppVisibility(r.appToken, true);
                ensureActivitiesVisibleLocked(null, 0);
            } else if (SHOW_APP_STARTING_PREVIEW && doShow) {
                // Figure out if we are transitioning from another activity that is
                // "has the same starting icon" as the next one.  This allows the
                // window manager to keep the previous window it had previously
                // created, if it still had one.
                ActivityRecord prev = mResumedActivity;
                if (prev != null) {
                    // We don't want to reuse the previous starting preview if:
                    // (1) The current activity is in a different task.
                    if (prev.task != r.task) {
                        prev = null;
                    }
                    // (2) The current activity is already displayed.
                    else if (prev.nowVisible) {
                        prev = null;
                    }
                }

                mWindowManager.setAppStartingWindow(
                        r.appToken, r.packageName, r.theme,
                        mService.compatibilityInfoForPackageLocked(
                                 r.info.applicationInfo), r.nonLocalizedLabel,
                        r.labelRes, r.icon, r.logo, r.windowFlags,

                        prev != null ? prev.appToken : null, showStartingIcon);
                r.mStartingWindowShown = true;
            }
        } else {
            // If this is the first activity, don't do any fancy animations,
            // because there is nothing for it to animate on top of.
            mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                    r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                    (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0, r.userId,
                    r.info.configChanges, task.voiceSession != null, r.mLaunchTaskBehind);
            ActivityOptions.abort(options);
            options = null;
        }
        if (VALIDATE_TOKENS) {
            validateAppTokensLocked();
        }

        if (doResume) {
            // [见流程2.11]
            mStackSupervisor.resumeTopActivitiesLocked(this, r, options);
        }
    }

### 2.11 ASS.resumeTopActivitiesLocked

    boolean resumeTopActivitiesLocked(ActivityStack targetStack, ActivityRecord target,
            Bundle targetOptions) {
        if (targetStack == null) {
            targetStack = mFocusedStack;
        }

        boolean result = false;
        if (isFrontStack(targetStack)) {
            //[见流程2.12]
            result = targetStack.resumeTopActivityLocked(target, targetOptions);
        }

        for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
            final ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
            for (int stackNdx = stacks.size() - 1; stackNdx >= 0; --stackNdx) {
                final ActivityStack stack = stacks.get(stackNdx);
                if (stack == targetStack) {
                    //上面刚已启动
                    continue;
                }
                if (isFrontStack(stack)) {
                    stack.resumeTopActivityLocked(null);
                }
            }
        }
        return result;
    }

### 2.12 AS.resumeTopActivitiesLocked


    final boolean resumeTopActivityLocked(ActivityRecord prev, Bundle options) {
        if (mStackSupervisor.inResumeTopActivity) {
            return false; //防止递归启动
        }

        boolean result = false;
        try {
            mStackSupervisor.inResumeTopActivity = true;
            if (mService.mLockScreenShown == ActivityManagerService.LOCK_SCREEN_LEAVING) {
                mService.mLockScreenShown = ActivityManagerService.LOCK_SCREEN_HIDDEN;
                mService.updateSleepIfNeededLocked();
            }
            //[见流程2.13]
            result = resumeTopActivityInnerLocked(prev, options);
        } finally {
            mStackSupervisor.inResumeTopActivity = false;
        }
        return result;
    }

inResumeTopActivity用于保证每次只有一个Activity执行resumeTopActivityLocked()操作.

### 2.13 AS.resumeTopActivityInnerLocked


    private boolean resumeTopActivityInnerLocked(ActivityRecord prev, Bundle options) {
        if (!mService.mBooting && !mService.mBooted) {
            return false;
        }

        ActivityRecord parent = mActivityContainer.mParentActivity;
        if ((parent != null && parent.state != ActivityState.RESUMED) ||
                !mActivityContainer.isAttachedLocked()) {
            // Do not resume this stack if its parent is not resumed.
            // TODO: If in a loop, make sure that parent stack resumeTopActivity is called 1st.
            return false;
        }

        cancelInitializingActivities();

        // Find the first activity that is not finishing.
        final ActivityRecord next = topRunningActivityLocked(null);

        // Remember how we'll process this pause/resume situation, and ensure
        // that the state is reset however we wind up proceeding.
        final boolean userLeaving = mStackSupervisor.mUserLeaving;
        mStackSupervisor.mUserLeaving = false;

        final TaskRecord prevTask = prev != null ? prev.task : null;
        if (next == null) {
            // There are no more activities!
            final String reason = "noMoreActivities";
            if (!mFullscreen) {
                // Try to move focus to the next visible stack with a running activity if this
                // stack is not covering the entire screen.
                final ActivityStack stack = getNextVisibleStackLocked();
                if (adjustFocusToNextVisibleStackLocked(stack, reason)) {
                    return mStackSupervisor.resumeTopActivitiesLocked(stack, prev, null);
                }
            }
            // Let's just start up the Launcher...
            ActivityOptions.abort(options);
            if (DEBUG_STATES) Slog.d(TAG_STATES,
                    "resumeTopActivityLocked: No more activities go home");
            if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
            // Only resume home if on home display
            final int returnTaskType = prevTask == null || !prevTask.isOverHomeStack() ?
                    HOME_ACTIVITY_TYPE : prevTask.getTaskToReturnTo();
            return isOnHomeDisplay() &&
                    mStackSupervisor.resumeHomeStackTask(returnTaskType, prev, reason);
        }

        next.delayedResume = false;

        // If the top activity is the resumed one, nothing to do.
        if (mResumedActivity == next && next.state == ActivityState.RESUMED &&
                    mStackSupervisor.allResumedActivitiesComplete()) {
            // Make sure we have executed any pending transitions, since there
            // should be nothing left to do at this point.
            mWindowManager.executeAppTransition();
            mNoAnimActivities.clear();
            ActivityOptions.abort(options);
            if (DEBUG_STATES) Slog.d(TAG_STATES,
                    "resumeTopActivityLocked: Top activity resumed " + next);
            if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
            return false;
        }

        final TaskRecord nextTask = next.task;
        if (prevTask != null && prevTask.stack == this &&
                prevTask.isOverHomeStack() && prev.finishing && prev.frontOfTask) {
            if (DEBUG_STACK)  mStackSupervisor.validateTopActivitiesLocked();
            if (prevTask == nextTask) {
                prevTask.setFrontOfTask();
            } else if (prevTask != topTask()) {
                // This task is going away but it was supposed to return to the home stack.
                // Now the task above it has to return to the home task instead.
                final int taskNdx = mTaskHistory.indexOf(prevTask) + 1;
                mTaskHistory.get(taskNdx).setTaskToReturnTo(HOME_ACTIVITY_TYPE);
            } else if (!isOnHomeDisplay()) {
                return false;
            } else if (!isHomeStack()){
                if (DEBUG_STATES) Slog.d(TAG_STATES,
                        "resumeTopActivityLocked: Launching home next");
                final int returnTaskType = prevTask == null || !prevTask.isOverHomeStack() ?
                        HOME_ACTIVITY_TYPE : prevTask.getTaskToReturnTo();
                return isOnHomeDisplay() &&
                        mStackSupervisor.resumeHomeStackTask(returnTaskType, prev, "prevFinished");
            }
        }

        // If we are sleeping, and there is no resumed activity, and the top
        // activity is paused, well that is the state we want.
        if (mService.isSleepingOrShuttingDown()
                && mLastPausedActivity == next
                && mStackSupervisor.allPausedActivitiesComplete()) {
            // Make sure we have executed any pending transitions, since there
            // should be nothing left to do at this point.
            mWindowManager.executeAppTransition();
            mNoAnimActivities.clear();
            ActivityOptions.abort(options);
            if (DEBUG_STATES) Slog.d(TAG_STATES,
                    "resumeTopActivityLocked: Going to sleep and all paused");
            if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
            return false;
        }

        // Make sure that the user who owns this activity is started.  If not,
        // we will just leave it as is because someone should be bringing
        // another user's activities to the top of the stack.
        if (mService.mStartedUsers.get(next.userId) == null) {
            Slog.w(TAG, "Skipping resume of top activity " + next
                    + ": user " + next.userId + " is stopped");
            if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
            return false;
        }

        // The activity may be waiting for stop, but that is no longer
        // appropriate for it.
        mStackSupervisor.mStoppingActivities.remove(next);
        mStackSupervisor.mGoingToSleepActivities.remove(next);
        next.sleeping = false;
        mStackSupervisor.mWaitingVisibleActivities.remove(next);

        if (DEBUG_SWITCH) Slog.v(TAG_SWITCH, "Resuming " + next);

        mActivityTrigger.activityResumeTrigger(next.intent, next.info, next.appInfo);

        // If we are currently pausing an activity, then don't do anything
        // until that is done.
        if (!mStackSupervisor.allPausedActivitiesComplete()) {
            if (DEBUG_SWITCH || DEBUG_PAUSE || DEBUG_STATES) Slog.v(TAG_PAUSE,
                    "resumeTopActivityLocked: Skip resume: some activity pausing.");
            if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
            return false;
        }

        // Okay we are now going to start a switch, to 'next'.  We may first
        // have to pause the current activity, but this is an important point
        // where we have decided to go to 'next' so keep track of that.
        // XXX "App Redirected" dialog is getting too many false positives
        // at this point, so turn off for now.
        if (false) {
            if (mLastStartedActivity != null && !mLastStartedActivity.finishing) {
                long now = SystemClock.uptimeMillis();
                final boolean inTime = mLastStartedActivity.startTime != 0
                        && (mLastStartedActivity.startTime + START_WARN_TIME) >= now;
                final int lastUid = mLastStartedActivity.info.applicationInfo.uid;
                final int nextUid = next.info.applicationInfo.uid;
                if (inTime && lastUid != nextUid
                        && lastUid != next.launchedFromUid
                        && mService.checkPermission(
                                android.Manifest.permission.STOP_APP_SWITCHES,
                                -1, next.launchedFromUid)
                        != PackageManager.PERMISSION_GRANTED) {
                    mService.showLaunchWarningLocked(mLastStartedActivity, next);
                } else {
                    next.startTime = now;
                    mLastStartedActivity = next;
                }
            } else {
                next.startTime = SystemClock.uptimeMillis();
                mLastStartedActivity = next;
            }
        }

        mStackSupervisor.setLaunchSource(next.info.applicationInfo.uid);
        // MIUI ADD: START
        if (mStackSupervisor.mIsPerfBoostEnabled && mResumePerf == null) {
            mResumePerf = new BoostFramework();
            rBoostTimeOut = mService.mContext.getResources().getInteger(
                   com.android.internal.R.integer.resumeboost_timeout_param);
        }
        if (mResumePerf != null) {
            ProcessRecord app = mService.getProcessRecordLocked(next.processName,
                next.info.applicationInfo.uid, true);
            if (app != null && app.thread != null)
                mResumePerf.perfLockAcquire(rBoostTimeOut, mStackSupervisor.lBoostCpuParamVal);
        }
        // END

        // We need to start pausing the current activity so the top one
        // can be resumed...
        boolean dontWaitForPause = (next.info.flags&ActivityInfo.FLAG_RESUME_WHILE_PAUSING) != 0;
        // 将其他Activity都执行暂停操作
        boolean pausing = mStackSupervisor.pauseBackStacks(userLeaving, true, dontWaitForPause);
        if (mResumedActivity != null) {
            pausing |= startPausingLocked(userLeaving, false, true, dontWaitForPause);
        }
        if (pausing) {
            if (next.app != null && next.app.thread != null) {
                mService.updateLruProcessLocked(next.app, true, null);
            }
            return true;
        }

        // If the most recent activity was noHistory but was only stopped rather
        // than stopped+finished because the device went to sleep, we need to make
        // sure to finish it as we're making a new activity topmost.
        if (mService.isSleeping() && mLastNoHistoryActivity != null &&
                !mLastNoHistoryActivity.finishing) {
            if (DEBUG_STATES) Slog.d(TAG_STATES,
                    "no-history finish of " + mLastNoHistoryActivity + " on new resume");
            requestFinishActivityLocked(mLastNoHistoryActivity.appToken, Activity.RESULT_CANCELED,
                    null, "resume-no-history", false);
            mLastNoHistoryActivity = null;
        }

        if (prev != null && prev != next) {
            if (!mStackSupervisor.mWaitingVisibleActivities.contains(prev)
                    && next != null && !next.nowVisible) {
                mStackSupervisor.mWaitingVisibleActivities.add(prev);
                if (DEBUG_SWITCH) Slog.v(TAG_SWITCH,
                        "Resuming top, waiting visible to hide: " + prev);
            } else {
                // The next activity is already visible, so hide the previous
                // activity's windows right now so we can show the new one ASAP.
                // We only do this if the previous is finishing, which should mean
                // it is on top of the one being resumed so hiding it quickly
                // is good.  Otherwise, we want to do the normal route of allowing
                // the resumed activity to be shown so we can decide if the
                // previous should actually be hidden depending on whether the
                // new one is found to be full-screen or not.
                if (prev.finishing) {
                    mWindowManager.setAppVisibility(prev.appToken, false);
                    if (DEBUG_SWITCH) Slog.v(TAG_SWITCH,
                            "Not waiting for visible to hide: " + prev + ", waitingVisible="
                            + mStackSupervisor.mWaitingVisibleActivities.contains(prev)
                            + ", nowVisible=" + next.nowVisible);
                } else {
                    if (DEBUG_SWITCH) Slog.v(TAG_SWITCH,
                            "Previous already visible but still waiting to hide: " + prev
                            + ", waitingVisible="
                            + mStackSupervisor.mWaitingVisibleActivities.contains(prev)
                            + ", nowVisible=" + next.nowVisible);
                }
            }
        }

        // Launching this app's activity, make sure the app is no longer
        // considered stopped.
        try {
            AppGlobals.getPackageManager().setPackageStoppedState(
                    next.packageName, false, next.userId); /* TODO: Verify if correct userid */
        } catch (RemoteException e1) {
        } catch (IllegalArgumentException e) {
            Slog.w(TAG, "Failed trying to unstop package "
                    + next.packageName + ": " + e);
        }

        // We are starting up the next activity, so tell the window manager
        // that the previous one will be hidden soon.  This way it can know
        // to ignore it when computing the desired screen orientation.
        boolean anim = true;
        if (mIsAnimationBoostEnabled == true && mPerf == null) {
            mPerf = new BoostFramework();
        }
        if (prev != null) {
            if (prev.finishing) {
                if (DEBUG_TRANSITION) Slog.v(TAG_TRANSITION,
                        "Prepare close transition: prev=" + prev);
                if (mNoAnimActivities.contains(prev)) {
                    anim = false;
                    mWindowManager.prepareAppTransition(AppTransition.TRANSIT_NONE, false);
                } else {
                    mWindowManager.prepareAppTransition(prev.task == next.task
                            ? AppTransition.TRANSIT_ACTIVITY_CLOSE
                            : AppTransition.TRANSIT_TASK_CLOSE, false);
                    if(prev.task != next.task && mPerf != null) {
                       mPerf.perfLockAcquire(aBoostTimeOut, aBoostParamVal);
                    }
                }
                mWindowManager.setAppWillBeHidden(prev.appToken);
                mWindowManager.setAppVisibility(prev.appToken, false);
            } else {
                if (DEBUG_TRANSITION) Slog.v(TAG_TRANSITION,
                        "Prepare open transition: prev=" + prev);
                if (mNoAnimActivities.contains(next)) {
                    anim = false;
                    mWindowManager.prepareAppTransition(AppTransition.TRANSIT_NONE, false);
                } else {
                    mWindowManager.prepareAppTransition(prev.task == next.task
                            ? AppTransition.TRANSIT_ACTIVITY_OPEN
                            : next.mLaunchTaskBehind
                                    ? AppTransition.TRANSIT_TASK_OPEN_BEHIND
                                    : AppTransition.TRANSIT_TASK_OPEN, false);
                    if(prev.task != next.task && mPerf != null) {
                        mPerf.perfLockAcquire(aBoostTimeOut, aBoostParamVal);
                    }
                }
            }
            if (false) {
                mWindowManager.setAppWillBeHidden(prev.appToken);
                mWindowManager.setAppVisibility(prev.appToken, false);
            }
        } else {
            if (mNoAnimActivities.contains(next)) {
                anim = false;
                mWindowManager.prepareAppTransition(AppTransition.TRANSIT_NONE, false);
            } else {
                mWindowManager.prepareAppTransition(AppTransition.TRANSIT_ACTIVITY_OPEN, false);
            }
        }

        Bundle resumeAnimOptions = null;
        if (anim) {
            ActivityOptions opts = next.getOptionsForTargetActivityLocked();
            if (opts != null) {
                resumeAnimOptions = opts.toBundle();
            }
            next.applyOptionsLocked();
        } else {
            next.clearOptionsLocked();
        }

        ActivityStack lastStack = mStackSupervisor.getLastStack();
        if (next.app != null && next.app.thread != null) {

            // This activity is now becoming visible.
            mWindowManager.setAppVisibility(next.appToken, true);

            // schedule launch ticks to collect information about slow apps.
            next.startLaunchTickingLocked();

            ActivityRecord lastResumedActivity = lastStack == null ? null :lastStack.mResumedActivity;
            ActivityState lastState = next.state;

            mService.updateCpuStats();

            next.state = ActivityState.RESUMED;
            mResumedActivity = next;
            next.task.touchActiveTime();
            mRecentTasks.addLocked(next.task);
            mService.updateLruProcessLocked(next.app, true, null);
            updateLRUListLocked(next);
            mService.updateOomAdjLocked();

            // Have the window manager re-evaluate the orientation of
            // the screen based on the new activity order.
            boolean notUpdated = true;
            if (mStackSupervisor.isFrontStack(this)) {
                Configuration config = mWindowManager.updateOrientationFromAppTokens(
                        mService.mConfiguration,
                        next.mayFreezeScreenLocked(next.app) ? next.appToken : null);
                if (config != null) {
                    next.frozenBeforeDestroy = true;
                }
                notUpdated = !mService.updateConfigurationLocked(config, next, false, false);
            }

            if (notUpdated) {
                ActivityRecord nextNext = topRunningActivityLocked(null);

                if (nextNext != next) {
                    // Do over!
                    mStackSupervisor.scheduleResumeTopActivities();
                }
                if (mStackSupervisor.reportResumedActivityLocked(next)) {
                    mNoAnimActivities.clear();
                    return true;
                }
                return false;
            }

            try {
                // Deliver all pending results.
                ArrayList<ResultInfo> a = next.results;
                if (a != null) {
                    final int N = a.size();
                    if (!next.finishing && N > 0) {
                        next.app.thread.scheduleSendResult(next.appToken, a);
                    }
                }

                if (next.newIntents != null) {
                    next.app.thread.scheduleNewIntent(next.newIntents, next.appToken);
                }

                next.sleeping = false;
                mService.showAskCompatModeDialogLocked(next);
                next.app.pendingUiClean = true;
                next.app.forceProcessStateUpTo(mService.mTopProcessState);
                next.clearOptionsLocked();
                next.app.thread.scheduleResumeActivity(next.appToken, next.app.repProcState,
                        mService.isNextTransitionForward(), resumeAnimOptions);

                mStackSupervisor.checkReadyForSleepLocked();

            } catch (Exception e) {
                // Whoops, need to restart this activity!
                if (DEBUG_STATES) Slog.v(TAG_STATES, "Resume failed; resetting state to "
                        + lastState + ": " + next);
                next.state = lastState;
                if (lastStack != null) {
                    lastStack.mResumedActivity = lastResumedActivity;
                }
                Slog.i(TAG, "Restarting because process died: " + next);
                if (!next.hasBeenLaunched) {
                    next.hasBeenLaunched = true;
                } else  if (SHOW_APP_STARTING_PREVIEW && lastStack != null &&
                        mStackSupervisor.isFrontStack(lastStack)) {
                    mWindowManager.setAppStartingWindow(
                            next.appToken, next.packageName, next.theme,
                            mService.compatibilityInfoForPackageLocked(next.info.applicationInfo),
                            next.nonLocalizedLabel, next.labelRes, next.icon, next.logo,
                            next.windowFlags, null, true);
                }
                mStackSupervisor.startSpecificActivityLocked(next, true, false);
                if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
                return true;
            }

            // From this point on, if something goes wrong there is no way
            // to recover the activity.
            try {
                next.visible = true;
                completeResumeLocked(next);
            } catch (Exception e) {
                // If any exception gets thrown, toss away this
                // activity and try the next one.
                Slog.w(TAG, "Exception thrown during resume of " + next, e);
                requestFinishActivityLocked(next.appToken, Activity.RESULT_CANCELED, null,
                        "resume-exception", true);
                if (DEBUG_STACK) mStackSupervisor.validateTopActivitiesLocked();
                return true;
            }
            next.stopped = false;

        } else {
            // Whoops, need to restart this activity!
            if (!next.hasBeenLaunched) {
                next.hasBeenLaunched = true;
            } else {
                if (SHOW_APP_STARTING_PREVIEW) {
                    mWindowManager.setAppStartingWindow(
                            next.appToken, next.packageName, next.theme,
                            mService.compatibilityInfoForPackageLocked(
                                    next.info.applicationInfo),
                            next.nonLocalizedLabel,
                            next.labelRes, next.icon, next.logo, next.windowFlags,
                            null, true);
                }
                if (DEBUG_SWITCH) Slog.v(TAG_SWITCH, "Restarting: " + next);
            }
            // [见流程2.14]
            mStackSupervisor.startSpecificActivityLocked(next, true, true);
        }

        return true;
    }

### 2.14 ASS.startSpecificActivityLocked

    void startSpecificActivityLocked(ActivityRecord r,
            boolean andResume, boolean checkConfig) {
        ProcessRecord app = mService.getProcessRecordLocked(r.processName,
                r.info.applicationInfo.uid, true);

        r.task.stack.setLaunchTime(r);

        if (app != null && app.thread != null) {
            try {
                if ((r.info.flags&ActivityInfo.FLAG_MULTIPROCESS) == 0
                        || !"android".equals(r.info.packageName)) {
                    app.addPackage(r.info.packageName, r.info.applicationInfo.versionCode,
                            mService.mProcessStats);
                }
                //[见流程3.1]
                realStartActivityLocked(r, app, andResume, checkConfig);
                return;
            } catch (RemoteException e) {
                Slog.w(TAG, "Exception when starting activity "
                        + r.intent.getComponent().flattenToShortString(), e);
            }

        }
        //当进程不存在时,则创建进程,经过层层调用,最终会在新进程中调用[流程3.1]
        mService.startProcessLocked(r.processName, r.info.applicationInfo, true, 0,
                "activity", r.intent.getComponent(), false, false, true);
    }


## 三. Activity生命周期

Activity启动过程运行到这里, 接下来就该进入生命周期的过程.

### 3.1  ASS.realStartActivityLocked



## 三. 总结

AMS.startActivityAsUser
    ASS.startActivityMayWait  (使用ASS.mFocusedStack)
        ASS.startActivityLocked
          ASS.startActivityUncheckedLocked

          ASS.resumeTopActivitiesLocked
            AS.resumeTopActivitiesLocked
              AS.resumeTopActivityInnerLocked （scheduleNewIntent, scheduleResumeActivity）
                  ASS.startSpecificActivityLocked


ActivityRecord -> Task -> ActivityStack -> ActivityDisplay -> mActivityDisplays


正向: ActivityStack.mTaskHistory -> TaskRecord.mActivities -> ActivityRecord
反向: ActivityRecord.task -> TaskRecord.stack -> ActivityStack

mActivityDisplays.valueAt(displayNdx).mStacks


LAUNCH_MULTIPLE
LAUNCH_SINGLE_TOP
LAUNCH_SINGLE_TASK
LAUNCH_SINGLE_INSTANCE
