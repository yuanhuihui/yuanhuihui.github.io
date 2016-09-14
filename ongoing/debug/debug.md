Xiaomi/gemini/gemini:6.0.1/MXB48T/6.6.4:user/release-keys
[ro.product.mod_device]: [gemini_alpha]
[ro.product.model]: [MI 5]


[ 2559.728031] gic_show_resume_irq: 178 triggered wcnss_wlan
[ 2559.728031] Resume caused by IRQ 178, wcnss_wlan
[ 2559.728031] gic_show_resume_irq: 200 triggered qcom,smd-rpm





至此， 我们可以很清楚的 解析 trace文件中 thread信息的含义了：
1. 第一行是 固定的头, 指明下面的都是 当前运行的 dvm thread ：“DALVIK THREADS:”
2. 第二行输出的是该 进程里各种线程互斥量的值。（具体的互斥量的作用在 dalvik 线程一章 单独陈述）
3. 第三行输出分别是 线程的名字（“main”），线程优先级（“prio=5”），线程id（“tid=1”） 以及线程的 类型（“NATIVE”）
4. 第四行分别是线程所述的线程组 （“main”），线程被正常挂起的次处（“sCount=1”），线程因调试而挂起次数（”dsCount=0“），当前线程所关联的java线程对象（”obj=0x400246a0“）以及该线程本身的地址（“self=0x12770”）。
5. 第五行 显示 线程调度信息。 分别是该线程在linux系统下得本地线程id （“ sysTid=503”），线程的调度有优先级（“nice=0”），调度策略（sched=0/0），优先组属（“cgrp=default”）以及 处理函数地址（“handle=-1342909272”）
6 第六行 显示更多该线程当前上下文，分别是 调度状态（从 /proc/[pid]/task/[tid]/schedstat读出）（“schedstat=( 15165039025 12197235258 23068 )”），以及该线程运行信息 ，它们是 线程用户态下使用的时间值(单位是jiffies）（“utm=182”）， 内核态下得调度时间值（“stm=1334”），以及最后运行改线程的cup标识（“core=0”）；
7.后面几行输出 该线程 调用栈。


2113833799 1469190352 6795
2114541923 1469354832 6797
2117451453 1470489571 6809

| state=S schedstat=( 2207457456 1680147196 6979 ) utm=145 stm=75 core=4 HZ=100
| state=S schedstat=( 2208407923 1680147196 6981 ) utm=145 stm=75 core=4 HZ=100
| state=S schedstat=( 2208982923 1680230009 6983 ) utm=145 stm=75 core=7 HZ=100


### kernel log打印级别


/proc/sys/kernel/printk  

4       4       1       7

(1) 控制台日志级别：优先级高于该值的消息将被打印至控制台。
(2) 缺省的消息日志级别：将用该值来打印没有优先级的消息。
(3) 最低的控制台日志级别：控制台日志级别可能被设置的最小值。
(4) 缺省的控制台：控制台日志级别的缺省值。


#define KERN_EMERG                  "<0>"       /* 致命级：紧急事件消息，系统崩溃之前提示，表示系统不可用   */
#define KERN_ALERT                    "<1>"       /* 警戒级：报告消息，表示必须采取措施                                   */
#define KERN_CRIT                        "<2>"       /* 临界级：临界条件，通常涉及严重的硬件或软件操作失败   */
#define KERN_ERR                        "<3>"        /* 错误级：错误条件，驱动程序常用KERN_ERR来报告硬件错误 */
#define KERN_WARNING              "<4>"        /* 告警级：警告条件，对可能出现问题的情况进行警告   */
#define KERN_NOTICE                  "<5>"        /* 注意级：正常但又重要的条件，用于提醒                                   */
#define KERN_INFO                       "<6>"         /* 通知级：提示信息，如驱动程序启动时，打印硬件信息   */
#define KERN_DEBUG                   "<7>"        /* 调试级：调试级别的信息                                                    */


SystemServer: Entered the Android system server!

init: Starting
init: Service


### 可以查看 dumpsys all里面的 DUMP OF SERVICE dropbox:



### 命令

/proc/locks 内核锁住的文件列表

系统允许打开的最大文件数: sysctl -a | grep fs.file-max

单进程允许打开的最大文件数: ulimit -n  (一般为1024)

http://www.cnblogs.com/vinozly/p/5699147.html


亮屏:

PowerManagerService: Waking up from sleep

灭屏:

PowerManagerService: Going to sleep due to power button
PowerManagerService: Sleeping



conflict
