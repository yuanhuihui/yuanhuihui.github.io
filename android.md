---
layout: post
title:  "Android系统架构开篇"
permalink: /android/
date:   2016-04-01 11:49:40
catalog:  true
tags:
    - android


---

> **版权声明：**本站所有博文内容均为原创，转载请务必注明作者与原文链接，且不得篡改原文内容。

为便于日常查阅本博客，可通过**[Gityuan博客导航](http://gityuan.com/archive/)**方便检索文章

### 一、引言

本文作为Android系统架构的入门篇，从系统整体架构角度概要讲解Android系统的核心技术点，带领大家初探Android系统全貌以及内部运作机制。虽然Android系统非常庞大且错综复杂，需要具备全面的技术栈，但整体架构设计清晰。Android底层内核空间以Linux Kernel作为基石，上层用户空间由Native系统库、虚拟机运行环境、框架层组成，通过系统调用(Syscall)连通系统的内核空间与用户空间。对于用户空间主要采用C++和Java代码编写，通过JNI技术打通用户空间的Java层和Native层(C++/C)，从而连通整个系统。

为了能让大家整体上大致了解Android系统涉及的知识层面，先来看一张Google官方提供的经典分层架构图，从下往上依次分为Linux内核、HAL、系统Native库和Android运行时环境、Java框架层以及应用层这5层架构，其中每一层都包含大量的子模块或子系统。

![android-arch1](/images/boot/android-stack.png)

上图采用静态分层方式的架构划分，总所周知，程序代码是死的，系统运转是活的，各模块代码运行在不同的进程(线程)中，相互之间进行着各种错终复杂的信息传递与交互流，从这个角度来说此图并没能体现Android整个系统的内部架构、运行机理，以及各个模块之间是如何衔接与配合工作的。**为了更深入地掌握Android整个架构思想以及各个模块在Android系统所处的地位与价值，计划以Android系统启动过程为主线，以进程的视角来诠释Android M系统全貌**，全方位的深度剖析各个模块功能，争取各个击破。这样才能犹如庖丁解牛，解决、分析问题则能游刃有余。


### 二、Android架构

Google提供的5层架构图很经典，但为了更进一步透视Android系统架构，本文更多的是以进程的视角，以分层的架构来诠释Android系统的全貌，阐述Android内部的环环相扣的内在联系。

**系统启动架构图**

点击查看[大图](http://gityuan.com/images/android-process/android-boot.jpg)

![process_status](/images/android-process/android-boot.jpg)


**图解：**
Android系统启动过程由上图从下往上的一个过程是由Boot Loader引导开机，然后依次进入 -> `Kernel` -> `Native` -> `Framework` -> `App`，接来下简要说说每个过程：

关于Loader层：

- Boot ROM: 当手机处于关机状态时，长按Power键开机，引导芯片开始从固化在`ROM`里的预设出代码开始执行，然后加载引导程序到`RAM`；
- Boot Loader：这是启动Android系统之前的引导程序，主要是检查RAM，初始化硬件参数等功能。

#### 2.1 Linux内核层

Android平台的基础是Linux内核，比如ART虚拟机就是依靠底层Linux内核来执行功能。Linux内核的安全机制为Android提供相应的保障，也允许设备制造商为内核开发硬件驱动程序。

- 启动Kernel的swapper进程(pid=0)：该进程又称为idle进程, 系统初始化过程Kernel由无到有开创的第一个进程, 用于初始化进程管理、内存管理，加载Display,Camera Driver，Binder Driver等相关工作；
- 启动kthreadd进程（pid=2）：是Linux系统的内核进程，会创建内核工作线程kworkder，软中断线程ksoftirqd，thermal等内核守护进程。`kthreadd进程是所有内核进程的鼻祖`。

#### 2.2 硬件抽象层 (HAL) 
硬件抽象层 (HAL) 提供标准接口，HAL包含多个库模块，其中每个模块都为特定类型的硬件组件实现一组接口，比如WIFI/蓝牙模块，当框架API请求访问设备硬件时，Android系统将为该硬件加载相应的库模块。

#### 2.3 Android Runtime & 系统库

每个应用都在其自己的进程中运行，都有有自己的虚拟机实例。ART通过执行DEX文件可再设备运行多个虚拟机，DEX文件是一种专为Android设计的字节码格式文件，经过优化，使用内存很少。ART主要功能包括：预先(AOT)和即时(JIT)编译，优化的垃圾回收(GC)，以及调试相关的支持。

这里的Native系统库主要包括init孵化来的用户空间的守护进程、HAL层以及开机动画等。启动init进程(pid=1),是Linux系统的用户进程，`init进程是所有用户进程的鼻祖`。

- init进程会孵化出ueventd、logd、healthd、installd、adbd、lmkd等用户守护进程；
- init进程还启动`servicemanager`(binder服务管家)、`bootanim`(开机动画)等重要服务
- init进程孵化出Zygote进程，Zygote进程是Android系统的第一个Java进程(即虚拟机进程)，`Zygote是所有Java进程的父进程`，Zygote进程本身是由init进程孵化而来的。


#### 2.4 Framework层

- Zygote进程，是由init进程通过解析init.rc文件后fork生成的，Zygote进程主要包含：
  - 加载ZygoteInit类，注册Zygote Socket服务端套接字
  - 加载虚拟机
  - 提前加载类preloadClasses
  - 提前加载资源preloadResouces
- System Server进程，是由Zygote进程fork而来，`System Server是Zygote孵化的第一个进程`，System Server负责启动和管理整个Java framework，包含ActivityManager，WindowManager，PackageManager，PowerManager等服务。
- Media Server进程，是由init进程fork而来，负责启动和管理整个C++ framework，包含AudioFlinger，Camera Service等服务。


#### 2.5 App层

- Zygote进程孵化出的第一个App进程是Launcher，这是用户看到的桌面App；
- Zygote进程还会创建Browser，Phone，Email等App进程，每个App至少运行在一个进程上。
- 所有的App进程都是由Zygote进程fork生成的。

#### 2.6 Syscall && JNI

- Native与Kernel之间有一层系统调用(SysCall)层，见[Linux系统调用(Syscall)原理](http://gityuan.com/2016/05/21/syscall/);
- Java层与Native(C/C++)层之间的纽带JNI，见[Android JNI原理分析](http://gityuan.com/2016/05/28/android-jni/)。

###  三、通信方式

无论是Android系统，还是各种Linux衍生系统，各个组件、模块往往运行在各种不同的进程和线程内，这里就必然涉及进程/线程之间的通信。对于IPC(Inter-Process Communication, 进程间通信)，Linux现有管道、消息队列、共享内存、套接字、信号量、信号这些IPC机制，Android额外还有Binder IPC机制，Android OS中的Zygote进程的IPC采用的是Socket机制，在上层system server、media server以及上层App之间更多的是采用Binder IPC方式来完成跨进程间的通信。对于Android上层架构中，很多时候是在同一个进程的线程之间需要相互通信，例如同一个进程的主线程与工作线程之间的通信，往往采用的Handler消息机制。

想深入理解Android内核层架构，必须先深入理解Linux现有的IPC机制；对于Android上层架构，则最常用的通信方式是Binder、Socket、Handler，当然也有少量其他的IPC方式，比如杀进程Process.killProcess()采用的是signal方式。下面说说Binder、Socket、Handler：


#### 3.1 Binder

Binder作为Android系统提供的一种IPC机制，无论从系统开发还是应用开发，都是Android系统中最重要的组成，也是最难理解的一块知识点，想了解[为什么Android要采用Binder作为IPC机制？](https://www.zhihu.com/question/39440766/answer/89210950) 可查看我在知乎上的回答。深入了解Binder机制，最好的方法便是阅读源码，借用Linux鼻祖Linus Torvalds曾说过的一句话：Read The Fucking Source Code。下面简要说说Binder IPC原理。

**Binder IPC原理**

Binder通信采用c/s架构，从组件视角来说，包含Client、Server、ServiceManager以及binder驱动，其中ServiceManager用于管理系统中的各种服务。

![ServiceManager](/images/binder/prepare/IPC-Binder.jpg)

- 想进一步了解Binder，可查看[Binder系列—开篇](http://gityuan.com/2015/10/31/binder-prepare/)，Binder系列花费了13篇文章的篇幅，从源码角度出发来，讲述Driver、Native、Framework、App四个层面的整个完整流程。根据有些读者反馈这个系列还是不好理解，这个binder涉及的层次跨度比较大，知识量比较广，建议大家先知道binder是用于进程间通信，有个大致概念就可以先去学习系统基本知识，等后面有一定功力再进一步深入研究Binder机制。

**Binder原理篇**

|序号|文章名|概述|
|---|---|---|
|0|[Binder系列—开篇](http://gityuan.com/2015/10/31/binder-prepare/)|Binder概述|
|1|[Binder系列3—启动Service Manager](http://gityuan.com/2015/11/07/binder-start-sm/)|ServiceManager守护进程 注册和查询服务|
|2|[Binder系列4—获取Service Manager](http://gityuan.com/2015/11/08/binder-get-sm/)|获取代理对象BpServiceManager|
|3|[Binder系列5—注册服务(addService)](http://gityuan.com/2015/11/14/binder-add-service/)|注册Media服务|
|4|[Binder系列6—获取服务(getService)](http://gityuan.com/2015/11/15/binder-get-service/)|获取Media代理，以及DeathRecipient|
|5|[Binder系列7—framework层分析](http://gityuan.com/2015/11/21/binder-framework/)|framework层服务注册和查询，Binder注册|
|6|[理解Binder线程池的管理](http://gityuan.com/2016/10/29/binder-thread-pool/)|Binder的startThreadPool过程|
|7|[彻底理解Android Binder通信架构](http://gityuan.com/2016/09/04/binder-start-service/)|startService为主线|
|8|[Binder系列10—总结](http://gityuan.com/2015/11/28/binder-summary/)|Binder的简单总结|
|9|[Binder IPC的权限控制](http://gityuan.com/2016/03/05/binder-clearCallingIdentity/)|clearCallingIdentity/restoreCallingIdentity|
|10|[Binder死亡通知机制之linkToDeath](http://gityuan.com/2016/10/03/binder_linktodeath/)|Binder死亡通知机制|

**Binder驱动篇:**

|---|---|---|
|1|[Binder系列1—Binder Driver初探](http://gityuan.com/2015/11/01/binder-driver/)|驱动open/mmap/ioctl，以及binder结构体|
|2|[Binder系列2—Binder Driver再探](http://gityuan.com/2015/11/02/binder-driver-2/)|Binder通信协议，内存机制|

**Binder使用篇:**

|---|---|---|
|1|[Binder系列8—如何使用Binder](http://gityuan.com/2015/11/22/binder-use/)|Native层、Framwrok层自定义Binder服务|
|2|[Binder系列9—如何使用AIDL](http://gityuan.com/2015/11/23/binder-aidl/)|App层自定义Binder服务|

#### 3.2 Socket

Socket通信方式也是C/S架构，比Binder简单很多。在Android系统中采用Socket通信方式的主要：

- zygote：用于孵化进程，system_server创建进程是通过socket向zygote进程发起请求；
- installd：用于安装App的守护进程，上层PackageManagerService很多实现最终都是交给它来完成；
- lmkd：lowmemorykiller的守护进程，Java层的LowMemoryKiller最终都是由lmkd来完成；
- adbd：这个也不用说，用于服务adb；
- logcatd:这个不用说，用于服务logcat；
- vold：即volume Daemon，是存储类的守护进程，用于负责如USB、Sdcard等存储设备的事件处理。

等等还有很多，这里不一一列举，Socket方式更多的用于Android framework层与native层之间的通信。Socket通信方式相对于binder比较简单，这里省略。

#### 3.3 Handler

**Binder/Socket用于进程间通信，而Handler消息机制用于同进程的线程间通信**，Handler消息机制是由一组MessageQueue、Message、Looper、Handler共同组成的，为了方便且称之为Handler消息机制。

有人可能会疑惑，为何Binder/Socket用于进程间通信，能否用于线程间通信呢？答案是肯定，对于两个具有独立地址空间的进程通信都可以，当然也能用于共享内存空间的两个线程间通信，这就好比杀鸡用牛刀。接着可能还有人会疑惑，那handler消息机制能否用于进程间通信？答案是不能，Handler只能用于共享内存地址空间的两个线程间通信，即同进程的两个线程间通信。很多时候，Handler是工作线程向UI主线程发送消息，即App应用中只有主线程能更新UI，其他工作线程往往是完成相应工作后，通过Handler告知主线程需要做出相应地UI更新操作，Handler分发相应的消息给UI主线程去完成，如下图：

![handler_communication](/images/handler/handler_thread_commun.jpg)

由于工作线程与主线程共享地址空间，即Handler实例对象mHandler位于线程间共享的内存堆上，工作线程与主线程都能直接使用该对象，只需要注意多线程的同步问题。工作线程通过mHandler向其成员变量MessageQueue中添加新Message，主线程一直处于loop()方法内，当收到新的Message时按照一定规则分发给相应的handleMessage()方法来处理。所以说，而Handler消息机制用于同进程的线程间通信的核心是线程间共享内存空间，而不同进程拥有不同的地址空间，也就不能用handler来实现进程间通信。

上图只是Handler消息机制的一种处理流程，是不是只能工作线程向UI主线程发消息呢，其实不然，可以是UI线程向工作线程发送消息，也可以是多个工作线程之间通过handler发送消息。更多关于Handler消息机制文章：

- [Android消息机制-Handler(framework篇)](http://gityuan.com/2015/12/26/handler-message-framework/)
- [Android消息机制-Handler(native篇)](http://gityuan.com/2015/12/27/handler-message-native/)
- [Android消息机制3-Handler(实战)](http://gityuan.com/2016/01/01/handler-message-usage/)

要理解framework层源码，掌握这3种基本的进程/线程间通信方式是非常有必要，当然Linux还有不少其他的IPC机制，比如共享内存、信号、信号量，在源码中也有体现，如果想全面彻底地掌握Android系统，还是需要对每一种IPC机制都有所了解。

###  四、核心提纲

博主对于Android从系统底层一路到上层有自己的理解和沉淀，通过前面对系统启动的介绍，相信大家对Android系统有了一个整体观，接下来需要抓核心、理思路，争取各个击破。后续持续新增和完善整个大纲，不限于进程、内存、IO、系统服务框架，整体架构以及各种系统分析实战等文章。

当然本站有一些文章没来得及进一步加工，有时间根据大家的反馈，不断修正和完善所有文章，争取给文章，再进一步精简非核心代码，增加可视化图表以及文字的结论性分析。基于**Android 6.0的源码**，专注于分享Android系统原理、架构分析的原创文章。  
 
**建议阅读群体**： 适合于正从事或者有兴趣研究Android系统的工程师或者技术爱好者，也适合Android App高级工程师；对于尚未入门或者刚入门的App工程师阅读可能会有点困难，建议先阅读更基础的资料，再来阅读本站博客。

看到Android整个系统架构是如此庞大的, 该问如何学习Android系统, 以下是我自己的Android的学习和研究论，仅供参考[如何自学Android](http://gityuan.com/2016/04/24/how-to-study-android/)。

从整理上来列举一下Android系统的核心知识点概览：

![Android_os](/images/android-arch/android_os.png)

#### 4.1 系统启动系列

![android-booting](/images/process/android-booting.jpg)

[Android系统启动-概述](http://gityuan.com/2016/02/01/android-booting/):
Android系统中极其重要进程：init, zygote, system_server, servicemanager 进程:

|序号|进程启动|概述|
|1|[init进程](http://gityuan.com/2016/02/05/android-init/)|Linux系统中用户空间的第一个进程, Init.main|
|2|[zygote进程](http://gityuan.com/2016/02/13/android-zygote/)|所有Ａpp进程的父进程, ZygoteInit.main|
|3|[system_server进程(上篇)](http://gityuan.com/2016/02/14/android-system-server/)|系统各大服务的载体, forkSystemServer过程|
|4|[system_server进程(下篇)](http://gityuan.com/2016/02/20/android-system-server-2/)|系统各大服务的载体, SystemServer.main|
|5|[servicemanager进程](http://gityuan.com/2015/11/07/binder-start-sm/)|binder服务的大管家, 守护进程循环运行在binder_loop|
|6|[app进程](http://gityuan.com/2016/03/26/app-process-create/)|通过Process.start启动App进程, ActivityThread.main|


再来看看守护进程(也就是进程名一般以d为后缀，比如logd，此处d是指daemon的简称), 下面介绍部分守护进程：

  - [debuggerd](http://gityuan.com/2016/06/15/android-debuggerd/)
  - [installd](http://gityuan.com/2016/11/13/android-installd)
  - [lmkd](http://gityuan.com/2016/09/17/android-lowmemorykiller/)
  - [logd](http://gityuan.com/2018/01/27/android-log/)

#### 4.2 系统稳定性系列

 [Android系统稳定性](http://gityuan.com/2016/06/19/stability_summary/)主要是异常崩溃(crash)和执行超时(timeout),:

|序号|文章名|概述|
|1|[理解Android ANR的触发原理](http://gityuan.com/2016/07/02/android-anr/)|触发ANR的场景以及机理|
|2|[Input系统—ANR原理分析](http://gityuan.com/2017/01/01/input-anr/)|input触发ANR的原理|
|3|[理解Android ANR的信息收集过程](http://gityuan.com/2016/12/02/app-not-response/)|AMS.appNotResponding过程分析,收集traces|
|4|[解读Java进程的Trace文件](http://gityuan.com/2016/11/26/art-trace/)|kill -3 信息收集过程|
|5|[Native进程之Trace原理](http://gityuan.com/2016/11/27/native-traces/)|debuggerd -b 信息收集过程|
|6|[WatchDog工作原理](http://gityuan.com/2016/06/21/watchdog/)|WatchDog触发机制|
|7|[理解Java   Crash处理流程](http://gityuan.com/2016/06/24/app-crash/)|AMS.handleApplicationCrash过程分析|
|8|[理解Native Crash处理流程](http://gityuan.com/2016/06/25/android-native-crash/)|debuggerd守护进程|
|9|[global reference限制策略](http://gityuan.com/2019/01/19/global_ref/)|global reference|

#### 4.3 Android进程系列
进程/线程是操作系统的魂，各种服务、组件、子系统都是依附于具体的进程实体。深入理解进程机制对于掌握Android系统整体架构和运转机制是非常有必要的，是系统工程师的基本功，下面列举进程相关的文章：

|序号|文章名|概述|
|1|[理解Android进程创建流程](http://gityuan.com/2016/03/26/app-process-create/)|Process.start过程分析|
|2|[理解杀进程的实现原理](http://gityuan.com/2016/04/16/kill-signal/)|Process.killProcess过程分析|
|3|[Android四大组件与进程启动的关系](http://gityuan.com/2016/10/09/app-process-create-2/)|AMS.startProcessLocked过程分析组件与进程|
|4|[Android进程绝杀技--forceStop](http://gityuan.com/2016/10/22/force-stop/)|force-stop过程分析彻底移除组件与杀进程|
|5|[理解Android线程创建流程](http://gityuan.com/2016/09/24/android-thread/)|3种不同线程的创建过程|
|6|[彻底理解Android Binder通信架构](http://gityuan.com/2016/09/04/binder-start-service/)|以start-service为线,阐述进程间通信机理|
|7|[理解Binder线程池的管理](http://gityuan.com/2016/10/29/binder-thread-pool/)|Zygote fork的进程都默认开启binder线程池|
|8|[Android进程生命周期与ADJ](http://gityuan.com/2015/10/01/process-lifecycle/)|进程adj, processState以及lmk|
|9|[Android LowMemoryKiller原理分析](http://gityuan.com/2016/09/17/android-lowmemorykiller/)|lmk原理分析|
|10|[进程优先级](http://gityuan.com/2015/10/01/process-priority/)|进程nice,thread priority以及scheduler|
|11|[Android进程调度之adj算法](http://gityuan.com/2016/08/07/android-adj/)|updateOomAdjLocked过程|
|12|[Android进程整理](http://gityuan.com/2015/12/19/android-process-category/)|整理系统的所有进程/线程|

#### 4.4 四大组件系列
对于App来说，Android应用的四大组件Activity，Service，Broadcast Receiver， Content Provider最为核心，接下分别展开介绍：

|序号|文章名|类别|
|1|[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)|Activity|
|2|[简述Activity生命周期](http://gityuan.com/2016/03/18/start-activity-cycle/)|Activity|
|3|[startService启动过程分析](http://gityuan.com/2016/03/06/start-service/)|Service|
|4|[bindService启动过程分析](http://gityuan.com/2016/05/01/bind-service/)|Service|
|5|[以Binder视角来看Service启动](http://gityuan.com/2016/09/04/binder-start-service/)|Service|
|6|[Android Broadcast广播机制分析](http://gityuan.com/2016/06/04/broadcast-receiver/)|Broadcast|
|7|[理解ContentProvider原理](http://gityuan.com/2016/07/30/content-provider/)|ContentProvider|
|8|[ContentProvider引用计数](http://gityuan.com/2016/05/03/content_provider_release/)|ContentProvider|
|9|[Activity与Service生命周期](http://gityuan.com/2015/05/31/android-lifecycle/)|Activity&&Service|
|10|[简述Activity与Window关系](http://gityuan.com/2017/04/16/activity-with-window/)|Activity&&Window|
|11|[四大组件之综述](http://gityuan.com/2017/05/19/ams-abstract/)|AMS|
|12|[四大组件之ServiceRecord](http://gityuan.com/2017/05/25/service_record/)|Service|
|13|[四大组件之BroadcastRecord](http://gityuan.com/2017/06/03/broadcast_record/)|Broadcast|
|14|[四大组件之ContentProviderRecord](http://gityuan.com/2017/06/04/content_provider_record/)|ContentProvider|
|15|[理解Android Context](http://gityuan.com/2017/04/09/android_context/)|Context|
|16|[理解Application创建过程](http://gityuan.com/2017/04/02/android-application/)|Application|
|17|[unbindService流程分析](http://gityuan.com/2016/05/02/unbind-service/)|Service|
|18|[四大组件之ActivityRecord](http://gityuan.com/2017/06/11/activity_record/)|Activity|
|19|[AMS总结(一)](http://gityuan.com/2017/06/25/ams_summary_1/)|AMS|

#### 4.5 图形系统系列
图形也是整个系统非常复杂且重要的一个系列，涉及WindowManager,SurfaceFlinger服务。

|序号|文章名|类别|
|1|[WindowManager启动篇](http://gityuan.com/2017/01/08/windowmanger/)|Window|
|2|[WMS之启动窗口篇](http://gityuan.com/2017/01/15/wms_starting_window/)|Window|
|3|[以Window视角来看startActivity](http://gityuan.com/2017/01/22/start-activity-wms/)|Window|
|4|[Android图形系统概述](http://gityuan.com/2017/02/05/graphic_arch/)|SurfaceFlinger|
|5|[SurfaceFlinger启动篇](http://gityuan.com/2017/02/11/surface_flinger/)|SurfaceFlinger|
|6|[SurfaceFlinger绘图篇](http://gityuan.com/2017/02/18/surface_flinger_2/)|SurfaceFlinger|
|7|[Choreographer原理](http://gityuan.com/2017/02/25/choreographer/)|Choreographer|

#### 4.6 系统服务篇
再则就是在整个架构中有大量的服务，都是基于[Binder](http://gityuan.com/2015/10/31/binder-prepare/)来交互的，[Android系统服务的注册过程](http://gityuan.com/2016/10/01/system_service_common/)也是在此之上的构建的。计划针对部分核心服务来重点分析：

- AMS服务
  - [AMS启动过程（一）](http://gityuan.com/2016/02/21/activity-manager-service/)
  - 更多组件篇[见小节4.3]
- Input系统
  - [Input系统—启动篇](http://gityuan.com/2016/12/10/input-manager/)
  - [Input系统—InputReader线程](http://gityuan.com/2016/12/11/input-reader/)
  - [Input系统—InputDispatcher线程](http://gityuan.com/2016/12/17/input-dispatcher/)
  - [Input系统—UI线程](http://gityuan.com/2016/12/24/input-ui/)
  - [Input系统—进程交互](http://gityuan.com/2016/12/31/input-ipc/)
  - [Input系统—ANR原理分析](http://gityuan.com/2017/01/01/input-anr/)
- PKMS服务
  - [PackageManager启动篇](http://gityuan.com/2016/11/06/packagemanagerservice)
  - [Installd守护进程](http://gityuan.com/2016/11/13/android-installd)
- Alarm服务
  - [理解AlarmManager机制](http://gityuan.com/2017/03/12/alarm_manager_service/)
- JobScheduler服务
  - [理解JobScheduler机制](http://gityuan.com/2017/03/10/job_scheduler_service/)
- BatteryService
  - [Android耗电统计算法](http://gityuan.com/2016/01/10/power_rank/)
- PMS服务
- DropBox服务
  - [DropBoxManager启动篇](http://gityuan.com/2016/06/12/DropBoxManagerService/)
- UserManagerService
  - [多用户管理UserManager](http://gityuan.com/2016/11/20/user_manager/)
- 更多系统服务
  - 敬请期待

#### 4.7 内存&&存储篇

- 内存篇
    - [Android LowMemoryKiller原理分析](http://gityuan.com/2016/09/17/android-lowmemorykiller/)
    - [Linux内存管理](http://gityuan.com/2015/10/30/kernel-memory/)
    - [Android内存分析命令](http://gityuan.com/2016/01/02/memory-analysis-command/)
- 存储篇
    - [Android存储系统之源码篇](http://gityuan.com/2016/07/17/android-io/)
    - [Android存储系统之架构篇](http://gityuan.com/2016/07/23/android-io-arch)
- Linux驱动篇
    - 敬请期待
- dalvik/art
    - [解读Java进程的Trace文件](http://gityuan.com/2016/11/26/art-trace/)

#### 4.8 工具篇
再来说说Android相关的一些常用命令和工具以及调试手段.

|序号|文章名|类别|
|1|[理解Android编译命令](http://gityuan.com/2016/03/19/android-build/)|build|
|2|[理解Android.bp](http://gityuan.com/2018/06/02/android-bp/)|build|
|2|[性能工具Systrace](http://gityuan.com/2016/01/17/systrace/)|systrace|
|3|[Android内存分析命令](http://gityuan.com/2016/01/02/memory-analysis-command/)|Memory|
|4|[ps进程命令](http://gityuan.com/2015/10/11/ps-command/)|Process|
|5|[Am命令用法](http://gityuan.com/2016/02/27/am-command/)|Am|
|6|[Pm命令用法](http://gityuan.com/2016/02/28/pm-command/)|Pm|
|7|[调试系列1：bugreport源码篇](http://gityuan.com/2016/06/10/bugreport/)|bugreport|
|8|[调试系列2：bugreport实战篇](http://gityuan.com/2016/06/11/bugreport-2/)|bugreport|
|9|[dumpsys命令用法](http://gityuan.com/2016/05/14/dumpsys-command/)|dumpsys|
|10|[Android logd日志原理](http://gityuan.com/2018/01/27/android-log/)|logd|
|11|[介绍gdb调试工具](http://gityuan.com/2017/09/09/gdb/)|gdb|
|12|[介绍addr2line调试命令](http://gityuan.com/2017/09/02/addr2line/)|addr2line|

#### 4.9 实战篇
下面列举处理过的部分较为典型的案例，供大家参考

|序号|文章名|类别|
|1|[Binder Driver缺陷导致定屏的案例](http://gityuan.com/2018/05/12/binder-driver-bug/)|binder|
|2|[深度解读ArrayMap优势与缺陷](http://gityuan.com/2019/01/13/arraymap/)|ArrayMap|
|3|[数组越界导致系统重启的案例](http://gityuan.com/2018/02/10/reboot-locked-method/)|数组越界|
|4|[一行Log引发多线程并发问题的案例](http://gityuan.com/2018/02/03/log-fc/)|多线程并发|
|5|[跑monkey压力测试过程的冻屏案例](http://gityuan.com/2018/02/17/monkey-deadlock/)|monkey冻屏|
|6|[深度剖析APP保活案例](http://gityuan.com/2018/02/24/process-keep-forever/)|保活|

### 五、结束语

Android系统之博大精深，包括Linux内核、Native、虚拟机、Framework，通过系统调用连通内核与用户空间，通过JNI打通用户空间的Java层和Native层，通过Binder、Socket、Handler等打通跨进程、跨线程的信息交换。只有真正阅读并理解系统核心架构的设计，解决问题和设计方案才能做到心中无剑胜有剑，才能做到知其然知其所以然。当修炼到此，恭喜你对系统有了更高一个层次的理解，正如太极剑法，忘记了所有招式，也就练成了太极剑法。

再回过头去看看那些API，看到的将不再是一行行代码、一个个接口的调用，而是各种信息的传递与交互工作，而是背后成千上万个小蝌蚪的动态执行流。记得《侠客行》里面的龙木二岛主终其一生也无法参透太玄经，石破天却短短数日练成绝世神功，究其根源是龙木二岛主以静态视角去解读太玄经，而石破天把墙壁的图案想象成无数游动的蝌蚪，最终成就绝世神功。一言以蔽之，程序代码是死的，系统运转是活的，要以动态视角去理解系统架构。

---

博主能力和精力有限，如有表述不正确，望海涵，请[联系我](http://gityuan.com/about/)，感谢大家的支持！
