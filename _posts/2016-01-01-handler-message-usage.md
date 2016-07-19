---
layout: post
title:  "Android消息机制3-Handler(实战)"
date:   2016-01-01 14:09:12
catalog:  true
tags:
    - android
    - handler


---

> 本文基于Android 6.0的源代码，来分析Handler的用法

**相关源码**

    framework/base/core/java/andorid/os/HandlerThread.java


## 一、HandlerThread

[Android消息机制1-Handler(Java层)](http://gityuan.com/2015/12/26/handler-message-framework/)
[Android消息机制2-Handler(native篇)](http://gityuan.com/2015/12/27/handler-message-native/#nativepollonce)

这两篇文章已经讲解了消息机制，那么对于Handler的用法，往往是在一个线程中运行Looper，其他线程通过Handler来发送消息到Looper所在线程，这里涉及线程间的通信。既然涉及多个线程的通信，会有同步的问题，Android对此直接提供了HandlerThread类，下面来讲讲HandlerThread类的设计。


### 1.1 创建

HandlerThread 继承于 Thread类

    public HandlerThread(String name) {
        super(name);
        mPriority = Process.THREAD_PRIORITY_DEFAULT; //默认优先级
    }

    public HandlerThread(String name, int priority) {
        super(name);
        mPriority = priority;
    }

### 1.2 getLooper

获取HandlerThread线程中的Looper对象

    public Looper getLooper() {
        // 当线程没有启动或者已经结束时，则返回null
        if (!isAlive()) {
            return null;
        }

        //当线程已经启动，则等待直到looper创建完成
        synchronized (this) {
            while (isAlive() && mLooper == null) {
                try {
                    wait(); //休眠等待
                } catch (InterruptedException e) {
                }
            }
        }
        return mLooper;
    }

### 1.3 运行

    @Override
    public void run() {
        mTid = Process.myTid();  //获取线程的tid
        Looper.prepare();   // 创建Looper对象
        synchronized (this) {
            mLooper = Looper.myLooper(); //获取looper对象
            notifyAll(); //唤醒等待线程
        }
        Process.setThreadPriority(mPriority);
        onLooperPrepared();  // 该方法可通过覆写，实现自己的逻辑
        Looper.loop();   //进入循环模式
        mTid = -1;
    }

### 1.4 退出

    public boolean quit() {
        Looper looper = getLooper();
        if (looper != null) {
            looper.quit(); //普通退出
            return true;
        }
        return false;
    }

    public boolean quitSafely() {
        Looper looper = getLooper();
        if (looper != null) {
            looper.quitSafely(); //安全退出
            return true;
        }
        return false;
    }

quit()与quitSafely()的区别，仅仅在于是否移除当前正在处理的消息。移除当前正在处理的消息可能会出现不安全的行为。

## 二、实战

### 2.1 利用HandlerThread

很多时候，在HandlerThread线程中运行Loop()方法，在其他线程中通过Handler发送消息到HandlerThread线程。通过wait/notifyAll的方式，有效地解决了多线程的同步问题。

示例代码：

    // Step 1: 创建并启动HandlerThread线程，内部包含Looper
    HandlerThread handlerThread = new HandlerThread("gityuan.com");
    handlerThread.start();

    // Step 2: 创建Handler
    Handler handler = new Handler(handlerThread.getLooper());

    // Step 3: 发送消息
    handler.post(new Runnable() {

            @Override
            public void run() {
                System.out.println("thread id="+Thread.currentThread().getId());
            }
        });

或者 handler.postDelayed(Runnable r, long delayMillis)用于延迟执行。


### 2.2 直接创建线程

示例代码：

    class LooperThread extends Thread {
        public Handler mHandler;

        public void run() {
            Looper.prepare();
            // Step 1: 创建Handler
            mHandler = new Handler() {
                public void handleMessage(Message msg) {
                    //TODO  处理即将发送过来的消息
                }
            };

            Looper.loop();
        }
    }

    // Step 2: 创建并启动LooperThread线程，内部包含Looper
    LooperThread looperThread = new LooperThread("gityuan.com");
    looperThread.start();

    // Step 3: 发送消息
    LooperThread.mHandler.sendEmptyMessage(10);
