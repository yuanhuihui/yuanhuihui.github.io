---
layout: post
title:  "dumpsys工具"
date:   2015-8-22 22:12:30
categories: algorithm
excerpt:  dumpsys工具
---

* content
{:toc}

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

从代码中，可以得出，	`dumpsys`主要工作：

1. `defaultServiceManager()`,获取service manager
2. `sm->listServices()`，获取系统所有向service manager注册过的服务。
3. `sm->checkService()`，获取系统中指定的服务。
4. `service->dump()`，dumpsys命令的核心还是调用远程服务中的dump()方法来获取相应的dump信息。

更多关于如何获取service manager和服务，可查看[Binder系列3 —— 获取Service Manager](http://www.yuanhh.com/2015/11/08/binder-get-sm/)，[Binder系列5 —— 获取服务(getService)](http://www.yuanhh.com/2015/11/15/binder-get-service/)。

----------


##二、dumpsys命令

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

例如：查看内存相关的信息：
	
	dumpsys meminfo

查看帮助信息

	dumpsys meminfo -h  //此处以meminfo为例，其他指令也是类同

如果想更进一步查看某个具体apk或进程的内存信息，可通过：

	dumpsys meminfo <packagename> 或者<pid>

下面是`dumpsys`手机中com.android.phone进程的内存信息如下：

	root@X3c70:/ # dumpsys meminfo com.android.phone
	Applications Memory Usage (kB):
	Uptime: 20874479 Realtime: 22539026
	
	** MEMINFO in pid 4610 [com.android.phone] **
	                   Pss  Private  Private  Swapped     Heap     Heap     Heap
	                 Total    Dirty    Clean    Dirty     Size    Alloc     Free
	                ------   ------   ------   ------   ------   ------   ------
	  Native Heap     4902     4828        0        0    16384     9452     6931
	  Dalvik Heap     8382     7880        0        0    32326    28212     4114
	 Dalvik Other      868      868        0        0
	        Stack     1556     1556        0        0
	       Cursor        2        0        0        0
	    Other dev        5        0        4        0
	     .so mmap      751      436       28        0
	    .apk mmap       12        0        0        0
	    .dex mmap       96        0       96        0
	    .oat mmap      496        0      180        0
	    .art mmap     2004     1344      408        0
	   Other mmap       10        4        0        0
	      Unknown     1266     1260        0        0
	        TOTAL    20350    18176      716        0    48710    37664    11045
	
	 Objects
	               Views:        0         ViewRootImpl:        0
	         AppContexts:       22           Activities:        0
	              Assets:        8        AssetManagers:        8
	       Local Binders:       98        Proxy Binders:       30
	       Parcel memory:       20         Parcel count:       83
	    Death Recipients:        8      OpenSSL Sockets:        0
	
	 SQL
	         MEMORY_USED:      702
	  PAGECACHE_OVERFLOW:       76          MALLOC_SIZE:       62
	
	 DATABASES
	      pgsz     dbsz   Lookaside(b)          cache  Dbname
	         4       56             12         0/24/1  /data/data/com.android.providers.telephony/databases/HbpcdLookup.db
	         4      280            384       29/36/13  /data/data/com.android.providers.telephony/databases/telephony.db
	         4      160            489       58/48/25  /data/data/com.android.providers.telephony/databases/mmssms.db

