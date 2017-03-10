## 一. 概述


      
## 二. JSS启动过程

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
    
### 2.5 JS.initAndGet
[-> JobStore.java]

    static JobStore initAndGet(JobSchedulerService jobManagerService) {
        synchronized (sSingletonLock) {
            if (sSingleton == null) {
                //[见小节2.5.1]
                sSingleton = new JobStore(jobManagerService.getContext(),
                        Environment.getDataDirectory());
            }
            return sSingleton;
        }
    }

#### 2.5.1 JobStore初始化
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
            //[见小节2.5.2]
            readJobMapFromDisk(mJobSet);
        }
    }
    
该方法会创建job目录以及jobs.xml文件。

#### 2.5.2 ReadJobMapFromDiskRunnable
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
                jobs = readJobMapImpl(fis);  //[见小节2.5.3]
                if (jobs != null) {
                    for (int i=0; i<jobs.size(); i++) {
                        this.jobSet.add(jobs.get(i));
                    }
                }
            }
            fis.close();
        }
    }

#### 2.5.3 readJobMapImpl
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
                          //[见小节2.5.4]
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

#### 2.5.4 restoreJobFromXml
[-> JobStore.java]

    private JobStatus restoreJobFromXml(XmlPullParser parser) throws XmlPullParserException,
                IOException {
        JobInfo.Builder jobBuilder;
        int uid;
        //从xml解析并创建jobBuilder[见小节2.5.5]
        jobBuilder = buildBuilderFromXml(parser);
        jobBuilder.setPersisted(true);
        uid = Integer.valueOf(parser.getAttributeValue(null, "uid"));
        ...
        
        buildConstraintsFromXml(jobBuilder, parser); //读取常量
        Pair<Long, Long> elapsedRuntimes = buildExecutionTimesFromXml(parser);
        ...
        //[见小节2.5.5]
        return new JobStatus(jobBuilder.build(), uid, 
                    elapsedRuntimes.first, elapsedRuntimes.second);
    }
        

#### 2.5.5 buildBuilderFromXml
[-> JobStore.java]

    private JobInfo.Builder buildBuilderFromXml(XmlPullParser parser) throws NumberFormatException {
        int jobId = Integer.valueOf(parser.getAttributeValue(null, "jobid"));
        String packageName = parser.getAttributeValue(null, "package");
        String className = parser.getAttributeValue(null, "class");
        ComponentName cname = new ComponentName(packageName, className);
        //[见小节2.5.6]
        return new JobInfo.Builder(jobId, cname);
    }

#### 2.5.6 JobInfo
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
    
### 涉及对象
- JobSchedulerService，JobStore，JobStatus，JobInfo。    
- JobSchedulerImpl：调度任务
- JobInfo：任务信息


JobSchedulerImpl extends JobScheduler 
JobSchedulerService的代理端位于 JobSchedulerImpl.mBinder

## 三.  用户使用

JobScheduler的用法:

     //[见小节3.1]
     JobScheduler scheduler = (JobScheduler) getSystemService(Context.JOB_SCHEDULER_SERVICE);  
     // MyJobService继承于MyJobService对象 [见小节3.2]
     ComponentName jobService = new ComponentName(this, MyJobService.class); 
     int jobId = 123;  
     
     //创建JobInfo对象[见小节2.5.6]
     JobInfo jobInfo = new JobInfo.Builder(jobId, jobService)  
             .setMinimumLatency(5000)// 设置任务运行最少延迟时间  
             .setOverrideDeadline(60000)// 设置deadline，若到期还没有达到规定的条件则会开始执行  
             .setRequiredNetworkType(JobInfo.NETWORK_TYPE_UNMETERED)// 设置网络条件  
             .setRequiresCharging(true)// 设置是否充电的条件  
             .setRequiresDeviceIdle(false)// 设置手机是否空闲的条件  
             .build();  
     //[见小节3.3]
     scheduler.schedule(jobInfo); 

### 3.1 JobScheduler
[-> SystemServiceRegistry]

    registerService(Context.JOB_SCHEDULER_SERVICE, JobScheduler.class,
            new StaticServiceFetcher<JobScheduler>() {
        public JobScheduler createService() {
            IBinder b = ServiceManager.getService(Context.JOB_SCHEDULER_SERVICE);
            return new JobSchedulerImpl(IJobScheduler.Stub.asInterface(b));
        }});
 
从这个过程,可知客户端请求获取JOB_SCHEDULER_SERVICE服务, 返回的是JobSchedulerImpl对象.
JobSchedulerImpl对象继承于JobScheduler对象.
 
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

#### 3.2.1 JobHandler
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
        JobStatus jobStatus = new JobStatus(job, uId);
        cancelJob(uId, job.getId());
        startTrackingJob(jobStatus);
         //[见小节3.6]
        mHandler.obtainMessage(MSG_CHECK_JOB).sendToTarget();
        return JobScheduler.RESULT_SUCCESS;
    }
  
向system_server进程的主线程发送message.

### 3.6 JSS.JobHandler
[-> JobSchedulerService.java  ::JobHandler]

    private class JobHandler extends Handler {
        public void handleMessage(Message message) {
            synchronized (mJobs) {
                if (!mReadyToRock) {
                    return;
                }
            }
            switch (message.what) {
                case MSG_JOB_EXPIRED:
                    synchronized (mJobs) {
                        JobStatus runNow = (JobStatus) message.obj;
                        if (runNow != null && !mPendingJobs.contains(runNow)
                                && mJobs.containsJob(runNow)) {
                            mPendingJobs.add(runNow);
                        }
                        queueReadyJobsForExecutionLockedH();
                    }
                    break;
                case MSG_CHECK_JOB:
                    synchronized (mJobs) {
                        //[见小节3.7]
                        maybeQueueReadyJobsForExecutionLockedH();
                    }
                    break;
            }
            //[见小节3.8]
            maybeRunPendingJobsH();
            removeMessages(MSG_CHECK_JOB);
        }
    }
    

### 3.7 maybeQueueReadyJobsForExecutionLockedH
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

### 3.8 maybeRunPendingJobsH

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
                    //[见小节3.9]
                    if (!availableContext.executeRunnableJob(nextPending)) {
                        mJobs.remove(nextPending);
                    }
                    it.remove();
                }
            }
        }
    }

处理mPendingJobs列队中所有的Job.

### 3.9 executeRunnableJob
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
            //bind服务
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

这便是由system_server进程的主线程来执行bind Service的方式来拉起的进程.

## 四. cancel

JobScheduler对象调用cancel(int jobId)或cancelAll()

### else
http://blog.csdn.net/zhangyongfeiyong/article/details/52224300
http://blog.csdn.net/zhangyongfeiyong/article/details/52130413
