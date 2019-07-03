


### 1.问：fw代码索引能力
答：AS打开的目录是flutter/packages/flutter

### 2.问：engine代码索引能力
答：Clion打开目录只需要engine/src，并在目录下添加android_profile生成的compile_commands.json

### 3.问：engine代码debug能力
答：1）执行如下：
      engine/src/flutter/sky/tools/flutter_gdb server [package_name]
      engine/src/flutter/sky/tools/flutter_gdb client [package_name]
   2）再配置GDB Remote Debug的配置

### 4.问：framework代码的debug能力
答：直接就行， 但我的本地还不行？


### 5.问: 如何抓取timeline
答：需要profile的包，adb forward可以支持。

### 6.问：以下这个问题
ld: symbol(s) not found for architecture i386
clang-8: error: linker command failed with exit code 1 (use -v to see invocation)
ninja: build stopped: subcommand failed.

答：Xcode的问题， https://github.com/flutter/flutter/issues/22598

cd /Applications/Xcode.app/Contents/Developer/Platforms/MacOSX.platform/Developer/SDKs
ln -s 最新的版本

### 7. 问：端口进不去，怎么办
答：adb forward 之后，打开的网页需要加上后面的一串


### 8.问： 对于无法抓取timeline的情况
Observatory listening on http://127.0.0.1:51914/YEorTvl3s1k=/

答：ftrp 后面加上 --disable-service-auth-codes
