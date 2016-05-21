---
layout: post
title:  "dumpsys命令用法"
date:   2016-5-14 21:10:30
catalog:    true
tags:
    - android
    - tool
    - dumpsys
---

> dumpsys命令功能很强大，能dump系统服务的各种状态，非常有必要熟悉该命令的用法以及含义。

## 一、 dumpsys命令

### 1.1 服务列表

不同的Android系统版本支持的命令有所不同，可通过下面命令查看当前手机所支持的dump服务，先进入adb shell，再执行如下命令：`dumpsys -l`。 这些服务名或许你并看不出其调用的哪个服务，那么这时可以通过下面指令：`service list`。

表一：

|服务名|类名|功能|
|---|---|---|
|activity|ActivityManagerService|AMS相关信息|
|package |PackageManagerService |PMS相关信息|
|window |WindowManagerService |WMS相关信息|
|input |InputManagerService |IMS相关信息|
|power |PowerManagerService |PMS相关信息|
|batterystats|BatterystatsService|电池统计信息|
|battery|BatteryService|电池信息|
|alarm| AlarmManagerService| 闹钟信息
|dropbox|DropboxManagerService|调试相关|
|procstats|ProcessStatsService|进程统计|
|cpuinfo|CpuBinder|CPU
|meminfo|MemBinder|内存
|gfxinfo|GraphicsBinder|图像
|dbinfo|DbBinder|数据库


表二：

|服务名|功能|
|---|---|---|
|SurfaceFlinger|图像相关
|appops|app使用情况
|permission|权限
|processinfo|进程服务
|batteryproperties|电池相关|
|audio     | 查看声音信息
|netstats|查看网络统计信息
|diskstats|查看空间free状态
|jobscheduler  | 查看任务计划
|wifi|wifi信息
|diskstats|磁盘情况
|usagestats|用户使用情况|
|devicestoragemonitor|设备信息|
|。。。|。。。|

未完待续...

### 1.2 查询服务

通过下面命令可打印具体某一项服务：`dumpsys <service>`，其中<service>便是前面表格中的服务名，比如：

	dumpsys cpuinfo //打印一段时间进程的CPU使用百分比排行榜
	dumpsys meminfo -h  //查看dump内存的帮助信息
	dumpsys package <packagename> //查看指定包的信息


系统服务非常之多，那么接下来将重点说说其中之一:`dumpsys activity`用法.


## 二、 Activity

	dumpsys activity [options] [cmd]

下面分别说说options和cmd有哪些可选值

### 2.1 options
	 
options可选值：

- `-a`：dump所有；
- `-c`：dump客户端；
- `-p [package]`：dump指定的包名；
- `-h`：输出帮助信息；


`dumpsys activity`等价于依次输出下面7条指令：

    dumpsys activity intents
    dumpsys activity broadcasts
    dumpsys activity providers
    dumpsys activity services
    dumpsys activity recents
    dumpsys activity activities
    dumpsys activity processes


### 2.2 cmd

cmd可选值

|cmd|解释|缩写|
|---|---|
|activities|activity状态|a|
|**broadcasts**| 广播|b|
|**intents**| pending intent状态|i|
|**processes**| 进程|p|
|oom| 内存溢出|o|
|**services**| Service状态|s|
|service | service状态(Client端)
|**providers**|ContentProvider状态|prov|
|provider| ContentProvider状态(Client端)
|associations| tracked app associations|as|
|permissions| URI permission grant state|perm
|**package**| package相关信息
|all| 所有的activities信息
|recents| recent activity状态|r|
|top|top activity信息
|write|将状态持久化到存储区
|track-associations|使能association tracking
|untrack-associations|禁止和清空association tracking

- cmd：上表加粗项是指直接跟`包名`，另外services和providers还可以跟`组件名`；
- 缩写：基本都是cmd首字母或者前几个字母，用cmd和缩写是等效：
        dumpsys activity broadcasts
        dumpsys activity b //等效


## 三、场景

下面以新浪微博App作为实例，由于输出结果较多，每个场景截图只挑选部分重要的信息。

**场景1：查询某个App所有的Service状态**

    dumpsys activity s com.sina.weibo

![dumpsys_service](/images/tools/dumpsys_service.png)

解读：

- Service类名为`com.morgoo.droidplugin.PluginManagerService`；
- 运行在进程pid=`7220`，进程名为`com.sina.weibo`，uid=`10094`；
- 通过bindService连接该服务的进程pid=`7306`，进程名为`com.sina.weibo:PluginP03`。

当然还有packageName，baseDir(apk路径)，dataDir(apk数据路径)，createTime等各种信息。另外，新浪微博采用的是360开源的Android插件机制(`com.morgoo.droidplugin`)，主要用于hotfix等功能。

**场景2：查询某个App所有的广播状态**

     dumpsys activity s com.sina.weibo

![dumpsys_broadcast](/images/tools/dumpsys_broadcast.png)

解读：

- android.intent.action.SCREEN_ON代表手机亮屏广播；
- 接收该广播的receiver有很多个，其中一个所在进程为pid=`7220`，进程名为`com.sina.weibo`


**场景3：查询某个App所有的Activity状态**
    
输出结果较多，尤其是`View Hierarchy`，下面截取部分：

    dumpsys activity a com.sina.weibo

![dumpsys_activity_task](/images/tools/dumpsys_activity_task.png)

解读：

- 格式：TaskRecord{Hashcode #TaskId Affinity UserId=0 Activity个数=1}；所以上图信息解析后就是TaskId=`1802`，Affinity=`com.sina.weibo`，当前Task中Activity个数为1。
- effectiveUid为当前task所属Uid，mCallingUid为调用者Uid=u0a94，mCallingPackage为调用者包名，这里是`com.sina.weibo`；
- realActivity:task中的已启动的Activity组件名`com.sina.weibo/.SplashActivity`。

**场景4：查询某个App的进程状态**

    dumpsys activity p com.sina.weibo

![dumpsys_processes](/images/tools/dumpsys_processes.png)

- 格式：ProcessRecord{Hashcode pid:进程名/uid}，进程pid=7306，进程名为`com.sina.weibo:PluginP03`，uid=10094.
- 该进程中还有Services，Connections, Providers, Receivers，可以看出该进程是没有Activity的进程。

**其他**

还有很多场景，会用到不同的参数，这里就不再一一列举，建议大家多去尝试，慢慢地就更加熟练，再比如：

    dumpsys activity top //当前界面app状态
    dumpsys activity oom //进程oom状态


> 由于本人最近刚刚换工作，个人下班时间严重缩减，迟迟没有更新博客，今天就先写到这里，后续再更新。


