---
layout: post
title:  "5.5 探究Binder Driver"
date:   2014-01-05 09:30:00
catalog:  true
---

## 5.5 探究Binder Driver

### 5.5.1 Binder驱动初始化

Binder驱动是Android专用的，但底层的驱动架构与Linux驱动一样。binder驱动在以misc设备进行注册，作为虚拟字符设备，没有直接操作硬件，只是对设备内存的处理。对于Binder初始化的三部曲，依次是(binder_open)，映射(binder_mmap)，数据操作(binder_ioctl)。

![binder_driver](/images/binder/binder_dev/binder_driver.png)


用户态进入内核态，需要经过系统调用，比如打开Binder驱动方法的调用链为： open-> __open() -> binder_open()。 open()为用户空间的方法，__open()便是系统调用中相应的处理方法，通过查找，对应调用到内核binder驱动的binder_open()方法，至于其他的从用户态陷入内核态的流程也基本一致。

![binder_syscall](/images/binder/binder_dev/binder_syscall.png)

简单说，当用户空间调用open()方法，最终会调用binder驱动的binder_open()方法；mmap()/ioctl()方法也是同理，在Binder系列的后续文章从用户态进入内核态，都依赖于系统调用过程。


#### 1. binder_init

Binder驱动设备的初始化的代码如下所示。

    static int __init binder_init(void)
    {
        int ret;
        //1.创建名为binder的工作队列
        binder_deferred_workqueue = create_singlethread_workqueue("binder");
        ...

        //2.创建各种用于调试的debugfs文件
        binder_debugfs_dir_entry_root = debugfs_create_dir("binder", NULL);
        if (binder_debugfs_dir_entry_root)
            binder_debugfs_dir_entry_proc = debugfs_create_dir("proc",
                             binder_debugfs_dir_entry_root);
        if (binder_debugfs_dir_entry_root) {
            ... //state, stats, transactions等节点
        }

        //3. 依次初始化binder,hwbinder,vndbinder这3个设备驱动节点
        device_names = kzalloc(strlen(binder_devices_param) + 1, GFP_KERNEL);
        strcpy(device_names, binder_devices_param);
        while ((device_name = strsep(&device_names, ","))) {
            ret = init_binder_device(device_name);
        }
        return ret;
    }


首先，创建一个工作队列binder_deferred_workqueue，运行在名叫“binder”的进程，其父进程是kthreadd，kthreadd是所有内核进程的鼻祖，会创建各种内核工作线程kworker。关于binder_deferred_workqueue工作队列用于处理以下3类可延迟执行的事件。

|Binder延迟状态|调用方法|
|---|---|
|BINDER_DEFERRED_FLUSH|binder_flush()|
|BINDER_DEFERRED_RELEASE|binder_release()|
|BINDER_DEFERRED_PUT_FILES|binder_vma_close()|

当进程关闭binder设备文件描述符的拷贝时，内核会调用binder_fops的flush, 从而调用binder_flush()； 当某个binder设备文件描述符的最后一个进程执行close()系统调用的时候，内核会调用binder_fops的release，从而调用binder_release()方法；
当binder所分配的vma关闭时，调用binder_vma_close()方法，以上这3个方法都是可以延迟执行的方法。


然后，创建各种用于调试的debugfs文件







/d/binder

debugfs_create_dir是指在debugfs文件系统中创建一个目录，返回值是指向dentry的指针。当kernel中禁用debugfs的话，返回值是-%ENODEV。默认是禁用的。如果需要打开，在目录`/kernel/arch/arm64/configs/`下找到目标defconfig文件中添加一行`CONFIG_DEBUG_FS=y`，再重新编译版本，即可打开debug_fs。




3. 依次初始化binder,hwbinder,vndbinder这3个驱动，注册成misc杂项设备,

binder_devices_param的值等于CONFIG_ANDROID_BINDER_DEVICES，该值是配置在kernel/android/configs/目录下的android-base.cfg文件， 从Android 8.0开始才有的，其值等于“binder,hwbinder,vndbinder”。

    static int __init init_binder_device(const char *name)
    {
        int ret;
        struct binder_device *binder_device;
        binder_device = kzalloc(sizeof(*binder_device), GFP_KERNEL);
        //初始化Binder设备的fops, context相关信息
        binder_device->miscdev.fops = &binder_fops;
        binder_device->miscdev.minor = MISC_DYNAMIC_MINOR;
        binder_device->miscdev.name = name;
        binder_device->context.binder_context_mgr_uid = INVALID_UID;
        binder_device->context.name = name;

        mutex_init(&binder_device->context.context_mgr_node_lock);
        //注册杂项设备
        ret = misc_register(&binder_device->miscdev);
        hlist_add_head(&binder_device->hlist, &binder_devices);
        return ret;





#### 2.1.1 misc_register

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


#### 1. binder_open

#### 2. binder_mmap

#### 3. binder_ioctl


### 5.5.2 基本数据结构

### 5.5.3 Binder通信协议

#### 1. BC_PROTOCOL

binder请求码是用enum binder_driver_command_protocol来定义的，是用于应用程序向binder驱动设备发送请求消息，应用程序包含Client端和Server端，以BC_开头，总15条；

|序号|请求码|作用|使用场景|
|---|---|
|1|BC_TRANSACTION|Client向Binder驱动发送请求数据|transact()|
|2|BC_REPLY||Server向Binder驱动发送请求数据|sendReply()|
|3|BC_FREE_BUFFER|释放内存|freeBuffer()|
|4|BC_ACQUIRE|binder_ref强引用加1|incStrongHandle()|
|5|BC_RELEASE|binder_ref强引用减1|decStrongHandle()|
|6|BC_INCREFS|binder_ref弱引用加1|incWeakHandle()|
|7|BC_DECREFS|binder_ref弱引用减1|decWeakHandle()|
|8|BC_ACQUIRE_DONE|binder_node强引用减1完成|executeCommand()|
|9|BC_INCREFS_DONE|binder_node弱引用减1完成|executeCommand()|
|10|BC_REGISTER_LOOPER|创建新的Binder线程|joinThreadPool()|
|11|BC_ENTER_LOOPER|Binder主线程进入looper|joinThreadPool()|
|12|BC_EXIT_LOOPER|Binder线程线程退出looper|joinThreadPool()|
|13|BC_REQUEST_DEATH_NOTIFICATION|注册死亡通知|requestDeathNotification()|
|14|BC_CLEAR_DEATH_NOTIFICATION|取消注册死亡通知|clearDeathNotification()|
|15|BC_DEAD_BINDER_DONE|已完成binder的死亡通知|executeCommand()|


（1） BC_TRANSACTION和BC_REPLY协议：是最常用的协议，用于向Binder驱动发起请求或者应答数据，传递参数便是binder_transaction_data结构体。

（2） BC_FREE_BUFFER协议：用于释放Binder通信所使用的buffer块，传递的参数是binder_transaction_data中的data.ptr.buffer，也就是所传递的Parcel数据块的内存指针。
    - 通过mmap()映射内存，其中ServiceManager映射的空间大小为128K，其他Binder应用进程映射的内存大小为1M-8K。
    - Binder驱动基于这块映射的内存采用最佳匹配算法来动态分配和释放，通过binder_buffer结构体中的`free`字段来表示相应的buffer是空闲还是已分配状态。对于已分配的buffers加入到binder_proc中的allocated_buffers红黑树;对于空闲的buffers加入到binder_proc中的free_buffers红黑树。
    - 当应用程序需要内存时，根据所需内存大小从free_buffers中找到最合适的内存，并放入allocated_buffers树；当应用程序处理完后必须尽快使用`BC_FREE_BUFFER`命令来释放该buffer，从而添加回到free_buffers树。

（3） BC_INCREFS、BC_ACQUIRE、BC_RELEASE、BC_DECREFS协议：作用是对binder的强/弱引用的计数操作，用于实现强/弱指针的功能，传递的参数的handle值。
BC_ACQUIRE_DONE和BC_INCREFS_DONE协议依次用于在接收到IPC.executeCommand()过程接收到BR_ACQUIRE和BR_INCREFS协议。

（4） Binder线程创建与退出，以下都是无参数协议
    - BC_ENTER_LOOPER：binder主线程(由应用层发起)的创建会向驱动发送该消息, 使用场景除了joinThreadPool()，还有setupPolling()过程；
    - BC_REGISTER_LOOPER：Binder用于驱动层决策而创建新的普通binder线程；
    - BC_EXIT_LOOPER：退出Binder线程，对于binder主线程是不能退出;joinThreadPool()的过程出现timeout,并且非binder主线程,则会退出该binder线程;

（5） BC_REQUEST_DEATH_NOTIFICATION和BC_CLEAR_DEATH_NOTIFICATION，分别是注册和取消注册死亡通知的功能， 传递的参数是handle和proxy
BC_DEAD_BINDER_DONE接收到IPC.executeCommand()过程接收到BR_DEAD_BINDER协议

（6） BC_ACQUIRE_RESULT和BC_ATTEMPT_ACQUIRE保留协议，目前暂没有实现。

#### 2. BR_PROTOCOL

binder响应码，是用enum binder_driver_return_protocol来定义的，是binder设备向应用程序回复的消息，，应用程序包含Client端和Server端，以BR_开头，总15条；

|响应码|参数类型|作用|
|---|---|---|
|1|BR_TRANSACTION|Binder驱动向Server端发送请求数据|
|2|BR_REPLY|Binder驱动向Client端发送回复数据|
|3|BR_TRANSACTION_COMPLETE|对请求发送的成功反馈|
|4|BR_ACQUIRE|binder_ref强引用加1|
|5|BR_RELEASE|binder_ref强引用减1|
|6|BR_INCREFS|binder_ref弱引用加1|
|7|BR_DECREFS|binder_ref弱引用减1|
|8|BR_SPAWN_LOOPER|创建新的Looper线程|
|9|BR_DEAD_BINDER|Binder驱动向client端发送死亡通知|
|10|BR_CLEAR_DEATH_NOTIFICATION_DONE|BC_CLEAR_DEATH_NOTIFICATION命令对应的响应码|
|11|BR_ERROR|操作发生错误|
|12|BR_OK|操作完成|
|13|BR_NOOP|不做任何事|
|14|BR_DEAD_REPLY|回复失败，往往是线程或节点为空|
|15|BR_FAILED_REPLY|回复失败，往往是transaction出错导致|

（1） BR_TRANSACTION和BR_REPLY协议：是最常用的协议，传递参数便是binder_transaction_data结构体；
BR_TRANSACTION_COMPLETE协议是指驱动接收到BC_TRANSACTION或则BC_REPLY协议，当Client端向Binder驱动发送BC_TRANSACTION命令后，Client会收到BR_TRANSACTION_COMPLETE命令，告知Client端请求命令发送成功；对于Server向Binder驱动发送BC_REPLY命令后，Server端会收到BR_TRANSACTION_COMPLETE命令，告知Server端请求回应命令发送成功。

（2） BR_ACQUIRE、BR_RELEASE、BR_INCREFS、BR_DECREFS协议：是与Client有四个相对应的BC协议；

（3） BR_SPAWN_LOOPER协议：binder驱动已经检测到进程中没有线程等待即将到来的事务。那么当一个进程接收到这条命令时，该进程必须创建一条新的服务线程并注册该线程，在接下来的响应过程会看到何时生成该响应码。

（4） BR_DEAD_BINDER和BR_CLEAR_DEATH_NOTIFICATION_DONE协议，用于处理Binder死亡回调相关事务

（5） BR_OK和BR_NOOP协议不做任何事，BR_DEAD_REPLY和BR_FAILED_REPLY代表Binder传输过程失败，BR_ERROR协议传递发生的错误码

（6） BR_ACQUIRE_RESULT，BR_ATTEMPT_ACQUIRE,以及BR_FINISHED保留协议，目前暂没有实现。


### 5.5.4 Binder调试技巧



============================

#### 4.3.1 binder_get_node

    static struct binder_node *binder_get_node(struct binder_proc *proc,
                 binder_uintptr_t ptr)
    {
      struct rb_node *n = proc->nodes.rb_node;
      struct binder_node *node;

      while (n) {
        node = rb_entry(n, struct binder_node, rb_node);

        if (ptr < node->ptr)
          n = n->rb_left;
        else if (ptr > node->ptr)
          n = n->rb_right;
        else
          return node;
      }
      return NULL;
    }

从binder_proc来根据binder指针ptr值，查询相应的binder_node。


#### 4.3.2 binder_new_node

    static struct binder_node *binder_new_node(struct binder_proc *proc,
                           binder_uintptr_t ptr,
                           binder_uintptr_t cookie)
    {
        struct rb_node **p = &proc->nodes.rb_node;
        struct rb_node *parent = NULL;
        struct binder_node *node;
        ... //红黑树位置查找

        //给新创建的binder_node 分配内核空间
        node = kzalloc(sizeof(*node), GFP_KERNEL);

        // 将新创建的node添加到proc红黑树；
        rb_link_node(&node->rb_node, parent, p);
        rb_insert_color(&node->rb_node, &proc->nodes);
        node->debug_id = ++binder_last_id;
        node->proc = proc;
        node->ptr = ptr;
        node->cookie = cookie;
        node->work.type = BINDER_WORK_NODE; //设置binder_work的type
        INIT_LIST_HEAD(&node->work.entry);
        INIT_LIST_HEAD(&node->async_todo);
        return node;
    }

#### 4.3.3 binder_get_ref_for_node

    static struct binder_ref *binder_get_ref_for_node(struct binder_proc *proc,
                  struct binder_node *node)
    {
      struct rb_node *n;
      struct rb_node **p = &proc->refs_by_node.rb_node;
      struct rb_node *parent = NULL;
      struct binder_ref *ref, *new_ref;
      //从refs_by_node红黑树，找到binder_ref则直接返回。
      while (*p) {
        parent = *p;
        ref = rb_entry(parent, struct binder_ref, rb_node_node);

        if (node < ref->node)
          p = &(*p)->rb_left;
        else if (node > ref->node)
          p = &(*p)->rb_right;
        else
          return ref;
      }

      //创建binder_ref
      new_ref = kzalloc_preempt_disabled(sizeof(*ref));

      new_ref->debug_id = ++binder_last_id;
      new_ref->proc = proc; //记录进程信息
      new_ref->node = node; //记录binder节点
      rb_link_node(&new_ref->rb_node_node, parent, p);
      rb_insert_color(&new_ref->rb_node_node, &proc->refs_by_node);

      //计算binder引用的handle值，该值返回给target_proc进程
      new_ref->desc = (node == binder_context_mgr_node) ? 0 : 1;
      //从红黑树最最左边的handle对比，依次递增，直到红黑树遍历结束或者找到更大的handle则结束。
      for (n = rb_first(&proc->refs_by_desc); n != NULL; n = rb_next(n)) {
        //根据binder_ref的成员变量rb_node_desc的地址指针n，来获取binder_ref的首地址
        ref = rb_entry(n, struct binder_ref, rb_node_desc);
        if (ref->desc > new_ref->desc)
          break;
        new_ref->desc = ref->desc + 1;
      }

      // 将新创建的new_ref 插入proc->refs_by_desc红黑树
      p = &proc->refs_by_desc.rb_node;
      while (*p) {
        parent = *p;
        ref = rb_entry(parent, struct binder_ref, rb_node_desc);

        if (new_ref->desc < ref->desc)
          p = &(*p)->rb_left;
        else if (new_ref->desc > ref->desc)
          p = &(*p)->rb_right;
        else
          BUG();
      }
      rb_link_node(&new_ref->rb_node_desc, parent, p);
      rb_insert_color(&new_ref->rb_node_desc, &proc->refs_by_desc);
      if (node) {
        hlist_add_head(&new_ref->node_entry, &node->refs);
      }
      return new_ref;
    }


handle值计算方法规律：

- 每个进程binder_proc所记录的binder_ref的handle值是从1开始递增的；
- 所有进程binder_proc所记录的handle=0的binder_ref都指向service manager；
- 同一个服务的binder_node在不同进程的binder_ref的handle值可以不同；






### 引用计数的问题

processPendingDerefs()过程会从mPendingStrongDerefs中取出数据，然后执行decStrong()操作。
而mPendingStrongDerefs的数据类型为Vector<BBinder*>，记录需要回收的BBinder，当收到BR_RELEASE时，才会将相应的BBinder放入mPendingStrongDerefs

Parcel, IPCThreadState, android_util_Binder.cpp, Binder.cpp

Parcel对象回收的时候， 会执行。

Parcel.release_object()
