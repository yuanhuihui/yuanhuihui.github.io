

## 一. Service Timeout

### 1.1 ANR时间点

bumpServiceExecutingLocked

时间点:

create
start
bind
unbind
destroy

### 1.2 前后台

AS.bindServiceLocked或许bindServiceLocked:

    callerFg = callerApp.setSchedGroup != Process.THREAD_GROUP_BG_NONINTERACTIVE;
    
## 二. broadcast

## 2.1

BR.setBroadcastTimeoutLocked

## 2.2 前后台

AMS.registerReceiver的过程, 根据intent来决定加入哪个Queue.

isFg = (intent.getFlags() & Intent.FLAG_RECEIVER_FOREGROUND) != 0;

根据schedGroup = (queue == mFgBroadcastQueue)  ? Process.THREAD_GROUP_DEFAULT : Process.THREAD_GROUP_BG_NONINTERACTIVE; 来决定调度组


mFgBroadcastQueue = new BroadcastQueue(this, mHandler,
        "foreground", BROADCAST_FG_TIMEOUT, false);
        
mBgBroadcastQueue = new BroadcastQueue(this, mHandler,
        "background", BROADCAST_BG_TIMEOUT, true);
        
### 2.3

enqueueClockTime:  enqueueOrderedBroadcastLocked加入队列
dispatchTime: 开始分发
receiverTime
finishTime: 整个广播完成


//TODO: 下一步完善broadcast的流程图问题