1.SharedPreference
2.properties



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
