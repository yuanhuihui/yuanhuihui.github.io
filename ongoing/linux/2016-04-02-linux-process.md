---
layout: post
title:  "Linux进程(一)"
date:   2016-04-02 20:12:50
catalog:  true
tags:
    - linux
    - process

---

## 一. 概述

Linux是类Unix系统，借鉴了Unix的设计并实现相关接口，但并非Unix。Linux是由Linus Torvalds于1991年创造的开源免费系统，采用GNU GPL协议保护。

下面，列举Linux的几个比较重要特点：

- Linux系统中万物皆为文件，这种抽象极大地方便了对数据或者设备的操作，只需一套统一的系统接口open, read, write, close完成对文件的操作。
- Linux是单内核，支持动态加载内核模块，可在运行时根据需求动态加载和卸载部分内核代码；
- Linux支持多对称处理器(SMP)机制；
- Linux内核支持可抢占；
- Linux内核创建进程，采用独特的fork()系统调用，创建进程比较高效；
- Linux内核并不区分进程和线程，对于内核而言，进程与线程无非是共享资源的区别，对CPU调度来说并没有显著差异。

## 进程

进程与线程的发展演化的目标，是为了更快的创建进程/线程，更小的上下文切换开销，更好的支持SMP以及HMP架构的CPU。
线程上下文(例如各个寄存器状态，pc指针)的切换比进程开销要小得多。

系统需要运转起来，代码都是静态的，进程才具有生命力，进程正是操作系统的心脏所在。

何为进程？进程是处于执行状态的代码以及相关资源的集合，不仅仅是代码段(text section)，还包括文件，信号，CPU状态，内存地址空间等。
线程基本可以等同于线程般对待。

虚拟处理器和虚拟内存：
- 多个进程分享一个处理器，但虚拟处理器给进程一种独占的感觉；
- 虚拟内存给进程以独占整个内存空间的感觉；

同一进程的线程间共享虚拟内存，但都有各自独立的虚拟处理器；

进程是程序的动态执行过程


进程=代码段（编译后形成的一些指令）+数据段（程序运行时需要的数据）+堆栈段（程序运行时动态分配的一些内存）+PCB（进程信息，状态标识等）

数据段包括：

- 只读数据段：常量
- 已初始化数据段：全局变量，静态变量
- 未初始化数据段（bss)：未初始化的全局变量和静态变量（实际上不分配内存，因为都为0，只有一些标记信息）


进程是动态的，程序是静态的


task_struct 是一个相当大的数据结构，同时里面也指向了其他类型的数据结构，比如 thread_info，指向的是这个进程的线程信息; mm_struct 指向了这个进程的内存结构; file_struct 指向了这个进程打开的进程描述符结构

进程切换需要保存 硬件上下文.  

硬件上下文:  CPU各个寄存器的状态


## 二. 进程

### 2.1 task_struct

Linux内核中进程用`task_struct`结构体表示，称为进程描述符，该结构体相对比较复杂，有几百行代码，记载着该进程相关的所有信息，比如进程地址空间，进程状态，打开的文件等。对内核而言，进程或者线程都称为任务task。内核将所有进程放入一个双向循环链表结构的任务列表(task list)。

[-> sched.h]

    struct task_struct {
       volatile long state; //进程状态
       struct mm_struct *mm, *active_mm; //内存地址空间
       pid_t pid;
	     pid_t tgid;

       struct task_struct __rcu *real_parent; //真正的父进程，fork时记录的
       struct task_struct __rcu *parent; // ptrace后，设置为trace当前进程的进程
       struct list_head children;  //子进程
	     struct list_head sibling;	//父进程的子进程，即兄弟进程
       struct task_struct *group_leader; //线程组的领头线程

       char comm[TASK_COMM_LEN];  //进程名，长度上限为16字符
       struct fs_struct *fs;  //文件系统信息
       struct files_struct *files; // 打开的文件

       struct signal_struct *signal;
       struct sighand_struct *sighand;
       struct sigpending pending;
       ...
    }    

### 2.2 thread_info

Linux通过slab动态生成task_struct，那么在栈顶或栈底创建新的结构体thread_info即可，其中task指向其真正的task_struct结构体。

    struct thread_info {
    	struct task_struct	*task;		//主要的进程描述符
    	struct exec_domain	*exec_domain;
    	__u32			flags;		
    	__u32			status;		// 线程同步flags
    	__u32			cpu;		//当前cpu
    	int			preempt_count;
    	mm_segment_t		addr_limit;
    	struct restart_block    restart_block;
    	void __user		*sysenter_return;
    	unsigned int		sig_on_uaccess_error:1;
    	unsigned int		uaccess_err:1;
    };

### 2.3 pid

pid最大值默认为32768，一般来说pid数值越大的进程创建时间越晚，但进程再不断创建与结束，轮完一圈又会继续从小开始轮循，所以也就破坏了这个规则。
可以通过修改/proc/sys/kernel/pid_max来提高上限。

## 2.4 进程状态

task_struct结构体有一个成员state，代表的是进程的状态：

|状态|缩写|含义|
|---|---|---|
|TASK_RUNNING|R|可运行状态|
|TASK_INTERRUPTIBLE|S|可中断的休眠|
|TASK_UNINTERRUPTIBLE|D|不可中断的休眠|
|__TASK_TRACED|T|被跟踪的状态|
|__TASK_STOPPED|T|停止状态|
|EXIT_ZOMBIE|Z|僵尸状态|
|EXIT_DEAD|X|死亡状态|

进程的各个状态定义在文件kernel/include/linux/sched.h，状态含义进一步说明：

- TASK_RUNNING: 可运行状态，分为正在执行和RQ队列等待执行，该状态是唯一可执行的状态；
- TASK_INTERRUPTIBLE: 可中断的休眠，条件达成或者收到信号则会唤醒；
- TASK_UNINTERRUPTIBLE: 不可中断的休眠，只有条件达成才会唤醒，不响应任何信号，比如SIGKILL；
- __TASK_TRACED: 被跟踪的状态，比如ptrace调试跟踪
- __TASK_STOPPED: 停止状态，往往是收到SIGSTOP，SIGTSTP等信号，或者调试期间收到任何信号，都进入该状态。
- EXIT_ZOMBIE:僵尸状态，已终止但还没有被父进程回收
- EXIT_DEAD: 死亡状态，应该是看不到的状态

【增加图】 【参考文章的页24】

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

###  进程/线程的创建

- Linux进程创建： 通过fork()系统调用创建进程
- Linux用户级线程创建：通过pthread库中的pthread_create()创建线程
- Linux内核线程创建： 通过kthread_create()

内核线程：没有独立的地址空间，即mm指向NULL。这样的线程只在内核运行，不会切换到用户空间。
所有内核线程都是由kthreadd作为内核线程的祖师爷，衍生而来的。通过kthread_create()来创建新的内核线程。



### 其他参数

Tgid: 线程组的ID,一个线程一定属于一个线程组(进程组).
Pid: 进程的ID,更准确的说应该是线程的ID
PPid: 当前进程的父进程

### 常见命令

    cat /proc/PID/status
    cat /proc/PID/stat
    ps


http://blog.csdn.net/u012927281/article/details/52016191

http://www.ibm.com/developerworks/cn/linux/l-linux-process-management/index.html

http://blog.csdn.net/gatieme/article/details/51569932

dup_task_struct
copy_files()、copy_fs()
copy_sighand()、copy_signal()
copy_mm
copy_thread
