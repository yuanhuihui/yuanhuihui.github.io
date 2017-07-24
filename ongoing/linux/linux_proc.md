
### proc/stat

    Gityuan$ adb shell cat /proc/stat
    //解释（默认单位jiffies，10ms）： user，nice, system, idle, iowait, irq, softirq
    cpu  130216 19944 162525 1491240 3784 24749 17773 0 0 0
    cpu0 40321 11452 49784 403099 2615 6076 6748 0 0 0
    cpu1 26585 2425 36639 151166 404 2533 3541 0 0 0
    cpu2 22555 2957 31482 152460 330 2236 2473 0 0 0
    cpu3 15232 1243 20945 153740 303 1985 3432 0 0 0
    cpu4 5903 595 6017 157410 30 10959 605 0 0 0
    cpu5 4716 380 3794 157909 23 118 181 0 0 0
    cpu6 8001 515 8995 157571 48 571 180 0 0 0
    cpu7 6903 377 4869 157885 31 271 613 0 0 0
    
    intr ...
    ctxt 22523049
    btime 1500827856
    processes 23231
    procs_running 1
    procs_blocked 0
    softirq 3552900 843593 733695 19691 93143 468832 12783 257382 610426 0 513355


|cpu指标|含义|
|---|---|
|user|用户态时长|
|nice|用户态时长(低优先级)|
|system|内核态时长|
|idle||
|iowait||
|irq|
|softirq|

其中iowait是不可靠的值，由于cpu不会等待iowait完成，而iowait是指task等待I/O完成的时间。

- intr：系统启动以来的所有interrupts的次数情况
- ctxt: 系统上下文切换次数
- btime：启动时间，单位秒，从Epoch开始到系统启动所经过的时长，Epoch为1970-01-01 00:00:00 +0000 (UTC)
- processes：系统启动后所创建过的进程数量
- procs_running：处于Runnable状态的进程个数
- procs_blocked：处于等待I/O完成的进程个数

另外，

    cat /proc/uptime
    82044.14 215440.94

- 第一个值代表从开机到现在的累积时间，单位为秒
- 第二个值代表从开机到现在的CPU空闲时间，单位为秒

可结合btime, 获取当前的绝对时间。

###  /proc/<pid>/stat

  Gityuan$ adb shell cat /proc/8385/stat
  1557 (system_server) S 823 823 0 0 -1 1077952832 
  2085481 15248 2003 27 166114 129684 26 30 
  10 -10 221 0 2284 2790821888 93087 18446744073709551615 
  1 1 0 0 0 0 6660 0 36088 0 0 0 17 3 0 0 0 0 0 0 0 0 0 0 0 0 0

一般地sysconf(_SC_CLK_TCK)定义为jiffies。数据过于长，为了方便说明，此处划分为多行：

#### 第一行：

1. pid： 进程ID
2. comm: task_struct结构体的进程名，一般地,每个pid对应不同的名字；
3. state: 进程状态
4. ppid: 父进程ID （父进程是指通过fork方式，通过clone并非父进程）
5. pgrp：进程组ID
6. session：进程会话组ID
7. tty_nr：当前进程的tty终点设备号
8. tpgid：控制进程终端的前台进程号
9. flags：进程标识位，定义在include/linux/sched.h中的PF_*, 此处等于1077952832


其中，进程状态有: (不同的linux版本略有不同，下面列举最新Kernel的进程状态值)

    R  Running
    S  Sleeping in an interruptible wait
    D  Waiting in uninterruptible disk sleep
    Z  Zombie
    X  Dead
    T  Stopped (on a signal)
    t  Tracing stop 
    
#### 第二行：(随着时间改变)

1. minflt： 次要缺页中断的次数，即无需从磁盘加载内存页
2. cminflt：当前进程等待子进程的minflt
3. majflt：主要缺页中断的次数，需要从磁盘加载内存页
4. majflt：当前进程等待子进程的majflt
5. utime: 该进程处于用户态的时间，单位jiffies，此处等于166114
6. stime: 该进程处于内核态的时间，单位jiffies，此处等于129684
7. cutime：当前进程等待子进程的utime
8. cstime: 当前进程等待子进程的utime

#### 第三行：

1. priority: 进程优先级
2. nice: nice值，取值范围[19, -20]，此处等于-10
3. num_threads: 线程个数, 此处等于221
4. itrealvalue: 该字段已废弃，恒等于0
5. starttime：自系统启动后的进程启动时间，单位jiffies，此处等于2284
6. vsize：进程的虚拟内存大小，单位为bytes
7. rss: 进程独占内存+共享库，单位pages
8. rsslim: rss大小上限

通过starttime，结合adb shell uptime，可知道每一个线程启动的时间点。

#### 第四行：

1 1 0 0 0 0 6660 0 36088 0 0 0 17 3 0 0 0 0 0 0 0 0 0 0 0 0 0

1. startcode
2. endcode
3. startstack
4. kstkesp 
5. kstkeip
6. signal：即将要处理的信号，十进制，此处等于6660
7. blocked：阻塞的信号，十进制
8. sigignore：被忽略的信号，十进制，此处等于36088

第四行数据价值不大，就不再介绍。 
信号相关，可查看/proc/[pid]/status



参考：
http://man7.org/linux/man-pages/man5/proc.5.html
