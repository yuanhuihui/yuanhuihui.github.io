
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
