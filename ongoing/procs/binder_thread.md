

### Binder Thread

子进程执行流：

		Zygote.forkAndSpecialize
			RuntimeInit.zygoteInit (创建新进程，并进入新进程)
				RuntimeInit.nativeZygoteInit
					app_main.onZygoteInit
							PS.startThreadPool
									PS.spawnPooledThread (创建新Binder线程)
											PoolThread.threadLoop
													IPC.joinThreadPool
															IPC.getAndExecuteCommand
															
### Binder线程池

1. Binder线程池，第一个创建的便是Binder主线程，该线程创建后便不会再退出。
2. binder线程分为binder主线程和binder普通线程, binder主线程一般是binder_1或者进程的主线程.
3. Binder线程池，其他binder线程的创建都是通过Binder驱动发出的命令BR_SPAWN_LOOPER，才会触发调用PS.spawnPooledThread(false)来创建binder线程。
4. 任何一个线程都可以通过IPCThreadState::self()->joinThreadPool()方法，则向kernel发送BC_ENTER_LOOPER或BC_REGISTER_LOOPER命令，将自身变成binder线程。例如mediaserver主线程便是binder线程。
5. mediaserver和servicemanager的主线程都是binder线程; surfaceflinger和system_server的主线程并非binder线程
6. 默认地，binder线程池的线程个数上限为15。这个上限不包括主线程(即通过BC_ENTER_LOOPER不算在其中)， 只计算BC_REGISTER_LOOPER命令创建的线程
