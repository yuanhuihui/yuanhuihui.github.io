---
layout: post
title:  "四大组件之ActivityRecord"
date:   2017-06-11 22:11:12
catalog:  true
tags:
    - android
    - 组件系列

---

## 一. 引言

BroadcastRecord，ServiceRecord都继承于Binder对象，而ActivityRecord并没有继承于Binder。
但ActivityRecord的成员变量appToken的数据类型为Token，Token继承于IApplicationToken.Stub。

appToken：system_server进程通过调用scheduleLaunchActivity()将appToken传递到App进程，
  - 调用createActivityContext()，保存到ContextImpl.mActivityToken
  - 调用activity.attach()，保存到Activity.mToken；

ServiceRecord本身继承于Binder对象，传递到客户端的代理：
  - 调用Service.attach()，保存到Service.mToken；
  - 用途：stopSelf,startForeground, stopForeground

## 二. ActivityRecord结构体

先以一幅图来展示AMS管理Activity所涉及的相关数据结构：
[点击查看大图](http://www.gityuan.com/images/ams/activity/activity_record.jpg)

![activity_record](/images/ams/activity/activity_record.jpg)


- ActivityRecord: 记录着Activity信息
- TaskRecord: 记录着task信息
- ActivityStack: 栈信息


### 2.1 ActivityRecord

Activity的信息记录在ActivityRecord对象, 并通过通过成员变量task指向TaskRecord

- ProcessRecord app //跑在哪个进程
- TaskRecord task  //跑在哪个task
- ActivityInfo info // Activity信息
- int mActivityType //Activity类型
- ActivityState state //Activity状态
- ApplicationInfo appInfo //跑在哪个app
- ComponentName realActivity //组件名
- String packageName //包名
- String processName //进程名
- int launchMode //启动模式
- int userId // 该Activity运行在哪个用户id


再来说一说Activity类型和Activity状态的常量：

mActivityType：

  - APPLICATION_ACTIVITY_TYPE：普通应用类型
  - HOME_ACTIVITY_TYPE：桌面类型
  - RECENTS_ACTIVITY_TYPE：最近任务类型

ActivityState：

  - INITIALIZING
  - RESUMED：已恢复
  - PAUSING
  - PAUSED：已暂停
  - STOPPING
  - STOPPED：已停止
  - FINISHING
  - DESTROYING
  - DESTROYED：已销毁

最后，说一说时间相关的成员变量：

|时间点|赋值时间|含义|
|---|---|---|
|createTime|new ActivityRecord|Activity首次创建时间点
|displayStartTime|AS.setLaunchTime|Activity首次启动时间点
|fullyDrawnStartTime|AS.setLaunchTime|Activity首次启动时间点
|startTime||Activity上次启动的时间点
|lastVisibleTime|AR.windowsVisibleLocked|Activity上次成为可见的时间点
|cpuTimeAtResume|AS.completeResumeLocked|从Rsume以来的cpu使用时长
|pauseTime|AS.startPausingLocked|Activity上次暂停的时间点
|launchTickTime|AR.startLaunchTickingLocked|Eng版本才赋值
|lastLaunchTime|ASS.realStartActivityLocked|上一次启动时间

其中AR是指ActivityRecord, AS是指ActivityStack。

### 2.2 TaskRecord
Task的信息记录在TaskRecord对象.

- ActivityStack stack; //当前所属的stack
- ArrayList<ActivityRecord> mActivities; // 当前task的所有Activity列表
- int taskId
- String affinity； 是指root activity的affinity，即该Task中第一个Activity;
- int mCallingUid;
- String mCallingPackage； //调用者的包名


### 2.3 ActivityStack

- ArrayList<TaskRecord> mTaskHistory  //保存所有的Task列表
- ArrayList<ActivityStack> mStacks; //所有stack列表
- final int mStackId;
- int mDisplayId;
- ActivityRecord mPausingActivity //正在pause
- ActivityRecord mLastPausedActivity
- ActivityRecord mResumedActivity  //已经resumed
- ActivityRecord mLastStartedActivity

所有前台stack的mResumedActivity的state == RESUMED, 则表示allResumedActivitiesComplete, 此时mLastFocusedStack = mFocusedStack;

### 2.4 ActivityStackSupervisor

- ActivityStack mHomeStack //桌面的stack
- ActivityStack mFocusedStack //当前聚焦stack
- ActivityStack mLastFocusedStack //正在切换
- SparseArray<ActivityDisplay> mActivityDisplays  //displayId为key
- SparseArray<ActivityContainer> mActivityContainers // mStackId为key

home的栈ID等于0,即HOME_STACK_ID = 0;

## 三. Activity栈关系

### 3.1 Stack组成图

Activity栈结构体的组成关系，[点击查看大图](http://www.gityuan.com/images/ams/activity/ams_relations.jpg)

![ams_relations](/images/ams/activity/ams_relations.jpg)

- 一般地，对于没有分屏功能以及虚拟屏的情况下，ActivityStackSupervisor与ActivityDisplay都是系统唯一；
- ActivityDisplay主要有Home Stack和App Stack这两个栈；
- 每个ActivityStack中可以有若干个TaskRecord对象；
- 每个TaskRecord包含如果若干个ActivityRecord对象；
- 每个ActivityRecord记录一个Activity信息。

(1)正向关系链表：

    ActivityStackSupervisor.mActivityDisplays
    -> ActivityDisplay.mStacks
    -> ActivityStack.mTaskHistory
    -> TaskRecord.mActivities
    -> ActivityRecord

(2)反向关系链表：

    ActivityRecord.task
    -> TaskRecord.stack
    -> ActivityStack.mStackSupervisor
    -> ActivityStackSupervisor

注：ActivityStack.mDisplayId可找到所对应的ActivityDisplay；


## 四. 启动过程

Activity启动与停止流程，[点击查看大图](http://www.gityuan.com/images/ams/activity/Seq_activity.jpg)

![Seq_activity](/images/ams/activity/Seq_activity.jpg)

Activity的pause情况：

- 当Activity A启动到Activity B，则需要pause掉Activity A;
- 当系统需要进入休眠状态或许shutdown的过程；
- 当activity需要finish的过程。

Activity的stop情况：

- 当Activity处于不可见状态，则需要stop该Activity;
- 为了更好的用户体验，先resume新的Activity，再待进入idle状态(即没有用户操作)再去stop旧的Activity;

更多源码详细过程，见[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)
