

## 三. 进程退出

### exit

1. 进程调用exit()退出执行，并会释放进程所占用的资源，再将自身设置为僵死状态(Z)；
2. 父进程调用wait4()来查询子进程是否终结；
3. 当父进程执行完wait或者waitpid操作后，该进程彻底退出。

    exit
        do_exit
            exit_mm
            sem_exit
            exit_files
            exit_fs
            exit_notify
            schedule

到此该进程相关的所有资源都已释放，并处于EXIT_ZOMBIE状态。此时进程所占用的内存为内核栈、task_struct和hread_info结构体， 该进程存在的唯一目标就是向父进程提供信息。





### 3.4

【需要图片】
syscall <-> 内核 <-> 中断

- 应用程序通过系统调用syscall与内核通信；
- 硬件设备通过发出中断信号，来打断CPU的执行。每一个中断对应一个中断号，内核通过中断号，找到并调用该中断处理程序来响应中断。

例如，当用手指触摸屏幕，则屏幕设备会发送中断，告知内核有touch输入事件需要处理，内核收到中断并调用相应处理程序来响应该输入事件。




### CPU的三种运行状态

- 运行在User Space(用户空间)，执行用户进程；
- 运行在Kernel Space(内核空间)，处于进程上下文，执行相应的进程；当CPU空闲时也处于该状态；
- 运行在Kernel Space(内核空间)，处于中断上下文，处理相应的中断。

【需要图片】



//cow的保护机制
http://blog.csdn.net/evenness/article/details/7656812

http://www.ibm.com/developerworks/cn/linux/l-linux-process-management/index.html

http://blog.csdn.net/gatieme/article/details/51569932

//内核blog
http://blog.csdn.net/gatieme/article/details/51577479


## 文件引用的问题

fork和dup，都只是增加file->f_count的引用计数

## 解决方案：

1. bionic fork： 直接关闭，比较合适。
2. copy_process, fs的文件计数： 子进程不加引用会有问题，子进程死亡会导致主进程binder_release
3. binder_release：主进程被杀，并收不到binder_flush, 子进程被杀则能。无法解决问题。
4. zygote waitpit. 目前并不支持。
5. exit()：设计不够合理
