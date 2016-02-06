---
layout: post
title:  "Android系统启动-zygote篇"
date:   2016-02-05 20:21:40
categories: android
excerpt:  Android系统启动-zygote篇
---

* content
{:toc}


---

> 基于Android 6.0的源码剖析， 分析Android启动过程的Zygote进程

	/frameworks/base/cmds/app_process/App_main.cpp （内含AppRuntime类）
	/frameworks/base/core/jni/AndroidRuntime.cpp
	/frameworks/base/core/java/com/android/internal/os/ZygoteInit.java
	/frameworks/base/core/java/com/android/internal/os/Zygote.java
	/frameworks/base/core/java/android/net/LocalServerSocket.java

**上传测试，本文尚未完成。。。**

## Zygote启动流程

Zygote是由[init进程](http://www.yuanhh.com/2016/01/16/android-init//#zygote)通过解析init.zygote.rc文件而创建的，zygote所对应的可执行程序app_process，所对应的源文件是App_main.cpp，进程名为zygote。

![startup_process](/images/boot/zygote/startup_process.jpg)


### 起点

传到此处的参数为 `-Xzygote /system/bin --zygote --start-system-server`

App_main.cpp

	int main(int argc, char* const argv[])
	{
	    if (prctl(PR_SET_NO_NEW_PRIVS, 1, 0, 0, 0) < 0) {
	        if (errno != EINVAL) {
	            LOG_ALWAYS_FATAL("PR_SET_NO_NEW_PRIVS failed: %s", strerror(errno));
	            return 12;
	        }
	    }
	    AppRuntime runtime(argv[0], computeArgBlockSize(argc, argv));

	    //忽略第一个参数
	    argc--;
	    argv++;

	    int i;
	    for (i = 0; i < argc; i++) {
	        if (argv[i][0] != '-') {
	            break;
	        }
	        if (argv[i][1] == '-' && argv[i][2] == 0) {
	            ++i; // Skip --.
	            break;
	        }
	        runtime.addOption(strdup(argv[i]));
	    }
	    // Parse runtime arguments.  Stop at first unrecognized option.
	    bool zygote = false;
	    bool startSystemServer = false;
	    bool application = false;
	    String8 niceName;
	    String8 className;
	    ++i;  // Skip unused "parent dir" argument.
	    while (i < argc) {
	        const char* arg = argv[i++];
	        if (strcmp(arg, "--zygote") == 0) {
	            zygote = true;
	            niceName = ZYGOTE_NICE_NAME;
	        } else if (strcmp(arg, "--start-system-server") == 0) {
	            startSystemServer = true;
	        } else if (strcmp(arg, "--application") == 0) {
	            application = true;
	        } else if (strncmp(arg, "--nice-name=", 12) == 0) {
	            niceName.setTo(arg + 12);
	        } else if (strncmp(arg, "--", 2) != 0) {
	            className.setTo(arg);
	            break;
	        } else {
	            --i;
	            break;
	        }
	    }
	    Vector<String8> args;
	    if (!className.isEmpty()) {
	        args.add(application ? String8("application") : String8("tool"));
	        runtime.setClassNameAndArgs(className, argc - i, argv + i);
	    } else {
	        // We're in zygote mode.
	        maybeCreateDalvikCache();
	        if (startSystemServer) {
	            args.add(String8("start-system-server"));
	        }
	        char prop[PROP_VALUE_MAX];
	        if (property_get(ABI_LIST_PROPERTY, prop, NULL) == 0) {
	            LOG_ALWAYS_FATAL("app_process: Unable to determine ABI list from property %s.",
	                ABI_LIST_PROPERTY);
	            return 11;
	        }
	        String8 abiFlag("--abi-list=");
	        abiFlag.append(prop);
	        args.add(abiFlag);
	        // In zygote mode, pass all remaining arguments to the zygote
	        // main() method.
	        for (; i < argc; ++i) {
	            args.add(String8(argv[i]));
	        }
	    }
	    if (!niceName.isEmpty()) {
	        runtime.setArgv0(niceName.string());
	        set_process_name(niceName.string());
	    }
	    if (zygote) {
	        // 【见下文】
	        runtime.start("com.android.internal.os.ZygoteInit", args, zygote);
	    } else if (className) {
	        runtime.start("com.android.internal.os.RuntimeInit", args, zygote);
	    } else {
	        fprintf(stderr, "Error: no class name or --zygote supplied.\n");
	        app_usage();
	        LOG_ALWAYS_FATAL("app_process: no class name or --zygote supplied.");
	        return 10;
	    }
	}


### start

AndroidRuntime.cpp

	void AndroidRuntime::start(const char* className, const Vector<String8>& options, bool zygote)
	{

	    static const String8 startSystemServer("start-system-server");

	    for (size_t i = 0; i < options.size(); ++i) {
	        if (options[i] == startSystemServer) {
	           const int LOG_BOOT_PROGRESS_START = 3000;
	           LOG_EVENT_LONG(LOG_BOOT_PROGRESS_START,  ns2ms(systemTime(SYSTEM_TIME_MONOTONIC)));
	        }
	    }
	    const char* rootDir = getenv("ANDROID_ROOT");
	    if (rootDir == NULL) {
	        rootDir = "/system";
	        if (!hasDir("/system")) {
	            return;
	        }
	        setenv("ANDROID_ROOT", rootDir, 1);
	    }
	    JniInvocation jni_invocation;
	    jni_invocation.Init(NULL);
	    JNIEnv* env;
	    // 【见下文】
	    if (startVm(&mJavaVM, &env, zygote) != 0) {
	        return;
	    }
	    onVmCreated(env);
	    // 【见下文】
	    if (startReg(env) < 0) {
	        ALOGE("Unable to register all android natives\n");
	        return;
	    }

	    jclass stringClass;
	    jobjectArray strArray;
	    jstring classNameStr;
	    stringClass = env->FindClass("java/lang/String");
	    assert(stringClass != NULL);
	    strArray = env->NewObjectArray(options.size() + 1, stringClass, NULL);
	    assert(strArray != NULL);
	    classNameStr = env->NewStringUTF(className);
	    assert(classNameStr != NULL);
	    env->SetObjectArrayElement(strArray, 0, classNameStr);
	    for (size_t i = 0; i < options.size(); ++i) {
	        jstring optionsStr = env->NewStringUTF(options.itemAt(i).string());
	        assert(optionsStr != NULL);
	        env->SetObjectArrayElement(strArray, i + 1, optionsStr);
	    }

	    char* slashClassName = toSlashClassName(className);
	    jclass startClass = env->FindClass(slashClassName);
	    if (startClass == NULL) {
	        ALOGE("JavaVM unable to locate class '%s'\n", slashClassName);
	    } else {
	        jmethodID startMeth = env->GetStaticMethodID(startClass, "main",
	            "([Ljava/lang/String;)V");
	        if (startMeth == NULL) {
	            ALOGE("JavaVM unable to find main() in '%s'\n", className);
	        } else {
	            // 【见下文】
	            env->CallStaticVoidMethod(startClass, startMeth, strArray);
	        }
	    }
	    free(slashClassName);
	    if (mJavaVM->DetachCurrentThread() != JNI_OK)
	        ALOGW("Warning: unable to detach main thread\n");
	    if (mJavaVM->DestroyJavaVM() != 0)
	        ALOGW("Warning: VM did not shut down cleanly\n");
	}


### startVm

[-->AndroidRuntime.cpp]

### startReg


[-->AndroidRuntime.cpp]

### CallStaticVoidMethod

env->CallStaticVoidMethod(startClass, startMeth, strArray);最终调用com.android.internal.os.ZygoteInit的main()方法

ZygoteInit.java

    public static void main(String argv[]) {
        try {
            RuntimeInit.enableDdms(); //开启DDMS功能
            SamplingProfilerIntegration.start();
            boolean startSystemServer = false;
            String socketName = "zygote";
            String abiList = null;
            for (int i = 1; i < argv.length; i++) {
                if ("start-system-server".equals(argv[i])) {
                    startSystemServer = true;
                } else if (argv[i].startsWith(ABI_LIST_ARG)) {
                    abiList = argv[i].substring(ABI_LIST_ARG.length());
                } else if (argv[i].startsWith(SOCKET_NAME_ARG)) {
                    socketName = argv[i].substring(SOCKET_NAME_ARG.length());
                } else {
                    throw new RuntimeException("Unknown command line argument: " + argv[i]);
                }
            }
            if (abiList == null) {
                throw new RuntimeException("No ABI list supplied.");
            }
            registerZygoteSocket(socketName); //为Zygote注册socket【】
            preload(); // 预加载类和资源【】
            SamplingProfilerIntegration.writeZygoteSnapshot();
            gcAndFinalize(); //GC操作
            if (startSystemServer) {
                startSystemServer(abiList, socketName);//启动system_server【】
            }
            runSelectLoop(abiList); //进入循环模式【】
            closeServerSocket();
        } catch (MethodAndArgsCaller caller) {
            caller.run(); //【】
        } catch (RuntimeException ex) {
            closeServerSocket();
            throw ex;
        }
    }

### startSystemServer

ZygoteInit.java

    private static boolean startSystemServer(String abiList, String socketName)
            throws MethodAndArgsCaller, RuntimeException {
        long capabilities = posixCapabilitiesAsBits(
            OsConstants.CAP_BLOCK_SUSPEND,
            OsConstants.CAP_KILL,
            OsConstants.CAP_NET_ADMIN,
            OsConstants.CAP_NET_BIND_SERVICE,
            OsConstants.CAP_NET_BROADCAST,
            OsConstants.CAP_NET_RAW,
            OsConstants.CAP_SYS_MODULE,
            OsConstants.CAP_SYS_NICE,
            OsConstants.CAP_SYS_RESOURCE,
            OsConstants.CAP_SYS_TIME,
            OsConstants.CAP_SYS_TTY_CONFIG
        );
        /* Hardcoded command line to start the system server */
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
            parsedArgs = new ZygoteConnection.Arguments(args);
            ZygoteConnection.applyDebuggerSystemProperty(parsedArgs);
            ZygoteConnection.applyInvokeWithSystemProperty(parsedArgs);
            // fork子进程，用于运行system_server
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

        if (pid == 0) {
            if (hasSecondZygote(abiList)) {
                waitForSecondaryZygote(socketName);
            }
            // 进入system_server进程 【】
            handleSystemServerProcess(parsedArgs);
        }
        return true;
    }


## Zygote创建新进程



![zygote_fork](/images/boot/zygote/zygote_fork.jpg)

**上传测试，本文尚未完成。。。**
