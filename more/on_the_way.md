2.properties


binder 是不是可以减少向servicemanager来查询的操作, 直接缓存起来.


https://source.android.com/devices/tech/debug/jank_jitter#fd-contention
https://android.googlesource.com/kernel/msm/+/1a7a93bd33f48a369de29f6f2b56251127bf6ab4%5E!/


## 下一步

1. binder parcel size打点；
2. get provider打点；
3. 从finishKeyguardDrawn的代码来看，调用waitForAllWindowsDrawn是不需要加mLock锁的，而且m10上调waitForAllWindowsDrawn时也没加mLock锁
但是Android 6.0的代码将waitForAllWindowsDrawn移到了finishKeyguardDrawn里，外面调用finishKeyguardDrawn时加了mLock锁，有可能引发死锁？？
4. ANR问题进一步分析： http://wiki.n.miui.com/pages/viewpage.action?pageId=26412002
5. input http://wiki.n.miui.com/pages/viewpage.action?pageId=33095532
6. 学习 http://wiki.n.miui.com/pages/viewpage.action?pageId=28116306


优化1：registerReceiver(), 强制将onReceive调整到非主线程。待验证
优化2：http://localhost:4000/2016/07/03/android-anr/，broadcastTimeoutLocked()
mService.mProcessesReady --> 改为looper ready.






### 其他

- 提高性能的方法之一：setprop dalvik.vm.stack-trace-file ""
- 提高trace效率， 增加白名单，有些进程并不放入firstPids ?? 可行乎
- uncatchexception的修改


### binder问题

类似的道理 http://blog.csdn.net/laisse/article/details/47257385

http://blog.csdn.net/laisse/article/details/47259707

ioctl命令的理解
http://blog.csdn.net/qq429205464/article/details/7822442

### linker文章

http://m.blog.csdn.net/article/details?id=50568693
