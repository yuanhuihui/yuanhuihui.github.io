---
layout: post
title:  "Binder系列7—如何使用Binder"
date:   2015-11-22 21:11:50
categories: android binder
excerpt: Binder系列7—Binder用法
---

* content
{:toc}


---

> 自定义binder架构的 client/ server组件


## 一、Native用法

### IMyService.h

头文件申明：

- IMyService（接口）
- BpMyService（Binder的代理端）
- BnMyService(Binder的服务端)

代码如下：

	#ifndef MY_SERVICE_DEMO
	#define MY_SERVICE_DEMO
	#include <stdio.h>
	#include <binder/IInterface.h>
	#include <binder/Parcel.h>
	#include <binder/IBinder.h>
	#include <binder/Binder.h>
	#include <binder/ProcessState.h>
	#include <binder/IPCThreadState.h>
	#include <binder/IServiceManager.h>
	using namespace android;
	namespace android
	{
	    class IMyService : public IInterface
	    {
	    public:
	        DECLARE_META_INTERFACE(MyService); // declare macro
	        virtual void sayHello()=0;
	    };
	
	    enum
	    {
	        HELLO = 1,
	    };
	
	    class BpMyService: public BpInterface<IMyService> {
	    public:
	    	BpMyService(const sp<IBinder>& impl);
	    	virtual void sayHello();
	    };
	
		class BnMyService: public BnInterface<IMyService> {
		public:
			virtual status_t onTransact(uint32_t code, const Parcel& data, Parcel* reply,
					uint32_t flags = 0);
			virtual void sayHello();
		};
	}
	#endif



### IMyService.cpp

实现了IMyService，BpMyService，BnMyService这3个类

	#include "IMyService.h"
	namespace android
	{
	    IMPLEMENT_META_INTERFACE(MyService, "android.demo.IMyService");
	   
	    //BpBinder
		BpMyService::BpMyService(const sp<IBinder>& impl) :
				BpInterface<IMyService>(impl) {
		}
		
		void BpMyService::sayHello() {
			printf("BpMyService::sayHello\n");
			Parcel data, reply;
			data.writeInterfaceToken(IMyService::getInterfaceDescriptor());
			remote()->transact(HELLO, data, &reply);
			printf("get num from BnMyService: %d\n", reply.readInt32());
		}
		
		//BnBinder	
		status_t BnMyService::onTransact(uint_t code, const Parcel& data,
				Parcel* reply, uint32_t flags) {
			switch (code) {
			case HELLO: {
				printf("BnMyService:: got the client hello\n");
				CHECK_INTERFACE(IMyService, data, reply);
				sayHello();
				reply->writeInt32(2015);
				return NO_ERROR;
			}
				break;
			default:
				break;
			}
			return NO_ERROR;
		}
	
		void BnMyService::sayHello() {
			printf("BnMyService::sayHello\n");
		};
	}

### Server端程序

服务端可运行程序

	#include "IMyService.h"

	int main() {
		sp < IServiceManager > sm = defaultServiceManager();
		sm->addService(String16("service.myservice"), new BnMyService());
		ProcessState::self()->startThreadPool();
		IPCThreadState::self()->joinThreadPool();
		return 0;
	}

### client端程序

客户端可运行程序

	#include "IMyService.h"
	
	int main() {
		sp < IServiceManager > sm = defaultServiceManager();
		sp < IBinder > binder = sm->getService(String16("service.myservice"));
		sp<IMyService> cs = interface_cast < IMyService > (binder);
		cs->sayHello();
		return 0;
	}

### Android.mk

用于编译的mk文件，在Android的源码中，通过mm编译后，可生成两个可执行文件ServerDemo，ClientDemo。

	adb push ServerDemo /system/bin
	adb push ClientDemo /system/bin 

直接运行即可，看到结果，暂略。

mk文件内容如下： 

	LOCAL_PATH := $(call my-dir)

	include $(CLEAR_VARS)
	LOCAL_SHARED_LIBRARIES := \
	    libcutils \
	    libutils \
	    libbinder       
	LOCAL_MODULE    := ServerDemo
	LOCAL_SRC_FILES := \
	    IMyService.cpp \
	    ServerDemo.cpp
	   
	LOCAL_MODULE_TAGS := optional
	include $(BUILD_EXECUTABLE)
	  
	
	include $(CLEAR_VARS)
	LOCAL_SHARED_LIBRARIES := \
	    libcutils \
	    libutils \
	    libbinder
	LOCAL_MODULE    := ClientDemo
	LOCAL_SRC_FILES := \
	    IMyService.cpp \
	    ClientDemo.cpp
	LOCAL_MODULE_TAGS := optional
	include $(BUILD_EXECUTABLE)


## 二、framework层用法
