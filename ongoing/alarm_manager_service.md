## 一. 概述    
    
## 二. AlarmManager服务启动

### 2.1 startOtherServices
[-> SystemServer.java]

    private void startOtherServices() {
      ...
      mSystemServiceManager.startService(AlarmManagerService.class);
      ...
    }

AlarmManagerService的初始化比JobScheduler更早。

### 2.2 AlarmManagerService
[-> AlarmManagerService.java]

    public AlarmManagerService(Context context) {
        super(context);
        mConstants = new Constants(mHandler);
    }

此处AlarmHandler mHandler = new AlarmHandler()，该Handler运行在system_server的主线程。

#### 2.2.1 创建Constants
[-> AlarmManagerService.java ::Constants]

    private final class Constants extends ContentObserver {
        public Constants(Handler handler) {
            super(handler);
            updateAllowWhileIdleMinTimeLocked();
            updateAllowWhileIdleWhitelistDurationLocked();
        }
        
        public void updateAllowWhileIdleMinTimeLocked() {
            mAllowWhileIdleMinTime = mPendingIdleUntil != null
                    ? ALLOW_WHILE_IDLE_LONG_TIME : ALLOW_WHILE_IDLE_SHORT_TIME;
        }

        public void updateAllowWhileIdleWhitelistDurationLocked() {
            if (mLastAllowWhileIdleWhitelistDuration != ALLOW_WHILE_IDLE_WHITELIST_DURATION) {
                mLastAllowWhileIdleWhitelistDuration = ALLOW_WHILE_IDLE_WHITELIST_DURATION;
                BroadcastOptions opts = BroadcastOptions.makeBasic();
                //设置为10s
                opts.setTemporaryAppWhitelistDuration(ALLOW_WHILE_IDLE_WHITELIST_DURATION);
                mIdleOptions = opts.toBundle();
            }
        }
        ...
    }

当系统处于idle状态，则alarm最小时间间隔为9min；当处于非idle则最小时间间隔为5s.

### 2.3 ALMS.onStart
[-> AlarmManagerService.java]

    public void onStart() {
        mNativeData = init(); //【2.4】
        mNextWakeup = mNextNonWakeup = 0;

        //由于重启后内核并没有保存时区信息，则必须将当前时区设置到内核；若时区改变则会发送相应
        setTimeZoneImpl(SystemProperties.get(TIMEZONE_PROPERTY));

        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        mWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "*alarm*");
        //TIME_TICK广播
        mTimeTickSender = PendingIntent.getBroadcastAsUser(getContext(), 0,
                new Intent(Intent.ACTION_TIME_TICK).addFlags(
                        Intent.FLAG_RECEIVER_REGISTERED_ONLY
                        | Intent.FLAG_RECEIVER_FOREGROUND), 0,
                        UserHandle.ALL);
        //DATE_CHANGED广播
        Intent intent = new Intent(Intent.ACTION_DATE_CHANGED);
        intent.addFlags(Intent.FLAG_RECEIVER_REPLACE_PENDING);
        mDateChangeSender = PendingIntent.getBroadcastAsUser(getContext(), 0, intent,
                Intent.FLAG_RECEIVER_REGISTERED_ONLY_BEFORE_BOOT, UserHandle.ALL);
                
        //【见小节2.5】
        mClockReceiver = new ClockReceiver();
        //首次调度一次，后面每分钟执行一次【见小节2.6】
        mClockReceiver.scheduleTimeTickEvent();
        //日期改变的广播，流程同上
        mClockReceiver.scheduleDateChangedEvent();
        
        //用于监听亮屏/灭屏广播
        mInteractiveStateReceiver = new InteractiveStateReceiver();
        //用于监听package移除/重启，sdcard不可用的广播
        mUninstallReceiver = new UninstallReceiver();
        
        if (mNativeData != 0) {
            //创建"AlarmManager"【见小节2.8】
            AlarmThread waitThread = new AlarmThread();
            waitThread.start();
        } 
        //发布alarm服务
        publishBinderService(Context.ALARM_SERVICE, mService);
    }


该方法主要功能：

1. 将时区信息设置到内核；其中时区属性TIMEZONE_PROPERTY = "persist.sys.timezone"
2. 创建ClockReceiver广播接收者，用于监听TIME_TICK和DATE_CHANGED广播；
3. 创建InteractiveStateReceiver，用于监听亮屏/灭屏广播；
4. 创建UninstallReceiver，用于监听package移除/重启，sdcard不可用的广播；
5. 创建线程"AlarmManager"；
6. 发布alarm服务信息；

### 2.4 init
[-> com_android_server_AlarmManagerService.cpp]

    static jlong android_server_AlarmManagerService_init(JNIEnv*, jobject)
    {
        jlong ret = init_alarm_driver(); //【2.4.1】
        if (ret) {
            return ret;
        }

        return init_timerfd(); //【2.4.2】
    }

#### 2.4.1 init_alarm_driver

    static jlong init_alarm_driver()
    {
        int fd = open("/dev/alarm", O_RDWR);
        //创建Alarm驱动对象
        AlarmImpl *ret = new AlarmImplAlarmDriver(fd);
        return reinterpret_cast<jlong>(ret);
    }

打开节点/dev/alarm，并创建Alarm驱动对象。

#### 2.4.2 init_timerfd

    static jlong init_timerfd()
    {
        int epollfd;
        int fds[N_ANDROID_TIMERFDS];

        epollfd = epoll_create(N_ANDROID_TIMERFDS);
        for (size_t i = 0; i < N_ANDROID_TIMERFDS; i++) {
            fds[i] = timerfd_create(android_alarm_to_clockid[i], 0);
            
        }

        AlarmImpl *ret = new AlarmImplTimerFd(fds, epollfd, wall_clock_rtc());
        for (size_t i = 0; i < N_ANDROID_TIMERFDS; i++) {
            epoll_event event;
            event.events = EPOLLIN | EPOLLWAKEUP;
            event.data.u32 = i;

            int err = epoll_ctl(epollfd, EPOLL_CTL_ADD, fds[i], &event);
            ...
        }

        struct itimerspec spec;
        memset(&spec, 0, sizeof(spec));

        int err = timerfd_settime(fds[ANDROID_ALARM_TYPE_COUNT],
                TFD_TIMER_ABSTIME | TFD_TIMER_CANCEL_ON_SET, &spec, NULL);
        ...

        return reinterpret_cast<jlong>(ret);
    }

此处android_alarm_to_clockid数组如下：

    android_alarm_to_clockid[N_ANDROID_TIMERFDS] = {
        CLOCK_REALTIME_ALARM,
        CLOCK_REALTIME,
        CLOCK_BOOTTIME_ALARM,
        CLOCK_BOOTTIME,
        CLOCK_MONOTONIC,
        CLOCK_REALTIME,
    };

### 2.5 创建ClockReceiver
[-> AlarmManagerService.java  ::ClockReceiver]

    class ClockReceiver extends BroadcastReceiver {
        public ClockReceiver() {
            IntentFilter filter = new IntentFilter();
            filter.addAction(Intent.ACTION_TIME_TICK);
            filter.addAction(Intent.ACTION_DATE_CHANGED);
            getContext().registerReceiver(this, filter);
        }
        ...
    }

注册用于监听TIME_TICK和DATE_CHANGED的广播。

### 2.6 scheduleTimeTickEvent
[-> AlarmManagerService.java  ::ClockReceiver]

    public void scheduleTimeTickEvent() {
        final long currentTime = System.currentTimeMillis();
        final long nextTime = 60000 * ((currentTime / 60000) + 1);
        //距离下一分钟的时间戳
        final long tickEventDelay = nextTime - currentTime;

        final WorkSource workSource = null
        //【见小节2.7】
        setImpl(ELAPSED_REALTIME, SystemClock.elapsedRealtime() + tickEventDelay, 0,
                0, mTimeTickSender, AlarmManager.FLAG_STANDALONE, workSource, null,
                Process.myUid());
    }
    

### 2.7 ALMS.setImpl
[-> AlarmManagerService.java]

    void setImpl(int type, long triggerAtTime, long windowLength, long interval,
             PendingIntent operation, int flags, WorkSource workSource,
             AlarmManager.AlarmClockInfo alarmClock, int callingUid) {
        ...

         final long nowElapsed = SystemClock.elapsedRealtime();
         //获取闹钟触发的时间点
         final long nominalTrigger = convertToElapsed(triggerAtTime, type);
         final long minTrigger = nowElapsed + mConstants.MIN_FUTURITY;
         //保证alarm时间至少是在5s之后发生
         final long triggerElapsed = (nominalTrigger > minTrigger) ? nominalTrigger : minTrigger;

         final long maxElapsed;
         if (windowLength == AlarmManager.WINDOW_EXACT) {
             maxElapsed = triggerElapsed;
         } else if (windowLength < 0) {
             maxElapsed = maxTriggerTime(nowElapsed, triggerElapsed, interval);
             windowLength = maxElapsed - triggerElapsed;
         } else {
             maxElapsed = triggerElapsed + windowLength;
         }

         synchronized (mLock) {
             //【见小节2.7.1】
             setImplLocked(type, triggerAtTime, triggerElapsed, windowLength, maxElapsed,
                     interval, operation, flags, true, workSource, alarmClock, callingUid);
         }
     }

#### 2.7.1 ALMS.setImplLocked

    private void setImplLocked(int type, long when, long whenElapsed, long windowLength,
            long maxWhen, long interval, PendingIntent operation, int flags,
            boolean doValidate, WorkSource workSource, AlarmManager.AlarmClockInfo alarmClock,
            int uid) {
        //创建Alarm对象
        Alarm a = new Alarm(type, when, whenElapsed, windowLength, maxWhen, interval,
                operation, workSource, flags, alarmClock, uid);
        removeLocked(operation);
        //【见小节2.7.2】
        setImplLocked(a, false, doValidate);
    }

#### 2.7.2 ALMS.setImplLocked

    private void setImplLocked(Alarm a, boolean rebatching, boolean doValidate) {
        if ((a.flags&AlarmManager.FLAG_IDLE_UNTIL) != 0) {
            if (mNextWakeFromIdle != null && a.whenElapsed > mNextWakeFromIdle.whenElapsed) {
                a.when = a.whenElapsed = a.maxWhenElapsed = mNextWakeFromIdle.whenElapsed;
            }
            //增加模糊事件，让alarm比实际预期事件更早的执行
            final long nowElapsed = SystemClock.elapsedRealtime();
            final int fuzz = fuzzForDuration(a.whenElapsed-nowElapsed);
            if (fuzz > 0) {
                if (mRandom == null) {
                    mRandom = new Random();
                }
                //创建随机模糊时间
                final int delta = mRandom.nextInt(fuzz);
                a.whenElapsed -= delta;
                a.when = a.maxWhenElapsed = a.whenElapsed;
            }

        } else if (mPendingIdleUntil != null) {
            if ((a.flags&(AlarmManager.FLAG_ALLOW_WHILE_IDLE
                    | AlarmManager.FLAG_ALLOW_WHILE_IDLE_UNRESTRICTED
                    | AlarmManager.FLAG_WAKE_FROM_IDLE))
                    == 0) {
                mPendingWhileIdleAlarms.add(a);
                return;
            }
        }

        int whichBatch = ((a.flags&AlarmManager.FLAG_STANDALONE) != 0)
                ? -1 : attemptCoalesceLocked(a.whenElapsed, a.maxWhenElapsed);
        if (whichBatch < 0) {
            //TIME_TICK是独立的，不与其他alarm一起批处理
            Batch batch = new Batch(a);
            addBatchLocked(mAlarmBatches, batch);
        } else {
            ...
        }
        ...

        boolean needRebatch = false;

        if ((a.flags&AlarmManager.FLAG_IDLE_UNTIL) != 0) {
            mPendingIdleUntil = a;
            mConstants.updateAllowWhileIdleMinTimeLocked();
            needRebatch = true;
        } else if ((a.flags&AlarmManager.FLAG_WAKE_FROM_IDLE) != 0) {
            if (mNextWakeFromIdle == null || mNextWakeFromIdle.whenElapsed > a.whenElapsed) {
                mNextWakeFromIdle = a;
                if (mPendingIdleUntil != null) {
                    needRebatch = true;
                }
            }
        }

        if (!rebatching) {
            if (needRebatch) {
                //需要对所有alarm重新执行批处理
                rebatchAllAlarmsLocked(false);
            }

            rescheduleKernelAlarmsLocked();
            //重新计算下一个alarm
            updateNextAlarmClockLocked();
        }
    }

### 2.8 AlarmThread
[-> AlarmManagerService.java  ::AlarmThread]

    private class AlarmThread extends Thread
    {
        public AlarmThread()
        {
            super("AlarmManager");
        }
        
        public void run()
        {
            ArrayList<Alarm> triggerList = new ArrayList<Alarm>();
            while (true)
            {
                int result = waitForAlarm(mNativeData);
                triggerList.clear();

                final long nowRTC = System.currentTimeMillis();
                final long nowELAPSED = SystemClock.elapsedRealtime();

                if ((result & TIME_CHANGED_MASK) != 0) {
                    final long lastTimeChangeClockTime;
                    final long expectedClockTime;
                    synchronized (mLock) {
                        lastTimeChangeClockTime = mLastTimeChangeClockTime;
                        expectedClockTime = lastTimeChangeClockTime
                                + (nowELAPSED - mLastTimeChangeRealtime);
                    }
                    if (lastTimeChangeClockTime == 0 || nowRTC < (expectedClockTime-500)
                            || nowRTC > (expectedClockTime+500)) {
                        removeImpl(mTimeTickSender);
                        rebatchAllAlarms();
                        mClockReceiver.scheduleTimeTickEvent();
                        synchronized (mLock) {
                            mNumTimeChanged++;
                            mLastTimeChangeClockTime = nowRTC;
                            mLastTimeChangeRealtime = nowELAPSED;
                        }
                        //发送TIME_CHANGED广播
                        Intent intent = new Intent(Intent.ACTION_TIME_CHANGED);
                        intent.addFlags(Intent.FLAG_RECEIVER_REPLACE_PENDING
                                | Intent.FLAG_RECEIVER_REGISTERED_ONLY_BEFORE_BOOT);
                        getContext().sendBroadcastAsUser(intent, UserHandle.ALL);

                        result |= IS_WAKEUP_MASK;
                    }
                }

                if (result != TIME_CHANGED_MASK) {
                    synchronized (mLock) {
                        boolean hasWakeup = triggerAlarmsLocked(triggerList, nowELAPSED, nowRTC);
                        if (!hasWakeup && checkAllowNonWakeupDelayLocked(nowELAPSED)) {
                            if (mPendingNonWakeupAlarms.size() == 0) {
                                mStartCurrentDelayTime = nowELAPSED;
                                mNextNonWakeupDeliveryTime = nowELAPSED
                                        + ((currentNonWakeupFuzzLocked(nowELAPSED)*3)/2);
                            }
                            mPendingNonWakeupAlarms.addAll(triggerList);
                            mNumDelayedAlarms += triggerList.size();
                            rescheduleKernelAlarmsLocked();
                            updateNextAlarmClockLocked();
                        } else {
                            rescheduleKernelAlarmsLocked();
                            updateNextAlarmClockLocked();
                            if (mPendingNonWakeupAlarms.size() > 0) {
                                calculateDeliveryPriorities(mPendingNonWakeupAlarms);
                                triggerList.addAll(mPendingNonWakeupAlarms);
                                Collections.sort(triggerList, mAlarmDispatchComparator);
                                final long thisDelayTime = nowELAPSED - mStartCurrentDelayTime;
                                mTotalDelayTime += thisDelayTime;
                                if (mMaxDelayTime < thisDelayTime) {
                                    mMaxDelayTime = thisDelayTime;
                                }
                                mPendingNonWakeupAlarms.clear();
                            }
                            deliverAlarmsLocked(triggerList, nowELAPSED);
                        }
                    }
                }
            }
        }
    }


### 三. alarm使用

    //【见小节3.1】
    PendingIntent pi = PendingIntent.getBroadcast(mContext, 0, new Intent(ACTION_JOB_EXPIRED), 0);
    AlarmManager alarmManager=(AlarmManager)getSystemService(Service.ALARM_SERVICE); 
    alarmManager.set(AlarmManager.ELAPSED_REALTIME, SystemClock.elapsedRealtime(), pi);  

alarm使用过程会使用到PendingIntent，先来简单介绍下PendingIntent.

### 3.1 PendingIntent

常见PendingIntent常见的几个静态方法如下：

    PendingIntent.getActivity
    PendingIntent.getService
    PendingIntent.getBroadcastAsUser

以上3个方法最终都会调用到AMS.getIntentSender,主要的不同在于第一个参数`TYPE`.

#### 3.1.1 getBroadcastAsUser
[-> PendingIntent.java]

    public static PendingIntent getBroadcastAsUser(Context context, int requestCode,
            Intent intent, int flags, UserHandle userHandle) {
        String packageName = context.getPackageName();
        String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                context.getContentResolver()) : null;
        try {
            intent.prepareToLeaveProcess();
            IIntentSender target =
                ActivityManagerNative.getDefault().getIntentSender(
                    ActivityManager.INTENT_SENDER_BROADCAST, packageName,
                    null, null, requestCode, new Intent[] { intent },
                    resolvedType != null ? new String[] { resolvedType } : null,
                    flags, null, userHandle.getIdentifier());
            return target != null ? new PendingIntent(target) : null;
        } catch (RemoteException e) {
        }
        return null;
    }

PendingIntentRecord对象继承于IIntentSender.Stub，此处target是指PendingIntentRecord对象的代理端。

#### 3.1.2 getActivity

    public static PendingIntent getActivityAsUser(Context context, int requestCode,
            Intent intent, int flags, Bundle options, UserHandle user) {
        String packageName = context.getPackageName();
        String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                context.getContentResolver()) : null;
        try {
            intent.migrateExtraStreamToClipData();
            intent.prepareToLeaveProcess();
            //[见小节3.1.4]
            IIntentSender target =
                ActivityManagerNative.getDefault().getIntentSender(
                    ActivityManager.INTENT_SENDER_ACTIVITY, packageName,
                    null, null, requestCode, new Intent[] { intent },
                    resolvedType != null ? new String[] { resolvedType } : null,
                    flags, options, user.getIdentifier());
            return target != null ? new PendingIntent(target) : null;
        } catch (RemoteException e) {
        }
        return null;
    }

#### 3.1.3 getService

    public static PendingIntent getService(Context context, int requestCode,
             Intent intent,  int flags) {
        String packageName = context.getPackageName();
        String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                context.getContentResolver()) : null;
        try {
            intent.prepareToLeaveProcess();
            IIntentSender target =
                ActivityManagerNative.getDefault().getIntentSender(
                    ActivityManager.INTENT_SENDER_SERVICE, packageName,
                    null, null, requestCode, new Intent[] { intent },
                    resolvedType != null ? new String[] { resolvedType } : null,
                    flags, null, UserHandle.myUserId());
            return target != null ? new PendingIntent(target) : null;
        } catch (RemoteException e) {
        }
        return null;
    }

#### 3.1.4 AMS.getIntentSender

    public IIntentSender getIntentSender(int type,
            String packageName, IBinder token, String resultWho,
            int requestCode, Intent[] intents, String[] resolvedTypes,
            int flags, Bundle options, int userId) {
        //重新拷贝一次intent对象内容
        if (intents != null) {
            for (int i=0; i<intents.length; i++) {
                Intent intent = intents[i];
                if (intent != null) {
                    intents[i] = new Intent(intent);
                }
            }
        }
        ...
        
        synchronized(this) {
            int callingUid = Binder.getCallingUid();
            int origUserId = userId;
            userId = handleIncomingUser(Binder.getCallingPid(), callingUid, userId,
                    type == ActivityManager.INTENT_SENDER_BROADCAST,
                    ALLOW_NON_FULL, "getIntentSender", null);
            if (origUserId == UserHandle.USER_CURRENT) {
                userId = UserHandle.USER_CURRENT;
            }
            //【见小节3.1.5】
            return getIntentSenderLocked(type, packageName, callingUid, userId,
                  token, resultWho, requestCode, intents, resolvedTypes, flags, options);
        }
    }

#### 3.1.5 AMS.getIntentSenderLocked

    IIntentSender getIntentSenderLocked(int type, String packageName,
            int callingUid, int userId, IBinder token, String resultWho,
            int requestCode, Intent[] intents, String[] resolvedTypes, int flags,
            Bundle options) {
        ActivityRecord activity = null;
        ...
        //创建Key对象
        PendingIntentRecord.Key key = new PendingIntentRecord.Key(
                type, packageName, activity, resultWho,
                requestCode, intents, resolvedTypes, flags, options, userId);
        WeakReference<PendingIntentRecord> ref;
        ref = mIntentSenderRecords.get(key);
        PendingIntentRecord rec = ref != null ? ref.get() : null;
        if (rec != null) {
            if (!cancelCurrent) {
                if (updateCurrent) {
                    if (rec.key.requestIntent != null) {
                        rec.key.requestIntent.replaceExtras(intents != null ?
                                intents[intents.length - 1] : null);
                    }
                    if (intents != null) {
                        intents[intents.length-1] = rec.key.requestIntent;
                        rec.key.allIntents = intents;
                        rec.key.allResolvedTypes = resolvedTypes;
                    } else {
                        rec.key.allIntents = null;
                        rec.key.allResolvedTypes = null;
                    }
                }
                return rec;
            }
            rec.canceled = true;
            mIntentSenderRecords.remove(key);
        }
        if (noCreate) {
            return rec;
        }
        //创建PendingIntentRecord对象
        rec = new PendingIntentRecord(this, key, callingUid);
        mIntentSenderRecords.put(key, rec.ref);
        ...
        return rec;
    }

### 3.2 AlarmManager

    registerService(Context.ALARM_SERVICE, AlarmManager.class,
            new CachedServiceFetcher<AlarmManager>() {

        public AlarmManager createService(ContextImpl ctx) {
            IBinder b = ServiceManager.getService(Context.ALARM_SERVICE);
            IAlarmManager service = IAlarmManager.Stub.asInterface(b);
            return new AlarmManager(service, ctx);
        }});
        
由此可知，getSystemService(Service.ALARM_SERVICE)获取的是AlarmManager对象，再来看看其创建过程。

#### 3.2.1 AlarmManager
[-> AlarmManager.java]

    AlarmManager(IAlarmManager service, Context ctx) {
        mService = service; //ALMS的binder代理端
        mPackageName = ctx.getPackageName();
        mTargetSdkVersion = ctx.getApplicationInfo().targetSdkVersion;
        mAlwaysExact = (mTargetSdkVersion < Build.VERSION_CODES.KITKAT);
        mMainThreadHandler = new Handler(ctx.getMainLooper());
    }
    
此处mMainThreadHandler是运行在app进程的主线程。

### 3.3 ALM.set
[-> AlarmManager.java]

    public void set(int type, long triggerAtMillis, PendingIntent operation) {
        //[见小节3.4]
        setImpl(type, triggerAtMillis, legacyExactLength(), 0, 0, operation, null, null,
            null, null, null);
    }

### 3.4 ALM.setImpl
[-> AlarmManager.java]

    private void setImpl(int type, long triggerAtMillis, long windowMillis, long intervalMillis,
            int flags, PendingIntent operation, final OnAlarmListener listener, String listenerTag,
            Handler targetHandler, WorkSource workSource, AlarmClockInfo alarmClock) {
        ListenerWrapper recipientWrapper = null;
        if (listener != null) {
            synchronized (AlarmManager.class) {
                if (sWrappers == null) {
                    sWrappers = new ArrayMap<OnAlarmListener, ListenerWrapper>();
                }

                recipientWrapper = sWrappers.get(listener);
                if (recipientWrapper == null) {
                    recipientWrapper = new ListenerWrapper(listener);
                    sWrappers.put(listener, recipientWrapper);
                }
            }
            //当没有设置handler对象时,则采用当前进程的主线程handler
            final Handler handler = (targetHandler != null) ? targetHandler : mMainThreadHandler;
            recipientWrapper.setHandler(handler);
        }
        //【见小节2.7】
        mService.set(mPackageName, type, triggerAtMillis, windowMillis, intervalMillis, flags,
                operation, recipientWrapper, listenerTag, workSource, alarmClock);
    }

此处mService是指远程IAlarmManager的代理类， 服务类位于ALMS的成员变量mService = new IAlarmManager.Stub()。
可见，接下来程序运行到system_server进程。

--------------

### 3. ALMS.deliverLocked
[-> AlarmManagerService.java]

    public void deliverLocked(Alarm alarm, long nowELAPSED, boolean allowWhileIdle) {
        if (alarm.operation != null) {
          ...
        } else {
           alarm.listener.doAlarm(this); 
           mHandler.sendMessageDelayed(
                   mHandler.obtainMessage(AlarmHandler.LISTENER_TIMEOUT,
                           alarm.listener.asBinder()),
                   mConstants.LISTENER_TIMEOUT);
        }
        ...
    }

### 4. ListenerWrapper.doAlarm
[-> AlarmManager.java ::ListenerWrapper]

     final class ListenerWrapper extends IAlarmListener.Stub implements Runnable {
         final OnAlarmListener mListener;
         Handler mHandler;
         IAlarmCompleteListener mCompletion;

         public ListenerWrapper(OnAlarmListener listener) {
             mListener = listener;
         }

         public void setHandler(Handler h) {
            mHandler = h;
         }

         //执行alarm操作
         public void doAlarm(IAlarmCompleteListener alarmManager) {
             mCompletion = alarmManager;
             mHandler.post(this);
         }
     }

如果是运行在system_server进程里面, 则接下来post到了system_server的主线程.

### 5. ListenerWrapper.run

    final class ListenerWrapper extends IAlarmListener.Stub implements Runnable {
        
        public void run() {
            //从wrapper的缓存中移除该listener, 由于服务端已经认为它不存在
            synchronized (AlarmManager.class) {
                if (sWrappers != null) {
                    sWrappers.remove(mListener);
                }
            }

            //分发到app端
            try {
                mListener.onAlarm();
            } finally {
                mCompletion.alarmComplete(this);
            }
        }
    }
    

## 四. 总结

1. AlarmManagerService.mHandler 也是运行在system_server的主线程；
2. 防止alarm频繁发起，则最小时间间隔5s；

设置闹钟有3种类型:

    set(int type，long startTime，PendingIntent pi)，//设置一次闹钟
    setRepeating(int type，long startTime，long intervalTime，PendingIntent pi)，//设置重复闹钟
    setInexactRepeating（int type，long startTime，long intervalTime，PendingIntent pi），//设置重复闹钟,但不准确
    
Type有4种类型：

|类型|是否能唤醒系统|是否包含休眠时间|
|---|---|---|
|RTC_WAKEUP|是|否|
|RTC|否|否|
|ELAPSED_REALTIME_WAKEUP|是|是|
|ELAPSED_REALTIME|否|是|


问题调用栈

at com.android.server.job.controllers.TimeController.checkExpiredDelaysAndResetAlarm(TimeController.java:174)
- waiting to lock <0x08e172aa> (a java.lang.Object) held by thread 9
at com.android.server.job.controllers.TimeController.-wrap1(TimeController.java:-1)
at com.android.server.job.controllers.TimeController$2.onAlarm(TimeController.java:284)
at android.app.AlarmManager$ListenerWrapper.run(AlarmManager.java:285)
at android.os.Handler.handleCallback(Handler.java:751)
at android.os.Handler.dispatchMessage(Handler.java:95)
at android.os.Looper.loop(Looper.java:154)
at com.android.server.SystemServer.run(SystemServer.java:363)
at com.android.server.SystemServer.main(SystemServer.java:231)
at java.lang.reflect.Method.invoke!(Native method)
at com.android.internal.os.ZygoteInit$MethodAndArgsCaller.run(ZygoteInit.java:895)
at com.android.internal.os.ZygoteInit.main(ZygoteInit.java:785)
