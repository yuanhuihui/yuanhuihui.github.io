---
layout: post
title:  "进程调度"
date:   2015-10-01 22:20:52
categories: android Process
excerpt:  进程调度
---

* content
{:toc}


---

> 线程与进程的最大区别就是是否共享父进程的地址空间，内核角度来看没有线程与进程之分，都用task_struct结构体来表示

# 一、进程调度

调度器操作的实体便是进程

## 1.1 优先级概念

进程可划分为普通进程和实时进程，那么优先级与nice值的关系图：

![nice_prio](\images\android-process\nice_prio.png)

优先级值越小表示进程优先级越高，3个进程优先级的概念：

- 静态优先级： 不会时间而改变，内核也不会修改，只能通过系统调用改变nice值的方法区修改。优先级映射公式： `static_prio = MAX_RT_PRIO + nice + 20`，其中MAX_RT_PRIO = 100，那么取值区间为**[100, 139]**；对应普通进程；

- 实时优先级：只对实时进程有意义，取值区间为[0, MAX_RT_PRIO -1]，其中MAX_RT_PRIO = 100，那么取值区间为**[0, 99]**；对应实时进程；

- 动态优先级： 调度程序通过增加或减少进程静态优先级的值，来达到奖励IO消耗型或惩罚cpu消耗型的进程，调整后的进程称为动态优先级。区间范围[0, MX_PRIO-1]，其中MX_PRIO = 140，那么取值区间为**[0,139]**；

**nice值**  

nice∈[-20, 19]，可通过adb直接修改某个进程的nice值： `renice prio pid`




## 1.2 framework调度策略

> 代码路径： framework/base/core/android/os/Process.java

### 1.2.1 Process Priority

Android进程优先级，总分10级

优先级调度方法：

	setThreadPriority(int tid, int priority)  

进程优先级级别：

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

### 1.2.2 Group Priority

进程/线程组优先级调度方法： 

	setProcessGroup(int pid, int group)
	setThreadGroup(int tid, int group)

进程组优先级级别：

| 组优先级   | 取值|解释|
| --------   | :-----  | :-----  | 
|THREAD_GROUP_DEFAULT|-1|仅用于setProcessGroup，将优先级<=10的进程提升到-2
|THREAD_GROUP_BG_NONINTERACTIVE|0|CPU分时的时长缩短
|THREAD_GROUP_FOREGROUND|1| CPU分时的时长正常
|THREAD_GROUP_SYSTEM |2|系统线程组
|THREAD_GROUP_AUDIO_APP |3|应用程序音频
|THREAD_GROUP_AUDIO_SYS| 4|系统程序音频

 
### 1.2.3 Scheduler

调度器设置方法：

	setThreadScheduler(int tid, int policy, int priority)

调度器类别

| 调度器   |名称|解释
| --------   | :-----  |
|SCHED_OTHER|默认|标准round-robin分时共享策略
|SCHED_BATCH |批处理调度|针对具有batch风格（批处理）进程的调度策略|
|SCHED_IDLE|空闲调度|针对优先级非常低的适合在后台运行的进程|
|SCHED_FIFO|先进先出|实时调度策略，android暂未实现
|SCHED_RR| 循环调度|实时调度策略，android暂未实现|


## 1.3 Kernel调度策略

设置优先级，Kernel不区别线程和进程，都对应同一个数据结构Task。Linux kernel用nicer值来描述进程的调度优先级，该值越大，表明该进程越友（nice），其被调度运行的几率越低。

### 1.3.1 Priority

	int setpriority(int which, int who, int prio);  

参数说明：

- which和who参数联合使用：
	- 当which为PRIO_PROGRESS时，who代表一个进程；
	- 当which为PRIO_PGROUP时，who代表一个进程组；
	- 当which为PRIO_USER时，who代表一个uid。
- prio参数用于设置应用进程的nicer值，可取范围从-20到19。


### 1.3.2 Scheduler

	int sched_setscheduler(pid_t pid, int policy, conststruct sched_param *param);

参数说明：

- pid为进程id；
- policy为调度策略；
- param最重要的是该结构体中的sched_priority变量；
	- 针对Android中的三种非实时Scheduler策略，该值必须为NULL。


# 二、进程内存清理

## 2.1 进程生命周期

Android系统将尽量长时间地保持应用进程，但为了新建进程或运行更重要的进程，最终需要清除旧进程来回收内存。 为了确定保留或终止哪些进程，系统会根据进程中正在运行的组件以及这些组件的状态，将每个进程放入“重要性层次结构”中。 必要时，系统会首先消除重要性最低的进程，然后是清除重要性稍低一级的进程，依此类推，以回收系统资源。

进程的重要性，划分5级：

1. 前台进程(Foreground process)
- 可见进程(Visible process)
- 服务进程(Service process) 
- 后台进程(Background process)
- 空进程(Empty process)

前台进程的重要性最高，空进程的重要性最低，下面分别来阐述每种级别的进程

### 2.1.1 前台进程

用户当前操作所必需的进程。通常在任意给定时间前台进程都为数不多。只有在内存不足以支持它们同时继续运行这一万不得已的情况下，系统才会终止它们。
 
- 拥有用户正在交互的 Activity（已调用onResume()）
- 拥有某个 Service，后者绑定到用户正在交互的 Activity
- 拥有正在“前台”运行的 Service（服务已调用 startForeground()）
- 拥有正执行一个生命周期回调的 Service（onCreate()、onStart() 或 onDestroy()）
- 拥有正执行其 onReceive() 方法的 BroadcastReceiver

### 2.1.2 可见进程  

没有任何前台组件、但仍会影响用户在屏幕上所见内容的进程。可见进程被视为是极其重要的进程，除非为了维持所有前台进程同时运行而必须终止，否则系统不会终止这些进程。
	
- 拥有不在前台、但仍对用户可见的 Activity（已调用onPause()）。
- 拥有绑定到可见（或前台）Activity 的 Service  
  
### 2.1.3 服务进程  

尽管服务进程与用户所见内容没有直接关联，但是它们通常在执行一些用户关心的操作（例如，在后台播放音乐或从网络下载数据）。因此，除非内存不足以维持所有前台进程和可见进程同时运行，否则系统会让服务进程保持运行状态。

- 正在运行startService()方法启动的服务，且不属于上述两个更高类别进程的进程。

### 2.1.4 后台进程  

后台进程对用户体验没有直接影响，系统可能随时终止它们，以回收内存供前台进程、可见进程或服务进程使用。 通常会有很多后台进程在运行，因此它们会保存在LRU列表中，以确保包含用户最近查看的Activity的进程最后一个被终止。如果某个 Activity 正确实现了生命周期方法，并保存了其当前状态，则终止其进程不会对用户体验产生明显影响，因为当用户导航回该 Activity 时，Activity 会恢复其所有可见状态。

- 对用户不可见的Activity的进程（已调用Activity的onStop()方法）

### 2.1.5 空进程  

保留这种进程的的唯一目的是用作缓存，以缩短下次在其中运行组件所需的启动时间。 为使总体系统资源在进程缓存和底层内核缓存之间保持平衡，系统往往会终止这些进程。

- 不含任何活动应用组件的进程


----------

## 2.2 Lowmemorykiller

### 2.2.1 ADJ级别

oom_adj划分为16级，从-17 到16之间取值。

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

说明：上表“解释列”加粗的行，即Lowmemorykiller的杀进程的档，共6档。

### 2.2.2 策略

Lowmemorykiller根据当前可用内存情况来进行进程释放，总设计了6个级别。系统内存从很宽裕到不足，Lowmemorykiller也会相应地从CACHED_APP_MAX_ADJ(第1档)开始杀进程，如果内存还不足，那么会杀CACHED_APP_MIN_ADJ(第2档)，不断加深。

1. CACHED_APP_MAX_ADJ
2. CACHED_APP_MIN_ADJ
3. BACKUP_APP_ADJ
4. PERCEPTIBLE_APP_ADJ
5. VISIBLE_APP_ADJ
6. FOREGROUND_APP_ADJ



# 参考

- <http://developer.android.com/intl/zh-cn/guide/components/processes-and-threads.html>