
## 一. 准备

当手头有源码， 可在/prebuilts目录下查找，一般位于如下：

### 1.1 准备工具

|工具|所在源码路径|
|---|---|
|32位gdb服务端|prebuilts/misc/android-arm/gdbserver/gdbserver|
|64位gdb服务端|prebuilts/misc/android-arm64/gdbserver64/gdbserver64|
|32位gdb客户端|prebuilts/gcc/linux-x86/arm/arm-linux-androideabi-4.9/bin/arm-linux-androideabi-gdb|
|64位gdb客户端|prebuilts/gcc/linux-x86/aarch64/aarch64-linux-android-4.9/bin/aarch64-linux-android-gdb|
|symbols|/out/target/product/[name]/symbols|

gdbserver64和gdbserver选择哪一个，取决于当前手机是32位还是64位，要判定这个方法很有很多，比如

    adb shell getprop ro.product.cpu.abi


### 1.2 准备环境

    adb root
    adb disable-verity          
    adb reboot

    adb root
    adb remout
    adb push prebuilts/misc/android-arm64/gdbserver64/gdbserver64 /system/bin

    adb shell setenforce 0


如果disable-verity命令不可执行，需要选择源码环境下的adb命；如果过程遇到selinux权限问题，记得关闭.

## 二. 调试

服务端操作：

    adb shell
    gdbserver64 :1234 --attach 1536  //1536代表system_server进程的pid


客户端操作：

    adb forward tcp:1234 tcp:1234
    aarch64-linux-android-gdb   //提前配置好环境变量
    target remote:1234
    file xxx/out/target/product/[name]/symbols/system/bin/app_process64  // 加载被调试的可执行程序
    set sysroot  [xxx/symbols] // 设置符号路径
    set dir xxx   //设置源码路径

调试

    b frameworks/base/core/jni/android_util_Process.cpp:1035 if sig == 19
    c


此次需要的是：

file /home/gityuan/gityuan/BUG/HTH-23835/whyred_rom/whyred_global_symbols_V9.5.6.0.OEIMIFA.root_8.1_c99e47134e_g25d3dd4/out/target/product/whyred/symbols/system/bin/app_process64
set sysroot  /home/gityuan/gityuan/BUG/HTH-23835/whyred_rom/whyred_global_symbols_V9.5.6.0.OEIMIFA.root_8.1_c99e47134e_g25d3dd4/out/target/product/whyred/symbols
set dir /home/gityuan/mount/project/c1-sagit-o-dev
 b frameworks/native/libs/binder/IPCThreadState.cpp:813
