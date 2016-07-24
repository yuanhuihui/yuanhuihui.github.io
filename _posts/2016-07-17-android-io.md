---
layout: post
title:  "Android存储系统之源码篇"
date:   2016-07-17 2:20:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码, 来分析存储相关架构,涉及源码:

    /framework/base/services/java/com/android/server/SystemServer.java
    /framework/base/services/core/java/com/android/server/MountService.java
    /framework/base/services/core/java/com/android/server/NativeDaemonConnector.java
    /framework/base/services/core/java/com/android/server/NativeDaemonEvent.java
    /framework/base/core/java/android/os/storage/IMountService.java
    /framework/base/core/java/android/os/storage/IMountServiceListener.java
    /framework/base/core/java/android/os/storage/StorageManager.java

    /system/vold/Main.cpp
    /system/vold/VolumeManager.cpp
    /system/vold/NetlinkManager.cpp
    /system/vold/NetlinkHandler.cpp
    /system/vold/CommandListener.cpp
    /system/vold/VoldCommand.cpp
    /system/vold/VolumeBase.cpp
    /system/vold/PublicVolume.cpp
    /system/vold/EmulatedVolume.cpp
    /system/vold/PublicVolume.cpp
    /system/vold/Disk.cpp

    /system/core/libsysutils/src/NetlinkListener.cpp
    /system/core/libsysutils/src/SocketListener.cpp
    /system/core/libsysutils/src/FrameworkListener.cpp
    /system/core/libsysutils/src/FrameworkCommand.cpp
    /system/core/include/sysutils/NetlinkListener.h
    /system/core/include/sysutils/SocketListener.h
    /system/core/include/sysutils/FrameworkListener.h
    /system/core/include/sysutils/FrameworkCommand.h


## 一、概述

本文主要介绍跟存储相关的模块MountService和Vold的整体流程与架构设计.

- **MountService**：Android Binder服务，运行在system_server进程，用于跟Vold进行消息通信，比如`MountService`向`Vold`发送挂载SD卡的命令,或者接收到来自`Vold`的外设热插拔事件。
- **Vold:**全称为Volume Daemon，用于管理外部存储设备的Native守护进程，这是一个非常重要的守护进程，由NetlinkManager，VolumeManager，CommandListener这3部分组成。


## 二、MountService

MountService运行在`system_server`进程，在系统启动到阶段PHASE_WAIT_FOR_DEFAULT_DISPLAY后，进入`startOtherServices`会启动MountService.

### 2.1 启动
[-> SystemServer.java]

    private void startOtherServices() {
        ...
        IMountService mountService = null;
        //启动MountService服务，【见小节2.2】
        mSystemServiceManager.startService(MOUNT_SERVICE_CLASS);
        //等价new IMountService.Stub.Proxy()，即获取MountService的proxy对象
        mountService = IMountService.Stub.asInterface(
                ServiceManager.getService("mount"));
        ...

        mActivityManagerService.systemReady(new Runnable() {
            public void run() {
                //启动到阶段550【见小节2.7】
                mSystemServiceManager.startBootPhase(
                            SystemService.PHASE_ACTIVITY_MANAGER_READY);
            ...
        });
    }

NotificationManagerService依赖于MountService，比如media/usb通知事件，所以需要先启动MountService。此处MOUNT_SERVICE_CLASS=`com.android.server.MountService$Lifecycle`.

### 2.2 startService

mSystemServiceManager.startService(MOUNT_SERVICE_CLASS)主要完成3件事：

- 创建MOUNT_SERVICE_CLASS所指类的Lifecycle对象；
- 将该对象添加SystemServiceManager的`mServices`服务列表；
- 最后调用Lifecycle的onStart()方法，主要工作量这个过程，如下：

[-> MountService.java]

    class MountService extends IMountService.Stub
            implements INativeDaemonConnectorCallbacks, Watchdog.Monitor {
        public static class Lifecycle extends SystemService {
            public void onStart() {
                //创建MountService对象【见小节2.3】
                mMountService = new MountService(getContext());
                //登记Binder服务
                publishBinderService("mount", mMountService);
            }
            ...
        }
        ...
    }

创建MountService对象，并向Binder服务的大管家ServiceManager登记，该服务名为“mount”，对应服务对象为mMountService。登记之后，其他地方当需要MountService的服务时便可以通过服务名来向ServiceManager来查询具体的MountService服务。

### 2.3 MountService

[-> MountService.java]

    public MountService(Context context) {
        sSelf = this;

        mContext = context;
        //FgThread线程名为“"android.fg"，创建IMountServiceListener回调方法【见小节2.4】
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
        //创建用于VoldConnector的NDC对象【见小节2.5】
        mConnector = new NativeDaemonConnector(this, "vold", MAX_CONTAINERS * 2, VOLD_TAG, 25,
                null);
        mConnector.setDebug(true);
        //创建线程名为"VoldConnector"的线程，用于跟vold通信【见小节2.6】
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

从这里便可知道共创建了3个线程："MountService","VoldConnector","CryptdConnector"，另外还会使用到系统进程中的两个线程"android.fg"和"android.io". 这便是在文章开头进程架构图中Java framework层进程的创建情况.

接下来再分别看看MountService创建过程中的Callbacks实例化, NativeDaemonConnector实例化,以及"vold"线程的运行.

### 2.4 Callbacks

    class MountService {
        ...
        private static class Callbacks extends Handler {
            private final RemoteCallbackList<IMountServiceListener>
                            mCallbacks = new RemoteCallbackList<>();
            public Callbacks(Looper looper) {
                super(looper);
            }
            ...
        }
    }

创建Callbacks时的Looper为FgThread.get().getLooper()，其中`FgThread`采用单例模式，是一个线程名为"android.fg"的HandlerThread。另外，Callbacks对象有一个成员变量`mCallbacks`，如下：

[-> RemoteCallbackList.java]

    public class RemoteCallbackList<E extends IInterface> {
        ArrayMap<IBinder, Callback> mCallbacks
                = new ArrayMap<IBinder, Callback>();

        //Binder死亡通知
        private final class Callback implements IBinder.DeathRecipient {
            public void binderDied() {
                ...
            }
        }

        //注册死亡回调
        public boolean register(E callback, Object cookie) {
            synchronized (mCallbacks) {
                ...
                IBinder binder = callback.asBinder();
                Callback cb = new Callback(callback, cookie);
                binder.linkToDeath(cb, 0);
                mCallbacks.put(binder, cb);
                ...
            }
        }
        ...
    }

通过`register()`方法添加IMountServiceListener对象信息到`mCallbacks`成员变量。RemoteCallbackList的内部类Callback继承于IBinder.DeathRecipient，很显然这是死亡通知，当binder服务端进程死亡后，回调binderDied方法通知binder客户端进行相应地处理。

### 2.5 NativeDaemonConnector
[-> NativeDaemonConnector.java]

    NativeDaemonConnector(INativeDaemonConnectorCallbacks callbacks, String socket,
            int responseQueueSize, String logTag, int maxLogSize, PowerManager.WakeLock wl) {
        this(callbacks, socket, responseQueueSize, logTag, maxLogSize, wl,
                FgThread.get().getLooper());
    }

    NativeDaemonConnector(INativeDaemonConnectorCallbacks callbacks, String socket,
            int responseQueueSize, String logTag, int maxLogSize, PowerManager.WakeLock wl,
            Looper looper) {
        mCallbacks = callbacks;
        //socket名为"vold"
        mSocket = socket;
        //对象响应个数为500
        mResponseQueue = new ResponseQueue(responseQueueSize);
        mWakeLock = wl;
        if (mWakeLock != null) {
            mWakeLock.setReferenceCounted(true);
        }
        mLooper = looper;
        mSequenceNumber = new AtomicInteger(0);
        //TAG为"VoldConnector"
        TAG = logTag != null ? logTag : "NativeDaemonConnector";
        mLocalLog = new LocalLog(maxLogSize);
    }

- mLooper为FgThread.get().getLooper()，即运行在"android.fg"线程；
- mResponseQueue对象中成员变量`mPendingCmds`数据类型为LinkedList，记录着vold进程上报的响应事件，事件个数上限为500。

### 2.6 NDC.run

[-> NativeDaemonConnector.java]

    final class NativeDaemonConnector implements Runnable, Handler.Callback, Watchdog.Monitor {
        public void run() {
            mCallbackHandler = new Handler(mLooper, this);

            while (true) {
                try {
                    //监听vold的socket【见小节2.13】
                    listenToSocket();
                } catch (Exception e) {
                    loge("Error in NativeDaemonConnector: " + e);
                    SystemClock.sleep(5000);
                }
            }
        }
    }

在线程`VoldConnector`中建立了名为`vold`的socket的客户端，通过循环方式不断监听Vold服务端发送过来的消息。 另外，同理还有一个线程`CryptdConnector也采用类似的方式，建立了`cryptd`的socket客户端，监听Vold中另个线程发送过来的消息。到此,MountService与NativeDaemonConnector都已经启动，那么接下来到系统启动到达阶段PHASE_ACTIVITY_MANAGER_READY，则调用到onBootPhase方法。


### 2.7 onBootPhase

[-> MountService.java ::Lifecycle]

由于MountService的内部Lifecycle已添加SystemServiceManager的`mServices`服务列表；系统启动到`PHASE_ACTIVITY_MANAGER_READY`时会回调`mServices`中的`onBootPhase`方法

    public static class Lifecycle extends SystemService {
        public void onBootPhase(int phase) {
            if (phase == SystemService.PHASE_ACTIVITY_MANAGER_READY) {
                mMountService.systemReady();
            }
        }
    }

再调用MountService.systemReady方法，该方法主要是通过`mHandler`发送消息。

    private void systemReady() {
        mSystemReady = true;
        mHandler.obtainMessage(H_SYSTEM_READY).sendToTarget();
    }

此处`mHandler = new MountServiceHandler(hthread.getLooper())`,采用的是线程"MountService"中的Looper。到此system_server主线程通过handler向线程"MountService"发送`H_SYSTEM_READY`消息，接下来进入线程"MountService"的MountServiceHandler对象(简称MSH)的handleMessage()来处理相关的消息。

### 2.8 MSH.handleMessage

[-> MountService.java ::MountServiceHandler]

    class MountServiceHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case H_SYSTEM_READY: {
                    handleSystemReady(); //【见小节2.9】
                    break;
                }
                ...
            }
        }
    }

### 2.9 handleSystemReady
[-> MountService.java]

    private void handleSystemReady() {
        synchronized (mLock) {
            //【见小节2.10】
            resetIfReadyAndConnectedLocked();
        }

        //计划执行日常的fstrim操作【】
        MountServiceIdler.scheduleIdlePass(mContext);
    }

### 2.10 resetIfReadyAndConnectedLocked
[-> MountService.java]

    private void resetIfReadyAndConnectedLocked() {
        Slog.d(TAG, "Thinking about reset, mSystemReady=" + mSystemReady
                + ", mDaemonConnected=" + mDaemonConnected);
        //当系统启动到阶段550，并且已经与vold守护进程建立连接，则执行reset
        if (mSystemReady && mDaemonConnected) {
            killMediaProvider();
            mDisks.clear();
            mVolumes.clear();

            //将/data为路径的private volume添加到mVolumes
            addInternalVolume();

            try {
                //【见小节2.11】
                mConnector.execute("volume", "reset");

                //告知所有已经存在和启动的users
                final UserManager um = mContext.getSystemService(UserManager.class);
                final List<UserInfo> users = um.getUsers();
                for (UserInfo user : users) {
                    mConnector.execute("volume", "user_added", user.id, user.serialNumber);
                }
                for (int userId : mStartedUsers) {
                    mConnector.execute("volume", "user_started", userId);
                }
            } catch (NativeDaemonConnectorException e) {
                Slog.w(TAG, "Failed to reset vold", e);
            }
        }
    }

### 2.11 NDC.execute
[-> NativeDaemonConnector.java]

    public NativeDaemonEvent execute(String cmd, Object... args)
            throws NativeDaemonConnectorException {
        return execute(DEFAULT_TIMEOUT, cmd, args);
    }

其中`DEFAULT_TIMEOUT=1min`，即命令执行超时时长为1分钟。经过层层调用，executeForList()

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
            //【见小节2.12】
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

首先，将带执行的命令mSequenceNumber执行加1操作，再将cmd(例如`3 volume reset`)写入到socket的输出流，通过循环与poll机制等待执行底层响应该操作结果，否则直到1分钟超时才结束该方法。即便收到底层的响应码，如果响应码属于[100,200)区间，则继续阻塞等待后续事件上报。

### 2.12 ResponseQueue.remove
[-> MountService.java ::ResponseQueue]

    private static class ResponseQueue {
        public NativeDaemonEvent remove(int cmdNum, long timeoutMs, String logCmd) {
            PendingCmd found = null;
            synchronized (mPendingCmds) {
                //从mPendingCmds查询cmdNum
                for (PendingCmd pendingCmd : mPendingCmds) {
                    if (pendingCmd.cmdNum == cmdNum) {
                        found = pendingCmd;
                        break;
                    }
                }
                //如果已有的mPendingCmds中查询不到，则创建一个新的PendingCmd
                if (found == null) {
                    found = new PendingCmd(cmdNum, logCmd);
                    mPendingCmds.add(found);
                }
                found.availableResponseCount--;
                if (found.availableResponseCount == 0) mPendingCmds.remove(found);
            }
            NativeDaemonEvent result = null;
            try {
                //采用poll轮询方式等待底层上报该事件，直到1分钟超时
                result = found.responses.poll(timeoutMs, TimeUnit.MILLISECONDS);
            } catch (InterruptedException e) {}
            return result;
        }
    }

这里用到poll，先来看看`responses = new ArrayBlockingQueue<NativeDaemonEvent>(10)`,这是一个长度为10的可阻塞队列。
这里的poll也是阻塞的方式来轮询事件。

#### responses.poll
[-> ArrayBlockingQueue.java]

    public E poll(long timeout, TimeUnit unit) throws InterruptedException {
        long nanos = unit.toNanos(timeout);
        final ReentrantLock lock = this.lock;
        //可中断的锁等待
        lock.lockInterruptibly();
        try {
            //当队列长度为空，循环等待
            while (count == 0) {
                if (nanos <= 0)
                    return null;
                nanos = notEmpty.awaitNanos(nanos);
            }
            return extract();
        } finally {
            lock.unlock();
        }
    }

**小知识**：这里用到了ReentrantLock同步锁，该锁跟synchronized有功能有很相似，用于多线程并发访问。那么ReentrantLock与synchronized相比,

ReentrantLock优势：

- ReentrantLock功能更为强大，比如有时间锁等候，可中断锁等候(lockInterruptibly)，锁投票等功能；
- ReentrantLock性能更好些；
- ReentrantLock提供可轮询的锁请求(tryLock)，相对不容易产生死锁；而synchronized只要进入，要么成功获取，要么一直阻塞等待。

ReentrantLock的劣势：

- lock必须在finally块显式地释放，否则如果代码抛出Exception，锁将一直得不到释放；对于synchronized而言，JVM或者ART虚拟机都会确保该锁能自动释放。
- synchronized锁，在dump线程转储时会记录锁信息，对于分析调试大有裨益；对于Lock来说，只是普通类，虚拟机无法识别。

再回到ResponseQueue.remove(),该方法中mPendingCmds中的内容是哪里添加的呢？其实是在NDC.listenToSocket循环监听到消息时添加的，则接下来看看监听过程。

### 2.13 listenToSocket
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
            //建立连接后，回调MS.onDaemonConnected【见小节2.15】
            mCallbacks.onDaemonConnected();

            byte[] buffer = new byte[BUFFER_SIZE];
            int start = 0;

            while (true) {
                int count = inputStream.read(buffer, start, BUFFER_SIZE - start);
                ...

                for (int i = 0; i < count; i++) {
                    if (buffer[i] == 0) {
                        final String rawEvent = new String(
                                buffer, start, i - start, StandardCharsets.UTF_8);

                        boolean releaseWl = false;
                        try {
                            //解析socket服务端发送的event
                            final NativeDaemonEvent event = NativeDaemonEvent.parseRawEvent(
                                    rawEvent);

                            log("RCV <- {" + event + "}");
                            //当事件的响应码区间为[600,700)，则发送消息交由mCallbackHandler处理
                            if (event.isClassUnsolicited()) {
                                if (mCallbacks.onCheckHoldWakeLock(event.getCode())
                                        && mWakeLock != null) {
                                    mWakeLock.acquire();
                                    releaseWl = true;
                                }
                                if (mCallbackHandler.sendMessage(mCallbackHandler.obtainMessage(
                                        event.getCode(), event.getRawEvent()))) {
                                    releaseWl = false;
                                }
                            } else {
                                //对于其他的响应码则添加到mResponseQueue队列【见小节2.14】
                                mResponseQueue.add(event.getCmdNumber(), event);
                            }
                        } catch (IllegalArgumentException e) {
                            log("Problem parsing message " + e);
                        } finally {
                            if (releaseWl) {
                                mWakeLock.acquire();
                            }
                        }
                        start = i + 1;
                    }
                }
                ...
            }
        } catch (IOException ex) {
            throw ex;
        } finally {
            //收尾清理类工作，关闭mOutputStream, socket
            ...
        }
    }

这里有一个动作是mResponseQueue.add()，通过该方法便能触发ResponseQueue.poll阻塞操作继续往下执行。

### 2.14 ResponseQueue.add
[-> NativeDaemonConnector.java]

    private static class ResponseQueue {
        public void add(int cmdNum, NativeDaemonEvent response) {
           PendingCmd found = null;
           synchronized (mPendingCmds) {
               for (PendingCmd pendingCmd : mPendingCmds) {
                   if (pendingCmd.cmdNum == cmdNum) {
                       found = pendingCmd;
                       break;
                   }
               }
                //没有找到则创建相应的PendingCmd
               if (found == null) {
                   while (mPendingCmds.size() >= mMaxCount) {
                       PendingCmd pendingCmd = mPendingCmds.remove();
                   }
                   found = new PendingCmd(cmdNum, null);
                   mPendingCmds.add(found);
               }
               found.availableResponseCount++;
               if (found.availableResponseCount == 0) mPendingCmds.remove(found);
           }
           try {
               found.responses.put(response);
           } catch (InterruptedException e) { }
       }
    }

#### responses.put
[-> ArrayBlockingQueue.java]

    public void put(E e) throws InterruptedException {
        checkNotNull(e);
        final ReentrantLock lock = this.lock;
        lock.lockInterruptibly();
        try {
            //当队列满了则等待
            while (count == items.length)
                notFull.await();
            insert(e);
        } finally {
            lock.unlock();
        }
    }


看完了如何向mPendingCmds中增加待处理的命令,再来回过来看看,当当listenToSocket刚开始监听前,收到Native的Daemon连接后的执行操作.

### 2.15 MS.onDaemonConnected
[-> MountService.java]

    public void onDaemonConnected() {
        mDaemonConnected = true;
        mHandler.obtainMessage(H_DAEMON_CONNECTED).sendToTarget();
    }

当前主线程发送消息`H_DAEMON_CONNECTED`给线程MountService`，该线程收到消息后调用MountServiceHandler的handleMessage()相应分支后，进而调用handleDaemonConnected()方法。

    private void handleDaemonConnected() {
        synchronized (mLock) {
            resetIfReadyAndConnectedLocked();
        }

        //类型为CountDownLatch，用于多线程同步，阻塞await()直到计数器为零
        mConnectedSignal.countDown();
        if (mConnectedSignal.getCount() != 0) {
            return;
        }

        //调用PMS来加载ASECs
        mPms.scanAvailableAsecs();

        //用于通知ASEC扫描已完成
        mAsecsScanned.countDown();
    }

这里的PMS.scanAvailableAsecs()经过层层调用，最终核心工作还是通过MountService.getSecureContainerList。

[-> MountService.java]

    public String[] getSecureContainerList() {
        enforcePermission(android.Manifest.permission.ASEC_ACCESS);
        //等待mConnectedSignal计数锁达到零
        waitForReady();
        //当没有挂载Primary卷设备，则弹出警告
        warnOnNotMounted();

        try {
            //向vold进程发送asec list命令
            return NativeDaemonEvent.filterMessageList(
                    mConnector.executeForList("asec", "list"), VoldResponseCode.AsecListResult);
        } catch (NativeDaemonConnectorException e) {
            return new String[0];
        }
    }

### 2.16 小节

这里以一张简单的流程图来说明上述过程:

![volume_reset](/images/io/volume_reset.jpg)

## 三、Vold

介绍完了Java framework层的MountService以及NativeDaemonConnector,往下走来到了Vold的世界.Vold是由开机过程中解析init.rc时启动：

    on post-fs-data
        start vold //启动vold服务

Vold的service定义如下：

    service vold /system/bin/vold
        class core
        socket vold stream 0660 root mount
        socket cryptd stream 0660 root mount
        ioprio be 2

接下来便进入Vold的main(),在开启新的征途之前,为了不被代码弄晕,先来用一幅图来介绍下这些核心类之间的关系以及主要方法,以方便更好的往下阅读.

![vold](/images/io/vold.jpg)

![volume](/images/io/volume.jpg)

### 3.1 main

[-> system/vold/Main.cpp]

    int main(int argc, char** argv) {
        setenv("ANDROID_LOG_TAGS", "*:v", 1);
        android::base::InitLogging(argv, android::base::LogdLogger(android::base::SYSTEM));

        VolumeManager *vm;
        CommandListener *cl;
        CryptCommandListener *ccl;
        NetlinkManager *nm;

        //解析参数，设置contenxt
        parse_args(argc, argv);
        ...

        fcntl(android_get_control_socket("vold"), F_SETFD, FD_CLOEXEC);
        fcntl(android_get_control_socket("cryptd"), F_SETFD, FD_CLOEXEC);

        mkdir("/dev/block/vold", 0755);

        //用于cryptfs检查，并mount加密的文件系统
        klog_set_level(6);

        //创建单例对象VolumeManager 【见小节3.2.1】
        if (!(vm = VolumeManager::Instance())) {
            exit(1);
        }

        //创建单例对象NetlinkManager 【见小节3.3.1】
        if (!(nm = NetlinkManager::Instance())) {
            exit(1);
        }

        if (property_get_bool("vold.debug", false)) {
            vm->setDebug(true);
        }

        // 创建CommandListener对象 【见小节3.4.1】
        cl = new CommandListener();
        // 创建CryptCommandListener对象 【见小节3.5.1】
        ccl = new CryptCommandListener();

        //【见小节3.2.2】
        vm->setBroadcaster((SocketListener *) cl);
        //【见小节3.3.2】
        nm->setBroadcaster((SocketListener *) cl);

        if (vm->start()) { //【见小节3.2.3】
            exit(1);
        }

        process_config(vm)； //【见小节3.2.4】

        if (nm->start()) {  //【见小节3.3.3】
            exit(1);
        }

        coldboot("/sys/block");

        //启动响应命令的监听器 //【见小节3.4.2】
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

该方法的主要功能是创建下面4个对象并启动

- VolumeManager
- NetlinkManager （NetlinkHandler）
- CommandListener
- CryptCommandListener

接下来分别说说几个类：

### 3.2 VolumeManager

#### 3.2.1 创建

[-> VolumeManager.cpp]

    VolumeManager *VolumeManager::Instance() {
        if (!sInstance)
            sInstance = new VolumeManager();
        return sInstance;
    }

创建单例模式的VolumeManager对象

    VolumeManager::VolumeManager() {
        mDebug = false;
        mActiveContainers = new AsecIdCollection();
        mBroadcaster = NULL;
        mUmsSharingCount = 0;
        mSavedDirtyRatio = -1;
        //当UMS获取时，则设置dirty ratio为0
        mUmsDirtyRatio = 0;
    }

#### 3.2.2 vm->setBroadcaster

    void setBroadcaster(SocketListener *sl) {
         mBroadcaster = sl;
     }

将新创建的`CommandListener`对象sl赋值给vm对象的成员变量`mBroadcaster`

#### 3.2.3 vm->start

    int VolumeManager::start() {
        //卸载所有设备，以提供最干净的环境
        unmountAll();

        //创建Emulated内部存储
        mInternalEmulated = std::shared_ptr<android::vold::VolumeBase>(
                new android::vold::EmulatedVolume("/data/media"));
        mInternalEmulated->create();
        return 0;
    }

mInternalEmulated的据类型为`EmulatedVolume`，设备路径为`/data/media`，id和label为“emulated”，mMountFlags=0。`EmulatedVolume`继承于`VolumeBase`

##### 3.2.3.1 unmountAll

    int VolumeManager::unmountAll() {
        std::lock_guard<std::mutex> lock(mLock);

        //卸载内部存储
        if (mInternalEmulated != nullptr) {
            mInternalEmulated->unmount();
        }
        //卸载外部存储
        for (auto disk : mDisks) {
            disk->unmountAll();
        }

        FILE* fp = setmntent("/proc/mounts", "r");
        if (fp == NULL) {
            return -errno;
        }

        std::list<std::string> toUnmount;
        mntent* mentry;
        while ((mentry = getmntent(fp)) != NULL) {
            if (strncmp(mentry->mnt_dir, "/mnt/", 5) == 0
                    || strncmp(mentry->mnt_dir, "/storage/", 9) == 0) {
                toUnmount.push_front(std::string(mentry->mnt_dir));
            }
        }
        endmntent(fp);

        for (auto path : toUnmount) {
            //强制卸载
            android::vold::ForceUnmount(path);
        }

        return 0;
    }

此处打开的"/proc/mounts"每一行内容依次是文件名，目录，类型，操作。例如：

    /dev/fuse /mnt/runtime/default/emulated fuse rw,nosuid,nodev,...

该方法的主要工作是卸载：

- 内部存储mInternalEmulated；
- 外部存储mDisks，比如sdcard等；
- "/proc/mounts"中目录包含mnt或者storage的路径；

**卸载内部存储**:

    status_t EmulatedVolume::doUnmount() {
        if (mFusePid > 0) {
            kill(mFusePid, SIGTERM);
            TEMP_FAILURE_RETRY(waitpid(mFusePid, nullptr, 0));
            mFusePid = 0;
        }

        KillProcessesUsingPath(getPath());
        //强制卸载fuse路径
        ForceUnmount(mFuseDefault);
        ForceUnmount(mFuseRead);
        ForceUnmount(mFuseWrite);

        rmdir(mFuseDefault.c_str());
        rmdir(mFuseRead.c_str());
        rmdir(mFuseWrite.c_str());

        mFuseDefault.clear();
        mFuseRead.clear();
        mFuseWrite.clear();

        return OK;
    }

`KillProcessesUsingPath`的功能很强大，通过文件path来查看其所在进程，并杀掉相应进程。当以下5处任意一处存在与path相同的地方，则会杀掉相应的进程：

- `proc/<pid>/fd`，打开文件；
- `proc/<pid>/maps` 打开文件映射；
- `proc/<pid>/cwd` 链接文件；
- `proc/<pid>/root` 链接文件；
- `proc/<pid>/exe` 链接文件；

##### 3.2.3.2 EV.create

[-> VolumeBase.cpp]

    status_t VolumeBase::create() {
        mCreated = true;
        status_t res = doCreate();
        //通知VolumeCreated事件
        notifyEvent(ResponseCode::VolumeCreated,
                StringPrintf("%d \"%s\" \"%s\"", mType, mDiskId.c_str(), mPartGuid.c_str()));
        //设置为非挂载状态
        setState(State::kUnmounted);
        return res;
    }


    void VolumeBase::notifyEvent(int event, const std::string& value) {
        if (mSilent) return;
        //通过socket向MountService发送创建volume的命令(650)
        VolumeManager::Instance()->getBroadcaster()->sendBroadcast(event,
                StringPrintf("%s %s", getId().c_str(), value.c_str()).c_str(), false);
    }

#### 3.2.4 process_config(vm)

[-> system/vold/Main.cpp]

    static int process_config(VolumeManager *vm) {
        //获取Fstab路径
        std::string path(android::vold::DefaultFstabPath());
        fstab = fs_mgr_read_fstab(path.c_str());
        ...

        bool has_adoptable = false;
        for (int i = 0; i < fstab->num_entries; i++) {
            if (fs_mgr_is_voldmanaged(&fstab->recs[i])) {
                if (fs_mgr_is_nonremovable(&fstab->recs[i])) {
                    LOG(WARNING) << "nonremovable no longer supported; ignoring volume";
                    continue;
                }

                std::string sysPattern(fstab->recs[i].blk_device);
                std::string nickname(fstab->recs[i].label);
                int flags = 0;

                if (fs_mgr_is_encryptable(&fstab->recs[i])) {
                    flags |= android::vold::Disk::Flags::kAdoptable;
                    has_adoptable = true;
                }
                if (fs_mgr_is_noemulatedsd(&fstab->recs[i])
                        || property_get_bool("vold.debug.default_primary", false)) {
                    flags |= android::vold::Disk::Flags::kDefaultPrimary;
                }

                vm->addDiskSource(std::shared_ptr<VolumeManager::DiskSource>(
                        new VolumeManager::DiskSource(sysPattern, nickname, flags)));
            }
        }
        property_set("vold.has_adoptable", has_adoptable ? "1" : "0");
        return 0;
    }

Fstab路径：首先通过`getprop ro.hardware`，比如高通芯片则为`qcom`那么Fstab路径就是`/fstab.qcom`，那么该文件的具体内容，例如(当然这个不同手机会有所不同)：

|src|mnt_point|type|mnt_flags and options|fs_mgr_flags|
|---|---|
|/dev/block/bootdevice/by-name/system|  /system|      ext4 |   ro,barrier=1,discard  |                              wait,verify|
|/dev/block/bootdevice/by-name/userdata| /data|        ext4|    nosuid,nodev,barrier=1,noauto_da_alloc,discard  |    wait,check,forceencrypt=footer|
|/dev/block/bootdevice/by-name/cust|    /cust|             ext4 |   nosuid,nodev,barrier=1 |                             wait,check|
|/devices/soc.0/7864900.sdhci/mmc_host*| /storage/sdcard1|   vfat |   nosuid,nodev  |       wait,voldmanaged=sdcard1:auto,noemulatedsd,encryptable=footer|
|/dev/block/bootdevice/by-name/config|   /frp|  emmc |   defaults                                            defaults|
|/devices/platform/msm_hsusb*|          /storage/usbotg|    vfat |   nosuid,nodev   |      wait,voldmanaged=usbotg:auto,encryptable=footer|



### 3.3 NetlinkManager

#### 3.3.1 创建
[-> NetlinkManager.cpp]

    NetlinkManager *NetlinkManager::Instance() {
        if (!sInstance)
            sInstance = new NetlinkManager();
        return sInstance;
    }

#### 3.3.2 nm->setBroadcaster

    void setBroadcaster(SocketListener *sl) {
        mBroadcaster = sl;
    }

#### 3.3.3 nm->start

    int NetlinkManager::start() {
        struct sockaddr_nl nladdr;
        int sz = 64 * 1024;
        int on = 1;

        memset(&nladdr, 0, sizeof(nladdr));
        nladdr.nl_family = AF_NETLINK;
        nladdr.nl_pid = getpid(); //记录当前进程的pid
        nladdr.nl_groups = 0xffffffff;

        //创建event socket
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

        //创建NetlinkHandler【见小节3.3.4】
        mHandler = new NetlinkHandler(mSock);
        //启动NetlinkHandler【见小节3.3.5】
        if (mHandler->start()) {
            goto out;
        }

        return 0;

    out:
        close(mSock);
        return -1;
    }

#### 3.3.4 NetlinkHandler

NetlinkHandler继承于`NetlinkListener`，`NetlinkListener`继承于`SocketListener`。new NetlinkHandler(mSock)中参数mSock是用于与Kernel进行通信的socket对象。由于这个继承关系，当NetlinkHandler初始化时会调用基类的初始化，最终调用到：

[-> SocketListener.cpp]

    SocketListener::SocketListener(int socketFd, bool listen) {
        //listen=false
        init(NULL, socketFd, listen, false);
    }

    void SocketListener::init(const char *socketName, int socketFd, bool listen, bool useCmdNum) {
        mListen = listen;
        mSocketName = socketName;
        //用于监听Kernel发送过程的uevent事件
        mSock = socketFd;
        mUseCmdNum = useCmdNum;
        //初始化同步锁
        pthread_mutex_init(&mClientsLock, NULL);
        //创建socket通信的client端
        mClients = new SocketClientCollection();
    }

到此，mListen = false; mSocketName = NULL; mUseCmdNum = false。 另外，这里用到的同步锁，用于控制多线程并发访问。 接着在来看看start过程：

#### 3.3.5 NH->start

[-> NetlinkHandler.cpp]

    int NetlinkHandler::start() {
        return this->startListener();
    }

[-> SocketListener.cpp]

    int SocketListener::startListener() {
        return startListener(4);
    }

    int SocketListener::startListener(int backlog) {
        ...
        //mListen =false
        if (mListen && listen(mSock, backlog) < 0) {
            return -1;
        } else if (!mListen)
            //创建SocketClient对象，并加入到mClients队列
            mClients->push_back(new SocketClient(mSock, false, mUseCmdNum));

        //创建匿名管道
        if (pipe(mCtrlPipe)) {
            return -1;
        }

        //创建工作线程，线程运行函数threadStart【见小节3.3.6】
        if (pthread_create(&mThread, NULL, SocketListener::threadStart, this)) {
            return -1;
        }

        return 0;
    }

mCtrlPipe是匿名管道，这是一个二元数组，mCtrlPipe[0]从管道读数据，mCtrlPipe[1]从管道写数据。

#### 3.3.6 threadStart
[-> SocketListener.cpp]

    void *SocketListener::threadStart(void *obj) {
        SocketListener *me = reinterpret_cast<SocketListener *>(obj);
        //【见小节3.3.7】
        me->runListener();
        pthread_exit(NULL); //线程退出
        return NULL;
    }

#### 3.3.7  SL->runListener
[-> SocketListener.cpp]

    void SocketListener::runListener() {
        SocketClientCollection pendingList;
        while(1) {
            SocketClientCollection::iterator it;
            fd_set read_fds;
            int rc = 0;
            int max = -1;

            FD_ZERO(&read_fds);

            if (mListen) {
                max = mSock;
                FD_SET(mSock, &read_fds);
            }

            FD_SET(mCtrlPipe[0], &read_fds);
            if (mCtrlPipe[0] > max)
                max = mCtrlPipe[0];

            pthread_mutex_lock(&mClientsLock);
            for (it = mClients->begin(); it != mClients->end(); ++it) {
                // NB: calling out to an other object with mClientsLock held (safe)
                int fd = (*it)->getSocket();
                FD_SET(fd, &read_fds);
                if (fd > max) {
                    max = fd;
                }
            }
            pthread_mutex_unlock(&mClientsLock);
            SLOGV("mListen=%d, max=%d, mSocketName=%s", mListen, max, mSocketName);
            if ((rc = select(max + 1, &read_fds, NULL, NULL, NULL)) < 0) {
                if (errno == EINTR)
                    continue;
                SLOGE("select failed (%s) mListen=%d, max=%d", strerror(errno), mListen, max);
                sleep(1);
                continue;
            } else if (!rc)
                continue;

            if (FD_ISSET(mCtrlPipe[0], &read_fds)) {
                char c = CtrlPipe_Shutdown;
                TEMP_FAILURE_RETRY(read(mCtrlPipe[0], &c, 1));
                if (c == CtrlPipe_Shutdown) {
                    break;
                }
                continue;
            }
            if (mListen && FD_ISSET(mSock, &read_fds)) {
                struct sockaddr addr;
                socklen_t alen;
                int c;

                do {
                    alen = sizeof(addr);
                    c = accept(mSock, &addr, &alen);
                    SLOGV("%s got %d from accept", mSocketName, c);
                } while (c < 0 && errno == EINTR);
                if (c < 0) {
                    SLOGE("accept failed (%s)", strerror(errno));
                    sleep(1);
                    continue;
                }
                fcntl(c, F_SETFD, FD_CLOEXEC);
                pthread_mutex_lock(&mClientsLock);
                mClients->push_back(new SocketClient(c, true, mUseCmdNum));
                pthread_mutex_unlock(&mClientsLock);
            }

            /* Add all active clients to the pending list first */
            pendingList.clear();
            pthread_mutex_lock(&mClientsLock);
            for (it = mClients->begin(); it != mClients->end(); ++it) {
                SocketClient* c = *it;
                // NB: calling out to an other object with mClientsLock held (safe)
                int fd = c->getSocket();
                if (FD_ISSET(fd, &read_fds)) {
                    pendingList.push_back(c);
                    c->incRef();
                }
            }
            pthread_mutex_unlock(&mClientsLock);

            /* Process the pending list, since it is owned by the thread,
             * there is no need to lock it */
            while (!pendingList.empty()) {
                /* Pop the first item from the list */
                it = pendingList.begin();
                SocketClient* c = *it;
                pendingList.erase(it);
                /* Process it, if false is returned, remove from list */
                if (!onDataAvailable(c)) {
                    release(c, false);
                }
                c->decRef();
            }
        }
    }

### 3.4 CommandListener

#### 3.4.1 创建

[-> CommandListener.cpp]

    CommandListener::CommandListener() :
                     FrameworkListener("vold", true) {
        registerCmd(new DumpCmd());
        registerCmd(new VolumeCmd());
        registerCmd(new AsecCmd());
        registerCmd(new ObbCmd());
        registerCmd(new StorageCmd());
        registerCmd(new FstrimCmd());
    }

##### 3.4.1.1 FrameworkListener

[-> FrameworkListener.cpp]

    FrameworkListener::FrameworkListener(const char *socketName, bool withSeq) :
                                SocketListener(socketName, true, withSeq) {
        init(socketName, withSeq);
    }

    void FrameworkListener::init(const char *socketName UNUSED, bool withSeq) {
        mCommands = new FrameworkCommandCollection();
        errorRate = 0;
        mCommandCount = 0;
        mWithSeq = withSeq; //true
    }


##### 3.4.1.2 SocketListener

[-> SocketListener.cpp]

    SocketListener::SocketListener(const char *socketName, bool listen, bool useCmdNum) {
        init(socketName, -1, listen, useCmdNum);
    }

    void SocketListener::init(const char *socketName, int socketFd, bool listen, bool useCmdNum) {
        mListen = listen; //true
        mSocketName = socketName; //"vold"
        mSock = socketFd; // -1
        mUseCmdNum = useCmdNum; //true
        pthread_mutex_init(&mClientsLock, NULL);
        mClients = new SocketClientCollection();
    }

socket名为“vold”

##### 3.4.1.3 registerCmd

    void FrameworkListener::registerCmd(FrameworkCommand *cmd) {
        mCommands->push_back(cmd);
    }

    CommandListener::VolumeCmd::VolumeCmd() :
                 VoldCommand("volume") {
    }

创建这些对象 DumpCmd，VolumeCmd，AsecCmd，ObbCmd，StorageCmd，FstrimCmd，并都加入到mCommands队列。

#### 3.4.2 cl->startListener

    int SocketListener::startListener() {
        return startListener(4);
    }

    int SocketListener::startListener(int backlog) {

        if (!mSocketName && mSock == -1) {
            ...
        } else if (mSocketName) {
            //获取“vold”所对应的句柄
            if ((mSock = android_get_control_socket(mSocketName)) < 0) {
                return -1;
            }
            fcntl(mSock, F_SETFD, FD_CLOEXEC);
        }

        //CL开始监听
        if (mListen && listen(mSock, backlog) < 0) {
            return -1;
        }
        ...
        //创建匿名管道
        if (pipe(mCtrlPipe)) {
            return -1;
        }

        //创建工作线程
        if (pthread_create(&mThread, NULL, SocketListener::threadStart, this)) {
            return -1;
        }

        return 0;
    }

## 四、小结

- **Linux Kernel**：通过`uevent`向Vold的NetlinkManager发送Uevent事件；
- **NetlinkManager**：接收来自Kernel的`Uevent`事件，再转发给VolumeManager；
- **VolumeManager**：接收来自NetlinkManager的事件，再转发给CommandListener进行处理；
- **CommandListener**：接收来自VolumeManager的事件，通过`socket`通信方式发送给MountService；
- **MountService**：接收来自CommandListener的事件。

本文从源码视角主要介绍了相关模块的创建与启动过程以及部分流程的介绍。要想更进一步了解,[Android存储系统之架构篇](http://gityuan.com/2016/07/23/android-io-arch).
