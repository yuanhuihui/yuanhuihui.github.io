---
layout: post
title:  "解读Android进程优先级ADJ算法"
date:   2018-05-19 10:11:12
catalog:  true
tags:
    - android

---

本文基于原生Android P源码来解读进程优先级原理，基于篇幅考虑会精炼部分代码

## 一、概述

### 1.1 进程

Android框架对进程创建与管理进行了封装，对于APP开发者只需知道Android四大组件的使用。当Activity, Service, ContentProvider, BroadcastReceiver任一组件启动时，当其所承载的进程存在则直接使用，不存在则由框架代码自动调用startProcessLocked创建进程。一个APP可以拥有多个进程，多个APP也可以运行在同一个进程，通过配置Android:process属性来决定。所以说对APP来说进程几乎是透明的，但了解进程对于深刻理解Android系统是至关关键的。

### 1.2 优先级

Android系统的设计理念正是希望应用进程能尽量长时间地存活，以提升用户体验。应用首次打开比较慢，这个过程有进程创建以及Application等信息的初始化，所以应用在启动之后，即便退到后台并非立刻杀死，而是存活一段时间，这样下次再使用则会非常快。对于APP同样希望自身尽可能存活更长的时间，甚至探索各种保活黑科技。物极必反，系统处于低内存的状态下，手机性能会有所下降；系统继续放任所有进程一直存活，系统内存很快就会枯竭而亡，那么需要合理地进程回收机制。

到底该回收哪个进程呢？系统根据进程的组件状态来决定每个进程的优先级值ADJ，系统根据一定策略先杀优先级最低的进程，然后逐步杀优先级更低的进程，依此类推，以回收预期的可用系统资源，从而保证系统正常运转。

谈到优先级，可能有些人会想到Linux进程本身有nice值，这个能决定CPU资源调度的优先级；而本文介绍Android系统中的ADJ，主要决定在什么场景下什么类型的进程可能会被杀，影响的是进程存活时间。ADJ与nice值两者定位不同，不过也有一定的联系，优先级很高的进程，往往也是用户不希望被杀的进程，是具有有一定正相关性。

### 1.3 ADJ级别

| ADJ级别   | 取值|含义|
| --------   | :-----  | :-----  |
|NATIVE_ADJ |-1000 |native进程|
|SYSTEM_ADJ |-900 |仅指system_server进程|
|PERSISTENT_PROC_ADJ |-800 |系统persistent进程|
|PERSISTENT_SERVICE_ADJ |-700 |关联着系统或persistent进程
|`FOREGROUND_APP_ADJ` |0 |前台进程|
|`VISIBLE_APP_ADJ` |100 |可见进程|
|`PERCEPTIBLE_APP_ADJ` |200 |可感知进程，比如后台音乐播放|
|BACKUP_APP_ADJ |300 |备份进程|
|HEAVY_WEIGHT_APP_ADJ |400 |重量级进程|
|`SERVICE_ADJ` |500 |服务进程|
|HOME_APP_ADJ |600 |Home进程|
|PREVIOUS_APP_ADJ |700 |上一个进程|
|`SERVICE_B_ADJ` |800 |B List中的Service|
|`CACHED_APP_MIN_ADJ` |900 |不可见进程的adj最小值|
|CACHED_APP_MAX_ADJ|906 |不可见进程的adj最大值|

从Android 7.0开始，ADJ采用100、200、300；在这之前的版本ADJ采用数字1、2、3，这样的调整可以更进一步地细化进程的优先级，比如在VISIBLE_APP_ADJ(100)与PERCEPTIBLE_APP_ADJ(200)之间，可以有ADJ=101、102级别的进程。

- 省去lmk对oom_score_adj的计算过程，Android 7.0之前的版本，oom_score_adj= oom_adj * 1000/17；
而Android 7.0开始，oom_score_adj= oom_adj，不用再经过一次转换。

### 1.4 LMK

为了防止剩余内存过低，Android在内核空间有lowmemorykiller(简称LMK)，LMK是通过注册shrinker来触发低内存回收的，这个机制并不太优雅，可能会拖慢Shrinkers内存扫描速度，已从内核4.12中移除，后续会采用用户空间的LMKD + memory cgroups机制，这里先不展开LMK讲解。

进程刚启动时ADJ等于INVALID_ADJ，当执行完attachApplication()，该该进程的curAdj和setAdj不相等，则会触发执行setOomAdj()将该进程的节点/proc/`pid`/oom_score_adj写入oomadj值。下图参数为Android原生阈值，当系统剩余空闲内存低于某阈值(比如147MB)，则从ADJ大于或等于相应阈值(比如900)的进程中，选择ADJ值最大的进程，如果存在多个ADJ相同的进程，则选择内存最大的进程。 如下是64位机器，LMK默认阈值图：

![lmk_adj](/images/damo-adj/lmk_adj.jpg)

在updateOomLevels()过程，会根据手机屏幕尺寸或内存大小来调整scale，默认大多数手机内存都大于700MB，则scale等于1。对于64位手机，阈值会更大些，具体如下。

```Java
private void updateOomLevels(int displayWidth, int displayHeight, boolean write) {
    ...
    for (int i=0; i<mOomAdj.length; i++) {
        int low = mOomMinFreeLow[i];
        int high = mOomMinFreeHigh[i];
        if (is64bit) {
            if (i == 4) high = (high*3)/2;
            else if (i == 5) high = (high*7)/4;
        }
        mOomMinFree[i] = (int)(low + ((high-low)*scale));
    }
}
```


## 二、解读ADJ

接下来，解读每个ADJ值都对应着怎样条件的进程，包括正在运行的组件以及这些组件的状态几何。这里重点介绍上图标红的ADJ级别所对应的进程。


Android系统中计算各进程ADJ算法的核心方法:

- updateOomAdjLocked：更新adj，当目标进程为空或者被杀则返回false；否则返回true;
- computeOomAdjLocked：计算adj，返回计算后RawAdj值;
- applyOomAdjLocked：应用adj，当需要杀掉目标进程则返回false；否则返回true。

当Android四大组件状态改变时会updateOomAdjLocked()来同步更新相应进程的ADJ优先级。这里需要说明一下，当同一个进程有多个决定其优先级的组件状态时，取优先级最高的ADJ作为最终的ADJ。另外，进程会通过设置maxAdj来限定ADJ的上限。

关于分析进程ADJ相关信息，常用命令如下：

- dumpsys meminfo，
- dumpsys activity o
- dumpsys activity p

### 2.0 ADJ<0的进程

- NATIVE_ADJ(-1000)：是由init进程fork出来的Native进程，并不受system管控；
- SYSTEM_ADJ(-900)：是指system_server进程；
- PERSISTENT_PROC_ADJ(-800): 是指在AndroidManifest.xml中申明android:persistent=”true”的系统(即带有FLAG_SYSTEM标记)进程，persistent进程一般情况并不会被杀，即便被杀或者发生Crash系统会立即重新拉起该进程。
- PERSISTENT_SERVICE_ADJ(-700)：是由startIsolatedProcess()方式启动的进程，或者是由system_server或者persistent进程所绑定(并且带有BIND_ABOVE_CLIENT或者BIND_IMPORTANT)的服务进程

再来说一下其他优先级：

- BACKUP_APP_ADJ(300)：执行bindBackupAgent()过程的进程
- HEAVY_WEIGHT_APP_ADJ(400): realStartActivityLocked()过程，当应用的privateFlags标识PRIVATE_FLAG_CANT_SAVE_STATE的进程；
- HOME_APP_ADJ(600)：当类型为ACTIVITY_TYPE_HOME的应用，比如桌面APP
- PREVIOUS_APP_ADJ(700)：用户上一个使用的APP进程

#### SYSTEM_ADJ(-900)

SYSTEM_ADJ: 仅指system_server进程。在执行SystemServer的startBootstrapServices()过程会调用AMS.setSystemProcess()，将system_server进程的maxAdj设置成SYSTEM_ADJ，源码如下：

    public void setSystemProcess() {
        ...
        ApplicationInfo info = mContext.getPackageManager().getApplicationInfo(
                "android", STOCK_PM_FLAGS | MATCH_SYSTEM_ONLY);
        mSystemThread.installSystemApplicationInfo(info, getClass().getClassLoader());
        synchronized (this) {
            ProcessRecord app = newProcessRecordLocked(info, info.processName, false, 0);
            app.persistent = true;
            app.pid = MY_PID;
            app.maxAdj = ProcessList.SYSTEM_ADJ;
            app.makeActive(mSystemThread.getApplicationThread(), mProcessStats);
            synchronized (mPidsSelfLocked) {
                mPidsSelfLocked.put(app.pid, app);
            }
            updateLruProcessLocked(app, false, null);
            updateOomAdjLocked();
        }
        ...
    }

但system_server的ADJ并非等于-900，而是-800？是由于startPersistentApps()过程直接把其adj重新被设置为-800，这算是一个小BUG，但
其实目前来说对于ADJ<0的进程，LMK不会杀，两者没有什么区别。

#### PERSISTENT_PROC_ADJ(-800)

PERSISTENT_PROC_ADJ：在AndroidManifest.xml中申明android:persistent="true"的系统(即带有FLAG_SYSTEM标记)进程，称之为persistent进程。对于persistent进程常规情况都不会被杀，一旦被杀或者发生Crash，进程会立即重启。

AMS.addAppLocked(）或AMS.newProcessRecordLocked()过程会赋值：  

**场景1：** newProcessRecordLocked

    final ProcessRecord newProcessRecordLocked(ApplicationInfo info, String customProcess,
          boolean isolated, int isolatedUid) {
      String proc = customProcess != null ? customProcess : info.processName;
      final int userId = UserHandle.getUserId(info.uid);
      int uid = info.uid;
      ...
      final ProcessRecord r = new ProcessRecord(stats, info, proc, uid);
      if (!mBooted && !mBooting
              && userId == UserHandle.USER_SYSTEM
              && (info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
          r.persistent = true;
          r.maxAdj = ProcessList.PERSISTENT_PROC_ADJ;
      }
      if (isolated && isolatedUid != 0) {
          r.maxAdj = ProcessList.PERSISTENT_SERVICE_ADJ;
      }
      return r;
    }

在每一次进程启动的时候都会判断该进程是否persistent进程，如果是则会设置maxAdj=PERSISTENT_PROC_ADJ。
system_server进程应该也是persistent进程？

**场景2：**addAppLocked

    final ProcessRecord addAppLocked(ApplicationInfo info, String customProcess, boolean isolated,
            String abiOverride) {
        ProcessRecord app;
        if (!isolated) {
            app = getProcessRecordLocked(customProcess != null ? customProcess : info.processName,
                    info.uid, true);
        } else {
            app = null;
        }

        if (app == null) {
            app = newProcessRecordLocked(info, customProcess, isolated, 0);
            updateLruProcessLocked(app, false, null);
            updateOomAdjLocked();
        }
        ...
        
        if ((info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
            app.persistent = true;
            app.maxAdj = ProcessList.PERSISTENT_PROC_ADJ;
        }
        if (app.thread == null && mPersistentStartingProcesses.indexOf(app) < 0) {
            mPersistentStartingProcesses.add(app);
            startProcessLocked(app, "added application",
                    customProcess != null ? customProcess : app.processName, abiOverride);
        }
        return app;
    }

开机过程会先启动persistent进程，并赋予maxAdj为PERSISTENT_PROC_ADJ，调用链：

    startOtherServices()
      AMS.systemReady
        AMS.startPersistentApps
          AMS.addAppLocked

#### PERSISTENT_SERVICE_ADJ(-700)

PERSISTENT_SERVICE_ADJ: startIsolatedProcess()方式启动的进程，或者是由system_server或者persistent进程所绑定的服务进程。

**场景1：**newProcessRecordLocked
  
    final ProcessRecord newProcessRecordLocked(ApplicationInfo info, String customProcess,
          boolean isolated, int isolatedUid) {
      String proc = customProcess != null ? customProcess : info.processName;
      final int userId = UserHandle.getUserId(info.uid);
      int uid = info.uid;
      ...
      final ProcessRecord r = new ProcessRecord(stats, info, proc, uid);
      if (!mBooted && !mBooting
              && userId == UserHandle.USER_SYSTEM
              && (info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
          r.persistent = true;
          r.maxAdj = ProcessList.PERSISTENT_PROC_ADJ;
      }
      if (isolated && isolatedUid != 0) { //startIsolatedProcess
          r.maxAdj = ProcessList.PERSISTENT_SERVICE_ADJ;
      }
      return r;
    }

调用链：

    startOtherServices
      WebViewUpdateService.prepareWebViewInSystemServer
        WebViewUpdateServiceImpl.prepareWebViewInSystemServer
          WebViewUpdater.prepareWebViewInSystemServer
            WebViewUpdater.onWebViewProviderChanged
              SystemImpl.onWebViewProviderChanged
                WebViewFactory.onWebViewProviderChanged
                  WebViewLibraryLoader.prepareNativeLibraries
                    WebViewLibraryLoader.createRelros
                      WebViewLibraryLoader.createRelroFile
                        AMS.startIsolatedProcess


                        
#### BACKUP_APP_ADJ(300)

    if (mBackupTarget != null && app == mBackupTarget.app) {
        if (adj > ProcessList.BACKUP_APP_ADJ) {
            adj = ProcessList.BACKUP_APP_ADJ;
            if (procState > ActivityManager.PROCESS_STATE_TRANSIENT_BACKGROUND) {
                procState = ActivityManager.PROCESS_STATE_TRANSIENT_BACKGROUND;
            }
            app.adjType = "backup";
            app.cached = false;
        }
        if (procState > ActivityManager.PROCESS_STATE_BACKUP) {
            procState = ActivityManager.PROCESS_STATE_BACKUP;
            app.adjType = "backup";
        }
    }

- 执行bindBackupAgent()过程，设置mBackupTarget值；
- 执行clearPendingBackup()或unbindBackupAgent()过程，置空mBackupTarget值；

#### HEAVY_WEIGHT_APP_ADJ(400)

- realStartActivityLocked()过程，当应用的privateFlags标识PRIVATE_FLAG_CANT_SAVE_STATE，设置mHeavyWeightProcess值；
- finishHeavyWeightApp(), 置空mHeavyWeightProcess值；


#### HOME_APP_ADJ(600)

当类型为ACTIVITY_TYPE_HOME的应用启动后会设置mHomeProcess，比如桌面APP。

#### PREVIOUS_APP_ADJ(700)

**场景1：**用户上一个使用的包含UI的进程，为了给用户在两个APP之间更好的切换体验，将上一个进程ADJ设置到PREVIOUS_APP_ADJ的档次。
当activityStoppedLocked()过程会更新上一个应用。

```Java
if (app == mPreviousProcess && app.activities.size() > 0) {
    if (adj > ProcessList.PREVIOUS_APP_ADJ) {
        adj = ProcessList.PREVIOUS_APP_ADJ;
        schedGroup = ProcessList.SCHED_GROUP_BACKGROUND;
        app.cached = false;
        app.adjType = "previous";
    }
    if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
        procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
        app.adjType = "previous";
    }
}
```

**场景2：**
当provider进程，上一次使用时间不超过20S的情况下，优先级不低于PREVIOUS_APP_ADJ。provider进程这个是Android 7.0以后新增的逻辑
，这样做的好处是在内存比较低的情况下避免拥有provider的进程出现颠簸，也就是启动后杀，然后又被拉。

```Java
if (app.lastProviderTime > 0 &&
        (app.lastProviderTime+mConstants.CONTENT_PROVIDER_RETAIN_TIME) > now) {
    if (adj > ProcessList.PREVIOUS_APP_ADJ) {
        adj = ProcessList.PREVIOUS_APP_ADJ;
        schedGroup = ProcessList.SCHED_GROUP_BACKGROUND;
        app.cached = false;
        app.adjType = "recent-provider";
    }
    if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
        procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
        app.adjType = "recent-provider";
    }
}
```


### 2.1 FOREGROUND_APP_ADJ(0)

**场景1：**满足以下任一条件的进程都属于FOREGROUND_APP_ADJ(0)优先级：

- 正处于resumed状态的Activity
- 正执行一个生命周期回调的Service（比如执行onCreate,onStartCommand,onDestroy等）
- 正执行onReceive()的BroadcastReceiver
- 通过startInstrumentation()启动的进程

源码如下：

    if (PROCESS_STATE_CUR_TOP == ActivityManager.PROCESS_STATE_TOP && app == TOP_APP) {
        adj = ProcessList.FOREGROUND_APP_ADJ;
        schedGroup = ProcessList.SCHED_GROUP_TOP_APP;
        app.adjType = "top-activity";
        foregroundActivities = true;
        procState = PROCESS_STATE_CUR_TOP;
    } else if (app.instr != null) {
        adj = ProcessList.FOREGROUND_APP_ADJ;
        schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
        app.adjType = "instrumentation";
        procState = ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE;
    } else if (isReceivingBroadcastLocked(app, mTmpBroadcastQueue)) {
        adj = ProcessList.FOREGROUND_APP_ADJ;
        schedGroup = (mTmpBroadcastQueue.contains(mFgBroadcastQueue))
                ? ProcessList.SCHED_GROUP_DEFAULT : ProcessList.SCHED_GROUP_BACKGROUND;
        app.adjType = "broadcast";
        procState = ActivityManager.PROCESS_STATE_RECEIVER;
    } else if (app.executingServices.size() > 0) {
        adj = ProcessList.FOREGROUND_APP_ADJ;
        schedGroup = app.execServicesFg ?
                ProcessList.SCHED_GROUP_DEFAULT : ProcessList.SCHED_GROUP_BACKGROUND;
        app.adjType = "exec-service";
        procState = ActivityManager.PROCESS_STATE_SERVICE;
    } else if (app == TOP_APP) {
        adj = ProcessList.FOREGROUND_APP_ADJ;
        schedGroup = ProcessList.SCHED_GROUP_BACKGROUND;
        app.adjType = "top-sleeping";
        foregroundActivities = true;
        procState = PROCESS_STATE_CUR_TOP;
    } else {
        schedGroup = ProcessList.SCHED_GROUP_BACKGROUND;
        adj = cachedAdj;
        procState = ActivityManager.PROCESS_STATE_CACHED_EMPTY;
        app.cached = true;
        app.empty = true;
        app.adjType = "cch-empty";
    }
    
**场景2：**
当客户端进程activity里面调用bindService()方法时flags带有BIND_ADJUST_WITH_ACTIVITY参数，并且该activity处于可见状态，则当前服务进程也属于前台进程，源码如下：

```Java
for (int is = app.services.size()-1; is >= 0; is--) {
    ServiceRecord s = app.services.valueAt(is);
    for (int conni = s.connections.size()-1; conni >= 0; conni--) {
        ArrayList<ConnectionRecord> clist = s.connections.valueAt(conni);
        for (int i = 0; i < clist.size(); i++) {
            ConnectionRecord cr = clist.get(i);
            if ((cr.flags&Context.BIND_WAIVE_PRIORITY) == 0) {
              ...
            }
            
            final ActivityRecord a = cr.activity;
            if ((cr.flags&Context.BIND_ADJUST_WITH_ACTIVITY) != 0) {
                if (a != null && adj > ProcessList.FOREGROUND_APP_ADJ &&
                    (a.visible || a.state == ActivityState.RESUMED ||
                     a.state == ActivityState.PAUSING)) {
                    adj = ProcessList.FOREGROUND_APP_ADJ;
                    if ((cr.flags&Context.BIND_NOT_FOREGROUND) == 0) {
                        if ((cr.flags&Context.BIND_IMPORTANT) != 0) {
                            schedGroup = ProcessList.SCHED_GROUP_TOP_APP_BOUND;
                        } else {
                            schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
                        }
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
```

#### provider客户端
**场景3：**
对于provider进程，还有以下两个条件能成为前台进程：

- 当Provider的客户端进程ADJ<=FOREGROUND_APP_ADJ时，则Provider进程ADJ等于FOREGROUND_APP_ADJ
- 当Provider有外部(非框架)进程依赖，也就是调用了getContentProviderExternal()方法，则ADJ至少等于FOREGROUND_APP_ADJ

```Java
for (int provi = app.pubProviders.size()-1; provi >= 0; provi--) {
    ContentProviderRecord cpr = app.pubProviders.valueAt(provi);
    //根据client来调整provider进程的adj和procState
    for (int i = cpr.connections.size()-1; i >= 0; i--) {
        ContentProviderConnection conn = cpr.connections.get(i);
        ProcessRecord client = conn.client;
        int clientAdj = computeOomAdjLocked(client, cachedAdj, TOP_APP, doingAll, now);
        if (adj > clientAdj) {
            if (app.hasShownUi && app != mHomeProcess
                    && clientAdj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                ...
            } else {
                adj = clientAdj > ProcessList.FOREGROUND_APP_ADJ
                        ? clientAdj : ProcessList.FOREGROUND_APP_ADJ;
                adjType = "provider";
            }
            app.cached &= client.cached;
        }
        ...
    }
    //根据provider外部依赖情况来调整adj和schedGroup
    if (cpr.hasExternalProcessHandles()) {
         if (adj > ProcessList.FOREGROUND_APP_ADJ) {
             adj = ProcessList.FOREGROUND_APP_ADJ;
             schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
             app.cached = false;
             app.adjType = "ext-provider";
             app.adjTarget = cpr.name;
         }
     }
}
```

### 2.2 VISIBLE_APP_ADJ(100)

可见进程：当ActivityRecord的visible=true，也就是Activity可见的进程。

```Java
if (!foregroundActivities && activitiesSize > 0) {
    int minLayer = ProcessList.VISIBLE_APP_LAYER_MAX;
    for (int j = 0; j < activitiesSize; j++) {
        final ActivityRecord r = app.activities.get(j);
        if (r.visible) {
            if (adj > ProcessList.VISIBLE_APP_ADJ) {
                adj = ProcessList.VISIBLE_APP_ADJ;
                app.adjType = "vis-activity";
            }
            if (procState > PROCESS_STATE_CUR_TOP) {
                procState = PROCESS_STATE_CUR_TOP;
                app.adjType = "vis-activity";
            }
            schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
            app.cached = false;
            app.empty = false;
            foregroundActivities = true;
            final TaskRecord task = r.getTask();
            if (task != null && minLayer > 0) {
                final int layer = task.mLayerRank;
                if (layer >= 0 && minLayer > layer) {
                    minLayer = layer;
                }
            }
            break;
        }
        ...
    }
    if (adj == ProcessList.VISIBLE_APP_ADJ) {
        adj += minLayer;
    }
}
```

从Android P开始，进一步细化ADJ级别，增加了VISIBLE_APP_LAYER_MAX(99)，是指VISIBLE_APP_ADJ(100)跟PERCEPTIBLE_APP_ADJ(200)之间有99个槽，则可见级别ADJ的取值范围为[100,199]。
算法会根据其所在task的mLayerRank来调整其ADJ，100加上mLayerRank就等于目标ADJ，layer越大，则ADJ越小。


关于TaskRecord的mLayerRank的计算方式是在updateOomAdjLocked()过程调用ASS的rankTaskLayersIfNeeded()方法，如下：
        
```Java
[-> ActivityStackSupervisor.java]
void rankTaskLayersIfNeeded() {
    if (!mTaskLayersChanged) {
        return;
    }
    mTaskLayersChanged = false;
    for (int displayNdx = 0; displayNdx < mActivityDisplays.size(); displayNdx++) {
        final ActivityDisplay display = mActivityDisplays.valueAt(displayNdx);
        int baseLayer = 0;
        for (int stackNdx = display.getChildCount() - 1; stackNdx >= 0; --stackNdx) {
            final ActivityStack stack = display.getChildAt(stackNdx);
            baseLayer += stack.rankTaskLayers(baseLayer);
        }
    }
}
```

```Java
[-> ActivityStack.java]
final int rankTaskLayers(int baseLayer) {
    int layer = 0;
    for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
        final TaskRecord task = mTaskHistory.get(taskNdx);
        ActivityRecord r = task.topRunningActivityLocked();
        if (r == null || r.finishing || !r.visible) {
            task.mLayerRank = -1;
        } else {
            task.mLayerRank = baseLayer + layer++;
        }
    }
    return layer;
}
```

当TaskRecord顶部的ActivityRecord为空或者结束或者不可见时，则设置该TaskRecord的mLayerRank等于-1; 每个ActivityDisplay的baseLayer都是从0开始，从最上面的TaskRecord开始，第一个ADJ=100，从上至下依次加1，直到199为上限。

![visible_adj_layer](/images/process-adj/visible_adj_layer.png)


#### service客户端
ServiceRecord的成员变量startRequested=true，是指被显式调用了startService()方法。当service被stop或kill会将其置为false。

一般情况下，即便客户端进程处于前台进程(ADJ=0)级别，服务进程只会提升到可见(ADJ=1)级别。以下flags是由调用bindService()过程所传递的flags来决定的。

|flag|含义|
|---|---|
|BIND_WAIVE_PRIORITY|是指客户端进程的优先级不会影响目标服务进程的优先级。比如当调用bindService又不希望提升目标服务进程的优先级的情况下，可以使用该flags|
|BIND_ADJUST_WITH_ACTIVITY|是指当从Activity绑定到该进程时，允许目标服务进程根据该activity的可见性来提升优先级|
|BIND_ABOVE_CLIENT|当客户端进程绑定到一个服务进程时，则服务进程比客户端进程更重要|
|BIND_IMPORTANT| 标记该服务对于客户端进程很重要，当客户端进程处于前台进程(ADJ=0)级别时，会把服务进程也提升到前台进程级别|
|BIND_NOT_VISIBLE|当客户端进程处于可见(ADJ=1)级别，也不允许被绑定的服务进程提升到可见级别，该类服务进程的优先级上限为可感知(ADJ=2)级别|
|BIND_NOT_FOREGROUND|不允许被绑定的服务进程提升到前台调度优先级，但是内存优先级可以提升到前台级别。比如不希望服务进程占用|


作为工程师很多时候可能还是想看看源码，show me the code。但是关于ADJ计算这一块源码场景computeOomAdjLocked()，Google真心写得比较乱，为了更清晰地说明客户端进程如何影响服务进程，在保证不失去原意的情况下重写了这块部分逻辑：

这个过程主要根据service本身、client端情况以及activity状态分别来调整adj和schedGroup

```Java
for (int is = app.services.size()-1; is >= 0; is--) {
    ServiceRecord s = app.services.valueAt(is);
    if (s.startRequested) {
        ... // 根据service本身调整adj和adjType
    }
    for (int conni = s.connections.size()-1; conni >= 0; conni--) {
        ArrayList<ConnectionRecord> clist = s.connections.valueAt(conni);
        for (int i = 0; i < clist.size(); i++) {
            ConnectionRecord cr = clist.get(i);
            //根据client端来调整adj
            if ((cr.flags&Context.BIND_WAIVE_PRIORITY) == 0) {
                if (adj > clientAdj) {
                    if (app.hasShownUi && app != mHomeProcess
                            && clientAdj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                        ...
                    } else {
                        int newAdj = clientAdj;
                        if ((cr.flags&(Context.BIND_ABOVE_CLIENT
                                |Context.BIND_IMPORTANT)) != 0) {
                            if(clientAdj < ProcessList.PERSISTENT_SERVICE_ADJ) {
                                newAdj = PERSISTENT_SERVICE_ADJ;
                            }
                        } else if ((cr.flags&Context.BIND_NOT_VISIBLE) != 0) {
                            if(clientAdj < ProcessList.PERCEPTIBLE_APP_ADJ) {
                                newAdj = PERCEPTIBLE_APP_ADJ;
                            }
                        } else {
                            if (clientAdj < ProcessList.VISIBLE_APP_ADJ) {
                                newAdj = VISIBLE_APP_ADJ;
                            }
                        }

                        if (adj > newAdj) {
                            adj = newAdj;
                            adjType = "service";
                        }
                    }
                }
            }
            final ActivityRecord a = cr.activity;
            // 根据client的activity来调整adj和schedGroup
            if ((cr.flags&Context.BIND_ADJUST_WITH_ACTIVITY) != 0) {
                ...
            }
        }
    }
}
```

上段代码说明服务端进程优先级(adj)不会低于客户端进程优先级(newAdj)，而newAdj的上限受限于flags，具体服务端进程受客户端进程影响的ADJ上限如下：


- BIND_ABOVE_CLIENT或BIND_IMPORTANT的情况下，ADJ上限为PERSISTENT_SERVICE_ADJ；
- BIND_NOT_VISIBLE的情况下， ADJ上限为PERCEPTIBLE_APP_ADJ；
- 否则，一般情况下，ADJ上限为VISIBLE_APP_ADJ；

由此，可见当bindService过程带有BIND_ABOVE_CLIENT或者BIND_IMPORTANT flags的同时，客户端进程ADJ小于或等于PERSISTENT_SERVICE_ADJ的情况下，该进程则为PERSISTENT_SERVICE_ADJ。另外，即便是启动过Activity的进程，当客户端进程ADJ<=200时，还是可以提升该服务进程的优先级。


### 2.3 PERCEPTIBLE_APP_ADJ(200)

可感知进程：当该进程存在不可见的Activity，但Activity正处于PAUSING、PAUSED、STOPPING状态，则为PERCEPTIBLE_APP_ADJ

```Java
if (!foregroundActivities && activitiesSize > 0) {
    int minLayer = ProcessList.VISIBLE_APP_LAYER_MAX;
    for (int j = 0; j < activitiesSize; j++) {
        final ActivityRecord r = app.activities.get(j);
        if (r.visible) {
            ...
        } else if (r.state == ActivityState.PAUSING || r.state == ActivityState.PAUSED) {
            if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                app.adjType = "pause-activity";
            }
            if (procState > PROCESS_STATE_CUR_TOP) {
                procState = PROCESS_STATE_CUR_TOP;
                app.adjType = "pause-activity";
            }
            schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
            app.cached = false;
            app.empty = false;
            foregroundActivities = true;
        } else if (r.state == ActivityState.STOPPING) {
            if (adj > ProcessList.PERCEPTIBLE_APP_ADJ) {
                adj = ProcessList.PERCEPTIBLE_APP_ADJ;
                app.adjType = "stop-activity";
            }
            
            if (!r.finishing) {
                if (procState > ActivityManager.PROCESS_STATE_LAST_ACTIVITY) {
                    procState = ActivityManager.PROCESS_STATE_LAST_ACTIVITY;
                    app.adjType = "stop-activity";
                }
            }
            app.cached = false;
            app.empty = false;
            foregroundActivities = true;
        }
    }
}
```

满足以下任一条件的进程也属于可感知进程:

- foregroundServices非空：前台服务进程，执行startForegroundService()方法
- app.forcingToImportant非空：执行setProcessImportant()方法，比如Toast弹出过程。
- hasOverlayUi非空：非activity的UI位于屏幕最顶层，比如显示类型TYPE_APPLICATION_OVERLAY的窗口


```Java
if (adj > ProcessList.PERCEPTIBLE_APP_ADJ
        || procState > ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE) {
    if (app.foregroundServices) {
        adj = ProcessList.PERCEPTIBLE_APP_ADJ;
        procState = ActivityManager.PROCESS_STATE_FOREGROUND_SERVICE;
        app.cached = false;
        app.adjType = "fg-service";
        schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
    } else if (app.hasOverlayUi) {
        adj = ProcessList.PERCEPTIBLE_APP_ADJ;
        procState = ActivityManager.PROCESS_STATE_IMPORTANT_FOREGROUND;
        app.cached = false;
        app.adjType = "has-overlay-ui";
        schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
    }
}

if (adj > ProcessList.PERCEPTIBLE_APP_ADJ
        || procState > ActivityManager.PROCESS_STATE_TRANSIENT_BACKGROUND) {
    if (app.forcingToImportant != null) {
        adj = ProcessList.PERCEPTIBLE_APP_ADJ;
        procState = ActivityManager.PROCESS_STATE_TRANSIENT_BACKGROUND;
        app.cached = false;
        app.adjType = "force-imp";
        app.adjSource = app.forcingToImportant;
        schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
    }
}
```

### 2.4 SERVICE_ADJ(500)

服务进程：没有启动过Activity，并且30分钟之内活跃过的服务进程。
startRequested为true，则代表执行startService()且没有stop的进程。

```Java
for (int is = app.services.size()-1; is >= 0; is--) {
    ServiceRecord s = app.services.valueAt(is);
    if (s.startRequested) {
        app.hasStartedServices = true;
        if (procState > ActivityManager.PROCESS_STATE_SERVICE) {
            procState = ActivityManager.PROCESS_STATE_SERVICE;
            app.adjType = "started-services";
        }
        if (app.hasShownUi && app != mHomeProcess) {
            if (adj > ProcessList.SERVICE_ADJ) {
                app.adjType = "cch-started-ui-services";
            }
        } else {
            if (now < (s.lastActivity + mConstants.MAX_SERVICE_INACTIVITY)) {
                if (adj > ProcessList.SERVICE_ADJ) {
                    adj = ProcessList.SERVICE_ADJ;
                    app.adjType = "started-services";
                    app.cached = false;
                }
            }
        }
    }
    for (int conni = s.connections.size()-1; conni >= 0; conni--) {
        ... //根据client情况来调整adj
    }
}
```


### 2.5 SERVICE_B_ADJ(800)

进程由SERVICE_ADJ(500)降低到SERVICE_B_ADJ(800)，有以下两种情况：

- A类Service占比过高：当A类Service个数 > Service总数的1/3时，则加入到B类Service。换句话说，B Service的个数至少是A Service的2倍。
- 内存紧张&&A类Service占用内存较高：当系统内存紧张级别(mLastMemoryLevel)高于ADJ_MEM_FACTOR_NORMAL，且该应用所占内存lastPss大于或等于CACHED_APP_MAX_ADJ级别所对应的内存阈值的1/3（默认值阈值约等于110MB）。

源码如下：

    if (adj == ProcessList.SERVICE_ADJ) {
        if (doingAll) {
            app.serviceb = mNewNumAServiceProcs > (mNumServiceProcs/3);
            mNewNumServiceProcs++;
            if (!app.serviceb) {
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
        if (app.serviceb) {
            adj = ProcessList.SERVICE_B_ADJ;
        }
    }

#### ADJ_MEM_FACTOR

这里顺便一下，内存因子ADJ_MEM_FACTOR共有4个级别，当前处于哪个内存因子级别，取决于当前进程中cached进程和空进程的个数。
 
```Java
final int numCachedAndEmpty = numCached + numEmpty;
int memFactor;
if (numCached <= mConstants.CUR_TRIM_CACHED_PROCESSES
        && numEmpty <= mConstants.CUR_TRIM_EMPTY_PROCESSES) {
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
```

 ADJ内存因子：决定允许后台运行Jobs的最大上限，以及决定TrimMemory的级别(包括ThreadedRenderer的回收级别)，再进一步来看看内存因子：
 
|内存因子|取值|先决条件|
|---|---|---|
|ADJ_MEM_FACTOR_CRITICAL| 3| Cached+Empty<=3|
|ADJ_MEM_FACTOR_LOW| 2| Cached+Empty<=5|
|ADJ_MEM_FACTOR_MODERATE| 1| Cached<=5 && Empty<=8|
|ADJ_MEM_FACTOR_NORMAL| 0| Cached>5或者Empty>8|

也就是说

 默认情况取值如下：
 
- 最大缓存进程个数：CUR_MAX_CACHED_PROCESSES = MAX_CACHED_PROCESSES = 32
- 最大空进程个数： CUR_MAX_EMPTY_PROCESSES  = MAX_CACHED_PROCESSES/2 = 16
- Trim空进程上限：CUR_TRIM_EMPTY_PROCESSES  = MAX_CACHED_PROCESSES/4 = 8
- Trim缓存进程上限：CUR_TRIM_CACHED_PROCESSES = MAX_CACHED_PROCESSES/6 = 5

当mOverrideMaxCachedProcesses有值的情况下，最大缓存进程个数和最大空进程个数上限优先取mOverrideMaxCachedProcesses，可通过AMS.setProcessLimit(int max)调整mOverrideMaxCachedProcesses值；Trim的缓存进程和空进程上限不受mOverrideMaxCachedProcesses影响。

再来看看cached和empty进程：

```Java
final int emptyProcessLimit = mConstants.CUR_MAX_EMPTY_PROCESSES;
final int cachedProcessLimit = mConstants.CUR_MAX_CACHED_PROCESSES - emptyProcessLimit;
final long oldTime = now - ProcessList.MAX_EMPTY_TIME;

switch (app.curProcState) {
    case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY:
    case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT:
        mNumCachedHiddenProcs++;
        numCached++;
        //默认cachedProcessLimit=16
        if (numCached > cachedProcessLimit) {
            app.kill("cached #" + numCached, true);
        }
        break;
    case ActivityManager.PROCESS_STATE_CACHED_EMPTY:
        //默认CUR_TRIM_EMPTY_PROCESSES=8, 且满足30min
        if (numEmpty > mConstants.CUR_TRIM_EMPTY_PROCESSES
                && app.lastActivityTime < oldTime) {
            app.kill("empty for "
                    + ((oldTime + ProcessList.MAX_EMPTY_TIME - app.lastActivityTime)
                    / 1000) + "s", true);
        } else {
            numEmpty++;
            //默认cachedProcessLimit=16
            if (numEmpty > emptyProcessLimit) {
                app.kill("empty #" + numEmpty, true);
            }
        }
        break;
    default:
        mNumNonCachedProcs++;
        break;
```

用于限制empty或cached进程的上限为16个，并且empty超过8个时会清理掉30分钟没有活跃的进程。
cached和empty主要是区别是否有Activity。


### 2.6 CACHED_APP_MIN_ADJ(900)

缓存进程优先级从CACHED_APP_MIN_ADJ(900)到 CACHED_APP_MAX_ADJ(906)。

ADJ的转换算法：

- cached: 900, 901, 903, 905
- empty:  900, 902, 904, 906

![adj_900](/images/damo-adj/adj_900.png)


```Java
final int N = mLruProcesses.size();
//numSlots等于3
int numSlots = (ProcessList.CACHED_APP_MAX_ADJ
        - ProcessList.CACHED_APP_MIN_ADJ + 1) / 2;
//mNumNonCachedProcs是指empty和cached之外的进程， mNumCachedHiddenProcs代表的是cached进程个数
int numEmptyProcs = N - mNumNonCachedProcs - mNumCachedHiddenProcs;
if (numEmptyProcs > cachedProcessLimit) {
    numEmptyProcs = cachedProcessLimit;
}
//emptyFactor和cachedFactor分别代表每个slot里面包括的进程个数，大于或等于1
int emptyFactor = numEmptyProcs/numSlots;
int cachedFactor = (mNumCachedHiddenProcs > 0 ? mNumCachedHiddenProcs : 1)/numSlots;

mNumNonCachedProcs = 0;
mNumCachedHiddenProcs = 0;

int curCachedAdj = ProcessList.CACHED_APP_MIN_ADJ;
int nextCachedAdj = curCachedAdj+1;
int curEmptyAdj = ProcessList.CACHED_APP_MIN_ADJ;
int nextEmptyAdj = curEmptyAdj+2;

for (int i=N-1; i>=0; i--) {
    ProcessRecord app = mLruProcesses.get(i);
    if (!app.killedByAm && app.thread != null) {
        app.procStateChanged = false;
        computeOomAdjLocked(app, ProcessList.UNKNOWN_ADJ, TOP_APP, true, now);
        if (app.curAdj >= ProcessList.UNKNOWN_ADJ) {
            switch (app.curProcState) {
                case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY:
                case ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT:
                case ActivityManager.PROCESS_STATE_CACHED_RECENT:
                    app.curRawAdj = curCachedAdj;
                    app.curAdj = app.modifyRawOomAdj(curCachedAdj);
                    if (curCachedAdj != nextCachedAdj) {
                        stepCached++;
                        if (stepCached >= cachedFactor) {
                            stepCached = 0;
                            curCachedAdj = nextCachedAdj;
                            nextCachedAdj += 2; //每次加2
                            if (nextCachedAdj > ProcessList.CACHED_APP_MAX_ADJ) {
                                nextCachedAdj = ProcessList.CACHED_APP_MAX_ADJ;
                            }
                        }
                    }
                    break;
                default:
                    app.curRawAdj = curEmptyAdj;
                    //ADJ阈值
                    app.curAdj = app.modifyRawOomAdj(curEmptyAdj);
                    if (curEmptyAdj != nextEmptyAdj) {
                        stepEmpty++;
                        if (stepEmpty >= emptyFactor) {
                            stepEmpty = 0;
                            curEmptyAdj = nextEmptyAdj;
                            nextEmptyAdj += 2; //每次加2
                            if (nextEmptyAdj > ProcessList.CACHED_APP_MAX_ADJ) {
                                nextEmptyAdj = ProcessList.CACHED_APP_MAX_ADJ;
                            }
                        }
                    }
                    break;
            }
        }

        applyOomAdjLocked(app, true, now, nowElapsed);
        ...
    }
}

```

numSlots=3,
emptyFactor= 空进程个数/3,
cachedFactor= 缓存进程个数/3,



再来看看PROCESS_STATE_CACHED_ACTIVITY的定义：

```Java
if (!foregroundActivities && activitiesSize > 0) {
    for (int j = 0; j < activitiesSize; j++) {
        final ActivityRecord r = app.activities.get(j);
        if (r.visible) {
            ...
        } else if (r.state == ActivityState.PAUSING || r.state == ActivityState.PAUSED) {
            ...
        } else if (r.state == ActivityState.STOPPING) {
            ...
        } else {
            if (procState > ActivityManager.PROCESS_STATE_CACHED_ACTIVITY) {
                procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY;
                app.adjType = "cch-act";
            }
        }
    }
}
```

foregroundActivities代表当前不是前台(FOREGROUND_APP_ADJ)进程，并且存在Activity的进程，当该Activity窗口不可见，并且不处于PAUSING(正在)、PAUSED(onPause个)、STOPPING的任一状态的情况下，则设置该进程为PROCESS_STATE_CACHED_ACTIVITY。


PROCESS_STATE_CACHED_ACTIVITY_CLIENT的定义：

```Java
if (procState >= ActivityManager.PROCESS_STATE_CACHED_EMPTY) {
    if (app.hasClientActivities) {
        procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY_CLIENT;
        app.adjType = "cch-client-act";
    } else if (app.treatLikeActivity) {
        procState = ActivityManager.PROCESS_STATE_CACHED_ACTIVITY;
        app.adjType = "cch-as-act";
    }
}
```

当该进程Service的客户端进程存在Activity或者是treatLikeActivity的进程，其进程状态都是cached进程。

## 三、查看进程优先级

### 3.1 CPU调度优先级

bindService或者startService是否前台调用取决于caller进程的调度组。当caller属于SCHED_GROUP_BACKGROUND则认为是后台调用，当不属于SCHED_GROUP_BACKGROUND则认为是前台调用。callerFg = callerApp.setSchedGroup != ProcessList.SCHED_GROUP_BACKGROUND;

关于CPU调度组：

|调度级别|进程组|备注|
|---|---|
|SCHED_GROUP_BACKGROUND(0) |THREAD_GROUP_BG_NONINTERACTIVE|后台进程组|
|SCHED_GROUP_DEFAULT(1) |THREAD_GROUP_DEFAULT|前台进程组|
|SCHED_GROUP_TOP_APP(2) |THREAD_GROUP_TOP_APP|TOP进程组|
|SCHED_GROUP_TOP_APP_BOUND(3) |THREAD_GROUP_TOP_APP|TOP进程组|


#### THREAD_GROUP_TOP_APP

- SCHED_GROUP_TOP_APP：
  - setRenderThread()过程，根据属性sys.use_fifo_ui来决定采用SCHED_FIFO，或者设置当前线程的优先级为-10
  - TOP_APP或者app.hasTopUi，则设置为该值
  
- SCHED_GROUP_TOP_APP_BOUND：
  - 对于ConnectionRecord带有BIND_ADJUST_WITH_ACTIVITY和BIND_IMPORTANT，并且没带有BIND_NOT_FOREGROUND的情况下，
当客户端进程的有可见的Activity，或者处于RESUMED/PAUSING状态时，则设置为该值

当进程调度级别由非TOP切换到TOP级别，则主线程和rendThread可设置为SCHED_FIFO或者更高优先级；当由TOP级别切换回非TOP级别，则恢复原来的调度策略或优先级。
  
#### THREAD_GROUP_DEFAULT

- SCHED_GROUP_DEFAULT：
  - 默认值
  - ADJ <= FOREGROUND_APP_ADJ；
  - 正在接收来自于mFgBroadcastQueue广播队列的广播；
  - 正在执行来自于前台调度进程发起的服务(execServicesFg=true)
  - Activity处于可见状态(visible=true)
  - 具有fg-service或者设置forcingToImportant的服务
  - 正在显示一个overlay UI(app.hasOverlayUi=true)
  - 当ConnectionRecord同时没有指定BIND_NOT_FOREGROUND和BIND_IMPORTANT_BACKGROUND、BIND_IMPORTANT情况下，
当客户端进程的schedGroup高于服务进程，则设置为该值
  - 对于ConnectionRecord带有BIND_ADJUST_WITH_ACTIVITY，并且没带有BIND_NOT_FOREGROUND和BIND_IMPORTANT的情况下，
当客户端进程的有可见的Activity，或者处于RESUMED/PAUSING状态时，则设置为该值
  - 当ContentProviderConnection所对应的客户端进程的schedGroup高于服务进程，则设置为该值
  - 当cpr.hasExternalProcessHandles为true的情况
  - 最后，当maxAdj <= PERCEPTIBLE_APP_ADJ的情况

#### THREAD_GROUP_BG_NONINTERACTIVE

- SCHED_GROUP_BACKGROUND: 
  - 应用已结束(app.thread == null) 
  - 正在接收来自于mBgBroadcastQueue广播队列的广播；
  - 正在执行来自于前台调度进程发起的服务(execServicesFg=false)
  - TOP_APP，且设备处于睡眠状态
  - 等等


## 四、总结

Android进程优先级ADJ的每一个ADJ级别往往都有多种场景，使用adjType完美地区分相同ADJ下的不同场景；
不同ADJ进程所对应的schedGroup不同，从而分配的CPU资源也不同，schedGroup大体分为TOP(T)、前台(F)、后台(B)；
ADJ跟AMS中的procState有着紧密的联系。

- adj：通过调整oom_score_adj来影响进程寿命(Lowmemorykiller杀进程策略)；
- schedGroup：影响进程的CPU资源调度与分配；
- procState：从进程所包含的四大组件运行状态来评估进程状态，影响framework的内存控制策略。比如控制缓存进程和空进程个数上限依赖于procState，再比如控制APP执行handleLowMemory()的触发时机等。

为了说明整体关系，以ADJ为中心来讲解跟adjType,schedGroup,procState的对应关系，下面以一幅图来诠释整个ADJ算法的精髓，几乎涵盖了ADJ算法调整的绝大多数场景。

![adj_summary](/images/damo-adj/adj-summary.jpg)



**CPU调度组：**

|调度级别|缩写|解释|
|---|---|
|SCHED_GROUP_BACKGROUND(0) |B|后台进程组|
|SCHED_GROUP_DEFAULT(1) |F|前台进程组|
|SCHED_GROUP_TOP_APP(2) |T|TOP进程组|
|SCHED_GROUP_TOP_APP_BOUND(3) |T|TOP进程组|

1. 常说的前台进程与后台进程，其实是从CPU调度角度来划分的前台与后台；为了让用户正在使用的TOP进程能分配到更多的CPU资源，从Android 6.0开始新增了TOP进程组，CPU调度优先分配给当前正在跟用户交互的APP，提升用户体验。
2. 上图adjType="broadcast"的CPU调度组的选择取决于广播队列，当receiver接收到的广播来自于前台广播队列则采用前台进程组，当receiver接收到的广播来自于后台广播队列则采用后台进程组。前后台广播队列的CPU资源调度优先级不同，所以前台广播超时10秒就会ANR，而后台广播超时60秒才会ANR。更少的CPU资源分配就需要更长的时间来完成执行，这也就是为何两个广播队列定义了不同的超时阈值。
3. 上图adjType="exec-service"的CPU调度组的选择取决于caller, 当发起bindService或者startService的调用者caller属于后台进程组，callerFg=false，则Service的生命周期回调运行在后台进程组，非常很少的CPU资源；当caller属于前台或者TOP进程组，则Service的生命周期回调运行在前台进程组，分配较多的CPU资源。
4. 上图adjType="service"也有机会选择TOP组, 前提条件是在bindService的时候带有BIND_IMPORTANT的flags，用于标记该服务对于客户端进程很重要。


最后，给广大应用开发者一些友好的建议：

1. UI进程与Service进程一定要分离，因为对于包含activity的service进程，一旦进入后台就成为"cch-started-ui-services"类型的cache进程(ADJ>=900)，随时可能会被系统回收；而分离后的Service进程服务属于SERVICE_ADJ(500)，被杀的可能性相对较小。尤其是系统允许自启动的服务进程必须做UI分离，避免消耗系统较大内存。
2. 只有真正需要用户可感知的应用，才调用startForegroundService()方法来启动前台服务，此时ADJ=PERCEPTIBLE_APP_ADJ(200)，常驻内存，并且会在通知栏常驻通知提醒用户，比如音乐播放，地图导航。切勿为了常驻而滥用前台服务，这会严重影响用户体验。
3. 进程中的Service工作完成后，务必主动调用stopService或stopSelf来停止服务，避免占据内存，浪费系统资源；
4. 不要长时间绑定其他进程的service或者provider，每次使用完成后应立刻释放，避免其他进程常驻于内存；
5. APP应该实现接口onTrimMemory()和onLowMemory()，根据TrimLevel适当地将非必须内存在回调方法中加以释放。当系统内存紧张时会回调该接口，减少系统卡顿与杀进程频次。
6. 减少在保活上花心思，更应该在优化内存上下功夫，因为在相同ADJ级别的情况下，系统会选择优先杀内存占用的进程。
