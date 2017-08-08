---
layout: post
title:  "Linux进程管理(一)"
date:   2017-07-30 20:12:50
catalog:  true
tags:
    - linux
    - process

---

## 一. 概述

Linux是类Unix系统，借鉴了Unix的设计并实现相关接口，但并非Unix。Linux是由Linus Torvalds于1991年创造的开源免费系统，采用GNU GPL协议保护，下面列举Linux的一些主要特点：

- Linux系统中万物皆为文件，这种抽象方便操作数据或设备，只需一套统一的系统接口open, read, write, close即可完成对文件的操作
- Linux是单内核，支持动态加载内核模块，可在运行时根据需求动态加载和卸载部分内核代码；
- Linux内核支持可抢占；
- Linux内核创建进程，采用独特的fork()系统调用，创建进程较高效；
- Linux内核并不区分进程和线程，对于内核而言，进程与线程无非是共享资源的区别，对CPU调度来说并没有显著差异。

### 1.1 进程概念

进程与线程的发展演化的目标，是为了更快的创建进程/线程，更小的上下文切换开销，更好的支持SMP以及HMP架构的CPU。
线程上下文(例如各个寄存器状态，pc指针)的切换比进程开销要小得多。

系统需要运转起来，代码都是静态的，进程才具有生命力，进程是程序的动态执行过程
，进程正是操作系统的心脏所在。何为进程？进程是处于执行状态的代码以及相关资源的集合，不仅仅是代码段(text section)，还包括文件，信号，CPU状态，内存地址空间等。线程基本可以等同于进程般对待。

- 虚拟处理器：多个进程共享同一个处理器，但虚拟处理器给进程一种独占的感觉；
- 虚拟内存：多进程分享整个内存，但虚拟内存给进程以独占整个内存空间的感觉；

## 二. 进程

### 2.1 task_struct结构体

进程主要由以下几部分组成：

- 代码段：编译后形成的一些指令
- 数据段：程序运行时需要的数据
  - 只读数据段：常量
  - 已初始化数据段：全局变量，静态变量
  - 未初始化数据段（bss)：未初始化的全局变量和静态变量
- 堆栈段：程序运行时动态分配的一些内存
- PCB：进程信息，状态标识等

Linux内核中进程用`task_struct`结构体表示，称为进程描述符，该结构体相对比较复杂，有几百行代码，记载着该进程相关的所有信息，比如进程地址空间，进程状态，打开的文件等。对内核而言，进程或者线程都称为任务task。内核将所有进程放入一个双向循环链表结构的任务列表(task list)。

![task_struct](/images/linux/process/task_struct.jpg)

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
       
       void *stack;    //  指向内核栈的指针
       ...
    }    
    
进程运行在内核态时，需要相应的堆栈信息, 则linux kernel为每个进程都提供一个内核栈kernel stack.

#### 2.1.1 thread_info

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

    
### 2.2 进程状态

进程结构体task_struct有一个成员state，代表的是进程的状态。
进程所有可能的状态定义在文件kernel/include/linux/sched.h，
不同的linux版本略有不同，下面列举最新Kernel的进程状态值：


|序号|状态|缩写|含义|
|---|---|---|
|1|TASK_RUNNING|R|正在运行或可运行|
|2|TASK_INTERRUPTIBLE|S|可中断的休眠|
|3|TASK_UNINTERRUPTIBLE|D|不可中断的休眠|
|4|__TASK_STOPPED|T|跟踪状态, 当进程接收到SIGSTOP等signal信息|
|5|__TASK_TRACED|t|停止状态，比如被debugger的ptrace()|
|6|EXIT_ZOMBIE|Z|僵尸状态，即父进程还没有执行waitpid()|
|7|EXIT_DEAD|X|死亡状态|

说明：

- R状态: 分为正在执行和RQ队列等待执行两种状态，该状态是唯一可执行的状态；
- D状态：不影响任何信号，如果分析过一些系统冻屏/死机重启的案例，会发现很多时候是由于某个进程异常处于D状态而导致系统blocked。
即便如此，也有其存在的价值，比如当进程打开设备驱动文件时，在驱动程序执行完成之前是
不希望被打断的，可能会出现不可预知的状态。
- Z状态：出现这个状态往往是父进程没有执行waitpid()或wait4()系统调用，
在这种情况下，内核不会丢弃该死亡进程的信息，系统无法判断是父进程是否还需要该信息。

进程状态转换图：

![process_schedule](/images/linux/process/process_schedule.jpg)

### 2.3 进程pid

pid最大值默认为32768，一般来说pid数值越大的进程创建时间越晚，但进程再不断创建与结束，轮完一圈又会继续从小开始轮循，所以也就破坏了这个规则。可以通过修改/proc/sys/kernel/pid_max来提高上限。

其他相关ID：

- Tgid: 线程组的ID,一个线程一定属于一个线程组(进程组).
- Pid: 进程的ID,更准确的说应该是线程的ID
- PPid: 当前进程的父进程


另外，每个进程的资源是有上限，可通过cat /proc/<pid>/limits查看


###  2.4 进程创建

- Linux进程创建： 通过fork()系统调用创建进程
- Linux用户级线程创建：通过pthread库中的pthread_create()创建线程
- Linux内核线程创建： 通过kthread_create()创建内核线程

内核线程：没有独立的地址空间，即mm指向NULL。这样的线程只在内核运行，不会切换到用户空间。
所有内核线程都是由kthreadd作为内核线程的祖师爷，衍生而来的。
