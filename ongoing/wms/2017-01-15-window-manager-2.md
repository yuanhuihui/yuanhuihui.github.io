---
layout: post
title:  "WindowManagerService原理"
date:   2017-01-15 20:32:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析WMS的原理。

## 一. Window架构图


### 1.1 关系图

![wms_binder](/images/wms/wms_binder.jpg)

说明：

1. system_server进程的Binder服务：
  - WindowManagerService extends IWindowManager.Stub
  - Session extends IWindowSession.Stub
  - ActivityRecord.Token extends IApplicationToken.Stub
2. app进程的Binder服务：
  - ViewRootImpl.W extends IWindow.Stub

### 1.2 C/S

WindowManagerGlobal.sWindowManagerService -> WMS
ViewRootImpl.mWindowSession
WindowManagerGlobal.sWindowSession -> Session

### 继承关系


- WindowManagerImpl.mParentWindow --> Window
- Window.mWindowManager --> WindowManagerImpl


## AMS与WMS关系

- ActivityRecord <–> AppWindowToken
- ActivityStack <–> TaskStack
- TaskRecord <–> Task


App向WMS添加窗口，会调用WindowManagerImpl.addView()
