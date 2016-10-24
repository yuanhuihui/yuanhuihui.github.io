## 防杀方案


- 广播自启动：  forceStopPackage()可解决
- 双进程Service：其中一个Service被杀后，另外service进程立即重启被杀service进程
- 通过NDK方式：fork子进程来守护
- QQ黑科技:在应用退到后台后，另起一个只有 1 像素的页面停留在桌面上，让自己保持前台状态，保护自己不被后台清理工具杀死。



##首先来看原理

Android系统中当前进程(Process)fork出来的子进程，被系统认为是两个不同的进程。当父进程被杀死的时候，子进程仍然可以存活，并不受影响。

##然后来看实现步骤

- 用C编写守护进程(即子进程)，守护进程做的事情就是循环检查目标进程是否存在，不存在则启动它。
- 在NDK环境中将1中编写的C代码编译打包成可执行文件(BUILD_EXECUTABLE)。
- 主进程启动时将守护进程放入私有目录下，赋予可执行权限，启动它即可。

##最后是相关代码片段

1.主函数包含死循环，调用watch()函数循环检查目标是否存在，不存在则调用restart_target()函数启动它，其中pid参数为目标进程的pid，在Android层可以很简单的获得。

	// 监听
	while(1)
	{
	    // 监听
	    if (watch(pid)
	    {
	        // 如果监听不到目标进程，则启动它
	        restart_target();
	        break;
	    }
	    // 骚等，歇一会
	    sleep(2);
	}
.
2. watch()函数。Linux中所有进程在/proc/目录都会有对应的进程目录，例如对于pid为1234的进程，将存在/proc/1234/目录。检查此目录是否存在即可确定目标进程是否存在。

	int watch(char *pidnum)
	{
	    char proc_path[100];
	    DIR *proc_dir;
	
	    // 初始化进程目录
	    strcpy(proc_path, "/proc/");
	    strcat(proc_path, pidnum);
	    strcat(proc_path, "/");
	    printf("proccess path is %s\n", proc_path);
	
	    // 尝试访问它以确定是否存在
	    proc_dir = opendir(proc_path);
	
	    if (proc_dir == NULL)
	    {
	        printf("process: %s not exist! start it!\n", pidnum);
	        return 1;
	    }
	    else
	    {
	        printf("process: %s exist!\n", pidnum);
	        return 0;
	    }
	}
.
3. restart_target()函数。使用Android系统的"am startservice"命令去启动目标服务。其他参数的含义请自行Google。

	void restart_target()
	{
	    char cmd_restart[128] = "am startservice --user 0 -a com.a.b.service.YourService";
	    popen(cmd_restart, "r");
	}
.
4. 以上就是守护进程的主体部分，接下来使用NDK将其编译打包成可执行文件。以下是Android.mk配置文件内容。

	LOCAL_PATH:= $(call my-dir)
	
	include $(CLEAR_VARS)
	LOCAL_SRC_FILES := watchdog.c
	LOCAL_MODULE := watchdog
	LOCAL_MODULE_PATH := $(TARGET_OUT_EXECUTABLES)
	LOCAL_LDLIBS := -llog
	include $(BUILD_EXECUTABLE)
.
5. 完成守护进程的编写后，接下来就是使用它。在Android程序运行时将它放到某个可赋予可执行权限的目录，比如私有目录下的files文件夹内。然后调用shell命令赋予它可执行权限并启动它。

	// 赋予可执行权限
	chmod 744 /data/data/com.a.b/files/watchdog
	
	// 执行它，1234为目标要守护的进程pid
	/data/data/com.a.b/files/watchdog 1234


以上方法可实现守护某进程的目的，进而达到服务常驻后台的效果。