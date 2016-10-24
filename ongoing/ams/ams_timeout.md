

### Timeout表

//AMS.java
APP_SWITCH_DELAY_TIME = 5*1000;
PROC_START_TIMEOUT = 10*1000;
CONTENT_PROVIDER_PUBLISH_TIMEOUT = 10*1000;
GC_TIMEOUT = 5*1000;
BROADCAST_FG_TIMEOUT = 10*1000;
BROADCAST_BG_TIMEOUT = 60*1000;
KEY_DISPATCHING_TIMEOUT = 5*1000;
USER_SWITCH_TIMEOUT = 2*1000;

//AS.java
PAUSE_TIMEOUT = 500;
STOP_TIMEOUT = 10*1000;
DESTROY_TIMEOUT = 10*1000;

//ASS.java
IDLE_TIMEOUT = 10 * 1000;
SLEEP_TIMEOUT = 5 * 1000;
LAUNCH_TIMEOUT = 10 * 1000;


### 主要成员变量

AMS.java
BroadcastQueue mFgBroadcastQueue;
BroadcastQueue mBgBroadcastQueue;
ProcessMap<ProcessRecord> mProcessNames
SparseArray<ProcessRecord> mPidsSelfLocked;


mProcessNames    以procName为key，记录着所有的ProcessRecord信息. 该对象是由AMS锁保护
mPidsSelfLocked  以pid为key，记录着所有的ProcessRecord信息。该对象的同步保护是通过自身锁，而非全局AMS保护
