以调试的视角来看待系统启动


现有的控制自启动的地方:限制自启动

    AMS.getContentProviderImpl
    AMS.startService
    AMS.startServiceInPackage
    AMS.bindService
    ASS.startActivityMayWait

11-23 14:05:03.549  1275  1275 I MIUI-AS : phase 3 service ServiceRecord{8188751 u0 com.android.defcontainer/.DefaultContainerService}, android.content.Intent$FilterComparison@6cd2de57
11-23 14:05:03.566  1275  1275 I MIUI-AS : phase 3 service ServiceRecord{daf2 u0 com.android.server.telecom/.components.TelecomService}, android.content.Intent$FilterComparison@3ab92c33

#### 其他

ExtraAMS
WhetstoneAMS :: removeActivityFromHistoryLocked

PKMS injector.initExtraGuard,会启动服务DefaultContainerService




#### 进程启动

12-21 14:28:20.218  1267  1267 I ActivityManager: ===> yhh com.android.defcontainer, allow:false

其他进程都是mProcessesReady之后启动的,也就是如下过程:

goingCallback.run()

addAppLocked(info, false, null); //启动所有的persistent进程

也就是说persistent之前启动的进程,都是在goingCallback.run()过程

#### 第一个进程(起不来)

com.android.defcontainer


12-21 14:28:20.215  1267  1267 W ContextImpl: Calling a method 
in the system process without a qualified user: android.app.ContextImpl.bindService:1300 
miui.provider.ExtraGuard.init:69 com.android.server.pm.PackageManagerServiceInjector.initExtraGuard:421
com.android.server.pm.PackageManagerService.systemReady:15164
com.android.server.SystemServer.startOtherServices:1090 

并不允许启动, 在startProcessLocked过程会加入欧尼-hold队列,  直到 AMS.finishBooting()方法才会启动.


#### 进程

12-23 09:54:41.354  1275  1275 I SystemServiceManager: Starting phase 550
// WebViewFactory.prepareWebViewInSystemServer();
12-23 09:55:01.403  1275  1275 I am_proc_start: [0,3200,1037,WebViewLoader-armeabi-v7a,,]
12-23 09:55:01.413  1275  1275 I am_proc_start: [0,3211,1037,WebViewLoader-arm64-v8a,,]
// startSystemUi(context);
12-23 09:55:01.551  1275  1275 I am_proc_start: [0,3226,1000,com.android.systemui,service,com.android.systemui/.SystemUIService]


12-23 09:55:02.687  1275  1275 I SystemServiceManager: Starting phase 600
//goingCallback.run() 剩下的东西
12-23 09:55:02.699  1275  1275 I am_proc_start: [0,3334,1000,com.securespaces.android.ssm.service,service,com.securespaces.android.ssm.service/.NotificationListener]
12-23 09:55:02.727  1275  1275 I am_proc_start: [0,3351,10126,com.baidu.input_mi,service,com.baidu.input_mi/.ImeService]
12-23 09:55:02.761  1275  1275 I am_proc_start: [0,3365,10034,com.amap.android.location,service,com.amap.android.location/.NetworkLocationService]
12-23 09:55:02.812  1275  1275 I am_proc_start: [0,3399,10060,com.xiaomi.metok,service,com.xiaomi.metok/.MetokLocationService]


// addApp
12-23 09:55:02.854  1275  1275 I am_proc_start: [0,3447,1000,com.quicinc.cne.CNEService,added application,com.quicinc.cne.CNEService]
12-23 09:55:02.875  1275  1275 I am_proc_start: [0,3465,1001,com.qualcomm.qcrilmsgtunnel,added application,com.qualcomm.qcrilmsgtunnel]
12-23 09:55:02.888  1275  1275 I am_proc_start: [0,3482,1000,com.miui.whetstone,added application,com.miui.whetstone]
12-23 09:55:02.901  1275  1275 I am_proc_start: [0,3497,10094,com.xiaomi.xmsf,added application,com.xiaomi.xmsf]
12-23 09:55:02.914  1275  1275 I am_proc_start: [0,3512,1001,com.qualcomm.qti.rcsbootstraputil,added application,com.qualcomm.qti.rcsbootstraputil]
12-23 09:55:02.925  1275  1275 I am_proc_start: [0,3525,1000,com.fingerprints.serviceext,added application,com.fingerprints.serviceext]
12-23 09:55:02.937  1275  1275 I am_proc_start: [0,3538,10012,com.xiaomi.finddevice,added application,com.xiaomi.finddevice]
12-23 09:55:02.949  1275  1275 I am_proc_start: [0,3552,1000,com.qualcomm.qti.services.secureui:sui_service,added application,com.qualcomm.qti.services.secureui:sui_service]
12-23 09:55:02.963  1275  1275 I am_proc_start: [0,3567,1001,com.android.phone,added application,com.android.phone]


// ExtraActivityManagerService.onSystemReady(mContext);
12-23 09:55:03.037  1275  1275 I am_proc_start: [0,3593,10085,com.miui.systemAdSolution,service,com.miui.systemAdSolution/.splashscreen.SplashScreenService]

//进入Loop
12-23 09:55:03.332  1275  1275 I am_proc_start: [0,3697,10013,com.android.incallui,service,com.android.incallui/.InCallServiceImpl]
12-23 09:55:08.384  1275  1275 I am_proc_start: [0,4855,10003,com.android.calendar,broadcast,com.android.calendar/.widget.AgendaWidgetProvider]
12-23 09:55:12.568  1275  1275 I am_proc_start: [0,5273,1001,org.codeaurora.ims,broadcast,org.codeaurora.ims/.ImsServiceAutoboot]
12-23 09:57:01.757  1275  1275 I am_proc_start: [0,6055,9802,com.android.updater,service,com.android.updater/.UpdateService]
12-23 09:57:01.776  1275  1275 I am_proc_start: [0,6067,9801,com.android.thememanager,service,com.android.thememanager/.service.ThemeTaskService]

以上是主线程的情况, 其实system_server还有其他线程也会启动线程.这是并行的.


#### 第二份完整进程


12-23 10:53:55.506  1276  2607 I ActivityManager: Start proc 2750:android.process.media/u0a10 for broadcast com.android.providers.media/.MtpReceiver
12-23 10:53:55.542  1276  1276 I ActivityManager: Start proc 2763:WebViewLoader-armeabi-v7a/1037 [android.webkit.WebViewFactory$RelroFileCreator] for 
12-23 10:53:55.562  1276  2607 I ActivityManager: Start proc 2777:com.android.externalstorage/u0a11 for broadcast com.android.externalstorage/.MountReceiver
12-23 10:53:55.575  1276  1276 I ActivityManager: Start proc 2789:WebViewLoader-arm64-v8a/1037 [android.webkit.WebViewFactory$RelroFileCreator] for 
12-23 10:53:55.588  1276  1276 I ActivityManager: Start proc 2801:com.android.systemui/1000 for service com.android.systemui/.SystemUIService

12-23 10:53:56.026  1276  2605 I ActivityManager: Start proc 2881:com.android.settings/1000 for broadcast com.android.settings/.AnalyticsReceiver
12-23 10:53:56.309  1276  1276 I ActivityManager: Start proc 2936:com.securespaces.android.ssm.service/1000 for service com.securespaces.android.ssm.service/.NotificationListener
12-23 10:53:56.344  1276  1276 I ActivityManager: Start proc 2955:com.baidu.input_mi/u0a126 for service com.baidu.input_mi/.ImeService
12-23 10:53:56.385  1276  1276 I ActivityManager: Start proc 2977:com.amap.android.location/u0a34 for service com.amap.android.location/.NetworkLocationService
12-23 10:53:56.702  1276  1276 I ActivityManager: Start proc 3019:com.xiaomi.metok/u0a60 for service com.xiaomi.metok/.MetokLocationService

12-23 10:53:56.730  1276  1276 I ActivityManager: Start proc 3041:com.quicinc.cne.CNEService/1000 for added application com.quicinc.cne.CNEService
12-23 10:53:56.742  1276  1276 I ActivityManager: Start proc 3064:com.qualcomm.qcrilmsgtunnel/1001 for added application com.qualcomm.qcrilmsgtunnel
12-23 10:53:56.754  1276  1276 I ActivityManager: Start proc 3074:com.miui.whetstone/1000 for added application com.miui.whetstone
12-23 10:53:56.765  1276  1276 I ActivityManager: Start proc 3096:com.xiaomi.xmsf/u0a94 for added application com.xiaomi.xmsf
12-23 10:53:56.777  1276  1276 I ActivityManager: Start proc 3110:com.qualcomm.qti.rcsbootstraputil/1001 for added application com.qualcomm.qti.rcsbootstraputil
12-23 10:53:56.790  1276  1276 I ActivityManager: Start proc 3131:com.fingerprints.serviceext/1000 for added application com.fingerprints.serviceext
12-23 10:53:56.805  1276  1276 I ActivityManager: Start proc 3150:com.xiaomi.finddevice/u0a12 for added application com.xiaomi.finddevice
12-23 10:53:56.817  1276  1276 I ActivityManager: Start proc 3163:com.qualcomm.qti.services.secureui:sui_service/1000 for added application com.qualcomm.qti.services.secureui:sui_service
12-23 10:53:56.831  1276  1276 I ActivityManager: Start proc 3177:com.android.phone/1001 for added application com.android.phone
12-23 10:53:56.843  1276  1276 I ActivityManager: Start proc 3200:com.miui.core/u0a99 for added application com.miui.core

12-23 10:53:56.873  1276  1276 I ActivityManager: Start proc 3223:com.miui.home/u0a20 for activity com.miui.home/.launcher.Launcher
12-23 10:53:56.959  1276  2606 I ActivityManager: Start proc 3247:com.android.printspooler/u0a76 for service com.android.printspooler/.model.PrintSpoolerService
12-23 10:53:56.988  1276  1276 I ActivityManager: Start proc 3261:com.miui.systemAdSolution/u0a85 for service com.miui.systemAdSolution/.splashscreen.SplashScreenService


12-23 10:53:57.046  1276  3192 I ActivityManager: Start proc 3287:com.miui.networkassistant.deamon/1000 for content provider com.miui.securitycenter/com.miui.networkassistant.provider.NetworkAssistantProvider
12-23 10:53:57.183  1276  3221 I ActivityManager: Start proc 3325:com.android.htmlviewer/u0a54 for broadcast com.android.htmlviewer/com.android.settings.wifi.openwifi.OpenWifiReceiver
12-23 10:53:57.213  1276  2605 I ActivityManager: Start proc 3348:com.android.thememanager/9801 for content provider com.android.thememanager/.service.ThemeRuntimeDataProvider
12-23 10:53:57.372  1276  1276 I ActivityManager: Start proc 3422:com.android.incallui/u0a13 for service com.android.incallui/.InCallServiceImpl
12-23 10:53:57.451  1276  3456 I ActivityManager: Start proc 3461:android.process.acore/u0a5 for content provider com.android.providers.contacts/.CallLogProvider
12-23 10:53:57.481  1276  3460 I ActivityManager: Start proc 3476:com.miui.antispam:provider/1000 for content provider com.miui.antispam/.db.AntiSpamProvider
12-23 10:53:57.500  3074  3074 E Whetstone-JNI: start process [index 0] forked(true) ,pid(558), uid(0), processName(zygote), property(1)
12-23 10:53:57.500  3074  3074 E Whetstone-JNI: start process [index 1] forked(true) ,pid(1276), uid(1000), processName(system_server), property(1)
12-23 10:53:57.500  3074  3074 E Whetstone-JNI: start process [index 2] forked(true) ,pid(3074), uid(1000), processName(com.miui.whetstone), property(1)
12-23 10:53:57.522  1276  3176 I ActivityManager: Start proc 3496:com.miui.voip/1001 for service com.miui.voip/.service.RemoteMiuiVoipService
12-23 10:53:57.579  1276  2775 I ActivityManager: Start proc 3546:com.miui.sysbase/u0a86 for service com.miui.sysbase/.MetokClService
12-23 10:53:57.616  1276  3149 I ActivityManager: Start proc 3589:com.miui.klo.bugreport/1000 for service com.miui.klo.bugreport/.service.FeedbackBackgroundService
12-23 10:53:57.680  1276  3138 I ActivityManager: Start proc 3619:com.miui.powerkeeper:service/1000 for service com.miui.powerkeeper/.PowerKeeperBackgroundService
12-23 10:53:57.859  1276  3149 I ActivityManager: Start proc 3725:com.miui.guardprovider/u0a53 for service com.miui.guardprovider/.manager.SecurityService
12-23 10:53:57.887  1276  3176 I ActivityManager: Start proc 3750:com.miui.securitycenter.remote/1000 for service com.miui.securitycenter/.memory.MemoryCheckService
12-23 10:53:58.686  1276  3149 I ActivityManager: Start proc 3987:com.android.smspush/u0a90 for service com.android.smspush/.WapPushManager
12-23 10:53:58.717  1276  2812 I ActivityManager: Start proc 4009:com.xiaomi.market/u0a67 for service com.xiaomi.market/.data.MarketService
12-23 10:53:58.782  1276  2604 I ActivityManager: Start proc 4036:com.lbe.security.miui/u0a0 for content provider com.lbe.security.miui/com.lbe.security.service.provider.PermissionManagerProvider
12-23 10:53:58.927  1276  2775 I ActivityManager: Start proc 4071:com.miui.networkassistant.shadow/1000 for content provider com.miui.securitycenter/com.miui.networkassistant.provider.ResourceHelperProvider
12-23 10:53:59.160  1276  3231 I ActivityManager: Start proc 4127:com.miui.player/u0a22 for broadcast com.miui.player/.scanner.FileScannerReceiver
12-23 10:53:59.164  3074  3892 D WtProcessController: [ALLOW] [broadcast]callerPackage android start process with Intent { act=android.intent.action.MEDIA_MOUNTED dat=file:///storage/emulated/0 flg=0x4000010 (has extras) } componentName{com.miui.player/com.miui.player.scanner.FileScannerReceiver}
12-23 10:53:59.447  1276  3148 I ActivityManager: Start proc 4167:com.android.quicksearchbox/u0a78 for content provider com.android.quicksearchbox/.xiaomi.XiaomiSuggestionProvider
12-23 10:53:59.674  1276  3192 I ActivityManager: Start proc 4193:com.miui.weather2/u0a32 for content provider com.miui.weather2/.providers.WeatherProvider
12-23 10:53:59.850  4127  4127 E ApplicationHelper: start process, name=com.miui.player
12-23 10:53:59.907  1276  2604 I ActivityManager: Start proc 4310:com.miui.systemAdSolution:remote/u0a85 for service com.miui.systemAdSolution/.landingPage.LandingPageService
12-23 10:54:00.142  1276  3192 I ActivityManager: Start proc 4345:com.miui.player:download/u0a22 for broadcast com.miui.player/com.android.providers.downloads.receiver.DownloadReceiver
12-23 10:54:00.143  3074  3105 D WtProcessController: [ALLOW] [broadcast]callerPackage android start process with Intent { act=android.intent.action.MEDIA_MOUNTED dat=file:///storage/emulated/0 flg=0x4000010 (has extras) } componentName{com.miui.player/com.android.providers.downloads.receiver.DownloadReceiver}
12-23 10:54:00.428  4345  4345 E ApplicationHelper: start process, name=com.miui.player:download
12-23 10:54:00.560  1276  3222 I ActivityManager: Start proc 4411:com.android.fileexplorer:remote/u0a50 for broadcast com.android.fileexplorer/com.android.midrive.service.MediaMountedReceiver
12-23 10:54:00.561  3074  3796 D WtProcessController: [ALLOW] [broadcast]callerPackage android start process with Intent { act=android.intent.action.MEDIA_MOUNTED dat=file:///storage/emulated/0 flg=0x4000010 (has extras) } componentName{com.android.fileexplorer/com.android.midrive.service.MediaMountedReceiver}
12-23 10:54:01.463  1276  2604 I ActivityManager: Start proc 4528:com.mfashiongallery.emag/u0a110 for content provider com.mfashiongallery.emag/.LockscreenMagazineProvider
12-23 10:54:01.880  1276  3221 I ActivityManager: Start proc 4592:com.miui.voip:ui/1001 for broadcast com.miui.voip/.event.UIEventReceiver
12-23 10:54:02.142  1276  3115 I ActivityManager: Start proc 4623:com.miui.virtualsim/1001 for broadcast com.miui.virtualsim/.receiver.SimStateChangeReceiver
12-23 10:54:02.166  1276  3193 I ActivityManager: Start proc 4636:com.xiaomi.providers.appindex/u0a37 for content provider com.xiaomi.providers.appindex/.AppIndexContentProvider

12-23 10:54:02.351  1276  2612 I ActivityManager: Start proc 4672:com.android.defcontainer/u0a9 for on-hold


