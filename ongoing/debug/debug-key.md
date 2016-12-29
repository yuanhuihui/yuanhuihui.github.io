## 时间
1. up time: 00:30:16, idle time: 00:29:30, sleep time: 00:02:41 (重点看up time)

## 一. Java Crash

1. system log

system_server crash

    *** FATAL EXCEPTION IN SYSTEM PROCESS [线程名]

app crash

    FATAL EXCEPTION: [线程名]
    Process: [进程名], PID: [进程id]

技巧1: 搜索关键词`FATAL EXCEPTION`来查看所有的Java crash问题,


2. event Log

技巧2: Event log中搜索"am_crash", am_crash格式:

    //[pid, UserId, 进程名, flags, Exception类, Exception内容, 抛异常文件名, 抛异常行号]
    am_crash: [16208,0,com.android.camera,952745541,java.lang.RuntimeException,getParameters failed (empty parameters),CameraManager.java,262]

3. dropbox

位于`/data/system/dropbox`

    system_server_crash
    system_server_watchdog
    system_app_crash
    data_app_crash

## 三. Native Crash

native程序(C/C++)出现异常时，kernel会发送相应的signal, 当进程捕获致命的signal，将action=DEBUGGER_ACTION_CRASH的消息发送给debuggerd服务端,阻塞等待回应消息.

输出内容项:

    pid: %d, tid: %d, name: [线程名]  >>> [进程名] <<<
    signal相关信息，包含fault address
    寄存器状态
    backtrace
    stack
    memory near
    code around
    memory map

输出文件:

`/data/tombstones/tombstone_XX`

**小结:system server Native crash关键词**

    >>> system_server <<< (位于tombstone)

## 四. 总结

### 4.1 system进程
对于system_server异常需要关注的关键词:

**Java Crash:**
    FATAL EXCEPTION IN SYSTEM PROCESS (位于system log)
    system_server_crash (位于dropbox)

**watchdog:**
    WATCHDOG KILLING SYSTEM PROCESS (位于system log)
    system_server_watchdog  (位于dropbox)

**Native Crash:**
    >>> system_server <<< (位于tombstone)

小结： 无论是ANR，还是Watchdog，最重要的信息是查看dropbox。

其他关键词：

ANR in system
beginning  of crash
FATAL EXCEPTION


### 4.2 普通进程

**Java Crash:**

    FATAL EXCEPTION (位于system log)
    am_crash (位于event log)
    system_app_crash (位于dropbox)
    data_app_crash (位于dropbox)

**Native Crash:**

    >>>   (位于tombstone)


## Kernel debug

http://wiki.mioffice.cn/xmg/Debug_kernel

http://wiki.mioffice.cn/xmg/Power_up_reason

## 项目

### 途径1

/data/anr/traces.txt.report 这个抓bugreport时生成的 (现抓的)
/data/anr/traces.txt 这是上次发生anr时抓取的 (这个重点看)

### 途径2

/data/dropbox/system_server_anr之类

bugreport关键词: DUMP OF SERVICE dropbox:

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

1. 查看uptime，来判断是上层重启，还是底层重启
2. 查看zygote, system_server的pid，大于10000，基本上是发生了framework重启

## 其他


echo "parsing ZYGOTE WAS GONE..."
grep -rn "Exit zygote" ./ --color

echo "parsing ZYGOTE WAS GONE BY EVENT LOG..."
grep -rnC 1 "boot_progress_start" ./ --color



echo "parsing SYSTEM_SERVER_HANG ..."

grep -rn "traces_SystemServer_WDT" ./ --color
grep -rn "am_watchdog" ./ --color

grep -rn "watchdog since start" ./ --color
grep -rn "Blocked in" ./ --color

echo "**********parsing SysRq*************..."
grep -rn "Show Blocked State" ./ --color


echo "parse SYSTEM_RESTART..."
grep -rn "SYSTEM_RESTART" ./ --color

echo "parse SYSTEM_BOOT..."
grep -rn "SYSTEM_BOOT" ./ --color

echo "parse KERNEL ISSUE.."
grep -rn "kpanic" ./ --color
grep -rn "Kernel BUG" ./ --color
grep -rn "Internal error" ./ --color
grep -rn "Kernel panic" ./ --color
grep -rn "Watchdog bark" ./ --color
grep -rn "watchdog bite" ./ --color
grep -rn "kernel reboot     :" ./ --color

echo "parse MODEM RESET.."
grep -rn "Modem Restart" ./ --color
grep -rn "Fatal error" ./ --color

echo "parse PUREASON.."
grep -rn "PuReason:" ./ --color
grep -rn "Powerup reason" ./ --color

echo "parse BOOTFAILTURE..."
grep -rn "BOOT FAILURE" ./ --color


echo "parse ShenYinMoShi"
grep -rn "mfrozenAppFunCtrlFlg" ./ --color
grep -rn "STATE is" ./ --color
#grep -rnE -A10 "#+dump FrozenAppController#+" ./ --color

echo "parse dropbox entries..."
grep -rn "Drop box contents" ./ --color

echo "parse ANR ..."
grep -rn "am_anr" ./ --color
grep -rn "system_app_anr" ./ --color
grep -rn " VM TRACES" ./ --color

echo "parse system app native crash"
grep -rn -A3 "system_app_native_crash" ./ --color

#echo "parse system tombstone"
#grep -rn -A3 "SYSTEM_TOMBSTONE" ./ --color
#echo "parse SYSTEM_APP_WTF"


## else

force acquire UnstableProvider
acquire killed Provider
is crashing

cat bugreport_1472203656562.log | egrep "force acquire UnstableProvider|acquire killed Provider|is crashing|depends on"

## D状态

DEBUG : timed out waiting for stop signal: tid=7601
DEBUG : detach failed: tid 7601, No such process
debuggerd committing suicide to free the zombie


## getprop
[ro.product.mod_device]: [gemini_alpha]
[ro.product.model]: [MI 5]

灭屏
01-18 04:22:08.869  2082  2082 I WindowManager: Started going to sleep... (why=2)
01-18 04:22:09.184  2082  2082 I WindowManager: Finished going to sleep... (why=2)
01-18 04:22:09.201  2082  2082 V LocationPolicy: Screen state changed

PowerManagerService: Going to sleep due to power button
PowerManagerService: Sleeping

亮屏
01-18 04:22:10.188  2082  2082 I WindowManager: Started waking up...
01-18 04:22:10.188  2082  2082 V KeyguardServiceDelegate: onStartedWakingUp()
01-18 04:22:10.216  2082  2082 V LocationPolicy: Screen state changed
01-18 04:22:10.264  2082  2082 I WindowManager: Finished waking up...

PowerManagerService: Waking up from sleep

灭屏:


调试技巧:

输出不包含的log:

adb logcat -b events | egrep -v "am_pss|sysui_|am_broadcast"

logcat -b system -b  main -b events | egrep "Timeline|am_" | egrep  -v "am_pss|auditd"


##  AMS

Activity启动
ActivityManager: START u0
