---
layout: post
title:  "Android Broadcast广播机制分析"
date:   2016-06-04 17:32:50
catalog:  true
tags:
    - android
    - 组件

---

> 基于Android 6.0的源码剖析， 分析android广播的发送与接收流程。

### 一、概述

广播(Broadcast)机制用于进程/线程间通信，广播分为广播发送和广播接收两个过程，其中广播接收者BroadcastReceiver便是Android四大组件之一。

BroadcastReceiver分为两类：

- 静态广播接收者：通过AndroidManifest.xml的<receiver>标签来申明的BroadcastReceiver。
- 动态广播接收者：通过AMS.registerReceiver()方式注册的BroadcastReceiver，动态注册更为灵活，可在不需要时通过unregisterReceiver()取消注册。

从广播发送方式可分为三类：

- 普通广播：通过Context.sendBroadcast()发送，可并行处理
- 有序广播：通过Context.sendOrderedBroadcast()发送，串行处理
- Sticky广播：通过Context.sendStickyBroadcast()发送

### 二、注册广播

#### 2.1 registerReceiver

广播注册，对于应用开发来说，往往是在Activity/Service中调用`registerReceiver()`方法，而Activity/Service都间接继承于Context抽象类，真正干活是交给ContextImpl类。另外调用getOuterContext()可获取最外层的调用者Activity/Service。

[ContextImpl.java]

    @Override
    public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter) {
        return registerReceiver(receiver, filter, null, null);
    }

    @Override
    public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter,
            String broadcastPermission, Handler scheduler) {
        //【见小节2.2】
        return registerReceiverInternal(receiver, getUserId(),
                filter, broadcastPermission, scheduler, getOuterContext());
    }

当执行两参数的`registerReceiver`方法，增加两个broadcastPermission=null和scheduler=null调用四参数的注册方法。其中broadcastPermission拥有广播的权限控制，scheduler用于指定接收到广播时onRecive执行线程，当scheduler=null则默认代表在主线程中执行，这也是最常见的用法。 再然后调用6参数的`registerReceiverInternal`。

#### 2.2 registerReceiverInternal

[ContextImpl.java]

    private Intent registerReceiverInternal(BroadcastReceiver receiver, int userId,
            IntentFilter filter, String broadcastPermission,
            Handler scheduler, Context context) {
        IIntentReceiver rd = null;
        if (receiver != null) {
            if (mPackageInfo != null && context != null) {
                if (scheduler == null) {
                    //将主线程Handler赋予scheuler
                    scheduler = mMainThread.getHandler();
                }
                //获取IIntentReceiver对象【2.3】
                rd = mPackageInfo.getReceiverDispatcher(
                    receiver, context, scheduler,
                    mMainThread.getInstrumentation(), true);
            } else {
                if (scheduler == null) {
                    scheduler = mMainThread.getHandler();
                }
                rd = new LoadedApk.ReceiverDispatcher(
                      receiver, context, scheduler, null, true).getIIntentReceiver();
            }
        }
        try {
            //调用AMP.registerReceiver 【2.4】
            return ActivityManagerNative.getDefault().registerReceiver(
                    mMainThread.getApplicationThread(), mBasePackageName,
                    rd, filter, broadcastPermission, userId);
        } catch (RemoteException e) {
            return null;
        }
    }

ActivityManagerNative.getDefault()返回的是ActivityManagerProxy对象，简称AMP，该方法中参数有mMainThread.getApplicationThread()返回的是ApplicationThread，这是Binder的Bn端，用于system_server进程与该进程的通信。

#### 2.3 LoadedApk.getReceiverDispatcher

[-> LoadedApk.java]

    public IIntentReceiver getReceiverDispatcher(BroadcastReceiver r,
            Context context, Handler handler,
            Instrumentation instrumentation, boolean registered) {
        synchronized (mReceivers) {
            LoadedApk.ReceiverDispatcher rd = null;
            ArrayMap<BroadcastReceiver, LoadedApk.ReceiverDispatcher> map = null;
            //此处registered=true，则进入该分支
            if (registered) {
                map = mReceivers.get(context);
                if (map != null) {
                    rd = map.get(r);
                }
            }

            if (rd == null) {
                //当广播分发者为空，则创建ReceiverDispatcher【2.3.1】
                rd = new ReceiverDispatcher(r, context, handler,
                        instrumentation, registered);
                if (registered) {
                    if (map == null) {
                        map = new ArrayMap<BroadcastReceiver, LoadedApk.ReceiverDispatcher>();
                        mReceivers.put(context, map);
                    }
                    map.put(r, rd);
                }
            } else {
                //验证广播分发者的context、handler是否一致
                rd.validate(context, handler);
            }
            rd.mForgotten = false;
            //获取IIntentReceiver对象
            return rd.getIIntentReceiver();
        }
    }

不妨令 以BroadcastReceiver(广播接收者)为key，LoadedApk.ReceiverDispatcher(分发者)为value的ArrayMap 记为`A`。此处`mReceivers`是一个以`Context`为key，以`A`为value的ArrayMap。对于ReceiverDispatcher(广播分发者)，当不存在时则创建一个。

**2.3.1 创建ReceiverDispatcher**

    ReceiverDispatcher(BroadcastReceiver receiver, Context context,
            Handler activityThread, Instrumentation instrumentation,
            boolean registered) {
        //创建InnerReceiver【2.3.2】
        mIIntentReceiver = new InnerReceiver(this, !registered);
        mReceiver = receiver;
        mContext = context;
        mActivityThread = activityThread;
        mInstrumentation = instrumentation;
        mRegistered = registered;
        mLocation = new IntentReceiverLeaked(null);
        mLocation.fillInStackTrace();
    }

**2.3.2 创建InnerReceiver**

    final static class InnerReceiver extends IIntentReceiver.Stub {
        final WeakReference<LoadedApk.ReceiverDispatcher> mDispatcher;
        final LoadedApk.ReceiverDispatcher mStrongRef;

        InnerReceiver(LoadedApk.ReceiverDispatcher rd, boolean strong) {
            mDispatcher = new WeakReference<LoadedApk.ReceiverDispatcher>(rd);
            mStrongRef = strong ? rd : null;
        }
        ...
    }

ReceiverDispatcher(广播分发者)有一个内部类`InnerReceiver`，该类继承于`IIntentReceiver.Stub`。显然，这是一个Binder服务端，广播分发者通过rd.getIIntentReceiver()可获取该Binder服务端对象`InnerReceiver`，用于Binder IPC通信。

#### 2.4 AMP.registerReceiver

[-> ActivityManagerNative.java]

    public Intent registerReceiver(IApplicationThread caller, String packageName,
            IIntentReceiver receiver,
            IntentFilter filter, String perm, int userId) throws RemoteException
    {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(caller != null ? caller.asBinder() : null);
        data.writeString(packageName);
        data.writeStrongBinder(receiver != null ? receiver.asBinder() : null);
        filter.writeToParcel(data, 0);
        data.writeString(perm);
        data.writeInt(userId);

        //Command为REGISTER_RECEIVER_TRANSACTION
        mRemote.transact(REGISTER_RECEIVER_TRANSACTION, data, reply, 0);
        reply.readException();
        Intent intent = null;
        int haveIntent = reply.readInt();
        if (haveIntent != 0) {
            intent = Intent.CREATOR.createFromParcel(reply);
        }
        reply.recycle();
        data.recycle();
        return intent;
    }

这里有两个Binder服务端对象`caller`和`receiver`，AMP通过Binder驱动将这些信息发送给system_server进程中的AMS对象，接下来进入AMS.registerReceiver。

#### 2.5 AMS.registerReceiver

[-> ActivityManagerService.java]

    public Intent registerReceiver(IApplicationThread caller, String callerPackage,
            IIntentReceiver receiver, IntentFilter filter, String permission, int userId) {
        //孤立进程不允许注册广播接收者
        enforceNotIsolatedCaller("registerReceiver");
        ArrayList<Intent> stickyIntents = null;
        ProcessRecord callerApp = null;
        int callingUid;
        int callingPid;
        synchronized(this) {
            if (caller != null) {
                //从mLruProcesses队列中查找调用者的ProcessRecord 【见2.5.1】
                callerApp = getRecordForAppLocked(caller);
                //查询不到目标进程，则抛出异常
                if (callerApp == null) {
                    throw new SecurityException("");
                }
                //非系统进程且包名不等于“android”，同时调用者进程不包括该包名时抛异常
                if (callerApp.info.uid != Process.SYSTEM_UID &&
                        !callerApp.pkgList.containsKey(callerPackage) &&
                        !"android".equals(callerPackage)) {
                    throw new SecurityException("");
                }
                callingUid = callerApp.info.uid;
                callingPid = callerApp.pid;
            } else {
                callerPackage = null;
                callingUid = Binder.getCallingUid();
                callingPid = Binder.getCallingPid();
            }

            userId = handleIncomingUser(callingPid, callingUid, userId,
                    true, ALLOW_FULL_ONLY, "registerReceiver", callerPackage);

            //获取IntentFilter中的actions
            Iterator<String> actions = filter.actionsIterator();
            if (actions == null) {
                ArrayList<String> noAction = new ArrayList<String>(1);
                noAction.add(null);
                actions = noAction.iterator();
            }

            int[] userIds = { UserHandle.USER_ALL, UserHandle.getUserId(callingUid) };
            while (actions.hasNext()) {
                String action = actions.next();
                for (int id : userIds) {
                    //从mStickyBroadcasts中查看用户的sticky Intent
                    ArrayMap<String, ArrayList<Intent>> stickies = mStickyBroadcasts.get(id);
                    if (stickies != null) {
                        ArrayList<Intent> intents = stickies.get(action);
                        if (intents != null) {
                            if (stickyIntents == null) {
                                stickyIntents = new ArrayList<Intent>();
                            }
                            //将sticky Intent加入到队列
                            stickyIntents.addAll(intents);
                        }
                    }
                }
            }
        }

        ArrayList<Intent> allSticky = null;
        if (stickyIntents != null) {
            final ContentResolver resolver = mContext.getContentResolver();
            for (int i = 0, N = stickyIntents.size(); i < N; i++) {
                Intent intent = stickyIntents.get(i);
                //查询匹配的sticky广播 【见2.5.2】
                if (filter.match(resolver, intent, true, TAG) >= 0) {
                    if (allSticky == null) {
                        allSticky = new ArrayList<Intent>();
                    }
                    //匹配成功，则将给intent添加到allSticky队列
                    allSticky.add(intent);
                }
            }
        }

        //当IIntentReceiver为空，则直接返回第一个sticky Intent，
        Intent sticky = allSticky != null ? allSticky.get(0) : null;
        if (receiver == null) {
            return sticky;
        }

        synchronized (this) {
            if (callerApp != null && (callerApp.thread == null
                    || callerApp.thread.asBinder() != caller.asBinder())) {
                //调用者已经死亡
                return null;
            }
            ReceiverList rl = mRegisteredReceivers.get(receiver.asBinder());
            if (rl == null) {
                //对于没有注册的广播，则创建接收者队列
                rl = new ReceiverList(this, callerApp, callingPid, callingUid,
                        userId, receiver);
                if (rl.app != null) {
                    rl.app.receivers.add(rl);
                } else {
                    try {
                        //注册死亡通知
                        receiver.asBinder().linkToDeath(rl, 0);
                    } catch (RemoteException e) {
                        return sticky;
                    }
                    rl.linkedToDeath = true;
                }
                //新创建的接收者队列，添加到已注册广播队列。
                mRegisteredReceivers.put(receiver.asBinder(), rl);
            }
            ...
            //创建BroadcastFilter对象，并添加到接收者队列
            BroadcastFilter bf = new BroadcastFilter(filter, rl, callerPackage,
                    permission, callingUid, userId);
            rl.add(bf);
            //新创建的广播过滤者，添加到ReceiverResolver队列
            mReceiverResolver.addFilter(bf);

            //所有匹配该filter的sticky广播执行入队操作
            //如果没有使用sendStickyBroadcast，则allSticky=null。
            if (allSticky != null) {
                ArrayList receivers = new ArrayList();
                receivers.add(bf);

                final int stickyCount = allSticky.size();
                for (int i = 0; i < stickyCount; i++) {
                    Intent intent = allSticky.get(i);
                    //当intent为前台广播，则返回mFgBroadcastQueue
                    //当intent为后台广播，则返回mBgBroadcastQueue
                    BroadcastQueue queue = broadcastQueueForIntent(intent);
                    //创建BroadcastRecord
                    BroadcastRecord r = new BroadcastRecord(queue, intent, null,
                            null, -1, -1, null, null, AppOpsManager.OP_NONE, null, receivers,
                            null, 0, null, null, false, true, true, -1);
                    //该广播加入到并行广播队列
                    queue.enqueueParallelBroadcastLocked(r);
                    //调度广播，发送BROADCAST_INTENT_MSG消息，触发处理下一个广播。
                    queue.scheduleBroadcastsLocked();
                }
            }
            return sticky;
        }
    }

其中`mRegisteredReceivers`记录着所有已注册的广播，以receiver IBinder为key, ReceiverList为value为HashMap。另外，这个过程涉及对象`ReceiverList`，`BroadcastFilter`，`BroadcastRecord`的创建。

在BroadcastQueue中有两个广播队列`mParallelBroadcasts`,`mOrderedBroadcasts`，数据类型都为ArrayList<BroadcastRecord>：

- `mParallelBroadcasts`:并行广播队列，可以立刻执行，而无需等待另一个广播运行完成，该队列只允许动态已注册的广播，从而避免发生同时拉起大量进程来执行广播，前台的和后台的广播分别位于独立的队列。
- `mOrderedBroadcasts`：有序广播队列，同一时间只允许执行一个广播，该队列顶部的广播便是活动广播，其他广播必须等待该广播结束才能运行，也是独立区别前台的和后台的广播。

##### 2.5.1 AMS.getRecordForAppLocked

    final ProcessRecord getRecordForAppLocked(
            IApplicationThread thread) {
        if (thread == null) {
            return null;
        }
        //从mLruProcesses队列中查看
        int appIndex = getLRURecordIndexForAppLocked(thread);
        return appIndex >= 0 ? mLruProcesses.get(appIndex) : null;
    }

mLruProcesses数据类型为`ArrayList<ProcessRecord>`，而ProcessRecord对象有一个IApplicationThread字段，根据该字段查找出满足条件的ProcessRecord对象。

##### 2.5.2 IntentFilter.match

    public final int match(ContentResolver resolver, Intent intent,
            boolean resolve, String logTag) {
        String type = resolve ? intent.resolveType(resolver) : intent.getType();
        return match(intent.getAction(), type, intent.getScheme(),
                     intent.getData(), intent.getCategories(), logTag);
    }

    public final int match(String action, String type, String scheme,
            Uri data, Set<String> categories, String logTag) {
        //不存在匹配的action
        if (action != null && !matchAction(action)) {
            return NO_MATCH_ACTION;
        }

        //不存在匹配的type或data
        int dataMatch = matchData(type, scheme, data);
        if (dataMatch < 0) {
            return dataMatch;
        }

        //不存在匹配的category
        String categoryMismatch = matchCategories(categories);
        if (categoryMismatch != null) {
            return NO_MATCH_CATEGORY;
        }
        return dataMatch;
    }

该方法用于匹配发起的Intent数据是否匹配成功，匹配项共有4项action, type, data, category，任何一项匹配不成功都会失败。


##### 小结

注册广播的过程，主要功能：

- 创建ReceiverList(接收者队列)，并添加到AMS.mRegisteredReceivers(已注册广播队列)；
- 创建BroadcastFilter(广播过滤者)，并添加到AMS.mReceiverResolver(接收者的解析人)；
- 当注册的是Sticky广播，则创建BroadcastRecord，并添加到BroadcastQueue的mParallelBroadcasts(并行广播队列)，注册后调用AMS来尽快处理该广播。


### 三、 发送广播

发送广播，同样往往是在Activity/Service中调用`registerReceiver()`方法，而Activity/Service都间接继承于Context抽象类，真正干活是交给ContextImpl类。

#### 3.1 sendBroadcast

[ContextImpl.java]

    @Override
    public void sendBroadcast(Intent intent) {
        warnIfCallingFromSystemProcess();
        String resolvedType = intent.resolveTypeIfNeeded(getContentResolver());
        try {
            intent.prepareToLeaveProcess();
            // 调用AMP.broadcastIntent  【见3.2】
            ActivityManagerNative.getDefault().broadcastIntent(
                    mMainThread.getApplicationThread(), intent, resolvedType, null,
                    Activity.RESULT_OK, null, null, null, AppOpsManager.OP_NONE, null, false, false,
                    getUserId());
        } catch (RemoteException e) {
            throw new RuntimeException("Failure from system", e);
        }
    }

#### 3.2 AMP.broadcastIntent

[-> ActivityManagerNative.java]

    public int broadcastIntent(IApplicationThread caller,
            Intent intent, String resolvedType, IIntentReceiver resultTo,
            int resultCode, String resultData, Bundle map,
            String[] requiredPermissions, int appOp, Bundle options, boolean serialized,
            boolean sticky, int userId) throws RemoteException
    {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(caller != null ? caller.asBinder() : null);
        intent.writeToParcel(data, 0);
        data.writeString(resolvedType);
        data.writeStrongBinder(resultTo != null ? resultTo.asBinder() : null);
        data.writeInt(resultCode);
        data.writeString(resultData);
        data.writeBundle(map);
        data.writeStringArray(requiredPermissions);
        data.writeInt(appOp);
        data.writeBundle(options);
        data.writeInt(serialized ? 1 : 0);
        data.writeInt(sticky ? 1 : 0);
        data.writeInt(userId);

        //Command为BROADCAST_INTENT_TRANSACTION
        mRemote.transact(BROADCAST_INTENT_TRANSACTION, data, reply, 0);
        reply.readException();
        int res = reply.readInt();
        reply.recycle();
        data.recycle();
        return res;
    }

#### 3.3 AMS.broadcastIntent

[-> ActivityManagerService.java]

    public final int broadcastIntent(IApplicationThread caller,
            Intent intent, String resolvedType, IIntentReceiver resultTo,
            int resultCode, String resultData, Bundle resultExtras,
            String[] requiredPermissions, int appOp, Bundle options,
            boolean serialized, boolean sticky, int userId) {
        enforceNotIsolatedCaller("broadcastIntent");
        synchronized(this) {
            //验证广播intent是否有效
            intent = verifyBroadcastLocked(intent);
            //获取调用者进程记录对象
            final ProcessRecord callerApp = getRecordForAppLocked(caller);
            final int callingPid = Binder.getCallingPid();
            final int callingUid = Binder.getCallingUid();
            final long origId = Binder.clearCallingIdentity();
            //【见小节3.4】
            int res = broadcastIntentLocked(callerApp,
                    callerApp != null ? callerApp.info.packageName : null,
                    intent, resolvedType, resultTo, resultCode, resultData, resultExtras,
                    requiredPermissions, appOp, null, serialized, sticky,
                    callingPid, callingUid, userId);
            Binder.restoreCallingIdentity(origId);
            return res;
        }
    }

broadcastIntent()方法有两个布尔参数serialized和sticky来共同决定是普通广播，有序广播，还是Sticky广播，参数如下：

|类型|serialized|sticky|
|---|---|
|sendBroadcast|false|false|
|sendOrderedBroadcast|true|false|
|sendStickyBroadcast|false|true|

#### 3.4 AMS.broadcastIntentLocked

    private final int broadcastIntentLocked(ProcessRecord callerApp,
            String callerPackage, Intent intent, String resolvedType,
            IIntentReceiver resultTo, int resultCode, String resultData,
            Bundle resultExtras, String[] requiredPermissions, int appOp, Bundle options,
            boolean ordered, boolean sticky, int callingPid, int callingUid, int userId) {

        //step1: 设置flag
        //step2: 广播权限验证
        //step3: 处理系统相关广播
        //step4: 增加sticky广播
        //step5: 查询receivers和registeredReceivers
        //step6: 处理并行广播
        //step7: 合并registeredReceivers到receivers
        //step8: 处理串行广播

        return ActivityManager.BROADCAST_SUCCESS;
    }

broadcastIntentLocked方法比较长，这里划分为8个部分来分别说明。

##### step1: 设置广播flag

        intent = new Intent(intent);
        //增加该flag，则广播不会发送给已停止的package
        intent.addFlags(Intent.FLAG_EXCLUDE_STOPPED_PACKAGES);

        //当没有启动完成时，不允许启动新进程
        if (!mProcessesReady && (intent.getFlags()&Intent.FLAG_RECEIVER_BOOT_UPGRADE) == 0) {
            intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY);
        }
        userId = handleIncomingUser(callingPid, callingUid, userId,
                true, ALLOW_NON_FULL, "broadcast", callerPackage);

        //检查发送广播时用户状态
        if (userId != UserHandle.USER_ALL && !isUserRunningLocked(userId, false)) {
            if ((callingUid != Process.SYSTEM_UID
                    || (intent.getFlags() & Intent.FLAG_RECEIVER_BOOT_UPGRADE) == 0)
                    && !Intent.ACTION_SHUTDOWN.equals(intent.getAction())) {
                return ActivityManager.BROADCAST_FAILED_USER_STOPPED;
            }
        }

这个过程最重要的工作是：

- 添加flag=`FLAG_EXCLUDE_STOPPED_PACKAGES`，保证已停止app不会收到该广播；
- 当系统还没有启动完成，则不允许启动新进程，，即只有动态注册receiver才能接受广播
- 当非USER_ALL广播且当前用户并没有处于Running的情况下，除非是系统升级广播或者关机广播，否则直接返回。

BroadcastReceiver还有其他flag，位于Intent.java常量:

    FLAG_RECEIVER_REGISTERED_ONLY //只允许已注册receiver接收广播
    FLAG_RECEIVER_REPLACE_PENDING //新广播会替代相同广播
    FLAG_RECEIVER_FOREGROUND //只允许前台receiver接收广播
    FLAG_RECEIVER_NO_ABORT //对于有序广播，先接收到的receiver无权抛弃广播
    FLAG_RECEIVER_REGISTERED_ONLY_BEFORE_BOOT //Boot完成之前，只允许已注册receiver接收广播
    FLAG_RECEIVER_BOOT_UPGRADE //升级模式下，允许系统准备就绪前可以发送广播


##### step2: 广播权限验证

        int callingAppId = UserHandle.getAppId(callingUid);
        if (callingAppId == Process.SYSTEM_UID || callingAppId == Process.PHONE_UID
            || callingAppId == Process.SHELL_UID || callingAppId == Process.BLUETOOTH_UID
            || callingAppId == Process.NFC_UID || callingUid == 0) {
            //直接通过
        } else if (callerApp == null || !callerApp.persistent) {
            try {
                if (AppGlobals.getPackageManager().isProtectedBroadcast(
                        intent.getAction())) {
                    //不允许发送给受保护的广播
                    throw new SecurityException(msg);
                } else if (AppWidgetManager.ACTION_APPWIDGET_CONFIGURE.equals(intent.getAction())) {
                    //这个case是出于兼容性考虑，限制只允许发送给自己。
                    ...
                }
            } catch (RemoteException e) {
                return ActivityManager.BROADCAST_SUCCESS;
            }
        }

主要功能：

- 对于callingAppId为SYSTEM_UID，PHONE_UID，SHELL_UID，BLUETOOTH_UID，NFC_UID之一或者callingUid == 0时都畅通无阻；
- 否则对于调用者进程为空并且不是persistent进程的情况下：
    - 当发送的是受保护广播`mProtectedBroadcasts`(只允许系统使用)，则抛出异常；
    - 当action为ACTION_APPWIDGET_CONFIGURE时，虽然不希望该应用发送这种广播，处于兼容性考虑，限制该广播只允许发送给自己，否则抛出异常。


##### step3: 处理系统相关广播

        final String action = intent.getAction();
        if (action != null) {
            switch (action) {
                case Intent.ACTION_UID_REMOVED:
                    mBatteryStatsService.removeUid(uid);
                    mAppOpsService.uidRemoved(uid);
                    break;
                case Intent.ACTION_EXTERNAL_APPLICATIONS_UNAVAILABLE:
                    String list[] = intent.getStringArrayExtra(Intent.EXTRA_CHANGED_PACKAGE_LIST);
                    if (list != null && list.length > 0) {
                        for (int i = 0; i < list.length; i++) {
                            forceStopPackageLocked(list[i], -1, false, true, true,
                                    false, false, userId, "storage unmount");
                        }
                        mRecentTasks.cleanupLocked(UserHandle.USER_ALL);
                        sendPackageBroadcastLocked(
                            IApplicationThread.EXTERNAL_STORAGE_UNAVAILABLE, list,userId);
                    }
                    break;
                case Intent.ACTION_EXTERNAL_APPLICATIONS_AVAILABLE
                    mRecentTasks.cleanupLocked(UserHandle.USER_ALL);
                    break;
                case Intent.ACTION_PACKAGE_REMOVED:
                case Intent.ACTION_PACKAGE_CHANGED:
                    Uri data = intent.getData();
                    boolean removed = Intent.ACTION_PACKAGE_REMOVED.equals(action);
                    boolean fullUninstall = removed && !intent.getBooleanExtra(Intent.EXTRA_REPLACING, false);
                    final boolean killProcess = !intent.getBooleanExtra(Intent.EXTRA_DONT_KILL_APP, false);
                    if (killProcess) {
                        forceStopPackageLocked(ssp, UserHandle.getAppId(
                                intent.getIntExtra(Intent.EXTRA_UID, -1)),
                                false, true, true, false, fullUninstall, userId,
                                removed ? "pkg removed" : "pkg changed");
                    }
                    if (removed) {
                        sendPackageBroadcastLocked(IApplicationThread.PACKAGE_REMOVED,new String[] {ssp}, userId);
                        if (fullUninstall) {
                            mAppOpsService.packageRemoved(intent.getIntExtra(Intent.EXTRA_UID, -1), ssp);
                            removeUriPermissionsForPackageLocked(ssp, userId, true);
                            removeTasksByPackageNameLocked(ssp, userId);
                            mBatteryStatsService.notePackageUninstalled(ssp);
                        }
                    } else {
                        cleanupDisabledPackageComponentsLocked(ssp, userId, killProcess,
                                intent.getStringArrayExtra(Intent.EXTRA_CHANGED_COMPONENT_NAME_LIST));
                    }
                    break;

                case Intent.ACTION_PACKAGE_ADDED:
                    Uri data = intent.getData();
                    final boolean replacing =intent.getBooleanExtra(Intent.EXTRA_REPLACING, false);
                    mCompatModePackages.handlePackageAddedLocked(ssp, replacing);
                    ApplicationInfo ai = AppGlobals.getPackageManager().getApplicationInfo(ssp, 0, 0);
                    break;
                case Intent.ACTION_TIMEZONE_CHANGED:
                    mHandler.sendEmptyMessage(UPDATE_TIME_ZONE);
                    break;
                case Intent.ACTION_TIME_CHANGED:
                    final int is24Hour = intent.getBooleanExtra(Intent.EXTRA_TIME_PREF_24_HOUR_FORMAT, false) ? 1: 0;
                    mHandler.sendMessage(mHandler.obtainMessage(UPDATE_TIME, is24Hour, 0));
                    BatteryStatsImpl stats = mBatteryStatsService.getActiveStatistics();
                    synchronized (stats) {
                        stats.noteCurrentTimeChangedLocked();
                    }
                    break;
                case Intent.ACTION_CLEAR_DNS_CACHE:
                    mHandler.sendEmptyMessage(CLEAR_DNS_CACHE_MSG);
                    break;
                case Proxy.PROXY_CHANGE_ACTION:
                    ProxyInfo proxy = intent.getParcelableExtra(Proxy.EXTRA_PROXY_INFO);
                    mHandler.sendMessage(mHandler.obtainMessage(UPDATE_HTTP_PROXY_MSG, proxy));
                    break;
            }
        }

这个过程代码较长，主要处于系统相关的广播，如下10个case：

        case Intent.ACTION_UID_REMOVED: //uid移除
        case Intent.ACTION_PACKAGE_REMOVED: //package移除，
        case Intent.ACTION_PACKAGE_CHANGED: //package改变
        case Intent.ACTION_EXTERNAL_APPLICATIONS_UNAVAILABLE: //外部设备不可用时，强制停止所有波及的应用并清空cache数据
        case Intent.ACTION_EXTERNAL_APPLICATIONS_AVAILABLE: //外部设备可用
        case Intent.ACTION_PACKAGE_ADDED: //增加package，处于兼容考虑

        case Intent.ACTION_TIMEZONE_CHANGED: //时区改变，通知所有运行中的进程
        case Intent.ACTION_TIME_CHANGED: //时间改变，通知所有运行中的进程
        case Intent.ACTION_CLEAR_DNS_CACHE: //dns缓存清空
        case Proxy.PROXY_CHANGE_ACTION: //网络代理改变

##### step4：增加sticky广播

        if (sticky) {
            if (checkPermission(android.Manifest.permission.BROADCAST_STICKY,
                    callingPid, callingUid)
                    != PackageManager.PERMISSION_GRANTED) {
                throw new SecurityException("");
            }
            if (requiredPermissions != null && requiredPermissions.length > 0) {
                return ActivityManager.BROADCAST_STICKY_CANT_HAVE_PERMISSION;
            }

            if (intent.getComponent() != null) {
               //当sticky广播发送给指定组件，则throw Exception
            }
            if (userId != UserHandle.USER_ALL) {
               //当非USER_ALL广播跟USER_ALL广播出现冲突,则throw Exception
            }

            ArrayMap<String, ArrayList<Intent>> stickies = mStickyBroadcasts.get(userId);
            if (stickies == null) {
                stickies = new ArrayMap<>();
                mStickyBroadcasts.put(userId, stickies);
            }
            ArrayList<Intent> list = stickies.get(intent.getAction());
            if (list == null) {
                list = new ArrayList<>();
                stickies.put(intent.getAction(), list);
            }
            final int stickiesCount = list.size();
            int i;
            for (i = 0; i < stickiesCount; i++) {
                if (intent.filterEquals(list.get(i))) {
                    //替换已存在的sticky intent
                    list.set(i, new Intent(intent));
                    break;
                }
            }
            //新的intent追加到list
            if (i >= stickiesCount) {
                list.add(new Intent(intent));
            }
        }

这个过程主要是将sticky广播增加到list，并放入mStickyBroadcasts里面。

##### step5：查询receivers和registeredReceivers

        int[] users;
        if (userId == UserHandle.USER_ALL) {
            users = mStartedUserArray; //广播给所有已启动用户
        } else {
            users = new int[] {userId}; //广播给指定用户
        }

        List receivers = null;
        List<BroadcastFilter> registeredReceivers = null;
        //找出所有能接收该广播的receivers
        if ((intent.getFlags()&Intent.FLAG_RECEIVER_REGISTERED_ONLY) == 0) {
            //根据intent查找相应的receivers
            receivers = collectReceiverComponents(intent, resolvedType, callingUid, users);
        }
        if (intent.getComponent() == null) {
            if (userId == UserHandle.USER_ALL && callingUid == Process.SHELL_UID) {
                UserManagerService ums = getUserManagerLocked();
                for (int i = 0; i < users.length; i++) {
                    //shell用户是否开启允许debug功能
                    if (ums.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES, users[i])) {
                        continue;
                    }
                    // 查询动态注册的广播
                    List<BroadcastFilter> registeredReceiversForUser =
                            mReceiverResolver.queryIntent(intent,
                                    resolvedType, false, users[i]);
                    if (registeredReceivers == null) {
                        registeredReceivers = registeredReceiversForUser;
                    } else if (registeredReceiversForUser != null) {
                        registeredReceivers.addAll(registeredReceiversForUser);
                    }
                }
            } else {
                // 查询动态注册的广播
                registeredReceivers = mReceiverResolver.queryIntent(intent,
                        resolvedType, false, userId);
            }
        }

- receivers：记录着匹配当前intent的所有静态注册广播接收者；
- registeredReceivers：记录着匹配当前的所有动态注册的广播接收者。

其中，`mReceiverResolver`是AMS的成员变量，记录着已注册的广播接收者的resolver.

**AMS.collectReceiverComponents**：

    private List<ResolveInfo> collectReceiverComponents(Intent intent, String resolvedType,
            int callingUid, int[] users) {
        List<ResolveInfo> receivers = null;
        for (int user : users) {
            //调用PKMS.queryIntentReceivers，可获取AndroidManifest.xml声明的接收者信息
            List<ResolveInfo> newReceivers = AppGlobals.getPackageManager()
                    .queryIntentReceivers(intent, resolvedType, STOCK_PM_FLAGS, user);
            if (receivers == null) {
                receivers = newReceivers;
            } else if (newReceivers != null) {
                ...
                //将所用户的receiver整合到receivers
            }
         }
        return receivers;
    }

##### step6：处理并行广播

        //用于标识是否需要用新intent替换旧的intent。
        final boolean replacePending = (intent.getFlags()&Intent.FLAG_RECEIVER_REPLACE_PENDING) != 0;
        //处理并行广播
        int NR = registeredReceivers != null ? registeredReceivers.size() : 0;
        if (!ordered && NR > 0) {
            final BroadcastQueue queue = broadcastQueueForIntent(intent);
            //创建BroadcastRecord对象
            BroadcastRecord r = new BroadcastRecord(queue, intent, callerApp,
                    callerPackage, callingPid, callingUid, resolvedType, requiredPermissions,
                    appOp, brOptions, registeredReceivers, resultTo, resultCode, resultData,
                    resultExtras, ordered, sticky, false, userId);

            final boolean replaced = replacePending && queue.replaceParallelBroadcastLocked(r);
            if (!replaced) {
                //将BroadcastRecord加入到并行广播队列
                queue.enqueueParallelBroadcastLocked(r);
                //处理广播【见小节4.1】
                queue.scheduleBroadcastsLocked();
            }
            registeredReceivers = null;
            NR = 0;
        }

广播队列中有一个成员变量`mParallelBroadcasts`，类型为ArrayList<BroadcastRecord>，记录着所有的并行广播。

##### step7：合并registeredReceivers到receivers

        int ir = 0;
        if (receivers != null) {
            //防止应用监听该广播，在安装时直接运行。
            String skipPackages[] = null;
            if (Intent.ACTION_PACKAGE_ADDED.equals(intent.getAction())
                    || Intent.ACTION_PACKAGE_RESTARTED.equals(intent.getAction())
                    || Intent.ACTION_PACKAGE_DATA_CLEARED.equals(intent.getAction())) {
                Uri data = intent.getData();
                if (data != null) {
                    String pkgName = data.getSchemeSpecificPart();
                    if (pkgName != null) {
                        skipPackages = new String[] { pkgName };
                    }
                }
            } else if (Intent.ACTION_EXTERNAL_APPLICATIONS_AVAILABLE.equals(intent.getAction())) {
                skipPackages = intent.getStringArrayExtra(Intent.EXTRA_CHANGED_PACKAGE_LIST);
            }

            //将skipPackages相关的广播接收者从receivers列表中移除
            if (skipPackages != null && (skipPackages.length > 0)) {
                for (String skipPackage : skipPackages) {
                    if (skipPackage != null) {
                        int NT = receivers.size();
                        for (int it=0; it<NT; it++) {
                            ResolveInfo curt = (ResolveInfo)receivers.get(it);
                            if (curt.activityInfo.packageName.equals(skipPackage)) {
                                receivers.remove(it);
                                it--;
                                NT--;
                            }
                        }
                    }
                }
            }

            //前面part6有一个处理动态广播的过程，处理完后再执行将动态注册的registeredReceivers合并到receivers
            int NT = receivers != null ? receivers.size() : 0;
            int it = 0;
            ResolveInfo curt = null;
            BroadcastFilter curr = null;
            while (it < NT && ir < NR) {
                if (curt == null) {
                    curt = (ResolveInfo)receivers.get(it);
                }
                if (curr == null) {
                    curr = registeredReceivers.get(ir);
                }
                if (curr.getPriority() >= curt.priority) {
                    receivers.add(it, curr);
                    ir++;
                    curr = null;
                    it++;
                    NT++;
                } else {
                    it++;
                    curt = null;
                }
            }
        }
        while (ir < NR) {
            if (receivers == null) {
                receivers = new ArrayList();
            }
            receivers.add(registeredReceivers.get(ir));
            ir++;
        }

##### step8: 处理串行广播

        if ((receivers != null && receivers.size() > 0)
                || resultTo != null) {
            BroadcastQueue queue = broadcastQueueForIntent(intent);
            //创建BroadcastRecord
            BroadcastRecord r = new BroadcastRecord(queue, intent, callerApp,
                    callerPackage, callingPid, callingUid, resolvedType,
                    requiredPermissions, appOp, brOptions, receivers, resultTo, resultCode,
                    resultData, resultExtras, ordered, sticky, false, userId);

            boolean replaced = replacePending && queue.replaceOrderedBroadcastLocked(r);
            if (!replaced) {
                //将BroadcastRecord加入到有序广播队列
                queue.enqueueOrderedBroadcastLocked(r);
                //处理广播【见小节4.1】
                queue.scheduleBroadcastsLocked();
            }
        }

广播队列中有一个成员变量`mOrderedBroadcasts`，类型为ArrayList<BroadcastRecord>，记录着所有的有序广播。


#### 3.5 小结

- 注册广播的小节[2.5]阶段, 会处理Sticky广播;
- 发送广播的[step 6]阶段, 会处理并行广播;
- 发送广播的[step 8]阶段, 会处理串行广播;

上述3个处理过程都是通过调用scheduleBroadcastsLocked()方法来完成的,接下来再来看看这个方法.

### 四、 处理广播

在发送广播过程中会执行`scheduleBroadcastsLocked`方法来处理相关的广播

#### 4.1 scheduleBroadcastsLocked

[-> BroadcastQueue.java]

    public void scheduleBroadcastsLocked() {
        // 正在处理BROADCAST_INTENT_MSG消息
        if (mBroadcastsScheduled) {
            return;
        }
        //发送BROADCAST_INTENT_MSG消息
        mHandler.sendMessage(mHandler.obtainMessage(BROADCAST_INTENT_MSG, this));
        mBroadcastsScheduled = true;
    }

在BroadcastQueue对象创建时，mHandler=new BroadcastHandler(handler.getLooper());那么此处交由mHandler的handleMessage来处理：

    private final class BroadcastHandler extends Handler {
        public BroadcastHandler(Looper looper) {
            super(looper, null, true);
        }

        @Override
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case BROADCAST_INTENT_MSG: {
                    processNextBroadcast(true); //【见小节4.2】
                } break;
                ...
        }
    }

#### 4.2 processNextBroadcast

[-> BroadcastQueue.java]

    final void processNextBroadcast(boolean fromMsg) {
        synchronized(mService) {
            //step1: 处理并行广播
            //step2: 处理当前有序广播
            //step3: 获取下条有序广播
            //step4: 处理下条有序广播
        }
    }

此处mService为AMS，整个流程还是比较长的，全程持有AMS锁，所以广播效率低的情况下，直接会严重影响这个手机的性能与流畅度，这里应该考虑细化同步锁的粒度。

##### step1: 处理并行广播

    BroadcastRecord r;
    mService.updateCpuStats(); //更新CPU统计信息
    if (fromMsg)  mBroadcastsScheduled = false;

    while (mParallelBroadcasts.size() > 0) {
        r = mParallelBroadcasts.remove(0);
        r.dispatchTime = SystemClock.uptimeMillis();
        r.dispatchClockTime = System.currentTimeMillis();
        final int N = r.receivers.size();
        for (int i=0; i<N; i++) {
            Object target = r.receivers.get(i);
            //分发广播给已注册的receiver 【见小节4.3】
            deliverToRegisteredReceiverLocked(r, (BroadcastFilter)target, false);
        }
        addBroadcastToHistoryLocked(r);//将广播添加历史统计
    }

##### step2: 处理当前有序广播

    if (mPendingBroadcast != null) {
        boolean isDead;
        synchronized (mService.mPidsSelfLocked) {
            //从mPidsSelfLocked获取正在处理该广播进程，判断该进程是否死亡
            ProcessRecord proc = mService.mPidsSelfLocked.get(mPendingBroadcast.curApp.pid);
            isDead = proc == null || proc.crashing;
        }
        if (!isDead) {
            //正在处理广播的进程保持活跃状态，则继续等待其执行完成
            return;
        } else {
            mPendingBroadcast.state = BroadcastRecord.IDLE;
            mPendingBroadcast.nextReceiver = mPendingBroadcastRecvIndex;
            mPendingBroadcast = null;
        }
    }

    boolean looped = false;
    do {
        if (mOrderedBroadcasts.size() == 0) {
            //所有串行广播处理完成，则调度执行gc
            mService.scheduleAppGcsLocked();
            if (looped) {
                mService.updateOomAdjLocked();
            }
            return;
        }
        r = mOrderedBroadcasts.get(0);
        boolean forceReceive = false;

        //获取所有该广播所有的接收者
        int numReceivers = (r.receivers != null) ? r.receivers.size() : 0;
        if (mService.mProcessesReady && r.dispatchTime > 0) {
            long now = SystemClock.uptimeMillis();
            if ((numReceivers > 0) &&
                    (now > r.dispatchTime + (2*mTimeoutPeriod*numReceivers))) {
                //当广播处理时间超时，则强制结束这条广播
                broadcastTimeoutLocked(false);
                forceReceive = true;
                r.state = BroadcastRecord.IDLE;
            }
        }

        if (r.state != BroadcastRecord.IDLE) {
            return;
        }

        if (r.receivers == null || r.nextReceiver >= numReceivers
                || r.resultAbort || forceReceive) {
            if (r.resultTo != null) {
                //处理广播消息消息，调用到onReceive()
                performReceiveLocked(r.callerApp, r.resultTo,
                    new Intent(r.intent), r.resultCode,
                    r.resultData, r.resultExtras, false, false, r.userId);
                r.resultTo = null;
            }
            //取消BROADCAST_TIMEOUT_MSG消息
            cancelBroadcastTimeoutLocked();

            addBroadcastToHistoryLocked(r);
            mOrderedBroadcasts.remove(0);
            r = null;
            looped = true;
            continue;
        }
    } while (r == null);

mTimeoutPeriod，对于前台广播则为10s，对于后台广播则为60s。广播超时为`2*mTimeoutPeriod*numReceivers`，接收者个数numReceivers越多则广播超时总时长越大。

##### step3: 获取下条有序广播

    //获取下一个receiver的index
    int recIdx = r.nextReceiver++;

    r.receiverTime = SystemClock.uptimeMillis();
    if (recIdx == 0) {
        r.dispatchTime = r.receiverTime;
        r.dispatchClockTime = System.currentTimeMillis();
    }
    if (!mPendingBroadcastTimeoutMessage) {
        long timeoutTime = r.receiverTime + mTimeoutPeriod;
        //设置广播超时时间，发送BROADCAST_TIMEOUT_MSG
        setBroadcastTimeoutLocked(timeoutTime);
    }

    final BroadcastOptions brOptions = r.options;
    //获取下一个广播接收者
    final Object nextReceiver = r.receivers.get(recIdx);

    if (nextReceiver instanceof BroadcastFilter) {
        //对于动态注册的广播接收者，deliverToRegisteredReceiverLocked处理广播
        BroadcastFilter filter = (BroadcastFilter)nextReceiver;
        deliverToRegisteredReceiverLocked(r, filter, r.ordered);
        if (r.receiver == null || !r.ordered) {
            r.state = BroadcastRecord.IDLE;
            scheduleBroadcastsLocked();
        } else {
            ...
        }
        return;
    }

    //对于静态注册的广播接收者
    ResolveInfo info = (ResolveInfo)nextReceiver;
    ComponentName component = new ComponentName(
            info.activityInfo.applicationInfo.packageName,
            info.activityInfo.name);
    ...
    //执行各种权限检测，此处省略，当权限不满足时skip=true

    if (skip) {
        r.receiver = null;
        r.curFilter = null;
        r.state = BroadcastRecord.IDLE;
        scheduleBroadcastsLocked();
        return;
    }

    r.state = BroadcastRecord.APP_RECEIVE;
    String targetProcess = info.activityInfo.processName;
    r.curComponent = component;
    final int receiverUid = info.activityInfo.applicationInfo.uid;
    if (r.callingUid != Process.SYSTEM_UID && isSingleton
            && mService.isValidSingletonCall(r.callingUid, receiverUid)) {
        info.activityInfo = mService.getActivityInfoForUser(info.activityInfo, 0);
    }
    r.curReceiver = info.activityInfo;
    ...

    //Broadcast正在执行中，stopped状态设置成false
    AppGlobals.getPackageManager().setPackageStoppedState(
            r.curComponent.getPackageName(), false, UserHandle.getUserId(r.callingUid));

##### step4: 处理下条有序广播

    //该receiver所对应的进程已经运行，则直接处理
    ProcessRecord app = mService.getProcessRecordLocked(targetProcess,
            info.activityInfo.applicationInfo.uid, false);
    if (app != null && app.thread != null) {
        try {
            app.addPackage(info.activityInfo.packageName,
                    info.activityInfo.applicationInfo.versionCode, mService.mProcessStats);
            processCurBroadcastLocked(r, app);
            return;
        } catch (RemoteException e) {
        } catch (RuntimeException e) {
            finishReceiverLocked(r, r.resultCode, r.resultData, r.resultExtras, r.resultAbort, false);
            scheduleBroadcastsLocked();
            r.state = BroadcastRecord.IDLE; //启动receiver失败则重置状态
            return;
        }
    }

    //该receiver所对应的进程尚未启动，则创建该进程
    if ((r.curApp=mService.startProcessLocked(targetProcess,
            info.activityInfo.applicationInfo, true,
            r.intent.getFlags() | Intent.FLAG_FROM_BACKGROUND,
            "broadcast", r.curComponent,
            (r.intent.getFlags()&Intent.FLAG_RECEIVER_BOOT_UPGRADE) != 0, false, false))
                    == null) {
        //创建失败，则结束该receiver
        finishReceiverLocked(r, r.resultCode, r.resultData,
                r.resultExtras, r.resultAbort, false);
        scheduleBroadcastsLocked();
        r.state = BroadcastRecord.IDLE;
        return;
    }
    mPendingBroadcast = r;
    mPendingBroadcastRecvIndex = recIdx;

- 如果是动态广播接收者，则调用deliverToRegisteredReceiverLocked处理；
- 如果是静态广播接收者，且对应进程已经创建，则调用processCurBroadcastLocked处理；
- 如果是静态广播接收者，且对应进程尚未创建，则调用startProcessLocked创建进程。

#### 4.3 deliverToRegisteredReceiverLocked

[-> BroadcastQueue.java]

    private void deliverToRegisteredReceiverLocked(BroadcastRecord r,
            BroadcastFilter filter, boolean ordered) {
        ...
        //检查发送者是否有BroadcastFilter所需权限
        //以及接收者是否有发送者所需的权限等等
        //当权限不满足要求，则skip=true。

        if (!skip) {
            //并行广播ordered = false，只有串行广播才进入该分支
            if (ordered) {
                r.receiver = filter.receiverList.receiver.asBinder();
                r.curFilter = filter;
                filter.receiverList.curBroadcast = r;
                r.state = BroadcastRecord.CALL_IN_RECEIVE;
                if (filter.receiverList.app != null) {
                    r.curApp = filter.receiverList.app;
                    filter.receiverList.app.curReceiver = r;
                    mService.updateOomAdjLocked(r.curApp);
                }
            }
            // 处理广播【见小节4.4】
            performReceiveLocked(filter.receiverList.app, filter.receiverList.receiver,
                    new Intent(r.intent), r.resultCode, r.resultData,
                    r.resultExtras, r.ordered, r.initialSticky, r.userId);
            if (ordered) {
                r.state = BroadcastRecord.CALL_DONE_RECEIVE;
            }
            ...
        }
    }

#### 4.4 performReceiveLocked

[-> BroadcastQueue.java]

    private static void performReceiveLocked(ProcessRecord app, IIntentReceiver receiver,
            Intent intent, int resultCode, String data, Bundle extras,
            boolean ordered, boolean sticky, int sendingUser) throws RemoteException {
        //通过binder异步机制，向receiver发送intent
        if (app != null) {
            if (app.thread != null) {
                //调用ApplicationThreadProxy类对应的方法 【4.5】
                app.thread.scheduleRegisteredReceiver(receiver, intent, resultCode,
                        data, extras, ordered, sticky, sendingUser, app.repProcState);
            } else {
                //应用进程死亡，则Recevier并不存在
                throw new RemoteException("app.thread must not be null");
            }
        } else {
            //调用者进程为空，则执行该分支
            receiver.performReceive(intent, resultCode, data, extras, ordered,
                    sticky, sendingUser);
        }
    }

#### 4.5 ATP.scheduleRegisteredReceiver

    public void scheduleRegisteredReceiver(IIntentReceiver receiver, Intent intent,
            int resultCode, String dataStr, Bundle extras, boolean ordered,
            boolean sticky, int sendingUser, int processState) throws RemoteException {
        Parcel data = Parcel.obtain();
        data.writeInterfaceToken(IApplicationThread.descriptor);
        data.writeStrongBinder(receiver.asBinder());
        intent.writeToParcel(data, 0);
        data.writeInt(resultCode);
        data.writeString(dataStr);
        data.writeBundle(extras);
        data.writeInt(ordered ? 1 : 0);
        data.writeInt(sticky ? 1 : 0);
        data.writeInt(sendingUser);
        data.writeInt(processState);

        //command=SCHEDULE_REGISTERED_RECEIVER_TRANSACTION
        mRemote.transact(SCHEDULE_REGISTERED_RECEIVER_TRANSACTION, data, null,
                IBinder.FLAG_ONEWAY);
        data.recycle();
    }

ATP位于system_server进程，是Binder Bp端通过Binder驱动向Binder Bn端发送消息, ATP所对应的Bn端位于发送广播调用端所在进程的ApplicationThread，即进入AT.scheduleRegisteredReceiver， 接下来说明该方法。

#### 4.6 AT.scheduleRegisteredReceiver

[-> ActivityThread.java]

    public void scheduleRegisteredReceiver(IIntentReceiver receiver, Intent intent,
            int resultCode, String dataStr, Bundle extras, boolean ordered,
            boolean sticky, int sendingUser, int processState) throws RemoteException {
        //更新虚拟机进程状态
        updateProcessState(processState, false);
        //【见小节4.7】
        receiver.performReceive(intent, resultCode, dataStr, extras, ordered,
                sticky, sendingUser);
    }

此处receiver是注册广播时创建的，见小节[2.3]，可知该`receiver`=`LoadedApk.ReceiverDispatcher.InnerReceiver`。

#### 4.7 InnerReceiver.performReceive

[-> LoadedApk.java]

    public void performReceive(Intent intent, int resultCode, String data,
            Bundle extras, boolean ordered, boolean sticky, int sendingUser) {
        LoadedApk.ReceiverDispatcher rd = mDispatcher.get();
        if (rd != null) {
            //【4.8】
            rd.performReceive(intent, resultCode, data, extras, ordered, sticky, sendingUser);
        } else {
           ...
        }
    }

#### 4.8 ReceiverDispatcher.performReceive

[-> LoadedApk.java]

    public void performReceive(Intent intent, int resultCode, String data,
            Bundle extras, boolean ordered, boolean sticky, int sendingUser) {
        Args args = new Args(intent, resultCode, data, extras, ordered,
                sticky, sendingUser);
        //通过handler消息机制发送args.
        if (!mActivityThread.post(args)) {
            if (mRegistered && ordered) {
                IActivityManager mgr = ActivityManagerNative.getDefault();
                args.sendFinished(mgr);
            }
        }
    }

其中`Args`继承于`BroadcastReceiver.PendingResult`，实现了接口`Runnable`。这里mActivityThread.post(args)
消息机制，关于Handler消息机制，见[Android消息机制1-Handler(Java层)](http://gityuan.com/2015/12/26/handler-message-framework/)，把消息放入MessageQueue，再调用Args的run()方法。


#### 4.9 Args.run

[-> LoadedApk.java]

    public final class LoadedApk {
      static final class ReceiverDispatcher {
        final class Args extends BroadcastReceiver.PendingResult implements Runnable {
            public void run() {
                final BroadcastReceiver receiver = mReceiver;
                final boolean ordered = mOrdered;

                final IActivityManager mgr = ActivityManagerNative.getDefault();
                final Intent intent = mCurIntent;
                mCurIntent = null;

                if (receiver == null || mForgotten) {
                    if (mRegistered && ordered) {
                        sendFinished(mgr);
                    }
                    return;
                }

                try {
                    //获取mReceiver的类加载器
                    ClassLoader cl =  mReceiver.getClass().getClassLoader();
                    intent.setExtrasClassLoader(cl);
                    setExtrasClassLoader(cl);
                    receiver.setPendingResult(this);
                    //回调广播onReceive方法
                    receiver.onReceive(mContext, intent);
                } catch (Exception e) {
                    ...
                }

                if (receiver.getPendingResult() != null) {
                    finish();
                }
            }
          }
        }

最终调用`BroadcastReceiver`具体实现类的`onReceive()`方法。

#### 4.10 PendingResult.finish

[-> BroadcastReceiver.java]

    public final void finish() {
        final IActivityManager mgr = ActivityManagerNative.getDefault();
        sendFinished(mgr);
        ...
    }

    public void sendFinished(IActivityManager am) {
        synchronized (this) {
            try {
                if (mResultExtras != null) {
                    mResultExtras.setAllowFds(false);
                }
                if (mOrderedHint) {
                    //串行广播
                    am.finishReceiver(mToken, mResultCode, mResultData, mResultExtras,
                            mAbortBroadcast, mFlags);
                } else {
                    //并行广播
                    am.finishReceiver(mToken, 0, null, null, false, mFlags);
                }
            } catch (RemoteException ex) {
            }
        }
    }

此处AMP.finishReceiver，经过binder调用，进入AMS.finishReceiver方法

#### 4.11 AMS.finishReceiver

    public void finishReceiver(IBinder who, int resultCode, String resultData,
            Bundle resultExtras, boolean resultAbort, int flags) {
        ...
        final long origId = Binder.clearCallingIdentity();
        try {
            boolean doNext = false;
            BroadcastRecord r;

            synchronized(this) {
                BroadcastQueue queue = (flags & Intent.FLAG_RECEIVER_FOREGROUND) != 0
                        ? mFgBroadcastQueue : mBgBroadcastQueue;
                r = queue.getMatchingOrderedReceiver(who);
                if (r != null) {
                    doNext = r.queue.finishReceiverLocked(r, resultCode,
                        resultData, resultExtras, resultAbort, true);
                }
            }

            if (doNext) {
                //处理下一条广播
                r.queue.processNextBroadcast(false);
            }
            trimApplications();
        } finally {
            Binder.restoreCallingIdentity(origId);
        }
    }

### 五、总结

未完留坑，后续总结以及增加流程图说明...

----------

### 附录

本文所涉及的源码：

    framework/base/core/java/android/content/BroadcastReceiver.java
    framework/base/core/java/android/content/Context.java
    framework/base/core/java/android/content/IntentFilter.java

    framework/base/core/java/android/app/ContextImpl.java
    framework/base/core/java/android/app/LoadedApk
    framework/base/core/java/android/app/ActivityManagerNative.java
    framework/base/core/java/android/app/ApplicationThreadNative.java
    framework/base/core/java/android/app/ActivityThread.java

    framework/base/services/core/java/com/android/server/ActivityManagerService.java
    framework/base/services/core/java/com/android/server/am/BroadcastQueue.java
    framework/base/services/core/java/com/android/server/am/BroadcastFilter.java
    framework/base/services/core/java/com/android/server/am/BroadcastRecord.java
    framework/base/services/core/java/com/android/server/am/ReceiverList.java
