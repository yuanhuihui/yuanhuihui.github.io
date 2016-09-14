## 意义

Android的设计理念, 应用程序退出,但进程还会继续存在系统中,以便再次启动时提高响应时间.
但这就会遇到一个问题, 随着应用打开数量的增多,系统中越来越多的进程, 就很有可能导致系统内存不足, 这时需要一个能否整理进程,释放内存空间的机制.
Android的lmkd便是干这件事, 由lmkd来决定什么时间, 杀掉什么进程.

### 参数

在OOM的参数oom_adj，oom_score_adj，oom_score

- oom_adj:代表进程的优先级, 数值越大,优先级越低,越容易被杀. 取值范围[-16, 15]
- oom_score_adj: 取值范围[-1000, 1000]
- oom_score

相应节点:

    /proc/<pid>/oom_adj
    /proc/<pid>/oom_score_adj
    /proc/<pid>/oom_score

- 当oom_adj= 15, 则oom_score_adj=1000;
- 否则, oom_score_adj= oom_adj * 1000/17;

### 阈值

    /sys/module/lowmemorykiller/parameters/minfree
    /sys/module/lowmemorykiller/parameters/adj

### 策略

触发oom时,会触发kernel panic 或者 杀掉一个目标进程.

当触发lmkd,则先杀oom_adj最大的进程, 当oom_adj相等时,则选择oom_score_adj最大的进程.


### lmk 与 oom 对比





151static int lowmem_oom_adj_to_oom_score_adj(int oom_adj)
152{
153    if (oom_adj == OOM_ADJUST_MAX)
154        return OOM_SCORE_ADJ_MAX;
155    else
156        return (oom_adj * OOM_SCORE_ADJ_MAX) / -OOM_DISABLE;
157}
158
