---
layout: post
title:  "理解Android ANR的触发情景"
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

- Service Timeout:比如前台服务在20s内未执行完成；
- BroadcastQueue Timeout：比如前台广播在10s内未执行完成
- ContentProvider Timeout：内容提供者执行超时
- InputDispatching Timeout: 输入事件分发超时5s，包括按键和触摸事件。

触发ANR的过程可分为三个步骤: 埋炸弹, 拆炸弹, 引爆炸弹

## 二 Service

Service Timeout是位于"ActivityManager"线程中的AMS.MainHandler收到`SERVICE_TIMEOUT_MSG`消息时触发。

对于Service有两类:

- 对于前台服务，则超时为SERVICE_TIMEOUT = 20s；
- 对于后台服务，则超时为SERVICE_BACKGROUND_TIMEOUT = 200s

### 2.1 埋炸弹

文章[startService流程分析](http://gityuan.com/2016/03/06/start-service/)详细介绍Service启动流程.
其中在Service进程attach到system_server进程的过程中会调用`realStartServiceLocked()`方法来埋下炸弹.

#### 2.1.1  AS.realStartServiceLocked
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
            mAm.appDiedLocked(app);
            throw e;
        } finally {
            ...
        }
    }

#### 2.1.2  AS.bumpServiceExecutingLocked

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
        
        //当超时后仍没有remove该SERVICE_TIMEOUT_MSG消息，则执行service Timeout流程【见2.3.1】
        mAm.mHandler.sendMessageAtTime(msg,
            proc.execServicesFg ? (now+SERVICE_TIMEOUT) : (now+ SERVICE_BACKGROUND_TIMEOUT));
    }

    
该方法的主要工作发送delay消息(`SERVICE_TIMEOUT_MSG`). 炸弹已埋下, 我们并不希望炸弹被引爆, 那么就需要在炸弹爆炸之前拆除炸弹.

### 2.2 拆炸弹

在system_server进程AS.realStartServiceLocked()调用的过程会埋下一颗炸弹, 超时没有启动完成则会爆炸.
那么什么时候会拆除这颗炸弹的引线呢? 经过Binder等层层调用进入目标进程的主线程handleCreateService()的过程.

#### 2.2.1  AT.handleCreateService
[-> ActivityThread.java]

        private void handleCreateService(CreateServiceData data) {
            ...
            java.lang.ClassLoader cl = packageInfo.getClassLoader();
            Service service = (Service) cl.loadClass(data.info.name).newInstance();
            ...

            try {
                //创建ContextImpl对象
                ContextImpl context = ContextImpl.createAppContext(this, packageInfo);
                context.setOuterContext(service);
                //创建Application对象
                Application app = packageInfo.makeApplication(false, mInstrumentation);
                service.attach(context, this, data.info.name, data.token, app,
                        ActivityManagerNative.getDefault());
                //调用服务onCreate()方法 
                service.onCreate();
                
                //拆除炸弹引线[见小节2.2.2]
                ActivityManagerNative.getDefault().serviceDoneExecuting(
                        data.token, SERVICE_DONE_EXECUTING_ANON, 0, 0);
            } catch (Exception e) {
                ...
            }
        }

在这个过程会创建目标服务对象,以及回调onCreate()方法, 紧接再次经过多次调用回到system_server来执行serviceDoneExecuting.
    

#### 2.2.2 AS.serviceDoneExecutingLocked

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
    
该方法的主要工作是当service启动完成，则移除服务超时消息`SERVICE_TIMEOUT_MSG`。

### 2.3 引爆炸弹

前面介绍了埋炸弹和拆炸弹的过程, 如果在炸弹倒计时结束之前成功拆卸炸弹,那么就没有爆炸的机会, 但是世事难料.
总有些极端情况下无法即时拆除炸弹,导致炸弹爆炸, 其结果就是App发生ANR. 接下来,带大家来看看炸弹爆炸的现场:

在system_server进程中有一个Handler线程, 名叫"ActivityManager".当倒计时结束便会向该Handler线程发送
一条信息`SERVICE_TIMEOUT_MSG`, 

#### 2.3.1 MainHandler.handleMessage
[-> ActivityManagerService.java ::MainHandler]

    final class MainHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case SERVICE_TIMEOUT_MSG: {
                    ...
                    //【见小节2.3.2】
                    mServices.serviceTimeout((ProcessRecord)msg.obj);
                } break;
                ...
            }
            ...
        }
    }
    
#### 2.3.2 AS.serviceTimeout

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
            //当存在timeout的service，则执行appNotResponding
            mAm.appNotResponding(proc, null, null, false, anrMessage);
        }
    }

其中anrMessage的内容为"executing service [发送超时serviceRecord信息]";


## 三 BroadcastQueue

BroadcastQueue Timeout是位于"ActivityManager"线程中的BroadcastQueue.BroadcastHandler收到`BROADCAST_TIMEOUT_MSG`消息时触发。


对于广播队列有两个: foreground队列和background队列:

- 对于前台广播，则超时为BROADCAST_FG_TIMEOUT = 10s；
- 对于后台广播，则超时为BROADCAST_BG_TIMEOUT = 60s

### 3.1 埋炸弹

文章[Android Broadcast广播机制分析](http://gityuan.com/2016/06/04/broadcast-receiver/)详细介绍广播启动流程，通过调用
processNextBroadcast来处理广播.其流程为先处理并行广播,再处理当前有序广播,最后获取并处理下条有序广播.

#### 3.1.1 processNextBroadcast
[-> BroadcastQueue.java]

    final void processNextBroadcast(boolean fromMsg) {
        synchronized(mService) {
            ...
            //part 2: 处理当前有序广播
            do {
                r = mOrderedBroadcasts.get(0);
                //获取所有该广播所有的接收者
                int numReceivers = (r.receivers != null) ? r.receivers.size() : 0;
                if (mService.mProcessesReady && r.dispatchTime > 0) {
                    long now = SystemClock.uptimeMillis();
                    if ((numReceivers > 0) &&
                            (now > r.dispatchTime + (2*mTimeoutPeriod*numReceivers))) {
                        //当广播处理时间超时，则强制结束这条广播【见小节3.3.2】
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
                    //拆炸弹【见小节3.2.1】
                    cancelBroadcastTimeoutLocked();
                }
            } while (r == null);
            ...

            //part 3: 获取下条有序广播
            r.receiverTime = SystemClock.uptimeMillis();
            if (!mPendingBroadcastTimeoutMessage) {
                long timeoutTime = r.receiverTime + mTimeoutPeriod;
                //埋炸弹【见小节3.1.3】
                setBroadcastTimeoutLocked(timeoutTime);
            }
            ...
        }
    }

对于广播超时处理时机：

1. 首先在part3的过程中setBroadcastTimeoutLocked(timeoutTime) 设置超时广播消息；
2. 然后在part2根据广播处理情况来处理：
    - 当广播接收者等待时间过长，则调用broadcastTimeoutLocked(false);
    - 当广播处理时间过长，cancelBroadcastTimeoutLocked

#### 3.1.2 setBroadcastTimeoutLocked

    final void setBroadcastTimeoutLocked(long timeoutTime) {
        if (! mPendingBroadcastTimeoutMessage) {
            Message msg = mHandler.obtainMessage(BROADCAST_TIMEOUT_MSG, this);
            mHandler.sendMessageAtTime(msg, timeoutTime);
            mPendingBroadcastTimeoutMessage = true;
        }
    }

设置定时广播BROADCAST_TIMEOUT_MSG，即当前往后推mTimeoutPeriod时间广播还没处理完毕，则进入广播超时流程。


### 3.2 拆炸弹

在processNextBroadcast()过程, 执行完performReceiveLocked,便会拆除炸弹.

#### 3.2.1 cancelBroadcastTimeoutLocked

    final void cancelBroadcastTimeoutLocked() {
        if (mPendingBroadcastTimeoutMessage) {
            mHandler.removeMessages(BROADCAST_TIMEOUT_MSG, this);
            mPendingBroadcastTimeoutMessage = false;
        }
    }

移除广播超时消息BROADCAST_TIMEOUT_MSG

### 3.3 引爆炸弹

#### 3.3.1 BroadcastHandler.handleMessage
[-> BroadcastQueue.java  ::BroadcastHandler]

    private final class BroadcastHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case BROADCAST_TIMEOUT_MSG: {
                    synchronized (mService) {
                        //【见小节3.3.2】
                        broadcastTimeoutLocked(true);
                    }
                } break;
                ...
            }
            ...
        }
    }

#### 3.3.2 broadcastTimeoutLocked
[-> BroadcastRecord.java]

    //fromMsg = true
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
            ...
            if (!mService.mProcessesReady) {
                return; //当系统还没有准备就绪时，广播处理流程中不存在广播超时
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
         Slog.w(TAG, "Receiver during timeout: " + curReceiver);
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
            // [见小节3.3.3]
            mHandler.post(new AppNotResponding(app, anrMessage));
        }
    }

#### 3.3.3 AppNotResponding
[-> BroadcastQueue.java]

    private final class AppNotResponding implements Runnable {
        ...
        public void run() {
            // 进入ANR处理流程
            mService.appNotResponding(mApp, null, null, false, mAnnotation);
        }
    }

## 四 ContentProvider

ContentProvider Timeout是位于”ActivityManager”线程中的AMS.MainHandler收到CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG消息时触发。

ContentProvider 超时为CONTENT_PROVIDER_PUBLISH_TIMEOUT = 10s. 这个跟前面的Service和BroadcastQueue完全不同,
由Provider[进程启动](http://gityuan.com/2016/10/09/app-process-create-2/)过程相关.

### 4.1 埋炸弹

文章[理解ContentProvider原理](http://gityuan.com/2016/07/30/content-provider/)详细介绍了Provider启动流程. 埋炸弹的过程
其实是在进程创建的过程,进程创建后会调用attachApplicationLocked()进入system_server进程.

#### 4.1.1  AMS.attachApplicationLocked

    private final boolean attachApplicationLocked(IApplicationThread thread,
            int pid) {
        ProcessRecord app;
        if (pid != MY_PID && pid >= 0) {
            synchronized (mPidsSelfLocked) {
                app = mPidsSelfLocked.get(pid); // 根据pid获取ProcessRecord
            }
        } 
        ...
        
        //系统处于ready状态或者该app为FLAG_PERSISTENT进程则为true
        boolean normalMode = mProcessesReady || isAllowedWhileBooting(app.info);
        List<ProviderInfo> providers = normalMode ? generateApplicationProvidersLocked(app) : null;

        //app进程存在正在启动中的provider,则超时10s后发送CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG消息
        if (providers != null && checkAppInLaunchingProvidersLocked(app)) {
            Message msg = mHandler.obtainMessage(CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG);
            msg.obj = app;
            mHandler.sendMessageDelayed(msg, CONTENT_PROVIDER_PUBLISH_TIMEOUT);
        }
        
        thread.bindApplication(...);
        ...
    }
    
10s之后引爆该炸弹

### 4.2 拆炸弹

当provider成功publish之后,便会拆除该炸弹.

#### 4.2.1 AMS.publishContentProviders

    public final void publishContentProviders(IApplicationThread caller,
           List<ContentProviderHolder> providers) {
       ...
       
       synchronized (this) {
           final ProcessRecord r = getRecordForAppLocked(caller);
           
           final int N = providers.size();
           for (int i = 0; i < N; i++) {
               ContentProviderHolder src = providers.get(i);
               ...
               ContentProviderRecord dst = r.pubProviders.get(src.info.name);
               if (dst != null) {
                   ComponentName comp = new ComponentName(dst.info.packageName, dst.info.name);
                   
                   mProviderMap.putProviderByClass(comp, dst); //将该provider添加到mProviderMap
                   String names[] = dst.info.authority.split(";");
                   for (int j = 0; j < names.length; j++) {
                       mProviderMap.putProviderByName(names[j], dst);
                   }

                   int launchingCount = mLaunchingProviders.size();
                   int j;
                   boolean wasInLaunchingProviders = false;
                   for (j = 0; j < launchingCount; j++) {
                       if (mLaunchingProviders.get(j) == dst) {
                           //将该provider移除mLaunchingProviders队列
                           mLaunchingProviders.remove(j);
                           wasInLaunchingProviders = true;
                           j--;
                           launchingCount--;
                       }
                   }
                   //成功pubish则移除该消息
                   if (wasInLaunchingProviders) {
                       mHandler.removeMessages(CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG, r);
                   }
                   synchronized (dst) {
                       dst.provider = src.provider;
                       dst.proc = r;
                       //唤醒客户端的wait等待方法
                       dst.notifyAll();
                   }
                   ...
               }
           }
       }    
    }

### 4.3 引爆炸弹

在system_server进程中有一个Handler线程, 名叫"ActivityManager".当倒计时结束便会向该Handler线程发送
一条信息`CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG`, 

#### 4.3.1 MainHandler.handleMessage
[-> ActivityManagerService.java ::MainHandler]

    final class MainHandler extends Handler {
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG: {
                    ...
                    ProcessRecord app = (ProcessRecord)msg.obj;
                    synchronized (ActivityManagerService.this) {
                        //【见小节4.3.2】
                        processContentProviderPublishTimedOutLocked(app);
                    }
                } break;
                ...
            }
            ...
        }
    }

#### 4.3.2 AMS.processContentProviderPublishTimedOutLocked


    private final void processContentProviderPublishTimedOutLocked(ProcessRecord app) {
        cleanupAppInLaunchingProvidersLocked(app, true); //[见4.3.3]
        //[见小节4.3.4]
        removeProcessLocked(app, false, true, "timeout publishing content providers");
    }

#### 4.3.3 AMS.cleanupAppInLaunchingProvidersLocked

    boolean cleanupAppInLaunchingProvidersLocked(ProcessRecord app, boolean alwaysBad) {
        boolean restart = false;
        for (int i = mLaunchingProviders.size() - 1; i >= 0; i--) {
            ContentProviderRecord cpr = mLaunchingProviders.get(i);
            if (cpr.launchingApp == app) {
                if (!alwaysBad && !app.bad && cpr.hasConnectionOrHandle()) {
                    restart = true;
                } else {
                    //移除死亡的provider
                    removeDyingProviderLocked(app, cpr, true);
                }
            }
        }
        return restart;
    }
    


removeDyingProviderLocked()的功能跟进程的存活息息相关：详见[ContentProvider引用计数](http://gityuan.com/2016/05/03/content_provider_release/) []小节4.5]

- 对于stable类型的provider(即conn.stableCount > 0),则会杀掉所有跟该provider建立stable连接的非persistent进程.
- 对于unstable类的provider(即conn.unstableCount > 0),并不会导致client进程被级联所杀.

#### 4.3.4 AMS.removeProcessLocked

    private final boolean removeProcessLocked(ProcessRecord app,
            boolean callerWillRestart, boolean allowRestart, String reason) {
        final String name = app.processName;
        final int uid = app.uid;

        //移除mProcessNames中的相应对象
        removeProcessNameLocked(name, uid);
        if (mHeavyWeightProcess == app) {
            mHandler.sendMessage(mHandler.obtainMessage(CANCEL_HEAVY_NOTIFICATION_MSG,
                    mHeavyWeightProcess.userId, 0));
            mHeavyWeightProcess = null;
        }
        boolean needRestart = false;
        if (app.pid > 0 && app.pid != MY_PID) {
            int pid = app.pid;
            synchronized (mPidsSelfLocked) {
                mPidsSelfLocked.remove(pid);
                mHandler.removeMessages(PROC_START_TIMEOUT_MSG, app);
            }
            
            ...
            boolean willRestart = false;
            if (app.persistent && !app.isolated) {
                if (!callerWillRestart) {
                    willRestart = true;
                } else {
                    needRestart = true;
                }
            }
            app.kill(reason, true); //杀进程
            handleAppDiedLocked(app, willRestart, allowRestart);
            if (willRestart) {
                removeLruProcessLocked(app);
                addAppLocked(app.info, false, null /* ABI override */);
            }
        } else {
            mRemovedProcesses.add(app);
        }
        return needRestart;
    }
    
## 五. Input

### 5.1 引爆炸弹

在native层InputDispatcher.cpp中经过层层调用，此处先省略过程，后续再展开，从native层com_android_server_input_InputManagerService调用到java层InputManagerService。

#### 5.1.1 IMS.notifyANR
[-> InputManagerService.java]

    private long notifyANR(InputApplicationHandle inputApplicationHandle,
            InputWindowHandle inputWindowHandle, String reason) {
        //【见小节5.1.2】
        return mWindowManagerCallbacks.notifyANR(
                inputApplicationHandle, inputWindowHandle, reason);
    }

mWindowManagerCallbacks为InputMonitor对象

#### 5.1.2 notifyANR
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
            //【见小节5.1.3.2】
            boolean abort = appWindowToken.appToken.keyDispatchingTimedOut(reason);
            if (! abort) {
                return appWindowToken.inputDispatchingTimeoutNanos;
            }
        } else if (windowState != null) {
            //AMP经过binder，最终调用到AMS【见小节5.1.3.1】
            long timeout = ActivityManagerNative.getDefault().inputDispatchingTimedOut(
                    windowState.mSession.mPid, aboveSystem, reason);
            if (timeout >= 0) {
                return timeout * 1000000L; //转化为纳秒
            }
        }
        return 0;
    }

发生input相关的ANR时在main log中能看到:

- Input event dispatching timed out sending to `windowState.mAttrs.getTitle()`.  Reason: + `reason`
- Input event dispatching timed out sending to application `appWindowToken.stringName`.  Reason: + `reason`
- Input event dispatching timed out. Reason: + `reason`

###### 5.1.3.1 AMS.inputDispatchingTimedOut

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
        //【见小节5.1.4】
        if (!inputDispatchingTimedOut(proc, null, null, aboveSystem, reason)) {
            return -1;
        }

        return timeout;
    }

inputDispatching的超时为`KEY_DISPATCHING_TIMEOUT`，即timeout = 5s


###### 5.1.3.2 Token.keyDispatchingTimedOut
[-> ActivityRecord.java :: Token]

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
                //[见小节5.1.4]
                return mService.inputDispatchingTimedOut(anrApp, anrActivity, r, false, reason);
            }
            ...
        }
    }
    
#### 5.1.4 AMS.inputDispatchingTimedOut

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
                    //处理ANR的流程
                    appNotResponding(proc, activity, parent, aboveSystem, annotation);
                }
            });
        }
        return true;
    }

## 六、总结

当出现ANR时，都是调用到AMS.appNotResponding()方法，详细过程见文章[理解Android ANR的处理过程](http://gityuan.com/2016/12/02/app-not-response/). 当然这里介绍的provider例外.

- 对于前台服务，则超时为SERVICE_TIMEOUT = 20s；
- 对于后台服务，则超时为SERVICE_BACKGROUND_TIMEOUT = 200s
- 对于前台广播，则超时为BROADCAST_FG_TIMEOUT = 10s；
- 对于后台广播，则超时为BROADCAST_BG_TIMEOUT = 60s
- ContentProvider超时为CONTENT_PROVIDER_PUBLISH_TIMEOUT = 10s;

说明:

- 对于Service, Broadcast, Input发生ANR之后,最终都会调用AMS.appNotResponding;
- 对于provider,在其进程启动时publish过程可能会出现ANR, 则会直接杀进程以及清理相应信息,而不会弹出ANR的对话框.
当然provider也是可能有走appNotResponding()流程的case,不过超时时间是由用户自定义.

