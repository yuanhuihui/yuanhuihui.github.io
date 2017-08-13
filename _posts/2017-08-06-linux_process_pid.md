---
layout: post
title:  "Linux进程pid分配算法"
date:   2017-08-06 22:22:50
catalog:  true
tags:
    - linux
    - process

---

## 一. 概述

Android系统创建进程，最终的实现还是调用linux fork方法，对于linux系统每个进程都有唯一的
进程ID(值大于0)，也有pid上限，默认为32768。 pid可重复利用，当进程被杀后会回收该pid，以供后续的进程pid分配。

上一篇文章[Linux进程管理](http://gityuan.com/2017/08/05/linux-process-fork/) 详细地介绍了进程fork过程，在copy_process()过程，执行完父进行文件、内存等信息的拷贝，
紧接着便是执行alloc_pid()方法去分配pid

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
      p->pid = pid_nr(pid); //设置pid[见小节2.x]
      ...
    }

### 2.2 alloc_pid
[-> kernel/kernel/pid.c]

    struct pid *alloc_pid(struct pid_namespace *ns)
    {
      struct pid *pid; //[见小节2.2.1]
      enum pid_type type;
      int i, nr;
      struct pid_namespace *tmp; //[见小节2.2.2]
      struct upid *upid;
      int retval = -ENOMEM;
      //分配内存
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
        INIT_HLIST_HEAD(&pid->tasks[type]);

      upid = pid->numbers + ns->level;
      spin_lock_irq(&pidmap_lock);
      if (!(ns->nr_hashed & PIDNS_HASH_ADDING))
        goto out_unlock;
        
      for ( ; upid >= pid->numbers; --upid) {
        hlist_add_head_rcu(&upid->pid_chain,
            &pid_hash[pid_hashfn(upid->nr, upid->ns)]);
        upid->ns->nr_hashed++;
      }
      spin_unlock_irq(&pidmap_lock);

      return pid;

    out_unlock:
      spin_unlock_irq(&pidmap_lock);
      put_pid_ns(ns);

    out_free:
      while (++i <= ns->level)
        free_pidmap(pid->numbers + i);

      kmem_cache_free(ns->pid_cachep, pid);
      return ERR_PTR(retval);
    }

#### 2.2.1 pid结构体
[-> kernel/include/linux/pid.h]

    struct pid
    {
    	atomic_t count;
    	unsigned int level;

    	struct hlist_head tasks[PIDTYPE_MAX];
    	struct rcu_head rcu;
    	struct upid numbers[1]; //见结构体upid
    };

    struct upid {
    	int nr; 
    	struct pid_namespace *ns;
    	struct hlist_node pid_chain;
    };
    
其中PIDTYPE_MAX的定义位于pid_type

    enum pid_type
    {
    	PIDTYPE_PID,
    	PIDTYPE_PGID,
    	PIDTYPE_SID,
    	PIDTYPE_MAX,
    	__PIDTYPE_TGID //仅用于__task_pid_nr_ns()
    };

#### 2.2.2 pid_namespace结构体
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
    #ifdef CONFIG_PROC_FS
    	struct vfsmount *proc_mnt;
    	struct dentry *proc_self;
    	struct dentry *proc_thread_self;
    #endif
    #ifdef CONFIG_BSD_PROCESS_ACCT
    	struct fs_pin *bacct;
    #endif
    	struct user_namespace *user_ns;
    	struct work_struct proc_work;
    	kgid_t pid_gid;
    	int hide_pid;
    	int reboot;	/* group exit code if this pidns was rebooted */
    	struct ns_common ns;
    };
    
### 2.x pid_nr
[-> kernel/include/linux/pid.h]

    static inline pid_t pid_nr(struct pid *pid)
    {
    	pid_t nr = 0;
    	if (pid)
    		nr = pid->numbers[0].nr;
    	return nr;
    }

### 2.3 alloc_pidmap
[-> kernel/kernel/pid.c]

    static int alloc_pidmap(struct pid_namespace *pid_ns)
    {
    	int i, offset, max_scan, pid, last = pid_ns->last_pid;
    	struct pidmap *map;

    	pid = last + 1;
    	if (pid >= pid_max)
    		pid = RESERVED_PIDS;
    	offset = pid & BITS_PER_PAGE_MASK;
    	map = &pid_ns->pidmap[pid/BITS_PER_PAGE];
    	/*
    	 * If last_pid points into the middle of the map->page we
    	 * want to scan this bitmap block twice, the second time
    	 * we start with offset == 0 (or RESERVED_PIDS).
    	 */
    	max_scan = DIV_ROUND_UP(pid_max, BITS_PER_PAGE) - !offset;
    	for (i = 0; i <= max_scan; ++i) {
    		if (unlikely(!map->page)) {
    			void *page = kzalloc(PAGE_SIZE, GFP_KERNEL);
    			/*
    			 * Free the page if someone raced with us
    			 * installing it:
    			 */
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
    		if (likely(atomic_read(&map->nr_free))) {
    			do {
    				if (!test_and_set_bit(offset, map->page)) {
    					atomic_dec(&map->nr_free);
    					set_last_pid(pid_ns, last, pid);
    					return pid;
    				}
    				offset = find_next_offset(map, offset);
    				pid = mk_pid(pid_ns, map, offset);
    			} while (offset < BITS_PER_PAGE && pid < pid_max);
    		}
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

## 三. 总结

未完，待续...
