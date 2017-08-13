---
layout: post
title:  "Linux进程pid分配法"
date:   2017-08-06 22:22:50
catalog:  true
tags:
    - linux
    - process

---

## 一. 概述

Android系统创建进程，最终的实现还是调用linux fork方法，对于linux系统每个进程都有唯一的
进程ID(值大于0)，也有pid上限，默认为32768。 pid可重复利用，当进程被杀后会回收该pid，以供后续的进程pid分配。

上一篇文章[Linux进程管理](http://gityuan.com/2017/08/05/linux-process-fork/) 详细地介绍了进程fork过程，在copy_process()过程，执行完父进行文件、内存等信息的拷贝，紧接着便是执行alloc_pid()方法去分配pid.

## 二. 分配法

### 2.1 copy_process

    static struct task_struct *copy_process(unsigned long clone_flags,
              unsigned long stack_start,
              unsigned long stack_size,
              int __user *child_tidptr,
              struct pid *pid,
              int trace,
              unsigned long tls)
    {
      ...
      struct task_struct *p;
      if (pid != &init_struct_pid) {
        //分配pid[见小节2.2]
        pid = alloc_pid(p->nsproxy->pid_ns_for_children);
      }
      p->pid = pid_nr(pid); //设置pid[见小节2.4]
      ...
    }

### 2.2 alloc_pid
[-> kernel/kernel/pid.c]

    struct pid *alloc_pid(struct pid_namespace *ns)
    {
      struct pid *pid; //[见小节2.2.1]
      enum pid_type type;
      int i, nr;
      struct pid_namespace *tmp; //[见小节2.2.4]
      struct upid *upid;
      int retval = -ENOMEM;
      //分配pid结构体的内存
      pid = kmem_cache_alloc(ns->pid_cachep, GFP_KERNEL);
      ...

      tmp = ns;
      pid->level = ns->level;
      for (i = ns->level; i >= 0; i--) {
        nr = alloc_pidmap(tmp); //分配pid【见小节2.3】
        ...
        pid->numbers[i].nr = nr; //nr保存到pid结构体
        pid->numbers[i].ns = tmp;
        tmp = tmp->parent;
      }
      ...

      get_pid_ns(ns);
      atomic_set(&pid->count, 1);
      for (type = 0; type < PIDTYPE_MAX; ++type)
        INIT_HLIST_HEAD(&pid->tasks[type]); //初始化pid的hlist结构体

      upid = pid->numbers + ns->level;
      spin_lock_irq(&pidmap_lock);
      if (!(ns->nr_hashed & PIDNS_HASH_ADDING))
        goto out_unlock;
        
      for ( ; upid >= pid->numbers; --upid) {
        //建立pid_hash的关联关系
        hlist_add_head_rcu(&upid->pid_chain,
            &pid_hash[pid_hashfn(upid->nr, upid->ns)]);
        upid->ns->nr_hashed++;
      }
      spin_unlock_irq(&pidmap_lock);
      return pid;
      ...
    }

#### 2.2.1 pid结构体
[-> kernel/include/linux/pid.h]

    struct pid
    {
      atomic_t count;
      unsigned int level;

      struct hlist_head tasks[PIDTYPE_MAX]; //见enum pid_type
      struct rcu_head rcu;
      struct upid numbers[1]; //见结构体upid
    };

#### 2.2.2 upid结构体
[-> pid.h]

    struct upid 
    {
      int nr; 
      struct pid_namespace *ns;
      struct hlist_node pid_chain;
    };
    
#### 2.2.3 pid_type
[-> pid.h]

    enum pid_type
    {
      PIDTYPE_PID, //进程ID
      PIDTYPE_PGID, //进程组ID
      PIDTYPE_SID, //会话组ID
      PIDTYPE_MAX,
      __PIDTYPE_TGID //仅用于__task_pid_nr_ns()
    };

#### 2.2.4 pid_namespace结构体
[-> kernel/include/linux/pid_namespace.h]

    struct pid_namespace {
      struct kref kref;
      struct pidmap pidmap[PIDMAP_ENTRIES];
      struct rcu_head rcu;
      int last_pid; 
      unsigned int nr_hashed;
      struct task_struct *child_reaper;
      struct kmem_cache *pid_cachep;
      unsigned int level;
      struct pid_namespace *parent;
      ...
      struct user_namespace *user_ns;
      struct work_struct proc_work;
      kgid_t pid_gid;
      int hide_pid;
      int reboot; 
      struct ns_common ns;
    };

PID命名空间，这是为系统提供虚拟化做支撑的功能。

### 2.3 alloc_pidmap
[-> kernel/kernel/pid.c]

    static int alloc_pidmap(struct pid_namespace *pid_ns)
    {
      //last_pid为上次分配出去的pid
      int i, offset, max_scan, pid, last = pid_ns->last_pid;
      struct pidmap *map;

      pid = last + 1;
      if (pid >= pid_max)
        pid = RESERVED_PIDS; //默认为300
        
      offset = pid & BITS_PER_PAGE_MASK; //最高位值置0，其余位不变
      map = &pid_ns->pidmap[pid/BITS_PER_PAGE]; //找到目标pidmap

      //当offset =0，则扫描一次;
      //当offset!=0，则扫描两次
      max_scan = DIV_ROUND_UP(pid_max, BITS_PER_PAGE) - !offset;
      for (i = 0; i <= max_scan; ++i) {
        if (unlikely(!map->page)) {
          void *page = kzalloc(PAGE_SIZE, GFP_KERNEL);
          spin_lock_irq(&pidmap_lock);
          if (!map->page) {
            map->page = page;
            page = NULL;
          }
          spin_unlock_irq(&pidmap_lock);
          kfree(page);
          if (unlikely(!map->page))
            break;
        }
        
        //当pidmap还有可用pid时
        if (likely(atomic_read(&map->nr_free))) {
          do {
            //当offset位空闲时返回该pid
            if (!test_and_set_bit(offset, map->page)) {
              atomic_dec(&map->nr_free); //可用pid减一
              set_last_pid(pid_ns, last, pid); //设置last_pid
              return pid;
            }
            //否则，查询下一个非0的offset值
            offset = find_next_offset(map, offset);
            根据offset转换成相应的pid
            pid = mk_pid(pid_ns, map, offset);
          } while (offset < BITS_PER_PAGE && pid < pid_max);
        }
        
        //当上述pid分配失败，则再次查找offset
        if (map < &pid_ns->pidmap[(pid_max-1)/BITS_PER_PAGE]) {
          ++map;
          offset = 0;
        } else {
          map = &pid_ns->pidmap[0];
          offset = RESERVED_PIDS;
          if (unlikely(last == offset))
            break;
        }
        pid = mk_pid(pid_ns, map, offset);
      }
      return -1;
    }

pid允许分配的最大值为32767，当pid分配轮过一圈之后则允许分配的最小值为300，也就是说前300个pid是不可再分配的。
    
相关常量如下：

    #define PAGE_SHIFT 12
    #define PAGE_SIZE (1UL << PAGE_SHIFT)  // 2^12
    #define BITS_PER_PAGE  (PAGE_SIZE * 8) // 2^15
    #define BITS_PER_PAGE_MASK	(BITS_PER_PAGE-1)  //2^15-1
    #define PAGE_MASK (~(PAGE_SIZE-1))
    
#### 2.3.1 pidmap结构体
[-> kernel/include/linux/pid_namespace.h]

    struct pidmap {
           atomic_t nr_free; //可用pid的个数
           void *page; //用于存放位图
    };

pidmap->page的大小为4KB，每一个bit位代表一个进程pid的分配情况，那么4KB*8=32768，
这正好是pid可分配的上限，用nr_free代表该namespace下还有多少可用pid。

#### 2.3.2 find_next_offset
[-> pid.c]

    #define find_next_offset(map, off)					\
        find_next_zero_bit((map)->page, BITS_PER_PAGE, off)
    
    static inline int mk_pid(struct pid_namespace *pid_ns,
        struct pidmap *map, int off)
    {
      return (map - pid_ns->pidmap)*BITS_PER_PAGE + off;
    }

### 2.4 pid_nr
[-> kernel/include/linux/pid.h]

    static inline pid_t pid_nr(struct pid *pid)
    {
      pid_t nr = 0;
      if (pid)
        nr = pid->numbers[0].nr;
      return nr;
    }

根据pid结构体找到真正的pid数值。

## 三. 总结

- pid分配上限的查询方式`cat /proc/sys/kernel/pid_max`，Android系统一般默认为32768。
- 对于pid<300的情况值允许分配一次，不可再改变。也就是进程pid分配范围为(300, 32768)；
- 每个pid分配成功，便会把当前的pid设置到last_pid， 那么下次pid的分配便是从last_pid+1开始
往下查找。这就意味着当last_pid+1或者附近的进程，刚被杀并回收该pid，此时再创建新进程，很有可能会复用
pid.
- 位图法记录已分配和未分配pid,由于pid的最大上限为32768，故pidmap采用4KB大小的内存，每一位代表一个进程ID号，正好4K*8=32K= 32768。
