---
layout: post
title:  "Binder系列9—总结"
date:   2015-11-28 22:22:12
categories: android binder
excerpt:  Binder系列9—总结
---

* content
{:toc}


---

## 架构图

![java_binder](\images\binder\java_binder\java_binder.jpg)


## 什么是Binder？

1. 从IPC角度来说，Binder是Android中的一种跨进程通信方式，该通信方式在linux中没有，是Android独有

2. 从Android Driver层：Binder还可以理解为一种虚拟的物理设备，它的设备驱动是/dev/binder

3. 从Android Native层：Binder是创建Service Manager以及BpBinder/BBinder模型，搭建与binder驱动的桥梁

4. 从Android Framework层：Binder是各种Manager（ActivityManager、WindowManager等）和相应xxxManagerService的桥梁

5. 从Android APP层：Binder是客户端和服务端进行通信的媒介，当bindService的时候，服务端会返回一个包含了服务端业务调用的 Binder对象，通过这个Binder对象，客户端就可以获取服务端提供的服务或者数据，这里的服务包括普通服务和基于AIDL的服务


## 关于binder优化的一些思考

- binder驱动中，还有 binder_set_nice方法，能否调整nice优化binder
- binder分配的默认内存大小为 1M-8k， 内存大小的设置依据？
- binder默认的最大可并发访问的线程数为15，为什么不是2^4=16？
- binder设备是支持多线程操作，那有binder同步方面是否与死锁，或者锁的粒度问题
- defaultServiceManager中，获取server，失败后sleep 1s，建议可以缩短，提升响应速度。
- IPCThreadState，用来接收/发送来自Binder设备的数据mIn=256，mOut=256。mIn, mOut都是Parcel类型。每一次talkWithDriver,当mIn,mOut占满时，总512字节。每个线程拥有一个IPCThreadState，最大15个线程
- ServiceManager申请的binder大小为128k。而进程打开binder申请大小为4M
- binder_stats,trace_binder_command这些是否对性能产生影响，能否去掉。
- 请求服务过程过程中，通过休眠0.5s的方法，是否有优化方案；
