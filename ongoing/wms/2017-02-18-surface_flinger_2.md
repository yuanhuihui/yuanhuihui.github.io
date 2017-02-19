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
        doDebugFlashRegions(); //用于调试
        doComposition(); //【见小节5.1】
        postComposition(); //【见小节6.1】
    }

先来看看SurfaceFlinger主线程绘制的systrace图

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
        if (needExtraInvalidate) {
            signalLayerUpdate(); //发送invalidate消息【见小节2.3】
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

### 2.3 signalLayerUpdate

    void SurfaceFlinger::signalLayerUpdate() {
        mEventQueue.invalidate();
    }

## 三. rebuildLayerStacks

    void SurfaceFlinger::rebuildLayerStacks() {
        //重新建立每一个屏幕上的所有可见的图层列表
        if (CC_UNLIKELY(mVisibleRegionsDirty)) {
            ATRACE_CALL();
            mVisibleRegionsDirty = false;
            invalidateHwcGeometry();

            const LayerVector& layers(mDrawingState.layersSortedByZ);
            for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                Region opaqueRegion;
                Region dirtyRegion;
                Vector< sp<Layer> > layersSortedByZ;
                const sp<DisplayDevice>& hw(mDisplays[dpy]);
                const Transform& tr(hw->getTransform());
                const Rect bounds(hw->getBounds());
                if (hw->isDisplayOn()) {
                    SurfaceFlinger::computeVisibleRegions(layers,
                            hw->getLayerStack(), dirtyRegion, opaqueRegion);

                    const size_t count = layers.size();
                    for (size_t i=0 ; i<count ; i++) {
                        const sp<Layer>& layer(layers[i]);
                        const Layer::State& s(layer->getDrawingState());
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
            // build the h/w work list
            if (CC_UNLIKELY(mHwWorkListDirty)) {
                mHwWorkListDirty = false;
                for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                    sp<const DisplayDevice> hw(mDisplays[dpy]);
                    const int32_t id = hw->getHwcDisplayId();
                    if (id >= 0) {
                        const Vector< sp<Layer> >& currentLayers(
                            hw->getVisibleLayersSortedByZ());
                        const size_t count = currentLayers.size();
                        if (hwc.createWorkList(id, count) == NO_ERROR) {
                            HWComposer::LayerListIterator cur = hwc.begin(id);
                            const HWComposer::LayerListIterator end = hwc.end(id);
                            for (size_t i=0 ; cur!=end && i<count ; ++i, ++cur) {
                                const sp<Layer>& layer(currentLayers[i]);
                                layer->setGeometry(hw, *cur);
                                if (mDebugDisableHWC || mDebugRegion || mDaltonize || mHasColorMatrix) {
                                    cur->setSkip(true);
                                }
                            }
                        }
                    }
                }
            }

            // set the per-frame data
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
                         */
                        const sp<Layer>& layer(currentLayers[i]);
                        layer->setPerFrameData(hw, *cur);
                    }
                }
            }

            // If possible, attempt to use the cursor overlay on each display.
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

            status_t err = hwc.prepare();
            ALOGE_IF(err, "HWComposer::prepare failed (%s)", strerror(-err));

            for (size_t dpy=0 ; dpy<mDisplays.size() ; dpy++) {
                sp<const DisplayDevice> hw(mDisplays[dpy]);
                hw->prepareFrame(hwc);
            }
        }
    }
## 五. doComposition
## 六. postComposition
