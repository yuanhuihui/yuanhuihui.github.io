---
layout: post
title:  "Pm命令用法"
date:   2016-02-28 20:55:51
catalog:  true
tags:
    - android
    - pm
    - command

---

## 一、Pm命令

命令格式：

	pm <command>

命令列表：

|命令|功能|实现方法|
|---|---|---|
|list packages|列举app包信息|PMS.getInstalledPackages|
|install `[options`] `<PATH`>|安装应用|PMS.installPackageAsUser|
|uninstall `[options`]`<package`>|卸载应用|IPackageInstaller.uninstall
|enable `<包名或组件名`>|enable|PMS.setEnabledSetting|
|disable `<包名或组件名`>|disable|PMS.setEnabledSetting|
|hide `<package`>|隐藏应用|PMS.setApplicationHiddenSettingAsUser
|unhide `<package`>|显示应用|PMS.setApplicationHiddenSettingAsUser|
|get-install-location|获取安装位置|PMS.getInstallLocation|
|set-install-location|设置安装位置|PMS.setInstallLocation|
|path `<package`>|查看App路径|PMS.getPackageInfo|
|clear `<package`>|清空App数据|AMS.clearApplicationUserData|
|get-max-users|最大用户数|UserManager.getMaxSupportedUsers|
|force-dex-opt `<package`>|dex优化|PMS.forceDexOpt|
|dump `<package`>|dump信息|AM.dumpPackageStateStatic|
|trim-caches `<目标size`>|紧缩cache目标大小|PMS.freeStorageAndNotify|

pm命令实的实现方式在Pm.java，最后大多数都是调用`PackageManagerService`相应的方法来完成的。disbale之后，在桌面和应用程序列表里边都看到不该app。

## 二、详细参数

### 2.1 list packages

查看所有的package

	list packages [options] <FILTER>

**其中[options]参数：**

- -f: 显示包名所关联的文件；
- -d: 只显示disabled包名；
- -e: 只显示enabled包名；
- -s: 只显示系统包名；
- -3: 只显示第3方应用的包名；
- -i: 包名所相应的installer;
- -u: 包含uninstalled包名.


**规律**： disabled + enabled = 总应用个数；  系统 + 第三方 = 总应用个数。

比如：查看第3方应用：

	pm list packages -3

又比如，查看已经被禁用的包名。（国内的厂商一般把google的服务禁用了）

	pm list packages -d

**`<FILTER`>参数：**

当FILTER为不为空时，则只会输出包名带有FILTER字段的应用；当FILTER为空时，则默认显示所有满足条件的应用。

比如，查看包名带google字段的包名

	pm list packages google


### 2.2 pm install


安装应用

	pm install [options] <PATH>

**其中[options]参数：**

- -r: 覆盖安装已存在Apk，并保持原有数据；
- -d: 运行安装低版本Apk;
- -t: 运行安装测试Apk
- -i <INSTALLER_PACKAGE_NAME>: 指定Apk的安装器；
- -s: 安装apk到共享快存储，比如sdcard;
- -f: 安装apk到内部系统内存；
- -l: 安装过程，持有转发锁
- -g: 准许Apk manifest中的所有权限；


**`<PATH`>参数：**

该参数是必须的，是指需要安装的apk所在的路径。

### 2.3 其他参数

	pm list users //查看当前手机用户
	pm list libraries //查看当前设备所支持的库
	pm list features //查看系统所有的features
	pm list instrumentation //所有测试包的信息
	pm list permission-groups //查看所有的权限组
	pm list permissions [options] <group> 查看权限
		-g: 以组形式组织；
		-f: 打印所有信息；
		-s: 简要信息；
		-d: 只列举危险权限；
		-u: 只列举用户可见的权限。


----------

如果觉得本文对您有所帮助，请关注我的**微信公众号：gityuan**， **[微博：Gityuan](http://weibo.com/gityuan)**。 或者[点击这里查看更多关于我的信息](http://gityuan.com/about/)


