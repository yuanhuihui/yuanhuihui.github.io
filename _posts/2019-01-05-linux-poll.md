---
layout: post
title:  "深入解读Linux poll内核机制"
date:   2019-01-05 22:11:12
catalog:  true
tags:
    - android

---

> 从源码角度来领略一下内核的轮询机制

```C
kernel/fs/select.c
kernel/include/linux/poll.h
kernel/include/linux/fs.h
```

## 一、概述

在前面的文章[select/poll/epoll对比分析](http://gityuan.com/2015/12/06/linux_epoll/)，从使用者的角度讲述了三者之间的关系。select/poll/epoll都是IO多路监控机制，通过监控文件描述符读写状态来通知相应程序执行操作的一个机制。再往深处问一个他们底层又是如何实现，可以做得监控文件状态的功能呢？本文先回顾select/poll机制的使用与源码，下一篇文章再来单独能实现高并发的epoll机制。

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

接下来从源码角度来解读这两种机制。

## 二、select源码

select最终是通过底层驱动对应设备文件的poll函数来查询是否有可用资源(可读或者可写)，如果没有则睡眠。

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
可通过上述的4个FD_XXX()宏来操作fd_set数组。

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
    
     // 见【小节2.3】
    ret = core_sys_select(n, inp, outp, exp, to);
    ret = poll_select_copy_remaining(&end_time, tvp, 1, ret); //更新超时
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

    ret = do_select(n, &fds, end_time); //【小节2.4】

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

select过程需要占用的空间有两种情况，size=4*(n+32-1)/32，其中n是监控文件fd的最大值+1：

- 当size<=42时，则为256个long型数组
- 当size>42时，则为6*size大小

### 2.4 do_select

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

    poll_initwait(&table); //初始化等待队列 【小节2.4.1】
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
                        //执行文件系统的poll函数，检测IO事件，见【小节2.4.2】
                        mask = (*f_op->poll)(f.file, wait); 
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
                    //当返回值不为零，则停止循环轮询
                    if (retval) {
                        can_busy_loop = false; 
                        busy_flag = 0;
                    } else if (busy_flag & mask)
                        can_busy_loop = true;
                }
            }
            //本轮循环遍历完成，则更新fd事件的结果
            if (res_in)
                *rinp = res_in;
            if (res_out)
                *routp = res_out;
            if (res_ex)
                *rexp = res_ex;
            cond_resched(); //让出cpu给其他进程运行，类似于上层的yield
        }
        wait->_qproc = NULL;
        //当有文件描述符准备就绪 或者超时 或者 有待处理的信号，则退出循环
        if (retval || timed_out || signal_pending(current))
            break;
        if (table.error) {
            retval = table.error;
            break;
        }

        if (can_busy_loop && !need_resched()) {
            if (!busy_end) {
                busy_end = busy_loop_end_time();
                continue;
            }
            if (!busy_loop_timeout(busy_end))
                continue;
        }
        busy_flag = 0;

        if (end_time && !to) { //首轮循环设置超时
            expire = timespec_to_ktime(*end_time);
            to = &expire;
        }
        //设置当前进程状态为TASK_INTERRUPTIBLE，进入睡眠直到超时，见【小节2.4.3】
        if (!poll_schedule_timeout(&table, TASK_INTERRUPTIBLE,
                         to, slack))
            timed_out = 1;
    }

    poll_freewait(&table); //释放poll等待队列【小节2.4.4】
    return retval;
}
```

do_select最核心的还是调用文件系统*f_op->poll函数，来检测I/O事件（比如fd可读或者可写）。

- 当存在被监控的fd触发目标事件，则将其fd记录下来，退出循环体，返回用户空间；
- 当没有找到目标事件，如果已超时或者有待处理的信号，也会退出循环体，返回空给用户空间；
- 当以上两种情况都不满足，则会让当前进程进入休眠状态，以等待fd或者超时定时器来唤醒自己，再走一遍循环。

```C
struct poll_wqueues table;
poll_initwait(&table);
wait = &table.pt;

(*f_op->poll)(f.file, wait); 

poll_freewait(&table)
```

#### 2.4.1 poll_initwait


```C
void poll_initwait(struct poll_wqueues *pwq)
{
    init_poll_funcptr(&pwq->pt, __pollwait); //初始化poll函数指针
    pwq->polling_task = current;
    pwq->triggered = 0;
    pwq->error = 0;
    pwq->table = NULL;
    pwq->inline_index = 0;
}
```

将结构体poll_wqueues->poll_table->poll_queue_proc赋值为__pollwait，下面依次来看看这里涉及到的几个结构体源码。

```C
struct poll_wqueues {
    poll_table pt;
    struct poll_table_page *table;
    struct task_struct *polling_task;
    int triggered;
    int error;
    int inline_index;
    //记录poll信息的数组
    struct poll_table_entry inline_entries[N_INLINE_POLL_ENTRIES];
};

typedef struct poll_table_struct {
    poll_queue_proc _qproc;
    unsigned long _key;
} poll_table;

struct poll_table_entry {
    struct file *filp;
    unsigned long key;
    wait_queue_t wait;
    wait_queue_head_t *wait_address;
};
```

再来看看poll函数的初始化过程

```C
static inline void init_poll_funcptr(poll_table *pt, poll_queue_proc qproc)
{
    pt->_qproc = qproc;
    pt->_key   = ~0UL;  //所有的事件使能
}

typedef void (*poll_queue_proc)(struct file *, 
                wait_queue_head_t *, struct poll_table_struct *);
                
static void __pollwait(struct file *filp, wait_queue_head_t *wait_address,
                poll_table *p)
{
    //根据poll_wqueues的成员pt指针 找到所在的poll_wqueues结构指针
    struct poll_wqueues *pwq = container_of(p, struct poll_wqueues, pt);
    struct poll_table_entry *entry = poll_get_entry(pwq);
    if (!entry)
        return;
    entry->filp = get_file(filp);
    entry->wait_address = wait_address;
    entry->key = p->_key;
    // 设置该poll表条目的wait操作函数为pollwake
    init_waitqueue_func_entry(&entry->wait, pollwake);
    entry->wait.private = pwq;
    // 将该wait加入到等待链表
    add_wait_queue(wait_address, &entry->wait);
}
```

理解__pollwait()方法对于真正掌握Linux的sleep/wakeup机制非常有效，poll_wait()和poll_freewait()使得这一切正常运转。
poll_wait()是在<linux / poll.h>中定义的内联函数，因为所有select/poll函数都必须调用它来向poll table添加一个条目。

再来看看pollwake函数

```C
static int __pollwake(wait_queue_t *wait, unsigned mode, int sync, void *key)
{
    struct poll_wqueues *pwq = wait->private;
    DECLARE_WAITQUEUE(dummy_wait, pwq->polling_task);

    smp_wmb();
    pwq->triggered = 1;
    //唤醒目标进程
    return default_wake_function(&dummy_wait, mode, sync, key);
}
```

#### 2.4.2 file_operations->poll

struct file_operations设备驱动的操作函数，每个文件系统都有自己的一套文件操作集合，下列列举file_operations结构体的部分
常见成员函数：

```C
struct file_operations {
    struct module *owner;
    loff_t (*llseek) (struct file *, loff_t, int);
    ssize_t (*read) (struct file *, char __user *, size_t, loff_t *);
    ssize_t (*write) (struct file *, const char __user *, size_t, loff_t *);
    unsigned int (*poll) (struct file *, struct poll_table_struct *);
    long (*unlocked_ioctl) (struct file *, unsigned int, unsigned long);
    int (*mmap) (struct file *, struct vm_area_struct *);
    int (*open) (struct inode *, struct file *);
    ... 
};
```

回到前面的核心函数调用(*f_op->poll)(f.file, wait)，就是等于调用文件系统的poll方法，不同驱动设备实现方法略有不同，但都会执行poll_wait()，该方法真正执行的便是前面的回调函数__pollwait，把自己挂入等待队列。

```C
unsigned int (*poll) (struct file *, struct poll_table_struct *);
```

当有事件发生时便会唤醒等待队列上的进程。比如监控的是可写事件，则会在write()方法中调用wakeup方法唤醒相对应的等待队列上的进程。

#### 2.4.3 poll_schedule_timeout

```C
int poll_schedule_timeout(struct poll_wqueues *pwq, int state,
              ktime_t *expires, unsigned long slack)
{
    int rc = -EINTR;

    set_current_state(state); //设置进程状态
    if (!pwq->triggered) //设置超时
        rc = schedule_hrtimeout_range(expires, slack, HRTIMER_MODE_ABS);
    __set_current_state(TASK_RUNNING);

    smp_store_mb(pwq->triggered, 0);

    return rc;
}
```

#### 2.4.4 poll_freewait

```C
void poll_freewait(struct poll_wqueues *pwq)
{
    struct poll_table_page * p = pwq->table;
    int i;
    for (i = 0; i < pwq->inline_index; i++)
        free_poll_entry(pwq->inline_entries + i);
    while (p) {
        struct poll_table_entry * entry;
        struct poll_table_page *old;

        entry = p->entry;
        do {
            entry--;
            free_poll_entry(entry);
        } while (entry > p->entries);
        old = p;
        p = p->next;
        free_page((unsigned long) old);
    }
}

static void free_poll_entry(struct poll_table_entry *entry)
{
    //从等待队列中移除wait
    remove_wait_queue(entry->wait_address, &entry->wait);
    fput(entry->filp);
}
```

## 三、poll源码

当应用程序调用poll函数，经过系统调用会执行sys_poll函数。

### 3.1 sys_poll

[-> fs/select.c]

```C
SYSCALL_DEFINE3(poll, struct pollfd __user *, ufds, unsigned int, nfds,
        int, timeout_msecs)
{
    struct timespec end_time, *to = NULL;
    int ret;

    if (timeout_msecs >= 0) { //设置超时
        to = &end_time;
        poll_select_set_timeout(to, timeout_msecs / MSEC_PER_SEC,
            NSEC_PER_MSEC * (timeout_msecs % MSEC_PER_SEC));
    }

    ret = do_sys_poll(ufds, nfds, to); // 见【小节3.2】

    if (ret == -EINTR) {
        struct restart_block *restart_block;

        restart_block = &current->restart_block;
        restart_block->fn = do_restart_poll;
        restart_block->poll.ufds = ufds;
        restart_block->poll.nfds = nfds;

        if (timeout_msecs >= 0) {
            restart_block->poll.tv_sec = end_time.tv_sec;
            restart_block->poll.tv_nsec = end_time.tv_nsec;
            restart_block->poll.has_timeout = 1;
        } else
            restart_block->poll.has_timeout = 0;

        ret = -ERESTART_RESTARTBLOCK;
    }
    return ret;
}
```

### 3.2 do_sys_poll

```C
int do_sys_poll(struct pollfd __user *ufds, unsigned int nfds,
        struct timespec *end_time)
{
    struct poll_wqueues table;
     int err = -EFAULT, fdcount, len, size;
    //创建大小为256的数组
    long stack_pps[POLL_STACK_ALLOC/sizeof(long)];
    struct poll_list *const head = (struct poll_list *)stack_pps;
     struct poll_list *walk = head;
     unsigned long todo = nfds;

    if (nfds > rlimit(RLIMIT_NOFILE)) //上限默认为1024
        return -EINVAL;

    len = min_t(unsigned int, nfds, N_STACK_PPS);
    for (;;) {
        walk->next = NULL;
        walk->len = len;
        if (!len)
            break;

        if (copy_from_user(walk->entries, ufds + nfds-todo,
                    sizeof(struct pollfd) * walk->len))
            goto out_fds;

        todo -= walk->len;
        if (!todo)
            break;

        len = min(todo, POLLFD_PER_PAGE);
        size = sizeof(struct poll_list) + sizeof(struct pollfd) * len;
        walk = walk->next = kmalloc(size, GFP_KERNEL);
    }

    poll_initwait(&table); //同上【小节2.4.1】
    fdcount = do_poll(nfds, head, &table, end_time); //见【小节3.3】
    poll_freewait(&table); //同上【小节2.4.4】

    for (walk = head; walk; walk = walk->next) {
        struct pollfd *fds = walk->entries;
        int j;
        //将revents值拷贝到用户空间ufds
        for (j = 0; j < walk->len; j++, ufds++)
            if (__put_user(fds[j].revents, &ufds->revents))
                goto out_fds;
      }

    err = fdcount;
out_fds:
    walk = head->next;
    while (walk) {
        struct poll_list *pos = walk;
        walk = walk->next;
        kfree(pos);
    }

    return err;
}
```

进程可打开文件的上限可通过命令**ulimit -n**获取，默认为1024

### 3.3 do_poll

```C
static int do_poll(unsigned int nfds,  struct poll_list *list,
           struct poll_wqueues *wait, struct timespec *end_time)
{
    poll_table* pt = &wait->pt;
    ktime_t expire, *to = NULL;
    int timed_out = 0, count = 0;
    u64 slack = 0;
    unsigned int busy_flag = net_busy_loop_on() ? POLL_BUSY_LOOP : 0;
    unsigned long busy_end = 0;

    // 优化非阻塞的情形
    if (end_time && !end_time->tv_sec && !end_time->tv_nsec) {
        pt->_qproc = NULL;
        timed_out = 1;
    }

    if (end_time && !timed_out)
        slack = select_estimate_accuracy(end_time);

    for (;;) {
        struct poll_list *walk;
        bool can_busy_loop = false;

        for (walk = list; walk != NULL; walk = walk->next) {
            struct pollfd * pfd, * pfd_end;

            pfd = walk->entries;
            pfd_end = pfd + walk->len;
            for (; pfd != pfd_end; pfd++) {
                //见【小节3.4】
                if (do_pollfd(pfd, pt, &can_busy_loop,
                          busy_flag)) {
                    count++;
                    pt->_qproc = NULL;
                    busy_flag = 0; //找到目标事件，可跳出循环
                    can_busy_loop = false; 
                }
            }
        }

        //所有的waiters已注册，因此不需要为下一轮循环提供poll_table->_qproc
        pt->_qproc = NULL;
        if (!count) {
            count = wait->error;
            if (signal_pending(current)) //有待处理信号，则跳出循环
                count = -EINTR;
        }
        if (count || timed_out) //监控事件触发，或者超时则跳出循环
            break;

        if (can_busy_loop && !need_resched()) {
            if (!busy_end) {
                busy_end = busy_loop_end_time();
                continue;
            }
            if (!busy_loop_timeout(busy_end))
                continue;
        }
        busy_flag = 0;

        if (end_time && !to) { //首轮循环设置超时
            expire = timespec_to_ktime(*end_time);
            to = &expire;
        }
        //【同上2.4.3】
        if (!poll_schedule_timeout(wait, TASK_INTERRUPTIBLE, to, slack))
            timed_out = 1;
    }
    return count;
}
```

### 3.4 do_pollfd

```C
static inline unsigned int do_pollfd(struct pollfd *pollfd, 
                     poll_table *pwait,
                     bool *can_busy_poll,
                     unsigned int busy_flag)
{
    unsigned int mask;
    int fd;

    mask = 0;
    fd = pollfd->fd;
    if (fd >= 0) {
        struct fd f = fdget(fd);
        mask = POLLNVAL;
        if (f.file) {
            mask = DEFAULT_POLLMASK;
            if (f.file->f_op->poll) {
                pwait->_key = pollfd->events|POLLERR|POLLHUP;
                pwait->_key |= busy_flag;
                //同上【2.4.2】
                mask = f.file->f_op->poll(f.file, pwait);
                if (mask & busy_flag)
                    *can_busy_poll = true;
            }
            mask &= pollfd->events | POLLERR | POLLHUP;
            fdput(f);
        }
    }
    pollfd->revents = mask;

    return mask;
}
```

## 四、总结

Linux驱动程序提供休眠/唤醒机制：

- 等待队列：当事件满足要求，则唤醒所有的等待队列项。一个进程可以等待多个不同等待队列，以及指定相应的唤醒时回调函数。一般来说，等待状态的进程处于睡眠，回调函数则相应会唤醒进程。
- 轮询函数poll：执行指定的回调函数，将驱动的等待队列给外部代码。


调用链：

```C
select 
    sys_select
        core_sys_select
            do_select
                poll_initwait
                while
                    poll
                    poll_schedule_timeout
                poll_freewait

poll
    sys_poll
        do_sys_poll
            poll_initwait
            do_poll
                do_pollfd
                poll_schedule_timeout
            poll_freewait
```
