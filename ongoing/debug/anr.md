ANR一般有三种类型：

1：KeyDispatchTimeout(5 seconds) --主要类型
按键或触摸事件在特定时间内无响应

staticfinal int KEY_DISPATCHING_TIMEOUT = 5*1000

2：BroadcastTimeout(10 seconds)
BroadcastReceiver在特定时间内无法处理完成

3：ServiceTimeout(20 seconds) --小概率类型
Service在特定的时间内无法处理完成


四：为什么会超时呢？
超时时间的计数一般是从按键分发给app开始。超时的原因一般有两种：
(1)当前的事件没有机会得到处理（即UI线程正在处理前一个事件，没有及时的完成或者looper被某种原因阻塞住了）
(2)当前的事件正在处理，但没有及时完成

五：如何避免KeyDispatchTimeout
1：UI线程尽量只做跟UI相关的工作
2：耗时的工作（比如数据库操作，I/O，连接网络或者别的有可能阻碍UI线程的操作）把它放入单独的线程处理
3：尽量用Handler来处理UIthread和别的thread之间的交互

UI线程主要包括如下：
Activity:onCreate(), onResume(), onDestroy(), onKeyDown(), onClick(),etc
AsyncTask: onPreExecute(), onProgressUpdate(), onPostExecute(), onCancel,etc
Mainthread handler: handleMessage(), post*(runnable r), etc

## Tips

- 当前发生ANR的应用进程被第一个添加进firstPids集合中，所以会第一个向traces文件中写入信息。
那么traces文件中出现的第一个进程正常情况下就是发生ANR的那个进程。
- 偶尔，发生ANR的进程还没有来得及输出trace信息，就由于某种原因退出了，所以偶尔会遇到traces文件中找不到发生ANR的进程信息的情况。

## 可疑点

1. cpu block, cpu load过重
2. iowait
    100%TOTAL: 6.9% user + 8.2% kernel + 84%iowait

3. 内存 泄露，内存不足， 内存碎片

    atdalvik.system.VMRuntime.trackExternalAllocation(NativeMethod)内存不足导致block在创建bitmap上

4. 硬件损坏或接触不良

### 八：Thread状态

    ThreadState (defined at “dalvik/vm/thread.h “)
    THREAD_UNDEFINED = -1, /* makes enum compatible with int32_t */
    THREAD_ZOMBIE = 0, /* TERMINATED */
    THREAD_RUNNING = 1, /* RUNNABLE or running now */
    THREAD_TIMED_WAIT = 2, /* TIMED_WAITING in Object.wait() */
    THREAD_MONITOR = 3, /* BLOCKED on a monitor */
    THREAD_WAIT = 4, /* WAITING in Object.wait() */
    THREAD_INITIALIZING= 5, /* allocated, not yet running */
    THREAD_STARTING = 6, /* started, not yet on thread list */
    THREAD_NATIVE = 7, /* off in a JNI native method */
    THREAD_VMWAIT = 8, /* waiting on a VM resource */
    THREAD_SUSPENDED = 9, /* suspended, usually by GC or debugger */

状态对比：

|Java|C++|解释|
|---|---|
|New||新建|
|RUNNABLE||可执行或正在执行|
|BLOCKED||阻塞|
|WAITING||等待|
|TIMED_WAITING||等待(带超时参数)|
|TERMINATED||终止|

TIMED_WAITING可以是wait、sleep或join函数

### trace分析

    线程名、（如果带有daemon说明是守护线程）、优先级、线程创建时的序号、线程当前状态
    "main" prio=5 tid=1 Blocked
        线程组名称、suspendCount、debugSuspendCount、线程的Java对象地址、线程的Native对象地址
      | group="main" sCount=1 dsCount=0 obj=0x76231de0 self=0x7f885fba00
         线程号（主线程的线程号和进程号相同）
      | sysTid=1723 nice=-2 cgrp=default sched=0/0 handle=0x7f8bbd5fe8
      | state=S schedstat=( 50771665889 26782378685 134348 ) utm=2791 stm=2286 core=1 HZ=100
      | stack=0x7fc6c1b000-0x7fc6c1d000 stackSize=8MB
      | held mutexes=
      at com.android.server.am.ActivityManagerService.onWakefulnessChanged(ActivityManagerService.java:10503)
      - waiting to lock <0x072bbeb5> (a com.android.server.am.ActivityManagerService) held by thread 90
      at com.android.server.am.ActivityManagerService$LocalService.onWakefulnessChanged(ActivityManagerService.java:20944)
      at com.android.server.power.Notifier$1.run(Notifier.java:306)
      at android.os.Handler.handleCallback(Handler.java:739)
      at android.os.Handler.dispatchMessage(Handler.java:95)
      at android.os.Looper.loop(Looper.java:148)
      at com.android.server.SystemServer.run(SystemServer.java:293)
      at com.android.server.SystemServer.main(SystemServer.java:178)
      at java.lang.reflect.Method.invoke!(Native method)
      at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:738)
      at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:628)

### cpu usage

    ActivityManager:  90% 24048/system_server: 25% user + 65% kernel / faults: 12992 minor 6 major

- major是指Major Page Fault（主要页错误，简称MPF），内核在读取数据时会先后查找CPU的高速缓存和物理内存，
如果找不到会发出一个MPF信息，请求将数据加载到内存。文件第一次加载时算在major
- Minor是指Minor Page Fault（次要页错误，简称MnPF），
磁盘数据被加载到内存后，内核再次读取时，会发出一个MnPF信息。文件从内存加载算在minor.


## 查看anr的trace方法

找到主线程，

Cmd line: system_server
sysTid=<pid>的问题
