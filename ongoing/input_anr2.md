### 5.5 ANR时机


#### 1 解冻屏幕, 系统开/关机的时刻点

InputMonitor.updateInputDispatchModeLw
    setInputDispatchMode (本身自带)
        resetAndDropEverythingLocked

##### 1.1 updateInputDispatchModeLw

freezeInputDispatchingLw
thawInputDispatchingLw (这个会reset)
setEventDispatchingLw (这个参数为false, 也会reset)
    updateInputDispatchModeLw

代码:

    private void updateInputDispatchModeLw() {
        mService.mInputManager.setInputDispatchMode(mInputDispatchEnabled, mInputDispatchFrozen);
    }

    void InputDispatcher::setInputDispatchMode(bool enabled, bool frozen) {
    bool changed;
    {
        AutoMutex _l(mLock);

        if (mDispatchEnabled != enabled || mDispatchFrozen != frozen) {
            if (mDispatchFrozen && !frozen) {  //可以
                resetANRTimeoutsLocked();
            }

            if (mDispatchEnabled && !enabled) {  //可以
                resetAndDropEverythingLocked("dispatcher is being disabled");
            }

            mDispatchEnabled = enabled;
            mDispatchFrozen = frozen;
            changed = true;
        } else {
            changed = false;
        }


    if (changed) {
        // Wake up poll loop since it may need to make new input dispatching choices.
        mLooper->wake();
    }
}

#### 2 wms聚焦app的改变

WMS.setFocusedApp
WMS.removeAppToken
    InputDispatcher.setFocusedApplication

#### 3 设置input filter的过程
IMS.setInputFilter
    setInputFilterEnabled
        resetAndDropEverythingLocked (本身自带)
            InputDispatcher.releasePendingEventLocked

#### 4 再次分发事件的时候(也就是input把事件发送过来)

InputDispatcher.dispatchOnceInnerLocked (本身自带)  (没有mPendingEvent,则会reset)
    InputDispatcher.releasePendingEventLocked (该方法便会设置mPendingEvent为null)

- 当mPendingEvent为空, 并拿出新的mPendingEvent, 则reset;
- dispatchKeyLocked成功, 则reset.


### filter

!mPolicy->filterInputEvent
    IMS.filterInputEvent (返回false则拦截) (synchronized (mInputFilterLock)
        InputFilter.filterInputEvent
             mH.obtainMessage(MSG_INPUT_EVENT)
                 MiuiInputFilter.onInputEvent
                     MiuiInputFilter.onKeyEvent
                     MiuiInputFilter.onMotionEvent
                     InputFilter.onInputEvent
                         InputFilter.sendInputEvent
                             InputFilterHost.sendInputEvent (  synchronized (mInputFilterLock))
                                IMS.nativeInjectInputEvent
                                    InputDispatcher.injectInputEvent (mLock.lock)
                                         InputDispatcher.enqueueInboundEventLocked


小米目前, InputReader的filterInputEvent直接拦截消息. 发送消息到display线程. 经过层层调用之后, 由回到InputDispatcher

1. 下一步把DEBUG_INJECTION打开来调试InputDispatcher.injectInputEvent这个过程.
2. enqueueInboundEventLocked过程, 为何没有drop掉该事件??
3. findFocusedWindowTargetsLocked如果 mFocusedWindowHandle不为null, 但是mFocusedApplicationHandle为null, 怎么办?
4. http://gityuan.com/2016/12/31/input-ipc/, 3.2 handleEvent, 这个过程添加log
5. startDispatchCycleLocked的过程, 设置dispatchEntry->deliveryTime.
        MotionEvent( age=5318.2ms, wait=5316.4ms). age是指事件触发到当前的时间, wait是指deliveryTime到现在的时间.


通过 android_bWriteLog(LOGTAG_BINDER_OPERATION, buf, pos - buf);方法来输出native的Event log.


InputFilterHost mHost是在如下过程创建的:  

    IMS.setInputFilter
        mInputFilterHost = new InputFilterHost();
        InputFilter.install

mH初始化:

    public InputFilter(Looper looper) {
        mH = new H(looper);
    }
