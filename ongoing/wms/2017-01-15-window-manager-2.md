---
layout: post
title:  "WindowManagerService原理"
date:   2017-01-15 20:32:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析WMS的原理。

## 一. 概述

WMS是Android系统中比较复杂，也是非常重要的服务之一，它涉及跟App，AMS,SurfaceFlinger等
模块间相互协同工作。简单来说：

- App主要是具体的UI业务需求
- AMS则是管理系统四大组件以及进程管理，尤其是Activity的各种栈以及状态切换等管理；
- WMS则是管理Activiy所相应的窗口系统(系统窗口以及嵌套的子窗口)；
- SurfaceFlinger则是将应用UI绘制到frameBuffer(帧缓冲区),最终由硬件完成渲染到屏幕上；


## 二. 架构概述
 
### 2.1 Window架构图

![wms_binder](/images/wms/wms_binder.jpg)

说明：

- system_server进程的Binder服务：
  - WindowManagerService extends IWindowManager.Stub
  - Session extends IWindowSession.Stub
  - ActivityRecord.Token extends IApplicationToken.Stub
- app进程的Binder服务：
  - ViewRootImpl.W extends IWindow.Stub

Binder Call流程：

1. Activity通过其成员变量mWindowManager，再调用WindowManagerGlobal对象，通过IWindowManager接口跟WMS通信；
2. ViewRootImpl会与WMS中的Session进行连接。
3. Activity启动过程会创建ActivityRecord对象，在这个过程便会初始化该对象的成员变量appToken为Token，作为binder服务。


3. 比如App跟AMS通信，会建立Session连接到WMS，后续便通过IWindowSesson跟WMS通信；
4. WMS跟SF通信，现在WMS建立SurfaceComposerClient，然后会在SF中创建Client与之对应，
后续便通过ISurfaceComposerClient跟SF通信；
  
### 2.2 模块功能概述



### 2.3 Activity对象

- mWindow：数据类型为PhoneWindow，继承于Window对象；
- mWindowManager：数据类型为WindowManagerImpl，实现WindowManager接口;
- mMainThread：当前线程的ActivityThread对象;
- mHandler：当前主线程的handler;
- mUiThread: 当前activity所在的主线程;
- mDecor: Activity执行完resume之后创建的View对象；

WindowManagerImpl.mParentWindowWindow指向Window对象，
Window.mWindowManager指向WindowManagerImpl对象，这两个对象相互保存对方的信息。


### 2.4 数量关系

1. App可以没有Activity，没有PhoneWindwow和DecorView，例如带悬浮窗口的Service；
2. Activity运行在ActivityThread所在线程；
3. DecorView是Activity所要显示的视图内容；
4. ViewRootImpl：管理DecorView跟WMS的交互；每次调用addView添加窗口时，则都会创建一个ViewRootImpl对象；
5. 
### 1.2 C/S

WindowManagerGlobal.sWindowManagerService -> WMS
ViewRootImpl.mWindowSession
WindowManagerGlobal.sWindowSession -> Session


## AMS与WMS关系

Activity以及task栈的对应关系：

|AMS|WMS|
|---|---|
|ActivityRecord|AppWindowToken|
|ActivityStack|TaskStack|
|TaskRecord|Task|


## 三. Window窗口流程

文章[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)，
从AMS的角度讲述了Activity启动过程，那么本文从WMS的角度说一说这个过程。接下来，从文章[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)的小节[2.10] AS.startActivityLocked()开始说起。

### 3.1 AS.startActivityLocked
[-> ActivityStack.java]

    final void startActivityLocked(ActivityRecord r, boolean newTask,
            boolean doResume, boolean keepCurTransition, Bundle options) {
        TaskRecord rTask = r.task;
        final int taskId = rTask.taskId;
        if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
            insertTaskAtTop(rTask, r);
            //将Window相应task移至顶部[见小节3.1.1]
            mWindowManager.moveTaskToTop(taskId); 
        }
        TaskRecord task = null;
        if (!newTask) {
            boolean startIt = true;
            for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
                task = mTaskHistory.get(taskNdx);
                if (task == r.task) {
                    if (!startIt) {
                        task.addActivityToTop(r);
                        r.putInHistory();
                        //创建AppWindowToken对象 [见小节3.1.2]
                        mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                                r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                                (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0,
                                r.userId, r.info.configChanges, task.voiceSession != null,
                                r.mLaunchTaskBehind);
                        return;
                    }
                    break;
                } 
                ...
            }
        }
        ...
        
        task = r.task;
        task.addActivityToTop(r);
        task.setFrontOfTask();

        r.putInHistory();
        mActivityTrigger.activityStartTrigger(r.intent, r.info, r.appInfo);
        if (!isHomeStack() || numActivities() > 0) {
            //当切换到新的task，或者下一个activity进程目前并没有运行
            boolean showStartingIcon = newTask;
            ProcessRecord proc = r.app;
            if (proc == null) {
                proc = mService.mProcessNames.get(r.processName, r.info.applicationInfo.uid);
            }

            if (proc == null || proc.thread == null) {
                showStartingIcon = true;
            }
            if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_NO_ANIMATION) != 0) {
                mWindowManager.prepareAppTransition(AppTransition.TRANSIT_NONE, keepCurTransition);
                mNoAnimActivities.add(r);
            } else {
                //设置transition方式[见小节3.1.3]
                mWindowManager.prepareAppTransition(newTask
                        ? r.mLaunchTaskBehind
                                ? AppTransition.TRANSIT_TASK_OPEN_BEHIND
                                : AppTransition.TRANSIT_TASK_OPEN
                        : AppTransition.TRANSIT_ACTIVITY_OPEN, keepCurTransition);
                mNoAnimActivities.remove(r);
            }
            mWindowManager.addAppToken(...);
            
            boolean doShow = true;
            if (newTask) {
                if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                    resetTaskIfNeededLocked(r, r);
                    doShow = topRunningNonDelayedActivityLocked(null) == r;
                }
            } else if (options != null && new ActivityOptions(options).getAnimationType()
                    == ActivityOptions.ANIM_SCENE_TRANSITION) {
                doShow = false;
            }
            if (r.mLaunchTaskBehind) {
                mWindowManager.setAppVisibility(r.appToken, true);
                ensureActivitiesVisibleLocked(null, 0);
            } else if (SHOW_APP_STARTING_PREVIEW && doShow) {
                ActivityRecord prev = mResumedActivity;
                mWindowManager.setAppStartingWindow(
                        r.appToken, r.packageName, r.theme,
                        mService.compatibilityInfoForPackageLocked(
                                 r.info.applicationInfo), r.nonLocalizedLabel,
                        r.labelRes, r.icon, r.logo, r.windowFlags,
                        prev != null ? prev.appToken : null, showStartingIcon);
                r.mStartingWindowShown = true;
            }
        } else {
            mWindowManager.addAppToken(...);
            ...
        }

        if (doResume) {
            // [见流程2.11]
            mStackSupervisor.resumeTopActivitiesLocked(this, r, options);
        }
    }

此处涉及WMS的有以下过程：

- WMS.moveTaskToTop：将Window相应task移至顶部；
- WMS.addAppToken：创建AppWindowToken对象atoken，并添加到mTokenMap;
- WMS.prepareAppTransition：设置transition方式以及5s超时消息；
- WMS.setAppStartingWindow：创建startingData启动数据，并发送消息到”android.display”线程来处理ADD_STARTING消息。

#### 3.1.1  WMS.moveTaskToTop

    public void moveTaskToTop(int taskId) {
        final long origId = Binder.clearCallingIdentity();
        try {
            synchronized(mWindowMap) {
                Task task = mTaskIdToTask.get(taskId);
                if (task == null) {
                    return;
                }
                final TaskStack stack = task.mStack;
                final DisplayContent displayContent = task.getDisplayContent();
                //将该task所属的栈 移至display的顶部
                displayContent.moveStack(stack, true);
                if (displayContent.isDefaultDisplay) {
                    final TaskStack homeStack = displayContent.getHomeStack();
                    if (homeStack != stack) {
                        //当非home栈移至顶部，则把home栈移至底部
                        displayContent.moveStack(homeStack, false);
                    }
                }
                //将该task 移至栈的顶部
                stack.moveTaskToTop(task);
                if (mAppTransition.isTransitionSet()) {
                    task.setSendingToBottom(false);
                }
                //更新窗口布局
                moveStackWindowsLocked(displayContent);
            }
        } finally {
            Binder.restoreCallingIdentity(origId);
        }
    }
    
#### 3.1.2 WMS.addAppToken

    public void addAppToken(int addPos, IApplicationToken token, int taskId, int stackId,
            int requestedOrientation, boolean fullscreen, boolean showForAllUsers, int userId,
            int configChanges, boolean voiceInteraction, boolean launchTaskBehind) {

        long inputDispatchingTimeoutNanos;
        inputDispatchingTimeoutNanos = token.getKeyDispatchingTimeout() * 1000000L;

        synchronized(mWindowMap) {
            AppWindowToken atoken = findAppWindowToken(token.asBinder());
            ...
            //创建AppWindowToken对象
            atoken = new AppWindowToken(this, token, voiceInteraction);
            atoken.inputDispatchingTimeoutNanos = inputDispatchingTimeoutNanos;
            atoken.appFullscreen = fullscreen;
            atoken.showForAllUsers = showForAllUsers;
            atoken.requestedOrientation = requestedOrientation;
            atoken.layoutConfigChanges = (configChanges &
                    (ActivityInfo.CONFIG_SCREEN_SIZE | ActivityInfo.CONFIG_ORIENTATION)) != 0;
            atoken.mLaunchTaskBehind = launchTaskBehind;

            //获取或创建相应的Task
            Task task = mTaskIdToTask.get(taskId);
            if (task == null) {
                task = createTaskLocked(taskId, stackId, userId, atoken);
            }
            task.addAppToken(addPos, atoken);
            //将该Token添加到mTokenMap
            mTokenMap.put(token.asBinder(), atoken);

            atoken.hidden = true;
            atoken.hiddenRequested = true;
        }
    }
    
该方法的主要功能：创建AppWindowToken对象atoken，并添加到mTokenMap。另外，input超时时长为5s.

#### 3.1.3 WMS.prepareAppTransition

    public void prepareAppTransition(int transit, boolean alwaysKeepCurrent) {
        synchronized(mWindowMap) {
            if (!mAppTransition.isTransitionSet() || mAppTransition.isTransitionNone()) {
                mAppTransition.setAppTransition(transit);
            } else if (!alwaysKeepCurrent) {
                if (transit == AppTransition.TRANSIT_TASK_OPEN
                        && mAppTransition.isTransitionEqual(
                                AppTransition.TRANSIT_TASK_CLOSE)) {
                    //正在打开新的task，取代关闭动画
                    mAppTransition.setAppTransition(transit);
                } else if (transit == AppTransition.TRANSIT_ACTIVITY_OPEN
                        && mAppTransition.isTransitionEqual(
                            AppTransition.TRANSIT_ACTIVITY_CLOSE)) {
                    //正在打开新的activity，取代关闭动画
                    mAppTransition.setAppTransition(transit);
                }
            }
            if (okToDisplay() && mAppTransition.prepare()) {
                mSkipAppTransitionAnimation = false;
            }
            if (mAppTransition.isTransitionSet()) {
                mH.removeMessages(H.APP_TRANSITION_TIMEOUT);
                mH.sendEmptyMessageDelayed(H.APP_TRANSITION_TIMEOUT, 5000);
            }
        }
    }

#### 3.1.4 WMS.setAppStartingWindow

    public void setAppStartingWindow(IBinder token, String pkg,
            int theme, CompatibilityInfo compatInfo,
            CharSequence nonLocalizedLabel, int labelRes, int icon, int logo,
            int windowFlags, IBinder transferFrom, boolean createIfNeeded) {
        ...
        wtoken.startingData = new StartingData(pkg, theme, compatInfo, nonLocalizedLabel,
                            labelRes, icon, logo, windowFlags);
        Message m = mH.obtainMessage(H.ADD_STARTING, wtoken);
        mH.sendMessageAtFrontOfQueue(m);
    }

该方法的主要功能是创建startingData启动数据，并发送消息到”android.display”线程来处理ADD_STARTING消息
