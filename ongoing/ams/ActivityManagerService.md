---
layout: post
title:  "ActivityManagerService"
date:   2016-01-01 14:09:12
categories: android
excerpt:  ActivityManagerService
---

* content
{:toc}

---

> 本文基于Android 6.0的源代码，来分析ActivityManagerService服务


## ActivityManagerService

boolean mProcessesReady = false;    AMS.systemReady()
boolean mSystemReady = false;    AMS.systemReady()
boolean mBooting = false;  AMS.systemReady()桌面启动时为true,  ASS.checkFinishBootingLocked()为false, AMS.ensureBootCompleted为false
boolean mBooted = false;  ASS.checkFinishBootingLocked()为true, AMS.ensureBootCompleted为true.


## 广播情况

- ACTION_SCREEN_ON: Notifier.java中的 sendWakeUpBroadcast, 亮灭屏广播. 这是order广播;
- ACTION_TIME_TICK:  AlarmManagerService.java的onStart, 发送time_tick广播;
- ACTION_BOOT_COMPLETED:  UserController.java的 finishUserUnlockedCompleted, 这是order广播;



### 3.2 继承关系

    PackageItemInfo
        ApplicationInfo
        ComponentInfo
            ActivityInfo
            ServiceInfo
            ProviderInfo
        InstrumentationInfo
        PermissionInfo
        PermissionGroupInfo


### CPU

CpuBinder的核心方法：

	ProcessCpuTracker.printCurrentLoad()
	ProcessCpuTracker.printCurrentState()

最终还是通过解析节点/proc/stat


### CPU

dumpsys cpuinfo

cat /proc/stat
cat /proc/loadavg

	root@X3c70:/proc # cat loadavg
	21.81 12.62 8.34 25/1515 11757

其中1515的线程，25个

### Memory

dumpsys meminfo
cat /proc/meminfo

### IO

vmstat

### process

dumpsys procstats

### 重要图

![ams_binder_class](/images/ams/ams_binder_class.jpg)
