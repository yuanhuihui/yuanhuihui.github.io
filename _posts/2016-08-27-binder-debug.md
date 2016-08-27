---
layout: post
title:  "Binder外传之调试分析(一)"
date:   2016-08-27 09:30:00
catalog:  true
tags:
    - android
    - binder
---

## 一. 概述

在博客以前有写过关于binder系列，大概写了10篇关于binder的文章，从binder驱动，到native层，再到framework，一路写到app层的使用。有兴趣的可以看看
[Binder系列—开篇](http://gityuan.com/2015/10/31/binder-prepare/)。

虽然写完binder系列，其实还是有很多细节没有讲透彻，计划再一个`binder外传`系列，不会涉及太多的源码，更多的是将binder从上至下再串一串。本文先从Binder调试说一说，接下来进入正题。

## 二.Binder驱动调试

看过Binder系列文章的同学，会发现Binder IPC过程最终都交给Binder Driver来完成，这是真正干跨进程通信活的地方，那么意味着这里会有各种核心的通信log，比如binder open, mmap, ioctl等操作都可以通过某种方式来打开相应调试信息来分析。对于binder driver存在16类调试log开关，如下:

### 2.1 debug_mask

|Log类型|mask值|解释|
|---|---|---|
|BINDER_DEBUG_USER_ERROR|1|用户使用错误|
|BINDER_DEBUG_FAILED_TRANSACTION|2|transaction失败|
|BINDER_DEBUG_DEAD_TRANSACTION|4|transaction死亡
|BINDER_DEBUG_OPEN_CLOSE|8|**binder的open/close/mmap信息**
|BINDER_DEBUG_DEAD_BINDER|16|binder/node的正常或者异常死亡
|BINDER_DEBUG_DEATH_NOTIFICATION|32|binder死亡通知信息|
|BINDER_DEBUG_READ_WRITE|64|binder的read/write信息
|BINDER_DEBUG_USER_REFS|128|binder引用计数
|BINDER_DEBUG_THREADS|256|**binder_thread信息**|
|BINDER_DEBUG_TRANSACTION|512|transaction信息
|BINDER_DEBUG_TRANSACTION_COMPLETE |1024|transaction完成信息
|BINDER_DEBUG_FREE_BUFFER  |2048|binder buffer释放信息
|BINDER_DEBUG_INTERNAL_REFS  |4096|binder内部引用计数
|BINDER_DEBUG_BUFFER_ALLOC |8192|**同步内存分配信息**
|BINDER_DEBUG_PRIORITY_CAP  |16384|调整binder线程的nice值
|BINDER_DEBUG_BUFFER_ALLOC_ASYNC  |32768|**异步内存分配信息**

每一项mask值通过将1左移N位，也就是等于2的倍数

### 2.2 调试开关

通过节点`/sys/module/binder/parameters/debug_mask`来动态控制选择开启上表中的debug log.

(1)例如打开`BINDER_DEBUG_OPEN_CLOSE`调试开关，则通过adb shell执行如下命令：

    echo 8 > /sys/module/binder/parameters/debug_mask

(2)再例如同时打开`BINDER_DEBUG_FAILED_TRANSACTION`和`BINDER_DEBUG_DEAD_BINDER`，将各个mask值相加即可，16+2 =18.

    echo 18 > /sys/module/binder/parameters/debug_mask

(3)要打开多个开关，只需将各个开关的mask值相加写入debug_mask即可。打开调试开关后，可通过adb shell，执行`cat /proc/kmsg | grep binder`，即可查看相应的binder log信息。


### 2.3 原理

mask相加，其实现其实是利用或运算，通过一个变量控制16个开关，而不是采用16个变量，这是比较经典的设计方案。在binder Driver中通过下面语句完成节点控制debug的功能：

    module_param_named(debug_mask, binder_debug_mask, uint, S_IWUSR | S_IRUGO);

module_param_named的功能：

- 首先会生成`/sys/module/binder/parameters/`目录；
- module_param_named的第一个参数为`debug_mask`，则会在parameters目录下创建`debug_mask`文件节点；
- 当通过`echo NUM > debug_mask`命令，会触发动态修改module_param_named的第二个参数`binder_debug_mask`值，这是个静态uint32_t类型数据；
- 驱动中输出debug log都是通过调用binder_debug()方法，该方法通过与`binder_debug_mask`变量做或运算来判断相应类型的log信息是否需要输出。

binder_debug宏定义，如下：

    #define binder_debug(mask, x...) \
    	do { \
    		if (binder_debug_mask & mask) \
    			pr_info(x); \
    	} while (0)

当然，也可以通过代码直接修改`binder_debug_mask`值来控制调试开关，默认值为：

    binder_debug_mask = BINDER_DEBUG_USER_ERROR |
      BINDER_DEBUG_FAILED_TRANSACTION | BINDER_DEBUG_DEAD_TRANSACTION;

另外，在`/sys/module/binder/parameters/`目录还有另外两个节点，分别为proc_no_lock, stop_on_user_error，其实现原理也基本差不多。

- **proc_no_lock节点**：与之对应binder驱动的`binder_debug_no_lock`变量，这是bool类型变量，该开关含义为在输出某些统计调试方法中是否加锁；默认为N；
- **stop_on_user_error节点**：与之对应binder驱动的`binder_stop_on_user_error`变量，这是int类型变量，另外，修改该节点还会触发调用binder_set_stop_on_user_error()方法;该开关含义是指当触发BINDER_DEBUG_USER_ERROR类型错误时是否让整个binder系统进入休眠等待状态，默认值为0，代表不会即便发生该类型错误系统不会被挂住，而是继续执行。

## 三 实战

### 3.1 BINDER_DEBUG_OPEN_CLOSE

当打开调试开关`BINDER_DEBUG_OPEN_CLOSE`时，主要输出binder的open, mmap, close, flush, release方法中的log信息

具体kernel log，如下：

1. **binder_open:** 4681:4681  
2. **binder_mmap:** 4681 b6b42000-b6c40000 (1016 K) vma 200071 pagep 79f  
3. **binder:** 4681 close vm area b6b42000-b6c40000 (1016 K) vma 2220051 pagep 79f  
4. **binder_flush:** 4681 woke 0 threads  
5. **binder_release:** 4681 threads 1, nodes 0 (ref 0), refs 2, active transactions 0, buffers 1, pages 1



### 3.2 解析

上面各行log所对应的信息项：

1. **binder_open:** `group_leader->pid`:`pid`  
2. **binder_mmap:** `pid` vm_start-vm_end (`vm_size` K) vma vm_flags pagep VMA访问权限
3. **binder:** `pid` close vm area vm_start-vm_end (`vm_size` K) vma vm_flags pagep VMA访问权限  
4. **binder_flush:** `pid` woke `wake_count` threads  
5. **binder_release:** `pid` threads `threads`, nodes `nodes` (ref `incoming_refs`), refs `outgoing_refs`, active transactions `active_transactions`, buffers `buffers`, pages `page_count`

进一步说明其中部分关键词的含义：

- `wake_count`:是指该进程唤醒了处于`BINDER_LOOPER_STATE_WAITING`休眠等待状态的线程个数；
- `threads`是指该进程中的线程个数；
- `nodes`代表该进程中创建binder_node个数；
- `incoming_refs`指向当前node的refs个数；
- `outgoing_refs`指向其他进程的refs个数；
- `active_transactions`是指当前进程中所有binder线程的transactions总和；
- `buffers`是指当前进程已分配的buffer个数；
- `page_count`是指当前进程已分配的物理page个数。

### 3.3 对应函数

上述log每一行相对应的函数：

1. binder_open()
2. binder_vma_open()  或者 binder_mmap()
3. binder_vma_close()
4. binder_deferred_flush()   由binder_flush调用（见下方调用栈）
5. binder_deferred_release()  由binder_release调用（见下方调用栈）

**binder_flush调用栈：**

    binder_flush  
      binder_defer_work(proc, BINDER_DEFERRED_FLUSH);
        queue_work(binder_deferred_workqueue, &binder_deferred_work);
          binder_deferred_func    //通过 DECLARE_WORK(binder_deferred_work, binder_deferred_func);
            binder_deferred_flush

**binder_release调用栈：**

    binder_release  
      binder_defer_work(proc, BINDER_DEFERRED_RELEASE);
        queue_work(binder_deferred_workqueue, &binder_deferred_work);
          binder_deferred_func    //通过 DECLARE_WORK(binder_deferred_work, binder_deferred_func);
            binder_deferred_release


当binder所在进程结束时会调用binder_release。 binder_open打开binder驱动/dev/binder，这是字符设备，获取文件描述符。在进程结束的时候会有一个关闭文件系统的过程中会调用驱动close方法，该方法相对应的是release()方法。

但并不是每个close系统调用都会触发调用release()方法. 只有真正释放设备数据结构才调用release(),内核维持一个文件结构被使用多少次的计数，即便是应用程序没有明显地关闭它打开的文件也适用: 内核在进程exit()时会释放所有内存和关闭相应的文件资源, 通过使用close系统调用最终也会release binder.

## 四. 小结

本文主要介绍控制调试开关和各个开关的含义及原理，最后再通过一个实例来进一步来说明其中一项开关打开后的log信息该如何分析。后续会介绍更多的调试含义和调试工具，以及从上至下binder是如何通信。
