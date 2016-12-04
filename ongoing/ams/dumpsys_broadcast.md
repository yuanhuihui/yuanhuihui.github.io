## 一 Broadcast

    dumpsys activity b


### 1.1 Registered Receivers

    Registered Receivers:
    //含义：ReceiverList{hashcode pid 进程名/uid/userId local:hashcode}
    * ReceiverList{436254c0 32365 system/1000/u0 local:436252d8}
      //含义：ProcessRecord=pid:进程名/uid
      app=32365:system/1000 pid=32365 uid=1000 user=0
      //含义：BroadcastFilter{hashcode}
      Filter #0: BroadcastFilter{43625520}
        Action: "android.intent.action.PACKAGE_ADDED"
        Action: "android.intent.action.PACKAGE_REMOVED"
        Action: "android.intent.action.QUERY_PACKAGE_RESTART"
        Scheme: "package"
      Filter #1: BroadcastFilter{436256a8}
        Action: "android.intent.action.UID_REMOVED"
        Action: "android.intent.action.USER_STOPPED"
    * ReceiverList
    ...

Tips: ReceiverList中local是指Binder服务端，还可以是remote则代表Binder客户端。


### 1.2 Receiver Resolver Table

    Receiver Resolver Table:
    Non-Data Actions:
      android.intent.action.SCREEN_OFF:
        //含义：BroadcastFilter{hashcode userId ReceiverList{hashcode pid 进程名/uid/userId local:hashcode}}
        BroadcastFilter{433d2e60 u0 ReceiverList{433d3220 32365 system/1000/u0 local:433d35a0}}
        BroadcastFilter{4351e010 u0 ReceiverList{439b29b8 769 com.android.systemui/1000/u0 remote:43083d80}}
        BroadcastFilter{432643a8 u0 ReceiverList{432758e8 2540 com.miui.securitycenter/1000/u0 remote:433044f8}}
      ...

Tips: 用于查看以Action为key，对应的Receiver。



### 1.3  Historical broadcasts

Historical broadcasts分为 foreground和background

    Historical broadcasts [foreground]:
    Historical Broadcast foreground #0:
       //含义：BroadcastRecord{hashcode u`userId` `mAction`} to user -1
       BroadcastRecord{43500e48 u-1 android.intent.action.TIME_TICK} to user -1
       //含义：Intent { act=`mAction` flg=`mFlags` (Bundle是否为null) }
       Intent { act=android.intent.action.TIME_TICK flg=0x50000014 (has extras) }
         extras: Bundle[{android.intent.extra.ALARM_COUNT=1}]
       //含义：caller=调用者包名 调用者ProcessRecord pid=掉用者pid uid=调用者uid
       caller=android null pid=-1 uid=1000
       dispatchClockTime=Mon May 23 20:32:00 GMT+08:00 2016
       dispatchTime=-16s713ms finishTime=-16s657ms
       resultTo=null resultCode=0 resultData=null
       resultAbort=false ordered=true sticky=false initialSticky=false
       nextReceiver=6 receiver=null
       //含义：Receiver #0: (该广播的Receiver)
       Receiver #0: BroadcastFilter{4327bf78 u0 ReceiverList{4327ea50 32365 system/1000/u0 local:432864f8}}
       Receiver #1: BroadcastFilter{438d3600 u0 ReceiverList{438d35a0 769 com.android.systemui/1000/u0 remote:438d2e00}}
       Receiver #2: BroadcastFilter{42f027a0 u0 ReceiverList{42f02740 769 com.android.systemui/1000/u0 remote:42f02418}}
    Historical Broadcast foreground #1:
    ...

    //含义：列举所有广播action
    Historical broadcasts summary [foreground]:
    #0: act=android.intent.action.SCREEN_OFF flg=0x50000010
      //disp-enq=3ms,fin-disp=128ms
      +3ms dispatch +128ms finish
      //含义：EnqueueTime，DispatchTime，FinishTime
      enq=2016-05-25 10:31:59 disp=2016-05-25 10:31:59 fin=2016-05-25 10:31:59
    #1: act=android.intent.action.CLOSE_SYSTEM_DIALOGS flg=0x50000010 (has extras)
      0 dispatch +2ms finish
      enq=2016-05-25 10:31:58 disp=2016-05-25 10:31:58 fin=2016-05-25 10:31:58
      extras: Bundle[{reason=lock}]
    ...


Tips: dispatchTime分发时间，finishTime完成时间，差值可以看出这条广播处理时间长短。
还有一个字段anrCount，代表这条广播触发了多少ANR。


列举了前台广播；紧接着便是后台广播信息，基本类似：

    Historical broadcasts [background]:
    Historical broadcasts summary [background]:

### 1.4 Sticky broadcasts

    Sticky broadcasts for user -1:
    * Sticky action android.hardware.usb.action.USB_STATE:
      Intent: act=android.hardware.usb.action.USB_STATE flg=0x30000010
        Bundle[{connected=true, unlocked=false, adb=true, mtp=true, configured=true}]
    * Sticky action ...

Tips: 列举Sticky类型的广播

### 1.5 mHandler

    mBroadcastsScheduled [foreground]=false //前台不存在正在途中的广播
    mBroadcastsScheduled [background]=true  //后台存在正在途中的广播
    mHandler:
    //含义：(this类名) @  uptimeMillis
    Handler (com.android.server.am.ActivityManagerService$MainHandler) {9ab9300} @ 14204904
      //含义：Looper (线程名, tid 线程id) {hashcode}
      Looper (ActivityManager, tid 16) {6d7c739}
        //含义：{when=下次触发时间 what=消息码 target=目标处理类名}
        Message 0: { when=+1s247ms what=58 target=com.android.server.am.ActivityManagerService$MainHandler }
        Message 1: { when=+53s361ms callback=com.android.server.AppOpsService$1 target=com.android.server.am.ActivityManagerService$MainHandler }
        Message 2: { when=+11m1s232ms what=27 target=com.android.server.am.ActivityManagerService$MainHandler }
        (Total messages: 3, polling=false, quitting=false)

Tips: uptimeMillis代表的是系统运行时间，不含sleep时间，单位ms。
quitting是指MessageQueue是否正在退出，当quitting=true，则polling=false；当quitting=false，则通过nativeIsPolling()来判定是否轮询中。


### 1.6 调用链

命令`dumpsys activity b`的调用链接

      AMS.dump
        AMS.dumpBroadcastsLocked
          //part 1 (Loop:mRegisteredReceivers)
          ReceiverList.dump
            BroadcastFilter.dump

          //part 2
          IntentResolver.dump  

          //part 3 (Loop:mBroadcastQueues)
          BroadcastQueue.dumpLocked
            BroadcastRecord.dump

          //part 4 (Loop:mStickyBroadcasts)

          //part 5
          Handler.dump
            Looper.dump
              MessageQueue.dump
