---
layout: post
title:  "理解Kill进程的实现原理"
date:   2016-04-16 10:10:22
categories: android process
excerpt:  理解Kill进程的实现原理
---

* content
{:toc}

---

> 基于Android 6.0的源码剖析， 分析kill进程的实现原理，本文涉及到的源码：

	/framework/base/core/java/android/os/Process.java
	/framework/base/core/jni/android_util_Process.cpp
	/frameworks/base/core/jni/com_android_internal_os_Zygote.cpp

	/kernel/kernel/signal.c
	/Kernel/include/linux/syscalls.h
	/kernel/include/uapi/asm-generic/unistd.h(内核空间的系统调用号)
	/bionic/libc/kernel/uapi/asm-generic/unistd.h (用户空间的系统调用号)

	/art/runtime/Runtime.cc
	/art/runtime/signal_catcher.h
	/art/runtime/signal_catcher.cc

### 概述

文章[理解Android进程创建流程](http://gityuan.com/2016/03/26/app-process-create)，介绍了Android进程创建过程是如何从framework一步步走到虚拟机。本文正好相反则是说说进程是如何被kill的过程。简单说，kill进程其实是通过发送signal信号的方式来完成的。创建进程从Process.start开始说起，那么杀进程则相应从Process.killProcess开始讲起。

## 信号(Signal)发送

### 1. Process.killProcess

[-> Process.java]

	public static final void killProcess(int pid) {
	    sendSignal(pid, SIGNAL_KILL); //【见流程2】
	}

其中`SIGNAL_KILL = 9`，这里的`sendSignal`是一个Native方法。在Android系统启动过程中，虚拟机会注册各种framework所需的JNI方法，很多时候查询Java层的native方法所对应的native方法，可在路径/framework/base/core/jni中找到，如果找不到的话，有兴趣可以看看[Zygote篇](http://gityuan.com/2016/02/13/android-zygote/#jnistartreg)。 

这里的sendSignal所对应的JNI方法在android_util_Process.cpp文件的android_os_Process_SendSignalQuiet方法，接下来进入见流程2.

### 2. SendSignalQuiet

[- >android_util_Process.cpp]

	void android_os_Process_sendSignalQuiet(JNIEnv* env, jobject clazz, jint pid, jint sig)
	{
	    if (pid > 0) {
	        kill(pid, sig); //此处sig=9，【见流程3】
	    }
	}

这里的`kill`方法位于用户空间的Native层，经过syscall进入到Linux内核的`sys_kill方法`。另外，此处kill(pid，9)，其实与大家平时在adb里输入的 `kill -9 <pid>` 是一个概念。

### 3. 系统调用

[-> syscalls.h]

	asmlinkage long sys_kill(int pid, int sig);

 `sys_kill()`方法在linux内核中没有直接定义，而是通过宏定义`SYSCALL_DEFINE2`的方式来实现的。Android内核（即Linux）会为每个syscall分配唯一的系统调用号，当执行系统调用时会根据系统调用号从系统调用表中来查看目标函数的入口地址，在calls.S文件中声明了入口地址信息(这里已经追溯到汇编语言了，就不再介绍)。另外，其中asmlinkage是gcc标签，表明该函数读取的参数位于栈中，而不是寄存器。

如何查找`sys_kill()`所在路径呢？可通过内核空间的`/kernel/include/uapi/asm-generic/unistd.h`，会记录

	/* kernel/signal.c */
	#define __NR_kill 129
	__SYSCALL(__NR_kill, sys_kill)

从这里可以推测`sys_kill()`的定义在kernel/signal.c文件中，事实也的确如此，接下来进入下面的方法。

[-> signal.c]

	SYSCALL_DEFINE2(kill, pid_t, pid, int, sig)
	{
		struct siginfo info;
		info.si_signo = sig;
		info.si_errno = 0;
		info.si_code = SI_USER;
		info.si_pid = task_tgid_vnr(current);
		info.si_uid = from_kuid_munged(current_user_ns(), current_uid());
		return kill_something_info(sig, &info, pid); //【见流程4】
	}

`SYSCALL_DEFINE2`是系统调用的宏定义，经过层层展开，等价于`asmlinkage long sys_kill(int pid, int sig)`。关于宏展开细节就不多说了，就说一点`SYSCALL_DEFINE2`中的2是指sys_kill方法有两个参数。

关于系统调用流程比较复杂，涉及汇编语言，可以不用知道整个过程，**只需要知道一点：** 用户空间的`kill()`最终调用到内核空间signal.c的`kill_something_info()`方法就可以。

### 4. kill_something_info

[-> signal.c]

	static int kill_something_info(int sig, struct siginfo *info, pid_t pid)
	{
		int ret;
		if (pid > 0) {
			rcu_read_lock();
			//当pid>0时，则发送给pid所对应的进程【见流程5】
			ret = kill_pid_info(sig, info, find_vpid(pid));
			rcu_read_unlock();
			return ret;
		}
		read_lock(&tasklist_lock);
		if (pid != -1) {
			//当pid=0时，则发送给当前进程组；
			//当pid<-1时，则发送给-pid所对应的进程。
			ret = __kill_pgrp_info(sig, info,
					pid ? find_vpid(-pid) : task_pgrp(current));
		} else {
			//当pid=-1时，则发送给所有进程
			int retval = 0, count = 0;
			struct task_struct * p;
			for_each_process(p) {
				if (task_pid_vnr(p) > 1 &&
						!same_thread_group(p, current)) {
					int err = group_send_sig_info(sig, info, p);
					++count;
					if (err != -EPERM)
						retval = err;
				}
			}
			ret = count ? retval : -ESRCH;
		}
		read_unlock(&tasklist_lock);
		return ret;
	}

功能：

- 当pid>0 时，则发送给pid所对应的进程；
- 当pid=0 时，则发送给当前进程组；
- 当pid=-1时，则发送给所有进程；
- 当pid<-1时，则发送给-pid所对应的进程。

### 5. kill_pid_info

[-> signal.c]

	int kill_pid_info(int sig, struct siginfo *info, struct pid *pid)
	{
		int error = -ESRCH;
		struct task_struct *p;
		rcu_read_lock();
	retry:
		//根据pid查询到task结构体
		p = pid_task(pid, PIDTYPE_PID);
		if (p) {
			error = group_send_sig_info(sig, info, p); //【见流程6】
			if (unlikely(error == -ESRCH))
				goto retry;
		}
		rcu_read_unlock();
		return error;
	}


### 6. group_send_sig_info

[-> signal.c]

	int group_send_sig_info(int sig, struct siginfo *info, struct task_struct *p)
	{
		int ret;
		rcu_read_lock();
		//检查sig是否合法以及隐私等权限问题
		ret = check_kill_permission(sig, info, p);
		rcu_read_unlock();
		if (!ret && sig)
			ret = do_send_sig_info(sig, info, p, true); //【见流程7】
		return ret;
	}

### 7. do_send_sig_info

[-> signal.c]

	int do_send_sig_info(int sig, struct siginfo *info, struct task_struct *p,
				bool group)
	{
		unsigned long flags;
		int ret = -ESRCH;
		if (lock_task_sighand(p, &flags)) {
			ret = send_signal(sig, info, p, group); //【见流程8】
			unlock_task_sighand(p, &flags);
		}
		return ret;
	}

### 8. send_signal

[-> signal.c]

	static int send_signal(int sig, struct siginfo *info, struct task_struct *t,
				int group)
	{
		int from_ancestor_ns = 0;
	#ifdef CONFIG_PID_NS
		from_ancestor_ns = si_fromuser(info) &&
				   !task_pid_nr_ns(current, task_active_pid_ns(t));
	#endif
		return __send_signal(sig, info, t, group, from_ancestor_ns); //【见流程9】
	}

### 9. __send_signal

[-> signal.c]

	static int __send_signal(int sig, struct siginfo *info, struct task_struct *t,
				int group, int from_ancestor_ns)
	{
		struct sigpending *pending;
		struct sigqueue *q;
		int override_rlimit;
		int ret = 0, result;
		assert_spin_locked(&t->sighand->siglock);
		result = TRACE_SIGNAL_IGNORED;
		if (!prepare_signal(sig, t,
				from_ancestor_ns || (info == SEND_SIG_FORCED)))
			goto ret;
		pending = group ? &t->signal->shared_pending : &t->pending;
		
		result = TRACE_SIGNAL_ALREADY_PENDING;
		if (legacy_queue(pending, sig))
			goto ret;
		result = TRACE_SIGNAL_DELIVERED;
		
		if (info == SEND_SIG_FORCED)
			goto out_set;
		
		if (sig < SIGRTMIN)
			override_rlimit = (is_si_special(info) || info->si_code >= 0);
		else
			override_rlimit = 0;
		q = __sigqueue_alloc(sig, t, GFP_ATOMIC | __GFP_NOTRACK_FALSE_POSITIVE,
			override_rlimit);
		if (q) {
			list_add_tail(&q->list, &pending->list);
			switch ((unsigned long) info) {
			case (unsigned long) SEND_SIG_NOINFO:
				q->info.si_signo = sig;
				q->info.si_errno = 0;
				q->info.si_code = SI_USER;
				q->info.si_pid = task_tgid_nr_ns(current,
								task_active_pid_ns(t));
				q->info.si_uid = from_kuid_munged(current_user_ns(), current_uid());
				break;
			case (unsigned long) SEND_SIG_PRIV:
				q->info.si_signo = sig;
				q->info.si_errno = 0;
				q->info.si_code = SI_KERNEL;
				q->info.si_pid = 0;
				q->info.si_uid = 0;
				break;
			default:
				copy_siginfo(&q->info, info);
				if (from_ancestor_ns)
					q->info.si_pid = 0;
				break;
			}
			userns_fixup_signal_uid(&q->info, t);
		} else if (!is_si_special(info)) {
			if (sig >= SIGRTMIN && info->si_code != SI_USER) {
				result = TRACE_SIGNAL_OVERFLOW_FAIL;
				ret = -EAGAIN;
				goto ret;
			} else {
				result = TRACE_SIGNAL_LOSE_INFO;
			}
		}
	out_set:
		//将信号sig传递给正处于监听状态的signalfd
		signalfd_notify(t, sig);
		//向信号集中加入信号sig
		sigaddset(&pending->signal, sig);
		//完成信号过程，【见流程10】
		complete_signal(sig, t, group);
	ret:
		trace_signal_generate(sig, info, t, group, result);
		return ret;
	}

### 10. complete_signal

[-> signal.c]

	static void complete_signal(int sig, struct task_struct *p, int group)
	{
		struct signal_struct *signal = p->signal;
		struct task_struct *t;

		//查找能处理该信号的线程
		if (wants_signal(sig, p))
			t = p;
		else if (!group || thread_group_empty(p))
			return;
		else {
			// 递归查找适合的线程
			t = signal->curr_target;
			while (!wants_signal(sig, t)) {
				t = next_thread(t);
				if (t == signal->curr_target)
					return;
			}
			signal->curr_target = t;
		}

		//找到一个能被杀掉的线程，如果这个信号是fatal，则立刻干掉整个线程组
		if (sig_fatal(p, sig) &&
		    !(signal->flags & (SIGNAL_UNKILLABLE | SIGNAL_GROUP_EXIT)) &&
		    !sigismember(&t->real_blocked, sig) &&
		    (sig == SIGKILL || !t->ptrace)) {
			//信号将终结整个线程组
			if (!sig_kernel_coredump(sig)) {
				signal->flags = SIGNAL_GROUP_EXIT;
				signal->group_exit_code = sig;
				signal->group_stop_count = 0;
				t = p;
				//遍历整个线程组，全部结束
				do {
					task_clear_jobctl_pending(t, JOBCTL_PENDING_MASK);
					//向信号集中加入信号SIGKILL
					sigaddset(&t->pending.signal, SIGKILL);
					signal_wake_up(t, 1);
				} while_each_thread(p, t);
				return;
			}
		}

		//该信号处于共享队列里(即将要处理的)。唤醒已选中的目标线程，并将该信号移出队列。
		signal_wake_up(t, sig == SIGKILL);
		return;
	}


### 小结


到此Signal信号已发送给目标线程，先用一副图来小结一下上述流程：

![process-kill](/images/android-process/process-kill.jpg)

图中分为用户空间(User Space)和内核空间（Kernel Space)。从用户空间进入内核空间需要向内核发出syscall(系统调用)，系统调用时操作系统提供的服务，用户空间的程序通过各种系统调用来引用内核空间相应的各种服务，系统调用是为了让用户空间的程序陷入内核，该陷入动作是由软中断来完成的。用户态的进程进行系统调用后，CPU切换到内核态，开始执行内核函数。`unistd.h`文件中定义了所有的系统中断号，用户态程序通过不同的系统调用号来调用不同的内核服务，通过系统调用号从系统调用表中查看到相应的内核服务。

讲完了系统发送过程，接下来进入目标线程来处理相应的信号。

## 信号(Signal)处理

在Process.java中定义了如下3个信号：

    public static final int SIGNAL_QUIT = 3;  //用于输出线程trace
    public static final int SIGNAL_KILL = 9;  //用于杀进程/线程
    public static final int SIGNAL_USR1 = 10; //用于强制执行GC

**实例：**

`kill -3 <pid>`：该pid所在进程的SignalCatcher接收到信号SIGNAL_QUIT，则挂起进程中的所有线程并dump所有线程的状态。
`kill -10 <pid>`： 该pid所在进程的SignalCatcher接收到信号SIGNAL_USR1，则触发进程强制执行GC操作。

信号SIGNAL_QUIT、SIGNAL_USR1的发送流程由上一节已介绍，对于信号捕获则是由SignalCatcher线程来捕获完成相应操作的。在上一篇文章[理解Android进程创建流程](http://gityuan.com/2016/03/26/app-process-create/#nativeforkandspecialize)的【Step 6-2-1】中的`ForkAndSpecializeCommon`有涉及到signal相关的操作，接下来说说应用进程在创建过程为信号处理做了哪些准备呢？

### 1. ForkAndSpecializeCommon

[-> com_android_internal_os_Zygote.cpp]

	static pid_t ForkAndSpecializeCommon(...) {
	    //设置子进程的signal信号处理函数 //【见流程2】
	    SetSigChldHandler(); 
	    pid_t pid = fork(); //fork子进程
	    if (pid == 0) {
	        //设置子进程的signal信号处理函数为默认函数 //【见流程3】
	        UnsetSigChldHandler(); 
	        //进入虚拟机，执行相关操作【见流程4】
	        env->CallStaticVoidMethod(gZygoteClass, gCallPostForkChildHooks, debug_flags,
	                              is_system_server ? NULL : instructionSet);
	        ...
	    } else if (pid > 0) {
	        //进入父进程Zygote
	    }
	    return pid;
	}

### 2. SetSigChldHandler

[-> com_android_internal_os_Zygote.cpp]

	static void SetSigChldHandler() {
	  struct sigaction sa;
	  memset(&sa, 0, sizeof(sa)); //对sa地址内容进行清零操作
	  sa.sa_handler = SigChldHandler;
	  //安装信号
	  int err = sigaction(SIGCHLD, &sa, NULL);
	  if (err < 0) {
	    ALOGW("Error setting SIGCHLD handler: %s", strerror(errno));
	  }
	}

进程处理某个信号前，需要先在进程中安装此信号，安装过程主要是建立信号值和进程对相应信息值的动作。此处
SIGCHLD=17，代表子进程退出时所相应的操作动作为`SigChldHandler`。


### 3. UnsetSigChldHandler

[-> com_android_internal_os_Zygote.cpp]

	static void UnsetSigChldHandler() {
	  struct sigaction sa;
	  memset(&sa, 0, sizeof(sa));
	  sa.sa_handler = SIG_DFL;
	  //在Zygote子进程中，设置信号SIGCHLD的处理器恢复为默认行为
	  int err = sigaction(SIGCHLD, &sa, NULL);
	  if (err < 0) {
	    ALOGW("Error unsetting SIGCHLD handler: %s", strerror(errno));
	  }
	}


### 4. DidForkFromZygote

在文章[理解Android进程创建流程](http://gityuan.com/2016/03/26/app-process-create/#nativeforkandspecialize)已详细地说明了此过程，并在小节【Step 6-2-2-1-1-1】中说过后续会单独讲讲信号处理过程，那本文便是补充这个过程

[-> Runtime.cc]

	void Runtime::DidForkFromZygote(JNIEnv* env, NativeBridgeAction action, const char* isa) {
	    ...
	    //创建Java堆处理的线程池
	    heap_->CreateThreadPool();
	    //重置gc性能数据，以保证进程在创建之前的GCs不会计算到当前app上。
	    heap_->ResetGcPerformanceInfo();

	    ...
	    //启动信号捕获 【见流程5】
	    StartSignalCatcher();
	    //启动JDWP线程，当命令debuger的flags指定"suspend=y"时，则暂停runtime
	    Dbg::StartJdwp();
	}

### 5. StartSignalCatcher

[-> Runtime.cc]

	void Runtime::StartSignalCatcher() {
	  if (!is_zygote_) {
	    //【见流程6】
	    signal_catcher_ = new SignalCatcher(stack_trace_file_);
	  }
	}

对于非Zygote进程才会启动SignalCatcher线程。

### 6. SignalCatcher

[-> signal_catcher.cc]

创建SignalCatcher对象

	SignalCatcher::SignalCatcher(const std::string& stack_trace_file)
	    : stack_trace_file_(stack_trace_file),
	      lock_("SignalCatcher lock"),
	      cond_("SignalCatcher::cond_", lock_),
	      thread_(nullptr) {
	  SetHaltFlag(false);
	  //通过pthread_create创建一个线程，线程名为"signal catcher thread"; 该线程的启动将关联到Android runtime。
	  CHECK_PTHREAD_CALL(pthread_create, (&pthread_, nullptr, &Run, this), "signal catcher thread");
	  Thread* self = Thread::Current();
	  MutexLock mu(self, lock_);
	  while (thread_ == nullptr) {
	    cond_.Wait(self);
	  }
	}

SignalCatcher是一个守护线程，用于捕获SIGQUIT、SIGUSR1信号，并采取相应的行为。

Android系统中，由Zygote孵化而来的子进程，包含system_server进程和各种App进程都存在一个SignalCatcher线程，但是Zygote进程本身是没有这个线程的。

![signal_catcher_thread](/images/android-process/signal_catcher_thread.png)

上图是systemui所在进程的部分线程信息，可以看到其中有一个SignalCatcher线程，该线程具体是如何处理信号的呢，请往下继续看。



### 7. Run

[-> signal_catcher.cc]

	void* SignalCatcher::Run(void* arg) {
	  SignalCatcher* signal_catcher = reinterpret_cast<SignalCatcher*>(arg);
	  CHECK(signal_catcher != nullptr);
	  Runtime* runtime = Runtime::Current();
	  //检查当前线程是否依附到Android Runtime
	  CHECK(runtime->AttachCurrentThread("Signal Catcher", true, runtime->GetSystemThreadGroup(), !runtime->IsAotCompiler()));

	  Thread* self = Thread::Current();
	  DCHECK_NE(self->GetState(), kRunnable);
	  {
	    MutexLock mu(self, signal_catcher->lock_);
	    signal_catcher->thread_ = self;
	    signal_catcher->cond_.Broadcast(self);
	  }

	  SignalSet signals;
	  signals.Add(SIGQUIT); //添加对信号SIGQUIT的处理
	  signals.Add(SIGUSR1); //添加对信号SIGUSR1的处理
	  while (true) {
	    //等待信号到来，这是个阻塞操作
	    int signal_number = signal_catcher->WaitForSignal(self, signals);
	    //当信号捕获需要停止时，则取消当前线程跟Android Runtime的关联。
	    if (signal_catcher->ShouldHalt()) {
	      runtime->DetachCurrentThread();
	      return nullptr;
	    }
	    switch (signal_number) {
	    case SIGQUIT:
	      signal_catcher->HandleSigQuit(); //输出线程trace
	      break;
	    case SIGUSR1:
	      signal_catcher->HandleSigUsr1(); //强制GC
	      break;
	    default:
	      LOG(ERROR) << "Unexpected signal %d" << signal_number;
	      break;
	    }
	  }
	}

这个方法中，只有信号SIGQUIT和SIGUSR1的处理过程，并没有信号SIGKILL的处理过程，这是因为SIGKILL是不能被忽略同时也不能被捕获，所以不会出现在Signal Catcher线程。

### 小结

调用流程：

	ForkAndSpecializeCommon
		SetSigChldHandler
		UnsetSigChldHandler
		DidForkFromZygote
			StartSignalCatcher
				SignalCatcher

后续再补图。

另外，进程被杀后，对于binder的C/S架构，Binder的Server端挂了，Client会收到死亡通告，还会执行各种清理工作。下一篇文章会进一步说明。