---
layout: post
title:  "理解ActivityManager与WindowManager"
date:   2017-03-12 23:19:12
catalog:  true
tags:
    - android

---

## 一. 概述

WMS是Android系统中比较复杂，也是非常重要的服务之一，它涉及跟App，AMS,SurfaceFlinger等
模块间相互协同工作。简单来说：

- App主要是具体的UI业务需求
- AMS则是管理系统四大组件以及进程管理，尤其是Activity的各种栈以及状态切换等管理；
- WMS则是管理Activiy所相应的窗口系统(系统窗口以及嵌套的子窗口)；
- SurfaceFlinger则是将应用UI绘制到frameBuffer(帧缓冲区),最终由硬件完成渲染到屏幕上；

### 1.1 

Activity启动过程会执行组件的生命周期回调以及UI相关对象的创建。UI工作会通过向AMS服务来
创建WindowState对象完成，这是用于描述窗口各种状态属性的。


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

1. Activity通过其成员变量mWindowManager，再调用WindowManagerGlobal对象，通过IWindowManager接口跟WMS通信；
2. Acitivity启动过程会创建ActivityRecord对象，在该对象初始化时创建Token对象appToken，再该对象传递ActivityThread.

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



## 一. 概述

http://blog.csdn.net/windskier/article/details/7172710
http://blog.csdn.net/luoshengyang/article/details/8462738
http://blog.csdn.net/jinzhuojun/article/details/37737439


###　其他图片

http://img.my.csdn.net/uploads/201111/20/0_1321764347oyXX.gif
http://img.my.csdn.net/uploads/201111/20/0_132176355880gR.gif
