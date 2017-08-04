---
layout: post
title:  "Binder子系统之调试分析(二)"
date:   2016-08-28 23:30:00
catalog:  true
tags:
    - android
    - binder
---

## 一. 节点创建

上一篇文章已经介绍了binder子系统调试的一些手段,这篇文章再来挑选系统几个核心服务进程来进行分析.

#### 1.1 内核编译选项

如果系统关闭了debugfs，则通过编辑`kernel/arch/arm/configs/×××_defconfig`

    //开启debugfs
    CONFIG_DEBUG_FS=y
    //有时，可能还需要配置fs的白名单列表，例如：
    CONFIG_DEBUG_FS_WHITE_LIST=":/tracing:/binder:/wakeup_sources:"

#### 1.2 创建debugfs

首先debugfs文件系统默认挂载在节点`/sys/kernel/debug`，binder驱动初始化的过程会在该节点下先创建`/binder`目录，然后在该目录下创建下面文件和目录：

- proc/
- stats
- state
- transactions
- transaction_log
- failed_transaction_log

比如：

	//创建目录 /sys/kernel/debug/binder
	binder_debugfs_dir_entry_root = debugfs_create_dir("binder", NULL);
	//创建目录 /sys/kernel/debug/binder/proc
	binder_debugfs_dir_entry_proc = debugfs_create_dir("proc", binder_debugfs_dir_entry_root);
	//创建文件/sys/kernel/debug/binder/state
	debugfs_create_file("state",S_IRUGO, binder_debugfs_dir_entry_root, NULL, &binder_state_fops);


另外，`/d`其实是指向`/sys/kernel/debug`的链接，也可以通过节点`/d/binder`来访问.



## 二. 节点分析

接下来,看看系统创建的以下5个节点:

    /d/binder/stats (整体以及各个进程的线程数,事务个数等的统计信息)
    /d/binder/state (整体以及各个进程的thread/node/ref/buffer的状态信息)
    /d/binder/failed_transaction_log (记录32条最近的传输失败事件)
    /d/binder/transaction_log (记录32条最近的传输事件)
    /d/binder/transactions (遍历所有进程的buffer分配情况)


每个节点所相应的Binder驱动中的输出函数为binder_xxx_show. 例如/d/binder/stats的节点信息,所对应的输出函数binder_stats_show.

### 2.1 stats

    cat /d/binder/stats

执行上述语句，所对应的函数`binder_stats_show`，所输出结果分两部分：

1. 整体统计信息
    - 所有BC_XXX命令的次数；
    - 所有BR_XXX命令的次数；
    - 输出`binder_stat_types`各个类型的active和total；  
2. 遍历所有进程的统计信息：
    - 当前进程相关的统计信息；
    - 所有BC_XXX命令的次数；
    - 所有BR_XXX命令的次数；

其中active是指当前系统存活的个数，total是指系统从开机到现在总共创建过的个数。下面举例来说明输出结果的含义：

#### 2.1.1 整体信息

    binder stats:
    BC_TRANSACTION: 235258
    BC_REPLY: 163048
    BC_FREE_BUFFER: 397853
    BC_INCREFS: 22573
    BC_ACQUIRE: 22735
    BC_RELEASE: 15840
    BC_DECREFS: 15810
    BC_INCREFS_DONE: 9517
    BC_ACQUIRE_DONE: 9518
    BC_REGISTER_LOOPER: 421
    BC_ENTER_LOOPER: 284
    BC_REQUEST_DEATH_NOTIFICATION: 4696
    BC_CLEAR_DEATH_NOTIFICATION: 3707
    BC_DEAD_BINDER_DONE: 400
    BR_TRANSACTION: 235245
    BR_REPLY: 163045
    BR_DEAD_REPLY: 3
    BR_TRANSACTION_COMPLETE: 398300
    BR_INCREFS: 9517
    BR_ACQUIRE: 9518
    BR_RELEASE: 5448
    BR_DECREFS: 5447
    BR_SPAWN_LOOPER: 462
    BR_DEAD_BINDER: 400
    BR_CLEAR_DEATH_NOTIFICATION_DONE: 3707
    BR_FAILED_REPLY: 3

    proc: active 78 total 382
    thread: active 530 total 3196
    node: active 1753 total 8134
    ref: active 2604 total 13422
    death: active 530 total 3991
    transaction: active 0 total 195903
    transaction_complete: active 0 total 195903

可知：

- 当前系统binder_proc个数为78，binder_thread个数为530，binder_node为1753等信息；
- 从开机到现在共创建过382个binder_proc，3196个binder_thread等；
- transaction active等于零，目前没有活动的transaction事务

`规律:` BC_TRANSACTION +  BC_REPLY =  BR_TRANSACTION_COMPLETE +  BR_DEAD_REPLY +  BR_FAILED_REPLY

为什么是会是这样呢,因为每次BC_TRANSACTION或着BC_REPLY,都是有相应的BR_TRANSACTION_COMPLETE,在传输不出异常的情况下这个次数是相等,有时候并能transaction成功, 所以还需要加上BR_DEAD_REPLY和BR_FAILED_REPLY的情况.

#### 2.1.2 各进程信息

    proc 14328
      threads: 3 //binder_thread个数
      //requested_threads(请求线程数) + requested_threads_started(已启动线程数) / max_threads(最大线程数)
      requested threads: 0+1/15
      ready threads 2 // ready_threads(准备就绪的线程数)
      free async space 520192 //可用的异步空间约为520k
      nodes: 3 //binder_node个数
      refs: 9 s 9 w 9 //引用次数，强引用次数，弱引用次数次数
      buffers: 0 //allocated_buffers(已分配的buffer个数)
      pending transactions: 0 //proc的todo队列事务个数

      //该进程中BC_XXX 和BR_XXX命令执行次数
      BC_TRANSACTION: 21
      BC_FREE_BUFFER: 24
      BC_INCREFS: 9
      BC_ACQUIRE: 9
      BC_INCREFS_DONE: 3
      BC_ACQUIRE_DONE: 3
      BC_REGISTER_LOOPER: 1
      BC_ENTER_LOOPER: 1
      BC_REQUEST_DEATH_NOTIFICATION: 1
      BR_TRANSACTION: 4
      BR_REPLY: 20
      BR_TRANSACTION_COMPLETE: 21
      BR_INCREFS: 3
      BR_ACQUIRE: 3
      BR_SPAWN_LOOPER: 1

可知进程14328：

- 共有3个binder_thread，最大线程个数上限为15.
- 共有3个binder_node， 9个binder_ref。
- 已分配binder_buffer为零，异步可用空间约为520k；
- proc->todo队列为空；

**Debug Tips：**

- 当binder内存紧张时，可查看`free async space`和`buffers:`字段；
- 当系统空闲时，一般来说`ready_threads` = `requested_threads_started` + `BC_ENTER_LOOPER`； 当系统繁忙时`ready_threads`可能为0.
- 例如system_server进程的`ready_threads`线程个数越少，系统可能处于越繁忙的状态；
- 绝大多数的进程`max_threads` = 15，而surfaceflinger最大线程个数为4，servicemanager最大线程个数为0(只有主线程)；
- `pending transactions`:是指该进程的todo队列事务个数

例如，想查看当前系统所有进程的异步可用内存情况，可执行：

    adb shell cat /d/binder/stats | egrep "proc |free async space"

#### 相关说明

	struct binder_stats {
		int br[_IOC_NR(BR_FAILED_REPLY) + 1]; //统计各个binder响应码的个数
		int bc[_IOC_NR(BC_DEAD_BINDER_DONE) + 1]; //统计各个binder请求码的个数
		int obj_created[BINDER_STAT_COUNT]; //统计各种obj的创建个数
		int obj_deleted[BINDER_STAT_COUNT]; //统计各种obj的删除个数
	};

其中obj的个数由一个枚举变量`binder_stat_types`定义。


统计创建与删除的对象

`binder_stat_types`中定义的量：

|类型|含义|
|---|---|
|BINDER_STAT_PROC|binder进程|
|BINDER_STAT_THREAD|binder线程|
|BINDER_STAT_NODE|binder节点|
|BINDER_STAT_REF|binder引用|
|BINDER_STAT_DEATH|binder死亡|
|BINDER_STAT_TRANSACTION|binder事务|
|BINDER_STAT_TRANSACTION_COMPLETE|binder已完成事务|


每个类型相应的调用方法：

|类型|创建调用|删除调用|
|---|---|
|BINDER_STAT_PROC|binder_open|binder_deferred_release
|BINDER_STAT_THREAD|binder_get_thread|binder_free_thread
|BINDER_STAT_NODE|binder_new_node|binder_thread_read/ binder_node_release/  binder_dec_node
|BINDER_STAT_REF|binder_get_ref_for_node|binder_delete_ref|
|BINDER_STAT_DEATH|binder_thread_write|binder_thread_read/ binder_release_work/  binder_delete_ref|
|BINDER_STAT_TRANSACTION|binder_transaction|binder_thread_read/ binder_transaction/ binder_release_work/  binder_pop_transaction|
|BINDER_STAT_TRANSACTION_COMPLETE|binder_transaction|binder_thread_read/ binder_transaction/ binder_release_work|


### 2.2 state

    cat /d/binder/state

执行上述语句，所对应的函数`binder_state_show`，输出当前系统binder_proc, binder_node等信息；

#### 2.2.1 整体信息
输出所有死亡节点的信息

    dead nodes:
      node 24713573: u0000007f9fe0c6c0 c0000007f9fe63700 hs 1 hw 1 ls 0 lw 0 is 1 iw 1 proc 12396
      node 24712275: u0000007f9d5f0a80 c0000007fa82d1880 hs 1 hw 1 ls 0 lw 0 is 1 iw 1 proc 12396


#### 2.2.2 各进程信息

    proc 18650
      thread 18650: l 00
      thread 18658: l 00
      thread 18663: l 12
      thread 18665: l 11
      node 24805986: u00000000e153f070 c00000000e197dd80 hs 1 hw 1 ls 0 lw 0 is 1 iw 1 proc 12396
      node 24805990: u00000000e153f090 c00000000e197dda0 hs 1 hw 1 ls 0 lw 0 is 1 iw 1 proc 12396
      ref 24804528: desc 0 node 1 s 1 w 1 d 0000000000000000
      ref 24804531: desc 1 node 24532956 s 1 w 1 d 0000000000000000
      buffer 24805817: ffffff8018e00050 size 1896:0 delivered
      buffer 24806788: ffffff8018e00808 size 152:0 delivered

遍历进程的thread/node/ref/buffer信息.  当然如果存在,还会有pending transaction信息.

Tips:

- pending transaction: 记录当前所有进程和线程 TODO队列的transaction.
- outgoing transaction: 当前线程transaction_stack, 由该线程发出的事务;
- incoming transaction: 当前线程transaction_stack, 由需要线程接收的事务;
- pending transactions: 记录当前进程总的pending事务;

#### 2.2.3 proc

    cat /d/binder/proc/<pid>

可查看单独每个进程更为详细的信息，锁对应的函数`binder_proc_show`. 这个等价于小节[2.2.2]的内容.

### 2.3 transaction_log

    cat /d/binder/transaction_log

输出结果：


    357140: async from 8963:9594 to 10777:0 node 145081 handle 717 size 172:0
    357141: call  from 8963:9594 to 435:0 node 1 handle 0 size 80:0
    357142: reply from 435:435 to 8963:9594 node 0 handle 0 size 24:8


解释：

`debug_id`: `call_type` from `from_proc`:`from_thread` to `to_proc`:`to_thread` node `to_node` handle `target_handle` size `data_size`:`offsets_size`

call_type：有3种，分别为async, call, reply.

`transaction_log`以及还有`binder_transaction_log_failed`会只会记录最近的32次的transaction过程.

### 2.4 failed_transaction_log

    24423418: async from 713:713 to 1731:0 node 1809 handle 1 size 156:0
    24423419: reply from 733:5038 to 1731:4738 node 0 handle -1 size 0:0
    0: async from 782:1138 to 0:0 node 974 handle 8 size 88:8

解释: 跟transaction_log是一个原理, 不同的时此处有时候to_proc=0,代表着远程进程已挂.

### 2.5 transactions

    binder transactions:
    proc 20256
      buffer 348035: ffffff800a280050 size 212:0 delivered
    ...

解释：

- pid=20256进程，buffer的data_size=212，offsets_size=0，delivered代表已分发的内存块
- 该命令遍历输出所有进程的情况，可以看出每个进程buffer的分发情况。
