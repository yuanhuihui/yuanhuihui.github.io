---
layout: post
title:  "调试系列5：debuggerd(native crash篇)"
date:   2016-6-17 21:25:53
catalog:    true
tags:
    - android
    - debug
    - stability

---

## 一、Native Crash

Native crash的工作核心是由debuggerd守护进程来完成，上一篇文章[调试系列4：debuggerd源码篇)](http://gityuan.com/2016/06/15/android-debuggerd/)，已经介绍过Debuggerdd的工作原理。
要了解Native Crash，首先从应用程序入口位于`begin.S`中的`__linker_init`入手。

### 1.1 begin.S

[-> arch/arm/begin.S]

    ENTRY(_start)
      mov r0, sp
      //入口地址 【见小节1.2】
      bl __linker_init
      /* linker init returns the _entry address in the main image */
      mov pc, r0
    END(_start)

### 1.2  __linker_init

[-> linker.cpp]

    extern "C" ElfW(Addr) __linker_init(void* raw_args) {
      KernelArgumentBlock args(raw_args);
      ElfW(Addr) linker_addr = args.getauxval(AT_BASE);
      ...
      //【见小节1.3】
      ElfW(Addr) start_address = __linker_init_post_relocation(args, linker_addr);
      return start_address;
    }

### 1.3 __linker_init_post_relocation

[-> linker.cpp]

    static ElfW(Addr) __linker_init_post_relocation(KernelArgumentBlock& args, ElfW(Addr) linker_base) {
      ...
      // Sanitize the environment.
      __libc_init_AT_SECURE(args);
      // Initialize system properties
      __system_properties_init();
      //【见小节1.4】
      debuggerd_init();
      ...
    }

### 1.4 debuggerd_init

[-> linker/debugger.cpp]

    __LIBC_HIDDEN__ void debuggerd_init() {
      struct sigaction action;
      memset(&action, 0, sizeof(action));
      sigemptyset(&action.sa_mask);
      //【见小节1.5】
      action.sa_sigaction = debuggerd_signal_handler;
      //SA_RESTART代表中断某个syscall，则会自动重新调用该syscall
      //SA_SIGINFO代表信号附带参数siginfo_t结构体可传送到signal_handler函数
      action.sa_flags = SA_RESTART | SA_SIGINFO;
      //使用备用signal栈(如果可用)，以便我们能捕获栈溢出
      action.sa_flags |= SA_ONSTACK;
      sigaction(SIGABRT, &action, nullptr);
      sigaction(SIGBUS, &action, nullptr);
      sigaction(SIGFPE, &action, nullptr);
      sigaction(SIGILL, &action, nullptr);
      sigaction(SIGPIPE, &action, nullptr);
      sigaction(SIGSEGV, &action, nullptr);
    #if defined(SIGSTKFLT)
      sigaction(SIGSTKFLT, &action, nullptr);
    #endif
      sigaction(SIGTRAP, &action, nullptr);
    }

### 1.5 debuggerd_signal_handler

连接到bionic上的native程序(C/C++)出现异常时，kernel会发送相应的signal；
当进程捕获致命的signal，通知debuggerd调用ptrace来获取有价值的信息(发生crash之前)。

[-> linker/debugger.cpp]

    static void debuggerd_signal_handler(int signal_number, siginfo_t* info, void*) {
      if (!have_siginfo(signal_number)) {
        info = nullptr; //SA_SIGINFO标识被意外清空，则info未定义
      }
      //防止debuggerd无法链接时，仍可以输出一些简要signal信息
      log_signal_summary(signal_number, info);
      //建立于debuggerd的socket通信连接 【见小节1.6】
      send_debuggerd_packet(info);
      //重置信号处理函数为SIG_DFL(默认操作)
      signal(signal_number, SIG_DFL);

      switch (signal_number) {
        case SIGABRT:
        case SIGFPE:
        case SIGPIPE:
    #if defined(SIGSTKFLT)
        case SIGSTKFLT:
    #endif
        case SIGTRAP:
          tgkill(getpid(), gettid(), signal_number);
          break;
        default:    // SIGILL, SIGBUS, SIGSEGV
          break;
      }
    }

### 1.6 send_debuggerd_packet

[-> linker/debugger.cpp]

    static void send_debuggerd_packet(siginfo_t* info) {
      // Mutex防止多个crashing线程同一时间来来尝试跟debuggerd进行通信
      static pthread_mutex_t crash_mutex = PTHREAD_MUTEX_INITIALIZER;
      int ret = pthread_mutex_trylock(&crash_mutex);
      if (ret != 0) {
        if (ret == EBUSY) {
          __libc_format_log(ANDROID_LOG_INFO, "libc",
              "Another thread contacted debuggerd first; not contacting debuggerd.");
          //等待其他线程释放该锁，从而获取该锁
          pthread_mutex_lock(&crash_mutex);
        }
        return;
      }
      //建立与debuggerd的socket通道
      int s = socket_abstract_client(DEBUGGER_SOCKET_NAME, SOCK_STREAM | SOCK_CLOEXEC);
      ...
      debugger_msg_t msg;
      msg.action = DEBUGGER_ACTION_CRASH;
      msg.tid = gettid();
      msg.abort_msg_address = reinterpret_cast<uintptr_t>(g_abort_message);
      msg.original_si_code = (info != nullptr) ? info->si_code : 0;
      //将DEBUGGER_ACTION_CRASH消息发送给debuggerd服务端
      ret = TEMP_FAILURE_RETRY(write(s, &msg, sizeof(msg)));
      if (ret == sizeof(msg)) {
        char debuggerd_ack;
        //阻塞等待debuggerd服务端的回应数据
        ret = TEMP_FAILURE_RETRY(read(s, &debuggerd_ack, 1));
        int saved_errno = errno;
        notify_gdb_of_libraries();
        errno = saved_errno;
      }
      close(s);
    }

该方法的主要功能：

- 调用socket_abstract_client，建立于debuggerd的socket通道；
- 将`action = DEBUGGER_ACTION_CRASH`的消息发送给debuggerd服务端；
- 阻塞等待debuggerd服务端的回应数据。

接下来，看看debuggerd服务端接收到`DEBUGGER_ACTION_CRASH`的处理流程

## 二、debuggerd服务端

debuggerd 守护进程启动后，一直在等待socket client的连接。当native crash发送后便会向debuggerd发送`action = DEBUGGER_ACTION_CRASH`的消息。

### 2.1 do_server

[-> /debuggerd/debuggerd.cpp]

    static int do_server() {
      ...
      for (;;) {
        sockaddr_storage ss;
        sockaddr* addrp = reinterpret_cast<sockaddr*>(&ss);
        socklen_t alen = sizeof(ss);
        //等待客户端连接
        int fd = accept4(s, addrp, &alen, SOCK_CLOEXEC);
        if (fd == -1) {
          continue; //accept失败
        }
        //处理native crash发送过来的请求【见小节2.2】
        handle_request(fd);
      }
      return 0;
    }

### 2.2 handle_request

[-> /debuggerd/debuggerd.cpp]

    static void handle_request(int fd) {
      ...
      //读取client发送过来的请求【见小节3.5】
      int status = read_request(fd, &request);
      ...

      //fork子进程来处理其余请求命令
      pid_t fork_pid = fork();
      if (fork_pid == -1) {
        ALOGE("debuggerd: failed to fork: %s\n", strerror(errno));
      } else if (fork_pid == 0) {
         //子进程执行【见小节2.3】
        worker_process(fd, request);
      } else {
        //父进程执行【见小节2.4】
        monitor_worker_process(fork_pid, request);
      }
    }

### 2.3 worker_process

处于client发送过来的请求，server端通过子进程来处理

[-> /debuggerd/debuggerd.cpp]

    static void worker_process(int fd, debugger_request_t& request) {
      std::string tombstone_path;
      int tombstone_fd = -1;
      switch (request.action) {
        case DEBUGGER_ACTION_CRASH:
          //打开tombstone文件
          tombstone_fd = open_tombstone(&tombstone_path);
          if (tombstone_fd == -1) {
            exit(1); //无法打开tombstone文件，则退出该进程
          }
          break;
        ...
      }

      // Attach到目标进程
      if (ptrace(PTRACE_ATTACH, request.tid, 0, 0) != 0) {
        exit(1); //attach失败则退出该进程
      }
      ...
      //生成backtrace【见小节3.6.2】
      std::unique_ptr<BacktraceMap> backtrace_map(BacktraceMap::Create(request.pid));

      int amfd = -1;
      std::unique_ptr<std::string> amfd_data;
      if (request.action == DEBUGGER_ACTION_CRASH) {
        //当发生native crash，则连接到AMS【见小节2.3.1】
        amfd = activity_manager_connect();
        amfd_data.reset(new std::string);
      }

      bool succeeded = false;

      //取消特权模式
      if (!drop_privileges()) {
        _exit(1); //操作失败则退出
      }

      int crash_signal = SIGKILL;
      //执行dump操作，【见小节2.3.2】
      succeeded = perform_dump(request, fd, tombstone_fd, backtrace_map.get(), siblings,
                               &crash_signal, amfd_data.get());

      if (!attach_gdb) {
        //将进程crash情况告知AMS【见小节2.3.3】
        activity_manager_write(request.pid, crash_signal, amfd, *amfd_data.get());
      }
      //detach目标进程
      ptrace(PTRACE_DETACH, request.tid, 0, 0);

      for (pid_t sibling : siblings) {
        ptrace(PTRACE_DETACH, sibling, 0, 0);
      }

      if (!attach_gdb && request.action == DEBUGGER_ACTION_CRASH) {
        //发送信号SIGKILL给目标进程[【见小节2.3.4】
        if (!send_signal(request.pid, request.tid, crash_signal)) {
          ALOGE("debuggerd: failed to kill process %d: %s", request.pid, strerror(errno));
        }
      }
      ...
    }


整个过程比较复杂，下面只介绍attach_gdb=false的执行流程：

1. 当DEBUGGER_ACTION_CRASH ，则调用open_tombstone并继续执行；
2. 调用ptrace方法attach到目标进程;
3. 调用BacktraceMap::Create来生成backtrace;
4. 当DEBUGGER_ACTION_CRASH，则执行activity_manager_connect；
5. 调用drop_privileges来取消特权模式；
6. 通过perform_dump执行dump操作；
    - SIGBUS等致命信号，则调用`engrave_tombstone`()，这是核心方法
7. 调用activity_manager_write，将进程crash情况告知AMS；
8. 调用ptrace方法detach到目标进程;
9. 当DEBUGGER_ACTION_CRASH，发送信号SIGKILL给目标进程tid


#### 2.3.1 activity_manager_connect

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
        return -1; //无法连接到ActivityManager(setsockopt SO_SNDTIMEO失败)
      }

      tv.tv_sec = 3;
      if (setsockopt(amfd.get(), SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) == -1) {
        return -1; //无法连接到ActivityManager(setsockopt SO_RCVTIMEO失败)
      }

      return amfd.release();
    }

该方法的功能是建立跟上层`ActivityManager`的socket连接。对于"/data/system/ndebugsocket"的服务端是在，NativeCrashListener.java方法中创建并启动的。

#### 2.3.2 perform_dump
根据接收到不同的signal采取相应的操作

[-> debuggerd.cpp]

    static bool perform_dump(const debugger_request_t& request, int fd, int tombstone_fd,
                             BacktraceMap* backtrace_map, const std::set<pid_t>& siblings,
                             int* crash_signal, std::string* amfd_data) {
      if (TEMP_FAILURE_RETRY(write(fd, "\0", 1)) != 1) {
        return false; //无法响应client端请求
      }

      int total_sleep_time_usec = 0;
      while (true) {
        //等待信号到来
        int signal = wait_for_signal(request.tid, &total_sleep_time_usec);
        switch (signal) {
          ...

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
            //这是输出tombstone信息最为核心的方法
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

对于以下信号都是致命的信号:

- SIGABRT：abort退出异常
- SIGBUS：硬件访问异常
- SIGFPE：浮点运算异常
- SIGILL：非法指令异常
- SIGSEGV：内存访问异常
- SIGSTKFLT：协处理器栈异常
- SIGTRAP：陷阱异常

另外，上篇文章已介绍过[engrave_tombstone](http://gityuan.com/2016/06/15/android-debuggerd/#tombstone)的功能内容，这里就不再累赘了。

#### 2.3.3 activity_manager_write

[-> debuggerd.cpp]

    static void activity_manager_write(int pid, int signal, int amfd, const std::string& amfd_data) {
      if (amfd == -1) {
        return;
      }

      //写入pid和signal，以及原始dump信息，最后添加0以标记结束
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

debuggerd与AMS的NativeCrashListener建立socket连接后，再通过该方法发送数据，数据项包括pid、signal、dump信息。

#### 2.3.4 send_signal

此处只是向目标进程发送SIGKILL信号，用于杀掉目标进程，文章[理解杀进程的实现原理](http://gityuan.com/2016/04/16/kill-signal/#sendsignal)已详细讲述过发送SIGKILL信号的处理流程。

### 三、NativeCrashListener

#### 3.1 startOtherServices

[-> SystemServer.java]

    private void startOtherServices() {
        ...
        mActivityManagerService.systemReady(new Runnable() {
           @Override
           public void run() {
               mSystemServiceManager.startBootPhase(
                       SystemService.PHASE_ACTIVITY_MANAGER_READY);
               try {
                   //【见小节3.2】
                   mActivityManagerService.startObservingNativeCrashes();
               } catch (Throwable e) {
                   reportWtf("observing native crashes", e);
               }
            }
        }
    }

当开机过程中启动服务启动到阶段`PHASE_ACTIVITY_MANAGER_READY`(550)，即服务可以广播自己的Intents，然后启动native crash的监听进程。

#### 3.2 startObservingNativeCrashes

[-> ActivityManagerService.java]

    public void startObservingNativeCrashes() {
        //【见】
        final NativeCrashListener ncl = new NativeCrashListener(this);
        ncl.start();
    }

NativeCrashListener继承于`Thread`，可见这是线程，通过调用start方法来启动线程开始工作。

#### 3.3 NativeCrashListener

[-> NativeCrashListener.java]

    public void run() {
        final byte[] ackSignal = new byte[1];
        {
            //此处DEBUGGERD_SOCKET_PATH= "/data/system/ndebugsocket"
            File socketFile = new File(DEBUGGERD_SOCKET_PATH);
            if (socketFile.exists()) {
                socketFile.delete();
            }
        }

        try {
            FileDescriptor serverFd = Os.socket(AF_UNIX, SOCK_STREAM, 0);
            //创建socket服务端
            final UnixSocketAddress sockAddr = UnixSocketAddress.createFileSystem(
                    DEBUGGERD_SOCKET_PATH);
            Os.bind(serverFd, sockAddr);
            Os.listen(serverFd, 1);

            while (true) {
                FileDescriptor peerFd = null;
                try {
                    //等待debuggerd建立连接
                    peerFd = Os.accept(serverFd, null /* peerAddress */);
                    //获取debuggerd的socket文件描述符
                    if (peerFd != null) {
                        //只有超级用户才被允许通过该socket进行通信
                        StructUcred credentials =
                                Os.getsockoptUcred(peerFd, SOL_SOCKET, SO_PEERCRED);
                        if (credentials.uid == 0) {
                            //【见小节3.4】处理native crash信息
                            consumeNativeCrashData(peerFd);
                        }
                    }
                } catch (Exception e) {
                    Slog.w(TAG, "Error handling connection", e);
                } finally {
                    //应答debuggerd已经建立连接
                    if (peerFd != null) {
                        Os.write(peerFd, ackSignal, 0, 1);//写入应答消息
                        Os.close(peerFd);//关闭socket
                        ...
                    }
                }
            }
        } catch (Exception e) {
            Slog.e(TAG, "Unable to init native debug socket!", e);
        }
    }

"/data/system/ndebugsocket"文件权限700，owned为system:system，debuggerd是以root权限运行，因此可以与该socket建立连接，但对于第三方App则没有权限。

#### 3.4 consumeNativeCrashData
[-> NativeCrashListener.java]

    void consumeNativeCrashData(FileDescriptor fd) {
        //进入该方法，标识着debuggerd已经与AMS建立连接
        final byte[] buf = new byte[4096];
        final ByteArrayOutputStream os = new ByteArrayOutputStream(4096);

        try {
            //此处SOCKET_TIMEOUT_MILLIS=2s
            StructTimeval timeout = StructTimeval.fromMillis(SOCKET_TIMEOUT_MILLIS);
            Os.setsockoptTimeval(fd, SOL_SOCKET, SO_RCVTIMEO, timeout);
            Os.setsockoptTimeval(fd, SOL_SOCKET, SO_SNDTIMEO, timeout);

            //1.读取pid和signal number
            int headerBytes = readExactly(fd, buf, 0, 8);
            if (headerBytes != 8) {
                return; //读取失败
            }

            int pid = unpackInt(buf, 0);
            int signal = unpackInt(buf, 4);

            //2.读取dump内容
            if (pid > 0) {
                final ProcessRecord pr;
                synchronized (mAm.mPidsSelfLocked) {
                    pr = mAm.mPidsSelfLocked.get(pid);
                }
                if (pr != null) {
                    //persistent应用，直接忽略
                    if (pr.persistent) {
                        return;
                    }

                    int bytes;
                    do {
                        //获取数据
                        bytes = Os.read(fd, buf, 0, buf.length);
                        if (bytes > 0) {
                            if (buf[bytes-1] == 0) {
                                //到达文件EOD, 忽略该字节
                                os.write(buf, 0, bytes-1);
                                break;
                            }
                            os.write(buf, 0, bytes);
                        }
                    } while (bytes > 0);

                    synchronized (mAm) {
                        pr.crashing = true;
                        pr.forceCrashReport = true;
                    }

                    final String reportString = new String(os.toByteArray(), "UTF-8");
                    //异常处理native crash报告【见小节3.5】
                    (new NativeCrashReporter(pr, signal, reportString)).start();
                }
            }
        } catch (Exception e) {
            Slog.e(TAG, "Exception dealing with report", e);
        }
    }

读取debuggerd那端发送过来的数据，再通过NativeCrashReporter来把native crash事件报告给framework层。

#### 3.5 NativeCrashReporter

[-> NativeCrashListener.java]

    class NativeCrashReporter extends Thread {
        public void run() {
            try {
                CrashInfo ci = new CrashInfo();
                ci.exceptionClassName = "Native crash";
                ci.exceptionMessage = Os.strsignal(mSignal);
                ci.throwFileName = "unknown";
                ci.throwClassName = "unknown";
                ci.throwMethodName = "unknown";
                ci.stackTrace = mCrashReport;
                //AMS真正处理crash的过程
                mAm.handleApplicationCrashInner("native_crash", mApp, mApp.processName, ci);
            } catch (Exception e) {
                Slog.e(TAG, "Unable to report native crash", e);
            }
        }
    }

不论是Native crash还是framework crash最终都会调用到handleApplicationCrashInner()，该方法位于位于AMS服务。关于AMS的crash处理流程也颇为复杂，下一篇文章会再展开说明。
