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
