---
layout: post
title:  "Android Log使用"
date:   2016-12-01 11:30:00
catalog:  true
tags:
    - android

---

  /framework/base/core/java/android/util/Log.java


## 一、概述

无论是Android系统开发，还是应用开发，都离不开log，Androd采用logcat输出log。

### 1. Java Log



### 1. 内核Log

Linux Kernel最常使用的是printk，用法如下：

    //第一个参数是级别， 第二个是具体log内容
    printk(KERN_INFO x); 

日志级别的定义位于kernel/include/linux/printk.h文件，如下：

|级别|对应值|使用场景|
|---|---|
|KERN_EMERG|<0>|系统不可用状态|
|KERN_ALERT|<1>|警报信息，必须立即采取信息|
|KERN_CRIT|<2>|严重错误信息
|KERN_ERR|<3>|错误信息
|KERN_WARNING|<4>|警告信息
|KERN_NOTICE|<5>|普通但重要的信息
|KERN_INFO|<6>|普通信息
|KERN_DEBUG|<7>|调试信息

日志输出到文件/proc/kmsg，可通过`cat /proc/kmsg`来获取内核log信息。

### 2. 
