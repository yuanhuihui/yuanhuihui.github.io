---
layout: post
title:  "Binder系列10—总结"
date:   2015-11-28 22:22:12
categories: android binder
excerpt:  Binder系列10—总结
---

* content
{:toc}


---

## 一、Binder概述

1. 从IPC角度来说，Binder是Android中的一种跨进程通信方式，该通信方式在linux中没有，是Android独有

2. 从Android Driver层：Binder还可以理解为一种虚拟的物理设备，它的设备驱动是/dev/binder

3. 从Android Native层：Binder是创建Service Manager以及BpBinder/BBinder模型，搭建与binder驱动的桥梁

4. 从Android Framework层：Binder是各种Manager（ActivityManager、WindowManager等）和相应xxxManagerService的桥梁

5. 从Android APP层：Binder是客户端和服务端进行通信的媒介，当bindService的时候，服务端会返回一个包含了服务端业务调用的 Binder对象，通过这个Binder对象，客户端就可以获取服务端提供的服务或者数据，这里的服务包括普通服务和基于AIDL的服务

## 二、Binder架构图

![binder_arch](\images\binder\java_binder\java_binder.jpg)


## 三、Binder类图

![java_binder_framework](\images\binder\java_binder_framework.jpg)


## 总结

未完待续

