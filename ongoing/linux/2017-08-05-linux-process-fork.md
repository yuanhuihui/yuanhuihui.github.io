---
layout: post
title:  "Linux进程管理(二)"
date:   2017-08-05 20:12:50
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

> 基于Kernel 4.4

## 一. 概述

Linux创建进程采用fork()和exec()

- fork: 采用复制当前进程的方式来创建子进程，此时子进程与父进程的区别仅在于pid, ppid以及资源统计量(比如挂起的信号)
- exec：读取可执行文件并载入地址空间执行；一般称之为exec函数族，有一系列exec开头的函数，比如execl, execve等

fork过程复制资源包括代码段，数据段，堆，栈。fork调用者所在进程便是父进程，新创建的进程便是子进程；在fork调用结束，从内核返回两次，一次继续执行父进程，一次进入执行子进程。


### 1.1 进程创建对比

- Linux进程创建： 通过fork()系统调用创建进程
- Linux用户级线程创建：通过pthread库中的pthread_create()创建线程
- Linux内核线程创建： 通过kthread_create()

Linux线程，也并非"轻量级进程"，在Linux看来线程是一种进程间共享资源的方式，线程可看做是跟其他进程共享资源的进程。


fork, vfork, clone根据不同参数调用do_fork

- pthread_create: flags参数为 CLONE_VM | CLONE_FS | CLONE_FILES | CLONE_SIGHAND   
- fork: flags参数为 SIGCHLD 
- vfork: flags参数为 CLONE_VFORK | CLONE_VM | SIGCHLD


### 1.2 fork机制

![do_fork](/images/linux/process/do_fork.jpg)

fork执行流程:

1. 用户空间调用fork()方法;
2. 经过syscall陷入内核空间, 内核根据系统调用号找到相应的sys_fork系统调用;
3. sys_fork()过程会在调用do_fork(), 该方法参数有一个flags很重要, 代表的是父子进程之间需要共享的资源;
对于进程的创建则flags=SIGCHLD,只是当子进程退出时向父进程发送SIGCHLD信号;
4. do_fork(),会进行一些check过程,之后便是进入核心方法copy_process.

![clone_flags](/images/linux/process/clone_flags.jpg)

fork采用Copy on Write机制，父子进程共用同一块内存，只有当父进程或者子进程执行写操作时会拷贝一份新内存。

另外，创建进程失败的可能原因：进程个数达到系统上限 或者 系统可用内存不足。

## 二. fork源码分析

do_fork
  _do_fork
    copy_process
        dup_task_struct
        copy_flags
        alloc_pid
        
### 2.1 fork
[-> kernel/fork.c]

    SYSCALL_DEFINE0(fork)
    {
      return do_fork(SIGCHLD, 0, 0, NULL, NULL);
    }

### 2.2 do_fork
[-> kernel/fork.c]

    long do_fork(unsigned long clone_flags,
            unsigned long stack_start,
            unsigned long stack_size,
            int __user *parent_tidptr,
            int __user *child_tidptr)
    {
      return _do_fork(clone_flags, stack_start, stack_size,
          parent_tidptr, child_tidptr, 0);
    }

### 2.3 _do_fork

    long _do_fork(unsigned long clone_flags,
            unsigned long stack_start,
            unsigned long stack_size,
            int __user *parent_tidptr,
            int __user *child_tidptr,
            unsigned long tls)
    {
      struct task_struct *p;
      int trace = 0;
      long nr;

      if (!(clone_flags & CLONE_UNTRACED)) {
        if (clone_flags & CLONE_VFORK)
          trace = PTRACE_EVENT_VFORK;
        else if ((clone_flags & CSIGNAL) != SIGCHLD)
          trace = PTRACE_EVENT_CLONE;
        else
          trace = PTRACE_EVENT_FORK;

        if (likely(!ptrace_event_enabled(current, trace)))
          trace = 0;
      }
      
      //复制进程描述符【见小节2.4】
      p = copy_process(clone_flags, stack_start, stack_size,
           child_tidptr, NULL, trace, tls);

      if (!IS_ERR(p)) {
        struct completion vfork;
        struct pid *pid;

        trace_sched_process_fork(current, p);
        pid = get_task_pid(p, PIDTYPE_PID); //获取新创建的子进程的pid
        nr = pid_vnr(pid);

        if (clone_flags & CLONE_PARENT_SETTID)
          put_user(nr, parent_tidptr);
          
        if (clone_flags & CLONE_VFORK) { //用于vfork过程
          p->vfork_done = &vfork;
          init_completion(&vfork);
          get_task_struct(p);
        }

        wake_up_new_task(p); //唤醒子进程，分配CPU时间片

        if (unlikely(trace)) //告知ptracer，子进程已创建完成，并且已启动
          ptrace_event_pid(trace, pid);
          
        if (clone_flags & CLONE_VFORK) { //用于vfork过程
          if (!wait_for_vfork_done(p, &vfork))
            ptrace_event_pid(PTRACE_EVENT_VFORK_DONE, pid);
        }

        put_pid(pid);
      } else {
        nr = PTR_ERR(p);
      }
      return nr;
    }

### 2.4 copy_process
[-> kernel/fork.c]

    static struct task_struct *copy_process(unsigned long clone_flags,
              unsigned long stack_start,
              unsigned long stack_size,
              int __user *child_tidptr,
              struct pid *pid,
              int trace,
              unsigned long tls)
    {
      int retval;
      struct task_struct *p;
      void *cgrp_ss_priv[CGROUP_CANFORK_COUNT] = {};
      ...
      
      retval = security_task_create(clone_flags);
      ...
      
      //【见小节2.4.1】
      p = dup_task_struct(current); 
      ...
      rt_mutex_init_task(p); //初始化mutex
      
      //检查进程数是否超过上限
      retval = -EAGAIN;
      if (atomic_read(&p->real_cred->user->processes) >=
          task_rlimit(p, RLIMIT_NPROC)) {
        if (p->real_cred->user != INIT_USER &&
            !capable(CAP_SYS_RESOURCE) && !capable(CAP_SYS_ADMIN))
          goto bad_fork_free;
      }
      current->flags &= ~PF_NPROC_EXCEEDED;

      retval = copy_creds(p, clone_flags);
      ...

      //检查nr_threads是否超过max_threads
      retval = -EAGAIN;
      if (nr_threads >= max_threads)
        goto bad_fork_cleanup_count;

      delayacct_tsk_init(p);
      p->flags &= ~(PF_SUPERPRIV | PF_WQ_WORKER);
      p->flags |= PF_FORKNOEXEC;
      INIT_LIST_HEAD(&p->children);
      INIT_LIST_HEAD(&p->sibling);
      rcu_copy_process(p);
      p->vfork_done = NULL;
      spin_lock_init(&p->alloc_lock); //初始化自旋锁
      init_sigpending(&p->pending);   //初始化挂起信号

      p->utime = p->stime = p->gtime = 0;
      p->utimescaled = p->stimescaled = 0;
      prev_cputime_init(&p->prev_cputime);
      p->default_timer_slack_ns = current->timer_slack_ns;

      task_io_accounting_init(&p->ioac);
      acct_clear_integrals(p);

      posix_cpu_timers_init(p);

      p->start_time = ktime_get_ns(); //初始化进程启动时间
      p->real_start_time = ktime_get_boot_ns();
      p->io_context = NULL;
      p->audit_context = NULL;
      cgroup_fork(p);
      p->pagefault_disabled = 0;
    
      //执行调度器相关设置，将该task分配给一某个CPU
      retval = sched_fork(clone_flags, p); 
      retval = perf_event_init_task(p);
      retval = audit_alloc(p);
      
      //拷贝进程的所有信息
      shm_init_task(p); 
      retval = copy_semundo(clone_flags, p);
      retval = copy_files(clone_flags, p);
      retval = copy_fs(clone_flags, p);
      retval = copy_sighand(clone_flags, p);
      retval = copy_signal(clone_flags, p);
      retval = copy_mm(clone_flags, p);
      retval = copy_namespaces(clone_flags, p);
      retval = copy_io(clone_flags, p);
      retval = copy_thread_tls(clone_flags, stack_start, stack_size, p, tls);

      if (pid != &init_struct_pid) {
        //分配pid【】
        pid = alloc_pid(p->nsproxy->pid_ns_for_children);
        if (IS_ERR(pid)) {
          retval = PTR_ERR(pid);
          goto bad_fork_cleanup_io;
        }
      }

      p->set_child_tid = (clone_flags & CLONE_CHILD_SETTID) ? child_tidptr : NULL;
      p->clear_child_tid = (clone_flags & CLONE_CHILD_CLEARTID) ? child_tidptr : NULL;
    
      INIT_LIST_HEAD(&p->pi_state_list);
      p->pi_state_cache = NULL;

      //当共享同一个VM， 则sigaltstack应被清空
      if ((clone_flags & (CLONE_VM|CLONE_VFORK)) == CLONE_VM)
        p->sas_ss_sp = p->sas_ss_size = 0;

      user_disable_single_step(p);
      clear_tsk_thread_flag(p, TIF_SYSCALL_TRACE);
      clear_all_latency_tracing(p);

      p->pid = pid_nr(pid);
      if (clone_flags & CLONE_THREAD) {
        p->exit_signal = -1;
        p->group_leader = current->group_leader;
        p->tgid = current->tgid;
      } else {
        if (clone_flags & CLONE_PARENT)
          p->exit_signal = current->group_leader->exit_signal;
        else
          p->exit_signal = (clone_flags & CSIGNAL);
        p->group_leader = p;
        p->tgid = p->pid;
      }

      p->nr_dirtied = 0;
      p->nr_dirtied_pause = 128 >> (PAGE_SHIFT - 10);
      p->dirty_paused_when = 0;

      p->pdeath_signal = 0;
      INIT_LIST_HEAD(&p->thread_group);
      p->task_works = NULL;

      threadgroup_change_begin(current);

      //确保cgroup策略 能允许新进程被forked
      retval = cgroup_can_fork(p, cgrp_ss_priv);
      write_lock_irq(&tasklist_lock);

      /* CLONE_PARENT re-uses the old parent */
      if (clone_flags & (CLONE_PARENT|CLONE_THREAD)) {
        p->real_parent = current->real_parent;
        p->parent_exec_id = current->parent_exec_id;
      } else {
        p->real_parent = current;
        p->parent_exec_id = current->self_exec_id;
      }

      spin_lock(&current->sighand->siglock);
      copy_seccomp(p);

      recalc_sigpending();
      if (signal_pending(current)) {
        spin_unlock(&current->sighand->siglock);
        write_unlock_irq(&tasklist_lock);
        retval = -ERESTARTNOINTR;
        goto bad_fork_cancel_cgroup;
      }

      if (likely(p->pid)) {
        ptrace_init_task(p, (clone_flags & CLONE_PTRACE) || trace);

        init_task_pid(p, PIDTYPE_PID, pid);
        if (thread_group_leader(p)) {
          init_task_pid(p, PIDTYPE_PGID, task_pgrp(current));
          init_task_pid(p, PIDTYPE_SID, task_session(current));

          if (is_child_reaper(pid)) {
            ns_of_pid(pid)->child_reaper = p;
            p->signal->flags |= SIGNAL_UNKILLABLE;
          }

          p->signal->leader_pid = pid;
          p->signal->tty = tty_kref_get(current->signal->tty);
          list_add_tail(&p->sibling, &p->real_parent->children);
          list_add_tail_rcu(&p->tasks, &init_task.tasks);
          attach_pid(p, PIDTYPE_PGID);
          attach_pid(p, PIDTYPE_SID);
          __this_cpu_inc(process_counts);
        } else {
          current->signal->nr_threads++;
          atomic_inc(&current->signal->live);
          atomic_inc(&current->signal->sigcnt);
          list_add_tail_rcu(&p->thread_group,
                &p->group_leader->thread_group);
          list_add_tail_rcu(&p->thread_node,
                &p->signal->thread_head);
        }
        attach_pid(p, PIDTYPE_PID);
        nr_threads++;
      }
      total_forks++; //进程forks次数加1
      ...
      return p;

    ...
    fork_out:
      return ERR_PTR(retval);
    }

主要功能：

- dup_task_struct，复制当前进程task_struct
- 检查进程数是否超过上限
- 初始化自旋锁，挂起信息，进程启动时间等信息
- sched_fork执行调度器相关设置，设置task进程状态为TASK_RUNNING，并分配CPU资源
- 复制进程所有的信息，包括files, fs, mm, io, sighand, signal，等信息
- alloc_pid，分配新的pid

#### 2.4.1 dup_task_struct

    static struct task_struct *dup_task_struct(struct task_struct *orig)
    {
    	struct task_struct *tsk;
    	struct thread_info *ti;
    	int node = tsk_fork_get_node(orig);
    	int err;
      //分配task_struct节点
    	tsk = alloc_task_struct_node(node);
      //分配thread_info节点
    	ti = alloc_thread_info_node(tsk, node);
    	err = arch_dup_task_struct(tsk, orig);
      //将thread_info赋值给当前新创建的task
    	tsk->stack = ti;

    	setup_thread_stack(tsk, orig);
    	clear_user_return_notifier(tsk);
    	clear_tsk_need_resched(tsk);
    	set_task_stack_end_magic(tsk);
      ...

    	account_kernel_stack(ti, 1);
      
    	return tsk;
    }
    
#### 2.4.x
进程拷贝过程

#### 2.4.y alloc_pid
[kernel/msm-4.4/kernel/pid.c]



http://blog.csdn.net/gatieme/article/details/51569932
