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



### 一. 杀进程场景

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


reason对于分析问题很重要, 实例说明:

    am_kill : [0,26328,com.gityuan.app,0,stop com.gityuan.app]

这是Eventlog,可知最后一个参数**stop com.gityuan.app**, 代表的是reason = stop `packageName`, 那么显然这个app是由于调用forceStopPackageLocked而被杀.
先看重点说说force-stop

#### 1.1 force-stop

对于force-stop系统这把杀进程的利器, 还会额外出现一个reason来更详细的说明触发force-stop的原因.

    Slog.i(TAG, "Force stopping " + packageName + " appid=" + appId + " user=" + userId + ": " + reason);

以下场景都会调用force-stop, 输出reason表格如下:

|方法|reason|含义|
|---|---|---|
|AMS.forceStopPackage|from pid `callingPid`||
|AMS.finishUserStop|finish user||
|AMS.clearApplicationUserData|clear data||
|AMS.broadcastIntentLocked|storage unmount||
|AMS.finishBooting|query restart||
|AMS.finishInstrumentationLocked|finished inst|evenPersistent|
|AMS.setDebugApp|set debug app|evenPersistent|
|AMS.startInstrumentation|start instrevenPersistent|
|PKMS.deletePackageLI|uninstall pkg||
|PKMS.movePackageInternal|move pkg||
|PKMS.replaceSystemPackageLI|replace sys pkg||
|PKMS.scanPackageDirtyLI|replace pkg||
|PKMS.scanPackageDirtyLI|update lib||
|PKMS.setApplicationHiddenSettingAsUser|hiding pkg||
|MountService.killMediaProvider|vold reset||

PKMS服务往往是调用killApplication从而间接调用forceStopPackage方法.

当然除了force-stop, 杀进程的原因(reason)有很多种形式, 如下:

#### 1.2 异常杀进程

|方法|reason|含义|
|---|---|---|
|appNotResponding|anr|ANR|
|appNotResponding|bg anr|ANR|
|handleAppCrashLocked|crash|CRASH|
|crashApplication|crash|CRASH|
|processStartTimedOutLocked|start timeout||
|processContentProviderPublishTimedOutLocked|timeout publishing content providers||
|removeDyingProviderLocked|depends on provider `cpr.name` in dying proc `processName`||


#### 1.3 主动杀进程

|方法|reason|含义|
|---|---|---|
|forceStopPackageLocked|stop user `userId`|
|forceStopPackageLocked|stop `packageName`|
|killBackgroundProcesses|kill background||
|killAllBackgroundProcesses|kill all background||
|killAppAtUsersRequest|user request after error|FORCE_CLOSE|
|killUid|kill uid|PERMISSION|
|killUid|Permission related app op changed|PERMISSION|
|killProcessesBelowAdj|setPermissionEnforcement||
|killApplicationProcess|-|直接杀|
|killPids|Free memory||
|killPids|Unknown||
|killPids|自定义|调用者自定义|

#### 1.4 调度杀进程

|方法|reason|含义|
|---|---|---|
|trimApplications|empty||
|applyOomAdjLocked|remove task||
|updateOomAdjLocked|cached #`numCached`||
|updateOomAdjLocked|empty #`numEmpty`||
|updateOomAdjLocked|empty for `tableime`s||
|updateOomAdjLocked|isolated not needed||


#### 1.5 其他杀进程

|方法|reason|含义|
|---|---|---|
|cleanUpRemovedTaskLocked|remove task||
|attachApplicationLocked|error during init||
|systemReady|system update done||
|getProcessRecordLocked|`lastCachedPss`k from cached||
|performIdleMaintenance|idle maint (pss `lastPss`  from `initialIdlePss`)||
|checkExcessivePowerUsageLocked|excessive wake held ||
|checkExcessivePowerUsageLocked|excessive cpu ||
|scheduleCrash|scheduleCrash for `message` failed|

### 二. 杀进程手段


以上介绍的所有杀进程都是调用ProcessRecord.kill()方法, 必然会输出相应的EventLog.那么还有哪些场景的杀进程不会输出log呢:

	Process.killProcess(int pid) //可杀任何指定进程,或者直接发signal 
	adb shell kill -9 <pid>  //可杀任何指定的进程  
    直接lmk杀进程

也就是说进程被杀而无log输出,那么可能是通过直接调用kill或者发信号, 再或许是lmk所杀.
 
### 三. 小结

杀进程log举例:

    am_kill : [0,3226,com.android.quicksearchbox,13,empty #13]
    Force stopping com.android.providers.media appid=10010 user=-1: vold reset
    Killing 5769:com.android.mms/u0a21 (adj 15): empty #13
    processes xxx at adjustment 1 //杀adj=1的进程


进程记录信息:

|进程结构体|数据类型|说明|
|---|---|---|
|mProcessNames| ProcessMap<ProcessRecord>|根据进程名和uid查询|
|mPidsSelfLocked|SparseArray<ProcessRecord>|根据pid查询|
|mLruProcesses| ArrayList<ProcessRecord>|foreach调用|

评估:

- killPids: 这个比较灵活,只需要指定pid即可杀进程, 也可定制kill reason.
- forceStopPackage: 杀进程最为彻底;
- killBackgroundProcesses: 只杀adj > SERVICE_ADJ(5)的进程;


未完待续...