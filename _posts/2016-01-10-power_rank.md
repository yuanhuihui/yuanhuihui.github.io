---
layout: post
title:  "Android耗电统计算法"
date:   2016-01-10 20:47:40
catalog:  true
tags:
    - android
    - power
    - algorithm


---

> 基于Android 6.0的源码剖析

## 一、 概述

Android系统中的耗电统计分为软件排行榜和硬件排行榜，软件排序榜是统计每个App的耗电总量的排行榜，硬件排行榜则是统计主要硬件的耗电总量的排行榜。

涉及耗电统计相关的核心类：

	/framework/base/core/res/res/xml/power_profile.xml
	/framework/base/core/java/com/andorid/internal/os/PowerProfile.java
	/framework/base/core/java/com/andorid/internal/os/BatteryStatsHelper.java
	/framework/base/core/java/com/andorid/internal/os/BatterySipper.java

- PowerProfile.java用于获取各个组件的电流数值；power_profile.xml是一个可配置的功耗数据文件。
- 软件排行榜的计算算法：BatteryStatsHelper类中的processAppUsage()方法
- 硬件排行榜的计算算法：BatteryStatsHelper类中的processMiscUsage()方法

下面直接切入主题，分别讲述软件和硬件的耗电统计

## 二、软件排行榜

processAppUsage统计每个App的耗电情况

	private void processAppUsage(SparseArray<UserHandle> asUsers) {
        //判断是否统计所有用户的App耗电使用情况，目前该参数为true
        final boolean forAllUsers = (asUsers.get(UserHandle.USER_ALL) != null); 
        mStatsPeriod = mTypeBatteryRealtime; //耗电的统计时长
        BatterySipper osSipper = null;

        //获取每个uid的统计信息
        final SparseArray<? extends Uid> uidStats = mStats.getUidStats(); 
        final int NU = uidStats.size();
        // 开始遍历每个uid的耗电情况
        for (int iu = 0; iu < NU; iu++) { 
            final Uid u = uidStats.valueAt(iu); 
            final BatterySipper app = new BatterySipper(BatterySipper.DrainType.APP, u, 0);
            mCpuPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mWakelockPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mMobileRadioPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mWifiPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mBluetoothPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mSensorPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mCameraPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            mFlashlightPowerCalculator.calculateApp(app, u, mRawRealtime, mRawUptime, mStatsType);
            
            final double totalPower = app.sumPower(); //对App的8项耗电再进行累加。

            //将app添加到 app list, WiFi, Bluetooth等，或其他用户列表
            if (totalPower != 0 || u.getUid() == 0) {

                final int uid = app.getUid();
                final int userId = UserHandle.getUserId(uid);
                if (uid == Process.WIFI_UID) { //uid为wifi的情况
                    mWifiSippers.add(app);
                } else if (uid == Process.BLUETOOTH_UID) {//uid为蓝牙的情况
                    mBluetoothSippers.add(app);
                } else if (!forAllUsers && asUsers.get(userId) == null
                        && UserHandle.getAppId(uid) >= Process.FIRST_APPLICATION_UID) {
                    //就目前来说 forAllUsers=true，不会进入此分支。
                    List<BatterySipper> list = mUserSippers.get(userId);
                    if (list == null) {
                        list = new ArrayList<>();
                        mUserSippers.put(userId, list);
                    }
                    list.add(app);
                } else {
                    mUsageList.add(app);  //把app耗电加入到mUsageList
                }
                if (uid == 0) {
                    osSipper = app; // root用户，代表操作系统的耗电量
                }
            }
        }
        //app之外的耗电量
        if (osSipper != null) {
            mWakelockPowerCalculator.calculateRemaining(osSipper, mStats, mRawRealtime, mRawUptime, mStatsType);
            osSipper.sumPower();
        }
    }

流程分析：

**mTypeBatteryRealtime**

	mTypeBatteryRealtime = mStats.computeBatteryRealtime(rawRealtimeUs, mStatsType);
	private int mStatsType = BatteryStats.STATS_SINCE_CHARGED;

BatteryStats.STATS_SINCE_CHARGED，计算规则是从上次充满电后数据；另外STATS_SINCE_UNPLUGGED是拔掉USB线后的数据。说明充电时间的计算是从上一次拔掉设备到现在的耗电量统计。


**耗电计算项**

8大模块的耗电计算器，都继承与`PowerCalculator`抽象类
	
|计算项|Class文件|
|---|---|
|CPU功耗|mCpuPowerCalculator.java
|Wakelock功耗|mWakelockPowerCalculator.java
|无线电功耗|mMobileRadioPowerCalculator.java
|WIFI功耗|mWifiPowerCalculator.java
|蓝牙功耗|mBluetoothPowerCalculator.java
|Sensor功耗|mSensorPowerCalculator.java
|相机功耗|mCameraPowerCalculator.java
|闪光灯功耗|mFlashlightPowerCalculator.java


**计算值添加到列表**

- mWifiSippers.add(app)： uid为wifi的情况
- mBluetoothSippers.add(app)： uid为蓝牙的情况
- mUsageList.add(app)： app耗电加入到mUsageList
- osSipper： root用户，代表操作系统的耗电量，app之外的wakelock耗电也计算该项


**公式**

processAppUsage统计的是Uid。一般地来说每个App都对应一个Uid，但存在以下特殊情况，如果两个或多个App签名和sharedUserId相同，则在运行时，他们拥有相同Uid。对于系统应用uid为system，则统一算入system应用的耗电量。  

Uid_Power = process_1_Power + ... + process_N_Power，其中所有进程都是属于同一个uid。  
当同一的uid下，只有一个进程时，Uid_Power = process_Power;

其中process_Power = CPU功耗 + Wakelock功耗 + 无线电功耗 + WIFI功耗 + 蓝牙功耗 + Sensor功耗 + 相机功耗 +  闪光灯功耗。

接下来开始分配说明每一项的功耗计算公式。


### 2.1 CPU

CPU功耗项的计算是通过CpuPowerCalculator类

**初始化**

    public CpuPowerCalculator(PowerProfile profile) {
        final int speedSteps = profile.getNumSpeedSteps(); //获取cpu的主频等级的级数
        mPowerCpuNormal = new double[speedSteps]; //用于记录不同频率下的功耗值
        mSpeedStepTimes = new long[speedSteps];
        for (int p = 0; p < speedSteps; p++) {
            mPowerCpuNormal[p] = profile.getAveragePower(PowerProfile.POWER_CPU_ACTIVE, p);
        }
    }

从对象的构造方法，可以看出PowerProfile类提供相应所需的基础功耗值，而真正的功耗值数据来源于power_profile.xml文件，故可以通过配置合理的基础功耗值，来达到较为精准的功耗统计结果。后续所有的`PowerCalculator`子类在构造方法中都有会相应所需的功耗配置项。

CPU功耗可配置项：

- POWER_CPU_SPEEDS = "cpu.speeds" 所对应的数组，配置CPU的频点，频点个数取决于CPU硬件特性
- POWER_CPU_ACTIVE = "cpu.active" 所对应的数组，配置CPU频点所对应的单位功耗(mAh)

**功耗计算**

	public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
	                             long rawUptimeUs, int statsType) {
	        final int speedSteps = mSpeedStepTimes.length;
	        long totalTimeAtSpeeds = 0;
	        for (int step = 0; step < speedSteps; step++) {
	            //获取Cpu不同频点下的运行时间
	            mSpeedStepTimes[step] = u.getTimeAtCpuSpeed(step, statsType);
	            totalTimeAtSpeeds += mSpeedStepTimes[step];
	        }
	        totalTimeAtSpeeds = Math.max(totalTimeAtSpeeds, 1); //获取Cpu总共的运行时间
	        app.cpuTimeMs = (u.getUserCpuTimeUs(statsType) + u.getSystemCpuTimeUs(statsType)) / 1000; //获取cpu在用户态和内核态的执行时长
	        
	        double cpuPowerMaMs = 0;
	        // 计算Cpu的耗电量
	        for (int step = 0; step < speedSteps; step++) {
	            final double ratio = (double) mSpeedStepTimes[step] / totalTimeAtSpeeds;
	            final double cpuSpeedStepPower = ratio * app.cpuTimeMs * mPowerCpuNormal[step];
	            cpuPowerMaMs += cpuSpeedStepPower;
	        }
	        
	        //追踪不同进程的耗电情况
	        double highestDrain = 0;
	        app.cpuFgTimeMs = 0;
	        final ArrayMap<String, ? extends BatteryStats.Uid.Proc> processStats = u.getProcessStats();
	        final int processStatsCount = processStats.size();
	        //统计同一个uid的不同进程的耗电情况
	        for (int i = 0; i < processStatsCount; i++) {
	            final BatteryStats.Uid.Proc ps = processStats.valueAt(i);
	            final String processName = processStats.keyAt(i);
	            app.cpuFgTimeMs += ps.getForegroundTime(statsType);
	            final long costValue = ps.getUserTime(statsType) + ps.getSystemTime(statsType) + ps.getForegroundTime(statsType);
	            //App可以有多个packages和多个不同的进程，跟踪耗电最大的进程
	            if (app.packageWithHighestDrain == null ||
	                    app.packageWithHighestDrain.startsWith("*")) {
	                highestDrain = costValue;
	                app.packageWithHighestDrain = processName;
	            } else if (highestDrain < costValue && !processName.startsWith("*")) {
	                highestDrain = costValue;
	                app.packageWithHighestDrain = processName;
	            }
	        }
	        //当Cpu前台时间 大于Cpu时间，将cpuFgTimeMs赋值为cpuTimeMs
	        if (app.cpuFgTimeMs > app.cpuTimeMs) { 
	            app.cpuTimeMs = app.cpuFgTimeMs; 
	        }

	        app.cpuPowerMah = cpuPowerMaMs / (60 * 60 * 1000); //转换为mAh
	    }
	}

**子公式**

cpuPower = ratio_1 * cpu_time * cpu_ratio_1_power + ... +ratio_n * cpu_time * cpu_ratio_n_power

其中： ratio_i = cpu_speed_time/ cpu_speeds_total_time，（i=1,2,...,N，N为CPU频点个数）


### 2.2 Wakelock

Wakelock功耗项的计算是通过WakelockPowerCalculator类

**初始化**

	public WakelockPowerCalculator(PowerProfile profile) {
        mPowerWakelock = profile.getAveragePower(PowerProfile.POWER_CPU_AWAKE);
    }

Wakelock功耗可配置项：

power_profile.xml文件：

- POWER_CPU_AWAKE = "cpu.awake" 所对应的值



**功耗计算**

	public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        long wakeLockTimeUs = 0;
        final ArrayMap<String, ? extends BatteryStats.Uid.Wakelock> wakelockStats =
                u.getWakelockStats();
        final int wakelockStatsCount = wakelockStats.size();
        for (int i = 0; i < wakelockStatsCount; i++) {
            final BatteryStats.Uid.Wakelock wakelock = wakelockStats.valueAt(i);
            //只统计partial wake locks，由于 full wake locks在灭屏后会自动取消
            BatteryStats.Timer timer = wakelock.getWakeTime(BatteryStats.WAKE_TYPE_PARTIAL);
            if (timer != null) {
                wakeLockTimeUs += timer.getTotalTimeLocked(rawRealtimeUs, statsType);
            }
        }
        app.wakeLockTimeMs = wakeLockTimeUs / 1000; //转换单位为秒
        mTotalAppWakelockTimeMs += app.wakeLockTimeMs;
        //计算唤醒功耗
        app.wakeLockPowerMah = (app.wakeLockTimeMs * mPowerWakelock) / (1000*60*60);
    }

**子公式**

wakeLockPowerMah = (app.wakeLockTimeMs * mPowerWakelock) / (1000*60*60);

### 2.3 Wifi

#### WifiPowerCalculator

Wifi功耗项的计算是通过WifiPowerCalculator类


**初始化**

	public WifiPowerCalculator(PowerProfile profile) {
	        mIdleCurrentMa = profile.getAveragePower(PowerProfile.POWER_WIFI_CONTROLLER_IDLE);
	        mTxCurrentMa = profile.getAveragePower(PowerProfile.POWER_WIFI_CONTROLLER_TX);
	        mRxCurrentMa = profile.getAveragePower(PowerProfile.POWER_WIFI_CONTROLLER_RX);
	    }

Wifi功耗可配置项：

- POWER_WIFI_CONTROLLER_IDLE = "wifi.controller.idle" 项所对应的值
- POWER_WIFI_CONTROLLER_RX = "wifi.controller.rx" 项所对应的值
- POWER_WIFI_CONTROLLER_TX = "wifi.controller.tx" 项所对应的值

**功耗计算**

	public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        final long idleTime = u.getWifiControllerActivity(BatteryStats.CONTROLLER_IDLE_TIME, statsType);
        final long txTime = u.getWifiControllerActivity(BatteryStats.CONTROLLER_TX_TIME, statsType);
        final long rxTime = u.getWifiControllerActivity(BatteryStats.CONTROLLER_RX_TIME, statsType);
        app.wifiRunningTimeMs = idleTime + rxTime + txTime; //计算wifi的时间
        app.wifiPowerMah = ((idleTime * mIdleCurrentMa) + (txTime * mTxCurrentMa) + (rxTime * mRxCurrentMa)) / (1000*60*60);
        mTotalAppPowerDrain += app.wifiPowerMah;
        app.wifiRxPackets = u.getNetworkActivityPackets(BatteryStats.NETWORK_WIFI_RX_DATA,
                statsType);
        app.wifiTxPackets = u.getNetworkActivityPackets(BatteryStats.NETWORK_WIFI_TX_DATA,
                statsType);
        app.wifiRxBytes = u.getNetworkActivityBytes(BatteryStats.NETWORK_WIFI_RX_DATA,
                statsType);
        app.wifiTxBytes = u.getNetworkActivityBytes(BatteryStats.NETWORK_WIFI_TX_DATA,
                statsType);
    }

**子公式**

wifiPowerMah = ((idleTime * mIdleCurrentMa) + (txTime * mTxCurrentMa) + (rxTime * mRxCurrentMa)) / (1000* 60* 60);

#### WifiPowerEstimator

**可配置项**

- POWER_WIFI_ACTIVE = "wifi.active"（用于计算mWifiPowerPerPacket）
- POWER_WIFI_ON="wifi.on"
- POWER_WIFI_SCAN = "wifi.scan"
- POWER_WIFI_BATCHED_SCAN = "wifi.batchedscan";

**功耗计算**- 

    public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        app.wifiRxPackets = u.getNetworkActivityPackets(BatteryStats.NETWORK_WIFI_RX_DATA,
                statsType);
        app.wifiTxPackets = u.getNetworkActivityPackets(BatteryStats.NETWORK_WIFI_TX_DATA,
                statsType);
        app.wifiRxBytes = u.getNetworkActivityBytes(BatteryStats.NETWORK_WIFI_RX_DATA,
                statsType);
        app.wifiTxBytes = u.getNetworkActivityBytes(BatteryStats.NETWORK_WIFI_TX_DATA,
                statsType);
        final double wifiPacketPower = (app.wifiRxPackets + app.wifiTxPackets)
                * mWifiPowerPerPacket;
        app.wifiRunningTimeMs = u.getWifiRunningTime(rawRealtimeUs, statsType) / 1000;
        mTotalAppWifiRunningTimeMs += app.wifiRunningTimeMs;
        final double wifiLockPower = (app.wifiRunningTimeMs * mWifiPowerOn) / (1000*60*60);
        final long wifiScanTimeMs = u.getWifiScanTime(rawRealtimeUs, statsType) / 1000;
        final double wifiScanPower = (wifiScanTimeMs * mWifiPowerScan) / (1000*60*60);
        double wifiBatchScanPower = 0;
        for (int bin = 0; bin < BatteryStats.Uid.NUM_WIFI_BATCHED_SCAN_BINS; bin++) {
            final long batchScanTimeMs =
                    u.getWifiBatchedScanTime(bin, rawRealtimeUs, statsType) / 1000;
            final double batchScanPower = (batchScanTimeMs * mWifiPowerBatchScan) / (1000*60*60);
            wifiBatchScanPower += batchScanPower;
        }
        app.wifiPowerMah = wifiPacketPower + wifiLockPower + wifiScanPower + wifiBatchScanPower;
    }

其中 `BatteryStats.Uid.NUM_WIFI_BATCHED_SCAN_BINS=5`

另外

    private static double getWifiPowerPerPacket(PowerProfile profile) {
        final long WIFI_BPS = 1000000; //初略估算每秒的收发1000000bit
        final double WIFI_POWER = profile.getAveragePower(PowerProfile.POWER_WIFI_ACTIVE)
                / 3600;
        return (WIFI_POWER / (((double)WIFI_BPS) / 8 / 2048)) / (60*60);
    }


**子公式**

wifiPowerMah = wifiPacketPower + wifiLockPower + wifiScanPower + wifiBatchScanPower;

wifiPacketPower = (wifiRxPackets + wifiTxPackets) * mWifiPowerPerPacket;  
wifiLockPower = (wifiRunningTimeMs * mWifiPowerOn) / (1000* 60* 60);  
wifiScanPower = (wifiScanTimeMs * mWifiPowerScan) / (1000* 60* 60);

wifiBatchScanPower = ∑ (batchScanTimeMs * mWifiPowerBatchScan) / (1000* 60* 60) ，5次相加。

### 2.4 Bluetooth

Bluetooth功耗项的计算是通过BluetoothPowerCalculator类

**初始化**

	public BluetoothPowerCalculator(PowerProfile profile) {
        mIdleMa = profile.getAveragePower(PowerProfile.POWER_BLUETOOTH_CONTROLLER_IDLE);
        mRxMa = profile.getAveragePower(PowerProfile.POWER_BLUETOOTH_CONTROLLER_RX);
        mTxMa = profile.getAveragePower(PowerProfile.POWER_BLUETOOTH_CONTROLLER_TX);
    }

Bluetooth功耗可配置项(目前蓝牙功耗计算的方法为空，此配置暂可忽略)：

- POWER_BLUETOOTH_CONTROLLER_IDLE = "bluetooth.controller.idle" 所对应的值
- POWER_BLUETOOTH_CONTROLLER_RX = "bluetooth.controller.rx" 所对应的值
- POWER_BLUETOOTH_CONTROLLER_TX = "bluetooth.controller.tx" 所对应的值



**功耗计算**

	public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        // No per-app distribution yet.
    }

**子公式**

bluePower = 0;

还没有给每个App统计蓝牙的算法。



### 2.5 Camera

Camera功耗项的计算是通过CameraPowerCalculator类

**初始化**

    public CameraPowerCalculator(PowerProfile profile) {
        mCameraPowerOnAvg = profile.getAveragePower(PowerProfile.POWER_CAMERA);
    }

Camera功耗可配置项：

- POWER_CAMERA = "camera.avg" 所对应的值

**功耗计算**

     public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        //对于camera功耗的评估比较粗，camera打开认定功耗一致
        final BatteryStats.Timer timer = u.getCameraTurnedOnTimer();
        if (timer != null) {
            final long totalTime = timer.getTotalTimeLocked(rawRealtimeUs, statsType) / 1000;
            app.cameraTimeMs = totalTime;
            app.cameraPowerMah = (totalTime * mCameraPowerOnAvg) / (1000*60*60);
        } else {
            app.cameraTimeMs = 0;
            app.cameraPowerMah = 0;
        }
    }

**子公式**

cameraPowerMah = (totalTime * mCameraPowerOnAvg) / (1000*60*60);


### 2.6  Flashlight

 Flashlight功耗项的计算是通过FlashlightPowerCalculator类

**初始化**

    public FlashlightPowerCalculator(PowerProfile profile) {
        mFlashlightPowerOnAvg = profile.getAveragePower(PowerProfile.POWER_FLASHLIGHT);
    }

Flashlight功耗可配置项：

- POWER_FLASHLIGHT = "camera.flashlight" 所对应的值

**功耗计算**

    public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        final BatteryStats.Timer timer = u.getFlashlightTurnedOnTimer();
        if (timer != null) {
            final long totalTime = timer.getTotalTimeLocked(rawRealtimeUs, statsType) / 1000;
            app.flashlightTimeMs = totalTime;
            app.flashlightPowerMah = (totalTime * mFlashlightPowerOnAvg) / (1000*60*60);
        } else {
            app.flashlightTimeMs = 0;
            app.flashlightPowerMah = 0;
        }
    }

**子公式**

flashlightPowerMah = (totalTime * mFlashlightPowerOnAvg) / (1000*60*60);

flashlight计算方式与Camera功耗计算思路一样。



### 2.7  MobileRadio

无线电功耗项的计算是通过MobileRadioPowerCalculator类

**初始化**

    public MobileRadioPowerCalculator(PowerProfile profile, BatteryStats stats) {
        mPowerRadioOn = profile.getAveragePower(PowerProfile.POWER_RADIO_ACTIVE);
        for (int i = 0; i < mPowerBins.length; i++) {
            mPowerBins[i] = profile.getAveragePower(PowerProfile.POWER_RADIO_ON, i);
        }
        mPowerScan = profile.getAveragePower(PowerProfile.POWER_RADIO_SCANNING);
        mStats = stats;
    }

无线电功耗可配置项：

- POWER_RADIO_ACTIVE = "radio.active" 所对应的值

**功耗计算**

    public void calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs,
                             long rawUptimeUs, int statsType) {
        app.mobileRxPackets = u.getNetworkActivityPackets(BatteryStats.NETWORK_MOBILE_RX_DATA, statsType);
        app.mobileTxPackets = u.getNetworkActivityPackets(BatteryStats.NETWORK_MOBILE_TX_DATA, statsType);
        app.mobileActive = u.getMobileRadioActiveTime(statsType) / 1000;
        app.mobileActiveCount = u.getMobileRadioActiveCount(statsType);
        app.mobileRxBytes = u.getNetworkActivityBytes(BatteryStats.NETWORK_MOBILE_RX_DATA,
                statsType);
        app.mobileTxBytes = u.getNetworkActivityBytes(BatteryStats.NETWORK_MOBILE_TX_DATA,
                statsType);
        if (app.mobileActive > 0) {
            // 当追踪信号的开头，则采用mobileActive时间乘以相应功耗
            mTotalAppMobileActiveMs += app.mobileActive;
            app.mobileRadioPowerMah = (app.mobileActive * mPowerRadioOn) / (1000*60*60);
        } else {
            //当没有追踪信号开关，则采用收发数据包来评估功耗
            app.mobileRadioPowerMah = (app.mobileRxPackets + app.mobileTxPackets) * getMobilePowerPerPacket(rawRealtimeUs, statsType);
        }
    }

计算出每收/发一个数据包的功耗值

    private double getMobilePowerPerPacket(long rawRealtimeUs, int statsType) {
        final long MOBILE_BPS = 200000; //Extract average bit rates from system
        final double MOBILE_POWER = mPowerRadioOn / 3600;
        final long mobileRx = mStats.getNetworkActivityPackets(BatteryStats.NETWORK_MOBILE_RX_DATA,
                statsType);
        final long mobileTx = mStats.getNetworkActivityPackets(BatteryStats.NETWORK_MOBILE_TX_DATA,
                statsType);
        final long mobileData = mobileRx + mobileTx;
        final long radioDataUptimeMs =
                mStats.getMobileRadioActiveTime(rawRealtimeUs, statsType) / 1000;
        final double mobilePps = (mobileData != 0 && radioDataUptimeMs != 0)
                ? (mobileData / (double)radioDataUptimeMs)
                : (((double)MOBILE_BPS) / 8 / 2048);
        return (MOBILE_POWER / mobilePps) / (60*60);
    }

**子公式**

情况一：当追踪信号活动时间，即mobileActive > 0，采用：

mobileRadioPowerMah = (app.mobileActive * mPowerRadioOn) / (1000* 60* 60);

情况二：当没有追踪信号活动时间，则采用：

mobileRadioPowerMah = (app.mobileRxPackets + app.mobileTxPackets) * MobilePowerPerPacket

其中MobilePowerPerPacket = (（mPowerRadioOn / 3600） / mobilePps) / (60*60)，  
mobilePps= （mobileRx + mobileTx）/radioDataUptimeMs



### 2.8 Sensor

Sensor功耗项的计算是通过SensorPowerCalculator类

**初始化**

    public SensorPowerCalculator(PowerProfile profile, SensorManager sensorManager) {
        mSensors = sensorManager.getSensorList(Sensor.TYPE_ALL);
        mGpsPowerOn = profile.getAveragePower(PowerProfile.POWER_GPS_ON);
    }

Sensor功耗可配置项：

- POWER_GPS_ON = "gps.on" 所对应的值

**功耗计算**

	d calculateApp(BatterySipper app, BatteryStats.Uid u, long rawRealtimeUs, long rawUptimeUs, int statsType) {
        // 计算没有个Uid
        final SparseArray<? extends BatteryStats.Uid.Sensor> sensorStats = u.getSensorStats();
        final int NSE = sensorStats.size();
        for (int ise = 0; ise < NSE; ise++) {
            final BatteryStats.Uid.Sensor sensor = sensorStats.valueAt(ise);
            final int sensorHandle = sensorStats.keyAt(ise);
            final BatteryStats.Timer timer = sensor.getSensorTime();
            final long sensorTime = timer.getTotalTimeLocked(rawRealtimeUs, statsType) / 1000;
            switch (sensorHandle) {
                case BatteryStats.Uid.Sensor.GPS:  //对于uid为GPS的情况
                    app.gpsTimeMs = sensorTime;
                    app.gpsPowerMah = (app.gpsTimeMs * mGpsPowerOn) / (1000*60*60);
                    break;
                default:
                    final int sensorsCount = mSensors.size();
                    for (int i = 0; i < sensorsCount; i++) { //统计所有的sensor情况
                        final Sensor s = mSensors.get(i);
                        if (s.getHandle() == sensorHandle) {
                            app.sensorPowerMah += (sensorTime * s.getPower()) / (1000*60*60);
                            break;
                        }
                    }
                    break;
            }
        }
    }

GPS的功耗计算与sensor的计算方法放在一块

**子公式**

gpsPowerMah = (app.gpsTimeMs * mGpsPowerOn) / (1000* 60* 60);

### 软件功耗总公式

BatterySipper中，功耗计算方法：

    public double sumPower() {
        return totalPowerMah = usagePowerMah + wifiPowerMah + gpsPowerMah + cpuPowerMah +
                sensorPowerMah + mobileRadioPowerMah + wakeLockPowerMah + cameraPowerMah +
                flashlightPowerMah;
    }


软件功耗的子项共分为9项：

|功耗项|解释|
|---|---|
|usage|通用的功耗
|cpu|cpu的消耗
|wakelock|唤醒带来的功耗
|mobileRadio|移动无线的功耗
|wifi|wifi功耗
|gps|定位的功耗
|sensor|传感器的功耗
|camera|相机功耗
|flashlight|闪光灯功耗

目前没有统计蓝牙的耗电，源码中统计蓝牙耗电的方法是空方法。gps耗电的计算在sensor模块一起计算的。

**软件功耗总公式**  

![calculate_software_power](/images/android-service/battery_stats_service/calculate_software_power.png)


## 三、 硬件排行榜

processMiscUsage()

    private void processMiscUsage() {
        addUserUsage();
        addPhoneUsage();
        addScreenUsage();
        addWiFiUsage();
        addBluetoothUsage();
        addIdleUsage(); 
        if (!mWifiOnly) { //对于只有wifi上网功能的设备，将不算计此项
            addRadioUsage();
        }
    }

硬件功耗的子项共分为7项：

|功耗项|解释|
|---|---|
|UserUsage|用户功耗
|PhoneUsage|通话功耗
|ScreenUsage|屏幕功耗
|WiFiUsage|Wifi功耗
|BluetoothUsage|蓝牙消耗
|IdleUsage|CPU Idle功耗
|RadioUsage|移动无线功耗

### 3.1 User

用户功耗的类型DrainType.USER

**功耗计算**

    private void addUserUsage() {
        for (int i = 0; i < mUserSippers.size(); i++) {
            final int userId = mUserSippers.keyAt(i);
            BatterySipper bs = new BatterySipper(DrainType.USER, null, 0);
            bs.userId = userId;
            aggregateSippers(bs, mUserSippers.valueAt(i), "User"); //将UserSippers中的功耗都合入bs.
            mUsageList.add(bs);
        }
    }


合计

    private void aggregateSippers(BatterySipper bs, List<BatterySipper> from, String tag)  {
        for (int i=0; i<from.size(); i++) {
            BatterySipper wbs = from.get(i);
            bs.add(wbs);  //将from中的功耗数据合入bs
        }
        bs.computeMobilemspp();
        bs.sumPower(); //计算总功耗
    }

**子公式**

user_power = user_1_power + user_2_power + ... +　user_n_power; (n为所有的user的总数)

### 3.2 Phone

通话功耗的类型为D`rainType.PHONE`

通话功耗可配置项：

- POWER_RADIO_ACTIVE = "radio.active" 所对应的值


**功耗计算**

    private void addPhoneUsage() {
        long phoneOnTimeMs = mStats.getPhoneOnTime(mRawRealtime, mStatsType) / 1000;
        double phoneOnPower = mPowerProfile.getAveragePower(PowerProfile.POWER_RADIO_ACTIVE) * phoneOnTimeMs / (60*60*1000);
        if (phoneOnPower != 0) {
            addEntry(BatterySipper.DrainType.PHONE, phoneOnTimeMs, phoneOnPower);
        }
    }


**子公式**

phone_powers = (phoneOnTimeMs * phoneOnPower) / (60* 60* 1000)


### 3.3 CPU Idle

CPU Idle功耗的类型为`DrainType.IDLE`

CPU Idle功耗可配置项：

- PowerProfile.POWER_CPU_IDLE = "cpu.idle" 所对应的值

**功耗计算**

    private void addIdleUsage() {
        long idleTimeMs = (mTypeBatteryRealtime - mStats.getScreenOnTime(mRawRealtime, mStatsType)) / 1000;
        double idlePower = (idleTimeMs * mPowerProfile.getAveragePower(PowerProfile.POWER_CPU_IDLE)) / (60*60*1000);
        if (idlePower != 0) {
            addEntry(BatterySipper.DrainType.IDLE, idleTimeMs, idlePower);
        }
    }


**子公式**

idlePower = (idleTimeMs * cpuIdlePower) / (60* 60* 1000)

### 3.4 Screen

屏幕功耗的类型为DrainType.SCREEN

屏幕功耗可配置项

- POWER_SCREEN_ON = "screen.on" 所对应的值
- POWER_SCREEN_FULL = "screen.full" 所对应的值

**功耗计算**

    private void addScreenUsage() {
        double power = 0;
        long screenOnTimeMs = mStats.getScreenOnTime(mRawRealtime, mStatsType) / 1000;
        power += screenOnTimeMs * mPowerProfile.getAveragePower(PowerProfile.POWER_SCREEN_ON);
        final double screenFullPower =
                mPowerProfile.getAveragePower(PowerProfile.POWER_SCREEN_FULL);
        for (int i = 0; i < BatteryStats.NUM_SCREEN_BRIGHTNESS_BINS; i++) {
            double screenBinPower = screenFullPower * (i + 0.5f)
                    / BatteryStats.NUM_SCREEN_BRIGHTNESS_BINS;
            long brightnessTime = mStats.getScreenBrightnessTime(i, mRawRealtime, mStatsType) / 1000;
            double p = screenBinPower*brightnessTime;
            power += p;
        }
        power /= (60*60*1000); // To hours
        if (power != 0) {
            addEntry(BatterySipper.DrainType.SCREEN, screenOnTimeMs, power);
        }
    }

其中参数：

	BatteryStats.NUM_SCREEN_BRIGHTNESS_BINS = 5；
	
	static final String[] SCREEN_BRIGHTNESS_NAMES = {
	        "dark", "dim", "medium", "light", "bright"
	    };
	    
    static final String[] SCREEN_BRIGHTNESS_SHORT_NAMES = {
        "0", "1", "2", "3", "4"
    };

**子公式**

公式：screen_power = screenOnTimeMs * screenOnPower + backlight_power  

其中：backlight_power = 0.1 * dark_brightness_time * screenFullPower + 0.3 * dim_brightness_time * screenFullPower + 0.5 * medium_brightness_time * screenFullPower + 0.7 * light_brightness_time + 0.9 * bright_brightness_time * screenFullPower;

### 3.5 Wifi

#### WifiPowerCalculater

Wifi的硬件功耗的类型DrainType.WIFI。

Wifi功耗可配置项

power_profile.xml文件：

- POWER_WIFI_CONTROLLER_IDLE = "wifi.controller.idle" 所对应的值
- POWER_WIFI_CONTROLLER_RX = "wifi.controller.rx" 所对应的值
- POWER_WIFI_CONTROLLER_TX = "wifi.controller.tx" 所对应的值

**功耗计算**

wifi的硬件功耗是指除去App消耗之外的剩余wifi功耗

    private void addWiFiUsage() {
        BatterySipper bs = new BatterySipper(DrainType.WIFI, null, 0);
        mWifiPowerCalculator.calculateRemaining(bs, mStats, mRawRealtime, mRawUptime, mStatsType); //计算wifi硬件功耗
        aggregateSippers(bs, mWifiSippers, "WIFI"); //将Wifi硬件合计入总功耗
        if (bs.totalPowerMah > 0) {
            mUsageList.add(bs);
        }
    }

计算

    @Override
    public void calculateRemaining(BatterySipper app, BatteryStats stats, long rawRealtimeUs, long rawUptimeUs, int statsType) {
        final long idleTimeMs = stats.getWifiControllerActivity(BatteryStats.CONTROLLER_IDLE_TIME, statsType);
        final long rxTimeMs = stats.getWifiControllerActivity(BatteryStats.CONTROLLER_RX_TIME, statsType);
        final long txTimeMs = stats.getWifiControllerActivity(BatteryStats.CONTROLLER_TX_TIME, statsType);
        app.wifiRunningTimeMs = idleTimeMs + rxTimeMs + txTimeMs;
        double powerDrainMah = stats.getWifiControllerActivity(BatteryStats.CONTROLLER_POWER_DRAIN, statsType) / (double)(1000*60*60);
        if (powerDrainMah == 0) {
            //对于不直接报告功耗的组件，可通过直接计算的方式来获取
            powerDrainMah = ((idleTimeMs * mIdleCurrentMa) + (txTimeMs * mTxCurrentMa) + (rxTimeMs * mRxCurrentMa)) / (1000*60*60);
        }
        app.wifiPowerMah = Math.max(0, powerDrainMah - mTotalAppPowerDrain);
    }


**子公式**
公式：wifiPowerMah = powerDrainMah - mTotalAppPowerDrain；  

powerDrainMah = ((idleTimeMs * mIdleCurrentMa) + (txTimeMs * mTxCurrentMa) +(rxTimeMs * mRxCurrentMa)；  

mTotalAppPowerDrain是通过calculateApp计算过程中获取，记录所有App的wifi功耗值之和。


#### WifiPowerEstimator

**可配置项**

POWER_WIFI_ON="wifi.on"

**功耗计算**

    public void calculateRemaining(BatterySipper app, BatteryStats stats, long rawRealtimeUs, long rawUptimeUs, int statsType) {
        final long totalRunningTimeMs = stats.getGlobalWifiRunningTime(rawRealtimeUs, statsType) / 1000;
        final double powerDrain = ((totalRunningTimeMs - mTotalAppWifiRunningTimeMs) * mWifiPowerOn) / (1000*60*60);
        app.wifiRunningTimeMs = totalRunningTimeMs;
        app.wifiPowerMah = Math.max(0, powerDrain);
    }

**子公式**

wifiPowerMah =   ((totalRunningTimeMs - mTotalAppWifiRunningTimeMs) * mWifiPowerOn) / (1000* 60* 60)；


### 3.6 Bluetooth

蓝牙功耗的类型DrainType.BLUETOOTH

蓝牙功耗可配置项

- POWER_BLUETOOTH_CONTROLLER_IDLE = "bluetooth.controller.idle" 所对应的值
- POWER_BLUETOOTH_CONTROLLER_RX = "bluetooth.controller.rx" 所对应的值
- POWER_BLUETOOTH_CONTROLLER_TX = "bluetooth.controller.tx" 所对应的值

**功耗计算**

    private void addBluetoothUsage() {
        BatterySipper bs = new BatterySipper(BatterySipper.DrainType.BLUETOOTH, null, 0);
        mBluetoothPowerCalculator.calculateRemaining(bs, mStats, mRawRealtime, mRawUptime, mStatsType);
        aggregateSippers(bs, mBluetoothSippers, "Bluetooth"); //将蓝牙功耗合计入总功耗
        if (bs.totalPowerMah > 0) {
            mUsageList.add(bs);
        }
    }

计算：

    public void calculateRemaining(BatterySipper app, BatteryStats stats, long rawRealtimeUs,
                                   long rawUptimeUs, int statsType) {
        final long idleTimeMs = stats.getBluetoothControllerActivity(
                BatteryStats.CONTROLLER_IDLE_TIME, statsType);
        final long txTimeMs = stats.getBluetoothControllerActivity(
                BatteryStats.CONTROLLER_TX_TIME, statsType);
        final long rxTimeMs = stats.getBluetoothControllerActivity(
                BatteryStats.CONTROLLER_RX_TIME, statsType);
        final long totalTimeMs = idleTimeMs + txTimeMs + rxTimeMs;
        double powerMah = stats.getBluetoothControllerActivity(
                BatteryStats.CONTROLLER_POWER_DRAIN, statsType) / (double)(1000*60*60);
        if (powerMah == 0) {
            //对于不直接报告功耗的组件，可通过直接计算的方式来获取
            powerMah = ((idleTimeMs * mIdleMa) + (rxTimeMs * mRxMa) + (txTimeMs * mTxMa)) / (1000*60*60);
        }

        app.usagePowerMah = powerMah;
        app.usageTimeMs = totalTimeMs;
    }

**子公式**

公式：usagePowerMah = ((idleTimeMs * mIdleMa) + (rxTimeMs * mRxMa) + (txTimeMs * mTxMa)) / (1000 * 60 * 60);

蓝牙的计算与3.5 wifi计算方式相仿。


### 3.7 MobileRadio

无线电功耗的类型为DrainType.CELL


无线电功耗可配置项

power_profile.xml文件：

- POWER_RADIO_ON = "radio.on" 所对应的数组，该数组大小为`NUM_SIGNAL_STRENGTH_BINS = 5`
- POWER_RADIO_SCANNING = "radio.scanning" 所对应的值

**功耗计算**

对于只支持wifi的设备则不需要计算该项

    private void addRadioUsage() {
        BatterySipper radio = new BatterySipper(BatterySipper.DrainType.CELL, null, 0);
        mMobileRadioPowerCalculator.calculateRemaining(radio, mStats, mRawRealtime, mRawUptime, mStatsType);
        radio.sumPower();
        if (radio.totalPowerMah > 0) {
            mUsageList.add(radio);
        }
    }

计算

    @Override
    public void calculateRemaining(BatterySipper app, BatteryStats stats, long rawRealtimeUs, long rawUptimeUs, int statsType) {
        double power = 0;
        long signalTimeMs = 0;
        long noCoverageTimeMs = 0;
        for (int i = 0; i < mPowerBins.length; i++) {
            long strengthTimeMs = stats.getPhoneSignalStrengthTime(i, rawRealtimeUs, statsType)
                    / 1000;
            final double p = (strengthTimeMs * mPowerBins[i]) / (60*60*1000);
            power += p;
            signalTimeMs += strengthTimeMs;
            if (i == 0) {
                noCoverageTimeMs = strengthTimeMs;
            }
        }
        final long scanningTimeMs = stats.getPhoneSignalScanningTime(rawRealtimeUs, statsType)
                / 1000;
        final double p = (scanningTimeMs * mPowerScan) / (60*60*1000);
        power += p;
        long radioActiveTimeMs = mStats.getMobileRadioActiveTime(rawRealtimeUs, statsType) / 1000;
        long remainingActiveTimeMs = radioActiveTimeMs - mTotalAppMobileActiveMs;
        if (remainingActiveTimeMs > 0) {
            power += (mPowerRadioOn * remainingActiveTimeMs) / (1000*60*60);
        }
        if (power != 0) {
            if (signalTimeMs != 0) {
                app.noCoveragePercent = noCoverageTimeMs * 100.0 / signalTimeMs;
            }
            app.mobileActive = remainingActiveTimeMs;
            app.mobileActiveCount = stats.getMobileRadioActiveUnknownCount(statsType);
            app.mobileRadioPowerMah = power;
        }
    }

常量：

    public static final int NUM_SIGNAL_STRENGTH_BINS = 5;
    public static final String[] SIGNAL_STRENGTH_NAMES = {
        "none", "poor", "moderate", "good", "great"
    };

**子公式**

mobileRadioPowerMah  = strengthOnPower + scanningPower + remainingActivePower

其中：  
strengthOnPower = none_strength_Ms  * none_strength_Power +  poor_strength_Ms  * poor_strength_Power +  moderate_strength_Ms  * moderate_strength_Power +  good_strength_Ms  * good_strength_Power +  great_strength_Ms  * great_strength_Power；
  
scanningPower = scanningTimeMs * mPowerScan；  
  
remainingActivePower =  （radioActiveTimeMs - mTotalAppMobileActiveMs）* mPowerRadioOn；


### 硬件耗电总公式


![calculate_hardware_power](/images/android-service/battery_stats_service/calculate_hardware_power.png)


## 四、总结

**(1)** 关于WifiPowerCalculator && WifiPowerEstimator的选择问题

在 BatteryStatsHelper.java中：

    final boolean hasWifiPowerReporting = checkHasWifiPowerReporting(mStats, mPowerProfile);
        if (mWifiPowerCalculator == null || hasWifiPowerReporting != mHasWifiPowerReporting) {
            mWifiPowerCalculator = hasWifiPowerReporting ?
                    new WifiPowerCalculator(mPowerProfile) :
                    new WifiPowerEstimator(mPowerProfile);
            mHasWifiPowerReporting = hasWifiPowerReporting;
        }

- 当hasWifiPowerReporting = true时，采用WifiPowerCalculator算法；
- 当hasWifiPowerReporting = false时，采用WifiPowerEstimator算法；

其中
 
    public static boolean checkHasWifiPowerReporting(BatteryStats stats, PowerProfile profile) {
        return stats.hasWifiActivityReporting() &&
                profile.getAveragePower(PowerProfile.POWER_WIFI_CONTROLLER_IDLE) != 0 &&
                profile.getAveragePower(PowerProfile.POWER_WIFI_CONTROLLER_RX) != 0 &&
                profile.getAveragePower(PowerProfile.POWER_WIFI_CONTROLLER_TX) != 0;
    }

mHasWifiActivityReporting的默认值为false，故WIFI计算方式默认采用WifiPowerEstimator方式。

**（2）** 硬件与软件排行榜，功耗项对比：


|功耗项|软件榜|硬件榜|
|---|---|---|
|CPU|√|√|
|无线电|√|√|
|WIFI|√|√|
|蓝牙|√|√|
|Wakelock|√|-|
|Sensor|√|-|
|相机|√|-|
|闪光灯|√|-|
|通话|-|√|
|屏幕|-|√|
|用户|-|√|

其中√代表包含此功耗项。

**（3）** 硬件与软件排行榜，可配置项对比：

对于wifi的统计存在两种方式.

|功耗项|软件榜|硬件榜|
|---|---|---|
|CPU|cpu.active|cpu.idle|
|无线电|radio.active|radio.on/scanning|
|WIFI_Calculater|wifi.controller.idle/rx/tx|wifi.controller.idle/rx/tx|
|WIFI_Estimator|wifi.on/ scan/ batchedscan|wifi.on|
|蓝牙|bluetooth.controller.idle/rx/tx|bluetooth.controller.idle/rx/tx|
|Wakelock|cpu.awake|-|
|Sensor|gps.on|-|
|相机|camera.avg|-|
|闪光灯|camera.flashlight|-|
|通话|-|radio.active|
|屏幕|-|screen.on|
|用户|-||
  
只有通过配置文件，精确地配置好每一项的基础功耗值，才能有一个精确的功耗统计结果。


----------

如果觉得本文对您有所帮助，请关注我的**微信公众号：gityuan**， **[微博：Gityuan](http://weibo.com/gityuan)**。 或者[点击这里查看更多关于我的信息](http://gityuan.com/about/)