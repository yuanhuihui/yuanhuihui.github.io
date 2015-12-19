---
layout: post
title:  "Android进程"
date:   2015-12-18 22:10:40
categories: android
excerpt:  Android进程
---

* content
{:toc}


---

> 线程与进程的最大区别就是是否共享父进程的地址空间

## 一、概括

下展示一张Android整个启动过程图：

![process_status](\images\android-process\process_status.jpg)

### 1.1 父进程
在所有进程中，以父进程的姿态存在的进程主要有：

- **`kthreadd进程`**: 是所有内核进程的父进程
- **`init进程`**   ： 是所有用户进程的父进程(或者父父进程)
- **`zygote进程`** ： 是所有上层Java进程的父进程，另外`zygote`的父进程是`init`进程。

### 1.2 重量级进程
另外，还有3个重量级的进程：

- **`system_server`**：是由zygote孵化而来的，是zygote的首席大弟子，托起整个Java framework的所有service，比如ActivityManagerService, PowerManagerService等等。

- **`mediaserver`**：是由init孵化而来的，托起整个C++ framework的所有service，比如AudioFlinger, MediaPlayerService等等。

- **`servicemanager`**：是由init孵化而来的，是整个Binder架构(IPC)的大管家，所有大大小小的service都需要先请示servicemanager。

### 1.3 ps含义

在`adb shell`终端，输入 `ps`，可查看手机当前所有的进程状态，其中`ps`的英文全称是Process Status。
执行ps指令后，输出结果的每一列相应含义：

- USER：  进程的当前用户
- PID   ： 进程号
- PPID  ： 父进程ID
- VSIZE  ： 进程虚拟地址空间大小；(virtual size)
- RSS    ： 进程正在使用的物理内存大小；
- WCHAN  ： 当进程(或线程)处于休眠状态，则表示为内核地址；当处于运行状态，则显示为0。
- PC  ： 程序指针
- NAME:  进程名


## 二、进程

Android进程从大类来划分，可分为内核进程和用户进程。

### 2.1 内核进程

`kthreadd`进程（2号进程），是Linux系统的内核进程，是所有内核进程的鼻祖。

下面列举部分比较常见的内核进程：

|进程名|作用
|---|---|
|ksoftirqd/0||
|kworkder/0:0H||
|migration/0||
|watchdog/0||
|binder||
|rcu_sched||
|perf||
|netns||
|rpm-smd||
|mpm||
|writeback||
|system||
|irq/261-msm_iom||
|mdss_dsi_event||
|kgsl-events||
|spi||
|therm_core:noti||
|msm_thermal:hot||

**内核进程都不存在子进程与子线程**


### 2.2 用户进程

`init`进程(1号进程)，是Linux系统的用户空间进程，或者说是Android的第一个用户空间进程。

init生成的子进程，定义在rc文件，其中每一个service，在启动时会通过fork的方式产生内核子进程。针对Andorid 6.0， rc文件包括：init.rc，init.trace.rc， init.usb.rc，ueventd.rc，init.zygote32.rc， init.zygote32_64.rc， init.zygote64.rc，init.zygote64_32.rc共8个。


下面列举出由**`init进程`** fork的比较重要的子进程

|进程名|进程文件|作用
|---|---|
|zygote| /system/bin/app_process|Java界的第一个进程，分32位和64位|
|servicemanager| /system/bin/servicemanager|Binder的守护进程|
|media| /system/bin/mediaserver| 多媒体服务的进程|
|ueventd| /sbin/ueventd|uevent守护进程|
|healthd| /sbin/healthd|电池的守护进程|
|logd| /system/bin/logd|log的守护进程|
|adbd |/sbin/adbd | adbd进程(Socket IPC)|
|lmkd| /system/bin/lmkd|lowmemorykiller守护进程|
|console |/system/bin/sh|控制台|
|vold| /system/bin/vold|volume守护进程
|netd| /system/bin/netd|network守护进程
|debuggerd| /system/bin/debuggerd|用于调试程序异常退出|
|debuggerd64 |/system/bin/debuggerd64|用于调试程序异常退出|
|ril-daemon  |/system/bin/rild|Radio Interface Layer的守护进程|
| installd| /system/bin/installd|安装的守护进程|
|surfaceflinger |/system/bin/surfaceflinger|绘图的进程


调试命令 
	
	debuggerd -b [tid] //-b 表示在控制台中输出backtrace, 否则dump到/data/tombstones文件夹


### 2.3 Zygote

Zygote本身是一个Native的应用程序，刚开始的名字为“app_process”，运行过程中，通过系统调用将自己名字改为Zygote。  
Zygote是所有上层Java进程的父进程，android系统中还有另一个Zygote64进程，用于孵化64位的应用进程。Zygote fork出来的进程往往都是App进程。

下面列举**`Zyogte进程`**孵化的部分子进程

|进程名|解释
|---|---|
|system_server|Java framework的各种services都依赖此进程|
|com.android.phone|电话应用进程
|android.process.acore|
|android.process.media|多媒体应用进程|
|com.android.settings|设置进程|
|com.android.wifi|Wifi应用进程|

## 三、线程

### 3.1 Zygote 子线程

zygote进程是497(该进程号是init fork进程时确定的)，通过指令：

	ps -t | grep -E "NAME| 497 "

解释： -t用于输出线程， `-E "NAME| 497 "` 是输出时能多显示`NAME`的那一行，方便查看每一列代表的具体含义，"497"是手机当前Zygote的进程号。

共享父进程的地址空间的便是子线程，即VSIZE必然相同，否则就是子进程，如下图：

![ps_zygote64](\images\android-process\pt_zygote64_2.png)

图中红色圈起来的便是子线程，其他都是子进程。

可见Zygote的子线程如下：

|线程名|作用|
|---|---|
|ReferenceQueueD||
|FinalizerDaemon||
|FinalizerWatchd||
|HeapTrimmerDaem||
|GCDaemon||

*线程作用暂空，后面慢慢补上*

### 3.2 system_server 子线程
Java Framework中的service都运行在system_server进程中，system_server内的子线程很多，统计了下自己身边的手机有system_server有122个线程。下面列举部分子线程：

|线程名|作用
|---|
|system_server|包含4个此同名线程|
|Heap thread poo|包含5个此同名线程|
|Signal Catcher||
|JDWP||
|ReferenceQueueD||
|FinalizerDaemon||
|FinalizerWatchd||
|HeapTrimmerDaem||
|GCDaemon||
|Binder_|包含16个Binder线程|
|ActivityManager||
|PerformanaceCont||
|FileObserver||
|CpuTracker||
|PowerManagerSer||
|PackageManager||
|watchdog||
|WifiMonitor||
|UEventObserver||
|RenderThread||
|AsyncTask #|包含若干个AsyncTask线程|
|...||


### 3.3 mediaserver 子线程

mediaserver 子线程，如下：

|线程名|
|---|
|mediaserver|
|ApmTone
|ApmAudio
|ApmOutput
|Safe Speaker Th
|AudioOut_2
|FastMixer
|AudioOut_4
|FastMixer
|AudioOut_6
|Binder_1|
|Binder_2|

### 3.4 apk 子线程

此处以settings为例

|线程名|
|---|
|com.android.settings|settings进程|
|Heap thread poo|包含5个此同名线程|
|Signal Catcher
|JDWP
|ReferenceQueueD
|FinalizerDaemon
|FinalizerWatchd
|HeapTrimmerDaem
|GCDaemon
|Binder_1
|Binder_2
|pool-2-thread-1
|pool-3-thread-1
|pool-3-thread-2
|pool-4-thread-1
|pool-4-thread-2
|AsyncTask #1
|pool-6-thread-1
|RenderThread|会有若干个|
|WifiManager

一般地，每个apk都会产生2或3个Binder线程，Apk运行的Activity或service都会产生2个Binder线程。

关于Binder问题

- 主线程是由 Zygote母体生成的；
- 线程池：首次创建第一个Binder线程A，然后监听BR_SPAWN_LOOPER事件，收到后创建第二个Binder线程B，线程B继续监听BR_SPAWN_LOOPER事件，收到后创建第三个Binder线程C。总共创建3个Bindr线程，这是Binder协议决定。根据系统处理器数目以及应用程序的负载强度，线程池的线程数目可以动态调整，这是Binder优化需要考虑的。

### 3.5 servicemanager

作为Binder架构的一个大管家，所有注册服务、获取服务，都需要经过servicemanager。 servicemanager进程没有子进程，也没有子线程。更多关于servicemanager，请查看[Binder系列](http://www.yuanhh.com/2015/11/01/android-binder-prepare/)文章。


### 四、进程统计

下面以一台基于Android 5.1.1的手机为例，统计以“父进程”作为PPID的进程个数统计表（进程总数为407）：

|父进程|个数|解释|
|---|---|---|
|0| 2|分别为init， kthreadd|
|init|  55|用户进程|
|kthreadd| 303|内核进程|
|zygote64| 41  |64位zygote|
|zygote |3 |32位zygote|
|qseecomd| 1|高通安全执行环境|
|adbd| 2|打开了2个adb窗口|
|sh|  2 |分别为ps, grep|

图中zygote64/zygote/qseecomd/adbd的父进程都是init进程，而sh的父进程是adbd.


