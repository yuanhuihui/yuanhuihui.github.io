---
layout: post
title:  "进程的状态转换"
date:   2015-12-12 19:10:40
categories: linux java android
excerpt:  进程的状态转换
---

* content
{:toc}


---

> 进程状态转换，同样可用于线程的状态转移

### 1. 进程状态

进程的生命周期内，有5种状态，分别为new, runnable, running, blocked, dead共5种状态，进程所处的状态，会随着系统负载以及运行环境的变化而不断发生改变(由一个状态切换到另一个状态)。

![process_status](\images\process\process_status.jpg)

- 创建状态(new)：进程正在被创建，仅仅在堆上分配内存，尚未进入就绪状态；
 
- 就绪状态(Runnable)：进程已处于准备运行的状态，即进程已获得除了CPU之外的所需资源，一旦分配到CPU时间片即可进入运行状态。

- 运行状态(Running)：进程正在运行，占用CPU资源，执行代码。任意时刻点，处于运行状态的进程(线程)的总数，不会超过是CPU的总核数；

- 阻塞状态(Blocked): 进程处于等待某一事件而放弃CPU，暂停运行。阻塞状态分3类：
	- 阻塞在对象等待池：当进程在运行时执行Object.wait()方法，虚拟机会把线程放入等待池；
	- 阻塞在对象锁池  ：当进程在运行时企图获取已经被其他进程占用的同步锁时，虚拟机会把线程放入锁池；
	- 其他阻塞状态    ：当进程在运行时执行Sleep()方法，或调用其他进程的join()方法，或者发出I/O请求时，进入该阻塞状态。



- 死亡状态(dead)：进程正在被结束，这可能是进程正常结束或其他原因中断退出运行。
	- 进程结束运行前，系统必须置进程为dead态，再处理资源释放和回收等工作。

### 2. 状态转移

![process_status](\images\process\process_status_2.jpg)

1. Runnable -> Running： 就绪态的进程获得了CPU的时间片，进入运行态；
2. Running  -> Runnable: 运行态的进程在时间片用完后，必须出让CPU，进入就绪态；
3. Running -> Blocked： 当进程请求资源的使用权(如外设)或等待事件发生(如I/O完成)时，由运行态转换为阻塞态；
4. Blocked -> Runnable： 当进程已经获取所需资源的使用权或者等待事件已完成时，中断处理程序必须把相应进程的状态由阻塞态转为就绪态；

### 3.小结

进程的状态转移，主要围绕Runnable、Running、Blocked三个状态。Runnable与Running之间的转换，更多的是与调度器Scheduler相关，而Blocked状态主要涉及资源的使用权问题。