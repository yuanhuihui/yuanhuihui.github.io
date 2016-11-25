### 小节

- kill -3  //输出文件 `data/anr/traces.txt`
- debuggerd -b [tid] //输出文件 `/data/tombstones/tombstone_XX`
- dropbox //输出目录  `/data/system/dropbox/`


## 一、打印堆栈

打印堆栈信息，从语言层面分为Java和C/C++代码，从进程角度分为Java进程和kernel进程。

### 1.1 Java层

在Java层的代码中，有下面3种方法可以打印堆栈信息：

方法1：

	new RuntimeException("stack info").printStackTrace();
	Thread.currentThread().dumpStack(); //等价

方法2：

	Log.d(TAG,Log.getStackTraceString(new Throwable("stack info")));

方法3：

	try {
		...
	} catch (Exception e) {  
	  e.printStackTrace();  //适用于发生Exception的情形
	}  

### 1.2 C/C++层

C/C++层，可通过CallStack的方式来打印堆栈信息

    android::CallStack stack;
    stack.update();
    stack.dump();


### 1.3 java进程

方法1：

	Process.sendSignal(pid, Process.SIGNAL_QUIT);  //代码方式

方法2：

	kill -3 pid  //adb命令方式

方法3：

	ActivityManagerService.dumpStackTraces();   //ANR时会触发调用此方法

其实上述3个方法实现原理的本质是一样的，其中`Process.SIGNAL_QUIT=3`，都会生成trace文件，并保存在`data/anr/traces.txt`文件。这里需要特别注意，如果无法正常生成该文件，很可能是权限问题，需要提前手动创建好相应目录或文件，并赋予相应的权限。


上述3个方法只能处理java进程，换句话说就是只能打印出Zygote进程孵化而来的子进程，比如system_server或者App进程。由虚拟机art/runtime/signal_catcher.cc中相应方法来处理。

方法1和方法2功能完全一致，方法3在前两个方法的基础之上，还会输出kernel进程以及当前系统的CPU使用情况。

### 1.4 kernel进程堆栈

方法1：

	Watchdog.dumpKernelStackTraces（这是私有方法，不允许外部调用，触发采用反射方式）。  

方法2：

	Debug.dumpNativeBacktraceToFile(pid, tracesPath);

方法3：

	debuggerd -b [tid]

`-b`表示在控制台中输出backtrace, 否则dump到`/data/tombstones`文件夹，生成文件的方式内容比输出到控制台更为丰富。对于native进程异常，会触发debugerd，生成文件并保存到目录/data/tombstones下，一般名为tombstone_xx(xx为第N个文件)。

另外，可通过修改system/core/debuggerd/debuggerd.c中dump_stack_and_code的代码来进一步增加更多的debug信息。


## 二、打印函数视角戳

### 2.1 Java层

	long startTime = System.currentTimeMillis();
	//一系列函数操作
	long spend_time = System.currentTimeMillis() - startTime;
	Log.i(TAG,"spend time：" + spend_time);

### 2.2 Native层

	#include <stdio.h>
	#include <sys/time.h>
	void main ()
	{
	    struct timeval time;
	    gettimeofday(&time, NULL);
	    printf ( "time : %lld ms\n", time.tv_sec * 1000 + time.tv_usec /1000);
	}

其中 gettimeofday()的精度us

## 其他调试

	strace -f -p pid -o output

1. -f表示跟踪所有子进程.
2. -o输出log到指定文件，默认直接输出到屏幕。

打印进程的系统调用，主要包含文件、SOCKET、锁等系统操作的信息。




## signal

1）Zygote 监控 子进程的退出情况

jellybean/dalvik/vm/native/dalvik_system_Zygote.cpp #151

    151     sa.sa_handler = sigchldHandler;
    153     err = sigaction (SIGCHLD, &sa, NULL);


2）DVM 生成单独的信号处理线程，用来对三个信号做特殊处理：

每个进程包含多个线程，当进程受到 signal 的时候，可能被其中任何一个线程处理

一个应用运行在虚拟机上dvm上一个应用也是一个dvm 进程，dvm 专门创建了一个信号处理线程来处理这3个信号，其他的线程都要block对这三个信号的处理。

这三个信号是 SIGQUIT, SIGUSR1, SIGUSR2









## crash

 services/core/java/com/android/server/am/NativeCrashListener

static final String DEBUGGERD_SOCKET_PATH = "/data/system/ndebugsocket";


## 其他

iostat -x
mount
ionice

service list


## Log使用

### 1.Native层

	#define LOG_TAG "TAG"
	#include <utils/Log.h>
	Log.i(TAG,"my log info");

### logcat

logcat -s system_server

分别一个个地看进程情况，zygote, system_server这些进程

如何看event log

/system/etc/event-log-tags


### else

BootFramework 拉频率

DropBoxManagerService会将结果保存在/data/system/dropbox。

### ctrl +z

(1) CTRL+Z挂起进程并放入后台
(2) jobs 显示当前暂停的进程
(3) bg %N 使第N个任务在后台运行(%前有空格)
(4) fg %N 使第N个任务在前台运行
默认bg,fg不带%N时表示对最后一个进程操作!

### binder debug 3


android_util_Binder.cpp
android_os_Parcel.cpp

    signalExceptionForError

###

setprop ctl.start bootanim //启动开机动画
setprop ctl.stop bootanim  //关闭开机动画
