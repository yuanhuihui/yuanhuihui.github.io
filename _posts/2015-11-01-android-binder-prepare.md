---
layout: post
title:  "Binder系列—提纲"
date:   2015-11-01 15:20:30
categories: android binder
excerpt: Binder系列—提纲
---

* content
{:toc}

---

> 基于Android 6.0的源码剖析

## 一、概述
Android系统中，每个应用程序是由Android的Activity、Service、Broadcast，ContentProvider这四剑客的中一个或多个组合而成。比如多个Activity可能运行在不同的进程中，那么针对这种跨进程Activity间的通信，Android采用的是Binder进程间通信机制。不仅于此，整个Android系统架构中，大量采用了Binder机制作为进程间通信方案，当然也存在部分其他的IPC方式，比如Zygote通信便是采用socket。

Binder作为Android系统提供的一种IPC（进程间通信）机制，无论从系统开发还是应用开发，都是Android系统中最重要的组成，也是最难理解的一块知识点。要深入了解Binder机制，最好的方法便是阅读源码，借用Linux鼻祖Linus Torvalds曾说过的一句话：Read The Fucking Source Code。

## 二、 Binder

Binder通信采用c/s架构，包含client、server、ServiceManager、以及binder驱动，其中ServiceManager用于管理系统中的各种服务。

![ServiceManager](/images/binder/prepare/IPC-Binder.jpg)

图中的三个步骤都是基于Binder机制通信的。既然是基于Binder机制通信，那么同样也是C/S架构，则每个步骤都有相应的客户端与服务端。  

1. **注册服务**：Server进程要先注册Service到ServiceManager。该过程：Server是客户端，ServiceManager是服务端。
2. **获取服务**：Client进程使用某个Service前，须先向ServiceManager中获取相应的Service。该过程：Client是客户端，ServiceManager是服务端。
3. **使用服务**：Client根据得到的Service信息建立与Service所在的Server进程通信的通路，然后就可以直接与Service交互。该过程：client是客户端，server是服务端。 

从上图中，Client,Server,Service Manager之间交互都是虚线表示，是由于它们彼此之间不是直接交互的，而是都通过与Binder驱动设备交互，从而实现IPC通信方式。其中Binder驱动是内核空间，Client,Server,Service Manager属于用户空间。另外，Binder驱动和Service Manager可以看做是Android平台的基础架构，而Client和Server是Android的应用层，开发人员只需自定义实现client,Server端，借助Android的基本平台架构便可以直接进行IPC通信。


其中ServiceManager是Android进程间通信机制Binder的守护进程。Client与Server要进行通信，都需要先获取ServiceManager接口，才能进行通信服务。
  
BpBinder和BBinder都是Android中与Binder通信相关的代表，它们都从IBinder类中派生而来，关系图如下：  


![Binder关系图](/images/binder/prepare/Ibinder_classes.jpg)

- client端：BpBinder.transact()来发送事务请求；
- server端：BBinder.transact()会接收到相应事务。


## 三、 提纲

Binder系列主要讲述几大块

- [Binder系列1 —— Binder驱动](http://www.yuanhh.com/2015/11/01/android-binder-1/)
- [Binder系列2 —— 创建Service Manager](http://www.yuanhh.com/2015/11/07/android-binder-2/)
- [Binder系列3 —— 获取Service Manager](http://www.yuanhh.com/2015/11/08/android-binder-3/)
- [Binder系列4 —— 注册服务(addService)](http://www.yuanhh.com/2015/11/14/android-binder-4/)
- [Binder系列5 —— 获取服务(getService)](http://www.yuanhh.com/2015/11/15/android-binder-5/)
- [Binder系列6 —— framework层分析](http://www.yuanhh.com/2015/11/21/android-binder-6/)
- [Binder系列7 —— 如何使用Binder](http://www.yuanhh.com/2015/11/22/android-binder-7/)
- [Binder系列8 —— 如何使用AIDL](http://www.yuanhh.com/2015/11/22/android-binder-8/)
- [Binder系列9 —— 总结](http://www.yuanhh.com/2015/11/28/android-binder-summary/)


说明：在开始开展源码剖析之前，先申明所涉及的源码，会有部分的精简，主要是去掉所有log输出语句，已减少代码篇幅过于长。



