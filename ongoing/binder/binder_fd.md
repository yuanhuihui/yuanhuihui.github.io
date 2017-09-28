
flat_binder_object.type = BINDER_TYPE_FD
binder_node.accept_fds
binder_state.fd


两个进程共享内存的方法：打开同一个文件，由binder驱动来完成，核心方法便是调用writeFileDescriptor和readFileDescriptor标识文件描述符。


### binder_transaction
[-> binder.c]

    static void binder_transaction(...){
       ...
       for (; offp < off_end; offp++) {
          struct flat_binder_object *fp;
          fp = (struct flat_binder_object *)(t->buffer->data + *offp);
          off_min = *offp + sizeof(struct flat_binder_object);
          switch (fp->type) {
          case BINDER_TYPE_FD: {
              int target_fd;
              struct file *file;
              //判断是否接收fd操作
              if (reply) {
                if (!(in_reply_to->flags & TF_ACCEPT_FDS)) {
                  return_error = BR_FAILED_REPLY;
                  goto err_fd_not_allowed;
                }
              } else if (!target_node->accept_fds) {
                return_error = BR_FAILED_REPLY;
                goto err_fd_not_allowed;
              }
              
              //获得fd在当前进程的file结构体
              file = fget(fp->handle); 
              //检查目标进程是否具有访问file的权限
              security_binder_transfer_file(proc->tsk, target_proc->tsk, file);
              //从目标进程查询未使用的fd
              target_fd = task_get_unused_fd_flags(target_proc, O_CLOEXEC);
              //将目标进程target_fd和file指针所执行的文件结构体，在目标进程进行关联
              task_fd_install(target_proc, target_fd, file);
              
              fp->binder = 0;
              fp->handle = target_fd;
          } break;
          ...
          }
      }
      ...
      
      //添加事务到目标队列
      t->work.type = BINDER_WORK_TRANSACTION;
      list_add_tail(&t->work.entry, target_list);
      tcomplete->type = BINDER_WORK_TRANSACTION_COMPLETE;
      list_add_tail(&tcomplete->entry, &thread->todo);
      
      //唤醒目标进程
      if (target_wait) {
          if (reply || !(t->flags & TF_ONE_WAY)) {
            wake_up_interruptible_sync(target_wait);
          }
          else {
            wake_up_interruptible(target_wait);
          }
      }
      return;
    }


该方法主要工作是从目标进程中获取一个未使用的fd，再调用task_fd_install把其和当前进程的file关联起来。



### writeFileDescriptor
[-> Parcel.cpp]

    status_t Parcel::writeFileDescriptor(int fd, bool takeOwnership)
    {
        flat_binder_object obj;
        obj.type = BINDER_TYPE_FD; //类型为文件描述符
        obj.flags = 0x7f | FLAT_BINDER_FLAG_ACCEPTS_FDS;
        obj.binder = 0;
        obj.handle = fd;
        obj.cookie = takeOwnership ? 1 : 0;
        return writeObject(obj, true); //
    }

####  writeObject

    status_t Parcel::writeObject(const flat_binder_object& val, bool nullMetaData)
    {
        const bool enoughData = (mDataPos+sizeof(val)) <= mDataCapacity;
        const bool enoughObjects = mObjectsSize < mObjectsCapacity;
        if (enoughData && enoughObjects) {
    restart_write:
            //将数据写入mData
            *reinterpret_cast<flat_binder_object*>(mData+mDataPos) = val;
            if (val.type == BINDER_TYPE_FD) {
                if (!mAllowFds) {
                    return FDS_NOT_ALLOWED;
                }
                mHasFds = mFdsKnown = true; //更新布尔值
            }

            //写入元数据
            if (nullMetaData || val.binder != 0) {
                mObjects[mObjectsSize] = mDataPos;
                acquire_object(ProcessState::self(), val, this, &mOpenAshmemSize);
                mObjectsSize++;
            }

            return finishWrite(sizeof(flat_binder_object));
        }
        ...
        goto restart_write;
    }
   
### readFileDescriptor
[-> Parcel.cpp]

    int Parcel::readFileDescriptor() const
    {
        const flat_binder_object* flat = readObject(true);
        if (flat && flat->type == BINDER_TYPE_FD) {
            return flat->handle;
        }
        return BAD_TYPE;
    }

#### readObject

    const flat_binder_object* Parcel::readObject(bool nullMetaData) const
    {
        const size_t DPOS = mDataPos;
        if ((DPOS+sizeof(flat_binder_object)) <= mDataSize) {
            const flat_binder_object* obj
                    = reinterpret_cast<const flat_binder_object*>(mData+DPOS);
            mDataPos = DPOS + sizeof(flat_binder_object);
            if (!nullMetaData && (obj->cookie == 0 && obj->binder == 0)) {
                //不进入该分支，nullMetaData=true
                return obj; 
            }

            binder_size_t* const OBJS = mObjects;
            const size_t N = mObjectsSize;
            size_t opos = mNextObjectHint;

            if (N > 0) {
                //开始查询
                if (opos < N) {
                    while (opos < (N-1) && OBJS[opos] < DPOS) {
                        opos++;
                    }
                } else {
                    opos = N-1;
                }
                if (OBJS[opos] == DPOS) {
                    mNextObjectHint = opos+1;
                    return obj;
                }

                //向后查询
                while (opos > 0 && OBJS[opos] > DPOS) {
                    opos--;
                }
                if (OBJS[opos] == DPOS) {
                    mNextObjectHint = opos+1;
                    return obj;
                }
            }
        }
        return NULL;
    }
