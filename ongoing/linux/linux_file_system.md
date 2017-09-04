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
