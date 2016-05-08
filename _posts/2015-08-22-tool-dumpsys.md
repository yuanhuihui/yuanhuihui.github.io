---
layout: post
title:  "dumpsys工具"
date:   2015-8-22 22:12:30
catalog:    true
tags:
    - android
    - tool
    - dumpsys
---

> dumpsys是Android自带的强大debug工具，能提供有多有价值的信息。

## 一、dumpsys源码

> frameworks/native/cmds/dumpsys/dumpsys.cpp

	int main(int argc, char* const argv[])
	{
	    signal(SIGPIPE, SIG_IGN);
	    sp<IServiceManager> sm = defaultServiceManager(); //获取ServiceManager
	    fflush(stdout);
	    if (sm == NULL) {
			ALOGE("Unable to get default service manager!");
	        aerr << "dumpsys: Unable to get default service manager!" << endl;
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
			//命令为"dumpsys"，执行此分支，获取系统所有的服务
	        services = sm->listServices();
	        services.sort(sort_func);
	        args.add(String16("-a"));
	    } else {
			//其他场景，则只获取指定服务名的信息
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

从代码中，可以得出，`dumpsys`主要工作分为以下4个步骤：

1. `defaultServiceManager()`,获取service manager
2. `sm->listServices()`，获取系统所有向service manager注册过的服务。
3. `sm->checkService()`，获取系统中指定的服务。
4. `service->dump()`，dumpsys命令的核心还是调用远程服务中的dump()方法来获取相应的dump信息。

更多关于如何获取service manager和服务，可查看[Binder系列3 —— 获取Service Manager](http://gityuan.com/2015/11/08/binder-get-sm/)，[Binder系列5 —— 获取服务(getService)](http://gityuan.com/2015/11/15/binder-get-service/)。

----------


## 二、dumpsys命令

1. dumpsys -l 可查看当前手机系统所有的service

2. dumpsys [service]，可查看指定service的dump信息。下面列举部分比较常用的dumpsys指令：

|命令|功能|
|---|---|
|dumpsys package  \<package_name\> |  查看指定包名的信息
|dumpsys activity \<package_name\> | 查看指定包名的activity信息
|dumpsys meminfo  \<package_name\>|查看指定包名的内存信息
|dumpsys batterystats    |查看电池信息
|dumpsys battery    |查看电池信息
|dumpsys cpuinfo| 查看CPU信息
|dumpsys alarm     | 查看Alarm信息
|dumpsys audio     | 查看声音信息
|dumpsys netstats|查看网络统计信息
|dumpsys diskstats|   查看空间free状态
|dumpsys jobscheduler  | 查看任务计划
|dumpsys power|查看功耗信息
|dumpsys wifi|查看wifi信息

比如：

- 查看内存信息：
	
		dumpsys meminfo

- 查看dumpsys内存的帮助信息

		dumpsys meminfo -h  //此处以meminfo为例，其他指令也是类同

- 查看具体apk或pid的内存信息:

		dumpsys meminfo <packagename> 或者<pid>

其他的dumpys指令也有类似的作用。


**其他：**   
另外，还有一个比较重要的dumpstate指令：

1. 基本信息，如版本信息，内存基本信息，cpu基本信息，硬件信息等
2. 系统log/panic信息
3. 网络/路由信息
5. 锁的使用信息
6. 进程信息
7. binder信息
8. 应用程序安装信息
9. 磁盘使用情况
10. 所有activity,services信息
11. properties信息等

而bugreport的真正实现便是通过dumpstate指令来完成的。





