
## 涉及类

BatteryStatsImpl.java 获取App各个组件运行时间

PowerProfile.java 获取组件的电流数值

BatteryStatsService.java 电池统计服务

BatteryStats.java

BatteryStatsHelper.java



## 步骤

1. BatteryStatsImpl.java 获取App各个组件运行时间
2. PowerProfile.java 用于获取各个组件的电流数值；
3. BatteryStatsHelper.java: 计算公式

# 一、 BatteryStatsImpl
> framework/base/core/java/com/andorid/internal/os/BatteryStatsImpl.java

作用：获取App各个组件运行时间

readLocked，解析/data/system/batterystats.bin文件。

# 二、 PowerProfile
> framework/base/core/java/com/andorid/internal/os/PowerProfile.java

作用：用于获取各个组件的电流数值；

读取的资源id = com.android.internal.R.xml.power_profile，相对应的文件是platform/frameworks/base/core/res/res/xml/power_profile.xml.

## getBatteryCapacity

获取电池电量

	public double getBatteryCapacity() {
        return getAveragePower(POWER_BATTERY_CAPACITY);
    }

获取类型为type的电流值

 	public double getAveragePower(String type, int level) {
        if (sPowerMap.containsKey(type)) {
            Object data = sPowerMap.get(type);
            if (data instanceof Double[]) { //type类型数据，包含多个level时，进入此分支
                final Double[] values = (Double[]) data;
                if (values.length > level && level >= 0) {
                    return values[level]; //根据level选择相应的电流值；
                } else if (level < 0 || values.length == 0) {
                    return 0;
                } else {
                    return values[values.length - 1];
                }
            } else {
                return (Double) data; //type类型数据只有一个level，直接返回data;
            }
        } else {
            return 0; //sPowerMap中不包含type类型的电流，则取值为0；
        }
    }



# 三、耗电排行榜

BatteryStats.dumpLocked()  
  ↓↓  
BatteryStatsHelper.refreshStats()   
  ↓↓  
BatteryStatsHelper.processAppUsage()  
BatteryStatsHelper.processAppUsage()  

## 3.1 软件排行榜

> framework/base/core/java/com/andorid//internal/os/BatteryStatsHelper.java

processAppUsage统计每个App的耗电情况



8大模块的耗电计算器，都继承与PowerCalculator抽象类
	
|计算项|Class文件|
|---|---|
|CPU耗电|mCpuPowerCalculator.java
|唤醒锁耗电|mWakelockPowerCalculator.java
|无线电耗电|mMobileRadioPowerCalculator.java
|WIFI耗电|mWifiPowerCalculator.java
|蓝牙耗电|mBluetoothPowerCalculator.java
|传感器耗电|mSensorPowerCalculator.java
|相机耗电|mCameraPowerCalculator.java
|闪光灯|mFlashlightPowerCalculator.java





### 3.2 BatterySipper

> framework/base/core/java/com/andorid/internal/os/BatterySipper.java

功耗计算方法：

    public double sumPower() {
        return totalPowerMah = usagePowerMah + wifiPowerMah + gpsPowerMah + cpuPowerMah +
                sensorPowerMah + mobileRadioPowerMah + wakeLockPowerMah + cameraPowerMah +
                flashlightPowerMah;
    }


## 总结

1. ActivityManagerService中 创建并初始化 BatteryStatsService服务；
3. BatteryStatsImpl调用readLocked()加载batterystats.bin数据；
4. PowerProfile，解析power_profile.xml文件，获取各个组件的电流数值；
4. PowerUsageSummary通过BatteryStatsService获取App耗电量。

### BatteryStatsService

BatteryStatsService是framework层用于电池统计的服务，服务名为"batterystats".

> framework/base/services/core/java/com/andorid/server/am/BatteryStatsService.java

**启动**  

BatteryStatsService是在ActivityManagerService初始化创建的。

	public ActivityManagerService(Context systemContext) {
	    mBatteryStatsService = new BatteryStatsService(systemDir, mHandler); //
	    mBatteryStatsService.getActiveStatistics().readLocked();
	    mBatteryStatsService.scheduleWriteToDisk(); //回写到磁盘
	    mBatteryStatsService.getActiveStatistics().setCallback(this);
	    ...
	}

	private void start() {
        Process.removeAllProcessGroups();
        mProcessCpuThread.start();
        mBatteryStatsService.publish(mContext); //注册BatteryStatsService服务
        mAppOpsService.publish(mContext);
        LocalServices.addService(ActivityManagerInternal.class, new LocalService());
    }

mBatteryStatsService.getActiveStatistics()返回的是一个BatteryStatsImpl对象。



###  工具

dumpsys batterystat

  
通过命令 dumpsys batterystats -h, 可得到

	Battery stats (batterystats) dump options:
	  [--checkin] [--history] [--history-start] [--unplugged] [--charged] [-c]
	  [--reset] [--write] [-h] [<package.name>]
	  --checkin: format output for a checkin report.
	  --history: show only history data.
	  --history-start <num>: show only history data starting at given time offset.
	  --unplugged: only output data since last unplugged.
	  --charged: only output data since last charged.
	  --reset: reset the stats, clearing all current data.
	  --write: force write current collected stats to disk.
	  <package.name>: optional name of package to filter output by.
	  -h: print this help text.
	Battery stats (batterystats) commands:
	  enable|disable <option>
	    Enable or disable a running option.  Option state is not saved across boots.
	    Options are:
	      full-history: include additional detailed events in battery history:
	          wake_lock_in and proc events
	      no-auto-reset: don't automatically reset stats when unplugged

【后续再详细分析每一个参数的含义】

### 杀进程

1.关于uid的问题，可通过 ps | grep ^u0;

即使重启，apk的uid也不会变。

u0_a119: user0, id = 10119. 这个uid，也可以认为是appid。

2.forceStopPackage(String packageName)：
这是ActivityManagerService的方法， 另外也存在killUid()也存在该方法。

杀的权限：

- android:sharedUserId="android.uid.system"
- <uses-permission android:name="android.permission.FORCE_STOP_PACKAGES"/>

杀的效果：
以包的形式杀app，比如微信多个进程，可以一次性杀死。

杀的善后：
activity, service, broadcast, contentprovider以及Permission移除。

杀的范围：
不会杀persistent的app, 还可以设置低于minOomAdj的不会杀。

杀的手段：
Process.killProcessQuiet(pid) ==> sendSignalQuiet（pid, SINAL_KILL）, SINAL_KILL=9;
Process.killProcessGroup(uid, pid)








