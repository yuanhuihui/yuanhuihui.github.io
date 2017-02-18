---
layout: post
title:  "四大组件之提纲篇"
date:   2017-8-22 22:12:30
catalog:    true
tags:
    - android
    - tool
    - debug

---



1. home -> ss -> target
2. ss -> target
3. 

## 一.概述


![ams_binder_class](/images/ams/ams_binder_class.jpg)


## service启动过程




- 主动调用stopService;
- 当包被移除或改变时;
- 当进程启动超时;
- 进程死亡;
- 执行trimApplications操作;
- 其他异常情况等.


## restart

## delay start

ServiceRecord.java

    Runnable restarter; //用于调度service的重启
    boolean delayed; //等待service在后台启动
    boolean delayedStop; // service已停止, 但还位于delay队列
    long startingBgTimeout;  //延迟启动的的调度时间点
    boolean startRequested; // 显示调用start service

    long restartDelay;      //直到下一次执行重启操作的延时时长
    long restartTime;       //上一次重启时间
    long nextRestartTime;   // time when restartDelay will expire.

ActiveServices.java

    ServiceMap.mDelayedStartList
    ServiceMap.mStartingBackground
    mRestartingServices


延迟启动与重启之间的问题