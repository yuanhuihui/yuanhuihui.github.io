## 三. 核心工作

servicemanager的核心工作就是注册服务和查询服务。

### 3.1 do_find_service
[-> service_manager.c]

    uint32_t do_find_service(struct binder_state *bs, const uint16_t *s, size_t len, uid_t uid, pid_t spid)
    {
        //查询相应的服务 【见小节3.1.1】
        struct svcinfo *si = find_svc(s, len);

        if (!si || !si->handle) {
            return 0;
        }

        if (!si->allow_isolated) {
            uid_t appid = uid % AID_USER;
            //检查该服务是否允许孤立于进程而单独存在
            if (appid >= AID_ISOLATED_START && appid <= AID_ISOLATED_END) {
                return 0;
            }
        }

        //服务是否满足查询条件
        if (!svc_can_find(s, len, spid)) {
            return 0;
        }
        return si->handle;
    }

查询到目标服务，并返回该服务所对应的handle

#### 3.1.1 find_svc

    struct svcinfo *find_svc(const uint16_t *s16, size_t len)
    {
        struct svcinfo *si;

        for (si = svclist; si; si = si->next) {
            //当名字完全一致，则返回查询到的结果
            if ((len == si->len) &&
                !memcmp(s16, si->name, len * sizeof(uint16_t))) {
                return si;
            }
        }
        return NULL;
    }

从svclist服务列表中，根据服务名遍历查找是否已经注册。当服务已存在`svclist`，则返回相应的服务名，否则返回NULL。

当找到服务的handle, 则调用bio_put_ref(reply, handle)，将handle封装到reply.

#### 3.1.2 bio_put_ref

    void bio_put_ref(struct binder_io *bio, uint32_t handle)
    {
        struct flat_binder_object *obj;

        if (handle)
            obj = bio_alloc_obj(bio); //[见小节3.1.3]
        else
            obj = bio_alloc(bio, sizeof(*obj));

        if (!obj)
            return;

        obj->flags = 0x7f | FLAT_BINDER_FLAG_ACCEPTS_FDS;
        obj->type = BINDER_TYPE_HANDLE; //返回的是HANDLE类型
        obj->handle = handle;
        obj->cookie = 0;
    }

#### 3.1.3 bio_alloc_obj

    static struct flat_binder_object *bio_alloc_obj(struct binder_io *bio)
    {
        struct flat_binder_object *obj;
        obj = bio_alloc(bio, sizeof(*obj));//[见小节3.1.4]

        if (obj && bio->offs_avail) {
            bio->offs_avail--;
            *bio->offs++ = ((char*) obj) - ((char*) bio->data0);
            return obj;
        }
        bio->flags |= BIO_F_OVERFLOW;
        return NULL;
    }

#### 3.1.4 bio_alloc
    static void *bio_alloc(struct binder_io *bio, size_t size)
    {
        size = (size + 3) & (~3);
        if (size > bio->data_avail) {
            bio->flags |= BIO_F_OVERFLOW;
            return NULL;
        } else {
            void *ptr = bio->data;
            bio->data += size;
            bio->data_avail -= size;
            return ptr;
        }
    }

### 3.2 do_add_service
[-> service_manager.c]

    int do_add_service(struct binder_state *bs,
                       const uint16_t *s, size_t len,
                       uint32_t handle, uid_t uid, int allow_isolated,
                       pid_t spid)
    {
        struct svcinfo *si;

        if (!handle || (len == 0) || (len > 127))
            return -1;

        //权限检查【见小节3.2.1】
        if (!svc_can_register(s, len, spid)) {
            return -1;
        }

        //服务检索【见小节3.1.1】
        si = find_svc(s, len);
        if (si) {
            if (si->handle) {
                svcinfo_death(bs, si); //服务已注册时，释放相应的服务【见小节3.2.2】
            }
            si->handle = handle;
        } else {
            si = malloc(sizeof(*si) + (len + 1) * sizeof(uint16_t));
            if (!si) {  //内存不足，无法分配足够内存
                return -1;
            }
            si->handle = handle;
            si->len = len;
            memcpy(si->name, s, (len + 1) * sizeof(uint16_t)); //内存拷贝服务信息
            si->name[len] = '\0';
            si->death.func = (void*) svcinfo_death;
            si->death.ptr = si;
            si->allow_isolated = allow_isolated;
            si->next = svclist; // svclist保存所有已注册的服务
            svclist = si;
        }

        //以BC_ACQUIRE命令，handle为目标的信息，通过ioctl发送给binder驱动
        binder_acquire(bs, handle);
        //以BC_REQUEST_DEATH_NOTIFICATION命令的信息，通过ioctl发送给binder驱动，主要用于清理内存等收尾工作。[见小节3.3]
        binder_link_to_death(bs, handle, &si->death);
        return 0;
    }

注册服务的分以下3部分工作：

- svc_can_register：检查权限，检查selinux权限是否满足；
- find_svc：服务检索，根据服务名来查询匹配的服务；
- svcinfo_death：释放服务，当查询到已存在同名的服务，则先清理该服务信息，再将当前的服务加入到服务列表svclist；

#### 3.2.1 svc_can_register
[-> service_manager.c]

    static int svc_can_register(const uint16_t *name, size_t name_len, pid_t spid)
    {
        const char *perm = "add";
        //检查selinux权限是否满足
        return check_mac_perms_from_lookup(spid, perm, str8(name, name_len)) ? 1 : 0;
    }

#### 3.2.2 svcinfo_death
[-> service_manager.c]

    void svcinfo_death(struct binder_state *bs, void *ptr)
    {
        struct svcinfo *si = (struct svcinfo* ) ptr;

        if (si->handle) {
            binder_release(bs, si->handle);
            si->handle = 0;
        }
    }

#### 3.2.3 bio_get_ref
[-> servicemanager/binder.c]

    uint32_t bio_get_ref(struct binder_io *bio)
    {
        struct flat_binder_object *obj;

        obj = _bio_get_obj(bio);
        if (!obj)
            return 0;

        if (obj->type == BINDER_TYPE_HANDLE)
            return obj->handle;

        return 0;
    }

### 3.3 binder_link_to_death
[-> servicemanager/binder.c]

    void binder_link_to_death(struct binder_state *bs, uint32_t target, struct binder_death *death)
    {
        struct {
            uint32_t cmd;
            struct binder_handle_cookie payload;
        } __attribute__((packed)) data;

        data.cmd = BC_REQUEST_DEATH_NOTIFICATION;
        data.payload.handle = target;
        data.payload.cookie = (uintptr_t) death;
        binder_write(bs, &data, sizeof(data)); //[见小节3.3.1]
    }

binder_write经过跟小节2.4.1一样的方式, 进入Binder driver后,直接调用后进入binder_thread_write, 处理BC_REQUEST_DEATH_NOTIFICATION命令


#### 3.3.1 binder_ioctl_write_read
[-> kernel/drivers/android/binder.c]

    static int binder_ioctl_write_read(struct file *filp,
                    unsigned int cmd, unsigned long arg,
                    struct binder_thread *thread)
    {
        int ret = 0;
        struct binder_proc *proc = filp->private_data;
        void __user *ubuf = (void __user *)arg;
        struct binder_write_read bwr;

        if (copy_from_user(&bwr, ubuf, sizeof(bwr))) { //把用户空间数据ubuf拷贝到bwr
            ret = -EFAULT;
            goto out;
        }
        if (bwr.write_size > 0) { //此时写缓存有数据【见小节3.3.2】
            ret = binder_thread_write(proc, thread,
                      bwr.write_buffer, bwr.write_size, &bwr.write_consumed);
             if (ret < 0) {
                  bwr.read_consumed = 0;
                  if (copy_to_user(ubuf, &bwr, sizeof(bwr)))
                      ret = -EFAULT;
                  goto out;
              }
        }

        if (bwr.read_size > 0) { //此时读缓存有数据【见小节3.3.3】
            ret = binder_thread_read(proc, thread, bwr.read_buffer,
                     bwr.read_size,
                     &bwr.read_consumed,
                     filp->f_flags & O_NONBLOCK);
            if (!list_empty(&proc->todo))  //进程todo队列不为空,则唤醒该队列中的线程
                wake_up_interruptible(&proc->wait);
            if (ret < 0) {
                if (copy_to_user(ubuf, &bwr, sizeof(bwr)))
                    ret = -EFAULT;
                goto out;
            }
        }

        if (copy_to_user(ubuf, &bwr, sizeof(bwr))) { //将内核数据bwr拷贝到用户空间ubuf
            ret = -EFAULT;
            goto out;
        }
    out:
        return ret;
    }

#### 3.3.2 binder_thread_write
[-> kernel/drivers/android/binder.c]

    static int binder_thread_write(struct binder_proc *proc,
          struct binder_thread *thread,
          binder_uintptr_t binder_buffer, size_t size,
          binder_size_t *consumed)
    {
      uint32_t cmd;
      struct binder_context *context = proc->context;
      void __user *buffer = (void __user *)(uintptr_t)binder_buffer;
      void __user *ptr = buffer + *consumed; //ptr指向小节3.2.3中bwr中write_buffer的data.
      void __user *end = buffer + size;
      while (ptr < end && thread->return_error == BR_OK) {
        get_user(cmd, (uint32_t __user *)ptr); //获取BC_REQUEST_DEATH_NOTIFICATION
        ptr += sizeof(uint32_t);
        switch (cmd) {
            case BC_REQUEST_DEATH_NOTIFICATION:{ //注册死亡通知
                uint32_t target;
                void __user *cookie;
                struct binder_ref *ref;
                struct binder_ref_death *death;

                get_user(target, (uint32_t __user *)ptr); //获取target
                ptr += sizeof(uint32_t);
                get_user(cookie, (void __user * __user *)ptr); //获取death
                ptr += sizeof(void *);

                ref = binder_get_ref(proc, target); //拿到目标服务的binder_ref

                if (cmd == BC_REQUEST_DEATH_NOTIFICATION) {
                    if (ref->death) {
                        break;  //已设置死亡通知
                    }
                    death = kzalloc(sizeof(*death), GFP_KERNEL);

                    INIT_LIST_HEAD(&death->work.entry);
                    death->cookie = cookie;
                    ref->death = death;
                    if (ref->node->proc == NULL) { //当目标binder服务所在进程已死,则发送死亡通知
                        ref->death->work.type = BINDER_WORK_DEAD_BINDER;
                        //当前线程为binder线程,则直接添加到当前线程的todo队列. 接下来,进入[小节3.2.6]
                        if (thread->looper & (BINDER_LOOPER_STATE_REGISTERED | BINDER_LOOPER_STATE_ENTERED)) {
                            list_add_tail(&ref->death->work.entry, &thread->todo);
                        } else {
                            list_add_tail(&ref->death->work.entry, &proc->todo);
                            wake_up_interruptible(&proc->wait);
                        }
                    }
                } else {
                    ...
                }
            } break;
          case ...;
        }
        *consumed = ptr - buffer;
      }
   }

此方法中的proc, thread都是指当前servicemanager进程的信息. 此时TODO队列有数据,则进入binder_thread_read.

那么哪些场景会向队列增加BINDER_WORK_DEAD_BINDER事务呢? 那就是当binder所在进程死亡后,会调用binder_release方法,
然后调用binder_node_release.这个过程便会发出死亡通知的回调.

#### 3.3.3 binder_thread_read

    static int binder_thread_read(struct binder_proc *proc,
                      struct binder_thread *thread,
                      binder_uintptr_t binder_buffer, size_t size,
                      binder_size_t *consumed, int non_block)
        ...
        //只有当前线程todo队列为空，并且transaction_stack也为空，才会开始处于当前进程的事务
        if (wait_for_proc_work) {
            ...
            ret = wait_event_freezable_exclusive(proc->wait, binder_has_proc_work(proc, thread));
        } else {
            ...
            ret = wait_event_freezable(thread->wait, binder_has_thread_work(thread));
        }
        binder_lock(__func__); //加锁

        if (wait_for_proc_work)
            proc->ready_threads--; //空闲的binder线程减1
        thread->looper &= ~BINDER_LOOPER_STATE_WAITING;

        while (1) {
            uint32_t cmd;
            struct binder_transaction_data tr;
            struct binder_work *w;
            struct binder_transaction *t = NULL;

            //从todo队列拿出前面放入的binder_work, 此时type为BINDER_WORK_DEAD_BINDER
            if (!list_empty(&thread->todo)) {
                w = list_first_entry(&thread->todo, struct binder_work,
                             entry);
            } else if (!list_empty(&proc->todo) && wait_for_proc_work) {
                w = list_first_entry(&proc->todo, struct binder_work,
                             entry);
            }

            switch (w->type) {
                case BINDER_WORK_DEAD_BINDER: {
                  struct binder_ref_death *death;
                  uint32_t cmd;

                  death = container_of(w, struct binder_ref_death, work);
                  if (w->type == BINDER_WORK_CLEAR_DEATH_NOTIFICATION)
                      ...
                  else
                      cmd = BR_DEAD_BINDER; //进入此分支
                  put_user(cmd, (uint32_t __user *)ptr);//拷贝到用户空间[见小节3.3.4]
                  ptr += sizeof(uint32_t);

                  //此处的cookie是前面传递的svcinfo_death
                  put_user(death->cookie, (binder_uintptr_t __user *)ptr);
                  ptr += sizeof(binder_uintptr_t);

                  if (w->type == BINDER_WORK_CLEAR_DEATH_NOTIFICATION) {
                      ...
                  } else
                      list_move(&w->entry, &proc->delivered_death);
                  if (cmd == BR_DEAD_BINDER)
                      goto done;
                } break;
            }
        }
        ...
        return 0;
    }

将命令BR_DEAD_BINDER写到用户空间, 此处的cookie是前面传递的svcinfo_death. 当binder_loop下一次
执行binder_parse的过程便会处理该消息。

#### 3.3.4 binder_parse
[-> servicemanager/binder.c]

    int binder_parse(struct binder_state *bs, struct binder_io *bio,
                     uintptr_t ptr, size_t size, binder_handler func)
    {
        int r = 1;
        uintptr_t end = ptr + (uintptr_t) size;

        while (ptr < end) {
            uint32_t cmd = *(uint32_t *) ptr;
            ptr += sizeof(uint32_t);
            switch(cmd) {
                case BR_DEAD_BINDER: {
                    struct binder_death *death = (struct binder_death *)(uintptr_t) *(binder_uintptr_t *)ptr;
                    ptr += sizeof(binder_uintptr_t);
                    // binder死亡消息【见小节3.3.5】
                    death->func(bs, death->ptr);
                    break;
                }
                ...
            }
        }
        return r;
    }

由小节3.2的 si->death.func = (void*) svcinfo_death; 可知此处 death->func便是执行svcinfo_death()方法.

#### 3.3.5 svcinfo_death
[-> service_manager.c]

    void svcinfo_death(struct binder_state *bs, void *ptr)
    {
        struct svcinfo *si = (struct svcinfo* ) ptr;

        if (si->handle) {
            binder_release(bs, si->handle);
            si->handle = 0;
        }
    }

#### 3.3.6 binder_release
[-> service_manager.c]

    void binder_release(struct binder_state *bs, uint32_t target)
    {
        uint32_t cmd[2];
        cmd[0] = BC_RELEASE;
        cmd[1] = target;
        binder_write(bs, cmd, sizeof(cmd));
    }

向Binder Driver写入BC_RELEASE命令, 最终进入Binder Driver后执行binder_dec_ref(ref, 1)来减少binder node的引用.

### 3.4 binder_send_reply
[-> servicemanager/binder.c]

    void binder_send_reply(struct binder_state *bs,
                           struct binder_io *reply,
                           binder_uintptr_t buffer_to_free,
                           int status)
    {
        struct {
            uint32_t cmd_free;
            binder_uintptr_t buffer;
            uint32_t cmd_reply;
            struct binder_transaction_data txn;
        } __attribute__((packed)) data;

        data.cmd_free = BC_FREE_BUFFER; //free buffer命令
        data.buffer = buffer_to_free;
        data.cmd_reply = BC_REPLY; // reply命令
        data.txn.target.ptr = 0;
        data.txn.cookie = 0;
        data.txn.code = 0;
        if (status) {
            data.txn.flags = TF_STATUS_CODE;
            data.txn.data_size = sizeof(int);
            data.txn.offsets_size = 0;
            data.txn.data.ptr.buffer = (uintptr_t)&status;
            data.txn.data.ptr.offsets = 0;
        } else {
            data.txn.flags = 0;
            data.txn.data_size = reply->data - reply->data0;
            data.txn.offsets_size = ((char*) reply->offs) - ((char*) reply->offs0);
            data.txn.data.ptr.buffer = (uintptr_t)reply->data0;
            data.txn.data.ptr.offsets = (uintptr_t)reply->offs0;
        }
        //向Binder驱动通信
        binder_write(bs, &data, sizeof(data));
    }

当小节2.5执行binder_parse方法，先调用svcmgr_handler()，再然后执行binder_send_reply过程。该方法会调用
[小节2.4.1] binder_write进入binder驱动后，将BC_FREE_BUFFER和BC_REPLY命令协议发送给Binder驱动，向client端发送reply.
其中data的数据区中保存的是TYPE为HANDLE.
