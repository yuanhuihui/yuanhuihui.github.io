---
layout: post
title:  "SurfaceFlinger原理(二)"
date:   2017-02-18 20:30:00
catalog:  true
tags:
    - android
---

> 基于Android 6.0源码， 分析SurfaceFlinger原理

    frameworks/native/services/surfaceflinger
        - Layer.cpp
        - Client.cpp

## 一. 图形显示输出

上一篇文章，介绍了SurfaceFlinger和VSync的处理流程。当SurfaceFlinger进程收到VSync信号后经层层调用，
最终调用到该对象的handleMessageRefresh()方法。接下来，从该方法说起。


### 1.1 SF.handleMessageRefresh
[-> SurfaceFlinger.cpp]

    void SurfaceFlinger::handleMessageRefresh() {
        ATRACE_CALL();
        preComposition(); //【见小节2.1】
        rebuildLayerStacks(); //【见小节3.1】
        setUpHWComposer(); //【见小节4.1】
        doDebugFlashRegions(); 
        doComposition(); //【见小节5.1】
        postComposition(); //【见小节6.1】
    }

先来看看SurfaceFlinger主线程绘制的systrace图：点击查看[大图](http://gityuan.com/images/surfaceFlinger/systrace_sf.png)

![systrace_sf](/images/surfaceFlinger/systrace_sf.png)

## 二. preComposition

### 2.1 preComposition

    void SurfaceFlinger::preComposition()
    {
        bool needExtraInvalidate = false;
        const LayerVector& layers(mDrawingState.layersSortedByZ);
        const size_t count = layers.size();
        for (size_t i=0 ; i<count ; i++) {
            //回调每个图层onPreComposition方法【见小节2.2】
            if (layers[i]->onPreComposition()) {
                needExtraInvalidate = true;
            }
        }
        
        //当存在图层有变化，则发送invalidate消息
        if (needExtraInvalidate) {
            signalLayerUpdate(); //【见小节2.3】
        }
    }
    
此处mDrawingState结构体如下：

    struct State {
        //所有参与绘制的Layer图层
        LayerVector layersSortedByZ; 
        //所有输出设备的对象
        DefaultKeyedVector< wp<IBinder>, DisplayDeviceState> displays;
    };

SurfaceFlinger可以控制某些Layer不参与绘制过程，比如需要将悬浮按钮图层隐藏。

### 2.2 onPreComposition
[-> Layer.cpp]

    bool Layer::onPreComposition() {
        mRefreshPending = false;
        return mQueuedFrames > 0 || mSidebandStreamChanged;
    }

mQueuedFrames初始化值为零，当其大于零则代表图层发生变化。那么onFrameAvailable时会对
mQueuedFrames执行加1操作。

#### 2.2.1 onFrameAvailable
[-> Layer.cpp]

    void Layer::onFrameAvailable(const BufferItem& item) {
        { // Autolock scope
            Mutex::Autolock lock(mQueueItemLock);

            if (item.mFrameNumber == 1) {
                mLastFrameNumberReceived = 0;
            }

            while (item.mFrameNumber != mLastFrameNumberReceived + 1) {
                status_t result = mQueueItemCondition.waitRelative(mQueueItemLock,
                        ms2ns(500));
            }

            mQueueItems.push_back(item);
            android_atomic_inc(&mQueuedFrames); //加1操作

            //唤醒所有pending的回调方法
            mLastFrameNumberReceived = item.mFrameNumber;
            mQueueItemCondition.broadcast();
        }

        mFlinger->signalLayerUpdate(); //【见小节2.3】
    }

### 2.3 signalLayerUpdate

    void SurfaceFlinger::signalLayerUpdate() {
        mEventQueue.invalidate();
    }

#### 2.3.1 invalidate
[-> MessageQueue.cpp]

    void MessageQueue::invalidate() {
    #if INVALIDATE_ON_VSYNC
        mEvents->requestNextVsync();
    #else
        mHandler->dispatchInvalidate();
    #endif
    }

#### 2.3.2 dispatchInvalidate

    void MessageQueue::Handler::dispatchInvalidate() {
        if ((android_atomic_or(eventMaskInvalidate, &mEventMask) & eventMaskInvalidate) == 0) {
            mQueue.mLooper->sendMessage(this, Message(MessageQueue::INVALIDATE));
        }
    }

发送消息到MessageQueue队列，Looper遍历消息后回调handleMessage方法来处理消息。

#### 2.3.3 handleMessage

    void MessageQueue::Handler::handleMessage(const Message& message) {
        switch (message.what) {
            case INVALIDATE:
                android_atomic_and(~eventMaskInvalidate, &mEventMask);
                mQueue.mFlinger->onMessageReceived(message.what);
                break;
            case REFRESH:
                android_atomic_and(~eventMaskRefresh, &mEventMask);
                mQueue.mFlinger->onMessageReceived(message.what);
                break;
            case TRANSACTION:
                android_atomic_and(~eventMaskTransaction, &mEventMask);
                mQueue.mFlinger->onMessageReceived(message.what);
                break;
        }
    }
    
#### 2.3.4 SF.onMessageReceived

    void SurfaceFlinger::onMessageReceived(int32_t what) {
        ATRACE_CALL();
        switch (what) {
            case MessageQueue::TRANSACTION: {
                handleMessageTransaction();
                break;
            }
            case MessageQueue::INVALIDATE: {
                //【见小节2.4】
                bool refreshNeeded = handleMessageTransaction();
                //【见小节2.5】
                refreshNeeded |= handleMessageInvalidate();
                refreshNeeded |= mRepaintEverything;
                if (refreshNeeded) {
                    signalRefresh(); //【见小节2.6】
                }
                break;
            }
            case MessageQueue::REFRESH: {
                handleMessageRefresh();
                break;
            }
        }
    }

当收到消息INVALIDATE时，则执行：

1. handleMessageTransaction；
2. handleMessageInvalidate；
3. 根据是否需要刷新，来决定是否执行signalRefresh。

### 2.4 handleMessageTransaction

    bool SurfaceFlinger::handleMessageTransaction() {
        uint32_t transactionFlags = peekTransactionFlags(eTransactionMask);
        if (transactionFlags) {
            handleTransaction(transactionFlags); //【见小节2.4.1】
            return true;
        }
        return false;
    }
    
#### 2.4.1 SF.handleTransaction

    void SurfaceFlinger::handleTransaction(uint32_t transactionFlags)
    {
        State drawingState(mDrawingState);

        Mutex::Autolock _l(mStateLock);
        const nsecs_t now = systemTime();
        mDebugInTransaction = now;

        transactionFlags = getTransactionFlags(eTransactionMask);
        handleTransactionLocked(transactionFlags); //【见小节2.4.2】

        mLastTransactionTime = systemTime() - now;
        mDebugInTransaction = 0;
        //设置mHwWorkListDirty=true
        invalidateHwcGeometry();
    }

#### 2.4.2 SF.handleTransactionLocked

    void SurfaceFlinger::handleTransactionLocked(uint32_t transactionFlags)
    {
        const LayerVector& currentLayers(mCurrentState.layersSortedByZ);
        const size_t count = currentLayers.size();

        //遍历所有Layer来执行其doTransaction方法
        if (transactionFlags & eTraversalNeeded) {
            for (size_t i=0 ; i<count ; i++) {
                const sp<Layer>& layer(currentLayers[i]);
                uint32_t trFlags = layer->getTransactionFlags(eTransactionNeeded);
                if (!trFlags) continue; //layer标志未改变则继续
                //【见小节2.4.3】
                const uint32_t flags = layer->doTransaction(0);
                if (flags & Layer::eVisibleRegion)
                    mVisibleRegionsDirty = true; //Layer成为可见，需更新
            }
        }

        // 处理显示设备的改变
        if (transactionFlags & eDisplayTransactionNeeded) {
            //当前显示设备状态的列表
            const KeyedVector<  wp<IBinder>, DisplayDeviceState>& curr(mCurrentState.displays);
            //之前使用过的显示设备状态的列表
            const KeyedVector<  wp<IBinder>, DisplayDeviceState>& draw(mDrawingState.displays);
            if (!curr.isIdenticalTo(draw)) {
                mVisibleRegionsDirty = true;
                const size_t cc = curr.size();
                      size_t dc = draw.size();

                for (size_t i=0 ; i<dc ; i++) {
                    const ssize_t j = curr.indexOfKey(draw.keyAt(i));
                    if (j < 0) {
                        if (!draw[i].isMainDisplay()) {
                            const sp<const DisplayDevice> defaultDisplay(getDefaultDisplayDevice());
                            defaultDisplay->makeCurrent(mEGLDisplay, mEGLContext);
                            sp<DisplayDevice> hw(getDisplayDevice(draw.keyAt(i)));
                            if (hw != NULL)
                                hw->disconnect(getHwComposer());
                            if (draw[i].type < DisplayDevice::NUM_BUILTIN_DISPLAY_TYPES)
                                mEventThread->onHotplugReceived(draw[i].type, false);
                            mDisplays.removeItem(draw.keyAt(i));
                        }
                    } else {
                        const DisplayDeviceState& state(curr[j]);
                        const wp<IBinder>& display(curr.keyAt(j));
                        const sp<IBinder> state_binder = IInterface::asBinder(state.surface);
                        const sp<IBinder> draw_binder = IInterface::asBinder(draw[i].surface);
                        if (state_binder != draw_binder) {
                            sp<DisplayDevice> hw(getDisplayDevice(display));
                            if (hw != NULL)
                                hw->disconnect(getHwComposer());
                            mDisplays.removeItem(display);
                            mDrawingState.displays.removeItemsAt(i);
                            dc--; i--;
                            continue;
                        }

                        const sp<DisplayDevice> disp(getDisplayDevice(display));
                        if (disp != NULL) {
                            if (state.layerStack != draw[i].layerStack) {
                                disp->setLayerStack(state.layerStack);
                            }
                            if ((state.orientation != draw[i].orientation)
                                    || (state.viewport != draw[i].viewport)
                                    || (state.frame != draw[i].frame))
                            {
                                disp->setProjection(state.orientation,
                                        state.viewport, state.frame);
                            }
                            if (state.width != draw[i].width || state.height != draw[i].height) {
                                disp->setDisplaySize(state.width, state.height);
                            }
                        }
                    }
                }

                //增加的显示设备
                for (size_t i=0 ; i<cc ; i++) {
                    if (draw.indexOfKey(curr.keyAt(i)) < 0) {
                        const DisplayDeviceState& state(curr[i]);

                        sp<DisplaySurface> dispSurface;
                        sp<IGraphicBufferProducer> producer;
                        sp<IGraphicBufferProducer> bqProducer;
                        sp<IGraphicBufferConsumer> bqConsumer;
                        BufferQueue::createBufferQueue(&bqProducer, &bqConsumer,
                                new GraphicBufferAlloc());

                        int32_t hwcDisplayId = -1;
                        if (state.isVirtualDisplay()) {
                            if (state.surface != NULL) {

                                int width = 0;
                                int status = state.surface->query(
                                        NATIVE_WINDOW_WIDTH, &width);
                                int height = 0;
                                status = state.surface->query(
                                        NATIVE_WINDOW_HEIGHT, &height);
                                if (MAX_VIRTUAL_DISPLAY_DIMENSION == 0 ||
                                        (width <= MAX_VIRTUAL_DISPLAY_DIMENSION &&
                                         height <= MAX_VIRTUAL_DISPLAY_DIMENSION)) {
                                    hwcDisplayId = allocateHwcDisplayId(state.type);
                                }

                                sp<VirtualDisplaySurface> vds = new VirtualDisplaySurface(
                                        *mHwc, hwcDisplayId, state.surface,
                                        bqProducer, bqConsumer, state.displayName);

                                dispSurface = vds;
                                producer = vds;
                            }
                        } else {
                            hwcDisplayId = allocateHwcDisplayId(state.type);
                            dispSurface = new FramebufferSurface(*mHwc, state.type,
                                    bqConsumer);
                            producer = bqProducer;
                        }

                        const wp<IBinder>& display(curr.keyAt(i));
                        if (dispSurface != NULL) {
                            sp<DisplayDevice> hw = new DisplayDevice(this,
                                    state.type, hwcDisplayId,
                                    mHwc->getFormat(hwcDisplayId), state.isSecure,
                                    display, dispSurface, producer,
                                    mRenderEngine->getEGLConfig());
                            hw->setLayerStack(state.layerStack);
                            hw->setProjection(state.orientation,
                                    state.viewport, state.frame);
                            hw->setDisplayName(state.displayName);
                            mDisplays.add(display, hw);
                            if (state.isVirtualDisplay()) {
                                if (hwcDisplayId >= 0) {
                                    mHwc->setVirtualDisplayProperties(hwcDisplayId,
                                            hw->getWidth(), hw->getHeight(),
                                            hw->getFormat());
                                }
                            } else {
                                mEventThread->onHotplugReceived(state.type, true);
                            }
                        }
                    }
                }
            }
        }

        if (transactionFlags & (eTraversalNeeded|eDisplayTransactionNeeded)) {
            sp<const DisplayDevice> disp;
            uint32_t currentlayerStack = 0;
            for (size_t i=0; i<count; i++) {
                const sp<Layer>& layer(currentLayers[i]);
                uint32_t layerStack = layer->getDrawingState().layerStack;
                if (i==0 || currentlayerStack != layerStack) {
                    currentlayerStack = layerStack;
                    disp.clear();
                    for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                        sp<const DisplayDevice> hw(mDisplays[dpy]);
                        if (hw->getLayerStack() == currentlayerStack) {
                            if (disp == NULL) {
                                disp = hw;
                            } else {
                                disp = NULL;
                                break;
                            }
                        }
                    }
                }
                if (disp == NULL) {
                    disp = getDefaultDisplayDevice();
                }
                layer->updateTransformHint(disp);
            }
        }

        const LayerVector& layers(mDrawingState.layersSortedByZ);
        // layers增加
        if (currentLayers.size() > layers.size()) {
            // layers have been added
            mVisibleRegionsDirty = true;
        }

        // layers移除
        if (mLayersRemoved) {
            mLayersRemoved = false;
            mVisibleRegionsDirty = true;
            const size_t count = layers.size();
            for (size_t i=0 ; i<count ; i++) {
                const sp<Layer>& layer(layers[i]);
                if (currentLayers.indexOf(layer) < 0) {
                    const Layer::State& s(layer->getDrawingState());
                    Region visibleReg = s.transform.transform(
                            Region(Rect(s.active.w, s.active.h)));
                    invalidateLayerStack(s.layerStack, visibleReg);
                }
            }
        }
        
        commitTransaction(); //【见小节2.4.4】
        updateCursorAsync(); //【见小节2.4.5】
    }


handleTransactionLocked方法的主要工作：

1. 遍历所有Layer来执行其doTransaction方法；
2. 处理显示设备的改变；
3. 处理layers的改变；
4. 提交transaction，并更新光标情况。

#### 2.4.3 doTransaction
[-> Layer.cpp]

    uint32_t Layer::doTransaction(uint32_t flags) {
        const Layer::State& s(getDrawingState()); //上次绘制状态
        const Layer::State& c(getCurrentState()); //当前设置的绘制状态

        const bool sizeChanged = (c.requested.w != s.requested.w) ||
                                 (c.requested.h != s.requested.h);

        if (sizeChanged) {
            //当Layer尺寸改变，则调整surface缓存区大小
            mSurfaceFlingerConsumer->setDefaultBufferSize(
                    c.requested.w, c.requested.h);
        }

        if (!isFixedSize()) {
            const bool resizePending = (c.requested.w != c.active.w) ||
                                       (c.requested.h != c.active.h);
            //当Layer不是固定大小，且请求大小和实际大小不同。
            if (resizePending && mSidebandStream == NULL) {
                flags |= eDontUpdateGeometryState;
            }
        }

        if (flags & eDontUpdateGeometryState)  {
        } else {
            Layer::State& editCurrentState(getCurrentState());
            editCurrentState.active = c.requested;
        }

        if (s.active != c.active) {
            flags |= Layer::eVisibleRegion; // invalidate且重新计算可见区域
        }

        if (c.sequence != s.sequence) {
            flags |= eVisibleRegion; // invalidate且重新计算可见区域
            this->contentDirty = true;
            const uint8_t type = c.transform.getType();
            mNeedsFiltering = (!c.transform.preserveRects() ||
                    (type >= Transform::SCALE));
        }

        commitTransaction(); //【见小节2.4.4】
        return flags;
    }

#### 2.4.4 commitTransaction

    void SurfaceFlinger::commitTransaction()
    {
        if (!mLayersPendingRemoval.isEmpty()) {
            // Notify removed layers now that they can't be drawn from
            for (size_t i = 0; i < mLayersPendingRemoval.size(); i++) {
                mLayersPendingRemoval[i]->onRemoved();
            }
            mLayersPendingRemoval.clear();
        }

        mAnimCompositionPending = mAnimTransactionPending;
        mDrawingState = mCurrentState; //设置状态
        mTransactionPending = false;
        mAnimTransactionPending = false;
        mTransactionCV.broadcast(); //唤醒
    }
    
#### 2.4.5 updateCursorAsync

    void SurfaceFlinger::updateCursorAsync()
    {
        HWComposer& hwc(getHwComposer());
        for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
            sp<const DisplayDevice> hw(mDisplays[dpy]);
            const int32_t id = hw->getHwcDisplayId();
            if (id < 0) {
                continue;
            }
            const Vector< sp<Layer> >& currentLayers(
                hw->getVisibleLayersSortedByZ());
            const size_t count = currentLayers.size();
            HWComposer::LayerListIterator cur = hwc.begin(id);
            const HWComposer::LayerListIterator end = hwc.end(id);
            for (size_t i=0 ; cur!=end && i<count ; ++i, ++cur) {
                if (cur->getCompositionType() != HWC_CURSOR_OVERLAY) {
                    continue;
                }
                const sp<Layer>& layer(currentLayers[i]);
                Rect cursorPos = layer->getPosition(hw);
                hwc.setCursorPositionAsync(id, cursorPos);
                break;
            }
        }
    }

### 2.5 SF.handleMessageInvalidate

    bool SurfaceFlinger::handleMessageInvalidate() {
        ATRACE_CALL();
        return handlePageFlip(); //【见小节2.5.1】
    }

#### 2.5.1 SF.handlePageFlip

    bool SurfaceFlinger::handlePageFlip()
    {
        Region dirtyRegion;

        bool visibleRegions = false;
        const LayerVector& layers(mDrawingState.layersSortedByZ);
        bool frameQueued = false;

        Vector<Layer*> layersWithQueuedFrames;
        for (size_t i = 0, count = layers.size(); i<count ; i++) {
            const sp<Layer>& layer(layers[i]);
            //判断Layer是否有需要更新的图层
            if (layer->hasQueuedFrame()) {
                frameQueued = true;
                if (layer->shouldPresentNow(mPrimaryDispSync)) {
                    //将需要更新的图层放入layersWithQueuedFrames
                    layersWithQueuedFrames.push_back(layer.get());
                } else {
                    layer->useEmptyDamage();
                }
            } else {
                layer->useEmptyDamage();
            }
        }
        for (size_t i = 0, count = layersWithQueuedFrames.size() ; i<count ; i++) {
            Layer* layer = layersWithQueuedFrames[i];
            //调用latchBuffer来处理
            const Region dirty(layer->latchBuffer(visibleRegions));
            layer->useSurfaceDamage();
            const Layer::State& s(layer->getDrawingState());
            invalidateLayerStack(s.layerStack, dirty);
        }

        mVisibleRegionsDirty |= visibleRegions;

        if (frameQueued && layersWithQueuedFrames.empty()) {
            signalLayerUpdate();
        }
        return !layersWithQueuedFrames.empty();
    }

### 2.6 signalRefresh

    void SurfaceFlinger::signalRefresh() {
        mEventQueue.refresh();
    }

处理过程类似于[小节2.3] signalLayerUpdate，最终会调用[小节1.1] SF.handleMessageRefresh()。

## 三. rebuildLayerStacks

    void SurfaceFlinger::rebuildLayerStacks() {
        if (CC_UNLIKELY(mVisibleRegionsDirty)) {
            mVisibleRegionsDirty = false;
            invalidateHwcGeometry();
            //每个显示屏中的所有可见图层列表
            const LayerVector& layers(mDrawingState.layersSortedByZ);
            for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                Region opaqueRegion;
                Region dirtyRegion;
                Vector< sp<Layer> > layersSortedByZ;
                const sp<DisplayDevice>& hw(mDisplays[dpy]);
                const Transform& tr(hw->getTransform());
                const Rect bounds(hw->getBounds());
                if (hw->isDisplayOn()) {
                    //计算每个Layer的可见区域
                    SurfaceFlinger::computeVisibleRegions(layers,
                            hw->getLayerStack(), dirtyRegion, opaqueRegion);

                    const size_t count = layers.size();
                    for (size_t i=0 ; i<count ; i++) {
                        const sp<Layer>& layer(layers[i]);
                        const Layer::State& s(layer->getDrawingState());
                        //当前layer和显示设备的layerStack相同
                        if (s.layerStack == hw->getLayerStack()) {
                            Region drawRegion(tr.transform(
                                    layer->visibleNonTransparentRegion));
                            drawRegion.andSelf(bounds);
                            if (!drawRegion.isEmpty()) {
                                layersSortedByZ.add(layer);
                            }
                        }
                    }
                }
                hw->setVisibleLayersSortedByZ(layersSortedByZ);
                hw->undefinedRegion.set(bounds);
                hw->undefinedRegion.subtractSelf(tr.transform(opaqueRegion));
                hw->dirtyRegion.orSelf(dirtyRegion);
            }
        }
    }

重建所有显示屏的各个可见Layer列表，根据Z轴排序。

## 四. setUpHWComposer

    void SurfaceFlinger::setUpHWComposer() {
        for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
            bool dirty = !mDisplays[dpy]->getDirtyRegion(false).isEmpty();
            bool empty = mDisplays[dpy]->getVisibleLayersSortedByZ().size() == 0;
            bool wasEmpty = !mDisplays[dpy]->lastCompositionHadVisibleLayers;
            bool mustRecompose = dirty && !(empty && wasEmpty);
            mDisplays[dpy]->beginFrame(mustRecompose);

            if (mustRecompose) {
                mDisplays[dpy]->lastCompositionHadVisibleLayers = !empty;
            }
        }

        HWComposer& hwc(getHwComposer());
        if (hwc.initCheck() == NO_ERROR) {
            if (CC_UNLIKELY(mHwWorkListDirty)) {
                mHwWorkListDirty = false;
                for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                    sp<const DisplayDevice> hw(mDisplays[dpy]);
                    const int32_t id = hw->getHwcDisplayId();
                    if (id >= 0) {
                        const Vector< sp<Layer> >& currentLayers(
                            hw->getVisibleLayersSortedByZ());
                        const size_t count = currentLayers.size();
                        //在HWComposer中创建列表
                        if (hwc.createWorkList(id, count) == NO_ERROR) {
                            HWComposer::LayerListIterator cur = hwc.begin(id);
                            const HWComposer::LayerListIterator end = hwc.end(id);
                            for (size_t i=0 ; cur!=end && i<count ; ++i, ++cur) {
                                const sp<Layer>& layer(currentLayers[i]);
                                layer->setGeometry(hw, *cur);
                            }
                        }
                    }
                }
            }

            //设置每帧的数据
            for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                sp<const DisplayDevice> hw(mDisplays[dpy]);
                const int32_t id = hw->getHwcDisplayId();
                if (id >= 0) {
                    const Vector< sp<Layer> >& currentLayers(
                        hw->getVisibleLayersSortedByZ());
                    const size_t count = currentLayers.size();
                    HWComposer::LayerListIterator cur = hwc.begin(id);
                    const HWComposer::LayerListIterator end = hwc.end(id);
                    for (size_t i=0 ; cur!=end && i<count ; ++i, ++cur) {
                        /*
                         * update the per-frame h/w composer data for each layer
                         * and build the transparent region of the FB
                        /为每一个layer,更新每帧h/w合成器的数据
                        const sp<Layer>& layer(currentLayers[i]);
                        layer->setPerFrameData(hw, *cur);
                    }
                }
            }

            //在每一个显示屏上，尝试使用cursor overlay
            for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                sp<const DisplayDevice> hw(mDisplays[dpy]);
                const int32_t id = hw->getHwcDisplayId();
                if (id >= 0) {
                    const Vector< sp<Layer> >& currentLayers(
                        hw->getVisibleLayersSortedByZ());
                    const size_t count = currentLayers.size();
                    HWComposer::LayerListIterator cur = hwc.begin(id);
                    const HWComposer::LayerListIterator end = hwc.end(id);
                    for (size_t i=0 ; cur!=end && i<count ; ++i, ++cur) {
                        const sp<Layer>& layer(currentLayers[i]);
                        if (layer->isPotentialCursor()) {
                            cur->setIsCursorLayerHint();
                            break;
                        }
                    }
                }
            }

            status_t err = hwc.prepare(); //【见小节4.1】
            for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                sp<const DisplayDevice> hw(mDisplays[dpy]);
                hw->prepareFrame(hwc);
            }
        }
    }
  
### 4.1 HWC.prepare

    status_t HWComposer::prepare() {
        Mutex::Autolock _l(mDisplayLock);
        for (size_t i=0 ; i<mNumDisplays ; i++) {
            DisplayData& disp(mDisplayData[i]);
            if (disp.framebufferTarget) {
                disp.framebufferTarget->compositionType = HWC_FRAMEBUFFER_TARGET;
            }
            mLists[i] = disp.list;
            if (mLists[i]) {
                if (hwcHasApiVersion(mHwc, HWC_DEVICE_API_VERSION_1_3)) {
                    mLists[i]->outbuf = disp.outbufHandle;
                    mLists[i]->outbufAcquireFenceFd = -1;
                } else if (hwcHasApiVersion(mHwc, HWC_DEVICE_API_VERSION_1_1)) {
                    mLists[i]->dpy = (hwc_display_t)0xDEADBEEF;
                    mLists[i]->sur = (hwc_surface_t)0xDEADBEEF;
                } else {
                    mLists[i]->dpy = EGL_NO_DISPLAY;
                    mLists[i]->sur = EGL_NO_SURFACE;
                }
            }
        }

        int err = mHwc->prepare(mHwc, mNumDisplays, mLists);

        if (err == NO_ERROR) {
            for (size_t i=0 ; i<mNumDisplays ; i++) {
                DisplayData& disp(mDisplayData[i]);
                disp.hasFbComp = false;
                disp.hasOvComp = false;
                if (disp.list) {
                    for (size_t i=0 ; i<disp.list->numHwLayers ; i++) {
                        hwc_layer_1_t& l = disp.list->hwLayers[i];

                        if (l.flags & HWC_SKIP_LAYER) {
                            l.compositionType = HWC_FRAMEBUFFER;
                        }
                        if (l.compositionType == HWC_FRAMEBUFFER) {
                            disp.hasFbComp = true;
                        }
                        if (l.compositionType == HWC_OVERLAY) {
                            disp.hasOvComp = true;
                        }
                        if (l.compositionType == HWC_CURSOR_OVERLAY) {
                            disp.hasOvComp = true;
                        }
                    }
                    if (disp.list->numHwLayers == (disp.framebufferTarget ? 1 : 0)) {
                        disp.hasFbComp = true;
                    }
                } else {
                    disp.hasFbComp = true;
                }
            }
        }
        return (status_t)err;
    }  
    
## 五. doComposition

    void SurfaceFlinger::doComposition() {
        const bool repaintEverything = android_atomic_and(0, &mRepaintEverything);
        for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
            const sp<DisplayDevice>& hw(mDisplays[dpy]);
            if (hw->isDisplayOn()) {
                //将脏区域转换为此屏幕的坐标空间
                const Region dirtyRegion(hw->getDirtyRegion(repaintEverything));

                //如果需要，则重绘framebuffer【见小节5.1】
                doDisplayComposition(hw, dirtyRegion);

                hw->dirtyRegion.clear();
                hw->flip(hw->swapRegion);
                hw->swapRegion.clear();
            }
            //通知h/w我们已完成合成操作
            hw->compositionComplete();
        }
        postFramebuffer(); //【见小节5.3】
    }

### 5.1 doDisplayComposition

    void SurfaceFlinger::doDisplayComposition(const sp<const DisplayDevice>& hw,
            const Region& inDirtyRegion)
    {
        bool isHwcDisplay = hw->getHwcDisplayId() >= 0;
        if (!isHwcDisplay && inDirtyRegion.isEmpty()) {
            return;
        }
        Region dirtyRegion(inDirtyRegion);

        //计算需要更新的区域
        hw->swapRegion.orSelf(dirtyRegion);

        uint32_t flags = hw->getFlags();
        if (flags & DisplayDevice::SWAP_RECTANGLE) {
            //矩形更新模式
            dirtyRegion.set(hw->swapRegion.bounds());
        } else {
            if (flags & DisplayDevice::PARTIAL_UPDATES) {
                //部分更新模式
                dirtyRegion.set(hw->swapRegion.bounds());
            } else {
                //更新区域为整个屏幕
                dirtyRegion.set(hw->bounds());
                hw->swapRegion = dirtyRegion;
            }
        }

        if (CC_LIKELY(!mDaltonize && !mHasColorMatrix)) {
            if (!doComposeSurfaces(hw, dirtyRegion)) return;
        } else {
            RenderEngine& engine(getRenderEngine());
            mat4 colorMatrix = mColorMatrix;
            if (mDaltonize) {
                colorMatrix = colorMatrix * mDaltonizer();
            }
            mat4 oldMatrix = engine.setupColorTransform(colorMatrix);
            doComposeSurfaces(hw, dirtyRegion);
            engine.setupColorTransform(oldMatrix);
        }

        //更新交换区域，并清除脏区域
        hw->swapRegion.orSelf(dirtyRegion);
        //交换buffer，输出图像
        hw->swapBuffers(getHwComposer());
    }

### 5.2 doComposeSurfaces

    bool SurfaceFlinger::doComposeSurfaces(const sp<const DisplayDevice>& hw, const Region& dirty)
    {
        RenderEngine& engine(getRenderEngine());
        const int32_t id = hw->getHwcDisplayId();
        HWComposer& hwc(getHwComposer());
        HWComposer::LayerListIterator cur = hwc.begin(id);
        const HWComposer::LayerListIterator end = hwc.end(id);

        bool hasGlesComposition = hwc.hasGlesComposition(id);
        if (hasGlesComposition) {
            if (!hw->makeCurrent(mEGLDisplay, mEGLContext)) {
                eglMakeCurrent(mEGLDisplay, EGL_NO_SURFACE, EGL_NO_SURFACE, EGL_NO_CONTEXT);
                if(!getDefaultDisplayDevice()->makeCurrent(mEGLDisplay, mEGLContext)) {
                }
                return false;
            }

            const bool hasHwcComposition = hwc.hasHwcComposition(id);
            if (hasHwcComposition) {
                engine.clearWithColor(0, 0, 0, 0);
            } else {
                //全屏
                const Region bounds(hw->getBounds());
                const Region letterbox(bounds.subtract(hw->getScissor()));
                Region region(hw->undefinedRegion.merge(letterbox));
                region.andSelf(dirty);

                if (!region.isEmpty()) {
                    //能发生在SurfaceView
                    drawWormhole(hw, region);
                }
            }

            if (hw->getDisplayType() != DisplayDevice::DISPLAY_PRIMARY) {
                const Rect& bounds(hw->getBounds());
                const Rect& scissor(hw->getScissor());
                if (scissor != bounds) {
                    const uint32_t height = hw->getHeight();
                    engine.setScissor(scissor.left, height - scissor.bottom,
                            scissor.getWidth(), scissor.getHeight());
                }
            }
        }

        const Vector< sp<Layer> >& layers(hw->getVisibleLayersSortedByZ());
        const size_t count = layers.size();
        const Transform& tr = hw->getTransform();
        if (cur != end) {
            //使用h/w composer
            for (size_t i=0 ; i<count && cur!=end ; ++i, ++cur) {
                const sp<Layer>& layer(layers[i]);
                const Region clip(dirty.intersect(tr.transform(layer->visibleRegion)));
                if (!clip.isEmpty()) {
                    switch (cur->getCompositionType()) {
                        case HWC_CURSOR_OVERLAY:
                        case HWC_OVERLAY: {
                            const Layer::State& state(layer->getDrawingState());
                            if ((cur->getHints() & HWC_HINT_CLEAR_FB)
                                    && i
                                    && layer->isOpaque(state) && (state.alpha == 0xFF)
                                    && hasGlesComposition) {
                                layer->clearWithOpenGL(hw, clip);
                            }
                            break;
                        }
                        case HWC_FRAMEBUFFER: {
                            layer->draw(hw, clip); //执行图像绘制
                            break;
                        }
                        case HWC_FRAMEBUFFER_TARGET: {
                            break;
                        }
                    }
                }
                layer->setAcquireFence(hw, *cur);
            }
        } else {
            //不使用h/w composer
            for (size_t i=0 ; i<count ; ++i) {
                const sp<Layer>& layer(layers[i]);
                const Region clip(dirty.intersect(
                        tr.transform(layer->visibleRegion)));
                if (!clip.isEmpty()) {
                    layer->draw(hw, clip);
                }
            }
        }

        engine.disableScissor();
        return true;
    }

### 5.3 postFramebuffer

    void SurfaceFlinger::postFramebuffer()
    {
        const nsecs_t now = systemTime();
        mDebugInSwapBuffers = now;

        HWComposer& hwc(getHwComposer());
        if (hwc.initCheck() == NO_ERROR) {
            if (!hwc.supportsFramebufferTarget()) {
                getDefaultDisplayDevice()->makeCurrent(mEGLDisplay, mEGLContext);
            }
            hwc.commit(); //【见小节5.4】
        }

        getDefaultDisplayDevice()->makeCurrent(mEGLDisplay, mEGLContext);

        for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
            sp<const DisplayDevice> hw(mDisplays[dpy]);
            const Vector< sp<Layer> >& currentLayers(hw->getVisibleLayersSortedByZ());
            hw->onSwapBuffersCompleted(hwc);
            const size_t count = currentLayers.size();
            int32_t id = hw->getHwcDisplayId();
            if (id >=0 && hwc.initCheck() == NO_ERROR) {
                HWComposer::LayerListIterator cur = hwc.begin(id);
                const HWComposer::LayerListIterator end = hwc.end(id);
                for (size_t i = 0; cur != end && i < count; ++i, ++cur) {
                    currentLayers[i]->onLayerDisplayed(hw, &*cur);
                }
            } else {
                for (size_t i = 0; i < count; i++) {
                    currentLayers[i]->onLayerDisplayed(hw, NULL);
                }
            }
        }

        mLastSwapBufferTime = systemTime() - now;
        mDebugInSwapBuffers = 0;

        uint32_t flipCount = getDefaultDisplayDevice()->getPageFlipCount();
        if (flipCount % LOG_FRAME_STATS_PERIOD == 0) {
            logFrameStats();
        }
    }

将数据写入framebuffer则完成物理屏幕的图像显示。

### 5.4 HWC.commit

    status_t HWComposer::commit() {
        int err = NO_ERROR;
        if (mHwc) {
            if (!hwcHasApiVersion(mHwc, HWC_DEVICE_API_VERSION_1_1)) {
                mLists[0]->dpy = eglGetCurrentDisplay();
                mLists[0]->sur = eglGetCurrentSurface(EGL_DRAW);
            }

            for (size_t i=VIRTUAL_DISPLAY_ID_BASE; i<mNumDisplays; i++) {
                DisplayData& disp(mDisplayData[i]);
                if (disp.outbufHandle) {
                    mLists[i]->outbuf = disp.outbufHandle;
                    mLists[i]->outbufAcquireFenceFd =
                            disp.outbufAcquireFence->dup();
                }
            }
            //处理图像输出到FrameBuffer
            err = mHwc->set(mHwc, mNumDisplays, mLists);

            for (size_t i=0 ; i<mNumDisplays ; i++) {
                DisplayData& disp(mDisplayData[i]);
                disp.lastDisplayFence = disp.lastRetireFence;
                disp.lastRetireFence = Fence::NO_FENCE;
                if (disp.list) {
                    if (disp.list->retireFenceFd != -1) {
                        disp.lastRetireFence = new Fence(disp.list->retireFenceFd);
                        disp.list->retireFenceFd = -1;
                    }
                    disp.list->flags &= ~HWC_GEOMETRY_CHANGED;
                }
            }
        }
        return (status_t)err;
    }
    
## 六. postComposition

    void SurfaceFlinger::postComposition()
    {
        const LayerVector& layers(mDrawingState.layersSortedByZ);
        const size_t count = layers.size();
        for (size_t i=0 ; i<count ; i++) {
            layers[i]->onPostComposition();
        }

        const HWComposer& hwc = getHwComposer();
        sp<Fence> presentFence = hwc.getDisplayFence(HWC_DISPLAY_PRIMARY);

        if (presentFence->isValid()) {
            if (mPrimaryDispSync.addPresentFence(presentFence)) {
                enableHardwareVsync();
            } else {
                disableHardwareVsync(false);
            }
        }

        const sp<const DisplayDevice> hw(getDefaultDisplayDevice());
        if (kIgnorePresentFences) {
            if (hw->isDisplayOn()) {
                enableHardwareVsync();
            }
        }

        if (mAnimCompositionPending) {
            mAnimCompositionPending = false;

            if (presentFence->isValid()) {
                mAnimFrameTracker.setActualPresentFence(presentFence);
            } else {
                nsecs_t presentTime = hwc.getRefreshTimestamp(HWC_DISPLAY_PRIMARY);
                mAnimFrameTracker.setActualPresentTime(presentTime);
            }
            mAnimFrameTracker.advanceFrame();
        }

        if (hw->getPowerMode() == HWC_POWER_MODE_OFF) {
            return;
        }

        nsecs_t currentTime = systemTime();
        if (mHasPoweredOff) {
            mHasPoweredOff = false;
        } else {
            nsecs_t period = mPrimaryDispSync.getPeriod();
            nsecs_t elapsedTime = currentTime - mLastSwapTime;
            size_t numPeriods = static_cast<size_t>(elapsedTime / period);
            if (numPeriods < NUM_BUCKETS - 1) {
                mFrameBuckets[numPeriods] += elapsedTime;
            } else {
                mFrameBuckets[NUM_BUCKETS - 1] += elapsedTime;
            }
            mTotalTime += elapsedTime;
        }
        mLastSwapTime = currentTime;
    }


## 七. 小结

简单总结图像输出流程：

1. preComposition：根据上次绘制的图层中是否有更新，来决定是否执行invalidate过程；
2. rebuildLayerStacks： 重建每个显示屏的所有可见Layer列表；
3. setUpHWComposer：更新HWComposer的图层
4. doComposition：合成所有图层的图像
5. postComposition：回调每个layer的onPostComposition。
