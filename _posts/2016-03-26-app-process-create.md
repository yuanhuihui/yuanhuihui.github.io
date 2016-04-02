---
layout: post
title:  "理解Android进程创建流程"
date:   2016-03-26 21:10:11
categories: android process
excerpt:  理解Android进程创建流程
---

* content
{:toc}

---

> 基于Android 6.0的源码剖析， 分析Android Process创建流程

	/frameworks/base/core/ava/android/os/Process.java
	/frameworks/base/core/java/com/android/internal/os/ZygoteInit.java
	/frameworks/base/core/java/com/android/internal/os/ZygoteConnection.java

	/frameworks/base/core/java/com/android/internal/os/Zygote.java
	/frameworks/base/core/jni/com_android_internal_os_Zygote.cpp

	/libcore/dalvik/src/main/java/dalvik/system/ZygoteHooks.java
	/art/runtime/native/dalvik_system_ZygoteHooks.cc
	/art/runtime/Runtime.cc
	/art/runtime/Thread.cc
	/art/runtime/signal_catcher.cc
	

### 概述

在前面的文章[Android系统启动-SystemServer上篇](http://gityuan.com/2016/02/14/android-system-server/)讲述关于Zygote 如何fork出子进程system_server（即系统进程）过程，本文将要讲述Android应用进程是如何创建，其流程和创建system_server系统进程创建过程很相近。

![start_app_process](/images/android-process/start_app_process.jpg)

概括来说，App启动过程中先通过binder发送消息给system_server进程，system_server再调用Process.start()方法，通过socket向zygote进程发送创建新进程的请求，此时zygote在执行`ZygoteInit.main()`后，便进入`runSelectLoop()`循环方法中，当有客户端连接时便会执行ZygoteConnection.runOnce()方法，再经过层层调用后fork出新的应用进程，在新进程中执行handleChildProc方法，最后调用ActivityThread.main()方法。




### 1. Process.start

    public static final ProcessStartResult start(final String processClass,
                                  final String niceName,
                                  int uid, int gid, int[] gids,
                                  int debugFlags, int mountExternal,
                                  int targetSdkVersion,
                                  String seInfo,
                                  String abi,
                                  String instructionSet,
                                  String appDataDir,
                                  String[] zygoteArgs) {
        try {
             //【见流程2】
            return startViaZygote(processClass, niceName, uid, gid, gids,
                    debugFlags, mountExternal, targetSdkVersion, seInfo,
                    abi, instructionSet, appDataDir, zygoteArgs);
        } catch (ZygoteStartFailedEx ex) {
            throw new RuntimeException("");
        }
    }

### 2. startViaZygote

[-> Process.java]

    private static ProcessStartResult startViaZygote(final String processClass,
                                  final String niceName,
                                  final int uid, final int gid,
                                  final int[] gids,
                                  int debugFlags, int mountExternal,
                                  int targetSdkVersion,
                                  String seInfo,
                                  String abi,
                                  String instructionSet,
                                  String appDataDir,
                                  String[] extraArgs)
                                  throws ZygoteStartFailedEx {
        synchronized(Process.class) {
            ArrayList<String> argsForZygote = new ArrayList<String>();

            argsForZygote.add("--runtime-args");
            argsForZygote.add("--setuid=" + uid);
            argsForZygote.add("--setgid=" + gid);
            argsForZygote.add("--target-sdk-version=" + targetSdkVersion);

            if (niceName != null) {
                argsForZygote.add("--nice-name=" + niceName);
            }
            if (appDataDir != null) {
                argsForZygote.add("--app-data-dir=" + appDataDir);
            }
            argsForZygote.add(processClass);

            if (extraArgs != null) {
                for (String arg : extraArgs) {
                    argsForZygote.add(arg);
                }
            }
             //【见流程3】
            return zygoteSendArgsAndGetResult(openZygoteSocketIfNeeded(abi), argsForZygote);
        }
    }

该过程主要工作是生成`argsForZygote`数组，该数组保存了进程的uid、gid、groups、target-sdk、nice-name等一系列的参数。



### 3. zygoteSendArgsAndGetResult
[-> Process.java]

**Step 3-1.** openZygoteSocketIfNeeded

    private static ZygoteState openZygoteSocketIfNeeded(String abi) throws ZygoteStartFailedEx {
        if (primaryZygoteState == null || primaryZygoteState.isClosed()) {
            try {
                primaryZygoteState = ZygoteState.connect(ZYGOTE_SOCKET);
            } catch (IOException ioe) {
                throw new ZygoteStartFailedEx("Error connecting to primary zygote", ioe);
            }
        }

        if (primaryZygoteState.matches(abi)) {
            return primaryZygoteState;
        }

        //当主zygote没能匹配成功，则尝试第二个zygote
        if (secondaryZygoteState == null || secondaryZygoteState.isClosed()) {
            try {
            secondaryZygoteState = ZygoteState.connect(SECONDARY_ZYGOTE_SOCKET);
            } catch (IOException ioe) {
                throw new ZygoteStartFailedEx("Error connecting to secondary zygote", ioe);
            }
        }

        if (secondaryZygoteState.matches(abi)) {
            return secondaryZygoteState;
        }

        throw new ZygoteStartFailedEx("Unsupported zygote ABI: " + abi);
    }

`openZygoteSocketIfNeeded(abi)`方法是根据当前的abi来选择与zygote还是zygote64来进行通信。

**Step 3-2.** zygoteSendArgsAndGetResult

    private static ProcessStartResult zygoteSendArgsAndGetResult(
            ZygoteState zygoteState, ArrayList<String> args)
            throws ZygoteStartFailedEx {
        try {
            //
            final BufferedWriter writer = zygoteState.writer;
            final DataInputStream inputStream = zygoteState.inputStream;

            writer.write(Integer.toString(args.size()));
            writer.newLine();

            int sz = args.size();
            for (int i = 0; i < sz; i++) {
                String arg = args.get(i);
                if (arg.indexOf('\n') >= 0) {
                    throw new ZygoteStartFailedEx(
                            "embedded newlines not allowed");
                }
                writer.write(arg);
                writer.newLine();
            }

            writer.flush();

            ProcessStartResult result = new ProcessStartResult();
            //等待socket服务端（即zygote）返回新创建的进程pid;
            //对于等待时长问题，Google正在考虑此处是否应该有一个timeout，但目前是没有的。
            result.pid = inputStream.readInt();
            if (result.pid < 0) {
                throw new ZygoteStartFailedEx("fork() failed");
            }
            result.usingWrapper = inputStream.readBoolean();
            return result;
        } catch (IOException ex) {
            zygoteState.close();
            throw new ZygoteStartFailedEx(ex);
        }
    }

这个方法的主要功能是通过socket通道向Zygote进程发送一个参数列表，然后进入阻塞等待状态，直到远端的socket服务端发送回来新创建的进程pid才返回。

既然system_server进程通过socket向Zygote进程发送消息，这是便会唤醒Zygote进程，来响应socket客户端的请求（即system_server端），接下来的操作便是在Zygote进程中执行。

### 4. runSelectLoop

[-->ZygoteInit.java]

    public static void main(String argv[]) {
        try {
            runSelectLoop(abiList);
            ....
        } catch (MethodAndArgsCaller caller) {
            caller.run(); //【见流程13】
        } catch (RuntimeException ex) {
            closeServerSocket();
            throw ex;
        }
    }

后续会讲到runSelectLoop()方法会抛出异常`MethodAndArgsCaller`，从而进入caller.run()方法。

[-> ZygoteInit.java]

    private static void runSelectLoop(String abiList) throws MethodAndArgsCaller {
        ...

        ArrayList<ZygoteConnection> peers = new ArrayList<ZygoteConnection>();
        while (true) {
            for (int i = pollFds.length - 1; i >= 0; --i) {
                //采用I/O多路复用机制，当客户端发出连接请求或者数据处理请求时，跳过continue，执行后面的代码
                if ((pollFds[i].revents & POLLIN) == 0) {
                    continue;
                }
                if (i == 0) {
                    //创建客户端连接
                    ZygoteConnection newPeer = acceptCommandPeer(abiList);
                    peers.add(newPeer);
                    fds.add(newPeer.getFileDesciptor());
                } else {
                    //处理客户端数据事务 【见流程5】
                    boolean done = peers.get(i).runOnce();
                    if (done) {
                        peers.remove(i);
                        fds.remove(i);
                    }
                }
            }
        }
    }

没有连接请求时会进入休眠状态，当有创建新进程的连接请求时，唤醒Zygote进程，创建Socket通道ZygoteConnection，然后执行ZygoteConnection的runOnce()方法。

### 5. runOnce

[-> ZygoteConnection.java]

    boolean runOnce() throws ZygoteInit.MethodAndArgsCaller {

        String args[];
        Arguments parsedArgs = null;
        FileDescriptor[] descriptors;

        try {
            //读取socket客户端发送过来的参数列表
            args = readArgumentList(); 
            descriptors = mSocket.getAncillaryFileDescriptors();
        } catch (IOException ex) {
            closeSocket();
            return true;
        }

        PrintStream newStderr = null;
        if (descriptors != null && descriptors.length >= 3) {
            newStderr = new PrintStream(new FileOutputStream(descriptors[2]));
        }

        int pid = -1;
        FileDescriptor childPipeFd = null;
        FileDescriptor serverPipeFd = null;

        try {
            //将binder客户端传递过来的参数，解析成Arguments对象格式
            parsedArgs = new Arguments(args);
            ...

            int [] fdsToClose = { -1, -1 };

            FileDescriptor fd = mSocket.getFileDescriptor();
            if (fd != null) {
                fdsToClose[0] = fd.getInt$();
            }

            fd = ZygoteInit.getServerSocketFileDescriptor();
            if (fd != null) {
                fdsToClose[1] = fd.getInt$();
            }
            fd = null;
            【见流程6】
            pid = Zygote.forkAndSpecialize(parsedArgs.uid, parsedArgs.gid, parsedArgs.gids,
                    parsedArgs.debugFlags, rlimits, parsedArgs.mountExternal, parsedArgs.seInfo,
                    parsedArgs.niceName, fdsToClose, parsedArgs.instructionSet,
                    parsedArgs.appDataDir);
        } catch (Exception e) {
            ...
        }

        try {
            if (pid == 0) {
                //子进程执行
                IoUtils.closeQuietly(serverPipeFd);
                serverPipeFd = null;
                【见流程7】
                handleChildProc(parsedArgs, descriptors, childPipeFd, newStderr);

                // 不应到达此处，子进程预期的是抛出异常ZygoteInit.MethodAndArgsCaller或者执行exec().
                return true;
            } else {
                //父进程执行
                IoUtils.closeQuietly(childPipeFd);
                childPipeFd = null;
                return handleParentProc(pid, descriptors, serverPipeFd, parsedArgs);
            }
        } finally {
            IoUtils.closeQuietly(childPipeFd);
            IoUtils.closeQuietly(serverPipeFd);
        }
    }


### 6. forkAndSpecialize

[-> Zygote.java]

    public static int forkAndSpecialize(int uid, int gid, int[] gids, int debugFlags,
          int[][] rlimits, int mountExternal, String seInfo, String niceName, int[] fdsToClose,
          String instructionSet, String appDataDir) {
        VM_HOOKS.preFork(); 【见流程6-1】
        int pid = nativeForkAndSpecialize(
                  uid, gid, gids, debugFlags, rlimits, mountExternal, seInfo, niceName, fdsToClose,
                  instructionSet, appDataDir); 【见流程6-2】
        ...
        VM_HOOKS.postForkCommon(); 【见流程6-3】
        return pid;
    }

这里`VM_HOOKS`是做什么的呢？ 

先说说Zygote进程，如下图：
![zygote_sub_thread](/images/android-process/zygote_sub_thread.png)

从图中可知Zygote进程有4个子线程，分别是`ReferenceQueueDaemon`、`FinalizerDaemon`、`FinalizerWatchdogDaemon`、`HeapTaskDaemon`，此处称为为Zygote的4个Daemon子线程。图中线程名显示的并不完整是由于底层的进程结构体`task_struct`是由长度为16的char型数组保存，超过15个字符便会截断。

可能有人会问zygote64进程不是还有system_server，com.android.phone等子线程，怎么会只有4个呢？那是因为这些并不是Zygote子线程，而是Zygote的子进程。在图中用红色圈起来的是进程的[VSIZE，virtual size)](http://gityuan.com/2015/10/11/ps-command/)，代表的是进程虚拟地址空间大小。线程与进程的最为本质的区别便是是否共享内存空间，图中VSIZE和Zygote进程相同的才是Zygote的子线程，否则就是Zygote的子进程。

#### 6-1 preFork

[-> ZygoteHooks.java]

	 public void preFork() {
        Daemons.stop(); //停止4个Daemon子线程【见流程6-1-1】
        waitUntilAllThreadsStopped(); //等待所有子线程结束【见流程6-1-2】
        token = nativePreFork(); //完成gc堆的初始化工作【见流程6-1-3】
    }

**Step 6-1-1.** Daemons.stop

    public static void stop() {
        HeapTaskDaemon.INSTANCE.stop(); //Java堆整理线程
        ReferenceQueueDaemon.INSTANCE.stop(); //引用队列线程
        FinalizerDaemon.INSTANCE.stop(); //析构线程
        FinalizerWatchdogDaemon.INSTANCE.stop(); //析构监控线程
    }

**Step 6-1-2.** waitUntilAllThreadsStopped

    private static void waitUntilAllThreadsStopped() {
        File tasks = new File("/proc/self/task");
        // 当/proc中线程数大于1，就出让CPU直到只有一个线程，才退出循环
        while (tasks.list().length > 1) {
            Thread.yield(); 
        }
    }

**Step 6-1-3.** nativePreFork

nativePreFork通过JNI最终调用的是dalvik_system_ZygoteHooks.cc中的ZygoteHooks_nativePreFork()方法，如下：

	static jlong ZygoteHooks_nativePreFork(JNIEnv* env, jclass) {
	    Runtime* runtime = Runtime::Current();
	    CHECK(runtime->IsZygote()) << "runtime instance not started with -Xzygote";
	    runtime->PreZygoteFork(); 【见流程6-1-3-1】
	    if (Trace::GetMethodTracingMode() != TracingMode::kTracingInactive) {
	      Trace::Pause();
	    }
	    //将线程转换为long型并保存到token，该过程是非安全的
	    return reinterpret_cast<jlong>(ThreadForEnv(env));
	}

**Step 6-1-3-1.** PreZygoteFork

	void Runtime::PreZygoteFork() {
	    // 堆的初始化工作。这里就不继续再往下追了，等后续有空专门谢谢关于art虚拟机
	    heap_->PreZygoteFork(); 
	}


VM_HOOKS.preFork()的主要功能便是停止Zygote的4个Daemon子线程的运行，等待并确保Zygote是单线程（用于提升fork效率），并等待这些线程的停止，初始化gc堆的工作。

#### 6-2 nativeForkAndSpecialize

nativeForkAndSpecialize()通过JNI最终调用的是com_android_internal_os_Zygote.cpp中的
com_android_internal_os_Zygote_nativeForkAndSpecialize()方法，如下：

[-> com_android_internal_os_Zygote.cpp]

	static jint com_android_internal_os_Zygote_nativeForkAndSpecialize(
        JNIEnv* env, jclass, jint uid, jint gid, jintArray gids,
        jint debug_flags, jobjectArray rlimits,
        jint mount_external, jstring se_info, jstring se_name,
        jintArray fdsToClose, jstring instructionSet, jstring appDataDir) {
	    // 将CAP_WAKE_ALARM赋予蓝牙进程
	    jlong capabilities = 0;
	    if (uid == AID_BLUETOOTH) {
	        capabilities |= (1LL << CAP_WAKE_ALARM);
	    }
	    【见流程6-2-1】
	    return ForkAndSpecializeCommon(env, uid, gid, gids, debug_flags,
	            rlimits, capabilities, capabilities, mount_external, se_info,
	            se_name, false, fdsToClose, instructionSet, appDataDir);
    }

**Step 6-2-1.**ForkAndSpecializeCommon

[-> com_android_internal_os_Zygote.cpp]

	static pid_t ForkAndSpecializeCommon(JNIEnv* env, uid_t uid, gid_t gid, jintArray javaGids,
	                                     jint debug_flags, jobjectArray javaRlimits,
	                                     jlong permittedCapabilities, jlong effectiveCapabilities,
	                                     jint mount_external,
	                                     jstring java_se_info, jstring java_se_name,
	                                     bool is_system_server, jintArray fdsToClose,
	                                     jstring instructionSet, jstring dataDir) {
	  SetSigChldHandler(); //设置子进程的signal信号处理函数
	  pid_t pid = fork(); //fork子进程 【见流程6-2-1-1】
	  if (pid == 0) {
	    //进入子进程
	    DetachDescriptors(env, fdsToClose); //关闭并清除文件描述符

	    if (!is_system_server) {
	        //对于非system_server子进程，则创建进程组
	        int rc = createProcessGroup(uid, getpid());
	    }
	    SetGids(env, javaGids); //设置设置group
	    SetRLimits(env, javaRlimits); //设置资源limit

	    int rc = setresgid(gid, gid, gid);
	    rc = setresuid(uid, uid, uid);

	    SetCapabilities(env, permittedCapabilities, effectiveCapabilities);
	    SetSchedulerPolicy(env); //设置调度策略

	     //selinux上下文
	    rc = selinux_android_setcontext(uid, is_system_server, se_info_c_str, se_name_c_str);

	    if (se_info_c_str == NULL && is_system_server) {
	      se_name_c_str = "system_server";
	    }
	    if (se_info_c_str != NULL) {
	      SetThreadName(se_name_c_str); //设置线程名为system_server，方便调试
	    }
	    UnsetSigChldHandler(); //设置子进程的signal信号处理函数为默认函数
	    //等价于调用zygote.callPostForkChildHooks() 【见流程6-2-2-1】
	    env->CallStaticVoidMethod(gZygoteClass, gCallPostForkChildHooks, debug_flags,
	                              is_system_server ? NULL : instructionSet);
	    ...

	  } else if (pid > 0) {
	    //进入父进程，即Zygote进程
	  }
	  return pid;
	}

**Step 6-2-1-1.** fork()

Zygote进程是所有Android进程的母体，包括system_server进程以及App进程都是由Zygote进程孵化而来。

![zygote_fork](/images/boot/zygote/zygote_fork.jpg)

Zygote采用fork方式创建新进程A，采用copy on write技术，这是linux创建进程的标准方法，会有两次return,对于pid==0为子进程的返回，对于pid>0为父进程的返回。新创建的进程复制Zygote进程本身的资源，再加上新进程A相关的资源，构成新的应用进程A。

**Step 6-2-2-1.** Zygote.callPostForkChildHooks

    private static void callPostForkChildHooks(int debugFlags, boolean isSystemServer,
            String instructionSet) {
        VM_HOOKS.postForkChild(debugFlags, isSystemServer, instructionSet);
    }

    public void postForkChild(int debugFlags, String instructionSet) {
        【见流程6-2-2-1-1】
        nativePostForkChild(token, debugFlags, instructionSet);
        Math.setRandomSeedInternal(System.currentTimeMillis());
    }

在这里，设置了新进程Random随机数种子为当前系统时间，也就是在进程创建的那一刻就决定了未来随机数的情况，也就是伪随机。

**Step 6-2-2-1-1.** nativePostForkChild

最终调用dalvik_system_ZygoteHooks的ZygoteHooks_nativePostForkChild

[-> dalvik_system_ZygoteHooks.cc]

	static void ZygoteHooks_nativePostForkChild(JNIEnv* env, jclass, jlong token, jint debug_flags,
	                                            jstring instruction_set) {
	    Thread* thread = reinterpret_cast<Thread*>(token);
	    //设置新进程的主线程id
	    thread->InitAfterFork();
	    ..
	    if (instruction_set != nullptr) {
	      ScopedUtfChars isa_string(env, instruction_set);
	      InstructionSet isa = GetInstructionSetFromString(isa_string.c_str());
	      Runtime::NativeBridgeAction action = Runtime::NativeBridgeAction::kUnload;
	      if (isa != kNone && isa != kRuntimeISA) {
	        action = Runtime::NativeBridgeAction::kInitialize;
	      }
	      【见流程6-2-2-1-1-1】
	      Runtime::Current()->DidForkFromZygote(env, action, isa_string.c_str());
	    } else {
	      Runtime::Current()->DidForkFromZygote(env, Runtime::NativeBridgeAction::kUnload, nullptr);
	    }
	}

**Step 6-2-2-1-1-1.** DidForkFromZygote

[-> Runtime.cc]

	void Runtime::DidForkFromZygote(JNIEnv* env, NativeBridgeAction action, const char* isa) {
	  is_zygote_ = false;
	  if (is_native_bridge_loaded_) {
	    switch (action) {
	      case NativeBridgeAction::kUnload:
	        UnloadNativeBridge(); //卸载用于跨平台的桥连库
	        is_native_bridge_loaded_ = false;
	        break;
	      case NativeBridgeAction::kInitialize:
	        InitializeNativeBridge(env, isa);//初始化用于跨平台的桥连库
	        break;
	    }
	  }
	  //创建Java堆处理的线程池
	  heap_->CreateThreadPool();
	  //重置gc性能数据，以保证进程在创建之前的GCs不会计算到当前app上。
	  heap_->ResetGcPerformanceInfo();
	  if (jit_.get() == nullptr && jit_options_->UseJIT()) {
	    //当flag被设置，并且还没有创建JIT时，则创建JIT
	    CreateJit();
	  }
	  //设置信号处理函数
	  StartSignalCatcher();
	  //启动JDWP线程，当命令debuger的flags指定"suspend=y"时，则暂停runtime
	  Dbg::StartJdwp();
	}

关于信号处理过程，其代码位于signal_catcher.cc文件中，后续会单独讲解。

#### 6-3 postForkCommon

[-> ZygoteHooks.java]

    public void postForkCommon() {
        Daemons.start(); 【见流程6-3-1】
    }

**Step 6-3-1.** Daemons.start

    public static void start() {
        ReferenceQueueDaemon.INSTANCE.start();
        FinalizerDaemon.INSTANCE.start();
        FinalizerWatchdogDaemon.INSTANCE.start();
        HeapTaskDaemon.INSTANCE.start();
    }

VM_HOOKS.postForkCommon的主要功能是在fork新进程后，启动Zygote的4个Daemon线程，java堆整理，引用队列，以及析构线程。


 **小结：forkAndSpecialize()的工作**

调用关系链如下：

	Zygote.forkAndSpecialize
		ZygoteHooks.preFork
			Daemons.stop
			ZygoteHooks.nativePreFork
				ZygoteHooks_nativePreFork
					Runtime::PreZygoteFork
						heap_->PreZygoteFork()
		Zygote.nativeForkAndSpecialize
			Zygote.ForkAndSpecializeCommon
				fork()
				Zygote.callPostForkChildHooks
					ZygoteHooks.postForkChild
						nativePostForkChild
							Runtime::DidForkFromZygote
		ZygoteHooks.postForkCommon
			Daemons.start


到此App进程已完成了创建的所有工作，接下来开始新创建的App进程的工作。在前面ZygoteConnection.runOnce方法中，zygote进程执行完`forkAndSpecialize()`后，新创建的App进程便进入`handleChildProc()`方法，下面的操作运行在App进程。

### 7. handleChildProc

[-> ZygoteConnection.java]

    private void handleChildProc(Arguments parsedArgs,
            FileDescriptor[] descriptors, FileDescriptor pipeFd, PrintStream newStderr)
            throws ZygoteInit.MethodAndArgsCaller {

        //关闭Zygote的socket两端的连接
        closeSocket();
        ZygoteInit.closeServerSocket();

        if (descriptors != null) {
            try {
                Os.dup2(descriptors[0], STDIN_FILENO);
                Os.dup2(descriptors[1], STDOUT_FILENO);
                Os.dup2(descriptors[2], STDERR_FILENO);
                for (FileDescriptor fd: descriptors) {
                    IoUtils.closeQuietly(fd);
                }
                newStderr = System.err;
            } catch (ErrnoException ex) {
                Log.e(TAG, "Error reopening stdio", ex);
            }
        }

        if (parsedArgs.niceName != null) {
            //设置进程名
            Process.setArgV0(parsedArgs.niceName);
        }

        if (parsedArgs.invokeWith != null) {
            //据说这是用于检测进程内存泄露或溢出时场景而设计，后续还需要进一步分析。
            WrapperInit.execApplication(parsedArgs.invokeWith,
                    parsedArgs.niceName, parsedArgs.targetSdkVersion,
                    VMRuntime.getCurrentInstructionSet(),
                    pipeFd, parsedArgs.remainingArgs);
        } else {
            //执行目标类的main()方法 【见流程8】
            RuntimeInit.zygoteInit(parsedArgs.targetSdkVersion,
                    parsedArgs.remainingArgs, null);
        }
    }

### 8. zygoteInit

[-->RuntimeInit.java]

    public static final void zygoteInit(int targetSdkVersion, String[] argv, ClassLoader classLoader)
            throws ZygoteInit.MethodAndArgsCaller {

        Trace.traceBegin(Trace.TRACE_TAG_ACTIVITY_MANAGER, "RuntimeInit");
        redirectLogStreams(); //重定向log输出

        commonInit(); // 通用的一些初始化【见流程9】
        nativeZygoteInit(); // zygote初始化 【见流程10】
        applicationInit(targetSdkVersion, argv, classLoader); // 应用初始化【见流程11】
    }

### 9. commonInit

[-->RuntimeInit.java]

    private static final void commonInit() {
        // 设置默认的未捕捉异常处理方法
        Thread.setDefaultUncaughtExceptionHandler(new UncaughtHandler());

        // 设置市区，中国时区为"Asia/Shanghai"
        TimezoneGetter.setInstance(new TimezoneGetter() {
            @Override
            public String getId() {
                return SystemProperties.get("persist.sys.timezone");
            }
        });
        TimeZone.setDefault(null);

        //重置log配置
        LogManager.getLogManager().reset(); 
        new AndroidConfig(); 

        // 设置默认的HTTP User-agent格式,用于 HttpURLConnection。
        String userAgent = getDefaultUserAgent();
        System.setProperty("http.agent", userAgent);

        // 设置socket的tag，用于网络流量统计
        NetworkManagementSocketTagger.install();
    }

默认的HTTP User-agent格式，例如：

	 "Dalvik/1.1.0 (Linux; U; Android 6.0.1；LenovoX3c70 Build/LMY47V)".

### 10. nativeZygoteInit

nativeZygoteInit()方法在AndroidRuntime.cpp中，进行了jni映射，对应下面的方法。

[-->AndroidRuntime.cpp]

	static void com_android_internal_os_RuntimeInit_nativeZygoteInit(JNIEnv* env, jobject clazz)
	{
	    gCurRuntime->onZygoteInit(); //此处的gCurRuntime为AppRuntime，是在AndroidRuntime.cpp中定义的
	}

[-->app_main.cpp]

    virtual void onZygoteInit()
    {
        sp<ProcessState> proc = ProcessState::self();
        proc->startThreadPool(); //启动新binder线程
    }

ProcessState::self()是单例模式，主要工作是调用open()打开/dev/binder驱动设备，再利用mmap()映射内核的地址空间，将Binder驱动的fd赋值ProcessState对象中的变量mDriverFD，用于交互操作。startThreadPool()是创建一个新的binder线程，不断进行talkWithDriver()，在binder系列文章中的[注册服务(addService)](http://gityuan.com/2015/11/14/binder-add-service/)详细这两个方法的执行原理。


### 11. applicationInit

[-->RuntimeInit.java]

    private static void applicationInit(int targetSdkVersion, String[] argv, ClassLoader classLoader)
            throws ZygoteInit.MethodAndArgsCaller {
        //true代表应用程序退出时不调用AppRuntime.onExit()，否则会在退出前调用
        nativeSetExitWithoutCleanup(true);

        //设置虚拟机的内存利用率参数值为0.75
        VMRuntime.getRuntime().setTargetHeapUtilization(0.75f);
        VMRuntime.getRuntime().setTargetSdkVersion(targetSdkVersion);

        final Arguments args;
        try {
            args = new Arguments(argv); //解析参数
        } catch (IllegalArgumentException ex) {
            Slog.e(TAG, ex.getMessage());
            return;
        }

        Trace.traceEnd(Trace.TRACE_TAG_ACTIVITY_MANAGER);

        //调用startClass的static方法 main() 【见流程12】
        invokeStaticMain(args.startClass, args.startArgs, classLoader);
    }

此处args.startClass为"android.app.ActivityThread"。

### 12. invokeStaticMain

[-->RuntimeInit.java]

    private static void invokeStaticMain(String className, String[] argv, ClassLoader classLoader)
            throws ZygoteInit.MethodAndArgsCaller {
        Class<?> cl;

        try {
            cl = Class.forName(className, true, classLoader);
        } catch (ClassNotFoundException ex) {
            throw new RuntimeException(
                    "Missing class when invoking static main " + className, ex);
        }

        Method m;
        try {
            m = cl.getMethod("main", new Class[] { String[].class });
        } catch (NoSuchMethodException ex) {
            throw new RuntimeException( "Missing static main on " + className, ex);
        } catch (SecurityException ex) {
            throw new RuntimeException(
                    "Problem getting static main on " + className, ex);
        }

        int modifiers = m.getModifiers();
        if (! (Modifier.isStatic(modifiers) && Modifier.isPublic(modifiers))) {
            throw new RuntimeException(
                    "Main method is not public and static on " + className);
        }

        //通过抛出异常，回到ZygoteInit.main()。这样做好处是能清空栈帧，提高栈帧利用率。【见流程13】
        throw new ZygoteInit.MethodAndArgsCaller(m, argv);
    }

invokeStaticMain()方法中抛出的异常`MethodAndArgsCaller`，根据前面的【流程4】中可知，下一步进入caller.run()方法。

### 13. MethodAndArgsCaller

[-->ZygoteInit.java]

    public static class MethodAndArgsCaller extends Exception
            implements Runnable {

        public void run() {
            try {
                //根据传递过来的参数，可知此处通过反射机制调用的是ActivityThread.main()方法
                mMethod.invoke(null, new Object[] { mArgs }); 
            } catch (IllegalAccessException ex) {
                throw new RuntimeException(ex);
            } catch (InvocationTargetException ex) {
                Throwable cause = ex.getCause();
                if (cause instanceof RuntimeException) {
                    throw (RuntimeException) cause;
                } else if (cause instanceof Error) {
                    throw (Error) cause;
                }
                throw new RuntimeException(ex);
            }
        }
    }

到此，总算是进入到了ActivityThread类的main()方法。

----------

### 总结

当App第一次启动时或者启动远程Service，即AndroidManifest.xml文件中定义了process:remote属性时，都需要创建进程。比如当用户点击桌面的某个App图标，桌面本身是一个app（即Launcher App），那么Launcher所在进程便是这次创建新进程的发起进程，该通过binder发送消息给system_server进程，该进程承载着整个java framework的核心服务。system_server进程从Process.start开始，执行创建进程，流程图（以进程的视角）如下：

点击查看[大图](http:/gityuan.com/images/android-process/process-create.jpg)

![process-create](/images/android-process/process-create.jpg)

上图中，`system_server`进程通过socket IPC通道向`zygote`进程通信，`zygote`在fork出新进程后由于fork返回两次，从而能进入新进程来执行代码。

1. **system_server进程**（即`流程1~3`）：通过Process.start()方法发起创建新进程请求，会先收集各种新进程uid、gid、nice-name等相关的参数，然后通过socket通道发送给zygote进程；
2. **zygote进程**（即`流程4~6`）：接收到system_server进程发送过来的参数后封装成Arguments对象，forkAndSpecialize()方法是进程创建过程中最为核心的一个环节（详细见上面的流程6），其具体工作是依次执行下面的3个方法：
	- preFork()：先停止Zygote的4个Daemon子线程（java堆内存整理线程、对线下引用队列线程、析构线程以及监控线程）的运行以及初始化gc堆；
	- nativeForkAndSpecialize()：调用linux的fork()出`新建进程`，创建Java堆处理的线程池，重置gc性能数据，设置进程的信号处理函数，启动JDWP线程；
	- postForkCommon()：在启动之前被暂停的4个Daemon子线程。
3. **新建进程**（即`流程7~13`）：进入handleChildProc()方法，设置进程名，打开binder驱动，启动新的binder线程；然后设置art虚拟机参数，再反射调用目标类的main()方法，即Activity.main()方法。

再之后的流程，如果是startActivity则将要进入Activity的onCreate/onStart/onResume等生命周期；如果是startService则将要进入Service的onCreate等生命周期。