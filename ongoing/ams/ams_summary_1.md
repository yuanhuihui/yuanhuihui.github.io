
## 一. Serivce

|序号|App端方法|生命周期|QueuedWork|serviceDoneExecuting|System端方法
|---|---|---|---|
|1|AT.handleCreateService|onCreate|-|√|AS.realStartServiceLocked|
|2|AT.handleServiceArgs|onStartCommand|√|√|AS.sendServiceArgsLocked|
|3|AT.handleBindService|onBind/onRebind|-|√|AS.requestServiceBindingLocked|
|4|AT.handleUnbindService|onUnbind|-|√|AS.removeConnectionLocked|
|5|AT.handleStopService|onDestroy|√|√|AS.bringDownServiceLocked|

说明:

- 方法1,2,5组成startService/stopService方式的生命周期;
- 方法1,3,4,5组成bindService/unbindService方式的生命周期;
- 每一个生命周期回调方法ANR情况
    - 计时方式: 起点是对端方法, 终点是serviceDoneExecuting()方法
    - 前台进程启动的service不允许超过20s(ActiveServices.SERVICE_TIMEOUT)
    - 后台进程启动的service不允许超过200s
- QueuedWork打勾项，是指该方法的结束必须等到QueuedWork执行完成，即所有SharedPreferences异步操作执行完成。

另外, AS.bringDownServiceLocked过程也会触发handleUnbindService.

注：AS是指ActiveServices.

## 二. Broadcast

|序号|App端方法|生命周期|QueuedWork|注册方式|sendFinished|System端方法
|---|---|---|---|
|1|handleReceiver|onReceive|√|√|静态注册|BQ.processCurBroadcastLocked|
|2|ReceiverDispatcher.Args.run|onReceive|-|?|动态注册|BQ.performReceiveLocked|


说明:

- 静态注册的广播接收者:
    - 不论何种广播都会调用sendFinished();
- 动态注册的广播接收者:
    - 发送的是串行广播, 则会调用sendFinished();
    - 发送的是并行广播, 则无需调用sendFinished();
- 广播ANR的情况:
    - 计时方式: 在广播没有处理完之前, 采用周期为mTimeoutPeriod的轮询方式
    - 静态注册的广播, 以及发送的本身就是串行广播, 都会采用串行方式处理.
    - 串行方式ANR情况1：某个广播总处理时间 > 2* receiver总个数 * mTimeoutPeriod;
        - 其中mTimeoutPeriod，前台队列默认为10s(AMS.BROADCAST_FG_TIMEOUT)，后台队列默认为60s;
    - 串行方式ANR情况2：某个receiver的执行时间超过mTimeoutPeriod；

注：ReceiverDispatcher是LoadedApk的静态内部类. BQ是指BroadcastQueue.

## 三. ContentProvider

|序号|App端方法|生命周期|计数起点|计数终点|
|---|---|---|---|
|1|installProvider|onCreate|AMS.attachApplicationLocked|AMS.publishContentProviders|

- Provider发布过程，从计数起点到终点，当超过10s(AMS.CONTENT_PROVIDER_PUBLISH_TIMEOUT)没有执行完成，则会弹出ANR;


## 四. Activity

|序号|App端方法|生命周期|QueuedWork|计时起点|计时终点
|---|---|---|---|
|1|handleLaunchActivity|onCreate/onStart/onResume||||
|2|handleResumeActivity|||||
|3|handlePauseActivity|onPause||startPausingLocked|activityPausedLocked|
|4|handleStopActivity||√|stopActivityLocked|activityStoppedLocked|
|5|handleDestroyActivity|||destroyActivityLocked|activityDestroyedLocked|
|6|handleRelaunchActivity|||||
|7|handleNewIntent|||||
|8|handleSleeping||√|||
|9|handleSendResult|onActivityResult|||||

说明:

- onPause
    - 当超时500ms没有执行完成handlePauseActivity(), 则直接进入AS.activityPausedLocked();
- ActivityRecord.setSleeping
    - 该过程会触发handleSleeping.

|事件|Timeout|文件|
|---|---|
<<<<<<< HEAD
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
- BroadcastHandler：
  - 处理broadcast的超时问题；
- ActivityStackSupervisorHandler：
  - 处理IDLE_TIMEOUT，SLEEP_TIMEOUT，LAUNCH_TIMEOUT
- ActivityStackHandler：
  - 处理PAUSE_TIMEOUT，STOP_TIMEOUT，DESTROY_TIMEOUT
  - 处理TRANSLUCENT_TIMEOUT，LAUNCH_TICK
- ActiveServices.ServiceMap：
  - 处理BG_START_TIMEOUT

  
可见，以上的超时都是在"ActivityManager", 也有例外，那就是input的超时是在inputDispatcher线程发生的。

### 其他

BaseErrorDialog.mHandler  --> android.ui
AppErrorDialog --> android.ui
StrictModeViolationDialog --> android.ui
AppNotRespondingDialog
AppWaitingForDebuggerDialog
UserSwitchingDialog

除了上述的,基本上所有的Anr/Crash/error等弹出都是运行在android.ui线程.
=======
|LAUNCH_TICK|0.5s|AS|
|PAUSE_TIMEOUT|0.5s|AS|
|STOP_TIMEOUT|10s|AS|
|DESTROY_TIMEOUT|10s|AS|
|APP_SWITCH_DELAY_TIME  |5s| AMS, APP切换|
|SLEEP_TIMEOUT| 5s| ASS, SLEEP_TIMEOUT_MSG|
|IDLE_TIMEOUT|10s| IDLE_TIMEOUT_MSG
|LAUNCH_TIMEOUT |10s| LAUNCH_TIMEOUT_MSG,释放wakelock|



## Broadcast

- ACTION_SCREEN_ON/ ACTION_SCREEN_OFF:
    - Notifier.java中的 sendWakeUpBroadcast, 亮灭屏广播.
    - 这是order广播;
    - 并且是前台的;
- ACTION_TIME_TICK:  AlarmManagerService.java的onStart, 发送time_tick广播;
- ACTION_BOOT_COMPLETED:  UserController.java的 finishUserUnlockedCompleted, 这是order广播;
>>>>>>> b75009a3079d2c55d5d6407d59565365a2bfe4be
