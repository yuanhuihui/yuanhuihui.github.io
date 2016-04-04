---
layout: post
title:  "Android系统-开篇"
date:   2016-01-30 23:43:40
categories: android start-up
excerpt:  Android系统-开篇
---

* content
{:toc}


---

> 基于Android 6.0源码，深入剖析Android系统架构，争取各个击破，解决和分析问题，方能入庖丁解牛，游刃有余。

## 一、Android概述

Android系统非常庞大，底层是采用Linux作为基底，上层采用带有虚拟机的Java层，通过通过JNI技术，将上下打通，融为一体。下图是Google提供的一张经典的4层架构图，从下往上，依次分为Linux内核，系统库和Android Runtime，应用框架层，应用程序层这4层架构，每一层都包含大量的子模块或子系统。
  
![android-arch1](/images/boot/android-arch1.png)
  

为了能够更深入地掌握Android整个架构思想，以及每块之间是如何衔接与配合工作的，计划以Android系统启动过程为主线，来详细展开对Android全方位的分析，争取各个击破。


##  二、系统启动

Google提供的4层架构图，是非常经典，但只是如垒砖般的方式，简单地分层，而不足表达Android整个系统的启动过程，环环相扣的连接关系，本文更多的是以进程的视角，以分层的架构来诠释Android系统的全貌。

**系统启动架构图**

点击查看[大图](http://gityuan.com/images/android-process/android-boot.jpg)

![process_status](/images/android-process/android-boot.jpg)

**图解：**Android系统启动过程由上图从下往上的一个过程：Loader -> Kernel -> Native -> Framework ->App，接来下简要说说每个过程：

### 2.1 Loader层

- Boot ROM: 当手机处于关机状态时，长按Power键开机，引导芯片开始从固化在`ROM`里的预设出代码开始执行，然后加载引导程序到`RAM`；
- Boot Loader：这是启动Android系统之前的引导程序，主要是检查RAM，初始化硬件参数等功能。
	
### 2.2 Kernel层

到这里才刚刚开始进入Android系统.

- 启动Kernel的0号进程：初始化进程管理、内存管理，加载Display,Camera Driver，Binder Driver等相关工作；
- 启动kthreadd进程（pid=2）：是Linux系统的内核进程，会创建内核工作线程kworkder，软中断线程ksoftirqd，thermal等内核守护进程。`kthreadd进程是所有内核进程的鼻祖`。
	
### 2.3 Native层

启动init进程(pid=1),是Linux系统的用户进程，`init进程是所有用户进程的鼻祖`。

- init进程启动`Media Server`(多媒体服务)、`servicemanager`(binder服务管家)、`bootanim`(开机动画)等重要服务
- init进程还会孵化出installd(用于App安装)、ueventd、adbd、lmkd(用于内存管理)等用户守护进程；
- init进程孵化出Zygote进程，Zygote进程是Android系统的首个Java进程，`Zygote是所有Java进程的父进程`，Zygote进程本身是由init进程孵化而来的。

### 2.4 Framework层

- Zygote进程，是由init进程通过解析init.rc文件后fork生成的，Zygote进程主要包含：
	- 加载ZygoteInit类，注册Zygote Socket服务端套接字；
	- 加载虚拟机；
	- preloadClasses；
	- preloadResouces；
- Zygote进程fork出System Server进程，`System Server是Zygote孵化的第一个进程`，地位非常重要；
- System Server进程：负责启动和管理整个Java framework，包含ActivityManager，PowerManager等服务。
- Media Server进程：负责启动和管理整个C++ framework，包含AudioFlinger，Camera Service等服务。
	
### 2.5 App层

- Zygote进程孵化出的第一个App进程是Launcher，这是用户看到的桌面App；
- Zygote进程还会创建Browser，Phone，Email等App进程，每个App至少运行在一个进程上。

所有的App进程都是由Zygote进程fork生成的。
	
##  三、计划提纲

2016年新的一年已经开始了，首先祝大家、也祝自己在新的一年诸事顺心，事业蒸蒸日上。在过去的一年，对于Android从底层一路到上层有不少自己的理解和沉淀，但总体较零散，未成体系。借着今天（元旦假日的最后一天），给自己的新的一年提前做一个计划，把知识进行归档整理与再学习，从而加深对Android架构的理解。通过前面对系统启动的介绍，相信大家对Android已然“**知全貌**”，那么接下来需要“**抓核心，理思路**”。


**（1）**在整个开机流程中，有几个非常重要的进程，分别是`init`、`Zygote`、`system_server`进程。接下来，计划用三篇文章来分别阐述：

- [Android系统启动—init篇](http://gityuan.com/2016/02/05/android-init/)
- [Android系统启动—Zygote篇](http://gityuan.com/2016/02/13/android-zygote/)
- Android系统启动—SystemServer篇
	- [SystemServer上篇](http://gityuan.com/2016/02/14/android-system-server/)
	- [SystemServer下篇](http://gityuan.com/2016/02/20/android-system-server-2/)
  
**（2）**再则就是在整个架构中有大量的服务，都是基于Binder来交互的，为了搞清楚binder，用了13篇文章来讲解[Binder](http://gityuan.com/2015/10/31/binder-prepare/)，从binder驱动到应用层整个完整的流程。针对比较核心服务来重点分析，计划分别用文章来对核心服务展开剖析：

- Android服务篇-ActivityManagerService
	- [AMS启动过程（一）](http://gityuan.com/2016/02/21/activity-manager-service/)
- Android服务篇-PackageManagerService
- Android服务篇-PowerManagerService
- Android服务篇-BatteryService
	- [Android耗电统计算法](http://localhost:4000/2016/01/11/power_rank/)
- Android服务篇-WindowManagerService
  
当然graphic也是一大块难啃的模块，也是需要整理的，先留个空位吧。

**（3）**对于App来说，Android应用的四大组件Activity，Service，Broadcast Receiver， Content Provider最为核心，那么我们需要分别展开对其他的分解：

- Android组件-Activity
- Android组件-Service
	- [startService流程分析](http://gityuan.com/2016/03/06/start-service/)
- Android组件-Broadcast Receiver
- Android组件-Content Provider

  
**（4）**有了这些，中间还缺少关于虚拟机ART的介绍，会需要对ART分析，后续还需要开展对ART虚拟机的一系列文章。另外，从架构中还有很多一块没有提及，那便是Linux Kernel，这部分内容，计划从进程，内存，IO的视角展开分析。

- Linux内核-进程篇
	- [进程的优先级](http://localhost:4000/2015/10/02/process-priority/)
- Linux内核-内存篇
- Linux内核-IO篇
- Linux内核-驱动篇
 

**（5）**最后，对整个架构回顾，从性能角度谈谈如何优化的问题，这是一个很大的话题涉及面之广，会贯穿整个过程。

  
先写这么多，后续再不断更新与完善。

----------

欢迎关注我的**[微博：Gityuan](http://weibo.com/gityuan)**，微信公众号：gityuan，后面会持续分享更多原创技术干货。