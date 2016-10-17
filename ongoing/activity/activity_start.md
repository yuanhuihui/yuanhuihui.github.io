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
            if (options != null) {
                mParent.startActivityFromChild(this, intent, requestCode, options);
            } else {
                mParent.startActivityFromChild(this, intent, requestCode);
            }
        }
    }

execStartActivity()方法的参数中,mMainThread.getApplicationThread()返回的是数据类型为ApplicationThread `mAppThread`, 另外`IBinder`数据类型为IBinder.

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

AMP经过binder IPC,进入AMN

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
        //[见小节2.6.1]
        userId = handleIncomingUser(Binder.getCallingPid(), Binder.getCallingUid(), userId,
                false, ALLOW_FULL_ONLY, "startActivity", null);
        //[见小节2.7]
        return mStackSupervisor.startActivityMayWait(caller, -1, callingPackage, intent,
                resolvedType, null, null, resultTo, resultWho, requestCode, startFlags,
                profilerInfo, null, null, options, false, userId, null, null);
    }

此处mStackSupervisor的数据类型为`ActivityStackSupervisor`

#### 2.6.1 AMS.handleIncomingUser

    int handleIncomingUser(int callingPid, int callingUid, int userId, boolean allowAll,
            int allowMode, String name, String callerPackage) {
        final int callingUserId = UserHandle.getUserId(callingUid);
        if (callingUserId == userId) {
            return userId;
        }
        //获取目标tUserId
        int targetUserId = unsafeConvertIncomingUser(userId);

        if (callingUid != 0 && callingUid != Process.SYSTEM_UID) {
            final boolean allow;
            if (checkComponentPermission(INTERACT_ACROSS_USERS_FULL, callingPid,
                    callingUid, -1, true) == PackageManager.PERMISSION_GRANTED) {
                // If the caller has this permission, they always pass go.  And collect $200.
                allow = true;
            } else if (allowMode == ALLOW_FULL_ONLY) {
                // We require full access, sucks to be you.
                allow = false;
            } else if (checkComponentPermission(INTERACT_ACROSS_USERS, callingPid,
                    callingUid, -1, true) != PackageManager.PERMISSION_GRANTED) {
                // If the caller does not have either permission, they are always doomed.
                allow = false;
            } else if (allowMode == ALLOW_NON_FULL) {
                // We are blanket allowing non-full access, you lucky caller!
                allow = true;
            } else if (allowMode == ALLOW_NON_FULL_IN_PROFILE) {
                // We may or may not allow this depending on whether the two users are
                // in the same profile.
                synchronized (mUserProfileGroupIdsSelfLocked) {
                    int callingProfile = mUserProfileGroupIdsSelfLocked.get(callingUserId,
                            UserInfo.NO_PROFILE_GROUP_ID);
                    int targetProfile = mUserProfileGroupIdsSelfLocked.get(targetUserId,
                            UserInfo.NO_PROFILE_GROUP_ID);
                    allow = callingProfile != UserInfo.NO_PROFILE_GROUP_ID
                            && callingProfile == targetProfile;
                }
            } else {
                throw new IllegalArgumentException("Unknown mode: " + allowMode);
            }
            if (!allow) {
                if (userId == UserHandle.USER_CURRENT_OR_SELF) {
                    // In this case, they would like to just execute as their
                    // owner user instead of failing.
                    targetUserId = callingUserId;
                } else {
                    throw new SecurityException(...);
                }
            }
        }
        if (!allowAll && targetUserId < 0) {
            throw new IllegalArgumentException(
                    "Call does not support special user #" + targetUserId);
        }

        if (callingUid == Process.SHELL_UID && targetUserId >= UserHandle.USER_OWNER) {
            if (mUserManager.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES,
                    targetUserId)) {
                throw new SecurityException("Shell does not have permission to access user "
                        + targetUserId + "\n " + Debug.getCallers(3));
            }
        }
        return targetUserId;
    }

    int unsafeConvertIncomingUser(int userId) {
        return (userId == UserHandle.USER_CURRENT || userId == UserHandle.USER_CURRENT_OR_SELF)
                ? mCurrentUserId : userId;
    }

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

该过程主要是通过resolveActivity来获取ActivityInfo信息, 然后再进入ASS.startActivityLocked().

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

        final int userId = aInfo != null ? UserHandle.getUserId(aInfo.applicationInfo.uid) : 0;

        ActivityRecord sourceRecord = null;
        ActivityRecord resultRecord = null;
        if (resultTo != null) {
            //获取调用者所在的Activity
            sourceRecord = isInAnyStackLocked(resultTo);
            if (sourceRecord != null) {
                //requestCode = -1, 不进入
                if (requestCode >= 0 && !sourceRecord.finishing) {
                    resultRecord = sourceRecord;
                }
            }
        }

        final int launchFlags = intent.getFlags();

        if ((launchFlags & Intent.FLAG_ACTIVITY_FORWARD_RESULT) != 0 && sourceRecord != null) {
            ... // activity执行结果的返回由源Activity转换到新Activity, 不需要返回结果则不会进入该分支
        }

        if (err == ActivityManager.START_SUCCESS && intent.getComponent() == null) {
            //从Intent中无法找到相应的组件
            err = ActivityManager.START_INTENT_NOT_RESOLVED;
        }

        if (err == ActivityManager.START_SUCCESS && aInfo == null) {
            //从Intent中无法找到相应的ActivityInfo
            err = ActivityManager.START_CLASS_NOT_FOUND;
        }

        if (err == ActivityManager.START_SUCCESS
                && !isCurrentProfileLocked(userId)
                && (aInfo.flags & FLAG_SHOW_FOR_ALL_USERS) == 0) {
            //尝试启动一个后台Activity, 但该Activity并不是允许对所有用户可见
            err = ActivityManager.START_NOT_CURRENT_USER_ACTIVITY;
        }

        if (err == ActivityManager.START_SUCCESS && sourceRecord != null
                && sourceRecord.task.voiceSession != null) {
            ... //voiceSession为空, 不进入该分支
        }

        if (err == ActivityManager.START_SUCCESS && voiceSession != null) {
            ... //voiceSession为空, 不进入该分支
        }

        //执行后resultStack = null
        final ActivityStack resultStack = resultRecord == null ? null : resultRecord.task.stack;

        //前面步骤存在err,执行到这里将会直接返回
        if (err != ActivityManager.START_SUCCESS) {
            if (resultRecord != null) {
                resultStack.sendActivityResultLocked(-1,
                    resultRecord, resultWho, requestCode,
                    Activity.RESULT_CANCELED, null);
            }
            ActivityOptions.abort(options);
            return err;
        }

        boolean abort = false;

        final int startAnyPerm = mService.checkPermission(
                START_ANY_ACTIVITY, callingPid, callingUid);

        if (startAnyPerm != PERMISSION_GRANTED) {
            ... //权限检查
        }

        abort |= !mService.mIntentFirewall.checkStartActivity(intent, callingUid,
                callingPid, resolvedType, aInfo.applicationInfo);

        // ActivityController不为空的情况
        if (mService.mController != null) {
            try {
                Intent watchIntent = intent.cloneFilter();
                abort |= !mService.mController.activityStarting(watchIntent,
                        aInfo.applicationInfo.packageName);
            } catch (RemoteException e) {
                mService.mController = null;
            }
        }

        // 只有条件不满足,才进入该分支
        if (abort) {
            if (resultRecord != null) {
                resultStack.sendActivityResultLocked(-1, resultRecord, resultWho, requestCode,
                        Activity.RESULT_CANCELED, null);
            }
            ActivityOptions.abort(options);
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
            Slog.w(TAG, "Starting activity in task not in recents: " + inTask);
            inTask = null;
        }

        final boolean launchSingleTop = r.launchMode == ActivityInfo.LAUNCH_SINGLE_TOP;
        final boolean launchSingleInstance = r.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE;
        final boolean launchSingleTask = r.launchMode == ActivityInfo.LAUNCH_SINGLE_TASK;

        int launchFlags = intent.getFlags();
        if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_DOCUMENT) != 0 &&
                (launchSingleInstance || launchSingleTask)) {
            launchFlags &=
                    ~(Intent.FLAG_ACTIVITY_NEW_DOCUMENT | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        } else {
            switch (r.info.documentLaunchMode) {
                case ActivityInfo.DOCUMENT_LAUNCH_NONE:
                    break;
                case ActivityInfo.DOCUMENT_LAUNCH_INTO_EXISTING:
                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_DOCUMENT;
                    break;
                case ActivityInfo.DOCUMENT_LAUNCH_ALWAYS:
                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_DOCUMENT;
                    break;
                case ActivityInfo.DOCUMENT_LAUNCH_NEVER:
                    launchFlags &= ~Intent.FLAG_ACTIVITY_MULTIPLE_TASK;
                    break;
            }
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

        if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
            if (launchTaskBehind
                    || r.info.documentLaunchMode == ActivityInfo.DOCUMENT_LAUNCH_ALWAYS) {
                launchFlags |= Intent.FLAG_ACTIVITY_MULTIPLE_TASK;
            }
        }

        mUserLeaving = (launchFlags & Intent.FLAG_ACTIVITY_NO_USER_ACTION) == 0;
        if (DEBUG_USER_LEAVING) Slog.v(TAG_USER_LEAVING,
                "startActivity() => mUserLeaving=" + mUserLeaving);

        if (!doResume) {
            r.delayedResume = true;
        }

        ActivityRecord notTop =
                (launchFlags & Intent.FLAG_ACTIVITY_PREVIOUS_IS_TOP) != 0 ? r : null;

        if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
            ActivityRecord checkedCaller = sourceRecord;
            if (checkedCaller == null) {
                checkedCaller = mFocusedStack.topRunningNonDelayedActivityLocked(notTop);
            }
            if (!checkedCaller.realActivity.equals(r.realActivity)) {
                startFlags &= ~ActivityManager.START_FLAG_ONLY_IF_NEEDED;
            }
        }

        boolean addingToTask = false;
        TaskRecord reuseTask = null;

        if (sourceRecord == null && inTask != null && inTask.stack != null) {
            final Intent baseIntent = inTask.getBaseIntent();
            final ActivityRecord root = inTask.getRootActivity();
            if (baseIntent == null) {
                ActivityOptions.abort(options);
                throw new IllegalArgumentException("Launching into task without base intent: "
                        + inTask);
            }

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
            if (root == null) {
                final int flagsOfInterest = Intent.FLAG_ACTIVITY_NEW_TASK
                        | Intent.FLAG_ACTIVITY_MULTIPLE_TASK | Intent.FLAG_ACTIVITY_NEW_DOCUMENT
                        | Intent.FLAG_ACTIVITY_RETAIN_IN_RECENTS;
                launchFlags = (launchFlags&~flagsOfInterest)
                        | (baseIntent.getFlags()&flagsOfInterest);
                intent.setFlags(launchFlags);
                inTask.setIntent(r);
                addingToTask = true;

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

                if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0 && inTask == null) {

                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
                }
            } else if (sourceRecord.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE) {
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            } else if (launchSingleInstance || launchSingleTask) {
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            }
        }

        ActivityInfo newTaskInfo = null;
        Intent newTaskIntent = null;
        ActivityStack sourceStack;
        if (sourceRecord != null) {
            if (sourceRecord.finishing) {
                if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0) {

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

        if (((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0 &&
                (launchFlags & Intent.FLAG_ACTIVITY_MULTIPLE_TASK) == 0)
                || launchSingleInstance || launchSingleTask) {
            if (inTask == null && r.resultTo == null) {
                ActivityRecord intentActivity = !launchSingleInstance ?
                        findTaskLocked(r) : findActivityLocked(intent, r.info);
                if (intentActivity != null) {
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
                        intentActivity.task.setIntent(r);
                    }
                    targetStack = intentActivity.task.stack;
                    targetStack.mLastPausedActivity = null;

                    final ActivityStack focusStack = getFocusedStack();
                    ActivityRecord curTop = (focusStack == null)
                            ? null : focusStack.topRunningNonDelayedActivityLocked(notTop);
                    boolean movedToFront = false;
                    if (curTop != null && (curTop.task != intentActivity.task ||
                            curTop.task != focusStack.topTask())) {
                        r.intent.addFlags(Intent.FLAG_ACTIVITY_BROUGHT_TO_FRONT);
                        if (sourceRecord == null || (sourceStack.topActivity() != null &&
                                sourceStack.topActivity().task == sourceRecord.task)) {

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
                        targetStack.moveToFront("intentActivityFound");
                    }


                    if ((launchFlags&Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                        intentActivity = targetStack.resetTaskIfNeededLocked(intentActivity, r);
                    }
                    if ((startFlags & ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {

                        if (doResume) {
                            resumeTopActivitiesLocked(targetStack, null, options);

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

                        reuseTask = intentActivity.task;
                        reuseTask.performClearTaskLocked();
                        reuseTask.setIntent(r);
                    } else if ((launchFlags & FLAG_ACTIVITY_CLEAR_TOP) != 0
                            || launchSingleInstance || launchSingleTask) {

                        ActivityRecord top =
                                intentActivity.task.performClearTaskLocked(r, launchFlags);
                        if (top != null) {
                            if (top.frontOfTask) {
                                top.task.setIntent(r);
                            }
                            ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT,
                                    r, top.task);
                            top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                        } else {

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

                            addingToTask = true;
                            sourceRecord = intentActivity;
                        }
                    } else if ((launchFlags&Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) == 0) {

                        addingToTask = true;
                        sourceRecord = intentActivity;
                    } else if (!intentActivity.task.rootWasReset) {

                        intentActivity.task.setIntent(r);
                    }
                    if (!addingToTask && reuseTask == null) {

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

        if (r.packageName != null) {
            ActivityStack topStack = mFocusedStack;
            ActivityRecord top = topStack.topRunningNonDelayedActivityLocked(notTop);
            if (top != null && r.resultTo == null) {
                if (top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                    if (top.app != null && top.app.thread != null) {
                        if ((launchFlags & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0
                            || launchSingleTop || launchSingleTask) {
                            ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, top,
                                    top.task);
                            topStack.mLastPausedActivity = null;
                            if (doResume) {
                                resumeTopActivitiesLocked();
                            }
                            ActivityOptions.abort(options);
                            if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
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
            } else {
                r.setTask(reuseTask, taskToAffiliate);
            }
            if (isLockTaskModeViolation(r.task)) {

                return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
            }
            if (!movedHome) {
                if ((launchFlags &
                        (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME))
                        == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME)) {

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

            r.setTask(sourceTask, null);


        } else if (inTask != null) {

            if (isLockTaskModeViolation(inTask)) {
                Slog.e(TAG, "Attempted Lock Task Mode violation r=" + r);
                return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
            }
            targetStack = inTask.stack;
            targetStack.moveTaskToFrontLocked(inTask, noAnimation, options, r.appTimeTracker,
                    "inTaskToFront");

            ActivityRecord top = inTask.getTopActivity();
            if (top != null && top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                if ((launchFlags & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0
                        || launchSingleTop || launchSingleTask) {
                    ActivityStack.logStartActivity(EventLogTags.AM_NEW_INTENT, top, top.task);
                    if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {

                        return ActivityManager.START_RETURN_INTENT_TO_CALLER;
                    }
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                    return ActivityManager.START_DELIVERED_TO_TOP;
                }
            }

            if (!addingToTask) {

                ActivityOptions.abort(options);
                return ActivityManager.START_TASK_TO_FRONT;
            }

            r.setTask(inTask, null);
            if (DEBUG_TASKS) Slog.v(TAG_TASKS, "Starting new activity " + r
                    + " in explicit task " + r.task);

        } else {

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


在ActivityRecord对象创建之初,delayedResume=false,如下情况会涉及

- AS.topRunningNonDelayedActivityLocked()方法不会启动delayedResume==true的ActivityRecord;
- AS.resumeTopActivityInnerLocked()方法会设置delayedResume=false
- ASS.startActivityUncheckedLocked(),当doResume =false, 则会设置delayedResume=true;

### 2.10 AS.startActivityLocked
[-> ActivityStack.java]

    final void startActivityLocked(ActivityRecord r, boolean newTask,
            boolean doResume, boolean keepCurTransition, Bundle options) {
        TaskRecord rTask = r.task;
        final int taskId = rTask.taskId;
        // mLaunchTaskBehind tasks get placed at the back of the task stack.
        if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
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

        if (task == r.task && mTaskHistory.indexOf(task) != (mTaskHistory.size() - 1)) {
            mStackSupervisor.mUserLeaving = false;
            if (DEBUG_USER_LEAVING) Slog.v(TAG_USER_LEAVING,
                    "startActivity() behind front, mUserLeaving=false");
        }

        task = r.task;

        task.addActivityToTop(r);
        task.setFrontOfTask();

        r.putInHistory();
        mActivityTrigger.activityStartTrigger(r.intent, r.info, r.appInfo);
        if (!isHomeStack() || numActivities() > 0) {
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
                if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                    resetTaskIfNeededLocked(r, r);
                    doShow = topRunningNonDelayedActivityLocked(null) == r;
                }
            } else if (options != null && new ActivityOptions(options).getAnimationType()
                    == ActivityOptions.ANIM_SCENE_TRANSITION) {
                doShow = false;
            }
            if (r.mLaunchTaskBehind) {
                mWindowManager.setAppVisibility(r.appToken, true);
                ensureActivitiesVisibleLocked(null, 0);
            } else if (SHOW_APP_STARTING_PREVIEW && doShow) {

                ActivityRecord prev = mResumedActivity;
                if (prev != null) {
                    if (prev.task != r.task) {
                        prev = null;
                    }

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
            return false;
        }

        cancelInitializingActivities();

        // Find the first activity that is not finishing.
        final ActivityRecord next = topRunningActivityLocked(null);


        final boolean userLeaving = mStackSupervisor.mUserLeaving;
        mStackSupervisor.mUserLeaving = false;

        final TaskRecord prevTask = prev != null ? prev.task : null;
        if (next == null) {

            final String reason = "noMoreActivities";
            if (!mFullscreen) {
                final ActivityStack stack = getNextVisibleStackLocked();
                if (adjustFocusToNextVisibleStackLocked(stack, reason)) {
                    return mStackSupervisor.resumeTopActivitiesLocked(stack, prev, null);
                }
            }
            // Let's just start up the Launcher...
            ActivityOptions.abort(options);

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

        if (mService.isSleepingOrShuttingDown()
                && mLastPausedActivity == next
                && mStackSupervisor.allPausedActivitiesComplete()) {
            mWindowManager.executeAppTransition();
            mNoAnimActivities.clear();
            ActivityOptions.abort(options);
            return false;
        }

        if (mService.mStartedUsers.get(next.userId) == null) {
            return false;
        }

        mStackSupervisor.mStoppingActivities.remove(next);
        mStackSupervisor.mGoingToSleepActivities.remove(next);
        next.sleeping = false;
        mStackSupervisor.mWaitingVisibleActivities.remove(next);

        if (DEBUG_SWITCH) Slog.v(TAG_SWITCH, "Resuming " + next);

        mActivityTrigger.activityResumeTrigger(next.intent, next.info, next.appInfo);

        if (!mStackSupervisor.allPausedActivitiesComplete()) {
            return false;
        }


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

        if (mService.isSleeping() && mLastNoHistoryActivity != null &&
                !mLastNoHistoryActivity.finishing) {

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
                if (prev.finishing) {
                    mWindowManager.setAppVisibility(prev.appToken, false);
                }
            }
        }


        try {
            AppGlobals.getPackageManager().setPackageStoppedState(
                    next.packageName, false, next.userId); /* TODO: Verify if correct userid */
        } catch (RemoteException e1) {
        } catch (IllegalArgumentException e) {

        }


        boolean anim = true;
        if (mIsAnimationBoostEnabled == true && mPerf == null) {
            mPerf = new BoostFramework();
        }
        if (prev != null) {
            if (prev.finishing) {

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


            mWindowManager.setAppVisibility(next.appToken, true);

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
                return true;
            }

            try {
                next.visible = true;
                completeResumeLocked(next);
            } catch (Exception e) {
                requestFinishActivityLocked(next.appToken, Activity.RESULT_CANCELED, null,
                        "resume-exception", true);
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

http://blog.csdn.net/innost/article/details/47254381
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
                    ASS.realStartActivityLocked
                    AMS.startProcessLocked -> ASS.realStartActivityLocked

ActivityRecord -> Task -> ActivityStack -> ActivityDisplay -> mActivityDisplays


正向: ActivityStack.mTaskHistory -> TaskRecord.mActivities -> ActivityRecord
反向: ActivityRecord.task -> TaskRecord.stack -> ActivityStack

mActivityDisplays.valueAt(displayNdx).mStacks


LAUNCH_MULTIPLE
LAUNCH_SINGLE_TOP
LAUNCH_SINGLE_TASK
LAUNCH_SINGLE_INSTANCE
