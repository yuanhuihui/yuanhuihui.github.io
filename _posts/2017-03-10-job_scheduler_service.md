---
layout: post
title:  "理解JobScheduler机制"
date:   2017-3-10 20:12:30
catalog:    true
tags:
    - android
        
---

## 一. 概述

JobScheduler主要用于在未来某个时间下满足一定条件时触发执行某项任务的情况，那么可以创建一个
JobService的子类，重写其onStartJob()方法来实现这个功能。

JobScheduler的schedule过程：

     JobScheduler scheduler = (JobScheduler) getSystemService(Context.JOB_SCHEDULER_SERVICE);  
     ComponentName jobService = new ComponentName(this, MyJobService.class); 
     
     JobInfo jobInfo = new JobInfo.Builder(123, jobService) //任务Id等于123
             .setMinimumLatency(5000)// 任务最少延迟时间  
             .setOverrideDeadline(60000)// 任务deadline，当到期没达到指定条件也会开始执行  
             .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)// 网络条件，默认值NETWORK_TYPE_NONE
             .setRequiresCharging(true)// 是否充电  
             .setRequiresDeviceIdle(false)// 设备是否空闲 
             .setPersisted(true) //设备重启后是否继续执行
             .setBackoffCriteria(3000，JobInfo.BACKOFF_POLICY_LINEAR) //设置退避/重试策略
             .build();  
     scheduler.schedule(jobInfo); 
     
JobScheduler的cancel过程：

     scheduler.cancel(123); //取消jobId=123的任务
     scheduler.cancelAll(); //取消当前uid下的所有任务
     
schedule过程说明：

1. 先获取JobScheduler调度器的代理对象，要理解这个过程，那么就需要先看看JobSchedulerService的启动过程；
2. 创建继承于JobService的对象，见小节3.2；
3. 创建JobInfo对象，采用builder模式；
4. 调用schedule()来调度任务，见小节3.3。

接下来，先来看看JobSchedulerService启动过程。

## 二. JobScheduler服务启动

### 2.1 startOtherServices
[-> SystemServer.java]

    private void startOtherServices() {
      ...
      mSystemServiceManager.startService(JobSchedulerService.class);
      ...
    }

该方法先初始化JSS，然后再调用其onStart()方法。

### 2.2 JobSchedulerService
[-> JobSchedulerService.java]

    JobSchedulerService {
        List<StateController> mControllers;
        final JobHandler mHandler;
        final JobSchedulerStub mJobSchedulerStub;
        final JobStore mJobs;
        ...
        
        public JobSchedulerService(Context context) {
            super(context);
            mControllers = new ArrayList<StateController>();
            mControllers.add(ConnectivityController.get(this));
            mControllers.add(TimeController.get(this));
            mControllers.add(IdleController.get(this));
            mControllers.add(BatteryController.get(this));
            mControllers.add(AppIdleController.get(this));
            
            //创建主线程的looper[见小节2.3]
            mHandler = new JobHandler(context.getMainLooper());
            //创建binder服务端[见小节2.4]
            mJobSchedulerStub = new JobSchedulerStub();
            //[见小节2.5]
            mJobs = JobStore.initAndGet(this);
        }

        public void onStart() {
            publishBinderService(Context.JOB_SCHEDULER_SERVICE, mJobSchedulerStub);
        }
    }

创建了5个不同的StateController，分别添加到mControllers。

|类型|说明|
|---|---|
|ConnectivityController|注册监听网络连接状态的广播|
|TimeController|注册监听job时间到期的广播|
|IdleController|注册监听屏幕亮/灭,dream进入/退出,状态改变的广播|
|BatteryController|注册监听电池是否充电,电量状态的广播|
|AppIdleController|监听app是否空闲|


![state_controller](/images/jobscheduler/state_controller.jpg)


接下来,以ConnectivityController为例,说一说相应Controller的创建过程, 其他Controller也基本类似.

#### 2.2.1 ConnectivityController
[-> ConnectivityController.java]

    public class ConnectivityController extends StateController implements
            ConnectivityManager.OnNetworkActiveListener {
            
        public static ConnectivityController get(JobSchedulerService jms) {
            synchronized (sCreationLock) {
                if (mSingleton == null) {
                    //单例模式
                    mSingleton = new ConnectivityController(jms, jms.getContext());
                }
                return mSingleton;
            }
        }
        
        private ConnectivityController(StateChangedListener stateChangedListener, Context context) {
            super(stateChangedListener, context);
            //注册监听网络连接状态的广播，且采用BackgroundThread线程
            IntentFilter intentFilter = new IntentFilter();
            intentFilter.addAction(ConnectivityManager.CONNECTIVITY_ACTION);
            mContext.registerReceiverAsUser(
                    mConnectivityChangedReceiver, UserHandle.ALL, intentFilter, null,
                    BackgroundThread.getHandler());
            ConnectivityService cs =
                    (ConnectivityService)ServiceManager.getService(Context.CONNECTIVITY_SERVICE);
            if (cs != null) {
                if (cs.getActiveNetworkInfo() != null) {
                    mNetworkConnected = cs.getActiveNetworkInfo().isConnected();
                }
                mNetworkUnmetered = mNetworkConnected && !cs.isActiveNetworkMetered();
            }
        }
    }

当监听到CONNECTIVITY_ACTION广播，onReceive方法的执行位于“android.bg”线程。

### 2.3 JSS.JobHandler
[-> JobSchedulerService.java  ::JobHandler]

    public class JobSchedulerService extends com.android.server.SystemService
        implements StateChangedListener, JobCompletedListener {
        private class JobHandler extends Handler {

        public JobHandler(Looper looper) {
            super(looper);
        }

        public void handleMessage(Message message) {
            synchronized (mJobs) {
                //当系统启动到phase 600，则mReadyToRock=true.
                if (!mReadyToRock) {
                    return;
                }
            }
            switch (message.what) {
                case MSG_JOB_EXPIRED: ...
                case MSG_CHECK_JOB: ...
            }
            maybeRunPendingJobsH();
            removeMessages(MSG_CHECK_JOB);
        }

JobHandler采用的是system_server进程的主线程Looper，也就是该过程运行在主线程。

### 2.4 JobSchedulerStub
[-> JobSchedulerService.java  ::JobSchedulerStub]

    final class JobSchedulerStub extends IJobScheduler.Stub {
        ...
    }

JobSchedulerStub作为实现接口IJobScheduler的binder服务端。

### 2.5 JS.initAndGet
[-> JobStore.java]

    static JobStore initAndGet(JobSchedulerService jobManagerService) {
        synchronized (sSingletonLock) {
            if (sSingleton == null) {
                //[见小节2.6]
                sSingleton = new JobStore(jobManagerService.getContext(),
                        Environment.getDataDirectory());
            }
            return sSingleton;
        }
    }

### 2.6 创建JobStore
[-> JobStore.java]

    public class JobStore {
        final ArraySet<JobStatus> mJobSet;
        private final Handler mIoHandler = IoThread.getHandler();
        ...
        
        private JobStore(Context context, File dataDir) {
            mContext = context;
            mDirtyOperations = 0;

            File systemDir = new File(dataDir, "system");
            File jobDir = new File(systemDir, "job");
            jobDir.mkdirs();
            // 创建/data/system/job/jobs.xml
            mJobsFile = new AtomicFile(new File(jobDir, "jobs.xml"));
            mJobSet = new ArraySet<JobStatus>();
            //[见小节2.7.1]
            readJobMapFromDisk(mJobSet);
        }
    }
    
该方法会创建job目录以及jobs.xml文件, 以及从文件中读取所有的JobStatus。

### 2.7 xml解析

#### 2.7.1 ReadJobMapFromDiskRunnable
[-> JobStore.java]

    private class ReadJobMapFromDiskRunnable implements Runnable {
        private final ArraySet<JobStatus> jobSet;

        ReadJobMapFromDiskRunnable(ArraySet<JobStatus> jobSet) {
            this.jobSet = jobSet;
        }

        public void run() {
            List<JobStatus> jobs;
            FileInputStream fis = mJobsFile.openRead();
            synchronized (JobStore.this) {
                jobs = readJobMapImpl(fis);  //[见小节2.7.2]
                if (jobs != null) {
                    for (int i=0; i<jobs.size(); i++) {
                        this.jobSet.add(jobs.get(i));
                    }
                }
            }
            fis.close();
        }
    }

此处mJobsFile便是/data/system/job/jobs.xml。

#### 2.7.2 readJobMapImpl
[-> JobStore.java]

    private List<JobStatus> readJobMapImpl(FileInputStream fis)
             throws XmlPullParserException, IOException {
         XmlPullParser parser = Xml.newPullParser();
         parser.setInput(fis, StandardCharsets.UTF_8.name());
         ...

         String tagName = parser.getName();
         if ("job-info".equals(tagName)) {
             final List<JobStatus> jobs = new ArrayList<JobStatus>();
             ...
             eventType = parser.next();
             do {
                 //读取每一个 <job/>
                 if (eventType == XmlPullParser.START_TAG) {
                     tagName = parser.getName();
                     if ("job".equals(tagName)) {
                          //[见小节2.7.3]
                         JobStatus persistedJob = restoreJobFromXml(parser);
                         if (persistedJob != null) {
                             jobs.add(persistedJob);
                         } 
                     }
                 }
                 eventType = parser.next();
             } while (eventType != XmlPullParser.END_DOCUMENT);
             return jobs;
         }
         return null;
     }

从文件jobs.xml中读取并创建JobStatus，然后添加到mJobSet.

#### 2.7.3 restoreJobFromXml
[-> JobStore.java]

    private JobStatus restoreJobFromXml(XmlPullParser parser) throws XmlPullParserException,
                IOException {
        JobInfo.Builder jobBuilder;
        int uid;
        //创建用于获取jobInfo的Builder[见小节2.7.4]
        jobBuilder = buildBuilderFromXml(parser);
        jobBuilder.setPersisted(true);
        uid = Integer.valueOf(parser.getAttributeValue(null, "uid"));
        ...
        
        buildConstraintsFromXml(jobBuilder, parser); //读取常量
        //读取job执行的两个时间点：delay和deadline
        Pair<Long, Long> elapsedRuntimes = buildExecutionTimesFromXml(parser);
        ...
        //[见小节2.8]
        return new JobStatus(jobBuilder.build(), uid, 
                    elapsedRuntimes.first, elapsedRuntimes.second);
    }

#### 2.7.4 buildBuilderFromXml
[-> JobStore.java]

    private JobInfo.Builder buildBuilderFromXml(XmlPullParser parser) throws NumberFormatException {
        int jobId = Integer.valueOf(parser.getAttributeValue(null, "jobid"));
        String packageName = parser.getAttributeValue(null, "package");
        String className = parser.getAttributeValue(null, "class");
        ComponentName cname = new ComponentName(packageName, className);
        //[见小节2.7.5]
        return new JobInfo.Builder(jobId, cname);
    }

创建的JobInfo对象，记录着任务的jobid, package, class。 

#### 2.7.5 创建JobInfo
[-> JobInfo.java]

    public class JobInfo implements Parcelable {
        public static final class Builder {
            public Builder(int jobId, ComponentName jobService) {
                 mJobService = jobService;
                 mJobId = jobId;
            }
            public JobInfo build() {
                mExtras = new PersistableBundle(mExtras); 
                return new JobInfo(this); //创建JobInfo
            }
        }
    }

    
### 2.8  创建JobStatus
[-> JobStatus.java]

    public JobStatus(JobInfo job, int uId, long earliestRunTimeElapsedMillis,
                      long latestRunTimeElapsedMillis) {
        this(job, uId, 0);

        this.earliestRunTimeElapsedMillis = earliestRunTimeElapsedMillis;
        this.latestRunTimeElapsedMillis = latestRunTimeElapsedMillis;
    }

    private JobStatus(JobInfo job, int uId, int numFailures) {
        this.job = job;
        this.uId = uId;
        this.name = job.getService().flattenToShortString();
        this.tag = "*job*/" + this.name;
        this.numFailures = numFailures;
    }
    
JobStatus对象记录着任务的jobId, ComponentName, uid以及标签和失败次数信息。

### 2.9 JSS.onBootPhase

    public void onBootPhase(int phase) {
        if (PHASE_SYSTEM_SERVICES_READY == phase) {
            //阶段500，则开始注册package和use移除的广播监听
            final IntentFilter filter = new IntentFilter(Intent.ACTION_PACKAGE_REMOVED);
            filter.addDataScheme("package");
            getContext().registerReceiverAsUser(
                    mBroadcastReceiver, UserHandle.ALL, filter, null, null);
            final IntentFilter userFilter = new IntentFilter(Intent.ACTION_USER_REMOVED);
            userFilter.addAction(PowerManager.ACTION_DEVICE_IDLE_MODE_CHANGED);
            getContext().registerReceiverAsUser(
                    mBroadcastReceiver, UserHandle.ALL, userFilter, null, null);
            mPowerManager = (PowerManager)getContext().getSystemService(Context.POWER_SERVICE);
        } else if (phase == PHASE_THIRD_PARTY_APPS_CAN_START) {
            synchronized (mJobs) {
                mReadyToRock = true;
                mBatteryStats = IBatteryStats.Stub.asInterface(ServiceManager.getService(
                        BatteryStats.SERVICE_NAME));
                for (int i = 0; i < MAX_JOB_CONTEXTS_COUNT; i++) {
                    //创建JobServiceContext对象
                    mActiveServices.add(
                            new JobServiceContext(this, mBatteryStats,
                                    getContext().getMainLooper()));
                }
                ArraySet<JobStatus> jobs = mJobs.getJobs();
                for (int i=0; i<jobs.size(); i++) {
                    JobStatus job = jobs.valueAt(i);
                    for (int controller=0; controller<mControllers.size(); controller++) {
                        mControllers.get(controller).deviceIdleModeChanged(mDeviceIdleMode);
                        mControllers.get(controller).maybeStartTrackingJob(job);
                    }
                }
                mHandler.obtainMessage(MSG_CHECK_JOB).sendToTarget();
            }
        }
    }

对于低内存的设备，则只创建一个创建JobServiceContext对象；否则创建3个该对象。

#### 2.9.1 创建JobServiceContext
[-> JobServiceContext.java]

    JobServiceContext(JobSchedulerService service, IBatteryStats batteryStats, Looper looper) {
        this(service.getContext(), batteryStats, service, looper);
    }

    JobServiceContext(Context context, IBatteryStats batteryStats,
            JobCompletedListener completedListener, Looper looper) {
        mContext = context;
        mBatteryStats = batteryStats;
        mCallbackHandler = new JobServiceHandler(looper);
        mCompletedListener = completedListener;
        mAvailable = true;
    }

此处的JobServiceHandler采用的是system_server进程的主线程。

### 2.10 小结   

1. JSS.JobHandler运行在system_server进程的主线程；
2. JobServiceContext.JobServiceHandler运行在system_server进程的主线程；
3. JobSchedulerStub作为实现接口IJobScheduler的binder服务端；
4. JobStore：其成员变量mIoHandler运行在"android.io"线程；
5. JobStatus：从/data/system/job/jobs.xml文件中读取每个JobInfo,再解析成JobStatus对象，添加到mJobSet。

可见JobSchedulerService启动过程，最主要工作是从jobs.xml文件收集所有的jobs，放入到JobStore的成员变量mJobSet。接下来，再回到文章最开头，来说一说schedule过程。


## 三. Schedule

### 3.1 JobScheduler
[-> SystemServiceRegistry]

    registerService(Context.JOB_SCHEDULER_SERVICE, JobScheduler.class,
            new StaticServiceFetcher<JobScheduler>() {
        public JobScheduler createService() {
            IBinder b = ServiceManager.getService(Context.JOB_SCHEDULER_SERVICE);
            return new JobSchedulerImpl(IJobScheduler.Stub.asInterface(b));
        }});
 
从这个过程,可知客户端请求获取JOB_SCHEDULER_SERVICE服务, 返回的是JobSchedulerImpl对象.JobSchedulerImpl对象继承于JobScheduler对象.
 
### 3.2 JobService
[-> JobService.java]

    public abstract class JobService extends Service {
        IJobService mBinder = new IJobService.Stub() {
            public void startJob(JobParameters jobParams) {
                ensureHandler();
                //向主线程的Handler发送执行任务的消息
                Message m = Message.obtain(mHandler, MSG_EXECUTE_JOB, jobParams);
                m.sendToTarget();
            }
            public void stopJob(JobParameters jobParams) {
                ensureHandler();
                //向主线程的Handler发送停止任务的消息
                Message m = Message.obtain(mHandler, MSG_STOP_JOB, jobParams);
                m.sendToTarget();
            }
        };
        
        void ensureHandler() {
           synchronized (mHandlerLock) {
               if (mHandler == null) {
                   //[见小节3.2.1]
                   mHandler = new JobHandler(getMainLooper());
               }
           }
       }
       public final IBinder onBind(Intent intent) {
          return mBinder.asBinder();
      }
      
    }

由于JobService运行在app端所在进程，那么此处的mHandler便是指app进程的主线程。

#### 3.2.1 JS.JobHandler
[-> JobService.java ::JobHandler]

    class JobHandler extends Handler {
        ...
        public void handleMessage(Message msg) {
            final JobParameters params = (JobParameters) msg.obj;
            switch (msg.what) {
                case MSG_EXECUTE_JOB:
                    boolean workOngoing = JobService.this.onStartJob(params);
                    ackStartMessage(params, workOngoing);
                    break;
                case MSG_STOP_JOB:
                    boolean ret = JobService.this.onStopJob(params);
                    ackStopMessage(params, ret);
                    break;
                case MSG_JOB_FINISHED:
                    final boolean needsReschedule = (msg.arg2 == 1);
                    IJobCallback callback = params.getCallback();
                    if (callback != null) {
                        callback.jobFinished(params.getJobId(), needsReschedule);
                    }
                    break;
                default:
                    break;
            }
        }
    }    

对于启动和停止任务，都分别向主线程发送消息，则分别会回调onStartJob和onStopJob方法。
由小节3.1 可知获取代理对象为JobSchedulerImpl，接下来说一说JobSchedulerImpl的schedule
过程。

### 3.3 JSI.schedule
[-> JobSchedulerImpl.java]

    public int schedule(JobInfo job) {
        try {
            return mBinder.schedule(job); //[见小节3.4]
        } catch (RemoteException e) {
            return JobScheduler.RESULT_FAILURE;
        }
    }
    
当app端调用JobSchedulerImpl的schedule()过程,通过binder call进入了system_server的binder线程,进入如下操作.

### 3.4 JobSchedulerStub.schedule
[-> JobSchedulerService.java  ::JobSchedulerStub]

    public int schedule(JobInfo job) throws RemoteException {
        final int pid = Binder.getCallingPid();
        final int uid = Binder.getCallingUid();
        enforceValidJobRequest(uid, job);

        long ident = Binder.clearCallingIdentity();
        try {
            return JobSchedulerService.this.schedule(job, uid);  //[见小节3.5]
        } finally {
            Binder.restoreCallingIdentity(ident);
        }
    }
    
### 3.5  JSS.schedule

    public int schedule(JobInfo job, int uId) {
        //创建JobStatus
        JobStatus jobStatus = new JobStatus(job, uId);
        //先取消该uid下的任务【见小节3.6】
        cancelJob(uId, job.getId());
        //开始追踪该任务【见小节3.7】
        startTrackingJob(jobStatus);
        //向system_server进程的主线程发送message.【见小节3.8】
        mHandler.obtainMessage(MSG_CHECK_JOB).sendToTarget();
        return JobScheduler.RESULT_SUCCESS;
    }

### 3.6 JSS.cancelJob
[-> JobSchedulerService.java]

    public void cancelJob(int uid, int jobId) {
        JobStatus toCancel;
        synchronized (mJobs) {
            //查找到相应的JobStatus
            toCancel = mJobs.getJobByUidAndJobId(uid, jobId);
        }
        if (toCancel != null) {
            //【见小节4.3】
            cancelJobImpl(toCancel);
        }
    }
    
### 3.7 JSS.startTrackingJob

    private void startTrackingJob(JobStatus jobStatus) {
        boolean update;
        boolean rocking;
        synchronized (mJobs) {
            update = mJobs.add(jobStatus);
            rocking = mReadyToRock;
        }
        if (rocking) {
            for (int i=0; i<mControllers.size(); i++) {
                StateController controller = mControllers.get(i);
                if (update) {
                    controller.maybeStopTrackingJob(jobStatus);
                }
                controller.maybeStartTrackingJob(jobStatus);
            }
        }
    }

先将该JobStatus添加到JobStore，再遍历已添加的5个状态控制器, 依次检查是否需要将该任务添加到相应的追踪控制器.
再回到[小节3.5]，通过JobHandler发送MSG_CHECK_JOB消息，接下来进入其handleMessage。

### 3.8 JSS.JobHandler
[-> JobSchedulerService.java  ::JobHandler]

    private class JobHandler extends Handler {
        public void handleMessage(Message message) {
            synchronized (mJobs) {
                if (!mReadyToRock) {
                    return;
                }
            }
            switch (message.what) {
                case MSG_JOB_EXPIRED: ...                    
                    break;
                case MSG_CHECK_JOB:
                    synchronized (mJobs) {
                        //[见小节3.9]
                        maybeQueueReadyJobsForExecutionLockedH();
                    }
                    break;
            }
            //[见小节3.10]
            maybeRunPendingJobsH();
            removeMessages(MSG_CHECK_JOB);
        }
    }
    

### 3.9 maybeQueueReadyJobsForExecutionLockedH
[-> JobSchedulerService.java  ::JobHandler]

    private void maybeQueueReadyJobsForExecutionLockedH() {
        int chargingCount = 0;
        int idleCount =  0;
        int backoffCount = 0;
        int connectivityCount = 0;
        List<JobStatus> runnableJobs = new ArrayList<JobStatus>();
        ArraySet<JobStatus> jobs = mJobs.getJobs();
        for (int i=0; i<jobs.size(); i++) {
            JobStatus job = jobs.valueAt(i);
            if (isReadyToBeExecutedLocked(job)) {
                if (job.getNumFailures() > 0) {
                    backoffCount++;
                }
                if (job.hasIdleConstraint()) {
                    idleCount++;
                }
                if (job.hasConnectivityConstraint() || job.hasUnmeteredConstraint()) {
                    connectivityCount++;
                }
                if (job.hasChargingConstraint()) {
                    chargingCount++;
                }
                //将所有job加入runnableJobs队列
                runnableJobs.add(job);
            } else if (isReadyToBeCancelledLocked(job)) {
                stopJobOnServiceContextLocked(job);
            }
        }
        if (backoffCount > 0 ||
                idleCount >= MIN_IDLE_COUNT ||
                connectivityCount >= MIN_CONNECTIVITY_COUNT ||
                chargingCount >= MIN_CHARGING_COUNT ||
                runnableJobs.size() >= MIN_READY_JOBS_COUNT) {
            for (int i=0; i<runnableJobs.size(); i++) {
                //加入到mPendingJobs队列
                mPendingJobs.add(runnableJobs.get(i));
            }
        } 
    }

该功能:

1. 先将所有JobStatus加入runnableJobs队列;
2. 再将runnableJobs中满足触发条件的JobStatus加入到mPendingJobs队列;

### 3.10 maybeRunPendingJobsH

    private void maybeRunPendingJobsH() {
        synchronized (mJobs) {
            if (mDeviceIdleMode) {
                return;
            }
            Iterator<JobStatus> it = mPendingJobs.iterator();
            while (it.hasNext()) {
                JobStatus nextPending = it.next();
                JobServiceContext availableContext = null;
                for (int i=0; i<mActiveServices.size(); i++) {
                    JobServiceContext jsc = mActiveServices.get(i);
                    final JobStatus running = jsc.getRunningJob();
                    if (running != null && running.matches(nextPending.getUid(),
                            nextPending.getJobId())) {
                        availableContext = null;
                        break;
                    }
                    if (jsc.isAvailable()) {
                        availableContext = jsc;
                    }
                }
                if (availableContext != null) {
                    //[见小节3.11]
                    if (!availableContext.executeRunnableJob(nextPending)) {
                        mJobs.remove(nextPending);
                    }
                    it.remove();
                }
            }
        }
    }

处理mPendingJobs列队中所有的Job.

### 3.11 executeRunnableJob
[-> JobServiceContext]

    boolean executeRunnableJob(JobStatus job) {
        synchronized (mLock) {
            if (!mAvailable) {
                return false;
            }

            mRunningJob = job;
            final boolean isDeadlineExpired =
                    job.hasDeadlineConstraint() &&
                            (job.getLatestRunTimeElapsed() < SystemClock.elapsedRealtime());
            mParams = new JobParameters(this, job.getJobId(), job.getExtras(), isDeadlineExpired);
            mExecutionStartTimeElapsed = SystemClock.elapsedRealtime();

            mVerb = VERB_BINDING;
            scheduleOpTimeOut();
            final Intent intent = new Intent().setComponent(job.getServiceComponent());
            //bind服务【见小节3.11.1】
            boolean binding = mContext.bindServiceAsUser(intent, this,
                    Context.BIND_AUTO_CREATE | Context.BIND_NOT_FOREGROUND,
                    new UserHandle(job.getUserId()));
            if (!binding) {
                mRunningJob = null;
                mParams = null;
                mExecutionStartTimeElapsed = 0L;
                mVerb = VERB_FINISHED;
                removeOpTimeOut();
                return false;
            }
            ...
            mAvailable = false;
            return true;
        }
    }

这便是由system_server进程的主线程来执行bind Service的方式来拉起的进程，当服务启动后回调到发起端的onServiceConnected。

#### 3.11.1 JSC.onServiceConnected

    public void onServiceConnected(ComponentName name, IBinder service) {
        JobStatus runningJob;
        synchronized (mLock) {
            runningJob = mRunningJob;
        }
        if (runningJob == null || !name.equals(runningJob.getServiceComponent())) {
            mCallbackHandler.obtainMessage(MSG_SHUTDOWN_EXECUTION).sendToTarget();
            return;
        }
        //获取远程JobService的代理端
        this.service = IJobService.Stub.asInterface(service);
        ...
        //发送消息【见小节3.11.2】
        mCallbackHandler.obtainMessage(MSG_SERVICE_BOUND).sendToTarget();
    }

this.service是指获取远程IJobService【小节3.2】的代理端，mCallbackHandler运行在system_server的主线程。

#### 3.11.2 MSG_SERVICE_BOUND
[-> JobServiceContext.java]

    private class JobServiceHandler extends Handler {
        JobServiceHandler(Looper looper) {
            super(looper);
        }

        public void handleMessage(Message message) {
            switch (message.what) {
                case MSG_SERVICE_BOUND:
                    removeOpTimeOut(); //移除MSG_TIMEOUT消息
                    handleServiceBoundH(); //【见小节3.11.3】
                    break;
                ...
            }
        }
    }

#### 3.11.3 JSC.handleServiceBoundH

    private void handleServiceBoundH() {
        if (mVerb != VERB_BINDING) {
            closeAndCleanupJobH(false /* reschedule */);
            return;
        }
        if (mCancelled.get()) {
            closeAndCleanupJobH(true /* reschedule */);
            return;
        }
        mVerb = VERB_STARTING;
        scheduleOpTimeOut();
        //此处经过binder调用【见小节3.11.4】
        service.startJob(mParams);
    }

此处的service是由【小节3.11.1】所赋值，是指app端IJobService的代理类。经过binder call
回到app进程。

#### 3.11.4 JS.startJob
[-> JobService.java]

    public abstract class JobService extends Service {
        IJobService mBinder = new IJobService.Stub() {
            public void startJob(JobParameters jobParams) {
                ensureHandler();
                //向主线程的Handler发送执行任务的消息【见小节3.11.5】
                Message m = Message.obtain(mHandler, MSG_EXECUTE_JOB, jobParams);
                m.sendToTarget();
            }
            
            public void stopJob(JobParameters jobParams) {
                ...
            }
        };
        
      
    }

由于JobService运行在app端所在进程，那么此处的mHandler便是指app进程的主线程。

#### 3.11.5 JS.JobHandler
[-> JobService.java ::JobHandler]

    class JobHandler extends Handler {
        ...
        public void handleMessage(Message msg) {
            final JobParameters params = (JobParameters) msg.obj;
            switch (msg.what) {
                case MSG_EXECUTE_JOB:
                    boolean workOngoing = JobService.this.onStartJob(params);
                    ackStartMessage(params, workOngoing);
                    break;
                case MSG_STOP_JOB: ...
                case MSG_JOB_FINISHED:...
                default: break;
            }
        }
    }   

回到主线程，调用onStartJob()方法。

## 四. Cancel

### 4.1 JSI.cancel
[-> JobSchedulerImpl.java]

    public class JobSchedulerImpl extends JobScheduler {
        public void cancel(int jobId) {
            try {
                mBinder.cancel(jobId); //【见小节4.2】
            } catch (RemoteException e) {}
        }

        public void cancelAll() {
            try {
                mBinder.cancelAll();
            } catch (RemoteException e) {}
        }
        ...
    }

通过binder call，进入system_server的binder线程执行如下操作

### 4.2 JobSchedulerStub.cancel
[-> JobSchedulerService.java  ::JobSchedulerStub]

    final class JobSchedulerStub extends IJobScheduler.Stub {
        public void cancel(int jobId) throws RemoteException {
            final int uid = Binder.getCallingUid();
            long ident = Binder.clearCallingIdentity();
            try {
                //【见小节4.3】
                JobSchedulerService.this.cancelJob(uid, jobId);
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
        }
        
        public void cancelAll() throws RemoteException {
            final int uid = Binder.getCallingUid();
            long ident = Binder.clearCallingIdentity();
            try {
                JobSchedulerService.this.cancelJobsForUid(uid);
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
        }
        
        ...
    }

### 4.3 JSS.cancelJob
[-> JobSchedulerService.java]

    public class JobSchedulerService extends com.android.server.SystemService
            implements StateChangedListener, JobCompletedListener {
            
        public void cancelJob(int uid, int jobId) {
            JobStatus toCancel;
            synchronized (mJobs) {
                //【见小节4.3.1】
                toCancel = mJobs.getJobByUidAndJobId(uid, jobId);
            }
            if (toCancel != null) {
                cancelJobImpl(toCancel);
            }
        }
        
        public void cancelJobsForUid(int uid) {
            List<JobStatus> jobsForUid;
            synchronized (mJobs) {
                //【见小节4.3.2】
                jobsForUid = mJobs.getJobsByUid(uid);
            }
            for (int i=0; i<jobsForUid.size(); i++) {
                JobStatus toRemove = jobsForUid.get(i);
                //【见小节4.4】
                cancelJobImpl(toRemove);
            }
        }
        ...
    }

由上可知：

- cancel(pid)：调用JSS.cancelJob(uid, jobId)
- cancelAll(): 调用JSS.cancelJobsForUid(uid)

以上两个方法，最终都会调用cancelJobImpl来取消任务的执行。

#### 4.3.1 getJobByUidAndJobId
[-> JobStore.java]

    public JobStatus getJobByUidAndJobId(int uid, int jobId) {
        Iterator<JobStatus> it = mJobSet.iterator();
        while (it.hasNext()) {
            JobStatus ts = it.next();
            if (ts.getUid() == uid && ts.getJobId() == jobId) {
                return ts;
            }
        }
        return null;
    }

从mJobSet中查找指定uid和jobid的job;

#### 4.3.2 getJobsByUid
[-> JobStore.java]

    public List<JobStatus> getJobsByUid(int uid) {
        List<JobStatus> matchingJobs = new ArrayList<JobStatus>();
        Iterator<JobStatus> it = mJobSet.iterator();
        while (it.hasNext()) {
            JobStatus ts = it.next();
            if (ts.getUid() == uid) {
                matchingJobs.add(ts);
            }
        }
        return matchingJobs;
    }

遍历mJobSet中查找所有uid相同的jobs

### 4.4 JSS.cancelJobImpl

    private void cancelJobImpl(JobStatus cancelled) {
        stopTrackingJob(cancelled); //【见小节4.5】
        synchronized (mJobs) {
            mPendingJobs.remove(cancelled);
            //【见小节4.6】
            stopJobOnServiceContextLocked(cancelled);
        }
    }

### 4.5 JSS.stopTrackingJob

    private boolean stopTrackingJob(JobStatus jobStatus) {
        boolean removed;
        boolean rocking;
        synchronized (mJobs) {
            removed = mJobs.remove(jobStatus);
            rocking = mReadyToRock;
        }
        if (removed && rocking) {
            for (int i=0; i<mControllers.size(); i++) {
                StateController controller = mControllers.get(i);
                //获取StateController的具体实现子类停止执行
                controller.maybeStopTrackingJob(jobStatus);
            }
        }
        return removed;
    }

此处会依次调用前面注册的5个StateController来执行maybeStopTrackingJob。

### 4.6 JSS.stopJobOnServiceContextLocked

    private boolean stopJobOnServiceContextLocked(JobStatus job) {
        for (int i=0; i<mActiveServices.size(); i++) {
            JobServiceContext jsc = mActiveServices.get(i);
            final JobStatus executing = jsc.getRunningJob();
            if (executing != null && executing.matches(job.getUid(), job.getJobId())) {
                //找到匹配的正在执行任务，则取消该任务【见小节4.6.1】
                jsc.cancelExecutingJob();
                return true;
            }
        }
        return false;
    }

#### 4.6.1 JSC.cancelExecutingJob
[-> JobServiceContext.java]

    void cancelExecutingJob() {
        //【见小节4.6.2】
        mCallbackHandler.obtainMessage(MSG_CANCEL).sendToTarget();
    }

向运行在system_server主线程的JobServiceHandler发送MSG_CANCEL消息，接收到该消息，则执行handleCancelH();

#### 4.6.2 JSC.handleCancelH
[-> JobServiceContext.java]

    private void handleCancelH() {
        if (mRunningJob == null) {
            return;
        }
        switch (mVerb) {
            case VERB_BINDING:
            case VERB_STARTING:
                mCancelled.set(true);
                break;
            case VERB_EXECUTING:
                if (hasMessages(MSG_CALLBACK)) {
                    //当client已调用jobFinished，则忽略本次取消操作
                    return;
                }
                sendStopMessageH(); //【见小节4.6.3】
                break;
            case VERB_STOPPING:
                break;
            default:
                break;
        }
    }
    
#### 4.6.3 JSC.sendStopMessageH

    private void sendStopMessageH() {
        removeOpTimeOut();
        if (mVerb != VERB_EXECUTING) {
            //停止还没有启动的job
            closeAndCleanupJobH(false /* reschedule */);
            return;
        }
        try {
            mVerb = VERB_STOPPING;
            scheduleOpTimeOut();
            //【见小节4.6.4】
            service.stopJob(mParams);
        } catch (RemoteException e) {
            closeAndCleanupJobH(false /* reschedule */);
        }
    }

此处的service是由【小节3.11.1】所赋值，是指app端IJobService的代理类。经过binder call
回到app进程。

#### 4.6.4 JobService.stopJob
[-> JobService.java]

    public abstract class JobService extends Service {
        IJobService mBinder = new IJobService.Stub() {
            public void startJob(JobParameters jobParams) {
                ...
            }
            public void stopJob(JobParameters jobParams) {
                ensureHandler();
                //向主线程的Handler发送停止任务的消息【见小节4.6.5】
                Message m = Message.obtain(mHandler, MSG_STOP_JOB, jobParams);
                m.sendToTarget();
            }
        };
        
        ...
    }

#### 4.6.5 JS.JobHandler
[-> JobService.java ::JobHandler]

    class JobHandler extends Handler {
        ...
        public void handleMessage(Message msg) {
            final JobParameters params = (JobParameters) msg.obj;
            switch (msg.what) {
                case MSG_EXECUTE_JOB:...
                case MSG_STOP_JOB:
                    boolean ret = JobService.this.onStopJob(params);
                    ackStopMessage(params, ret);
                    break;
                case MSG_JOB_FINISHED:...
                default: break;
            }
        }
    }  

回到主线程，调用onStopJob()方法。

## 四. 总结

JobScheduler启动调用schedule()，结束则调用cancel(int jobId)或cancelAll(),整个JobScheduler过程涉及不少记录job的对象,关系如下:
 
![job](/images/jobscheduler/job.jpg)

JobSchedulerService通过成员遍历mJobs指向JobStore对象;JobStore的mJobSet记录着所有的JobStatus对象;
JobStatus通过job指向JobInfo对象; JobInfo对象里面记录着jobId, 组件名以及各种触发scheduler的限制条件信息.


再来看看整个jobscheduler的执行过程:[点击查看大图](http://www.gityuan.com/images/jobscheduler/job_scheduler_sequence.jpg)

![job_scheduler_sequence](/images/jobscheduler/job_scheduler_sequence.jpg)

上图整个过程涉及两次跨进程的调用, 第一次是从app进程进入system_server进程的JobSchedulerStub, 采用IJobScheduler接口. 
第二次则是JobScheduler通过bindService方式启动之后, 再回到system_server进程,然后调用startJob(),这是通过IJobService接口,
这是oneway的方式,意味着不会等待对方完成便会结束.

当然在JobScheduler过程中前面介绍的5个StateController很重要,会根据时机来触发JobSchedulerService执行相应的满足条件的任务.

另外，cancalAll()小心有坑，因为该方法的功能是取消该uid下的所有jobs，也就是说当存在多个app通过shareUid的方式，那么在其中任意一个app执行cancalAll()，则会把所有同一uid下的app中的jobs都cancel掉，这个应该是Google设计的缺陷，一定要谨慎处理。

最终会回调目标应用中的JobService的onStartJob()方法, 可见该方法运行在app进程的主线程, 那么当存在耗时操作时则必须要采用异步方式, 让耗时操作交给子线程去执行,这样就不会阻塞app的UI线程.
