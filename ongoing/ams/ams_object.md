---
layout: post
title:  "ActivityManager剖析"
date:   2016-10-01 21:12:40
catalog:  true
tags:
    - android
    - AMS

---

- ActivityInfo: 从xml解析出来的信息
- ActivityRecord: 记录着Activity信息
- TaskRecord: 记录着task信息
- ActivityStack: 栈信息


### 一. ActivityManager概述

ActivityManagerService(简称AMS)运行在system_server进程. 当AMS服务启动之后, 便创建ActivityStackSupervisor对象.

### 一 基本对象

#### 重要变量:

mBooted: 默认false, startHomeActivityLocked的时候则认为是true;

boolean mProcessesReady = false;    AMS.systemReady()
boolean mSystemReady = false;    AMS.systemReady()
boolean mBooting = false;  AMS.systemReady()桌面启动时为true,  ASS.checkFinishBootingLocked()为false, AMS.ensureBootCompleted为false
boolean mBooted = false;  ASS.checkFinishBootingLocked()为true, AMS.ensureBootCompleted为true.


#### 1. ActivityRecord
- Activity的信息记录在ActivityRecord对象, 并通过通过成员变量task指向TaskRecord

ProcessRecord app //跑在哪个进程
TaskRecord task  //跑在哪个task
ActivityInfo info // Activity信息
ActivityState state //Activity状态
ApplicationInfo appInfo //跑在哪个app
ComponentName realActivity //组件名
String packageName //包名
String processName //进程名
int launchMode //启动模式
int userId // 该Activity运行在哪个用户id

#### 2. TaskRecord

- Task的信息记录在TaskRecord对象.

ActivityStack stack; //当前所属的stack
ArrayList<ActivityRecord> mActivities; // 当前task的所有Activity列表
int taskId
String affinity
int mCallingUid;
String mCallingPackage;


#### 3. ActivityStack

ArrayList<TaskRecord> mTaskHistory  //保存所有的Task列表
ArrayList<ActivityStack> mStacks; //所有stack列表
final int mStackId;
int mDisplayId;

ActivityRecord mPausingActivity //正在pause
ActivityRecord mLastPausedActivity
ActivityRecord mResumedActivity  //已经resumed
ActivityRecord mLastStartedActivity

ActivityContainer mActivityContainer


所有前台stack的mResumedActivity的state == RESUMED, 则表示allResumedActivitiesComplete, 此时 mLastFocusedStack = mFocusedStack;

#### 4. ActivityStackSupervisor

ActivityStack mHomeStack //桌面的stack
ActivityStack mFocusedStack //当前聚焦stack
ActivityStack mLastFocusedStack //正在切换

SparseArray<ActivityDisplay> mActivityDisplays  //displayId为key
SparseArray<ActivityContainer> mActivityContainers // mStackId为key

home的栈ID等于0,即HOME_STACK_ID = 0;

## 三. Handler角度


|Handler|数据类型|所属线程|
|---|---|---|
|AMS.mUiHandler|UiHandler|android.ui|
|AMS.mBgHandler|Handler|android.bg|
|AMS.mHandler|MainHandler|ActivityManager|
|ASS.mHandler|ActivityStackSupervisorHandler|ActivityManager|
|AS.mHandler|ActivityStackHandler|ActivityManager|
|BroadcastQueue.mHandler|BroadcastHandler|ActivityManager|
|ActiveServices.mServiceMap|ServiceMap|ActivityManager|

说明：

- AMS.MainHandler
  - 处理service、process、provider的超时问题；
- ActivityStackSupervisorHandler：
  - 处理IDLE_TIMEOUT，SLEEP_TIMEOUT，LAUNCH_TIMEOUT
- ActivityStackHandler：
  - 处理PAUSE_TIMEOUT，STOP_TIMEOUT，DESTROY_TIMEOUT
  - TRANSLUCENT_TIMEOUT，LAUNCH_TICK
- ActiveServices.ServiceMap：
  - 处理BG_START_TIMEOUT
- BroadcastHandler：
  - 处理broadcast的超时问题；
  
可见，以上的超时都是在"ActivityManager", 也有例外，那就是input的超时是在inputDispatcher线程发生的。

### 其他

BaseErrorDialog.mHandler  --> android.ui
AppErrorDialog --> android.ui
StrictModeViolationDialog --> android.ui
AppNotRespondingDialog
AppWaitingForDebuggerDialog
UserSwitchingDialog

除了上述的,基本上所有的Anr/Crash/error等弹出都是运行在android.ui线程.





### 5. pending事件

#### 1. Activity
ASS.java
- mPendingActivityLaunches

#### 2. Service
ActiveServices.java
- mPendingServices
- mRestartingServices

#### 3. Broadcast  
BroadcastQueue.java
- mFgBroadcastQueue.mPendingBroadcast
- mBgBroadcastQueue.mPendingBroadcast

#### 4. Provider
AMS.java
- mLaunchingProviders


#### 5. Process
AMS.java
- mProcessesOnHold
- mPersistentStartingProcesses


#### 关系链表

正向: ActivityStack.mTaskHistory -> TaskRecord.mActivities -> ActivityRecord
反向: ActivityRecord.task -> TaskRecord.stack -> ActivityStack


ActivityRecord -> Task -> ActivityStack -> ActivityDisplay -> mActivityDisplays

mActivityDisplays.valueAt(displayNdx).mStacks


LAUNCH_MULTIPLE
LAUNCH_SINGLE_TOP
LAUNCH_SINGLE_TASK
LAUNCH_SINGLE_INSTANCE

### 继承关系

PackageItemInfo
    ApplicationInfo
    InstrumentationInfo
    ComponentInfo
        ActivityInfo
        ServiceInfo
        ProviderInfo
    PermissionInfo
    PermissionGroupInfo

in ActivityRecord.java

Token 继承于 IApplicationToken.Stub


ActivityRecord -> Task -> ActivityStack -> ActivityDisplay -> mActivityDisplays


正向: ActivityStack.mTaskHistory -> TaskRecord.mActivities -> ActivityRecord
反向: ActivityRecord.task -> TaskRecord.stack -> ActivityStack

mActivityDisplays.valueAt(displayNdx).mStacks

### 二. 常见逻辑


AMS.isPendingBroadcastProcessLocked


AS.addTask: 启动Activity的过程,


AS.removeTask:


- "activityDestroyed"
- "destroyTimeout"
- "exceptionInScheduleDestroy"
- "appDied"    
- "setTask"
- "moveTaskToStack"
