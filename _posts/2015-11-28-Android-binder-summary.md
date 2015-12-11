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

## 一、概括

![java_binder](\images\binder\java_binder\java_binder.jpg)


### 1.什么是Binder？

1. 从IPC角度来说，Binder是Android中的一种跨进程通信方式，该通信方式在linux中没有，是Android独有

2. 从Android Driver层：Binder还可以理解为一种虚拟的物理设备，它的设备驱动是/dev/binder

3. 从Android Native层：Binder是创建Service Manager以及BpBinder/BBinder模型，搭建与binder驱动的桥梁

4. 从Android Framework层：Binder是各种Manager（ActivityManager、WindowManager等）和相应xxxManagerService的桥梁

5. 从Android APP层：Binder是客户端和服务端进行通信的媒介，当bindService的时候，服务端会返回一个包含了服务端业务调用的 Binder对象，通过这个Binder对象，客户端就可以获取服务端提供的服务或者数据，这里的服务包括普通服务和基于AIDL的服务


### 2.为什么Android内核要使用Binder
Android中有大量的CS（Client-Server）应用方式，这就要求Android内部提供IPC方法，而linux所支持的进程通信方式有两个问题：性能和安全性。

目 前linux支持的IPC包括传统的管道，System V IPC(消息队列/共享内存/信号量)，以及socket，但只有socket支持Client-Server的通信方式，由于socket是一套通用的 网络通信方式，其传输效率低下切有很大的开销，比如socket的连接建立过程和中断连接过程都是有一定开销的。消息队列和管道采用存储-转发方式，即数 据先从发送方缓存区拷贝到内核开辟的缓存区中，然后再从内核缓存区拷贝到接收方缓存区，至少有两次拷贝过程。共享内存虽然无需拷贝，但控制复杂，难以使 用。

在安全性方 面，Android作为一个开放式，拥有众多开发者的的平台，应用程序的来源广泛，确保智能终端的安全是非常重要的。终端用户不希望从网上下载的程序在不 知情的情况下偷窥隐私数据，连接无线网络，长期操作底层设备导致电池很快耗尽等等。传统IPC没有任何安全措施，完全依赖上层协议来确保。首先传统IPC 的接收方无法获得对方进程可靠的UID/PID（用户ID/进程ID），从而无法鉴别对方身份。Android为每个安装好的应用程序分配了自己的 UID，故进程的UID是鉴别进程身份的重要标志。使用传统IPC只能由用户在数据包里填入UID/PID，但这样不可靠，容易被恶意程序利用。可靠的身 份标记只有由IPC机制本身在内核中添加。其次传统IPC访问接入点是开放的，无法建立私有通道。比如命名管道的名称，system V的键值，socket的ip地址或文件名都是开放的，只要知道这些接入点的程序都可以和对端建立连接，不管怎样都无法阻止恶意程序通过猜测接收方地址获 得连接。

基于以上原 因，Android需要建立一套新的IPC机制来满足系统对通信方式，传输性能和安全性的要求，这就是Binder。Binder基于 Client-Server通信模式，传输过程只需一次拷贝，为发送发添加UID/PID身份，既支持实名Binder也支持匿名Binder，安全性 高。下图为Binder通信过程示例：




### 5.关于binder的一些思考
## 思考

创建Service Manager过程：

- Service Manager大小为128k
- binder驱动中，还有 binder_set_nice方法，能否调整nice优化binder

获取Service Manager过程：

- binder分配的默认内存大小为 1M-8k， 内存大小的设置依据？
- binder默认的最大可并发访问的线程数为15，为什么不是2^4=16？
- binder设备是支持多线程操作，那有binder同步工作可以进一步了解。
- defaultServiceManager中，获取server，失败后sleep 1s，建议可以缩短，提升响应速度。
- IPCThreadState，用来接收/发送来自Binder设备的数据mIn=256，mOut=256。mIn, mOut都是Parcel类型。每一次talkWithDriver,当mIn,mOut占满时，总512字节。每个线程拥有一个IPCThreadState，最大15个线程
- ServiceManager申请的binder大小为128k。而进程打开binder申请大小为4M

代码中if(false){} 应该不会影响代码，用javap做个实验