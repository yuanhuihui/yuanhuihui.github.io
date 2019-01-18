---
layout: post
title:  "深入解读Linux poll内核机制"
date:   2018-02-03 21:11:12
catalog:  true
tags:
    - android

---

> 从源码角度来领略一下内核的轮询机制

```C
fs/select.c
kernel/include/linux/poll.h
```

## 一、概述

在前面的文章[select/poll/epoll对比分析](http://gityuan.com/2015/12/06/linux_epoll/)，从使用者的角度讲述了三者之间的关系。select/poll/epoll都是IO多路监控机制，通过监控文件描述符读写状态来通知相应程序执行操作的一个机制。

#### 1.1 select函数

```CPP
int select (int n, fd_set *readfds, 
									 fd_set *writefds, 
									 fd_set *exceptfds, 
									 struct timeval *timeout);
									 
struct timeval {
	long tv_sec;  //seconds
	long tv_usec; //microseconds
}；
```

select最终是通过底层驱动对应设备文件的poll函数来查询是否有可用资源(可读或者可写)，如果没有则睡眠。

#### 1.2 poll函数

```CPP
int poll (struct pollfd *fds, unsigned int nfds, int timeout);

struct pollfd {
	int fd; 
	short events; 
	short revents;
};
```

#### 1.3 epoll函数

```CPP
int epoll_create(int size)；
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event)；
int epoll_wait(int epfd, struct epoll_event * events, int maxevents, int timeout);

struct epoll_event {
	__uint32_t events; 
	epoll_data_t data; 
};
```

接下来从源码角度来看看以上3种机制。

## 二、select源码

select最终是通过底层驱动对应设备文件的poll函数来查询是否有可用资源(可读或者可写)，如果没有则睡眠。

select调用链：select -> sys_select -> core_sys_select -> do_select -> poll_select_copy_remaining

### 2.1 fd_set

```CPP
#include <sys/select.h>

#define FD_SETSIZE 1024
#define NFDBITS (8 * sizeof(unsigned long))
#define __FDSET_LONGS (FD_SETSIZE/NFDBITS)

typedef struct {
		unsigned long fds_bits[__FDSET_LONGS];
} fd_set;

void FD_SET(int fd, fd_set *fdset)   //将fd添加到fdset
void FD_CLR(int fd, fd_set *fdset)   //从fdset中删除fd
void FD_ISSET(int fd, fd_set *fdset) //判断fd是否已存在fdset
void FD_ZERO(fd_set *fdset)          //初始化fdset全为0
```

fd_set是一个文件描述符fd的集合，由于每个进程可打开的文件描述符默认值为1024，fd_set可记录的fd个数上限也是为1024个。
从下面代码可知，fd_set采用位图bitmap算法，位图是一个比较经典的算法，此处创建一个大小为32的long型数组，每一个bit代表一个0~1023区间的数字。
可通过以下4个FD_XXX宏来操作fd_set数组。

### 2.2 sys_select
select系统调用对应的方法是sys_select，具体代码如下：

[-> fs/select.c]

```C
SYSCALL_DEFINE5(select, int, n, fd_set __user *, inp, fd_set __user *, outp,
		fd_set __user *, exp, struct timeval __user *, tvp)
{
	struct timespec end_time, *to = NULL;
	struct timeval tv;
	int ret;

	if (tvp) {  // 设置超时阈值
		if (copy_from_user(&tv, tvp, sizeof(tv)))
			return -EFAULT;

		to = &end_time;
		if (poll_select_set_timeout(to,
				tv.tv_sec + (tv.tv_usec / USEC_PER_SEC),
				(tv.tv_usec % USEC_PER_SEC) * NSEC_PER_USEC))
			return -EINVAL;
	}

	ret = core_sys_select(n, inp, outp, exp, to); // 见【小节2.3】
	ret = poll_select_copy_remaining(&end_time, tvp, 1, ret); // 见【小节2.4】
	return ret;
}
```

### 2.3 core_sys_select

```C
int core_sys_select(int n, fd_set __user *inp, fd_set __user *outp,
				 fd_set __user *exp, struct timespec *end_time)
{
	fd_set_bits fds;
	void *bits;
	int ret, max_fds;
	unsigned int size;
	struct fdtable *fdt;
	//创建大小为256的数组
	long stack_fds[SELECT_STACK_ALLOC/sizeof(long)];

	rcu_read_lock();
	fdt = files_fdtable(current->files);
	max_fds = fdt->max_fds;
	rcu_read_unlock();
	if (n > max_fds)
		n = max_fds; //select可监控个数必须小于等于进程可打开的文件描述上限

	////根据n来计算需要多少个字节, 展开为size=4*(n+32-1)/32
	size = FDS_BYTES(n); 
	bits = stack_fds;
	//需要6个bitmaps (int/out/ex 以及其对应的3个结果集)
	if (size > sizeof(stack_fds) / 6) {
		bits = kmalloc(6 * size, GFP_KERNEL);
	}
	fds.in      = bits;
	fds.out     = bits +   size;
	fds.ex      = bits + 2*size;
	fds.res_in  = bits + 3*size;
	fds.res_out = bits + 4*size;
	fds.res_ex  = bits + 5*size;

	if ((ret = get_fd_set(n, inp, fds.in)) ||
			(ret = get_fd_set(n, outp, fds.out)) ||
			(ret = get_fd_set(n, exp, fds.ex)))
		goto out;
	zero_fd_set(n, fds.res_in);
	zero_fd_set(n, fds.res_out);
	zero_fd_set(n, fds.res_ex);

	ret = do_select(n, &fds, end_time); //【小节2.3.1】

	if (ret < 0)
		goto out;
	if (!ret) {
		ret = -ERESTARTNOHAND;
		if (signal_pending(current))
			goto out;
		ret = 0;
	}
	//执行完do_select后，将可读、可写、异常这3类事件结果调用copy_to_user拷贝到用户空间
	if (set_fd_set(n, inp, fds.res_in) ||
			set_fd_set(n, outp, fds.res_out) ||
			set_fd_set(n, exp, fds.res_ex))
		ret = -EFAULT;

out:
	if (bits != stack_fds)
		kfree(bits);
out_nofds:
	return ret;
}
```

可见占用空间有两种情况：（size=4*(n+32-1)/32）
- 当size<=42，则为256个long型数组
- 当size>42，则为6*size



##### 2.3.1 do_select

```C
int do_select(int n, fd_set_bits *fds, struct timespec *end_time)
{
	ktime_t expire, *to = NULL;
	struct poll_wqueues table;
	poll_table *wait;
	int retval, i, timed_out = 0;
	u64 slack = 0;
	unsigned int busy_flag = net_busy_loop_on() ? POLL_BUSY_LOOP : 0;
	unsigned long busy_end = 0;

	rcu_read_lock();
	retval = max_select_fd(n, fds);
	rcu_read_unlock();

	if (retval < 0)
		return retval;
	n = retval;

	poll_initwait(&table); //初始化等待队列
	wait = &table.pt;
	if (end_time && !end_time->tv_sec && !end_time->tv_nsec) {
		wait->_qproc = NULL;
		timed_out = 1;
	}

	if (end_time && !timed_out)
		slack = select_estimate_accuracy(end_time);

	retval = 0;
	for (;;) {
		unsigned long *rinp, *routp, *rexp, *inp, *outp, *exp;
		bool can_busy_loop = false;

		inp = fds->in; outp = fds->out; exp = fds->ex;
		rinp = fds->res_in; routp = fds->res_out; rexp = fds->res_ex;

		for (i = 0; i < n; ++rinp, ++routp, ++rexp) {
			unsigned long in, out, ex, all_bits, bit = 1, mask, j;
			unsigned long res_in = 0, res_out = 0, res_ex = 0;

			in = *inp++; out = *outp++; ex = *exp++;
			all_bits = in | out | ex;
			
			if (all_bits == 0) {
				i += BITS_PER_LONG; //以32bits步长遍历位图，直到在该区间存在目标fd
				continue;
			}

			for (j = 0; j < BITS_PER_LONG; ++j, ++i, bit <<= 1) {
				struct fd f;
				if (i >= n)
					break;
				if (!(bit & all_bits))
					continue;
				f = fdget(i);  //找到目标fd
				if (f.file) {
					const struct file_operations *f_op;
					f_op = f.file->f_op;
					mask = DEFAULT_POLLMASK;
					if (f_op->poll) {
						wait_key_set(wait, in, out, bit, busy_flag);
						mask = (*f_op->poll)(f.file, wait); //执行文件系统的poll方法
					}
					fdput(f);
					//写入in/out/ex相对应的结果
					if ((mask & POLLIN_SET) && (in & bit)) {
						res_in |= bit;
						retval++;
						wait->_qproc = NULL;
					}
					if ((mask & POLLOUT_SET) && (out & bit)) {
						res_out |= bit;
						retval++;
						wait->_qproc = NULL;
					}
					if ((mask & POLLEX_SET) && (ex & bit)) {
						res_ex |= bit;
						retval++;
						wait->_qproc = NULL;
					}
					
					if (retval) {
						can_busy_loop = false; //当返回值不为零，则停止循环轮询
						busy_flag = 0;
					} else if (busy_flag & mask)
						can_busy_loop = true;
				}
			}
			if (res_in)
				*rinp = res_in;
			if (res_out)
				*routp = res_out;
			if (res_ex)
				*rexp = res_ex;
			cond_resched();
		}
		wait->_qproc = NULL;
		if (retval || timed_out || signal_pending(current))
			break;
		if (table.error) {
			retval = table.error;
			break;
		}

		/* only if found POLL_BUSY_LOOP sockets && not out of time */
		if (can_busy_loop && !need_resched()) {
			if (!busy_end) {
				busy_end = busy_loop_end_time();
				continue;
			}
			if (!busy_loop_timeout(busy_end))
				continue;
		}
		busy_flag = 0;

		/*
		 * If this is the first loop and we have a timeout
		 * given, then we convert to ktime_t and set the to
		 * pointer to the expiry value.
		 */
		if (end_time && !to) {
			expire = timespec_to_ktime(*end_time);
			to = &expire;
		}

		if (!poll_schedule_timeout(&table, TASK_INTERRUPTIBLE,
						 to, slack))
			timed_out = 1;
	}

	poll_freewait(&table);

	return retval;
}
```

## 三、poll源码

### 3.1 原型

```CPP
int poll (struct pollfd *fds, unsigned int nfds, int timeout);

struct pollfd {
		int fd; 
		short events; 
		short revents;
};
```

## 四、epoll源码

### 4.1 原型

```CPP
int epoll_create(int size)；
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event)；
int epoll_wait(int epfd, struct epoll_event * events, int maxevents, int timeout);

struct epoll_event {
	__uint32_t events; 
	epoll_data_t data; 
};
```
