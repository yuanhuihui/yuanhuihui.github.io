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
的相关系统调用。 VFS是物理文件系统与上层服务的抽象接口层，只存在于内存，系统启动时建立，系统关闭时消失，
不会被保存到磁盘。

文件系统有Ext3, NTFS，/proc等等，另外，常见的socket，binder操作都是基于文件系统的。

接下来，详细说一说VFS。

## 二. VFS

文件系统主要组成：

- 超级块 (superblock): 记录fs相关信息，如果是磁盘文件系统，则对应于磁盘上的文件系统控制块；
- 索引节点 (inode)：记录文件的信息，如果是磁盘文件系统，则对应于磁盘上的文件控制块；每个inode有唯一的index编号；
- 文件 (file)：记录打开文件与进程间的相关信息，只有当进程访问文件时存在内存中；
- 目录项 (dentry)：记录目录项与对应文件的相关信息。


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

      char s_id[32];        
      u8 s_uuid[16];        
      void       *s_fs_info;
      unsigned int    s_max_links;
      fmode_t      s_mode;
      u32       s_time_gran;

      struct mutex s_vfs_rename_mutex; 
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

超级块代表一个文件系统，其中s_op是指向超级块的操作函数集合。

### 2.2 inode

    struct inode {
    	umode_t			i_mode;
    	unsigned short		i_opflags;
    	kuid_t			i_uid;
    	kgid_t			i_gid;
    	unsigned int		i_flags;

    	const struct inode_operations	*i_op;
    	struct super_block	*i_sb;
    	struct address_space	*i_mapping;

    #ifdef CONFIG_SECURITY
    	void			*i_security;
    #endif

    	/* Stat data, not accessed from path walking */
    	unsigned long		i_ino;
    	/*
    	 * Filesystems may only read i_nlink directly.  They shall use the
    	 * following functions for modification:
    	 *
    	 *    (set|clear|inc|drop)_nlink
    	 *    inode_(inc|dec)_link_count
    	 */
    	union {
    		const unsigned int i_nlink;
    		unsigned int __i_nlink;
    	};
    	dev_t			i_rdev;
    	loff_t			i_size;
    	struct timespec		i_atime;
    	struct timespec		i_mtime;
    	struct timespec		i_ctime;
    	spinlock_t		i_lock;	/* i_blocks, i_bytes, maybe i_size */
    	unsigned short          i_bytes;
    	unsigned int		i_blkbits;
    	blkcnt_t		i_blocks;

    #ifdef __NEED_I_SIZE_ORDERED
    	seqcount_t		i_size_seqcount;
    #endif

    	/* Misc */
    	unsigned long		i_state;
    	struct mutex		i_mutex;

    	unsigned long		dirtied_when;	/* jiffies of first dirtying */

    	struct hlist_node	i_hash;
    	struct list_head	i_wb_list;	/* backing dev IO list */
    	struct list_head	i_lru;		/* inode LRU list */
    	struct list_head	i_sb_list;
    	union {
    		struct hlist_head	i_dentry;
    		struct rcu_head		i_rcu;
    	};
    	u64			i_version;
    	atomic_t		i_count;
    	atomic_t		i_dio_count;
    	atomic_t		i_writecount;
    #ifdef CONFIG_IMA
    	atomic_t		i_readcount; /* struct files open RO */
    #endif
    	const struct file_operations	*i_fop;	/* former ->i_op->default_file_ops */
    	struct file_lock	*i_flock;
    	struct address_space	i_data;
    #ifdef CONFIG_QUOTA
    	struct dquot		*i_dquot[MAXQUOTAS];
    #endif
    	struct list_head	i_devices;
    	union {
    		struct pipe_inode_info	*i_pipe;
    		struct block_device	*i_bdev;
    		struct cdev		*i_cdev;
    	};

    	__u32			i_generation;

    #ifdef CONFIG_FSNOTIFY
    	__u32			i_fsnotify_mask; /* all events this inode cares about */
    	struct hlist_head	i_fsnotify_marks;
    #endif

    	void			*i_private; /* fs or device private pointer */
    };


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

### read


VFS作为通用文件系统，当执行read()方法，经过系统调用,执行相应的方法sys_read()。
文件在内核内存中由file结构体来表示，其中有一个f_op字段，该字段包含其指向的文件系统的函数指针。
那么上层的read()，便转换为file->f_op->read()方法。

### 路由

当前进程current->files里面根据fd能找到file.


### dup

该方法的功能是创建一个新的fd, 将两个fd文件描述符都指向同一个文件. 这个过程并不会创建file对象, 只是增加引用计数file->f_count

http://www.cnblogs.com/hzl6255/archive/2012/12/31/2840854.html
