## binder static

static HLIST_HEAD(binder_deferred_list);
static HLIST_HEAD(binder_dead_nodes);


static struct workqueue_struct *binder_deferred_workqueue;


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
