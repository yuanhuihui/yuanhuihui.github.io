---
layout: post
title:  "四大组件之Service机制"
date:   2017-04-16 23:19:12
catalog:  true
tags:
    - android

---

## 一. 引言

Android系统中最为重要的服务便是AMS, AMS管理着framework层面四大组件和进程. 本文从另一个维度
来说一说四大组件之一的Service. 每个app进程运行的Service, 对应于system_server进程中AMS的ServiceRecord对象.
也就是说所有app进程的Service, 都会记录在system_server进程, 好比一个大管家.

本文的重点是讲解AMS如何管理Service.

## 二. 原理

### 2.1 启动方式

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


### 2.2 生命周期

#### 2.2.1 startService
[startService](http://gityuan.com/2016/03/06/start-service/)的生命周期:

- onCreate
- onStartCommand
- onDestroy

启动流程图, [点击查看大图](http://www.gityuan.com/images/ams/service_lifeline.jpg)

![service_lifeline](/images/ams/service_lifeline.jpg)

#### 2.2.2 bindService

bindService的生命周期:

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

### 2.2


    startForeground(int id, Notification notification)
    stopForeground(boolean removeNotification)



## 二. 结构体说明

#### IntentBindRecord


- received:
    - 当执行完publishServiceLocked(), 则received=true; requested=true;
    - 当执行killServicesLocked(), 则received=false; requested=false;

#### ConnectionRecord

执行bindService()便会创建ConnectionRecord对象, 该对象创建后添加到以下对象的列表:

- ServiceRecord.connections: 记录在ServiceRecord的成员变量;
- ActiveServices.mServiceConnections: 效果同上;
- AppBindRecord.connections: 某个service的所有绑定信息会记录在该对象;
- ProcessRecord.connections: 记录在service所对应的client进程
- ActivityRecord.connections: 当bindService()过程是由activity context所启动, 则会添加到该对表;否则跳过;

当bindService过程中指定参数flags Context.BIND_AUTO_CREATE, 则会在bind过程创建service;













http://www.tuicool.com/articles/eaMNnyz
http://blog.csdn.net/windskier/article/details/7203293




ServiceRecord要继承于Binder对象,
其传递到客户端的是Service.mToken, 即ServiceRecord的代理对象;


ActivityRecord并没有继承于Binder, 所以采用成员变量ActivityRecord.appToken, 继承于Token
    Token extends IApplicationToken.Stub
其传递到客户端的是ContextImpl.mActivityToken, 以及Activity.mToken都是Token的代理对象;
