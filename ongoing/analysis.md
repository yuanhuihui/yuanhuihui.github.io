logcat -b all | egrep -i "fingersense_touch_up|GITYUAN|broadcastqueue|am_anr"

## HUA
mate 9 , android 7.0, kernel 4.1.18, hisilicon kirin 960
4.0GB内存, 32GB存储

打开log的暗码: *#*#2846579#*#*


杀进程: com.huawei.systemmanager:service, 采用force-stop

HWMHA:/ $ ps | grep zygote                                                     
root      500   1     2263012 92848          0 0000000000 S zygote64
root      501   1     1676436 77708          0 0000000000 S zygote
HWMHA:/ $ ps | grep -c " 1 "                                                   
59
HWMHA:/ $ ps | grep -c " 2 "                                                   
318
HWMHA:/ $ ps | grep -c " 500 "                                                 
44
HWMHA:/ $ ps | grep -c " 501 "                                                 
11
HWMHA:/ $ ps | grep -c "  "                                                    
438

//system_server
HWMHA:/ $ ps -t | grep " 1192 " -c                                             
193

//自动分析anr
06-28 12:06:51.889   525  1011 I logserver: ANR, proc_name:com.gityuan.providertest, f1_name: at java.lang.Thread.sleep!(Native method), topcpu_proc:system_server

06-28 13:55:40.779  1192  2147 I HwBroadcastQueue: set default proxy broadcast actions:
android.intent.action.ANY_DATA_STATE,
android.intent.action.TIME_TICK,
android.intent.action.BATTERY_CHANGED,
android.net.wifi.SCAN_RESULTS,
android.net.wifi.STATE_CHANGE,
android.intent.action.CONFIGURATION_CHANGED,
android.intent.action.SERVICE_STATE,
android.net.conn.CONNECTIVITY_CHANGE,
android.net.wifi.supplicant.STATE_CHANGE,
android.intent.action.USER_PRESENT,
android.intent.action.PACKAGE_RESTARTED,
android.intent.action.CLOSE_SYSTEM_DIALOGS,
android.net.wifi.RSSI_CHANGED,
android.location.GPS_ENABLED_CHANGE,
org.agoo.android.intent.action.ELECTION_RESULT_V4]]

06-28 13:56:00.350  1192  1343 W HwBroadcastQueue: current receiver should not report timeout.



06-28 14:18:26.390  1830  1931 I AppBlackWhitelist: Clean unprotected apps: [com.huawei.android.airsharing, com.android.calculator2, com.nuance.swype.emui, com.huawei.android.remotecontroller, com.sina.weibo, com.huawei.hwireader, ctrip.android.view, com.realvnc.android.remote, com.szzc.ucar.pilot, com.huawei.fans, com.ifeng.news2, com.huawei.android.thememanager, com.huawei.vdrive, com.huawei.lives, com.huawei.compass, com.vmall.client, com.example.android.testapp, com.gityuan.providertest]

06-28 14:18:26.394  1830  1931 I AppBlackWhitelist: changeDozeWhiteList remove: [com.huawei.android.airsharing, com.nuance.swype.emui, com.huawei.android.remotecontroller, com.sina.weibo, com.huawei.hwireader, ctrip.android.view, com.realvnc.android.remote, com.szzc.ucar.pilot, com.huawei.fans, com.ifeng.news2, com.huawei.vdrive, com.huawei.lives, com.huawei.compass, com.vmall.client, com.example.android.testapp, com.gityuan.providertest]

### MI

mi6, android7.1.1, kernel 4.4.21, 八核 2.45GB
4GB内存, 64GB存储



sagit:/ $ ps |grep zygote
root      732   1     10780  2260           0 0000000000 S zygote
root      804   1     2179096 92616          0 0000000000 S zygote64
root      806   1     1618888 79332          0 0000000000 S zygote
sagit:/ $ ps | grep -c " 1 "
79
sagit:/ $ ps | grep -c " 2 "                                                   
567
sagit:/ $ ps | grep -c " 804 "                                                 
66
sagit:/ $ ps | grep -c " 806 "                                                 
8
sagit:/ $ ps | grep -c " "                                                     
725

//system_server
sagit:/ $ ps -t | grep " 1583 " -c                                             
204


MI5S稳定版  android 6.0, kernel 3.18.20

shell@capricorn:/ $ ps | grep zygote
root      523   1     8748   1284  __skb_recv 0000000000 S zygote
root      760   1     2108100 75064 poll_sched 0000000000 S zygote64
root      762   1     1549860 54528 poll_sched 0000000000 S zygote
shell@capricorn:/ $ ps | grep -c " 1 "                                         
68
shell@capricorn:/ $ ps | grep -c " 2 "                                         
406
shell@capricorn:/ $ ps | grep -c " 760 "                                       
58
shell@capricorn:/ $ ps | grep -c " 762 "                                       
5
shell@capricorn:/ $ ps | grep -c ""
545
