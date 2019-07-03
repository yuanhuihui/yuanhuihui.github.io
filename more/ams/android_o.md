
【进程调度优化】：
【异常增强机制】

1) 提升PREVIOUS_APP_ADJ优先级，
2) 优化cache进程的优先级，增加app.mLastVisibleTime, 结合r.lastVisibleTime(在其赋值过程，同步赋值app), 根据进程的lastVisibleTime来调整其优先级。根据距离当前的时间 来调整其adj。  
==》 可提升用户体验， 比如1min之内，app可保持一定的数量。[700,800）之间。同时调整provider adj，不可长时间处于pervious。
改善冷启比
3）lmk阈值的调整？
4）dumpProcessOomList过程加上 initialIdlePss的dump输出， 并放入异常检测机制里面；关于run cpu over +3m1s586ms used 0 (0%)，可以考虑加上所有的进程。 内存泄漏
5）EventLog.writeEvent(EventLogTags.AM_LOW_MEMORY, mLruProcesses.size()); 是指没有ProcState>=PROCESS_STATE_CACHED_ACTIVITY的进程，并非真正的低内存。最终会触发ActivityThread执行handleLowMemory()释放内存，主要是执行app的低内存回调方法以及回收SQLite、canvas，强制GC。
6) ADJ内存因子：决定允许后台运行Jobs的最大上限，以及触发handleTrimMemory(), 决定TrimMemory的级别(包括WMS的ThreadedRenderer的回收级别)，再进一步来看看内存因子：
7) Persistent进程不一定需要放到默认进程组里面：（很多时候persistent只是为了提升优先级）
           if (app.maxAdj <= ProcessList.PERCEPTIBLE_APP_ADJ) {
                schedGroup = ProcessList.SCHED_GROUP_DEFAULT;
            }
8） force-imp进程的限制
