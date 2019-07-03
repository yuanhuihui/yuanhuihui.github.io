---
layout: post
title:  "AMS综述"
date:   2016-01-01 14:09:12
categories: android
excerpt:  ActivityManagerService
---

* content
{:toc}

---

### CPU

CpuBinder的核心方法：

	ProcessCpuTracker.printCurrentLoad()
	ProcessCpuTracker.printCurrentState()

最终还是通过解析节点/proc/stat


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
