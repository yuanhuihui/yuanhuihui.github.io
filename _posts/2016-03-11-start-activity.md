---
layout: post
title:  "startActivity流程分析(一)"
date:   2016-03-11 20:09:12
categories: android
excerpt:  startActivity流程分析(一)
---

* content
{:toc}

---

> 基于Android 6.0的源码剖析， 分析android Activity启动流程中ActivityManagerService所扮演的角色


	/frameworks/base/services/core/java/com/android/server/am/ActiveServices.java
	/frameworks/base/services/core/java/com/android/server/am/ProcessRecord.java

	/frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java
	/frameworks/base/core/java/android/app/IActivityManager.java
	/frameworks/base/core/java/android/app/ActivityManagerNative.java (内含ActivityManagerProxy类)
	/frameworks/base/core/java/android/app/ActivityManager.java

	/frameworks/base/core/java/android/app/IApplicationThread.java
	/frameworks/base/core/java/android/app/ApplicationThreadNative.java (内含ApplicationThreadProxy类)
	/frameworks/base/core/java/android/app/ActivityThread.java (内含ApplicationThread类)

	/frameworks/base/core/java/android/app/ContextImpl.java


### 一、启动过程

`startActivity`的整体流程与[startService流程](http://www.yuanhh.com/2016/02/21/start-service/)非常相近，但比服务启动更为复杂，多了UI的相关内容以及Activity的生命周期更为丰富。

对于Activity的启动过程，可用如下图来概括。

![start_activity_process](/images/activity/start_activity_process.jpg)


启动流程：

1. 点击桌面App图标，Launcher进程采用Binder IPC向system_server进程发起startActivity请求；
2. system_server进程接收到请求后，向zygote进程发送创建进程的请求；
3. Zygote进程fork出新的子进程，即App进程；
4. App进程，通过Binder IPC向sytem_server进程发起attachApplication请求；
5. system_server进程在收到请求后，进行一系列准备工作后，再通过binder IPC向App进程发送scheduleLaunchActivity请求；
6. App进程的binder线程（ApplicationThread）在收到请求后，通过handler向主线程发送LAUNCH_ACTIVITY消息；
7. 主线程在收到Message后，通过发射机制创建目标Activity，并回调Activity.onCreate()等方法。

到此，App便正式启动，开始进入Activity生命周期，执行完onCreate/onStart/onResume方法，UI渲染结束后便可以看到App的主界面。

启动Activity较为复杂，涉及UI渲染问题，后续再单独篇幅从源码角度阐述该过程。

### 二、Activity生命周期

#### 2.1 Activity状态

Activity的生命周期中只有在以下3种状态之一，才能较长时间内保持状态不变。

![activity_lifecycle](/images/activity/activity_lifecycle.jpg)



- **Resumed（运行状态）**：Activity处于前台，且用户可以与其交互。
- **Paused（暂停状态）**: Activity被在前台中处于半透明状态或者未覆盖全屏的其他Activity部分遮挡。 暂停的Activity不会接收用户输入，也无法执行任何代码。
- **Stopped（停止状态）**：Activity被完全隐藏，且对用户不可见；被视为后台Activity。 停止的Activity实例及其诸如成员变量等所有状态信息将保留，但它无法执行任何代码。

除此之外，其他状态都是过渡状态(或称为暂时状态)，比如onCreate()，onStart()后很快就会调用onResume()方法

#### 2.2 生命周期

对于App来说，其Activity的生命周期执行是由系统进程中的·ActivityManagerService·服务触发的，接下来从进程和线程的角度来分析Activity的生命周期，这里涉及到系统进程和应用进程：

**system_server进程是系统进程**，java framework框架的核心载体，里面运行了大量的系统服务，比如这里提供ApplicationThreadProxy（简称ATP），ActivityManagerService（简称AMS），这个两个服务都运行在system_server进程的不同线程中，由于ATP和AMS都是基于IBinder接口，都是binder线程，binder线程的创建与销毁都是由binder驱动来决定的。

**App进程是应用程序所在进程**，主线程主要负责Activity/Service等组件的生命周期以及UI相关操作都运行在这个线程； 另外，每个App进程中至少会有两个binder线程 ApplicationThread(简称AT)和ActivityManagerProxy（简称AMP），除了下图中所示的线程，其实还有很多线程，比如signal catcher线程等。

![app_process](/images/activity/app_process.jpg)

`Binder`用于不同进程之间通信，由一个进程的Binder客户端向另一个进程的服务端发送事件，比如图中线程2向线程4发送事务；而`handler`用于同一个进程中不同线程的通信，比如图中线程4向主线程发送消息。

结合图说说Activity生命周期，比如暂停Activity的流程如下：

- `线程1`的AMS中调用`线程2`的ATP来发送事件；（由于同一个进程的线程间资源共享，可以相互直接调用，但需要注意多线程并发问题）
- `线程2`通过binder将暂停Activity的事件传输到App进程的`线程4`；
- `线程4`通过handler消息机制，将暂停Activity的消息发送给`主线程`；
- `主线程`在looper.loop()中循环遍历消息，当收到暂停Activity的消息(`PAUSE_ACTIVITY`)时，便将消息分发给ActivityThread.H.handleMessage()方法，再经过方法的层层调用，最后便会调用到Activity.onPause()方法。

这便是由AMS完成了onPause()控制，那么同理Activity的其他生命周期也是这么个流程来进行控制的。

### 三、流程分析

通过`ActivityThread`的内部类`H.handleMessage()`来控制Activity的生命周期，在H类中共定义了50种消息。

#### 3.1 启动应用

消息： `LAUNCH_ACTIVITY`

**调用链**

	ActivityThread.handleLaunchActivity
		ActivityThread.handleConfigurationChanged
			ActivityThread.performConfigurationChanged
				ComponentCallbacks2.onConfigurationChanged

		ActivityThread.performLaunchActivity
			LoadedApk.makeApplication
				Instrumentation.callApplicationOnCreate
					Application.onCreate
		
			Instrumentation.callActivityOnCreate
				Activity.performCreate
					Activity.onCreate
	
			Instrumentation.callActivityonRestoreInstanceState
				Activity.performRestoreInstanceState
					Activity.onRestoreInstanceState

		ActivityThread.handleResumeActivity
			ActivityThread.performResumeActivity
				Activity.performResume
					Activity.performRestart
						Instrumentation.callActivityOnRestart
							Activity.onRestart
	
						Activity.performStart
							Instrumentation.callActivityOnStart
								Activity.onStart
	
					Instrumentation.callActivityOnResume
						Activity.onResume

采用缩进方式，来代表方法的调用链，相同缩进层的方法代表来自位于同一个调用方法里。callActivityOnCreate和callActivityonRestoreInstanceState相同层级，代表都是由上一层级的ActivityThread.performLaunchActivity()方法中调用。

**App角度**

调用链过程层层调用，但对上层应用是透明的，App开发者只需要覆写其中重要的回调函数即可，故此处所说的App角度，便是指App开发者来说可见之处。经过上述的调用链，依次会执行下面回调方法。

1. ComponentCallbacks2.onConfigurationChanged()：
2. Application.onCreate()
3. Activity.onCreate()
4. Activity.onRestoreInstanceState()
5. Activity.onRestart()
6. Activity.onStart() 
7. Activity.onResume() 
 
Application和Activity都实现了ComponentCallbacks2接口；所以Application和Activity会先执行onConfigurationChanged()回调方法。在前面说过onCreate()是过渡状态，紧跟着会执行handleResumeActivity()方法，然后就进入Resumed状态。

#### 3.2 恢复应用

消息： `RESUME_ACTIVITY`

**调用链**

	ActivityThread.handleResumeActivity
		ActivityThread.performResumeActivity
			Activity.performResume
				Activity.performRestart
					Instrumentation.callActivityOnRestart
						Activity.onRestart

					Activity.performStart
						Instrumentation.callActivityOnStart
							Activity.onStart

				Instrumentation.callActivityOnResume
					Activity.onResume

**App角度**

1. Activity.onRestart()
2. Activity.onStart() 
3. Activity.onResume() 

App处于运行状态，UI可见。

#### 3.3 暂停应用

msg: `PAUSE_ACTIVITY`

**调用链**

	ActivityThread.handlePauseActivity
		ActivityThread.performPauseActivity
			ActivityThread.callCallActivityOnSaveInstanceState
				Instrumentation.callActivityOnSaveInstanceState
					Activity.performSaveInstanceState
						Activity.onSaveInstanceState

			Instrumentation.callActivityOnPause
				Activity.performPause
					Activity.onPause

**App角度**

1. Activity.onSaveInstanceState()
2. Activity.onPause()

根据saveState是否true决定是否执行callCallActivityOnSaveInstanceState()分支，从而决定是否回调onRestoreInstanceState()方法

#### 3.4 停止应用

msg: `STOP_ACTIVITY_HIDE`

**调用链**

	ActivityThread.handleStopActivity
		ActivityThread.performStopActivityInner
			ActivityThread.callCallActivityOnSaveInstanceState
				Instrumentation.callActivityOnSaveInstanceState
					Activity.performSaveInstanceState
						Activity.onSaveInstanceState

			ActivityThread.performStop
				Activity.performStop
					Instrumentation.callActivityOnStop
						Activity.onStop

		updateVisibility

		H.post(StopInfo)
			AMP.activityStopped
				AMS.activityStopped
					ActivityStack.activityStoppedLocked
					AMS.trimApplications
						ProcessRecord.kill
						ApplicationThread.scheduleExit
							Looper.myLooper().quit()

						AMS.cleanUpApplicationRecordLocked
						AMS.updateOomAdjLocked

**App角度**

1. Activity.onSaveInstanceState
2. Activity.onStop

在停止Activity的过程，会有一个trimApplications()的操作，主要是kill空进程，将当前进程退出loop循环，清理应用的上下文环境，并且更新进程的Adj值。

#### 3.5 销毁应用

msg: `DESTROY_ACTIVITY`

**调用链**

	ActivityThread.handleDestroyActivity
		ActivityThread.performDestroyActivity
			Instrumentation.callActivityOnPause
			Activity.performStop()
			Instrumentation.callActivityOnDestroy
				Activity.performDestroy
					Window.destroy
					Activity.onDestroy

		AMP.activityDestroyed
			AMS.activityDestroyed
				ActivityStack.activityDestroyedLocked
					ActivityStackSupervisor.resumeTopActivitiesLocked
						ActivityStack.resumeTopActivityLocked
							ActivityStack.resumeTopActivityInnerLocked

**App角度**

- Activity.onDestroy

销毁应用后，会查看第一个没有结束的Activity，用于显示在最顶层界面，当不存在未结束的Activity时，则显示Launcher界面，即主界面。

#### 3.6 创建Intent

msg: `NEW_INTENT` （打开已经处于栈顶的Activity，则会发送给NEW_INTENT消息给主线程）

**调用链**

	ActivityThread.handleNewIntent
		performNewIntents
			Instrumentation.callActivityOnPause
				Activity.performPause
					Activity.onPause

			deliverNewIntents
				Instrumentation.callActivityOnNewIntent
					Activity.onNewIntent

			Activity.performResume
				Activity.performRestart
					Instrumentation.callActivityOnRestart
						Activity.onRestart

					Activity.performStart
						Instrumentation.callActivityOnStart
							Activity.onStart

				Instrumentation.callActivityOnResume
					Activity.onResume

**App角度**

1. Activity.onPause
2. Activity.onNewIntent
3. Activity.onRestart
4. Activity.onStart
5. Activity.onResume


本文主要是概括性讲述Activity的调用过程，后续会再从源码角度进一步细说Activity生命周期。

----------
如果觉得本文对您有所帮助，请关注我的**微信公众号：gityuan**， **[微博：Gityuan](http://weibo.com/gityuan)**。 或者[点击这里查看更多关于我的信息](http://www.yuanhh.com/about/)