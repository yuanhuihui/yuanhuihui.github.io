---
layout: post
title:  "Android Broadcast广播机制分析"
date:   2016-06-04 17:32:50
catalog:  true
tags:
    - android
    - 组件系列

---

> 基于Android 6.0的源码剖析， 分析android广播的发送与接收流程。

    framework/base/services/core/java/com/android/server/
      - ActivityManagerService.java
      - BroadcastQueue.java
      - BroadcastFilter.java
      - BroadcastRecord.java
      - ReceiverList.java
      - ProcessRecord.java

    framework/base/core/java/android/content/
      - BroadcastReceiver.java
      - IntentFilter.java

    framework/base/core/java/android/app/
      - ActivityManagerNative.java (内含AMP)
      - ActivityManager.java
      - ApplicationThreadNative.java (内含ATP)
      - ActivityThread.java (内含ApplicationThread)
      - ContextImpl.java
      - LoadedApk


## 一、概述

广播(Broadcast)机制用于进程/线程间通信，广播分为广播发送和广播接收两个过程，其中广播接收者BroadcastReceiver便是Android四大组件之一。

BroadcastReceiver分为两类：

- 静态广播接收者：通过AndroidManifest.xml的<receiver>标签来申明的BroadcastReceiver。
- 动态广播接收者：通过AMS.registerReceiver()方式注册的BroadcastReceiver，动态注册更为灵活，可在不需要时通过unregisterReceiver()取消注册。

从广播发送方式可分为三类：

- 普通广播：通过Context.sendBroadcast()发送，可并行处理
- 有序广播：通过Context.sendOrderedBroadcast()发送，串行处理
- Sticky广播：通过Context.sendStickyBroadcast()发送


#### 1.1 BroadcastRecord

广播在系统中以BroadcastRecord对象来记录, 该对象有几个时间相关的成员变量.

    final class BroadcastRecord extends Binder {
        final ProcessRecord callerApp; //广播发送者所在进程
        final String callerPackage; //广播发送者所在包名
        final List receivers;   // 包括动态注册的BroadcastFilter和静态注册的ResolveInfo

        final String callerPackage; //广播发送者
        final int callingPid;   // 广播发送者pid
        final List receivers;   // 广播接收者
        int nextReceiver;  // 下一个被执行的接收者
        IBinder receiver; // 当前正在处理的接收者
        int anrCount;   //广播ANR次数

        long enqueueClockTime;  //入队列时间
        long dispatchTime;      //分发时间
        long dispatchClockTime; //分发时间
        long receiverTime;      //接收时间(首次等于dispatchClockTime)
        long finishTime;        //广播完成时间

    }

- enqueueClockTime 伴随着 scheduleBroadcastsLocked
- dispatchClockTime伴随着 deliverToRegisteredReceiverLocked
- finishTime 位于 addBroadcastToHistoryLocked方法内

## 二、注册广播

广播注册，对于应用开发来说，往往是在Activity/Service中调用`registerReceiver()`方法，而Activity或Service都间接继承于Context抽象类，真正干活是交给ContextImpl类。另外调用getOuterContext()可获取最外层的调用者Activity或Service。

### 2.1 registerReceiver
[ContextImpl.java]

    public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter) {
        return registerReceiver(receiver, filter, null, null);
    }

    public Intent registerReceiver(BroadcastReceiver receiver, IntentFilter filter,
            String broadcastPermission, Handler scheduler) {
        return registerReceiverInternal(receiver, getUserId(),
                filter, broadcastPermission, scheduler, getOuterContext());
    }

其中broadcastPermission拥有广播的权限控制，scheduler用于指定接收到广播时onRecive执行线程，当scheduler=null则默认代表在主线程中执行，这也是最常见的用法

### 2.2 registerReceiverInternal
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

ActivityManagerNative.getDefault()返回的是ActivityManagerProxy对象，简称AMP.   
该方法中参数有mMainThread.getApplicationThread()返回的是ApplicationThread，这是Binder的Bn端，用于system_server进程与该进程的通信。

### 2.3 LoadedApk.getReceiverDispatcher

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

#### 2.3.1 创建ReceiverDispatcher

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

此处mActivityThread便是前面传递过来的当前主线程的Handler.

#### 2.3.2 创建InnerReceiver

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

### 2.4 AMP.registerReceiver

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

这里有两个Binder服务端对象`caller`和`receiver`，都代表执行注册广播动作所在的进程.
AMP通过Binder驱动将这些信息发送给system_server进程中的AMS对象，接下来进入AMS.registerReceiver。

### 2.5 AMS.registerReceiver

[-> ActivityManagerService.java]

```Java
public Intent registerReceiver(IApplicationThread caller, String callerPackage,
        IIntentReceiver receiver, IntentFilter filter, String permission, int userId) {
    ArrayList<Intent> stickyIntents = null;
    ProcessRecord callerApp = null;
    ...
    synchronized(this) {
        if (caller != null) {
            //从mLruProcesses查询调用者的进程信息【见2.5.1】
            callerApp = getRecordForAppLocked(caller);
            ...
            callingUid = callerApp.info.uid;
            callingPid = callerApp.pid;
        } else {
            callerPackage = null;
            callingUid = Binder.getCallingUid();
            callingPid = Binder.getCallingPid();
        }

        userId = handleIncomingUser(callingPid, callingUid, userId,
                true, ALLOW_FULL_ONLY, "registerReceiver", callerPackage);

        //获取IntentFilter中的actions. 这就是平时所加需要监听的广播action
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
            return null; //调用者已经死亡
        }
        ReceiverList rl = mRegisteredReceivers.get(receiver.asBinder());
        if (rl == null) {
            //对于没有注册的广播，则创建接收者队列
            rl = new ReceiverList(this, callerApp, callingPid, callingUid,
                    userId, receiver);
            if (rl.app != null) {
                rl.app.receivers.add(rl);
            } else {
                receiver.asBinder().linkToDeath(rl, 0); //注册死亡通知
                ...
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
                //根据intent返回前台或后台广播队列【见2.5.3】
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
```

其中`mRegisteredReceivers`记录着所有已注册的广播，以receiver IBinder为key, ReceiverList为value为HashMap。

在BroadcastQueue中有两个广播队列mParallelBroadcasts,mOrderedBroadcasts，数据类型都为ArrayList<BroadcastRecord>：

- `mParallelBroadcasts`:并行广播队列，可以立刻执行，而无需等待另一个广播运行完成，该队列只允许动态已注册的广播，从而避免发生同时拉起大量进程来执行广播，前台的和后台的广播分别位于独立的队列。
- `mOrderedBroadcasts`：有序广播队列，同一时间只允许执行一个广播，该队列顶部的广播便是活动广播，其他广播必须等待该广播结束才能运行，也是独立区别前台的和后台的广播。

#### 2.5.1 AMS.getRecordForAppLocked

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

#### 2.5.2 IntentFilter.match

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

#### 2.5.3 AMS.broadcastQueueForIntent

    BroadcastQueue broadcastQueueForIntent(Intent intent) {
        final boolean isFg = (intent.getFlags() & Intent.FLAG_RECEIVER_FOREGROUND) != 0;
        return (isFg) ? mFgBroadcastQueue : mBgBroadcastQueue;
    }

broadcastQueueForIntent(Intent intent)通过判断intent.getFlags()是否包含FLAG_RECEIVER_FOREGROUND
来决定是前台或后台广播，进而返回相应的广播队列mFgBroadcastQueue或者mBgBroadcastQueue。

- 当Intent的flags包含FLAG_RECEIVER_FOREGROUND，则返回mFgBroadcastQueue；
- 当Intent的flags不包含FLAG_RECEIVER_FOREGROUND，则返回mBgBroadcastQueue；

### 2.6 广播注册小结

注册广播：

1. 传递的参数为广播接收者BroadcastReceiver和Intent过滤条件IntentFilter；
2. 创建对象LoadedApk.ReceiverDispatcher.InnerReceiver，该对象继承于IIntentReceiver.Stub；
3. 通过AMS把当前进程的ApplicationThread和InnerReceiver对象的代理类，注册登记到system_server进程；
4. 当广播receiver没有注册过，则创建广播接收者队列ReceiverList，该对象继承于ArrayList<BroadcastFilter>，
并添加到AMS.mRegisteredReceivers(已注册广播队列)；
5. 创建BroadcastFilter，并添加到AMS.mReceiverResolver；
6. 将BroadcastFilter添加到该广播接收者的ReceiverList

另外，当注册的是Sticky广播：
  - 创建BroadcastRecord，并添加到BroadcastQueue的mParallelBroadcasts(并行广播队列)，注册后调用AMS来尽快处理该广播。
  - 根据注册广播的Intent是否包含FLAG_RECEIVER_FOREGROUND，则mFgBroadcastQueue

广播注册完, 另一个操作便是在广播发送过程.

## 三、 发送广播

发送广播是在Activity或Service中调用`sendBroadcast()`方法，而Activity或Service都间接继承于Context抽象类，真正干活是交给ContextImpl类。

### 3.1 sendBroadcast

[ContextImpl.java]

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
            ...
        }
    }

### 3.2 AMP.broadcastIntent
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

### 3.3 AMS.broadcastIntent
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

### 3.4 AMS.broadcastIntentLocked

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

#### 3.4.1 设置广播flag

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


#### 3.4.2 广播权限验证

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
                ...
            }
        } catch (RemoteException e) {
            return ActivityManager.BROADCAST_SUCCESS;
        }
    }

主要功能：

- 对于callingAppId为SYSTEM_UID，PHONE_UID，SHELL_UID，BLUETOOTH_UID，NFC_UID之一或者callingUid == 0时都畅通无阻；
- 否则当调用者进程为空 或者非persistent进程的情况下：
    - 当发送的是受保护广播`mProtectedBroadcasts`(只允许系统使用)，则抛出异常；
    - 当action为ACTION_APPWIDGET_CONFIGURE时，虽然不希望该应用发送这种广播，处于兼容性考虑，限制该广播只允许发送给自己，否则抛出异常。


#### 3.4.3 处理系统相关广播

    final String action = intent.getAction();
    if (action != null) {
        switch (action) {
            case Intent.ACTION_UID_REMOVED: //uid移除
            case Intent.ACTION_PACKAGE_REMOVED: //package移除
            case Intent.ACTION_PACKAGE_ADDED: //增加package
            case Intent.ACTION_PACKAGE_CHANGED: //package改变

            case Intent.ACTION_EXTERNAL_APPLICATIONS_UNAVAILABLE: //外部设备不可用
            case Intent.ACTION_EXTERNAL_APPLICATIONS_AVAILABLE: //外部设备可用

            case Intent.ACTION_TIMEZONE_CHANGED: //时区改变，通知所有运行中的进程
            case Intent.ACTION_TIME_CHANGED: //时间改变，通知所有运行中的进程

            case Intent.ACTION_CLEAR_DNS_CACHE: //DNS缓存清空
            case Proxy.PROXY_CHANGE_ACTION: //网络代理改变
        }
    }

这个过主要处于系统相关的10类广播,这里不就展开讲解了.

#### 3.4.4 增加sticky广播

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

#### 3.4.5 查询receivers和registeredReceivers

    List receivers = null;
    List<BroadcastFilter> registeredReceivers = null;
    //当允许静态接收者处理该广播，则通过PKMS根据Intent查询相应的静态receivers
    if ((intent.getFlags()&Intent.FLAG_RECEIVER_REGISTERED_ONLY) == 0) {
        receivers = collectReceiverComponents(intent, resolvedType, callingUid, users);
    }
    if (intent.getComponent() == null) {
        if (userId == UserHandle.USER_ALL && callingUid == Process.SHELL_UID) {
            ...
        } else {
            // 查询相应的动态注册的广播
            registeredReceivers = mReceiverResolver.queryIntent(intent,
                    resolvedType, false, userId);
        }
    }

- receivers：记录着匹配当前intent的所有静态注册广播接收者；
- registeredReceivers：记录着匹配当前的所有动态注册的广播接收者。

其他说明：

- 根据userId来决定广播是发送给全部的接收者，还是指定的userId;
- mReceiverResolver是AMS的成员变量，记录着已注册的广播接收者的resolver.

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

#### 3.4.6 处理并行广播

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
            //将BroadcastRecord加入到并行广播队列[见下文]
            queue.enqueueParallelBroadcastLocked(r);
            //处理广播【见小节4.1】
            queue.scheduleBroadcastsLocked();
        }
        //动态注册的广播接收者处理完成，则会置空该变量；
        registeredReceivers = null;
        NR = 0;
    }

广播队列中有一个成员变量`mParallelBroadcasts`，类型为ArrayList<BroadcastRecord>，记录着所有的并行广播。

    // 并行广播,加入mParallelBroadcasts队列
    public void enqueueParallelBroadcastLocked(BroadcastRecord r) {
        mParallelBroadcasts.add(r);
        r.enqueueClockTime = System.currentTimeMillis();
    }

#### 3.4.7 合并registeredReceivers到receivers

```Java
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
        ...
    }

    //[3.4.6]有一个处理动态广播的过程，处理完后再执行将动态注册的registeredReceivers合并到receivers
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
```

动态注册的registeredReceivers，全部合并都receivers，再统一按串行方式处理。

#### 3.4.8 处理串行广播

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

    // 串行广播 加入mOrderedBroadcasts队列
    public void enqueueOrderedBroadcastLocked(BroadcastRecord r) {
        mOrderedBroadcasts.add(r);
        r.enqueueClockTime = System.currentTimeMillis();
    }

### 3.5 小结

发送广播过程:

1. 默认不发送给已停止（Intent.FLAG_EXCLUDE_STOPPED_PACKAGES）的应用包；
2. 处理各种PACKAGE,TIMEZONE等相关的系统广播；
3. 当为粘性广播，则将sticky广播增加到list，并放入mStickyBroadcasts里面；
4. 当广播的Intent没有设置FLAG_RECEIVER_REGISTERED_ONLY，则允许静态广播接收者来处理该广播；
创建BroadcastRecord对象,并将该对象加入到相应的广播队列, 然后调用BroadcastQueue的`scheduleBroadcastsLocked`()方法来完成的不同广播处理:

处理方式：

1. Sticky广播: 广播注册过程处理AMS.registerReceiver，开始处理粘性广播，见小节[2.5];
  - 创建BroadcastRecord对象；
  - 并添加到mParallelBroadcasts队列；
  - 然后执行queue.scheduleBroadcastsLocked；
2. 并行广播： 广播发送过程处理，见小节[3.4.6]
  - 只有动态注册的mRegisteredReceivers才会并行处理；
  - 会创建BroadcastRecord对象;
  - 并添加到mParallelBroadcasts队列；
  - 然后执行queue.scheduleBroadcastsLocked;
3. 串行广播： 广播发送广播处理，见小节[3.4.8]
  - 所有静态注册的receivers以及动态注册mRegisteredReceivers合并到一张表处理；
  - 创建BroadcastRecord对象；
  - 并添加到mOrderedBroadcasts队列；
  - 然后执行queue.scheduleBroadcastsLocked；

可见不管哪种广播方式，接下来都会执行scheduleBroadcastsLocked方法来处理广播；

## 四、 处理广播

在发送广播过程中会执行`scheduleBroadcastsLocked`方法来处理相关的广播

### 4.1 scheduleBroadcastsLocked

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

#### 4.1.1 BroadcastHandler

    public ActivityManagerService(Context systemContext) {
        //名为"ActivityManager"的线程
        mHandlerThread = new ServiceThread(TAG,
                android.os.Process.THREAD_PRIORITY_FOREGROUND, false);
        mHandlerThread.start();
        mHandler = new MainHandler(mHandlerThread.getLooper());
        ...
        //创建BroadcastQueue对象
        mFgBroadcastQueue = new BroadcastQueue(this, mHandler,
                "foreground", BROADCAST_FG_TIMEOUT, false);
        mBgBroadcastQueue = new BroadcastQueue(this, mHandler,
                "background", BROADCAST_BG_TIMEOUT, true);
        ...
    }


    BroadcastQueue(ActivityManagerService service, Handler handler,
            String name, long timeoutPeriod, boolean allowDelayBehindServices) {
        mService = service;
        //创建BroadcastHandler
        mHandler = new BroadcastHandler(handler.getLooper());
        mQueueName = name;
        mTimeoutPeriod = timeoutPeriod;
        mDelayBehindServices = allowDelayBehindServices;
    }

由此可见BroadcastHandler采用的是"ActivityManager"线程的Looper

    private final class BroadcastHandler extends Handler {

        public void handleMessage(Message msg) {
            switch (msg.what) {
                case BROADCAST_INTENT_MSG: {
                    processNextBroadcast(true); //【见小节4.2】
                } break;
                ...
        }
    }

### 4.2 processNextBroadcast

[-> BroadcastQueue.java]

    final void processNextBroadcast(boolean fromMsg) {
        synchronized(mService) {
            //part1: 处理并行广播
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

            //part2: 处理当前有序广播
            do {
                if (mOrderedBroadcasts.size() == 0) {
                    mService.scheduleAppGcsLocked(); //没有更多的广播等待处理
                    if (looped) {
                        mService.updateOomAdjLocked();
                    }
                    return;
                }
                r = mOrderedBroadcasts.get(0); //获取串行广播的第一个广播
                boolean forceReceive = false;
                int numReceivers = (r.receivers != null) ? r.receivers.size() : 0;
                if (mService.mProcessesReady && r.dispatchTime > 0) {
                    long now = SystemClock.uptimeMillis();
                    if ((numReceivers > 0) && (now > r.dispatchTime + (2*mTimeoutPeriod*numReceivers))) {
                        broadcastTimeoutLocked(false); //当广播处理时间超时，则强制结束这条广播
                    }
                }
                ...
                if (r.receivers == null || r.nextReceiver >= numReceivers
                        || r.resultAbort || forceReceive) {
                    if (r.resultTo != null) {
                        //处理广播消息消息，调用到onReceive()
                        performReceiveLocked(r.callerApp, r.resultTo,
                            new Intent(r.intent), r.resultCode,
                            r.resultData, r.resultExtras, false, false, r.userId);
                    }

                    cancelBroadcastTimeoutLocked(); //取消BROADCAST_TIMEOUT_MSG消息
                    addBroadcastToHistoryLocked(r);
                    mOrderedBroadcasts.remove(0);
                    continue;
                }
            } while (r == null);

            //part3: 获取下一个receiver
            r.receiverTime = SystemClock.uptimeMillis();
            if (recIdx == 0) {
                r.dispatchTime = r.receiverTime;
                r.dispatchClockTime = System.currentTimeMillis();
            }
            if (!mPendingBroadcastTimeoutMessage) {
                long timeoutTime = r.receiverTime + mTimeoutPeriod;
                setBroadcastTimeoutLocked(timeoutTime); //设置广播超时延时消息
            }

            //part4: 处理下条有序广播
            ProcessRecord app = mService.getProcessRecordLocked(targetProcess,
                    info.activityInfo.applicationInfo.uid, false);
            if (app != null && app.thread != null) {
                app.addPackage(info.activityInfo.packageName,
                        info.activityInfo.applicationInfo.versionCode, mService.mProcessStats);
                processCurBroadcastLocked(r, app); //[处理串行广播]
                return;
                ...
            }

            //该receiver所对应的进程尚未启动，则创建该进程
            if ((r.curApp=mService.startProcessLocked(targetProcess,
                    info.activityInfo.applicationInfo, true,
                    r.intent.getFlags() | Intent.FLAG_FROM_BACKGROUND,
                    "broadcast", r.curComponent,
                    (r.intent.getFlags()&Intent.FLAG_RECEIVER_BOOT_UPGRADE) != 0, false, false))
                            == null) {
                ...
                return;
            }
        }
    }

此处mService为AMS，整个流程还是比较长的，全程持有AMS锁，所以广播效率低的情况下，直接会严重影响这个手机的性能与流畅度，这里应该考虑细化同步锁的粒度。

- 设置广播超时延时消息: setBroadcastTimeoutLocked:
- 当广播接收者等待时间过长，则调用broadcastTimeoutLocked(false);
- 当执行完广播,则调用cancelBroadcastTimeoutLocked;

#### 4.2.1 处理并行广播

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

通过while循环, 一次性分发完所有的并发广播后,则分发完成后则添加到历史广播队列.
fromMsg是指processNextBroadcast()是否由BroadcastHandler所调用的.

    private final void addBroadcastToHistoryLocked(BroadcastRecord r) {
        if (r.callingUid < 0) {
            return;
        }
        r.finishTime = SystemClock.uptimeMillis(); //记录分发完成时间

        mBroadcastHistory[mHistoryNext] = r;
        mHistoryNext = ringAdvance(mHistoryNext, 1, MAX_BROADCAST_HISTORY);

        mBroadcastSummaryHistory[mSummaryHistoryNext] = r.intent;
        mSummaryHistoryEnqueueTime[mSummaryHistoryNext] = r.enqueueClockTime;
        mSummaryHistoryDispatchTime[mSummaryHistoryNext] = r.dispatchClockTime;
        mSummaryHistoryFinishTime[mSummaryHistoryNext] = System.currentTimeMillis();
        mSummaryHistoryNext = ringAdvance(mSummaryHistoryNext, 1, MAX_BROADCAST_SUMMARY_HISTORY);
    }

#### 4.2.2 处理串行广播

    if (mPendingBroadcast != null) {
        boolean isDead;
        synchronized (mService.mPidsSelfLocked) {
            //从mPidsSelfLocked获取正在处理该广播进程，判断该进程是否死亡
            ProcessRecord proc = mService.mPidsSelfLocked.get(mPendingBroadcast.curApp.pid);
            isDead = proc == null || proc.crashing;
        }
        if (!isDead) {
            return; //正在处理广播的进程保持活跃状态，则继续等待其执行完成
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

#### 4.2.3 获取下条有序广播

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

#### 4.2.4 处理下条有序广播

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

接下来,介绍deliverToRegisteredReceiverLocked的处理流程:

### 4.3 deliverToRegisteredReceiverLocked

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

### 4.4 performReceiveLocked

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

### 4.5 ATP.scheduleRegisteredReceiver
[-> ApplicationThreadNative.java  ::ApplicationThreadProxy]

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

ATP位于system_server进程，是Binder Bp端通过Binder驱动向Binder Bn端发送消息(oneway调用方式), ATP所对应的Bn端位于发送广播调用端所在进程的ApplicationThread，即进入AT.scheduleRegisteredReceiver， 接下来说明该方法。

### 4.6 AT.scheduleRegisteredReceiver
[-> ActivityThread.java ::ApplicationThread]

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

### 4.7 InnerReceiver.performReceive
[-> LoadedApk.java]

    public void performReceive(Intent intent, int resultCode, String data,
            Bundle extras, boolean ordered, boolean sticky, int sendingUser) {
        LoadedApk.ReceiverDispatcher rd = mDispatcher.get();
        if (rd != null) {
            //【见小节4.8】
            rd.performReceive(intent, resultCode, data, extras, ordered, sticky, sendingUser);
        } else {
           ...
        }
    }

此处方法LoadedApk()属于LoadedApk.ReceiverDispatcher.InnerReceiver, 也就是LoadedApk内部类的内部类InnerReceiver.

### 4.8 ReceiverDispatcher.performReceive
[-> LoadedApk.java]

    public void performReceive(Intent intent, int resultCode, String data,
            Bundle extras, boolean ordered, boolean sticky, int sendingUser) {
        Args args = new Args(intent, resultCode, data, extras, ordered,
                sticky, sendingUser);
        //通过handler消息机制发送args.
        if (!mActivityThread.post(args)) {
            //消息成功post到主线程，则不会走此处。
            if (mRegistered && ordered) {
                IActivityManager mgr = ActivityManagerNative.getDefault();
                args.sendFinished(mgr);
            }
        }
    }

其中`Args`继承于`BroadcastReceiver.PendingResult`，实现了接口`Runnable`; 其中mActivityThread是当前进程的主线程, 是由[小节2.3.1]完成赋值过程.

这里mActivityThread.post(args)
消息机制，关于Handler消息机制，见[Android消息机制1-Handler(Java层)](http://gityuan.com/2015/12/26/handler-message-framework/)，把消息放入MessageQueue，再调用Args的run()方法。

### 4.9 ReceiverDispatcher.Args.run

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
                    finish(); //【见小节4.10】
                }
            }
          }
        }

接下来,便进入主线程,最终调用`BroadcastReceiver`具体实现类的`onReceive()`方法。

### 4.10 PendingResult.finish
[-> BroadcastReceiver.java ::PendingResult]

    public final void finish() {
      if (mType == TYPE_COMPONENT) { //代表是静态注册的广播
          final IActivityManager mgr = ActivityManagerNative.getDefault();
          if (QueuedWork.hasPendingWork()) {
              QueuedWork.singleThreadExecutor().execute( new Runnable() {
                  void run() {
                      sendFinished(mgr); //[见小节4.10.1]
                  }
              });
          } else {
              sendFinished(mgr); //[见小节4.10.1]
          }
      } else if (mOrderedHint && mType != TYPE_UNREGISTERED) { //动态注册的串行广播
          final IActivityManager mgr = ActivityManagerNative.getDefault();
          sendFinished(mgr); //[见小节4.10.1]
      }
    }

主要功能:

- 静态注册的广播接收者:
    - 当QueuedWork工作未完成, 即SharedPreferences写入磁盘的操作没有完成, 则等待完成再执行sendFinished方法;
    - 当QueuedWork工作已完成, 则直接调用sendFinished方法;
- 动态注册的广播接收者:
    - 当发送的是串行广播, 则直接调用sendFinished方法.

另外常量参数说明:

- TYPE_COMPONENT: 静态注册
- TYPE_REGISTERED: 动态注册
- TYPE_UNREGISTERED: 取消注册

#### 4.10.1 sendFinished
[-> BroadcastReceiver.java ::PendingResult]

    public void sendFinished(IActivityManager am) {
        synchronized (this) {
            mFinished = true;
            ...
            // mOrderedHint代表发送是否为串行广播 [见小节4.10.2]
            if (mOrderedHint) {
                am.finishReceiver(mToken, mResultCode, mResultData, mResultExtras,
                        mAbortBroadcast, mFlags);
            } else {
                //并行广播, 但属于静态注册的广播, 仍然需要告知AMS. [见小节4.10.2]
                am.finishReceiver(mToken, 0, null, null, false, mFlags);
            }
            ...
        }
    }


此处AMP.finishReceiver，经过binder调用，进入AMS.finishReceiver方法

#### 4.10.2 AMS.finishReceiver

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
                    //[见小节4.10.3]
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

#### 4.10.3 BQ.finishReceiverLocked
[-> BroadcastQueue.java]

    public boolean finishReceiverLocked(BroadcastRecord r, int resultCode,
            String resultData, Bundle resultExtras, boolean resultAbort, boolean waitForServices) {
        final int state = r.state;
        final ActivityInfo receiver = r.curReceiver;
        r.state = BroadcastRecord.IDLE;

        r.receiver = null;
        r.intent.setComponent(null);
        if (r.curApp != null && r.curApp.curReceiver == r) {
            r.curApp.curReceiver = null;
        }
        if (r.curFilter != null) {
            r.curFilter.receiverList.curBroadcast = null;
        }
        r.curFilter = null;
        r.curReceiver = null;
        r.curApp = null;
        mPendingBroadcast = null;

        r.resultCode = resultCode;
        r.resultData = resultData;
        r.resultExtras = resultExtras;
        if (resultAbort && (r.intent.getFlags()&Intent.FLAG_RECEIVER_NO_ABORT) == 0) {
            r.resultAbort = resultAbort;
        } else {
            r.resultAbort = false;
        }

        if (waitForServices && r.curComponent != null && r.queue.mDelayBehindServices
                && r.queue.mOrderedBroadcasts.size() > 0
                && r.queue.mOrderedBroadcasts.get(0) == r) {
            ActivityInfo nextReceiver;
            if (r.nextReceiver < r.receivers.size()) {
                Object obj = r.receivers.get(r.nextReceiver);
                nextReceiver = (obj instanceof ActivityInfo) ? (ActivityInfo)obj : null;
            } else {
                nextReceiver = null;
            }

            if (receiver == null || nextReceiver == null
                    || receiver.applicationInfo.uid != nextReceiver.applicationInfo.uid
                    || !receiver.processName.equals(nextReceiver.processName)) {
                if (mService.mServices.hasBackgroundServices(r.userId)) {
                    r.state = BroadcastRecord.WAITING_SERVICES;
                    return false;
                }
            }
        }
        r.curComponent = null;

        return state == BroadcastRecord.APP_RECEIVE
                || state == BroadcastRecord.CALL_DONE_RECEIVE;
    }

## 五、总结

### 5.1 基础知识
1.BroadcastReceiver分为两类：

- 静态广播接收者：通过AndroidManifest.xml的标签来申明的BroadcastReceiver;
- 动态广播接收者：通过AMS.registerReceiver()方式注册的BroadcastReceiver, 不需要时记得调用unregisterReceiver();

2.广播发送方式可分为三类:

|类型|方法|ordered|sticky|
|---|---|---|
|普通广播|sendBroadcast|false|false|
|有序广播|sendOrderedBroadcast|true|false|
|Sticky广播|sendStickyBroadcast|false|true|

3.广播注册registerReceiver():默认将当前进程的主线程设置为scheuler. 再向AMS注册该广播相应信息, 根据类型选择加入mParallelBroadcasts或mOrderedBroadcasts队列.

4.广播发送processNextBroadcast():根据不同情况调用不同的处理过程:

- 如果是动态广播接收者，则调用deliverToRegisteredReceiverLocked处理；
- 如果是静态广播接收者，且对应进程已经创建，则调用processCurBroadcastLocked处理；
- 如果是静态广播接收者，且对应进程尚未创建，则调用startProcessLocked创建进程。

### 5.2 流程图

最后,通过一幅图来总结整个广播处理过程. 点击查看[大图](http://gityuan.com//images/ams/send_broadcast.jpg)

![send_broadcast](/images/ams/send_broadcast.jpg)

#### 5.2.1 并行广播

整个过程涉及过程进程间通信, 先来说说并行广播处理过程:

1. 广播发送端所在进程: 步骤1~2;
2. system_server的binder线程: 步骤3~5;
3. system_server的ActivityManager线程: 步骤6~11;
4. 广播接收端所在进程的binder线程: 步骤12~13;
5. 广播接收端所在进程的主线程: 步骤14~15,以及23;
6. system_server的binder线程: 步骤24~25.

#### 5.2.2 串行广播

可以看出整个流程中,步骤8~15是并行广播, 而步骤16~22则是串行广播.那么再来说说串行广播的处理过程.

1. 广播发送端所在进程: 步骤1~2;
2. system_server的binder线程: 步骤3~5;
3. system_server的ActivityManager线程:步骤6以及16~18;
4. 广播接收端所在进程的binder线程: 步骤19;
5. 广播接收端所在进程的主线程: 步骤20~22;
6. system_server的binder线程: 步骤24~25.

再来说说几个关键的时间点:

- enqueueClockTime: 位于步骤4 scheduleBroadcastsLocked(), 这是在system_server的binder线程.
- dispatchClockTime: 位于步骤8 deliverToRegisteredReceiverLocked(),这是在system_server的ActivityManager线程.
- finishTime : 位于步骤11 addBroadcastToHistoryLocked()之后, 这是在并行广播向所有receivers发送完成后的时间点,而串行广播则是一个一个发送完成才会继续.

#### 5.2.3 粘性广播

对于粘性广播，registerReceiver()会有一个返回值，数据类型为Intent。
只有粘性广播在注册过程过程会直接返回Intent，里面带有相关参数。
比如常见的使用场景比如Battery广播的注册。

### 5.3 广播处理机制


1. 当发送串行广播(ordered=true)的情况下：
    - 静态注册的广播接收者(receivers)，采用串行处理；
    - 动态注册的广播接收者(registeredReceivers)，采用串行处理；
2. 当发送并行广播(ordered=false)的情况下：
    - 静态注册的广播接收者(receivers)，依然采用串行处理；
    - 动态注册的广播接收者(registeredReceivers)，采用并行处理；

简单来说，静态注册的receivers始终采用串行方式来处理（processNextBroadcast）；
动态注册的registeredReceivers处理方式是串行还是并行方式, 取决于广播的发送方式(processNextBroadcast)。

静态注册的广播往往其所在进程还没有创建，而进程创建相对比较耗费系统资源的操作，所以
让静态注册的广播串行化，能防止出现瞬间启动大量进程的喷井效应。

**ANR时机：**只有串行广播才需要考虑超时，因为接收者是串行处理的，前一个receiver处理慢，会影响后一个receiver；并行广播
通过一个循环一次性向所有的receiver分发广播事件，所以不存在彼此影响的问题，则没有广播超时；

- 串行广播超时情况1：某个广播总处理时间 > 2* receiver总个数 * mTimeoutPeriod, 其中mTimeoutPeriod，前台队列默认为10s，后台队列默认为60s;
- 串行广播超时情况2：某个receiver的执行时间超过mTimeoutPeriod；
