---
layout: post
title:  "Android重启流程(一)"
date:   2016-7-9 22:39:22
catalog:    true
tags:
    - android
    - stability

---

    framework/base/services/core/java/com/android/server/power/PowerManagerServer.java
    framework/base/services/core/java/com/android/server/power/ShutdownThread.java

## 一、概述

重启动作从按键触发中断，linux kernel层给Android framework层返回按键事件进入 framework层，再从 framework层到kernel层执行kernel层关机任务。当然还有非按键触发，比如系统异常导致重启，或者直接调用PM的reboot()方法重启。

这里就先从PowerManager说起。

## 二、关机流程

### 2.1 PM.reboot

[-> PowerManager.java]

    public void reboot(String reason) {
        try {
            //【见小节2.2】
            mService.reboot(false, reason, true);
        } catch (RemoteException e) {
        }
    }

### 2.2 BinderService.reboot

[-> PowerManagerService.java]

    private final class BinderService extends IPowerManager.Stub {
        public void reboot(boolean confirm, String reason, boolean wait) {
            //权限检查
            mContext.enforceCallingOrSelfPermission(android.Manifest.permission.REBOOT, null);
            if (PowerManager.REBOOT_RECOVERY.equals(reason)) {
                mContext.enforceCallingOrSelfPermission(android.Manifest.permission.RECOVERY, null);
            }

            final long ident = Binder.clearCallingIdentity();
            try {
                //【见小节2.3】
                shutdownOrRebootInternal(false, confirm, reason, wait);
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
        }
    }

此时参数为shutdownOrRebootInternal(false, false, reason, true);

- shutdown=false：代表重启；
- confirm=false：代表直接重启，无需弹出询问提示框；
- wait=true：代表阻塞等待重启操作完成。

### 2.3 PMS.shutdownOrRebootInternal

[-> PowerManagerService.java]

    private void shutdownOrRebootInternal(final boolean shutdown, final boolean confirm,
            final String reason, boolean wait) {
        ...
        Runnable runnable = new Runnable() {
            @Override
            public void run() {
                synchronized (this) {
                    if (shutdown) {
                        ShutdownThread.shutdown(mContext, reason, confirm);
                    } else {
                        //重启则进入该分支【见小节2.4】
                        ShutdownThread.reboot(mContext, reason, confirm);
                    }
                }
            }
        };

        // ShutdownThread必须运行在一个展现UI的looper
        Message msg = Message.obtain(mHandler, runnable);
        msg.setAsynchronous(true);
        mHandler.sendMessage(msg);


        if (wait) {
            //等待ShutdownThread执行完毕
            synchronized (runnable) {
                while (true) {
                    try {
                        runnable.wait();
                    } catch (InterruptedException e) {
                    }
                }
            }
        }
    }

### 2.4 SDT.reboot

[-> ShutdownThread.java]

    public static void reboot(final Context context, String reason, boolean confirm) {
        mReboot = true;
        mRebootSafeMode = false;
        mRebootUpdate = false;
        mReason = reason;
        //【见小节2.5】
        shutdownInner(context, confirm);
    }

mReboot为true则代表重启操作，值为false则代表关机操作。

### 2.5 SDT.shutdownInner

[-> ShutdownThread.java]

    static void shutdownInner(final Context context, boolean confirm) {
        //确保只有唯一的线程执行shutdown/reboot操作
        synchronized (sIsStartedGuard) {
            if (sIsStarted) {
                return;
            }
        }

        final int longPressBehavior = context.getResources().getInteger(
                        com.android.internal.R.integer.config_longPressOnPowerBehavior);
        final int resourceId = mRebootSafeMode
                ? com.android.internal.R.string.reboot_safemode_confirm
                : (longPressBehavior == 2
                        ? com.android.internal.R.string.shutdown_confirm_question
                        : com.android.internal.R.string.shutdown_confirm);

        Log.d(TAG, "Notifying thread to start shutdown longPressBehavior=" + longPressBehavior);

        if (confirm) {
            //这里是走弹出关机/重启提示框
            ...
        } else {
            //本次confirm=false进入该分支【见小节2.6】
            beginShutdownSequence(context);
        }
    }

### 2.6 SDT.beginShutdownSequence

[-> ShutdownThread.java]

    private static void beginShutdownSequence(Context context) {
        synchronized (sIsStartedGuard) {
            if (sIsStarted) {
                return; //shutdown操作正在执行，则直接返回
            }
            sIsStarted = true;
        }
        //创建进度显示对话框
        ProgressDialog pd = new ProgressDialog(context);

        //当重启原因为"recovery"
        if (PowerManager.REBOOT_RECOVERY.equals(mReason)) {
            mRebootUpdate = new File(UNCRYPT_PACKAGE_FILE).exists();
            if (mRebootUpdate) {
                pd.setTitle(context.getText(com.android.internal.R.string.reboot_to_update_title));
                pd.setMessage(context.getText(
                        com.android.internal.R.string.reboot_to_update_prepare));
                pd.setMax(100);
                pd.setProgressNumberFormat(null);
                pd.setProgressStyle(ProgressDialog.STYLE_HORIZONTAL);
                pd.setProgress(0);
                pd.setIndeterminate(false);
            } else {
                pd.setTitle(context.getText(com.android.internal.R.string.reboot_to_reset_title));
                pd.setMessage(context.getText(
                        com.android.internal.R.string.reboot_to_reset_message));
                pd.setIndeterminate(true);
            }
        } else {
            //重启/关机则进入该分支
            pd.setTitle(context.getText(com.android.internal.R.string.power_off));
            pd.setMessage(context.getText(com.android.internal.R.string.shutdown_progress));
            pd.setIndeterminate(true);
        }
        pd.setCancelable(false);
        pd.getWindow().setType(WindowManager.LayoutParams.TYPE_KEYGUARD_DIALOG);

        pd.show();

        sInstance.mProgressDialog = pd;
        sInstance.mContext = context;
        sInstance.mPowerManager = (PowerManager)context.getSystemService(Context.POWER_SERVICE);

        //确保系统不会进入休眠状态
        sInstance.mCpuWakeLock = null;
        try {
            sInstance.mCpuWakeLock = sInstance.mPowerManager.newWakeLock(
                    PowerManager.PARTIAL_WAKE_LOCK, TAG + "-cpu");
            sInstance.mCpuWakeLock.setReferenceCounted(false);
            sInstance.mCpuWakeLock.acquire();
        } catch (SecurityException e) {
            sInstance.mCpuWakeLock = null;
        }

        //当处理亮屏状态，则获取亮屏锁，提供用户体验
        sInstance.mScreenWakeLock = null;
        if (sInstance.mPowerManager.isScreenOn()) {
            try {
                sInstance.mScreenWakeLock = sInstance.mPowerManager.newWakeLock(
                        PowerManager.FULL_WAKE_LOCK, TAG + "-screen");
                sInstance.mScreenWakeLock.setReferenceCounted(false);
                sInstance.mScreenWakeLock.acquire();
            } catch (SecurityException e) {
                sInstance.mScreenWakeLock = null;
            }
        }

        sInstance.mHandler = new Handler() {};
        //启动线程来执行shutdown初始化【见小节2.7】
        sInstance.start();
    }


此处`ProgressDialog`根据不同reboot reason会不同UI框：

1. 重启到recovery模式，并安装更新
    - Condition：mReason == REBOOT_RECOVERY and mRebootUpdate == True
    - 检查/cache/recovery/uncrypt_file文件存在，则mRebootUpdate为True
    - UI: 进度条(progress bar)
2. 重启到recovery，用于工厂重置模式
    - Condition: mReason == REBOOT_RECOVERY and mRebootUpdate == False
    - UI: 仅显示spinning circle
3. 常规重启/关机
    - Condition: Otherwise
    - UI: 仅显示spinning circle

### 2.7 SDT.run

[-> ShutdownThread.java]

    public final class ShutdownThread extends Thread {
        public void run() {
            BroadcastReceiver br = new BroadcastReceiver() {
                public void onReceive(Context context, Intent intent) {
                     //接收到该广播,则唤醒wait()操作
                    actionDone();
                }
            };

            //设置属性"sys.shutdown.requested"的值为reason
            String reason = (mReboot ? "1" : "0") + (mReason != null ? mReason : "");
            SystemProperties.set(SHUTDOWN_ACTION_PROPERTY, reason);

            if (mRebootSafeMode) {
                //如果需要重启进入安全模式，则设置"persist.sys.safemode"=1
                SystemProperties.set(REBOOT_SAFEMODE_PROPERTY, "1");
            }

            //1. 发送关机广播
            mActionDone = false;
            Intent intent = new Intent(Intent.ACTION_SHUTDOWN);
            intent.addFlags(Intent.FLAG_RECEIVER_FOREGROUND);
            mContext.sendOrderedBroadcastAsUser(intent,
                    UserHandle.ALL, null, br, mHandler, 0, null, null);
            //其中MAX_BROADCAST_TIME=10s
            final long endTime = SystemClock.elapsedRealtime() + MAX_BROADCAST_TIME;

            //循环等待,超时或者mActionDone都会结束该循环
            synchronized (mActionDoneSync) {
                while (!mActionDone) {
                    long delay = endTime - SystemClock.elapsedRealtime();
                    if (delay <= 0) {
                        break; //关机广播超时
                    } else if (mRebootUpdate) {
                        int status = (int)((MAX_BROADCAST_TIME - delay) * 1.0 *
                                BROADCAST_STOP_PERCENT / MAX_BROADCAST_TIME);
                        sInstance.setRebootProgress(status, null);
                    }
                    try {
                        //最长等待时间为500ms
                        mActionDoneSync.wait(Math.min(delay, PHONE_STATE_POLL_SLEEP_MSEC));
                    } catch (InterruptedException e) {
                    }
                }
            }
            if (mRebootUpdate) {
                sInstance.setRebootProgress(BROADCAST_STOP_PERCENT, null);
            }

            final IActivityManager am =
                ActivityManagerNative.asInterface(ServiceManager.checkService("activity"));
            if (am != null) {
                //2. 关闭AMS [见流程2.7.1]
                am.shutdown(MAX_BROADCAST_TIME);
            }
            if (mRebootUpdate) {
                sInstance.setRebootProgress(ACTIVITY_MANAGER_STOP_PERCENT, null);
            }

            final PackageManagerService pm = (PackageManagerService)
                ServiceManager.getService("package");
            if (pm != null) {
                //3. 关闭PMS [见流程2.7.2]
                pm.shutdown();
            }
            if (mRebootUpdate) {
                sInstance.setRebootProgress(PACKAGE_MANAGER_STOP_PERCENT, null);
            }

            //4. 关闭radios [见流程2.7.3]
            shutdownRadios(MAX_RADIO_WAIT_TIME);
            if (mRebootUpdate) {
                sInstance.setRebootProgress(RADIO_STOP_PERCENT, null);
            }

            IMountShutdownObserver observer = new IMountShutdownObserver.Stub() {
                public void onShutDownComplete(int statusCode) throws RemoteException {
                    actionDone();
                }
            };

            mActionDone = false;
            //其中MAX_SHUTDOWN_WAIT_TIME=20s
            final long endShutTime = SystemClock.elapsedRealtime() + MAX_SHUTDOWN_WAIT_TIME;
            synchronized (mActionDoneSync) {
                final IMountService mount = IMountService.Stub.asInterface(
                        ServiceManager.checkService("mount"));
                if (mount != null) {
                    //5. 关闭MountService [见流程2.7.3]
                    mount.shutdown(observer);
                }
                while (!mActionDone) {
                    long delay = endShutTime - SystemClock.elapsedRealtime();
                    if (delay <= 0) {
                        break; // Mount观察者广播超时
                    } else if (mRebootUpdate) {
                        int status = (int)((MAX_SHUTDOWN_WAIT_TIME - delay) * 1.0 *
                                (MOUNT_SERVICE_STOP_PERCENT - RADIO_STOP_PERCENT) /
                                MAX_SHUTDOWN_WAIT_TIME);
                        status += RADIO_STOP_PERCENT;
                        sInstance.setRebootProgress(status, null);
                    }
                    try {
                        //当收到mActionDoneSync.notifyAll()，则继续往下执行程序
                        mActionDoneSync.wait(Math.min(delay, PHONE_STATE_POLL_SLEEP_MSEC));
                    } catch (InterruptedException e) {
                    }
                }
            }
            ...
            //【见流程2.8】
            rebootOrShutdown(mContext, mReboot, mReason);
        }
    }

设置"sys.shutdown.requested"，记录下`mReboot`和`mReason`。如果是进入安全模式，则"persist.sys.safemode=1"。

接下来主要关闭一些系统服务：

1. 发送关机广播
2. 关闭AMS
3. 关闭PMS
4. 关闭radios
5. 关闭MountService

之后就需要进入重启/关机流程。

### 2.7.1 AMS.shutdown

通过AMP.shutdown，通过binder调用到AMS.shutdown.

    public boolean shutdown(int timeout) {
        //权限检测
        if (checkCallingPermission(android.Manifest.permission.SHUTDOWN)
                != PackageManager.PERMISSION_GRANTED) {
            throw new SecurityException("Requires permission "
                    + android.Manifest.permission.SHUTDOWN);
        }

        boolean timedout = false;

        synchronized(this) {
            mShuttingDown = true;
            //禁止WMS继续处理Event
            updateEventDispatchingLocked();
            //调用ASS处理shutdown操作
            timedout = mStackSupervisor.shutdownLocked(timeout);
        }

        mAppOpsService.shutdown();
        if (mUsageStatsService != null) {
            mUsageStatsService.prepareShutdown();
        }
        mBatteryStatsService.shutdown();
        synchronized (this) {
            mProcessStats.shutdownLocked();
            notifyTaskPersisterLocked(null, true);
        }

        return timedout;
    }

此处timeout为MAX_BROADCAST_TIME=10s

#### 2.7.2 PMS.shutdown

    public void shutdown() {
        mPackageUsage.write(true);
    }

此处mPackageUsage数据类型是PMS的内部类PackageUsage。

    private class PackageUsage {
        void write(boolean force) {
            if (force) {
                writeInternal();
                return;
            }
            ...
        }
    }

对于force=true，接下来调用writeInternal方法。

    private class PackageUsage {
        private void writeInternal() {
            synchronized (mPackages) {
                synchronized (mFileLock) {
                    //file是指/data/system/package-usage.list
                    AtomicFile file = getFile();
                    FileOutputStream f = null;
                    try {
                        //将原来的文件记录到package-usage.list.bak
                        f = file.startWrite();
                        BufferedOutputStream out = new BufferedOutputStream(f);
                        FileUtils.setPermissions(file.getBaseFile().getPath(), 0640, SYSTEM_UID, PACKAGE_INFO_GID);
                        StringBuilder sb = new StringBuilder();
                        for (PackageParser.Package pkg : mPackages.values()) {
                            if (pkg.mLastPackageUsageTimeInMills == 0) {
                                continue;
                            }
                            sb.setLength(0);
                            sb.append(pkg.packageName);
                            sb.append(' ');
                            sb.append((long)pkg.mLastPackageUsageTimeInMills);
                            sb.append('\n');
                            out.write(sb.toString().getBytes(StandardCharsets.US_ASCII));
                        }
                        out.flush();
                        //将文件内容同步到磁盘，并删除.bak文件
                        file.finishWrite(f);
                    } catch (IOException e) {
                        if (f != null) {
                            file.failWrite(f);
                        }
                        Log.e(TAG, "Failed to write package usage times", e);
                    }
                }
            }
            mLastWritten.set(SystemClock.elapsedRealtime());
        }
    }

/data/system/package-usage.list文件中每一行记录一条package及其上次使用时间(单位ms)。

由于IO操作的过程中，写入文件并非立刻就会真正意义上写入物理磁盘，以及在写入文件的过程中还可能中断或者出错等原因的考虑，采用的策略是先将老的文件package-usage.list，重命为增加后缀package-usage.list.bak；然后再往package-usage.list文件写入新的数据，数据写完之后再执行sync操作，将内存数据彻底写入物理磁盘，此时便可以安全地删除原来的package-usage.list.bak文件。

#### 2.7.3 ST.shutdownRadios

[-> ShutdownThread.java]

    private void shutdownRadios(final int timeout) {
        final long endTime = SystemClock.elapsedRealtime() + timeout;
        Thread t = new Thread() {
            public void run() {
                boolean nfcOff;
                boolean bluetoothOff;
                boolean radioOff;

                final INfcAdapter nfc =
                        INfcAdapter.Stub.asInterface(ServiceManager.checkService("nfc"));
                final ITelephony phone =
                        ITelephony.Stub.asInterface(ServiceManager.checkService("phone"));
                final IBluetoothManager bluetooth =
                        IBluetoothManager.Stub.asInterface(ServiceManager.checkService(
                                BluetoothAdapter.BLUETOOTH_MANAGER_SERVICE));

                nfcOff = nfc == null || nfc.getState() == NfcAdapter.STATE_OFF;
                if (!nfcOff) {
                    nfc.disable(false);//关闭NFC
                }

                bluetoothOff = bluetooth == null || !bluetooth.isEnabled();
                if (!bluetoothOff) {
                    bluetooth.disable(false);  //关闭Bluetooth
                }

                radioOff = phone == null || !phone.needMobileRadioShutdown();
                if (!radioOff) {
                    phone.shutdownMobileRadios(); //关闭cellular radios
                }
                ...

                //等待NFC, Bluetooth, Radio
                long delay = endTime - SystemClock.elapsedRealtime();
                while (delay > 0) {
                    ...
                    if (radioOff && bluetoothOff && nfcOff) {
                        Log.i(TAG, "NFC, Radio and Bluetooth shutdown complete.");
                        break;
                    }
                    //每间隔500ms，check一次，直到nfc、bluetooth、radio全部关闭或者超时才会退出循环
                    SystemClock.sleep(PHONE_STATE_POLL_SLEEP_MSEC);
                    delay = endTime - SystemClock.elapsedRealtime();
                }
            }
        };

        t.start();
        try {
            t.join(timeout);
        } catch (InterruptedException ex) {
        }
    }

创建新的线程来处理NFC, Radio and Bluetooth这些射频相关的模块的shutdown过程。每间隔500ms，check一次，直到nfc、bluetooth、radio全部关闭或者超时(MAX_RADIO_WAIT_TIME=12s)才会退出循环。

#### 2.7.4 MS.shutdown

[-> MountService.java]

    public void shutdown(final IMountShutdownObserver observer) {
        enforcePermission(android.Manifest.permission.SHUTDOWN);
        //向名为“MountService”的线程发送H_SHUTDOWN消息
        mHandler.obtainMessage(H_SHUTDOWN, observer).sendToTarget();
    }

`MountService`线程收到消息后进入handleMessage出来相应消息

    class MountServiceHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case H_SHUTDOWN: {
                    final IMountShutdownObserver obs = (IMountShutdownObserver) msg.obj;
                    boolean success = false;
                    try {
                        //向vold发送shutdown命令
                        success = mConnector.execute("volume", "shutdown").isClassOk();
                    } catch (NativeDaemonConnectorException ignored) {
                    }
                    if (obs != null) {
                        try {
                            //回调方法，告知关闭工作已完成
                            obs.onShutDownComplete(success ? 0 : -1);
                        } catch (RemoteException ignored) {
                        }
                    }
                    break;
                }
                ...
            }
        }
    }

observer的回调方法onShutDownComplete()，会调用actionDone()，该方法通知mActionDoneSync已完成

    void actionDone() {
        synchronized (mActionDoneSync) {
            mActionDone = true;
            mActionDoneSync.notifyAll();
        }
    }

调用mActionDoneSync.notifyAll()之后，那么便可以继续往下执行rebootOrShutdown方法。

### 2.8 SDT.rebootOrShutdown

[-> ShutdownThread.java]

    public static void rebootOrShutdown(final Context context, boolean reboot, String reason) {
        if (reboot) {
            Log.i(TAG, "Rebooting, reason: " + reason);
            //【见小节2.9】
            PowerManagerService.lowLevelReboot(reason);
            Log.e(TAG, "Reboot failed, will attempt shutdown instead");
            reason = null;
        } else if (SHUTDOWN_VIBRATE_MS > 0 && context != null) {
            ...
        }

        //关闭电源 [见流程2.10]
        PowerManagerService.lowLevelShutdown(reason);
    }

对于重启原因:

- logcat会直接输出`Rebooting, reason: `;
- 如果重启失败，则会输出`Reboot failed`;
，- 果无法重启，则会尝试直接关机。

### 2.9 PMS.lowLevelReboot

    public static void lowLevelReboot(String reason) {
        if (reason == null) {
            reason = "";
        }
        if (reason.equals(PowerManager.REBOOT_RECOVERY)) {
            SystemProperties.set("ctl.start", "pre-recovery");
        } else {
            SystemProperties.set("sys.powerctl", "reboot," + reason);
        }
        try {
            Thread.sleep(20 * 1000L);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        Slog.wtf(TAG, "Unexpected return from lowLevelReboot!");
    }

- 当reboot原因是“recovery”，则设置属性`ctl.start=pre-recovery`；
- 当其他情况，则设置属性"sys.powerctl=reboot,[reason]"。

到此，framework层面的重启就流程基本介绍完了，那么接下来就要进入属性服务，即设置`sys.powerctl=reboot,`。

## 三、总结

先用一句话总结，从最开始的PM.reboot()，经过层层调用，最终重启的核心方法等价于调用SystemProperties.set("sys.powerctl", "reboot," + reason); 也就意味着调用下面命令，也能重启手机：

    adb shell setprop sys.powerctl reboot

后续,还会进一步上面命令的执行流程，如何进入native，如何进入kernel来完成重启的，以及PM.reboot如何触发的。
