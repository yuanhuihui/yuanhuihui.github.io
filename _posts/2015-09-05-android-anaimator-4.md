---
layout: post
title:  "Android动画系列（四）"
date:   2015-9-5 01：05:00
categories: android
excerpt:  Android属性动画原理篇
---

* content
{:toc}



----------

> 本文讲述动画的整个执行流程

在前面的文章中有讲到，Android动画的启动方式如下：

	ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f);
	anim.setDuration(1000);
	anim.start();

那么接下来，我们就从源码中来分析，分析这3条语句是如何调用动画的。

## 步骤1

（1）ObjectAnimator.ofFloat静态方法：首先是创建ObjectAnimator对象，指定target对象和属性名; 然后`setFloatValues(values)`，该方法最终是调用`KeyframeSet.ofFloat(values)`，创建了一个只有起始帧和结束帧(2-keyframe)的KeyframeSet对象。

	public static ObjectAnimator ofFloat(Object target, String propertyName, float... values) {
	    //创建ObjectAnimator对象
	    ObjectAnimator anim = new ObjectAnimator(target, propertyName); 
	    //设置float类型值 
	    anim.setFloatValues(values);  
	    return anim;
	}

## 步骤2
（2）anim.setDuration(1000)，用于设置动画的执行总时间，调用的是父类ValueAnimator的方法，。

	public ValueAnimator setDuration(long duration) {
        if (duration < 0) {
            throw new IllegalArgumentException("Animators cannot have negative duration: " +
                    duration);
        }
        mUnscaledDuration = duration;  //mUnscaledDuration的默认值为300ms
        updateScaledDuration(); //更新duration
        return this;
    }

	private void updateScaledDuration() {
		// sDurationScale默认为1，
        mDuration = (long)(mUnscaledDuration * sDurationScale);
    }

## 步骤3
（3）anim.start(),启动动画  
AnimationHandler中包含mAnimations（活动动画）， mPendingAnimations（下一帧的动画），mDelayedAnims（延时动画）这3个动画ArrayList，下面方法主要是判断这些动画中是否存在活动或将要活动的，如果存在则根据条件进行相应的取消操作。

### 3-1

	public void start() {
        // See if any of the current active/pending animators need to be canceled
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
        super.start(); //代码见（3-2）
    }

### 3-2 
之后再调用super.start()，再调用start(false)，为了精简内容，下面方法只截取关键的代码片段：



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

（3-2-1）
其中setCurrentPlayTime(0)，多次跳转后，调用animateValue(1)，插值器默认为AccelerateDecelerateInterpolator。
	
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

（3-2-2）
其中notifyStartListeners()，主要功能是调用onAnimationStart(this)

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

（3-2-3）
其中animationHandler.start()，在下一帧启动动画。

	private void scheduleAnimation() {
        if (!mAnimationScheduled) {
            mChoreographer.postCallback(Choreographer.CALLBACK_ANIMATION, this, null); //代码见（3-3）
            mAnimationScheduled = true;
        }
    }

### 3-3
mChoreographer.postCallback 方法，经过几次调用，最后调用postCallbackDelayedInternal()，传入进去的action的animationHandler：

    private void postCallbackDelayedInternal(int callbackType,
            Object action, Object token, long delayMillis) {
        if (DEBUG) {
            Log.d(TAG, "PostCallback: type=" + callbackType
                    + ", action=" + action + ", token=" + token
                    + ", delayMillis=" + delayMillis);
        }

        synchronized (mLock) {
            final long now = SystemClock.uptimeMillis();
            final long dueTime = now + delayMillis;
			 //此处action 为 animationHandler
            mCallbackQueues[callbackType].addCallbackLocked(dueTime, action, token);

            if (dueTime <= now) {
                scheduleFrameLocked(now); //代码见（3-3-1）
            } else {
                Message msg = mHandler.obtainMessage(MSG_DO_SCHEDULE_CALLBACK, action);
                msg.arg1 = callbackType;
                msg.setAsynchronous(true);
                mHandler.sendMessageAtTime(msg, dueTime);
            }
        }
    }

（3-3-1）其中scheduleFrameLocked（now）源码如下，其中USE_VSYNC=true：

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

（3-3-2）scheduleVsyncLocked（）再调用DisplayEventReceiver还触发vsync信号

	private void scheduleVsyncLocked() {
        mDisplayEventReceiver.scheduleVsync();
    }

（3-3-3）当接收到vsync信号时，会调用onVsync()方法，通过sendMessageAtTime，交由FrameHandler来处理消息

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

（3-3-4）FrameHandler在收到信息时，进行doFrame(System.nanoTime(), 0)，该方法的重点看最下面的doCallbacks执行，回调的处理顺序依次为：input事件, 动画，view布局和绘制。

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

        doCallbacks(Choreographer.CALLBACK_INPUT, frameTimeNanos);      //代码见（3-4-1）
        doCallbacks(Choreographer.CALLBACK_ANIMATION, frameTimeNanos);  //代码见（3-4-1）
        doCallbacks(Choreographer.CALLBACK_TRAVERSAL, frameTimeNanos);  //代码见（3-4-1）

    }

### 3-4
（3-4-1）doCallbacks，run方法调用的实际上是animationHandler.run();
    
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
                //运行方法调用 
                c.run(frameTimeNanos);  //代码见（3-4-2）
            }
        } finally {
            synchronized (mLock) {
                mCallbacksRunning = false;
                do {
                    final CallbackRecord next = callbacks.next;
                    recycleCallbackLocked(callbacks);
                    callbacks = next;
                } while (callbacks != null);
            }
        }
    }


(3-4-2)animationHandler.run()

	//  由Choreographer调用的
    @Override
    public void run() {
        mAnimationScheduled = false;
        //具体实现动画的一阵内容
        doAnimationFrame(mChoreographer.getFrameTime());   //代码见（3-4-3）
    }

（3-4-3）doAnimationFrame是消耗帧的过程，其中startAnimation会初始化Evalutor.

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
            if (mAnimations.contains(anim) && anim.doAnimationFrame(frameTime)) { //代码见（3-4-4）
                mEndingAnims.add(anim);
            }
        }
        //清空mTmpAnimations 和 mEndingAnims
        mTmpAnimations.clear();
        if (mEndingAnims.size() > 0) {
            for (int i = 0; i < mEndingAnims.size(); ++i) {
                mEndingAnims.get(i).endAnimation(this);
            }
            mEndingAnims.clear();
        }

        // 活动或延时动画不会空时，调用scheduleAnimation
        if (!mAnimations.isEmpty() || !mDelayedAnims.isEmpty()) {
            scheduleAnimation();   //代码见（3-4-5）
        }
    }

（3-4-4）animationFrame 绘制动画的帧，当动画的elapsed time时间草果动画的duration时，动画将结束。

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
            animateValue(fraction);
            break;
        }

        return done;
    }

（3-4-5）scheduleAnimation再次调用mChoreographer，与（3-2-3）步骤构成循环流程，直到动画结束

	private void scheduleAnimation() {
        if (!mAnimationScheduled) {
            mChoreographer.postCallback(Choreographer.CALLBACK_ANIMATION, this, null);
            mAnimationScheduled = true;
        }
    }

到此，整个动画的完成流程已全部疏通完毕。