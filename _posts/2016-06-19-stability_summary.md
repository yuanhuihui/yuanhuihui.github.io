---
layout: post
title:  "Android系统稳定性简述"
date:   2016-06-19 22:19:53
catalog:    true
tags:
    - android
    - stability

---

## 一. 稳定性简述

Android系统稳定性对于用户体验至关重要. 对于稳定性问题从表现来看有: 死机重启, 自动关机, 无法开机,冻屏,黑屏以及闪退, 无响应等情况;
从技术层面来划分无外乎两大类: 长时间无法执行完成(Timeout) 以及异常崩溃(crash). 主要分类如下:

![stability_summary.jpg](/images/stability/stability_summary.jpg)


### 1.1 Timeout

长时间无法执行完成, 这只是描述性命题, 对于系统来说必须指定每一项操作超过指定阈值美誉执行完成, 则判定为超时(Timeout).

对于Android系统来说,比较常见的便是Service, Broadcast, provider以及input, 当普通app进程超过一定时间没有执行完, 则会弹出应用无响应(Application Not Responding, ANR)的对话框.
如果该app运行在system进程, 更准确的来说,应该是(System Not Responding, SNR). 虽然有ANR和SNR之分, 但习惯上大家都统称为ANR问题.

[理解Android ANR的触发原理](http://gityuan.com/2016/07/02/android-anr/), 对于组件ANR问题, 有些是需要的执行时间比较长, 即便触发ANR, 只要再多给些时间还是可以正常运行的; 有些则是由于发生了死锁,即便给再长的时间都无法恢复的问题.

- Service Timeout:比如前台服务在20s内未执行完成；
- broadcast Timeout：比如前台广播在10s内未执行完成
- ContentProvider Timeout：内容提供者执行超时
- InputDispatching Timeout: 输入事件分发超时5s，包括按键和触摸事件。


除了ANR, 还有另一个类型那就是WatchDog.[WatchDog工作原理](http://gityuan.com/2016/06/21/watchdog/), 最为常见的便是运行在system进程中的"watchdog"线程; 还有运行在各个app进程(包括system进程)的"FinalizerWatchdogDaemon",该线程用于监控执行GC的过程中,
守护线程"FinalizerDaemon"回收某个对象时间过长的监视器; 当然不至于这些, 还有dex2oat, wifi等watchdog.

当发生ANR或许WatchDog后, 便需要收集系统相关信息,用于分析和修复异常, 见[理解Android ANR的信息收集过程](http://gityuan.com/2016/12/02/app-not-response/).
整个过程中进程Trace的输出是最为核心的环节，另外该过程会清空/data/anr/traces.txt的老文件, 那么原来之前的traces信息一般地会先输出到dropbox, 有些情况就会丢失traces.
Java和Native进程采用不同的策略，如下：

|进程类型|trace命令|文章|描述|
|Java|kill -3 [pid]|[ART虚拟机之Trace原理](http://gityuan.com/2016/11/26/art-trace/)|不适用于Native进程|
|Native|debuggerd -b [pid]|[Native进程之Trace原理](http://gityuan.com/2016/11/27/native-traces/)|也适用于Java进程

### 1.2 Crash

异常崩溃(Crash)的问题, 毫无疑问这不是时间上能解决的问题, 而是出现了未知的异常. 一旦触发崩溃会出现相应的调用栈, 但不糊输出各个进程的traces.

对于Java层Crash, [理解Java Crash处理流程](http://gityuan.com/2016/06/24/app-crash/), 往往是抛出了一个未捕获的异常uncaughtException而导致的崩溃. 那是不是把所有的异常都catch住系统就没有问题呢,
这个是要分情况的,有时候的异常强制崩溃可能会留下更大的问题, 有些异常的抛出是需要深入分析Root Cause,从根源来解决问题, 而非简单粗糙的捕获住所有的异常.

对于Native层Crash, [理解Native Crash处理流程](http://gityuan.com/2016/06/25/android-native-crash/), 则是由于进程收到signal信号而引发的崩溃.当进程收到信号,并会触发信号处理函数,通过socket发送信息到debuggerd进程, debuggerd进程收到事件后通过
ptrace attach到目标进程, 获取cpu/memory/traces等关键信息后dettach. Native crash情况比较多, 其中最为场景便是SIGSEGV段错误异常, 往往是内存出现异常,比如访问了权限不足的内存地址等.

对于Kernel层Crash, 这是比较难分析的一大类, 不少情况是跟硬件导致的,比较cpu问题, 硬件驱动问题等.

