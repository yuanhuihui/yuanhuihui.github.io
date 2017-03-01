
### 1. AMS

- "ActivityManager", AMS.mHandler, 常见消息：service/contentprovider/process/idle/sleep超时，activity launch/pause/stop/destroy超时
等等，各种anr处理消息。
- "android.ui", AMS.mUiHandler，常见消息：anr/crash/debugger等提示窗口；

### 2. WMS

- android.display, WMS.mH, 常见消息：DO_TRAVERSAL，startingwindow启动/结束，
- android.ui, PhoneWindowManager.mHandler

### 3. IMS

- android.display, IMS.mHandler
- InputReader
- InputDispatcher


### 4. PKMS

- “PackageManager”, PKMS.mHandler
- “andorid.fg”，
- "android.io"

### 几个线程

- display: WMS, IMS
- ui: AMS, WMS, DisplayManagerService,
- io: PackageInstaller, connectivity, BT,MountService,JobStore
- fg: Account，Network, Dream，Battery, UsbDevice, MountService, PKMS
- bg:SyncManager,BatteryStats等
