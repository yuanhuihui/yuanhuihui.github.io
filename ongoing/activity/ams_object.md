- ActivityInfo: 从xml解析出来的信息
- ActivityRecord: 记录着Activity信息
- TaskRecord: 记录着task信息
- ActivityStack: 栈信息


### 一 基本对象
#### 1. ActivityRecord
- Activity的信息记录在ActivityRecord对象, 并通过通过成员变量task指向TaskRecord

ProcessRecord app //跑在哪个进程
TaskRecord task  //跑在哪个task
ActivityInfo info // Activity信息
ActivityState state //Activity状态
ApplicationInfo appInfo //跑在哪个app
ComponentName realActivity //组件名
String packageName //包名
String processName //进程名
int launchMode //启动模式
int userId // 该Activity运行在哪个用户id

#### 2. TaskRecord

- Task的信息记录在TaskRecord对象.

ActivityStack stack; //当前所属的stack
ArrayList<ActivityRecord> mActivities; // 当前task的所有Activity列表
int taskId
String affinity
int mCallingUid;
String mCallingPackage;


#### 3. ActivityStack

ArrayList<TaskRecord> mTaskHistory  //保存所有的Task列表
ArrayList<ActivityStack> mStacks; //所有stack列表
final int mStackId;
int mDisplayId;

ActivityRecord mPausingActivity //正在pause
ActivityRecord mLastPausedActivity
ActivityRecord mResumedActivity  //已经resumed
ActivityRecord mLastStartedActivity

ActivityContainer mActivityContainer
boolean mConfigWillChange


所有前台stack的mResumedActivity的state == RESUMED, 则表示allResumedActivitiesComplete, 此时 mLastFocusedStack = mFocusedStack;

#### 4. ActivityStackSupervisor

int mLastStackId
int mCurTaskId
int mCurrentUser
ActivityStack mHomeStack //桌面的stack
ActivityStack mFocusedStack //当前聚焦stack
ActivityStack mLastFocusedStack //正在切换

SparseArray<ActivityDisplay> mActivityDisplays  //displayId为key
SparseArray<ActivityContainer> mActivityContainers // mStackId为key

### 5. pendings


#### Activity  当binderDied 需要提交

ASS.java
- mPendingActivityLaunches

#### Service  ok
ActiveServices.java
- mPendingServices
- mRestartingServices

#### Broadcast  force-stop需要提交 skipCurrentReceiverLocked
BroadcastQueue.java
- mFgBroadcastQueue.mPendingBroadcast
- mBgBroadcastQueue.mPendingBroadcast

#### Provider ok
AMS.java
- mLaunchingProviders


#### Process force-stop需要提交
AMS.java
- mProcessesOnHold
- mPersistentStartingProcesses


#### 5. AMS

HashMap<PendingIntentRecord.Key, WeakReference<PendingIntentRecord>> mIntentSenderRecords,这个也要清除才对
ArrayList<ProcessChangeItem> mPendingProcessChanges

mProcessNames

#### 关系链表

正向: ActivityStack.mTaskHistory -> TaskRecord.mActivities -> ActivityRecord
反向: ActivityRecord.task -> TaskRecord.stack -> ActivityStack


ActivityRecord -> Task -> ActivityStack -> ActivityDisplay -> mActivityDisplays

### 继承关系

PackageItemInfo
    ApplicationInfo
    InstrumentationInfo
    ComponentInfo
        ActivityInfo
        ServiceInfo
        ProviderInfo
    PermissionInfo
    PermissionGroupInfo

in ActivityRecord.java

Token 继承于 IApplicationToken.Stub


ActivityRecord -> Task -> ActivityStack -> ActivityDisplay -> mActivityDisplays


正向: ActivityStack.mTaskHistory -> TaskRecord.mActivities -> ActivityRecord
反向: ActivityRecord.task -> TaskRecord.stack -> ActivityStack

mActivityDisplays.valueAt(displayNdx).mStacks

### 二. 常见逻辑


AMS.isPendingBroadcastProcessLocked


AS.addTask: 启动Activity的过程,


AS.removeTask:


- "activityDestroyed"
- "destroyTimeout"
- "exceptionInScheduleDestroy"
- "appDied"    
- "setTask"
- "moveTaskToStack"


锁屏下来电时只显示绿条
