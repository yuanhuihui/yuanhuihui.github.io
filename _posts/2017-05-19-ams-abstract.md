---
layout: post
title:  "四大组件之综述"
date:   2017-05-19 21:19:12
catalog:  true
tags:
    - android
    - 组件系列

---

> 本文基于Android 6.0的源代码，来分析四大组件的管理者AMS

    frameworks/base/services/core/java/com/android/server/am/
      - ActivityManagerService.java
      - ProcessRecord
      - ActivityStackSupervisor.java
      - ActivityStack.java
      - ActiveServices
      - BroadcastQueue

## 一. 引言


Android系统内部非常复杂，经层层封装后，app只需要简单的几行代码便可完成任一组件的启动/结束、
生命周期的操作。然而每一次看似简单的操作，背后所有的复杂工作都是交由系统来完成。

组件启动后，首先需要依赖进程，那么就需要先创建进程，系统需要记录每个进程，这便产生了ProcessRecord。
Android中，对于进程的概念被弱化，通过抽象后的四大组件。让开发者几乎感受不到进程的存在。
当应用退出时，进程也并非马上退出，而是成为cache/empty进程，下次该应用再启动的时候，可以不用
再创建进程直接初始化组件即可，提高启动速度。先来说一说进程。

## 二. 进程管理

Android系统中用于描述进程的数据结构是ProcessRecord对象，AMS便是管理进程的核心模块。四大组件
（Activity,Service, BroadcastReceiver, ContentProvider）定义在AndroidManifest.xml文件，
每一项都可以用属性android:process指定所运行的进程。同一个app可以运行在同一个进程，也可以运行在多个进程，
甚至多个app可以共享同一个进程。例如：AndroidManifest.xml中定义Service：

    <service android:name =".GityuanService"  android:process =":remote" >  
        <intent-filter>  
           <action android:name ="com.action.gityuan" />  
        </intent-filter>  
    </service>

GityuanService这个服务运行在remote进程。

#### 2.1 进程关系图

以一幅图来展示AMS管理进程的相关成员变量以及ProcessRecord对象：

[点击查看大图](http://www.gityuan.com/images/ams/process_record.jpg)

![process_record](/images/ams/process_record.jpg)


#### 2.2 进程与AMS的关联

这里只介绍AMS的进程相关的成员变量：

1. **mProcessNames**：数据类型为ProcessMap<ProcessRecord>，以进程名和userId为key来记录ProcessRecord;
  - 添加进程，addProcessNameLocked()
  - 删除进程，removeProcessNameLocked()
2. **mPidsSelfLocked**: 数据类型为SparseArray<ProcessRecord>，以进程pid为key来记录ProcessRecord;
  - startProcessLocked()，移除已存在进程，增加新创建进程pid信息；
  - removeProcessLocked，processStartTimedOutLocked，cleanUpApplicationRecordLocked移除进程；
3. **mLruProcesses**：数据类型为ArrayList<ProcessRecord>，以进程最近使用情况来排序记录ProcessRecord;
  - 其中第一个元素代表的便是最近最少使用的进程；
  - updateLruProcessLocked()更新进程队列位置；
4. mRemovedProcesses：数据类型为ArrayList<ProcessRecord>，记录所有需要强制移除的进程；
5. mProcessesToGc：数据类型为ArrayList<ProcessRecord>，记录系统进入idle状态需执行gc操作的进程；
6. mPendingPssProcesses：数据类型为ArrayList<ProcessRecord>，记录将要收集内存使用数据PSS的进程；
7. mProcessesOnHold：数据类型为ArrayList<ProcessRecord>，记录刚开机过程，系统还没与偶准备就绪的情况下，
所有需要启动的进程都放入到该队列；
8. mPersistentStartingProcesses：数据类型ArrayList<ProcessRecord>，正在启动的persistent进程；
9. mHomeProcess: 记录包含home Activity所在的进程；
10. mPreviousProcess：记录用户上一次刚访问的进程；其中mPreviousProcessVisibleTime记录上一个进程的用户访问时间；
11. mProcessList: 数据类型ProcessList，用于进程管理，Adj常量定义位于该文件；

其中最为常见的是mProcessNames，mPidsSelfLocked，mLruProcesses这3个对象；

#### 2.3 进程与组件的关联

系统AMS这边是由ProcessRecord对象记录进程，进程自身比较重要成员变量如下：

1. processName：记录进程名，默认情况下进程名和该进程运行的第一个apk的包名是相同的，当然也可以自定义进程名；
2. pid: 记录进程pid，该值在由进程创建时内核所分配的。
3. thread：执行完attachApplicationLocked()方法，会把客户端进程ApplicationThread的binder服务的代理端传递到
AMS，并保持到ProcessRecord的成员变量thread；
  - ProcessRecord.makeActive，赋值；
  - ProcessRecord.makeInactive，清空；
4. info：记录运行在该进程的第一个应用；
5. pkgList: 记录运行在该进程中所有的包名，比如通过addPackage()添加；
6. pkgDeps：记录该进程所依赖的包名，比如通过addPackageDependency()添加；
7. lastActivityTime：每次updateLruProcessLocked()过程会更新该值；
8. killedByAm：当值为true，意味着该进程是被AMS所杀，而非由于内存低而被LMK所杀；
9. killed：当值为true，意味着该进程被杀，不论是AMS还是其他方式；
10. waitingToKill：比如cleanUpRemovedTaskLocked()过程会赋值为"remove task"，当该进程处于后台且

任一组件都运行在某个进程，再来说说ProcessRecord对象中与组件的关联关系：

|成员变量|说明|对应组件|
|---|---|
|activities|记录进程的ActivityRecord列表|Activity|
|services|记录进程的ActivityRecord列表|Service|
|executingServices|记录进程的正在执行的ActivityRecord列表|Service|
|connections|记录该进程bind的ConnectionRecord集合|Service|
|receivers|动态注册的广播接收者ReceiverList集合|Broadcast|
|curReceiver|当前正在处理的一个广播BroadcastRecord|Broadcast|
|pubProviders|该进程发布的ContentProviderRecord的map表|ContentProvider|
|conProviders|该进程所请求的ContentProviderConnection列表|ContentProvider|

说明：

- connections：举例来说，进程A调用bindService()方法去bind远程进程B的Service。
此时会在进程A的ProcessRecord.connections添加一个ConnectionRecord.
- pubProviders: 该进程所有对外发布的ContentProvider信息，这是是以ArrayMap形式保存，即
以provider的name为key,以ContentProviderRecord为value的键值对结构体。
- conProviders: 当进程A调用query()的过程，会执行getContentProvider()方法去向进程B请求
provider的代理。此时会在进程A的ProcessRecord.conProviders添加一个ContentProviderConnection。

## 三. AMS的组件管理

组件启动，先填充完进程信息，接下来还需要完善组件本身的信息，各个组件在system_server的核心信息记录如下：

- Service的信息记录在ActiveServices和AMS
- Broadcast信息记录在BroadcastQueue和AMS
- Activity信息记录在ActivityStack，ActivityStackSupervisor，以及AMS;
- Provider信息记录在ProviderMap和AMS;

可见，AMS是整个四大组件最为核心的对象，所有组件都或多或少依赖该对象的数据结构信息。
关系图如下：[点击查看大图](http://www.gityuan.com/images/ams/four_component.jpg)

![four_component](/images/ams/four_component.jpg)


#### 3.1 Activity

AMS对象

    public final class ActivityManagerService extends ...{
        //当前聚焦的Activity
        ActivityRecord mFocusedActivity = null;
        //用于管理各个Activity栈
        final ActivityStackSupervisor mStackSupervisor;
    }

ASS对象

    public final class ActivityStackSupervisor implements DisplayListener {
        //桌面app所在栈
        ActivityStack mHomeStack;

        //当前可以接受Input事件，或许启动下一个Activity的栈
        ActivityStack mFocusedStack;

        //当该值等于mFocusedStack，代表当前栈顶的Activity已进入resumed状态；
        //当该值等于上一个旧栈时，代表正处理activity切换状态；
        private ActivityStack mLastFocusedStack;

        //在完成相应目标前，等待新的Activity成为可见的Activity列表
        final ArrayList<ActivityRecord> mWaitingVisibleActivities = new ArrayList<>();

        //等待找到下一个可见Activity的等待列表
        final ArrayList<IActivityManager.WaitResult> mWaitingActivityVisible = new ArrayList<>();

        //等待找到下一个已启动Activity的等待列表
        final ArrayList<IActivityManager.WaitResult> mWaitingActivityLaunched = new ArrayList<>();

        //等待上一个activity安置完成，则即将进入被stopped的Activity列表
        final ArrayList<ActivityRecord> mStoppingActivities = new ArrayList<>();

        //等待上一个activity安置完成，则即将进入被finished的Activity列表
        final ArrayList<ActivityRecord> mFinishingActivities = new ArrayList<>();

        //即将进入sleep状态的进程所对应的Activity列表
        final ArrayList<ActivityRecord> mGoingToSleepActivities = new ArrayList<>();
    }

AS对象

    final class ActivityStack{
        //记录该栈中所有的task
        private final ArrayList<TaskRecord> mTaskHistory = new ArrayList<>();

        //按LRU方式排序的Activity列表，队尾成员是最新活动的Activity
        final ArrayList<ActivityRecord> mLRUActivities = new ArrayList<>();

        //正在执行pausing过程的Activity
        ActivityRecord mPausingActivity = null;

        //已处于paused状态的Activity
        ActivityRecord mLastPausedActivity = null;

        //已处于Resumed状态的Activity
        ActivityRecord mResumedActivity = null;
    }

#### 3.2 Service
[-> ActiveServices.java]

    public final class ActiveServices {
        //记录不同User下所有的Service信息
        final SparseArray<ServiceMap> mServiceMap = new SparseArray<>();

        //bind service的连接信息，以IServiceConnection的Bp端作为Keys
        final ArrayMap<IBinder, ArrayList<ConnectionRecord>> mServiceConnections = new ArrayMap<>();

        //已请求启动但尚未启动的Service列表
        final ArrayList<ServiceRecord> mPendingServices = new ArrayList<>();

        //crash后需要计划重启的Service列表
        final ArrayList<ServiceRecord> mRestartingServices = new ArrayList<>();

        //正在执行destroyed的service列表
        final ArrayList<ServiceRecord> mDestroyingServices = new ArrayList<>();
    }

#### 3.3 Broadcast
[-> ActivityManagerService.java]

    public final class ActivityManagerService extends ...{
        //前台广播队列
        BroadcastQueue mFgBroadcastQueue;
        //后台广播队列
        BroadcastQueue mBgBroadcastQueue;
        //广播队列数组，也就是前台和后台广播队列
        final BroadcastQueue[] mBroadcastQueues = new BroadcastQueue[2];

        //粘性广播，[userId，action，ArrayList<Intent>]
        final SparseArray<ArrayMap<String, ArrayList<Intent>>> mStickyBroadcasts;

        //动态注册的广播接收者，其中key为客户端InnerReceiver的Bp端，value为ReceiverList
        final HashMap<IBinder, ReceiverList> mRegisteredReceivers = new HashMap<>();

        //从广播intent到已注册接收者的解析器
        final IntentResolver<BroadcastFilter, BroadcastFilter> mReceiverResolver；
    }

[-> BroadcastQueue.java]

    public final class BroadcastQueue{
        //并行广播列表
        final ArrayList<BroadcastRecord> mParallelBroadcasts = new ArrayList<>();
        //串行广播列表
        final ArrayList<BroadcastRecord> mOrderedBroadcasts = new ArrayList<>();

        //即将要处理的串行广播，等待目标进程创建完成。每个广播队列只有一个，其他必须等待该广播完成。
        BroadcastRecord mPendingBroadcast = null;
    }

#### 3.4 Provider

[-> ActivityManagerService.java]

    public final class ActivityManagerService extends ...{
        //记录系统所有的provider信息
        final ProviderMap mProviderMap;

        //记录有client正在等待的provider列表，当provider发布完成则从该队列移除
        final ArrayList<ContentProviderRecord> mLaunchingProviders;
    }

[-> ProviderMap.java]

    public final class ProviderMap {
        //以provider名字(auth)为key的方式所记录的provider信息
        private final HashMap<String, ContentProviderRecord> mSingletonByName;
        //以provider组件名(ComponentName)为key的方式所记录的provider信息
        private final HashMap<ComponentName, ContentProviderRecord> mSingletonByClass;

        //记录不同UserId下的，以auth为key的方式所记录的provider信息
        private final SparseArray<HashMap<String, ContentProviderRecord>> mProvidersByNamePerUser;
        //记录不同UserId下的，以ComponentName为key的方式所记录的provider信息
        private final SparseArray<HashMap<ComponentName, ContentProviderRecord>> mProvidersByClassPerUser;
    }

同一个provider组件名，可能对应多个provider名。

## 四. App端的组件信息

关系图如下：[点击查看大图](http://www.gityuan.com/images/ams/client_component.jpg)

![client_component](/images/ams/client_component.jpg)

App端的组件信息，都保存在ActivityThread和LoadedApk这两个对象，主要保存信息：

- ActivityThread：记录provider, activity, service在客户端的相关信息；
- LoadedApk: 记录动态注册的广播接收器，以及bind方式启动service在客户端的相关信息；
