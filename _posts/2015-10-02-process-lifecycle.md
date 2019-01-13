---
layout: post
title:  "Android进程生命周期与ADJ"
date:   2015-10-01 22:20:52
catalog:  true
tags:
    - android
    - 进程系列

---


> 做为应用开发者，对于进程生命周期和进程中的内存回收是透明的，但了解生命周期对加深对Andorid体系的理解很有帮助

## 一、 进程生命周期

Android系统将尽量长时间地保持应用进程，但为了新建进程或运行更重要的进程，最终需要清除旧进程来回收内存。 为了确定保留或终止哪些进程，系统会根据进程中正在运行的组件以及这些组件的状态，将每个进程放入“重要性层次结构”中。 必要时，系统会首先消除重要性最低的进程，然后是清除重要性稍低一级的进程，依此类推，以回收系统资源。

进程的重要性，划分5级：

1. 前台进程(Foreground process)
2. 可见进程(Visible process)
3. 服务进程(Service process)
4. 后台进程(Background process)
5. 空进程(Empty process)

前台进程的重要性最高，依次递减，空进程的重要性最低，下面分别来阐述每种级别的进程

### 1.1 Foreground process

用户当前操作所必需的进程。通常在任意给定时间前台进程都为数不多。只有在内存不足以支持它们同时继续运行这一万不得已的情况下，系统才会终止它们。

- 拥有用户正在交互的 Activity（已调用onResume()）
- 拥有某个 Service，后者绑定到用户正在交互的 Activity
- 拥有正在“前台”运行的 Service（服务已调用 startForeground()）
- 拥有正执行一个生命周期回调的 Service（onCreate()、onStart() 或 onDestroy()）
- 拥有正执行其 onReceive() 方法的 BroadcastReceiver

### 1.2 Visible process

没有任何前台组件、但仍会影响用户在屏幕上所见内容的进程。可见进程被视为是极其重要的进程，除非为了维持所有前台进程同时运行而必须终止，否则系统不会终止这些进程。

- 拥有不在前台、但仍对用户可见的 Activity（已调用onPause()）。
- 拥有绑定到可见（或前台）Activity 的 Service

### 1.3 Service process

尽管服务进程与用户所见内容没有直接关联，但是它们通常在执行一些用户关心的操作（例如，在后台播放音乐或从网络下载数据）。因此，除非内存不足以维持所有前台进程和可见进程同时运行，否则系统会让服务进程保持运行状态。

- 正在运行startService()方法启动的服务，且不属于上述两个更高类别进程的进程。

### 1.4 Background process

后台进程对用户体验没有直接影响，系统可能随时终止它们，以回收内存供前台进程、可见进程或服务进程使用。 通常会有很多后台进程在运行，因此它们会保存在LRU列表中，以确保包含用户最近查看的Activity的进程最后一个被终止。如果某个 Activity 正确实现了生命周期方法，并保存了其当前状态，则终止其进程不会对用户体验产生明显影响，因为当用户导航回该 Activity 时，Activity 会恢复其所有可见状态。

- 对用户不可见的Activity的进程（已调用Activity的onStop()方法）

### 1.5 Empty process

保留这种进程的的唯一目的是用作缓存，以缩短下次在其中运行组件所需的启动时间。 为使总体系统资源在进程缓存和底层内核缓存之间保持平衡，系统往往会终止这些进程。

- 不含任何活动应用组件的进程


## 二、 Lowmemorykiller

Android中对于内存的回收，主要依靠Lowmemorykiller来完成，是一种根据阈值级别触发相应力度的内存回收的机制。

### 2.1 ADJ级别

定义在ProcessList.java文件，oom_adj划分为16级，从-17到16之间取值。

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

### 2.2 进程state级别

定义在ActivityManager.java文件，process_state划分18类，从-1到16之间取值。

| state级别   | 取值|解释|
| --------   | :-----  | :-----  |
|PROCESS_STATE_CACHED_EMPTY|16|进程处于cached状态，且为空进程|
|PROCESS_STATE_CACHED_ACTIVITY_CLIENT|15|进程处于cached状态，且为另一个cached进程(内含Activity)的client进程|
|PROCESS_STATE_CACHED_ACTIVITY|14|进程处于cached状态，且内含Activity|
|PROCESS_STATE_LAST_ACTIVITY|13|后台进程，且拥有上一次显示的Activity|
|PROCESS_STATE_HOME|12|后台进程，且拥有home Activity|
|PROCESS_STATE_RECEIVER|11|后台进程，且正在运行receiver|
|PROCESS_STATE_SERVICE|10|后台进程，且正在运行service|
|PROCESS_STATE_HEAVY_WEIGHT|9|后台进程，但无法执行restore，因此尽量避免kill该进程|
|PROCESS_STATE_BACKUP|8|后台进程，正在运行backup/restore操作|
|PROCESS_STATE_IMPORTANT_BACKGROUND|7|对用户很重要的进程，用户不可感知其存在|
|PROCESS_STATE_IMPORTANT_FOREGROUND|6|对用户很重要的进程，用户可感知其存在|
|PROCESS_STATE_TOP_SLEEPING|5|与PROCESS_STATE_TOP一样，但此时设备正处于休眠状态|
|PROCESS_STATE_FOREGROUND_SERVICE|4|拥有给一个前台Service|
|PROCESS_STATE_BOUND_FOREGROUND_SERVICE|3|拥有给一个前台Service，且由系统绑定|
|PROCESS_STATE_TOP|2|拥有当前用户可见的top Activity|
|PROCESS_STATE_PERSISTENT_UI|1|persistent系统进程，并正在执行UI操作|
|PROCESS_STATE_PERSISTENT|0|persistent系统进程|
|PROCESS_STATE_NONEXISTENT|-1|不存在的进程|

### 2.3 lmk策略

Lowmemorykiller根据当前可用内存情况来进行进程释放，总设计了6个级别，即上表中“解释列”加粗的行，即Lowmemorykiller的杀进程的6档，如下：

1. CACHED_APP_MAX_ADJ
2. CACHED_APP_MIN_ADJ
3. BACKUP_APP_ADJ
4. PERCEPTIBLE_APP_ADJ
5. VISIBLE_APP_ADJ
6. FOREGROUND_APP_ADJ

系统内存从很宽裕到不足，Lowmemorykiller也会相应地从CACHED_APP_MAX_ADJ(第1档)开始杀进程，如果内存还不足，那么会杀CACHED_APP_MIN_ADJ(第2档)，不断深入，直到满足内存阈值条件。
