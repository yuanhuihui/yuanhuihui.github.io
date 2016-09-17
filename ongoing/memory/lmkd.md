--
layout: post
title:  "lmkd原理分析"
date:   2016-09-15 22:20:00
catalog:  true
tags:
    - android
    - memory
    - process

---

    frameworks/base/services/core/java/com/android/server/am/ProcessList.java
    platform/system/core/lmkd/lmkd.c
    kernel/common/drivers/staging/Android/lowmemorykiller.c

## 一. 概述

Android的设计理念之一，便是应用程序退出,但进程还会继续存在系统以便再次启动时提高响应时间.
这样的设计会带来一个问题, 每个进程都有自己独立的内存地址空间，随着应用打开数量的增多,系统已使用的内存越来越大，就很有可能导致系统内存不足, 那么需要一个能管理所有进程，根据一定策略来释放进程的策略，这便有了`lmk`，全称为LowMemoryKiller(低内存杀手)，lmkd来决定什么时间杀掉什么进程.

Android基于Linux的系统，其实Linux有类似的内存管理策略——`OOM killer`，全称(Out Of Memory Killer), OOM的策略更多的是用于分配内存不足时触发，将得分最高的进程杀掉。而LMK则会每隔一段时间检查一次，当系统剩余可用内存较低时，便会触发杀进程的策略，根据不同的剩余内存档位来来选择杀不同优先级的进程，而不是等到OOM时再来杀进程，真正OOM时系统可能已经处于异常状态，系统更希望的是未雨绸缪，在内存很低时来杀掉一些优先级较低的进程来保障后续操作的顺利进行。

## 二. framework层

位于`ProcessList.java`中定义了3种命令类型，这些文件的定义必须跟`lmkd.c`定义完全一致，格式分别如下：

    LMK_TARGET <minfree> <minkillprio> ... (up to 6 pairs)
    LMK_PROCPRIO <pid> <prio>
    LMK_PROCREMOVE <pid>

功能|命令|对应方法|触发时机|
|---|---|---|---|
|更新oom水线|LMK_TARGET|updateOomLevels|AMS.updateConfiguration|
|设置进程adj|LMK_PROCPRIO|setOomAdj|AMS.applyOomAdjLocked|
|移除进程|LMK_PROCREMOVE|remove|AMS.handleAppDiedLocked/cleanUpApplicationRecordLocked|


在前面文章[Android进程调度之adj算法](http://gityuan.com/2016/08/07/android-adj/)中有讲到`AMS.applyOomAdjLocked`，接下来以这个过程为主线开始分析。

### 2.1 AMS.applyOomAdjLocked

    private final boolean applyOomAdjLocked(ProcessRecord app, boolean doingAll, long now,
            long nowElapsed) {
        ...
        if (app.curAdj != app.setAdj) {
            //【见小节2.2】
            ProcessList.setOomAdj(app.pid, app.info.uid, app.curAdj);
            app.setAdj = app.curAdj;
        }
        ...
    }

### 2.2 PL.setOomAdj

    public static final void setOomAdj(int pid, int uid, int amt) {
        //当adj=16，则直接返回
        if (amt == UNKNOWN_ADJ)
            return;
        long start = SystemClock.elapsedRealtime();
        ByteBuffer buf = ByteBuffer.allocate(4 * 4);
        buf.putInt(LMK_PROCPRIO);
        buf.putInt(pid);
        buf.putInt(uid);
        buf.putInt(amt);
        //将16Byte字节写入socket【见小节2.3】
        writeLmkd(buf);
        long now = SystemClock.elapsedRealtime();
        if ((now-start) > 250) {
            Slog.w("ActivityManager", "SLOW OOM ADJ: " + (now-start) + "ms for pid " + pid
                    + " = " + amt);
        }
    }

buf大小为16个字节，依次写入LMK_PROCPRIO(命令类型), pid(进程pid), uid(进程uid), amt(目标adj)，将这些字节通过socket发送给lmkd.

### 2.3 PL.writeLmkd

    private static void writeLmkd(ByteBuffer buf) {
        //当socket打开失败会尝试3次
        for (int i = 0; i < 3; i++) {
            if (sLmkdSocket == null) {
                    //打开socket 【见小节2.4】
                    if (openLmkdSocket() == false) {
                        try {
                            Thread.sleep(1000);
                        } catch (InterruptedException ie) {
                        }
                        continue;
                    }
            }
            try {
                //将buf信息写入lmkd socket
                sLmkdOutputStream.write(buf.array(), 0, buf.position());
                return;
            } catch (IOException ex) {
                try {
                    sLmkdSocket.close();
                } catch (IOException ex2) {
                }
                sLmkdSocket = null;
            }
        }
    }

- 当sLmkdSocket为空，并且打开失败，重新执行该操作；
- 当sLmkdOutputStream写入buf信息失败，则会关闭sLmkdSocket，重新执行该操作；

这个重新执行操作最多3次，如果3次后还失败，则writeLmkd操作会直接结束。尝试3次，则不管结果如何都将退出该操作，可见writeLmkd写入操作还有可能失败的。

### 2.4 PL.openLmkdSocket

    private static boolean openLmkdSocket() {
        try {
            sLmkdSocket = new LocalSocket(LocalSocket.SOCKET_SEQPACKET);
            //与远程lmkd守护进程建立socket连接
            sLmkdSocket.connect(
                new LocalSocketAddress("lmkd",
                        LocalSocketAddress.Namespace.RESERVED));
            sLmkdOutputStream = sLmkdSocket.getOutputStream();
        } catch (IOException ex) {
            Slog.w(TAG, "lowmemorykiller daemon socket open failed");
            sLmkdSocket = null;
            return false;
        }
        return true;
    }

sLmkdSocket采用的是SOCK_SEQPACKET，这是类型的socket能提供顺序确定的，可靠的，双向基于连接的socket endpoint，与类型SOCK_STREAM很相似，唯一不同的是SEQPACKET保留消息的边界，而SOCK_STREAM是基于字节流，并不会记录边界。

举例：本地通过write()系统调用向远程先后发送两组数据：一组4字节，一组8字节；对于SOCK_SEQPACKET类型通过read()能获知这是两组数据以及大小，而对于SOCK_STREAM类型，通过read()一次性读取到12个字节，并不知道数据包的边界情况。

常见的数据类型还有SOCK_DGRAM，提供数据报形式，用于udp这样不可靠的通信过程。

再回到openLmkdSocket()方法，该方法是打开一个名为`lmkd`的socket，类型为LocalSocket.SOCKET_SEQPACKET，这只是一个封装，真实类型就是SOCK_SEQPACKET。先跟远程lmkd守护进程建立连接，再向其通过write()将数据写入该socket，再接下来进入lmkd过程。


## 三. lmkd

lmkd是由init进程，通过解析init.rc文件来启动的lmkd守护进程，lmkd会创建名为`lmkd`的socket，节点位于`/dev/socket/lmkd`，该socket用于跟上层framework交互。

    service lmkd /system/bin/lmkd
        class core
        critical
        socket lmkd seqpacket 0660 system system
        writepid /dev/cpuset/system-background/tasks

lmkd启动后，接下里的操作都在`platform/system/core/lmkd/lmkd.c`文件，首先进入main()方法

### 3.1 main

  int main(int argc __unused, char **argv __unused) {
      struct sched_param param = {
              .sched_priority = 1,
      };
      mlockall(MCL_FUTURE);
      sched_setscheduler(0, SCHED_FIFO, &param);
      //初始化【见小节3.2】
      if (!init())
          mainloop(); //成功后进入loop [见小节3.3]
      ALOGI("exiting");
      return 0;
  }

### 3.2 init

    static int init(void) {
        struct epoll_event epev;
        int i;
        int ret;
        page_k = sysconf(_SC_PAGESIZE);
        if (page_k == -1)
            page_k = PAGE_SIZE;
        page_k /= 1024;
        //创建epoll监听文件句柄
        epollfd = epoll_create(MAX_EPOLL_EVENTS);

        //获取lmkd控制描述符
        ctrl_lfd = android_get_control_socket("lmkd");
        //监听lmkd socket
        ret = listen(ctrl_lfd, 1);

        epev.events = EPOLLIN;
        epev.data.ptr = (void *)ctrl_connect_handler;

        //将文件句柄ctrl_lfd，加入epoll句柄
        if (epoll_ctl(epollfd, EPOLL_CTL_ADD, ctrl_lfd, &epev) == -1) {
            return -1;
        }

        maxevents++;
        //该路径是否具有可写的权限
        use_inkernel_interface = !access(INKERNEL_MINFREE_PATH, W_OK);
        if (use_inkernel_interface) {
            ALOGI("Using in-kernel low memory killer interface");
        } else {
            ret = init_mp(MEMPRESSURE_WATCH_LEVEL, (void *)&mp_event);
            if (ret)
                ALOGE("Kernel does not support memory pressure events or in-kernel low memory killer");
        }

        for (i = 0; i <= ADJTOSLOT(OOM_SCORE_ADJ_MAX); i++) {
            procadjslot_list[i].next = &procadjslot_list[i];
            procadjslot_list[i].prev = &procadjslot_list[i];
        }
        return 0;
    }

这里，通过检验/sys/module/lowmemorykiller/parameters/minfree节点是否具有可写权限来判断是否使用kernel接口来管理lmk事件。默认该节点是具有系统可写的权限，也就意味着use_inkernel_interface=1.

### 3.3 mainloop

    static void mainloop(void) {
        while (1) {
            struct epoll_event events[maxevents];
            int nevents;
            int i;
            ctrl_dfd_reopened = 0;

            //等待epollfd上的事件
            nevents = epoll_wait(epollfd, events, maxevents, -1);
            if (nevents == -1) {
                if (errno == EINTR)
                    continue;
                continue;
            }
            for (i = 0; i < nevents; ++i) {
                if (events[i].events & EPOLLERR)
                    ALOGD("EPOLLERR on event #%d", i);
                // 当事件到来，则调用ctrl_connect_handler方法 【见小节3.4】
                if (events[i].data.ptr)
                    (*(void (*)(uint32_t))events[i].data.ptr)(events[i].events);
            }
        }
    }

主循环调用epoll_wait()，等待epollfd上的事件，当接收到中断或者不存在事件，则执行continue操作。当事件到来，则
调用的ctrl_connect_handler方法，该方法是由init()过程中设定的方法。

### 3.4 ctrl_connect_handler

    static void ctrl_connect_handler(uint32_t events __unused) {
        struct epoll_event epev;
        if (ctrl_dfd >= 0) {
            ctrl_data_close();
            ctrl_dfd_reopened = 1;
        }
        ctrl_dfd = accept(ctrl_lfd, NULL, NULL);
        if (ctrl_dfd < 0) {
            ALOGE("lmkd control socket accept failed; errno=%d", errno);
            return;
        }
        ALOGI("ActivityManager connected");
        maxevents++;
        epev.events = EPOLLIN;
        epev.data.ptr = (void *)ctrl_data_handler;

        //将ctrl_lfd添加到epollfd
        if (epoll_ctl(epollfd, EPOLL_CTL_ADD, ctrl_dfd, &epev) == -1) {
            ALOGE("epoll_ctl for data connection socket failed; errno=%d", errno);
            ctrl_data_close();
            return;
        }
    }

当事件触发，则调用ctrl_data_handler

### 3.5 ctrl_data_handler

    static void ctrl_data_handler(uint32_t events) {
        if (events & EPOLLHUP) {
            //ActivityManager 连接已断开
            if (!ctrl_dfd_reopened)
                ctrl_data_close();
        } else if (events & EPOLLIN) {
            //[见小节3.6]
            ctrl_command_handler();
        }
    }

### 3.6 ctrl_command_handler

    static void ctrl_command_handler(void) {
        int ibuf[CTRL_PACKET_MAX / sizeof(int)];
        int len;
        int cmd = -1;
        int nargs;
        int targets;
        len = ctrl_data_read((char *)ibuf, CTRL_PACKET_MAX);
        if (len <= 0)
            return;
        nargs = len / sizeof(int) - 1;
        if (nargs < 0)
            goto wronglen;
        //将网络字节顺序转换为主机字节顺序
        cmd = ntohl(ibuf[0]);
        switch(cmd) {
        case LMK_TARGET:
            targets = nargs / 2;
            if (nargs & 0x1 || targets > (int)ARRAY_SIZE(lowmem_adj))
                goto wronglen;
            cmd_target(targets, &ibuf[1]);
            break;
        case LMK_PROCPRIO:
            if (nargs != 3)
                goto wronglen;
            //设置进程adj【见小节3.7】
            cmd_procprio(ntohl(ibuf[1]), ntohl(ibuf[2]), ntohl(ibuf[3]));
            break;
        case LMK_PROCREMOVE:
            if (nargs != 1)
                goto wronglen;
            cmd_procremove(ntohl(ibuf[1]));
            break;
        default:
            ALOGE("Received unknown command code %d", cmd);
            return;
        }
        return;
    wronglen:
        ALOGE("Wrong control socket read length cmd=%d len=%d", cmd, len);
    }

CTRL_PACKET_MAX 大小等于 (sizeof(int) * (MAX_TARGETS * 2 + 1))；而MAX_TARGETS=6,对于sizeof(int)=4的系统，则CTRL_PACKET_MAX=52。
获取framework传递过来的buf数据后，根据3种不同的命令，进入不同的分支。 接下来，继续以第二章节传递过来的LMK_PROCPRIO命令来往下讲解。

### 3.7 cmd_procprio

    static void cmd_procprio(int pid, int uid, int oomadj) {
        struct proc *procp;
        char path[80];
        char val[20];
        ...
        snprintf(path, sizeof(path), "/proc/%d/oom_score_adj", pid);
        snprintf(val, sizeof(val), "%d", oomadj);
        //向节点/proc/<pid>/oom_score_adj写入oomadj
        writefilestring(path, val);

        //当使用kernel方式则直接返回
        if (use_inkernel_interface)
            return;
        procp = pid_lookup(pid);
        if (!procp) {
                procp = malloc(sizeof(struct proc));
                if (!procp) {
                    // Oh, the irony.  May need to rebuild our state.
                    return;
                }
                procp->pid = pid;
                procp->uid = uid;
                procp->oomadj = oomadj;
                proc_insert(procp);
        } else {
            proc_unslot(procp);
            procp->oomadj = oomadj;
            proc_slot(procp);
        }
    }

既然，目前use_inkernel_interface=1，那么再接下里需要看看kernel的情况

## 四. lowmemorykiller driver

该驱动位于 drivers/staging/Android/lowmemorykiller.c

### 4.1 lowmem_scan （定期扫描？）





### 参数

在OOM的参数oom_adj，oom_score_adj，oom_score

- oom_adj:代表进程的优先级, 数值越大,优先级越低,越容易被杀. 取值范围[-16, 15]
- oom_score_adj: 取值范围[-1000, 1000]
- oom_score

想查看某个进程的上述3值，只需要知道pid，查看以下几个节点:

    /proc/<pid>/oom_adj
    /proc/<pid>/oom_score_adj
    /proc/<pid>/oom_score

对于oom_adj与oom_score_adj有一定的映射关系：

- 当oom_adj = 15, 则oom_score_adj=1000;
- 当oom_adj < 15， 则oom_score_adj= oom_adj * 1000/17;


## 驱动层

### 阈值

    /sys/module/lowmemorykiller/parameters/minfree
    /sys/module/lowmemorykiller/parameters/adj

adj：是指oom_score_adj
minfree：是指pages数，1page=4KB

例如：   
将"0,8" 写入节点/sys/module/lowmemorykiller/parameters/adj，
将"1024,4096" 写入节点/sys/module/lowmemorykiller/parameters/minfree。

那么     
当系统可用内存低于4096个pages时，则会杀掉oom_score_adj>=8的进程；
当系统可用内存低于1024个pages时，则会杀掉oom_score_adj>=0的进程；


### 策略

触发oom时,会触发kernel panic 或者 杀掉一个目标进程.

当触发lmkd,则先杀oom_adj最大的进程, 当oom_adj相等时,则选择oom_score_adj最大的进程.


### lmk 与 oom 对比

## 参考

http://blog.csdn.net/jscese/article/details/47317765
http://bbs.hwrf.com.cn/downrd/MP-HW-23049.pdf
http://www.w2bc.com/article/159838
http://www.cnblogs.com/angeldevil/archive/2013/05/21/3090872.html


http://www.jiandaima.com/blog/archives/294.html
