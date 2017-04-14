binder_deferred_release

    binder_free_thread(proc, thread)

    binder_node_release(node, incoming_refs);
    binder_delete_ref(ref);

    binder_release_work(&proc->todo);
	binder_release_work(&proc->delivered_death);

    binder_free_buf(proc, buffer);
