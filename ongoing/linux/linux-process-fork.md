---
layout: post
title:  "Linux进程(二)"
date:   2016-10-02 20:12:50
catalog:  true
tags:
    - linux
    - process

---

    kernel/include/linux/sched.h
    bionic/libc/bionic/pthread_create.cpp
    kernel/arch/arm/include/asm/thread_info.h

        linux/kthread.h
    kernel/fork.c
        kernel/exit.c


## 一. 概述

许多其他系统采用spawn机制创建进程:新的地址空间创建进程，读入可执行文件

Linux则采用fork()和exec()，这两个操作合起来的功能跟spawn有点相似；

- fork: 复制当前进程的方式来创建子进程，此时子进程与父进程的区别仅在于pid, ppid以及资源统计量(比如挂起的信号)
- exec： 读取可执行文件并载入地址空间执行；

fork: Linux通过fork复制父进程的方式来创建新进程，复制的资源包括text segment, data segment, stack, heap这些内存区域。fork调用者所在进程便是父进程，新创建的进程便是子进程；在fork调用结束，从内核返回两次，一次继续执行父进程，一次进入执行子进程。



### 调用过程

调用流程:

1. 用户空间调用fork()方法;
2. 经过syscall陷入内核空间, 内核根据系统调用号找到相应的sys_fork系统调用;
3. sys_fork()过程会在调用do_fork(), 该方法参数有一个flags很重要, 代表的是父子进程之间需要共享的资源;
对于进程的创建则flags=SIGCHLD,只是当子进程退出时向父进程发送SIGCHLD信号;
4. do_fork(),会进行一些check过程,之后便是进入核心方法copy_process.


fork, vfork, clone根据不同参数调用do_fork  [kernel/fork.c]


- pthread_create: 调用clone(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND, 0)   
    pthread_create -> clone -> sys_clone -> do_fork
- fork: clone(SIGCHLD)     
    fork -> sys_fork -> do_fork
- vfork: clone(CLONE_VFORK | CLONE_VM | SIGCHLD, 0)
    vfork -> sys_vfork -> do_fork

线程: int flags = CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND | CLONE_THREAD | CLONE_SYSVSEM |
  CLONE_SETTLS | CLONE_PARENT_SETTID | CLONE_CHILD_CLEARTID;

进程: FORK_FLAGS (CLONE_CHILD_SETTID | CLONE_CHILD_CLEARTID | SIGCHLD)

### 说明

Linux通过fork复制父进程的方式来创建新进程，其中fork调用者所在进程便是父进程，新创建的进程便是子进程；在fork调用结束，从内核返回两次，一次继续执行父进程，一次进入执行子进程。

执行流： fork -> exec -> exit


创建进程失败，可能原因：

1. 进程达到系统上限；
2. 系统内存不足；


进程创建后，每个进程的资源是有上限， 可通过

cat /proc/32261/limits来查看

## 二. fork解析

### 2.1 do_fork
[-> kernel/fork.c]

do_fork
  copy_process
      dup_task_struct
      copy_flags
      alloc_pid

### 2.2 pthread_create

        pthread_create -> __pthread_create_2_1 -> create_thread -> do_clone


#### 写时拷贝

所以fork后，有意希望子进程先执行（减少写时拷贝）， 但事实并非总是如此，为何？



### 2.3 对比

- Linux进程创建： 通过fork()系统调用创建进程
- Linux用户级线程创建：通过pthread库中的pthread_create()创建线程
- Linux内核线程创建： 通过kthread_create()

- pthread_create: clone(CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND, 0)
- fork: clone(SIGCHLD)
- vfork: clone(CLONE_VFORK | CLONE_VM | SIGCHLD, 0)

Linux 线程，也并非"轻量级进程"，在Linux看来线程是一种进程间共享资源的方式，线程可看做是跟其他进程共享资源的进程。

## 三. 进程退出

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


## COW

http://blog.csdn.net/evenness/article/details/7656812
http://www.ibm.com/developerworks/cn/linux/kernel/l-thread/

## 文件引用的问题

fork和dup，都只是增加file->f_count的引用计数

## 解决方案：

1. bionic fork： 直接关闭，比较合适。
2. copy_process, fs的文件计数： 子进程不加引用会有问题，子进程死亡会导致主进程binder_release
3. binder_release：主进程被杀，并收不到binder_flush, 子进程被杀则能。无法解决问题。
4. zygote waitpit. 目前并不支持。
5. exit()：设计不够合理


### 2.4

【需要图片】
syscall <-> 内核 <-> 中断

- 应用程序通过系统调用syscall与内核通信；
- 硬件设备通过发出中断信号，来打断CPU的执行。每一个中断对应一个中断号，内核通过中断号，找到并调用该中断处理程序来响应中断。

例如，当用手指触摸屏幕，则屏幕设备会发送中断，告知内核有touch输入事件需要处理，内核收到中断并调用相应处理程序来响应该输入事件。




### CPU的三种运行状态

- 运行在User Space(用户空间)，执行用户进程；
- 运行在Kernel Space(内核空间)，处于进程上下文，执行相应的进程；当CPU空闲时也处于该状态；
- 运行在Kernel Space(内核空间)，处于中断上下文，处理相应的中断。

【需要图片】


http://blog.csdn.net/u012927281/article/details/52016191

http://www.ibm.com/developerworks/cn/linux/l-linux-process-management/index.html

http://blog.csdn.net/gatieme/article/details/51569932

//内核blog
http://blog.csdn.net/gatieme/article/details/51577479
