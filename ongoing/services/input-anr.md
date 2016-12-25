


## 三. InputDispatcher线程 
[-> InputDispatcher.cpp]


    InputDispatcherThread::threadLoop
    dispatchOnce
    dispatchOnceInnerLocked
    dispatchKeyLocked
    findFocusedWindowTargetsLocked  / 另一个case便会进程findTouchedWindowTargetsLocked()
    handleTargetsNotReadyLocked


在InputDispatcher::updateDispatchStatisticsLocked() 可以做点什么呢?

InputDispatcher.injectInputEvent,

## 其他

Linux Kernel -> IMS(InputReader -> InputDispatcher) -> WMS -> ViewRootImpl

### 命令

    getevent
    sendevent


好文: 
http://blog.csdn.net/laisse/article/details/47259485
http://blog.csdn.net/u012719256/article/details/52945534
