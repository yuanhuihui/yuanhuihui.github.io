### 1. sysctl

http://man.linuxde.net/sysctl

Linux内核通过/proc虚拟文件系统向用户提供查询和修改内核信息的功能，
sysctl可支持动态调整内核参数：

有三种方法：

- sysctl命令
- 目录/proc/sys/
- 文件/etc/sysctl.conf

例如：

    //直接写/proc文件系统
    echo 1 > /proc/sys/net/ipv4/ip_forward

    //利用sysctl命令
    sysctl -w net.ipv4.ip_forward=1

    //编辑/etc/sysctl.conf
    net.ipv4.ip_forward = 1



另外sysctl -a，可显示内核所有支持的参数。

sysctl fs.file-max

fs.file-max行 代表整个系统允许打开的最大文件数


### 2. sysrq

echo w > /proc/sysrq-trigger //blocked traces信息
echo l > /proc/sysrq-trigger //CPU backtraces 信息
echo c > /proc/sysrq-trigger  //crash系统


### 3. ulimit

用于控制shell程序资源

    gityuan-android:/ $ ulimit -a
    time(cpu-seconds)    unlimited
    file(blocks)         unlimited
    coredump(blocks)     0
    data(KiB)            unlimited
    stack(KiB)           8192  //堆栈的最大值8KB
    lockedmem(KiB)       65536
    nofiles(descriptors) 1024 //可同时打开的fd上限
    processes            14101
    sigpending           14101
    msgqueue(bytes)      819200
    maxnice              40
    maxrtprio            0
    resident-set(KiB)    unlimited
    address-space(KiB)   unlimited

### 4. 其他


- dmesg 或 cat /proc/kmsg
- logcat -L 或 cat /proc/last_kmsg
- adb bugreport > bugreport.txt
- ps
- lsof

- showmap

- mount
- df

- skill //冻结进程？？

- strace

- /d/binder/ 

- /proc/locks //内核锁住的文件列表
