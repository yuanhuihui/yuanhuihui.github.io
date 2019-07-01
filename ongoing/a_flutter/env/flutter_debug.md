1. Profiler::DumpStackTrace(bool for_crash)  
  没有symbols的问题，如何解决？


1.问：fw代码索引能力
答：AS打开的目录是flutter/packages/flutter

2.问：engine代码索引能力
答：Clion打开目录只需要engine/src，并在目录下添加android_profile生成的compile_commands.json

3.问：engine代码debug能力
答：1）执行如下：
      engine/src/flutter/sky/tools/flutter_gdb server [package_name]
      engine/src/flutter/sky/tools/flutter_gdb client [package_name]
   2）再配置GDB Remote Debug的配置

4.问：framework代码的debug能力
答：直接就行， 但我的本地还不行？


5.问: 如何抓取timeline
答：需要profile的包，adb forward可以支持。
