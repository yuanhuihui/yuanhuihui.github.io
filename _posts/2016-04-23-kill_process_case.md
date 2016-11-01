---
layout: post
title:  "AMS杀进程场景之汇总"
date:   2016-04-23 11:20:00
catalog:  true
tags:
    - android
    - binder
    - process

---

> 基于Android 6.0源码剖析，统计AMS所有可能杀进程的场景.



### 一.场景汇总表

[理解杀进程的实现原理](http://gityuan.com/2016/04/16/kill-signal/), 介绍了杀进程的过程, 接下来本文介绍系统framework层, ActivityManagerService在哪些场景会调用ProcessRecord.java中的kill()方法来杀进程.

    void kill(String reason, boolean noisy) {
        if (!killedByAm) {
            if (noisy) {
                Slog.i(TAG, "Killing " + toShortString() + " (adj " + setAdj + "): " + reason);
            }
            //调用该方法,则会输出EventLog, 最后一个参数reason代表是通过何在方法触发kill
            EventLog.writeEvent(EventLogTags.AM_KILL, userId, pid, processName, setAdj, reason);
            Process.killProcessQuiet(pid);
            Process.killProcessGroup(info.uid, pid);
            if (!persistent) {
                killed = true;
                killedByAm = true;
            }
        }
    }

其中杀进程的原因(reason)有很多种形式, 如下表:

#### 表1

|方法|reason|含义|
|---|---|---|
|appNotResponding|anr||
|appNotResponding|bg anr||
|handleAppCrashLocked|crash||
|crashApplication|crash||
|processStartTimedOutLocked|start timeout||
|processContentProviderPublishTimedOutLocked|timeout publishing content providers||
|removeDyingProviderLocked|depends on provider `cpr.name` in dying proc `processName`||

#### 表2

|方法|reason|含义|
|---|---|---|
|forceStopPackageLocked|stop user `userId`||
|forceStopPackageLocked|stop `packageName`||
|killBackgroundProcesses|kill background||
|killAllBackgroundProcesses|kill all background||
|killUid|kill uid||
|killUid|Permission related app op changed||
|killAppAtUsersRequest|user request after error||
|killProcessesBelowAdj|setPermissionEnforcement||

#### 表3

|方法|reason|含义|
|---|---|---|
|trimApplications|empty||
|applyOomAdjLocked|remove task||
|updateOomAdjLocked|cached #`numCached`||
|updateOomAdjLocked|empty #`numEmpty`||
|updateOomAdjLocked|empty for `tableime`s||
|updateOomAdjLocked|isolated not needed||


#### 表4

|方法|reason|含义|
|---|---|---|
|cleanUpRemovedTaskLocked|remove task||
|attachApplicationLocked|error during init||
|systemReady|system update done||
|getProcessRecordLocked|`lastCachedPss`k from cached||
|performIdleMaintenance|idle maint (pss `lastPss`  from `initialIdlePss`)||
|checkExcessivePowerUsageLocked|excessive wake held ||
|checkExcessivePowerUsageLocked|excessive cpu ||



### 二.用法

reason对于分析问题很重要, 比如

    am_kill : [0,26328,com.gityuan.app,0,stop com.gityuan.app]

这是Eventlog,可知最后一个参数**stop com.gityuan.app**, 代表的是reason = stop `packageName`, 那么显然这个app是由于调用forceStopPackageLocked而被杀.

未完....
