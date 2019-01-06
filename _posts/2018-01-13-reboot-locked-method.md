---
layout: post
title:  "数组越界导致系统重启的案例"
date:   2018-01-13 22:11:12
catalog:  true
tags:
    - android

---

> 这是作者在2017年处理的数组越界的案例，要理解该问题需熟练掌握以下知识：

- [Activity启动流程](http://gityuan.com/2016/03/12/start-activity/)
- [进程创建流程](http://gityuan.com/2016/10/09/app-process-create-2/)
- [ANR触发流程](http://gityuan.com/2016/03/12/start-activity/)

## 一. 问题描述

### 引言
一般数组越界问题, 往往是涉及多线程并发的情况下, 某个或多个临界资源(比如类或对象的成员变量)多线程并发读写而导致的异常。出现这样情况, 一般是该保护的地方没有用同步锁保护，或者是用错了同步锁，这类问题比较常规。但本文要分享的案例却是一个方法内的临界资源已被加锁保护的情况下仍然出现的数组越界问题, 导致system_server挂掉，手机重启。

### 问题调用栈

    2017-02-27 07:14:46 system_server_crash (text, 1021 bytes)
    Process: system_server
    java.lang.IndexOutOfBoundsException: Invalid index 8, size is 8
    at java.util.ArrayList.throwIndexOutOfBoundsException(ArrayList.java:255)
    at java.util.ArrayList.get(ArrayList.java:308)
    at com.android.server.am.ActivityStack.finishTopRunningActivityLocked(ActivityStack.java:2901)
    at com.android.server.am.ActivityStackSupervisor.finishTopRunningActivityLocked(ActivityStackSupervisor.java:2891)
    at com.android.server.am.ActivityManagerService.handleAppCrashLocked(ActivityManagerService.java:12483)
    at com.android.server.am.ActivityManagerService.killAppAtUsersRequest(ActivityManagerService.java:12434)
    at com.android.server.am.AppNotRespondingDialog$1.handleMessage(AppNotRespondingDialog.java:114)
    at android.os.Handler.dispatchMessage(Handler.java:102)
    at android.os.Looper.loop(Looper.java:148)
    at android.os.HandlerThread.run(HandlerThread.java:61)
    at com.android.server.ServiceThread.run(ServiceThread.java:46)
    
该问题出现在Android 6.0的机型上，从调用栈可以看出是在某个应用发生ANR的时候弹出对话框的过程导致手机重启。

### 疑问

来看看调用栈上的finishTopRunningActivityLocked()方法：

![finishTopRunningActivityLocked](/images/reboot_case_1/1.png)

在Android源码里面有大量方法名为`xxxLock`,  其含义是指该方法是非线程安全的, 所有调用该方法的地方一定是加过锁的. 也就是说
finishTopRunningActivityLocked()该方法一定是被AMS锁synchronized所保护, 既然同步锁保护, 为何还会出现mTaskHistory变量获取过程为出现数据越界的问题? 先告诉大家答案, 这个问题是Android 6.0原生问题，是一个低概率事件，最新的版本已修复。

接下来, 开始一步步剖析, 解开谜团.

## 二. 问题分析

分析重启异常问题，最重要的是从时间点附近逐步分析推理整个过程。重启发生在2017-02-27 07:14:46，需要逐一遴选基于该时间点附近的关键日志。这个过程日志有很多，需要有一定的功底，对于一行静态的日志能推算出复杂系统的动态执行流程，具体筛选过程就不再一一赘述了，下面直接列出跟该问题直接相关的核心日志信息。

### 核心日志

    //Step 1. ANR
    02-27 07:14:44.015  1236  1275 E ActivityManager: ANR in com.dailyyoga.cn (com.dailyyoga.cn/.activity.PlanDetailActivity)
    02-27 07:14:44.015  1236  1275 E ActivityManager: PID: 13930
    02-27 07:14:44.015  1236  1275 E ActivityManager: Reason: Input dispatching timed out (Waiting because the touched window's input channel is not registered with the input dispatcher.  The window may be in the process of being removed.)

    //Step 2. AS.finishTopRunningActivityLocked()
    02-27 07:14:46.197    1236 1276 ActivityManager:   Force finishing activity com.dailyyoga.cn/.activity.PlanDetailActivity

    // Step 3. AS.startPausingLocked()
    02-27 07:14:46.206    1236 1276   W ActivityManager: Exception thrown during pause
    02-27 07:14:46.206    1236 1276   W ActivityManager: android.os.DeadObjectException: Transaction failed on small parcel; remote process probably died
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at android.os.BinderProxy.transactNative(Native Method)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at android.os.BinderProxy.transact(Binder.java:503)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at android.app.ApplicationThreadProxy.schedulePauseActivity(ApplicationThreadNative.java:727)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.startPausingLocked(ActivityStack.java:915)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.finishActivityLocked(ActivityStack.java:3030)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.finishTopRunningActivityLocked(ActivityStack.java:2886)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStackSupervisor.finishTopRunningActivityLocked(ActivityStackSupervisor.java:2891)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.ActivityManagerService.handleAppCrashLocked(ActivityManagerService.java:12483)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.ActivityManagerService.killAppAtUsersRequest(ActivityManagerService.java:12434)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.am.AppNotRespondingDialog$1.handleMessage(AppNotRespondingDialog.java:114)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at android.os.Handler.dispatchMessage(Handler.java:102)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at android.os.Looper.loop(Looper.java:148)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at android.os.HandlerThread.run(HandlerThread.java:61)
    02-27 07:14:46.206    1236 1276   W ActivityManager:    at com.android.server.ServiceThread.run(ServiceThread.java:46)

    //Step 4. AS.resumeTopActivityInnerLocked()
    02-27 07:14:46.209    1236 1276   I ActivityManager: Restarting because process died: ActivityRecord{909d520 u0 com.dailyyoga.cn/.FrameworkActivity t1861}

    //Step 5. ASS.startSpecificActivityLocked()
    02-27 07:14:46.211    1236 1276   W ActivityManager: Exception when starting activity com.dailyyoga.cn/.FrameworkActivity
    02-27 07:14:46.211    1236 1276   W ActivityManager: android.os.DeadObjectException: Transaction failed on small parcel; remote process probably died
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at android.os.BinderProxy.transactNative(Native Method)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at android.os.BinderProxy.transact(Binder.java:503)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at android.app.ApplicationThreadProxy.scheduleLaunchActivity(ApplicationThreadNative.java:826)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStackSupervisor.realStartActivityLocked(ActivityStackSupervisor.java:1357)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStackSupervisor.startSpecificActivityLocked(ActivityStackSupervisor.java:1457)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.resumeTopActivityInnerLocked(ActivityStack.java:2058)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.resumeTopActivityLocked(ActivityStack.java:1605)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.resumeTopActivityLocked(ActivityStack.java:1588)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.startPausingLocked(ActivityStack.java:970)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.finishActivityLocked(ActivityStack.java:3030)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStack.finishTopRunningActivityLocked(ActivityStack.java:2886)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityStackSupervisor.finishTopRunningActivityLocked(ActivityStackSupervisor.java:2891)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityManagerService.handleAppCrashLocked(ActivityManagerService.java:12483)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.ActivityManagerService.killAppAtUsersRequest(ActivityManagerService.java:12434)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.am.AppNotRespondingDialog$1.handleMessage(AppNotRespondingDialog.java:114)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at android.os.Handler.dispatchMessage(Handler.java:102)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at android.os.Looper.loop(Looper.java:148)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at android.os.HandlerThread.run(HandlerThread.java:61)
    02-27 07:14:46.211    1236 1276   W ActivityManager:    at com.android.server.ServiceThread.run(ServiceThread.java:46)

    //Step 6. AMS.startProcessLocked()
    02-27 07:14:46.211    1236 1276  D ActivityManager: cleanUpApplicationRecord -- 13930
    02-27 07:14:46.211    1236 1277   I libprocessgroup: Killing pid 14312 in uid 10227 as part of process group 13930

    //Step 7. AS.removeHistoryRecordsForAppLocked()
    02-27 07:14:46.216    1236 1276   W ActivityManager: Force removing ActivityRecord{909d520 u0 com.dailyyoga.cn/.FrameworkActivity t1861}: app died, no saved state

    //论证Step6的正确性
    02-27 07:14:46.230 1236 1276 [null] I ActivityManager: Start proc 14895:com.dailyyoga.cn/u0a227 for activity com.dailyyoga.cn/.FrameworkActivity

接下来，基于上述的日志从源码中找到相应的方法，推测代码执行流。要理解该问题需熟练掌握进程创建流程、Activity启动流程、ANR执行流程。

### Step 1. ANR
从核心日志，可以看到com.dailyyoga.cn发生了一次ANR，网上一搜得知这个App是每日瑜伽。该App在界面PlanDetailActivity时，超过5s主线程没有响应input事件, 从而引发应用ANR。由于发生的是前台ANR, 则会弹出对话框, 让用户选择是等待还是关闭该应用。

作为一个App是否有可能导致系统重启，这个还不确定，至少有一点可以推测出，那就是系统重启跟ANR对话框有一定的关系。

### Step 2. AS.finishTopRunningActivityLocked
发生ANR后间隔2s就出现上面这行log, 可定位已执行到如下方法，这个方法是由finishTopRunningActivityLocked()调用的。

![finishTopRunningActivityLocked](/images/reboot_case_1/2.png)


### Step 3. AS.startPausingLocked

![finishTopRunningActivityLocked](/images/reboot_case_1/3.png)

每日瑜伽应用发生异常后, 这时会设置mPausingActivity = null, 这个很重要, 前面传递的参数resuming=false, 则便会走到如下流程

![finishTopRunningActivityLocked](/images/reboot_case_1/4.png)

### Step 4. AS.resumeTopActivityInnerLocked

![finishTopRunningActivityLocked](/images/reboot_case_1/5.png)

虽然这里没有出现调用栈, 不难看出, 这里发生异常的地方, 应该是next.app.thread.scheduleResumeActivity.之后开始执行startSpecificActivityLocked操作.

### Step 5. ASS.startSpecificActivityLocked

![finishTopRunningActivityLocked](/images/reboot_case_1/6.png)

进入startSpecificActivityLocked方法, 执行realStartActivityLocked()出现Exception, 这里是关键,正常情况直接返回了.
这里发生异常, 那么会执行重新创建进程的操作. 

### Step 6. AMS.startProcessLocked
    
紧接着, 看到cleanUpApplicationRecord的log, 反推调用情况有多种, 结合上面输出的libprocessgroup log, 逐一排除, 可以发现程序执行到startProcessLocked()的如下流程:

![finishTopRunningActivityLocked](/images/reboot_case_1/7.png)

app.pid>0 导致需要杀旧的进程组, 以及清理进程相关信息. 

- startProcessLocked过程
  - 根据进程名,从mProcessNames查询是否存在该进程.
  - 会先设置app.setPid(0), 
  - 当进程创建后执行app.setPid(startResult.pid), 设置进程pid;
- cleanUpApplicationRecordLocked()
  - 当restart=true, 不会设置改变pid; 重启过程会设置pid=0; (即存在provider处于launching状态),
  - 当restart=false, 且pid>0, 则app.setPid(0);

在AMS.handleAppDiedLocked的过程, 会调用 AMS.cleanUpApplicationRecord, 清理组件信息, 输出上述log.

### Step 7. AS.removeHistoryRecordsForAppLocked

![finishTopRunningActivityLocked](/images/reboot_case_1/8.png)

在前面Step6执行handleAppDiedLocked过程, 先执行cleanUpApplicationRecord, 然后经过层层调用会进入AS.removeHistoryRecordsForAppLocked过程。这里的最后一行removeActivityFromHistoryLocked(r, "appDied"), 则进入Step8。

### Step 8. AS.removeActivityFromHistoryLocked

![finishTopRunningActivityLocked](/images/reboot_case_1/9.png)

再来看看removeTask，则进入Step9。

### Step 9. AS.removeTask

![finishTopRunningActivityLocked](/images/reboot_case_1/10.png)

这便是整个问题最为核心的地方, 直接把每日瑜伽的task, 从ActivityStack的mTaskHistory里面移除.

### Step 10. AS.finishTopRunningActivityLocked

执行完removeTask()方法，层层回溯，再回到Step2的finishTopRunningActivityLocked()执行完成。
也就是对应如下代码的第2886行，核心是把task从mTaskHistory中移除。

![finishTopRunningActivityLocked](/images/reboot_case_1/11.png)

执行完2886行，程序继续往下走。由于com.dailyyoga.cn应用的TASK中有3个activity，则不进入第2891行，直接进入2901行。
由于task从mTaskHistory中移除，此时便出现的数组越界问题。


### 总结
整个过程出现多次Exception引发的重启问题，这个调用链如下：

    finishTopRunningActivityLocked
      finishActivityLocked
        startPausingLocked
          resumeTopActivityInnerLocked
            startSpecificActivityLocked
              startProcessLocked
                handleAppDiedLocked
                  cleanUpApplicationRecord
                    removeHistoryRecordsForAppLocked
                      removeActivityFromHistoryLocked
                        removeTask

解读：

1. App发生一次ANR, 用户点击确定关闭该App;
2. AS.finishActivityLocked()过程, 执行activity pause操作, 调用schedulePauseActivity过程`发生Exception`, 导致触发AS.resumeTopActivityInnerLocked()
3. AS.resumeTopActivityInnerLocked()过程, 执行resume FrameworkActivity, 调用scheduleResumeActivity()过程`发生Exception`, 导致触发ASS.startSpecificActivityLocked();
4. ASS.startSpecificActivityLocked()过程, 执行realStartActivityLocked(), 调用scheduleLaunchActivity过程`发生Exception`, 导致触发AMS.startProcessLocked();
5. AMS.startProcessLocked()过程, 由于app.pid>0, 导致需要先杀掉旧的进程组, 以及执行handleAppDiedLocked()流程;
没有执行cleanUpApplicationRecordLocked过程, 往往是死亡回调没有回来.
6. AMS.handleAppDiedLocked过程, 执行AS.removeTask()流程,  从而导致task从ActivityStack的mTaskHistory里面移除.
7. 最后回到AS.finishTopRunningActivityLocked过程, 便会出现mTaskHistory的数组越界问题.

## 三. 解决方案

AS.finishTopRunningActivityLocked()方法的主要功能是结束当前在栈顶正处于运行状态的Activity。
过程会有finishActivityLocked方法，本案例在期间发生多次Exception，需要resume当前发生ANR activity的下一个activity，并该该activity所在的task从mTaskHistory中移除。

结论：当task发生remove时，会减少mTaskHistory中的成员个数，从导致mTaskHistory.get(taskNdx)出现数组越界。
 
问题关键点：需要resume的activity可能是跟当前activity所归属的应用

- 当发生ANR的应用如果只有单一activity，那么resume的一定是其他应用的activity；在发生异常的时候，便会移除其他应用的task。而发生ANR的应用的task并没有被移除，只是序号变小，则需重新计算该task所在mTaskHistory的位置序号。
- 当发生ANR的应用至少有两个activity，那么resume的一定是还是当前app的下一个activity；在发生异常的时候，便会移除当前应用的task。此时要么task所在mTaskHistory的位置序号变小，要么当前task直接被移除了，这取决于该应用示范有多个task。这时还需要再执行finishActivityLocked()，否则有可能出现不断重启发生crash的应用。

不管以上那种情况，只要出现了task被remove的情况，都需要更新计算task所在mTaskHistory的位置序号，才能确保不会出现数组越界。至于是否还需要执行finishActivityLocked，这就取决于被移除的

- 当activityNdx=1 (只有一个activity), 且是单task情况下, 那么resume下一个activity的是其他app,  发生异常移除的便是其他app的task;
  - 此时mTaskHistory.indexOf(r.task)返回值会减一 (多个task,减N), 而非-1;
  - 策略: ANR activity的下一个activity和task已被移除, 没有必要再执行第二次finish动作. 因为当前crash app的next task已被remove, 不会出现restart crash app.
- 当activityNdx>=2, 也就是该app的task至少有两个activity; 或者ANR activity存在多个task; 那么resume activity失败后, 移除的便是当前发生ANR的activity所在的task;
  - 此时mTaskHistory.indexOf(r.task)返回的便是-1, 
  - 应重新获取 --taskNdx 和 activityNdx; 来执行第2次finish动作, 防止可能出现的restart crash app情况;
