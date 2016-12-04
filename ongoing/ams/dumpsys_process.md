### Process

### 1. All known processes

    ACTIVITY MANAGER RUNNING PROCESSES (dumpsys activity processes)
      All known processes:
      *APP* UID 10005 ProcessRecord{f07f66a 22469:com.miui.yellowpage/u0a5}
        user #0 uid=10005 gids={50005, 9997, 3002, 3003, 3001}
        requiredAbi=armeabi-v7a instructionSet=arm
        class=com.miui.yellowpage.Application
        dir=/system/priv-app/YellowPage/YellowPage.apk publicDir=/system/priv-app/YellowPage/YellowPage.apk data=/data/user/0/com.miui.yellowpage
        packageList={com.miui.yellowpage}
        //依赖的应用包名
        packageDependencies={com.google.android.webview}
        compat={480dpi}
        thread=android.app.ApplicationThreadProxy@f2490ef
        pid=22469 starting=false
        lastActivityTime=-1m16s416ms lastPssTime=-39s649ms nextPssTime=+29m20s305ms
        //lastPss上次计算内存pss；lastCachedPss上次处于cache态的pss
        adjSeq=93645 lruSeq=0 lastPss=13MB lastCachedPss=13MB
        //缓存进程，后台空进程
        cached=true empty=true
        // adj最大值=16，当前进程adj=11，上次设置adj=11
        oom: max=16 curRaw=11 setRaw=11 cur=11 set=11
        curSchedGroup=0 setSchedGroup=0 systemNoUi=false trimMemoryLevel=0
        curProcState=16 repProcState=16 pssProcState=16 setProcState=16 lastStateTime=-1m14s302ms
        lastWakeTime=0 timeUsed=0
        lastCpuTime=0 timeUsed=0
        lastRequestedGc=-17m54s302ms lastLowMemory=-17m54s302ms reportLowMemory=false
        Published Providers:
          - com.miui.yellowpage.providers.telocation.TelocationProvider
            -> ContentProviderRecord{8692c55 u0 com.miui.yellowpage/.providers.telocation.TelocationProvider}
        Connected Providers:
          -bb8ad9f/com.android.providers.settings/.SettingsProvider->22469:com.miui.yellowpage/u0a5 s1/1 u0/0 +17m54s53ms
        Receivers:
          - ReceiverList{6b244e 22469 com.miui.yellowpage/10005/u0 remote:16e9349}
          - ReceiverList{8757b2 22469 com.miui.yellowpage/10005/u0 remote:affa5bd}

### 2. UID states

    UID states:
       //含义：  userId: UidRecord{hashcode userId 进程状态  / 进程个数 procs}
       UID 1000: UidRecord{44b2d71 1000 P  / 17 procs}
       UID 1001: UidRecord{240f756 1001 P  / 5 procs}
       UID u0a9: UidRecord{7d8685c u0a9 IF / 1 procs}
       UID u0a83: UidRecord{f1b33d5 u0a83 IB / 2 procs}

### 3. Process LRU list

    // LRU进程数 64，非Acvitity进程数9，非service进程数9
    Process LRU list (sorted by oom_adj, 64 total, non-act at 9, non-svc at 9):
      //普通进程 #13 CACHED_APP_MIN_ADJ+2 后台线程组/ /cache_empty进程 trim级别：0  
      Proc #13: cch+2 B/ /CE trm: 0 22469:com.miui.yellowpage/u0a5 (cch-empty)

    PID mappings:
      PID #22469: ProcessRecord{f07f66a 22469:com.miui.yellowpage/u0a5}
    mPreviousProcessVisibleTime: +1d3h20m17s295ms
    mConfigWillChange: false
