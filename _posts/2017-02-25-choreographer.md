---
layout: post
title:  "Choreographer原理"
date:   2017-2-25 20:12:30
catalog:    true
tags:
    - android
    - graphic

---

    Choreographer.java
    DisplayEventReceiver.java
    frameworks/base/core/jni/android_view_DisplayEventReceiver.cpp
    frameworks/native/libs/gui/DisplayEventReceiver.cpp

## 一. 概述

前面两篇文章介绍了SurfaceFlinger原理，讲述了SurfaceFlinger的启动过程，绘制过程，以及Vsync处理过程。
本文再介绍一下Choreographer的启动与Vsync处理过程。

## 二. Choreographer启动流程

在Activity启动过程，执行完onResume后，会调用Activity.makeVisible()，然后再调用到addView()，
层层调用会进入如下方法：

    public ViewRootImpl(Context context, Display display) {
        ...
        //这里便出现获取Choreographer实例【见小节2.1】
        mChoreographer = Choreographer.getInstance();
        ...
    }

### 2.1 getInstance
[-> Choreographer.java]

    public static Choreographer getInstance() {
        return sThreadInstance.get(); //单例模式
    }

    private static final ThreadLocal<Choreographer> sThreadInstance =
        new ThreadLocal<Choreographer>() {

        protected Choreographer initialValue() {
            Looper looper = Looper.myLooper(); //获取当前线程的Looper
            if (looper == null) {
                throw new IllegalStateException("The current thread must have a looper!");
            }
            return new Choreographer(looper); //【见小节2.2】
        }
    };

当前所在线程为UI线程，也就是常说的主线程。

### 2.2 创建Choreographer
[-> Choreographer.java]

    private Choreographer(Looper looper) {
        mLooper = looper;
        //创建Handler对象【见小节2.3】
        mHandler = new FrameHandler(looper);
        //创建用于接收VSync信号的对象【见小节2.4】
        mDisplayEventReceiver = USE_VSYNC ? new FrameDisplayEventReceiver(looper) : null;
        mLastFrameTimeNanos = Long.MIN_VALUE;
        mFrameIntervalNanos = (long)(1000000000 / getRefreshRate());
        //创建回调对象
        mCallbackQueues = new CallbackQueue[CALLBACK_LAST + 1];
        for (int i = 0; i <= CALLBACK_LAST; i++) {
            mCallbackQueues[i] = new CallbackQueue();
        }
    }

- mLastFrameTimeNanos：是指上一次帧绘制时间点；
- mFrameIntervalNanos：帧间时长，一般等于16.7ms.

### 2.3 创建FrameHandler
[-> Choreographer.java  ::FrameHandler]

    private final class FrameHandler extends Handler {
        public FrameHandler(Looper looper) {
            super(looper);
        }

        @Override
        public void handleMessage(Message msg) {
            switch (msg.what) {
                case MSG_DO_FRAME:
                    doFrame(System.nanoTime(), 0);
                    break;
                case MSG_DO_SCHEDULE_VSYNC:
                    doScheduleVsync();
                    break;
                case MSG_DO_SCHEDULE_CALLBACK:
                    doScheduleCallback(msg.arg1);
                    break;
            }
        }
    }

### 2.4 创建FrameDisplayEventReceiver
[-> Choreographer.java  ::FrameDisplayEventReceiver]

    private final class FrameDisplayEventReceiver extends DisplayEventReceiver
            implements Runnable {

        public FrameDisplayEventReceiver(Looper looper) {
            super(looper); //【见小节2.4.1】
        }
    }

#### 2.4.1  DisplayEventReceiver
[-> DisplayEventReceiver.java]

    public DisplayEventReceiver(Looper looper) {
        mMessageQueue = looper.getQueue(); //获取主线程的消息队列
        //【见小节2.4.2】
        mReceiverPtr = nativeInit(new WeakReference<DisplayEventReceiver>(this), mMessageQueue);
    }

经过JNI调用进入如下Native方法。

#### 2.4.2 nativeInit
[-> android_view_DisplayEventReceiver.cpp]

    static jlong nativeInit(JNIEnv* env, jclass clazz, jobject receiverWeak,
            jobject messageQueueObj) {
        sp<MessageQueue> messageQueue = android_os_MessageQueue_getMessageQueue(env, messageQueueObj);
        ...
        //【见小节2.4.3】
        sp<NativeDisplayEventReceiver> receiver = new NativeDisplayEventReceiver(env,
                receiverWeak, messageQueue);
        //【见小节2.4.4】
        status_t status = receiver->initialize();
        ...

        //获取DisplayEventReceiver对象的引用
        receiver->incStrong(gDisplayEventReceiverClassInfo.clazz);
        return reinterpret_cast<jlong>(receiver.get());
    }

#### 2.4.3 创建NativeDisplayEventReceiver
[-> android_view_DisplayEventReceiver.cpp]

    NativeDisplayEventReceiver::NativeDisplayEventReceiver(JNIEnv* env,
            jobject receiverWeak, const sp<MessageQueue>& messageQueue) :
            mReceiverWeakGlobal(env->NewGlobalRef(receiverWeak)),
            mMessageQueue(messageQueue), mWaitingForVsync(false) {
        ALOGV("receiver %p ~ Initializing display event receiver.", this);
    }

NativeDisplayEventReceiver继承于LooperCallback对象，此处mReceiverWeakGlobal记录的是Java层
DisplayEventReceiver对象的全局引用。


#### 2.4.4 initialize
[-> android_view_DisplayEventReceiver.cpp]

    status_t NativeDisplayEventReceiver::initialize() {
        //mReceiver为DisplayEventReceiver类型
        status_t result = mReceiver.initCheck();
        ...
        //监听mReceiver的所获取的文件句柄。
        int rc = mMessageQueue->getLooper()->addFd(mReceiver.getFd(), 0, Looper::EVENT_INPUT,
                this, NULL);
        ...

        return OK;
    }

此处跟文章[SurfaceFlinger原理(一)](http://gityuan.com/2017/02/11/surface_flinger/)的【小节2.8】的监听原理一样。
监听mReceiver的所获取的文件句柄，一旦有数据到来，则回调this(此处NativeDisplayEventReceiver)中所复写LooperCallback对象的
handleEvent。

### 2.5 handleEvent
[-> android_view_DisplayEventReceiver.cpp]

    int NativeDisplayEventReceiver::handleEvent(int receiveFd, int events, void* data) {
        ...
        nsecs_t vsyncTimestamp;
        int32_t vsyncDisplayId;
        uint32_t vsyncCount;
        //清除所有的pending事件，只保留最后一次vsync【见小节2.5.1】
        if (processPendingEvents(&vsyncTimestamp, &vsyncDisplayId, &vsyncCount)) {
            mWaitingForVsync = false;
            //分发Vsync【见小节2.5.2】
            dispatchVsync(vsyncTimestamp, vsyncDisplayId, vsyncCount);
        }
        return 1;
    }

#### 2.5.1 processPendingEvents

    bool NativeDisplayEventReceiver::processPendingEvents(
            nsecs_t* outTimestamp, int32_t* outId, uint32_t* outCount) {
        bool gotVsync = false;
        DisplayEventReceiver::Event buf[EVENT_BUFFER_SIZE];
        ssize_t n;
        while ((n = mReceiver.getEvents(buf, EVENT_BUFFER_SIZE)) > 0) {
            for (ssize_t i = 0; i < n; i++) {
                const DisplayEventReceiver::Event& ev = buf[i];
                switch (ev.header.type) {
                case DisplayEventReceiver::DISPLAY_EVENT_VSYNC:
                    gotVsync = true; //获取VSync信号
                    *outTimestamp = ev.header.timestamp;
                    *outId = ev.header.id;
                    *outCount = ev.vsync.count;
                    break;
                case DisplayEventReceiver::DISPLAY_EVENT_HOTPLUG:
                    dispatchHotplug(ev.header.timestamp, ev.header.id, ev.hotplug.connected);
                    break;
                default:
                    break;
                }
            }
        }
        return gotVsync;
    }

遍历所有的事件，当有多个VSync事件到来，则只关注最近一次的事件。

#### 2.5.2 dispatchVsync

    void NativeDisplayEventReceiver::dispatchVsync(nsecs_t timestamp, int32_t id, uint32_t count) {
        JNIEnv* env = AndroidRuntime::getJNIEnv();

        ScopedLocalRef<jobject> receiverObj(env, jniGetReferent(env, mReceiverWeakGlobal));
        if (receiverObj.get()) {
            //【见小节2.6】
            env->CallVoidMethod(receiverObj.get(),
                    gDisplayEventReceiverClassInfo.dispatchVsync, timestamp, id, count);
        }

        mMessageQueue->raiseAndClearException(env, "dispatchVsync");
    }

此处调用到Java层的DisplayEventReceiver对象的dispatchVsync()方法，接下来进入Java层。

### 2.6 dispatchVsync
[-> DisplayEventReceiver.java]

    private void dispatchVsync(long timestampNanos, int builtInDisplayId, int frame) {
        //【见小节2.7】
        onVsync(timestampNanos, builtInDisplayId, frame);
    }

再回到【小节2.2】，可知Choreographer对象实例化的过程，创建的对象是DisplayEventReceiver子类
FrameDisplayEventReceiver对象，接下来进入该对象。

### 2.7 onVsync
[-> Choreographer.java ::FrameDisplayEventReceiver]

    private final class FrameDisplayEventReceiver extends DisplayEventReceiver
            implements Runnable {
        private boolean mHavePendingVsync;
        private long mTimestampNanos;
        private int mFrame;

        @Override
        public void onVsync(long timestampNanos, int builtInDisplayId, int frame) {
            //忽略来自第二显示屏的Vsync
            if (builtInDisplayId != SurfaceControl.BUILT_IN_DISPLAY_ID_MAIN) {
                scheduleVsync();
                return;
            }
            ...

            mTimestampNanos = timestampNanos;
            mFrame = frame;
            //该消息的callback为当前对象FrameDisplayEventReceiver
            Message msg = Message.obtain(mHandler, this);
            msg.setAsynchronous(true);
            //此处mHandler为FrameHandler
            mHandler.sendMessageAtTime(msg, timestampNanos / TimeUtils.NANOS_PER_MS);
        }

        @Override
        public void run() {
            mHavePendingVsync = false;
            doFrame(mTimestampNanos, mFrame); //【见小节2.8】
        }
    }

可见onVsync()过程是通过FrameHandler向主线程Looper发送了一个自带callback的消息 callback为FrameDisplayEventReceiver。
当主线程Looper执行到该消息时，则调用FrameDisplayEventReceiver.run()方法，紧接着便是调用doFrame，如下：

### 2.8 doFrame
[-> Choreographer.java]

    void doFrame(long frameTimeNanos, int frame) {
        final long startNanos;
        synchronized (mLock) {
            if (!mFrameScheduled) {
                return; // mFrameScheduled=false，则直接返回。
            }

            long intendedFrameTimeNanos = frameTimeNanos; //原本计划的绘帧时间点
            startNanos = System.nanoTime();
            final long jitterNanos = startNanos - frameTimeNanos;
            if (jitterNanos >= mFrameIntervalNanos) {
                final long skippedFrames = jitterNanos / mFrameIntervalNanos;
                //当掉帧个数超过30，则输出相应log
                if (skippedFrames >= SKIPPED_FRAME_WARNING_LIMIT) {
                    Log.i(TAG, "Skipped " + skippedFrames + " frames!  "
                            + "The application may be doing too much work on its main thread.");
                }
                final long lastFrameOffset = jitterNanos % mFrameIntervalNanos;
                frameTimeNanos = startNanos - lastFrameOffset; //对齐帧的时间间隔
            }

            if (frameTimeNanos < mLastFrameTimeNanos) {
                scheduleVsyncLocked();
                return;
            }

            mFrameInfo.setVsync(intendedFrameTimeNanos, frameTimeNanos);
            mFrameScheduled = false;
            mLastFrameTimeNanos = frameTimeNanos;
        }

        try {
            Trace.traceBegin(Trace.TRACE_TAG_VIEW, "Choreographer#doFrame");

            mFrameInfo.markInputHandlingStart();
            doCallbacks(Choreographer.CALLBACK_INPUT, frameTimeNanos);

            //标记动画开始时间
            mFrameInfo.markAnimationsStart();
            //执行回调方法【见小节2.9】
            doCallbacks(Choreographer.CALLBACK_ANIMATION, frameTimeNanos);

            mFrameInfo.markPerformTraversalsStart();
            doCallbacks(Choreographer.CALLBACK_TRAVERSAL, frameTimeNanos);

            doCallbacks(Choreographer.CALLBACK_COMMIT, frameTimeNanos);
        } finally {
            Trace.traceEnd(Trace.TRACE_TAG_VIEW);
        }
    }

1. 每调用一次scheduleFrameLocked()，则mFrameScheduled=true，能执行一次
doFrame()操作，执行完doFrame()并设置mFrameScheduled=false；
2. 最终有4个回调类别，如下所示：
  - INPUT：输入事件
  - ANIMATION：动画
  - TRAVERSAL：窗口刷新，执行measure、layout、draw
  - COMMIT：遍历完成的提交操作，用来修正动画启动时间

### 2.9 doCallbacks
[-> Choreographer.java]

    void doCallbacks(int callbackType, long frameTimeNanos) {
        CallbackRecord callbacks;
        synchronized (mLock) {
            final long now = System.nanoTime();
            // 从队列查找相应类型的CallbackRecord对象【见小节2.9.1】
            callbacks = mCallbackQueues[callbackType].extractDueCallbacksLocked(
                    now / TimeUtils.NANOS_PER_MS);
            if (callbacks == null) {
                return;  //当队列为空，则直接返回
            }
            mCallbacksRunning = true;

            if (callbackType == Choreographer.CALLBACK_COMMIT) {
                final long jitterNanos = now - frameTimeNanos;
                //当commit类型回调执行的时间点超过2帧，则更新mLastFrameTimeNanos。
                if (jitterNanos >= 2 * mFrameIntervalNanos) {
                    final long lastFrameOffset = jitterNanos % mFrameIntervalNanos
                            + mFrameIntervalNanos;
                    frameTimeNanos = now - lastFrameOffset;
                    mLastFrameTimeNanos = frameTimeNanos;
                }
            }
        }
        try {
            for (CallbackRecord c = callbacks; c != null; c = c.next) {
                c.run(frameTimeNanos); //【见小节2.10】
            }
        } finally {
          synchronized (mLock) {
              mCallbacksRunning = false;
              //回收callbacks，加入对象池mCallbackPool
              do {
                  final CallbackRecord next = callbacks.next;
                  recycleCallbackLocked(callbacks);
                  callbacks = next;
              } while (callbacks != null);
          }
          Trace.traceEnd(Trace.TRACE_TAG_VIEW);
        }
    }

也就是说callback一旦执行完成，则会被回收。

#### 2.9.1 extractDueCallbacksLocked
[-> Choreographer.java ::CallbackQueue]

    private final class CallbackQueue {
        public CallbackRecord extractDueCallbacksLocked(long now) {
            CallbackRecord callbacks = mHead;
            //当队列头部的callbacks对象为空，或者执行时间还没到达，则直接返回
            if (callbacks == null || callbacks.dueTime > now) {
                return null;
            }

            CallbackRecord last = callbacks;
            CallbackRecord next = last.next;
            while (next != null) {
                if (next.dueTime > now) {
                    last.next = null;
                    break;
                }
                last = next;
                next = next.next;
            }
            mHead = next;
            return callbacks;
        }
    }

### 2.10 CallbackRecord.run
[-> Choreographer.java ::CallbackRecord]

    private static final class CallbackRecord {
        public CallbackRecord next;
        public long dueTime;
        public Object action; // Runnable or FrameCallback
        public Object token;

        public void run(long frameTimeNanos) {
            if (token == FRAME_CALLBACK_TOKEN) {
                ((FrameCallback)action).doFrame(frameTimeNanos);
            } else {
                ((Runnable)action).run();
            }
        }
    }

这里的回调方法run()有两种执行情况：

- 当token的数据类型为FRAME_CALLBACK_TOKEN，则执行该对象的doFrame()方法;
- 当token为其他类型，则执行该对象的run()方法。

在前面小节【2.8】doFrame()过程有一个判断变量mFrameScheduled，有两种执行情况：
- 当该值为true则执行动画，执行完本次操作则再次设置该值为false;
- 否则并不会执行动画。

对于底层Vsync信号每间隔16.7ms，上层都会接收到该信号。但对于系统会有需要，才会更新动画，
那么需要的场景便是由WMS调用scheduleAnimationLocked()方法来设置mFrameScheduled=true来触发动画，
接下来说说动画控制的过程

## 三. 动画显示过程

调用栈：

    WMS.scheduleAnimationLocked
      postFrameCallback
        postFrameCallbackDelayed
          postCallbackDelayedInternal
            scheduleFrameLocked

### 3.1 WMS.scheduleAnimationLocked
[-> WindowManagerService.java]

    void scheduleAnimationLocked() {
         if (!mAnimationScheduled) {
             mAnimationScheduled = true;
             //【见小节3.2】
             mChoreographer.postFrameCallback(mAnimator.mAnimationFrameCallback);
         }
     }

只有当mAnimationScheduled=false时，才会执行postFrameCallback()，其中参数为mAnimator对象的
成员变量mAnimationFrameCallback，该对象的初始化过程：

#### 3.1.1 创建WMS

    private WindowManagerService(
        ...
        mAnimator = new WindowAnimator(this); //【见小节3.1.2】
        ...
    }

#### 3.1.2 创建WindowAnimator
[-> WindowAnimator.java]

    WindowAnimator(final WindowManagerService service) {
        mService = service;
        mContext = service.mContext;
        mPolicy = service.mPolicy;

        mAnimationFrameCallback = new Choreographer.FrameCallback() {
            public void doFrame(long frameTimeNs) {
                synchronized (mService.mWindowMap) {
                    mService.mAnimationScheduled = false;
                    animateLocked(frameTimeNs);
                }
            }
        };
    }

mAnimationFrameCallback的数据类型为Choreographer.FrameCallback。

### 3.2 postFrameCallback
[-> Choreographer.java]

    public void postFrameCallback(FrameCallback callback) {
        postFrameCallbackDelayed(callback, 0);
    }

    public void postFrameCallbackDelayed(FrameCallback callback, long delayMillis) {
        ...
        //【见小节3.3】
        postCallbackDelayedInternal(CALLBACK_ANIMATION,
                callback, FRAME_CALLBACK_TOKEN, delayMillis);
    }

### 3.3 postCallbackDelayedInternal
[-> Choreographer.java]

    // callbackType为动画，action为mAnimationFrameCallback
    // token为FRAME_CALLBACK_TOKEN，delayMillis=0
    private void postCallbackDelayedInternal(int callbackType,
        Object action, Object token, long delayMillis) {

        synchronized (mLock) {
            final long now = SystemClock.uptimeMillis();
            final long dueTime = now + delayMillis;
            //添加到mCallbackQueues队列
            mCallbackQueues[callbackType].addCallbackLocked(dueTime, action, token);

            if (dueTime <= now) {
                scheduleFrameLocked(now);
            } else {
                //发送消息MSG_DO_SCHEDULE_CALLBACK
                Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_CALLBACK, action);
                msg.arg1 = callbackType;
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, dueTime);
            }
        }
    }

发送MSG_DO_SCHEDULE_CALLBACK消息后，主线程接收后进入FrameHandler的handleMessage()操作，如下方法。

### 3.4 MSG_DO_SCHEDULE_CALLBACK
[-> Choreographer.java  ::FrameHandler]

    private final class FrameHandler extends Handler {

        public void handleMessage(Message msg) {
            switch (msg.what) {
                case MSG_DO_FRAME:
                    doFrame(System.nanoTime(), 0);
                    break;
                case MSG_DO_SCHEDULE_VSYNC:
                    doScheduleVsync();
                    break;
                case MSG_DO_SCHEDULE_CALLBACK:
                    doScheduleCallback(msg.arg1); //【见小节3.5】
                    break;
            }
        }
    }

### 3.5 doScheduleCallback
[-> Choreographer.java]

    void doScheduleCallback(int callbackType) {
        synchronized (mLock) {
            if (!mFrameScheduled) {
                final long now = SystemClock.uptimeMillis();
                if (mCallbackQueues[callbackType].hasDueCallbacksLocked(now)) {
                    scheduleFrameLocked(now); //【见小节3.6】
                }
            }
        }
    }

### 3.6 scheduleFrameLocked
[-> Choreographer.java]

    private void scheduleFrameLocked(long now) {
        if (!mFrameScheduled) {
            mFrameScheduled = true;
            if (USE_VSYNC) {
                if (isRunningOnLooperThreadLocked()) {
                    //当运行在Looper线程，则立刻调度vsync
                    scheduleVsyncLocked();
                } else {
                    //否则，发送消息到UI线程
                    Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_VSYNC);
                    msg.setAsynchronous(true);
                    mHandler.sendMessageAtFrontOfQueue(msg);
                }
            } else {
                final long nextFrameTime = Math.max(
                        mLastFrameTimeNanos / TimeUtils.NANOS_PER_MS + sFrameDelay, now);
                Message msg = mHandler.obtainMessage(MSG_DO_FRAME);
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, nextFrameTime);
            }
        }
    }

该方法的功能：

1. 当运行在Looper线程，则立刻调度scheduleVsyncLocked();
2. 当运行在其他线程，则通过发送一个消息到Looper线程，然后再执行scheduleVsyncLocked();

### 3.7 scheduleVsyncLocked
[-> Choreographer.java]

    private void scheduleVsyncLocked() {
        mDisplayEventReceiver.scheduleVsync(); //【见小节3.8】
    }

mDisplayEventReceiver对象是在【小节2.2】Choreographer的实例化过程所创建的。

### 3.8 scheduleVsync
[-> DisplayEventReceiver.java]

    public void scheduleVsync() {
         if (mReceiverPtr == 0) {
            ...
         } else {
             nativeScheduleVsync(mReceiverPtr);
         }
    }

### 3.9 nativeScheduleVsync
[-> android_view_DisplayEventReceiver.cpp]

    static void nativeScheduleVsync(JNIEnv* env, jclass clazz, jlong receiverPtr) {
        sp<NativeDisplayEventReceiver> receiver =
                reinterpret_cast<NativeDisplayEventReceiver*>(receiverPtr);
        status_t status = receiver->scheduleVsync();
        ...
    }

### 3.10 scheduleVsync
[-> android_view_DisplayEventReceiver.cpp]

    status_t NativeDisplayEventReceiver::scheduleVsync() {
        if (!mWaitingForVsync) {
            nsecs_t vsyncTimestamp;
            int32_t vsyncDisplayId;
            uint32_t vsyncCount;
            processPendingEvents(&vsyncTimestamp, &vsyncDisplayId, &vsyncCount);
            //【见小节3.11】
            status_t status = mReceiver.requestNextVsync();
            ...

            mWaitingForVsync = true;
        }
        return OK;
    }

### 3.11 requestNextVsync
[-> DisplayEventReceiver.cpp]

    status_t DisplayEventReceiver::requestNextVsync() {
        if (mEventConnection != NULL) {
            mEventConnection->requestNextVsync();
            return NO_ERROR;
        }
        return NO_INIT;
    }

该方法的作用请求下一次Vsync信息处理，当Vsync信号到来，由于mFrameScheduled=true,则继续【小节2.10】CallbackRecord.run()方法。

## 四、总结

- 尽量避免在执行动画渲染的前后在主线程放入耗时操作，否则会造成卡顿感，影响用户体验；
- 可通过Choreographer.getInstance().postFrameCallback()来监听帧率情况；
- 每调用一次scheduleFrameLocked()，则mFrameScheduled=true，可进入doFrame()方法体内部，执行完doFrame()并设置mFrameScheduled=false；
- doCallbacks回调方法有4个类别：INPUT（输入事件），ANIMATION（动画），TRAVERSAL（窗口刷新），COMMIT（完成后的提交操作）。
