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


#### 录屏

1. input事件的展示； mShowInputEventForScreenRecorder；
notifyShowInputEventSwitchChanged();
void switchTouchCaptouchMode(in boolean modeOn);
notifyLedSwitchChanged();
2. 增加直接录屏的广播，并且带录屏参数，尤其是是否input事件；
