---
layout: post
title:  "dumpsys原理简介"
date:   2015-8-22 22:12:30
catalog:    true
tags:
    - android
    - tool
    - debug
    
---


### dumpsys源码

dumpsys是Android自带的强大debug工具，命令源码来自dumpsys.cpp文件。

frameworks/native/cmds/dumpsys/dumpsys.cpp

	int main(int argc, char* const argv[])
	{
	    signal(SIGPIPE, SIG_IGN);
        //获取ServiceManager
	    sp<IServiceManager> sm = defaultServiceManager(); 
	    fflush(stdout);
	    if (sm == NULL) {
	        return 20;
	    }
	    Vector<String16> services;
	    Vector<String16> args;
	    bool showListOnly = false;
        //命令为"dumpsys -l"，执行此分支
	    if ((argc == 2) && (strcmp(argv[1], "-l") == 0)) {
	        showListOnly = true;
	    }
	    if ((argc == 1) || showListOnly) {
			//不带参数的命令为"dumpsys"，获取系统所有的服务
	        services = sm->listServices();
	        services.sort(sort_func);
	        args.add(String16("-a"));
	    } else {
            //带参数则只获取指定服务名的信息
	        services.add(String16(argv[1]));
	        for (int i=2; i<argc; i++) {
	            args.add(String16(argv[i]));
	        }
	    }
	    const size_t N = services.size();
	    if (N > 1) {
	        // 打印出第一行信息
	        aout << "Currently running services:" << endl;
	    
	        for (size_t i=0; i<N; i++) {
	            //获取相应的服务
	            sp<IBinder> service = sm->checkService(services[i]);
	            if (service != NULL) {
	                aout << "  " << services[i] << endl;
	            }
	        }
	    }
	    if (showListOnly) {
	        return 0;
	    }
	    for (size_t i=0; i<N; i++) {
	        sp<IBinder> service = sm->checkService(services[i]);
	        if (service != NULL) {
	            if (N > 1) {
	                aout << "------------------------------------------------------------"
	                        "-------------------" << endl;
	                aout << "DUMP OF SERVICE " << services[i] << ":" << endl;
	            }
	            //调用service相应的dump()方法，这是整个dumpsys命令的精华
	            int err = service->dump(STDOUT_FILENO, args);
	            if (err != 0) {
	                aerr << "Error dumping service info: (" << strerror(err)
	                        << ") " << services[i] << endl;
	            }
	        } else {
	            aerr << "Can't find service: " << services[i] << endl;
	        }
	    }
	    return 0;
	}

从代码中，可以得出`dumpsys`主要工作分为以下4个步骤：

1. `defaultServiceManager()`,获取ServiceManager对象；
2. `sm->listServices()`，获取系统所有向ServiceManager注册过的服务；
3. `sm->checkService()`，获取系统中指定的Service；
4. `service->dump()`，dumpsys命令的核心还是调用远程服务中的`dump()`方法来获取相应的dump信息。

如果有兴趣要了解从源码角度是如何获取ServiceManager和Service，可查看文章[Binder系列4—获取ServiceManager](http://gityuan.com/2015/11/08/binder-get-sm/)，[Binder系列6—获取服务(getService)](http://gityuan.com/2015/11/15/binder-get-service/)。


### 实例

例如常见的指令

	dumpsys activity

由前面的原理可知， 先要查询sm->checkService("activity")，这里得到的是ActivityManagerService，那么也就意味着上述命令等价于调用ActivityManagerService.dump()。 同理其他的命令也是类似的方式。


