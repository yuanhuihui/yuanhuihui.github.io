---
layout: post
title:  "Android存储系统之架构篇"
date:   2016-07-23 22:59:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0的源码，剖析存储架构的设计

## 一、概述

本文讲述Android存储系统的架构与设计，涉及到最为核心的便是MountService和Vold这两个模块以及之间的交互。上一篇文章[Android存储系统之源码篇](http://gityuan.com/2016/07/17/android-io/)从源码角度介绍相关模块的创建与启动过程，那么本文主要从全局角度把握和剖析Android的存储系统。

**MountService**：Android Binder服务端，运行在system_server进程，用于跟Vold进行消息通信，比如`MountService`向`Vold`发送挂载SD卡的命令,或者接收到来自`Vold`的外设热插拔事件。MountService作为Binder服务端，那么相应的Binder客户端便是StorageManager，通过binder IPC与MountService交互。

**Vold**：全称为Volume Daemon，用于管理外部存储设备的Native daemon进程，这是一个非常重要的守护进程，主要由NetlinkManager，VolumeManager，CommandListener这3部分组成。

### 1.1 模块架构

从模块地角度划分Android整个存储架构：

![arch-vold-mount](/images/io/arch-vold-mount.jpg)

图解：

- **Linux Kernel**：通过`uevent`向Vold的NetlinkManager发送Uevent事件；
- **NetlinkManager**：接收来自Kernel的`Uevent`事件，再转发给VolumeManager；
- **VolumeManager**：接收来自NetlinkManager的事件，再转发给CommandListener进行处理；
- **CommandListener**：接收来自VolumeManager的事件，通过`socket`通信方式发送给MountService；
- **MountService**：接收来自CommandListener的事件。

### 1.2 进程架构

(1)先看看Java framework层的线程：

    root@gityuan:/ # ps -t | grep 1212
    system    1212  557   2334024 160340 SyS_epoll_ 7faedddbe4 S system_server
    system    2662  1212  2334024 160340 SyS_epoll_ 7faedddbe4 S MountService
    system    2663  1212  2334024 160340 unix_strea 7faedde73c S VoldConnector
    system    2664  1212  2334024 160340 unix_strea 7faedde73c S CryptdConnector
    ...

MountService运行在system_server进程，这里查询的便是system_server进程的所有子线程，system_server进程承载整个framework所有核心服务，子线程数有很多，这里只列举与MountService模块相关的子线程。

(2)再看看Native层的线程：

    root@gityuan:/ # ps -t | grep " 387 "
    USER      PID   PPID  VSIZE  RSS   WCHAN              PC  NAME
    root      387   1     13572  2912  hrtimer_na 7fa34755d4 S /system/bin/vold
    root      397   387   13572  2912  poll_sched 7fa3474d1c S vold
    root      399   387   13572  2912  poll_sched 7fa3474d1c S vold
    root      400   387   13572  2912  poll_sched 7fa3474d1c S vold
    media_rw  2702  387   7140   2036  inotify_re 7f84b1d6ac S /system/bin/sdcard

Vold作为native守护进程，进程名为"/system/bin/vold"，pid=387，通过`ps -t`可查询到该进程下所有的子进程/线程。

**小技巧：**有读者可能会好奇，为什么`/system/bin/sdcard`是子进程，而非子线程呢？要回答这个问题，有两个方法，其一就是直接看撸源码，会发现这是通过`fork`方式创建的，而其他子线程都是通过`pthread_create`方式创建的。当然其实还有个更快捷的小技巧，就是直接看上图中的第4列，这一列的含义是`VSIZE`，代表的是进程虚拟地址空间大小，是否共享地址空间，这是进程与线程最大的区别，再来看看/sdcard的VSIZE大小跟父进程不一样，基本可以确实/sdcard是子进程。

(3) 从进程/线程视角来看Android存储架构:

![arch-io-process](/images/io/arch-io-process.jpg)

- Java层：采用 `1个主线程`(system_server) + `3个子线程`(VoldConnector, MountService, CryptdConnector)；
- Native层：采用 `1个主线程`(/system/bin/vold) + `3个子线程`(vold) + `1子进程`(/system/bin/sdcard)；

注：图中红色字代表的进程/线程名，vold进程通过pthread_create的方式创建的3个子线程名都为vold，图中只是为了便于区别才标注为vold1, vold2, vold3，其实名称都为vold。

Android还可划分为内核空间(Kernel Space)和用户空间(User space)，从上图可看出，Android存储系统在User space总共采用9个进程/线程的架构模型。当然，除了这9个进/线程,另外还会在handler消息处理过程中使用到system_server的两个子线程:`android.fg`和`android.io`。

Tips: 同一个模块可以运行在各个不同的进程/线程， 同一个进程可以运行不同模块的代码,所以从进程角度和模块角度划分看到的有所不同的.


### 1.3 类关系图

![vold](/images/io/vold.jpg)

![volume](/images/io/volume.jpg)

上图中4个蓝色块便是前面谈到的核心模块。

## 二、 通信架构

Android存储系统中涉及各个进程间通信，这个架构采用的socket，并没有采用Android binder IPC机制。这样的架构代码大量更少，整体架构逻辑也相对简单，在介绍通信过程前，先来看看MountService对象的实例化过程，那么也就基本明白进程架构中system_sever进程为了MountService服务而单独创建与共享使用到线程情况。

    public MountService(Context context) {
        sSelf = this;

        mContext = context;
        //FgThread线程名为“"android.fg"，创建IMountServiceListener回调方法
        mCallbacks = new Callbacks(FgThread.get().getLooper());
        //获取PKMS的Client端对象
        mPms = (PackageManagerService) ServiceManager.getService("package");
        //创建“MountService”线程
        HandlerThread hthread = new HandlerThread(TAG);
        hthread.start();

        mHandler = new MountServiceHandler(hthread.getLooper());
        //IoThread线程名为"android.io"，创建OBB操作的handler
        mObbActionHandler = new ObbActionHandler(IoThread.get().getLooper());

        File dataDir = Environment.getDataDirectory();
        File systemDir = new File(dataDir, "system");
        mLastMaintenanceFile = new File(systemDir, LAST_FSTRIM_FILE);
        //判断/data/system/last-fstrim文件，不存在则创建，存在则更新最后修改时间
        if (!mLastMaintenanceFile.exists()) {
            (new FileOutputStream(mLastMaintenanceFile)).close();
            ...
        } else {
            mLastMaintenance = mLastMaintenanceFile.lastModified();
        }
        ...
        //将MountServiceInternalImpl登记到sLocalServiceObjects
        LocalServices.addService(MountServiceInternal.class, mMountServiceInternal);
        //创建用于VoldConnector的NDC对象
        mConnector = new NativeDaemonConnector(this, "vold", MAX_CONTAINERS * 2, VOLD_TAG, 25,
                null);
        mConnector.setDebug(true);
        //创建线程名为"VoldConnector"的线程，用于跟vold通信
        Thread thread = new Thread(mConnector, VOLD_TAG);
        thread.start();

        //创建用于CryptdConnector工作的NDC对象
        mCryptConnector = new NativeDaemonConnector(this, "cryptd",
                MAX_CONTAINERS * 2, CRYPTD_TAG, 25, null);
        mCryptConnector.setDebug(true);
        //创建线程名为"CryptdConnector"的线程，用于加密
        Thread crypt_thread = new Thread(mCryptConnector, CRYPTD_TAG);
        crypt_thread.start();

        //注册监听用户添加、删除的广播
        final IntentFilter userFilter = new IntentFilter();
        userFilter.addAction(Intent.ACTION_USER_ADDED);
        userFilter.addAction(Intent.ACTION_USER_REMOVED);
        mContext.registerReceiver(mUserReceiver, userFilter, null, mHandler);

        //内部私有volume的路径为/data，该volume通过dumpsys mount是不会显示的
        addInternalVolume();

        //默认为false
        if (WATCHDOG_ENABLE) {
            Watchdog.getInstance().addMonitor(this);
        }
    }

其主要功能依次是：

1. 创建ICallbacks回调方法,FgThread线程名为"android.fg"，此处用到的Looper便是线程"android.fg"中的Looper;
2. 创建并启动线程名为"MountService"的handlerThread；
3. 创建OBB操作的handler,IoThread线程名为"android.io"，此处用到的的Looper便是线程"android.io"中的Looper;
4. 创建NativeDaemonConnector对象
5. 创建并启动线程名为"VoldConnector"的线程；
6. 创建并启动线程名为"CryptdConnector"的线程；
7. 注册监听用户添加、删除的广播；

从这里便可知道共创建了3个线程：`MountService`,`VoldConnector`,`CryptdConnector`，另外还会使用到系统进程中的两个线程`android.fg`和`android.io`. 这便是在文章开头进程架构图中Java framework层进程的创建情况.

接下来，我们分别从MountService向vold发送消息和接收消息两个方面，以及Kernel向vold上报事件3个方面展开。

### 2.1 MountService发送消息

system_server进程与vold守护进程间采用socket进行通信，这个通信过程是由MountService线程向vold线程发送消息。这里以执行mount调用为例：

#### 2.1.1 MS.mount

    class MountService extends IMountService.Stub
            implements INativeDaemonConnectorCallbacks, Watchdog.Monitor {

        public void mount(String volId) {
            ...
            try {
                //【见小节2.1.2】
                mConnector.execute("volume", "mount", vol.id, vol.mountFlags, vol.mountUserId);
            } catch (NativeDaemonConnectorException e) {
                throw e.rethrowAsParcelableException();
            }
        }
    }

#### 2.1.2 NDC.execute

[-> NativeDaemonConnector.java]

    public NativeDaemonEvent execute(String cmd, Object... args)
        throws NativeDaemonConnectorException {
        return execute(DEFAULT_TIMEOUT, cmd, args);
    }

其中`DEFAULT_TIMEOUT=1min`，即命令执行超时时长为1分钟。经过层层调用到executeForList()

    public NativeDaemonEvent[] executeForList(long timeoutMs, String cmd, Object... args)
            throws NativeDaemonConnectorException {
        final long startTime = SystemClock.elapsedRealtime();

        final ArrayList<NativeDaemonEvent> events = Lists.newArrayList();

        final StringBuilder rawBuilder = new StringBuilder();
        final StringBuilder logBuilder = new StringBuilder();

        //mSequenceNumber初始化值为0，每执行一次该方法则进行加1操作
        final int sequenceNumber = mSequenceNumber.incrementAndGet();

        makeCommand(rawBuilder, logBuilder, sequenceNumber, cmd, args);

        //例如：“3 volume reset”
        final String rawCmd = rawBuilder.toString();
        final String logCmd = logBuilder.toString();

        log("SND -> {" + logCmd + "}");

        synchronized (mDaemonLock) {
            //将cmd写入到socket的输出流
            mOutputStream.write(rawCmd.getBytes(StandardCharsets.UTF_8));
            ...
        }

        NativeDaemonEvent event = null;
        do {
            //阻塞等待，直到收到相应指令的响应码
            event = mResponseQueue.remove(sequenceNumber, timeoutMs, logCmd);
            events.add(event);
        //当收到的事件响应码属于[100,200)区间，则继续等待后续事件上报
        } while (event.isClassContinue());

        final long endTime = SystemClock.elapsedRealtime();
        //对于执行时间超过500ms则会记录到log
        if (endTime - startTime > WARN_EXECUTE_DELAY_MS) {
            loge("NDC Command {" + logCmd + "} took too long (" + (endTime - startTime) + "ms)");
        }
        ...
        return events.toArray(new NativeDaemonEvent[events.size()]);
    }

- 首先，将带执行的命令mSequenceNumber执行加1操作；
- 再将cmd(例如`3 volume reset`)写入到socket的输出流；
- 通过循环与poll机制阻塞等待底层响应该操作完成的结果；
- 有两个情况会跳出循环：
    - 当超过1分钟未收到vold相应事件的响应码，则跳出阻塞等待；
    - 当收到底层的响应码，且响应码不属于[100,200)区间，则跳出循环。
- 对于执行时间超过500ms的时间，则额外输出以`NDC Command`开头的log信息，提示可能存在优化之处。

#### 2.1.3 FL.onDataAvailable

MountService线程通过socket发送cmd事件给vold，对于vold守护进程在启动的过程，初始化CommandListener时通过`pthread_create`创建子线程vold来专门监听MountService发送过来的消息，当该线程接收到socket消息时，便会调用onDataAvailable()方法

[-> FrameworkListener.cpp]

    bool FrameworkListener::onDataAvailable(SocketClient *c) {
        char buffer[CMD_BUF_SIZE];
        int len;
        // 多次尝试从socket管道读取数据
        len = TEMP_FAILURE_RETRY(read(c->getSocket(), buffer, sizeof(buffer)));
        ...

        for (i = 0; i < len; i++) {
            if (buffer[i] == '\0') {
                //分发该命令【见小节2.1.4】
                dispatchCommand(c, buffer + offset);
                ...
            }
        }
        return true;
    }

#### 2.1.4 FL.dispatchCommand

[-> FrameworkListener.cpp]

    void FrameworkListener::dispatchCommand(SocketClient *cli, char *data) {
        ...
        for (i = mCommands->begin(); i != mCommands->end(); ++i) {
            FrameworkCommand *c = *i;

            if (!strcmp(argv[0], c->getCommand())) {
                //找到相应的类处理该命令
                if (c->runCommand(cli, argc, argv)) {
                    SLOGW("Handler '%s' error (%s)", c->getCommand(), strerror(errno));
                }
                goto out;
            }
        }
        ...
    }

这是用于分发从MountService发送过来的命令，针对不同的命令调用不同的类，总共有以下6类：

- DumpCmd
- VolumeCmd
- AsecCmd
- ObbCmd
- StorageCmd
- FstrimCmd

另外，在处理过程中遇到下面情况，则会直接发送响应吗500的应答消息给MountService

- 当无法找到匹配的类，则会直接向MountService返回响应码500，内容"Command not recognized"的应答消息；
- 命令参数过长导致socket管道溢出，则会发送响应码500，内容"Command too long"的应答消息。


#### 2.1.5 CL.runCommand

例如前面发送过来的是`volume mount`，则会调用到CommandListener的内部类VolumeCmd的runCommand来处理该消息，并进入mount分支。

    int CommandListener::VolumeCmd::runCommand(SocketClient *cli,
                                               int argc, char **argv) {
        VolumeManager *vm = VolumeManager::Instance();
        std::lock_guard<std::mutex> lock(vm->getLock());
        ...
        std::string cmd(argv[1]);
        if (cmd == "reset") {
               return sendGenericOkFail(cli, vm->reset());
        }else if (cmd == "mount" && argc > 2) {
            // mount [volId] [flags] [user]
            std::string id(argv[2]);
            auto vol = vm->findVolume(id);
            if (vol == nullptr) {
                return cli->sendMsg(ResponseCode::CommandSyntaxError, "Unknown volume", false);
            }

            int mountFlags = (argc > 3) ? atoi(argv[3]) : 0;
            userid_t mountUserId = (argc > 4) ? atoi(argv[4]) : -1;

            vol->setMountFlags(mountFlags);
            vol->setMountUserId(mountUserId);
            //真正的挂载操作【见2.1.6】
            int res = vol->mount();
            if (mountFlags & android::vold::VolumeBase::MountFlags::kPrimary) {
                vm->setPrimary(vol);
            }
            //发送应答消息给MountService【见2.2.1】
            return sendGenericOkFail(cli, res);
        }
        // 省略其他的else if
        ...
    }

#### 2.1.6 mount

这里便进入了VolumeManager模块，执行volume设备真正的挂载操作。对于挂载内置存储和外置存储流程是有所不同的，这里就不再细说，简单的调用流程：

    VolumeCmd.runCommand
        VolumeBase.mount
            EmulatedVolume.doMount(内置)
            PublicVolume.doMount(外置)
                vfat::Check
                vfat::Mount
                fork (/sdcard)

#### 2.1.7 小节

![mountservice_socket](/images/io/mountservice_socket.jpg)

MountService向vold发送消息后，便阻塞在图中的MountService线程的NDC.execute()方法，那么何时才会退出呢？图的后半段MonutService接收消息的过程会有答案，那便是在收到消息，并且消息的响应吗不属于区间[600,700)则添加事件到ResponseQueue，从而唤醒阻塞的MountService继续执行。关于上图的后半段介绍的便是MountService接收消息的流程。

### 2.2 MountService接收消息

当Vold在处理完完MountService发送过来的消息后，会通过sendGenericOkFail发送应答消息给上层的MountService。

#### 2.2.1 响应码

[-> CommandListener.cpp]

    int CommandListener::sendGenericOkFail(SocketClient *cli, int cond) {
        if (!cond) {
            //【见小节2.2.2】
            return cli->sendMsg(ResponseCode::CommandOkay, "Command succeeded", false);
        } else {
            return cli->sendMsg(ResponseCode::OperationFailed, "Command failed", false);
        }
    }

- 当执行成功，则发送响应码为500的成功应答消息；
- 当执行失败，则发送响应码为400的失败应答消息。

不同的响应码(VoldResponseCode)，代表着系统不同的处理结果，主要分为下面几大类：

|响应码|事件类别|对应方法
|---|---|---|
|[100, 200)|部分响应，随后继续产生事件|isClassContinue
|[200, 300)|成功响应|isClassOk
|[400, 500)|远程服务端错误|isClassServerError
|[500, 600)|本地客户端错误|isClassClientError
|[600, 700)|远程Vold进程自触发的事件|isClassUnsolicited

例如当操作执行成功，VoldConnector线程能收到类似`RCV <- {200 3 Command succeeded}的响应事件。

其中对于[600,700)响应码是由Vold进程"不请自来"的事件，主要是针对disk，volume的一系列操作，比如设备创建，状态、路径改变，以及文件类型、uid、标签改变等事件都是底层直接触发。

|命令|响应吗|
|---|---|---|
|DISK_CREATED|640|
|DISK_SIZE_CHANGED|641|
|DISK_LABEL_CHANGED|642|
|DISK_SCANNED|643|
|DISK_SYS_PATH_CHANGED|644|
|DISK_DESTROYED|649|
|VOLUME_CREATED|650|
|VOLUME_STATE_CHANGED|651|
|VOLUME_FS_TYPE_CHANGED|652|
|VOLUME_FS_UUID_CHANGED|653|
|VOLUME_FS_LABEL_CHANGED|654|
|VOLUME_PATH_CHANGED|655|
|VOLUME_INTERNAL_PATH_CHANGED|656|
|VOLUME_DESTROYED|659|
|MOVE_STATUS|660|
|BENCHMARK_RESULT|661|
|TRIM_RESULT|662|

介绍完响应码，接着继续来说说发送应答消息的过程：

#### 2.2.2 SC.sendMsg
[-> SocketClient.cpp]

    int SocketClient::sendMsg(int code, const char *msg, bool addErrno) {
        return sendMsg(code, msg, addErrno, mUseCmdNum);
    }

sendMsg经过层层调用，进入sendDataLockedv方法

    int SocketClient::sendDataLockedv(struct iovec *iov, int iovcnt) {
        ...
        struct sigaction new_action, old_action;
        memset(&new_action, 0, sizeof(new_action));
        new_action.sa_handler = SIG_IGN;
        sigaction(SIGPIPE, &new_action, &old_action);

        //将应答消息写入socket管道
        for (;;) {
            ssize_t rc = TEMP_FAILURE_RETRY(
                writev(mSocket, iov + current, iovcnt - current));

            if (rc > 0) {
                size_t written = rc;
                while ((current < iovcnt) && (written >= iov[current].iov_len)) {
                    written -= iov[current].iov_len;
                    current++;
                }
                if (current == iovcnt) {
                    break;
                }
                iov[current].iov_base = (char *)iov[current].iov_base + written;
                iov[current].iov_len -= written;
                continue;
            }
            ...
            break;
        }

        sigaction(SIGPIPE, &old_action, &new_action);
        ...
        return ret;
    }

#### 2.2.3 NDC.listenToSocket

应答消息写入socket管道后，在MountService的另个线程"VoldConnector"中建立了名为`vold`的socket的客户端，通过循环方式不断监听Vold服务端发送过来的消息。

[-> NativeDaemonConnector.java]

    private void listenToSocket() throws IOException {
        LocalSocket socket = null;
        try {
            socket = new LocalSocket();
            LocalSocketAddress address = determineSocketAddress();
            //建立与"/dev/socket/vold"的socket连接
            socket.connect(address);
            InputStream inputStream = socket.getInputStream();
            synchronized (mDaemonLock) {
                mOutputStream = socket.getOutputStream();
            }
            ...
            while (true) {
                int count = inputStream.read(buffer, start, BUFFER_SIZE - start);
                ...
                for (int i = 0; i < count; i++) {
                    if (buffer[i] == 0) {
                        final String rawEvent = new String(
                                buffer, start, i - start, StandardCharsets.UTF_8);
                        //解析socket服务端发送的event
                        final NativeDaemonEvent event = NativeDaemonEvent.parseRawEvent(
                                rawEvent);
                        log("RCV <- {" + event + "}");

                        if (event.isClassUnsolicited()) {
                            ...
                            //当响应码区间为[600,700)，则发送消息交由mCallbackHandler处理
                            if (mCallbackHandler.sendMessage(mCallbackHandler.obtainMessage(
                                    event.getCode(), event.getRawEvent()))) {
                                releaseWl = false;
                            }
                        } else {
                            //对于其他响应码则添加到mResponseQueue队列
                            mResponseQueue.add(event.getCmdNumber(), event);
                        }
                    }
                }
            }
        } finally {
            //收尾清理类工作
            ...
        }
    }

监听也是阻塞的过程，当收到不同的消息相应码，采用不同的行为：

- 当响应吗不属于区间[600,700)：则将该事件添加到mResponseQueue，并且触发响应事件所对应的请求事件不再阻塞到ResponseQueue.poll，那么线程继续往下执行，即前面小节[2.1.2] NDC.execute的过程。
- 当响应码区间为[600,700)：则发送消息交由mCallbackHandler处理，向线程`android.fg`发送Handler消息，该线程收到后回调NativeDaemonConnector的`handleMessage`来处理。


#### 2.2.4 小节

![volume_reset](/images/io/volume_reset.jpg)

### 2.3 Kernel上报事件

介绍完MonutService与vold之间的交互通信，那么再来看看Kernel是如何上报事件到vold的流程。再介绍这个之前，先简单看看vold启动时都创建了哪些对象。


[-> system/vold/Main.cpp]

    int main(int argc, char** argv) {
        setenv("ANDROID_LOG_TAGS", "*:v", 1);
        android::base::InitLogging(argv, android::base::LogdLogger(android::base::SYSTEM));

        VolumeManager *vm;
        CommandListener *cl;
        CryptCommandListener *ccl;
        NetlinkManager *nm;

        mkdir("/dev/block/vold", 0755);

        //用于cryptfs检查，并mount加密的文件系统
        klog_set_level(6);

        //创建单例对象VolumeManager
        if (!(vm = VolumeManager::Instance())) {
            exit(1);
        }

        //创建单例对象NetlinkManager
        if (!(nm = NetlinkManager::Instance())) {
            exit(1);
        }

        if (property_get_bool("vold.debug", false)) {
            vm->setDebug(true);
        }

        // 创建CommandListener对象
        cl = new CommandListener();
        // 创建CryptCommandListener对象
        ccl = new CryptCommandListener();

        //给vm设置socket监听对象
        vm->setBroadcaster((SocketListener *) cl);
        //给nm设置socket监听对象
        nm->setBroadcaster((SocketListener *) cl);

        if (vm->start()) { //启动vm
            exit(1);
        }

        process_config(vm)； //解析config参数

        if (nm->start()) {  //启动nm
            exit(1);
        }

        coldboot("/sys/block");

        //启动响应命令的监听器
        if (cl->startListener()) {
            exit(1);
        }

        if (ccl->startListener()) {
            exit(1);
        }

        //Vold成为监听线程
        while(1) {
            sleep(1000);
        }

        exit(0);
    }

该方法的主要功能是创建并启动：VolumeManager，NetlinkManager ，NetlinkHandler，CommandListener，CryptCommandListener。

#### 2.3.1 Uevent && Netlink

Kernel上报事件给用户空间采用了Netlink方式，Netlink是一种特殊的socket，它是Linux所特有的。传送的消息是暂存在socket接收缓存中，并不被接收者立即处理，所以netlink是一种异步通信机制。而对于syscall和ioctl则都是同步通信机制。

Linux系统中大量采用Netlink机制来进行用户空间程序与kernel的通信。例如设备热插件，这会产生Uevent(User Space event，用户空间事件)是Linux系统中用户空间与内核空间之间通信的消息内容，主要用于设备驱动的事件通知。Uevent是Kobject的一部分，当Kobject状态改变时通知用户空间程序。对于kobject_action包括KOBJ_ADD，KOBJ_REMOVE，KOBJ_CHANGE，KOBJ_MOVE，KOBJ_ONLINE，KOBJ_OFFLINE，当发送任何一种action都会引发Kernel发送Uevent消息。

vold早已准备就绪等待着Kernel上报Uevent事件，接下来看看vold是如何接收Uevent事件，这就从NetlinkManager启动开始说起。

#### 2.3.2 NM.start
[-> NetlinkManager.java]

    int NetlinkManager::start() {
        struct sockaddr_nl nladdr;
        int sz = 64 * 1024;
        int on = 1;

        memset(&nladdr, 0, sizeof(nladdr));
        nladdr.nl_family = AF_NETLINK;
        nladdr.nl_pid = getpid(); //记录当前进程的pid
        nladdr.nl_groups = 0xffffffff;

        //PF_NETLINK代表创建的是Netlink通信的socket
        if ((mSock = socket(PF_NETLINK, SOCK_DGRAM | SOCK_CLOEXEC,
                NETLINK_KOBJECT_UEVENT)) < 0) {
            return -1;
        }

        //设置uevent的SO_RCVBUFFORCE选项
        if (setsockopt(mSock, SOL_SOCKET, SO_RCVBUFFORCE, &sz, sizeof(sz)) < 0) {
            goto out;
        }

        //设置uevent的SO_PASSCRED选项
        if (setsockopt(mSock, SOL_SOCKET, SO_PASSCRED, &on, sizeof(on)) < 0) {
            goto out;
        }
        //绑定uevent socket
        if (bind(mSock, (struct sockaddr *) &nladdr, sizeof(nladdr)) < 0) {
            goto out;
        }

        //创建NetlinkHandler
        mHandler = new NetlinkHandler(mSock);
        //启动NetlinkHandler
        if (mHandler->start()) {
            goto out;
        }
        return 0;

    out:
        close(mSock);
        return -1;
    }

NetlinkManager启动的过程中，会创建并启动NetlinkHandler，在该过程会通过`pthrea_create`创建子线程专门用于接收Kernel发送过程的Uevent事件，当收到数据时会调用NetlinkListener的onDataAvailable方法。

#### 2.3.3 NL.onDataAvailable
[-> NetlinkListener.cpp]

    bool NetlinkListener::onDataAvailable(SocketClient *cli)
    {
        int socket = cli->getSocket();
        ...
        //多次尝试获取socket数据
        count = TEMP_FAILURE_RETRY(uevent_kernel_recv(socket,
                mBuffer, sizeof(mBuffer), require_group, &uid));
        ...

        NetlinkEvent *evt = new NetlinkEvent();
        //解析消息并封装成NetlinkEvent
        if (evt->decode(mBuffer, count, mFormat)) {
            //事件处理【见小节2.3.4】
            onEvent(evt);
        } else if (mFormat != NETLINK_FORMAT_BINARY) {
            ...
        }

        delete evt;
        return true;
    }

#### 2.3.4 NH.onEvent

[-> NetlinkHandler.cpp]

    void NetlinkHandler::onEvent(NetlinkEvent *evt) {
        VolumeManager *vm = VolumeManager::Instance();
        const char *subsys = evt->getSubsystem();

        if (!strcmp(subsys, "block")) {
            //对于块设备的处理过程
            vm->handleBlockEvent(evt);
        }
    }

驱动设备分为字符设备、块设备、网络设备。对于字符设备按照字符流的方式被有序访问，字符设备也称为裸设备，可以直接读取物理磁盘，不经过系统缓存，例如键盘直接产生中断。而块设备是指系统中能够随机（不需要按顺序）访问固定大小数据片（chunks）的设备，例如硬盘；块设备则是通过系统缓存进行读取。

#### 2.3.5 VM.handleBlockEvent
[-> VolumeManager.cpp]

    void VolumeManager::handleBlockEvent(NetlinkEvent *evt) {
        std::lock_guard<std::mutex> lock(mLock);

        std::string eventPath(evt->findParam("DEVPATH")?evt->findParam("DEVPATH"):"");
        std::string devType(evt->findParam("DEVTYPE")?evt->findParam("DEVTYPE"):"");
        if (devType != "disk") return;

        int major = atoi(evt->findParam("MAJOR"));
        int minor = atoi(evt->findParam("MINOR"));
        dev_t device = makedev(major, minor);

        switch (evt->getAction()) {
        case NetlinkEvent::Action::kAdd: {
            for (auto source : mDiskSources) {
                if (source->matches(eventPath)) {
                    int flags = source->getFlags();
                    if (major == kMajorBlockMmc) {
                        flags |= android::vold::Disk::Flags::kSd;
                    } else {
                        flags |= android::vold::Disk::Flags::kUsb;
                    }

                    auto disk = new android::vold::Disk(eventPath, device,
                            source->getNickname(), flags);
                    //创建
                    disk->create();
                    mDisks.push_back(std::shared_ptr<android::vold::Disk>(disk));
                    break;
                }
            }
            break;
        }
        case NetlinkEvent::Action::kChange: {
            ...
            break;
        }
        case NetlinkEvent::Action::kRemove: {
            ...
            break;
        }
        ...
        }
    }

#### 2.3.6 小节

此处，我们以设备插入为例，来描绘一下整个流程图：

![kernel_process](/images/io/kernel_process.jpg)

### 2.4 不请自来的广播

线程VoldConnector通过socket不断监听来自vold发送过来的响应消息：

- 情况一：响应码不属于区间[600, 700)，则直接将响应消息添加到响应队列ResponseQueue，当响应队列有数据到来，便会唤醒另个线程MountService阻塞操作poll轮询操作。
- 情况二：响应码属于区间[600, 700)，则便是Unsolicited broadcasts，即不请自来的广播，当收到这类事件，则处理流程较第一种情况更复杂。

接下来说说第二种情况，对于不清自来的广播，这里的广播并非四大组件的广播，而是vold通过socket发送过来的消息。还记得还文章的开头讲到进程架构时，提到会涉及system_server的线程`android.fg`，那么这个过程就会讲到该线程的作用。回到NDC的监听socket过程。

#### 2.4.1 NDC.listenToSocket

[-> NativeDaemonConnector.java]

    private void listenToSocket() throws IOException {
        LocalSocket socket = null;
        try {
            socket = new LocalSocket();
            LocalSocketAddress address = determineSocketAddress();
            //建立与"/dev/socket/vold"的socket连接
            socket.connect(address);
            InputStream inputStream = socket.getInputStream();
            synchronized (mDaemonLock) {
                mOutputStream = socket.getOutputStream();
            }
            ...
            while (true) {
                int count = inputStream.read(buffer, start, BUFFER_SIZE - start);
                ...
                for (int i = 0; i < count; i++) {
                    if (buffer[i] == 0) {
                        final String rawEvent = new String(
                                buffer, start, i - start, StandardCharsets.UTF_8);
                        //解析socket服务端发送的event
                        final NativeDaemonEvent event = NativeDaemonEvent.parseRawEvent(
                                rawEvent);
                        log("RCV <- {" + event + "}");

                        if (event.isClassUnsolicited()) {
                            ...
                            //当响应码区间为[600,700)，则发送消息交由mCallbackHandler处理【2.4.2】
                            if (mCallbackHandler.sendMessage(mCallbackHandler.obtainMessage(
                                    event.getCode(), event.getRawEvent()))) {
                                releaseWl = false;
                            }
                        } else {
                            //对于其他响应码则添加到mResponseQueue队列
                            mResponseQueue.add(event.getCmdNumber(), event);
                        }
                    }
                }
            }
        } finally {
            //收尾清理类工作
            ...
        }
    }

通过handler消息机制，由mCallbackHandler处理，先来看看其初始化过程：

    mCallbackHandler = new Handler(mLooper, this);
    Looper=`FgThread.get().getLooper();

可以看出Looper采用的是线程`android.fg`的Looper，消息回调处理方法为NativeDaemonConnector的`handleMessage`来处理。那么这个过程就等价于向线程`android.fg`发送Handler消息，该线程收到消息后回调NativeDaemonConnector的`handleMessage`来处理。


#### 2.4.2 NDC.handleMessage
[-> NativeDaemonConnector.java]

    public boolean handleMessage(Message msg) {
        String event = (String) msg.obj;
        ...
        mCallbacks.onEvent(msg.what, event, NativeDaemonEvent.unescapeArgs(event))
                log(String.format("Unhandled event '%s'", event));
        ...
        return true;
    }

此处的mCallbacks，是由实例化NativeDaemonConnector对象时传递进来的，在这里是指MountService。转了一圈，又回到MountService。

#### 2.4.3 MS.onEvent
[-> MountService.java]

    public boolean onEvent(int code, String raw, String[] cooked) {
        synchronized (mLock) {
            return onEventLocked(code, raw, cooked);
        }
    }

onEventLocked增加同步锁，用于多线程并发访问的控制。根据vold发送过来的不同响应码将采取不同的处理流程。

#### 2.4.4 MS.onEventLocked
这里以收到vold发送过来的`RCV <- {650 public ...}`为例，即挂载外置sdcard/otg外置存储的流程：

[-> MountService.java]

    private boolean onEventLocked(int code, String raw, String[] cooked) {
        switch (code) {
            case VoldResponseCode.VOLUME_CREATED: {
                final String id = cooked[1];
                final int type = Integer.parseInt(cooked[2]);
                final String diskId = TextUtils.nullIfEmpty(cooked[3]);
                final String partGuid = TextUtils.nullIfEmpty(cooked[4]);

                final DiskInfo disk = mDisks.get(diskId);
                final VolumeInfo vol = new VolumeInfo(id, type, disk, partGuid);
                mVolumes.put(id, vol);
                //【见小节2.4.5】
                onVolumeCreatedLocked(vol);
                break;
            }
            ...
        }
        return true;
    }

#### 2.4.5 MS.onVolumeCreatedLocked
[-> MountService.java]

    private void onVolumeCreatedLocked(VolumeInfo vol) {
        if (vol.type == VolumeInfo.TYPE_EMULATED) {
            ...

        } else if (vol.type == VolumeInfo.TYPE_PUBLIC) {
            if (Objects.equals(StorageManager.UUID_PRIMARY_PHYSICAL, mPrimaryStorageUuid)
                    && vol.disk.isDefaultPrimary()) {
                vol.mountFlags |= VolumeInfo.MOUNT_FLAG_PRIMARY;
                vol.mountFlags |= VolumeInfo.MOUNT_FLAG_VISIBLE;
            }

            if (vol.disk.isAdoptable()) {
                vol.mountFlags |= VolumeInfo.MOUNT_FLAG_VISIBLE;
            }

            vol.mountUserId = UserHandle.USER_OWNER;
            //【见小节2.4.6】
            mHandler.obtainMessage(H_VOLUME_MOUNT, vol).sendToTarget();

        }
    }

这里又遇到一个Handler类型的对象`mHandler`,再来看看其定义：

    private static final String TAG = "MountService";
    HandlerThread hthread = new HandlerThread(TAG);
    hthread.start();
    mHandler = new MountServiceHandler(hthread.getLooper());

该Handler用到Looper便是线程`MountService`中的Looper，回调方法handleMessage位于MountServiceHandler类：

#### 2.4.6 MSH.handleMessage

[-> MountService]

    class MountServiceHandler extends Handler {
        public void handleMessage(Message msg) {
           switch (msg.what) {
               case H_VOLUME_MOUNT: {
                   final VolumeInfo vol = (VolumeInfo) msg.obj;
                   try {
                       //发送mount操作
                       mConnector.execute("volume", "mount", vol.id, vol.mountFlags,
                               vol.mountUserId);
                   } catch (NativeDaemonConnectorException ignored) {
                   }
                   break;
                }
                ...
            }
        }
    }

当收到H_VOLUME_MOUNT消息后，线程`MountService`便开始向vold发送mount操作事件，再接下来的流程在前面小节【2.1】已经介绍过

#### 2.4.7 小结

![unsolicited_broadcasts](/images/io/unsolicited_broadcasts.jpg)

## 三、总结

### 3.1 概括

本文首先从模块化和进程的视角来整体上描述了Android存储系统的架构，并分别展开对MountService, vold, kernel这三者之间的通信流程的剖析。

{1}**Java framework层**：采用 `1个主线程`(system_server) + `3个子线程`(VoldConnector, MountService, CryptdConnector)；MountService线程不断向vold下发存储相关的命令，比如mount, mkdirs等操作；而线程VoldConnector一直处于等待接收vold发送过来的应答事件；CryptdConnector通信原理和VoldConnector大抵相同，有兴趣地读者可自行阅读。

(2)**Native层**：采用 `1个主线程`(/system/bin/vold) + `3个子线程`(vold) + `1子进程`(/system/bin/sdcard)；vold进程中会通过`pthread_create`方式来生成3个vold子线程，其中两个vold线程分别跟上层system_server进程中的线程VoldConnector和CryptdConnector通信，第3个vold线程用于与kernel进行netlink方式通信。

本文更多的是以系统的角度来分析存储系统，那么对于app来说，那么地方会直接用到的呢？其实用到的地方很多，例如存储设备挂载成功会发送广播让app知晓当前存储挂载情况；其次当app需要创建目录时，比如`getExternalFilesDirs`, `getExternalCacheDirs`等当目录不存在时都需向存储系统发出mkdirs的命令。另外，MountService作为Binder服务端，那自然而然会有Binder客户端，那就是`StorageManager`，这个比较简单就不再细说了。

### 3.2 架构的思考

以Google原生的Android存储系统的架构设计主要采用Socket阻塞式通信方式，虽然vold的native层面有多个子线程干活，但各司其职，真正处理上层发送过来的命令，仍然是单通道的模式。

目前外置存储设备比如sdcard或者otg的硬件质量参差不齐，且随使用时间碎片化程度也越来越严重，对于存储设备挂载的过程中往往会有磁盘检测fsck_msdos或者整理fstrim的动作，那么势必会阻塞多线程并发访问，影响系统稳定性，从而造成系统ANR。

例如系统刚启动过程中reset操作需要重新挂载外置存储设备，而紧接着system_server主线程需要执行的volume user_started操作便会被阻塞，阻塞超过20s则系统会抛出Service Timeout的ANR。
