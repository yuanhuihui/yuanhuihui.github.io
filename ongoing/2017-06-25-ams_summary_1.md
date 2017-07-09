---
layout: post
title:  "AMS总结(一)"
date:   2017-06-25 22:11:12
catalog:  true
tags:
    - android

---

> 从另一个维度，简要总结下四大组件的超时统计区间，以及Handler情况。

## 一. Serivce

|序号|App端方法|生命周期|计时起点|计时终点
|---|---|---|---|
|1|AT.handleCreateService|onCreate|AS.realStartServiceLocked| serviceDoneExecuting|
|2|AT.handleServiceArgs|onStartCommand|AS.sendServiceArgsLocked| serviceDoneExecuting|
|3|AT.handleBindService|onBind/onRebind|AS.requestServiceBindingLocked| serviceDoneExecuting|
|4|AT.handleUnbindService|onUnbind|AS.removeConnectionLocked| serviceDoneExecuting|
|5|AT.handleStopService|onDestroy|AS.bringDownServiceLocked| serviceDoneExecuting|

说明:

- 其中AS是指ActiveServices；
- 方法1,2,5组成startService/stopService方式的生命周期;
- 方法1,3,4,5组成bindService/unbindService方式的生命周期;
- 每一个生命周期回调方法ANR情况
    - 计时方式: 起点是对端方法, 终点是serviceDoneExecuting()方法
    - 前台进程启动的service不允许超过20s(ActiveServices.SERVICE_TIMEOUT)
    - 后台进程启动的service不允许超过200s
    - 前后台判断标准callerFg = callerApp.setSchedGroup != Process.THREAD_GROUP_BG_NONINTERACTIVE;
- 必须等到QueuedWork执行完成才结束的生命周期：
  - handleServiceArgs
  - handleServiceArgs

另外, AS.bringDownServiceLocked过程也会触发handleUnbindService.

## 二. Broadcast

|序号|App端方法|生命周期|System端方法|计数终点
|---|---|---|---|
|1|handleReceiver|onReceive|BQ.processCurBroadcastLocked|sendFinished|
|2|ReceiverDispatcher.Args.run|onReceive|BQ.performReceiveLocked|sendFinished|


说明:

- 其中BQ是指BroadcastQueue，ReceiverDispatcher是LoadedApk的静态内部类；
- 静态注册的广播接收者:
    - 生命周期回调为handleReceiver；
    - 不论何种广播都会调用sendFinished();
- 动态注册的广播接收者:
    - 周末周期回调为ReceiverDispatcher.Args.run；
    - 发送的是串行广播, 则会调用sendFinished();
    - 发送的是并行广播, 则无需调用sendFinished();
- 广播ANR的情况:
    - 计时方式: 在广播没有处理完之前, 采用周期为mTimeoutPeriod的轮询方式
    - 静态注册的广播, 以及发送的本身就是串行广播, 都会采用串行方式处理.
    - 串行方式ANR情况1：某个广播总处理时间 > 2* receiver总个数 * mTimeoutPeriod;
        - 前台队列mTimeoutPeriod默认为10s(AMS.BROADCAST_FG_TIMEOUT)，
        - 后台队列mTimeoutPeriod默认为60s;
        - 前后台判定isFg = (intent.getFlags() & Intent.FLAG_RECEIVER_FOREGROUND) != 0;
    - 串行方式ANR情况2：某个receiver的执行时间超过mTimeoutPeriod；
- 必须等到QueuedWork执行完成才结束的生命周期：
  - handleReceiver

## 三. ContentProvider

|序号|App端方法|生命周期|计数起点|计数终点|
|---|---|---|---|
|1|installProvider|onCreate|AMS.attachApplicationLocked|AMS.publishContentProviders|

说明：Provider发布过程，从计数起点到终点，当超过10s(AMS.CONTENT_PROVIDER_PUBLISH_TIMEOUT)没有执行完成，则会弹出ANR;


## 四. Activity

|序号|App端方法|生命周期|计时起点|计时终点
|---|---|---|---|
|1|handleLaunchActivity|onCreate/onStart/onResume||||
|2|handleResumeActivity|onResume|||
|3|handlePauseActivity|onPause||startPausingLocked|activityPausedLocked|
|4|handleStopActivity|onStop|stopActivityLocked|activityStoppedLocked|
|5|handleDestroyActivity|onDestroy||destroyActivityLocked|activityDestroyedLocked|
|6|handleRelaunchActivity||||
|7|handleNewIntent|onNewIntent|||
|8|handleSleeping||||
|9|handleSendResult|onActivityResult||||

说明:

- onPause
    - 当超时500ms没有执行完成handlePauseActivity(), 则直接进入AS.activityPausedLocked();
- ActivityRecord.setSleeping
    - 该过程会触发handleSleeping.
- 必须等到QueuedWork执行完成才结束的生命周期：
  - handleStopActivity
  - handleSleeping

#### 4.2 Activity超时常量

|事件|Timeout|文件|
|---|---|
|LAUNCH_TICK|0.5s|ActivityStack|
|PAUSE_TIMEOUT|0.5s|ActivityStack|
|STOP_TIMEOUT|10s|ActivityStack|
|DESTROY_TIMEOUT|10s|ActivityStack|
|APP_SWITCH_DELAY_TIME  |5s| AMS|
|SLEEP_TIMEOUT| 5s|ASS|
|IDLE_TIMEOUT|10s|ASS|
|LAUNCH_TIMEOUT|10s|ASS|

注：ASS是指ActivityStackSupervisor.


## 三. Handler角度

### 3.1 四大组件相关Handler

|Handler|数据类型|运行线程|
|---|---|---|
|AMS.mUiHandler|UiHandler|android.ui|
|AMS.mBgHandler|Handler|android.bg|
|AMS.mHandler|MainHandler|ActivityManager|
|ASS.mHandler|ActivityStackSupervisorHandler|ActivityManager|
|AS.mHandler|ActivityStackHandler|ActivityManager|
|BroadcastQueue.mHandler|BroadcastHandler|ActivityManager|
|ActiveServices.mServiceMap|ServiceMap|ActivityManager|

说明：(以下所有跟超时相关的工作都运行在ActivityManager线程)

- AMS.MainHandler
  - 处理service、process、provider的超时问题；
- BroadcastHandler：
  - 处理broadcast的超时问题；
- ActivityStackSupervisorHandler：
  - 处理IDLE_TIMEOUT，SLEEP_TIMEOUT，LAUNCH_TIMEOUT
- ActivityStackHandler：
  - 处理PAUSE_TIMEOUT，STOP_TIMEOUT，DESTROY_TIMEOUT
  - 处理TRANSLUCENT_TIMEOUT，LAUNCH_TICK
- ActiveServices.ServiceMap：
  - 处理BG_START_TIMEOUT
  
唯独input的超时处理过程并非发生在ActivityManager线程，而是inputDispatcher线程发生的。

### 3.2 UI相关Handler

对于Anr/Crash/error等基本所有错误、警告灯相关弹出框都运行在android.ui线程

- BaseErrorDialog.mHandler
- AppErrorDialog
- StrictModeViolationDialog 
- AppNotRespondingDialog
- AppWaitingForDebuggerDialog
- UserSwitchingDialog
