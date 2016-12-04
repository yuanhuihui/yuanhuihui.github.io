## provider

### 1. Published single-user content providers (by class):

    Published single-user content providers (by class):
    //含义：{hashcode userId 组件名}
    * ContentProviderRecord{bb8ad9f u0 com.android.providers.settings/.SettingsProvider}
       //含义：package=所在包名 process=所在进程名
       package=com.android.providers.settings process=system
       proc=ProcessRecord{5f31c64 24161:system/1000}
       uid=1000 provider=android.content.ContentProvider$Transport@cdfd762
       singleton=true
       authority=settings
       isSyncable=false multiprocess=false initOrder=100
       //所有已连接的客户端
       Connections:
         // [ProcessRecord]  stableCount/numStableIncs unstableCount/numUnstableIncs 连接总时长
         -> 24408:com.android.systemui/1000 s1/1 u0/0 +3d13h43m25s425ms
         -> 25095:com.android.nfc/1027 s1/1 u0/0 +3d13h43m22s260ms
         -> 25152:com.android.phone/1001 s1/1 u0/0 +3d13h43m21s975ms
     ...

Tips:
- multiprocess=false是指该ContentProvider只允许单例模式运行在某个进程，而不能在多个进程存在实例。
- Connections：还有字段WAITING（代表Client正在等待Provider出现，通过lock来保证）和DEAD（代表provider连接已断）；
- stableCount/unstableCount，在AMS.incProviderCountLocked进行加1操作，AMS.decProviderCountLocked进行减1操作；
numStableIncs/numUnstableIncs只进行加1并不进行减1，意味着记录的是总的次数。


### 2. Published user [n] content providers (by class):

    Published user 0 content providers (by class):
    * ContentProviderRecord{fa351f u0 com.android.providers.applications/.ApplicationsProvider}
      package=com.android.providers.applications process=android.process.acore
      proc=ProcessRecord{2eafc9b 25520:android.process.acore/u0a5}
      uid=10005 provider=android.content.ContentProviderProxy@bb2406c
      authority=applications
      Connections:
        -> 18943:com.android.quicksearchbox/u0a81 s1/1 u0/4 +24m51s313ms
    ...

### 3. Single-user authority to provider mappings:

    Single-user authority to provider mappings:
    //含义： key: hashcode/包名/类名
    mms-sms: 4d3c36d/com.android.providers.telephony/.MmsSmsProvider
    com.android.server.heapdump: 6baad4a/android/com.android.server.am.DumpHeapProvider
    ...

### 4. User [n] authority to provider mappings:

     User 0 authority to provider mappings:
     com.android.calendar: fb86756/com.android.providers.calendar/.CalendarProvider2
     ...

### 调用链

    AMS.dump
        AMS.dumpProvidersLocked
            ProviderMap.dumpProvidersLocked
                 //part 1
                ProviderMap.dumpProvidersByClassLocked
                    ContentProviderRecord.dump
                        ContentProviderConnection.toClientString

                //part 2  (Loop: mProvidersByClassPerUser)
                ProviderMap.dumpProvidersByClassLocked
                    ContentProviderRecord.dump
                        ContentProviderConnection.toClientString

                //part 3
                ProviderMap.dumpProvidersByNameLocked
                    ContentProviderRecord.toShortString

                //part 4 (Loop: mProvidersByNamePerUser)
                ProviderMap.dumpProvidersByNameLocked
                    ContentProviderRecord.toShortString


### 其他

返回回调链表

    handleAppDiedLocked
        appDiedLocked  false,true
            binderdied
        startProcessLocked​  true,true
        removeProcessLocked 自定义参数  
            kill进程
            systemReady
            handleAppCrash
            processContentPRoviderPublishTimeout
        attachApplicationLocked true,true

### 其他2

03-15 16:05:47.912  3136  5542 I am_kill :
[0,13600,com.android.contacts,0,depends on provider com.miui.yellowpage/.providers.yellowpage.YellowPageProvider in dying proc com.miui.yellowpage]

06-30 17:12:18.406 10059 10906 I ActivityManager: Start proc
18282:com.miui.yellowpage/u0a5 for content provider com.miui.yellowpage/.providers.yellowpage.YellowPageProvider


dumpsys activity p com.miui.yellowpage | grep curRaw
