---
layout: post
title:  "四大组件之ContentProvider机制"
date:   2017-06-02 22:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

## 二. ContentProvider数据结构

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
3. 


### 2.3 AMS

进程相关的变量

1. mProcessNames：数据类型为ProcessMap<ProcessRecord>，以进程名和userId为key来记录ProcessRecord;
  - 添加进程，addProcessNameLocked()
  - 删除进程，removeProcessNameLocked()
2. mPidsSelfLocked: 数据类型为SparseArray<ProcessRecord>，以进程pid为key来记录ProcessRecord;
  - startProcessLocked()，移除已存在进程，增加新创建进程pid信息；
  - removeProcessLocked，processStartTimedOutLocked，cleanUpApplicationRecordLocked移除进程；
3. mLruProcesses：数据类型为ArrayList<ProcessRecord>，以进程最近使用情况来排序记录ProcessRecord;
  - 其中第一个元素代表的便是最近最少使用的进程；
4. mProcessesToGc：数据类型为ArrayList<ProcessRecord>，记录当系统进入idle状态需要尽快执行gc操作的进程；
5. mPendingPssProcesses：数据类型为ArrayList<ProcessRecord>，记录即将要收集内存使用情况PSS数据的进程；
6. mRemovedProcesses：数据类型为ArrayList<ProcessRecord>，记录所有需要强制移除的进程；
7. mProcessesOnHold：数据类型为ArrayList<ProcessRecord>，记录刚开机过程，系统还没与偶准备就绪的情况下，
所有需要启动的进程都放入到该队列；
8. mPersistentStartingProcesses：数据类型ArrayList<ProcessRecord>，正在启动的persistent进程；
9. mHomeProcess: 记录包含home Activity所在的进程；
10. mPreviousProcess：记录用户上一次刚访问的进程；
11. mPreviousProcessVisibleTime: 上一个进程，用户访问的时间；
12. mProcessList: 数据类型ProcessList，用于进程管理，Adj常量定义位于该文件；

### 2.4 ProcessRecord

- pubProviders: ArrayMap<String, ContentProviderRecord>
- conProviders: ArrayList<ContentProviderConnection>
