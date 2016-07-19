---
layout: post
title:  "Android系统启动-init篇"
date:   2016-02-05 20:15:40
catalog:  true
tags:
    - android
    - 系统启动


---

> 基于Android 6.0的源码剖析， 分析Android启动过程进程号为1的init进程的工作内容

    /system/core/init/Init.h
    /system/core/init/Init.cpp
    /system/core/init/Init_parser.h
    /system/core/init/Init_parser.cpp
    /system/core/init/Signal_handler.h
    /system/core/init/Signal_handler.cpp

## 一、概述

init是Linux系统中用户空间的第一个进程，进程号为1。Kernel启动后，在用户空间，启动init进程，并调用init中的main()方法执行init进程的职责。对于init进程的功能分为4部分：

- 分析和运行所有的init.rc文件;
- 生成设备驱动节点; （通过rc文件创建）
- 处理子进程的终止(signal方式);
- 提供属性服务。

### 1.1 main()

下面展示main()方法的骨干逻辑：

    int main(int argc, char** argv) {
        ...
        klog_init();  //初始化kernel log
        property_init(); //创建一块共享的内存空间，用于属性服务
        signal_handler_init();  //初始化子进程退出的信号处理过程

        property_load_boot_defaults(); //加载/default.prop文件
        start_property_service();   //启动属性服务器(通过socket通信)
        init_parse_config_file("/init.rc"); //解析init.rc文件

        //执行rc文件中触发器为 on early-init的语句
        action_for_each_trigger("early-init", action_add_queue_tail);
        //执行rc文件中触发器为 on init的语句
        action_for_each_trigger("init", action_add_queue_tail);
        //执行rc文件中触发器为 on late-init的语句
        action_for_each_trigger("late-init", action_add_queue_tail);

        while (true) {
            if (!waiting_for_exec) {
                execute_one_command();
                restart_processes();
            }
            int timeout = -1;
            if (process_needs_restart) {
                timeout = (process_needs_restart - gettime()) * 1000;
                if (timeout < 0)
                    timeout = 0;
            }
            if (!action_queue_empty() || cur_action) {
                timeout = 0;
            }

            epoll_event ev;
            //循环 等待事件发生
            int nr = TEMP_FAILURE_RETRY(epoll_wait(epoll_fd, &ev, 1, timeout));
            if (nr == -1) {
                ERROR("epoll_wait failed: %s\n", strerror(errno));
            } else if (nr == 1) {
                ((void (*)()) ev.data.ptr)();
            }
        }
        return 0;
    }

## 二、信号处理

在init.cpp的main()方法中，通过signal_handler_init()来初始化信号处理过程。

### 1. 初始化signal句柄

signal_handler.cpp

**【1-1】signal_handler_init**

    void signal_handler_init() {
        //创建信号SIGCHLD的机制
        int s[2];
        // 调用一对已连接好的socket（socketpair是syscall命令）
        if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0, s) == -1) {
            ERROR("socketpair failed: %s\n", strerror(errno));
            exit(1);
        }
        signal_write_fd = s[0];
        signal_read_fd = s[1];
        //当捕获信号SIGCHLD，则写入signal_write_fd
        struct sigaction act;
        memset(&act, 0, sizeof(act));
        act.sa_handler = SIGCHLD_handler; 【见流程1-2】
        //SA_NOCLDSTOP使init进程只有在其子进程终止时才会受到SIGCHLD信号
        act.sa_flags = SA_NOCLDSTOP;
        sigaction(SIGCHLD, &act, 0);
        reap_any_outstanding_children(); 【见流程2-1】
        //对于handle_signal 【见流程2-3】
        register_epoll_handler(signal_read_fd, handle_signal);  //【见流程4】
    }

每个进程在处理其他进程发送的signal信号时都需要先注册，当进程的运行状态改变或终止时会产生某种signal信号，init进程是所有用户空间进程的父进程，当其子进程终止时产生SIGCHLD信号，init进程调用信号安装函数sigaction()，传递参数给sigaction结构体，便完成信号处理的过程。

**【1-2】SIGCHLD_handler**

    static void SIGCHLD_handler(int) {
        //向signal_write_fd写入1，直到成功为止
        if (TEMP_FAILURE_RETRY(write(signal_write_fd, "1", 1)) == -1) {
            ERROR("write(signal_write_fd) failed: %s\n", strerror(errno));
        }
    }

**【1-3】handle_signal**

    static void handle_signal() {
        char buf[32];
        //读取signal_read_fd数据，放入buf
        read(signal_read_fd, buf, sizeof(buf));
        reap_any_outstanding_children(); 【见流程3-1】
    }


- SIGCHLD_handler：向signal_write_fd写入1；
- handle_signal：读取signal_read_fd数据，放入buf；

### 2. 循环处理子进程

signal_handler.cpp

**【2-1】reap_any_outstanding_children**

    static void reap_any_outstanding_children() {
        while (wait_for_one_process()) { 【见流程2-2】
        }
    }

**【2-2】wait_for_one_process**

    static bool wait_for_one_process() {
        int status;
        //等待任意子进程，如果子进程没有退出则返回0，否则则返回该子进程pid。
        pid_t pid = TEMP_FAILURE_RETRY(waitpid(-1, &status, WNOHANG));
        if (pid == 0) {
            return false;
        } else if (pid == -1) {
            ERROR("waitpid failed: %s\n", strerror(errno));
            return false;
        }
        service* svc = service_find_by_pid(pid); //根据pid查找到相应的service
        std::string name;

        if (!svc) {
            return true;
        }

        //当flags为RESTART，且不是ONESHOT时，先kill进程组内所有的子进程或子线程
        if (!(svc->flags & SVC_ONESHOT) || (svc->flags & SVC_RESTART)) {
            kill(-pid, SIGKILL);
        }

        //移除当前服务svc中的所有创建过的socket
        for (socketinfo* si = svc->sockets; si; si = si->next) {
            char tmp[128];
            snprintf(tmp, sizeof(tmp), ANDROID_SOCKET_DIR"/%s", si->name);
            unlink(tmp);
        }

        //当flags为EXEC时，释放相应的服务
        if (svc->flags & SVC_EXEC) {
            INFO("SVC_EXEC pid %d finished...\n", svc->pid);
            waiting_for_exec = false;
            list_remove(&svc->slist);
            free(svc->name);
            free(svc);
            return true;
        }
        svc->pid = 0;
        svc->flags &= (~SVC_RUNNING);

        //对于ONESHOT服务，使其进入disabled状态
        if ((svc->flags & SVC_ONESHOT) && !(svc->flags & SVC_RESTART)) {
            svc->flags |= SVC_DISABLED;
        }
        //禁用和重置的服务，都不再自动重启
        if (svc->flags & (SVC_DISABLED | SVC_RESET))  {
            svc->NotifyStateChange("stopped"); //设置相应的service状态为stopped
            return true;
        }

        //服务在4分钟内重启次数超过4次，则重启手机进入recovery模式
        time_t now = gettime();
        if ((svc->flags & SVC_CRITICAL) && !(svc->flags & SVC_RESTART)) {
            if (svc->time_crashed + CRITICAL_CRASH_WINDOW >= now) {
                if (++svc->nr_crashed > CRITICAL_CRASH_THRESHOLD) {
                    android_reboot(ANDROID_RB_RESTART2, 0, "recovery");
                    return true;
                }
            } else {
                svc->time_crashed = now;
                svc->nr_crashed = 1;
            }
        }
        svc->flags &= (~SVC_RESTART);
        svc->flags |= SVC_RESTARTING;

        //执行当前service中所有onrestart命令
        struct listnode* node;
        list_for_each(node, &svc->onrestart.commands) {
            command* cmd = node_to_item(node, struct command, clist);
            cmd->func(cmd->nargs, cmd->args);
        }
        //设置相应的service状态为restarting
        svc->NotifyStateChange("restarting");
        return true;
    }


另外：通过`getprop | grep init.svc` 可查看所有的service运行状态。状态总共分为：running, stopped, restarting

### 3. 注册epoll句柄

signal_handler.cpp

    void register_epoll_handler(int fd, void (*fn)()) {
        epoll_event ev;
        ev.events = EPOLLIN; //可读
        ev.data.ptr = reinterpret_cast<void*>(fn);
        //将fd的可读事件加入到epoll_fd的监听队列中
        if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, fd, &ev) == -1) {
            ERROR("epoll_ctl failed: %s\n", strerror(errno));
        }
    }

### 4. 处理子进程的终止

![init_oneshot](/images/boot/init/init_oneshot.jpg)

当init子进程退出时，会产生SIGCHLD信号，并发送给init进程，通过socket套接字传递数据，调用到wait_for_one_process()方法，根据是否是oneshot，来决定是重启子进程，还是放弃启动。

## 三、rc文件语法

rc文件语法是以行尾单位，以空格间隔的语法，以#开始代表注释行。rc文件主要包含Action、Service、Command、Options，其中对于Action和Service的名称都是唯一的，对于重复的命名视为无效。

### 1. 动作Action

Action： 通过trigger，即以 on开头的语句，决定何时执行相应的service。

- on early-init; 在初始化早期阶段触发；
- on init; 在初始化阶段触发；
- on late-init;  在初始化晚期阶段触发；
- on boot/charger： 当系统启动/充电时触发，还包含其他情况，此处不一一列举；
- on property:\<key\>=\<value\>: 当属性值满足条件时触发；

### 2. 服务Service
服务Service，以 service开头，由init进程启动，一般运行于另外一个init的子进程，所以启动service前需要判断对应的可执行文件是否存在。init生成的子进程，定义在rc文件，其中每一个service，在启动时会通过fork方式生成子进程。

例如： `service servicemanager /system/bin/servicemanager`代表的是服务名为servicemanager，服务的路径，也就是服务执行操作时运行/system/bin/servicemanager。

### 3. 命令Command
下面列举常用的命令

- class_start \<service_class_name\>： 启动属于同一个class的所有服务；
- start \<service_name\>： 启动指定的服务，若已启动则跳过；
- stop \<service_name\>： 停止正在运行的服务
- setprop \<name\> \<value\>：设置属性值
- mkdir \<path\>：创建指定目录
- symlink \<target\> \<sym_link\>： 创建连接到\<target\>的\<sym_link\>符号链接；
- write \<path\> \<string\>： 向文件path中写入字符串；
- exec： fork并执行，会阻塞init进程直到程序完毕；
- exprot \<name\> \<name\>：设定环境变量；
- loglevel \<level\>：设置log级别

### 4. 可选操作Options

Options是Services的可选项，与service配合使用

- disabled: 不随class自动启动，只有根据service名才启动；
- oneshot: service退出后不再重启；
- user/group： 设置执行服务的用户/用户组，默认都是root；
- class：设置所属的类名，当所属类启动/退出时，服务也启动/停止，默认为default；
- onrestart:当服务重启时执行相应命令；
- socket: 创建名为`/dev/socket/<name>`的socket
- critical: 在规定时间内该service不断重启，则系统会重启并进入恢复模式


**default:** 意味着disabled=false，oneshot=false，critical=false。

所有的Service里面只有servicemanager ，zygote ，surfaceflinger这3个service有`onrestart`关键字来触发其他service启动过程。

    //zygote可触发media、netd重启
    service zygote /system/bin/app_process -Xzygote /system/bin --zygote --start-system-server
        class main
        socket zygote stream 660 root system
        onrestart write /sys/android_power/request_state wake
        onrestart write /sys/power/state on
        onrestart restart media
        onrestart restart netd

    //servicemanager可触发healthd、zygote、media、surfaceflinger、drm重启
    service servicemanager /system/bin/servicemanager
        class core
        user system
        group system
        critical
        onrestart restart healthd
        onrestart restart zygote
        onrestart restart media
        onrestart restart surfaceflinger
        onrestart restart drm

    //surfaceflinger可触发zygote重启
    service surfaceflinger /system/bin/surfaceflinger
        class core
        user system
        group graphics drmrpc
        onrestart restart zygote

## 四、创建Zygote

在init.zygote.rc文件中，zygote服务定义如下：

    service zygote /system/bin/app_process -Xzygote /system/bin --zygote --start-system-server
        class main
        socket zygote stream 660 root system
        onrestart write /sys/android_power/request_state wake
        onrestart write /sys/power/state on
        onrestart restart media
        onrestart restart netd

通过`Init_parser.cpp`完成整个service解析工作，此处就不详细展开讲解析过程，该过程主要是创建一个名"zygote"的service结构体，一个socketinfo结构体(用于socket通信)，以及一个包含4个onrestart的action结构体。

Zygote服务会随着main class的启动而启动，退出后会由init重启zygote，即使多次重启也不会进入recovery模式。zygote所对应的可执行文件是/system/bin/app_process，通过调用`pid =fork()`创建子进程，通过`execve(svc->args[0], (char**)svc->args, (char**) ENV)`，进入App_main.cpp的main()函数。故zygote是通过fork和execv共同创建的。

流程如下：

![zygote_init](/images/boot/init/zygote_init.jpg)

而关于Zygote重启在前面的信号处理过程中讲过，是处理SIGCHLD信号，init进程重启zygote进程，更多关于Zygote内容见[Zygote篇](http://gityuan.com/2016/02/13/android-zygote/)。


## 五、属性服务

当某个进程A，通过property_set()修改属性值后，init进程会检查访问权限，当权限满足要求后，则更改相应的属性值，属性值一旦改变则会触发相应的触发器（即rc文件中的on开头的语句)，在Android Shared Memmory（共享内存区域）中有一个_system_property_area_区域，里面记录着所有的属性值。对于进程A通过property_get（）方法，获取的也是该共享内存区域的属性值。


property_service.cpp

    void property_init() {
        //用于保证只初始化_system_property_area_区域一次
        if (property_area_initialized) {
            return;
        }
        property_area_initialized = true;
        if (__system_property_area_init()) {
            return;
        }
        pa_workspace.size = 0;
        pa_workspace.fd = open(PROP_FILENAME, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
        if (pa_workspace.fd == -1) {
            ERROR("Failed to open %s: %s\n", PROP_FILENAME, strerror(errno));
            return;
        }
    }


在properyty_init函数中，先调用init_property_area函数，创建一块用于存储属性的共享内存，而共享内存是可以跨进程的。

**关于加载的prop文件**

通过`load_all_load_all_propsprops()`方法，加载以下：

1. /system/build.prop；
2. /vendor/build.prop；
3. /factory/factory.prop；
4. /data/local.prop；
5. /data/property路径下的persist属性

**对于属性**：

1. 属性名以`ctl.`开头，则表示是控制消息，控制消息用来执行一些命令。例如：
    - setprop ctl.start bootanim 查看开机动画；
    - setprop ctl.stop bootanim 关闭开机动画；
    - setprop ctl.start pre-recovery 进入recovery模式。
2. 属性名以`ro.``开头，则表示是只读的，不能设置，所以直接返回。
3. 属性名以`persist.``开头，则需要把这些值写到对应文件中去。
