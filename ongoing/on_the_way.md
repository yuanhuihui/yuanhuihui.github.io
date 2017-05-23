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




1. 模块划分: Broadcast/Service/Provider/Activity/Process/综合问题;
2. 周报格式: 长线计划进展, 总结情况数据化, 表格化, 面试情况, 下一步计划.
3. jira: 每周及时更新, 提交代码不要漏分支,小心猪头
4. 长线计划: 建立自己的长线计划,
5. 重要工作: mqsas的top问题, 以及能品质提升的工作;
6. 工作负载情况,及时沟通；


关于长线计划与重要工作, 几点想法:

1. Process analysis，开机进程管理，服务架构调整等工作；
2. 组件指标 (Broadcast/Service/Provider/Activity/Process)
3. 自动化分析
4. system进程中架构调整, handler消息管理
5. 现有injector机制改进
6. 组件异常问题分析,(KLO, MQSAS)




分工的意义: 不是绝对的分工，平衡工作量，知识体系深度和广度
时间管理:
学习方式: 多问自己一个问题, 多去尝试自己不太舒服的区域, 比如C++不熟悉, 就多去看.
培训计划:


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
