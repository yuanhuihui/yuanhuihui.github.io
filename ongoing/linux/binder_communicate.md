binder_ioctl
    ret = wait_event_interruptible(binder_user_error_wait, binder_stop_on_user_error < 2);


    binder_transaction

oneway模式：

    //ref失败
    ref = binder_get_ref(proc, tr->target.handle);
		if (ref == NULL) {
			binder_user_error("binder: %d:%d got "
				"transaction to invalid handle\n",
				proc->pid, thread->pid);
			return_error = BR_FAILED_REPLY;
			goto err_invalid_target_handle;
		}

    //target_proc失败
    if (target_proc == NULL) {
		return_error = BR_DEAD_REPLY;
		goto err_dead_binder;
	}

    if (security_binder_transaction(proc->tsk, target_proc->tsk) < 0) {
        return_error = BR_FAILED_REPLY;
        goto err_invalid_target_handle;
    }

    //binder_transaction 内存分配失败
    t = kzalloc(sizeof(*t), GFP_KERNEL);
    if (t == NULL) {
        return_error = BR_FAILED_REPLY;
        goto err_alloc_t_failed;
    }

    //binder_work 内存分配失败
	tcomplete = kzalloc(sizeof(*tcomplete), GFP_KERNEL);
	if (tcomplete == NULL) {
		return_error = BR_FAILED_REPLY;
		goto err_alloc_tcomplete_failed;
	}

    //binder_buffer内存分配失败
    t->buffer = binder_alloc_buf(target_proc, tr->data_size,
		tr->offsets_size, !reply && (t->flags & TF_ONE_WAY));
	if (t->buffer == NULL) {
		return_error = BR_FAILED_REPLY;
		goto err_binder_alloc_buf_failed;
	}

    //copy_from_user 数据拷贝失败
    if (copy_from_user(t->buffer->data, tr->data.ptr.buffer, tr->data_size)) {
        binder_user_error("binder: %d:%d got transaction with invalid "
            "data ptr\n", proc->pid, thread->pid);
        return_error = BR_FAILED_REPLY;
        goto err_copy_data_failed;
    }
    if (copy_from_user(offp, tr->data.ptr.offsets, tr->offsets_size)) {
        binder_user_error("binder: %d:%d got transaction with invalid "
            "offsets ptr\n", proc->pid, thread->pid);
        return_error = BR_FAILED_REPLY;
        goto err_copy_data_failed;
    }

    //字节偏移量 没有对齐的错误
    if (!IS_ALIGNED(tr->offsets_size, sizeof(size_t))) {
		binder_user_error("binder: %d:%d got transaction with "
			"invalid offsets size, %zd\n",
			proc->pid, thread->pid, tr->offsets_size);
		return_error = BR_FAILED_REPLY;
		goto err_bad_offset;
	}


从tr->data.ptr.buffer 拷贝数据到t->buffer->data
其中，来自于IPCThreadState.cpp：
tr.data.ptr.buffer = data.ipcData();
tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t);
tr.data.ptr.offsets = data.ipcObjects();


执行完：
target_list = &target_proc->todo;
target_wait = &target_proc->wait;
binder_transaction信息设置：
    t->from = thread; （当前proxy线程）
    t->to_proc = target_proc; (server进程)
    t->to_thread = null;


if (target_node->has_async_transaction) {
    target_list = &target_node->async_todo;
    target_wait = NULL;
} else
    target_node->has_async_transaction = 1;
}

t->work.type = BINDER_WORK_TRANSACTION;
list_add_tail(&t->work.entry, target_list); //加入到target_proc->todo 或者target_node->async_todo;
tcomplete->type = BINDER_WORK_TRANSACTION_COMPLETE;
list_add_tail(&tcomplete->entry, &thread->todo); //加入到thread->todo队列
if (target_wait)
wake_up_interruptible(target_wait);
