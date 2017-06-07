---
layout: post
title:  "四大组件之ServiceRecord"
date:   2017-05-25 23:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

Android系统中最为重要的服务便是AMS, AMS管理着framework层面四大组件和进程. 本文从另一个维度
来说一说四大组件之一的Service. 每个app进程运行的Service, 对应于system_server进程中AMS的ServiceRecord对象.
也就是说所有app进程的Service, 都会记录在system_server进程, 好比一个大管家.

本文的重点是讲解AMS如何管理Service.

## 二. Service数据结构

先以一幅图来展示AMS管理Service所涉及的相关数据结构：
[点击查看大图](http://www.gityuan.com/images/ams/service_record.jpg)

![service_record](/images/ams/service_record.jpg)

图中，从上至下存在简单的包含关系：

- ServiceRecord可以包含一个或多个IntentBindRecord；
- IntentBindRecord可以包含一个或多个AppBindRecord；
- AppBindRecord可以包含一个或多个ConnectionRecord；

#### 2.1 ServiceRecord

ServiceRecord位于system_server进程，是AMS管理各个app中service的基本单位。
ServiceRecord继承于Binder对象,作为Binder IPC的Bn端；Binder将其传递到Service进程的Bp端，
保存在`Service.mToken`, 即ServiceRecord的代理对象。

ServiceRecord的成员变量app，用于记录当前service运行在哪个进程。再来说说其他成员变量：

（1）bindings：由于可通过不同的Intent来bind同一个service，故采用bindings来记录所有的intent以及对应的IntentBindRecord
，其数据类型如下：

    ArrayMap<Intent.FilterComparison, IntentBindRecord> bindings

（2）connections:记录IServiceConnection以及所有对应client的ConnectionRecord

（3）startRequested：代表service是否由startService方式所启动的

- startService()，则startRequested=true;
- stopService()或stopSelf()，则startRequested=false;

#### 2.2 IntentBindRecord

功能: 一个绑定的Intent与其对应的service

（1）apps: 由于同一个intent，可能有多个不同的进程来bind该service，故采用其成员变量aPps来记录该intent绑定的所有client进程，
其数据类型如下：

    ArrayMap<ProcessRecord, AppBindRecord> apps

（2）binder: service发布过程，调用publishServiceLocked()来赋值的IBinder对象；也就是bindService后的onBinder()方法
的返回值（作target进程的binder服务）的代理对象。简单来说就是onServiceConnected()的第二个参数。

（3）received：
 
- 当执行完publishServiceLocked(), 则received=true; requested=true;
- 当执行killServicesLocked(), 则received=false; requested=false;

#### 2.3 AppBindRecord

功能:一个service与其所关联的client进程

其成员变量connections记录所有的连接信息;

#### 2.4 ConnectionRecord
功能:记录一个service的绑定信息binding; 只有bindService()才会创建该对象。

1. conn:client进程中的LoadedApk.ServiceDispatcher.InnerConnection的Bp端
2. activity:不为空,代表发起方拥有activity上下文
3. clientIntent: 记录如何启动client

执行bindService()便会创建ConnectionRecord对象, 该对象创建后添加到以下对象的列表:

- ServiceRecord.connections: 记录在ServiceRecord的成员变量;
- ActiveServices.mServiceConnections: 效果同上;
- AppBindRecord.connections: 某个service的所有绑定信息会记录在该对象;
- ProcessRecord.connections: 记录在service所对应的client进程
- ActivityRecord.connections: 当bindService()过程是由activity context所启动, 则会添加到该对表;否则跳过;

当bindService过程中指定参数flags Context.BIND_AUTO_CREATE, 则会在bind过程创建service;

#### 2.5 LoadedApk

![loaded_apk](/images/ams/loaded_apk.jpg)

LoadedApk对象，往往运行在client进程，通过其成员变量mServices来记录相关的service信息。不同的Context下，对于同一个
ServiceConnection会对应唯一的LoadedApk.ServiceDispatcher对象。ServiceDispatcher用于服务分发，即服务连接或死亡事件的派发。

bindService过程并不是直接把ServiceConnection(只是Interface)传递到AMS，而是创建一个InnerConnection(Binder对象)再传递到AMS，这样便于跨进程间交互。

## 三. Service综述

### 3.1 启动与销毁

对Service的主要操作如下四个方法:

    startService(Intent service)
    stopService(Intent service)
    bindService(Intent service, ServiceConnection conn, int flags)
    unbindService(ServiceConnection conn)

其中:

    public interface ServiceConnection {
        public void onServiceConnected(ComponentName name, IBinder service);
        public void onServiceDisconnected(ComponentName name);
    }

Service的启动方式主要有startService和bindService的方式.
说明:在这里把执行启动这个动作的一方称为client, 把被启动的陈伟target service.


(1) startService方式:

- client通过startService()启动target服务;
- target通过覆写onStartCommand可以执行具体的业务逻辑;
- client通过stopService()或者service自身通过stopself()来结束服务;
    - 如果存在多个client启动同一个service, 只需一个client便可以stop该服务;

(2) bindService方式:

- client通过bindService()启动target服务;
- target通过覆写onBinder将其IBinder对象将其返回给client端;
    - client端通过ServiceConnection的onServiceConnected获取IBinder的代理对象, 便可通过Binder IPC直接操作service的相应业务方法;
- client通过unbindService()来结束服务的连接关系;
    - 多次bind，则需要等量的unbind操作；

(3) unbindService

前面介绍的bindService()过程会创建与bind服务，对于unbindService则正好是逆过程unbind和摧毁service。

    unbindService(ServiceConnection conn)

说明：

1. unbindService()过程在client进程是对同一个ServiceConnection的bind来执行unbind操作，
从该方法参数也能印证其功能；这里需要注意当采用同一个ServiceConnection执行了bind操作，只需一次unbind就把所有
使用同一个ServiceConnection的bind都一并执行了unbind操作；
2. 站在AMS角度来看，unbindService()，只有当某个service Intent的IntentBindRecord.apps的个数为0时才执行unbind操作。
也就是说当存在多个进程采用同一个intent bind某个service，那么必须等到所有的进程都执行了unbind操作，才能真正unbind。
3. 当service是通过startService方式所启动，那么必须通过stopService或者stopSelf()才能destroy该服务，任何的unbindService
是无法destroy该服务；
4. 当servce时通过bindService带有flags Context.BIND_AUTO_CREATE方式启动的，那么unbind过程会判断如果该service的其他ConnectionRecord都不存在设置BIND_AUTO_CREATE，则会直接destroy该service；如果存在一个，则不会destroy。可见，决定是否destroy service的过程，是否存在其他的不带BIND_AUTO_CREATE的bind service完全忽略。

### 3.2 生命周期

#### 3.2.1 startService
[startService](http://gityuan.com/2016/03/06/start-service/)的生命周期:

- onCreate
- onStartCommand
- onDestroy

启动流程图, [点击查看大图](http://www.gityuan.com/images/ams/service_lifeline.jpg)

![service_lifeline](/images/ams/service_lifeline.jpg)

#### 3.2.2 bindService

[bindService](http://gityuan.com/2016/05/01/bind-service/)的生命周期:

- onCreate
- onBind
- onUnbind
- onDestroy

启动流程图, [点击查看大图](http://www.gityuan.com/images/ams/bind_service.jpg)

![bind_service](/images/ams/bind_service.jpg)

说明：

1. 图中蓝色代表的是Client进程(发起端), 红色代表的是system_server进程, 黄色代表的是target进程(service所在进程);
2. Client进程: 通过getServiceDispatcher获取Client进程的匿名Binder服务端，即LoadedApk.ServiceDispatcher.InnerConnection,该对象继承于IServiceConnection.Stub；
再通过bindService调用到system_server进程;
3. system_server进程: 依次通过scheduleCreateService和scheduleBindService方法, 远程调用到target进程;
4: target进程: 依次执行onCreate()和onBind()方法; 将onBind()方法的返回值IBinder(作为target进程的binder服务端)通过publishService传递到system_server进程;
5. system_server进程: 利用IServiceConnection代理对象向Client进程发起connected()调用, 并把target进程的onBind返回Binder对象的代理端传递到Client进程;
6. Client进程: 回调到onServiceConnection()方法, 该方法的第二个参数便是target进程的binder代理端. 到此便成功地拿到了target进程的代理, 可以畅通无阻地进行交互.

另外，说明bindService过程中只有指定参数flags Context.BIND_AUTO_CREATE, 才会在bind过程创建/销毁service，即BringUpServiceLocked和bringDownServiceIfNeededLocked过程；


### 3.3 Foreground

在系统内存资源不足的情况下，会优先杀掉低优先级的进程。对于只有service的进程，有些情况对于用户来说是可感知的app。往往不希望被系统所杀，比如正在听音乐。系统默认service都是后台的，可以通过startForeground()把该service提升到foreground优先级，那么adj便会成为PERCEPTIBLE_APP_ADJ(可感知的级别)，这个级别的app一般不会轻易被杀。当用户不再听歌时，应该主动调用stopForeground()，将其优先级还原到后台，为用户提供更好的体验，相关API位于文件Service.java ：

    startForeground(int id, Notification notification)
    stopForeground(boolean removeNotification)

以上两个方法进入AMS都是调用setServiceForeground()；对于startForeground()，往往通过postNotification()来展示
一个通知；对于stopForeground()，当removeNotification=true,则通过 cancelNotification()来取消通知。

作为前台service，必须要有一个status bar的通知，并且通知不会消失直到service停止或许主动移除前台优先级。
