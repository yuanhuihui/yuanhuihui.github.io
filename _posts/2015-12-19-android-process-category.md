---
layout: post
title:  "Android进程整理"
date:   2015-12-19 22:10:40
categories: android
excerpt:  Android进程整理
---

* content
{:toc}


---

> 线程与进程的最大区别就是是否共享父进程的地址空间

## 一、概括

先展示一张Android整个启动过程图：

![process_status](\images\android-process\process_status.jpg)

图解：

- 深红色：代表0号进程，是在进入刚进入启动时创建的，内核启动完成后便退出；
- 浅红色：init/kthreadd/Zygote，这3个进程分别会创建大量的内核守护进程、用户空间守护进程以及应用进程，地位主要创建了大量子进程(注意，此处说的不是子线程)；
- 深紫色：system server/ media server/ servicemanager，这3个进程并不是用于创建子进程，而是对于整个Android架构，有着非常重要的意义；
- 深蓝色：内核守护进程、用户空间守护进程以及应用进程，这些都是由“深红色”fork生成的；
- 浅蓝色：各种系统服务、驱动等相关信息。


----------

下面，进一步阐释各个进程状态：

### 1.1 父进程
在所有进程中，以父进程的姿态存在的进程(即图中的浅红色项)，如下：

- **`kthreadd进程`**: 是所有内核进程的父进程
- **`init进程`**   ： 是所有用户进程的父进程(或者父父进程)
- **`zygote进程`** ： 是所有上层Java进程的父进程，另外`zygote`的父进程是`init`进程。

### 1.2 重量级进程
在Android进程中，有3个非常重要的进程(即图中的深紫色项)，如下：

- **`system_server`**：是由zygote孵化而来的，是zygote的首席大弟子，托起整个Java framework的所有service，比如ActivityManagerService, PowerManagerService等等。

- **`mediaserver`**：是由init孵化而来的，托起整个C++ framework的所有service，比如AudioFlinger, MediaPlayerService等等。

- **`servicemanager`**：是由init孵化而来的，是整个Binder架构(IPC)的大管家，所有大大小小的service都需要先请示servicemanager。

### 1.3 ps指令

在`adb shell`终端，输入 `ps`，可查看手机当前所有的进程状态，其中`ps`的英文全称是Process Status。

**PS命令参数**:

- -t 显示进程里的所有子线程 
- -c 显示进程耗费的CPU时间 
- -p 显示进程优先级、nice值、调度策略
- -P 显示进程，通常是bg(后台进程)或fg(前台进程)
- -x 显示进程耗费的用户时间和系统时间，格式:(u:0, s:0)，单位:秒(s)。 

上面的参数可根据需要自由组合，比如只需要查看当前进程的线程情况，只需要`ps -t | grep <pid>`。

**PS输出结果含义**：

- USER：  进程的当前用户
- PID   ： 进程ID
- PPID  ： 父进程ID
- VSIZE  ： 进程虚拟地址空间大小；(virtual size)
- RSS    ： 进程正在使用的物理内存大小；
- WCHAN  ： 值为0代表进程处于运行态；否则代表内核地址(休眠态)
- PC  ： 程序指针
- NAME:  进程名

**实例说明**


![ps_command](\images\android-process\ps_command.jpg)

含义：

|类型|说明|
|---|---|
|用户|system|
|进程ID|20671|
|父进程ID|497|
|虚拟空间大小|2085804B|
|正在使用物理内存|60892B|
|CPU消耗|1|
|进程优化级|20|
|Nice值|0|
|实时进程优先级|0|
|调度策略|SCHED_OTHER(默认策略)|
|PCY|后台进程|
|WCHAN|内核地址|
|当前程序指令|b17d3d30|
|S|处于休眠状态|
|进程名|com.android.settings|
|进程时间消耗|用户态130s,系统态12s|

关于更多进程的调度与优先级的说明，见[进程与线程](http://www.yuanhh.com/2015/10/01/Process-and-thread/)。

## 二、进程

Android进程从大类来划分，可分为内核进程和用户进程。

### 2.1 内核进程

`kthreadd`进程（2号进程），是Linux系统的内核进程，是所有内核进程的鼻祖。

下面列举部分比较常见的内核进程：

|进程名|解释
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
|...|...|

**内核进程都不存在子进程与子线程**

*每个内核进程的作用，后续再补上*

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
|surfaceflinger |/system/bin/surfaceflinger|UI帧相关的进程
|...|...|

调试命令 
	
	debuggerd -b [tid] //-b 表示在控制台中输出backtrace, 否则dump到/data/tombstones文件夹


### 2.3 Zygote

Zygote本身是一个Native的应用程序，刚开始的名字为“app_process”，运行过程中，通过系统调用将自己名字改为Zygote。是所有上层Java进程的父进程，android系统中还有另一个Zygote64进程，用于孵化64位的应用进程。

在图中的红色线，便是Zygote fork出来的进程，所有的App进程都是由Zygote fork产生的。

下面列举**`Zyogte进程`**孵化的部分子进程

|进程名|解释
|---|---|
|system_server|Java framework的各种services都依赖此进程|
|com.android.phone|电话应用进程
|android.process.acore|通讯录进程
|android.process.media|多媒体应用进程|
|com.android.settings|设置进程|
|com.android.wifi|Wifi应用进程|
|...|...|

## 三、线程

### 3.1 Zygote 子线程

在`adb shell`终端，输入:

	ps -t | grep -E "NAME| 497 "

解释： `-E "NAME| 497 "` 是输出时能多显示`NAME`的那一行，方便查看每一列代表的具体含义，`497`是Zygote的进程号。

共享父进程的地址空间的便是子线程，即VSIZE必然相同，否则就是子进程，如下图：

![ps_zygote64](\images\android-process\pt_zygote64_2.png)

图中红色圈起来的便是子线程，其他都是子进程。

可见Zygote的子线程如下：

|线程名|解释|
|---|---|
|ReferenceQueueD|引用队列的守护线程|
|FinalizerDaemon|析构的守护线程|
|FinalizerWatchd|析构监控的守护线程|
|HeapTrimmerDaem|堆整理的守护线程|
|GCDaemon|执行GC的守护线程|

这5个线程都是与虚拟机息息相关的线程，之后所有由Zygote直接或间接孵化的子进程，都会包含这5个线程，那么就在其线程说明中，不再重复，而是以“用于GC”的字样来表示。后续有空会专门针对Android的虚拟机展开讨论。


### 3.2 system_server 子线程
Java Framework中的service都运行在system_server进程中，system_server内的子线程很多，统计了下自己身边的手机有system_server有122个线程。下面列举部分子线程：

|线程名|解释
|---|
|system_server|包含4个此同名线程|
|Heap thread poo|异步的HeapWorker, 包含5个|
|Signal Catcher|捕捉Kernel信号，比如SIGNAL_QUIT|
|JDWP|虚拟机调试的线程|
|ReferenceQueueD|用于GC|
|FinalizerDaemon|用于GC|
|FinalizerWatchd|用于GC|
|HeapTrimmerDaem|用于GC|
|GCDaemon|用于GC|
|Binder_|IPC线程， 包含16个|
|Thread_|普通线程，包含若干个|
|AsyncTask #|异步任务，包含若干个|
|RenderThread|渲染线程，可以包含若干个|
|ActivityManager|system_server专有|
|PerformanaceCont|system_server专有|
|FileObserver|system_server专有|
|CpuTracker|system_server专有|
|PowerManagerSer|system_server专有|
|PackageManager|system_server专有|
|watchdog|system_server专有|
|WifiMonitor|system_server专有|
|UEventObserver|system_server专有|
|...|...|

### 3.3 app 子线程

此处以settings为例

|线程名|解释
|---|
|com.android.settings|settings进程|
|Heap thread poo|异步的HeapWorker, 包含5个|
|Signal Catcher|捕捉Kernel信号，比如SIGNAL_QUIT|
|JDWP|虚拟机调试的线程|
|ReferenceQueueD|用于GC|
|FinalizerDaemon|用于GC|
|FinalizerWatchd|用于GC|
|HeapTrimmerDaem|用于GC|
|GCDaemon|用于GC|
|Binder_1|用于IPC|
|Binder_2|用于IPC|
|pool-m-thread-n|线程池m中的第n个线程,包含若干个|
|AsyncTask #1|异常任务|
|RenderThread|会有若干个|
|WifiManager|管理wifi的线程|

一般地，每个apk都会产生2或3个Binder线程，Apk运行的Activity或service都会产生2个Binder线程。

关于Binder问题

- 主线程是由 Zygote母体生成的；
- 线程池：首次创建第一个Binder线程A，然后监听BR_SPAWN_LOOPER事件，收到后创建第二个Binder线程B，线程B继续监听BR_SPAWN_LOOPER事件，收到后创建第三个Binder线程C。总共创建3个Bindr线程，这是Binder协议决定。根据系统处理器数目以及应用程序的负载强度，线程池的线程数目可以动态调整，这是Binder优化需要考虑的。


### 3.4 mediaserver 子线程

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

*每个线程的作用，后续再补上*

### 3.5 servicemanager

作为Binder架构的一个大管家，所有注册服务、获取服务，都需要经过servicemanager。 servicemanager进程没有子进程，也没有子线程。更多关于servicemanager，请查看[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)文章。


## 四、进程统计

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


