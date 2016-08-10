---
layout: post
title:  "Android进程调度之adj算法"
date:   2016-08-07 22:30:00
catalog:  true
tags:
    - android
    - 组件
---

## 一、概述

提到进程调度，可能大家首先想到的是cpu调度算法，进程优先级这些概念，本文并不打算介绍这些内容，而是介绍Android framework层中承载activity/service/contentprovider/broadcastrecevier的进程是如何根据组件运行状态而动态调节进程自身的状态。进程有两个比较重要的状态值，即adj(定义在`ProcessList.java`)和procState(定义在`ActivityManager.java`)。

### 1.1 核心方法

调整进程的adj的3大护法：

- `updateOomAdjLocked`：更新adj，当目标进程为空，或者被杀则返回false；否则返回true;
- `computeOomAdjLocked`：计算adj，返回计算后RawAdj值;
- `applyOomAdjLocked`：应用adj，当需要杀掉目标进程则返回false；否则返回true。

前面提到调整adj的3大护法，最为常见的方法便是computeOomAdjLocked，这也是其他各个方法在需要更新adj时会调用的方法，该方法有3个不同参数的同名方法，定义如下：

    无参方法：updateOomAdjLocked()
    一参方法：updateOomAdjLocked(ProcessRecord app)
    三参方法：updateOomAdjLocked(ProcessRecord app, int cachedAdj,
        ProcessRecord TOP_APP, boolean doingAll, long now)

updateOomAdjLocked的实现过程中依次会`computeOomAdjLocked`和`applyOomAdjLocked`。

### 1.2 使用场景

到底哪些地方会需要updateOomAdjLocked呢，其实很多地方，下面列举常见场景：

- Activity的start/resume/finish；
- Service的start/bind/unbind；
- broadcast的分发/处理；
- contentprovider的发布/移除/获取；
- 进程的kill/attach等。

## 二、ADJ算法

ADJ算法，其核心也就是updateOomAdjLocked方法。

### 2.1  一参updateOomAdjLocked

[-> ActivityManagerService.java]

    final boolean updateOomAdjLocked(ProcessRecord app) {
        //获取栈顶的Activity
        final ActivityRecord TOP_ACT = resumedAppLocked();
        final ProcessRecord TOP_APP = TOP_ACT != null ? TOP_ACT.app : null;
        final boolean wasCached = app.cached;

        mAdjSeq++;

        //确保cachedAdj>=9
        final int cachedAdj = app.curRawAdj >= ProcessList.CACHED_APP_MIN_ADJ
                ? app.curRawAdj : ProcessList.UNKNOWN_ADJ;

        //执行三参updateOomAdjLocked【见小节2.2】
        boolean success = updateOomAdjLocked(app, cachedAdj, TOP_APP, false,
                SystemClock.uptimeMillis());

        //当app cached状态改变，或者curRawAdj=16，则执行无参数updateOomAdjLocked【见小节2.3】
        if (wasCached != app.cached || app.curRawAdj == ProcessList.UNKNOWN_ADJ) {
            updateOomAdjLocked();
        }
        return success;
    }

该方法：

1. 执行`三参updateOomAdjLocked`；
2. 当app经过更新adj操作后，其cached状态改变(包括由cached变成非cached，或者非cached变成cached)，或者curRawAdj=16，则执行``无参updateOomAdjLocked`；

### 2.2  三参updateOomAdjLocked

    private final boolean updateOomAdjLocked(ProcessRecord app, int cachedAdj,
            ProcessRecord TOP_APP, boolean doingAll, long now) {
        if (app.thread == null) {
            return false;
        }
        //【见小节2.4】
        computeOomAdjLocked(app, cachedAdj, TOP_APP, doingAll, now);

        //【见小节2.5】
        return applyOomAdjLocked(app, doingAll, now, SystemClock.elapsedRealtime());
    }

该方法是private方法，只提供给一参和无参的同名方法调用，系统中并没有其他地方调用。

### 2.3 无参updateOomAdjLocked

#### 2.3.1 涉及的部分参数

[-> ProcessList.java]

- 空进程存活时长： `MAX_EMPTY_TIME`  = 30min
- (缓存+空)进程个数上限：`MAX_CACHED_APPS` = SystemProperties.getInt("sys.fw.bg_apps_limit",32) = 32(默认)；
- 空进程个数上限：`MAX_EMPTY_APPS`  = computeEmptyProcessLimit(MAX_CACHED_APPS)  = MAX_CACHED_APPS/2 = 16；
- trim空进程个数上限：`TRIM_EMPTY_APPS` = computeTrimEmptyApps() = MAX_EMPTY_APPS/2 = 8；
- trim缓存进程个数上限：`TRIM_CACHED_APPS` = computeTrimCachedApps() = MAX_CACHED_APPS-MAX_EMPTY_APPS)/3 = 5;
- `TRIM_CRITICAL_THRESHOLD` = 3;

[-> AMS.java]

- `mBServiceAppThreshold` = SystemProperties.getInt("ro.sys.fw.bservice_limit", 5);
- `mMinBServiceAgingTime` =SystemProperties.getInt("ro.sys.fw.bservice_age", 5000);
- `mProcessLimit` = ProcessList.MAX_CACHED_APPS    
- `mProcessLimit` = emptyProcessLimit(空进程上限) + cachedProcessLimit(缓存进程上限)
- `oldTime` = now - ProcessList.MAX_EMPTY_TIME;
- `LRU进程队列长度` =  numEmptyProcs(空进程数)  + mNumCachedHiddenProcs(cached进程) + mNumNonCachedProcs（非cached进程）
- `emptyFactor` = numEmptyProcs/3, 且大于等于1
- `cachedFactor` = mNumCachedHiddenProcs/3, 且大于等于1

#### 2.3.2 代码

    final void updateOomAdjLocked() {
        //获取栈顶的Activity
        final ActivityRecord TOP_ACT = resumedAppLocked();
        final ProcessRecord TOP_APP = TOP_ACT != null ? TOP_ACT.app : null;
        final long now = SystemClock.uptimeMillis();
        final long nowElapsed = SystemClock.elapsedRealtime();
        final long oldTime = now - ProcessList.MAX_EMPTY_TIME;
        final int N = mLruProcesses.size();

        //重置所有uid记录，把curProcState设置成16(空进程)
        for (int i=mActiveUids.size()-1; i>=0; i--) {
            final UidRecord uidRec = mActiveUids.valueAt(i);
            uidRec.reset();
        }

        mAdjSeq++;
        mNewNumServiceProcs = 0;
        mNewNumAServiceProcs = 0;

        final int emptyProcessLimit;
        final int cachedProcessLimit;
        // mProcessLimit默认值等于32，通过开发者选择可设置，或者厂商会自行调整
        if (mProcessLimit <= 0) {
            emptyProcessLimit = cachedProcessLimit = 0;
        } else if (mProcessLimit == 1) {
            emptyProcessLimit = 1;
            cachedProcessLimit = 0;
        } else {
            //则emptyProcessLimit = 16， cachedProcessLimit = 16
            emptyProcessLimit = ProcessList.computeEmptyProcessLimit(mProcessLimit);
            cachedProcessLimit = mProcessLimit - emptyProcessLimit;
        }

        //经过计算得 numSlots =3
        int numSlots = (ProcessList.CACHED_APP_MAX_ADJ
                - ProcessList.CACHED_APP_MIN_ADJ + 1) / 2;
        int numEmptyProcs = N - mNumNonCachedProcs - mNumCachedHiddenProcs;

        //确保空进程个数不大于cached进程数
        if (numEmptyProcs > cachedProcessLimit) {
            numEmptyProcs = cachedProcessLimit;
        }
        int emptyFactor = numEmptyProcs/numSlots;
        if (emptyFactor < 1) emptyFactor = 1;
        int cachedFactor = (mNumCachedHiddenProcs > 0 ? mNumCachedHiddenProcs : 1)/numSlots;
        if (cachedFactor < 1) cachedFactor = 1;
        int stepCached = 0;
        int stepEmpty = 0;
        int numCached = 0;
        int numEmpty = 0;
        int numTrimming = 0;

        mNumNonCachedProcs = 0;
        mNumCachedHiddenProcs = 0;

        //更新所有进程状态(基于当前状态)
        int curCachedAdj = ProcessList.CACHED_APP_MIN_ADJ;
        int nextCachedAdj = curCachedAdj+1;
        int curEmptyAdj = ProcessList.CACHED_APP_MIN_ADJ;
        int nextEmptyAdj = curEmptyAdj+2;
        ProcessRecord selectedAppRecord = null;
        long serviceLastActivity = 0;
        int numBServices = 0;
        for (int i=N-1; i>=0; i--) {
            ProcessRecord app = mLruProcesses.get(i);
            if (mEnableBServicePropagation && app.serviceb
                    && (app.curAdj == ProcessList.SERVICE_B_ADJ)) {
                numBServices++;
                for (int s = app.services.size() - 1; s >= 0; s--) {
                    ServiceRecord sr = app.services.valueAt(s);
                    //上次活跃时间距离现在小于5s，则不会迁移到BService
                    if (SystemClock.uptimeMillis() - sr.lastActivity
                            < mMinBServiceAgingTime) {
                        continue;
                    }
                    if (serviceLastActivity == 0) {
                        serviceLastActivity = sr.lastActivity;
                        selectedAppRecord = app;
                    //记录service上次活动时间最长的那个app
                    } else if (sr.lastActivity < serviceLastActivity) {
                        serviceLastActivity = sr.lastActivity;
                        selectedAppRecord = app;
                    }
                }
            }

            if (!app.killedByAm && app.thread != null) {
                app.procStateChanged = false;
                //计算app的adj值【见小节2.4】
                computeOomAdjLocked(app, ProcessList.UNKNOWN_ADJ, TOP_APP, true, now);

                //当进程未分配adj的情况下，更新adj(cached和empty算法是相同的)
                if (app.curAdj >= ProcessList.UNKNOWN_ADJ) {
                    switch (app.curProcState) {
                        case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY:
                        case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT:
                            //当进程procState=14或15，则设置adj=9;
                            app.curRawAdj = curCachedAdj;
                            app.curAdj = app.modifyRawOomAdj(curCachedAdj);
                            //当前cacheadj不等于下一次cachedadj时
                            if (curCachedAdj != nextCachedAdj) {
                                stepCached++;
                                //当stepCached大于cachedFactor，则将nextCachedAdj赋值给curCachedAdj，并且nextCachedAdj加2，nextCachedAdj最大等于15；
                                if (stepCached >= cachedFactor) {
                                    stepCached = 0;
                                    curCachedAdj = nextCachedAdj;
                                    nextCachedAdj += 2;
                                    if (nextCachedAdj > ProcessList.CACHED_APP_MAX_ADJ) {
                                        nextCachedAdj = ProcessList.CACHED_APP_MAX_ADJ;
                                    }
                                }
                            }
                            break;
                        default:
                            app.curRawAdj = curEmptyAdj;
                            app.curAdj = app.modifyRawOomAdj(curEmptyAdj);
                            //更新curCachedAdj值
                            if (curEmptyAdj != nextEmptyAdj) {
                                stepEmpty++;
                                //当stepEmpty大于emptyFactor，则将nextEmptyAdj赋值给curEmptyAdj，并且nextEmptyAdj加2，nextEmptyAdj最大等于15；
                                if (stepEmpty >= emptyFactor) {
                                    stepEmpty = 0;
                                    curEmptyAdj = nextEmptyAdj;
                                    nextEmptyAdj += 2;
                                    if (nextEmptyAdj > ProcessList.CACHED_APP_MAX_ADJ) {
                                        nextEmptyAdj = ProcessList.CACHED_APP_MAX_ADJ;
                                    }
                                }
                            }
                            break;
                    }
                }

                //【见小节2.5】
                applyOomAdjLocked(app, true, now, nowElapsed);

                //根据当前进程procState状态来决策
                switch (app.curProcState) {
                    case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY:
                    case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT:
                        mNumCachedHiddenProcs++;
                        numCached++;
                        // 当cached进程超过上限(cachedProcessLimit)，则杀掉该进程
                        if (numCached > cachedProcessLimit) {
                            app.kill("cached #" + numCached, true);
                        }
                        break;
                    case ActivityManager.PROCESS_STATE_CACHED_EMPTY:
                        // 当空进程超过上限(TRIM_EMPTY_APPS)，且空闲时间超过30分钟，则杀掉该进程
                        if (numEmpty > ProcessList.TRIM_EMPTY_APPS
                                && app.lastActivityTime < oldTime) {
                            app.kill("empty for "
                                    + ((oldTime + ProcessList.MAX_EMPTY_TIME - app.lastActivityTime)
                                    / 1000) + "s", true);
                        } else {
                            // 当空进程超过上限(emptyProcessLimit)，则杀掉该进程
                            numEmpty++;
                            if (numEmpty > emptyProcessLimit) {
                                if (!CT_PROTECTED_PROCESS.equals(app.processName))
                                    app.kill("empty #" + numEmpty, true);
                            }
                        }
                        break;
                    default:
                        mNumNonCachedProcs++;
                        break;
                }

                if (app.isolated && app.services.size() <= 0) {
                    //没有services运行的孤立进程，则直接杀掉
                    app.kill("isolated not needed", true);
                } else {
                    final UidRecord uidRec = app.uidRecord;
                    if (uidRec != null && uidRec.curProcState > app.curProcState) {
                        uidRec.curProcState = app.curProcState;
                    }
                }

                if (app.curProcState >= ActivityManager.PROCESS_STATE_HOME
                        && !app.killedByAm) {
                    numTrimming++;
                }
            }
        }

        //当BServices个数超过上限(mBServiceAppThreshold)，则
        if ((numBServices > mBServiceAppThreshold) && (true == mAllowLowerMemLevel)
                && (selectedAppRecord != null)) {
            ProcessList.setOomAdj(selectedAppRecord.pid, selectedAppRecord.info.uid,
                    ProcessList.CACHED_APP_MAX_ADJ);
            selectedAppRecord.setAdj = selectedAppRecord.curAdj;
        }
        mNumServiceProcs = mNewNumServiceProcs;

        //根据CachedAndEmpty个数来调整内存因子memFactor
        final int numCachedAndEmpty = numCached + numEmpty;
        int memFactor;
        if (numCached <= ProcessList.TRIM_CACHED_APPS
                && numEmpty <= ProcessList.TRIM_EMPTY_APPS) {
            if (numCachedAndEmpty <= ProcessList.TRIM_CRITICAL_THRESHOLD) {
                memFactor = ProcessStats.ADJ_MEM_FACTOR_CRITICAL;
            } else if (numCachedAndEmpty <= ProcessList.TRIM_LOW_THRESHOLD) {
                memFactor = ProcessStats.ADJ_MEM_FACTOR_LOW;
            } else {
                memFactor = ProcessStats.ADJ_MEM_FACTOR_MODERATE;
            }
        } else {
            memFactor = ProcessStats.ADJ_MEM_FACTOR_NORMAL;
        }

        if (memFactor > mLastMemoryLevel) {
            if (!mAllowLowerMemLevel || mLruProcesses.size() >= mLastNumProcesses) {
                memFactor = mLastMemoryLevel;
            }
        }
        mLastMemoryLevel = memFactor;
        mLastNumProcesses = mLruProcesses.size();
        boolean allChanged = mProcessStats.setMemFactorLocked(memFactor, !isSleeping(), now);
        final int trackerMemFactor = mProcessStats.getMemFactorLocked();
        //当内存因子不是普通0级别的情况下
        if (memFactor != ProcessStats.ADJ_MEM_FACTOR_NORMAL) {
            if (mLowRamStartTime == 0) {
                mLowRamStartTime = now;
            }
            int step = 0;
            int fgTrimLevel;
            switch (memFactor) {
                case ProcessStats.ADJ_MEM_FACTOR_CRITICAL:
                    fgTrimLevel = ComponentCallbacks2.TRIM_MEMORY_RUNNING_CRITICAL;
                    break;
                case ProcessStats.ADJ_MEM_FACTOR_LOW:
                    fgTrimLevel = ComponentCallbacks2.TRIM_MEMORY_RUNNING_LOW;
                    break;
                default:
                    fgTrimLevel = ComponentCallbacks2.TRIM_MEMORY_RUNNING_MODERATE;
                    break;
            }
            int factor = numTrimming/3;
            int minFactor = 2;
            if (mHomeProcess != null) minFactor++;
            if (mPreviousProcess != null) minFactor++;
            if (factor < minFactor) factor = minFactor;

            //TRIM_MEMORY_COMPLETE：该进程处于LRU队列的尾部，当进程不足则会杀掉该进程
            int curLevel = ComponentCallbacks2.TRIM_MEMORY_COMPLETE;
            for (int i=N-1; i>=0; i--) {
                ProcessRecord app = mLruProcesses.get(i);
                if (allChanged || app.procStateChanged) {
                    setProcessTrackerStateLocked(app, trackerMemFactor, now);
                    app.procStateChanged = false;
                }
                //当curProcState > 12且没有被am杀掉的情况；
                if (app.curProcState >= ActivityManager.PROCESS_STATE_HOME
                        && !app.killedByAm) {
                    if (app.trimMemoryLevel < curLevel && app.thread != null) {
                        //调度app执行trim memory的操作
                        app.thread.scheduleTrimMemory(curLevel);
                    }
                    app.trimMemoryLevel = curLevel;
                    step++;
                    if (step >= factor) {
                        step = 0;
                        switch (curLevel) {
                            case ComponentCallbacks2.TRIM_MEMORY_COMPLETE:
                                curLevel = ComponentCallbacks2.TRIM_MEMORY_MODERATE;
                                break;
                            case ComponentCallbacks2.TRIM_MEMORY_MODERATE:
                                curLevel = ComponentCallbacks2.TRIM_MEMORY_BACKGROUND;
                                break;
                        }
                    }
                } else if (app.curProcState == ActivityManager.PROCESS_STATE_HEAVY_WEIGHT) {
                    if (app.trimMemoryLevel < ComponentCallbacks2.TRIM_MEMORY_BACKGROUND
                            && app.thread != null) {
                        app.thread.scheduleTrimMemory(
                                ComponentCallbacks2.TRIM_MEMORY_BACKGROUND);
                    }
                    app.trimMemoryLevel = ComponentCallbacks2.TRIM_MEMORY_BACKGROUND;
                } else {
                    if ((app.curProcState >= ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND
                            || app.systemNoUi) && app.pendingUiClean) {
                        final int level = ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN;
                        if (app.trimMemoryLevel < level && app.thread != null) {
                            app.thread.scheduleTrimMemory(level);
                        }
                        app.pendingUiClean = false;
                    }
                    if (app.trimMemoryLevel < fgTrimLevel && app.thread != null) {
                        app.thread.scheduleTrimMemory(fgTrimLevel);
                    }
                    app.trimMemoryLevel = fgTrimLevel;
                }
            }
        } else {
            if (mLowRamStartTime != 0) {
                mLowRamTimeSinceLastIdle += now - mLowRamStartTime;
                mLowRamStartTime = 0;
            }
            for (int i=N-1; i>=0; i--) {
                ProcessRecord app = mLruProcesses.get(i);
                if (allChanged || app.procStateChanged) {
                    setProcessTrackerStateLocked(app, trackerMemFactor, now);
                    app.procStateChanged = false;
                }
                if ((app.curProcState >= ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND
                        || app.systemNoUi) && app.pendingUiClean) {
                    if (app.trimMemoryLevel < ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN
                            && app.thread != null) {
                        app.thread.scheduleTrimMemory(
                                ComponentCallbacks2.TRIM_MEMORY_UI_HIDDEN);
                    }
                    app.pendingUiClean = false;
                }
                app.trimMemoryLevel = 0;
            }
        }

        //是否finish activity
        if (mAlwaysFinishActivities) {
            mStackSupervisor.scheduleDestroyAllActivities(null, "always-finish");
        }

        if (allChanged) {
            requestPssAllProcsLocked(now, false, mProcessStats.isMemFactorLowered());
        }
        ...
    }




#### 2.3.3 updateOomAdjLocked小节

updateOomAdjLocked过程比较复杂，主要分为更新adj(满足条件则杀进程)和根据memFactor来调度执行TrimMemory操作；

第一部分：更新adj(满足条件则杀进程)

- 遍历mLruProcesses进程
    - 当进程未分配adj的情况
        - 当进程procState=14或15，则设置`adj=curCachedAdj(初始化=9)`;
            - 当curCachedAdj != nextCachedAdj，且stepCached大于cachedFactor时
                则`curCachedAdj = nextCachedAdj`，（nextCachedAdj加2，nextCachedAdj上限为15）；
        - 否则，则设置`adj=curEmptyAdj(初始化=9)`;
            - 当curEmptyAdj != nextEmptyAdj，且stepEmpty大于EmptyFactor时
                则`curEmptyAdj = nextEmptyAdj`，（nextEmptyAdj加2，nextEmptyAdj上限为15）；

    - 根据当前进程procState状态来决策：
        - 当curProcState=14或15，且cached进程超过上限(cachedProcessLimit=32)，则杀掉该进程
        - 当curProcState=16的前提下：
            - 当空进程超过上限(TRIM_EMPTY_APPS=8)，且空闲时间超过30分钟，则杀掉该进程
            - 否则，当空进程超过上限(emptyProcessLimit=16)，则杀掉该进程

    - 没有services运行的孤立进程，则杀掉该进程；

第二部分：根据memFactor来调度执行TrimMemory操作；

- 根据CachedAndEmpty个数来调整内存因子memFactor(值越大，级别越高)：
    - 当CachedAndEmpty < 3，则memFactor=3；
    - 当CachedAndEmpty < 5，则memFactor=2；
    - 当CachedAndEmpty >=5，且numCached<=5,numEmpty<=8，则memFactor=1；
    - 当numCached>5 或numEmpty>8，则memFactor=0；

- 当内存因子不是普通0级别的情况下，根据memFactor来调整前台trim级别(fgTrimLevel):
    - 当memFactor=3，则fgTrimLevel=TRIM_MEMORY_RUNNING_CRITICAL；
    - 当memFactor=2，则fgTrimLevel=TRIM_MEMORY_RUNNING_LOW；
    - 否则(其实就是memFactor=1)，则fgTrimLevel=TRIM_MEMORY_RUNNING_MODERATE

    - 再遍历mLruProcesses队列进程：
        - 当curProcState > 12且没有被am杀掉，则执行TrimMemory操作；
        - 否则，当curProcState = 9 且trimMemoryLevel<TRIM_MEMORY_BACKGROUND，则执行TrimMemory操作；
        - 否则，当curProcState > 7， 且pendingUiClean =true时
            - 当trimMemoryLevel<TRIM_MEMORY_UI_HIDDEN，则执行TrimMemory操作；
            - 当trimMemoryLevel<fgTrimLevel，则执行TrimMemory操作；
- 当内存因子等于0的情况下,遍历mLruProcesses队列进程：
    - 当curProcState >=7, 且pendingUiClean =true时,
        - 当trimMemoryLevel< TRIM_MEMORY_UI_HIDDEN，则执行TrimMemory操作；


### 2.4 computeOomAdjLocked

    private final int computeOomAdjLocked(ProcessRecord app, int cachedAdj, ProcessRecord TOP_APP,
             boolean doingAll, long now)；

该方法比较长，下面分几个部分来展开说明： (adj和procState的取值原则是以优先级高为主)


#### 2.4.1 进程为空的情况

     if (mAdjSeq == app.adjSeq) {
          //已经调整完成
         return app.curRawAdj;
     }

     // 当进程对象为空时，则设置curProcState=16， curAdj=curRawAdj=15
     if (app.thread == null) {
         app.adjSeq = mAdjSeq;
         app.curSchedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
         app.curProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
         return (app.curAdj=app.curRawAdj=ProcessList.CACHED_APP_MAX_ADJ);
     }
     //app中包含的activity个数
     final int activitiesSize = app.activities.size();

#### 2.4.2 当maxAdj<=0情况

当maxAdj <=0的情况，也就意味这不允许app将其adj调整到低于前台app的优先级别。

     if (app.maxAdj <= ProcessList.FOREGROUND_APP_ADJ) {
         app.adjType = "fixed";
         app.adjSeq = mAdjSeq;
         app.curRawAdj = app.maxAdj;
         app.foregroundActivities = false;
         app.curSchedGroup = Process.THREAD_GROUP_DEFAULT;
         app.curProcState = ActivityManager.PROCESS_STATE_PERSISTENT;

         app.systemNoUi = true;
         //顶部的activity就是当前app，则代表正处于展现UI
         if (app == TOP_APP) {
             app.systemNoUi = false;
         } else if (activitiesSize > 0) {
             for (int j = 0; j < activitiesSize; j++) {
                 final ActivityRecord r = app.activities.get(j);
                 if (r.visible) {
                     app.systemNoUi = false;
                 }
             }
         }
         if (!app.systemNoUi) {
             app.curProcState = ActivityManager.PROCESS_STATE_PERSISTENT_UI;
         }
         return (app.curAdj=app.maxAdj);
     }

该过程执行后将直接返回

 - curProcState = ActivityManager.PROCESS_STATE_PERSISTENT_UI;
 - curAdj = app.maxAdj

#### 2.4.3 计算adj和procState

     if (app == TOP_APP) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = Process.THREAD_GROUP_DEFAULT;
         app.adjType = "top-activity";
         foregroundActivities = true;
         procState = PROCESS_STATE_TOP;
         if(app == mHomeProcess) {
             mHomeKilled = false;
             mHomeProcessName = mHomeProcess.processName;
         }
     } else if (app.instrumentationClass != null) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = Process.THREAD_GROUP_DEFAULT;
         app.adjType = "instrumentation";
         procState = ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE;
     } else if ((queue = isReceivingBroadcast(app)) != null) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = (queue == mFgBroadcastQueue)
                 ? Process.THREAD_GROUP_DEFAULT : Process.THREAD_GROUP_BG_NONINTERACTIVE;
         app.adjType = "broadcast";
         procState = ActivityManager.PROCESS_STATE_RECEIVER;
     } else if (app.executingServices.size() > 0) {
         adj = ProcessList.FOREGROUND_APP_ADJ;
         schedGroup = app.execServicesFg ?
                 Process.THREAD_GROUP_DEFAULT : Process.THREAD_GROUP_BG_NONINTERACTIVE;
         app.adjType = "exec-service";
         procState = ActivityManager.PROCESS_STATE_SERVICE;
     } else {
         //top app; isReceivingBroadcast；executingServices；除此之外则为PROCESS_STATE_CACHED_EMPTY【】
         schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
         adj = cachedAdj;
         procState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
         app.cached = true;
         app.empty = true;
         app.adjType = "cch-empty";

         if (mHomeKilled && app.processName.equals(mHomeProcessName)) {
             adj = ProcessList.PERSISTENT_PROC_ADJ;
             schedGroup = Process.THREAD_GROUP_DEFAULT;
             app.cached = false;
             app.empty = false;
             app.adjType = "top-activity";
         }
     }

 |Case|adj|procState|
 |---|---|---|
 |当app是当前展示的app|adj=0|procState=2|
 |当instrumentation不为空时|adj=0|procState=4|
 |当进程存在正在接收的broadcastrecevier|adj=0|procState=11|
 |当进程存在正在执行的service|adj=0|procState=10|
 |以上条件都不符合|adj=cachedAdj|procState=16|

 其中cachedAdj大于等于9，该值来源于computeOomAdjLocked输入参数

#### 2.4.4 非前台activity的情况

     if (!foregroundActivities && activitiesSize > 0) {
         for (int j = 0; j < activitiesSize; j++) {
             final ActivityRecord r = app.activities.get(j);
             if (r.app != app) {
                 continue;
             }
             当activity可见， 则adj=1,procState=2
             if (r.visible) {
                 if (adj > ProcessList.VISIBLE_APP_ADJ) {
                     adj = ProcessList.VISIBLE_APP_ADJ;
                     app.adjType = "visible";
                 }
                 if (procState > PROCESS_STATE_TOP) {
                     procState = PROCESS_STATE_TOP;
                 }
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
                 app.cached = false;
                 app.empty = false;
                 foregroundActivities = true;
                 break;
             当activity正在暂停或者已经暂停， 则adj=2,procState=2
             } else if (r.state == ActivityState.PAUSING || r.state == ActivityState.PAUSED) {
                 if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                     adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                     app.adjType = "pausing";
                 }
                 if (procState > PROCESS_STATE_TOP) {
                     procState = PROCESS_STATE_TOP;
                 }
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
                 app.cached = false;
                 app.empty = false;
                 foregroundActivities = true;
             当activity正在停止， 则adj=2,procState=13(activity尚未finish)
             } else if (r.state == ActivityState.STOPPING) {
                 if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                     adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                     app.adjType = "stopping";
                 }

                 if (!r.finishing) {
                     if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
                         procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
                     }
                 }
                 app.cached = false;
                 app.empty = false;
                 foregroundActivities = true;
             否则procState=14
             } else {
                 if (procState > ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                     procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY;
                     app.adjType = "cch-act";
                 }
             }
         }
     }

对于进程中的activity处于非前台情况

- 当activity可见， 则adj=1,procState=2；
- 当activity正在暂停或者已经暂停， 则adj=2,procState=2；
- 当activity正在停止， 则adj=2,procState=13(且activity尚未finish)；
- 以上都不满足，否则procState=14

#### 2.4.5 adj > 2的情况

     if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
         当存在前台service时，则adj=2, procState=4；
         if (app.foregroundServices) {
             adj = ProcessList.PERCEPTIBLE_APP_ADJ;
             procState = ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE;
             app.cached = false;
             app.adjType = "fg-service";
             schedGroup = Process.THREAD_GROUP_DEFAULT;
         当强制前台时，则adj=2, procState=6；
         } else if (app.forcingToForeground != null) {
             adj = ProcessList.PERCEPTIBLE_APP_ADJ;
             procState = ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
             app.cached = false;
             app.adjType = "force-fg";
             app.adjSource = app.forcingToForeground;
             schedGroup = Process.THREAD_GROUP_DEFAULT;
         }
     }

当adj > 2的情况的前提下：

- 当存在前台service时，则adj=2, procState=4；
- 当强制前台时，则adj=2, procState=6；

#### 2.4.6 HeavyWeightProces情况

     if (app == mHeavyWeightProcess) {
         if (adj > ProcessList.HEAVY_WEIGHT_APP_ADJ) {
             adj = ProcessList.HEAVY_WEIGHT_APP_ADJ;
             schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
             app.cached = false;
             app.adjType = "heavy";
         }
         if (procState > ActivityManager.PROCESS_STATE_HEAVY_WEIGHT) {
             procState = ActivityManager.PROCESS_STATE_HEAVY_WEIGHT;
         }
     }

当进程为HeavyWeightProcess，则adj=4, procState=9；

#### 2.4.7 HomeProcess情况

     if (app == mHomeProcess) {
         if (adj > ProcessList.HOME_APP_ADJ) {
             adj = ProcessList.HOME_APP_ADJ;
             schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
             app.cached = false;
             app.adjType = "home";
         }
         if (procState > ActivityManager.PROCESS_STATE_HOME) {
             procState = ActivityManager.PROCESS_STATE_HOME;
         }
     }

当进程为HomeProcess情况，则adj=6, procState=12；

#### 2.4.8 PreviousProcess情况

     if (app == mPreviousProcess && app.activities.size() > 0) {
         if (adj > ProcessList.PREVIOUS_APP_ADJ) {
             adj = ProcessList.PREVIOUS_APP_ADJ;
             schedGroup = Process.THREAD_GROUP_BG_NONINTERACTIVE;
             app.cached = false;
             app.adjType = "previous";
         }
         if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
             procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
         }
     }

当进程为PreviousProcess情况，则adj=7, procState=13；

#### 2.4.9 备份进程情况

     if (mBackupTarget != null && app == mBackupTarget.app) {
         if (adj > ProcessList.BACKUP_APP_ADJ) {
             adj = ProcessList.BACKUP_APP_ADJ;
             if (procState > ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND) {
                 procState = ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND;
             }
             app.adjType = "backup";
             app.cached = false;
         }
         if (procState > ActivityManager.PROCESS_STATE_BACKUP) {
             procState = ActivityManager.PROCESS_STATE_BACKUP;
         }
     }

对于备份进程的情况，则adj=3, procState=7或8

#### 2.4.10 Service情况

     //是否显示在最顶部
     boolean mayBeTop = false;
     for (int is = app.services.size()-1;
             is >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                     || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                     || procState > ActivityManager.PROCESS_STATE_TOP);
             is--) {
         //当adj>0 或 schedGroup为后台线程组 或procState>2时执行
         ServiceRecord s = app.services.valueAt(is);
         if (s.startRequested) {
             app.hasStartedServices = true;
             //当service已启动，则procState<=10；
             if (procState > ActivityManager.PROCESS_STATE_SERVICE) {
                 procState = ActivityManager.PROCESS_STATE_SERVICE;
             }
             if (app.hasShownUi && app != mHomeProcess) {
                 if (adj > ProcessList.SERVICE_ADJ) {
                     app.adjType = "cch-started-ui-services";
                 }
             } else {
                 if (now < (s.lastActivity + ActiveServices.MAX_SERVICE_INACTIVITY)) {
                     //当service在30分钟内活动过，则adj=5；
                     if (adj > ProcessList.SERVICE_ADJ) {
                         adj = ProcessList.SERVICE_ADJ;
                         app.adjType = "started-services";
                         app.cached = false;
                     }
                 }
                 if (adj > ProcessList.SERVICE_ADJ) {
                     app.adjType = "cch-started-services";
                 }
             }
         }

         for (int conni = s.connections.size()-1;
                 conni >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                         || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                         || procState > ActivityManager.PROCESS_STATE_TOP);
                 conni--) {
             // 获取service所绑定的connections
             ArrayList<ConnectionRecord> clist = s.connections.valueAt(conni);
             for (int i = 0;
                     i < clist.size() && (adj > ProcessList.FOREGROUND_APP_ADJ
                             || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                             || procState > ActivityManager.PROCESS_STATE_TOP);
                     i++) {
                 ConnectionRecord cr = clist.get(i);
                 //当client与当前app同一个进程，则continue;
                 if (cr.binding.client == app) {
                     continue;
                 }
                 if ((cr.flags&Context.BIND_WAIVE_PRIORITY) == 0) {
                     ProcessRecord client = cr.binding.client;
                     //计算connections所对应的client进程的adj
                     int clientAdj = computeOomAdjLocked(client, cachedAdj,
                             TOP_APP, doingAll, now);
                     int clientProcState = client.curProcState;

                     //当client进程的ProcState >=cache，则设置为空进程
                     if (clientProcState >= ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                         clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
                     }
                     String adjType = null;
                     if ((cr.flags&Context.BIND_ALLOW_OOM_MANAGEMENT) != 0) {
                         //当进程存在显示的ui，则将当前进程的adj和ProcState值赋予给client进程
                         if (app.hasShownUi && app != mHomeProcess) {
                             if (adj > clientAdj) {
                                 adjType = "cch-bound-ui-services";
                             }
                             app.cached = false;
                             clientAdj = adj;
                             clientProcState = procState;
                         } else {
                             //当不存在显示的ui，且service上次活动时间距离现在超过30分钟，则只将当前进程的adj值赋予给client进程
                             if (now >= (s.lastActivity
                                     + ActiveServices.MAX_SERVICE_INACTIVITY)) {
                                 if (adj > clientAdj) {
                                     adjType = "cch-bound-services";
                                 }
                                 clientAdj = adj;
                             }
                         }
                     }
                     //当前进程adj > client进程adj的情况
                     if (adj > clientAdj) {
                         if (app.hasShownUi && app != mHomeProcess
                                 && clientAdj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                             adjType = "cch-bound-ui-services";
                         } else {
                             //当service进程比较重要时，设置adj >= -11
                             if ((cr.flags&(Context.BIND_ABOVE_CLIENT
                                     |Context.BIND_IMPORTANT)) != 0) {
                                 adj = clientAdj >= ProcessList.PERSISTENT_SERVICE_ADJ
                                         ? clientAdj : ProcessList.PERSISTENT_SERVICE_ADJ;
                             //当client进程adj<2,且当前进程adj>2时，设置adj=2;
                             } else if ((cr.flags&Context.BIND_NOT_VISIBLE) != 0
                                     && clientAdj < ProcessList.PERCEPTIBLE_APP_ADJ
                                     && adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                                 adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                             //当client进程adj>1时，则设置adj = clientAdj
                             } else if (clientAdj > ProcessList.VISIBLE_APP_ADJ) {
                                 adj = clientAdj;
                             } else {
                                 //否则，设置adj <= 1
                                 if (adj > ProcessList.VISIBLE_APP_ADJ) {
                                     adj = ProcessList.VISIBLE_APP_ADJ;
                                 }
                             }
                             //当client进程不是cache进程，则当前进程也设置为非cache进程
                             if (!client.cached) {
                                 app.cached = false;
                             }
                             adjType = "service";
                         }
                     }

                     //当绑定的是前台进程的情况
                     if ((cr.flags&Context.BIND_NOT_FOREGROUND) == 0) {
                         if (client.curSchedGroup == Process.THREAD_GROUP_DEFAULT) {
                             schedGroup = Process.THREAD_GROUP_DEFAULT;
                         }
                         if (clientProcState <= ActivityManager.PROCESS_STATE_TOP) {
                             //当client进程状态为前台时，则设置mayBeTop=true，并设置client进程procState=16
                             if (clientProcState == ActivityManager.PROCESS_STATE_TOP) {
                                 mayBeTop = true;
                                 clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
                             //当client进程状态 < 2的前提下：若绑定前台service，则clientProcState=3；否则clientProcState=6
                             } else {
                                 if ((cr.flags&Context.BIND_FOREGROUND_SERVICE) != 0) {
                                     clientProcState =
                                             ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                                 } else if (mWakefulness
                                                 == PowerManagerInternal.WAKEFULNESS_AWAKE &&
                                         (cr.flags&Context.BIND_FOREGROUND_SERVICE_WHILE_AWAKE)
                                                 != 0) {
                                     clientProcState =
                                             ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                                 } else {
                                     clientProcState =
                                             ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
                                 }
                             }
                         }
                     //当connections并没有绑定前台service时，则clientProcState >= 7
                     } else {
                         if (clientProcState <
                                 ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND) {
                             clientProcState =
                                     ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND;
                         }
                     }
                     //保证当前进程procState不会必client进程的procState大
                     if (procState > clientProcState) {
                         procState = clientProcState;
                     }
                     if (procState < ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND
                             && (cr.flags&Context.BIND_SHOWING_UI) != 0) {
                         app.pendingUiClean = true;
                     }
                     if (adjType != null) {
                         app.adjType = adjType;
                         app.adjTypeCode = ActivityManager.RunningAppProcessInfo
                                 .REASON_SERVICE_IN_USE;
                         app.adjSource = cr.binding.client;
                         app.adjSourceProcState = clientProcState;
                         app.adjTarget = s.name;
                     }
                 }
                 if ((cr.flags&Context.BIND_TREAT_LIKE_ACTIVITY) != 0) {
                     app.treatLikeActivity = true;
                 }
                 final ActivityRecord a = cr.activity;
                 if ((cr.flags&Context.BIND_ADJUST_WITH_ACTIVITY) != 0) {
                     //当进程adj >0，且activity可见 或者resumed 或 正在暂停，则设置adj = 0
                     if (a != null && adj > ProcessList.FOREGROUND_APP_ADJ &&
                             (a.visible || a.state == ActivityState.RESUMED
                              || a.state == ActivityState.PAUSING)) {
                         adj = ProcessList.FOREGROUND_APP_ADJ;
                         if ((cr.flags&Context.BIND_NOT_FOREGROUND) == 0) {
                             schedGroup = Process.THREAD_GROUP_DEFAULT;
                         }
                         app.cached = false;
                         app.adjType = "service";
                         app.adjTypeCode = ActivityManager.RunningAppProcessInfo
                                 .REASON_SERVICE_IN_USE;
                         app.adjSource = a;
                         app.adjSourceProcState = procState;
                         app.adjTarget = s.name;
                     }
                 }
             }
         }
     }

 当adj>0 或 schedGroup为后台线程组 或procState>2时，双重循环遍历：

 - 当service已启动，则procState<=10；
     - 当service在30分钟内活动过，则adj=5,cached=false;
 - 获取service所绑定的connections
     - 当client与当前app同一个进程，则continue;
     - 当client进程的ProcState >=cache，则设置为空进程
     - 当进程存在显示的ui，则将当前进程的adj和ProcState值赋予给client进程
     - 当不存在显示的ui，且service上次活动时间距离现在超过30分钟，则只将当前进程的adj值赋予给client进程
     - 当前进程adj > client进程adj的情况
         - 当service进程比较重要时，则设置adj >= -11
         - 当client进程adj<2,且当前进程adj>2时，则设置adj=2;
         - 当client进程adj>1时，则设置adj = clientAdj
         - 否则，设置adj <= 1；
         - 若client进程不是cache进程，则当前进程也设置为非cache进程
     - 当绑定的是前台进程的情况
         - 当client进程状态为前台时，则设置mayBeTop=true，并设置client进程procState=16
         - 当client进程状态 < 2的前提下：若绑定前台service，则clientProcState=3；否则clientProcState=6
     - 当connections并没有绑定前台service时，则clientProcState >= 7
     - 保证当前进程procState不会必client进程的procState大
 - 当进程adj >0，且activity可见 或者resumed 或 正在暂停，则设置adj = 0

#### 2.4.11 ContentProvider情况

     //当adj>0 或 schedGroup为后台线程组 或procState>2时
     for (int provi = app.pubProviders.size()-1;
             provi >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                     || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                     || procState > ActivityManager.PROCESS_STATE_TOP);
             provi--) {
         ContentProviderRecord cpr = app.pubProviders.valueAt(provi);
         for (int i = cpr.connections.size()-1;
                 i >= 0 && (adj > ProcessList.FOREGROUND_APP_ADJ
                         || schedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE
                         || procState > ActivityManager.PROCESS_STATE_TOP);
                 i--) {
             ContentProviderConnection conn = cpr.connections.get(i);
             ProcessRecord client = conn.client;
             // 当client与当前app同一个进程，则continue;
             if (client == app) {
                 continue;
             }
             // 计算client进程的adj
             int clientAdj = computeOomAdjLocked(client, cachedAdj, TOP_APP, doingAll, now);
             int clientProcState = client.curProcState;
             //当client进程procState >=14，则设置成procState =16
             if (clientProcState >= ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                 clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY; 【】
             }
             if (adj > clientAdj) {
                 if (app.hasShownUi && app != mHomeProcess
                         && clientAdj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                     app.adjType = "cch-ui-provider";
                 } else {
                     //没有ui展示，则保证adj >=0
                     adj = clientAdj > ProcessList.FOREGROUND_APP_ADJ
                             ? clientAdj : ProcessList.FOREGROUND_APP_ADJ;
                     app.adjType = "provider";
                 }
                 app.cached &= client.cached;
                 app.adjTypeCode = ActivityManager.RunningAppProcessInfo
                         .REASON_PROVIDER_IN_USE;
                 app.adjSource = client;
                 app.adjSourceProcState = clientProcState;
                 app.adjTarget = cpr.name;
             }
             if (clientProcState <= ActivityManager.PROCESS_STATE_TOP) {
                 if (clientProcState == ActivityManager.PROCESS_STATE_TOP) {
                     mayBeTop = true;
                     //当client进程状态为前台时，则设置mayBeTop=true，并设置client进程procState=16设置为空进程
                     clientProcState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
                 } else {
                     //当client进程状态 < 2时，则clientProcState=3；
                     clientProcState = ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                 }
             }
             //procState 比client进程值更大时，则取client端的状态值。
             if (procState > clientProcState) {
                 procState = clientProcState;
             }
             if (client.curSchedGroup == Process.THREAD_GROUP_DEFAULT) {
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
             }
         }
         //当contentprovider存在外部进程依赖(非framework)时
         if (cpr.hasExternalProcessHandles()) {
             //设置adj =0, procState=6
             if (adj > ProcessList.FOREGROUND_APP_ADJ) {
                 adj = ProcessList.FOREGROUND_APP_ADJ;
                 schedGroup = Process.THREAD_GROUP_DEFAULT;
                 app.cached = false;
                 app.adjType = "provider";
                 app.adjTarget = cpr.name;
             }
             if (procState > ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND) {
                 procState = ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
             }
         }
     }


 当adj>0 或 schedGroup为后台线程组 或procState>2时，双重循环遍历：

 - 当client与当前app同一个进程，则continue;
 - 当client进程procState >=14，则设置成procState =16
 - 没有ui展示，则保证adj >=0
 - 当client进程状态为前台时，则设置mayBeTop=true，并设置client进程procState=16设置为空进程
 - 当client进程状态 < 2时，则clientProcState=3；
 - procState 比client进程值更大时，则取client端的状态值。
 - 当contentprovider存在外部进程依赖(非framework)时，则设置adj =0, procState=6


#### 2.4.12 调整adj

     // 当client进程处于top，且procState>2时
     if (mayBeTop && procState > ActivityManager.PROCESS_STATE_TOP) {
         switch (procState) {
             case ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND:
             case ActivityManager.PROCESS_STATE_IMPORTANT_BACKGROUND:
             case ActivityManager.PROCESS_STATE_SERVICE:
                 //对于procState=6,7,10时，则设置成3
                 procState = ActivityManager.PROCESS_STATE_BOUND_FOREGROUND_SERVICE;
                 break;
             default:
                 //其他情况，直接设置成2
                 procState = ActivityManager.PROCESS_STATE_TOP;
                 break;
         }
     }

     //当procState>= 16时，
     if (procState >= ActivityManager.PROCESS_STATE_CACHED_EMPTY) {
         if (app.hasClientActivities) {
             //当进程存在client activity，则设置procState=15；
             procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT;
             app.adjType = "cch-client-act";
         } else if (app.treatLikeActivity) {
             //当进程可以像activity一样对待时，则设置procState=14；
             procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY;
             app.adjType = "cch-as-act";
         }
     }

     //当adj = 5时
     if (adj == ProcessList.SERVICE_ADJ) {
         if (doingAll) {
             //当A类Service个数 > service/3时，则加入到B类Service
             app.serviceb = mNewNumAServiceProcs > (mNumServiceProcs/3);
             mNewNumServiceProcs++;
             if (!app.serviceb) {
                 //当对于低RAM设备，则把该service直接放入B类Service
                 if (mLastMemoryLevel > ProcessStats.ADJ_MEM_FACTOR_NORMAL
                         && app.lastPss >= mProcessList.getCachedRestoreThresholdKb()) {
                     app.serviceHighRam = true;
                     app.serviceb = true;
                 } else {
                     mNewNumAServiceProcs++;
                 }
             } else {
                 app.serviceHighRam = false;
             }
         }
         //调整adj=8
         if (app.serviceb) {
             adj = ProcessList.SERVICE_B_ADJ;
         }
     }
     //将计算得到的adj赋给curRawAdj
     app.curRawAdj = adj;

     //当adj大小上限为maxAdj
     if (adj > app.maxAdj) {
         adj = app.maxAdj;
         if (app.maxAdj <= ProcessList.PERCEPTIBLE_APP_ADJ) {
             schedGroup = Process.THREAD_GROUP_DEFAULT;
         }
     }
     //对于hasAboveClient=true，则降低该进程adj
     app.curAdj = app.modifyRawOomAdj(adj);
     app.curSchedGroup = schedGroup;
     app.curProcState = procState;
     app.foregroundActivities = foregroundActivities;
     //返回进程的curRawAdj
     return app.curRawAdj;
 }


### 2.5  AMS.applyOomAdjLocked

    private final boolean applyOomAdjLocked(ProcessRecord app, boolean doingAll, long now,
            long nowElapsed) {
        boolean success = true;

        //将curRawAdj赋给setRawAdj
        if (app.curRawAdj != app.setRawAdj) {
            app.setRawAdj = app.curRawAdj;
        }

        if (app.curAdj != app.setAdj) {
            //将adj值 发送给lmkd守护进程
            ProcessList.setOomAdj(app.pid, app.info.uid, app.curAdj);
            app.setAdj = app.curAdj;
        }

        //情况为： waitingToKill
        if (app.setSchedGroup != app.curSchedGroup) {
            app.setSchedGroup = app.curSchedGroup;
            if (app.waitingToKill != null && app.curReceiver == null
                    && app.setSchedGroup == Process.THREAD_GROUP_BG_NONINTERACTIVE) {
                //杀进程，并设置applyOomAdjLocked过程失败
                app.kill(app.waitingToKill, true);
                success = false;
            } else {
                long oldId = Binder.clearCallingIdentity();
                try {
                    //设置进程组信息
                    Process.setProcessGroup(app.pid, app.curSchedGroup);
                } catch (Exception e) {
                } finally {
                    Binder.restoreCallingIdentity(oldId);
                }
                //调整进程的swappiness值
                Process.setSwappiness(app.pid,
                        app.curSchedGroup <= Process.THREAD_GROUP_BG_NONINTERACTIVE);
            }
        }
        if (app.repForegroundActivities != app.foregroundActivities) {
            app.repForegroundActivities = app.foregroundActivities;
            changes |= ProcessChangeItem.CHANGE_ACTIVITIES;
        }
        if (app.repProcState != app.curProcState) {
            app.repProcState = app.curProcState;
            changes |= ProcessChangeItem.CHANGE_PROCESS_STATE;
            if (app.thread != null) {
                //设置进程状态
                app.thread.setProcessState(app.repProcState);
            }
        }

        if (app.setProcState == ActivityManager.PROCESS_STATE_NONEXISTENT
                || ProcessList.procStatesDifferForMem(app.curProcState, app.setProcState)) {
            app.lastStateTime = now;
            //当setProcState = -1或者curProcState与setProcState值不同时，则计算pss下次时间(参数true)
            app.nextPssTime = ProcessList.computeNextPssTime(app.curProcState, true,
                    mTestPssMode, isSleeping(), now);
        } else {
            当前时间超过pss下次时间，则请求统计pss,并计算pss下次时间(参数false)
            if (now > app.nextPssTime || (now > (app.lastPssTime+ProcessList.PSS_MAX_INTERVAL)
                    && now > (app.lastStateTime+ProcessList.minTimeFromStateChange(
                    mTestPssMode)))) {
                requestPssLocked(app, app.setProcState);
                app.nextPssTime = ProcessList.computeNextPssTime(app.curProcState, false,
                        mTestPssMode, isSleeping(), now);
            }
        }

        if (app.setProcState != app.curProcState) {
            boolean setImportant = app.setProcState < ActivityManager.PROCESS_STATE_SERVICE;
            boolean curImportant = app.curProcState < ActivityManager.PROCESS_STATE_SERVICE;
            if (setImportant && !curImportant) {
                BatteryStatsImpl stats = mBatteryStatsService.getActiveStatistics();
                synchronized (stats) {
                    app.lastWakeTime = stats.getProcessWakeTime(app.info.uid,
                            app.pid, nowElapsed);
                }
                app.lastCpuTime = app.curCpuTime;

            }
            maybeUpdateUsageStatsLocked(app, nowElapsed);

            app.setProcState = app.curProcState;
            if (app.setProcState >= ActivityManager.PROCESS_STATE_HOME) {
                app.notCachedSinceIdle = false;
            }
            if (!doingAll) {
                setProcessTrackerStateLocked(app, mProcessStats.getMemFactorLocked(), now);
            } else {
                app.procStateChanged = true;
            }
        } else if (app.reportedInteraction && (nowElapsed-app.interactionEventTime)
                > USAGE_STATS_INTERACTION_INTERVAL) {
            maybeUpdateUsageStatsLocked(app, nowElapsed);
        }

        if (changes != 0) {
            int i = mPendingProcessChanges.size()-1;
            ProcessChangeItem item = null;
            while (i >= 0) {
                item = mPendingProcessChanges.get(i);
                if (item.pid == app.pid) {
                    break;
                }
                i--;
            }
            if (i < 0) {
                final int NA = mAvailProcessChanges.size();
                if (NA > 0) {
                    item = mAvailProcessChanges.remove(NA-1);
                } else {
                    item = new ProcessChangeItem();
                }
                item.changes = 0;
                item.pid = app.pid;
                item.uid = app.info.uid;
                if (mPendingProcessChanges.size() == 0) {
                    mUiHandler.obtainMessage(DISPATCH_PROCESSES_CHANGED).sendToTarget();
                }
                mPendingProcessChanges.add(item);
            }
            item.changes |= changes;
            item.processState = app.repProcState;
            item.foregroundActivities = app.repForegroundActivities;
        }

        return success;
    }

该方法主要功能：

1. 把curRawAdj值赋给setRawAdj
2. 把adj值 发送给lmkd守护进程
3. 当app标记waitingToKill，且没有广播接收器运行在该进程，并且调度组为后台非交互组，则杀掉该进程，设置applyOomAdjLocked过程失败；
4. 设置进程组信息
5. 设置进程状态
6. 执行pss统计操作，以及计算下一次pss时间
7. 设置进程状态改变；


### 三、总结


调整进程的adj的3大护法：

- `updateOomAdjLocked`：更新adj，当目标进程为空，或者被杀则返回false；否则返回true;
- `computeOomAdjLocked`：计算adj，返回计算后RawAdj值;
- `applyOomAdjLocked`：应用adj，当需要杀掉目标进程则返回false；否则返回true。


#### 3.1 updateOomAdjLocked
主要工作：

- 遍历mLruProcesses进程，更新进程adj，并杀掉满足以下条件的进程：
    - 当curProcState=14或15，且cached进程超过上限(cachedProcessLimit=32)
    - 当curProcState=16，且空进程超过上限(TRIM_EMPTY_APPS=8)，且空闲时间超过30分钟
    - 当curProcState=16，且空进程超过上限(emptyProcessLimit=16)

- 根据memFactor来调度执行TrimMemory操作；


#### 3.2 computeOomAdjLocked

主要工作：计算进程的adj和procState

- 进程为空的情况
- maxAdj<=0
- 计算各种状态下(当前显示activity, 症结接收的广播/service等)的adj和procState
- 非前台activity的情况
- adj > 2的情况
- HeavyWeightProces情况
- HomeProcess情况
- PreviousProcess情况
- 备份进程情况
- Service情况
- ContentProvider情况
- 调整adj


#### 3.3 applyOomAdjLocked

主要工作：

- 把adj值相关信息发送给lmkd守护进程
- 当app标记waitingToKill，且没有广播接收器运行在该进程，并且调度组为后台非交互组，则杀掉该进程；
- 设置进程组信息/进程状态
- 执行pss统计操作，以及计算下一次pss时间

 apply过程中只有当waitingToKill情况下杀掉该进程，则会返回false；否则都是返回true。
