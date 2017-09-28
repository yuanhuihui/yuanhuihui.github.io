---
layout: post
title:  "Linux文件系统"
date:   2017-09-02 23:29:50
catalog:    true
tags:
    - linux

---

    kernel/include/linux/fs.h


## 一. 文件系统

Linux系统有一句话叫“万物皆文件”，这正是Linux系统设计巧妙的地方。既然万物都可抽象为文件系统，
那么内核需要一层软件层--虚拟文件系统(Virtual File System, 简称VFS)，用于定义所有通用的文件系统
的相关系统调用。 VFS是物理文件系统与上层服务的抽象接口层，只存在于内存，系统启动时建立，系统关闭是消失，
不会被保存到磁盘。

文件系统有Ext3, NTFS，/proc等等，另外，常见的socket，binder操作都是基于文件系统的。

接下来，详细说一说VFS。

## 二. VFS

文件系统主要组成：

- superblock (超级块): 记录fs相关信息，如果是磁盘文件系统，则对应于磁盘上的文件系统控制块；
- inode (索引节点)：记录文件的信息，如果是磁盘文件系统，则对应于磁盘上的文件控制块；每个inode有唯一的index编号；
- file (文件)：记录打开文件与进程间的相关信息，只有当进程访问文件期间，存在于内存之中；
- dentry (目录项)：记录目录项与对应文件的相关信息。


### 2.1 super_block
[-> fs.h]

    struct super_block {
      struct list_head  s_list;    //第一个成员，双向链表，用于连接所有的超级块
      dev_t      s_dev;    //设备标识符
      unsigned char    s_blocksize_bits; //块大小(以位为单位)
      unsigned long    s_blocksize;     //块大小(以字节为单位)
      loff_t      s_maxbytes;         //文件的最大长度
      
      struct file_system_type  *s_type;  //文件系统类型
      const struct super_operations  *s_op; //超级块的操作函数集合
      const struct dquot_operations  *dq_op;
      const struct quotactl_ops  *s_qcop;
      const struct export_operations *s_export_op;
      unsigned long    s_flags;  //状态位
      unsigned long    s_magic;  //每个超级块都有唯一的魔数
      struct dentry    *s_root;  //超级块指向根目录的dentry结构体
      struct rw_semaphore  s_umount; //用于卸载文件系统的读写信号量
      int      s_count;  //引用计数
      atomic_t    s_active;
      const struct xattr_handler **s_xattr;

      struct list_head  s_inodes;  //该文件系统上的所有inode结构体
      struct hlist_bl_head  s_anon;
      struct list_head  s_mounts;
      struct block_device  *s_bdev;
      struct backing_dev_info *s_bdi;
      struct mtd_info    *s_mtd;
      struct hlist_node  s_instances;
      struct quota_info  s_dquot;
      struct sb_writers  s_writers;

      char s_id[32];        /* Informational name */
      u8 s_uuid[16];        /* UUID */

      void       *s_fs_info;
      unsigned int    s_max_links;
      fmode_t      s_mode;
      u32       s_time_gran;

      struct mutex s_vfs_rename_mutex;  /* Kludge */
      char *s_subtype;

      char __rcu *s_options;
      const struct dentry_operations *s_d_op;

      int cleancache_poolid;
      struct shrinker s_shrink;
      atomic_long_t s_remove_count;
      int s_readonly_remount;

      struct workqueue_struct *s_dio_done_wq;
      struct hlist_head s_pins;

      struct list_lru    s_dentry_lru ____cacheline_aligned_in_smp;
      struct list_lru    s_inode_lru ____cacheline_aligned_in_smp;
      struct rcu_head    rcu;

      int s_stack_depth;
    };

超级块代表一个文件系统


### open

fd = open("/dev/binder")

用户关心的是文件路径, 内核关心的是相对应的inode;

该方法的主要功能:

- 为进程创建file结构体;
- task_struct的files_struct记录当前进程所有已打开的file结构体;

类似说明:

- 文件描述符fd: 类似handle
- 每个进程都会创建file; 类似binder_ref
- 文件真正对应的inode: 类似binder_node

### 路由

当前进程current->files里面根据fd能找到file.


### dup

该方法的功能是创建一个新的fd, 将两个fd文件描述符都执行同一个文件. 这个过程并不会创建file对象, 只是增加引用计数file->f_count
