---
layout: post
title:  "AMS之dumpsys篇"
date:   2017-07-02 22:20:00
catalog:  true
tags:
    - android

---


> 基于Android 7.0的源码分析

## 一.概述

前面介绍过AMS相关的一些数据结构，每个数据结构有大量的成员变量，为了查询当前手机运行时状态的
变化值，可以通过dumpsys activity命令来完成，该方法最终是调用AMS.dump()方法。

[dumpsys命令用法](http://gityuan.com/2016/05/14/dumpsys-command/)简要介绍过dumpsys命令
的基本用法，以及系统服务列表信息，那么本文重点介绍AMS。
根据dumpsys activity传递不同的参数， 对于AMS.dump便会输出相应的对象信息。
具体可以跟哪些参数.

#### 1.1 命令格式

    dumpsys activity [options] [WHAT]

其中options为可选项，以`-`开头， 主要有以下几类：

|options|含义|
|---|---|
|-a|包括所有可用Server状态|
|-c|包括Client状态，即App端情况|
|-p PACKAGE|限定输出指定包名|

#### 1.2 WHAT参数

列举常见的WHAT参数：

|序号|WHAT|解释|对应源码
|---|---|---|
|1|a[ctivities]|activity状态|dumpActivitiesLocked()|
|2|b[roadcasts] [PACKAGE_NAME]|broadcast状态|dumpBroadcastsLocked()|
|3|s[ervices] [COMP_SPEC ...]| service状态|newServiceDumperLocked().dumpLocked|
|4|prov[iders] [COMP_SPEC ...]|content provider状态|dumpProvidersLocked()|
|5|p[rocesses] [PACKAGE_NAME]| 进程状态|dumpProcessesLocked()|
|6|o[om]|内存管理|dumpOomLocked()|
|7|i[ntents] [PACKAGE_NAME]|pending intent状态|dumpPendingIntentsLocked()|
|8|r[ecents]|最近activity|dumpRecentsLocked()|
|9|perm[issions]| URI授权情况|dumpPermissionsLocked()|
|10|all|所有activities信息|dumpActivity()|
|11|top|顶部activity信息|dumpActivity()|
|12|package| package相关信息|dump()|

其中PACKAGE_NAME是指可跟包名，COMP_SPEC是指可跟具体组件信息，中括号是指缩写字母；


## 二. dumpsys activity

前面介绍dumpsys activity根据后面跟着的不同参数则输出相应的内容，当不跟任何参数，
`dumpsys activity`等价于依次输出下面8条命令：

    dumpsys activity intents
    dumpsys activity broadcasts //广播
    dumpsys activity providers  //provider
    dumpsys activity permissions
    dumpsys activity services  //服务
    dumpsys activity recents
    dumpsys activity activities //activity
    dumpsys activity processes

依次简要说明这8条命令：

### 2.1 intents

    //标志性开头，dumpPendingIntentsLocked
    ACTIVITY MANAGER PENDING INTENTS (dumpsys activity intents)

输出对象：

- PendingIntentRecord

### 2.2 broadcasts

    //标志性开头，dumpBroadcastsLocked
    ACTIVITY MANAGER BROADCAST STATE (dumpsys activity broadcasts)
        Registered Receivers：
        Receiver Resolver Table：
        Historical broadcasts [foreground]:
        Historical broadcasts summary [foreground]:
        Historical broadcasts [background]:
        Historical broadcasts summary [background]:
        Sticky broadcasts
        mHandler

主要输出的对象：

- ReceiverList, BroadcastFilter,
- IntentResolver,
- BroadcastQueue, BroadcastRecord
- Handler, Looper


### 2.3 provider

    //标志性开头，dumpProvidersLocked
    ACTIVITY MANAGER CONTENT PROVIDERS (dumpsys activity providers)
        Published single-user content providers (by class):
        Published user [n] content providers (by class):
        Single-user authority to provider mappings:
        User [n] authority to provider mappings:

主要输出的对象：

- ProviderMap
- ContentProviderRecord， ContentProviderConnection

### 2.4 permissions

    //标志性开头，dumpPermissionsLocked
    ACTIVITY MANAGER URI PERMISSIONS (dumpsys activity permissions)

主要输出的对象：

- UriPermission

### 2.5 Service

    //标志性开头，newServiceDumperLocked().dumpLocked
    ACTIVITY MANAGER SERVICES (dumpsys activity services)

主要输出的对象：

- ActiveServices,
- ServiceRecord, ConnectionRecord,ProcessRecord

### 2.6 recents

    //标志性开头，dumpRecentsLocked
    ACTIVITY MANAGER RECENT TASKS (dumpsys activity recents)

主要输出的对象：

- TaskRecord

### 2.7 activities

    //标志性开头，dumpActivitiesLocked
    ACTIVITY MANAGER ACTIVITIES (dumpsys activity activities)
        Display #0 (activities from top to bottom):
          Stack #0:
            Task id #[n]
              * Hist #[m]:
          Stack #1:


主要输出的对象：

- ActivityStackSupervisor, ActivityStack,
- TaskRecord, ActivityRecord
- ActivityThread, Activity
- ViewRootImpl
- Looper, MessageQueue

输出格式样例：

    //{Hashcode #TaskId Affinity UserId 该task的Activity个数}；
    TaskRecord{e6d7a8e #156 A=com.gityuan.demo U=0 sz=1}
    userId=0 effectiveUid=1000 mCallingUid=1000 mCallingPackage=android
    realActivity=com.gityuan.demo/.Blog

    //ProcessRecord{Hashcode pid:进程名/uid}
    ProcessRecord{7c8a2af 12265:com.gityuan.demo/1000}


### 2.8 processes

    //标志性开头，dumpProcessesLocked
    ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)
        All known processes:
        Isolated process list (sorted by uid):
        UID states:
        UID validation:
        Process LRU list (sorted by oom_adj, 60 total, non-act at 2, non-svc at 2):
        PID mappings:
        Foreground Processes:

主要输出的对象：

- AMS各种进程对象
- ProcessRecord, UidRecord
