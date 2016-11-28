---
layout: post
title:  "调试技巧(一)"
date:   2016-6-21 22:19:53
catalog:    true
tags:
    - android
    - debug
    - stability

---

## 调试技巧

### 1.1 打印堆栈

#### 1.1.1 Java堆栈

Java代码有下面3种方法可以打印堆栈信息：

1. new RuntimeException("Gityuan").printStackTrace();
2. Thread.currentThread().dumpStack(); 
3. Log.d(TAG,"",new Throwable("Gityuan"));

#### 1.1.2 C/C++堆栈

C/C++代码可通过CallStack的方式来打印堆栈信息

    android::CallStack stack;
    stack.update();
    stack.dump();

### 1.2 打印stackTrace

#### 1.2.1 Java

1. adb shell kill -3 pid  //adb命令方式
2. Process.sendSignal(pid, Process.SIGNAL_QUIT);  //代码方式
3. ActivityManagerService.dumpStackTraces();   //ANR时会触发调用此方法

生成trace文件保存在`data/anr/traces.txt`文件。

- 方法1和方法2功能完全一致，方法3在前两个方法的基础之上，还会输出kernel进程以及当前系统的CPU使用情况。这里需要特别注意，如果无法正常生成该文件，很可能是权限问题，需要提前手动创建好相应目录或文件，并赋予相应的权限。
- 上述3个方法只能处理java进程，换句话说就是只能打印出Zygote进程孵化而来的子进程，比如system_server或者App进程。由虚拟机art/runtime/signal_catcher.cc中相应方法来处理。


#### 1.2.2 C/C++

1. Watchdog.dumpKernelStackTraces（这是私有方法，不允许外部调用，触发采用反射方式）。  
2. Debug.dumpNativeBacktraceToFile(pid, tracesPath);
3. adb shell debuggerd -b [tid]

`-b`表示在控制台中输出backtrace, 否则dump到`/data/tombstones`文件夹，生成文件的方式内容比输出到控制台更为丰富。
另外可通过修改system/core/debuggerd/debuggerd.c中dump_stack_and_code定制更多的debug信息。


### 1.3 打印时间戳

#### 1.3.1 Java层

	long startTime = System.currentTimeMillis();
	...
	long spend_time = System.currentTimeMillis() - startTime;
	Log.i(TAG,"spend time：" + spend_time);

#### 1.3.2 C/C++层

	#include <stdio.h>
	#include <sys/time.h>
	void main ()
	{
	    struct timeval time;
	    gettimeofday(&time, NULL); //精度us
	    printf ( "time : %lld ms\n", time.tv_sec * 1000 + time.tv_usec /1000);
	}
	
	
	
### 小节

- kill -3  //输出文件 `data/anr/traces.txt`
- debuggerd -b [tid] //输出文件 `/data/tombstones/tombstone_XX`
- dropbox //输出目录  `/data/system/dropbox/`


## 其他

iostat -x
mount
ionice
service list


### ctrl +z

(1) CTRL+Z挂起进程并放入后台
(2) jobs 显示当前暂停的进程
(3) bg %N 使第N个任务在后台运行(%前有空格)
(4) fg %N 使第N个任务在前台运行
默认bg,fg不带%N时表示对最后一个进程操作!


setprop ctl.start bootanim //启动开机动画
setprop ctl.stop bootanim  //关闭开机动画



## signal

一个应用运行在虚拟机上dvm上一个应用也是一个dvm 进程，dvm 专门创建了一个信号处理线程来处理这3个信号，其他的线程都要block对这三个信号的处理。

这三个信号是 SIGQUIT, SIGUSR1, SIGUSR2
