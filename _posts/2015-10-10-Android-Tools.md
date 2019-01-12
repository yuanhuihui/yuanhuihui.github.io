---
layout: post
title:  "AndroidStudio 内存工具"
date:   2015-10-10 21:10:21
catalog:  true
tags:
    - android
    - memory
    - tool

---


## 一、内存工具

Android Studio提供了强大的分析功能，关于内存分析工具包含：
Memory Monitor, Heap Viewer, Allocation Tracker

### 1. Memory Monitor

![memory-monitor](/images/android-tools/memory-monitor.png)


### 2. Heap Viewer

堆内存查看工具，用于监控App的某一时刻的内存堆上的具体使用情况，从而帮助找出内存泄露。

**用法**
![heap-viewer](\images\android-tools\heap-viewer.png)
打开Android Studio，进行上述操作，则生成堆快照文件。 生成的文件名格式为Snapshot-yyyy.mm.dd-hh.mm.ss.hprof。

### 3. Allocation tracker

内存分配追踪工具，用于追踪一段时间的内存分配使用情况，能够知道执行一些列操作后，有哪些对象被分配空间。知道这些分配能使你调整相关的方法调用来优化app性能与内存使用。

**用法**

![allocation-tracker](\images\android-tools\allocation-tracker.png)

打开Android Studio，点击"start Allocation Tracking"，开始追踪从当前时间点的内存分配情况，再次点击该按钮，将停止追踪内存分配情况，并生成堆快照文件。 生成的文件名格式为Allocation-yyyy.mm.dd-hh.mm.ss.alloc。

另外，可通过各种[Android内存分析命令](http://gityuan.com/2016/01/02/memory-tool/)来分析当前内存使用情况以及内存泄露情况。
