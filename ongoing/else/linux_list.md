

## 一. 链表

普通的链表实现,都是将数据内嵌到链表中, 而Linux是将链表内嵌到数据对象.

链表代码在头文件<linux/list.h>, 全路径为kernel/include/linux/list.h.

### 1. 链表初始化

结构体list_head,如下:

    struct list_head {  
        struct list_head *next, *prev;  
    };  
    
这是一个双向的环形链表.

    #define LIST_HEAD_INIT(name) { &(name), &(name) }
    
    #define LIST_HEAD(name) /
        struct list_head name = LIST_HEAD_INIT(name)

可见, LIST_HEAD()可完成链表初始化.

### 2. 访问数据

#define list_entry(ptr, type, member) \  
    container_of(ptr, type, member)  
    
    
    
### 3. 添加

//将new 插入到 head之后
void list_add(struct list_head *new, struct list_head *head)

//将new 插入到 head之前
void list_add_tail(struct list_head *new, struct list_head *head)


//从链表中删除 entry
void list_del(struct list_head *entry)

// 链表 是否为空
int list_empty(const struct list_head *head)

//获取整个结构体
list_entry(ptr, type, member) 

### 4. 循环遍历


ist_for_each(pos, head)

list_for_each_entry(pos, head, member)


https://www.zybuluo.com/ligq/note/114380


----------------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------------
### 我的新功能


debugfs_create_file("blocking_transactions",
            S_IRUGO,
            binder_debugfs_dir_entry_root,
            NULL,
            &binder_blocking_transactions_fops);

BINDER_DEBUG_ENTRY(blocking_transactions);


static int binder_blocking_transactions_show(struct seq_file *m, void *unused)
{
	struct binder_blocking_transaction_log *log;	
	int do_lock = !binder_debug_no_lock;

	if (do_lock)
		binder_lock(__func__);

	seq_puts(m, "binder blocking transactions:\n");
	hlist_for_each_entry(log, &binder_blocking_transactions, blocking_node)
	    print_binder_transaction_log_entry(m, &log->binder_transaction_log_entry);
	if (do_lock)
		binder_unlock(__func__);
	return 0;
}

struct binder_blocking_transaction_log {
	struct hlist_node blocking_node;
	struct binder_transaction_log_entry entry;
}

static HLIST_HEAD(binder_blocking_transactions);


// add
struct binder_blocking_transaction_log *log;
log = kzalloc(sizeof(*log), GFP_KERNEL);
if (log == NULL)
		return -ENOMEM;
hlist_add_head(&log->blocking_node, &binder_blocking_transactions);

// delete
binder_blocking_transaction_log *log;
hlist_del(&log->blocking_node);

----------------------------------------------------------------------------------------------------------------------------------------
----------------------------------------------------------------------------------------------------------------------------------------
struct binder_proc *proc;

binder_debug(BINDER_DEBUG_OPEN_CLOSE, "binder_open: %d:%d\n",
         current->group_leader->pid, current->pid);

proc = kzalloc(sizeof(*proc), GFP_KERNEL);
if (proc == NULL)
    return -ENOMEM;
get_task_struct(current);
proc->tsk = current;
INIT_LIST_HEAD(&proc->todo);
init_waitqueue_head(&proc->wait);
proc->default_priority = task_nice(current);

binder_lock(__func__);

binder_stats_created(BINDER_STAT_PROC);
hlist_add_head(&proc->proc_node, &binder_procs);


        
static HLIST_HEAD(binder_procs);
hlist_add_head(&proc->proc_node, &binder_procs);
hlist_del(&proc->proc_node);


hlist_for_each_entry(proc, &binder_procs, proc_node)
		print_binder_proc(m, proc, 1);