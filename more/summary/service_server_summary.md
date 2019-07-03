
### 1. AMS

- "ActivityManager": AMS.mHandler, 常见消息：service/contentprovider/process/idle/sleep超时，activity launch/pause/stop/destroy超时
等等，各种anr处理消息。
- "android.ui": AMS.mUiHandler，常见消息：anr/crash/debugger等提示窗口；

### 2. WMS

- android.display: WMS.mH, 常见消息：DO_TRAVERSAL，startingwindow启动/结束，
- android.ui: PhoneWindowManager.mHandler

### 3. IMS

- android.display: IMS.mHandler
- InputReader
- InputDispatcher


### 4. PKMS

- “PackageManager”: PKMS.mHandler
- “andorid.fg”，
- "android.io"


## 二. SystemServer所有的Handler线程

handler线程便有40-50个.

### 2.1 常规的服务线程

1. "android.display", 优先级 THREAD_PRIORITY_DISPLAY, 用于WMS, IMS
2. "android.ui", 优先级 THREAD_PRIORITY_FOREGROUND, 用于WMS, AMS, DisplayManagerService
3. "android.fg", 优先级 THREAD_PRIORITY_DEFAULT, 用于Account，Network, Dream，Battery, UsbDevice, MountService, PKMS
4. "android.io", 优先级 THREAD_PRIORITY_DEFAULT, 用于PackageInstaller, connectivity, BT, MountService, JobStore
5. "android.bg", 优先级 THREAD_PRIORITY_BACKGROUND, 用于SyncManager,BatteryStats等

### 2.2 其他的handler线程

1. "ActivityManager", 优先级THREAD_PRIORITY_FOREGROUND, 用于AMS
2. "PowerManagerService", 优先级 THREAD_PRIORITY_DISPLAY, 用于PMS
3. "PackageManager", 优先级 THREAD_PRIORITY_BACKGROUND, 用于PKMS
4. "PackageDexOptimizerManager", 优先级 THREAD_PRIORITY_BACKGROUND, 用于dex
5. "CameraService_proxy", 优先级 THREAD_PRIORITY_DISPLAY, 用于camera


### 2.3 其他线程

main

1. PackageInstaller
2. PackageDexOptimizerManager
2. MountService
3. NetworkStats
4. NetworkPolicy
5. WifiP2pService
6. WifiStateMachine
7. WifiWatchdogStateMachine
7. WifiScanningService
7. WifiRttService
7. WifiService
8. WifiManager
8. ConnectivityServiceThread
8. EthernetServiceThread
8. NetworkTimeUpdateService


9. Tethering
10. NsdService
11. ranker
12. notification-sqlite-log
13. LocationPolicy


1. AudioService
2. SecurityWriteHandlerThread
3. SecurityManagerService
4. MiuiBackup
5. PowerKeeperPolicy
6. backup
7. SyncHandler-0
8. AsyncQueryWorker
9. IzatServiceBase
10. GNPProxy
11. LBSSystemMonitorService
12. ScreenshotUtils
