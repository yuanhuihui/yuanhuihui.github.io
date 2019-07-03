

[-> frameworks/base/cmds/am/am]
[-> frameworks/base/cmds/app_process/app_main.cpp]

## 进程起源

    #!/system/bin/sh
    #
    # Script to start "am" on the device, which has a very rudimentary
    # shell.
    #
    base=/system
    export CLASSPATH=$base/framework/am.jar
    exec app_process $base/bin com.android.commands.am.Am "$@"

也就是说


[-> frameworks/base/cmds/app_process/app_main.cpp]

    app_process [vm-options] cmd-dir [options] start-class-name [main-options]
    app_process /system/bin com.android.commands.am.Am "$@"


#### app_process用法说明

app_process [vm-options] cmd-dir [options] start-class-name [main-options]

参数说明：

|参数|含义|实例|
|---|---|---|
|vm-options|VM可选项|-Xzygote|
|cmd-dir|父目录|/system/bin|
|options|运行参数|--zygote|
|||


其中options的可取值有：

- --zygote： 启动Zygote进程；
- --start-system-server: 启动system_server进程；
- --application： 启动应用；
- --nice-name： 设置进程名

例如启动Zygote进程的命令

    /system/bin/app_process -Xzygote /system/bin --zygote --start-system-server


####


    if (zygote) {
        runtime.start("com.android.internal.os.ZygoteInit", args, zygote);
    } else if (className) {
        runtime.start("com.android.internal.os.RuntimeInit", args, zygote);
    }
