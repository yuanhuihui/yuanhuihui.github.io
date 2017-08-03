---
layout: post
title:  "Android调试技巧(一)"
date:   2017-07-11 22:19:53
catalog:    true
tags:
    - android
    - debug
    - stability

---

> 本文主要介绍一些常见的调试技巧

## 一. 调用栈相关

### 1.1 Java层

#### 1.1.1 当前线程的调用栈

有下面3种方法可以打印堆栈信息：

- Thread.currentThread().dumpStack(); 
- Log.d(TAG,"Gityuan", new RuntimeException("Gityuan"));
- new RuntimeException("Gityuan").printStackTrace();

#### 1.1.2 目标进程的调用栈

- adb shell kill -3 [pid]
- Process.sendSignal(pid, Process.SIGNAL_QUIT);

上述两条命令功能相同，都会生成trace文件保存在`data/anr/traces.txt`文件。

#### 1.1.3 打印时间戳

	long startTime = System.currentTimeMillis();
	...
	long spendTime = System.currentTimeMillis() - startTime;
	Log.i(TAG,"spend time：" + spendTime + “ ms”);

### 1.2 C/C++层

#### 1.2.1 当前线程的调用栈

    #include <utils/CallStack.h>
    android::CallStack stack(("Gityuan"));

#### 1.2.2 目标进程的调用栈

- adb shell debuggerd -b [tid]
- Debug.dumpNativeBacktraceToFile(pid, tracesPath);
- Watchdog.dumpKernelStackTraces  

前两条命令输出内容相同，命令1输出到控制台，命令2输出到目标文件；
对于debuggerd命令，若不带参数则输出到`/data/tombstones`文件夹，生成的tombstones文件信息非常详尽。

#### 1.2.3 打印时间戳

	#include <stdio.h>
	#include <sys/time.h>
	void main ()
	{
	    struct timeval time;
	    gettimeofday(&time, NULL); //精度us
	    printf ( "time : %lld ms\n", time.tv_sec * 1000 + time.tv_usec /1000);
	}

### 1.3 归纳

以下分别列举输出Java, Native, Kernel的调用栈方式：

|类别|函数式|命令式|
|---|---|---|
|Java|Process.sendSignal(pid, Process.SIGNAL_QUIT)|kill -3 [pid]|
|Native|Debug.dumpNativeBacktraceToFile(pid, tracesPath)|debuggerd -b [pid]|
|Kernel|WD.dumpKernelStackTraces()|cat /proc/[tid]/stack|

其中dumpKernelStackTraces()只能用于打印当前进程的kernel线程

## 二。其他调试

#### 2.1 重要调试文件

分析异常，往往需要以下几个目录问题

    /data/anr/traces.txt
    /data/tombstones/tombstone_X
    /data/system/dropbox/

#### 2.2 kernel log级别

    cat /proc/sys/kernel/printk  
    4       4       1       7

参数解读：

1. 控制台日志级别：优先级高于该值的消息将被打印至控制台。
2. 缺省的消息日志级别：将用该值来打印没有优先级的消息。
3. 最低的控制台日志级别：控制台日志级别可能被设置的最小值。
4. 缺省的控制台：控制台日志级别的缺省值。

日志级别：

|级别|值|说明|
|---|---|---|
|KERN_EMERG|0|致命错误|
|KERN_ALERT|1|报告消息|
|KERN_CRIT|2|严重异常
|KERN_ERR|3|出错
|KERN_WARNING|4|警告
|KERN_NOTICE|5|通知
|KERN_INFO|6|常规
|KERN_DEBUG|7|调试

#### 2.3 其他

- logcat -b all
- dmesg 或 cat /proc/kmsg
- logcat -L 或 cat /proc/last_kmsg
- adb bugreport > bugreport.txt
- ps
- lsof
- showmap
- iostat -x
- mount
- strace
- development/scripts/stack
- /d/binder/ 记录binder信息
- /proc/locks 内核锁住的文件列表
- sysctl -a中的fs.file-max //系统允许打开的最大文件数
- ulimit -n  //单进程允许打开的最大文件数，一般为1024
