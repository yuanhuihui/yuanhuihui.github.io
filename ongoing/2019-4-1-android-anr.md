---
layout: post
title:  "ANR"
date:   2019-4-1 22:19:53
catalog:    true
tags:
    - android

---

### 引言

相信不论是从事Android应用开发，还是Android系统研发，一定都遇到过应用无响应（ANR，Application Not Responding）问题。
当应用程序一段时间无法及时响应，则会弹出ANR对话框，让用户选择继续等待，还是强制关闭。

我曾面试过非常多的候选人，发现多数人对ANR的理解仅停留在主线程耗时导致。
有没有可能主线程不耗时也出现ANR？有多少种场景会在主线程空闲的时候导致ANR? 如何更好的调试ANR?

看完这篇文章，相信能刷新你对ANR的认知，提升你的技术深度。

### ANR触发机制

我在公司少说也面试过上百人，说到ANR，一般回答都是主线程耗时或CPU繁忙，再或者等锁之类的，几乎很少有人能真正从系统级去梳理ANR完整的来龙去脉。
对于知识的掌握要知其然知其所以然，才能做到庖丁解牛般游刃有余。

要理解ANR，当然先要明白ANR的完整触发机制，常见的ANR有service、broadcast、input以及provider，接下来分别看看。

#### service超时机制

ANR是一套监控Android应用响应是否及时的机制，流程包含三个部分：

1. 埋定时炸弹：在适合的时机下，中控系统(system_server进程)启动倒计时，在规定时间内如果目标(应用进程)没有干完所有的活，则系统定向炸毁(杀进程)目标。
2. 拆炸弹：在规定的时间内，干完工地的所有活，并立刻向中控系统报告，请求解除定时炸弹，则幸免于难。
3. 引爆炸弹：中控系统立即封装现场，抓取快照，搜集目标干活慢的罪证(traces)，便于后续的案件侦破（程序员的调试分析）。

下面来看看埋炸弹与拆炸弹在整个服务启动(startService)过程所处的环节。

![service_anr](/images/android-anr/service_anr.jpg)

- 某应用发起启动服务的请求，中控系统(system_server进程)派出一名空闲状态的通信员(binder线程)接收该请求
- 通讯员1号(binder_1)先向中控系统的组件管家(ActivityManager线程)发送消息，埋下定时炸弹；再通知工地(service所在进程)的通信员开始干活了

#### broadcast超时机制
![broadcast_anr](/images/android-anr/broadcast_anr.jpg)

![broadcast_anr_2](/images/android-anr/broadcast_anr_2.jpg)

#### provider超时机制
![provider_anr](/images/android-anr/provider_anr.jpg)

#### input超时机制
![input_anr](/images/android-anr/input_anr.jpg)

input超时

EventHub的工作

inputReader的工作

inputDispatcher的工作

#### 前台与后台ANR
- 前台ANR 和后台ANR 的区别是什么？


#### 前台与后台服务超时

两种前台服务的区别?

对于前台服务，则ＡＮＲ超时为20s
对于后台服务，则ＡＮＲ超时为 200s

bindService或者startService是否前台调用取决于caller进程的调度组。

当caller属于SCHED_GROUP_BACKGROUND则认为是后台调用，

当不属于SCHED_GROUP_BACKGROUND则认为是前台调用。callerFg = callerApp.setSchedGroup != ProcessList.SCHED_GROUP_BACKGROUND;



ServiceRecord.createdFromFg

当发起方进程不等于Process.THREAD_GROUP_BG_NONINTERACTIVE,或者发起方为空, 则callerFg= true;
否则,callerFg= false;

==>贴一下AS.startServiceLocked()核心代码.



==>再讲讲THREAD_GROUP_BG_NONINTERACTIVE.

关于进程优先级（ADJ）和进程调度组（SCHED_GROUP）算法较为复杂，大家可以简单理解，大多数情况下，adj小于100的进程属于top进程组，adj等于100或者200的进程属于前台进程组，adj大于200的进程属于后台进程组，当然事实上adj跟进程调度组之间的关系远比这个复杂．有兴趣的同学可以参考我的文章xxx.

此处，列举一张adj的图片．


#### 前台与后台广播超时
两种广播的区别？

对于前台广播，则ＡＮＲ超时为10s
对于后台广播，则ＡＮＲ超时为60s


broadcastQueueForIntent(Intent intent)通过判断intent.getFlags()是否包含FLAG_RECEIVER_FOREGROUND 来决定是前台或后台广播，进而返回相应的广播队列mFgBroadcastQueue或者mBgBroadcastQueue。默认情况广播都是属于后台广播队列，拥有更长的超时时长．

==> AMS.broadcastQueueForIntent核心代码。

当Intent的flags包含FLAG_RECEIVER_FOREGROUND，则该广播位于前台广播队列
当Intent的flags不包含FLAG_RECEIVER_FOREGROUND，则该广播位于前台广播队列

### ANR信息收集
对于service、broadcast、input发生ANR后，会马上去抓取现场的信息，用于调试分析。收集的信息包括如下：

- 将am_anr信息输出到EventLog，也就是说ANR触发的时间点最接近的就是EventLog中输出的am_anr信息;
- 收集以下重要进程的各个线程调用栈trace信息，保存在data/anr/traces.txt文件
    - Java进程：当前发生ANR的进程，system_server进程，所有的persistent进程
    - Native进程：
    - CPU使用率排名前5的进程
- ANR reason以及CPU使用情况信息，输出到main log;
- 再将traces文件和 CPU使用情况信息保存到dropbox，即data/system/dropbox目录
- 对用户不可感知的进程发生ANR，则直接杀掉；对用户可感知的进程则弹出ANR对话框告知用户

整个ANR信息收集过程比较耗时，其中抓取进程的trace信息，每抓取一个等待200ms，可见persistent越多，等待时间越长。

关于抓取trace命令，对于Java进程可通过在adb shell环境下执行kill -3 [pid]可抓取相应pid的调用栈；对于Native进程在adb shell环境下执行debuggerd -b [pid]可抓取相应pid的调用栈。对于ANR问题发生后的蛛丝马迹(trace)在traces.txt和dropbox目录中保存记录。

### ANR技巧


#### 实例

#### 调试方法
binder, message, lock, io

#### 注意点

- sharePreference
- query provider
- activity, service, broadcast生命周期
- 锁的竞争
- 耗时的binder需要注意
- 网络，IO， 耗时


参考文章：
http://gityuan.com/2016/12/02/app-not-response/
