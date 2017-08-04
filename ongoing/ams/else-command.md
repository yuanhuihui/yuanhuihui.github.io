## dumpsys package


dumpsys package 常见参数:

    p[ackages]:  查询已安装的应用包
    <packagename>: 查询指定应用包的信息
    r[esolvers] [activity|service|receiver|content]: 查询intent resolvers
    prov[iders]: 查询content providers

    l[ibraries]: 查询已知共享库
    f[ibraries]: 查询设备features
    k[eysets]: 查询已知的keysets
    version: 查询数据库版本, 包括ROM版本
    m[essages]: 收集packge相关的运行时事件

    perm[issions]: dump permissions
    permission [name ...]: dump declaration and use of given permission
    check-permission <permission> <package> [<user>]: does pkg hold perm?
    pref[erred]: print preferred package settings
    preferred-xml [--full]: print preferred package settings as xml
    s[hared-users]: dump shared user IDs


其中

dumpsys package r

    Activity Resolver Table:
    Receiver Resolver Table:
    Service Resolver Table:
    Provider Resolver Table:


dumpsys package prov

    Registered ContentProviders: //所有已注册的provider
    ContentProvider Authorities: // auth --> provider映射关系


## dumpsys input


输出内容分别为EventHub.dump(),InputReader.dump(),InputDispatcher.dump()这3类,另外如果发生过input ANR,那么也会输出上一个ANR的状态.


    Event Hub State: //输出EventHub设备信息
    Input Reader State: //输出InputReader信息
    Input Dispatcher State: //输出InputDispatcher信息



## dumpsys window

dumpsys window

    d[isplays]: //跟activity具有对应关系, active display contents
    t[okens]: token list
    w[indows]: window list

#### displays

关系: WMS -> DisplayContent -> TaskStack -> Task -> AppWindowToken

WMS: SparseArray<DisplayContent> mDisplayContents
DisplayContent: ArrayList<TaskStack> mStacks
TaskStack: ArrayList<Task> mTasks
Task: AppTokenList mAppTokens
AppTokenList: AppWindowToken

#### windows

WMS: SparseArray<DisplayContent> mDisplayContents
DisplayContent: WindowList mWindows
WindowList: WindowState

#### tokens

WMS: HashMap<IBinder, WindowToken> mTokenMap


## 其他


  dumpsys package
  dumpsys input
  dumpsys window

  dumpsys alarm
  dumpsys processinfo
  dumpsys permission
  dumpsys meminfo
  dumpsys cpuinfo
  dumpsys dbinfo
  dumspys gfxinfo

  dumpsys power
  dumpsys battery
  dumpsys batterystats
  dumpsys batteryproperties

  dumpsys procstats
  dumpsys diskstats
  dumpsys graphicsstats
  dumpsys usagestats
  dumpsys devicestoragemonitor
  dumpsys dropbox

  dumpsys appops
  dumpsys SurfaceFlinger



### dumpsys cpuinfo

MEmBinder

ProcessCpuTracker.java

每个更新是通过update()方法，而该方法只有在

- AMS.updateCpuStatsNow
- AMS.dumpStackTraces (2次)
- ProcessCpuTracker.init (初始化1次)
- LoadAverageService.handleMessage (msg=1)


dumpStackTraces，会出现在

- appNotResponding
- Watchdog.run (waitState==WAITED_HALF)


AMS.updateCpuStatsNow，只会在

- appNotResponding
- batteryNeedsCpuUpdate
- batteryPowerChanged
- checkExcessivePowerUsageLocked
- dumpApplicationMemoryUsage
- mBgHandler.handleMessage  (COLLECT_PSS_BG_MSG)
- reportMemUsage
- CpuTracker.run


## wm

交由服务WindowManagerService来完成

查看

	wm density
	wm size

修改

	wm density 480
	wm size 1080x1920


## input

交由服务InputManagerService类的injectInputEvent()方法完成

格式：

    input text <string>
    input keyevent <key code number or name>
    input tap <x> <y>
    input swipe <x1> <y1> <x2> <y2>

例如：

	input text hello    //输入字符串“hello”
	input tap 100 200    //点击坐标（100，200）
	input swipe 100 100 200 200    //从坐标（100，100）滑动到（200，200）

	input keyevent --longpress 3   //长按Home键
	input keyevent 4  //按Back键
	input keyevent 24 //按音量(+)键
	input keyevent 25 //按音量(-)键
	input keyevent 26 //按power键
