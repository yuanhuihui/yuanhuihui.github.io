---
layout: post
title:  "四大组件之ContentProvider机制"
date:   2017-06-02 22:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

作为四大组件之一的ContentProvider，相比来说是设计得稍逊色，有些地方不太合理，比如provider级联被杀，
请求provider时占用system_server的binder线程来wait()等。

既然很少自己定义ContentProvider，但你也可以会需要使用到ContentProvider，比如通信录，Settings等；
使用Provider往往跟数据库结合起来使用。

## 二. ContentProvider数据结构


先以一幅图来展示AMS管理ContentProvider所涉及的相关数据结构：
[点击查看大图](http://www.gityuan.com/images/ams/content_provider_record.jpg)

![content_provider_record](/images/ams/content_provider_record.jpg)

### 2.1 ContentProviderRecord

- provider：在ActivityThread的installProvider()过程，会创建ContentProvider对象，
该对象有一个成员变量Transport，继承于ContentProviderNative对象，作为binder服务端。经过binder传递到system_server
进程的便是ContentProvider.Transport的binder代理对象， 由publishContentProviders()过程完成赋值；
- proc：记录provider所在的进程，是在publishContentProviders()过程完成赋值；
- launchingApp：记录等待provider所在进程启动，getContentProviderImpl()过程执行创建进程之后赋值；
- connections：记录该ContentProvider的所有连接信息，
  - 添加连接过程：incProviderCountLocked
  - 减少连接过程：decProviderCountLocked，removeDyingProviderLocked，cleanUpApplicationRecordLocked；

### 2.2 ContentProviderConnection

功能:连接contentProvider与请求该provider所对应的进程

1. provider:目标provider所对应的ContentProviderRecord结构体；
2. client:请求该provider的客户端进程；
3. waiting:该连接的client进程正在等待该provider发布

### 2.3 ProcessRecord

- pubProviders: ArrayMap<String, ContentProviderRecord>
- conProviders: ArrayList<ContentProviderConnection>
