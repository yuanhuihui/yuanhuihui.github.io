---
layout: post
title:  "unbindService流程分析"
date:   2016-05-02 20:22:50
catalog:  true
tags:
    - android
    - 组件系列

---

> 基于Android 6.0的源码剖析， 分析bind service的启动流程。

    /frameworks/base/core/java/android/app/ContextImpl.java
    /frameworks/base/core/java/android/app/LoadedApk.java
    /frameworks/base/core/java/android/app/IServiceConnection.aidl(自动生成Binder两端)

## 一. unbind

文章[bindService启动过程分析](http://gityuan.com/2016/05/01/bind-service/)，介绍了
bindService的过程，本文介绍其对应的另一个操作unbind。

**unbind调用链:**

    AMP.unbindService
      AMS.unbindService
        AS.unbindServiceLocked
          AS.removeConnectionLocked
            ATP.scheduleUnbindService
              AT.scheduleUnbindService
                AT.handleUnbindService
                  Service.onUnbind
            AS.bringDownServiceIfNeededLocked
              AS.bringDownServiceLocked
                ATP.scheduleUnbindService
                  AT.scheduleUnbindService
                ATP.scheduleStopService
                  AT.scheduleStopService
            

### 1.1 AMP.unbindService

... //省略，未完待续

## 二. onServiceDisconnected
当service所在进程死亡后，binderDied死亡回调后触发的。

### 2.1 binderDied
[-> LoadedApk.ServiceDispatcher.DeathMonitor]

    private final class DeathMonitor implements IBinder.DeathRecipient
    {
        DeathMonitor(ComponentName name, IBinder service) {
            mName = name;
            mService = service;
        }

        public void binderDied() {
            death(mName, mService); //【见流程2.2】
        }

        final ComponentName mName;
        final IBinder mService;
    }

### 2.2 death
[-> LoadedApk.ServiceDispatcher]

    public void death(ComponentName name, IBinder service) {
        ServiceDispatcher.ConnectionInfo old;

        synchronized (this) {
            mDied = true;
            old = mActiveConnections.remove(name);
            if (old == null || old.binder != service) {
                return;
            }
            old.binder.unlinkToDeath(old.deathMonitor, 0);
        }

        if (mActivityThread != null) {
            //【见流程2.3】
            mActivityThread.post(new RunConnection(name, service, 1));
        } else {
            doDeath(name, service);
        }
    }

### 2.3 run
[-> LoadedApk.ServiceDispatcher.RunConnection]

    private final class RunConnection implements Runnable {
        RunConnection(ComponentName name, IBinder service, int command) {
            mName = name;
            mService = service;
            mCommand = command;
        }

        public void run() {
            if (mCommand == 0) {
                doConnected(mName, mService);
            } else if (mCommand == 1) {
                doDeath(mName, mService); //【见流程2.4】
            }
        }
    }

### 2.4 doDeath
[-> LoadedApk.ServiceDispatcher]

    public void doDeath(ComponentName name, IBinder service) {
       //回调用户定义的onServiceDisconnected方法
       mConnection.onServiceDisconnected(name);
    }

## 三. 总结

1. unbind()是bind的逆操作，主要是清理bind相关对象，并不会回调onServiceDisconnected.
2. 当Service进程死亡，经过Binder死亡回调，则会进入Client端进程来执行binderDied()，经过层层调用，
最终回调用户定义的onServiceDisconnected方法。
3. 当或者stopService过程被service彻底destroy的过程，也会回调onServiceDisconnected方法。
