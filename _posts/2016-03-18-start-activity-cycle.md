---
layout: post
title:  "简述Activity生命周期"
date:   2016-3-18 21:09:12
catalog:  true
tags:
    - android
    - 组件

---

> 基于Android 6.0的源码剖析， 分析android Activity启动流程中ActivityManagerService所扮演的角色

## 一、概述

上一篇文章[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)，介绍了startActivity是如何一步步创建的，再来看看生命周期的控制。先来一张官方的Activity状态转换图：

![activity_lifecycle](/images/activity/activity_lifecycle.jpg)

Activity的生命周期中只有在以下3种状态之一，才能较长时间内保持状态不变。

- **Resumed（运行状态）**：Activity处于前台，且用户可以与其交互。
- **Paused（暂停状态）**: Activity被在前台中处于半透明状态或者未覆盖全屏的其他Activity部分遮挡。 暂停的Activity不会接收用户输入，也无法执行任何代码。
- **Stopped（停止状态）**：Activity被完全隐藏，且对用户不可见；被视为后台Activity。 停止的Activity实例及其诸如成员变量等所有状态信息将保留，但它无法执行任何代码。

除此之外，其他状态都是过渡状态(或称为暂时状态)，比如onCreate()，onStart()后很快就会调用onResume()方法。

## 二. 生命周期

### 2.1 进程间通信
对于App来说，其Activity的生命周期执行是与系统进程中的`ActivityManagerService`有一定关系的，接下来从进程和线程的角度来分析Activity的生命周期，这里涉及到系统进程和应用进程：

**system_server进程是系统进程**，Java framework框架的核心载体，里面运行了大量的系统服务，比如这里提供ApplicationThreadProxy（简称ATP），ActivityManagerService（简称AMS），这个两个服务都运行在system_server进程的不同线程中，由于ATP和AMS都是基于IBinder接口，都是binder线程，binder线程的创建与销毁都是由binder驱动来决定的。

**App进程是应用程序所在进程**，主线程主要负责Activity/Service等组件的生命周期以及UI相关操作都运行在这个线程； 另外，每个App进程中至少会有两个binder线程 ApplicationThread(简称AT)和ActivityManagerProxy（简称AMP），除了下图中所示的线程，其实还有很多线程，比如signal catcher线程等。

![app_process](/images/activity/app_process.jpg)

`Binder`用于不同进程之间通信，由一个进程的Binder客户端向另一个进程的服务端发送事件，比如图中线程2向线程4发送事务；而`handler`用于同一个进程中不同线程的通信，比如图中线程4向主线程发送消息。

结合图说说Activity生命周期，比如暂停Activity的流程如下：

- `线程1`的AMS中调用`线程2`的ATP来发送事件；（由于同一个进程的线程间资源共享，可以相互直接调用，但需要注意多线程并发问题）
- `线程2`通过binder将暂停Activity的事件传输到App进程的`线程4`；
- `线程4`通过handler消息机制，将暂停Activity的消息发送给`主线程`；
- `主线程`在looper.loop()中循环遍历消息，当收到暂停Activity的消息(`PAUSE_ACTIVITY`)时，便将消息分发给ActivityThread.H.handleMessage()方法，再经过方法的层层调用，最后便会调用到Activity.onPause()方法。

这便是由AMS完成了onPause()控制，那么同理Activity的其他生命周期也是这么个流程来进行控制的。

### 2.2 App主线程

每个App都有一个主线程，大家常说主线程是ActivityThread，其实这个说法是欠妥当的，首先何为线程？一般来说Java层创建线程往往是继承Thread对象或者实现Runnable，再看看ActivityThread，会发现该对象并没有继承任何对象。准确说法ActivityThread是运行在主线程的对象，充当着主线程的职责。

那主线程到底是哪个呢，这个问题涉及到Linux进程与线程的理解，本质上来说大家常说的主线程就是app首次启动时创建的进程，对于Linux来说进程与线程都是一个task_struct结构体，除了是否有独立资源，并没有什么区别。

那有为何说充当着主线程的职责呢？这是由于进程在创建之初会为主线程创建Looper对象，这个便是用来维护Activity的生命周期。关于更多详细，可查看我之前在知乎
的一个回答[Android中为什么主线程不会因为Looper.loop()里的死循环卡死？](https://www.zhihu.com/question/34652589/answer/90344494?from=profile_answer_card)


### 2.3 枢纽中心

Activity的生命周期，都是其他线程通过handler发送消息给主线程，那么主线程中的`ActivityThread`的内部类`H`控制整个核心消息处理机制，通过`H.handleMessage()`来控制Activity的生命周期，在H类中共定义了50种消息。

    private class H extends Handler {
      public static final int LAUNCH_ACTIVITY         = 100;
      public static final int PAUSE_ACTIVITY          = 101;
      public static final int PAUSE_ACTIVITY_FINISHING= 102;
      public static final int STOP_ACTIVITY_SHOW      = 103;
      public static final int STOP_ACTIVITY_HIDE      = 104;
      public static final int SHOW_WINDOW             = 105;
      public static final int HIDE_WINDOW             = 106;
      public static final int RESUME_ACTIVITY         = 107;
      public static final int SEND_RESULT             = 108;
      public static final int DESTROY_ACTIVITY        = 109;
      public static final int BIND_APPLICATION        = 110;
      public static final int EXIT_APPLICATION        = 111;
      public static final int NEW_INTENT              = 112;
      public static final int RECEIVER                = 113;
      public static final int CREATE_SERVICE          = 114;
      public static final int SERVICE_ARGS            = 115;
      public static final int STOP_SERVICE            = 116;

      public static final int CONFIGURATION_CHANGED   = 118;
      public static final int CLEAN_UP_CONTEXT        = 119;
      public static final int GC_WHEN_IDLE            = 120;
      public static final int BIND_SERVICE            = 121;
      public static final int UNBIND_SERVICE          = 122;
      public static final int DUMP_SERVICE            = 123;
      public static final int LOW_MEMORY              = 124;
      public static final int ACTIVITY_CONFIGURATION_CHANGED = 125;
      public static final int RELAUNCH_ACTIVITY       = 126;
      public static final int PROFILER_CONTROL        = 127;
      public static final int CREATE_BACKUP_AGENT     = 128;
      public static final int DESTROY_BACKUP_AGENT    = 129;
      public static final int SUICIDE                 = 130;
      public static final int REMOVE_PROVIDER         = 131;
      public static final int ENABLE_JIT              = 132;
      public static final int DISPATCH_PACKAGE_BROADCAST = 133;
      public static final int SCHEDULE_CRASH          = 134;
      public static final int DUMP_HEAP               = 135;
      public static final int DUMP_ACTIVITY           = 136;
      public static final int SLEEPING                = 137;
      public static final int SET_CORE_SETTINGS       = 138;
      public static final int UPDATE_PACKAGE_COMPATIBILITY_INFO = 139;
      public static final int TRIM_MEMORY             = 140;
      public static final int DUMP_PROVIDER           = 141;
      public static final int UNSTABLE_PROVIDER_DIED  = 142;
      public static final int REQUEST_ASSIST_CONTEXT_EXTRAS = 143;
      public static final int TRANSLUCENT_CONVERSION_COMPLETE = 144;
      public static final int INSTALL_PROVIDER        = 145;
      public static final int ON_NEW_ACTIVITY_OPTIONS = 146;
      public static final int CANCEL_VISIBLE_BEHIND = 147;
      public static final int BACKGROUND_VISIBLE_BEHIND_CHANGED = 148;
      public static final int ENTER_ANIMATION_COMPLETE = 149;
    }
    
主线程每到收到其他线程发送过来的不同的Handler消息，则都会触发相应的H.handleMessage，下面列举跟Activity相关的一些常见消息。

- LAUNCH_ACTIVITY 
- RELAUNCH_ACTIVITY
- RESUME_ACTIVITY
- NEW_INTENT
- PAUSE_ACTIVITY / PAUSE_ACTIVITY_FINISHING
- STOP_ACTIVITY_SHOW / STOP_ACTIVITY_HIDE
- DESTROY_ACTIVITY

一般来说收到消息，都会调用相应handlerxxx方法。比如,`LAUNCH_ACTIVITY`则对应`handleLaunchActivity`, `RESUME_ACTIVITY`则对应`handleResumeActivity`等。

    public void handleMessage(Message msg) {
      switch (msg.what) {
        case LAUNCH_ACTIVITY: {
            final ActivityClientRecord r = (ActivityClientRecord) msg.obj;
            r.packageInfo = getPackageInfoNoCheck(
                    r.activityInfo.applicationInfo, r.compatInfo);
            handleLaunchActivity(r, null);
        } break;
        case RELAUNCH_ACTIVITY: {
            ActivityClientRecord r = (ActivityClientRecord)msg.obj;
            handleRelaunchActivity(r);
        } break;
        case PAUSE_ACTIVITY:
            handlePauseActivity((IBinder)msg.obj, false, (msg.arg1&1) != 0, msg.arg2,
                    (msg.arg1&2) != 0);
            maybeSnapshot();
            break;
        case STOP_ACTIVITY_SHOW:
            handleStopActivity((IBinder)msg.obj, true, msg.arg2);
            break;
        case STOP_ACTIVITY_HIDE:
            handleStopActivity((IBinder)msg.obj, false, msg.arg2);
            break;
        case RESUME_ACTIVITY:
            handleResumeActivity((IBinder) msg.obj, true, msg.arg1 != 0, true);
            break;
        case DESTROY_ACTIVITY:
                handleDestroyActivity((IBinder)msg.obj, msg.arg1 != 0,
                        msg.arg2, false);
                break;
         ...
      }
    }

先简单列举先调用链可能涉及的方法(**注：并非每次都能同时进入如下调用链的每个分支，先大致列举，后续再展开**)

## 三. 调用链

### 3.1 启动应用

消息： `LAUNCH_ACTIVITY`

**调用链**

    ActivityThread.handleLaunchActivity
        ActivityThread.handleConfigurationChanged
            ActivityThread.performConfigurationChanged
                ComponentCallbacks2.onConfigurationChanged

        ActivityThread.performLaunchActivity
            LoadedApk.makeApplication
                Instrumentation.callApplicationOnCreate
                    Application.onCreate

            Instrumentation.callActivityOnCreate
                Activity.performCreate
                    Activity.onCreate

            Instrumentation.callActivityonRestoreInstanceState
                Activity.performRestoreInstanceState
                    Activity.onRestoreInstanceState

        ActivityThread.handleResumeActivity
            ActivityThread.performResumeActivity
                Activity.performResume
                    Activity.performRestart
                        Instrumentation.callActivityOnRestart
                            Activity.onRestart

                        Activity.performStart
                            Instrumentation.callActivityOnStart
                                Activity.onStart

                    Instrumentation.callActivityOnResume
                        Activity.onResume

采用缩进方式，来代表方法的调用链，相同缩进层的方法代表来自位于同一个调用方法里。callActivityOnCreate和callActivityonRestoreInstanceState相同层级，代表都是由上一层级的ActivityThread.performLaunchActivity()方法中调用。

**App角度**

调用链过程层层调用，但对上层应用是透明的，App开发者只需要覆写其中重要的回调函数即可，故此处所说的App角度，便是指App开发者来说可见之处。经过上述的调用链，依次会执行下面回调方法。

1. ComponentCallbacks2.onConfigurationChanged()：
2. Application.onCreate()
3. Activity.onCreate()
4. Activity.onRestoreInstanceState()
5. Activity.onRestart()
6. Activity.onStart()
7. Activity.onResume()

Application和Activity都实现了ComponentCallbacks2接口；所以Application和Activity会先执行onConfigurationChanged()回调方法。在前面说过onCreate()是过渡状态，紧跟着会执行handleResumeActivity()方法，然后就进入Resumed状态。

### 3.2 恢复应用

消息： `RESUME_ACTIVITY`

**调用链**

    ActivityThread.handleResumeActivity
        ActivityThread.performResumeActivity
            Activity.performResume
                Activity.performRestart
                    Instrumentation.callActivityOnRestart
                        Activity.onRestart

                    Activity.performStart
                        Instrumentation.callActivityOnStart
                            Activity.onStart

                Instrumentation.callActivityOnResume
                    Activity.onResume

**App角度**

1. Activity.onRestart()
2. Activity.onStart()
3. Activity.onResume()

App处于运行状态，UI可见。

### 3.3 暂停应用

msg: `PAUSE_ACTIVITY`

**调用链**

    ActivityThread.handlePauseActivity
        ActivityThread.performPauseActivity
            ActivityThread.callCallActivityOnSaveInstanceState
                Instrumentation.callActivityOnSaveInstanceState
                    Activity.performSaveInstanceState
                        Activity.onSaveInstanceState

            Instrumentation.callActivityOnPause
                Activity.performPause
                    Activity.onPause

**App角度**

1. Activity.onSaveInstanceState()
2. Activity.onPause()

根据saveState是否true决定是否执行callCallActivityOnSaveInstanceState()分支，从而决定是否回调onRestoreInstanceState()方法

### 3.4 停止应用

msg: `STOP_ACTIVITY_HIDE`

**调用链**

    ActivityThread.handleStopActivity
        ActivityThread.performStopActivityInner
            ActivityThread.callCallActivityOnSaveInstanceState
                Instrumentation.callActivityOnSaveInstanceState
                    Activity.performSaveInstanceState
                        Activity.onSaveInstanceState

            ActivityThread.performStop
                Activity.performStop
                    Instrumentation.callActivityOnStop
                        Activity.onStop

        updateVisibility

        H.post(StopInfo)
            AMP.activityStopped
                AMS.activityStopped
                    ActivityStack.activityStoppedLocked
                    AMS.trimApplications
                        ProcessRecord.kill
                        ApplicationThread.scheduleExit
                            Looper.myLooper().quit()

                        AMS.cleanUpApplicationRecordLocked
                        AMS.updateOomAdjLocked

**App角度**

1. Activity.onSaveInstanceState
2. Activity.onStop

在停止Activity的过程，会有一个trimApplications()的操作，主要是kill空进程，将当前进程退出loop循环，清理应用的上下文环境，并且更新进程的Adj值。

### 3.5 销毁应用

msg: `DESTROY_ACTIVITY`

**调用链**

    ActivityThread.handleDestroyActivity
        ActivityThread.performDestroyActivity
            Instrumentation.callActivityOnPause
            Activity.performStop()
            Instrumentation.callActivityOnDestroy
                Activity.performDestroy
                    Window.destroy
                    Activity.onDestroy

        AMP.activityDestroyed
            AMS.activityDestroyed
                ActivityStack.activityDestroyedLocked
                    ActivityStackSupervisor.resumeTopActivitiesLocked
                        ActivityStack.resumeTopActivityLocked
                            ActivityStack.resumeTopActivityInnerLocked

**App角度**

- Activity.onDestroy

销毁应用后，会查看第一个没有结束的Activity，用于显示在最顶层界面，当不存在未结束的Activity时，则显示Launcher界面，即主界面。

### 3.6 创建Intent

msg: `NEW_INTENT` （打开已经处于栈顶的Activity，则会发送给NEW_INTENT消息给主线程）

**调用链**

    ActivityThread.handleNewIntent
        performNewIntents
            Instrumentation.callActivityOnPause
                Activity.performPause
                    Activity.onPause

            deliverNewIntents
                Instrumentation.callActivityOnNewIntent
                    Activity.onNewIntent

            Activity.performResume
                Activity.performRestart
                    Instrumentation.callActivityOnRestart
                        Activity.onRestart

                    Activity.performStart
                        Instrumentation.callActivityOnStart
                            Activity.onStart

                Instrumentation.callActivityOnResume
                    Activity.onResume

**App角度**

1. Activity.onPause
2. Activity.onNewIntent
3. Activity.onRestart
4. Activity.onStart
5. Activity.onResume


本文主要是概括性讲述Activity的调用过程，后续会再从源码角度进一步细说Activity生命周期，敬请期待。
