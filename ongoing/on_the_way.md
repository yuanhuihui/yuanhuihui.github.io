1.SharedPreference
2.properties

## 下一步

1. binder parcel size打点；
2. get provider打点；
3. 从finishKeyguardDrawn的代码来看，调用waitForAllWindowsDrawn是不需要加mLock锁的，而且m10上调waitForAllWindowsDrawn时也没加mLock锁
但是Android 6.0的代码将waitForAllWindowsDrawn移到了finishKeyguardDrawn里，外面调用finishKeyguardDrawn时加了mLock锁，有可能引发死锁？？
4. ANR问题进一步分析： http://wiki.n.miui.com/pages/viewpage.action?pageId=26412002
5. input http://wiki.n.miui.com/pages/viewpage.action?pageId=33095532
6. 学习 http://wiki.n.miui.com/pages/viewpage.action?pageId=28116306

1. Process Stat/analysis，开机进程管理，延迟等工作；
2. 组件指标
3. 自动化分析
4. system进程机制调制
5. 现有injector机制改进
6. handler消息管理
7. 异常问题分析(Service, Broadcast异常) 这个归谁来负责？？ top问题开始分析

top ANR的广播，top的receive？

分工：(不是绝对的分工，相互帮助，平衡工作量，知识体系深度和广度)

1. 感觉到手头bug的工作量负载重，随时跟我沟通；
2. 长线计划，与短线计划。
3. 品质为先。
4. 本地验证，小心猪头。

Process
Broadcast
Service
Provider
Activity
综合问题

优化1：registerReceiver(), 强制将onReceive调整到非主线程。待验证
优化2：http://localhost:4000/2016/07/03/android-anr/，broadcastTimeoutLocked()
mService.mProcessesReady --> 改为looper ready.

### 其他

- 提高性能的方法之一：setprop dalvik.vm.stack-trace-file ""
- 提高trace效率， 增加白名单，有些进程并不放入firstPids ?? 可行乎
- uncatchexception的修改


创建DebugManager.java, 多利用现有的android/os/Debug


### binder问题

类似的道理 http://blog.csdn.net/laisse/article/details/47257385

http://blog.csdn.net/laisse/article/details/47259707

ioctl命令的理解
http://blog.csdn.net/qq429205464/article/details/7822442

#### input两次问题

1. 超时提前统计的功能；
2. 有地方的MIUI ADD，修改input flags可能存在问题。


####

SharedPreferencesImpl的性能问题, 需要优化


### linker文章

http://m.blog.csdn.net/article/details?id=50568693
