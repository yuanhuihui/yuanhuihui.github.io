---
layout: post
title:  "Android ANR原理分析"
date:   2016-07-02 23:39:00
catalog:  true
tags:
    - android
    - debug
    - stability
---

## 一、概述

ANR(Application Not responding)，是指应用程序未响应，Android系统对于一些事件需要在一定的时间范围内完成，如果超过预定时间能未能得到有效响应或者响应时间过长，都会造成ANR。一般地，这时往往会弹出一个提示框，告知用户当前xxx未响应，用户可选择继续等待或者Force Close。

那么哪些场景会造成ANR呢？

- Service Timeout:服务在20s内未执行完成；
- BroadcastQueue Timeout：比如前台广播在10s内执行完成
- ContentProvider Timeout：内容提供者执行超时
- inputDispatching Timeout: 输入事件分发超时5s，包括按键分发事件的超时。

## 二、ANR触发时机

### 2.1 Service Timeout

Service Timeout触发时机，简单说就是AMS中的`mHandler`收到`SERVICE_TIMEOUT_MSG`消息时触发。

在前面文章[startService流程分析](http://gityuan.com/2016/03/06/start-service/)详细介绍Service启动流程，在Service所在进程attach到system_server进程的过程中会调用`realStartServiceLocked()`方法

#### 2.1.1 realStartServiceLocked

[-> ActiveServices.java]

    private final void realStartServiceLocked(ServiceRecord r,
            ProcessRecord app, boolean execInFg) throws RemoteException {
        ...
        //发送delay消息(SERVICE_TIMEOUT_MSG)，【见小节2.1.2】
        bumpServiceExecutingLocked(r, execInFg, "create");
        try {
            ...
            //最终执行服务的onCreate()方法
            app.thread.scheduleCreateService(r, r.serviceInfo,
                    mAm.compatibilityInfoForPackageLocked(r.serviceInfo.applicationInfo),
                    app.repProcState);

            } catch (DeadObjectException e) {
                ...
        } finally {
            if (!created) {
                //当service启动完毕，则remove SERVICE_TIMEOUT_MSG消息【见小节2.1.3】
                serviceDoneExecutingLocked(r, inDestroying, inDestroying);
                ...
            }
        }
    }

#### 2.1.2 bumpServiceExecutingLocked

该方法的主要工作发送delay消息(SERVICE_TIMEOUT_MSG)

    private final void bumpServiceExecutingLocked(ServiceRecord r, boolean fg, String why) {
        ...
        scheduleServiceTimeoutLocked(r.app);
    }
    void scheduleServiceTimeoutLocked(ProcessRecord proc) {
        if (proc.executingServices.size() == 0 || proc.thread == null) {
            return;
        }
        long now = SystemClock.uptimeMillis();
        Message msg = mAm.mHandler.obtainMessage(
                ActivityManagerService.SERVICE_TIMEOUT_MSG);
        msg.obj = proc;
        //当超时后仍没有remove该SERVICE_TIMEOUT_MSG消息，则执行service Timeout流程【见2.1.4】
        mAm.mHandler.sendMessageAtTime(msg,
                proc.execServicesFg ? (now+SERVICE_TIMEOUT) : (now+ SERVICE_BACKGROUND_TIMEOUT));
    }


- 对于前台服务，则超时为`SERVICE_TIMEOUT`，即timeout=20s；
- 对于后台服务，则超时为`SERVICE_BACKGROUND_TIMEOUT`，即timeout=200s；

#### 2.1.3 serviceDoneExecutingLocked

该方法的主要工作是当service启动完成，则移除service Timeout消息。

    private void serviceDoneExecutingLocked(ServiceRecord r, boolean inDestroying,
                boolean finishing) {
        ...
        if (r.executeNesting <= 0) {
            if (r.app != null) {
                r.app.execServicesFg = false;
                r.app.executingServices.remove(r);
                if (r.app.executingServices.size() == 0) {
                    //当前服务所在进程中没有正在执行的service
                    mAm.mHandler.removeMessages(ActivityManagerService.SERVICE_TIMEOUT_MSG, r.app);
            ...
        }
        ...
    }

#### 2.1.4 SERVICE_TIMEOUT_MSG

到此不难理解，当`SERVICE_TIMEOUT_MSG`消息成功发送时，则AMS中的`mHandler`收到该消息则触发调用`serviceTimeout`。

    final class MainHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case SERVICE_TIMEOUT_MSG: {
                    ...
                    //【见小节2.1.5】
                    mServices.serviceTimeout((ProcessRecord)msg.obj);
                } break;
                ...
            }
            ...
        }
    }

#### 2.1.5 serviceTimeout

[-> ActiveServices.java]

    void serviceTimeout(ProcessRecord proc) {
        String anrMessage = null;

        synchronized(mAm) {
            if (proc.executingServices.size() == 0 || proc.thread == null) {
                return;
            }
            final long now = SystemClock.uptimeMillis();
            final long maxTime =  now -
                    (proc.execServicesFg ? SERVICE_TIMEOUT : SERVICE_BACKGROUND_TIMEOUT);
            ServiceRecord timeout = null;
            long nextTime = 0;
            for (int i=proc.executingServices.size()-1; i>=0; i--) {
                ServiceRecord sr = proc.executingServices.valueAt(i);
                if (sr.executingStart < maxTime) {
                    timeout = sr;
                    break;
                }
                if (sr.executingStart > nextTime) {
                    nextTime = sr.executingStart;
                }
            }
            if (timeout != null && mAm.mLruProcesses.contains(proc)) {
                Slog.w(TAG, "Timeout executing service: " + timeout);
                StringWriter sw = new StringWriter();
                PrintWriter pw = new FastPrintWriter(sw, false, 1024);
                pw.println(timeout);
                timeout.dump(pw, "    ");
                pw.close();
                mLastAnrDump = sw.toString();
                mAm.mHandler.removeCallbacks(mLastAnrDumpClearer);
                mAm.mHandler.postDelayed(mLastAnrDumpClearer, LAST_ANR_LIFETIME_DURATION_MSECS);
                anrMessage = "executing service " + timeout.shortName;
            }
        }

        if (anrMessage != null) {
            //当存在timeout的service，则执行appNotResponding【见小节3.1】
            mAm.appNotResponding(proc, null, null, false, anrMessage);
        }
    }

其中anrMessage的内容为"executing service [发送超时serviceRecord信息]";


### 2.2 BroadcastQueue Timeout

BroadcastQueue Timeout触发时机，简单说就是BroadcastQueue中的`mHandler`收到`BROADCAST_TIMEOUT_MSG`消息时触发。

在前面文章[Android Broadcast广播机制分析](http://gityuan.com/2016/06/04/broadcast-receiver/)详细介绍广播启动流程，在发送广播过程中会执行`scheduleBroadcastsLocked`方法来处理相关的广播，然后会调用到`processNextBroadcast`方法来处理下一条广播。

processNextBroadcast执行过程分4步骤：        

- step1. 处理并行广播
- step2. 处理当前有序广播
- step3. 获取下条有序广播
- step4. 处理下条有序广播

#### 2.2.1 processNextBroadcast

[-> BroadcastQueue.java]

    final void processNextBroadcast(boolean fromMsg) {
        synchronized(mService) {
            ...
            //step 2: 处理当前有序广播
            do {
                r = mOrderedBroadcasts.get(0);
                //获取所有该广播所有的接收者
                int numReceivers = (r.receivers != null) ? r.receivers.size() : 0;
                if (mService.mProcessesReady && r.dispatchTime > 0) {
                    long now = SystemClock.uptimeMillis();
                    if ((numReceivers > 0) &&
                            (now > r.dispatchTime + (2*mTimeoutPeriod*numReceivers))) {
                        //当广播处理时间超时，则强制结束这条广播【见小节2.2.5】
                        broadcastTimeoutLocked(false);
                        ...
                    }
                }
                if (r.receivers == null || r.nextReceiver >= numReceivers
                        || r.resultAbort || forceReceive) {
                    if (r.resultTo != null) {
                        //处理广播消息消息
                        performReceiveLocked(r.callerApp, r.resultTo,
                            new Intent(r.intent), r.resultCode,
                            r.resultData, r.resultExtras, false, false, r.userId);
                        r.resultTo = null;
                    }
                    //取消BROADCAST_TIMEOUT_MSG消息【见小节2.2.3】
                    cancelBroadcastTimeoutLocked();
                }
            } while (r == null);
            ...

            //step 3: 获取下条有序广播
            r.receiverTime = SystemClock.uptimeMillis();
            if (!mPendingBroadcastTimeoutMessage) {
                long timeoutTime = r.receiverTime + mTimeoutPeriod;
                //设置广播超时时间，发送BROADCAST_TIMEOUT_MSG【见小节2.2.2】
                setBroadcastTimeoutLocked(timeoutTime);
            }
            ...
        }
    }

对于广播超时处理时机：

1. 首先在step3的过程中setBroadcastTimeoutLocked(timeoutTime) 设置超时广播消息；
2. 然后在step2根据广播处理情况来处理：
    - 当广播接收者等待时间过长，则调用broadcastTimeoutLocked(false);
    - 当，cancelBroadcastTimeoutLocked

#### 2.2.2 setBroadcastTimeoutLocked

    final void setBroadcastTimeoutLocked(long timeoutTime) {
        if (! mPendingBroadcastTimeoutMessage) {
            Message msg = mHandler.obtainMessage(BROADCAST_TIMEOUT_MSG, this);
            mHandler.sendMessageAtTime(msg, timeoutTime);
            mPendingBroadcastTimeoutMessage = true;
        }
    }

设置定时广播BROADCAST_TIMEOUT_MSG，即当前往后推mTimeoutPeriod时间广播还没处理完毕，则进入广播超时流程。

- 对于前台广播，则超时为`BROADCAST_FG_TIMEOUT`，即timeout=10s；
- 对于后台广播，则超时为`BROADCAST_BG_TIMEOUT`，即timeout=60s。


#### 2.2.3 cancelBroadcastTimeoutLocked

    final void cancelBroadcastTimeoutLocked() {
        if (mPendingBroadcastTimeoutMessage) {
            mHandler.removeMessages(BROADCAST_TIMEOUT_MSG, this);
            mPendingBroadcastTimeoutMessage = false;
        }
    }

移除广播超时消息BROADCAST_TIMEOUT_MSG

#### 2.2.4 BROADCAST_TIMEOUT_MSG

到此不难理解，当`BROADCAST_TIMEOUT_MSG`消息成功发送时，则AMS中的`mHandler`收到该消息则触发调用`serviceTimeout`。

    private final class BroadcastHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case BROADCAST_TIMEOUT_MSG: {
                    synchronized (mService) {
                        //【见小节2.2.5】
                        broadcastTimeoutLocked(true);
                    }
                } break;
                ...
            }
            ...
        }
    }

#### 2.2.5 broadcastTimeoutLocked
[-> BroadcastRecord.java]

    final void broadcastTimeoutLocked(boolean fromMsg) {
        if (fromMsg) {
            mPendingBroadcastTimeoutMessage = false;
        }

        if (mOrderedBroadcasts.size() == 0) {
            return;
        }

        long now = SystemClock.uptimeMillis();
        BroadcastRecord r = mOrderedBroadcasts.get(0);
        if (fromMsg) {
            if (mService.mDidDexOpt) {
                //延迟timeouts直到dexopt结束
                mService.mDidDexOpt = false;
                long timeoutTime = SystemClock.uptimeMillis() + mTimeoutPeriod;
                setBroadcastTimeoutLocked(timeoutTime);
                return;
            }
            if (!mService.mProcessesReady) {
                //当系统还没有准备就绪时，广播处理流程中不存在广播超时
                return;
            }

            long timeoutTime = r.receiverTime + mTimeoutPeriod;
            if (timeoutTime > now) {
                //过早的timeout，重新设置广播超时
                setBroadcastTimeoutLocked(timeoutTime);
                return;
            }
        }

        BroadcastRecord br = mOrderedBroadcasts.get(0);
        if (br.state == BroadcastRecord.WAITING_SERVICES) {
            //广播已经处理完成，但需要等待已启动service执行完成。当等待足够时间，则处理下一条广播。
            br.curComponent = null;
            br.state = BroadcastRecord.IDLE;
            processNextBroadcast(false);
            return;
        }

        r.receiverTime = now;
        //当前BroadcastRecord的anr次数执行加1操作
        r.anrCount++;

        if (r.nextReceiver <= 0) {
            return;
        }

        ProcessRecord app = null;
        String anrMessage = null;

        Object curReceiver = r.receivers.get(r.nextReceiver-1);
        //根据情况记录广播接收者丢弃的EventLog
        logBroadcastReceiverDiscardLocked(r);
        if (curReceiver instanceof BroadcastFilter) {
            BroadcastFilter bf = (BroadcastFilter)curReceiver;
            if (bf.receiverList.pid != 0
                    && bf.receiverList.pid != ActivityManagerService.MY_PID) {
                synchronized (mService.mPidsSelfLocked) {
                    app = mService.mPidsSelfLocked.get(
                            bf.receiverList.pid);
                }
            }
        } else {
            app = r.curApp;
        }

        if (app != null) {
            anrMessage = "Broadcast of " + r.intent.toString();
        }

        if (mPendingBroadcast == r) {
            mPendingBroadcast = null;
        }

        //继续移动到下一个广播接收者
        finishReceiverLocked(r, r.resultCode, r.resultData,
                r.resultExtras, r.resultAbort, false);
        scheduleBroadcastsLocked();

        if (anrMessage != null) {
            //【见小节2.2.6】
            mHandler.post(new AppNotResponding(app, anrMessage));
        }
    }

#### 2.2.6 AppNotResponding

[-> BroadcastQueue.java]

    private final class AppNotResponding implements Runnable {
        ...
        public void run() {
            //【见小节3.1】
            mService.appNotResponding(mApp, null, null, false, mAnnotation);
        }
    }


### 2.3 ContentProvider Timeout

#### 2.3.1 AMS.appNotRespondingViaProvider

    public void appNotRespondingViaProvider(IBinder connection) {
        enforceCallingPermission(
                android.Manifest.permission.REMOVE_TASKS, "appNotRespondingViaProvider()");

        final ContentProviderConnection conn = (ContentProviderConnection) connection;
        if (conn == null) {
            return;
        }

        final ProcessRecord host = conn.provider.proc;
        //无法找到provider所处的进程
        if (host == null) {
            return;
        }

        final long token = Binder.clearCallingIdentity();
        try {
            //【见小节3.1】
            appNotResponding(host, null, null, false, "ContentProvider not responding");
        } finally {
            Binder.restoreCallingIdentity(token);
        }
    }

Timeout时间20s

调用链：

    ContentProviderClient.NotRespondingRunnable.run
        ContextImpl.ApplicationContentResolver.appNotRespondingViaProvider
            ActivityThread.appNotRespondingViaProvider
                AMP.appNotRespondingViaProvider
                    AMS.appNotRespondingViaProvider

### 2.4 inputDispatching Timeout

在native层InputDispatcher.cpp中经过层层调用，此处先省略过程，后续再展开，从native层com_android_server_input_InputManagerService调用到java层InputManagerService。

#### 2.4.1 IMS.notifyANR
[-> InputManagerService.java]

    private long notifyANR(InputApplicationHandle inputApplicationHandle,
            InputWindowHandle inputWindowHandle, String reason) {
        //【见小节2.4.2】
        return mWindowManagerCallbacks.notifyANR(
                inputApplicationHandle, inputWindowHandle, reason);
    }

mWindowManagerCallbacks为InputMonitor对象

#### 2.4.2 notifyANR
[-> InputMonitor.java]

    public long notifyANR(InputApplicationHandle inputApplicationHandle,
            InputWindowHandle inputWindowHandle, String reason) {
        AppWindowToken appWindowToken = null;
        WindowState windowState = null;
        boolean aboveSystem = false;
        synchronized (mService.mWindowMap) {
            if (inputWindowHandle != null) {
                windowState = (WindowState) inputWindowHandle.windowState;
                if (windowState != null) {
                    appWindowToken = windowState.mAppToken;
                }
            }
            if (appWindowToken == null && inputApplicationHandle != null) {
                appWindowToken = (AppWindowToken)inputApplicationHandle.appWindowToken;
            }
            //输出input事件分发超时log
            if (windowState != null) {
                Slog.i(WindowManagerService.TAG, "Input event dispatching timed out "
                        + "sending to " + windowState.mAttrs.getTitle()
                        + ".  Reason: " + reason);
                int systemAlertLayer = mService.mPolicy.windowTypeToLayerLw(
                        WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
                aboveSystem = windowState.mBaseLayer > systemAlertLayer;
            } else if (appWindowToken != null) {
                Slog.i(WindowManagerService.TAG, "Input event dispatching timed out "
                        + "sending to application " + appWindowToken.stringName
                        + ".  Reason: " + reason);
            } else {
                Slog.i(WindowManagerService.TAG, "Input event dispatching timed out "
                        + ".  Reason: " + reason);
            }
            mService.saveANRStateLocked(appWindowToken, windowState, reason);
        }

        if (appWindowToken != null && appWindowToken.appToken != null) {
            //【见小节2.5.1】
            boolean abort = appWindowToken.appToken.keyDispatchingTimedOut(reason);
            if (! abort) {
                return appWindowToken.inputDispatchingTimeoutNanos;
            }
        } else if (windowState != null) {
            //AMP经过binder，最终调用到AMS【见小节2.4.3】
            long timeout = ActivityManagerNative.getDefault().inputDispatchingTimedOut(
                    windowState.mSession.mPid, aboveSystem, reason);
            if (timeout >= 0) {
                return timeout * 1000000L; //转化为纳秒
            }
        }
        return 0;
    }


#### 2.4.3 AMS.inputDispatchingTimedOut

    public long inputDispatchingTimedOut(int pid, final boolean aboveSystem, String reason) {
        ...
        ProcessRecord proc;
        long timeout;
        synchronized (this) {
            synchronized (mPidsSelfLocked) {
                proc = mPidsSelfLocked.get(pid); //根据pid查看进程record
            }
            timeout = getInputDispatchingTimeoutLocked(proc);
        }
        //【见小节2.4.4】
        if (!inputDispatchingTimedOut(proc, null, null, aboveSystem, reason)) {
            return -1;
        }

        return timeout;
    }

inputDispatching的超时为`KEY_DISPATCHING_TIMEOUT`，即timeout = 5s

#### 2.4.4 AMS.inputDispatchingTimedOut

    public boolean inputDispatchingTimedOut(final ProcessRecord proc,
            final ActivityRecord activity, final ActivityRecord parent,
            final boolean aboveSystem, String reason) {
        ...
        final String annotation;
        if (reason == null) {
            annotation = "Input dispatching timed out";
        } else {
            annotation = "Input dispatching timed out (" + reason + ")";
        }

        if (proc != null) {
            ...
            mHandler.post(new Runnable() {
                public void run() {
                    //【见小节3.1】
                    appNotResponding(proc, activity, parent, aboveSystem, annotation);
                }
            });
        }
        return true;
    }

调用链：

    InputManagerService.notifyANR
        InputMonitor.notifyANR
            AMP.inputDispatchingTimedOut
                AMS.inputDispatchingTimedOut

### 2.5 keyDispatching Timeout

keyDispatching timout与inputDispatching Timeout流畅基本一致。

调用链：

    InputManagerService.notifyANR
        InputMonitor.notifyANR
            ActivityRecord.Token.keyDispatchingTimedOut
                AMS.inputDispatchingTimedOut


#### Token.keyDispatchingTimedOut
[-> ActivityRecord.java]

    final class ActivityRecord {
        static class Token extends IApplicationToken.Stub {
            public boolean keyDispatchingTimedOut(String reason) {
                ActivityRecord r;
                ActivityRecord anrActivity;
                ProcessRecord anrApp;
                synchronized (mService) {
                    r = tokenToActivityRecordLocked(this);
                    if (r == null) {
                        return false;
                    }
                    anrActivity = r.getWaitingHistoryRecordLocked();
                    anrApp = r != null ? r.app : null;
                }
                return mService.inputDispatchingTimedOut(anrApp, anrActivity, r, false, reason);
            }
            ...
        }
    }

对于keyDispatching Timeout的ANR，当触发该类型ANR时，如果不再有输入事件，则不会弹出ANR对话框；只有在下一次input事件产生后5s才弹出ANR提示框。

## 三、ANR工作

### 3.1 appNotResponding

[-> ActivityManagerService.java]

    final void appNotResponding(ProcessRecord app, ActivityRecord activity,
            ActivityRecord parent, boolean aboveSystem, final String annotation) {
        ArrayList<Integer> firstPids = new ArrayList<Integer>(5);
        SparseArray<Boolean> lastPids = new SparseArray<Boolean>(20);

        if (mController != null) {
            try {
                // 0 == continue, -1 = kill process immediately
                int res = mController.appEarlyNotResponding(app.processName, app.pid, annotation);
                if (res < 0 && app.pid != MY_PID) {
                    app.kill("anr", true);
                }
            } catch (RemoteException e) {
                mController = null;
                Watchdog.getInstance().setActivityController(null);
            }
        }

        long anrTime = SystemClock.uptimeMillis();
        if (MONITOR_CPU_USAGE) {
            updateCpuStatsNow();
        }

        synchronized (this) {
            // PowerManager.reboot() 会阻塞很长时间，因此忽略关机时的ANR
            if (mShuttingDown) {
                Slog.i(TAG, "During shutdown skipping ANR: " + app + " " + annotation);
                return;
            } else if (app.notResponding) {
                Slog.i(TAG, "Skipping duplicate ANR: " + app + " " + annotation);
                return;
            } else if (app.crashing) {
                Slog.i(TAG, "Crashing app skipping ANR: " + app + " " + annotation);
                return;
            }

            app.notResponding = true;

            //记录ANR
            EventLog.writeEvent(EventLogTags.AM_ANR, app.userId, app.pid,
                    app.processName, app.info.flags, annotation);

            // Dump thread traces as quickly as we can, starting with "interesting" processes.
            firstPids.add(app.pid);

            int parentPid = app.pid;
            if (parent != null && parent.app != null && parent.app.pid > 0) parentPid = parent.app.pid;
            if (parentPid != app.pid) firstPids.add(parentPid);

            if (MY_PID != app.pid && MY_PID != parentPid) firstPids.add(MY_PID);

            for (int i = mLruProcesses.size() - 1; i >= 0; i--) {
                ProcessRecord r = mLruProcesses.get(i);
                if (r != null && r.thread != null) {
                    int pid = r.pid;
                    if (pid > 0 && pid != app.pid && pid != parentPid && pid != MY_PID) {
                        if (r.persistent) {
                            firstPids.add(pid);
                        } else {
                            lastPids.put(pid, Boolean.TRUE);
                        }
                    }
                }
            }
        }

        //输出ANR到main log.
        StringBuilder info = new StringBuilder();
        info.setLength(0);
        info.append("ANR in ").append(app.processName);
        if (activity != null && activity.shortComponentName != null) {
            info.append(" (").append(activity.shortComponentName).append(")");
        }
        info.append("\n");
        info.append("PID: ").append(app.pid).append("\n");
        if (annotation != null) {
            info.append("Reason: ").append(annotation).append("\n");
        }
        if (parent != null && parent != activity) {
            info.append("Parent: ").append(parent.shortComponentName).append("\n");
        }

        final ProcessCpuTracker processCpuTracker = new ProcessCpuTracker(true);
        //dump栈信息
        File tracesFile = dumpStackTraces(true, firstPids, processCpuTracker, lastPids,
                NATIVE_STACKS_OF_INTEREST);

        String cpuInfo = null;
        if (MONITOR_CPU_USAGE) {
            updateCpuStatsNow();
            synchronized (mProcessCpuTracker) {
                //输出各个进程的CPU使用情况
                cpuInfo = mProcessCpuTracker.printCurrentState(anrTime);
            }
            //输出CPU负载
            info.append(processCpuTracker.printCurrentLoad());
            info.append(cpuInfo);
        }

        info.append(processCpuTracker.printCurrentState(anrTime));

        Slog.e(TAG, info.toString());
        if (tracesFile == null) {
            //发送signal 3来dump栈信息
            Process.sendSignal(app.pid, Process.SIGNAL_QUIT);
        }
        //将anr信息添加到dropbox
        addErrorToDropBox("anr", app, app.processName, activity, parent, annotation,
                cpuInfo, tracesFile, null);

        if (mController != null) {
            try {
                // 0 == show dialog, 1 = keep waiting, -1 = kill process immediately
                int res = mController.appNotResponding(app.processName, app.pid, info.toString());
                if (res != 0) {
                    if (res < 0 && app.pid != MY_PID) {
                        app.kill("anr", true);
                    } else {
                        synchronized (this) {
                            mServices.scheduleServiceTimeoutLocked(app);
                        }
                    }
                    return;
                }
            } catch (RemoteException e) {
                mController = null;
                Watchdog.getInstance().setActivityController(null);
            }
        }

        boolean showBackground = Settings.Secure.getInt(mContext.getContentResolver(),
                Settings.Secure.ANR_SHOW_BACKGROUND, 0) != 0;

        synchronized (this) {
            mBatteryStatsService.noteProcessAnr(app.processName, app.uid);

            if (!showBackground && !app.isInterestingToUserLocked() && app.pid != MY_PID) {
                app.kill("bg anr", true);
                return;
            }

            // Set the app's notResponding state, and look up the errorReportReceiver
            makeAppNotRespondingLocked(app,
                    activity != null ? activity.shortComponentName : null,
                    annotation != null ? "ANR " + annotation : "ANR",
                    info.toString());

            //弹出ANR对话框
            Message msg = Message.obtain();
            HashMap<String, Object> map = new HashMap<String, Object>();
            msg.what = SHOW_NOT_RESPONDING_MSG;
            msg.obj = map;
            msg.arg1 = aboveSystem ? 1 : 0;
            map.put("app", app);
            if (activity != null) {
                map.put("activity", activity);
            }

            mUiHandler.sendMessage(msg);
        }
    }

主要发送ANR， 则会输出

- 各个进程的CPU使用情况；
- CPU负载；
- IOWait；
- traces文件

## 四、其他

### 导致ANR常见情形：

- I/O阻塞
- 网络阻塞；
- onReceiver执行时间超过10s;
- 多线程死锁

### 避免ANR:

- UI线程尽量只做跟UI相关的工作
- 耗时的工作()比如数据库操作，I/O，网络操作)，采用单独的工作线程处理
- 用Handler来处理UIthread和工作thread的交互

UI线程，例如：

- Activity:onCreate(), onResume(), onDestroy(), onKeyDown(), onClick(),etc
- AsyncTask: onPreExecute(), onProgressUpdate(), onPostExecute(), onCancel,etc
- Mainthread handler: handleMessage(), post*(runnable r), etc
- ...

**ANR分析**：需要关注CPU/IO，trace死锁等数据，下篇文章再介绍。
