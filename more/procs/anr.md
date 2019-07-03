
## 可疑点

1. cpu block, cpu load过重
2. iowait
    100%TOTAL: 6.9% user + 8.2% kernel + 84%iowait

3. 内存 泄露，内存不足， 内存碎片

    at dalvik.system.VMRuntime.trackExternalAllocation(NativeMethod)内存不足导致block在创建bitmap上

4. 硬件损坏或接触不良

### 八：Thread状态

    ThreadState (defined at “dalvik/vm/thread.h “)
    THREAD_UNDEFINED = -1, /* makes enum compatible with int32_t */
    THREAD_ZOMBIE = 0, /* TERMINATED */
    THREAD_RUNNING = 1, /* RUNNABLE or running now */
    THREAD_TIMED_WAIT = 2, /* TIMED_WAITING in Object.wait() */
    THREAD_MONITOR = 3, /* BLOCKED on a monitor */
    THREAD_WAIT = 4, /* WAITING in Object.wait() */
    THREAD_INITIALIZING= 5, /* allocated, not yet running */
    THREAD_STARTING = 6, /* started, not yet on thread list */
    THREAD_NATIVE = 7, /* off in a JNI native method */
    THREAD_VMWAIT = 8, /* waiting on a VM resource */
    THREAD_SUSPENDED = 9, /* suspended, usually by GC or debugger */

状态对比：

|Java|C++|解释|
|---|---|
|New||新建|
|RUNNABLE||可执行或正在执行|
|BLOCKED||阻塞|
|WAITING||等待|
|TIMED_WAITING||等待(带超时参数)|
|TERMINATED||终止|

TIMED_WAITING可以是wait、sleep或join

### cpu usage

    ActivityManager:  90% 24048/system_server: 25% user + 65% kernel / faults: 12992 minor 6 major

- major是指Major Page Fault（主要页错误，简称MPF），内核在读取数据时会先后查找CPU的高速缓存和物理内存，
如果找不到会发出一个MPF信息，请求将数据加载到内存。文件第一次加载时算在major
- Minor是指Minor Page Fault（次要页错误，简称MnPF），
磁盘数据被加载到内存后，内核再次读取时，会发出一个MnPF信息。文件从内存加载算在minor.
