---
layout: post
title:  "Binder子系统之调试分析(三)"
date:   2016-09-03 22:20:00
catalog:  true
tags:
    - android
    - binder
---


### 一. binder调试信息

#### 1.1 binder_thread

调用方法:print_binder_thread

    thread 8980: l 12 //tid=8980，looper=12

关于looper状态值:

    BINDER_LOOPER_STATE_REGISTERED  = 0x01, // 创建注册线程BC_REGISTER_LOOPER
    BINDER_LOOPER_STATE_ENTERED     = 0x02, // 创建主线程BC_ENTER_LOOPER
    BINDER_LOOPER_STATE_EXITED      = 0x04, // 已退出
    BINDER_LOOPER_STATE_INVALID     = 0x08, // 非法
    BINDER_LOOPER_STATE_WAITING     = 0x10, // 等待中
    BINDER_LOOPER_STATE_NEED_RETURN = 0x20, // 需要返回

所以`0x12` = `BINDER_LOOPER_STATE_ENTERED | BINDER_LOOPER_STATE_WAITING`，代表的是等待就绪状态且由为binder主线程.
简单说,looper值, 十位为1代表处于binder_thread_read()状态, 个位为1代表已注册的binder线程,个位为2代表binder主线程.

####  1.2 binder_node

关于binder_node的输出信息:print_binder_node()

例如:

    node 3079465: u0000005593cc3540 c0000005593f37030 hs 1 hw 1 ls 0 lw 0 is 1 iw 1 proc 8963

含义:

- debug_id = 3079465
- ptr = u0000005593cc3540
- cookies = c0000005593f37030
- has_strong_ref(hs) = 1
- has_weak_ref(hw) = 1
- local_strong_refs(ls) = 0
- local_weak_refs(lw) = 0
- internal_strong_refs(is) = 1
- count: (node->refs总引用次数) = 1
- proc: (node->refs->proc->pid) = 8963

#### 1.3 binder_ref

调用方法: print_binder_ref()

    //含义：ref `debug_id`:`desc` `node` `node->debug_id` `strong` `weak` `death`
    ref 340122: desc 1 node 340121 s 1 w 1 d ffffffc04f90a340

输出binder_ref结构体成员变量:

- `node`是指当 ref->node->proc为空则代表node已死亡,采用`deadnode`,否则`node`.
- `death`: 应用注册死亡通知时，此域不为空.

#### 1.4 binder_buffer

调用方法: print_binder_buffer()

    //含义：buffer `debug_id`:`data` `data_size`:`offsets_size` `transaction`
    buffer 3473176: ffffff8007700218 size 0:0 delivered

输出的便是binder_buffer结构体的成员变量,其中`transaction`不为空,则为active,否则为delivered.


#### 1.5 binder_transaction

print_binder_transaction

    static void print_binder_transaction(struct seq_file *m, const char *prefix,
    				     struct binder_transaction *t)
    {
    	seq_printf(m,
    		   "%s %d: %p from %d:%d to %d:%d code %x flags %x pri %ld r%d",
    		   prefix, t->debug_id, t,
    		   t->from ? t->from->proc->pid : 0,
    		   t->from ? t->from->pid : 0,
    		   t->to_proc ? t->to_proc->pid : 0,
    		   t->to_thread ? t->to_thread->pid : 0,
    		   t->code, t->flags, t->priority, t->need_reply);
    	if (t->buffer == NULL) {
    		seq_puts(m, " buffer free\n");
    		return;
    	}
    	if (t->buffer->target_node)
    		seq_printf(m, " node %d",
     		   t->buffer->target_node->debug_id);
    	seq_printf(m, " size %zd:%zd data %p\n",
    		   t->buffer->data_size, t->buffer->offsets_size,
    		   t->buffer->data);
    }


接下来,分别说说系统中几个常见进程:`surfaceflinger`, `mediaserver`, `servicemanager`, `system_server`


### 二. mediaserver


        USER      PID   PPID  VSIZE  RSS   WCHAN              PC  NAME
        media     8814  1     128376 16068 binder_thr 00f6da2db0 S /system/bin/mediaserver
        media     9304  8814  128376 16068 binder_thr 00f6da2db0 S Binder_1
        media     9305  8814  128376 16068 binder_thr 00f6da2db0 S Binder_2
        media     22609 8814  128376 16068 binder_thr 00f6da2db0 S Binder_3

#### 2.1 stats

    proc 8814
      threads: 8
      requested threads: 0+2/15
      ready threads 4
      free async space 520192
      nodes: 13
      refs: 14 s 14 w 14
      buffers: 0
      pending transactions: 0


进程mediaserver:

- 处于ready状态的binder线程个数为4:
- BC_ENTER_LOOPER创建2个binder线程
- BC_REGISTER_LOOPER创建2个binder线程

#### 2.2 proc/8814

    proc 8814
      thread 8814: l 12
      thread 9294: l 00
      thread 9296: l 00
      thread 9297: l 00
      thread 9299: l 00
      thread 9304: l 12
      thread 9305: l 11
      thread 22609: l 11

### 三. servicemanager

单线程的进程:

    system    435   1     3872   1040  binder_thr 7fb462bcd4 S /system/bin/servicemanager


    proc 435
      threads: 1
      requested threads: 0+0/0
      ready threads 1
      free async space 65536
      nodes: 1
      refs: 130 s 130 w 0
      buffers: 0
      pending transactions: 0



      proc 435
        thread 435: l 12
        node 1: u0000000000000000 c0000000000000000 hs 1 hw 1 ls 1 lw 1 is 72 iw 72 proc ...

该binder_thread是由BC_ENTER_LOOPER所创建的binder主线程, 只有一个binder_node对象, 被72个进程所使用.servicemanager作为服务管家,被系统大量进程所使用.


### 四. system_server

    system    8963  8794  2337380 139776 SyS_epoll_ 7f950f2be4 S system_server
    system    8980  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_1
    system    8981  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_2
    system    9407  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_3
    system    9411  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_4
    system    9472  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_5
    system    9513  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_6
    system    9590  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_7
    system    9591  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_8
    system    9592  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_9
    system    9594  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_A
    system    9596  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_B
    system    9860  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_C
    system    9862  8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_D
    system    10074 8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_E
    system    10081 8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_F
    system    10082 8963  2337092 138556 binder_thr 7f950f2cd4 S Binder_10


#### 4.1 stats

    proc 8963
      threads: 50
      requested threads: 0+15/15
      ready threads 16
      free async space 520192
      nodes: 596
      refs: 951 s 950 w 950
      buffers: 3
      pending transactions: 0

进程system_server:

- 处于ready状态的binder线程个数为16:
- BC_ENTER_LOOPER创建1个binder线程
- BC_REGISTER_LOOPER创建15个binder线程

#### 4.2 proc/8963

    proc 8963
      thread 8963: l 00
      thread 8976: l 00
      thread 8980: l 12
      thread 8981: l 11
      ...

      buffer 3263909: ffffff8007700150 size 8:0 delivered
      buffer 3468983: ffffff80077001a8 size 24:8 delivered
      buffer 3473176: ffffff8007700218 size 0:0 delivered


8976作为binder主线程,已使用的binder buffer个数为3.

### 五. surfaceflinger


    system    492   436   192320 21360 binder_thr 7f99cffcd4 S Binder_2
    system    3068  436   192320 21360 binder_thr 7f99cffcd4 S Binder_3
    system    4063  436   192320 21360 binder_thr 7f99cffcd4 S Binder_4
    system    8317  436   192320 21360 binder_thr 7f99cffcd4 S Binder_5

#### 5.1 stats

    proc 436
      threads: 8
      requested threads: 0+4/4
      ready threads 5
      free async space 520192
      nodes: 50
      refs: 6 s 5 w 6
      buffers: 0
      pending transactions: 0
      ...


进程surfaceflinger:

- 处于ready状态的binder线程个数为5:
- BC_ENTER_LOOPER创建1个binder主线程
- BC_REGISTER_LOOPER创建4个binder线程
- max_threads = 4
- binder_thread个数为8
- 已分配的buffer个数为0

#### 5.2 proc/436

```Java
proc 436
thread 436: l 00
thread 490: l 12
thread 492: l 11
thread 499: l 00
thread 500: l 00
thread 3068: l 11
thread 4063: l 11
thread 8317: l 11

node 3079465: u0000005593cc3540 c0000005593f37030 hs 1 hw 1 ls 0 lw 0 is 1 iw 1 proc 8963
node 3076788: u0000005593f270d0 c0000005594049818 hs 1 hw 1 ls 0 lw 0 is 2 iw 2 proc 9687 8963
...

ref 18: desc 0 node 1 s 1 w 1 d           (null)
ref 340122: desc 1 node 340121 s 1 w 1 d ffffffc04f90a340
...
```Java

已知该进程有8个binder_thread,其中

- 4个线程处于0x11 = `BINDER_LOOPER_STATE_REGISTERED | BINDER_LOOPER_STATE_WAITING`,代表的是等待就绪状态
- 1个线程处于0x12 = `BINDER_LOOPER_STATE_ENTERED | BINDER_LOOPER_STATE_WAITING`,代表的是等待就绪状态

### 六. 小结

- `mediaserver`和`servicemanager`的主线程都是binder线程; `surfaceflinger`和`system_server`的主线程并非binder线程
- binder线程分为binder主线程和binder普通线程, binder主线程一般是`binder_1`或者进程的主线程.
- `cat /d/binder/stats`和`cat /d/binder/proc/<pid>`是分析系统binder状态的重要信息.

本文举例的这几个重要进程情况：

|进程|max|BC_REGISTER_LOOPER|BC_ENTER_LOOPER|
|---|---|
|surfaceflinger|4|4|1|
|mediaserver|15|2|2|
|servicemanager|0|1|0|
|system_server|15|15|1|

BC_REGISTER_LOOPER + BC_ENTER_LOOPER = max + 1，则代表该进程中的binder线程已达上限。 可见, mediaserver具有继续创建新线程的能力,而其他几个进程都以达到可创建的binder线程上限.
