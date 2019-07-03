---
layout: post
title:  "Toast源码分析"
date:   2018-03-03 10:11:12
catalog:  true
tags:
    - android

---

> 基于Android 7.0源码分析Toast机制，相关源码如下：

## 一. 概述

### 1.1 使用实例

    Toast.makeText(context, msg, Toast.LENGTH_SHORT).show(); 


## 二. 原理

Toast.show
  NMS.enqueueToast
    NMS.showNextToastLocked
      record.callback.show
        Toast.TN.show
            mHandler.post(mShow)
              handleShow
                mWM.addView
      scheduleTimeoutLocked
        handleTimeout
          cancelToastLocked
            record.callback.hide
              ...
      
### 2.1 show
[-> Toast.java]

    public void show() {

        INotificationManager service = getService();
        String pkg = mContext.getOpPackageName();
        TN tn = mTN;
        tn.mNextView = mNextView;

        try {
            service.enqueueToast(pkg, tn, mDuration);
        } catch (RemoteException e) {
            
        }
    }

    public void cancel() {
        mTN.hide();
        try {
            getService().cancelToast(mContext.getPackageName(), mTN);
        } catch (RemoteException e) {
            
        }
    }
