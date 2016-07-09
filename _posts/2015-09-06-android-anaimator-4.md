---
layout: post
title:  "Android动画之原理篇（四）"
date:   2015-9-6 20：05:00
catalog:  true
tags:
    - android
    - 动画

----------

> 本文讲述动画的整个执行流程

在前面的文章中有讲到，Android动画的启动方式如下：

    ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f); //step 1
    anim.setDuration(1000); //Step 2
    anim.start();           //Step 3

那么接下来，我们就从源码中来分析，分析这3条语句是如何调起动画的。所有代码来源于Android sdk 22，为了精简文章篇幅，部分源码的方法只截了与动画流程相关的关键代码片段。

----------

## 1. ofFloat()
**step 1：** ObjectAnimator.ofFloat，是一个静态方法。首先创建ObjectAnimator对象，并指定target对象和属性名。然后`setFloatValues(values)`方法，经几次调用，最后调用`KeyframeSet.ofFloat(values)`，创建了一个只有起始帧和结束帧(2-keyframe)的KeyframeSet对象。

    public static ObjectAnimator ofFloat(Object target, String propertyName, float... values) {
        //创建ObjectAnimator对象
        ObjectAnimator anim = new ObjectAnimator(target, propertyName);
        //设置float类型值
        anim.setFloatValues(values);
        return anim;
    }

## 2. setDuration()
**step 2：** anim.setDuration(1000)，用于设置动画的执行总时间，调用父类ValueAnimator的方法：

    public ValueAnimator setDuration(long duration) {
        if (duration < 0) {
            throw new IllegalArgumentException("Animators cannot have negative duration: " +
                    duration);
        }
        //mUnscaledDuration的默认值为300ms
        mUnscaledDuration = duration;
        //更新duration
        updateScaledDuration();  //代码见下方
        return this;
    }

    private void updateScaledDuration() {
        // sDurationScale默认为1
        mDuration = (long)(mUnscaledDuration * sDurationScale);
    }

## 3. start()
**step 3：** anim.start()，启动动画，这整个动画过程中最为复杂的流程。首先判断是否存在活动或将要活动的，若存在则根据条件进行相应的取消操作。
其中AnimationHandler包含mAnimations（活动动画）， mPendingAnimations（下一帧的动画），mDelayedAnims（延时动画）这3个动画ArrayList。

### 3-1 ObjectAnimator.start()
调用ObjectAnimator中start方法，开启动画的第一步：

    public void start() {
        // 获取AnimationHandler，并进行取消动画操作
        AnimationHandler handler = sAnimationHandler.get();
        if (handler != null) {
            int numAnims = handler.mAnimations.size();
            for (int i = numAnims - 1; i >= 0; i--) {
                if (handler.mAnimations.get(i) instanceof ObjectAnimator) {
                    ObjectAnimator anim = (ObjectAnimator) handler.mAnimations.get(i);
                    if (anim.mAutoCancel && hasSameTargetAndProperties(anim)) {
                        anim.cancel();
                    }
                }
            }
            numAnims = handler.mPendingAnimations.size();
            for (int i = numAnims - 1; i >= 0; i--) {
                if (handler.mPendingAnimations.get(i) instanceof ObjectAnimator) {
                    ObjectAnimator anim = (ObjectAnimator) handler.mPendingAnimations.get(i);
                    if (anim.mAutoCancel && hasSameTargetAndProperties(anim)) {
                        anim.cancel();
                    }
                }
            }
            numAnims = handler.mDelayedAnims.size();
            for (int i = numAnims - 1; i >= 0; i--) {
                if (handler.mDelayedAnims.get(i) instanceof ObjectAnimator) {
                    ObjectAnimator anim = (ObjectAnimator) handler.mDelayedAnims.get(i);
                    if (anim.mAutoCancel && hasSameTargetAndProperties(anim)) {
                        anim.cancel();
                    }
                }
            }
        }
        //调用父类方法
        super.start(); //代码见（3-2）
    }

### 3-2 ValueAnimator.start()
进入ValueAnimator对象的方法。调用start()，再跳转到start(false)，为了精简内容，下面方法只截取关键的代码片段：

    private void start(boolean playBackwards) {
        ...

        int prevPlayingState = mPlayingState;
        mPlayingState = STOPPED;
        // 更新时间duration
        updateScaledDuration();

        //获取或创建AnimationHandler，
        //AnimationHandler的核心功能是靠Choreographer完成，后面会详细介绍Choreographer;
        AnimationHandler animationHandler = getOrCreateAnimationHandler();

        // 将当前动画添加到下一帧动画列表中
        animationHandler.mPendingAnimations.add(this);

        if (mStartDelay == 0) {
            //初始化动画参数
            if (prevPlayingState != SEEKED) {
                setCurrentPlayTime(0);  //代码见（3-2-1）
            }
            mPlayingState = STOPPED;
            mRunning = true;
            notifyStartListeners(); //代码见（3-2-2）
        }
        animationHandler.start();   //代码见（3-2-3）
    }

**（3-2-1）**
其中setCurrentPlayTime(0)，多次跳转后，调用animateValue(1)，插值器默认为`AccelerateDecelerateInterpolator`。此处首次调用onAnimationUpdate方法，

**动画更新，通过实现`AnimatorUpdateListener`接口的`onAnimationUpdate()`方法。**

    void animateValue(float fraction) {

        fraction = mInterpolator.getInterpolation(fraction);
        mCurrentFraction = fraction;
        int numValues = mValues.length;
        for (int i = 0; i < numValues; ++i) {
            mValues[i].calculateValue(fraction);
        }
        if (mUpdateListeners != null) {
            int numListeners = mUpdateListeners.size();
            for (int i = 0; i < numListeners; ++i) {
                mUpdateListeners.get(i).onAnimationUpdate(this); //更新动画状态
            }
        }
    }

**（3-2-2）**
其中notifyStartListeners()，主要功能是调用`onAnimationStart(this)`,动画启动：

**通知动画开始，通过实现`AnimatorListener`接口的`onAnimationStart()`方法。**

    private void notifyStartListeners() {
        if (mListeners != null && !mStartListenersCalled) {
            ArrayList<AnimatorListener> tmpListeners =
                    (ArrayList<AnimatorListener>) mListeners.clone();
            int numListeners = tmpListeners.size();
            for (int i = 0; i < numListeners; ++i) {
                tmpListeners.get(i).onAnimationStart(this); //动画开始
            }
        }
        mStartListenersCalled = true;
    }

----------

**从此处开始，将是循环执行的开始**

**（3-2-3）**
其中animationHandler.start()，交给mChoreographer来执行动画。

    private void scheduleAnimation() {
        if (!mAnimationScheduled) {
            mChoreographer.postCallback(Choreographer.CALLBACK_ANIMATION, this, null); //代码见（3-3）
            mAnimationScheduled = true;
        }
    }

### 3-3 Choreographer
进入Choreographer类，这是动画最为核心的一个类，动画最后都会走到这个类里面。mChoreographer.postCallback 方法，经几次调用，最后调用postCallbackDelayedInternal()，传入进去的action的`animationHandler`：

    private void postCallbackDelayedInternal(int callbackType,
            Object action, Object token, long delayMillis) {
        ...

        synchronized (mLock) {
            final long now = SystemClock.uptimeMillis();
            final long dueTime = now + delayMillis;
             //此处action 为 animationHandler,添加到Callback队列
            mCallbackQueues[callbackType].addCallbackLocked(dueTime, action, token);

            if (dueTime <= now) {
                 //传进来的delayMillis=0,故进入才分支
                scheduleFrameLocked(now);    //代码见（3-3-1）
            } else {
                Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_CALLBACK, action);
                msg.arg1 = callbackType;
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, dueTime);
            }
        }
    }

**（3-3-1）**scheduleFrameLocked（now），其中`USE_VSYNC = SystemProperties.getBoolean("debug.choreographer.vsync", true)`,该属性值一般都是缺省的，则`USE_VSYNC =true`,启动VSYNC垂直同步信号方式来触发动画。当fps=60时，则1/60 s≈16.7ms，故VSYNC信号上报的周期为16.7ms：

    private void scheduleFrameLocked(long now) {
        if (!mFrameScheduled) {
            mFrameScheduled = true;
            if (USE_VSYNC) {
                if (DEBUG) {
                    Log.d(TAG, "Scheduling next frame on vsync.");
                }

                // 正运行在Looper线程
                if (isRunningOnLooperThreadLocked()) {
                    scheduleVsyncLocked();  //代码见（3-3-2）
                } else {
                    Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_VSYNC);
                    msg.setAsynchronous(true);
                    mHandler.sendMessageAtFrontOfQueue(msg);
                }
            } else {
                final long nextFrameTime = Math.max(
                        mLastFrameTimeNanos / TimeUtils.NANOS_PER_MS + sFrameDelay, now);
                if (DEBUG) {
                    Log.d(TAG, "Scheduling next frame in " + (nextFrameTime - now) + " ms.");
                }
                Message msg = mHandler.obtainMessage(MSG_DO_FRAME);
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, nextFrameTime);
            }
        }
    }

**（3-3-2）**scheduleVsyncLocked（）再调用`DisplayEventReceiver`。`DisplayEventReceiver`实现了Runnable接口，继承`DisplayEventReceiver`，提供了一种能接收display event，比如垂直同步的机制，通过Looper不断扫描信息，直到收到VSYNC信号，触发相应操作。

    private void scheduleVsyncLocked() {
        mDisplayEventReceiver.scheduleVsync();
    }

**（3-3-3）**当接收到vsync信号时，会调用onVsync()方法，通过sendMessageAtTime，交由FrameHandler来处理消息事件

        @Override
        public void onVsync(long timestampNanos, int builtInDisplayId, int frame) {
            ...

            long now = System.nanoTime();
            if (timestampNanos > now) {
                Log.w(TAG, "Frame time is " + ((timestampNanos - now) * 0.000001f)
                        + " ms in the future!  Check that graphics HAL is generating vsync "
                        + "timestamps using the correct timebase.");
                timestampNanos = now;
            }

            if (mHavePendingVsync) {
                Log.w(TAG, "Already have a pending vsync event.  There should only be "
                        + "one at a time.");
            } else {
                mHavePendingVsync = true;
            }

            mTimestampNanos = timestampNanos;
            mFrame = frame;
            Message msg = Message.obtain(mHandler, this);
            msg.setAsynchronous(true);
            mHandler.sendMessageAtTime(msg, timestampNanos / TimeUtils.NANOS_PER_MS);
        }

**（3-3-4）** FrameHandler在收到信息时，进行doFrame(System.nanoTime(), 0)，该方法重点最下面的三行doCallbacks语句，分别是`CALLBACK_INPUT`，`CALLBACK_ANIMATION`，`CALLBACK_TRAVERSAL`，可看出回调的处理顺序依次为：input事件, 动画，view布局和绘制。

    void doFrame(long frameTimeNanos, int frame) {
        final long startNanos;
        synchronized (mLock) {
            if (!mFrameScheduled) {
                return; // no work to do
            }

            startNanos = System.nanoTime();
            final long jitterNanos = startNanos - frameTimeNanos;

            //mFrameIntervalNanos 代表两帧之间的刷新时间
            if (jitterNanos >= mFrameIntervalNanos) {
                final long skippedFrames = jitterNanos / mFrameIntervalNanos;
                // 说明已经掉帧了
                if (skippedFrames >= SKIPPED_FRAME_WARNING_LIMIT) {
                    Log.i(TAG, "Skipped " + skippedFrames + " frames!  "
                            + "The application may be doing too much work on its main thread.");
                }
                final long lastFrameOffset = jitterNanos % mFrameIntervalNanos;
                frameTimeNanos = startNanos - lastFrameOffset;
            }

            if (frameTimeNanos < mLastFrameTimeNanos) {
                if (DEBUG) {
                    Log.d(TAG, "Frame time appears to be going backwards.  May be due to a "
                            + "previously skipped frame.  Waiting for next vsync.");
                }
                scheduleVsyncLocked();
                return;
            }

            mFrameScheduled = false;
            mLastFrameTimeNanos = frameTimeNanos;
        }

        doCallbacks(Choreographer.CALLBACK_INPUT, frameTimeNanos);      //代码见（3-3-5）
        doCallbacks(Choreographer.CALLBACK_ANIMATION, frameTimeNanos);  //代码见（3-3-5）
        doCallbacks(Choreographer.CALLBACK_TRAVERSAL, frameTimeNanos);  //代码见（3-3-5）

    }

**（3-3-5）** doCallbacks，遍历执行所有的run方法，再回收相应的Callback：

    void doCallbacks(int callbackType, long frameTimeNanos) {
        CallbackRecord callbacks;
        synchronized (mLock) {
            final long now = SystemClock.uptimeMillis();
            callbacks = mCallbackQueues[callbackType].extractDueCallbacksLocked(now);
            if (callbacks == null) {
                return;
            }
            mCallbacksRunning = true;
        }
        try {
            for (CallbackRecord c = callbacks; c != null; c = c.next) {
                if (DEBUG) {
                    Log.d(TAG, "RunCallback: type=" + callbackType
                            + ", action=" + c.action + ", token=" + c.token
                            + ", latencyMillis=" + (SystemClock.uptimeMillis() - c.dueTime));
                }
                //此处调用的实际上是animationHandler.run()
                c.run(frameTimeNanos);  //代码见（3-4-2）
            }
        } finally {
            synchronized (mLock) {
                mCallbacksRunning = false;
                do {
                    final CallbackRecord next = callbacks.next;
                    recycleCallbackLocked(callbacks);  //回收Callback
                    callbacks = next;
                } while (callbacks != null);
            }
        }
    }

### 3-4 animationHandler.run()
该方法是由Choreographer调用的


    @Override
    public void run() {
        mAnimationScheduled = false;
        //具体实现动画的一阵内容
        doAnimationFrame(mChoreographer.getFrameTime());   //代码见（3-4-1）
    }

**（3-4-1）**doAnimationFrame是消耗帧的过程，其中startAnimation会初始化`Evalutor`.

     private void doAnimationFrame(long frameTime) {
        // 清空mPendingAnimations
        while (mPendingAnimations.size() > 0) {
            ArrayList<ValueAnimator> pendingCopy =
                    (ArrayList<ValueAnimator>) mPendingAnimations.clone();
            mPendingAnimations.clear();
            int count = pendingCopy.size();
            for (int i = 0; i < count; ++i) {
                ValueAnimator anim = pendingCopy.get(i);

                if (anim.mStartDelay == 0) {
                    anim.startAnimation(this); // 将mPendingAnimations动画添加到活动动画list
                } else {
                    mDelayedAnims.add(anim); // 如果有delay时间的，就添加到 mDelayedAnims
                }
            }
        }

        // 将已经到时的延时动画，加入到mReadyAnims
        int numDelayedAnims = mDelayedAnims.size();
        for (int i = 0; i < numDelayedAnims; ++i) {
            ValueAnimator anim = mDelayedAnims.get(i);
            if (anim.delayedAnimationFrame(frameTime)) {
                mReadyAnims.add(anim);
            }
        }
        //移除mDelayedAnims动画，并清空mReadyAnims动画
        int numReadyAnims = mReadyAnims.size();
        if (numReadyAnims > 0) {
            for (int i = 0; i < numReadyAnims; ++i) {
                ValueAnimator anim = mReadyAnims.get(i);
                anim.startAnimation(this);   //将mReadyAnims动画添加到活动动画list
                anim.mRunning = true;
                mDelayedAnims.remove(anim);
            }
            mReadyAnims.clear();
        }

        // 处理所有的活动动画，根据返回值决定是否将相应的动画添加到endAnims.
        int numAnims = mAnimations.size();
        for (int i = 0; i < numAnims; ++i) {
            mTmpAnimations.add(mAnimations.get(i));
        }
        for (int i = 0; i < numAnims; ++i) {
            ValueAnimator anim = mTmpAnimations.get(i);
            if (mAnimations.contains(anim) && anim.doAnimationFrame(frameTime)) { //代码见（3-4-2）
                mEndingAnims.add(anim);
            }
        }
        //清空mTmpAnimations 和 mEndingAnims
        mTmpAnimations.clear();
        if (mEndingAnims.size() > 0) {
            for (int i = 0; i < mEndingAnims.size(); ++i) {
                // 动画结束
                mEndingAnims.get(i).endAnimation(this);  //代码见（3-4-4）
            }
            mEndingAnims.clear();
        }

        // 活动或延时动画不会空时，调用scheduleAnimation
        if (!mAnimations.isEmpty() || !mDelayedAnims.isEmpty()) {
            scheduleAnimation();   //代码见（3-4-5）
        }
    }

**（3-4-2）** animationFrame 绘制动画的帧，当动画的elapsed time时间超过动画duration时，动画将结束。

    boolean animationFrame(long currentTime) {
        boolean done = false;
        switch (mPlayingState) {
        case RUNNING:
        case SEEKED:
            float fraction = mDuration > 0 ? (float)(currentTime - mStartTime) / mDuration : 1f;
            if (mDuration == 0 && mRepeatCount != INFINITE) {
                // Skip to the end
                mCurrentIteration = mRepeatCount;
                if (!mReversing) {
                    mPlayingBackwards = false;
                }
            }
            if (fraction >= 1f) {
                if (mCurrentIteration < mRepeatCount || mRepeatCount == INFINITE) {
                    // Time to repeat
                    if (mListeners != null) {
                        int numListeners = mListeners.size();
                        for (int i = 0; i < numListeners; ++i) {
                            mListeners.get(i).onAnimationRepeat(this);
                        }
                    }
                    if (mRepeatMode == REVERSE) {
                        mPlayingBackwards = !mPlayingBackwards;
                    }
                    mCurrentIteration += (int) fraction;
                    fraction = fraction % 1f;
                    mStartTime += mDuration;
                } else {
                    done = true;
                    fraction = Math.min(fraction, 1.0f);
                }
            }
            if (mPlayingBackwards) {
                fraction = 1f - fraction;
            }
             //处理动画
            animateValue(fraction);   //代码见（3-4-3）
            break;
        }

        return done;
    }

**（3-4-3）**animateValue(fraction)，动画的每一帧变化，都会调用这个方式，将` elapsed fraction`通过`Interpolation`转换为所需的插值。之后获取的动画属性值，对于`evaluator`，大多数情况是在动画更新方式中调用，用。

**动画更新，通过实现`AnimatorUpdateListener`接口的`onAnimationUpdate()`方法。**

     void animateValue(float fraction) {
        fraction = mInterpolator.getInterpolation(fraction);  //获取插值
        mCurrentFraction = fraction;
        int numValues = mValues.length;
        for (int i = 0; i < numValues; ++i) {
            mValues[i].calculateValue(fraction); //计算相应的属性值
        }
        if (mUpdateListeners != null) {
            int numListeners = mUpdateListeners.size();
            for (int i = 0; i < numListeners; ++i) {
                mUpdateListeners.get(i).onAnimationUpdate(this); //更新动画
            }
        }
    }

**(3-4-4)**endAnimation()

    protected void endAnimation(AnimationHandler handler) {
        handler.mAnimations.remove(this);
        handler.mPendingAnimations.remove(this);
        handler.mDelayedAnims.remove(this);
        mPlayingState = STOPPED;
        mPaused = false;
        if ((mStarted || mRunning) && mListeners != null) {
            if (!mRunning) {
                // If it's not yet running, then start listeners weren't called. Call them now.
                notifyStartListeners();
             }
            ArrayList<AnimatorListener> tmpListeners =
                    (ArrayList<AnimatorListener>) mListeners.clone();
            int numListeners = tmpListeners.size();
            for (int i = 0; i < numListeners; ++i) {
                tmpListeners.get(i).onAnimationEnd(this); // 动画结束
            }
        }
        mRunning = false;
        mStarted = false;
        mStartListenersCalled = false;
        mPlayingBackwards = false;
        mReversing = false;
        mCurrentIteration = 0;
        if (Trace.isTagEnabled(Trace.TRACE_TAG_VIEW)) {
            Trace.asyncTraceEnd(Trace.TRACE_TAG_VIEW, getNameForTrace(),
                    System.identityHashCode(this));
        }
    }


**动画结束，通过实现`AnimatorListener`接口的`onAnimationEnd()`方法。**

**（3-4-5）**scheduleAnimation再次调用mChoreographer，与**（3-2-3）**步骤构成循环流程，不断重复执行这个过程，直到动画结束

    private void scheduleAnimation() {
        if (!mAnimationScheduled) {
            mChoreographer.postCallback(Choreographer.CALLBACK_ANIMATION, this, null);
            mAnimationScheduled = true;
        }
    }

到此，整个动画的完成流程已全部疏通完毕。

----------

## 总结
动画主线流程：  ObjectAnimator.start() -> ValueAnimator.start()
-> animationHandler.start() -> AnimationHandler.scheduleAnimation()
-> Choreographer.postCallback() -> postCallbackDelayed() -> postCallbackDelayedInternal() -> scheduleFrameLocked() -> scheduleVsyncLocked() -> DisplayEventReceiver.scheduleVsync() -> onVsync() -> doFrame(）-> doCallbacks()
-> animationHandler.run() ->doAnimationFrame() -> animationFrame() -> animateValue()
目前先文字叙述，后面有空再画详细流程图。
