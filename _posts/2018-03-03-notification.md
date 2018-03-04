---
layout: post
title:  "NotificationManagerService原理分析"
date:   2018-03-03 10:11:12
catalog:  true
tags:
    - android

---

> 基于Android 7.0源码分析通知机制，相关源码如下：
      
    frameworks/base/services/core/java/com/android/server/notification/
      - NotificationManagerService.java
      - ManagedServices.java
      
    frameworks/base/core/java/android/app/
      - NotificationManager.java
      - Notification.java
      
    frameworks/base/core/java/android/service/notification/
      - NotificationListenerService.java
      - StatusBarNotification.java
      
    frameworks/base/packages/SystemUI/src/com/android/systemui/statusbar/
      - phone/PhoneStatusBar.java
      - BaseStatusBar.java

## 一. 概述

Android应用除了组件和窗口管理，还有通知显示也是非常重要的，通知是应用界面之外向用户显示的界面。
NotificationListenerService继承于Service，该服务是为了给app提供获取通知的新增和删除事件，通知的数量和内容等相关信息的途径，该类的主要方法：

- cancelAllNotifications() ：删除系统所有可被清除的通知； 
- cancelNotification(String pkg, String tag, int id) ：删除某一个通知；
- onNotificationPosted(StatusBarNotification sbn) ：当系统收到新通知后触发回调方法； 
- onNotificationRemoved(StatusBarNotification sbn) ：当系统通知被删掉后触发回调方法；
- getActiveNotifications() ：获取当前系统所有通知到StatusBarNotification[]；


### 1.1 通知使用实例

#### 1.1.1 创建通知

    PendingIntent targetIntent = PendingIntent.getActivity(
      this, 0, new Intent(this, TargetActivity.class), 0);
    Notification notification = new Notification.Builder(this)
            .setSmallIcon(R.drawable.notification_icon) //小图标
            .setContentTitle("Gityuan notification") //通知标题
            .setContentText("Hello Gityuan") //通知内容
            .setContentIntent(targetIntent) //目标Intent
            .setAutoCancel(true) //自动取消
            .build();

**常见的Flags:**

- FLAG_AUTO_CANCEL，当通知被用户点击之后会自动被清除(cancel)
- FLAG_INSISTENT，在用户响应之前会一直重复提醒音
- FLAG_ONGOING_EVENT，表示正在运行的事件
- FLAG_NO_CLEAR，通知栏点击“清除”按钮时，该通知将不会被清除
- FLAG_FOREGROUND_SERVICE，表示当前服务是前台服务

关于前台服务是用户可感知的，前台服务需要显示一个通知，比如后台播放音乐。

    startForeground(ID, notification)//启动前台服务通知
    stopForeground(true); //true表示移除之前的通知

#### 1.1.2 发送通知

    NotificationManager mNotificationManager = 
    (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    mNotificationManager.notify(notifyID, notification); 
    

创建通知过程，此处的PendingIntent是当通知被点击后的跳转动作，可以是启动Activity、Service，或者发送Broadcast。
对于更新通知只需要发送notifyID相同的通知即可。

#### 1.1.3 取消通知

    NotificationManager mNotificationManager = 
    (NotificationManager) context.getSystemService(NOTIFICATION_SERVICE);
    mNotificationManager.cancel(notifyId); //取消指定ID的通知
    mNotificationManager.cancelAll(); //取消所有通知

除了调用NotificationManager的cancel()或者cancelAll()，也可

- 点击通知栏的清除按钮，则会清除所有的可清除通知；
- 设置setAutoCancel()或FLAG_AUTO_CANCEL的通知，当点击该通知则会清除它。

### 1.2 架构图

#### 1.2.1 核心类图

[点击查看大图](http://www.gityuan.com/images/notification/notification_class.jpg)

![notification](/images/notification/notification_class.jpg)

#### 1.2.2 通知处理流程图
[点击查看大图](http://www.gityuan.com/images/notification/notification_seq.jpg)

![notification](/images/notification/notification_seq.jpg)

可见，通知发送与通知取消流程的步骤一直对齐，这里就只介绍通知发送流程，通知取消流程就不再介绍。


## 二. 通知发送原理分析

### 2.1 NM.notify
[-> NotificationManager.java]

    public void notify(int id, Notification notification)
    {
        notify(null, id, notification);
    }

    public void notify(String tag, int id, Notification notification)
    {
        notifyAsUser(tag, id, notification, new UserHandle(UserHandle.myUserId()));
    }

    public void notifyAsUser(String tag, int id, Notification notification, UserHandle user)
    {
        int[] idOut = new int[1];
        //获取通知的代理对象
        INotificationManager service = getService();
        String pkg = mContext.getPackageName();
        //将包名和userId保存到通知的extras
        Notification.addFieldsFromContext(mContext, notification);
        ...
        fixLegacySmallIcon(notification, pkg);
        //对于Android 5.0之后的版本，smallIcon不可为空
        if (mContext.getApplicationInfo().targetSdkVersion > Build.VERSION_CODES.LOLLIPOP_MR1) {
            if (notification.getSmallIcon() == null) {
                throw new IllegalArgumentException(...);
            }
        }
        final Notification copy = Builder.maybeCloneStrippedForDelivery(notification);
        try {
            //binder调用，进入system_server进程【2.2】
            service.enqueueNotificationWithTag(pkg, mContext.getOpPackageName(), tag, id,
                    copy, idOut, user.getIdentifier());
        } catch (RemoteException e) {
            throw e.rethrowFromSystemServer();
        }
    }

### 2.2 NMS.enqueueNotificationInternal

    void enqueueNotificationInternal(final String pkg, final String opPkg, final int callingUid,
            final int callingPid, final String tag, final int id, final Notification notification,
            int[] idOut, int incomingUserId) {
        //检查发起者是系统进程或者同一个app，否则抛出异常
        checkCallerIsSystemOrSameApp(pkg); 
        final boolean isSystemNotification = isUidSystem(callingUid) || ("android".equals(pkg));
        final boolean isNotificationFromListener = mListeners.isListenerPackage(pkg);
        //除了系统通知和已注册的监听器允许入队列，其他通知都会限制数量上限，默认是一个package上限50个
        ...

        //将通知信息封装到StatusBarNotification对象
        final StatusBarNotification n = new StatusBarNotification(
                pkg, opPkg, id, tag, callingUid, callingPid, 0, notification, user);
        //创建记录通知实体的对象NotificationRecord
        final NotificationRecord r = new NotificationRecord(getContext(), n);
        //将通知异步发送到handler线程【见小节2.3】
        mHandler.post(new EnqueueNotificationRunnable(userId, r));
    }

这个过程主要是创建NotificationRecord对象，里面包含了notification相关信息。然后交给mHandler线程来处理，
mHandler是WorkerHandler类的实例对象。接下来看看WorkerHandler到底运行在哪个线程，这需要从NMS服务初始化过程来说起：

#### 2.2.1 SS.startOtherServices
[-> SystemServer.java]

    private void startOtherServices() {
        //【见小节2.2.2】
        mSystemServiceManager.startService(NotificationManagerService.class);
        ...
    }

该过程运行在system_server进程的主线程。

#### 2.2.2 SSM.startService
[-> SystemServiceManager.java]

    public <T extends SystemService> T startService(Class<T> serviceClass) {
        final String name = serviceClass.getName();
        Constructor<T> constructor = serviceClass.getConstructor(Context.class);
        //创建NotificationManagerService对象
        final T service = constructor.newInstance(mContext);
        //注册该服务
        mServices.add(service);
        //调用NMS的onStart方法，【见小节2.2.3】
        service.onStart();
        return service;
    }

该过程先创建NotificationManagerService(简称NMS)，然后再调用其onStart方法。

#### 2.2.3 NMS.onStart
[-> NMS.java]

    public void onStart() {
        ...
        mHandler = new WorkerHandler(); //运行在system_server的主线程
        mRankingThread.start(); //线程名为"ranker"的handler线程
        mRankingHandler = new RankingHandlerWorker(mRankingThread.getLooper());
        ...
        //用于记录所有的listeners的MangedServices对象
        mListeners = new NotificationListeners();
        ...
        publishBinderService(Context.NOTIFICATION_SERVICE, mService);
        publishLocalService(NotificationManagerInternal.class, mInternalService);
    }

到此，我们可以得知onStart()过程创建的mHandler运行在system_server的主线程。那么上面的执行流便进入了
system_server主线程。

### 2.3 EnqueueNotificationRunnable
[-> NMS.java]

    private class EnqueueNotificationRunnable implements Runnable {
        private final NotificationRecord r;
        private final int userId;

        EnqueueNotificationRunnable(int userId, NotificationRecord r) {
            this.userId = userId;
            this.r = r;
        };

        @Override
        public void run() {
            synchronized (mNotificationList) {
                final StatusBarNotification n = r.sbn;
                final Notification notification = n.getNotification();
                
                //将通知告知ranker service
                if (mRankerServices.isEnabled()) {
                    mRankerServices.onNotificationEnqueued(r);
                }
                
                //从通知列表mNotificationList查看是否存在该通知
                int index = indexOfNotificationLocked(n.getKey());
                if (index < 0) {
                    mNotificationList.add(r); 
                    mUsageStats.registerPostedByApp(r);
                } else {
                    old = mNotificationList.get(index);
                    mNotificationList.set(index, r);
                    mUsageStats.registerUpdatedByApp(r, old);
                    //确保通知的前台服务属性不会被丢弃
                    notification.flags |=
                            old.getNotification().flags & Notification.FLAG_FOREGROUND_SERVICE;
                    r.isUpdate = true;
                }
                mNotificationsByKey.put(n.getKey(), r);
                
                //如果是前台服务的通知，则添加不允许被清除和正在运行的标签
                if ((notification.flags & Notification.FLAG_FOREGROUND_SERVICE) != 0) {
                    notification.flags |= Notification.FLAG_ONGOING_EVENT
                            | Notification.FLAG_NO_CLEAR;
                }

                applyZenModeLocked(r);
                mRankingHelper.sort(mNotificationList);

                if (notification.getSmallIcon() != null) {
                    StatusBarNotification oldSbn = (old != null) ? old.sbn : null;
                    //当设置小图标，则通知NotificationListeners处理 【2.4】
                    mListeners.notifyPostedLocked(n, oldSbn);
                } else {
                    if (old != null && !old.isCanceled) {
                        mListeners.notifyRemovedLocked(n);
                    }
                }
                //处理该通知【2.10】
                buzzBeepBlinkLocked(r);
            }
        }
    }

### 2.4 NotificationListeners.notifyPostedLocked
[-> NMS.java]

    public class NotificationListeners extends ManagedServices {
        public void notifyPostedLocked(StatusBarNotification sbn, StatusBarNotification oldSbn) {
            TrimCache trimCache = new TrimCache(sbn);

            for (final ManagedServiceInfo info : mServices) {
                boolean sbnVisible = isVisibleToListener(sbn, info);
                boolean oldSbnVisible = oldSbn != null ? isVisibleToListener(oldSbn, info) : false;
                if (!oldSbnVisible && !sbnVisible) {
                    continue;
                }
                final NotificationRankingUpdate update = makeRankingUpdateLocked(info);

                //通知变得不可见，则移除老的通知
                if (oldSbnVisible && !sbnVisible) {
                    final StatusBarNotification oldSbnLightClone = oldSbn.cloneLight();
                    mHandler.post(new Runnable() {
                        public void run() {
                            notifyRemoved(info, oldSbnLightClone, update);
                        }
                    });
                    continue;
                }

                final StatusBarNotification sbnToPost =  trimCache.ForListener(info);
                mHandler.post(new Runnable() {
                    @Override
                    public void run() {
                        notifyPosted(info, sbnToPost, update); //【见小节2.5】
                    }
                });
            }
        }
        ...
    }


### 2.5 NMS.notifyPosted

    private void notifyPosted(final ManagedServiceInfo info,
            final StatusBarNotification sbn, NotificationRankingUpdate rankingUpdate) {
        final INotificationListener listener = (INotificationListener)info.service;
        StatusBarNotificationHolder sbnHolder = new StatusBarNotificationHolder(sbn);
        try {
            // 【见小节2.6】
            listener.onNotificationPosted(sbnHolder, rankingUpdate);
        } catch (RemoteException ex) {
            ...
        }
    }

此处的listener来自于ManagedServiceInfo的service成员变量，接下来看看该listener具体的数据类型。

#### 2.5.1 BaseStatusBar.start
[-> BaseStatusBar.java]

    public void start() {
      ...
      //安装通知的初始化状态【2.5.2】
      mNotificationListener.registerAsSystemService(mContext,
          new ComponentName(mContext.getPackageName(), getClass().getCanonicalName()),
          UserHandle.USER_ALL);
      ...  
    }

#### 2.5.2 NLS.registerAsSystemService
[-> NotificationListenerService.java]

    public void registerAsSystemService(Context context, ComponentName componentName,
            int currentUser) throws RemoteException {
        if (mWrapper == null) {
            mWrapper = new NotificationListenerWrapper();
        }
        mSystemContext = context;
        //获取NMS的接口代理对象
        INotificationManager noMan = getNotificationInterface();
        //运行在主线程的handler
        mHandler = new MyHandler(context.getMainLooper());
        mCurrentUser = currentUser;
        //注册监听器【2.5.3】
        noMan.registerListener(mWrapper, componentName, currentUser);
    }

#### 2.5.3 registerListener
[-> NMS.java]

    private final IBinder mService = new INotificationManager.Stub() {
        ...
        
        public void registerListener(final INotificationListener listener,
                final ComponentName component, final int userid) {
            enforceSystemOrSystemUI("INotificationManager.registerListener");
            //此处的INotificationListener便是NotificationListenerWrapper对象 【2.5.4】
            mListeners.registerService(listener, component, userid);
        }
    }

mListeners的对象类型为ManagedServices。

#### 2.5.4 registerService
[-> ManagedServices.java]

    public void registerService(IInterface service, ComponentName component, int userid) {
        //【2.5.5】
        ManagedServiceInfo info = registerServiceImpl(service, component, userid);
        if (info != null) {
            onServiceAdded(info);
        }
    }

#### 2.5.5 registerService
[-> ManagedServices.java]

    private ManagedServiceInfo registerServiceImpl(final IInterface service,
             final ComponentName component, final int userid) {
         //将NotificationListenerWrapper对象保存到ManagedServiceInfo.service
         ManagedServiceInfo info = newServiceInfo(service, component, userid,
                 true, null, Build.VERSION_CODES.LOLLIPOP);
         //【2.5.6】
         return registerServiceImpl(info);
     }

 #### 2.5.6 registerService
 [-> ManagedServices.java]
 
     private ManagedServiceInfo registerServiceImpl(ManagedServiceInfo info) {
         synchronized (mMutex) {
             try {
                 info.service.asBinder().linkToDeath(info, 0);
                 mServices.add(info);
                 return info;
             } catch (RemoteException e) {
                 // already dead
             }
         }
         return null;
     }

可见，前面的listener便是指NotificationListenerWrapper对象。

### 2.6 NotificationListenerWrapper.onNotificationPosted
[-> NotificationListenerService.java]

    protected class NotificationListenerWrapper extends INotificationListener.Stub {

        public void onNotificationPosted(IStatusBarNotificationHolder sbnHolder,
                NotificationRankingUpdate update) {
            StatusBarNotification sbn;
            try {
                sbn = sbnHolder.get(); //获取sbn对象
            } catch (RemoteException e) {
                return;
            }

            synchronized (mLock) {
                applyUpdateLocked(update);
                if (sbn != null) {
                    SomeArgs args = SomeArgs.obtain();
                    args.arg1 = sbn;
                    args.arg2 = mRankingMap;
                    //【2.7】
                    mHandler.obtainMessage(MyHandler.MSG_ON_NOTIFICATION_POSTED,
                            args).sendToTarget();
                } else {
                    mHandler.obtainMessage(MyHandler.MSG_ON_NOTIFICATION_RANKING_UPDATE,
                            mRankingMap).sendToTarget();
                }
            }

        }
        ...
    }

此处的mHandler = new MyHandler(getMainLooper())，也就是运行在system_server主线程的handler

### 2.7 MyHandler
[-> NotificationListenerService.java]

    private final class MyHandler extends Handler {
        ...
        public void handleMessage(Message msg) {
            ...
            switch (msg.what) {
                case MSG_ON_NOTIFICATION_POSTED: {
                    SomeArgs args = (SomeArgs) msg.obj;
                    StatusBarNotification sbn = (StatusBarNotification) args.arg1;
                    RankingMap rankingMap = (RankingMap) args.arg2;
                    args.recycle();
                    onNotificationPosted(sbn, rankingMap);
                } break;
                case ...
            }
        }
    }

此处调用NotificationListenerService实例对象的onNotificationPosted()

### 2.8  NLS.onNotificationPosted
[-> BaseStatusBar.java]

    private final NotificationListenerService mNotificationListener =
            new NotificationListenerService() {
        
        public void onNotificationPosted(final StatusBarNotification sbn,
                final RankingMap rankingMap) {
            if (sbn != null) {
                mHandler.post(new Runnable() {
                    public void run() {
                        ...
                        String key = sbn.getKey();
                        boolean isUpdate = mNotificationData.get(key) != null;
                        
                        if (isUpdate) {
                            updateNotification(sbn, rankingMap);
                        } else {
                            //【2.9】
                            addNotification(sbn, rankingMap, null );
                        }
                    }
                });
            }
        }
    }

### 2.9 addNotification
[-> PhoneStatusBar.java]

    public void addNotification(StatusBarNotification notification, RankingMap ranking,
            Entry oldEntry) {
        mNotificationData.updateRanking(ranking);   //更新排序
        //创建通知视图【2.9.1】
        Entry shadeEntry = createNotificationViews(notification);
        if (shadeEntry == null) {
            return;
        }
        ...
        //添加到通知栏
        addNotificationViews(shadeEntry, ranking);
        // Recalculate the position of the sliding windows and the titles.
        setAreThereNotifications();
    }

如果创建的通知视图为空则会直接返回。

#### 2.9.1 createNotificationViews
[-> BaseStatusBar.java]

    protected NotificationData.Entry createNotificationViews(StatusBarNotification sbn) {
        final StatusBarIconView iconView = createIcon(sbn);
        if (iconView == null) {
            return null;
        }

        NotificationData.Entry entry = new NotificationData.Entry(sbn, iconView);
        if (!inflateViews(entry, mStackScroller)) {
            handleNotificationError(sbn, "Couldn't expand RemoteViews for: " + sbn);
            return null;
        }
        return entry;
    }
    
### 2.10 buzzBeepBlinkLocked
[-> NMS.java]

    void buzzBeepBlinkLocked(NotificationRecord record) {
        ...
        final Notification notification = record.sbn.getNotification();
        final String key = record.getKey();

        if ((disableEffects == null || (smsRingtone && mInCall))
                && (record.getUserId() == UserHandle.USER_ALL ||
                    record.getUserId() == currentUser ||
                    mUserProfiles.isCurrentProfile(record.getUserId()))
                && canInterrupt && mSystemReady && mAudioManager != null) {

            if (!(record.isUpdate && (notification.flags & Notification.FLAG_ONLY_ALERT_ONCE) != 0)) {
                sendAccessibilityEvent(notification, record.sbn.getPackageName());
                if (hasValidSound) {
                    boolean looping = (notification.flags & Notification.FLAG_INSISTENT) != 0;
                    AudioAttributes audioAttributes = audioAttributesForNotification(notification);
                    mSoundNotificationKey = key;
                    if ((mAudioManager.getStreamVolume(
                            AudioAttributes.toLegacyStreamType(audioAttributes)) != 0)
                            && !audioManager.isAudioFocusExclusive()）{
                        final IRingtonePlayer player = mAudioManager.getRingtonePlayer();
                        //播放声音
                        player.playAsync(soundUri, record.sbn.getUser(), looping, audioAttributes);
                        beep = true;
                    }
                }

                if (hasValidVibrate && !(mAudioManager.getRingerModeInternal()
                        == AudioManager.RINGER_MODE_SILENT)）{
                    mVibrateNotificationKey = key;
                    //触发震动
                    if (useDefaultVibrate || convertSoundToVibration) {
                        mVibrator.vibrate(record.sbn.getUid(), record.sbn.getOpPkg(),
                                useDefaultVibrate ? mDefaultVibrationPattern
                                        : mFallbackVibrationPattern,
                                ((notification.flags & Notification.FLAG_INSISTENT) != 0)
                                        ? 0: -1, audioAttributesForNotification(notification));
                        buzz = true;
                    } else if (notification.vibrate.length > 1) {
                        mVibrator.vibrate(record.sbn.getUid(), record.sbn.getOpPkg(),
                                notification.vibrate,
                                ((notification.flags & Notification.FLAG_INSISTENT) != 0)
                                        ? 0: -1, audioAttributesForNotification(notification));
                        buzz = true;
                    }
                }
            }

        }
        
        //如果通知被更新，则取消当前正在播放的声音或者震动
        if (wasBeep && !hasValidSound) {
            clearSoundLocked();
        }
        if (wasBuzz && !hasValidVibrate) {
            clearVibrateLocked();
        }

        boolean wasShowLights = mLights.remove(key);
        //更新指示灯
        if ((notification.flags & Notification.FLAG_SHOW_LIGHTS) != 0 && aboveThreshold
              && ((record.getSuppressedVisualEffects()
               & NotificationListenerService.SUPPRESSED_EFFECT_SCREEN_OFF) == 0)) {
            mLights.add(key);
            updateLightsLocked();
            blink = true;
        } else if (wasShowLights) {
            updateLightsLocked();
        }
        
        if (buzz || beep || blink) {
            if (((record.getSuppressedVisualEffects()
                    & NotificationListenerService.SUPPRESSED_EFFECT_SCREEN_OFF) != 0)) {
            } else {
                mHandler.post(mBuzzBeepBlinked);
            }
        }
    }


## 三. 小结

整个过程涉及到3个Handler都是运行在system_server的主线程：NMS的mHandler运，NLS的mHandler，以及BaseStatusBar的mHandler。

一次通知发送的过程，在system_server进程里面经过了步骤[2.3]，[2.4]，[2.6]，[2.8]共四次的handler异步处理。
对于这种异步的使用过于频繁，其反而性能变差，每一次post的过程，都需要等待前面的message执行完成才能继续往下走，可见通知架构设计得有些混乱。

另外，这里需要注意的是前台服务也会显示通知，该通知是为了提升服务的优先级，并且让用户可感知该服务的存在，以防止进程被杀，比如音乐播放。
对于常规的通知可通过点击通知(允许清除的通知)或者点击通知栏的清除按钮来清除。
