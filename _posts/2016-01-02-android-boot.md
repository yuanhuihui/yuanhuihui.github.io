---
layout: post
title:  "Android开机过程分析"
date:   2016-01-02 20:10:40
categories: android
excerpt:  Android开机过程分析
---

* content
{:toc}


---

> 在前面的文章[Android进程整理](http://www.yuanhh.com/2015/12/19/android-process-category/)中，从进程角度阐释Android手机中的所有进程和线程情况，那么本文将主要来讲述开机流程。

# 一、概述

**开机流程图：**

![process_status](\images\android-process\process_status.jpg)

**图解：**

开机过程是从图中最下方Loader开始，经过 -> Kernel -> Native -> Framework，一路直至最上层的App启动。下面来进一步说明：

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


在整个开机流程中，有几个非常重要的进程，分别是init、Zygote、System Server进程，下面分别讲述。

# 二	、init进程

## 2.1 init流程
[-->init.c]

1. 设置子进程退出的信号处理函数sigchld_handler
- 创建文件夹以及设备挂载；
- 解析init.rc配置文件；
	- on init: on关键字标示section，对应的名字是”init”，即后面步骤7
	- on boot: on关键字标示section，对应的名字是”boot”，即后面步骤11
	- service xxx： service也是section的标示，对应section名为"xxx"； service的启动往往会配置相应的 on property:****
- **action_for_each_trigger**("early-init", action_add_queue_tail); 
- 创建利用Uevent和Linux内核交互的socket
- 初始化/dev/keychord设备；
- **action_for_each_trigger**("init", action_add_queue_tail);   
- 启动属性服务器;
- 创建已连接的socketpair；
- **action_for_each_trigger**("early-boot", action_add_queue_tail);  
- **action_for_each_trigger**("boot", action_add_queue_tail);  
 
- init监听如下四个事件： 
	- ufds[0].fd= device_fd  //监听来自内核的Uevent事件 
	- ufds[1].fd = property_set_fd //监听来自属性服务器的事件 
	- ufds[2].fd = signal_recv_fd //监听socketpair的另一端socket事件. 
	- ufds[3].fd = keychord_fd  //监听keychord设备事件 
	
-  for(;;) {}     //从此init将进入一个无限循环。

## 2.2 init.rc语法

-  trigger： 以 on开头，决定何时执行；
	- on boot/init/charger： 当系统启动/初始化/充电时触发，还包含其他情况，此处不一一列举；
	- on property:\<key\>=\<value\>: 当属性值满足条件时触发；
- Service：以 service开头，由init进程启动；
- Options: 是Services的修饰
	- disabled: 不随class自动启动，只有按照名称才会启动；
	- oneshot: service退出后不再重启；
	- user/group： 设置执行服务的用户/用户组，默认都是root；
	- class：设置所属的类名，当所属类启动/退出时，服务也启动/停止，默认为default；
	- onrestart:当服务重启时执行相应命令；
	- socket: 创建名为`/dev/socket/<name>`的socket
	- critical: 在规定时间内该service不断重启，则系统会重启并进入恢复模式

- Command:下面列举常用的命令
	- class_start \<service_class_name\>： 启动该类下的所有服务；
	- start \<service_name\>： 启动制定的服务，若已启动，则跳过；
	- stop \<service_name\>： 停止正在运行的服务
	- symlink \<target\> \<sym_link\>： 创建连接到<target>的<sym_link>符号链接； 
	- write \<path\> \<string\>： 想文件path中，写入字符串；
	- exec： fork并执行，会阻塞init进程直到程序完毕；
 
service一般运行于另外一个init的子进程，所以启动service前需要判断对应的可执行文件是否存在。


## 2.3 zygote

	通过 cat init.rc 可查看init.rc；  
	通过 ps 可查看父进程为1的子进程都是init.rc文件产生的

由init生成的进程： zygote, surfaceflinger, logd， servicemanager, lmkd, mediaserver,bootanimation等

### init.rc部分内容 

	service zygote /system/bin/app_process -Xzygote /system/bin --zygote --start-system-server
	    class main
	    socket zygote stream 660 root system
	    onrestart write /sys/android_power/request_state wake
	    onrestart write /sys/power/state on
	    onrestart restart media
	    onrestart restart netd


	service servicemanager /system/bin/servicemanager
	    class core
	    user system
	    group system
	    critical
	    onrestart restart healthd
	    onrestart restart zygote
	    onrestart restart media
	    onrestart restart surfaceflinger
	    onrestart restart drm

### 执行过程
zygote对应的可执行文件是/system/bin/app_process。

`pid =fork();` //调用fork创建子进程   
`execve(svc->args[0], (char**)svc->args, (char**) ENV)` //执行app_process的 main函数。  

故zygote是通过fork和execv共同创建的。

### zygote重启

当子进程退出时，init的这个信号处理函数会被调用 sigchld_handler


## 2.4 属性服务器 
[-->property_service.c]

	void property_init(void){
	init_property_area(); //初始化属性存储区域
	load_properties_from_file(PROP_PATH_RAMDISK_DEFAULT);
	}

在properyty_init函数中，先调用init_property_area函数，创建一块用于存储属性的共享内存，而共享内存是可以跨进程的，然后加载default.prop文件中的内容。

- 属性名以ctl开头，则认为是控制消息，控制消息用来执行一些命令。如：setprop ctl.start bootanim查看开机动画，setprop ctl.stop bootanim 关闭开机动画
- 属性名以ro.开头，则表示是只读的，不能设置，所以直接返回。
- 属性名以persist.开头，则需要把这些值写到对应文件中去。


启动属性服务器：  
[-->Property_service.c]	

	int start_property_service(void)	{	    
		intfd;	  	   /*	       加载属性文件，其实就是解析这些文件中的属性，然后把它设置到属性空间中去。Android系统	      一共提供了四个存储属性的文件，它们分别是：	     #definePROP_PATH_RAMDISK_DEFAULT "/default.prop"	
		#define PROP_PATH_SYSTEM_BUILD     "/system/build.prop"	
		#define PROP_PATH_SYSTEM_DEFAULT   "/system/default.prop"	
		#define PROP_PATH_LOCAL_OVERRIDE   "/data/local.prop"	*/	  	   
		load_properties_from_file(PROP_PATH_SYSTEM_BUILD);	   
		load_properties_from_file(PROP_PATH_SYSTEM_DEFAULT);	
		load_properties_from_file(PROP_PATH_LOCAL_OVERRIDE);
		load_persistent_properties();	   
	    
		fd =create_socket(PROP_SERVICE_NAME, SOCK_STREAM, 0666, 0, 0);	//创建一个socket，用于IPC通信。	    
		...
	}

## 三、Zygote进程
 Java世界，Google的SDK主要就是针对这个世界的。在这个世界中运行的程序都是基于Dalvik/ART虚拟机的Java程序。

- Native世界，也就是用Native语言C或C++开发的程序，它们组成了Native世界。
- zygote和system_server这两个进程分别是Java世界的半边天，任何一个进程的死亡，都会导致Java世界的崩溃


Zygote本身是一个Native的应用程序，和驱动、内核等均无关系，Zygote是由init进程根据init.rc文件中的配置项而创建的。Zygote是由init进程根据init.rc文件中的配置项而创建的。zygote最初的名字叫“app_process”，这个名字是在Android.mk文件中被指定的，但app_process在运行过程中，通过Linux下的pctrl系统调用将自己的名字换成了“zygote”。app_process所对应的源文件是App_main.cpp。

## 四、System Server进程
System Server是Android在Java世界中的系统Service运行的载体，Android系统中绝大多数的系统核心Service都是运行在System Server进程，比如常见的ActivityManagerService，PackageManagerService，PowerManagerService等进程。System Server进程的进程名为"system_server"。

