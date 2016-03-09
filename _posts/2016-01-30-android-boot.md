---
layout: post
title:  "Android系统-开篇"
date:   2016-01-30 23:43:40
categories: android
excerpt:  Android系统-开篇
---

* content
{:toc}


---

> 知全貌，抓核心，理思路

## 一、Android概述

Android系统非常庞大，底层是采用Linux作为基底，上层采用带有虚拟机的Java层，通过通过JNI技术，将上下打通，融为一体。下图是Google提供的一张经典的4层架构图，从下往上，依次分为Linux内核，系统库和Android Runtime，应用框架层，应用程序层这4层架构，每一层都包含大量的子模块或子系统。
  
![android-arch1](\images\boot\android-arch1.png)
  

为了能够更深入地掌握Android整个架构思想，以及每块之间是如何衔接与配合工作的，计划以Android系统启动过程为主线，来详细展开对Android全方位的分析，争取各个击破。


##  二、系统启动

Google提供的4层架构图，是非常经典，但只是如垒砖般的方式，简单地分层，而不足表达Android整个系统的启动过程，环环相扣的连接关系，本文更多的是以进程的视角，以分层的架构来诠释Android系统的全貌。

**系统启动架构图**

![process_status](\images\android-process\process_status.jpg)

	
### 2.1 进程视角

- 深红色：代表0号进程，是在进入刚进入启动时创建的，内核启动完成后便退出；
- 浅红色：init/kthreadd/Zygote，这3个进程分别会创建大量的内核守护进程、用户空间守护进程以及应用进程，地位主要创建了大量子进程(注意，此处说的不是子线程)；
- 深紫色：system server/ media server/ servicemanager，这3个进程并不是用于创建子进程，而是对于整个Android架构，有着非常重要的意义；
- 深蓝色：内核守护进程、用户空间守护进程以及应用进程，这些都是由“深红色”fork生成的；
- 浅蓝色：各种系统服务、驱动等相关信息。

### 2.2 分层视角

开机过程是从图中最下方Loader开始，经过 -> Kernel -> Native -> Framework，一路直至最上层的App层启动。下面来进一步说明：

1. Loader
	- Boot ROM: 当按下电源开机键，引导芯片代码从预设定处(固化在ROM)开始执行，加载引导程序到RAM；
	- Boot Loader：是启动Android OS之前的引导程序，主要是检查RAM，初始化硬件参数等功能；
2. Kernel
	- 启动Kernel的0号进程，初始化进程管理、内存管理，加载驱动程序等相关工作；
	- 启动init进程(1号进程)，是Linux系统的用户空间进程，也就是Native层的进程的鼻祖；
	- 启动kthreadd进程（2号进程），是Linux系统的内核进程，是所有内核进程的鼻祖；
3. Native
	- init进程启动Media Server、servicemanager等重要服务
	- init进程孵化出各种用户守护进程；
	- init进程孵化出Zygote进程，这是第一个Java进程，包含虚拟机等内容；
4. Framework
	- Zygote进程，是由init通过解析init.rc文件后，fork出来生成的，主要工作包含：
		- 加载ZygoteInit类，注册Zygote Socket服务端套接字；
		- 加载虚拟机；
		- preloadClasses；
		- preloadResouces；
	- Zygote进程fork出System Server进程，System Server是Zygote孵化的第一个进程，地位非常重要；
	- 由Media  Server负责启动 C++ framework，包含AudioFlinger，Camera Service等服务；
	- 由System Server负责启动 Java framework，包含ActivityManagerService,PowerManagerService等服务；
	
5. App
	- Zygote进程孵化出Home进程，这便是用户看到的桌面App；
	- Zygote进程Browser，Phone等App进程；每个App至少运行在一个进程上；



##  三、计划提纲

2016年新的一年已经开始了，首先祝大家，也祝自己在新的一年诸事顺心，事业蒸蒸日上。在过去的一年，对于Android从底层到上层有不少理解和沉淀，但总体比较零散琐碎。借着今天（元旦假日的最后一天），给自己的新的一年提前做一个计划，需要去学习和整理，以加深对Android架构的理解。言归正传，通过前面对系统启动的介绍，相信大家对Android已然“**知全貌**”，那么接下来需要“**抓核心，理思路**”。


**（1）**在整个开机流程中，有几个非常重要的进程，分别是init、Zygote、SystemServer进程。接下来，计划用三篇文章来分别阐述：

- [Android系统启动—init篇](http://www.yuanhh.com/2016/02/05/android-init/)
- [Android系统启动—Zygote篇](http://www.yuanhh.com/2016/02/13/android-zygote/)
- [Android系统启动—SystemServer篇](http://www.yuanhh.com/2016/02/14/android-system-server/)

  
**（2）**再则就是在整个架构中有大量的服务，通过[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)文章，可知所有服务都是基于Binder来交互的，那么接下来，需要抓核心服务来重点分析，计划分别用文章来对核心服务展开剖析：

- Android服务篇-ActivityManagerService
- Android服务篇-PackageManagerService
- Android服务篇-PowerManagerService
- Android服务篇-BatteryService
- Android服务篇-WindowManagerService
  

**（3）**对于App来说，Android应用的四大组件Activity，Service，Broadcast Receiver， Content Provider最为核心，那么我们需要分别展开对其他的分解：

- Android组件-Activity
- Android组件-Service
- Android组件-Broadcast Receiver
- Android组件-Content Provider

  
**（4）**有了这些，中间还缺少关于虚拟机ART的介绍，会需要对ART分析，后续还需要开展对ART虚拟机的一系列文章。另外，从架构中还有很多一块没有提及，那便是Linux Kernel，这部分内容，计划从进程，内存，IO的视角展开分析。

- Linux内核-进程篇
- Linux内核-内存篇
- Linux内核-IO篇
- Linux内核-驱动篇
  

**（5）**最后，对整个架构回顾，从性能角度谈谈如何优化的问题，这是一个很大的话题，涉及面之广，会贯穿整个过程。

  
先写这么多，后续再不断调整与完善。

----------

如果觉得本文对您有所帮助，请关注我的**微信公众号：gityuan**， **[微博：Gityuan](http://weibo.com/gityuan)**。 或者[点击这里查看更多关于我的信息](http://www.yuanhh.com/about/)