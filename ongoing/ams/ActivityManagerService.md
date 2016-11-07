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


**相关源码**

	framework/base/services/core/java/com/android/server/am/ActivityManagerService.java


## ActivityManagerService


### 1. 超时参数

ActivityManagerService中有如下超时参数

|参数|取值|解释
|---|----|---|
|KEY_DISPATCHING_TIMEOUT |5s|按键事件分发
|BROADCAST_FG_TIMEOUT |10s|前台广播
|BROADCAST_BG_TIMEOUT |60s|后台广播
|APP_SWITCH_DELAY_TIME  |5s| APP切换
|PROC_START_TIMEOUT |10s|进程启动
|CONTENT_PROVIDER_PUBLISH_TIMEOUT |10s|内容提供
|GC_TIMEOUT |5s|垃圾回收
|GC_MIN_INTERVAL |60s|连续GC的最小间隔
|BATTERY_STATS_TIME |30min|电池统计
|MONITOR_CPU_MIN_TIME |5min|CPU监控

另外，还有一些重要的超时参数
ActiveServices.SERVICE_TIMEOUT = 20*1000

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


### 杀进程

Process.killProcessGroup（uid, pid）;
