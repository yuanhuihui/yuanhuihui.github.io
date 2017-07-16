---
layout: post
title:  "AMS调试篇"
date:   2017-07-01 2:20:00
catalog:  true
tags:
    - android

---


## 一.概述

前面介绍过AMS相关的一些数据结构，每个数据结构有大量的成员变量，为了查询当前手机运行时状态的
变化值，可以通过dumpsys activity命令来完成，该方法最终是调用AMS.dump()方法。

根据dumpsys activity传递不同的参数， 对于AMS.dump便会输出相应的对象信息。
具体可以跟哪些参数呢，见Help:

### 1.1 Help

    gityuan:/ $ dumpsys activity -h
    Activity manager dump options:
      [-a] [-c] [-p PACKAGE] [-h] [WHAT] ...
      WHAT may be one of:
        a[ctivities]: activity stack state
        
        r[recents]: recent activities state
        b[roadcasts] [PACKAGE_NAME] [history [-s]]: broadcast state
        
        broadcast-stats [PACKAGE_NAME]: aggregated broadcast statistics
        i[ntents] [PACKAGE_NAME]: pending intent state
        p[rocesses] [PACKAGE_NAME]: process state
        o[om]: out of memory management
        perm[issions]: URI permission grant state
        
        prov[iders] [COMP_SPEC ...]: content provider state
        provider [COMP_SPEC]: provider client-side state
        
        s[ervices] [COMP_SPEC ...]: service state
        service [COMP_SPEC]: service client-side state
        package [PACKAGE_NAME]: all state related to given package
        all: dump all activities
        top: dump the top activity
      WHAT may also be a COMP_SPEC to dump activities.
      COMP_SPEC may be a component name (com.foo/.myApp),
        a partial substring in a component name, a
        hex object identifier.
        
        
      -a: include all available server state.
      -c: include client state.
      -p: limit output to given package.
      --checkin: output checkin format, resetting data.
      --C: output checkin format, not resetting data.

### 参数
options可选值：

- `-a`：dump所有；
- `-c`：dump客户端；
- `-p [package]`：dump指定的包名；

第一个是限定条件， 可以是dumpAll，dumpAll，dumpPackage，dumpCheckin

cmd可取值：

- a[ctivities]: activity的栈信息
- r[recents]: recent activities信息
- b[roadcasts] [PACKAGE_NAME] [history [-s]]: broadcast信息
- i[ntents] [PACKAGE_NAME]: pending intent信息
- p[rocesses] [PACKAGE_NAME]: process信息
- o[om]: oom信息
- perm[issions]: URI permission grant state
- prov[iders] [COMP_SPEC ...]: content provider state
- provider [COMP_SPEC]: provider client-side state
- s[ervices] [COMP_SPEC ...]: service state
- as[sociations]: tracked app associations
- service [COMP_SPEC]: service客户端信息
- package [PACKAGE_NAME]: package相关信息
- all: 所有的activities信息
- top: top activity信息
- write: write all pending state to storage
- track-associations: enable association tracking
- untrack-associations: disable and clear association tracking

## activity


 

  AMS.dump
  AMS.dumpActivitiesLocked
  ASS.dumpActivitiesLocked
  AS.dumpActivitiesLocked
  ASS.dumpHistoryList
  TR.dump
  AR.dump
  AT.dumpActivity
  AT.handleDumpActivity
  Activity.dump
  Activity.dumpInner
  FragmentController.dumpLoaders
  FragmentManager.dump
  ViewRootImpl.dump
  Looper.dump
  MessageQueue.dump
  ASS.dumpHistoryList
  ASS.printThisActivity
  ASS.printThisActivity
  ASS.dump





输出格式：

Display #0
  Stack #1
  Task id #10
  

  TaskRecord{e6d7a8e #156 A=com.yhh.analyser U=0 sz=1}
  userId=0 effectiveUid=1000 mCallingUid=1000 mCallingPackage=com.lenovo.analyser
  realActivity=com.tiger.cpu/.Main

- TaskRecord{Hashcode #TaskId Affinity UserId=0 task中的Activity个数=1}；
- effectiveUid为当前task所属Uid，mCallingUid为调用者Uid，mCallingPackage为调用者包名；
- realActivity:task中的已启动额Activity组件名；



ProcessRecord{7c8a2af 12265:com.yhh.analyser/1000}

ProcessRecord{Hashcode pid:进程名/uid}

### Service

  AMS.dump
  ActiveServices.dumpService
  ServiceRecord.dump
  ApplicationThread.dump

### broadcasts


  AMS.dump
  AMS.dumpBroadcastsLocked
  BroadcastQueue.dumpLocked
  BroadcastRecord.dump
  ResolveInfo.dump
  ActivityInfo.dump
  ServiceInfo.dump
  ProviderInfo.dump
  Handler.dump
  Looper.dump


### provider

### package

### oom

  AMS.dump
  AMS.dumpOomLocked
  AMS.printOomLevel
  AMS.dumpProcessOomList
  AMS.dumpProcessesToGc


### processes

  AMS.dump
  AMS.dumpProcessesLocked
  ProcessRecord.dump

### recents

  AMS.dump
  AMS.dumpRecentsLocked
  TaskRecord.dump



## 其他


  dumpsys package
  dumpsys input
  dumpsys window
  dumpsys alarm

  dumpsys processinfo
  dumpsys permission
  dumpsys meminfo
  dumpsys cpuinfo
  dumpsys dbinfo
  dumspys gfxinfo

  dumpsys power
  dumpsys battery
  dumpsys batterystats
  dumpsys batteryproperties

  dumpsys procstats	
  dumpsys diskstats
  dumpsys graphicsstats
  dumpsys usagestats
  dumpsys devicestoragemonitor
  dumpsys dropbox

  dumpsys appops
  dumpsys SurfaceFlinger



### dumpsys cpuinfo

MEmBinder

ProcessCpuTracker.java

每个更新是通过update()方法，而该方法只有在

- AMS.updateCpuStatsNow
- AMS.dumpStackTraces (2次)
- ProcessCpuTracker.init (初始化1次)
- LoadAverageService.handleMessage (msg=1)


dumpStackTraces，会出现在

- appNotResponding
- Watchdog.run (waitState==WAITED_HALF)

AMS.updateCpuStatsNow，只会在 

- appNotResponding
- batteryNeedsCpuUpdate
- batteryPowerChanged
- checkExcessivePowerUsageLocked
- dumpApplicationMemoryUsage
- mBgHandler.handleMessage  (COLLECT_PSS_BG_MSG)
- reportMemUsage
- CpuTracker.run

**小结论：**先dumpsys meminfo, 再dumpsys cpuinfo. （过程不能插拔USB线）



### 组件的发起端

BroadcastRecord
    final ProcessRecord callerApp; // process that sent this
    final String callerPackage; // who sent this
    final int callingPid;   // the pid of who sent this
    final int callingUid;   // the uid of who sent this

  
  
ActivityRecord
  final int launchedFromUid; // always the uid who started the activity.
  final String launchedFromPackage; // always the package who started the activity.
  
service和provider由谁拉起的,并不知道.



Activity
provider
service (start/bind/startServiceInPackage)
