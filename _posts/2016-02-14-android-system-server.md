---
layout: post
title:  "Android系统启动-systemServer篇(一)"
date:   2016-02-14 20:11:40
categories: android
excerpt:  Android系统启动-systemServer篇(一)
---

* content
{:toc}


---

> 基于Android 6.0的源码剖析， 分析Android启动过程的system_server进程

	/frameworks/base/core/java/com/android/internal/os/ZygoteInit.java
	/frameworks/base/core/java/com/android/internal/os/RuntimeInit.java
	/frameworks/base/core/services/java/com/android/server/SystemServer.java
	/frameworks/base/core/java/com/android/internal/os/Zygote.java
	/frameworks/base/core/jni/com_android_internal_os_Zygote.cpp

### 启动流程

SystemServer的在Android体系中所处的地位，SystemServer由Zygote fork生成的，进程名为`system_server`，该进程承载着framework的核心服务。[Android系统启动-zygote篇](http://www.yuanhh.com/22016/02/13/android-zygote/)中讲到Zygote启动过程中，会调用startSystemServer()，可知`startSystemServer()`函数是system_server启动流程的起点，启动流程图如下：

![system_server_boot_process](/images/boot/systemServer/system_server.jpg)


下面从startSystemServer()开始讲解详细启动流程。

### 1. startSystemServer

[-->ZygoteInit.java]

    private static boolean startSystemServer(String abiList, String socketName)
            throws MethodAndArgsCaller, RuntimeException {
		...
        //参数准备
        String args[] = {
            "--setuid=1000",
            "--setgid=1000",
            "--setgroups=1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1018,1021,1032,3001,3002,3003,3006,3007",
            "--capabilities=" + capabilities + "," + capabilities,
            "--nice-name=system_server",
            "--runtime-args",
            "com.android.server.SystemServer",
        };

        ZygoteConnection.Arguments parsedArgs = null;
        int pid;
        try {
            //用于解析参数，生成目标格式
            parsedArgs = new ZygoteConnection.Arguments(args);
            ZygoteConnection.applyDebuggerSystemProperty(parsedArgs);
            ZygoteConnection.applyInvokeWithSystemProperty(parsedArgs);

            // fork子进程，该进程是system_server进程【见小节2】
            pid = Zygote.forkSystemServer(
                    parsedArgs.uid, parsedArgs.gid,
                    parsedArgs.gids,
                    parsedArgs.debugFlags,
                    null,
                    parsedArgs.permittedCapabilities,
                    parsedArgs.effectiveCapabilities);
        } catch (IllegalArgumentException ex) {
            throw new RuntimeException(ex);
        }

        //进入子进程system_server
        if (pid == 0) {
            if (hasSecondZygote(abiList)) {
                waitForSecondaryZygote(socketName);
            }
            // 完成system_server进程剩余的工作 【见小节5】
            handleSystemServerProcess(parsedArgs);
        }
        return true;
    }

准备参数并fork新进程，从上面可以看出system server进程参数信息为uid=1000,gid=1000,进程名为sytem_server，从zygote进程fork新进程后，需要关闭zygote原有的socket。另外，对于有两个zygote进程情况，需等待第2个zygote创建完成。

### 2 forkSystemServer

[-->Zygote.java]

    public static int forkSystemServer(int uid, int gid, int[] gids, int debugFlags,
            int[][] rlimits, long permittedCapabilities, long effectiveCapabilities) {
        VM_HOOKS.preFork();
        // 调用native方法fork system_server进程【见小节3】
        int pid = nativeForkSystemServer(
                uid, gid, gids, debugFlags, rlimits, permittedCapabilities, effectiveCapabilities);
        if (pid == 0) {
            Trace.setTracingEnabled(true);
        }
        VM_HOOKS.postForkCommon();
        return pid;
    }

nativeForkSystemServer()，该native方法事在AndroidRuntime.cpp中注册的，然后调用com_android_internal_os_Zygote.cpp中的register_com_android_internal_os_Zygote()方法完成nativeForkSystemServer()与com_android_internal_os_Zygote_nativeForkSystemServer()方法的一一映射关系，也就是会进入下面的方法。

### 3. nativeForkSystemServer

[-->com_android_internal_os_Zygote.cpp]

	static jint com_android_internal_os_Zygote_nativeForkSystemServer(
	        JNIEnv* env, jclass, uid_t uid, gid_t gid, jintArray gids,
	        jint debug_flags, jobjectArray rlimits, jlong permittedCapabilities,
	        jlong effectiveCapabilities) {
	  //fork子进程，见【见小节4】
	  pid_t pid = ForkAndSpecializeCommon(env, uid, gid, gids,
	                                      debug_flags, rlimits,
	                                      permittedCapabilities, effectiveCapabilities,
	                                      MOUNT_EXTERNAL_DEFAULT, NULL, NULL, true, NULL,
	                                      NULL, NULL);
	  if (pid > 0) {
	      // zygote进程，检测system_server进程是否创建
	      gSystemServerPid = pid;
	      int status;
	      if (waitpid(pid, &status, WNOHANG) == pid) {
	          //当system_server进程死亡后，重启zygote进程
	          RuntimeAbort(env);
	      }
	  }
	  return pid;
	}

当system_server进程创建失败时，将会重启zygote进程。这里需要注意，对于Android 5.0以上系统，有两个zygote进程，分别是zygote、zygote64两个进程，system_server的父进程，一般来说64位系统其父进程是zygote64进程

1. 当kill system_server进程后，只重启zygote64和system_server，不重启zygote;
2. 当kill zygote64进程后，只重启zygote64和system_server，也不重启zygote；
3. 当kill zygote进程，则重启zygote、zygote64以及system_server。


### 4. ForkAndSpecializeCommon

[-->com_android_internal_os_Zygote.cpp]

	static pid_t ForkAndSpecializeCommon(JNIEnv* env, uid_t uid, gid_t gid, jintArray javaGids,
	                                     jint debug_flags, jobjectArray javaRlimits,
	                                     jlong permittedCapabilities, jlong effectiveCapabilities,
	                                     jint mount_external,
	                                     jstring java_se_info, jstring java_se_name,
	                                     bool is_system_server, jintArray fdsToClose,
	                                     jstring instructionSet, jstring dataDir) {
	  SetSigChldHandler(); //设置子进程的signal信号处理函数
	  pid_t pid = fork(); //fork子进程
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
	    //等价于调用zygote.callPostForkChildHooks()
	    env->CallStaticVoidMethod(gZygoteClass, gCallPostForkChildHooks, debug_flags,
	                              is_system_server ? NULL : instructionSet);
	    ...

	  } else if (pid > 0) {
	    //进入父进程，即zygote进程
	  }
	  return pid;
	}

fork()创建新进程，采用copy on write方式，这是linux创建进程的标准方法，会有两次return,对于pid==0为子进程的返回，对于pid>0为父进程的返回。  到此system_server进程已完成了创建的所有工作，接下来开始了system_server进程的真正工作。在前面startSystemServer()方法中，zygote进程执行完forkSystemServer()后，新创建出来的system_server进程便进入handleSystemServerProcess()方法。

### 5. handleSystemServerProcess

[-->ZygoteInit.java]

    private static void handleSystemServerProcess(
            ZygoteConnection.Arguments parsedArgs)
            throws ZygoteInit.MethodAndArgsCaller {

        closeServerSocket(); //关闭父进程zygote复制而来的Socket

        Os.umask(S_IRWXG | S_IRWXO);

        if (parsedArgs.niceName != null) {
            Process.setArgV0(parsedArgs.niceName); //设置当前进程名为"system_server"
        }

        final String systemServerClasspath = Os.getenv("SYSTEMSERVERCLASSPATH");
        if (systemServerClasspath != null) {
            //执行dex优化操作【见小节6】
            performSystemServerDexOpt(systemServerClasspath);
        }

        if (parsedArgs.invokeWith != null) {
            String[] args = parsedArgs.remainingArgs;

            if (systemServerClasspath != null) {
                String[] amendedArgs = new String[args.length + 2];
                amendedArgs[0] = "-cp";
                amendedArgs[1] = systemServerClasspath;
                System.arraycopy(parsedArgs.remainingArgs, 0, amendedArgs, 2, parsedArgs.remainingArgs.length);
            }
            //启动应用进程
            WrapperInit.execApplication(parsedArgs.invokeWith,
                    parsedArgs.niceName, parsedArgs.targetSdkVersion,
                    VMRuntime.getCurrentInstructionSet(), null, args);
        } else {
            ClassLoader cl = null;
            if (systemServerClasspath != null) {
                创建类加载器，并赋予当前线程
                cl = new PathClassLoader(systemServerClasspath, ClassLoader.getSystemClassLoader());
                Thread.currentThread().setContextClassLoader(cl);
            }

            //system_server故进入此分支【见小节7】
            RuntimeInit.zygoteInit(parsedArgs.targetSdkVersion, parsedArgs.remainingArgs, cl);
        }

        /* should never reach here */
    }


此处`systemServerClasspath`至少包含/system/framework/services.jar，当然也可以不止于此，比如还可以包含/system/framework/ethernet-service.jar, /system/framework/wifi-service.jar等。

### 6. performSystemServerDexOpt

[-->ZygoteInit.java]

    private static void performSystemServerDexOpt(String classPath) {
        final String[] classPathElements = classPath.split(":");
        //创建一个与installd的建立socket连接
        final InstallerConnection installer = new InstallerConnection();
        //执行ping操作，直到与installd服务端连通为止
        installer.waitForConnection();
        final String instructionSet = VMRuntime.getRuntime().vmInstructionSet();

        try {
            for (String classPathElement : classPathElements) {
                final int dexoptNeeded = DexFile.getDexOptNeeded(
                        classPathElement, "*", instructionSet, false /* defer */);
                if (dexoptNeeded != DexFile.NO_DEXOPT_NEEDED) {
                    //以system权限，执行dex文件优化
                    installer.dexopt(classPathElement, Process.SYSTEM_UID, false,
                            instructionSet, dexoptNeeded);
                }
            }
        } catch (IOException ioe) {
            throw new RuntimeException("Error starting system_server", ioe);
        } finally {
            installer.disconnect(); //断开与installd的socket连接
        }
    }

将classPath字符串中的apk，分别进行dex优化操作。真正执行优化工作通过socket通信将相应的命令参数，发送给installd来完成。

### 7. zygoteInit

[-->RuntimeInit.java]

    public static final void zygoteInit(int targetSdkVersion, String[] argv, ClassLoader classLoader)
            throws ZygoteInit.MethodAndArgsCaller {

        Trace.traceBegin(Trace.TRACE_TAG_ACTIVITY_MANAGER, "RuntimeInit");
        redirectLogStreams(); //重定向log输出

        commonInit(); // 通用的一些初始化【见小节8】
        nativeZygoteInit(); // zygote初始化 【见小节9】
        applicationInit(targetSdkVersion, argv, classLoader); // 应用初始化【见小节10】
    }

### 8. commonInit

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

### 9. nativeZygoteInit

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

ProcessState::self()是单例模式，主要工作是调用open()打开/dev/binder驱动设备，再利用mmap()映射内核的地址空间，将Binder驱动的fd赋值ProcessState对象中的变量mDriverFD，用于交互操作。startThreadPool()是创建一个新的binder线程，不断进行talkWithDriver()，在binder系列文章中的[注册服务(addService)](http://www.yuanhh.com/2015/11/14/binder-add-service/)详细这两个方法的执行原理。


### 10 applicationInit

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

        //调用startClass的static方法 main() 【见小节11】
        invokeStaticMain(args.startClass, args.startArgs, classLoader);
    }
在startSystemServer()方法中通过硬编码初始化参数，可知此处args.startClass为"com.android.server.SystemServer"。

### 11. invokeStaticMain

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

        //通过抛出异常，回到ZygoteInit.main()。这样做好处是能清空栈帧，提高栈帧利用率。【见小节12】
        throw new ZygoteInit.MethodAndArgsCaller(m, argv);
    }


### 12. MethodAndArgsCaller

在[Android系统启动-zygote篇](http://www.yuanhh.com/22016/02/13/android-zygote/#zygoteinit)中遗留了一个问题没有讲解，如下：

[-->ZygoteInit.java]

    public static void main(String argv[]) {
        try {
            startSystemServer(abiList, socketName);//启动system_server
            ....
        } catch (MethodAndArgsCaller caller) {
            caller.run(); //【见小节13】
        } catch (RuntimeException ex) {
            closeServerSocket();
            throw ex;
        }
    }

现在已经很明显了，是invokeStaticMain()方法中抛出的异常`MethodAndArgsCaller`，从而进入caller.run()方法。

[-->ZygoteInit.java]

    public static class MethodAndArgsCaller extends Exception
            implements Runnable {

        public void run() {
            try {
                //根据传递过来的参数，可知此处通过反射机制调用的是SystemServer.main()方法
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

到此，总算是进入到了SystemServer类的main()方法， 在文章[Android系统启动-SystemServer篇(二)](http://www.yuanhh.com/2016/02/20/android-system-server-2/)中会紧接着这里开始讲述。

### fork机制

本文最后通过图来展示zygote作为Android进程的母体，是如何fork出新的子进程，比如本文的system_server进程，以及后续会降到的App进程，如下：

![zygote_fork](/images/boot/zygote/zygote_fork.jpg)

Zygote采用fork方式创建新进程A，采用copy on write技术，新创建的进程复制Zygote进程本身的资源，再加上新进程A相关的资源，构成新的应用进程A。


----------

**[如果您觉得文章对您有所帮助，不妨关注我的微信、微博. ^_^](http://www.yuanhh.com/about/)**


