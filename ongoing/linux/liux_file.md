#### 3.2.2 files_struct结构体
[-> kernel/include/linux/fdtable.h]

    struct files_struct {
    	atomic_t count; 
    	bool resize_in_progress;
    	wait_queue_head_t resize_wait;

    	struct fdtable __rcu *fdt;
    	struct fdtable fdtab;

      //写入部分在单独的高速缓存线
    	spinlock_t file_lock ____cacheline_aligned_in_smp;
    	int next_fd;
    	unsigned long close_on_exec_init[1];
    	unsigned long open_fds_init[1];
    	unsigned long full_fds_bits_init[1];
    	struct file __rcu * fd_array[NR_OPEN_DEFAULT];
    };

#### fdtable结构体
[-> kernel/include/linux/fdtable.h]

    #define NR_OPEN_DEFAULT BITS_PER_LONG
    struct fdtable {
    	unsigned int max_fds;
    	struct file __rcu **fd;   //当前fd数组
    	unsigned long *close_on_exec;
    	unsigned long *open_fds;
    	unsigned long *full_fds_bits;
    	struct rcu_head rcu;
    };

#### 3.2.3 file结构体
[-> /kernel/include/linux/fs.h]

    struct file {
    	union {
    		struct llist_node	fu_llist;
    		struct rcu_head 	fu_rcuhead;
    	} f_u;
    	struct path		f_path;
    	struct inode		*f_inode;	/* cached value */
    	const struct file_operations	*f_op;

    	/*
    	 * Protects f_ep_links, f_flags.
    	 * Must not be taken from IRQ context.
    	 */
    	spinlock_t		f_lock;
    	atomic_long_t		f_count;
    	unsigned int 		f_flags;
    	fmode_t			f_mode;
    	struct mutex		f_pos_lock;
    	loff_t			f_pos;
    	struct fown_struct	f_owner;
    	const struct cred	*f_cred;
    	struct file_ra_state	f_ra;

    	u64			f_version;
    	/* needed for tty driver, and maybe others */
    	void			*private_data;

    #ifdef CONFIG_EPOLL
    	/* Used by fs/eventpoll.c to link all the hooks to this file */
    	struct list_head	f_ep_links;
    	struct list_head	f_tfile_llink;
    #endif
    	struct address_space	*f_mapping;
    } __attribute__((aligned(4)));	

http://www.wowotech.net/kernel_synchronization/spinlock.html

// spinlock
http://www.wowotech.net/kernel_synchronization/spinlock.html
