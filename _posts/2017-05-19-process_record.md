---
layout: post
title:  "四大组件之ProcessRecord"
date:   2017-05-19 21:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

Android中，对于进程的概念被弱化，通过抽象后的四大组件。让开发者几乎感受不到进程的存在。
当应用退出时，进程也并非马上退出，而是成为cache/empty进程，下次该应用再启动的时候，可以不用
再创建进程直接初始化组件即可，提高启动速度。

Android系统中用于描述进程的数据结构是ProcessRecord对象，AMS便是管理进程的核心模块。四大组件
（Activity,Service, BroadcastReceiver, ContentProvider）定义在AndroidManifest.xml文件，
每一项都可以用属性android:process指定所运行的进程。同一个app可以运行在通过一个进程，也可以运行在多个进程，
甚至多个app可以共享同一个进程。例如：AndroidManifest.xml中定义Service：

    <service android:name =".GityuanService"  android:process =":remote" >  
        <intent-filter>  
           <action android:name ="com.action.gityuan" />  
        </intent-filter>  
    </service>

GityuanService这个服务运行在remote进程。

## 二. 进程管理

先以一幅图来展示AMS管理进程的相关成员变量以及ProcessRecord对象：

[点击查看大图](http://www.gityuan.com/images/ams/process_record.jpg)

![process_record](/images/ams/process_record.jpg)


### 2.1 ActivityManagerService

这里只介绍AMS的进程相关的成员变量：

1. mProcessNames：数据类型为ProcessMap<ProcessRecord>，以进程名和userId为key来记录ProcessRecord;
  - 添加进程，addProcessNameLocked()
  - 删除进程，removeProcessNameLocked()
2. mPidsSelfLocked: 数据类型为SparseArray<ProcessRecord>，以进程pid为key来记录ProcessRecord;
  - startProcessLocked()，移除已存在进程，增加新创建进程pid信息；
  - removeProcessLocked，processStartTimedOutLocked，cleanUpApplicationRecordLocked移除进程；
3. mLruProcesses：数据类型为ArrayList<ProcessRecord>，以进程最近使用情况来排序记录ProcessRecord;
  - 其中第一个元素代表的便是最近最少使用的进程；
  - updateLruProcessLocked()更新进程队列位置；
4. mRemovedProcesses：数据类型为ArrayList<ProcessRecord>，记录所有需要强制移除的进程；
5. mProcessesToGc：数据类型为ArrayList<ProcessRecord>，记录当系统进入idle状态需要尽快执行gc操作的进程；
6. mPendingPssProcesses：数据类型为ArrayList<ProcessRecord>，记录即将要收集内存使用情况PSS数据的进程；
7. mProcessesOnHold：数据类型为ArrayList<ProcessRecord>，记录刚开机过程，系统还没与偶准备就绪的情况下，
所有需要启动的进程都放入到该队列；
8. mPersistentStartingProcesses：数据类型ArrayList<ProcessRecord>，正在启动的persistent进程；
9. mHomeProcess: 记录包含home Activity所在的进程；
10. mPreviousProcess：记录用户上一次刚访问的进程；其中mPreviousProcessVisibleTime记录上一个进程的用户访问时间；
11. mProcessList: 数据类型ProcessList，用于进程管理，Adj常量定义位于该文件；

其中最为常见的是mProcessNames，mPidsSelfLocked，mLruProcesses这3个对象；

### 2.2 ProcessRecord

部分重要成员变量说明：

1. info：记录运行在该进程的第一个应用；
2. pkgList: 记录运行在该进程中所有的包名，比如通过addPackage()添加；
3. pkgDeps：记录该进程所依赖的包名，比如通过addPackageDependency()添加；
4. thread：执行完attachApplicationLocked()方法，会把客户端进程ApplicationThread的binder服务的代理端传递到
AMS，并保持到ProcessRecord的成员变量thread；
  - ProcessRecord.makeActive，赋值；
  - ProcessRecord.makeInactive，清空；
5. lastActivityTime：每次updateLruProcessLocked()过程会更新该值；
6. killedByAm：当值为true，意味着该进程是被AMS所杀，而非由于内存低而被LMK所杀；
7. killed：当值为true，意味着该进程被杀，不论是AMS还是其他方式；
8. waitingToKill：比如cleanUpRemovedTaskLocked()过程会赋值为"remove task"，当该进程处于后台且


四大组件都运行在某个进程，再来说说组件相关的成员变量：

1. Activity:
  - activities：记录所有运行在该进程的ActivityRecord;
2. Service
  - services: 记录所有运行在该进程的ServiceRecord;
  - executingServices: 记录所有当前正在执行的ServiceRecord;
  - connections: 记录当前进程bind的所有ConnectionRecord，即bind service的client进程；
3. Receiver:
  - receivers: 所有动态注册的广播接收者ReceiverList;
  - curReceiver: 该进程当前正在处理的广播；
4. ContentProvider:
  - pubProviders:记录该进程发布的provider;
  - conProviders:记录该进程所请求的provider;
