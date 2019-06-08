---
layout: post
title:  "Android系统启动-Init篇"
date:   2016-02-05 20:15:40
catalog:  true
tags:
    - android
    - 系统启动

---

> 基于Android 6.0的源码剖析， 分析Android启动过程进程号为1的init进程的工作内容

    system/core/init/
      - init.cpp
      - init_parser.cpp
      - signal_handler.cpp

## 一、概述

init进程是Linux系统中用户空间的第一个进程，进程号固定为1。Kernel启动后，在用户空间启动init进程，并调用init中的main()方法执行init进程的职责。对于init进程的功能分为4部分：

- 解析并运行所有的init.rc相关文件
- 根据rc文件，生成相应的设备驱动节点
- 处理子进程的终止(signal方式)
- 提供属性服务的功能

接下来从main()方法说起。

#### 1.1 main
[-> init.cpp]

```CPP
static int epoll_fd = -1;

int main(int argc, char** argv) {
    ...
    //设置文件属性0777
    umask(0);
    //初始化内核log，位于节点/dev/kmsg【见小节1.2】
    klog_init();
    //设置输出的log级别
    klog_set_level(KLOG_NOTICE_LEVEL);

    //创建一块共享的内存空间，用于属性服务【见小节5.1】
    property_init();
    //初始化epoll功能
    epoll_fd = epoll_create1(EPOLL_CLOEXEC);
    //初始化子进程退出的信号处理函数，并调用epoll_ctl设置signal fd可读的回调函数【见小节2.1】
    signal_handler_init();  

    //加载default.prop文件
    property_load_boot_defaults();
    //启动属性服务器，此处会调用epoll_ctl设置property fd可读的回调函数【见小节5.2】
    start_property_service();   
    //解析init.rc文件
    init_parse_config_file("/init.rc");

    //执行rc文件中触发器为on early-init的语句
    action_for_each_trigger("early-init", action_add_queue_tail);
    //等冷插拔设备初始化完成
    queue_builtin_action(wait_for_coldboot_done_action, "wait_for_coldboot_done");
    queue_builtin_action(mix_hwrng_into_linux_rng_action, "mix_hwrng_into_linux_rng");
    //设备组合键的初始化操作，此处会调用epoll_ctl设置keychord fd可读的回调函数
    queue_builtin_action(keychord_init_action, "keychord_init");

    // 屏幕上显示Android静态Logo 【见小节1.3】
    queue_builtin_action(console_init_action, "console_init");

    //执行rc文件中触发器为on init的语句
    action_for_each_trigger("init", action_add_queue_tail);
    queue_builtin_action(mix_hwrng_into_linux_rng_action, "mix_hwrng_into_linux_rng");

    char bootmode[PROP_VALUE_MAX];
    //当处于充电模式，则charger加入执行队列；否则late-init加入队列。
    if (property_get("ro.bootmode", bootmode) > 0 && strcmp(bootmode, "charger") == 0)
    {
       action_for_each_trigger("charger", action_add_queue_tail);
    } else {
       action_for_each_trigger("late-init", action_add_queue_tail);
    }
    //触发器为属性是否设置
    queue_builtin_action(queue_property_triggers_action, "queue_property_triggers");

    while (true) {
        if (!waiting_for_exec) {
            execute_one_command();
             //根据需要重启服务【见小节1.4】
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
        //循环等待事件发生
        int nr = TEMP_FAILURE_RETRY(epoll_wait(epoll_fd, &ev, 1, timeout));
        if (nr == -1) {
            ERROR("epoll_wait failed: %s\n", strerror(errno));
        } else if (nr == 1) {
            ((void (*)()) ev.data.ptr)();
        }
    }
    return 0;
}
```

init进程执行完成后进入循环等待epoll_wait的状态。

#### 1.2 log系统

此时android的log系统还没有启动，采用kernel的log系统，打开的设备节点/dev/kmsg，
那么可通过`cat /dev/kmsg`来获取内核log。

接下来，设置log的输出级别为KLOG_NOTICE_LEVEL(5)，当log级别小于5时则会输出到kernel log，
默认值为3.

    #define KLOG_ERROR_LEVEL   3
    #define KLOG_WARNING_LEVEL 4
    #define KLOG_NOTICE_LEVEL  5
    #define KLOG_INFO_LEVEL    6
    #define KLOG_DEBUG_LEVEL   7
    #define KLOG_DEFAULT_LEVEL  3 //默认为3

#### 1.3 console_init_action
[-> init.cpp]

    static int console_init_action(int nargs, char **args)
    {
        char console[PROP_VALUE_MAX];
        if (property_get("ro.boot.console", console) > 0) {
            snprintf(console_name, sizeof(console_name), "/dev/%s", console);
        }

        int fd = open(console_name, O_RDWR | O_CLOEXEC);
        if (fd >= 0)
            have_console = 1;
        close(fd);

        fd = open("/dev/tty0", O_WRONLY | O_CLOEXEC);
        if (fd >= 0) {
            const char *msg;
                msg = "\n"
            "\n"
            "\n"
            "\n"
            "\n"
            "\n"
            "\n"  // console is 40 cols x 30 lines
            "\n"
            "\n"
            "\n"
            "\n"
            "\n"
            "\n"
            "\n"
            "             A N D R O I D ";
            write(fd, msg, strlen(msg));
            close(fd);
        }

        return 0;
    }

这便是开机显示的底部带ANDROID字样的画面。

#### 1.4 restart_processes
[-> init.cpp]

    static void restart_processes()
    {
        process_needs_restart = 0;
        service_for_each_flags(SVC_RESTARTING,
                               restart_service_if_needed);
    }

检查service_list中的所有服务，对于带有SVC_RESTARTING标志的服务，则都会调用其相应的restart_service_if_needed。

    static void restart_service_if_needed(struct service *svc)
    {
        time_t next_start_time = svc->time_started + 5;

        if (next_start_time <= gettime()) {
            svc->flags &= (~SVC_RESTARTING);
            service_start(svc, NULL);
            return;
        }

        if ((next_start_time < process_needs_restart) ||
            (process_needs_restart == 0)) {
            process_needs_restart = next_start_time;
        }
    }

之后再调用service_start来启动服务。

接下来，解读init的main方法中的4大块核心知识点：信号处理、rc文件语法、启动服务以及属性服务。

## 二、信号处理

在小节[1.1]的init.cpp的main()方法中通过signal_handler_init()来初始化信号处理过程。

主要工作：

- 初始化signal句柄；
- 循环处理子进程；
- 注册epoll句柄；
- 处理子进程的终止；

#### 2.1 signal_handler_init
[-> signal_handler.cpp]

    void signal_handler_init() {
        int s[2];
        // 创建socket pair
        if (socketpair(AF_UNIX, SOCK_STREAM | SOCK_NONBLOCK | SOCK_CLOEXEC, 0, s) == -1) {
            exit(1);
        }
        signal_write_fd = s[0];
        signal_read_fd = s[1];
        //当捕获信号SIGCHLD，则写入signal_write_fd
        struct sigaction act;
        memset(&act, 0, sizeof(act));
        act.sa_handler = SIGCHLD_handler;
        //SA_NOCLDSTOP使init进程只有在其子进程终止时才会受到SIGCHLD信号
        act.sa_flags = SA_NOCLDSTOP;
        sigaction(SIGCHLD, &act, 0);

        //进入waitpid来处理子进程是否退出的情况【见小节2.2】
        reap_any_outstanding_children();
        //调用epoll_ctl方法来注册epoll的回调函数【见小节2.3】
        register_epoll_handler(signal_read_fd, handle_signal);
    }

每个进程在处理其他进程发送的signal信号时都需要先注册，当进程的运行状态改变或终止时会产生某种signal信号，init进程是所有用户空间进程的父进程，当其子进程终止时产生SIGCHLD信号，init进程调用信号安装函数sigaction()，传递参数给sigaction结构体，便完成信号处理的过程。

这里有两个重要的函数：SIGCHLD_handler和handle_signal，如下：

    //写入数据
    static void SIGCHLD_handler(int) {
        //向signal_write_fd写入1，直到成功为止
        if (TEMP_FAILURE_RETRY(write(signal_write_fd, "1", 1)) == -1) {
            ERROR("write(signal_write_fd) failed: %s\n", strerror(errno));
        }
    }

    //读取数据
    static void handle_signal() {
        char buf[32];
        //读取signal_read_fd中的数据，并放入buf
        read(signal_read_fd, buf, sizeof(buf));
        reap_any_outstanding_children(); 【见小节2.2】
    }

#### 2.2 reap_any_outstanding_children
[-> signal_handler.cpp]

    static void reap_any_outstanding_children() {
        while (wait_for_one_process()) { }
    }

    static bool wait_for_one_process() {
        int status;
        //等待任意子进程，如果子进程没有退出则返回0，否则则返回该子进程pid。
        pid_t pid = TEMP_FAILURE_RETRY(waitpid(-1, &status, WNOHANG));
        if (pid == 0) {
            return false;
        } else if (pid == -1) {
            return false;
        }
        //根据pid查找到相应的service
        service* svc = service_find_by_pid(pid);
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

#### 2.3 register_epoll_handler
[-> signal_handler.cpp]

    void register_epoll_handler(int fd, void (*fn)()) {
        epoll_event ev;
        ev.events = EPOLLIN;
        ev.data.ptr = reinterpret_cast<void*>(fn);
        //将fd的可读事件加入到epoll_fd的监听队列中
        if (epoll_ctl(epoll_fd, EPOLL_CTL_ADD, fd, &ev) == -1) {
            ERROR("epoll_ctl failed: %s\n", strerror(errno));
        }
    }

当fd可读，则会触发调用(*fn)函数。

## 三、rc文件语法

rc文件语法是以行尾单位，以空格间隔的语法，以#开始代表注释行。rc文件主要包含Action、Service、Command、Options，其中对于Action和Service的名称都是唯一的，对于重复的命名视为无效。

#### 3.1 Action

Action： 通过触发器trigger，即以on开头的语句来决定执行相应的service的时机，具体有如下时机：

- on early-init; 在初始化早期阶段触发；
- on init; 在初始化阶段触发；
- on late-init;  在初始化晚期阶段触发；
- on boot/charger： 当系统启动/充电时触发，还包含其他情况，此处不一一列举；
- on property:\<key\>=\<value\>: 当属性值满足条件时触发；

#### 3.2 Service
服务Service，以 service开头，由init进程启动，一般运行在init的一个子进程，所以启动service前需要判断对应的可执行文件是否存在。init生成的子进程，定义在rc文件，其中每一个service在启动时会通过fork方式生成子进程。

例如： `service servicemanager /system/bin/servicemanager`代表的是服务名为servicemanager，服务执行的路径为/system/bin/servicemanager。

#### 3.3 Command
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

#### 3.4 Options
Options是Service的可选项，与service配合使用

- disabled: 不随class自动启动，只有根据service名才启动；
- oneshot: service退出后不再重启；
- user/group： 设置执行服务的用户/用户组，默认都是root；
- class：设置所属的类名，当所属类启动/退出时，服务也启动/停止，默认为default；
- onrestart:当服务重启时执行相应命令；
- socket: 创建名为`/dev/socket/<name>`的socket
- critical: 在规定时间内该service不断重启，则系统会重启并进入恢复模式

**default:** 意味着disabled=false，oneshot=false，critical=false。

## 四、启动服务

#### 4.1 启动顺序

    on early-init
    on init
    on late-init
        trigger post-fs      
        trigger load_system_props_action
        trigger post-fs-data  
        trigger load_persist_props_action
        trigger firmware_mounts_complete
        trigger boot   

    on post-fs      //挂载文件系统
        start logd
        mount rootfs rootfs / ro remount
        mount rootfs rootfs / shared rec
        mount none /mnt/runtime/default /storage slave bind rec
        ...

    on post-fs-data  //挂载data
        start logd
        start vold   //启动vold
        ...

    on boot      //启动核心服务
        ...
        class_start core //启动core class

触发器的执行顺序为on early-init -> init -> late-init，从上面的代码可知，在late-init触发器中会触发文件系统挂载以及on boot。再on boot过程会触发启动core class。至于main class的启动是由vold.decrypt的以下4个值的设置所决定的，
该过程位于system/vold/cryptfs.c文件。

    on nonencrypted
        class_start main
        class_start late_start

    on property:vold.decrypt=trigger_restart_min_framework
        class_start main

    on property:vold.decrypt=trigger_restart_framework
        class_start main
        class_start late_start

    on property:vold.decrypt=trigger_reset_main
        class_reset main

    on property:vold.decrypt=trigger_shutdown_framework
        class_reset late_start
        class_reset main


#### 4.2 服务启动(Zygote)
在init.zygote.rc文件中，zygote服务定义如下：

    service zygote /system/bin/app_process -Xzygote /system/bin --zygote --start-system-server
        class main
        socket zygote stream 660 root system
        onrestart write /sys/android_power/request_state wake
        onrestart write /sys/power/state on
        onrestart restart media
        onrestart restart netd

通过`init_parser.cpp`完成整个service解析工作，此处就不详细展开讲解析过程，该过程主要工作是：

- 创建一个名叫"zygote"的service结构体；
- 创建一个用于socket通信的socketinfo结构体；
- 创建一个包含4个onrestart的action结构体。

Zygote服务会随着main class的启动而启动，退出后会由init重启zygote，即使多次重启也不会进入recovery模式。zygote所对应的可执行文件是/system/bin/app_process，通过调用`pid =fork()`创建子进程，通过`execve(svc->args[0], (char**)svc->args, (char**) ENV)`，进入App_main.cpp的main()函数。故zygote是通过fork和execv共同创建的。

流程如下：

![zygote_init](/images/boot/init/zygote_init.jpg)

而关于Zygote重启在前面的信号处理过程中讲过，是处理SIGCHLD信号，init进程重启zygote进程，更多关于Zygote内容见[Zygote篇](http://gityuan.com/2016/02/13/android-zygote/)。

#### 4.3 服务重启

![init_oneshot](/images/boot/init/init_oneshot.jpg)

当init子进程退出时，会产生SIGCHLD信号，并发送给init进程，通过socket套接字传递数据，调用到wait_for_one_process()方法，根据是否是oneshot，来决定是重启子进程，还是放弃启动。

所有的Service里面只有servicemanager ，zygote ，surfaceflinger这3个服务有`onrestart`关键字来触发其他service启动过程。

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

由上可知：

- zygote：触发media、netd以及子进程(包括system_server进程)重启；
- system_server: 触发zygote重启;
- surfaceflinger：触发zygote重启;
- servicemanager: 触发zygote、healthd、media、surfaceflinger、drm重启

所以，surfaceflinger,servicemanager,zygote自身以及system_server进程被杀都会触发Zygote重启。

## 五、属性服务

当某个进程A，通过property_set()修改属性值后，init进程会检查访问权限，当权限满足要求后，则更改相应的属性值，属性值一旦改变则会触发相应的触发器（即rc文件中的on开头的语句)，在Android Shared Memmory（共享内存区域）中有一个_system_property_area_区域，里面记录着所有的属性值。对于进程A通过property_get（）方法，获取的也是该共享内存区域的属性值。

#### 5.1 property_init
[-> property_service.cpp]

    void property_init() {
        //用于保证只初始化_system_property_area_区域一次
        if (property_area_initialized) {
            return;
        }
        property_area_initialized = true;
        //创建共享内存
        if (__system_property_area_init()) {
            return;
        }
        pa_workspace.size = 0;
        pa_workspace.fd = open(PROP_FILENAME, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    }

该方法核心功能在执行__system_property_area_init()方法，创建用于跨进程的共享内存。主要工作如下：

- 执行open()，打开名为”/dev/__properties__“的共享内存文件，并设置大小为128KB；
- 执行mmap()，将该内存映射到init进程；
- 将该内存的首地址保存在全局变量__system_property_area__，后续的增加或者修改属性都基于该变量来计算位置。


**关于加载的prop文件**

通过`load_all_load_all_propsprops()`方法，加载以下：

1. /system/build.prop；
2. /vendor/build.prop；
3. /factory/factory.prop；
4. /data/local.prop；
5. /data/property路径下的persist属性

#### 5.2 start_property_service
[-> property_service.cpp]

```Java
void start_property_service() {
    property_set("ro.property_service.version", "2");

    property_set_fd = CreateSocket(PROP_SERVICE_NAME, SOCK_STREAM | SOCK_CLOEXEC | SOCK_NONBLOCK,
                                   false, 0666, 0, 0, nullptr, sehandle);
    listen(property_set_fd, 8);
    //设置property文件描述符可读的回调函数【见小节2.3】
    register_epoll_handler(property_set_fd, handle_property_set_fd);
}
```

创建并监听名叫“property_service”的socket，再利用epoll_ctl设置property文件描述符触发可读时的回调函数为handle_property_set_fd，接下来看看该函数的实现。

#### 5.3 handle_property_set_fd

```Java
static void handle_property_set_fd() {
    static constexpr uint32_t kDefaultSocketTimeout = 2000; /* ms */

    int s = accept4(property_set_fd, nullptr, nullptr, SOCK_CLOEXEC);

    struct ucred cr;
    socklen_t cr_size = sizeof(cr);
    getsockopt(s, SOL_SOCKET, SO_PEERCRED, &cr, &cr_size) < 0)；

    SocketConnection socket(s, cr);
    uint32_t timeout_ms = kDefaultSocketTimeout; //设置2秒超时

    uint32_t cmd = 0;
    if (!socket.RecvUint32(&cmd, &timeout_ms)) {
        socket.SendUint32(PROP_ERROR_READ_CMD);
        return;
    }

    switch (cmd) {
    case PROP_MSG_SETPROP: {
        char prop_name[PROP_NAME_MAX];
        char prop_value[PROP_VALUE_MAX];

        if (!socket.RecvChars(prop_name, PROP_NAME_MAX, &timeout_ms) ||
            !socket.RecvChars(prop_value, PROP_VALUE_MAX, &timeout_ms)) {
          return;
        }

        prop_name[PROP_NAME_MAX-1] = 0;
        prop_value[PROP_VALUE_MAX-1] = 0;
        //设置property【见小节5.4】
        handle_property_set(socket, prop_value, prop_value, true);
        break;
      }

    case PROP_MSG_SETPROP2: {
        std::string name;
        std::string value;
        if (!socket.RecvString(&name, &timeout_ms) ||
            !socket.RecvString(&value, &timeout_ms)) {
          socket.SendUint32(PROP_ERROR_READ_DATA);
          return;
        }
        //设置property【见小节5.4】
        handle_property_set(socket, name, value, false);
        break;
      }

    default:
        socket.SendUint32(PROP_ERROR_INVALID_CMD);
        break;
    }
}
```

这里针对socket接收事件设置2秒超时，也就是说property的设置过程有可能耗时。

#### 5.4 handle_property_set

```Java
static void handle_property_set(SocketConnection& socket,
                                const std::string& name,
                                const std::string& value,
                                bool legacy_protocol) {
  const char* cmd_name = legacy_protocol ? "PROP_MSG_SETPROP" : "PROP_MSG_SETPROP2";
  if (!is_legal_property_name(name)) { //检查属性名是否合规
    socket.SendUint32(PROP_ERROR_INVALID_NAME);
    return;
  }

  struct ucred cr = socket.cred();
  char* source_ctx = nullptr;
  getpeercon(socket.socket(), &source_ctx);

  if (android::base::StartsWith(name, "ctl.")) {
    if (check_control_mac_perms(value.c_str(), source_ctx, &cr)) {
      //处理以ctl.开头的属性
      handle_control_message(name.c_str() + 4, value.c_str());
    }
    ...
  } else {
    if (check_perms(name, source_ctx, &cr)) {
      //设置属性名和属性值
      uint32_t result = property_set(name, value);
    }
    ...
  }
  freecon(source_ctx);
}
```

这里会检测属性名是否合规，具体检查规范如下：

```Java
bool is_legal_property_name(const std::string& name) {
    size_t namelen = name.size();

    if (namelen < 1) return false;
    if (name[0] == '.') return false;
    if (name[namelen - 1] == '.') return false;

    /* Only allow alphanumeric, plus '.', '-', '@', ':', or '_' */
    /* Don't allow ".." to appear in a property name */
    for (size_t i = 0; i < namelen; i++) {
        if (name[i] == '.') {
            // i=0 is guaranteed to never have a dot. See above.
            if (name[i-1] == '.') return false;
            continue;
        }
        if (name[i] == '_' || name[i] == '-' || name[i] == '@' || name[i] == ':') continue;
        if (name[i] >= 'a' && name[i] <= 'z') continue;
        if (name[i] >= 'A' && name[i] <= 'Z') continue;
        if (name[i] >= '0' && name[i] <= '9') continue;
        return false;
    }

    return true;
}
```

```Java
uint32_t property_set(const std::string& name, const std::string& value) {
    return PropertySetImpl(name, value);
}

static uint32_t PropertySetImpl(const std::string& name, const std::string& value) {
    size_t valuelen = value.size();

    if (!is_legal_property_name(name)) {
        return PROP_ERROR_INVALID_NAME;
    }

    if (valuelen >= PROP_VALUE_MAX) { //属性名不可过长
        return PROP_ERROR_INVALID_VALUE;
    }

    prop_info* pi = (prop_info*) __system_property_find(name.c_str());
    if (pi != nullptr) {
        // 以ro.开头的属性不可更改
        if (android::base::StartsWith(name, "ro.")
            && strcmp(name.c_str(),"ro.build.software.version")) {
            return PROP_ERROR_READ_ONLY_PROPERTY;
        }
        //更新属性
        __system_property_update(pi, value.c_str(), valuelen);
    } else {
        //添加属性
        int rc = __system_property_add(name.c_str(), name.size(), value.c_str(), valuelen);
    }

    //以persist.开头的属性需要持久化
    if (persistent_properties_loaded && android::base::StartsWith(name, "persist.")) {
        write_persistent_property(name.c_str(), value.c_str());
    }
    //属性值改变的通知过程
    property_changed(name, value);
    return PROP_SUCCESS;
}

```


不同属性执行逻辑有所不同，主要区分如下：

- 属性名以`ctl.`开头，则表示是控制消息，控制消息用来执行一些命令。例如：
    - setprop ctl.start bootanim 查看开机动画；
    - setprop ctl.stop bootanim 关闭开机动画；
    - setprop ctl.start pre-recovey 进入recovery模式；
- 属性名以`ro.`开头，则表示是只读的，不能设置，所以直接返回；
- 属性名以`persist.`开头，则需要把这些值写到对应文件；需要注意的是，persist用于持久化保存某些属性值，当同时也带来了额外的IO操作。

## 六、总结

init进程(pid=1)是Linux系统中用户空间的第一个进程，主要工作如下：

- 创建一块共享的内存空间，用于属性服务器;
- 解析各个rc文件，并启动相应属性服务进程;
- 初始化epoll，依次设置signal、property、keychord这3个fd可读时相对应的回调函数;
- 进入无限循环状态，执行如下流程：
    - 检查action_queue列表是否为空，若不为空则执行相应的action;
    - 检查是否需要重启的进程，若有则将其重新启动;
    - 进入epoll_wait等待状态，直到系统属性变化事件(property_set改变属性值)，或者收到子进程的信号SIGCHLD，再或者keychord
    键盘输入事件，则会退出等待状态，执行相应的回调函数。

可见init进程在开机之后的核心工作就是响应property变化事件和回收僵尸进程。当某个进程调用property_set来改变一个系统属性值时，系统会通过socket向init进程发送一个property变化的事件通知，那么property fd会变成可读，init进程采用epoll机制监听该fd则会
触发回调handle_property_set_fd()方法。回收僵尸进程，在Linux内核中，如父进程不等待子进程的结束直接退出，会导致子进程在结束后变成僵尸进程，占用系统资源。为此，init进程专门安装了SIGCHLD信号接收器，当某些子进程退出时发现其父进程已经退出，则会向init进程发送SIGCHLD信号，init进程调用回调方法handle_signal()来回收僵尸子进程。
