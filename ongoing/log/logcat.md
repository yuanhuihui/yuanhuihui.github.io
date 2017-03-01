---
layout: post
title:  "Android Log使用"
date:   2016-12-01 11:30:00
catalog:  true
tags:
    - android

---

    /framework/base/core/java/android/util/Log.java
    /frameworks/base/core/jni/android_util_Log.cpp
    /system/core/liblog/logd_write.c
    /system/core/liblog/uio.c
    
## 一、概述

无论是Android系统开发，还是应用开发，都离不开log，Androd采用logcat输出log。

### logcat命令

logcat -b main system events
logcat -s "ActivityManager"
logcat -g //缓冲区大小

这是好命令:

logcat -b kernel //输出kernel log


logcat -S  //统计log信息

## 二. 输出
### 1. Java Log

#### 级别
定义在文件Log.java

|级别|对应值|使用场景|
|---|---|
|VERBOSE|2|冗长信息|
|DEBUG|3|调试信息|
|INFO|4|普通信息
|WARN|5|警告信息
|ERROR|6|错误信息
|ASSERT|7|普通但重要的信息

当然还有SLOG， RLOG等。

#### buffer ID
Log.java

   /** @hide */ public static final int LOG_ID_MAIN = 0;
   /** @hide */ public static final int LOG_ID_RADIO = 1;
   /** @hide */ public static final int LOG_ID_EVENTS = 2;
   /** @hide */ public static final int LOG_ID_SYSTEM = 3;
   /** @hide */ public static final int LOG_ID_CRASH = 4;
  
logd_write.c

   static const char *LOG_NAME[LOG_ID_MAX] = {
       [LOG_ID_MAIN] = "main",
       [LOG_ID_RADIO] = "radio",
       [LOG_ID_EVENTS] = "events",
       [LOG_ID_SYSTEM] = "system",
       [LOG_ID_CRASH] = "crash",
       [LOG_ID_KERNEL] = "kernel",
   };
    

#### buffer大小

LogBuffer.cpp


[persist.logd.size]: [2M]
[persist.logd.size.radio]: [4M]

可知
radio = 4M, 其他都为2M.


#### 其他

6个log级别，5个log缓存区
      
http://blog.csdn.net/kc58236582/article/category/6246436
http://blog.csdn.net/luoshengyang/article/details/6606957
http://blog.csdn.net/luoshengyang/article/details/6595744

### 2. Native Log


### 3. Kernel Log

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
