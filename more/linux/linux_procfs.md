
## 概述

Android底层是基于Linux系统，要深入掌握Android系统，则需要进一步学习Linux知识。接下来介绍Linux系统
的/proc目录，也就是proc文件系统，这是一种虚拟文件系统，


## 节点

### proc/N/

proc/N/, 代表当前正在运行进程的相关信息

|节点|含义|
|---|---|
|cmdline|进程的命令行|
|comm|线程名|
|maps|当前进程关联到的每个可执行文件和库文件在内存映射区及其访问权限所组成的列表|详解|
|fd|目录，当前进程打开的所有fd, 是指向实际文件的符号链接|详解|
|stat|当前进程的cpu等状态信息|详解|
|statm — 当前进程占用内存的状态信息，通常以“页面”（page）表示|详解|
|status|与stat类似的信息|
|limits| 当前进程所使用的每一个受限资源的软限制、硬限制|详解，文件和进程上限|
|task|目录，包含由当前进程所运行的每一个线程相关信息|
|sched|cpu调度相关信息|

cmdline：进程的命令行，包括程序的名称和所有的参数，僵死进程或者被交换出去的进程可能没有任何内容。如cat ./self/cmdline

### 其他节点

|节点|含义|
|---|---|
|proc/stat| cpu使用率|
|proc/meminfo| 内存使用情况 |
|proc/buddyinfo| 内存碎片信息|详解|
|proc/diskstats|每块磁盘设备的磁盘I/O统计信息列表|
|proc/cmdline| 在启动时传递至内核的相关参数信息，这些信息通常由lilo或grub等启动管理工具进行传递|
|proc/cpuinfo| CPU信息|
|proc/filesystems|当前被内核支持的文件系统类型列表文件，被标示为nodev的文件系统表示不需要块设备的支持|
|proc/swaps| swap空间的使用情况|
|proc/uptime| 系统的正常运行时间|
|proc/kmsg|输出内核信息|
|proc/loadavg| CPU和磁盘I/O的负载平均值，其前三列分别表示每1秒钟、每5秒钟及每15秒的负载平均值|
|proc/locks| 当前由内核锁定的文件的相关信息|详情|
|proc/mounts|系统当前挂载的所有文件系统|详解|
|proc/version|当前系统运行的内核版本号|
|proc/vmstat|当前系统虚拟内存的多种统计数据|
|proc/zoneinfo|内存区域（zone）的详细信息列表|
|proc/sys|子目录中的许多文件内容进行修改以更改内核的运行特性|
|proc/misc|报告内核函数misc_register函数登记的设备驱动程序|

https://www.cnblogs.com/cute/archive/2011/04/20/2022280.html
【2.22】其中第一列表示挂载的设备，第二列表示在当前目录树中的挂载点，第三点表示当前文件系统的类型，第四列表示挂载属性（ro或者rw），第五列和第六列用来匹配/etc/mtab文件中的转储（dump）属性


locks文件：包含在打开的文件上的加锁信息，由/linux/fs/lock.c中的get_locks_status函数产生
