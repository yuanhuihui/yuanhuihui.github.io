---
layout: post
title:  "调试系列4：Debuggerd原理篇(上)"
date:   2016-6-15 20:25:33
catalog:    true
tags:
    - android
    - debug

---

## 一、概述

Android系统有监控程序异常退出的机制，这便是本文要讲述得debuggerd守护进程。当发生native crash或者主动调用debuggerd时，会输出进程相关的状态信息到文件或者控制台。输出的debuggerd数据
保存在文件`/data/tombstones/tombstone_XX`，该类型文件个数上限位10个，当超过时则每次覆盖时间最老的文件。针对进程出现的不同的状态，Linux kernel会发送相应的signal给异常进程，捕获signal并对其做相应的处理（通常动作是退出异常进程）。而Android在这机制的前提下，通过拦截这些信号来dump进程信息，方便开发人员调试分析。

debuggerd守护进程会打开socket服务端，当需要调用debuggerd服务时，先通过客户端进程向debuggerd服务端建立socket连接，然后发送不同的请求给debuggerd服务端，当服务端收到不同的请求，则会采取相应的dump操作。接下来从源码角度来探索debuggerd客户端和服务端的工作原理。

## 二、debuggerd客户端

    debuggerd -b <tid>
    debuggerd <tid>

通过adb执行上面的命令都能触发debuggerd进行相应的dump操作，其中参数-b`表示在控制台中输出backtrace，参数tid表示的是需要dump的进程或者线程id。这两个命令的输出结果相差较大，下面来一步步分析看看这两个命令分别能触发哪些操作，执行上述任一命令都会调用debuggerd的main方法()。

### 2.1 main

[-> /debuggerd/debuggerd.cpp]

    int main(int argc, char** argv) {
      ...
      bool dump_backtrace = false;
      bool have_tid = false;
      pid_t tid = 0;
      //参数解析backtrace与tid信息
      for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "-b")) {
          dump_backtrace = true;
        } else if (!have_tid) {
          tid = atoi(argv[i]);
          have_tid = true;
        } else {
          usage();
          return 1;
        }
      }
      //没有指定tid则直接返回
      if (!have_tid) {
        usage();
        return 1;
      }
      //【见小节2.2】
      return do_explicit_dump(tid, dump_backtrace);
    }

对于debuggerd命令，必须指定线程tid，否则不做任何操作，直接返回。

### 2.2 do_explicit_dump

[-> /debuggerd/debuggerd.cpp]

    static int do_explicit_dump(pid_t tid, bool dump_backtrace) {
      fprintf(stdout, "Sending request to dump task %d.\n", tid);

      if (dump_backtrace) {
        fflush(stdout);
        //输出到控制台【见小节2.3】
        if (dump_backtrace_to_file(tid, fileno(stdout)) < 0) {
          fputs("Error dumping backtrace.\n", stderr);
          return 1;
        }
      } else {
        char tombstone_path[PATH_MAX];
        //输出到tombstone文件【见小节2.4】
        if (dump_tombstone(tid, tombstone_path, sizeof(tombstone_path)) < 0) {
          fputs("Error dumping tombstone.\n", stderr);
          return 1;
        }
        fprintf(stderr, "Tombstone written to: %s\n", tombstone_path);
      }
      return 0;
    }

dump_backtrace等于true代表的是输出backtrace到控制台，否则意味着输出到tombstone文件。

### 2.3 dump_backtrace_to_file

[-> libcutils/debugger.c]

    int dump_backtrace_to_file(pid_t tid, int fd) {
        return dump_backtrace_to_file_timeout(tid, fd, 0);
    }

    int dump_backtrace_to_file_timeout(pid_t tid, int fd, int timeout_secs) {
      //向socket服务端发送dump backtrace的请求【见小节2.5】
      int sock_fd = make_dump_request(DEBUGGER_ACTION_DUMP_BACKTRACE, tid, timeout_secs);
      if (sock_fd < 0) {
        return -1;
      }

      int result = 0;
      char buffer[1024];
      ssize_t n;
      //阻塞等待，从sock_fd中读取到服务端发送过来的数据，并写入buffer
      while ((n = TEMP_FAILURE_RETRY(read(sock_fd, buffer, sizeof(buffer)))) > 0) {
        //再将buffer数据输出到fd，此处是stdout文件描述符(屏幕终端)。
        if (TEMP_FAILURE_RETRY(write(fd, buffer, n)) != n) {
          result = -1;
          break;
        }
      }
      close(sock_fd);
      return result;
    }

该方法的功能：

- 首先，向debuggerd的socket服务端发出DEBUGGER_ACTION_DUMP_BACKTRACE请求，然后阻塞等待；
- 循环遍历读取debuggerd服务端发送过来的数据，并写入到buffer;
- 再将buffer数据输出到fd，此处是stdout文件描述符(屏幕终端)。

### 2.4 dump_tombstone

[-> libcutils/debugger.c]

    int dump_tombstone(pid_t tid, char* pathbuf, size_t pathlen) {
      return dump_tombstone_timeout(tid, pathbuf, pathlen, 0);
    }

    int dump_tombstone_timeout(pid_t tid, char* pathbuf, size_t pathlen, int timeout_secs) {
      //向socket服务端发送dump tombstone的请求【见小节2.5】
      int sock_fd = make_dump_request(DEBUGGER_ACTION_DUMP_TOMBSTONE, tid, timeout_secs);
      if (sock_fd < 0) {
        return -1;
      }

      char buffer[100];
      int result = 0; ，
      //从sock_fd中读取到服务端发送过来的tombstone文件名，并写入buffer
      ssize_t n = TEMP_FAILURE_RETRY(read(sock_fd, buffer, sizeof(buffer) - 1));
      if (n <= 0) {
        result = -1;
      } else {
        if (pathbuf && pathlen) {
          if (n >= (ssize_t) pathlen) {
            n = pathlen - 1;
          }
          buffer[n] = '\0';
          //将buffer数据拷贝到pathbuf
          memcpy(pathbuf, buffer, n + 1);
        }
      }
      close(sock_fd);
      return result;
    }

该方法的功能：

- 首先，向debuggerd的socket服务端发出DEBUGGER_ACTION_DUMP_TOMBSTONE请求，然后阻塞等待；
- 循环遍历读取debuggerd服务端发送过来的tombstone文件名，并写入到buffer;
- 将buffer数据拷贝到pathbuf，即拷贝tombstone文件名。

### 2.5 make_dump_request

[-> libcutils/debugger.c]

    static int make_dump_request(debugger_action_t action, pid_t tid, int timeout_secs) {
      debugger_msg_t msg;
      memset(&msg, 0, sizeof(msg));
      msg.tid = tid;
      msg.action = action;
      //与debuggerd服务端建立socket通信，获取client端描述符sock_fd
      int sock_fd = socket_local_client(DEBUGGER_SOCKET_NAME, ANDROID_SOCKET_NAMESPACE_ABSTRACT,
          SOCK_STREAM | SOCK_CLOEXEC);
      ...
      //通过write()方法将msg信息写入文件描述符sock_fd【见小节2.5】
      if (send_request(sock_fd, &msg, sizeof(msg)) < 0) {
        close(sock_fd);
        return -1;
      }
      return sock_fd;
    }

该函数的功能是与debuggerd服务端建立socket通信，并发送action请求，以执行相应操作。

### 2.6 send_request

    static int send_request(int sock_fd, void* msg_ptr, size_t msg_len) {
      int result = 0;
      //写入消息
      if (TEMP_FAILURE_RETRY(write(sock_fd, msg_ptr, msg_len)) != (ssize_t) msg_len) {
        result = -1;
      } else {
        char ack;
        //等待应答消息
        if (TEMP_FAILURE_RETRY(read(sock_fd, &ack, 1)) != 1) {
          result = -1;
        }
      }
      return result;
    }


### 2.7 小节

通过调用`debuggerd <tid>`命令调用流程图：

![debuggerd_client](/images/debug/debuggerd_client.jpg)

执行debuggerd命令最终都是调用send_request()方法，向debuggerd服务端发出`DEBUGGER_ACTION_DUMP_TOMBSTONE`或者`DEBUGGER_ACTION_DUMP_BACKTRACE`请求，那对于debuggerd服务端收到相应命令做了哪些操作呢，要想明白这个过程，接下来看看debuggerd服务端的工作。


## 三、debuggerd服务端

在执行debuggerd命令之前，debuggerd服务端早早就以准备就绪，时刻等待着client请求的到来。

### 3.1 debuggerd.rc

由init进程fork子进程来以daemon方式启动，定义在debuggerd.rc文件（旧版本位于init.rc）

    service debuggerd /system/bin/debuggerd
        group root readproc
        writepid /dev/cpuset/system-background/tasks

init进程会解析上述rc文件，调用/system/bin/debuggerd文件，进入main方法，此时不带有任何参数。
接下来进入main()方法。

### 3.2 main

[-> /debuggerd/debuggerd.cpp]

    int main(int argc, char** argv) {
      union selinux_callback cb;
      //当参数个数为1则启动服务
      if (argc == 1) {
        cb.func_audit = audit_callback;
        selinux_set_callback(SELINUX_CB_AUDIT, cb);
        cb.func_log = selinux_log_callback;
        selinux_set_callback(SELINUX_CB_LOG, cb);
        //【见小节3.3】
        return do_server();
      }
      ...
    }

### 3.3 do_server

[-> /debuggerd/debuggerd.cpp]

    static int do_server() {
      //忽略debuggerd进程自身crash的处理过程。重置所有crash handlers
      signal(SIGABRT, SIG_DFL);
      signal(SIGBUS, SIG_DFL);
      signal(SIGFPE, SIG_DFL);
      signal(SIGILL, SIG_DFL);
      signal(SIGSEGV, SIG_DFL);
    #ifdef SIGSTKFLT
      signal(SIGSTKFLT, SIG_DFL);
    #endif
      signal(SIGTRAP, SIG_DFL);

      //忽略向已关闭socket执行写操作失败的信号
      signal(SIGPIPE, SIG_IGN);
      //阻塞SIGCHLD
      sigset_t sigchld;
      sigemptyset(&sigchld);
      sigaddset(&sigchld, SIGCHLD);
      sigprocmask(SIG_SETMASK, &sigchld, nullptr);
      //建立socket通信中的服务端
      int s = socket_local_server(SOCKET_NAME, ANDROID_SOCKET_NAMESPACE_ABSTRACT,
                                  SOCK_STREAM | SOCK_CLOEXEC);
      if (s == -1) return 1;

      // Fork子进程来发送信号(同样具有root权限)，并监听pipe来暂停和恢复目标进程
      if (!start_signal_sender()) {
        ALOGE("debuggerd: failed to fork signal sender");
        return 1;
      }
      ALOGI("debuggerd: starting\n");

      for (;;) {
        sockaddr_storage ss;
        sockaddr* addrp = reinterpret_cast<sockaddr*>(&ss);
        socklen_t alen = sizeof(ss);
        //等待客户端连接
        ALOGV("waiting for connection\n");
        int fd = accept4(s, addrp, &alen, SOCK_CLOEXEC);
        if (fd == -1) {
          ALOGE("accept failed: %s\n", strerror(errno));
          continue;
        }
        //处理新连接的客户端请求【见小节3.4】
        handle_request(fd);
      }
      return 0;
    }

主要功能：

- 忽略debuggerd进程自身crash的处理过程；
- 重置所有crash handlers；
- 建立socket通信中的服务端；
- 循环等待客户端的连接，并调用handle_request处理客户端请求。

### 3.4 handle_request

[-> /debuggerd/debuggerd.cpp]

    static void handle_request(int fd) {
      ALOGV("handle_request(%d)\n", fd);
      android::base::unique_fd closer(fd);
      debugger_request_t request;
      memset(&request, 0, sizeof(request));
      //读取client发送过来的请求【见小节3.5】
      int status = read_request(fd, &request);
      if (status != 0) {
        return;
      }

    #if defined(__LP64__)
      //对于32位的进程，重定向到32位debuggerd
      if (is32bit(request.tid)) {
        //仅仅dump backtrace和tombstone请求能重定向
        if (request.action == DEBUGGER_ACTION_DUMP_BACKTRACE ||
            request.action == DEBUGGER_ACTION_DUMP_TOMBSTONE) {
          redirect_to_32(fd, &request);
        }
        return;
      }
    #endif

      //fork子进程来处理其余请求命令
      pid_t fork_pid = fork();
      if (fork_pid == -1) {
        ALOGE("debuggerd: failed to fork: %s\n", strerror(errno));
      } else if (fork_pid == 0) {
         //子进程执行【见小节3.6】
        worker_process(fd, request);
      } else {
        //父进程执行【见小节3.7】
        monitor_worker_process(fork_pid, request);
      }
    }

### 3.5 read_request

[-> /debuggerd/debuggerd.cpp]

    static int read_request(int fd, debugger_request_t* out_request) {
      ucred cr;
      socklen_t len = sizeof(cr);
      //从fd获取client进程的pid,uid,gid
      int status = getsockopt(fd, SOL_SOCKET, SO_PEERCRED, &cr, &len);
      ...
      fcntl(fd, F_SETFL, O_NONBLOCK);

      pollfd pollfds[1];
      pollfds[0].fd = fd;
      pollfds[0].events = POLLIN;
      pollfds[0].revents = 0;
      //读取tid
      status = TEMP_FAILURE_RETRY(poll(pollfds, 1, 3000));
      debugger_msg_t msg;
      memset(&msg, 0, sizeof(msg));
      //从fd读取数据并保存到结构体msg
      status = TEMP_FAILURE_RETRY(read(fd, &msg, sizeof(msg)));
      ...

      out_request->action = static_cast<debugger_action_t>(msg.action);
      out_request->tid = msg.tid;
      out_request->pid = cr.pid;
      out_request->uid = cr.uid;
      out_request->gid = cr.gid;
      out_request->abort_msg_address = msg.abort_msg_address;
      out_request->original_si_code = msg.original_si_code;

      if (msg.action == DEBUGGER_ACTION_CRASH) {
        // C/C++进程crash时发送过来的请求
        char buf[64];
        struct stat s;
        snprintf(buf, sizeof buf, "/proc/%d/task/%d", out_request->pid, out_request->tid);
        if (stat(buf, &s)) {
          return -1;  //tid不存在，忽略该显式dump请求
        }
      } else if (cr.uid == 0
                || (cr.uid == AID_SYSTEM && msg.action == DEBUGGER_ACTION_DUMP_BACKTRACE)) {
        //root权限既可以可收集backtraces，又可以dump tombstones；
        //system权限只允许收集backtraces;
        status = get_process_info(out_request->tid, &out_request->pid,
                                  &out_request->uid, &out_request->gid);
        if (status < 0) {
          return -1; //tid不存在，忽略该显式dump请求
        }

        if (!selinux_action_allowed(fd, out_request))
          return -1; //selinux权限不足，忽略该请求

      } else {
        //其他情况，则直接忽略
        return -1;
      }
      return 0;
    }

该方法的功能是首先从socket获取client进程的pid,uid,gid用于权限控制，能处理以下三种情况：

- C/C++进程crash时发送过来的请求；
- root权限既可以可收集backtraces，又可以dump tombstones；
- system权限只允许收集backtraces。

针对这些情况若相应的tid不存在或selinux权限不满足，则都忽略该显式dump请求。read_request执行完成后，则从socket通道中读取到request信息。

### 3.6 worker_process

处于client发送过来的请求，server端通过子进程来处理

[-> /debuggerd/debuggerd.cpp]

    static void worker_process(int fd, debugger_request_t& request) {
      std::string tombstone_path;
      int tombstone_fd = -1;
      switch (request.action) {
        case DEBUGGER_ACTION_DUMP_TOMBSTONE: //case1:输出tombstone文件
        case DEBUGGER_ACTION_CRASH: //case2:出现native crash
          //打开tombstone文件【见小节3.6.1】
          tombstone_fd = open_tombstone(&tombstone_path);
          if (tombstone_fd == -1) {
            exit(1); //无法打开tombstone文件，则退出该进程
          }
          break;

        case DEBUGGER_ACTION_DUMP_BACKTRACE: //case3:输出backtrace
          break;

        default:
          exit(1); //其他case则直接结束进程
      }

      // Attach到目标进程
      if (ptrace(PTRACE_ATTACH, request.tid, 0, 0) != 0) {
        exit(1); //attach失败则退出该进程
      }

      bool attach_gdb = should_attach_gdb(request);
      if (attach_gdb) {
        // 在特权模式降级之前，打开所有需要监听的input设备
        if (init_getevent() != 0) {
          attach_gdb = false; //初始化input设备失败，不再等待gdb
        }
      }
      ...

      //生成backtrace【见小节3.6.2】
      std::unique_ptr<BacktraceMap> backtrace_map(BacktraceMap::Create(request.pid));

      int amfd = -1;
      std::unique_ptr<std::string> amfd_data;
      if (request.action == DEBUGGER_ACTION_CRASH) {
        //当发生native crash，则连接到AMS【见小节3.6.3】
        amfd = activity_manager_connect();
        amfd_data.reset(new std::string);
      }

      bool succeeded = false;

      //取消特权模式
      if (!drop_privileges()) {
        _exit(1); //操作失败，则退出
      }

      int crash_signal = SIGKILL;
      //执行dump操作，【见小节3.6.4】
      succeeded = perform_dump(request, fd, tombstone_fd, backtrace_map.get(), siblings,
                               &crash_signal, amfd_data.get());
      if (succeeded) {
        if (request.action == DEBUGGER_ACTION_DUMP_TOMBSTONE) {
          if (!tombstone_path.empty()) {
            android::base::WriteFully(fd, tombstone_path.c_str(), tombstone_path.length());
          }
        }
      }

      if (attach_gdb) {
        //向目标进程发送SIGSTOP信号
        if (!send_signal(request.pid, 0, SIGSTOP)) {
          attach_gdb = false; //无法停止通过gdb attach的进程
        }
      }

      if (!attach_gdb) {
        //将进程crash情况告知AMS【见小节3.6.5】
        activity_manager_write(request.pid, crash_signal, amfd, *amfd_data.get());
      }
      //detach目标进程
      ptrace(PTRACE_DETACH, request.tid, 0, 0);

      for (pid_t sibling : siblings) {
        ptrace(PTRACE_DETACH, sibling, 0, 0);
      }

      if (!attach_gdb && request.action == DEBUGGER_ACTION_CRASH) {
        //发送信号SIGKILL给目标进程
        if (!send_signal(request.pid, request.tid, crash_signal)) {
          ALOGE("debuggerd: failed to kill process %d: %s", request.pid, strerror(errno));
        }
      }

      //如果需要则等待gdb
      if (attach_gdb) {
        wait_for_user_action(request);
        //将进程crash情况告知AMS
        activity_manager_write(request.pid, crash_signal, amfd, *amfd_data.get());

        //发送信号SIGCONT给目标进程
        if (!send_signal(request.pid, 0, SIGCONT)) {
          ALOGE("debuggerd: failed to resume process %d: %s", request.pid, strerror(errno));
        }

        uninit_getevent();
      }

      close(amfd);
      exit(!succeeded);
    }

这个流程比较长，这里介绍attach_gdb=false的执行流程

#### 3.6.1 open_tombstone

[-> tombstone.cpp]

    int open_tombstone(std::string* out_path) {
      char path[128];
      int fd = -1;
      int oldest = -1;
      struct stat oldest_sb;
      //遍历查找
      for (int i = 0; i < MAX_TOMBSTONES; i++) {
        snprintf(path, sizeof(path), TOMBSTONE_TEMPLATE, i);
        struct stat sb;
        if (stat(path, &sb) == 0) {
          //记录修改时间最老的tombstone文件
          if (oldest < 0 || sb.st_mtime < oldest_sb.st_mtime) {
            oldest = i;
            oldest_sb.st_mtime = sb.st_mtime;
          }
          continue;
        }
        //存在没有使用的tombstone文件，则打开并赋给out_path，然后直接返回
        fd = open(path, O_CREAT | O_EXCL | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600);

        if (out_path) {
          *out_path = path;
        }
        fchown(fd, AID_SYSTEM, AID_SYSTEM);
        return fd;
      }

       //找不到最老的可用tombstone文件，则默认使用tombstone 0
      if (oldest < 0) {
        oldest = 0;
      }

      snprintf(path, sizeof(path), TOMBSTONE_TEMPLATE, oldest);
      //打开最老的tombstone文件
      fd = open(path, O_CREAT | O_TRUNC | O_WRONLY | O_NOFOLLOW | O_CLOEXEC, 0600);
      ...

      if (out_path) {
        *out_path = path;
      }
      fchown(fd, AID_SYSTEM, AID_SYSTEM);
      return fd;
    }

其中TOMBSTONE_TEMPLATE为`data/tombstones/tombstone_%02d`，文件个数上限`MAX_TOMBSTONES`=10

打开tombstone文件规则：

1. 当已使用的tombstone文件个数小于10时，则创建新的tombstone文件；否则执行2；
2. 获取修改时间最老的tombstone文件，并覆写该文件；
3. 如果最老文件不存在，则默认使用文件`data/tombstones/tombstone_00`

#### 3.6.2 BacktraceMap::Create

[-> UnwindMap.cpp]

    BacktraceMap* BacktraceMap::Create(pid_t pid, bool uncached) {
      BacktraceMap* map;

       //uncached默认值为false
      if (uncached) {
        map = new BacktraceMap(pid);
      } else if (pid == getpid()) {
        //本地进程
        map = new UnwindMapLocal();
      } else {
        //远程进程
        map = new UnwindMapRemote(pid);
      }

      //获取BacktraceMap
      if (!map->Build()) {
        delete map;
        return nullptr;
      }
      return map;
    }

#### 3.6.3 activity_manager_connect

[-> debuggerd.cpp]

    static int activity_manager_connect() {
      android::base::unique_fd amfd(socket(PF_UNIX, SOCK_STREAM, 0));
      if (amfd.get() < -1) {
        return -1; ///无法连接到ActivityManager(socket失败)
      }

      struct sockaddr_un address;
      memset(&address, 0, sizeof(address));
      address.sun_family = AF_UNIX;
      //该路径必须匹配NativeCrashListener.java中的定义
      strncpy(address.sun_path, "/data/system/ndebugsocket", sizeof(address.sun_path));
      if (TEMP_FAILURE_RETRY(connect(amfd.get(), reinterpret_cast<struct sockaddr*>(&address),
                                     sizeof(address))) == -1) {
        return -1;  //无法连接到ActivityManager(connect失败)
      }

      struct timeval tv;
      memset(&tv, 0, sizeof(tv));
      tv.tv_sec = 1;
      if (setsockopt(amfd.get(), SOL_SOCKET, SO_SNDTIMEO, &tv, sizeof(tv)) == -1) {
        ALOGE("debuggerd: Unable to connect to activity manager (setsockopt SO_SNDTIMEO failed: %s)",
              strerror(errno));
        return -1; //无法连接到ActivityManager(setsockopt SO_SNDTIMEO失败)
      }

      tv.tv_sec = 3;
      if (setsockopt(amfd.get(), SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) == -1) {
        ALOGE("debuggerd: Unable to connect to activity manager (setsockopt SO_RCVTIMEO failed: %s)",
              strerror(errno));
        return -1; //无法连接到ActivityManager(setsockopt SO_RCVTIMEO失败)
      }

      return amfd.release();
    }

该方法的功能是建立与ActivityManager的socket连接。


#### 3.6.4 perform_dump
根据接收到不同的signal采取相应的操作

[-> debuggerd.cpp]

    static bool perform_dump(const debugger_request_t& request, int fd, int tombstone_fd,
                             BacktraceMap* backtrace_map, const std::set<pid_t>& siblings,
                             int* crash_signal, std::string* amfd_data) {
      if (TEMP_FAILURE_RETRY(write(fd, "\0", 1)) != 1) {
        ALOGE("debuggerd: failed to respond to client: %s\n", strerror(errno));
        return false; //无法响应client端请求
      }

      int total_sleep_time_usec = 0;
      while (true) {
        //等待信号到来
        int signal = wait_for_signal(request.tid, &total_sleep_time_usec);
        switch (signal) {
          case -1:
            ALOGE("debuggerd: timed out waiting for signal");
            return false; //等待超时

          case SIGSTOP:
            if (request.action == DEBUGGER_ACTION_DUMP_TOMBSTONE) {
              ALOGV("debuggerd: stopped -- dumping to tombstone");
              //【见小节4.1】
              engrave_tombstone(tombstone_fd, backtrace_map, request.pid, request.tid, siblings, signal,
                                request.original_si_code, request.abort_msg_address, amfd_data);
            } else if (request.action == DEBUGGER_ACTION_DUMP_BACKTRACE) {
              ALOGV("debuggerd: stopped -- dumping to fd");
              //【见小节4.4】
              dump_backtrace(fd, backtrace_map, request.pid, request.tid, siblings, nullptr);
            } else {
              ALOGV("debuggerd: stopped -- continuing");
              if (ptrace(PTRACE_CONT, request.tid, 0, 0) != 0) {
                ALOGE("debuggerd: ptrace continue failed: %s", strerror(errno));
                return false;
              }
              continue;  //再次循环
            }
            break;

          case SIGABRT:
          case SIGBUS:
          case SIGFPE:
          case SIGILL:
          case SIGSEGV:
    #ifdef SIGSTKFLT
          case SIGSTKFLT:
    #endif
          case SIGTRAP:
            ALOGV("stopped -- fatal signal\n");
            *crash_signal = signal;
            //【见小节4.1】
            engrave_tombstone(tombstone_fd, backtrace_map, request.pid, request.tid, siblings, signal,
                              request.original_si_code, request.abort_msg_address, amfd_data);
            break;

          default:
            ALOGE("debuggerd: process stopped due to unexpected signal %d\n", signal);
            break;
        }
        break;
      }

      return true;
    }

致命信号有SIGABRT，SIGBUS，SIGFPE，SIGILL，SIGSEGV，SIGSTKFLT，SIGTRAP共7个信息，能造成native crash。

#### 3.6.5 activity_manager_write

[-> debuggerd.cpp]

    static void activity_manager_write(int pid, int signal, int amfd, const std::string& amfd_data) {
      if (amfd == -1) {
        return;
      }

      //写入32-bit pid和signal，以及原始dump信息，最后添加0以标记结束
      uint32_t datum = htonl(pid);
      if (!android::base::WriteFully(amfd, &datum, 4)) {
        return; //AM pid写入失败
      }
      datum = htonl(signal);
      if (!android::base::WriteFully(amfd, &datum, 4)) {
        return;//AM signal写入失败
      }

      if (!android::base::WriteFully(amfd, amfd_data.c_str(), amfd_data.size())) {
        return;//AM data写入失败
      }

      uint8_t eodMarker = 0;
      if (!android::base::WriteFully(amfd, &eodMarker, 1)) {
        return; //AM eod 写入失败
      }
      //读取应答消息，如果3s超时未收到则读取失败
      android::base::ReadFully(amfd, &eodMarker, 1);
    }

### 3.7 monitor_worker_process

父进程处理

[-> debuggerd.cpp]

    static void monitor_worker_process(int child_pid, const debugger_request_t& request) {
      struct timespec timeout = {.tv_sec = 10, .tv_nsec = 0 };
      if (should_attach_gdb(request)) {
        timeout.tv_sec = INT_MAX;
      }

      sigset_t signal_set;
      sigemptyset(&signal_set);
      sigaddset(&signal_set, SIGCHLD);

      bool kill_worker = false;
      bool kill_target = false;
      bool kill_self = false;

      int status;
      siginfo_t siginfo;
      int signal = TEMP_FAILURE_RETRY(sigtimedwait(&signal_set, &siginfo, &timeout));
      if (signal == SIGCHLD) {
        pid_t rc = waitpid(-1, &status, WNOHANG | WUNTRACED);
        if (rc != child_pid) {
          ALOGE("debuggerd: waitpid returned unexpected pid (%d), committing murder-suicide", rc);

          if (WIFEXITED(status)) {
            ALOGW("debuggerd: pid %d exited with status %d", rc, WEXITSTATUS(status));
          } else if (WIFSIGNALED(status)) {
            ALOGW("debuggerd: pid %d received signal %d", rc, WTERMSIG(status));
          } else if (WIFSTOPPED(status)) {
            ALOGW("debuggerd: pid %d stopped by signal %d", rc, WSTOPSIG(status));
          } else if (WIFCONTINUED(status)) {
            ALOGW("debuggerd: pid %d continued", rc);
          }

          kill_worker = true;
          kill_target = true;
          kill_self = true;
        } else if (WIFSIGNALED(status)) {
          ALOGE("debuggerd: worker process %d terminated due to signal %d", child_pid, WTERMSIG(status));
          kill_worker = false;
          kill_target = true;
        } else if (WIFSTOPPED(status)) {
          ALOGE("debuggerd: worker process %d stopped due to signal %d", child_pid, WSTOPSIG(status));
          kill_worker = true;
          kill_target = true;
        }
      } else {
        ALOGE("debuggerd: worker process %d timed out", child_pid);
        kill_worker = true;
        kill_target = true;
      }

      if (kill_worker) {
        // Something bad happened, kill the worker.
        if (kill(child_pid, SIGKILL) != 0) {
          ALOGE("debuggerd: failed to kill worker process %d: %s", child_pid, strerror(errno));
        } else {
          waitpid(child_pid, &status, 0);
        }
      }

      int exit_signal = SIGCONT;
      if (kill_target && request.action == DEBUGGER_ACTION_CRASH) {
        ALOGE("debuggerd: killing target %d", request.pid);
        exit_signal = SIGKILL;
      } else {
        ALOGW("debuggerd: resuming target %d", request.pid);
      }

      if (kill(request.pid, exit_signal) != 0) {
        ALOGE("debuggerd: failed to send signal %d to target: %s", exit_signal, strerror(errno));
      }

      if (kill_self) {
        stop_signal_sender();
        _exit(1);
      }
    }


### 3.8 小节

调用流程：

    debuggerd.main
        do_server
            handle_request
                read_request
                    worker_process(子进程)
                    monitor_worker_process(父进程)


整个过程的核心方法为`worker_process()`，其流程如下：

1. 根据请worker_process()求中的不同action采取相应操作，除此之外则立即结束进程
    - DEBUGGER_ACTION_DUMP_TOMBSTONE，则调用open_tombstone并继续执行；
    - DEBUGGER_ACTION_CRASH ，则调用open_tombstone并继续执行；
    - DEBUGGER_ACTION_DUMP_BACKTRACE，则直接继续执行；
2. 调用ptrace方法attach到目标进程;
4. 调用BacktraceMap::Create来生成backtrace;
5. 当Action=`DEBUGGER_ACTION_CRASH`，则执行activity_manager_connect；
6. 调用drop_privileges来取消特权模式；
7. 通过perform_dump执行dump操作；
    - SIGSTOP && `DEBUGGER_ACTION_DUMP_TOMBSTONE`，则`engrave_tombstone`()
    - SIGSTOP && `DEBUGGER_ACTION_DUMP_BACKTRACE`，则`dump_backtrace`()
    - `SIGBUS等`致命信号，则`engrave_tombstone`()
8. 当Action=`DEBUGGER_ACTION_DUMP_TOMBSTONE`，则将向client端写入tombstone数据；
9. 调用activity_manager_write，将进程crash情况告知AMS；
10. 调用ptrace方法detach到目标进程;
11. 当Action=`DEBUGGER_ACTION_CRASH`，发送信号SIGKILL给目标进程tid
12. 调用exit来结束进程。

**可知：**

- `debuggerd -b <tid>`指令，发送请求的action为DEBUGGER_ACTION_DUMP_BACKTRACE，则调用dump_backtrace();
- `debuggerd <tid>`指令，发送请求的action为DEBUGGER_ACTION_DUMP_TOMBSTONE，则调用engrave_tombstone();
- `native crash`，发送请求的action为DEBUGGER_ACTION_CRASH，且发送信号为SIGBUS等致命信号，则调用engrave_tombstone()。

再接下来，需要重点看看`engrave_tombstone`和`dump_backtrace`这两个方法。

## 四、tombstone

### 4.1 engrave_tombstone

[-> debuggerd/tombstone.cpp]

    void engrave_tombstone(int tombstone_fd, BacktraceMap* map, pid_t pid, pid_t tid,
                           const std::set<pid_t>& siblings, int signal, int original_si_code,
                           uintptr_t abort_msg_address, std::string* amfd_data) {
      log_t log;
      log.current_tid = tid;
      log.crashed_tid = tid;

      if (tombstone_fd < 0) {
        ALOGE("debuggerd: skipping tombstone write, nothing to do.\n");
        return;
      }

      log.tfd = tombstone_fd;
      log.amfd_data = amfd_data;
      //【见小节4.2】
      dump_crash(&log, map, pid, tid, siblings, signal, original_si_code, abort_msg_address);
    }

### 4.2 dump_crash

[-> debuggerd/tombstone.cpp]

    // Dump该pid所对应进程的所有tombstone信息
    static void dump_crash(log_t* log, BacktraceMap* map, pid_t pid, pid_t tid,
                           const std::set<pid_t>& siblings, int signal, int si_code,
                           uintptr_t abort_msg_address) {
      char value[PROPERTY_VALUE_MAX];
      //当ro.debuggable =1，则输出log信息
      property_get("ro.debuggable", value, "0");
      bool want_logs = (value[0] == '1');

      _LOG(log, logtype::HEADER,
           "*** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***\n");
      //tombstone头部信息【见小节4.3】
      dump_header_info(log);
      //tombstone线程信息【见小节4.4】
      dump_thread(log, pid, tid, map, signal, si_code, abort_msg_address, true);
      if (want_logs) {
        //输出log信息【见小节4.5】
        dump_logs(log, pid, 5);
      }

      if (!siblings.empty()) {
        for (pid_t sibling : siblings) {
          //tombstone兄弟线程信息【见小节4.4】
          dump_thread(log, pid, sibling, map, 0, 0, 0, false);
        }
      }

      if (want_logs) {
        dump_logs(log, pid, 0);
      }
    }

主要输出信息：

- dump_header_info
- 主线程dump_thread
- dump_logs (ro.debuggable=1 才输出此项)
- 兄弟线程dump_thread
- dump_logs (ro.debuggable=1 才输出此项)

### 4.3 dump_header_info

[-> debuggerd/tombstone.cpp]

    static void dump_header_info(log_t* log) {
      char fingerprint[PROPERTY_VALUE_MAX];
      char revision[PROPERTY_VALUE_MAX];

      property_get("ro.build.fingerprint", fingerprint, "unknown");
      property_get("ro.revision", revision, "unknown");

      _LOG(log, logtype::HEADER, "Build fingerprint: '%s'\n", fingerprint);
      _LOG(log, logtype::HEADER, "Revision: '%s'\n", revision);
      _LOG(log, logtype::HEADER, "ABI: '%s'\n", ABI_STRING);
    }

例如：

    Build fingerprint: 'xxx/xxx/MMB29M/gityuan06080845:userdebug/test-keys'
    Revision: '0'
    ABI: 'arm'

### 4.4 dump_thread(主)

调用方法dump_thread(log, pid, tid, map, signal, si_code, abort_msg_address, true);

[-> debuggerd/tombstone.cpp]

    static void dump_thread(log_t* log, pid_t pid, pid_t tid, BacktraceMap* map, int signal,
                            int si_code, uintptr_t abort_msg_address, bool primary_thread) {
      log->current_tid = tid;
      //【见小节4.4.1】
      dump_thread_info(log, pid, tid);

      if (signal) {
      //【见小节4.4.2】
        dump_signal_info(log, tid, signal, si_code);
      }
      //【见小节3.6.2】
      std::unique_ptr<Backtrace> backtrace(Backtrace::Create(pid, tid, map));
      if (primary_thread) {
        //【见小节4.4.3】
        dump_abort_message(backtrace.get(), log, abort_msg_address);
      }
      //【见小节4.4.4】
      dump_registers(log, tid);
      if (backtrace->Unwind(0)) {
        //【见小节4.4.5】
        dump_backtrace_and_stack(backtrace.get(), log);
      } else {
        ALOGE("Unwind failed: pid = %d, tid = %d", pid, tid);
      }

      if (primary_thread) {
        //【见小节4.4.6】
        dump_memory_and_code(log, backtrace.get());
        if (map) {
            //【见小节4.4.7】
          dump_all_maps(backtrace.get(), map, log, tid);
        }
      }
      log->current_tid = log->crashed_tid;
    }

#### 4.4.1 dump_thread_info

    static void dump_thread_info(log_t* log, pid_t pid, pid_t tid) {
      char path[64];
      char threadnamebuf[1024];
      char* threadname = nullptr;
      FILE *fp;
      //获取/proc/<tid>/comm节点的线程名
      snprintf(path, sizeof(path), "/proc/%d/comm", tid);
      if ((fp = fopen(path, "r"))) {
        threadname = fgets(threadnamebuf, sizeof(threadnamebuf), fp);
        fclose(fp);
        if (threadname) {
          size_t len = strlen(threadname);
          if (len && threadname[len - 1] == '\n') {
            threadname[len - 1] = '\0';
          }
        }
      }
      // Blacklist logd, logd.reader, logd.writer, logd.auditd, logd.control ...
      static const char logd[] = "logd";
      if (threadname != nullptr && !strncmp(threadname, logd, sizeof(logd) - 1)
          && (!threadname[sizeof(logd) - 1] || (threadname[sizeof(logd) - 1] == '.'))) {
        log->should_retrieve_logcat = false;
      }

      char procnamebuf[1024];
      char* procname = nullptr;

      //获取/proc/<pid>/cmdline节点的进程名
      snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
      if ((fp = fopen(path, "r"))) {
        procname = fgets(procnamebuf, sizeof(procnamebuf), fp);
        fclose(fp);
      }

      _LOG(log, logtype::HEADER, "pid: %d, tid: %d, name: %s  >>> %s <<<\n", pid, tid,
           threadname ? threadname : "UNKNOWN", procname ? procname : "UNKNOWN");
    }


- 获取线程名：/proc/<tid>/comm
- 获取进程名：/proc/<pid>/cmdline

例如：

    //代表主线程system_server
    pid: 1789, tid: 1789, name: system_server  >>> system_server <<<
    //代表子线程ActivityManager
    pid: 1789, tid: 1827, name: ActivityManager  >>> system_server <<<

#### 4.4.2 dump_signal_info

    static void dump_signal_info(log_t* log, pid_t tid, int signal, int si_code) {
      siginfo_t si;
      memset(&si, 0, sizeof(si));
      if (ptrace(PTRACE_GETSIGINFO, tid, 0, &si) == -1) {
        ALOGE("cannot get siginfo: %s\n", strerror(errno));
        return;
      }

      si.si_code = si_code;

      char addr_desc[32];
      if (signal_has_si_addr(signal)) {
        snprintf(addr_desc, sizeof(addr_desc), "%p", si.si_addr);
      } else {
        snprintf(addr_desc, sizeof(addr_desc), "--------");
      }

      _LOG(log, logtype::HEADER, "signal %d (%s), code %d (%s), fault addr %s\n",
           signal, get_signame(signal), si.si_code, get_sigcode(signal, si.si_code), addr_desc);
    }

对于SIGBUS，SIGFPE，SIGILL，SIGSEGV，SIGTRAP时触发的dump则会输出fault addr的具体地址，对于SIGSTOP则输出fault addr为"--------"

例如：

    signal 11 (SIGSEGV), code 1 (SEGV_MAPERR), fault addr 0xd140109c
    signal 19 (SIGSTOP), code 0 (SI_USER), fault addr --------

此处get_sigcode函数功能负责根据signal以及si_code来获取相应信息，比如SEGV_MAPERR下面来列举每种signal所包含的信息种类：

|signal|get_sigcode|
|---|---|
|SIGILL|ILL_ILLOPC|
|SIGILL|ILL_ILLOPN|
|SIGILL|ILL_ILLADR|
|SIGILL|ILL_ILLTRP|
|SIGILL|ILL_PRVOPC|
|SIGILL|ILL_PRVREG|
|SIGILL|ILL_COPROC|
|SIGILL|ILL_BADSTK|
|SIGBUS|BUS_ADRALN|
|SIGBUS|BUS_ADRERR|
|SIGBUS|BUS_OBJERR|
|SIGBUS|BUS_MCEERR_AR|
|SIGBUS|BUS_MCEERR_AO|
|SIGFPE|FPE_INTDIV|
|SIGFPE|FPE_INTOVF|
|SIGFPE|FPE_FLTDIV|
|SIGFPE|FPE_FLTOVF|
|SIGFPE|FPE_FLTUND|
|SIGFPE|FPE_FLTRES|
|SIGFPE|FPE_FLTINV|
|SIGFPE|FPE_FLTSUB|
|SIGSEGV|SEGV_MAPERR|
|SIGSEGV|SEGV_ACCERR|
|SIGSEGV|SEGV_BNDERR|
|SIGSEGV|SEGV_MAPERR|
|SIGTRAP|TRAP_BRKPT|
|SIGTRAP|TRAP_TRACE|
|SIGTRAP|TRAP_BRANCH|
|SIGTRAP|TRAP_HWBKPT|

#### 4.4.3 dump_abort_message

    static void dump_abort_message(Backtrace* backtrace, log_t* log, uintptr_t address) {
      if (address == 0) {
        return;
      }

      address += sizeof(size_t);  // Skip the buffer length.

      char msg[512];
      memset(msg, 0, sizeof(msg));
      char* p = &msg[0];
      while (p < &msg[sizeof(msg)]) {
        word_t data;
        size_t len = sizeof(word_t);
        if (!backtrace->ReadWord(address, &data)) {
          break;
        }
        address += sizeof(word_t);

        while (len > 0 && (*p++ = (data >> (sizeof(word_t) - len) * 8) & 0xff) != 0) {
          len--;
        }
      }
      msg[sizeof(msg) - 1] = '\0';

      _LOG(log, logtype::HEADER, "Abort message: '%s'\n", msg);
    }


#### 4.4.4 dump_registers
输出系统寄存器信息，这里以arm为例来说明

[-> debuggerd/arm/Machine.cpp]

    void dump_registers(log_t* log, pid_t tid) {
      pt_regs r;
      if (ptrace(PTRACE_GETREGS, tid, 0, &r)) {
        ALOGE("cannot get registers: %s\n", strerror(errno));
        return;
      }

      _LOG(log, logtype::REGISTERS, "    r0 %08x  r1 %08x  r2 %08x  r3 %08x\n",
           static_cast<uint32_t>(r.ARM_r0), static_cast<uint32_t>(r.ARM_r1),
           static_cast<uint32_t>(r.ARM_r2), static_cast<uint32_t>(r.ARM_r3));
      _LOG(log, logtype::REGISTERS, "    r4 %08x  r5 %08x  r6 %08x  r7 %08x\n",
           static_cast<uint32_t>(r.ARM_r4), static_cast<uint32_t>(r.ARM_r5),
           static_cast<uint32_t>(r.ARM_r6), static_cast<uint32_t>(r.ARM_r7));
      _LOG(log, logtype::REGISTERS, "    r8 %08x  r9 %08x  sl %08x  fp %08x\n",
           static_cast<uint32_t>(r.ARM_r8), static_cast<uint32_t>(r.ARM_r9),
           static_cast<uint32_t>(r.ARM_r10), static_cast<uint32_t>(r.ARM_fp));
      _LOG(log, logtype::REGISTERS, "    ip %08x  sp %08x  lr %08x  pc %08x  cpsr %08x\n",
           static_cast<uint32_t>(r.ARM_ip), static_cast<uint32_t>(r.ARM_sp),
           static_cast<uint32_t>(r.ARM_lr), static_cast<uint32_t>(r.ARM_pc),
           static_cast<uint32_t>(r.ARM_cpsr));

      user_vfp vfp_regs;
      if (ptrace(PTRACE_GETVFPREGS, tid, 0, &vfp_regs)) {
        ALOGE("cannot get FP registers: %s\n", strerror(errno));
        return;
      }

      for (size_t i = 0; i < 32; i += 2) {
        _LOG(log, logtype::FP_REGISTERS, "    d%-2d %016llx  d%-2d %016llx\n",
             i, vfp_regs.fpregs[i], i+1, vfp_regs.fpregs[i+1]);
      }
      _LOG(log, logtype::FP_REGISTERS, "    scr %08lx\n", vfp_regs.fpscr);
    }

通过ptrace获取寄存器状态信息，这里输出r0-r9,sl,fp,ip,sp,lr,pc,cpsr 以及32个fpregs和一个fpscr

#### 4.4.5 dump_backtrace_and_stack
[-> debuggerd/tombstone.cpp]

    static void dump_backtrace_and_stack(Backtrace* backtrace, log_t* log) {
      if (backtrace->NumFrames()) {
        _LOG(log, logtype::BACKTRACE, "\nbacktrace:\n");
        dump_backtrace_to_log(backtrace, log, "    ");

        _LOG(log, logtype::STACK, "\nstack:\n");
        dump_stack(backtrace, log);
      }
    }

**输出backtrace信息**

[-> debuggerd/Backtrace.cpp]

    void dump_backtrace_to_log(Backtrace* backtrace, log_t* log, const char* prefix) {
      for (size_t i = 0; i < backtrace->NumFrames(); i++) {
        _LOG(log, logtype::BACKTRACE, "%s%s\n", prefix, backtrace->FormatFrameData(i).c_str());
      }
    }

**输出stack信息**

[-> debuggerd/tombstone.cpp]

static void dump_stack(Backtrace* backtrace, log_t* log) {
  size_t first = 0, last;
  for (size_t i = 0; i < backtrace->NumFrames(); i++) {
    const backtrace_frame_data_t* frame = backtrace->GetFrame(i);
    if (frame->sp) {
      if (!first) {
        first = i+1;
      }
      last = i;
    }
  }
  if (!first) {
    return;
  }
  first--;

  // Dump a few words before the first frame.
  word_t sp = backtrace->GetFrame(first)->sp - STACK_WORDS * sizeof(word_t);
  dump_stack_segment(backtrace, log, &sp, STACK_WORDS, -1);

  // Dump a few words from all successive frames.
  // Only log the first 3 frames, put the rest in the tombstone.
  for (size_t i = first; i <= last; i++) {
    const backtrace_frame_data_t* frame = backtrace->GetFrame(i);
    if (sp != frame->sp) {
      _LOG(log, logtype::STACK, "         ........  ........\n");
      sp = frame->sp;
    }
    if (i == last) {
      dump_stack_segment(backtrace, log, &sp, STACK_WORDS, i);
      if (sp < frame->sp + frame->stack_size) {
        _LOG(log, logtype::STACK, "         ........  ........\n");
      }
    } else {
      size_t words = frame->stack_size / sizeof(word_t);
      if (words == 0) {
        words = 1;
      } else if (words > STACK_WORDS) {
        words = STACK_WORDS;
      }
      dump_stack_segment(backtrace, log, &sp, words, i);
    }
  }
}

#### 4.4.6 dump_memory_and_code
[-> debuggerd/arm/Machine.cpp]

    void dump_memory_and_code(log_t* log, Backtrace* backtrace) {
      pt_regs regs;
      if (ptrace(PTRACE_GETREGS, backtrace->Tid(), 0, &regs)) {
        ALOGE("cannot get registers: %s\n", strerror(errno));
        return;
      }

      static const char reg_names[] = "r0r1r2r3r4r5r6r7r8r9slfpipsp";

      for (int reg = 0; reg < 14; reg++) {
        dump_memory(log, backtrace, regs.uregs[reg], "memory near %.2s:", &reg_names[reg * 2]);
      }

      dump_memory(log, backtrace, static_cast<uintptr_t>(regs.ARM_pc), "code around pc:");

      if (regs.ARM_pc != regs.ARM_lr) {
        dump_memory(log, backtrace, static_cast<uintptr_t>(regs.ARM_lr), "code around lr:");
      }
    }

#### 4.4.7 dump_all_maps

[-> debuggerd/tombstone.cpp]

    static void dump_all_maps(Backtrace* backtrace, BacktraceMap* map, log_t* log, pid_t tid) {
      bool print_fault_address_marker = false;
      uintptr_t addr = 0;
      siginfo_t si;
      memset(&si, 0, sizeof(si));
      if (ptrace(PTRACE_GETSIGINFO, tid, 0, &si) != -1) {
        print_fault_address_marker = signal_has_si_addr(si.si_signo);
        addr = reinterpret_cast<uintptr_t>(si.si_addr);
      } else {
        ALOGE("Cannot get siginfo for %d: %s\n", tid, strerror(errno));
      }

      _LOG(log, logtype::MAPS, "\n");
      if (!print_fault_address_marker) {
        _LOG(log, logtype::MAPS, "memory map:\n");
      } else {
        _LOG(log, logtype::MAPS, "memory map: (fault address prefixed with --->)\n");
        if (map->begin() != map->end() && addr < map->begin()->start) {
          _LOG(log, logtype::MAPS, "--->Fault address falls at %s before any mapped regions\n",
               get_addr_string(addr).c_str());
          print_fault_address_marker = false;
        }
      }

      std::string line;
      for (BacktraceMap::const_iterator it = map->begin(); it != map->end(); ++it) {
        line = "    ";
        if (print_fault_address_marker) {
          if (addr < it->start) {
            _LOG(log, logtype::MAPS, "--->Fault address falls at %s between mapped regions\n",
                 get_addr_string(addr).c_str());
            print_fault_address_marker = false;
          } else if (addr >= it->start && addr < it->end) {
            line = "--->";
            print_fault_address_marker = false;
          }
        }
        line += get_addr_string(it->start) + '-' + get_addr_string(it->end - 1) + ' ';
        if (it->flags & PROT_READ) {
          line += 'r';
        } else {
          line += '-';
        }
        if (it->flags & PROT_WRITE) {
          line += 'w';
        } else {
          line += '-';
        }
        if (it->flags & PROT_EXEC) {
          line += 'x';
        } else {
          line += '-';
        }
        line += android::base::StringPrintf("  %8" PRIxPTR "  %8" PRIxPTR,
                                            it->offset, it->end - it->start);
        bool space_needed = true;
        if (it->name.length() > 0) {
          space_needed = false;
          line += "  " + it->name;
          std::string build_id;
          if ((it->flags & PROT_READ) && elf_get_build_id(backtrace, it->start, &build_id)) {
            line += " (BuildId: " + build_id + ")";
          }
        }
        if (it->load_base != 0) {
          if (space_needed) {
            line += ' ';
          }
          line += android::base::StringPrintf(" (load base 0x%" PRIxPTR ")", it->load_base);
        }
        _LOG(log, logtype::MAPS, "%s\n", line.c_str());
      }
      if (print_fault_address_marker) {
        _LOG(log, logtype::MAPS, "--->Fault address falls at %s after any mapped regions\n",
             get_addr_string(addr).c_str());
      }
    }

当内存出现故障时，可搜索关键词：

    memory map: (fault address prefixed with --->)

### 4.5 dump_logs
[-> debuggerd/tombstone.cpp]

    static void dump_logs(log_t* log, pid_t pid, unsigned int tail) {
      dump_log_file(log, pid, "system", tail);
      dump_log_file(log, pid, "main", tail);
    }

输出system和main log

### 4.6 dump_thread(兄弟)

dump_thread(log, pid, sibling, map, 0, 0, 0, false);

[-> debuggerd/tombstone.cpp]

    static void dump_thread(log_t* log, pid_t pid, pid_t tid, BacktraceMap* map, int signal,
                            int si_code, uintptr_t abort_msg_address, bool primary_thread) {
      log->current_tid = tid;

      if (!primary_thread) {
        _LOG(log, logtype::THREAD, "--- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---\n");
      }
      //【见小节4.4.1】
      dump_thread_info(log, pid, tid);

      std::unique_ptr<Backtrace> backtrace(Backtrace::Create(pid, tid, map));

      //【见小节4.4.4】
      dump_registers(log, tid);
      if (backtrace->Unwind(0)) {
        //【见小节4.4.5】
        dump_backtrace_and_stack(backtrace.get(), log);
      }

      log->current_tid = log->crashed_tid;
    }

### 4.7 小节

**engrave_tombstone**主要输出信息：

- dump_header_info
- 主线程dump_thread
- dump_logs (ro.debuggable=1 才输出此项)
- 兄弟线程dump_thread
- dump_logs (ro.debuggable=1 才输出此项)

**主线程dump_thread**

1. build相关头信息；
2. 线程相关信息，包含pid/tid以及相应name
3. signal相关信息，包含fault address
4. 寄存器状态
5. backtrace
6. stack
7. memory near
8. code around
9. memory map

**兄弟线程dump_thread**

1. 线程相关信息，包含pid/tid以及相应name
2. 寄存器状态
3. backtrace
4. stack

## 五、 backtrace

### 5.1 dump_backtrace

[-> debuggerd/backtrace.cpp]

    void dump_backtrace(int fd, BacktraceMap* map, pid_t pid, pid_t tid,
                        const std::set<pid_t>& siblings, std::string* amfd_data) {
      log_t log;
      log.tfd = fd;
      log.amfd_data = amfd_data;

      dump_process_header(&log, pid); //【见小节5.2】
      dump_thread(&log, map, pid, tid);//【见小节5.3】

      for (pid_t sibling : siblings) {
        dump_thread(&log, map, pid, sibling);//【见小节5.3】
      }

      dump_process_footer(&log, pid);//【见小节5.4】
    }

### 5.2 dump_process_header
[-> debuggerd/backtrace.cpp]

    static void dump_process_header(log_t* log, pid_t pid) {
      char path[PATH_MAX];
      char procnamebuf[1024];
      char* procname = NULL;
      FILE* fp;

      //获取/proc/<pid>/cmdline节点的进程名
      snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
      if ((fp = fopen(path, "r"))) {
        procname = fgets(procnamebuf, sizeof(procnamebuf), fp);
        fclose(fp);
      }

      time_t t = time(NULL);
      struct tm tm;
      localtime_r(&t, &tm);
      char timestr[64];
      strftime(timestr, sizeof(timestr), "%F %T", &tm);
      _LOG(log, logtype::BACKTRACE, "\n\n----- pid %d at %s -----\n", pid, timestr);

      if (procname) {
        _LOG(log, logtype::BACKTRACE, "Cmd line: %s\n", procname);
      }
      _LOG(log, logtype::BACKTRACE, "ABI: '%s'\n", ABI_STRING);
    }

例如：

    ----- pid 1789 at 2016-06-16 23:31:00 -----
    Cmd line: system_server
    ABI: 'arm'

### 5.3 dump_thread
[-> debuggerd/backtrace.cpp]

    static void dump_thread(log_t* log, BacktraceMap* map, pid_t pid, pid_t tid) {
      char path[PATH_MAX];
      char threadnamebuf[1024];
      char* threadname = NULL;
      FILE* fp;

      //获取/proc/<tid>/comm节点的线程名
      snprintf(path, sizeof(path), "/proc/%d/comm", tid);
      if ((fp = fopen(path, "r"))) {
        threadname = fgets(threadnamebuf, sizeof(threadnamebuf), fp);
        fclose(fp);
        if (threadname) {
          size_t len = strlen(threadname);
          if (len && threadname[len - 1] == '\n') {
              threadname[len - 1] = '\0';
          }
        }
      }

      _LOG(log, logtype::BACKTRACE, "\n\"%s\" sysTid=%d\n", threadname ? threadname : "<unknown>", tid);

      std::unique_ptr<Backtrace> backtrace(Backtrace::Create(pid, tid, map));
      if (backtrace->Unwind(0)) {
        dump_backtrace_to_log(backtrace.get(), log, "  ");
      }
    }

**输出backtrace信息**

[-> debuggerd/Backtrace.cpp]

    void dump_backtrace_to_log(Backtrace* backtrace, log_t* log, const char* prefix) {
      for (size_t i = 0; i < backtrace->NumFrames(); i++) {
        _LOG(log, logtype::BACKTRACE, "%s%s\n", prefix, backtrace->FormatFrameData(i).c_str());
      }
    }

例如：

    "Signal Catcher" sysTid=1794
    "ActivityManager" sysTid=1827
      #00 pc 00040984  /system/lib/libc.so (__epoll_pwait+20)
      #01 pc 00019f5b  /system/lib/libc.so (epoll_pwait+26)
      #02 pc 00019f69  /system/lib/libc.so (epoll_wait+6)
      #03 pc 00012c57  /system/lib/libutils.so (_ZN7android6Looper9pollInnerEi+102)
      #04 pc 00012ed3  /system/lib/libutils.so (_ZN7android6Looper8pollOnceEiPiS1_PPv+130)
      #05 pc 00082ccd  /system/lib/libandroid_runtime.so (_ZN7android18NativeMessageQueue8pollOnceEP7_JNIEnvP8_jobjecti+22)
      #06 pc 7385d55d  /data/dalvik-cache/arm/system@framework@boot.oat (offset 0x246d000)

### 5.4 dump_process_footer
[-> debuggerd/backtrace.cpp]

    static void dump_process_footer(log_t* log, pid_t pid) {
      _LOG(log, logtype::BACKTRACE, "\n----- end %d -----\n", pid);
    }

例如：----- end 1789 -----

### 5.5 小结

backtrace输出信息：

- dump_process_header
- 主线程backtrace
- 兄弟线程backtrace
- dump_process_footer

 可见dump_backtrace主要输出主线程与兄弟线程的backtrace，而dump_tombstone的信息量远比其丰富。

## 六、实例

这里是dump_tombstone文件内容的组成：

### 6.1 文件头信息

    *** *** *** *** *** *** *** *** *** *** *** *** *** *** *** ***
    //【见小节4.3】dump_header_info
    Build fingerprint: 'xxx/xxx/MMB29M/gityuan06080845:userdebug/test-keys'
    Revision: '0'
    ABI: 'arm'

### 6.2 主线程dump_thread


    //【见小节4.4.1】dump_thread_info
    pid: 1789, tid: 1789, name: system_server  >>> system_server <<<
    //【见小节4.4.2】dump_signal_info
    signal 19 (SIGSTOP), code 0 (SI_USER), fault addr --------
    //【见小节4.4.4】dump_registers
    r0 fffffffc  r1 bed67e68  r2 00000010  r3 0000ea60
    r4 00000000  r5 00000008  r6 00000000  r7 0000015a
    ...

    //【见小节4.4.5】dump_backtrace_and_stack
    backtrace:
        #00 pc 00000000004489bc  /data/dalvik-cache/arm64/system@framework@boot.oat (offset 0x3e2e000)
        #01 pc 00000000003e8a74  /data/dalvik-cache/arm64/system@framework@boot.oat (offset 0x3e2e000)

    stack:
             0000007ff47b26b0  0000000012cf05e0  /dev/ashmem/dalvik-main space (deleted)
             0000007ff47b26b8  0000000000000000
             0000007ff47b26c0  0000000012cf05e0  /dev/ashmem/dalvik-main space (deleted)
    //【见小节4.4.6】dump_memory_and_code
    memory near r1:
    ...
    code around pc:
    code around lr:

    //【见小节4.4.7】dump_all_maps
    memory map:
    //【见小节4.5】dump_logs

###  6.3 兄弟线程dump_thread

    --- --- --- --- --- --- --- --- --- --- --- --- --- --- --- ---
    //【见小节4.4.1】dump_thread_info
    pid: 1789, tid: 1803, name: Binder_1  >>> system_server <<<
    //【见小节4.4.4】dump_registers
        r0 0000000b  r1 c0186201  r2 b3589868  r3 b3589860
    //【见小节4.4.5】dump_backtrace_and_stack
    backtrace:
        #00 pc 00040aac  /system/lib/libc.so (__ioctl+8)
        #01 pc 00047529  /system/lib/libc.so (ioctl+14)
        #02 pc 0001e909  /system/lib/libbinder.so (_ZN7android14IPCThreadState14talkWithDriverEb+132)

    stack:
             b3589810  00000000
             b3589814  00000000
             b3589818  b6ebf07c  /system/lib/libcutils.so
             b358981c  b6eb4405  /system/lib/libcutils.so


## 相关源码

    /system/core/debuggerd/debuggerd.cpp
    /system/core/debuggerd/tombstone.cpp
    /system/core/debuggerd/backtrace.cpp
    /system/core/debuggerd/arm/Machine.cpp
    /system/core/debuggerd/arm64/Machine.cpp

    /system/core/libcutils/debugger.c
    /system/core/include/BacktraceMap.h
    /system/core/libbacktrace/UnwindMap.cpp

    /bionic/linker/arch/arm/begin.S
    /bionic/linker/linker.cpp
    /bionic/linker/debugger.cpp
