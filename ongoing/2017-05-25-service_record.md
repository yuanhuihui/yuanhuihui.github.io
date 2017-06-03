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


### 1.1 Service使用方法

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
    
http://www.tuicool.com/articles/eaMNnyz
http://blog.csdn.net/windskier/article/details/7203293




ServiceRecord要继承于Binder对象
