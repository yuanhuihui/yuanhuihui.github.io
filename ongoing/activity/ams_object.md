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

#### Service
ActiveServices.java
- mPendingServices
- mRestartingServices

#### Broadcast  force-stop需要提交 skipCurrentReceiverLocked
BroadcastQueue.java
- mFgBroadcastQueue.mPendingBroadcast 
- mBgBroadcastQueue.mPendingBroadcast

#### Provider
AMS.java
- mLaunchingProviders

#### Process force-stop需要提交
AMS.java
- mProcessesOnHold
- mPersistentStartingProcesses


#### 5. AMS

HashMap<PendingIntentRecord.Key, WeakReference<PendingIntentRecord>> mIntentSenderRecords,这个也要清除才对
ArrayList<ProcessChangeItem> mPendingProcessChanges


#### 6. pending系列

activity: ASS.mPendingActivityLaunches
service:  ActiveServices.mPendingServices
Broadcast:  BroadcastQueue.mPendingBroadcast
provider: ??

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

#### AS.topRunningActivityLocked
[-> ActivityStack.java]

    final ActivityRecord topRunningActivityLocked(ActivityRecord notTop) {
        for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
            ActivityRecord r = mTaskHistory.get(taskNdx).topRunningActivityLocked(notTop);
            if (r != null) {
                return r;
            }
        }
        return null;
    }

### TaskRecord.topRunningActivityLocked
[-> TaskRecord.java]

    ActivityRecord topRunningActivityLocked(ActivityRecord notTop) {
        if (stack != null) {
            for (int activityNdx = mActivities.size() - 1; activityNdx >= 0; --activityNdx) {
                ActivityRecord r = mActivities.get(activityNdx);
                if (!r.finishing && r != notTop && stack.okToShowLocked(r)) {
                    return r;
                }
            }
        }
        return null;
    }

获取栈顶第一个不是finishing状态, 且不等于notTop, 并且运行在当前userId下展示的ActivityRecord.

### AS.okToShowLocked

    boolean okToShowLocked(ActivityRecord r) {
        //当前用户id属于当前配置, 或者ActivityRecord允许所有用户展示
        return mStackSupervisor.isCurrentProfileLocked(r.userId)
                || (r.info.flags & FLAG_SHOW_FOR_ALL_USERS) != 0;
    }
