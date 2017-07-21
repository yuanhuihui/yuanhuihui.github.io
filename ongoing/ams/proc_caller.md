Activity
  - launchedFromPackage


Broadcast
  - callerPackage
  - caller

Service
  - CI.startServiceCommon过程会把caller package传递过来

Provider
  - AMS.getContentProviderImpl()方法的参数 带有caller
  
## 一. 启动
### 1.1 AMS
[-> ActivityManagerService.java]

    public ActivityManagerService(Context systemContext) {
        ...
        //[见小节1.2]
        mProcessStats = new ProcessStatsService(this, new File(systemDir, "procstats"));
        ...
    }

文件目录为/data/system/procstats

#### env小技巧

    File DATA_DIRECTORY = getDirectory("ANDROID_DATA", "/data");  代表/data
    File dataDir = Environment.getDataDirectory();
    File systemDir = new File(dataDir, "system");  代表/data/system
    new File(systemDir, "procstats") 代表/data/system/procstats

此处用到了环境变量`ANDROID_DATA`, 那么如何查看该变量的值呢

有两个命令: `env`可查看当前系统所有的环境变量, `echo $变量名`可查看指定的变量名. 例如`echo $ANDROID_DATA`,那么输出结果就是`/data`

比较常见的路径:

    ANDROID_DATA=/data
    HOME=/data
    ANDROID_ROOT=/system
    SHELL=/system/bin/sh
    TMPDIR=/data/local/tmp
    ANDROID_ASSETS=/system/app


### 1.2 ProcessStatsService
[-> ProcessStatsService.java]

    public ProcessStatsService(ActivityManagerService am, File file) {
        mAm = am;
        mBaseDir = file;
        mBaseDir.mkdirs();

        mProcessStats = new ProcessStats(true);

        //彻底procstats目录下创建文件,格式为 state-yyyy-mm-dd-hh-mm-ss.bin
        updateFile();
        SystemProperties.addChangeCallback(new Runnable() {
            @Override public void run() {
                synchronized (mAm) {
                    if (mProcessStats.evaluateSystemProperties(false)) {
                        mProcessStats.mFlags |= ProcessStats.FLAG_SYSPROPS;
                        writeStateLocked(true, true);
                        mProcessStats.evaluateSystemProperties(true);
                    }
                }
            }
        });
    }

### 1.3  ProcessStats
[-> ProcessStats.java]

    public ProcessStats(boolean running) {
        mRunning = running;
        reset();
    }

reset主要工作是清空`mPackages`,`mProcesses`, `mLongs`,`mTimePeriodStartClock`等对象相关的变量


## 二.

### 2.1 进程启动

[-> ActivityManagerService.java]

    private final boolean attachApplicationLocked(IApplicationThread thread,
                int pid) {
        ...
        app.makeActive(thread, mProcessStats);
        ...
    }

    public void setSystemProcess() {
        ...
        //该过程会创建newProcessRecord对象.
        ProcessRecord app = newProcessRecordLocked(info, info.processName, false, 0);
        app.makeActive(mSystemThread.getApplicationThread(), mProcessStats);
        ...
    }

不论是普通app,还是系统app,顺序都是:

- 先创建ProcessRecord对象;
- 再调用app.makeActive

### 2.2 ProcessRecord


    ProcessRecord(BatteryStatsImpl _batteryStats, ApplicationInfo _info,
            String _processName, int _uid) {
        mBatteryStats = _batteryStats;
        info = _info;
        isolated = _info.uid != _uid;
        uid = _uid;
        userId = UserHandle.getUserId(_uid);
        processName = _processName;
        pkgList.put(_info.packageName, new ProcessStats.ProcessStateHolder(_info.versionCode));
        maxAdj = ProcessList.UNKNOWN_ADJ;
        curRawAdj = setRawAdj = -100;
        curAdj = setAdj = -100;
        persistent = false;
        removed = false;
        lastStateTime = lastPssTime = nextPssTime = SystemClock.uptimeMillis();
    }

### AMS.setProcessTrackerStateLocked

    private final void setProcessTrackerStateLocked(ProcessRecord proc, int memFactor, long now) {
        if (proc.thread != null) {
            if (proc.baseProcessTracker != null) {
                proc.baseProcessTracker.setState(proc.repProcState, memFactor, now, proc.pkgList);
            }
        }
    }


proc.baseProcessTracker的初始化是在ProcessRecord.java

### 2.3 PR.makeActive
[-> ProcessRecord.java]

    public void makeActive(IApplicationThread _thread, ProcessStatsService tracker) {

        if (thread == null) {
            final ProcessStats.ProcessState origBase = baseProcessTracker;
            if (origBase != null) {
                origBase.setState(ProcessStats.STATE_NOTHING,
                        tracker.getMemFactorLocked(), SystemClock.uptimeMillis(), pkgList);
                origBase.makeInactive();
            }
            baseProcessTracker = tracker.getProcessStateLocked(info.packageName, uid,
                    info.versionCode, processName);
            baseProcessTracker.makeActive();
            for (int i=0; i<pkgList.size(); i++) {
                ProcessStats.ProcessStateHolder holder = pkgList.valueAt(i);
                if (holder.state != null && holder.state != origBase) {
                    holder.state.makeInactive();
                }
                holder.state = tracker.getProcessStateLocked(pkgList.keyAt(i), uid,
                        info.versionCode, processName);
                if (holder.state != baseProcessTracker) {
                    holder.state.makeActive();
                }
            }
        }
        thread = _thread;
    }
