

以下都是串行广播：

- ACTION_SCREEN_ON/ ACTION_SCREEN_OFF:Notifier.java中的 sendWakeUpBroadcast
- ACTION_TIME_TICK:  AlarmManagerService.java的onStart
- ACTION_BOOT_COMPLETED:  UserController.java的finishUserUnlockedCompleted,
