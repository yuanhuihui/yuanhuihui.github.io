---
layout: post
title:  "wait、notify、sleep、interrupt对比分析"
date:   2016-01-03 19:10:40
catalog:  true
tags:
    - java
    - thread

---

> 对比分析Java中的各个线程相关的wait()、notify()、sleep()、interrupt()方法

## 方法简述

### Thread类

- sleep：暂停当前正在执行的线程；（**类方法**）
- yield：暂停当前正在执行的线程，并执行其他线程；（**类方法**）
- join：等待该线程终止；
- interrupt：中断该线程，当线程调用wait(),sleep(),join()或I/O操作时，将收到InterruptedException或 ClosedByInterruptException；


### Object类

- wait：暂停当前正在执行的线程，直到调用notify()或notifyAll()方法或超时，退出等待状态；
- notify：唤醒在该对象上等待的一个线程；
- notifyAll：唤醒在该对象上等待的所有线程；

## 详细分析

### sleep VS wait

sleep()和wait()方法都是暂停当前正在执行的线程，出让CPU资源。

|方法|所属类|方法类型|锁|解除方法|场景|用途
|---|---|---|
|sleep|Thread|静态方法|不释放锁|timeout,interrupt|无限制|线程内的控制|
|wait|Object|非静态方法|释放锁|timeout,notify,interrupt|同步语句块|线程间的通信|

	public static void sleep(long millis) throws InterruptedException
	public static void sleep(long millis, int nanos) throws InterruptedException
	
	public final void wait() throws InterruptedException
	public final void wait(long timeout) throws InterruptedException
	public final void wait(long timeout, int nanos) throws InterruptedException

### wait && notify
调用对象的wait()、notify()、notifyAll()方法的线程，必须是作为此对象监视器的所有者。常见的场景便是就是synchronized关键字的语句块内部使用这3个方法，如果直接在线程中使用wait()、notify()、notifyAll()方法，那么会抛出异常IllegalMonitorStateException，抛出的异常表明某一线程已经试图等待对象的监视器，或者试图通知其他正在等待对象的监视器而本身没有指定监视器的线程。。

调用wait()方法的线程，在调用该线程的interrupt()方法，则会重新尝试获取对象锁。只有当获取到对象锁，才开始抛出相应的异常，则执行该线程之后的程序。

### interrupt

interrupt()方法的工作仅仅是改变中断状态，并不是直接中断正在运行的线程。中断的真正原理是当线程被Object.wait(),Thread.join()或sleep()方法阻塞时，调用interrupt()方法后改变中断状态，而wait/join/sleep这些方法内部会不断地检查线程的中断状态值，当发现中断状态值改变时则抛出InterruptedException异常；对于没有阻塞的线程，调用interrupt()方法是没有任何作用。

### yield

yield()方法使当前线程出让CPU执行时间，当并不会释放当前线程所持有的锁。执行完yield()方法后，线程从Running状态转变为Runnable状态，既然是Runnable状态，那么也很可能马上会被CPU调度再次进入Running状态。
