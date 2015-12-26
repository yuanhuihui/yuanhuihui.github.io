---
layout: post
title:  "Android消息机制-Handler(上篇)"
date:   2015-12-26 18:10:50
categories: android
excerpt:  Android Message
---

* content
{:toc}


---

> 本文基于Android 6.0的源代码，来分析Java层的Handler消息处理机制

**相关源码**
	
	framework/base/core/java/andorid/os/Handler.java
	framework/base/core/java/andorid/os/Looper.java
	framework/base/core/java/andorid/os/Message.java
	framework/base/core/java/andorid/os/MessageQueue.java

## 一、概述
在整个Android的源码世界里，有两大利剑，其一是Binder IPC机制，，另一个便是消息机制(由Handler/Looper/MessageQueue等构成的)。关于Binder在[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)中详细讲解过，有兴趣的可以去看看。

Android有大量的消息驱动方式来进行交互，比如Android的四剑客Activity, Service, Broadcast, ContentProvider的启动过程的交互，都离不开消息机制，Android某种意义上也可以说成是一个以消息驱动的系统。

**模型**  
消息机制主要包含：

- 消息(Message)：消息分为硬件产生的消息(如按钮、触摸)和软件生成的消息；
- 消息队列(MessageQueue)：可以向消息池投递消息，也可以从消息池取走消息；
- 消息辅助类(Handler)，用于向消息池发送各种消息事件和处理相应消息事件；
- 消息分发(Looper)：不断循环执行，用于分发消息至target Handler。



展示一个典型的Looper线程，后面围绕着这个线程来分析

	class LooperThread extends Thread {
        public Handler mHandler;
  
        public void run() {
            Looper.prepare();   【见 2.1】
  
            mHandler = new Handler() {
                public void handleMessage(Message msg) {
                    //处理即将发送过来的消息   【见 5.2】
                }
            };
  
            Looper.loop(); 【见 2.2】
        }
    }


## 二、Looper

### 2.1 Looper.prepare()

对于无参的情况，默认调用prepare(true)

	private static void prepare(boolean quitAllowed) {
        if (sThreadLocal.get() != null) { //该方法只允许执行一次，第二执行是TLS中已有数据，则会抛出异常
            throw new RuntimeException("Only one Looper may be created per thread");
        }
        sThreadLocal.set(new Looper(quitAllowed));
    }

这里，需要特别注意，每个线程只允许执行一次prepare()方法。

#### 2.1.1 ThreadLocal

TLS(Thread Local Storage），叫线程局部存储，每个线程都有自己的私有的局部存储区域，线程之间彼此不能访问对方的TLS区域。

- `sThreadLocal.get()`作用是用于获取当前线程的TLS区域的数据；
- `sThreadLocal.set(new Looper(quitAllowed))`的作用是将创建的Looper对象存储在当前线程的TLS区域

#### 2.1.2 创建Looper对象

    private Looper(boolean quitAllowed) {
        mQueue = new MessageQueue(quitAllowed);  //创建MessageQueue对象
        mThread = Thread.currentThread();  //保存当前线程到mThread变量
    }

#### 2.1.3 prepare()总结

可以发现，Looper.prepare()工作：

1. 创建Looper对象，该过程里包含下面两部分：
	- 创建MessageQueue对象；
	- 获取当前线程，并保存到mThread；
2. 把Looper对象，保存到sThreadLocal(线程局部变量)。


### 2.2 Looper.loop()

	public static void loop() {
        final Looper me = myLooper();  //获取TLS存储的Looper对象 【见2.2.1】
        if (me == null) {
            throw new RuntimeException("No Looper; Looper.prepare() wasn't called on this thread.");
        }
        final MessageQueue queue = me.mQueue;  //获取Looper对象中的消息队列

        Binder.clearCallingIdentity();
        final long ident = Binder.clearCallingIdentity(); //确保在权限检查时基于本地进程，而不是基于最初调用进程。
        for (;;) {
            Message msg = queue.next(); //可能会阻塞 【见4.2】
            if (msg == null) { //没有消息，则退出循环
                return;
            }
            
            Printer logging = me.mLogging;  //默认为null，可通过setMessageLogging()方法来指定输出，用于debug功能
            if (logging != null) {
                logging.println(">>>>> Dispatching to " + msg.target + " " +
                        msg.callback + ": " + msg.what);
            }
            msg.target.dispatchMessage(msg); //用于分发Message 【见5.2】
            if (logging != null) {
                logging.println("<<<<< Finished to " + msg.target + " " + msg.callback);
            }

            final long newIdent = Binder.clearCallingIdentity(); //确保分发过程中identity不会损坏
            if (ident != newIdent) {
                ... //打印identity改变的log
            }
            msg.recycleUnchecked();  //将Message放入消息池 【见3.2.2】
        }
    }

#### 2.2.1 myLooper

获取TLS存储的Looper对象

	public static @Nullable Looper myLooper() {
	        return sThreadLocal.get();
	    }

#### 2.2.2 消息循环

进入循环模式，不断重复下面的操作，直到没有消息时退出循环

- 读取MessageQueue的下一条Message
- 把Message分发给相应的target
- 再把分发后的Message，回收到消息池

这是这个消息处理的核心部分。另外，上面代码中可以看到有logging方法，这是用于debug的，默认情况下`logging == null`，通过设置setMessageLogging()放来开启debug工作。

关于Message对象，下面来详细说一说。

## 三、 Message

### 3.1 消息体

每个消息用`Message`表示，`Message`主要包含以下内容：

|Item|解释|
|---|---|
|what|消息类别|
|arg1|参数1|
|arg2|参数2|
|obj|消息内容|
|target|消息响应方|
|when|触发时间|

### 3.2 消息池

在代码中，可能经常看到recycle()方法，咋一看，可能是在做虚拟机的gc()相关的工作，其实不然，这是用于把消息加入到消息池的作用。这样的好处是，当消息池不为空时，可以直接从消息池中获取Message对象，而不是直接创建，提高效率。

静态变量`sPool`代表消息池；静态变量`MAX_POOL_SIZE`代表消息池的可用大小；消息池的默认大小为50。

#### 3.2.1 obtain()

从消息池中获取消息

	public static Message obtain() {
        synchronized (sPoolSync) {
            if (sPool != null) {
                Message m = sPool;
                sPool = m.next;
                m.next = null; //从sPool中取出一个Message对象，并消息链表断开
                m.flags = 0; // 清除in-use flag
                sPoolSize--; //消息池的可用大小进行减1操作
                return m;
            }
        }
        return new Message(); // 当消息池为空时，直接创建Message对象
    }

#### 3.2.2 recycle()

把不再使用的消息加入消息池

	public void recycle() {
        if (isInUse()) { //判断消息是否正在使用中
            if (gCheckRecycle) { //Android 5.0以后的版本默认为true,之前的版本默认为false.
                throw new IllegalStateException("This message cannot be recycled because it is still in use.");
            }
            return;
        }
        recycleUnchecked(); 
    }

	//对于不再使用的消息，加入到消息池中
	void recycleUnchecked() {
        //将消息标示位置为IN_USE，并清空消息所有的参数。
        flags = FLAG_IN_USE;
        what = 0;
        arg1 = 0;
        arg2 = 0;
        obj = null;
        replyTo = null;
        sendingUid = -1;
        when = 0;
        target = null;
        callback = null;
        data = null;
        synchronized (sPoolSync) {
            if (sPoolSize < MAX_POOL_SIZE) { //当消息池没有满时，将Message对象加入消息池
                next = sPool;
                sPool = this;
                sPoolSize++; //消息池的可用大小进行加1操作
            }
        }
    }

从上面代码，不难看出：

- 每次从消息池取Message，都是把消息池表头的Message取走，表头指向next;
- 每次将Message加入到消息池的过程，都是把Message加到链表的表头；

## 四、MessageQueue

native方法如下：

	private native static long nativeInit();
    private native static void nativeDestroy(long ptr);
    private native void nativePollOnce(long ptr, int timeoutMillis); //注意，唯独该方法不是static
    private native static void nativeWake(long ptr);
    private native static boolean nativeIsPolling(long ptr);
    private native static void nativeSetFileDescriptorEvents(long ptr, int fd, int events);


### 4.1 创建MessageQueue

	MessageQueue(boolean quitAllowed) {
        mQuitAllowed = quitAllowed;
        mPtr = nativeInit(); //通过native方法，来初始化消息队列
    }

`mPtr`是用于native代码

### 4.2 queue.next()

提取下一条message

	Message next() {
        final long ptr = mPtr;
        if (ptr == 0) { //当消息循环已经退出，则直接返回
            return null;
        }
        int pendingIdleHandlerCount = -1; // 循环迭代的首次为-1
        int nextPollTimeoutMillis = 0;
        for (;;) {
            if (nextPollTimeoutMillis != 0) {
                Binder.flushPendingCommands();
            }
            nativePollOnce(ptr, nextPollTimeoutMillis); //调用native方法，轮询消息
            synchronized (this) {
                final long now = SystemClock.uptimeMillis();
                Message prevMsg = null;
                Message msg = mMessages;
                if (msg != null && msg.target == null) {
                    //查询MessageQueue中的下一条异步消息
                    do {
                        prevMsg = msg;
                        msg = msg.next;
                    } while (msg != null && !msg.isAsynchronous());
                }
                if (msg != null) {
                    if (now < msg.when) {
                        //设置下一次轮询消息的超时时间
                        nextPollTimeoutMillis = (int) Math.min(msg.when - now, Integer.MAX_VALUE);
                    } else {
                        // 获取一条消息，并返回
                        mBlocked = false;
                        if (prevMsg != null) {
                            prevMsg.next = msg.next;
                        } else {
                            mMessages = msg.next;
                        }
                        msg.next = null;
                        msg.markInUse(); //设置消息为使用中的状态
                        return msg;
                    }
                } else {
                    //没有消息
                    nextPollTimeoutMillis = -1;
                }
                //消息正在退出，返回null
                if (mQuitting) {
                    dispose();
                    return null;
                }
                //当消息队列为空，或者消息队列的第一个消息时
                if (pendingIdleHandlerCount < 0
                        && (mMessages == null || now < mMessages.when)) {
                    pendingIdleHandlerCount = mIdleHandlers.size();
                }
                if (pendingIdleHandlerCount <= 0) {
                    //没有idle handlers 需要运行，则循环并等待。
                    mBlocked = true;
                    continue;
                }
                if (mPendingIdleHandlers == null) {
                    mPendingIdleHandlers = new IdleHandler[Math.max(pendingIdleHandlerCount, 4)];
                }
                mPendingIdleHandlers = mIdleHandlers.toArray(mPendingIdleHandlers);
            }
            //只有第一次循环时，会运行idle handlers，执行完成后，重置pendingIdleHandlerCount为0.
            for (int i = 0; i < pendingIdleHandlerCount; i++) {
                final IdleHandler idler = mPendingIdleHandlers[i];
                mPendingIdleHandlers[i] = null; //去掉handler的引用
                boolean keep = false;
                try {
                    keep = idler.queueIdle();
                } catch (Throwable t) {
                    Log.wtf(TAG, "IdleHandler threw exception", t);
                }
                if (!keep) {
                    synchronized (this) {
                        mIdleHandlers.remove(idler);
                    }
                }
            }
            //重置idle handler个数为0，以保证不会再次重复运行
            pendingIdleHandlerCount = 0;
            //当调用一个空闲handler时，一个新message能够被分发，因此无需等待可以直接查询pending message.
            nextPollTimeoutMillis = 0;
        }
    }

nativePollOnce是阻塞的操作，当从mMessages中成功提取一个消息后才会返回，否则便会阻塞等待消息，也就是说当消息队列为空时，无法返回直到有消息加入到消息队列中。


### 4.3 enqueueMessage

添加一条消息到消息队列

    boolean enqueueMessage(Message msg, long when) {
        // 每一个Message必须有一个target
        if (msg.target == null) {
            throw new IllegalArgumentException("Message must have a target.");
        }
        if (msg.isInUse()) {
            throw new IllegalStateException(msg + " This message is already in use.");
        }
        synchronized (this) {
            if (mQuitting) {  //正在退出时，回收msg，加入到消息池
                IllegalStateException e = new IllegalStateException(
                        msg.target + " sending message to a Handler on a dead thread");
                Log.w(TAG, e.getMessage(), e);
                msg.recycle();
                return false;
            }
            msg.markInUse();
            msg.when = when;
            Message p = mMessages;
            boolean needWake;
            if (p == null || when == 0 || when < p.when) {
                //p为null(代表MessageQueue没有消息） 或者msg的触发时间是队列中最早的， 则进入该该分支
                msg.next = p;
                mMessages = msg;
                needWake = mBlocked; //当阻塞时需要唤醒
            } else {
                //将消息按时间顺序插入到MessageQueue。一般地，不需要唤醒事件队列，除非
                //消息队头存在barrier，并且同时Message是队列中最早的异步消息。 
                needWake = mBlocked && p.target == null && msg.isAsynchronous();
                Message prev;
                for (;;) {
                    prev = p;
                    p = p.next;
                    if (p == null || when < p.when) {
                        break;
                    }
                    if (needWake && p.isAsynchronous()) {
                        needWake = false;
                    }
                }
                msg.next = p;
                prev.next = msg;
            }
            //消息没有退出，我们认为此时mPtr != 0
            if (needWake) {
                nativeWake(mPtr);
            }
        }
        return true;
    }

MessageQueue一直是按照Message触发的时间先后顺序排列的，队头的消息是将要最早触发的消息。当有消息需要加入消息队列时，会从队列头开始遍历，直到找到消息应该插入的合适位置，以保证所有消息的时间顺序。


### 五、Handler

	final MessageQueue mQueue;
    final Looper mLooper;
    final Callback mCallback;
    final boolean mAsynchronous;
    IMessenger mMessenger;

#### 5.1 获取消息

	public final Message obtainMessage()
	    {
	        return Message.obtain(this); 【见 3.2.1】
	    }

`Handler.obtainMessage()`方法，最终调用`Message.obtainMessage(this)`，其中this为当前的Handler对象。

#### 5.2 分发消息


	public void dispatchMessage(Message msg) {
        if (msg.callback != null) {
            handleCallback(msg);  //Message有回调方法
        } else {
            if (mCallback != null) {
                if (mCallback.handleMessage(msg)) { //Handler有Callback对象来处理
                    return;
                }
            }
            handleMessage(msg);  //Handler自身的回调方法
        }
    }

**(1) Message的回调方法**

    //当Message存在回调方法时，直接由Message的CallBack方法来处理，CallBack是一个Runnable类型
    private static void handleCallback(Message message) {
        message.callback.run();
    }

**(2) Handler的mCallback的回调方法**

    //消息回调接口，用于处理消息
    public interface Callback {
        public boolean handleMessage(Message msg);
    }

**(3) Handler的回调方法**

    // Handler自身的回调方法
    public void handleMessage(Message msg) {
     	//空方法，子类实现时需要覆写的地方
    }

消息分发流程：

1. 当Message有回调方法，那么由`message.callback.run()`来处理消息并返回；否则继续执行；
2. 当Handler设置了mCallback成员变量，那么由`mCallback.handleMessage(msg)`来处理消息，处理完的返回值为true则直接返回；否则继续执行；
3. 调用Handler自身的回调方法`handleMessage(msg)`来处理.


#### 5.3 发送消息


**(1) sendEmptyMessage**

	public final boolean sendEmptyMessage(int what)
    {
        return sendEmptyMessageDelayed(what, 0);
    }

**(2) sendEmptyMessageDelayed**

	public final boolean sendEmptyMessageDelayed(int what, long delayMillis) {
        Message msg = Message.obtain();
        msg.what = what;
        return sendMessageDelayed(msg, delayMillis);
    }

**(3) sendMessageDelayed**

	public final boolean sendMessageDelayed(Message msg, long delayMillis)
    {
        if (delayMillis < 0) {
            delayMillis = 0;
        }
        return sendMessageAtTime(msg, SystemClock.uptimeMillis() + delayMillis);
    }

**(4) sendMessageAtTime**

	public boolean sendMessageAtTime(Message msg, long uptimeMillis) {
        MessageQueue queue = mQueue;
        if (queue == null) {
            RuntimeException e = new RuntimeException(
                    this + " sendMessageAtTime() called with no mQueue");
            Log.w("Looper", e.getMessage(), e);
            return false;
        }
        return enqueueMessage(queue, msg, uptimeMillis);
    }

**(5) enqueueMessage**

	private boolean enqueueMessage(MessageQueue queue, Message msg, long uptimeMillis) {
        msg.target = this;
        if (mAsynchronous) {
            msg.setAsynchronous(true);
        }
        return queue.enqueueMessage(msg, uptimeMillis); 【见4.3】
    }


`Handler.sendEmptyMessage()`方法，最终调用`MessageQueue.enqueueMessage(msg, uptimeMillis)`，其中uptimeMillis为系统当前的运行时间。


小结：
Handler类似于辅助类，更多的实现都是其他MessageQueue, Message

### 总结

1. Looper有一个MessageQueue消息队列；
2. MessageQueue有一系列的待处理的Message；
3. Message中有一个用于处理消息的Handler。
4. Handlder中有一个Looper和MessageQueue；

