---
layout: post
title:  "Binder系列0—Binder Driver初探"
date:   2015-11-01 20:11:50
categories: android binder
excerpt:  Binder系列0—Binder Driver初探
---

* content
{:toc}


---
> 基于Android 6.0的源码剖析，在讲解Binder原理之前，先从kernel的角度来讲解Binder Driver.


## 一、概述

### 1.1 源码路径

Binder Driver的源码路径

	/kernel/drivers/android/binder.c
	/kernel/include/uapi/linux/android/binder.h

Binder驱动是Android专用的，但底层的驱动架构与Linux驱动一样。binder驱动在以misc设备进行注册，作为虚拟设备，没有直接操作硬件，只是对设备内存的处理。主要是驱动设备的初始化(binder_init)，打开
(binder_open)，映射(binder_mmap)，数据操作(binder_ioctl)。

![binder_driver](/images/binder/binder_dev/binder_driver.png)


### 1.2 系统调用

用户态的程序调用kernel驱动，需要陷入内核态，进行系统调用(syscall)，比如打开Binder驱动方法的调用链为： open-> __open() -> binder_open()。 open()为用户空间的方法，__open()便是系统调用中相应的处理方法，通过查找，对应调用到内核binder驱动的binder_open()方法，至于其他的从用户态陷入内核态的流程也基本一致。 


![binder_syscall](/images/binder/binder_dev/binder_syscall.png)

简单说，当用户空间调用open()方法，最终会调用binder驱动的binder_open()方法；mmap(),ioctl()方法也是同理。

## 二、 Binder核心方法

### 2.1 binder_init

主要工作是为了注册misc设备

	static int __init binder_init(void)
	{
		int ret;
		binder_deferred_workqueue = create_singlethread_workqueue("binder"); //创建名为binder的workqueue
		if (!binder_deferred_workqueue)
			return -ENOMEM;
	
		binder_debugfs_dir_entry_root = debugfs_create_dir("binder", NULL); //创建debugfs目录
		if (binder_debugfs_dir_entry_root)
			binder_debugfs_dir_entry_proc = debugfs_create_dir("proc",
							 binder_debugfs_dir_entry_root);
		ret = misc_register(&binder_miscdev);    // 注册misc设备
		if (binder_debugfs_dir_entry_root) {
			... //在debugfs文件系统中创建一系列的文件
		}
		return ret;
	}


`debugfs_create_dir`是指在debugfs文件系统中创建一个目录，返回值是指向dentry的指针。当kernel中禁用debugfs的话，返回值是-%ENODEV。默认是禁用的。如果需要打开，在目录`/kernel/arch/arm64/configs/`下找到目标defconfig文件中添加一行`CONFIG_DEBUG_FS=y`，再重新编译版本，即可打开debug_fs。

**misc_register**

注册misc设备，`miscdevice`结构体，便是前面注册misc设备时传递进去的参数

	static struct miscdevice binder_miscdev = {
		.minor = MISC_DYNAMIC_MINOR, //次设备号 动态分配
		.name = "binder",     //设备名
		.fops = &binder_fops  //设备的文件操作结构，这是file_operations结构
	};

`file_operations`结构体,指定相应文件操作的方法

	static const struct file_operations binder_fops = {
		.owner = THIS_MODULE,
		.poll = binder_poll,
		.unlocked_ioctl = binder_ioctl,
		.compat_ioctl = binder_ioctl,
		.mmap = binder_mmap,
		.open = binder_open,
		.flush = binder_flush,
		.release = binder_release,
	};


### 2.2 binder_open

打开binder驱动设备

	static int binder_open(struct inode *nodp, struct file *filp)
	{
		struct binder_proc *proc; // binder进程 【见附录】
	
		proc = kzalloc(sizeof(*proc), GFP_KERNEL); // 为binder_proc结构体在分配kernel内存空间
		if (proc == NULL)
			return -ENOMEM;
		get_task_struct(current);
		proc->tsk = current;   //将当前线程的task保存到binder进程的tsk
		INIT_LIST_HEAD(&proc->todo);
		init_waitqueue_head(&proc->wait); //初始化等待队列
		proc->default_priority = task_nice(current);  //将当前进程的nice值转换为进程优先级
	
		binder_lock(__func__);   //同步锁，因为binder支持多线程访问
		binder_stats_created(BINDER_STAT_PROC); //BINDER_PROC对象创建数加1
		hlist_add_head(&proc->proc_node, &binder_procs);
		proc->pid = current->group_leader->pid;
		INIT_LIST_HEAD(&proc->delivered_death);
		filp->private_data = proc;       //file文件指针的private_data变量指向binder_proc数据
		binder_unlock(__func__); //释放同步锁

		return 0;
	}

**binder_open**: 过程中的filp->private_data = proc 该语句很重要，将通过filp可获取相应的binder_proc保存到filp指针的private_data成员变量，那么之后通过filp可获取相应的binder_proc，而binder_proc里管理IPC所需的各种信息，拥有其他结构体的跟结构体。



### 2.3 binder_mmap

> binder_mmap(文件描述符，用户虚拟内存空间)

主要功能：首先在内核虚拟地址空间，申请一块与用户虚拟内存相同大小的内存；然后再申请1个page大小的物理内存，再将同一块物理内存分别映射到内核虚拟地址空间和用户虚拟内存空间，从而实现了用户空间的Buffer和内核空间的Buffer同步操作的功能。


	static int binder_mmap(struct file *filp, struct vm_area_struct *vma)
	{
		int ret;
		struct vm_struct *area; //虚拟内核空间
		struct binder_proc *proc = filp->private_data; 
		const char *failure_string;
		struct binder_buffer *buffer;  //【见附录】
	
		if (proc->tsk != current)
			return -EINVAL;
	
		if ((vma->vm_end - vma->vm_start) > SZ_4M)
			vma->vm_end = vma->vm_start + SZ_4M;  //保证映射内存大小不超过4M
	
		mutex_lock(&binder_mmap_lock);  //同步锁
		//分配一个连续的内核虚拟空间，与进程虚拟空间大小一致
		area = get_vm_area(vma->vm_end - vma->vm_start, VM_IOREMAP); 
		if (area == NULL) {
			ret = -ENOMEM;
			failure_string = "get_vm_area";
			goto err_get_vm_area_failed;
		}
		proc->buffer = area->addr;
		proc->user_buffer_offset = vma->vm_start - (uintptr_t)proc->buffer; 
		mutex_unlock(&binder_mmap_lock); //释放锁
	    
		...
		proc->pages = kzalloc(sizeof(proc->pages[0]) * ((vma->vm_end - vma->vm_start) / PAGE_SIZE), GFP_KERNEL);//分配一个虚拟用户空间的页数大小的内存给pages指针
		if (proc->pages == NULL) {
			ret = -ENOMEM;
			failure_string = "alloc page array";
			goto err_alloc_pages_failed;
		}
		proc->buffer_size = vma->vm_end - vma->vm_start;
	
		vma->vm_ops = &binder_vm_ops;
		vma->vm_private_data = proc;
	 
		//分配物理页面，同时映射到内核空间和进程空间 【见】
		if (binder_update_page_range(proc, 1, proc->buffer, proc->buffer + PAGE_SIZE, vma)) {
			ret = -ENOMEM;
			failure_string = "alloc small buf";
			goto err_alloc_small_buf_failed;
		}
		buffer = proc->buffer;
		INIT_LIST_HEAD(&proc->buffers);
		list_add(&buffer->entry, &proc->buffers);
		buffer->free = 1;
		binder_insert_free_buffer(proc, buffer);
		proc->free_async_space = proc->buffer_size / 2;
		barrier();
		proc->files = get_files_struct(current);
		proc->vma = vma;
		proc->vma_vm_mm = vma->vm_mm;
		return 0;
	
		...// 错误flags跳转处，free释放内存之类的操作
		return ret;
	}

binder_mmap的主要工作可用下面的图来表达：

![binder_mmap](/images/binder/binder_dev/binder_mmap.png)

`binder_update_page_range`主要完成工作：分配物理空间，将物理空间映射到内核空间，将物理空间映射到进程空间。  

代码如下：

	static int binder_update_page_range(struct binder_proc *proc, int allocate,
					    void *start, void *end,  struct vm_area_struct *vma)	
	{
		...
		for (page_addr = start; page_addr < end; page_addr += PAGE_SIZE) {
			int ret;
			struct page **page_array_ptr;
			page = &proc->pages[(page_addr - proc->buffer) / PAGE_SIZE];
			BUG_ON(*page);
			*page = alloc_page(GFP_KERNEL | __GFP_HIGHMEM | __GFP_ZERO);  //分配物理内存
			if (*page == NULL) {
				goto err_alloc_page_failed;
			}
			tmp_area.addr = page_addr;
			tmp_area.size = PAGE_SIZE + PAGE_SIZE;
			page_array_ptr = page;
			ret = map_vm_area(&tmp_area, PAGE_KERNEL, &page_array_ptr); //物理空间映射到虚拟内核空间
			if (ret) {
				goto err_map_kernel_failed;
			}
			user_page_addr = (uintptr_t)page_addr + proc->user_buffer_offset;
			ret = vm_insert_page(vma, user_page_addr, page[0]); //物理空间映射到虚拟进程空间
			if (ret) {
				goto err_vm_insert_page_failed;
			}
		}
		...
	}



### 2.4 binder_ioctl

binder_ioctl()函数负责在两个进程间收发IPC数据和IPC reply数据。

> ioctl(文件描述符，ioctl命令，数据类型)

(1) 文件描述符，是通过open()方法打开Binder Driver后返回值；

(2) ioctl命令和数据类型是一体的，不同的命令对应不同的数据类型

|ioctl命令|数据类型|操作|
|---|---|---|
|BINDER_WRITE_READ|struct binder_write_read|收发Binder IPC数据|
|BINDER_SET_MAX_THREADS|__u32|设置Binder线程最大个数|
|BINDER_SET_CONTEXT_MGR|__s32|设置Service Manager节点|
|BINDER_THREAD_EXIT|__s32|释放Binder线程
|BINDER_VERSION|struct binder_version|获取Binder版本信息|
|BINDER_SET_IDLE_TIMEOUT|__s64|没有使用|
|BINDER_SET_IDLE_PRIORITY|__s32|没有使用|

上述命令中`BINDER_WRITE_READ`命令使用率最为频繁，也是ioctl的核心命令。

**源码**  

	static long binder_ioctl(struct file *filp, unsigned int cmd, unsigned long arg)
	{
		int ret;
		struct binder_proc *proc = filp->private_data;
		struct binder_thread *thread;  // binder线程
		unsigned int size = _IOC_SIZE(cmd);
		void __user *ubuf = (void __user *)arg;
		//进入休眠状态，直到中断唤醒
		ret = wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);
		if (ret)
			goto err_unlocked;
	
		binder_lock(__func__);
		thread = binder_get_thread(proc); //【获取binder_thread 见小节4.1】
		if (thread == NULL) {
			ret = -ENOMEM;
			goto err;
		}
	
		switch (cmd) {
		case BINDER_WRITE_READ:  //进行binder的读写操作
			ret = binder_ioctl_write_read(filp, cmd, arg, thread); //读写操作【见小节4.2】
			if (ret)
				goto err;
			break;
		case BINDER_SET_MAX_THREADS: //设置binder最大支持的线程数
			if (copy_from_user(&proc->max_threads, ubuf, sizeof(proc->max_threads))) {
				ret = -EINVAL;
				goto err;
			}
			break;
		case BINDER_SET_CONTEXT_MGR: //成为binder的上下文管理者，也就是ServiceManager成为守护进程
			ret = binder_ioctl_set_ctx_mgr(filp);
			if (ret)
				goto err;
			break;
		case BINDER_THREAD_EXIT:   //当binder线程退出，释放binder线程
			binder_free_thread(proc, thread);
			thread = NULL;
			break;
		case BINDER_VERSION: {  //获取binder的版本号
			struct binder_version __user *ver = ubuf;
	
			if (size != sizeof(struct binder_version)) {
				ret = -EINVAL;
				goto err;
			}
			if (put_user(BINDER_CURRENT_PROTOCOL_VERSION,
				     &ver->protocol_version)) {
				ret = -EINVAL;
				goto err;
			}
			break;
		}
		default:
			ret = -EINVAL;
			goto err;
		}
		ret = 0;
	err:
		if (thread)
			thread->looper &= ~BINDER_LOOPER_STATE_NEED_RETURN;
		binder_unlock(__func__);
		wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);
			
	err_unlocked:
		trace_binder_ioctl_done(ret);
		return ret;
	}


**binder_get_thread()**

从binder_proc中查找binder_thread,如果存在则直接返回，如果不存在则新建一个，并添加到当前的proc

	static struct binder_thread *binder_get_thread(struct binder_proc *proc)
	{
		struct binder_thread *thread = NULL;
		struct rb_node *parent = NULL;
		struct rb_node **p = &proc->threads.rb_node;
		while (*p) {  //根据当前进程的pid，从binder_proc中查找相应的binder_thread
			parent = *p;
			thread = rb_entry(parent, struct binder_thread, rb_node);
			if (current->pid < thread->pid)
				p = &(*p)->rb_left;
			else if (current->pid > thread->pid)
				p = &(*p)->rb_right;
			else
				break;
		}
		if (*p == NULL) {
			thread = kzalloc(sizeof(*thread), GFP_KERNEL); //新建binder_thread结构体
			if (thread == NULL)
				return NULL;
			binder_stats_created(BINDER_STAT_THREAD);
			thread->proc = proc;
			thread->pid = current->pid;  //保存当前进程(线程)的pid
			init_waitqueue_head(&thread->wait);
			INIT_LIST_HEAD(&thread->todo);
			rb_link_node(&thread->rb_node, parent, p);
			rb_insert_color(&thread->rb_node, &proc->threads);
			thread->looper |= BINDER_LOOPER_STATE_NEED_RETURN;
			thread->return_error = BR_OK;
			thread->return_error2 = BR_OK;
		}
		return thread;
	}

**binder_ioctl_write_read()**

对于ioctl()方法中，传递进来的命令是cmd = `BINDER_WRITE_READ`时执行该方法，arg是一个`binder_write_read`结构体

	static int binder_ioctl_write_read(struct file *filp,
					unsigned int cmd, unsigned long arg,
					struct binder_thread *thread)
	{
		int ret = 0;
		struct binder_proc *proc = filp->private_data;
		unsigned int size = _IOC_SIZE(cmd);
		void __user *ubuf = (void __user *)arg;
		struct binder_write_read bwr;
	
		if (size != sizeof(struct binder_write_read)) {
			ret = -EINVAL;
			goto out;
		}
		if (copy_from_user(&bwr, ubuf, sizeof(bwr))) { //把用户空间数据ubuf拷贝到bwr
			ret = -EFAULT;
			goto out;
		}
	
		if (bwr.write_size > 0) {
			//当写缓存中有数据，则执行binder写操作【见4.3】
			ret = binder_thread_write(proc, thread,
						  bwr.write_buffer, bwr.write_size, &bwr.write_consumed); 
			trace_binder_write_done(ret); 
			if (ret < 0) { //当写失败，再将bwr数据写回用户空间，并返回
				bwr.read_consumed = 0;
				if (copy_to_user(ubuf, &bwr, sizeof(bwr))) 
					ret = -EFAULT;
				goto out;
			}
		}
		if (bwr.read_size > 0) {
			//当读缓存中有数据，则执行binder读操作, 【见4.4】
			ret = binder_thread_read(proc, thread, 
						  bwr.read_buffer, bwr.read_size, &bwr.read_consumed,
						  filp->f_flags & O_NONBLOCK); 
			trace_binder_read_done(ret);
			if (!list_empty(&proc->todo))
				wake_up_interruptible(&proc->wait); //进入休眠，等待中断唤醒
			if (ret < 0) { //当读失败，再将bwr数据写回用户空间，并返回
				if (copy_to_user(ubuf, &bwr, sizeof(bwr))) 
					ret = -EFAULT;
				goto out;
			}
		}

		if (copy_to_user(ubuf, &bwr, sizeof(bwr))) { //将内核数据bwr拷贝到用户空间ubuf
			ret = -EFAULT;
			goto out;
		}
	out:
		return ret;
	}

对于`binder_ioctl_write_read`的流程图，如下：

![binder_write_read](/images/binder/binder_dev/binder_write_read.png)

流程：

- 首先把用户空间数据拷贝到内核空间bwr；
- 当bwr写缓存中有数据，则执行binder写操作；当写失败，再将bwr数据写回用户空间，并退出；
- 当bwr读缓存中有数据，则执行binder读操作；当读失败，再将bwr数据写回用户空间，并退出；
- 最后把内核数据bwr拷贝到用户空间。

这里涉及两个核心方法`binder_thread_write()`和`binder_thread_write()`方法，在Binder系列的后续文章[Binder Driver再探](http://www.yuanhh.com/2015/11/02/binder-driver-2/)中详细介绍。


## 三、 结构体附录

下面列举Binder相关的核心结构体，并解释其中的比较重要的参数。

### 3.1 binder_proc

binder_proc结构体：用于管理IPC所需的各种信息，拥有其他结构体的跟结构体。


|类型|成员变量|解释|
|---|---|---|
|struct hlist_node| proc_node|进程节点|
|struct rb_root| threads|保存binder_thread结构体的红黑树的跟节点
|struct rb_root| nodes|保存binder_node结构体的红黑树的根节点
|struct rb_root| refs_by_desc|保存binder_ref实体的引用(以handle为key)
|struct rb_root| refs_by_node|binder实体的引用（以ptr为key）
|int| pid|创建binder_proc结构体的进程id
|struct vm_area_struct *|vma|指向进程虚拟地址空间的指针
|struct mm_struct *|vma_vm_mm;
|struct task_struct *|tsk|创建binder_proc结构体的进程结构体
|struct files_struct *|files|
||struct hlist_node| deferred_work_node|
|int| deferred_work|
|void *|buffer|接收IPC数据的内核地址空间指针(binder_buffer)
|ptrdiff_t| user_buffer_offset|内核空间与用户空间的地址偏移量
|struct| list_head buffers|
|struct| rb_root free_buffers|空闲buffer
|struct| rb_root allocated_buffers|已分配buffer
|size_t| free_async_space|异步的可用空闲空间
|struct page **|pages|描述物理内存页的数据结构
|size_t| buffer_size|接收IPC数据的内核地址空间大小
|uint32_t| buffer_free|
|struct list_head| todo|进程将要做的事
|wait_queue_head_t| wait|等待队列
|struct binder_stats| stats|
|struct list_head| delivered_death|
|int| max_threads|最大线程数
|int| requested_threads|请求的线程数
|int| requested_threads_started|已启动的请求线程数
|int| ready_threads|
|long| default_priority|默认优先级
|struct dentry *|debugfs_entry|



- 其中rb_root是一种红黑树结构，红黑树作为自平衡的二叉树树便于查询和维护。
	- `refs_by_desc` 记录的是`binder_transaction_data`结构体中target的 `handle`;
	- `refs_by_node` 记录的是`binder_transaction_data`结构体中target的 `ptr`;
- `user_buffer_offset`是虚拟进程地址与虚拟内核地址的差值，也就是说同一物理地址，当内核地址为kernel_addr，则进程地址为proc_addr = kernel_addr + user_buffer_offset。

### 3.2 binder_thread

binder_thread结构体代表当前binder操作所在的线程

|类型|成员变量|解释|
|---|---|---|
|struct binder_proc *|proc|线程所属的进程|
|struct rb_node|rb_node||
|int|pid|线程pid|
|int|looper|looper的状态|
|struct binder_transaction *|transaction_stack|正在处理的事务|
|struct list_head|todo|将要处理的数据列表|
|uint32_t|return_error|write失败后，返回的错误码|
|uint32_t|return_error2|write失败后，返回的错误码|
|wait_queue_head_t|wait|等待队列的队头|
|struct binder_stats|stats|binder线程的统计信息|

looper的状态如下：

	enum {
		BINDER_LOOPER_STATE_REGISTERED  = 0x01, // 已注册
		BINDER_LOOPER_STATE_ENTERED     = 0x02, // 已进入
		BINDER_LOOPER_STATE_EXITED      = 0x04, // 已退出
		BINDER_LOOPER_STATE_INVALID     = 0x08, // 非法
		BINDER_LOOPER_STATE_WAITING     = 0x10, // 等待中
		BINDER_LOOPER_STATE_NEED_RETURN = 0x20, // 需要返回
	};

### 3.3 binder_write_read
用户空间程序和Binder驱动程序交互基本都是通过BINDER_WRITE_READ命令，来进行数据的读写操作。

|类型|成员变量|解释|
|---|---|---|
|binder_size_t|rite_size|write_buffer的字节数
|binder_size_t|write_consumed|已处理的write字节数
|binder_uintptr_t|write_buffer|指向write数据区
|binder_size_t|read_size|read_buffer的字节数
|binder_size_t|read_consumed|已处理的read字节数
|binder_uintptr_t|read_buffer|指向read数据区

- write_buffer变量：用于发送IPC(或IPC reply)数据，即传递经由Binder Driver的数据时使用。
- read_buffer 变量：用于接收来自Binder Driver的数据，即Binder Driver在接收IPC(或IPC reply)数据后，保存到read_buffer，再传递到用户空间；

write_buffer和read_buffer都是包含Binder协议命令和binder_transaction_data结构体。

- copy_from_user()将用户空间IPC数据拷贝到内核态binder_write_read结构体；
- copy_to_user()将用内核态binder_write_read结构体数据拷贝到用户空间；

### 3.4 binder_transaction_data

当BINDER_WRITE_READ命令的目标是本地Binder node时，target使用ptr，否则使用handle。只有当这是Binder node时，cookie才有意义，表示附加数据，由进程自己解释。

	struct binder_transaction_data {
		union {
			__u32	handle;	   //binder实体的引用
			binder_uintptr_t ptr;	 //Binder实体在当前进程的地址
		} target;  //RPC目标
		binder_uintptr_t	cookie;	
		__u32		code;		//RPC代码
	
		__u32	        flags;
		pid_t		sender_pid;  //发送端进程的pid
		uid_t		sender_euid; //发送端进程的euid
		binder_size_t	data_size;	
		binder_size_t	offsets_size;	
	
		union {
			struct {
				binder_uintptr_t	buffer;
				binder_uintptr_t	offsets;
			} ptr;
			__u8	buf[8];
		} data;   //RPC数据
	};


### 3.5 binder_transaction

|类型|成员变量|解释|
|---|---|---|
|int |debug_id|
|struct binder_work |work|
|struct binder_thread *|from|发送端线程
|struct binder_transaction *|from_parent|
|struct binder_proc *|to_proc|
|struct binder_thread *|to_thread|接收端线程
|struct binder_transaction *|to_parent|
|unsigned |need_reply|是否需要回应
|struct binder_buffer *|buffer|
|unsigned int	|code|
|unsigned int	|flags|
|long	|priority|优先级
|long	|saved_priority|保存的优先级
|kuid_t	|sender_euid|发送端uid



### 3.6 binder_buffer

|类型|成员变量|解释|
|---|---|---|
|struct list_head|entry|空闲和已分配实体的地址|
|struct rb_node|rb_node|空闲实体大小或已分配实体地址|
|unsigned|free|标记是否是空闲buffer，占位1bit|
|unsigned|allow_user_free|是否允许用户释放，占位1bit|
|unsigned|async_transaction|占位1bit|
|unsigned|debug_id|占位29bit|
|struct binder_transaction *|transaction||
|struct binder_node *|target_node|Binder实体|
|size_t|data_size||
|size_t|offsets_size||
|uint8_t|data[0]||


每一个binder_buffer分为空闲和已分配的，通过free标记来区分。空闲和已分配的binder_buffer通过各自的成员变量rb_node分别连入binder_proc的free_buffers(红黑树)和allocated_buffers(红黑树)。

### 3.7 binder_node

binder_node代表一个binder实体

|类型|成员变量|解释|
|---|---|---|
|int|debug_id||
|struct binder_work|work||
|struct rb_node|rb_node|binder正常使用，union|
|struct hlist_node|dead_node|binder进程已销毁，union|
|struct binder_proc *|proc|binder所在的进程|
|struct hlist_head |refs|
|int| internal_strong_refs|
|int |local_weak_refs|
|int |local_strong_refs| 
|binder_uintptr_t| ptr|Binder实体所在用户空间的地址|
|binder_uintptr_t| cookie|附件数据|
|unsigned| has_strong_ref|占位1bit
|unsigned| pending_strong_ref|占位1bit
|unsigned| has_weak_ref|占位1bit
|unsigned| pending_weak_ref|占位1bit
|unsigned| has_async_transaction|占位1bit
|unsigned| accept_fds|占位1bit
|unsigned| min_priority|占位8bit
|struct list_head| async_todo|

### 3.8 binder_ref

|类型|成员变量|解释|
|---|---|---|
|int |debug_id|
|struct rb_node |rb_node_desc|以desc为索引的红黑树
|struct rb_node |rb_node_node|以node为索引的红黑树
|struct hlist_node |node_entry|
|struct binder_proc *|proc|binder进程
|struct binder_node *|node|binder节点
|uint32_t |desc|handle
|int |strong|强引用次数
|int |weak|弱引用次数
|struct binder_ref_death *|death|


binder引用的查询方式如下：

- node + proc => ref (transaction) 
- desc + proc => ref (transaction, inc/dec ref) 
- node => refs + procs (proc exit)


### 3.9 binder_ref_death

	struct binder_ref_death {
		struct binder_work work;
		binder_uintptr_t cookie;
	};

### 3.10 binder_work

	struct binder_work {
		struct list_head entry;
		enum {
			BINDER_WORK_TRANSACTION = 1, //binder_transaction()方法设置
			BINDER_WORK_TRANSACTION_COMPLETE, //binder_transaction()方法设置
			BINDER_WORK_NODE, // binder_new_node()方法设置
			BINDER_WORK_DEAD_BINDER, // binder_thread_write()等多个方法可设置
			BINDER_WORK_DEAD_BINDER_AND_CLEAR, // binder_thread_write()等多个方法可设置
			BINDER_WORK_CLEAR_DEATH_NOTIFICATION,// binder_thread_write()等多个方法可设置
		} type;
	};


### 3.11 binder_state

|类型|成员变量|解释|
|---|---|---|
|int| fd|文件描述符
|void *|mapped|内存映射地址
|size_t |mapsize|内存映射大小

### 3.12 flat_binder_object

flat_binder_object结构体代表Binder对象在两个进程间传递的扁平结构。


|类型|成员变量|解释|
|---|---|---|
|__u32|	type|类型
|__u32|	flags|记录优先级、文件描述符许可
|binder_uintptr_t|binder |local对象，union|
|__u32|handle |remote对象，union|
|binder_uintptr_t|cookie|local对象相关的额外数据|

此处的类型type的可能取值来自于`enum`，成员如下：

|成员变量|解释|
|---|---|
|BINDER_TYPE_BINDER|binder实体的强引用|
|BINDER_TYPE_WEAK_BINDER|binder实体的弱引用|
|BINDER_TYPE_HANDLE|binder强引用|
|BINDER_TYPE_WEAK_HANDLE|binder弱引用|
|BINDER_TYPE_FD|binder文件描述符|