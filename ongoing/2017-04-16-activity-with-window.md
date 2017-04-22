---
layout: post
title:  "简述Activity与Window关系"
date:   2017-04-16 23:19:12
catalog:  true
tags:
    - android

---

## 一. 概述

AMS是Android系统最为核心的服务之一，其职责包括四大核心组件与进程的管理，而四大组件中Activity最为复杂。
其复杂在于需要跟用户进行UI交互(涉及Window)，WMS其主要职责便是窗口管理，还有跟App,SurfaceFlinger等
模块间相互协同工作。简而言之：

- App主要是具体的UI业务需求
- AMS则是管理系统四大组件以及进程管理，尤其是Activity的各种栈以及状态切换等管理；
- WMS则是管理Activiy所相应的窗口系统(系统窗口以及嵌套的子窗口)；
- SurfaceFlinger则是将应用UI绘制到frameBuffer(帧缓冲区),最终由硬件完成渲染到屏幕上；

### 1.1 

Activity启动过程会执行组件的生命周期回调以及UI相关对象的创建。UI工作会通过向AMS服务来
创建WindowState对象完成，这是用于描述窗口各种状态属性的。

- 每一个Activity对应一个应用窗口,；
- 每一个窗口对应一个ViewRootImpl；


## 二. UI主线程

[startActivity](http://gityuan.com/2016/03/12/start-activity/)的过程, 经过层层调用后,
向app进程的主线程发送H.LAUNCH_ACTIVITY消息, 当主线程接收到该消息后,便执行handleLaunchActivity()方法,
接下来,从该方法说起.

### 2.1 AT.handleLaunchActivity
[-> ActivityThread.java]













## 二. 架构概述
 
### 2.1 Window架构图

![wms_binder](/images/wms/wms_binder.jpg)

说明：

- system_server进程的Binder服务：
  - WindowManagerService extends IWindowManager.Stub
  - Session extends IWindowSession.Stub
  - ActivityRecord.Token extends IApplicationToken.Stub
- app进程的Binder服务：
  - ViewRootImpl.W extends IWindow.Stub (WindowState使用)

Binder Call流程：

1. IWindowManager.Stub: Activity通过其成员变量mWindowManager(数据类型WindowManagerImpl)，再调用WindowManagerGlobal对象，经过binder call跟WMS通信；
2. IApplicationToken.Stub:  startAcitivity过程，通过binder call进入system_server进程，在该进程执行ASS.startActivityLocked()方法中会创建相应的ActivityRecord对象，该对象初始化时会创建数据类型为ActivityRecord.Token的成员变量appToken，再该对象传递ActivityThread.

2. ViewRootImpl会与WMS中的Session进行连接。
3. Activity启动过程会创建ActivityRecord对象，在这个过程便会初始化该对象的成员变量appToken为Token，作为binder服务。


3. 比如App跟AMS通信，会建立Session连接到WMS，后续便通过IWindowSesson跟WMS通信；
4. WMS跟SF通信，现在WMS建立SurfaceComposerClient，然后会在SF中创建Client与之对应，
后续便通过ISurfaceComposerClient跟SF通信；
  
### 2.2 模块功能概述

### 2.3 Activity对象
下面列举Activity对象的部分常见成员变量：

1. mWindow：数据类型为PhoneWindow，继承于Window对象；
2. mWindowManager：数据类型为WindowManagerImpl，实现WindowManager接口;
3. mMainThread：数据类型为ActivityThread, 并非真正的线程，只是运行在主线程的对象。
4. mUiThread: 数据类型为Thread，当前activity所在线程，即主线程;
5. mHandler：数据类型为Handler, 当前主线程的handler;
6. mDecor: 数据类型为View, Activity执行完resume之后创建的视图对象；

另外说明：WindowManagerImpl与Window这两个对象相互保存对方的信息：

- WindowManagerImpl.mParentWindowWindow指向Window对象；
- Window.mWindowManager指向WindowManagerImpl对象；


### 2.4 数量关系

1. App可以没有Activity/PhoneWindwow/DecorView，例如带悬浮窗口的Service；
2. Activity运行在ActivityThread所在线程，即主线程；
3. DecorView是Activity所要显示的视图内容；
4. ViewRootImpl：管理DecorView跟WMS的交互；每次调用addView添加窗口时，则都会创建一个ViewRootImpl对象；

### 1.2 C/S cx

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


###  IWindow死亡回调

WindowState.java

    private class DeathRecipient implements IBinder.DeathRecipient {
        @Override
        public void binderDied() {
            try {
                synchronized(mService.mWindowMap) {
                    WindowState win = mService.windowForClientLocked(mSession, mClient, false);
                    Slog.i(TAG, "WIN DEATH: " + win);
                    if (win != null) {
                        mService.removeWindowLocked(win);
                    } else if (mHasSurface) {
                        Slog.e(TAG, "!!! LEAK !!! Window removed but surface still valid.");
                        mService.removeWindowLocked(WindowState.this);
                    }
                }
            } catch (IllegalArgumentException ex) {
                // This will happen if the window has already been
                // removed.
            }
        }
    }

## 一. 概述

http://blog.csdn.net/windskier/article/details/7172710
http://blog.csdn.net/luoshengyang/article/details/8462738
http://blog.csdn.net/jinzhuojun/article/details/37737439


###　其他图片

http://img.my.csdn.net/uploads/201111/20/0_1321764347oyXX.gif
http://img.my.csdn.net/uploads/201111/20/0_132176355880gR.gif
