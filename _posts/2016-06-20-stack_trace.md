---
layout: post
title:  "简单聊一聊Throwable"
date:   2016-06-20 20:14:54
catalog:  true
tags:


---

## 一.概述

Android有一套异常处理机制, 分析Crash时最常见的便是先查看其调用栈stackTrace. 对于调用栈, 是从下往上调用的.
其中经常会遇到"Caused by", 以及"... 8 more"等信息, 具体是什么含义呢, 本文就是解答这个问题.

### 1.1 初始化Throwable对象
[-> Throwable.java]

    public Throwable(String detailMessage, Throwable cause) {
        this.detailMessage = detailMessage;
        this.cause = cause;
        this.stackTrace = EmptyArray.STACK_TRACE_ELEMENT;
        fillInStackTrace(); // [见小节1.2]
    }

### 1.2  fillInStackTrace
[-> Throwable.java]

    public Throwable fillInStackTrace() {
        if (stackTrace == null) {
            return this; 
        }
        stackState = nativeFillInStackTrace();
        stackTrace = EmptyArray.STACK_TRACE_ELEMENT;
        return this;
    }
    
## 二. 打印调用栈

### 2.1 printStackTrace
[-> Throwable.java]

    public void printStackTrace() {
        printStackTrace(System.err);
    }

    public void printStackTrace(PrintStream err) {
        try {
            printStackTrace(err, "", null); //[见小节2.2]
        } catch (IOException e) {
            throw new AssertionError();
        }
    }

### 2.2 printStackTrace
[-> Throwable.java]

    private void printStackTrace(Appendable err, String indent, StackTraceElement[] parentStack)
        throws IOException {
        err.append(toString()); //[见小节2.2.1]
        err.append("\n");

        StackTraceElement[] stack = getInternalStackTrace(); //[见小节2.2.2]
        if (stack != null) {
            //parentStack为null, 则duplicates=0;
            int duplicates = parentStack != null ? countDuplicates(stack, parentStack) : 0;
            for (int i = 0; i < stack.length - duplicates; i++) {
                err.append(indent);
                err.append("\tat ");
                err.append(stack[i].toString());
                err.append("\n");
            }

            if (duplicates > 0) {
                ...
            }
        }

        //打印suppressed异常
        if (suppressedExceptions != null) {
            for (Throwable throwable : suppressedExceptions) {
                err.append(indent);
                err.append("\tSuppressed: ");
                throwable.printStackTrace(err, indent + "\t", stack);
            }
        }

        Throwable cause = getCause();  //[见小节2.2.3]
        if (cause != null) {
            err.append(indent);
            err.append("Caused by: ");
            cause.printStackTrace(err, indent, stack); //[见小节2.2.4]
        }
    }

其中indent为空.

#### 2.2.1 toString
[-> Throwable.java]

    public String toString() {
        //获取detailMessage
        String msg = getLocalizedMessage();
        //获取exception类名
        String name = getClass().getName();
        if (msg == null) {
            return name;
        }
        return name + ": " + msg;
    }

这是输出的第一行.例如:

1. detailMessage为"Error receiving broadcast Intent";
2. name 为java.lang.RuntimeException;

则组合为: java.lang.RuntimeException: Error receiving broadcast Intent

#### 2.2.2 getInternalStackTrace

```Java
private StackTraceElement[] getInternalStackTrace() {
    if (stackTrace == EmptyArray.STACK_TRACE_ELEMENT) {
        // 当stackTrace为空, 则获取native调用栈
        stackTrace = nativeGetStackTrace(stackState); 
        stackState = null;
        return stackTrace;
    } else if (stackTrace == null) {
        return EmptyArray.STACK_TRACE_ELEMENT;
    } else {
      return stackTrace;
    }
}
```

#### 2.2.3 getCause

    public Throwable getCause() {
        if (cause == this) {
            return null;
        }
        return cause;
    }

默认cause等于this, 当创建的Throwable带有cause的话, 则返回的便是新的Throwable对象.

### 2.3 打印Caused by
[-> Throwable.java]

    private void printStackTrace(Appendable err, String indent, StackTraceElement[] parentStack)
            throws IOException {
        err.append(toString());
        err.append("\n");

        StackTraceElement[] stack = getInternalStackTrace();
        if (stack != null) {
            //获取栈帧的重复个数 [见小节2.3.1]
            int duplicates = parentStack != null ? countDuplicates(stack, parentStack) : 0;
            // 从栈顶往下依次输出 调用栈 直到跟parentStack重复的栈为止.
            for (int i = 0; i < stack.length - duplicates; i++) {
                err.append(indent);
                err.append("\tat ");
                err.append(stack[i].toString());
                err.append("\n");
            }

            if (duplicates > 0) {
                //最终以省略号结尾, 并带上栈帧重复的个数
                err.append(indent);
                err.append("\t... ");
                err.append(Integer.toString(duplicates));
                err.append(" more\n");
            }
        }

        if (suppressedExceptions != null) {
            ...
        }

        Throwable cause = getCause();
        if (cause != null) {
            ... //第二次cause为空,一般为空. 也存在级联情况
        }
    }

#### 2.3.1 countDuplicates

    private static int countDuplicates(StackTraceElement[] currentStack,
            StackTraceElement[] parentStack) {
        int duplicates = 0;
        int parentIndex = parentStack.length;
        for (int i = currentStack.length; --i >= 0 && --parentIndex >= 0;) {
            StackTraceElement parentFrame = parentStack[parentIndex];
            //比如栈帧相同的个数
            if (parentFrame.equals(currentStack[i])) {
                duplicates++;
            } else {
                break;
            }
        }
        return duplicates;
    }
    
比较parentStack和当前currentStack, 分别从栈底开始比较, 最终得到栈帧重复个数duplicates

## 三. 实例

举例说明:

    java.lang.RuntimeException: Error receiving broadcast Intent{}
    in com.android.server.notification.NotificationManagerService$3@ef5346c
    at android.app.LoadedApk$ReceiverDispatcher$Args.run(LoadedApk.java:1134)
    at android.os.Handler.handleCallback(Handler.java:751)
    at android.os.Handler.dispatchMessage(Handler.java:95)
    at android.os.Looper.loop(Looper.java:154)
    at com.android.server.SystemServer.run(SystemServer.java:352)
    at com.android.server.SystemServer.main(SystemServer.java:220)
    at java.lang.reflect.Method.invoke(Native Method)
    at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:874)
    at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:764)
    
    Caused by: java.lang.IndexOutOfBoundsException: Index: 0, Size: 0
    at java.util.ArrayList.get(ArrayList.java:411)
    at com.android.server.notification.NotificationManagerService$NotificationRankers.onUserSwitched(NotificationManagerService.java:3912)
    at com.android.server.notification.NotificationManagerService$3.onReceive(NotificationManagerService.java:804)
    at android.app.LoadedApk$ReceiverDispatcher$Args.run(LoadedApk.java:1124)
    ... 8 more
    
可以看出, Args.run()的1134行抛出异常RuntimeException; 造成这个异常的原因是该方法的1124行代码出现IndexOutOfBoundsException(数组越界).
这两个stack栈底重复的栈帧个数为8个. 既然是重复了8个, 那么展开就等价于:

    java.lang.RuntimeException: Error receiving broadcast Intent{}
    in com.android.server.notification.NotificationManagerService$3@ef5346c
    at android.app.LoadedApk$ReceiverDispatcher$Args.run(LoadedApk.java:1134)
    at android.os.Handler.handleCallback(Handler.java:751)
    at android.os.Handler.dispatchMessage(Handler.java:95)
    at android.os.Looper.loop(Looper.java:154)
    at com.android.server.SystemServer.run(SystemServer.java:352)
    at com.android.server.SystemServer.main(SystemServer.java:220)
    at java.lang.reflect.Method.invoke(Native Method)
    at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:874)
    at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:764)

    Caused by: java.lang.IndexOutOfBoundsException: Index: 0, Size: 0
    at java.util.ArrayList.get(ArrayList.java:411)
    at com.android.server.notification.NotificationManagerService$NotificationRankers.onUserSwitched(NotificationManagerService.java:3912)
    at com.android.server.notification.NotificationManagerService$3.onReceive(NotificationManagerService.java:804)
    at android.app.LoadedApk$ReceiverDispatcher$Args.run(LoadedApk.java:1124)
    //以下部分是duplicates部分
    at android.os.Handler.handleCallback(Handler.java:751)
    at android.os.Handler.dispatchMessage(Handler.java:95)
    at android.os.Looper.loop(Looper.java:154)
    at com.android.server.SystemServer.run(SystemServer.java:352)
    at com.android.server.SystemServer.main(SystemServer.java:220)
    at java.lang.reflect.Method.invoke(Native Method)
    at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:874)
    at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:764)
