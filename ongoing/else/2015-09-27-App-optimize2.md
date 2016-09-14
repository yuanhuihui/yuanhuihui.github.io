---
layout: post
title:  "APP优化(二)"
date:   2015-09-27 20:10:22
catalog:  true
tags:
    - android
    - app
    - performance

---


> 本文是针对Android的App开发的性能优化的专题总纲。

## 一、降低执行时间
这部分包括：缓存、数据存储优化、算法优化、JNI、逻辑优化、需求优化几种优化方式。

### 1.1 缓存
缓存分类包括：

- 对象缓存： 减少内存分配
- 网络缓存： 减少网络传输
- IO缓存： 减少磁盘的读写次数
- DB缓存： 减少数据库的访问次数

Android常用缓存:

- 线程池
- 图片缓存，Sdcard缓存，数据预取缓存（**此处需要进一步完成**）
- 消息缓存： 消息复用 `handler.sendMessage(handler.obtainMessage(0, object));`
- UI缓存
- 网络缓存：数据库缓存http response，根据http头信息中的Cache-Control域确定缓存过期时间
- IO缓存：使用BufferedInputStream，BufferedReader等具有缓存策略的输入流。对文件、网络IO皆适用。
- 需要频繁访问或访问一次消耗较大的数据缓存 。

### 1.2 数据存储优化
**（1）数据类型选择：**

- 字符串拼接用StringBuilder代替String，在非并发情况下用StringBuilder代替StringBuffer。如果你对字符串的长度有大致了解，如100字符左右，可以直接new StringBuilder(128)指定初始大小，减少空间不够时的再次分配。
- 使用SoftReference、WeakReference相对正常的强应用来说更有利于系统垃圾回收
- final类型存储在常量区中读取效率更高
- LocalBroadcastManager代替普通BroadcastReceiver，效率和安全性都更高

**（2） 数据结构选择：**

- ArrayList和LinkedList的选择，ArrayList根据index取值更快，LinkedList更占内存、随机插入删除更快速、扩容效率更高。一般推荐ArrayList。
- ArrayList、HashMap、LinkedHashMap、HashSet的选择
hash系列数据结构查询速度更优，ArrayList存储有序元素，HashMap为键值对数据结构，LinkedHashMap可以记住加入次序的hashMap，HashSet不允许重复元素。
HashMap、WeakHashMap选择，WeakHashMap中元素可在适当时候被系统垃圾回收器自动回收，所以适合在内存紧张型中使用。
- Collections.synchronizedMap和ConcurrentHashMap的选择，ConcurrentHashMap为细分锁，锁粒度更小，并发性能更优。
- Collections.synchronizedMap为对象锁，自己添加函数进行锁控制更方便。
- SparseArray、SparseBooleanArray、SparseIntArray、Pair。Sparse系列的数据结构是为key为int情况的特殊处理，采用二分查找及简单的数组存储，加上不需要泛型转换的开销，相对Map来说性能更优。

### 1.3 算法优化
这个主题比较大，需要具体问题具体分析，尽量不用O(n*n)时间复杂度以上的算法，必要时候可用空间换时间。
查询考虑hash和二分，尽量不用递归。可以从结构之法 算法之道[结构之法 算法之道](http://blog.csdn.net/v_july_v/)或[微软、Google等面试题](http://zhedahht.blog.163.com/)学习。

### 1.4 JNI(需要更新)
Android应用程序大都通过Java开发，需要Dalvik的JIT编译器将Java字节码转换成本地代码运行，而本地代码可以直接由设备管理器直接执行，节省了中间步骤，所以执行速度更快。不过需要注意从Java空间切换到本地空间需要开销，同时JIT编译器也能生成优化的本地代码，所以糟糕的本地代码不一定性能更优。

### 1.5 逻辑优化
主要是理清程序逻辑，减少不必要冗余的操作。


## 二、同步改异步
充分利用多核Cpu优势，提高TPS。利用多线程解决密集型计算、IO、网络等操作，以提高TPS。
在Android应用程序中由于系统ANR的限制，将可能造成主线程超时操作放入另外的工作线程中。在工作线程中可以通过handler和主线程交互。

## 三、提前或延迟操作
(1) 延迟操作
不在Activity、Service、BroadcastReceiver的生命周期内对响应时间敏感函数中执行耗时操作，可适当delay。
延迟操作：

- ScheduledExecutorService.schedule

        ExecutorService scheduledThreadPool = Executors.newScheduledThreadPool(corePoolSize);
        scheduledThreadPool.schedule(runnable, delay, TimeUnit.SECONDS);

- handler.postDelayed(Runnable r)

        new Handler().postDelayed(new Runnable() {
            public void run() {
                ... //TODO
            }},
        delayMillis);
- handler.postAtTime(Runnable r, long uptimeMillis)

        定时执行任务，时间是基于android.os.SystemClock.uptimeMillis

- handler.sendMessageDelayed(Message msg, long delayMillis)

        以及handler.sendEmptyMessageDelayed(int what, long delayMillis)

- View.postDelayed(Runnable action, long delayMillis)

        实现方式还是通过handler.postDelayed();
- AlarmManager定时

        定时闹钟的方式有多种，包括精准/非精准定时，周期/非周期定时。
        比如：`setExact(int type, long triggerAtMillis, PendingIntent operation)`，
        其中PendingIntent只是Activity,Service或者Broadcast，故不能直接定时启动一个线程。

(2) 提前操作
对于第一次调用较耗时操作，可统一放到初始化中，将耗时提前。如得到壁纸wallpaperManager.getDrawable();

## 四、网络优化
以下是网络优化中一些客户端和服务器端需要尽量遵守的准则：

- 图片必须缓存，最好根据机型做图片做图片适配
- 所有http请求必须添加http timeout
- 开启gzip压缩
- api接口数据以json格式返回，而不是xml或html
- 根据http头信息中的Cache-Control及expires域确定是否缓存请求结果。
- 确定网络请求的connection是否keep-alive
- 减少网络请求次数，服务器端适当做请求合并。
- 减少重定向次数
- api接口服务器端响应时间不超过100ms
