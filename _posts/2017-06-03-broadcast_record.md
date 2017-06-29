---
layout: post
title:  "四大组件之BroadcastRecord"
date:   2017-06-03 23:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

广播在Android系统使用频率比较高，广播的使用场景往往是在满足某种条件下发出一个事件(broadcast),
多处(Receiver)可以监听该事件通知并做出相应的改变。比如亮/灭屏，网络状态切换等事件发送时都会发出相应的广播。

    LoadedApk
        ReceiverDispatcher
            InnerReceiver extends IIntentReceiver.Stub
            Args extends BroadcastReceiver.PendingResult implements Runnable

        ServiceDispatcher
            InnerConnection extends IServiceConnection.Stub
            RunConnection implements Runnable

关系:

- InnerReceiver与ReceiverDispatcher在数量上一一对应;
- InnerConnection与ServiceDispatcher在数量上也一一对应;

## 二. Broadcast数据结构

[点击查看大图](http://www.gityuan.com/images/ams/broadcast/broadcast_record.jpg)

![broadcast_record](/images/ams/broadcast/broadcast_record.jpg)

### 2.1 BroadcastRecord

1. callerApp:广播发送者的进程；
2. ordered:是否有序广播；
3. sticky:是否粘性广播；
4. receivers:广播接收器，包括动态注册(BroadcastFilter)和静态注册(ResolveInfo)；
5. receiver：数据类型为IBinder，保存的广播所在进程的ApplicationThread对象的代理端
6. 时间点：
  - enqueueClockTime: 广播入队列时间点；
  - dispatchTime：广播分发时间点；
  - receiverTime：当前receiver开始处理时间点；
  - finishTime：广播处理完成时间点；

### 2.2 BroadcastFilter

只有registerReceiver()过程才会创建BroadcastFilter,也就是该对象用于动态注册的广播Receiver;
BroadcastFilter继承于IntentFilter.

- packageName:发起注册广播接收器所对应的包名;
- owningUid:广播接收器所对应的uid;

### 2.3 ReceiverList

同样地, 只有registerReceiver()过程才会创建ReceiverList;

### 2.4 AMS


[点击查看大图](http://www.gityuan.com/images/ams/broadcast/broadcast_relation1.jpg)

![broadcast_relation1](/images/ams/broadcast/broadcast_relation1.jpg)

- mRegisteredReceivers：类型为HashMap， 其key数据类型为客户端InnerReceiver的Binder Bp端，value为ReceiverList（广播接收者列表）；
  - ReceiverList是一个BroadcastFilter列表；
- mFgBroadcastQueue/mBgBroadcastQueue：分别代表前后台广播队列；
  - 每个队列里面有包含mOrderedBroadcasts/mParallelBroadcasts（串行和并行广播列表）；
  - 其中每个广播BroadcastRecord里面有一个receivers，记录当前广播的所有接收者，包含BroadcastFilter和ResolveInfo；

也就是说AMS记录的前/后台广播队列和已注册的广播接收者(mRegisteredReceivers)都有对应的相同BroadcastFilter；

### 2.5 BroadcastQueue

1. mBroadcastsScheduled为true,代表当前已广播消息BROADCAST_INTENT_MSG, 正在等待处理中.
2. 并行广播队列，只有动态注册的receiver；串行广播队列，可能同时又动态注册和静态注册的receiver;

## 三. 过程简述

广播分为注册过程和发送过程

### 3.1 注册过程

#### 动态广播

App进程通过registerReceiver()向system_server进程注册BroadcastReceiver。这个过程会将App进程的两个binder
服务对象传递给system_server进程：

- ApplicationThread： 继承于ApplicationThreadNative, 作为ActivityThread的成员变量mAppThread；
- InnerReceiver： 继承于IIntentReceiver.Stub，作为LoadedApk.ReceiverDispatcher的成员变量mIIntentReceiver

这里有一个ReceiverDispatcher(广播分发者)， 其个数跟BroadcastReceiver是一一对象的。每个广播接收者对应一个广播分发者，
当AMS向app发送广播时会调用到app进程的广播分发者，然后再将广播以message形式post到app的主线程，来执行onReceive().

#### 静态广播

通过AndroidManifest.xml声明receiver，在系统开机过程通过PKMS来解析所有的静态广播接收者。

PKMS中有一个成员变量mReceivers，其数据类型为ActivityIntentResolver；可通过PKMS的
queryIntentReceivers()方法来查询指定Intent所对应的ResolveInfo列表。

### 3.2 发送过程

[点击查看大图](http://www.gityuan.com/images/ams/broadcast/broadcast_relation1.jpg)
![seq_broadcast](/images/ams/broadcast/seq_broadcast.jpg)

处理过程，根据注册方式不同执行流程略有不同。

- 根据发送的广播Intent是否带有Intent.FLAG_RECEIVER_FOREGROUND, 来决定将广播放入AMS中的前台广播队列(mFgBroadcastQueue)
,还是后台广播队列(mBgBroadcastQueue).
- 发送广播的过程, 也就是将BROADCAST_INTENT_MSG消息发送到ActivityManager线程即可返回.
- 静态注册的receiver，一定是按照order方式处理；
- 动态注册的receiver，则需要根据发送方式order来决定处理方式；即可能并行队列, 也可以在串行队列
- 位于mParallelBroadcasts中的并行广播, 一次性全部发出.
- 位于mOrderedBroadcasts中的串行广播，一次处理一个，等待上一个receive完成才继续处理；

更多源码详细过程，见[Android Broadcast广播机制分析](http://gityuan.com/2016/06/04/broadcast-receiver/)
