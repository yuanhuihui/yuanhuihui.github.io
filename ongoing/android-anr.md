### 引言

相信不论是从事Android应用开发，还是Android系统研发，一定都遇到过应用无响应（ANR，Application Not Responding）问题。
当应用程序一段时间无法及时响应，则会弹出ANR对话框，让用户选择继续等待，还是强制关闭。

我曾面试过非常多的候选人，发现多数人对ANR的理解仅停留在主线程耗时导致。
有没有可能主线程不耗时也出现ANR？有多少种场景会在主线程空闲的时候导致ANR? 如何界定ANR哪些是系统导致，哪些是应用自身导致？如何更好的调试ANR?

看完这篇文章，相信能刷新你对ANR的认知，提升你的技术深度。

### ANR触发机制

http://gityuan.com/2016/07/02/android-anr/
http://gityuan.com/2017/01/01/input-anr/

【几个组件的流程图的anr流程】

### ANR实例
provider
shareperferences

### ANR信息收集
http://gityuan.com/2016/12/02/app-not-response/

### ANR技巧

binder, message, lock, io
调试方法


- sharePreference
- query provider
- activity, service, broadcast生命周期
- 锁的竞争
- 耗时的binder需要注意
- 网络，IO， 耗时
