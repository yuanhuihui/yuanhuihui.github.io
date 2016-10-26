
## Linux进程状态

### 常见命令
/proc/PID/status
/proc/PID/stat
ps


### 状态含义

各进程的状态代表的意义如下:

R (running or runnable, on run queue)   TASK_RUNNING
S (sleeping)  TASK_INTERRUPTIBLE
D (disk sleep)  TASK_UNINTERRUPTIBLE
T (stopped， 或tracing stop) __TASK_STOPPED
Z (zombie) 已终止但还没有被父进程回收
X (dead) 死亡，应该是看不到的状态

### 其他参数

Tgid: 线程组的ID,一个线程一定属于一个线程组(进程组).
Pid: 进程的ID,更准确的说应该是线程的ID
PPid: 当前进程的父进程
