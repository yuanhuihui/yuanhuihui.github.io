---
layout: post
title:  "Android消息机制1-Handler(Java层)"
date:   2015-12-26 18:10:50
catalog:  true
tags:
    - android
    - handler

---

> 本文基于Android 6.0的源代码，来分析Java层的handler消息处理机制

    framework/base/core/java/andorid/os/
      - Handler.java
      - Looper.java
      - Message.java
      - MessageQueue.java

## 一、概述

在整个Android的源码世界里，有两大利剑，其一是Binder IPC机制，，另一个便是消息机制(由Handler/Looper/MessageQueue等构成的)。关于Binder在[Binder系列](http://gityuan.com/2015/10/31/binder-prepare/)中详细讲解过，有兴趣看看。

Android有大量的消息驱动方式来进行交互，比如Android的四剑客`Activity`, `Service`, `Broadcast`, `ContentProvider`的启动过程的交互，都离不开消息机制，Android某种意义上也可以说成是一个以消息驱动的系统。消息机制涉及MessageQueue/Message/Looper/Handler这4个类。

### 1.1 模型
消息机制主要包含：

- **Message**：消息分为硬件产生的消息(如按钮、触摸)和软件生成的消息；
- **MessageQueue**：消息队列的主要功能向消息池投递消息(`MessageQueue.enqueueMessage`)和取走消息池的消息(`MessageQueue.next`)；
- **Handler**：消息辅助类，主要功能向消息池发送各种消息事件(`Handler.sendMessage`)和处理相应消息事件(`Handler.handleMessage`)；
- **Looper**：不断循环执行(`Looper.loop`)，按分发机制将消息分发给目标处理者。

### 1.2 架构图

![handler_java](/images/handler/Main.jpg)


- **Looper**有一个MessageQueue消息队列；
- **MessageQueue**有一组待处理的Message；
- **Message**中有一个用于处理消息的Handler；
- **Handler**中有Looper和MessageQueue。


### 1.3 典型实例
先展示一个典型的关于Handler/Looper的线程

    class LooperThread extends Thread {
        public Handler mHandler;

        public void run() {
            Looper.prepare();   //【见 2.1】

            mHandler = new Handler() {  //【见 3.1】
                public void handleMessage(Message msg) {
                    //TODO    定义消息处理逻辑. 【见 3.2】
                }
            };

            Looper.loop();  //【见 2.2】
        }
    }

接下来，围绕着这个实例展开详细分析。


## 二、Looper

### 2.1 prepare()

对于无参的情况，默认调用`prepare(true)`，表示的是这个Looper允许退出，而对于false的情况则表示当前Looper不允许退出。

```Java
private static void prepare(boolean quitAllowed) {
    //每个线程只允许执行一次该方法，第二次执行时线程的TLS已有数据，则会抛出异常。
    if (sThreadLocal.get() != null) {
        throw new RuntimeException("Only one Looper may be created per thread");
    }
    //创建Looper对象，并保存到当前线程的TLS区域
    sThreadLocal.set(new Looper(quitAllowed));
}
```

这里的`sThreadLocal`是ThreadLocal类型，下面，先说说ThreadLocal。

**ThreadLocal**： 线程本地存储区（Thread Local Storage，简称为TLS），每个线程都有自己的私有的本地存储区域，不同线程之间彼此不能访问对方的TLS区域。TLS常用的操作方法：


- `ThreadLocal.set(T value)`：将value存储到当前线程的TLS区域，源码如下：

```Java
public void set(T value) {
    Thread currentThread = Thread.currentThread(); //获取当前线程
    Values values = values(currentThread); //查找当前线程的本地储存区
    if (values == null) {
        //当线程本地存储区，尚未存储该线程相关信息时，则创建Values对象
        values = initializeValues(currentThread);
    }
    //保存数据value到当前线程this
    values.put(this, value);
}
```

- `ThreadLocal.get()`：获取当前线程TLS区域的数据，源码如下：

```Java
public T get() {
    Thread currentThread = Thread.currentThread(); //获取当前线程
    Values values = values(currentThread); //查找当前线程的本地储存区
    if (values != null) {
        Object[] table = values.table;
        int index = hash & values.mask;
        if (this.reference == table[index]) {
            return (T) table[index + 1]; //返回当前线程储存区中的数据
        }
    } else {
        //创建Values对象
        values = initializeValues(currentThread);
    }
    return (T) values.getAfterMiss(this); //从目标线程存储区没有查询是则返回null
}
```

ThreadLocal的get()和set()方法操作的类型都是泛型，接着回到前面提到的`sThreadLocal`变量，其定义如下：

    static final ThreadLocal<Looper> sThreadLocal = new ThreadLocal<Looper>()

可见`sThreadLocal`的get()和set()操作的类型都是`Looper`类型。

**Looper.prepare()**

Looper.prepare()在每个线程只允许执行一次，该方法会创建Looper对象，Looper的构造方法中会创建一个MessageQueue对象，再将Looper对象保存到当前线程TLS。

对于Looper类型的构造方法如下：

    private Looper(boolean quitAllowed) {
        mQueue = new MessageQueue(quitAllowed);  //创建MessageQueue对象. 【见4.1】
        mThread = Thread.currentThread();  //记录当前线程.
    }


另外，与prepare()相近功能的，还有一个`prepareMainLooper()`方法，该方法主要在ActivityThread类中使用。

    public static void prepareMainLooper() {
        prepare(false); //设置不允许退出的Looper
        synchronized (Looper.class) {
            //将当前的Looper保存为主Looper，每个线程只允许执行一次。
            if (sMainLooper != null) {
                throw new IllegalStateException("The main Looper has already been prepared.");
            }
            sMainLooper = myLooper();
        }
    }

### 2.2 loop()

    public static void loop() {
        final Looper me = myLooper();  //获取TLS存储的Looper对象 【见2.4】
        final MessageQueue queue = me.mQueue;  //获取Looper对象中的消息队列

        Binder.clearCallingIdentity();
        //确保在权限检查时基于本地进程，而不是调用进程。
        final long ident = Binder.clearCallingIdentity();

        for (;;) { //进入loop的主循环方法
            Message msg = queue.next(); //可能会阻塞 【见4.2】
            if (msg == null) { //没有消息，则退出循环
                return;
            }

            //默认为null，可通过setMessageLogging()方法来指定输出，用于debug功能
            Printer logging = me.mLogging;  
            if (logging != null) {
                logging.println(">>>>> Dispatching to " + msg.target + " " +
                        msg.callback + ": " + msg.what);
            }
            msg.target.dispatchMessage(msg); //用于分发Message 【见3.2】
            if (logging != null) {
                logging.println("<<<<< Finished to " + msg.target + " " + msg.callback);
            }

            //恢复调用者信息
            final long newIdent = Binder.clearCallingIdentity();
            msg.recycleUnchecked();  //将Message放入消息池 【见5.2】
        }
    }


loop()进入循环模式，不断重复下面的操作，直到没有消息时退出循环

- 读取MessageQueue的下一条Message；
- 把Message分发给相应的target；
- 再把分发后的Message回收到消息池，以便重复利用。

这是这个消息处理的核心部分。另外，上面代码中可以看到有logging方法，这是用于debug的，默认情况下`logging == null`，通过设置setMessageLogging()用来开启debug工作。

### 2.3 quit()

    public void quit() {
        mQueue.quit(false); //消息移除
    }

    public void quitSafely() {
        mQueue.quit(true); //安全地消息移除
    }

Looper.quit()方法的实现最终调用的是MessageQueue.quit()方法

**MessageQueue.quit()**

    void quit(boolean safe) {
            // 当mQuitAllowed为false，表示不运行退出，强行调用quit()会抛出异常
            if (!mQuitAllowed) {
                throw new IllegalStateException("Main thread not allowed to quit.");
            }
            synchronized (this) {
                if (mQuitting) { //防止多次执行退出操作
                    return;
                }
                mQuitting = true;
                if (safe) {
                    removeAllFutureMessagesLocked(); //移除尚未触发的所有消息
                } else {
                    removeAllMessagesLocked(); //移除所有的消息
                }
                //mQuitting=false，那么认定为 mPtr != 0
                nativeWake(mPtr);
            }
        }

消息退出的方式：

- 当safe =true时，只移除尚未触发的所有消息，对于正在触发的消息并不移除；
- 当safe =flase时，移除所有的消息


### 2.4 常用方法

#### 2.4.1 myLooper

用于获取TLS存储的Looper对象

    public static @Nullable Looper myLooper() {
            return sThreadLocal.get();
        }

#### 2.4.2 post

发送消息，并设置消息的callback，用于处理消息。

    public final boolean post(Runnable r)
    {
       return  sendMessageDelayed(getPostMessage(r), 0);
    }

    private static Message getPostMessage(Runnable r) {
        Message m = Message.obtain();
        m.callback = r;
        return m;
    }

## 三、Handler

### 3.1 创建Handler

#### 3.1.1 无参构造

    public Handler() {
        this(null, false);
    }

    public Handler(Callback callback, boolean async) {
        //匿名类、内部类或本地类都必须申明为static，否则会警告可能出现内存泄露
        if (FIND_POTENTIAL_LEAKS) {
            final Class<? extends Handler> klass = getClass();
            if ((klass.isAnonymousClass() || klass.isMemberClass() || klass.isLocalClass()) &&
                    (klass.getModifiers() & Modifier.STATIC) == 0) {
                Log.w(TAG, "The following Handler class should be static or leaks might occur: " +
                    klass.getCanonicalName());
            }
        }
        //必须先执行Looper.prepare()，才能获取Looper对象，否则为null.
        mLooper = Looper.myLooper();  //从当前线程的TLS中获取Looper对象【见2.1】
        if (mLooper == null) {
            throw new RuntimeException("");
        }
        mQueue = mLooper.mQueue; //消息队列，来自Looper对象
        mCallback = callback;  //回调方法
        mAsynchronous = async; //设置消息是否为异步处理方式
    }

对于Handler的无参构造方法，默认采用当前线程TLS中的Looper对象，并且callback回调方法为null，且消息为同步处理方式。只要执行的Looper.prepare()方法，那么便可以获取有效的Looper对象。

#### 3.1.2 有参构造

```Java
public Handler(Looper looper) {
    this(looper, null, false);
}

public Handler(Looper looper, Callback callback, boolean async) {
    mLooper = looper;
    mQueue = looper.mQueue;
    mCallback = callback;
    mAsynchronous = async;
}
```

Handler类在构造方法中，可指定Looper，Callback回调方法以及消息的处理方式(同步或异步)，对于无参的handler，默认是当前线程的Looper。


### 3.2 消息分发机制

在Looper.loop()中，当发现有消息时，调用消息的目标handler，执行dispatchMessage()方法来分发消息。

    public void dispatchMessage(Message msg) {
        if (msg.callback != null) {
            //当Message存在回调方法，回调msg.callback.run()方法；
            handleCallback(msg);
        } else {
            if (mCallback != null) {
                //当Handler存在Callback成员变量时，回调方法handleMessage()；
                if (mCallback.handleMessage(msg)) {
                    return;
                }
            }
            //Handler自身的回调方法handleMessage()
            handleMessage(msg);
        }
    }

**分发消息流程：**

1. 当`Message`的回调方法不为空时，则回调方法`msg.callback.run()`，其中callBack数据类型为Runnable,否则进入步骤2；
2. 当`Handler`的`mCallback`成员变量不为空时，则回调方法`mCallback.handleMessage(msg)`,否则进入步骤3；
3. 调用`Handler`自身的回调方法`handleMessage()`，该方法默认为空，Handler子类通过覆写该方法来完成具体的逻辑。

对于很多情况下，消息分发后的处理方法是第3种情况，即Handler.handleMessage()，一般地往往通过覆写该方法从而实现自己的业务逻辑。

### 3.3 消息发送

发送消息调用链：

![java_sendmessage](/images/handler/java_sendmessage.png)

从上图，可以发现所有的发消息方式，最终都是调用`MessageQueue.enqueueMessage()`;

#### 3.3.1 sendEmptyMessage

    public final boolean sendEmptyMessage(int what)
    {
        return sendEmptyMessageDelayed(what, 0);
    }

#### 3.3.2 sendEmptyMessageDelayed

    public final boolean sendEmptyMessageDelayed(int what, long delayMillis) {
        Message msg = Message.obtain();
        msg.what = what;
        return sendMessageDelayed(msg, delayMillis);
    }

#### 3.3.3 sendMessageDelayed

    public final boolean sendMessageDelayed(Message msg, long delayMillis)
    {
        if (delayMillis < 0) {
            delayMillis = 0;
        }
        return sendMessageAtTime(msg, SystemClock.uptimeMillis() + delayMillis);
    }

#### 3.3.4 sendMessageAtTime

    public boolean sendMessageAtTime(Message msg, long uptimeMillis) {
        MessageQueue queue = mQueue;
        if (queue == null) {
            return false;
        }
        return enqueueMessage(queue, msg, uptimeMillis);
    }


#### 3.3.5 sendMessageAtFrontOfQueue

    public final boolean sendMessageAtFrontOfQueue(Message msg) {
        MessageQueue queue = mQueue;
        if (queue == null) {
            return false;
        }
        return enqueueMessage(queue, msg, 0);
    }

该方法通过设置消息的触发时间为0，从而使Message加入到消息队列的队头。

#### 3.3.6 post

    public final boolean post(Runnable r)
    {
       return  sendMessageDelayed(getPostMessage(r), 0);
    }

    private static Message getPostMessage(Runnable r) {
        Message m = Message.obtain();
        m.callback = r;
        return m;
    }

#### 3.3.7 postAtFrontOfQueue

    public final boolean postAtFrontOfQueue(Runnable r)
    {
        return sendMessageAtFrontOfQueue(getPostMessage(r));
    }

#### 3.3.8 enqueueMessage

    private boolean enqueueMessage(MessageQueue queue, Message msg, long uptimeMillis) {
        msg.target = this;
        if (mAsynchronous) {
            msg.setAsynchronous(true);
        }
        return queue.enqueueMessage(msg, uptimeMillis); 【见4.3】
    }


#### 小节

 `Handler.sendEmptyMessage()`等系列方法最终调用`MessageQueue.enqueueMessage(msg, uptimeMillis)`，将消息添加到消息队列中，其中uptimeMillis为系统当前的运行时间，不包括休眠时间。


### 3.4 Handler其他方法

#### 3.4.1 obtainMessage

获取消息

    public final Message obtainMessage()
    {
        return Message.obtain(this); 【见5.2】
    }

`Handler.obtainMessage()`方法，最终调用`Message.obtainMessage(this)`，其中this为当前的Handler对象。

#### 3.4.2 removeMessages

    public final void removeMessages(int what) {
        mQueue.removeMessages(this, what, null); 【见 4.5】
    }


`Handler`是消息机制中非常重要的辅助类，更多的实现都是`MessageQueue`, `Message`中的方法，Handler的目的是为了更加方便的使用消息机制。


## 四、MessageQueue

MessageQueue是消息机制的Java层和C++层的连接纽带，大部分核心方法都交给native层来处理，其中MessageQueue类中涉及的native方法如下：

    private native static long nativeInit();
    private native static void nativeDestroy(long ptr);
    private native void nativePollOnce(long ptr, int timeoutMillis);
    private native static void nativeWake(long ptr);
    private native static boolean nativeIsPolling(long ptr);
    private native static void nativeSetFileDescriptorEvents(long ptr, int fd, int events);

关于这些native方法的介绍，见[Android消息机制2-Handler(native篇)](http://gityuan.com/2015/12/27/handler-message-native/)。

### 4.1 创建MessageQueue

    MessageQueue(boolean quitAllowed) {
        mQuitAllowed = quitAllowed;
        //通过native方法初始化消息队列，其中mPtr是供native代码使用
        mPtr = nativeInit();
    }

### 4.2 next()

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
            //阻塞操作，当等待nextPollTimeoutMillis时长，或者消息队列被唤醒，都会返回
            nativePollOnce(ptr, nextPollTimeoutMillis);
            synchronized (this) {
                final long now = SystemClock.uptimeMillis();
                Message prevMsg = null;
                Message msg = mMessages;
                //当消息的Handler为空时，则查询异步消息
                if (msg != null && msg.target == null) {
                    //当查询到异步消息，则立刻退出循环
                    do {
                        prevMsg = msg;
                        msg = msg.next;
                    } while (msg != null && !msg.isAsynchronous());
                }
                if (msg != null) {
                    if (now < msg.when) {
                        //当异步消息触发时间大于当前时间，则设置下一次轮询的超时时长
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
                        //设置消息的使用状态，即flags |= FLAG_IN_USE
                        msg.markInUse();
                        return msg;   //成功地获取MessageQueue中的下一条即将要执行的消息
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
                //当消息队列为空，或者是消息队列的第一个消息时
                if (pendingIdleHandlerCount < 0 && (mMessages == null || now < mMessages.when)) {
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
                    keep = idler.queueIdle();  //idle时执行的方法
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

`nativePollOnce`是阻塞操作，其中`nextPollTimeoutMillis`代表下一个消息到来前，还需要等待的时长；当nextPollTimeoutMillis = -1时，表示消息队列中无消息，会一直等待下去。

当处于空闲时，往往会执行`IdleHandler`中的方法。当nativePollOnce()返回后，next()从`mMessages`中提取一个消息。

`nativePollOnce()`在native做了大量的工作，想进一步了解可查看 [Android消息机制2-Handler(native篇)](http://gityuan.com/2015/12/27/handler-message-native/#nativepollonce)。


### 4.3 enqueueMessage

添加一条消息到消息队列

```Java
boolean enqueueMessage(Message msg, long when) {
    // 每一个普通Message必须有一个target
    if (msg.target == null) {
        throw new IllegalArgumentException("Message must have a target.");
    }
    if (msg.isInUse()) {
        throw new IllegalStateException(msg + " This message is already in use.");
    }
    synchronized (this) {
        if (mQuitting) {  //正在退出时，回收msg，加入到消息池
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
```

`MessageQueue`是按照Message触发时间的先后顺序排列的，队头的消息是将要最早触发的消息。当有消息需要加入消息队列时，会从队列头开始遍历，直到找到消息应该插入的合适位置，以保证所有消息的时间顺序。


### 4.4 removeMessages

```Java
void removeMessages(Handler h, int what, Object object) {
    if (h == null) {
        return;
    }
    synchronized (this) {
        Message p = mMessages;
        //从消息队列的头部开始，移除所有符合条件的消息
        while (p != null && p.target == h && p.what == what
               && (object == null || p.obj == object)) {
            Message n = p.next;
            mMessages = n;
            p.recycleUnchecked();
            p = n;
        }
        //移除剩余的符合要求的消息
        while (p != null) {
            Message n = p.next;
            if (n != null) {
                if (n.target == h && n.what == what
                    && (object == null || n.obj == object)) {
                    Message nn = n.next;
                    n.recycleUnchecked();
                    p.next = nn;
                    continue;
                }
            }
            p = n;
        }
    }
}
```

这个移除消息的方法，采用了两个while循环，第一个循环是从队头开始，移除符合条件的消息，第二个循环是从头部移除完连续的满足条件的消息之后，再从队列后面继续查询是否有满足条件的消息需要被移除。

### 4.5 postSyncBarrier

```Java
public int postSyncBarrier() {
    return postSyncBarrier(SystemClock.uptimeMillis());
}

private int postSyncBarrier(long when) {
    synchronized (this) {
        final int token = mNextBarrierToken++;
        final Message msg = Message.obtain();
        msg.markInUse();
        msg.when = when;
        msg.arg1 = token;

        Message prev = null;
        Message p = mMessages;
        if (when != 0) {
            while (p != null && p.when <= when) {
                prev = p;
                p = p.next;
            }
        }
        if (prev != null) {
            msg.next = p;
            prev.next = msg;
        } else {
            msg.next = p;
            mMessages = msg;
        }
        return token;
    }
}
```

前面小节[4.3]已说明每一个普通Message必须有一个target，对于特殊的message是没有target，即同步barrier token。
这个消息的价值就是用于拦截同步消息，所以并不会唤醒Looper.

```Java
public void removeSyncBarrier(int token) {
     synchronized (this) {
         Message prev = null;
         Message p = mMessages;
         //从消息队列找到 target为空,并且token相等的Message
         while (p != null && (p.target != null || p.arg1 != token)) {
             prev = p;
             p = p.next;
         }
         final boolean needWake;
         if (prev != null) {
             prev.next = p.next;
             needWake = false;
         } else {
             mMessages = p.next;
             needWake = mMessages == null || mMessages.target != null;
         }
         p.recycleUnchecked();

         if (needWake && !mQuitting) {
             nativeWake(mPtr);
         }
     }
 }
```

postSyncBarrier只对同步消息产生影响，对于异步消息没有任何差别。

## 五、 Message

### 5.1 消息对象

每个消息用`Message`表示，`Message`主要包含以下内容：

|数据类型|成员变量|解释|
|---|---|
|int|what|消息类别|
|long|when|消息触发时间|
|int|arg1|参数1|
|int|arg2|参数2|
|Object|obj|消息内容|
|Handler|target|消息响应方|
|Runnable|callback|回调方法|

创建消息的过程，就是填充消息的上述内容的一项或多项。

### 5.2 消息池

在代码中，可能经常看到recycle()方法，咋一看，可能是在做虚拟机的gc()相关的工作，其实不然，这是用于把消息加入到消息池的作用。这样的好处是，当消息池不为空时，可以直接从消息池中获取Message对象，而不是直接创建，提高效率。

静态变量`sPool`的数据类型为Message，通过next成员变量，维护一个消息池；静态变量`MAX_POOL_SIZE`代表消息池的可用大小；消息池的默认大小为50。

消息池常用的操作方法是obtain()和recycle()。

#### 5.2.1 obtain

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

obtain()，从消息池取Message，都是把消息池表头的Message取走，再把表头指向next;

#### 5.2.2 recycle

把不再使用的消息加入消息池

    public void recycle() {
        if (isInUse()) { //判断消息是否正在使用
            if (gCheckRecycle) { //Android 5.0以后的版本默认为true,之前的版本默认为false.
                throw new IllegalStateException("This message cannot be recycled because it is still in use.");
            }
            return;
        }
        recycleUnchecked();
    }

    //对于不再使用的消息，加入到消息池
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

recycle()，将Message加入到消息池的过程，都是把Message加到链表的表头；


## 六、总结

最后用一张图，来表示整个消息机制

![handler_java](/images/handler/handler_java.jpg)

**图解：**

- Handler通过sendMessage()发送Message到MessageQueue队列；
- Looper通过loop()，不断提取出达到触发条件的Message，并将Message交给target来处理；
- 经过dispatchMessage()后，交回给Handler的handleMessage()来进行相应地处理。
- 将Message加入MessageQueue时，处往管道写入字符，可以会唤醒loop线程；如果MessageQueue中没有Message，并处于Idle状态，则会执行IdelHandler接口中的方法，往往用于做一些清理性地工作。

**消息分发的优先级：**

1. Message的回调方法：`message.callback.run()`，优先级最高；
2. Handler的回调方法：`Handler.mCallback.handleMessage(msg)`，优先级仅次于1；
3. Handler的默认方法：`Handler.handleMessage(msg)`，优先级最低。

**消息缓存：**

为了提供效率，提供了一个大小为50的Message缓存队列，减少对象不断创建与销毁的过程。
