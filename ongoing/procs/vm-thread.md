
## 四. 线程状态

### 4.1 虚拟机角度

[-> art/runtime/thread.h]

状态表:

    kStarting,                        // NEW            TS_WAIT      native thread started, not yet ready to run managed code
    kTerminated,                      // TERMINATED     TS_ZOMBIE    Thread.run has returned, but Thread* still around
    kRunnable,                        // RUNNABLE       TS_RUNNING   runnable
    kNative,                          // RUNNABLE       TS_RUNNING   running in a JNI native method
    kSuspended,                       // RUNNABLE       TS_RUNNING   suspended by GC or debugger

    kBlocked,                         // BLOCKED        TS_MONITOR   blocked on a monitor
    kSleeping,                        // TIMED_WAITING  TS_SLEEPING  in Thread.sleep()
    kTimedWaiting,                    // TIMED_WAITING  TS_WAIT      in Object.wait() with a timeout
    kWaiting,                         // WAITING        TS_WAIT      in Object.wait()

    kWaitingForGcToComplete,          // WAITING        TS_WAIT      blocked waiting for GC
    kWaitingForCheckPointsToRun,      // WAITING        TS_WAIT      GC waiting for checkpoints to run
    kWaitingPerformingGc,             // WAITING        TS_WAIT      performing GC
    kWaitingForDebuggerSend,          // WAITING        TS_WAIT      blocked waiting for events to be sent
    kWaitingForDebuggerToAttach,      // WAITING        TS_WAIT      blocked waiting for debugger to attach
    kWaitingInMainDebuggerLoop,       // WAITING        TS_WAIT      blocking/reading/processing debugger events
    kWaitingForDebuggerSuspension,    // WAITING        TS_WAIT      waiting for debugger suspend all
    kWaitingForJniOnLoad,             // WAITING        TS_WAIT      waiting for execution of dlopen and JNI on load code
    kWaitingForSignalCatcherOutput,   // WAITING        TS_WAIT      waiting for signal catcher IO to complete
    kWaitingInMainSignalCatcherLoop,  // WAITING        TS_WAIT      blocking/reading/processing signals
    kWaitingForDeoptimization,        // WAITING        TS_WAIT      waiting for deoptimization suspend all
    kWaitingForMethodTracingStart,    // WAITING        TS_WAIT      waiting for method tracing to start
    kWaitingForVisitObjects,          // WAITING        TS_WAIT      waiting for visiting objects
    kWaitingForGetObjectsAllocated,   // WAITING        TS_WAIT      waiting for getting the number of allocated objects


### 4.2 内核角度

[-> kernel/include/linux/sched.h]

    #define TASK_RUNNING		0         //R
    #define TASK_INTERRUPTIBLE	1         //S
    #define TASK_UNINTERRUPTIBLE	2     //D
    #define __TASK_STOPPED		4         //T
    #define __TASK_TRACED		8         //T
    #define EXIT_ZOMBIE		16            //Z
    #define EXIT_DEAD		32            //X

进程状态: R/S/D/T/Z/X

### 4.3 映射关系


R: Runnable
S: TimedWaiting, Native, Waiting, Blocked, Sleeping, not attached

TimedWaiting: Object.wait(timeout)
Waiting: Object.wait()
Sleeping:  Thread.sleep()
Blocked: 等待持有某个锁
