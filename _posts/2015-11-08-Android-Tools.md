---
layout: post
title:  "Android工具(内存)"
date:   2015-11-02 22:10:54
categories: android
excerpt:  Android 工具
---

* content
{:toc}


---

## 一、内存
内存相关工具：
Memory Monitor, Heap Viewer, Allocation Tracker， dumpsys meminfo

### 1. Heap Viewer工具

堆内存查看工具，用于监控App的某一时刻的内存堆上的具体使用情况，从而帮助找出内存泄露。

#### 1.1 数据获取
打开Android Studio，进行如下操作，则生成堆快照文件。 生成的文件名格式为Snapshot-yyyy.mm.dd-hh.mm.ss.hprof。
![Dump Java Heap](http://i.imgur.com/95smxLR.png)

#### 1.2 数据分析

### 2. Allocation tracker工具

内存分配追踪工具，用于追踪一段时间的内存分配使用情况，能够知道执行一些列操作后，有哪些对象被分配空间。知道这些分配能使你调整相关的方法调用来优化app性能与内存使用。

#### 2.1 数据获取
打开Android Studio，点击"start Allocation Tracking"，开始追踪从当前时间点的内存分配情况，再次点击该按钮，将停止追踪内存分配情况，并生成堆快照文件。 生成的文件名格式为Allocation-yyyy.mm.dd-hh.mm.ss.alloc。
![Dump Java Heap](http://i.imgur.com/95smxLR.png)

#### 2.2 数据分析

### 3. dumpsys meminfo
	adb shell dumpsys meminfo <package_name|pid> [-d]


