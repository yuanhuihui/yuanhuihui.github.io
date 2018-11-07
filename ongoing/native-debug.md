---
layout: post
title:  "理解Android Crash触发机制"
date:   2018-06-09 22:19:53
catalog:    true
tags:
    - android
    - stability

---

本文基于原生Android 9.0源码来解读Crash触发机制


## 概述

APP发生Crash(崩溃)对用户的体验是非常糟糕的，我们很有必要掌握其原理来尽可能避免出现Crash。
Crash可分为Java Crash和Native Crash两大类：

- Java Crash是指执行Java层代码时发生未捕获的异常；
- Native Crash是指执行Native代码发生异常。

http://gityuan.com/2016/06/24/app-crash/
http://gityuan.com/2016/06/25/android-native-crash/

## 一、Java Crash

RuntimeInit.java中针对未捕获的异常，分别注册用于输出日志的Handler以及杀掉该崩溃应用的handler

```
protected static final void commonInit() {
    Thread.setUncaughtExceptionPreHandler(new LoggingHandler());
    Thread.setDefaultUncaughtExceptionHandler(new KillApplicationHandler());
    ...
}

```Java
private static class LoggingHandler implements Thread.UncaughtExceptionHandler {
    @Override
    public void uncaughtException(Thread t, Throwable e) {
        if (mCrashing) return;
        if (mApplicationObject == null) {
            Clog_e(TAG, "*** FATAL EXCEPTION IN SYSTEM PROCESS: " + t.getName(), e);
        } else {
            StringBuilder message = new StringBuilder();
            message.append("FATAL EXCEPTION: ").append(t.getName()).append("\n");
            final String processName = ActivityThread.currentProcessName();
            if (processName != null) {
                message.append("Process: ").append(processName).append(", ");
            }
            message.append("PID: ").append(Process.myPid());
            Clog_e(TAG, message.toString(), e);
        }
    }
}
```

```Java
private static class KillApplicationHandler implements Thread.UncaughtExceptionHandler {
    public void uncaughtException(Thread t, Throwable e) {
        try {
            if (mCrashing) return;
            mCrashing = true;

            ActivityManager.getService().handleApplicationCrash(
                    mApplicationObject, new ApplicationErrorReport.ParcelableCrashInfo(e));
        } catch (Throwable t2) {
            ...
        } finally {
            Process.killProcess(Process.myPid());
            System.exit(10);
        }
    }
}
```

```Java
void handleApplicationCrashInner(String eventType, ProcessRecord r, String processName,
        ApplicationErrorReport.CrashInfo crashInfo) {
    EventLog.writeEvent(EventLogTags.AM_CRASH, Binder.getCallingPid(),
            UserHandle.getUserId(Binder.getCallingUid()), processName,
            r == null ? -1 : r.info.flags,
            crashInfo.exceptionClassName,
            crashInfo.exceptionMessage,
            crashInfo.throwFileName,
            crashInfo.throwLineNumber);

    addErrorToDropBox(eventType, r, processName, null, null, null, null, null, crashInfo);

    mAppErrors.crashApplication(r, crashInfo);
}
```
