onDestroy触发时机:
    - AS.destroyActivityLocked
    - 输出Event Log: AM_DESTROY_ACTIVITY

reason:

    stop-config  // activityStoppedLocked
    config
    stop-except // stopActivityLocked() 发生异常
    always-finish // 用户设置每次都finish
    finish-imm //
    finish-idle // ASS.activityIdleInternalLocked
    app-req //
    low-mem //  releaseSomeActivities
