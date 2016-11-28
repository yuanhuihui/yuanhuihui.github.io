---
layout: post
title:  "stackTraces"
date:   2016-6-22 22:19:53
catalog:    true
tags:
    - android
    - debug
    - stability

---

### 1. AMS.appNotResponding

final void appNotResponding(ProcessRecord app, ActivityRecord activity,
        ActivityRecord parent, boolean aboveSystem, final String annotation) {
    ...
    synchronized (this) {
      firstPids.add(app.pid);
      int parentPid = app.pid;
      ...
      //添加system_server的pid
      if (MY_PID != app.pid && MY_PID != parentPid) firstPids.add(MY_PID);
      for (int i = mLruProcesses.size() - 1; i >= 0; i--) {
          ProcessRecord r = mLruProcesses.get(i);
          if (r != null && r.thread != null) {
              int pid = r.pid;
              if (pid > 0 && pid != app.pid && pid != parentPid && pid != MY_PID) {
                  if (r.persistent) {
                      firstPids.add(pid); //将persistent进程添加到firstPids
                  } else {
                      lastPids.put(pid, Boolean.TRUE); //其他进程添加到lastPids
                  }
              }
          }
      }
        
    }
    final ProcessCpuTracker processCpuTracker = new ProcessCpuTracker(true);
    //【见小节】
    File tracesFile = dumpStackTraces(true, firstPids, processCpuTracker, lastPids,
            NATIVE_STACKS_OF_INTEREST);
}

- firstPids：第一个是发生ANR进程，第二个是system_server，之后全是persistent进程；
- lastPids: mLruProcesses中的进程，且不属于firstPids的进程
- NATIVE_STACKS_OF_INTEREST：是指/system/bin/目录下的mediaserver,sdcard,surfaceflinger这3个native进程。

### 2. AMS.dumpStackTraces

    public static File dumpStackTraces(boolean clearTraces, ArrayList<Integer> firstPids,
            ProcessCpuTracker processCpuTracker, SparseArray<Boolean> lastPids, String[] nativeProcs) {
        //默认为 data/anr/traces.txt
        String tracesPath = SystemProperties.get("dalvik.vm.stack-trace-file", null);
        if (tracesPath == null || tracesPath.length() == 0) {
            return null;
        }

        File tracesFile = new File(tracesPath);
        try {
            //当clearTraces，则删除已存在的traces文件
            if (clearTraces && tracesFile.exists()) tracesFile.delete();
            //创建traces文件
            tracesFile.createNewFile();
            FileUtils.setPermissions(tracesFile.getPath(), 0666, -1, -1);
        } catch (IOException e) {
            return null;
        }
        //输出trace内容
        dumpStackTraces(tracesPath, firstPids, processCpuTracker, lastPids, nativeProcs);
        return tracesFile;
    }

### 3. AMS.dumpStackTraces

    private static void dumpStackTraces(String tracesPath, ArrayList<Integer> firstPids,
            ProcessCpuTracker processCpuTracker, SparseArray<Boolean> lastPids, String[] nativeProcs) {
        FileObserver observer = new FileObserver(tracesPath, FileObserver.CLOSE_WRITE) {
            @Override
            public synchronized void onEvent(int event, String path) { notify(); }
        };

        try {
            observer.startWatching();

            //首先，获取最重要进程的stacks
            if (firstPids != null) {
                try {
                    int num = firstPids.size();
                    for (int i = 0; i < num; i++) {
                        synchronized (observer) {
                            //【见小节4】
                            Process.sendSignal(firstPids.get(i), Process.SIGNAL_QUIT);
                            observer.wait(200);  //等待直到写关闭，或者200ms超时
                        }
                    }
                } catch (InterruptedException e) {
                    Slog.wtf(TAG, e);
                }
            }

            //下一步，获取native进程的stacks
            if (nativeProcs != null) {
                int[] pids = Process.getPidsForCommands(nativeProcs);
                if (pids != null) {
                    for (int pid : pids) {
                        //【见小节】
                        Debug.dumpNativeBacktraceToFile(pid, tracesPath);
                    }
                }
            }

            //测量CPU使用情况
            if (processCpuTracker != null) {
                processCpuTracker.init();
                System.gc();
                processCpuTracker.update();
                try {
                    synchronized (processCpuTracker) {
                        processCpuTracker.wait(500); // measure over 1/2 second.
                    }
                } catch (InterruptedException e) {
                }
                processCpuTracker.update();

                //从lastPids中选取CPU使用率 top 5的进程，输出这些进程的stacks
                final int N = processCpuTracker.countWorkingStats();
                int numProcs = 0;
                for (int i=0; i<N && numProcs<5; i++) {
                    ProcessCpuTracker.Stats stats = processCpuTracker.getWorkingStats(i);
                    if (lastPids.indexOfKey(stats.pid) >= 0) {
                        numProcs++;
                        try {
                            synchronized (observer) {
                                Process.sendSignal(stats.pid, Process.SIGNAL_QUIT);
                                observer.wait(200); 
                            }
                        } catch (InterruptedException e) {
                            Slog.wtf(TAG, e);
                        }

                    }
                }
            }
        } finally {
            observer.stopWatching();
        }
    }
    
该方法的主要功能，依次输出：

1. 收集firstPids进程的stacks；
  - 第一个是发生ANR进程；
  - 第二个是system_server；
  - mLruProcesses中所有的persistent进程；
2. 收集Native进程的stacks；
  - 依次是mediaserver,sdcard,surfaceflinger进程；
3. 收集CPU使用率top 5的进程。

总共进程 2(self + system_server) + x(persistent) + 3(native) +5(top 5)

- 提高性能的方法之一：setprop dalvik.vm.stack-trace-file ""
- 提高trace效率， 增加白名单，有些进程并不放入firstPids ?? 可行乎





## dumpKernelStackTraces
