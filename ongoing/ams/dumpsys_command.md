---
layout: post
title:  "Dumpsys命令用法"
date:   2016-02-28 20:55:51
categories: android tool
excerpt:  Dumpsys命令用法
---

* content
{:toc}


---


## Activity

	dumpsys activity [options] [cmd]

该方法最终的实现，是调用`AMS.dump()`方法



### 参数
	 
options可选值：

- `-a`：dump所有；
- `-c`：dump客户端；
- `-p [package]`：dump指定的包名；
- `-h`：输出帮助信息；

cmd可取值：

- a[ctivities]: activity的栈信息
- r[recents]: recent activities信息
- b[roadcasts] [PACKAGE_NAME] [history [-s]]: broadcast信息
- i[ntents] [PACKAGE_NAME]: pending intent信息
- p[rocesses] [PACKAGE_NAME]: process信息
- o[om]: oom信息
- perm[issions]: URI permission grant state
- prov[iders] [COMP_SPEC ...]: content provider state
- provider [COMP_SPEC]: provider client-side state
- s[ervices] [COMP_SPEC ...]: service state
- as[sociations]: tracked app associations
- service [COMP_SPEC]: service客户端信息
- package [PACKAGE_NAME]: package相关信息
- all: 所有的activities信息
- top: top activity信息
- write: write all pending state to storage
- track-associations: enable association tracking
- untrack-associations: disable and clear association tracking


级联自启：

- broadcast:force-stop
- pushService:packageManager.setComponentEnabledSetting();
- Daemon Process

## activity


ActivityStackSupervisor： ASS
ActivityStack：AS
TaskRecord: TR
ActivityRecord:AR
ApplicationThread:AT

	AMS.dump
		AMS.dumpActivitiesLocked
			ASS.dumpActivitiesLocked
				AS.dumpActivitiesLocked
					ASS.dumpHistoryList
						TR.dump
						AR.dump
						AT.dumpActivity
							AT.handleDumpActivity
								Activity.dump
									Activity.dumpInner
										FragmentController.dumpLoaders
										FragmentManager.dump
										ViewRootImpl.dump
										Looper.dump
											MessageQueue.dump
				ASS.dumpHistoryList
				ASS.printThisActivity
			ASS.printThisActivity
			ASS.dump





输出格式：

Display #0
	Stack #1
		Task id #10
		

	TaskRecord{e6d7a8e #156 A=com.yhh.analyser U=0 sz=1}
	userId=0 effectiveUid=1000 mCallingUid=1000 mCallingPackage=com.lenovo.analyser
	realActivity=com.tiger.cpu/.Main

- TaskRecord{Hashcode #TaskId Affinity UserId=0 task中的Activity个数=1}；
- effectiveUid为当前task所属Uid，mCallingUid为调用者Uid，mCallingPackage为调用者包名；
- realActivity:task中的已启动额Activity组件名；



ProcessRecord{7c8a2af 12265:com.yhh.analyser/1000}

ProcessRecord{Hashcode pid:进程名/uid}

### Service

	AMS.dump
		ActiveServices.dumpService
			ServiceRecord.dump
			ApplicationThread.dump

### broadcasts


	AMS.dump
		AMS.dumpBroadcastsLocked
			BroadcastQueue.dumpLocked
				BroadcastRecord.dump
					ResolveInfo.dump
						ActivityInfo.dump
						ServiceInfo.dump
						ProviderInfo.dump
		Handler.dump
			Looper.dump


### provider

### package

### oom

	AMS.dump
		AMS.dumpOomLocked
			AMS.printOomLevel
			AMS.dumpProcessOomList
			AMS.dumpProcessesToGc


### processes

	AMS.dump
		AMS.dumpProcessesLocked
			ProcessRecord.dump

### recents

	AMS.dump
		AMS.dumpRecentsLocked
			TaskRecord.dump



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

**小结论：**先dumpsys meminfo, 再dumpsys cpuinfo. （过程不能插拔USB线）



8：27