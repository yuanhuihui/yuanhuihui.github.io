

	/libcore/luni/src/main/java/java/lang/System.java
	/libcore/luni/src/main/java/java/lang/Runtime.java



## 调用栈

System.exit
    Runtime.getRuntime().exit(code);
        java_lang_Runtime.cc
            runtime.cc

### 1. System.exit

[-> System.java]

	public static void exit(int code) {
	    Runtime.getRuntime.exit(code);
	}

### 2.Runtime.exit

[-> Runtime.java]

    public void exit(int code) {
        //确保同一个进程多次调用，只执行一次
        synchronized(this) {
            if (!shuttingDown) {
                shuttingDown = true;
                Thread[] hooks;
                synchronized (shutdownHooks) {
                    //拷贝hooks
                    hooks = new Thread[shutdownHooks.size()];
                    shutdownHooks.toArray(hooks);
                }
                //同时启动所有的shtdown hooks
                for (Thread hook : hooks) {
                    hook.start();
                }
                //等待这些hooks线程执行完毕
                for (Thread hook : hooks) {
                    try {
                        hook.join();
                    } catch (InterruptedException ex) {
                        //由于处理关闭虚拟机中，可以忽略.
                    }
                }
                /如果需要的话，确保所有的对象都会回收
                if (finalizeOnExit) {
                    runFinalization();
                }
                //执行退出
                nativeExit(code);
            }
        }
    }

### 3. java_lang_Runtime

    NO_RETURN static void Runtime_nativeExit(JNIEnv*, jclass, jint status) {
      LOG(INFO) << "System.exit called, status: " << status;
      Runtime::Current()->CallExitHook(status);
      exit(status);
    }


### 4.runtime.cc

    void Runtime::CallExitHook(jint status) {
      if (exit_ != nullptr) {
        ScopedThreadStateChange tsc(Thread::Current(), kNative);
        exit_(status);
        LOG(WARNING) << "Exit hook returned instead of exiting!";
      }
