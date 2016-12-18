---
layout: post
title:  "Android调试技巧(一)"
date:   2016-6-21 22:19:53
catalog:    true
tags:
    - android
    - debug
    - stability

---

> 本文主要介绍一些常见的调试技巧

## 一. Java层

### 1.1 当前线程的调用栈

有下面3种方法可以打印堆栈信息：

- Thread.currentThread().dumpStack(); 
- Log.d(TAG,"", new RuntimeException("Gityuan"));
- new RuntimeException("Gityuan").printStackTrace();

### 1.2 目标进程的调用栈

- adb shell kill -3 [pid]
- Process.sendSignal(pid, Process.SIGNAL_QUIT);

上述两条命令功能相同，都会生成trace文件保存在`data/anr/traces.txt`文件。

### 1.3 打印时间戳

	long startTime = System.currentTimeMillis();
	...
	long spendTime = System.currentTimeMillis() - startTime;
	Log.i(TAG,"spend time：" + spendTime + “ ms”);

## 二. C/C++层

### 1.1 当前线程的调用栈

    #include <utils/CallStack.h>
    android::CallStack stack(("Gityuan"));

### 1.2 目标进程的调用栈

- adb shell debuggerd -b [tid]
- Debug.dumpNativeBacktraceToFile(pid, tracesPath);
- Watchdog.dumpKernelStackTraces  

上述两条命令输出内容相同，命令1输出到控制台，命令2输出到目标文件；
对于debuggerd命令，若不带参数则输出到`/data/tombstones`文件夹，生成的tombstones文件信息非常详尽。

### 1.3 打印时间戳

	#include <stdio.h>
	#include <sys/time.h>
	void main ()
	{
	    struct timeval time;
	    gettimeofday(&time, NULL); //精度us
	    printf ( "time : %lld ms\n", time.tv_sec * 1000 + time.tv_usec /1000);
	}

## 三. 归纳

以下分别列举输出Java, Native, Kernel的stack函数和命令：

|类别|函数式|命令式|
|---|---|---|
|Java|Process.sendSignal(pid, Process.SIGNAL_QUIT)|kill -3 [pid]|
|Native|Debug.dumpNativeBacktraceToFile(pid, tracesPath)|debuggerd -b [pid]|
|Kernel|WD.dumpKernelStackTraces()|cat /proc/[tid]/stack|

其中dumpKernelStackTraces()只能用于打印当前进程的kernel线程
