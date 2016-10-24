---
layout: post
title:  "Linux内核"
date:   2016-10-02 20:12:50
catalog:  true
tags:
    - linux
    - process

---

		linux/sched.h
		linux/kthread.h
    kernel/fork.c
		kernel/exit.c

## 一. 概述

Linux是类Unix系统，借鉴了Unix的设计并实现相关接口，但并非Unix。1991年是由Linus Torvalds创造的开源免费系统，采用GNU GPL协议保护。
Linux的几个比较重要特点：

- Linux系统中万物皆为文件，这种抽象极大地方便了对数据或者设备的操作，只需一套统一的系统接口open, read, write, close完成对文件的操作。
- Linux内核创建进程，采用独特的fork()系统调用，创建过程非常迅速。
- Linux是一个单内核，但支持动态加载内核模块，可运行时根据需求动态加载和卸载部分内核代码；
- Linux支持多对称处理器(SMP)机制
- Linux内核支持可抢占；
- Linux内核并不区分进程和线程，对于内核而言，进程与线程无非是共享资源的区别罢了，对于CPU来说没有任何的区别。

## 二. Linux

【需要图片】 syscall <-> 内核 <-> 中断

- 应用程序通过系统调用syscall与内核通信；
- 硬件设备通过发出中断信号，来打断CPU的执行。每一个中断对应一个中断号，内核通过中断号，找到并调用该中断处理程序来响应中断。

例如，当用手指触摸屏幕，则屏幕设备会发送中断，告知内核有touch输入事件需要处理，内核收到中断并调用相应处理程序来响应该输入事件。

【需要图片】

CPU的三种运行状态：

- 运行在User Space，执行用户进程；
- 运行在Kernel Space，处于进程上下文，执行相应的进程；当CPU空闲时也处于该状态；
- 运行在Kernel Space，处于中断上下文，处理相应的中断。



## 整体

与Linux进程和线程一一对应
通过fork系统调用创建进程
通过pthread库接口创建线程

## 一. 进程

系统需要运转起来，代码都是静态的，进程才具有生命力，进程正是操作系统的心脏所在。

何为进程？进程是处于执行状态的代码以及相关资源的集合，不仅仅是代码段(text section)，还包括文件，信号，CPU状态，内存地址空间等。
线程基本可以等同于线程般对待。

虚拟处理器和虚拟内存：
- 多个进程分享一个处理器，但虚拟处理器给进程一种独占的感觉；
- 虚拟内存给进程以独占整个内存空间的感觉；

同一进程的线程间共享虚拟内存，但都有各自独立的虚拟处理器；

### fork

Linux通过fork复制父进程的方式来创建新进程，其中fork调用者所在进程便是父进程，新创建的进程便是子进程；在fork调用结束，从内核返回两次，一次继续执行父进程，一次进入执行子进程。

执行流： fork -> exec -> exit

fork -> clone()

### exit

1. 进程调用exit()退出执行，并会释放进程所占用的资源，再将自身设置为僵死状态(Z)；
2. 父进程调用wait4()来查询子进程是否终结；
3. 当父进程执行完wait或者waitpid操作后，该进程彻底退出。

	exit
		do_exit
			exit_mm
			sem_exit
			exit_files
			exit_fs
			exit_notify
			schedule
		
到此该进程相关的所有资源都已释放，并处于EXIT_ZOMBIE状态。此时进程所占用的内存为内核栈、task_struct和hread_info结构体， 该进程存在的唯一目标就是向父进程提供信息。

### task

对内核而言，进程或者线程都称为任务task。内核将所有进程放入任务队列的双向循环链表，每一个task的数据类型便是task_struct结构体，称为进程描述符，记载着该进程相关的所有信息，比如进程地址空间，进程状态，打开的文件等；定义在<linux/sched.h>

### pid

pid最大值默认为32768，一般来说pid数值越大的进程创建时间越晚，但进程再不断创建与结束，轮完一圈又会继续从小开始轮训，所以也就破坏了这个规则。

可以通过修改/proc/sys/kernel/pid_max来提高上限。


### 进程状态

进程总共有5个状态：

- TASK_RUNNING: 可运行状态，分为正在执行和RQ队列等待执行，该状态是唯一可执行的状态；
- TASK_INTERRUPTIBLE: 可中断的休眠，条件达成或者收到信号则会唤醒；
- TASK_UNINTERRUPTIBLE: 不可中断的休眠，只有条件达成才会唤醒，不响应任何信号，比如SIGKILL；
- __TASK_TRACED: 被跟踪的状态，比如ptrace调试跟踪
- __TASK_STOPPED: 停止状态，往往是收到SIGSTOP，SIGTSTP等信号，或者调试期间收到任何信号，都进入该状态。

【内核设计与实现 P24】



D状态：不可中断
Z状态：僵尸状态

### 创建

许多其他系统采用spawn机制创建进程:新的地址空间创建进程，读入可执行文件

Linux则采用fork()和exec()

fork: 复制当前进程的方式来创建子进程，此时子进程与父进程的区别在于pid, ppid以及资源统计量(比如挂起的信号)
exec： 读取可执行文件并载入地址空间执行；

这两个操作跟spawn有点相似；

#### 写时拷贝

所以fork后，有意希望子进程先执行（减少写时拷贝）， 但事实并非总是如此，为何？

#### 调用过程

fork, vfork, __clone根据不同参数调用 clone， 再调用do_fork [kernel/fork.c]


		fork
			clone
				do_fork
					copy_process
						dup_task_struct
						设置TASK_UNINTERRUPTIBLE，保证不会运行
						copy_flags
						alloc_pid
						
- 线程: clone(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGCHLD, 0)
- fork: clone(SIGCHLD)
- vfork: clone(CLONE_VFORK | CLONE_VM | SIGCHLD, 0)
		
Linux 线程，也并非"轻量级进程"，在Linux看来线程一种进程间共享资源的方式，线程可看做是跟其他进程共享资源的进程。


### 内核线程 vs 普通进程
内核线程没有独立的地址空间，即mm指向NULL。这样的线程只在内核运行，不会切换到用户空间。其他跟普通进程一样。

所有内核线程都是由kthreadd作为内核线程的祖师爷，衍生而来的。通过kthread_create()来创建新的内核线程。



## 二. 线程创建


多进程浏览器： IE浏览器，chrome浏览器
单进程多线程浏览器：firefox浏览器

《Linux内核设计与实现》
