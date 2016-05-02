---
layout: post
title:  "ps进程命令"
date:   2015-10-11 22:20:50
catalog:  true
tags:
    - android
    - process
    - command
    - tool

---

## ps进程命令

在`adb shell`终端，输入 `ps`，可查看手机当前所有的进程状态，其中`ps`的英文全称是Process Status。

### 1. ps命令参数

- -t 显示进程里的所有子线程 
- -c 显示进程耗费的CPU时间 
- -p 显示进程优先级、nice值、调度策略
- -P 显示进程，通常是bg(后台进程)或fg(前台进程)
- -x 显示进程耗费的用户时间和系统时间，格式:(u:0, s:0)，单位:秒(s)。 

上面的参数可根据需要自由组合，比如只需要查看当前进程的线程情况:

查看进程<pid>内的所有子进程和子线程： `ps -t | grep <pid>`； 
 
查看所有普通应用程序，由于目前android是单用户的，所以用户普通进程的user都是以u0_开头的，google有意把android发展成支持多用户的，以后应该会有u1_, u2_等等的用户名，另外普通app的uid是从10000开始：

 	`ps | grep ^u0`;

### 2. ps结果分析

例如，在我手机输出如下命令：（20671是某个进程pid）

	ps -P -p -x -c  | grep -E "NAME| 20671 "

**输出结果：**

![ps_command](/images/android-process/ps_command.jpg)


**结果分析：**

|字段|含义|值|
|---|---|---|
|USER|进程的当前用户|system|
|PID|进程ID|20671|
|PPID|父进程ID|497|
|VSIZE|进程虚拟地址空间大小|2085804B|
|RSS|进程正在使用物理内存大小|60892B|
|CPU|CPU消耗|1|
|PRIO|进程优化级|20|
|NICE|Nice值|0|
|RTPRI|实时进程优先级|0|
|SCHED|调度策略|SCHED_OTHER(默认策略)|
|PCY|进程状态|bg|
|**WCHAN**|内核地址|ffffffff|
|PC|当前程序指针|b17d3d30|
|-|休眠状态|S
|NAME|进程名|com.android.settings|
|-|用户态和内核态时间(单位s)|u:130, s:12|

注： WCHAN值为0代表进程处于运行态；否则代表内核地址(休眠态)。

----------

关于更多进程的调度与优先级的说明，见[进程与线程](http://gityuan.com/2015/10/01/Process-and-thread/)。