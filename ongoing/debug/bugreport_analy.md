### 一、reboot

#### dumpsys_all
Kernel reboot
kpanic
Internal error

#### lask_kernel

Internal error
Kernel panic

#### current_kernel

Powerup reason


#### 小技巧

查看uptime，来判断是上层重启，还是底层重启

查看zygote, system_server的pid，大于10000，基本上是发生了framework重启

### 二、ANR

#### system log

ANR in system


### 三、Crash

beginning  of crash
FATAL EXCEPTION


### Service

publishServiceLocked

handleCreateService
handleBinderService
handleUnbindService
handlerServiceArgs
handleStopService
  serviceDoneExecuting
