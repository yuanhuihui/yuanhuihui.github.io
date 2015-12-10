---
layout: post
title:  "Binder系列5—获取服务(getService)"
date:   2015-11-15 21:11:50
categories: android binder
excerpt: Binder系列5—获取服务(getService)
---

* content
{:toc}


---
> 基于Android 6.0的源码剖析， 本文Client如何向Server获取服务的过程。


## 源码分析


**相关源码**
	
	/framework/av/media/libmedia/IMediaDeathNotifier.cpp
	/framework/native/libs/binder/IServiceManager.cpp


下面开始讲解每一个流程：

### [1] IMediaDeathNotifier::getMediaPlayerService
==> `/framework/av/media/libmedia/IMediaDeathNotifier.cpp`

获取服务MediaPlayerService

	sp<IMediaPlayerService>&
	IMediaDeathNotifier::getMediaPlayerService()
	{
	    Mutex::Autolock _l(sServiceLock);
	    if (sMediaPlayerService == 0) {
	        sp<IServiceManager> sm = defaultServiceManager(); //获取ServiceManager
	        sp<IBinder> binder;
	        do {
				//获取名为"media.player"的服务
	            binder = sm->getService(String16("media.player")); //【见流程2】
	            if (binder != 0) {
	                break;
	            }
	            usleep(500000); // 0.5 s
	        } while (true);
	
	        if (sDeathNotifier == NULL) {
	            sDeathNotifier = new DeathNotifier(); //创建死亡通知
	        }
	        binder->linkToDeath(sDeathNotifier); //将死亡通知连接到binder
	        sMediaPlayerService = interface_cast<IMediaPlayerService>(binder); //【见流程】
	    }
	    return sMediaPlayerService;
	}

关于`defaultServiceManager`，前面已经讲过，返回BpServiceManager。在请求获取名为"media.player"的服务过程中，采用不断循环获取的方法。由于MediaPlayerService服务可能还没向ServiceManager注册完成或者尚未启动完成等情况，故则binder返回为NULL，休眠0.5s后继续请求，直到获取服务为止。


### [2] getService
==> `/framework/native/libs/binder/IServiceManager.cpp`

通过BpServiceManager来获取MediaPlayer服务

	virtual sp<IBinder> getService(const String16& name) const
	    {
	        unsigned n;
	        for (n = 0; n < 5; n++){
	            sp<IBinder> svc = checkService(name); //【见流程3】
	            if (svc != NULL) return svc;
	            sleep(1);
	        }
	        return NULL;
	    }

检索服务是否存在，当服务存在则返回相应的服务，当服务不存在则休眠1s再继续检索服务。该循环进行5次。为什么是循环5次呢，这估计跟Android的ANR时间为5s相关。如果每次都无法获取服务，循环5次，每次循环休眠1s，忽略`checkService()`的时间，差不多就是5s的时间


### [3] checkService
==> `/framework/native/libs/binder/IServiceManager.cpp`

检索指定服务是否存在

    virtual sp<IBinder> checkService( const String16& name) const
    {
        Parcel data, reply;
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());//写入RPC头
        data.writeString16(name); //写入服务名
        remote()->transact(CHECK_SERVICE_TRANSACTION, data, &reply); //remote为BpBinder
        return reply.readStrongBinder();
    }

这里调用BpBinder->transact()，再调用到IPCThreadState->transact()，再调用到IPCThreadState->waitForResponse，再调用。这个流程与[Binder系列4 —— 注册服务(addService)](http://www.yuanhh.com/2015/11/14/android-binder-4/)中的【流程4到流程10】基本一致。此处不再重复,最后reply里面会返回IBinder对象。



## 思考
- 循环获取过程中，通过休眠0.5s的方法，是否有优化方案；
