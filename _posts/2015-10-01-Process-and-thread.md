---
layout: post
title:  "进程和线程"
date:   2015-10-01 22:20:52
categories: android
excerpt:  进程和线程
---

* content
{:toc}


---

## 一、进程调度

### 1.1 优先级概念  á
优先级区别普通进程和实时进程。对于普通进程分静态优先级和动态优先级；而实时进程又增加实时优先级。`其中MAX_RT_PRIO = 100, MX_PRIO =140，nice∈[-20, 19]`

- 静态优先级： 不会时间而改变，内核也不会修改，只能通过系统调用改变nice值的方法区修改。优先级映射公式： static_prio = MAX_RT_PRIO + nice + 20，则静态优先级的取值区间为**[100, 139]**。

- 动态优先级: 调度程序通过增加或减少进程静态优先级的值，来达到奖励IO消耗型或惩罚cpu消耗型的进程，调整后的进程称为动态优先级。区间范围[0, MX_PRIO-1]，值越大表示进程优先级越小。等价于**[0,139]**

- 实时优先级：支队实时进程有意义，取值区间为[0, MAX_RT_PRIO -1]，等价于**[0, 99]**.

另外，可通过adb直接修改某个进程的nice值： `renice prio pid`

### 1.2 上层调度策略

> 代码路径： framework/base/core/android/os/Process.java

**Android进程优先级**（总10级）

优先级调度：setThreadPriority(int tid, int priority)  

| 进程优先级   | nice值        |解释|
| --------   | :-----  | :-----  | 
|THREAD_PRIORITY_LOWEST| 19|最低优先级
|THREAD_PRIORITY_BACKGROUND |10|**后台**
|THREAD_PRIORITY_LESS_FAVORABLE| 1|比默认略低
|THREAD_PRIORITY_DEFAULT|0|默认
|THREAD_PRIORITY_MORE_FAVORABLE| -1|比默认略高
|THREAD_PRIORITY_FOREGROUND | -2|**前台**
|THREAD_PRIORITY_DISPLAY| -4|显示相关
|THREAD_PRIORITY_URGENT_DISPLAY| -8|显示(更为重要)，input事件
|THREAD_PRIORITY_AUDIO| -16|音频相关
|THREAD_PRIORITY_URGENT_AUDIO| -19|音频(更为重要)

**组优先级**

进程/线程组优先级调度： setProcessGroup(int pid, int group)，setThreadGroup(int tid, int group)

| 组优先级   | 取值|解释|
| --------   | :-----  | :-----  | 
|THREAD_GROUP_DEFAULT|-1|仅用于setProcessGroup，将优先级<=10的进程提升到-2
|THREAD_GROUP_BG_NONINTERACTIVE|0|CPU分时的时长缩短
|THREAD_GROUP_FOREGROUND|1| CPU分时的时长正常
|THREAD_GROUP_SYSTEM |2|系统线程组
|THREAD_GROUP_AUDIO_APP |3|应用程序音频
|THREAD_GROUP_AUDIO_SYS| 4|系统程序音频

 
**调度器**

调度器设置：setThreadScheduler(int tid, int policy, int priority)

| 调度器   |名称|解释
| --------   | :-----  |
|SCHED_OTHER|默认|标准round-robin分时共享策略
|SCHED_BATCH |批处理调度|针对具有batch风格（批处理）进程的调度策略|
|SCHED_IDLE|空闲调度|针对优先级非常低的适合在后台运行的进程|
|SCHED_FIFO|先进先出|实时调度策略，android暂未实现
|SCHED_RR| 循环调度|实时调度策略，android暂未实现|


### 1.3 Kernel调度策略
设置优先级，Kernel不区别线程和进程，都对应同一个数据结构Task。
 
Linux kernel用nicer值来描述进程的调度优先级，该值越大，表明该进程越友（nice），其被调度运行的几率越低。

- int setpriority(int which, int who, int prio);  
	- which和who参数联合使用。当which为PRIO_PROGRESS时，who代表一个进程；当which为PRIO_PGROUP时，who代表一个进程组；当which为PRIO_USER时，who代表一个uid。
	- prio参数用于设置应用进程的nicer值，可取范围从-20到19。

- int sched_setscheduler(pid_t pid, int policy, conststruct sched_param *param);
	- 第一个参数为进程id
	- 第二个参数为调度策略
	- param参数中最重要的是该结构体中的sched_priority变量。针对Android中的三种非实时调度策略，该值必须为NULL。


## 二、进程内存清理
### 2.1 进程生命周期
Android 系统将尽量长时间地保持应用进程，但为了新建进程或运行更重要的进程，最终需要清除旧进程来回收内存。 为了确定保留或终止哪些进程，系统会根据进程中正在运行的组件以及这些组件的状态，将每个进程放入“重要性层次结构”中。 必要时，系统会首先消除重要性最低的进程，然后是重要性略逊的进程，依此类推，以回收系统资源。

重要性层次结构共5级：

1. 前台进程(Foreground process)   
用户当前操作所必需的进程。通常，在任意给定时间前台进程都为数不多。只有在内在不足以支持它们同时继续运行这一万不得已的情况下，系统才会终止它们。 此时，设备往往已达到内存分页状态，因此需要终止一些前台进程来确保用户界面正常响应。 
	- 拥有用户正在交互的 Activity（已调用onResume()）
	- 拥有某个 Service，后者绑定到用户正在交互的 Activity
	- 拥有正在“前台”运行的 Service（服务已调用 startForeground()）
	- 拥有正执行一个生命周期回调的 Service（onCreate()、onStart() 或 onDestroy()）
	- 拥有正执行其 onReceive() 方法的 BroadcastReceiver

- 可见进程(Visible process)  
没有任何前台组件、但仍会影响用户在屏幕上所见内容的进程。 如果一个进程满足以下任一条件，即视为可见进程：
可见进程被视为是极其重要的进程，除非为了维持所有前台进程同时运行而必须终止，否则系统不会终止这些进程。
	- 拥有不在前台、但仍对用户可见的 Activity（已调用onPause()）。
	- 拥有绑定到可见（或前台）Activity 的 Service  
  
- 服务进程(Service process)  
正在运行已使用 startService() 方法启动的服务且不属于上述两个更高类别进程的进程。尽管服务进程与用户所见内容没有直接关联，但是它们通常在执行一些用户关心的操作（例如，在后台播放音乐或从网络下载数据）。因此，除非内存不足以维持所有前台进程和可见进程同时运行，否则系统会让服务进程保持运行状态。

- 后台进程(Background process)  
包含目前对用户不可见的 Activity 的进程（已调用 Activity 的 onStop() 方法）。这些进程对用户体验没有直接影响，系统可能随时终止它们，以回收内存供前台进程、可见进程或服务进程使用。 通常会有很多后台进程在运行，因此它们会保存在 LRU （最近最少使用）列表中，以确保包含用户最近查看的 Activity 的进程最后一个被终止。如果某个 Activity 正确实现了生命周期方法，并保存了其当前状态，则终止其进程不会对用户体验产生明显影响，因为当用户导航回该 Activity 时，Activity 会恢复其所有可见状态。 有关保存和恢复状态的信息，请参阅Activity文档。

- 空进程(Empty process)  
不含任何活动应用组件的进程。保留这种进程的的唯一目的是用作缓存，以缩短下次在其中运行组件所需的启动时间。 为使总体系统资源在进程缓存和底层内核缓存之间保持平衡，系统往往会终止这些进程。


### 2.2 lowmemorykiller

oom_adj
共分为16级。

| ADJ级别   | 取值|解释|
| --------   | :-----  | :-----  |
|UNKNOWN_ADJ|16|一般指将要会缓存进程，无法获取确定值
|CACHED_APP_MAX_ADJ|15|**不可见进程的adj最大值 1**
|CACHED_APP_MIN_ADJ|9|**不可见进程的adj最小值 2**
|SERVICE_B_AD| 8| B List中的Service（较老的、使用可能性更小）
|PREVIOUS_APP_ADJ| 7|上一个App的进程(往往通过按返回键)
|HOME_APP_ADJ | 6|Home进程
|SERVICE_ADJ | 5|服务进程(Service process)
|HEAVY_WEIGHT_APP_ADJ | 4|后台的重量级进程，system/rootdir/init.rc文件中设置
|BACKUP_APP_ADJ | 3|**备份进程 3**
|PERCEPTIBLE_APP_ADJ | 2|**可感知进程，比如后台音乐播放  4**
|VISIBLE_APP_ADJ | 1|**可见进程(Visible process) 5** 
|FOREGROUND_APP_ADJ | 0|**前台进程（Foreground process） 6**
|PERSISTENT_SERVICE_ADJ | -11|关联着系统或persistent进程
|PERSISTENT_PROC_ADJ | -12|系统persistent进程，比如telephony
|SYSTEM_ADJ |-16|系统进程
|NATIVE_ADJ | -17|native进程（不被系统管理）

说明：low memory killer根据当前可用内存情况来进行进程释放，总设计了6个级别，分为是下表“解释”中加粗的行


## 思考
- 进程MAX_EMPTY_TIME是否可以优化调整，默认为30min


## 参考

- <http://developer.android.com/intl/zh-cn/guide/components/processes-and-threads.html>
- <http://hukai.me/android-notes-process-and-thread/>