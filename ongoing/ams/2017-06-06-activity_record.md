---
layout: post
title:  "四大组件之ActivityRecord"
date:   2017-06-05 23:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

BroadcastRecord，ServiceRecord都继承于Binder对象，而ActivityRecord并没有继承于Binder。
但ActivityRecord的成员变量appToken的数据类型为Token，Token继承于IApplicationToken.Stub。

appToken：system_server进程通过调用scheduleLaunchActivity()将appToken传递到App进程，
  - 调用createActivityContext()，保存到ContextImpl.mActivityToken
  - 调用activity.attach()，保存到Activity.mToken；

ServiceRecord本身继承于Binder对象， 传递到客户端的代理：
  - 调用Service.attach()，保存到Service.mToken；
  - 用途：stopSelf,startForeground, stopForeground
  
## 二. ActivityRecord结构体

### 2.1 ActivityRecord

mActivityType：Activity的类型取值如下：
  - APPLICATION_ACTIVITY_TYPE
  - HOME_ACTIVITY_TYPE
  - RECENTS_ACTIVITY_TYPE

ActivityState：Activity状态取值如下：
  - INITIALIZING
  - RESUMED：已恢复
  - PAUSING
  - PAUSED：已暂停
  - STOPPING
  - STOPPED：已停止
  - FINISHING
  - DESTROYING
  - DESTROYED：已销毁

时间相关的成员变量：

- createTime：
- displayStartTime：
- fullyDrawnStartTime：
- startTime：
- lastVisibleTime：
- cpuTimeAtResume：
- pauseTime：
- launchTickTime：
- lastLaunchTime：
