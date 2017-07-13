
## 一. Serivce

|序号|方法|生命周期|QueuedWork|serviceDoneExecuting|对端方法
|---|---|---|---|
|1|handleCreateService|onCreate|-|√|AS.realStartServiceLocked|
|2|handleServiceArgs|onStartCommand|√|√|AS.sendServiceArgsLocked|
|3|handleBindService|onBind/onRebind|-|√|AS.requestServiceBindingLocked|
|4|handleUnbindService|onUnbind|-|√|AS.removeConnectionLocked|
|5|handleStopService|onDestroy|√|√|AS.bringDownServiceLocked|

说明:

- 方法1,2,5组成startService/stopService方式的生命周期;
- 方法1,3,4,5组成bindService/unbindService方式的生命周期;
- 每一个生命周期回调方法ANR情况
    - 计时方式: 起点是对端方法, 终点是serviceDoneExecuting()方法
    - 前台进程启动的service不允许超过20s
    - 后台进程启动的service不允许超过200s

另外, AS.bringDownServiceLocked过程也会触发handleUnbindService.

ActiveServices.java

## 二. Broadcast

|序号|广播接收者|方法|生命周期|QueuedWork|sendFinished|对端方法
|---|---|---|---|
|1|静态注册|handleReceiver|onReceive|√|√|BQ.processCurBroadcastLocked|
|2|动态注册|ReceiverDispatcher.Args.run|onReceive|-|?|BQ.performReceiveLocked|


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
        - 其中mTimeoutPeriod，前台队列默认为10s，后台队列默认为60s;
    - 串行方式ANR情况2：某个receiver的执行时间超过mTimeoutPeriod；

另外, 说明ReceiverDispatcher是LoadedApk的静态内部类.

## 三. Activity

|序号|方法|生命周期|QueuedWork|计时起点|计时终点
|---|---|---|---|
|1|handleLaunchActivity|onCreate/onStart/onResume||||
|2|handleResumeActivity|||||
|3|handlePauseActivity|onPause||startPausingLocked|activityPausedLocked|
|4|handleStopActivity||√|stopActivityLocked|activityStoppedLocked|
|5|handleDestroyActivity|||destroyActivityLocked|activityDestroyedLocked|
|6|handleRelaunchActivity|||||
|7|handleNewIntent|||||
|8|handleSleeping||√|||
|9|handleSendResult||||||

说明:

- onPause
    - 当超时500ms没有执行完成handlePauseActivity(), 则直接进入AS.activityPausedLocked();
- ActivityRecord.setSleeping
    - 该过程会触发handleSleeping.

|事件|Timeout|文件|
|---|---|
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
    - order广播;
    - 并且是前台的;
- ACTION_TIME_TICK:  AlarmManagerService.java的onStart, 发送time_tick广播;
- ACTION_BOOT_COMPLETED:  UserController.java的 finishUserUnlockedCompleted,
    - order广播;
