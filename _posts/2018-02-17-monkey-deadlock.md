---
layout: post
title:  "跑monkey压力测试过程的冻屏案例"
date:   2018-02-17 22:21:12
catalog:  true
tags:
    - android
    - 实战案例

---

> 这是作者在2017年处理的monkey相关的冻屏案例

## 一、引用

这个问题经常在跑monkey出现, 普通用户端不会出现这个问题(发烧友刷带有root的版本或者内部root版本除外), 也没有真正花精力去分析.
但这个问题 困扰了测试同事 有一段时间了, 这次花精力认真研究了下这个问题的前因后果.

问题现象就是monkey压力测试一段时间后会出现冻屏，有时候一直冻着，有时候居然还可以恢复，并且每次出现冻屏问题，都无法抓取bugreport，导致无法进一步分析问题。

## 二、过程分析

#### 1.1  system_server进程

```Java
"main" prio=5 tid=1 Blocked
  | group="main" sCount=1 dsCount=0 obj=0x75ba9000 self=0x7f95496a00
  | sysTid=1930 nice=-2 cgrp=default sched=0/0 handle=0x7f9987ba98
  | state=S schedstat=( 0 0 0 ) utm=304 stm=241 core=6 HZ=100
  | stack=0x7fe6384000-0x7fe6386000 stackSize=8MB
  | held mutexes=
  at com.android.server.am.ActivityManagerService.broadcastIntent(ActivityManagerService.java:18933)
  - waiting to lock <0x098877e9> (a com.android.server.am.ActivityManagerService) held by thread 85
  at android.app.ContextImpl.sendBroadcastAsUser(ContextImpl.java:1073)
  at android.app.ContextImpl.sendBroadcastAsUser(ContextImpl.java:1062)
  at com.android.server.DropBoxManagerService$3.handleMessage(DropBoxManagerService.java:173)
  at android.os.Handler.dispatchMessage(Handler.java:102)
  at android.os.Looper.loop(Looper.java:154)
  at com.android.server.SystemServer.run(SystemServer.java:363)
  at com.android.server.SystemServer.main(SystemServer.java:231)
  at java.lang.reflect.Method.invoke!(Native method)
  at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:895)
  at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:785)
```

```Java
"Binder:1930_5" prio=5 tid=85 Native
  | group="main" sCount=1 dsCount=0 obj=0x13cb1820 self=0x7f79fcd400
  | sysTid=5316 nice=-2 cgrp=default sched=0/0 handle=0x7f6e1ff450
  | state=S schedstat=( 0 0 0 ) utm=83 stm=56 core=2 HZ=100
  | stack=0x7f6e105000-0x7f6e107000 stackSize=1005KB
  | held mutexes=
  kernel: __switch_to+0x88/0x94
  kernel: binder_thread_read+0x4e4/0x1140
  kernel: binder_ioctl_write_read+0x1e0/0x31c
  kernel: binder_ioctl+0x28c/0x710
  kernel: do_vfs_ioctl+0x48c/0x564
  kernel: SyS_ioctl+0x60/0x88
  kernel: el0_svc_naked+0x24/0x28
  native: #00 pc 000000000007831c  /system/lib64/libc.so (__ioctl+4)
  native: #01 pc 0000000000020020  /system/lib64/libc.so (ioctl+140)
  native: #02 pc 0000000000055b14  /system/lib64/libbinder.so (_ZN7android14IPCThreadState14talkWithDriverEb+256)
  native: #03 pc 0000000000056ab8  /system/lib64/libbinder.so (_ZN7android14IPCThreadState15waitForResponseEPNS_6ParcelEPi+708)
  native: #04 pc 000000000004b504  /system/lib64/libbinder.so (_ZN7android8BpBinder8transactEjRKNS_6ParcelEPS1_j+72)
  native: #05 pc 00000000000ff69c  /system/lib64/libandroid_runtime.so (???)
  native: #06 pc 0000000001117058  /data/dalvik-cache/arm64/system@framework@boot.oat (Java_android_os_BinderProxy_transactNative__ILandroid_os_Parcel_2Landroid_os_Parcel_2I+196)
  at android.os.BinderProxy.transactNative(Native method)
  at android.os.BinderProxy.transact(Binder.java:615)
  at android.app.IActivityController$Stub$Proxy.appCrashed(IActivityController.java:222)
  at com.android.server.am.AppErrors.handleAppCrashInActivityController(AppErrors.java:450)
  at com.android.server.am.AppErrors.crashApplicationInner(AppErrors.java:334)
  - locked <0x098877e9> (a com.android.server.am.ActivityManagerService)
  at com.android.server.am.AppErrors.crashApplication(AppErrors.java:309)
  at com.android.server.am.ActivityManagerService.handleApplicationCrashInner(ActivityManagerService.java:13799)
  at com.android.server.am.ActivityManagerService.handleApplicationCrash(ActivityManagerService.java:13781)
  at android.app.ActivityManagerNative.onTransact(ActivityManagerNative.java:1646)
  at com.android.server.am.ActivityManagerService.onTransact(ActivityManagerService.java:2886)
  at android.os.Binder.execTransact(Binder.java:565)
```
system_server进程的主线程，被线程Binder:1930_5所blocke的；而线程Binder:1930_5被monkey进程blocked，接下来看看monkey多进程。

#### 1.2  com.android.commands.monkey进程

```Java
"Binder:17922_1" prio=5 tid=8 Blocked
  | group="main" sCount=1 dsCount=0 obj=0x12c69940 self=0x7f97e12400
  | sysTid=17961 nice=-2 cgrp=default sched=0/0 handle=0x7f96286450
  | state=S schedstat=( 0 0 0 ) utm=0 stm=0 core=4 HZ=100
  | stack=0x7f9618c000-0x7f9618e000 stackSize=1005KB
  | held mutexes=
  at com.android.commands.monkey.Monkey$ActivityController.appCrashed(Monkey.java:306)
  - waiting to lock <0x0b9d2b64> (a com.android.commands.monkey.Monkey) held by thread 1
  at android.app.IActivityController$Stub.onTransact(IActivityController.java:92)
  at android.os.Binder.execTransact(Binder.java:565)
```

```Java
"main" prio=5 tid=1 Native
  | group="main" sCount=1 dsCount=0 obj=0x12c070d0 self=0x7fa2a96a00
  | sysTid=17922 nice=0 cgrp=default sched=0/0 handle=0x7fa6ebda98
  | state=S schedstat=( 0 0 0 ) utm=34 stm=8 core=1 HZ=100
  | stack=0x7fe05bf000-0x7fe05c1000 stackSize=8MB
  | held mutexes=
  kernel: __switch_to+0x88/0x94
  kernel: pipe_wait+0x68/0x8c
  kernel: pipe_read+0x1cc/0x240
  kernel: __vfs_read+0xa0/0xc8
  kernel: vfs_read+0x84/0xfc
  kernel: SyS_read+0x48/0x84
  kernel: el0_svc_naked+0x24/0x28
  native: #00 pc 0000000000078d6c  /system/lib64/libc.so (read+4)
  native: #01 pc 000000000002e724  /system/lib64/libjavacore.so (???)
  native: #02 pc 00000000006dd668  /data/dalvik-cache/arm64/system@framework@boot.oat (Java_libcore_io_Posix_readBytes__Ljava_io_FileDescriptor_2Ljava_lang_Object_2II+196)
  at libcore.io.Posix.readBytes(Native method)
  at libcore.io.Posix.read(Posix.java:169)
  at libcore.io.BlockGuardOs.read(BlockGuardOs.java:231)
  at libcore.io.IoBridge.read(IoBridge.java:471)
  at java.io.FileInputStream.read(FileInputStream.java:252)
  at java.io.BufferedInputStream.read1(BufferedInputStream.java:273)
  at java.io.BufferedInputStream.read(BufferedInputStream.java:334)
  - locked <0x00b50a82> (a java.lang.UNIXProcess$ProcessPipeInputStream)
  at sun.nio.cs.StreamDecoder.readBytes(StreamDecoder.java:287)
  at sun.nio.cs.StreamDecoder.implRead(StreamDecoder.java:350)
  at sun.nio.cs.StreamDecoder.read(StreamDecoder.java:179)
  - locked <0x08d54593> (a java.io.InputStreamReader)
  at java.io.InputStreamReader.read(InputStreamReader.java:184)
  at java.io.BufferedReader.fill(BufferedReader.java:172)
  at java.io.BufferedReader.readLine(BufferedReader.java:335)
  - locked <0x08d54593> (a java.io.InputStreamReader)
  at java.io.BufferedReader.readLine(BufferedReader.java:400)
  at com.android.commands.monkey.Monkey.commandLineReport(Monkey.java:434)
  at com.android.commands.monkey.Monkey.getBugreport(Monkey.java:473)
  at com.android.commands.monkey.Monkey.runMonkeyCycles(Monkey.java:1059)
  - locked <0x0b9d2b64> (a com.android.commands.monkey.Monkey)
  at com.android.commands.monkey.Monkey.run(Monkey.java:622)
  at com.android.commands.monkey.Monkey.main(Monkey.java:485)
  at com.android.internal.os.RuntimeInit.nativeFinishInit(Native method)
  at com.android.internal.os.RuntimeInit.main(RuntimeInit.java:319)
```

monkey进程的Binder:17922_1线程被其主线程所blocked，而monkey主线程在执行Monkey.getBugreport()过程会fork子进程bugreport, 然后等待bugreport返回结果, 阻塞在read()方法。


 以下是另外一次复现相同现象时, 不同时间段抓取的monkey进程的主线程traces情况. 可以看出monkey主线程的utm和stm时间在走动，从而说明monkey的主线程执行read过程并非直接卡死, 其实还是会不断在执行的, 只是执行比较慢或者任务比较重。

```Java
----- pid 7639 at 2017-07-11 17:55:33 -----
"main" prio=5 tid=1 Native
  | group="main" sCount=1 dsCount=0 obj=0x12c060d0 self=0x7f7c096a00
  | sysTid=7639 nice=0 cgrp=default sched=0/0 handle=0x7f7ff7baa0
  | state=S schedstat=( 5256393495 2540341243 10726 ) utm=422 stm=103 core=0 HZ=100
  | stack=0x7fc2620000-0x7fc2622000 stackSize=8MB
```

```Java
----- pid 7639 at 2017-07-11 18:03:15 -----
"main" prio=5 tid=1 Native
  | group="main" sCount=1 dsCount=0 obj=0x12c060d0 self=0x7f7c096a00
  | sysTid=7639 nice=0 cgrp=default sched=0/0 handle=0x7f7ff7baa0
  | state=S schedstat=( 5299648863 2546711245 10774 ) utm=426 stm=103 core=1 HZ=100
  | stack=0x7fc2620000-0x7fc2622000 stackSize=8MB
  | held mutexes=
```

```Java
----- pid 7639 at 2017-07-11 18:19:17 -----
"main" prio=5 tid=1 Native
  | group="main" sCount=1 dsCount=0 obj=0x12c060d0 self=0x7f7c096a00
  | sysTid=7639 nice=0 cgrp=default sched=0/0 handle=0x7f7ff7baa0
  | state=S schedstat=( 5390166370 2558167129 10873 ) utm=433 stm=106 core=0 HZ=100
```

再来看看bugreport进程到底在做什么？

#### 1.3 bugreport进程

```Java
shell     18013 17922 8068   1288  unix_strea 7fa8814d70 S bugreport
 
"bugreport" sysTid=18013
  #00 pc 0000000000078d70  /system/lib64/libc.so (read+8)
  #01 pc 0000000000001178  /system/bin/bugreport
  #02 pc 000000000001a788  /system/lib64/libc.so (__libc_init+88)
  #03 pc 0000000000000ca8  /system/bin/bugreport
 
sagit:/data/anr # cat /proc/18013/stack
[<0000000000000000>] __switch_to+0x88/0x94
[<0000000000000000>] unix_stream_read_generic+0x24c/0x730
[<0000000000000000>] unix_stream_recvmsg+0x34/0x3c
[<0000000000000000>] sock_recvmsg+0x44/0x54
[<0000000000000000>] sock_read_iter+0x7c/0xa4
[<0000000000000000>] __vfs_read+0xa0/0xc8
[<0000000000000000>] vfs_read+0x84/0xfc
[<0000000000000000>] SyS_read+0x48/0x84
[<0000000000000000>] el0_svc_naked+0x24/0x28
[<0000000000000000>] 0xffffffffffffffff
```

bugreport进程通过设置property, 触发init创建dumpstate进程, 然后等待dumpstate返回结果。 接下里再来看看dumpstate进程在干什么？

#### 1.4 system/bin/dumpstate进程

查看dumpstate进程的traces:

```Java
#00 pc 000000000006a848  /system/lib64/libc.so (__rt_sigtimedwait+8)
#01 pc 0000000000024d64  /system/lib64/libc.so (sigtimedwait+48)
 #02 pc 00000000000184a4  /system/bin/dumpstate
 #03 pc 00000000000187c4  /system/bin/dumpstate
 #04 pc 00000000000179b0  /system/bin/dumpstate
 #05 pc 00000000000177f0  /system/bin/dumpstate
 #06 pc 0000000000016e28  /system/bin/dumpstate
 #07 pc 0000000000006388  /system/bin/dumpstate
 #08 pc 000000000001a794  /system/lib64/libc.so (__libc_init+88)
 #09 pc 00000000000042bc  /system/bin/dumpstate
```

通过addr2line的转换后获取其对应代码行号，如下：

```Java
/proc/self/cwd/frameworks/native/cmds/dumpstate/dumpstate.cpp:777
__for_each_pid(void (*)(int, char const*, void*), char const*, void*)
/proc/self/cwd/frameworks/native/cmds/dumpstate/utils.cpp:164
do_showmap
/proc/self/cwd/frameworks/native/cmds/dumpstate/utils.cpp:404
run_command
/proc/self/cwd/frameworks/native/cmds/dumpstate/utils.cpp:661 (discriminator 1)
run_command_always
/proc/self/cwd/frameworks/native/cmds/dumpstate/utils.cpp:726
waitpid_with_timeout(int, int, int*)
/proc/self/cwd/frameworks/native/cmds/dumpstate/utils.cpp:599
```

可知dumpstate进程卡在frameworks/native/cmds/dumpstate/utils.cpp#605，也就是waitpid_with_timeout()的sigtimedwait过程，是在等待子进程su的完成, 每次等待10s的timeout超时. 整个操作又包裹在 __for_each_pid()的大循环里面.
这一块执行su操作, 可能有异常,一直都处于timeout, 如果有N个进程,那么就是等待10*N的时间，也是非常长的耗时.


#### 1.5 再次复现

基本定位在dumpstate过程的su存在异常，通过增加log再次复现，从而得以验证的确是每次的su都是通过timeout完成, 从而导致手机冻屏.

```Java
07-13 10:55:52.222  9342  9342 I dumpstate_utils: waitpid_with_time-TEMP_FAILURE_RETRY pid = 9575 and difftime is  : 20.000000
07-13 10:55:52.222  9342  9342 E dumpstate: command '/system/xbin/su root procrank' timed out after 20.008s (killing pid 9575)
07-13 10:56:02.762  9342  9342 I dumpstate_utils: waitpid_with_time-TEMP_FAILURE_RETRY pid = 9603 and difftime is  : 10.000000
07-13 10:56:02.762  9342  9342 E dumpstate: command '/system/xbin/su root librank' timed out after 10.007s (killing pid 9603)
07-13 10:56:12.854  9342  9342 I dumpstate_utils: waitpid_with_time-TEMP_FAILURE_RETRY pid = 9616 and difftime is  : 10.000000
...
```

到此，以上整个hang机等待链条:  **system_server --> monkey --> bugreport --> dumpstate** 。

接下来, 再来看看dumpstate是如何被/system/xbin/su blocked的. 过程如下:

## 二. dumpstate过程分析

#### 2.1 dumpstate
[ → dumpstate/dumpstate.cpp]

![dumpstate](/images/monkey_hang/dumpstate_1.png)

执行do_showmap过程, 导致系统hang住

#### 2.2 for_each_pid
[ → dumpstate/utils.cpp]

```Java
void for_each_pid(for_each_pid_func func, const char *header) {
    ON_DRY_RUN_RETURN();
  __for_each_pid(for_each_pid_helper, header, (void *)func);
}
```

其中  func指向do_showmap, header为"SMAPS OF ALL PROCESSES"

#### 2.3  __for_each_pid

![for_each_pid_2](/images/monkey_hang/for_each_pid_2.png)

说明:

- 方法名helper指向for_each_pid_helper
- 参数pid为进程pid;
- 参数cmdline为节点/proc/[pid]/cmdline的内容, 即进程名; 如果没有cmdline, 则采用/proc/[pid]/comm节点内容;
- 参数arg为前面传递过来的func, 此处为do_showmap

```Java
static void for_each_pid_helper(int pid, const char *cmdline, void *arg) {
    for_each_pid_func *func = (for_each_pid_func*) arg;
    func(pid, cmdline);
}
```

可见, 接下来调用的便是do_showmap(pid, cmdline)

#### 2.4 do_showmap

![do_showmap_3](/images/monkey_hang/do_showmap_3.png)

#### 2.5 run_command

![run_command_4](/images/monkey_hang/run_command_4.png)

说明：

- title等于 "SHOW MAP %d (%s)"
- timeout_seconds = 10s;
- args为 SU_PATH, "root", "showmap", "-q", pid，组合起来就是: /system/xbin/su root showmap -q [pid]

#### 2.6 run_command_always

```Java
int run_command_always(const char *title, RootMode root_mode, StdoutMode stdout_mode,
        int timeout_seconds, const char *args[]) {
    bool silent = (stdout_mode == REDIRECT_TO_STDERR); // silent= false
    int weight = timeout_seconds;
 
    const char *command = args[0];
    uint64_t start = DurationReporter::nanotime();
    pid_t pid = fork();  //创建子进程, 用于执行命令
 
    /* handle error case */
    if (pid < 0) {
        if (!silent) printf("*** fork: %s\n", strerror(errno));
        MYLOGE("*** fork: %s\n", strerror(errno));
        return pid;
    }
 
    /* handle child case */
    if (pid == 0) {
        if (root_mode == DROP_ROOT && !drop_root_user()) {  //此处不满足条件
        if (!silent) printf("*** fail todrop root before running %s: %s\n", command,
                strerror(errno));
            MYLOGE("*** could not drop root before running %s: %s\n", command, strerror(errno));
            return -1;
        }
 
        if (silent) {
            // Redirect stderr to stdout
            dup2(STDERR_FILENO, STDOUT_FILENO);
        }
 
        /* make sure the child dies when dumpstate dies */
        prctl(PR_SET_PDEATHSIG, SIGKILL);
 
        /* just ignore SIGPIPE, will go down with parent's */
        struct sigaction sigact;
        memset(&sigact, 0, sizeof(sigact));
        sigact.sa_handler = SIG_IGN;
        sigaction(SIGPIPE, &sigact, NULL);
 
        execvp(command, (char**) args);   //子进程执行前面的命令
        MYLOGD("execvp on command '%s' failed (error: %s)", command, strerror(errno)); 
        fflush(stdout);
        _exit(EXIT_FAILURE);
    }
 
    /* handle parent case */
    int status;
    bool ret = waitpid_with_timeout(pid, timeout_seconds, &status);   // 父进程停止这里等待子进程结束
    uint64_t elapsed = DurationReporter::nanotime() - start;
    std::string cmd; // used to log command and its args
    if (!ret) {
        if (errno == ETIMEDOUT) {
            format_args(command, args, &cmd);
            if (!silent) printf("*** command '%s' timed out after %.3fs (killing pid %d)\n",
            cmd.c_str(), (float) elapsed / NANOS_PER_SEC, pid);
            MYLOGE("command '%s' timed out after %.3fs (killing pid %d)\n", cmd.c_str(), 
                   (float) elapsed / NANOS_PER_SEC, pid);
        } else {
            format_args(command, args, &cmd);
            if (!silent) printf("*** command '%s': Error after %.4fs (killing pid %d)\n",
            cmd.c_str(), (float) elapsed / NANOS_PER_SEC, pid);
            MYLOGE("command '%s': Error after %.4fs (killing pid %d)\n", cmd.c_str(),
                   (float) elapsed / NANOS_PER_SEC, pid);
        }
        kill(pid, SIGTERM);
        if (!waitpid_with_timeout(pid, 5, NULL)) {
            kill(pid, SIGKILL);
            if (!waitpid_with_timeout(pid, 5, NULL)) {
                if (!silent) printf("could not kill command '%s' (pid %d) even with SIGKILL.\n",
                        command, pid);
                MYLOGE("could not kill command '%s' (pid %d) even with SIGKILL.\n", command, pid);
            }
        }
        return -1;
    } else if (status) {
        format_args(command, args, &cmd);
        if (!silent) printf("*** command '%s' failed: %s\n", cmd.c_str(), strerror(errno));
        MYLOGE("command '%s' failed: %s\n", cmd.c_str(), strerror(errno));
        return -2;
    }
 
    if (WIFSIGNALED(status)) {
        if (!silent) printf("*** %s: Killed by signal %d\n", command, WTERMSIG(status));
        MYLOGE("*** %s: Killed by signal %d\n", command, WTERMSIG(status));
    } else if (WIFEXITED(status) && WEXITSTATUS(status) > 0) {
        if (!silent) printf("*** %s: Exit code %d\n", command, WEXITSTATUS(status));
        MYLOGE("*** %s: Exit code %d\n", command, WEXITSTATUS(status));
    }
 
    if (weight > 0) {
        update_progress(weight);
    }
    return status;
}
```

该方法主要功能:

- 调用fork创建子进程;
- 子进程(su进程)执行execvp(command, (char**) args);   此处便是/system/xbin/su root showmap -q [pid];
- 父进程(dumpstate进程)执行waitpid_with_timeout(), 等待子进程结束, 其中timeout=10s;也就是父进程最长等待10s, 子进程还没有结束, 则执行结束;
    - 当waitpid_with_timeout方法返回值不为0(比如发生timeout), 则执行kill命令, 杀掉目标进程.

#### 2.7 waitpid

![waitpid_5](/images/monkey_hang/waitpid_5.png)

等待子进程执行结束，再来看看su过程

## 三、su过程

#### 3.1 send_request

为何 /system/xbin/su root showmap -q [pid] 这条命令会如此耗时呢? 是不是直接卡死了? 
最终发现这是安全中心的root机制有关，每次su进程在鉴权时需要向ams请求provider来鉴权, 这个过程需要持有ams同步锁。

![su_](/images/monkey_hang/su_.png)


#### 3.2 openContentUrl

通过binder调用进入system_server进程

![content_provider_5](/images/monkey_hang/content_provider_5.png)

getContentProviderExternalUnchecked()的过程代码如下：

```Java
private ContentProviderHolder getContentProviderExternalUnchecked(String name,
    IBinder token, int userId) {
    return getContentProviderImpl(null, name, token, true, userId);
}
```

#### 3.3 getContentProviderImpl

![get_content_impl_6](/images/monkey_hang/get_content_impl_6.png)


为了进一步验证, 查看了一下system_server的调用栈, 有大量的binder线程的调用栈是如下的: 

```Java
"Binder:1600_A" prio=5 tid=108 Blocked
  | group="main" sCount=1 dsCount=0 obj=0x135aba60 self=0x7f7718e400
  | sysTid=2663 nice=0 cgrp=default sched=0/0 handle=0x7f60563450
  | state=S schedstat=( 2475142473 1244835003 2089 ) utm=131 stm=116 core=2 HZ=100
  | stack=0x7f60469000-0x7f6046b000 stackSize=1005KB
  | held mutexes=
  at com.android.server.am.ActivityManagerService.getContentProviderImpl(ActivityManagerService.java:11011)
  - waiting to lock <0x0c45d723> (a com.android.server.am.ActivityManagerService) held by thread 94
  at com.android.server.am.ActivityManagerService.getContentProviderExternalUnchecked(ActivityManagerService.java:11493)
  at com.android.server.am.ActivityManagerService.openContentUri(ActivityManagerService.java:12037)
  at android.app.ActivityManagerNative.onTransact(ActivityManagerNative.java:1524)
  at com.android.server.am.ActivityManagerService.onTransact(ActivityManagerService.java:2884)
  at android.os.Binder.execTransact(Binder.java:565)
```

#### 3.4  su进程创建
执行一次 /system/xbin/su root showmap -q [pid] 命令,  会创建5个su进程, 

```C
shell     8949  1     10092  2060  do_sigtime 7f8a8b96e0 S /system/bin/dumpstate
root      10651 8949  9120   1792     do_wait 7f9d5f6610 S /system/xbin/su
root      10652 10651 11420  876   unix_strea 7f9d5f6040 S /system/xbin/su
root      10654 1     9120   180      do_wait 7fb2cfe610 S /system/xbin/su
root      10657 10654 9120   200      do_wait 7fb2cfe610 S /system/xbin/su
u0_a1     10658 10657 10392  624   binder_thr 7fb2cfd5f0 S /system/xbin/su
```

每次调用su命令会创建5个进程, 当发生timeout ,则会杀掉dumpstate子进程(10651), 同时10652成为孤儿进程, 托孤给init进程. 
也就是说每次会新增4个su进程，这就是为什么异常情况下, su进程越来越多，最终导致冻屏。

#### 3.5 总结

调用链如下: for_each_pid → __for_each_pid → do_showmap → run_command → run_command_always

问题根源: dumpstate进程, 遍历系统所有的进程, 每次run_command_always过程都是通过timeout结束, 而非正常完成,

假设当前系统有10000个进程, 那么抓bugreport的等待时间至少是10000 * 10s = 100000s, 一天只有3600*24s= 86400s, 也就是说这个冻屏问题, 大概1天多点也能恢复。如果系统当前进程少的话, 那么可能几个小时就能恢复.  

这就解释了为什么有些冻屏问题, 放一天半天的, 居然能恢复的道理.  常规的冻屏, 往往是发生死锁, 再长的时间等待也无法恢复, 除非是死锁的某一段进程被杀。这也解释了为什么经常性出现冻屏的bug现场, 却无法抓取bugreport的原因.

目前su每次会创建大量的进程, 之前进过一个修复, 是防止遍历循环过程, su进程自己去showmap新创建的su进程, 导致for循环要执行的进程个数不断地增加, 甚至系统经常性出现几千个su进程。

最终的解决方案是改善这套过旧的su实现方案，跑monkey的冻屏问题就不再复现。
