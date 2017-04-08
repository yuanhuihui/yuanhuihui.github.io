### 命令

/proc/locks 内核锁住的文件列表

系统允许打开的最大文件数: sysctl -a | grep fs.file-max

单进程允许打开的最大文件数: ulimit -n  (一般为1024)

http://www.cnblogs.com/vinozly/p/5699147.html

### 掉帧

showmap

dumpsys gfxinfo com.miui.home

### stack

development/scripts/stack 等等, 需要研究这个目录下的功能;

### logcat

LogBufferElement::populateDroppedMessage

http://blog.csdn.net/kc58236582/article/details/51506896

chatty这样的log，那就是删除了log最多的那个uid的log。而且会合并。

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
#define KERN_DEBUG                   "<7>"        /* 调试级：调试级别的信息      
