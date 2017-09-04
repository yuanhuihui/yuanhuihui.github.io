---
layout: post
title:  "四大组件之ContentProviderRecord"
date:   2017-06-04 22:19:12
catalog:  true
tags:
    - android
    - 组件系列
    
---

## 一. 引言

作为四大组件之一的ContentProvider，相比来说是设计得稍逊色，有些地方不太合理，比如provider级联被杀，
请求provider时占用system_server的binder线程来wait()等。

即便很少自定义ContentProvider，但你也可以会需要使用到ContentProvider，比如通信录，Settings等；
使用Provider往往跟数据库结合起来使用，所以这里需要注意不要再主线程用provider做过多的io操作。

## 二. ContentProvider数据结构

先以一幅图来展示AMS管理ContentProvider所涉及的相关数据结构：
[点击查看大图](http://www.gityuan.com/images/ams/provider/content_provider_record.jpg)

![content_provider_record](/images/ams/provider/content_provider_record.jpg)

### 2.1 ContentProviderRecord

- provider：在ActivityThread的installProvider()过程，会创建ContentProvider对象，
该对象有一个成员变量Transport，继承于ContentProviderNative对象，作为binder服务端。经过binder传递到system_server
进程的便是ContentProvider.Transport的binder代理对象， 由publishContentProviders()过程完成赋值；
- proc：记录provider所在的进程，是在publishContentProviders()过程完成赋值；
- launchingApp：记录等待provider所在进程启动，getContentProviderImpl()过程执行创建进程之后赋值；
- connections：记录该ContentProvider的所有连接信息，
  - 添加连接过程：incProviderCountLocked
  - 减少连接过程：decProviderCountLocked，removeDyingProviderLocked，cleanUpApplicationRecordLocked；
- externalProcessTokenToHandle: 数据类型为HashMap<IBinder, ExternalProcessHandle>.
    - AMS.getContentProviderExternalUnchecked()过程会添加externalProcessTokenToHandle值;
    - CPR.hasConnectionOrHandle()或hasExternalProcessHandles()都会判断该变量是否为空.

### 2.2 ContentProviderConnection

功能:连接contentProvider与请求该provider所对应的进程

1. provider:目标provider所对应的ContentProviderRecord结构体；
2. client:请求该provider的客户端进程；
3. waiting:该连接的client进程正在等待该provider发布

### 2.3 ProcessRecord

- pubProviders: ArrayMap<String, ContentProviderRecord>
  - 记录当前进程所有已发布的provider;
- conProviders: ArrayList<ContentProviderConnection>
  - 记录当前进程跟其他进程provider所建立的连接

### 2.4 AMS

- mProviderMap记录系统所有的provider信息；
- mLaunchingProviders记录当前正在启动的provider;

### 2.5 ActivityThread

- mProviderMap: 记录App端的所有provider信息；
- mProviderRefCountMap：记录App端的所有provider引用信息；


## 三. Provider使用过程

[点击查看大图](http://www.gityuan.com/images/ams/provider/Seq_provider.jpg)

![Seq_provider](/images/ams/provider/Seq_provider.jpg)

更多源码详细过程，见[理解ContentProvider原理](http://gityuan.com/2016/07/30/content-provider/)
