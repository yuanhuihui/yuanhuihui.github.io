---
layout: post
title:  "四大组件之BroadcastRecord"
date:   2017-06-01 23:19:12
catalog:  true
tags:
    - android

---

## 一. 引言


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

### BroadcastRecord


1.callerApp:广播发送者的进程；
2.ordered:是否有序广播；
3.sticky:是否粘性广播；
4.receivers:广播接收器；
5.时间点：入队列，分发，接收，完成


### BroadcastFilter

只有registerReceiver()过程才会创建BroadcastFilter,也就是该对象用于动态注册的广播Receiver;
BroadcastFilter继承于IntentFilter.

- packageName:发起注册广播接收器所对应的包名;
- owningUid:广播接收器所对应的uid;

### ReceiverList

同样地, 只有registerReceiver()过程才会创建ReceiverList;

### AMS

HashMap<IBinder, ReceiverList> mRegisteredReceivers, 此处HashMap的key的真正数据类型为客户端
LoadedApk.ReceiverDispatcher.InnerReceiver的Binder代理对象.


IntentResolver<BroadcastFilter, BroadcastFilter> mReceiverResolver

### BroadcastQueue

1.mBroadcastsScheduled为true,代表当前已广播消息BROADCAST_INTENT_MSG, 正在等待处理中.

## 三. 结论

发送的广播分为普通广播和串行广播;

- 根据发送的广播Intent是否带有Intent.FLAG_RECEIVER_FOREGROUND, 来决定将广播放入AMS中的前台广播队列(mFgBroadcastQueue)
,还是后台广播队列(mBgBroadcastQueue).
- 发送广播的过程, 也就是将BROADCAST_INTENT_MSG消息发送到ActivityManager线程即可返回.

- 动态注册的广播接收者, 即可能并行队列, 也可以在串行队列. 但静态注册的广播,则一定位于串行队列;

http://blog.csdn.net/codefly/article/details/42322695

位于mParallelBroadcasts中的并行广播, 一次性全部发出.

ANR

1. 对于串行广播, 当某个前台广播的处理时间超过> 该广播接收者个数*10s*2, 则抛出anr.
