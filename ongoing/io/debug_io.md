## 命令

df

cat proc/partitions  

mount

stat <file>

## 内置存储关系


/data/
    /media/0  (sdcard数据)
    /sdcard
    /data/pkgName  (app内部存储)

/sdcard

/mnt/
    /sdcard/
    /runtime/
    /user/0
    /shell
    /media_rw (废弃)


/storage
    /emulated/0/  (内置存储)
    /sdcard1/Android/data/com.tencent.mobileqq/cache/ (外置sdcard) M之前的机型
    /uuid/android/data                                (外置sdcard) M

obb的作用:针对大app而涉及的

### 等价

/sdcard
/mnt/runtime/write/emulated/0
/mnt/runtime/read/emulated/0
/mnt/sdcard
/mnt/user/0/primary/

/storage/self/primary
/storage/emulated/0  

/data/media/0


链接关系:

/mnt/sdcard/ -> /sdcard  -> /storage/self/primary -> /mnt/user/0/primary/
-> /storage/emulated/0 -> /data/media/0(通过文件系统指向)


storage/emulated/0
/storage/sdcard1

## 文件系统

    mount <type> <device> <dir> [mountoption]

|目录|设备|文件系统|
|---|---|---|
|/|rootfs|rootfs|
|/proc|proc|proc|Vold
|/sys|sysfs|sysfs|
|/dev|tmpfs|tmpfs|
|/mnt |tmpfs|tmpfs|
|/storage|tmpfs|tmpfs|
|/var|none|tmpfs|
|/sys/fs/cgroup|none|tmpfs|
|/dev/pts|devpts|devpts
|/sys/fs/selinux|selinuxfs|selinuxfs|
|/sys/kernel/debug|debugfs|debugfs
|/storage/emulated|/dev/fuse|fuse|
|/mnt/runtime/default/emulated|/dev/fuse|fuse|
|/mnt/runtime/read/emulated|/dev/fuse|fuse|
|/mnt/runtime/write/emulated|/dev/fuse|fuse|
|/data|/dev/block/dm-0|ext4|
|/system|-|ext4|
|/cache|-|ext4|
|/cust|-|ext4|
|/persist|-|ext4|
|/dsp|-|ext4|
|/firmware|-|vfat|

对于后面几个ext4文件系统的mount节点,所指向的设备都是在/dev/block/bootdevice/by-name/*, 例如:

    /system  => /dev/block/bootdevice/by-name/system
    /cache  => /dev/block/bootdevice/by-name/cache
    /persist  => /dev/block/bootdevice/by-name/persist
    /dsp  => /dev/block/bootdevice/by-name/dsp
    /firmware  => /dev/block/bootdevice/by-name/modem


采用cgroup文件系统: (另外,/sys/fs/cgroup采用的是tmpfs)

- /acct
- /dev/memcg
- /dev/cpuctl
- /dev/cpuset
- /sys/fs/cgroup/memory
- /sys/fs/cgroup/freezer


## 参考

https://source.android.com/devices/storage/

### storage

可插拔存储:(物理存储媒介)
- SD card: Android 1.0 开始支持
- USB: Android 6.0
- OTG:

模拟存储
-  Emulated storage:通过暴露内部存储来实现的模拟层, Android 3.0

## 关键词


MountService
VoldConnector
CryptdConnector

Vold
VoldCmdListener


egrep -i 'vold|volume|mount|fsck_msdos'


## usb问题

dumpsys usb
getprop | grep usb


## bsp 分享

OTG log分析

1.插上OTG线后首先会有下面的log：
    hub 2-0:1.0: USB hub found
    hub 2-0:1.0: 1 port detected

2.如果能成功枚举出USB设备，大概会有如下log，以某个U盘为例：

    usb 2-1: New USB device found, idVendor=0930, idProduct=6545
    usb 2-1: New USB device strings: Mfr=1, Product=2, SerialNumber=3
    usb 2-1: Product: TransMemory
    usb 2-1: Manufacturer: TOSHIBA
    usb 2-1: SerialNumber: 001CC0C61237EC10532502D9

3.kernel中SCSI设备的识别，会把这个已经枚举USB设备识别成系统支持的文件系统的设备（可以理解为window中的盘符），log中usb-storage开头的都是scsi的log

    usb-storage 2-1:1.0: starting scan
    usb-storage: usb_stor_control_msg: rq=fe rqtype=a1 value=0000 index=00 len=1
    usb-storage: GetMaxLUN command result is 1, data is 0
    usb-storage 2-1:1.0: scan complete
    usb-storage: queuecommand_lck called

如果SCSI识别成功，会产生如下log： sda: sda1 //这个就是产生的‘盘符’
[编辑]





09-10 15:08:30.134  1377  1428 D MountService: mStartedUsers is empty, delay mount public volume
