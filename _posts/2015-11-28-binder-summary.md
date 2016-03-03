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

### 1. Binder概述

1. 从IPC角度来说：Binder是Android中的一种跨进程通信方式，该通信方式在linux中没有，是Android独有；
2. 从Android Driver层：Binder还可以理解为一种虚拟的物理设备，它的设备驱动是/dev/binder；
3. 从Android Native层：Binder是创建Service Manager以及BpBinder/BBinder模型，搭建与binder驱动的桥梁；
4. 从Android Framework层：Binder是各种Manager（ActivityManager、WindowManager等）和相应xxxManagerService的桥梁；
5. 从Android APP层：Binder是客户端和服务端进行通信的媒介，当bindService的时候，服务端会返回一个包含了服务端业务调用的 Binder对象，通过这个Binder对象，客户端就可以获取服务端提供的服务或者数据，这里的服务包括普通服务和基于AIDL的服务。

### 2. Binder架构

![binder_arch](\images\binder\java_binder\java_binder.jpg)

Binder在整个Android系统中有这举足轻重的地位，在Native层有一套完整的binder通信的C/S架构(图中的蓝色)，Bpinder作为客户端，BBinder作为服务端。基于naive层的Binder框架，Java也有一套镜像功能的binder C/S架构，通过JNI技术，与native层的binder对应，Java层的binder功能最终都是交给native的binder来完成。从kernel到native，jni，framework层的架构所涉及的所有有关类和方法见[Binder类图](http://www.yuanhh.com/2015/11/21/binder-framework/#binder-1)。


### 3. Binder进程与线程


![binder_proc_relation](\images\binder\summary\binder_proc_relation.png)

对于底层Binder驱动，通过`binder_procs`链表记录所有创建的binder_proc结构体，binder驱动层的每一个binder_proc结构体都与用户空间的一个用于binder通信的进程一一对应，且每个进程有且只有一个`ProcessState`对象，这是通过单例模式来保证的。在每个进程中可以有很多个线程，每个线程对应一个IPCThreadState对象，IPCThreadState对象也是单例模式，即一个线程对应一个IPCThreadState对象，在Binder驱动层也有与之相对应的结构，那就是Binder_thread结构体。在binder_proc结构体中通过成员变量`rb_root threads`，来记录当前进程内所有的binder_thread。

Binder线程池：每个Server进程在启动时会创建一个binder线程池，并向其中注册一个Binder线程；之后Server进程也可以向binder线程池注册新的线程，或者Binder驱动在探测到没有空闲binder线程时会主动向Server进程注册新的的binder线程。对于一个Server进程有一个最大Binder线程数限制，默认为16个binder线程，例如Android的system_server进程就存在16个线程。对于所有Client端进程的binder请求都是交由Server端进程的binder线程来处理的。



### 4. Binder传输过程

Binder IPC机制，就是指在进程间传输数据（binder_transaction_data），一次数据的传输，称为事务（binder_transaction）。对于多个不同进程向同一个进程发送事务时，这个同一个进程或线程的事务需要串行执行，在Binder驱动中为binder_proc和binder_thread都有todo队列。

也就是说对于进程间的通信，就是发送端把binder_transaction节点，插入到目标进程或其子线程的todo队列中，等目标进程或线程不断循环地从todo队列中取出数据并进行相应的操作。


![binder_transaction](\images\binder\summary\binder_transaction.png)

在Binder驱动层，每个接收端进程都有一个todo队列，用于保存发送端进程发送过来的binder请求，这类请求可以由接收端进程的任意一个空闲的binder线程处理；接收端进程存在一个或多个binder线程，在每个binder线程里都有一个todo队列，也是用于保存发送端进程发送过来的binder请求，这类请求只能由当前binder线程来处理。binder线程在空闲时进入可中断的休眠状态，当自己的todo队列或所属进程的todo队列有新的请求到来时便会唤醒，如果是由所需进程唤醒的，那么进程会让其中一个线程处理响应的请求，其他线程再次进入休眠状态。

**binder的路由原理**：BpBinder发送端，根据handler，在当前binder_proc中，找到相应的binder_ref，由binder_ref再找到目标binder_node实体，由目标binder_node再找到目标进程binder_proc。简单地方式是直接把binder_transaction节点插入到binder_proc的todo队列中，完成传输过程。

对于binder驱动来说应尽可能地把binder_transaction节点插入到目标进程的某个线程的todo队列，效率更高。当binder驱动可以找到合适的线程，就会把binder_transaction节点插入到相应线程的todo队列中，如果找不到合适的线程，就把节点之间插入binder_proc的todo队列。


----------

**[如果您觉得文章对您有所帮助，不妨点我，关注我的微信、微博. ^_^](http://www.yuanhh.com/about/)**
