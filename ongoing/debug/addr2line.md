addr2line

## Native地址转换

1. 首先获取symbols表

http://ota.pt.miui.com/?r=eng&dir=/symbols

要找到对应的版本的symbols，以及对应版本的addr2line，这样才能确保完全匹配。

2. 其次，执行如下命令：

64位：

    cd prebuilts/gcc/linux-x86/aarch64/aarch64-linux-android-4.9/bin
    ./aarch64-linux-android-addr2line -f -C -e libxxx.so  <addr1> <addr2> ...


32位：

    cd /prebuilts/gcc/linux-x86/arm/arm-linux-androideabi-4.9/bin
    ./arm-linux-androideabi-addr2line -f -C -e libxxx.so  <addr1> <addr2> ...


## kernel地址转换


1. 获取符号地址

    cd prebuilts/gcc/linux-x86/arm/arm-eabi-4.8/bin/
    arm-eabi-nm  out/target/product/cancro/obj/KERNEL_OBJ/vmlinux |grep epoll_wait

该命令执行后,可获取sys_epoll_wait命令的符号地址

    c02b2f28 T sys_epoll_wait


2. 计算地址

例如 [<0000000000000000>] SyS_epoll_wait+0x2a0/0x324

则计算后的地址 c02b2f28 + 2a0 = 目标地址, 这时再执行如下:

    ./aarch64-linux-android-addr2line -f -C -e /out/target/product/cancro/obj/KERNEL_OBJ/vmlinux [目标地址]

3. 注意

对于kernel来说都是通过vmlinux来获取的
