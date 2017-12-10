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
        //创建名为binder的工作队列
        binder_deferred_workqueue = create_singlethread_workqueue("binder");
        ...

        //创建各种用于调试的debugfs文件
        binder_debugfs_dir_entry_root = debugfs_create_dir("binder", NULL);
        if (binder_debugfs_dir_entry_root)
            binder_debugfs_dir_entry_proc = debugfs_create_dir("proc",
                             binder_debugfs_dir_entry_root);
        if (binder_debugfs_dir_entry_root) {
            ... //state, stats, transactions等节点
        }

        //分配binder_devices_param
        device_names = kzalloc(strlen(binder_devices_param) + 1, GFP_KERNEL);
        strcpy(device_names, binder_devices_param);
        while ((device_name = strsep(&device_names, ","))) {
             //依次初始化binder,hwbinder,vndbinder这3个驱动
            ret = init_binder_device(device_name);
        }

        return ret;
        return ret;
    }

该方法主要完成3件事情：

1. 创建一个名叫“binder”的进程，其父进程是kthreadd，kthreadd是所有内核进程的鼻祖，会创建各种内核工作线程kworker。
2. 创建各种用于调试的debugfs文件
3. 依次初始化binder,hwbinder,vndbinder这3个驱动，注册成misc杂项设备,


/d/binder

debugfs_create_dir是指在debugfs文件系统中创建一个目录，返回值是指向dentry的指针。当kernel中禁用debugfs的话，返回值是-%ENODEV。默认是禁用的。如果需要打开，在目录`/kernel/arch/arm64/configs/`下找到目标defconfig文件中添加一行`CONFIG_DEBUG_FS=y`，再重新编译版本，即可打开debug_fs。


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

### 5.5.4 Binder调试技巧



### 需要添加的内容

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
