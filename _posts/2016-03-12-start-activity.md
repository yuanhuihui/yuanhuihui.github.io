---
layout: post
title:  "startActivity启动过程分析"
date:   2016-03-12 21:15:40
catalog:  true
tags:
    - android
    - 组件系列

---

> 基于Android 6.0的源码剖析， 分析android Activity启动流程，相关源码：

    frameworks/base/services/core/java/com/android/server/am/
      - ActivityManagerService.java
      - ActivityStackSupervisor.java
      - ActivityStack.java
      - ActivityRecord.java
      - ProcessRecord.java

    frameworks/base/core/java/android/app/
      - IActivityManager.java
      - ActivityManagerNative.java (内含AMP)
      - ActivityManager.java

      - IApplicationThread.java
      - ApplicationThreadNative.java (内含ATP)
      - ActivityThread.java (内含ApplicationThread)

      - ContextImpl.java

## 一. 概述

`startActivity`的整体流程与[startService启动过程分析](http://gityuan.com/2016/03/06/start-service/)非常相近，但比Service启动更为复杂，多了stack/task以及UI的相关内容以及Activity的生命周期更为丰富。

Activity启动发起后，通过Binder最终交由system进程中的AMS来完成，则启动流程如下图：

![start_activity](/images/activity/start_activity.jpg)

接下来，从源码来说说每个过程。

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
        //创建新的Intent对象，即便intent被修改也不受影响
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

        ... //权限检查

        // ActivityController不为空的情况，比如monkey测试过程
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

当发送5秒超时或者执行`AMS.resumeAppSwitches()`过程会将mAppSwitchesAllowedTime设置0, 都会开启允许app执行切换的操作.另外,禁止App切换的操作,对于同一个app是不受影响的,有兴趣可以进一步查看`checkComponentPermission`过程.

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
                ...
            }
        }
    }

`mPendingActivityLaunches`记录着所有将要启动的Activity, 是由于在`startActivityLocked`的过程时App切换功能被禁止, 也就是不运行切换Activity, 那么此时便会把相应的Activity加入到`mPendingActivityLaunches`队列. 该队列的成员在执行完`doPendingActivityLaunchesLocked`便会清空.

启动mPendingActivityLaunches中所有的Activity, 由于doResume = false, 那么这些activtity并不会进入resume状态,而是设置delayedResume = true, 会延迟resume.

### 2.9 ASS.startActivityUncheckedLocked
[-> ActivityStackSupervisor.java]

    // sourceRecord是指调用者， r是指本次将要启动的Activity
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

        if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) != 0) {
            if (launchTaskBehind
                    || r.info.documentLaunchMode == ActivityInfo.DOCUMENT_LAUNCH_ALWAYS) {
                launchFlags |= Intent.FLAG_ACTIVITY_MULTIPLE_TASK;
            }
        }

        mUserLeaving = (launchFlags & Intent.FLAG_ACTIVITY_NO_USER_ACTION) == 0;
        //当本次不需要resume，则设置为延迟resume的状态
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
                //调用者 与将要启动的Activity不相同时，进入该分支。
                startFlags &= ~ActivityManager.START_FLAG_ONLY_IF_NEEDED;
            }
        }

        boolean addingToTask = false;
        TaskRecord reuseTask = null;

        //当调用者不是来自activity，而是明确指定task的情况。
        if (sourceRecord == null && inTask != null && inTask.stack != null) {
            ... //目前sourceRecord不为空，则不进入该分支
        } else {
            inTask = null;
        }

        if (inTask == null) {
            if (sourceRecord == null) {
                //调用者并不是Activity context,则强制创建新task
                if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0 && inTask == null) {
                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
                }
            } else if (sourceRecord.launchMode == ActivityInfo.LAUNCH_SINGLE_INSTANCE) {
                //调用者activity带有single instance，则创建新task
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            } else if (launchSingleInstance || launchSingleTask) {
                //目标activity带有single instance或者single task，则创建新task
                launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
            }
        }

        ActivityInfo newTaskInfo = null;
        Intent newTaskIntent = null;
        ActivityStack sourceStack;
        if (sourceRecord != null) {
            if (sourceRecord.finishing) {
                //调用者处于即将finish状态，则创建新task
                if ((launchFlags & Intent.FLAG_ACTIVITY_NEW_TASK) == 0) {
                    launchFlags |= Intent.FLAG_ACTIVITY_NEW_TASK;
                    newTaskInfo = sourceRecord.info;
                    newTaskIntent = sourceRecord.task.intent;
                }
                sourceRecord = null;
                sourceStack = null;
            } else {
                //当调用者Activity不为空，且不处于finishing状态，则其所在栈赋于sourceStack
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
                //从mActivityDisplays开始查询是否有相应ActivityRecord
                ActivityRecord intentActivity = !launchSingleInstance ?
                        findTaskLocked(r) : findActivityLocked(intent, r.info);
                if (intentActivity != null) {
                    if (isLockTaskModeViolation(intentActivity.task,
                            (launchFlags & (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))
                            == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_CLEAR_TASK))) {
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
                            //将该task移至前台
                            targetStack.moveTaskToFrontLocked(intentActivity.task, noAnimation,
                                    options, r.appTimeTracker, "bringingFoundTaskToFront");
                            movedToFront = true;
                            if ((launchFlags &
                                    (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME))
                                    == (FLAG_ACTIVITY_NEW_TASK | FLAG_ACTIVITY_TASK_ON_HOME)) {
                                //将toReturnTo设置为home
                                intentActivity.task.setTaskToReturnTo(HOME_ACTIVITY_TYPE);
                            }
                            options = null;
                        }
                    }
                    if (!movedToFront) {
                        targetStack.moveToFront("intentActivityFound");
                    }

                    if ((launchFlags&Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                        //重置目标task
                        intentActivity = targetStack.resetTaskIfNeededLocked(intentActivity, r);
                    }
                    if ((startFlags & ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
                        if (doResume) {
                            resumeTopActivitiesLocked(targetStack, null, options);
                            //当没有启动至前台，则通知Keyguard
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
                        //移除所有跟已存在的task有关联的activity
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
                            //触发onNewIntent()
                            top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                        } else {
                            sourceRecord = intentActivity;
                            TaskRecord task = sourceRecord.task;
                            if (task != null && task.stack == null) {
                                targetStack = computeStackFocus(sourceRecord, false /* newTask */);
                                targetStack.addTask(
                                        task, !launchTaskBehind /* toTop */, false /* moving */);
                            }

                        }
                    } else if (r.realActivity.equals(intentActivity.task.realActivity)) {
                        if (((launchFlags&Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0 || launchSingleTop)
                                && intentActivity.realActivity.equals(r.realActivity)) {
                            if (intentActivity.frontOfTask) {
                                intentActivity.task.setIntent(r);
                            }
                            //触发onNewIntent()
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
            //当启动的activity跟前台显示是同一个的情况
            ActivityStack topStack = mFocusedStack;
            ActivityRecord top = topStack.topRunningNonDelayedActivityLocked(notTop);
            if (top != null && r.resultTo == null) {
                if (top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                    if (top.app != null && top.app.thread != null) {
                        if ((launchFlags & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0
                            || launchSingleTop || launchSingleTask) {
                            topStack.mLastPausedActivity = null;
                            if (doResume) {
                                resumeTopActivitiesLocked();
                            }
                            ActivityOptions.abort(options);
                            if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
                            }
                            //触发onNewIntent()
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
                    //触发onNewIntent()
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
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
                    top.updateOptionsLocked(options);
                    //触发onNewIntent()
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
                return ActivityManager.START_RETURN_LOCK_TASK_MODE_VIOLATION;
            }
            targetStack = inTask.stack;
            targetStack.moveTaskToFrontLocked(inTask, noAnimation, options, r.appTimeTracker,
                    "inTaskToFront");

            ActivityRecord top = inTask.getTopActivity();
            if (top != null && top.realActivity.equals(r.realActivity) && top.userId == r.userId) {
                if ((launchFlags & Intent.FLAG_ACTIVITY_SINGLE_TOP) != 0
                        || launchSingleTop || launchSingleTask) {
                    if ((startFlags&ActivityManager.START_FLAG_ONLY_IF_NEEDED) != 0) {
                        return ActivityManager.START_RETURN_INTENT_TO_CALLER;
                    }
                    //触发onNewIntent()
                    top.deliverNewIntentLocked(callingUid, r.intent, r.launchedFromPackage);
                    return ActivityManager.START_DELIVERED_TO_TOP;
                }
            }

            if (!addingToTask) {
                ActivityOptions.abort(options);
                return ActivityManager.START_TASK_TO_FRONT;
            }

            r.setTask(inTask, null);

        } else {
            targetStack = computeStackFocus(r, newTask);
            targetStack.moveToFront("addingToTopTask");
            ActivityRecord prev = targetStack.topActivity();
            r.setTask(prev != null ? prev.task : targetStack.createTaskRecord(getNextTaskId(),
                            r.info, intent, null, null, true), null);
            mWindowManager.moveTaskToTop(r.task.taskId);
        }

        mService.grantUriPermissionFromIntentLocked(callingUid, r.packageName,
                intent, r.getUriPermissionsLocked(), r.userId);

        if (sourceRecord != null && sourceRecord.isRecentsActivity()) {
            r.task.setTaskToReturnTo(RECENTS_ACTIVITY_TYPE);
        }

        targetStack.mLastPausedActivity = null;
        //创建activity [见流程2.10]
        targetStack.startActivityLocked(r, newTask, doResume, keepCurTransition, options);
        if (!launchTaskBehind) {
            mService.setFocusedActivityLocked(r, "startedActivity");
        }
        return ActivityManager.START_SUCCESS;
    }

找到或创建新的Activit所属于的Task对象，之后调用AS.startActivityLocked

#### 2.9.1 Launch Mode
简单说说ActivityInfo.java中定义了4类Launch Mode：

- LAUNCH_MULTIPLE(standard)：每次启动新Activity，都会创建新的Activity，这是最常见标准情形；
- LAUNCH_SINGLE_TOP: 当启动新Acitity，在栈顶存在相同Activity，则不会创建新Activity；其余情况同上；
- LAUNCH_SINGLE_TASK：当启动新Acitity，在栈中存在相同Activity(可以是不在栈顶)，则不会创建新Activity，而是移除该Activity之上的所有Activity；其余情况同上；
- LAUNCH_SINGLE_INSTANCE：每个Task栈只有一个Activity，其余情况同上。

再来说说几个常见的flag含义：

- FLAG_ACTIVITY_NEW_TASK：将Activity放入一个新启动的Task；
- FLAG_ACTIVITY_CLEAR_TASK：启动Activity时，将目标Activity关联的Task清除，再启动新Task，将该Activity放入该Task。该flags跟FLAG_ACTIVITY_NEW_TASK配合使用。
- FLAG_ACTIVITY_CLEAR_TOP：启动非栈顶Activity时，先清除该Activity之上的Activity。例如Task已有A、B、C3个Activity，启动A，则清除B，C。类似于SingleTop。

### 2.10 AS.startActivityLocked
[-> ActivityStack.java]

    final void startActivityLocked(ActivityRecord r, boolean newTask,
            boolean doResume, boolean keepCurTransition, Bundle options) {
        TaskRecord rTask = r.task;
        final int taskId = rTask.taskId;
        if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
            //task中的上一个activity已被移除，或者ams重用该task,则将该task移到顶部
            insertTaskAtTop(rTask, r);
            mWindowManager.moveTaskToTop(taskId);
        }
        TaskRecord task = null;
        if (!newTask) {
            boolean startIt = true;
            for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
                task = mTaskHistory.get(taskNdx);
                if (task.getTopActivity() == null) {
                    //该task所有activity都finishing
                    continue;
                }
                if (task == r.task) {
                    if (!startIt) {
                        task.addActivityToTop(r);
                        r.putInHistory();
                        mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                                r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                                (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0,
                                r.userId, r.info.configChanges, task.voiceSession != null,
                                r.mLaunchTaskBehind);
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
        }

        task = r.task;
        task.addActivityToTop(r);
        task.setFrontOfTask();

        r.putInHistory();
        mActivityTrigger.activityStartTrigger(r.intent, r.info, r.appInfo);
        if (!isHomeStack() || numActivities() > 0) {
            //当切换到新的task，或者下一个activity进程目前并没有运行，则
            boolean showStartingIcon = newTask;
            ProcessRecord proc = r.app;
            if (proc == null) {
                proc = mService.mProcessNames.get(r.processName, r.info.applicationInfo.uid);
            }

            if (proc == null || proc.thread == null) {
                showStartingIcon = true;
            }
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
                    //当前activity所属不同的task
                    if (prev.task != r.task) {
                        prev = null;
                    }
                    //当前activity已经displayed
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

### 2.12 AS.resumeTopActivityLocked

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
        ... //系统没有进入booting或booted状态，则不允许启动Activity

        ActivityRecord parent = mActivityContainer.mParentActivity;
        if ((parent != null && parent.state != ActivityState.RESUMED) ||
                !mActivityContainer.isAttachedLocked()) {
            return false;
        }
        //top running之后的任意处于初始化状态且有显示StartingWindow, 则移除StartingWindow
        cancelInitializingActivities();

        //找到第一个没有finishing的栈顶activity
        final ActivityRecord next = topRunningActivityLocked(null);

        final boolean userLeaving = mStackSupervisor.mUserLeaving;
        mStackSupervisor.mUserLeaving = false;

        final TaskRecord prevTask = prev != null ? prev.task : null;
        if (next == null) {
            final String reason = "noMoreActivities";
            if (!mFullscreen) {
                //当该栈没有全屏，则尝试聚焦到下一个可见的stack
                final ActivityStack stack = getNextVisibleStackLocked();
                if (adjustFocusToNextVisibleStackLocked(stack, reason)) {
                    return mStackSupervisor.resumeTopActivitiesLocked(stack, prev, null);
                }
            }
            ActivityOptions.abort(options);
            final int returnTaskType = prevTask == null || !prevTask.isOverHomeStack() ?
                    HOME_ACTIVITY_TYPE : prevTask.getTaskToReturnTo();
            //启动home桌面activity
            return isOnHomeDisplay() &&
                    mStackSupervisor.resumeHomeStackTask(returnTaskType, prev, reason);
        }

        next.delayedResume = false;

        if (mResumedActivity == next && next.state == ActivityState.RESUMED &&
                    mStackSupervisor.allResumedActivitiesComplete()) {
            mWindowManager.executeAppTransition();
            mNoAnimActivities.clear();
            ActivityOptions.abort(options);
            return false;
        }

        final TaskRecord nextTask = next.task;
        if (prevTask != null && prevTask.stack == this &&
                prevTask.isOverHomeStack() && prev.finishing && prev.frontOfTask) {
            if (prevTask == nextTask) {
                prevTask.setFrontOfTask();
            } else if (prevTask != topTask()) {
                final int taskNdx = mTaskHistory.indexOf(prevTask) + 1;
                mTaskHistory.get(taskNdx).setTaskToReturnTo(HOME_ACTIVITY_TYPE);
            } else if (!isOnHomeDisplay()) {
                return false;
            } else if (!isHomeStack()){
                final int returnTaskType = prevTask == null || !prevTask.isOverHomeStack() ?
                        HOME_ACTIVITY_TYPE : prevTask.getTaskToReturnTo();
                return isOnHomeDisplay() &&
                        mStackSupervisor.resumeHomeStackTask(returnTaskType, prev, "prevFinished");
            }
        }

        //处于睡眠或者关机状态，top activity已暂停的情况下
        if (mService.isSleepingOrShuttingDown()
                && mLastPausedActivity == next
                && mStackSupervisor.allPausedActivitiesComplete()) {
            mWindowManager.executeAppTransition();
            mNoAnimActivities.clear();
            ActivityOptions.abort(options);
            return false;
        }

        if (mService.mStartedUsers.get(next.userId) == null) {
            return false; //拥有该activity的用户没有启动则直接返回
        }

        mStackSupervisor.mStoppingActivities.remove(next);
        mStackSupervisor.mGoingToSleepActivities.remove(next);
        next.sleeping = false;
        mStackSupervisor.mWaitingVisibleActivities.remove(next);

        mActivityTrigger.activityResumeTrigger(next.intent, next.info, next.appInfo);

        if (!mStackSupervisor.allPausedActivitiesComplete()) {
            return false; //当正处于暂停activity，则直接返回
        }

        mStackSupervisor.setLaunchSource(next.info.applicationInfo.uid);

        //需要等待暂停当前activity完成，再resume top activity
        boolean dontWaitForPause = (next.info.flags&ActivityInfo.FLAG_RESUME_WHILE_PAUSING) != 0;
        //暂停其他Activity[见小节2.13.1]
        boolean pausing = mStackSupervisor.pauseBackStacks(userLeaving, true, dontWaitForPause);
        if (mResumedActivity != null) {
            //当前resumd状态activity不为空，则需要先暂停该Activity
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
            } else {
                if (prev.finishing) {
                    mWindowManager.setAppVisibility(prev.appToken, false);
                }
            }
        }

        AppGlobals.getPackageManager().setPackageStoppedState(
                next.packageName, false, next.userId);

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
        //进程已存在的情况
        if (next.app != null && next.app.thread != null) {
            //activity正在成为可见
            mWindowManager.setAppVisibility(next.appToken, true);

            next.startLaunchTickingLocked();

            ActivityRecord lastResumedActivity = lastStack == null ? null :lastStack.mResumedActivity;
            ActivityState lastState = next.state;

            mService.updateCpuStats();
            //设置Activity状态为resumed
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
                    mStackSupervisor.scheduleResumeTopActivities();
                }
                if (mStackSupervisor.reportResumedActivityLocked(next)) {
                    mNoAnimActivities.clear();
                    return true;
                }
                return false;
            }

            try {
                //分发所有pending结果.
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
                //触发onResume()
                next.app.thread.scheduleResumeActivity(next.appToken, next.app.repProcState,
                        mService.isNextTransitionForward(), resumeAnimOptions);

                mStackSupervisor.checkReadyForSleepLocked();

            } catch (Exception e) {
                ...
                return true;
            }
            next.visible = true;
            completeResumeLocked(next);
            next.stopped = false;

        } else {
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
            mStackSupervisor.startSpecificActivityLocked(next, true, true);
        }
        return true;
    }

主要分支功能：

- 当找不到需要resume的Activity，则直接回到桌面；
- 否则，当mResumedActivity不为空，则执行startPausingLocked()暂停该activity;
- 然后再进入startSpecificActivityLocked环节，接下来从这里继续往下说。

#### 2.13.1 ASS.pauseBackStacks

    boolean pauseBackStacks(boolean userLeaving, boolean resuming, boolean dontWait) {
        boolean someActivityPaused = false;
        for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
            ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
            for (int stackNdx = stacks.size() - 1; stackNdx >= 0; --stackNdx) {
                final ActivityStack stack = stacks.get(stackNdx);
                if (!isFrontStack(stack) && stack.mResumedActivity != null) {
                    //[见小节2.13.2]
                    someActivityPaused |= stack.startPausingLocked(userLeaving, false, resuming,
                            dontWait);
                }
            }
        }
        return someActivityPaused;
    }

暂停所有处于后台栈的所有Activity。

#### 2.13.2 AS.startPausingLocked

    final boolean startPausingLocked(boolean userLeaving, boolean uiSleeping, boolean resuming,
         boolean dontWait) {
      if (mPausingActivity != null) {
          if (!mService.isSleeping()) {
              completePauseLocked(false);
          }
      }
      ActivityRecord prev = mResumedActivity;
      ...

      if (mActivityContainer.mParentActivity == null) {
          //暂停所有子栈的Activity
          mStackSupervisor.pauseChildStacks(prev, userLeaving, uiSleeping, resuming, dontWait);
      }
      ...
      final ActivityRecord next = mStackSupervisor.topRunningActivityLocked();

      if (prev.app != null && prev.app.thread != null) {
          EventLog.writeEvent(EventLogTags.AM_PAUSE_ACTIVITY,
                  prev.userId, System.identityHashCode(prev),
                  prev.shortComponentName);
          mService.updateUsageStats(prev, false);
          //暂停目标Activity
          prev.app.thread.schedulePauseActivity(prev.appToken, prev.finishing,
                  userLeaving, prev.configChangeFlags, dontWait);
      }else {
          ...
      }

      if (!uiSleeping && !mService.isSleepingOrShuttingDown()) {
          mStackSupervisor.acquireLaunchWakelock(); //申请wakelock
      }

      if (mPausingActivity != null) {
          if (!uiSleeping) {
              prev.pauseKeyDispatchingLocked();
          }

          if (dontWait) {
              completePauseLocked(false);
              return false;
          } else {
              Message msg = mHandler.obtainMessage(PAUSE_TIMEOUT_MSG);
              msg.obj = prev;
              prev.pauseTime = SystemClock.uptimeMillis();
              //500ms后，执行暂停超时的消息
              mHandler.sendMessageDelayed(msg, PAUSE_TIMEOUT);
              return true;
          }

      } else {
          if (!resuming) { //调度暂停失败，则认为已暂停完成，开始执行resume操作
              mStackSupervisor.getFocusedStack().resumeTopActivityLocked(null);
          }
          return false;
      }

该方法中，下一步通过Binder调用，进入acitivity所在进程来执行schedulePauseActivity()操作。
接下来，对于dontWait=true则执行执行completePauseLocked，否则等待app通知或许500ms超时再执行该方法。

#### 3.13.3 completePauseLocked

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
                //真正的启动Activity【见流程2.17】
                realStartActivityLocked(r, app, andResume, checkConfig);
                return;
            } catch (RemoteException e) {
                Slog.w(TAG, "Exception when starting activity "
                        + r.intent.getComponent().flattenToShortString(), e);
            }

        }
        //当进程不存在则创建进程【见流程2.15】
        mService.startProcessLocked(r.processName, r.info.applicationInfo, true, 0,
                "activity", r.intent.getComponent(), false, false, true);
    }

### 2.15 AMS.startProcessLocked

在文章[理解Android进程启动之全过程](http://gityuan.com/2016/10/09/app-process-create-2/)中，详细介绍了AMS.startProcessLocked()整个过程，创建完新进程后会在新进程中调用`AMP.attachApplication
`，该方法经过binder ipc后调用到`AMS.attachApplicationLocked`。

    private final boolean attachApplicationLocked(IApplicationThread thread,
            int pid) {
        ...
        ////只有当系统启动完，或者app允许启动过程允许，则会true
        boolean normalMode = mProcessesReady || isAllowedWhileBooting(app.info);
        thread.bindApplication(...);

        if (normalMode) {
            //【见流程2.16】
            if (mStackSupervisor.attachApplicationLocked(app)) {
                didSomething = true;
            }
        }
        ...
    }

在执行完bindApplication()之后进入ASS.attachApplicationLocked()

### 2.16 ASS.attachApplicationLocked

    boolean attachApplicationLocked(ProcessRecord app) throws RemoteException {
        final String processName = app.processName;
        boolean didSomething = false;
        for (int displayNdx = mActivityDisplays.size() - 1; displayNdx >= 0; --displayNdx) {
            ArrayList<ActivityStack> stacks = mActivityDisplays.valueAt(displayNdx).mStacks;
            for (int stackNdx = stacks.size() - 1; stackNdx >= 0; --stackNdx) {
                final ActivityStack stack = stacks.get(stackNdx);
                if (!isFrontStack(stack)) {
                    continue;
                }
                //获取前台stack中栈顶第一个非finishing的Activity
                ActivityRecord hr = stack.topRunningActivityLocked(null);
                if (hr != null) {
                    if (hr.app == null && app.uid == hr.info.applicationInfo.uid
                            && processName.equals(hr.processName)) {
                        try {
                            //真正的启动Activity【见流程2.17】
                            if (realStartActivityLocked(hr, app, true, true)) {
                                didSomething = true;
                            }
                        } catch (RemoteException e) {
                            throw e;
                        }
                    }
                }
            }
        }
        if (!didSomething) {
            //启动Activity不成功，则确保有可见的Activity
            ensureActivitiesVisibleLocked(null, 0);
        }
        return didSomething;
    }

### 2.17 ASS.realStartActivityLocked

    final boolean realStartActivityLocked(ActivityRecord r,
            ProcessRecord app, boolean andResume, boolean checkConfig)
            throws RemoteException {

        if (andResume) {
            r.startFreezingScreenLocked(app, 0);
            mWindowManager.setAppVisibility(r.appToken, true);
            //调度启动ticks用以收集应用启动慢的信息
            r.startLaunchTickingLocked();
        }

        if (checkConfig) {
            Configuration config = mWindowManager.updateOrientationFromAppTokens(
                    mService.mConfiguration,
                    r.mayFreezeScreenLocked(app) ? r.appToken : null);
            //更新Configuration
            mService.updateConfigurationLocked(config, r, false, false);
        }

        r.app = app;
        app.waitingToKill = null;
        r.launchCount++;
        r.lastLaunchTime = SystemClock.uptimeMillis();

        int idx = app.activities.indexOf(r);
        if (idx < 0) {
            app.activities.add(r);
        }
        mService.updateLruProcessLocked(app, true, null);
        mService.updateOomAdjLocked();

        final TaskRecord task = r.task;
        if (task.mLockTaskAuth == LOCK_TASK_AUTH_LAUNCHABLE ||
                task.mLockTaskAuth == LOCK_TASK_AUTH_LAUNCHABLE_PRIV) {
            setLockTaskModeLocked(task, LOCK_TASK_MODE_LOCKED, "mLockTaskAuth==LAUNCHABLE", false);
        }

        final ActivityStack stack = task.stack;
        try {
            if (app.thread == null) {
                throw new RemoteException();
            }
            List<ResultInfo> results = null;
            List<ReferrerIntent> newIntents = null;
            if (andResume) {
                results = r.results;
                newIntents = r.newIntents;
            }
            if (r.isHomeActivity() && r.isNotResolverActivity()) {
                //home进程是该栈的根进程
                mService.mHomeProcess = task.mActivities.get(0).app;
            }
            mService.ensurePackageDexOpt(r.intent.getComponent().getPackageName());
            ...

            if (andResume) {
                app.hasShownUi = true;
                app.pendingUiClean = true;
            }
            //将该进程设置为前台进程PROCESS_STATE_TOP
            app.forceProcessStateUpTo(mService.mTopProcessState);
            //【见流程2.18】
            app.thread.scheduleLaunchActivity(new Intent(r.intent), r.appToken,
                    System.identityHashCode(r), r.info, new Configuration(mService.mConfiguration),
                    new Configuration(stack.mOverrideConfig), r.compat, r.launchedFromPackage,
                    task.voiceInteractor, app.repProcState, r.icicle, r.persistentState, results,
                    newIntents, !andResume, mService.isNextTransitionForward(), profilerInfo);

            if ((app.info.privateFlags&ApplicationInfo.PRIVATE_FLAG_CANT_SAVE_STATE) != 0) {
                ... //处理heavy-weight进程
            }

        } catch (RemoteException e) {
            if (r.launchFailed) {
                //第二次启动失败，则结束该activity
                mService.appDiedLocked(app);
                stack.requestFinishActivityLocked(r.appToken, Activity.RESULT_CANCELED, null,
                        "2nd-crash", false);
                return false;
            }
            //这是第一个启动失败，则重启进程
            app.activities.remove(r);
            throw e;
        }

        //将该进程加入到mLRUActivities队列顶部
        stack.updateLRUListLocked(r)；

        if (andResume) {
            //启动过程的一部分
            stack.minimalResumeActivityLocked(r);
        } else {
            r.state = STOPPED;
            r.stopped = true;
        }

        if (isFrontStack(stack)) {
            //当系统发生更新时，只会执行一次的用户向导
            mService.startSetupActivityLocked();
        }
        //更新所有与该Activity具有绑定关系的Service连接
        mService.mServices.updateServiceConnectionActivitiesLocked(r.app);

        return true;
    }

### 2.18 ATP.scheduleLaunchActivity
[-> ApplicationThreadProxy.java]

    public final void scheduleLaunchActivity(Intent intent, IBinder token, int ident,
             ActivityInfo info, Configuration curConfig, Configuration overrideConfig,
             CompatibilityInfo compatInfo, String referrer, IVoiceInteractor voiceInteractor,
             int procState, Bundle state, PersistableBundle persistentState,
             List<ResultInfo> pendingResults, List<ReferrerIntent> pendingNewIntents,
             boolean notResumed, boolean isForward, ProfilerInfo profilerInfo) throws RemoteException {
         Parcel data = Parcel.obtain();
         data.writeInterfaceToken(IApplicationThread.descriptor);
         intent.writeToParcel(data, 0);
         data.writeStrongBinder(token);
         data.writeInt(ident);
         info.writeToParcel(data, 0);
         curConfig.writeToParcel(data, 0);
         if (overrideConfig != null) {
             data.writeInt(1);
             overrideConfig.writeToParcel(data, 0);
         } else {
             data.writeInt(0);
         }
         compatInfo.writeToParcel(data, 0);
         data.writeString(referrer);
         data.writeStrongBinder(voiceInteractor != null ? voiceInteractor.asBinder() : null);
         data.writeInt(procState);
         data.writeBundle(state);
         data.writePersistableBundle(persistentState);
         data.writeTypedList(pendingResults);
         data.writeTypedList(pendingNewIntents);
         data.writeInt(notResumed ? 1 : 0);
         data.writeInt(isForward ? 1 : 0);
         if (profilerInfo != null) {
             data.writeInt(1);
             profilerInfo.writeToParcel(data, Parcelable.PARCELABLE_WRITE_RETURN_VALUE);
         } else {
             data.writeInt(0);
         }
         //【见流程2.19】
         mRemote.transact(SCHEDULE_LAUNCH_ACTIVITY_TRANSACTION, data, null,
                 IBinder.FLAG_ONEWAY);
         data.recycle();
     }

### 2.19 ATN.onTransact
[-> ApplicationThreadNative.java]

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
                throws RemoteException {
        switch (code) {
        case SCHEDULE_LAUNCH_ACTIVITY_TRANSACTION:
        {
            data.enforceInterface(IApplicationThread.descriptor);
            Intent intent = Intent.CREATOR.createFromParcel(data);
            IBinder b = data.readStrongBinder();
            int ident = data.readInt();
            ActivityInfo info = ActivityInfo.CREATOR.createFromParcel(data);
            Configuration curConfig = Configuration.CREATOR.createFromParcel(data);
            Configuration overrideConfig = null;
            if (data.readInt() != 0) {
                overrideConfig = Configuration.CREATOR.createFromParcel(data);
            }
            CompatibilityInfo compatInfo = CompatibilityInfo.CREATOR.createFromParcel(data);
            String referrer = data.readString();
            IVoiceInteractor voiceInteractor = IVoiceInteractor.Stub.asInterface(
                    data.readStrongBinder());
            int procState = data.readInt();
            Bundle state = data.readBundle();
            PersistableBundle persistentState = data.readPersistableBundle();
            List<ResultInfo> ri = data.createTypedArrayList(ResultInfo.CREATOR);
            List<ReferrerIntent> pi = data.createTypedArrayList(ReferrerIntent.CREATOR);
            boolean notResumed = data.readInt() != 0;
            boolean isForward = data.readInt() != 0;
            ProfilerInfo profilerInfo = data.readInt() != 0
                    ? ProfilerInfo.CREATOR.createFromParcel(data) : null;
            //【见流程2.20】
            scheduleLaunchActivity(intent, b, ident, info, curConfig, overrideConfig, compatInfo,
                    referrer, voiceInteractor, procState, state, persistentState, ri, pi,
                    notResumed, isForward, profilerInfo);
            return true;
        }
        ...
        }
    }

### 2.20 AT.scheduleLaunchActivity
[-> ApplicationThread.java]

    public final void scheduleLaunchActivity(Intent intent, IBinder token, int ident,
             ActivityInfo info, Configuration curConfig, Configuration overrideConfig,
             CompatibilityInfo compatInfo, String referrer, IVoiceInteractor voiceInteractor,
             int procState, Bundle state, PersistableBundle persistentState,
             List<ResultInfo> pendingResults, List<ReferrerIntent> pendingNewIntents,
             boolean notResumed, boolean isForward, ProfilerInfo profilerInfo) {

         updateProcessState(procState, false);

         ActivityClientRecord r = new ActivityClientRecord();

         r.token = token;
         r.ident = ident;
         r.intent = intent;
         r.referrer = referrer;
         r.voiceInteractor = voiceInteractor;
         r.activityInfo = info;
         r.compatInfo = compatInfo;
         r.state = state;
         r.persistentState = persistentState;

         r.pendingResults = pendingResults;
         r.pendingIntents = pendingNewIntents;

         r.startsNotResumed = notResumed;
         r.isForward = isForward;

         r.profilerInfo = profilerInfo;

         r.overrideConfig = overrideConfig;
         updatePendingConfiguration(curConfig);
         //【见流程2.21】
         sendMessage(H.LAUNCH_ACTIVITY, r);
     }

### 2.21 H.handleMessage
[-> ActivityThread.java ::H]

    public void handleMessage(Message msg) {
        switch (msg.what) {
            case LAUNCH_ACTIVITY: {
                final ActivityClientRecord r = (ActivityClientRecord) msg.obj;
                r.packageInfo = getPackageInfoNoCheck(
                        r.activityInfo.applicationInfo, r.compatInfo);
                //【见流程2.22】
                handleLaunchActivity(r, null);
            } break;
            ...
        }
    }

### 2.22 ActivityThread.handleLaunchActivity
[-> ActivityThread.java]

    private void handleLaunchActivity(ActivityClientRecord r, Intent customIntent) {
        unscheduleGcIdler();
        mSomeActivitiesChanged = true;

        //最终回调目标Activity的onConfigurationChanged()
        handleConfigurationChanged(null, null);
        //初始化wms
        WindowManagerGlobal.initialize();
        //最终回调目标Activity的onCreate[见流程2.23]
        Activity a = performLaunchActivity(r, customIntent);
        if (a != null) {
            r.createdConfig = new Configuration(mConfiguration);
            Bundle oldState = r.state;
            //最终回调目标Activity的onStart,onResume.
            handleResumeActivity(r.token, false, r.isForward,
                    !r.activity.mFinished && !r.startsNotResumed);

            if (!r.activity.mFinished && r.startsNotResumed) {
                r.activity.mCalled = false;
                mInstrumentation.callActivityOnPause(r.activity);
                r.paused = true;
            }
        } else {
            //存在error则停止该Activity
            ActivityManagerNative.getDefault()
                .finishActivity(r.token, Activity.RESULT_CANCELED, null, false);
        }
    }

### 2.23 ActivityThread.performLaunchActivity
[-> ActivityThread.java]

    private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {

        ActivityInfo aInfo = r.activityInfo;
        if (r.packageInfo == null) {
            r.packageInfo = getPackageInfo(aInfo.applicationInfo, r.compatInfo,
                    Context.CONTEXT_INCLUDE_CODE);
        }

        ComponentName component = r.intent.getComponent();
        if (component == null) {
            component = r.intent.resolveActivity(
                mInitialApplication.getPackageManager());
            r.intent.setComponent(component);
        }

        if (r.activityInfo.targetActivity != null) {
            component = new ComponentName(r.activityInfo.packageName,
                    r.activityInfo.targetActivity);
        }

        Activity activity = null;
        try {
            java.lang.ClassLoader cl = r.packageInfo.getClassLoader();
            activity = mInstrumentation.newActivity(
                    cl, component.getClassName(), r.intent);
            StrictMode.incrementExpectedActivityCount(activity.getClass());
            r.intent.setExtrasClassLoader(cl);
            r.intent.prepareToEnterProcess();
            if (r.state != null) {
                r.state.setClassLoader(cl);
            }
        } catch (Exception e) {
            ...
        }

        try {
            //创建Application对象
            Application app = r.packageInfo.makeApplication(false, mInstrumentation);

            if (activity != null) {
                Context appContext = createBaseContextForActivity(r, activity);
                CharSequence title = r.activityInfo.loadLabel(appContext.getPackageManager());
                Configuration config = new Configuration(mCompatConfiguration);

                activity.attach(appContext, this, getInstrumentation(), r.token,
                        r.ident, app, r.intent, r.activityInfo, title, r.parent,
                        r.embeddedID, r.lastNonConfigurationInstances, config,
                        r.referrer, r.voiceInteractor);

                if (customIntent != null) {
                    activity.mIntent = customIntent;
                }
                r.lastNonConfigurationInstances = null;
                activity.mStartedActivity = false;
                int theme = r.activityInfo.getThemeResource();
                if (theme != 0) {
                    activity.setTheme(theme);
                }

                activity.mCalled = false;
                if (r.isPersistable()) {
                    mInstrumentation.callActivityOnCreate(activity, r.state, r.persistentState);
                } else {
                    mInstrumentation.callActivityOnCreate(activity, r.state);
                }
                ...
                r.activity = activity;
                r.stopped = true;
                if (!r.activity.mFinished) {
                    activity.performStart();
                    r.stopped = false;
                }
                if (!r.activity.mFinished) {
                    if (r.isPersistable()) {
                        if (r.state != null || r.persistentState != null) {
                            mInstrumentation.callActivityOnRestoreInstanceState(activity, r.state,
                                    r.persistentState);
                        }
                    } else if (r.state != null) {
                        mInstrumentation.callActivityOnRestoreInstanceState(activity, r.state);
                    }
                }
                if (!r.activity.mFinished) {
                    activity.mCalled = false;
                    if (r.isPersistable()) {
                        mInstrumentation.callActivityOnPostCreate(activity, r.state,
                                r.persistentState);
                    } else {
                        mInstrumentation.callActivityOnPostCreate(activity, r.state);
                    }
                    ...
                }
            }
            r.paused = true;

            mActivities.put(r.token, r);

        }  catch (Exception e) {
            ...
        }

        return activity;
    }

到此，正式进入了Activity的onCreate, onStart, onResume这些生命周期的过程。

## 三. 总结

本文详细startActivity的整个启动流程，

- 流程[**2.1 ~2.4**]:运行在调用者所在进程，比如从桌面启动Activity，则调用者所在进程为launcher进程，launcher进程利用ActivityManagerProxy作为Binder Client，进入system_server进程(AMS相应的Server端)。
- 流程[**2.5 ~2.18**]:运行在system_server系统进程，整个过程最为复杂、核心的过程，下面其中部分步骤：
  - 流程[2.7]：会调用到resolveActivity()，借助PackageManager来查询系统中所有符合要求的Activity，当存在多个满足条件的Activity则会弹框让用户来选择;
  - 流程[2.8]：创建ActivityRecord对象，并检查是否运行App切换，然后再处理mPendingActivityLaunches中的activity;
  - 流程[2.9]：为Activity找到或创建新的Task对象，设置flags信息；
  - 流程[2.13]：当没有处于非finishing状态的Activity，则直接回到桌面；
否则，当mResumedActivity不为空则执行`startPausingLocked`()暂停该activity;然后再进入`startSpecificActivityLocked`()环节;
  - 流程[2.14]：当目标进程已存在则直接进入流程[2.17]，当进程不存在则创建进程，经过层层调用还是会进入流程[2.17];
  - 流程[2.17]：system_server进程利用的ATP(Binder Client)，经过Binder，程序接下来进入目标进程。
- 流程[**2.19 ~2.18**]:运行在目标进程，通过Handler消息机制，该进程中的Binder线程向主线程发送`H.LAUNCH_ACTIVITY`，最终会通过反射创建目标Activity，然后进入onCreate()生命周期。

从另一个角度下图来概括：

![start_activity_process](/images/activity/start_activity_process.jpg)


启动流程：

1. 点击桌面App图标，Launcher进程采用Binder IPC向system_server进程发起startActivity请求；
2. system_server进程接收到请求后，向zygote进程发送创建进程的请求；
3. Zygote进程fork出新的子进程，即App进程；
4. App进程，通过Binder IPC向sytem_server进程发起attachApplication请求；
5. system_server进程在收到请求后，进行一系列准备工作后，再通过binder IPC向App进程发送scheduleLaunchActivity请求；
6. App进程的binder线程（ApplicationThread）在收到请求后，通过handler向主线程发送LAUNCH_ACTIVITY消息；
7. 主线程在收到Message后，通过发射机制创建目标Activity，并回调Activity.onCreate()等方法。

到此，App便正式启动，开始进入Activity生命周期，执行完onCreate/onStart/onResume方法，UI渲染结束后便可以看到App的主界面。
启动Activity较为复杂，后续计划再进一步讲解生命周期过程与系统是如何交互，以及UI渲染过程，敬请期待。
