---
layout: post
title:  "Activity与Service生命周期"
date:   2015-03-20 20:30:00
categories:  Android
excerpt:  Activity与Service生命周期
---

* content
{:toc}

##一. Activity


先展示一张Activity的生命周期图：
![activity lifecycle](/images/lifecycle/activity.png)  
  
  
###1.1 Activity状态

只有下面三个状态是静态的，可以存在较长的时间内保持状态不变。(其它状态只是过渡状态，系统快速执行并切换到下一个状态)　　　

- **运行（Resumed）：** 
	- 当前activity在最上方，用户可以与它进行交互。(通常也被理解为"running" 状态)
	- 此状态由`onResume()`进入，由`onPause()`退出
- **暂停（Paused）：** 
	- 当前activity仍然是可见的。但被另一个activity处在最上方，最上方的activity是半透明的，或者是部分覆盖整个屏幕。被暂停的activity不会再接受用户的输入。
	- 处于活着的状态（Activity对象存留在内存，保持着所有的状态和成员信息，仍然吸附在window manager）。  
	- 当处于极度低内存的状态时，系统会杀掉该activity，释放相应资源。
	- 此状态由`onPause()`进入，退出可能o`nResume()`或者`onCreate()`重新唤醒软件，或者被`onStop()`杀掉
- **停止（Stopped）：**
	- 当前activity完全被隐藏，不被用户可见。可以认为是处于在后台。
	- 处于活着的状态（Activity对象存留在内存，保持着所有的状态和成员信息，不再吸附在window manager）。
	- 由于对用户不再可见，只要有内存的需要，系统就会杀掉该activity来释放资源。	  
	- 该状态由`onStop()`进入，或`onRestart()`或者`onCreate()`重新唤醒软件，或者被`onDestroy()`彻底死亡..
其它状态 (Created与Started)都是短暂的，系统快速的执行那些回调函数并通过。
  
当acitivty处于暂停或者停止状态，系统可以通过`finish()`或 `android.os.Process.killProcess(android.os.Process.myPid())`来杀死其进程。当该activity再次被打开时(结束或杀死后)，需要重新创建，走一遍完整的流程。

###1.2 Activities调用流程
当Activity A 启动 Activity B时，两个activity都有自个的生命周期。Activity A暂停或者停止，Activity B被创建。记住，在Activity B创建之前，Activity A并不会完全停止，流程如下：

1. Activity A 进入onPause();
2. Activity B 依次 onCreate(), onStart(), onResume()。（此时Activity B得到了用户焦点）
3. 如果Activity A不再可见，则进入onStop().

###1.3 代码实践  
利用下面的`DemoActivity`代码，可亲自感受每一个阶段的状态。比如点返回键，home键，menu键等操作，可以借助通过logcat查看该activity到底处于哪种状态，这里就不说结果了，自己动手，丰衣足食。
  
	import android.app.Activity;
	import android.os.Bundle;
	import android.util.Log;

	public class DemoActivity extends Activity {
	    private static final String TAG = "demo";
	
	    @Override
	    public void onCreate(Bundle savedInstanceState) {
	        super.onCreate(savedInstanceState);
	        Log.i(TAG,"onCreate::The activity is being created.");
	    }
	    @Override
	    protected void onStart() {
	        super.onStart();
	        Log.i(TAG, "onStart::The activity is about to become visible.");
	    }
	    @Override
	    protected void onResume() {
	        super.onResume();
	        Log.i(TAG, "onResume::The activity has become visible.");
	    }
	    @Override
	    protected void onPause() {
	        super.onPause();
	        Log.i(TAG, "onPause:: Another activity is taking focus.");
	    }
	    @Override
	    protected void onStop() {
	        super.onStop();
	        Log.i(TAG, "onStop::The activity is no longer visible");
	    }
	    @Override
	    protected void onDestroy() {
	        super.onDestroy();
	        Log.i(TAG, "onDestroy::The activity is about to be destroyed");
	    }
	}

----------

##二. Service

  
先展示一张Activity的生命周期图：  

![service lifecycle](/images/lifecycle/service.png)
  
  
###2.1  启动方式：

service有两种启动方式：

- startService() 启动本地服务Local Service
- bindService() 启动远程服务Remote Service   


###2.2  生命周期

两种不同的启动方式决定了Service具有两种生命周期的可能（并非互斥的两种）。  

1. start方式：onCreate()，onStartCommand()。onDestroy释放资源。
2. bind方式： onCreate()，onBind()方法。需要所有client全部调用unbindService()才能将Service释放资源，等待系统回收。

###2.3  代码实践
利用下面的`DemoService`代码，通过logcat自行感受每一个阶段的状态与场景的关系。

	import android.app.Service;
	import android.content.Intent;
	import android.os.IBinder;
	import android.util.Log;
	
	public class DemoService extends Service {
	    private static final String TAG = "demo";
	
	    int mStartMode;       // service被杀掉的方式
	    IBinder mBinder;      // clients绑定接口 
	    boolean mAllowRebind; // 是否允许onRebind
	
	    @Override
	    public void onCreate() {
	        Log.i(TAG,"onCreate::The service is being created");
	    }
	    @Override
	    public int onStartCommand(Intent intent, int flags, int startId) {
	        Log.i(TAG,"onStartCommand::The service is starting");
	        return mStartMode;
	    }
	    @Override
	    public IBinder onBind(Intent intent) {
	        Log.i(TAG,"onBind::A client is binding to the service");
	        return mBinder;
	    }
	    @Override
	    public boolean onUnbind(Intent intent) {
	        Log.i(TAG,"onUnbind::All clients have unbound");
	        return mAllowRebind;
	    }
	    @Override
	    public void onRebind(Intent intent) {
	        Log.i(TAG,"onRebind::A client rebind to the service " +
	                "after onUnbind() has already been called");
	    }
	    @Override
	    public void onDestroy() {
	        Log.i(TAG,"onDestroy::The service is no longer used");
	    }
	}