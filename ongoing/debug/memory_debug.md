# memory

1. lostframe

full_log出现The application may be doing too much work on its main thread.这句log是在1s中丢帧30帧以上才会出现，如果lostframe统计出来的数据过多，用户就会感觉卡顿。lowmemorykill会查出每次杀死的进程name和进程的adj，如果前台进程频繁被查杀，肯定是有问题。


2. 搜索关键词：

- fatal exception
- beginning of crash
- build fingerprint：动态库出错造成的严重问题
- DexOpt：这个在找不到apk依赖的库文件或者无法优化apk的时候出现
- NullPointerException或者outofbundexception： 常见异常
- ActivityManager: ANR或者CPU usage from：出现ANR
- jank：丢帧情况
- SystemServiceManager


- zygote :
- ServiceManager:
- Watchdog: Triggering SysRq for system_server watchdog
- died

3. kernel log

- Kernel panic
- Fatal Exception
- PM: suspend: 来查看底层时间点
- UTC 再加8小时 可以对应时间

3. 内存信息

- cat /proc/meminfo，主要关注MemFree，Cached, swap
- dumpsys meminfo： 主要关注是否有应用内存泄露问题，下面的情况可能是异常，需要注意：

     native heap > Dalvik Heap
     activities 数量> viewRootImp 数量+1
     activities > 10 or viewRotImpl > 10 or Views > 5000 or AppContexts > 50

原因往往是：

     1.一些长生命周期的对象引用了Activity,Context,View,Drawable等对象。
     2.在Activity中使用了非静态内部类，这些内部类会自动持有Activity的引用。
     3.不必要的缓存对象。

<https://developer.android.com/studio/profile/investigate-ram.html>

内存泄露：<http://wiki.n.miui.com/pages/viewpage.action?pageId=15490207>

<http://wiki.n.miui.com/pages/viewpage.action?pageId=7360172>

4. 优化

<http://blog.csdn.net/lovelion/article/details/7420888>

- 内存优化：zram+cgroup
- 限制后台进程个数；
- 控制自启动

5. 卡顿问题

- 全局卡顿：
    adb shell dumpsys cpuinfo
    top
    降频率
    io问题

- 局部卡顿：
    应用无响应，看trace.txt就可以看出主线程卡在某个地方了，一般是IO操作或者是死锁。

<http://wiki.n.miui.com/pages/viewpage.action?pageId=7768673>
<http://wiki.n.miui.com/pages/viewpage.action?pageId=8553363>


6. 规律性问题

- 分析现场内存紧张程度：
    events log里面的am_on_lowmemory的频度；
    看kswapd0的 cpu 占用情况；

- 内存碎片化导致卡顿：
    adb shell cat /proc/pagetypeinfo
    adb shell cat /proc/slab


<http://wiki.n.miui.com/pages/viewpage.action?pageId=22909614>
<http://wiki.n.miui.com/pages/viewpage.action?pageId=18983100>
<http://wiki.n.miui.com/pages/viewpage.action?pageId=22911849>

7. 功耗

batterystats解析
<http://wiki.n.miui.com/pages/viewpage.action?pageId=10694697>
<http://wiki.n.miui.com/pages/viewpage.action?pageId=10698876>



[08-12 01:38:24.955]<6>[   16.906919] lowmemorykiller: lowmem_shrink: convert oom_adj to oom_score_adj:
[08-12 01:38:24.955]<6>[   16.906927] lowmemorykiller: oom_adj 0 => oom_score_adj 0
[08-12 01:38:24.955]<6>[   16.906932] lowmemorykiller: oom_adj 1 => oom_score_adj 58
[08-12 01:38:24.955]<6>[   16.906936] lowmemorykiller: oom_adj 2 => oom_score_adj 117
[08-12 01:38:24.955]<6>[   16.906939] lowmemorykiller: oom_adj 3 => oom_score_adj 176
[08-12 01:38:24.955]<6>[   16.906943] lowmemorykiller: oom_adj 9 => oom_score_adj 529
[08-12 01:38:24.955]<6>[   16.906947] lowmemorykiller: oom_adj 15 => oom_score_adj 1000
