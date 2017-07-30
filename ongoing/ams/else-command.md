

ActivityThread.java

public void dumpGfxInfo(FileDescriptor fd, String[] args) {
    dumpGraphicsInfo(fd);
    WindowManagerGlobal.getInstance().dumpGfxInfo(fd, args);
}




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
