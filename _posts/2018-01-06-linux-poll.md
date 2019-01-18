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

fd_set是一个文件描述符fd的集合，由于每个进程可打开的文件描述符默认值为1024，fd_set可记录的fd个数上限也是为1024个。
从下面代码可知，fd_set采用位图bitmap算法，位图是一个比较经典的算法，此处创建一个大小为32的long型数组，每一个bit代表一个0~1023区间的数字。
可通过以下4个FD_XXX宏来操作fd_set数组。

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

### 2.2 sys_select
select系统调用对应的方法是sys_select，具体代码如下：

```C
SYSCALL_DEFINE5(select, int, n, fd_set __user *, inp, fd_set __user *, outp,
		fd_set __user *, exp, struct timeval __user *, tvp)
{
	struct timespec end_time, *to = NULL;
	struct timeval tv;
	int ret;

	if (tvp) {
		if (copy_from_user(&tv, tvp, sizeof(tv)))
			return -EFAULT;

		to = &end_time;
		if (poll_select_set_timeout(to,
				tv.tv_sec + (tv.tv_usec / USEC_PER_SEC),
				(tv.tv_usec % USEC_PER_SEC) * NSEC_PER_USEC))
			return -EINVAL;
	}

	ret = core_sys_select(n, inp, outp, exp, to);
	ret = poll_select_copy_remaining(&end_time, tvp, 1, ret);

	return ret;
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

Test, 正在编写中
