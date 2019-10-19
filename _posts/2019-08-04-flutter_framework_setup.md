---
layout: post
title:  "搭建Flutter Framework开发环境"
date:   2019-08-04 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、相关依赖

- Linux，Mac OS X或者Windows
- git：用于源码的版本控制;
- ssh client：用于Github的认证;
- IDE: [带有Flutter插件的Android Studio](https://flutter.dev/docs/development/tools/android-studio)，这是官方推荐的旗舰IDE;
- Python: 很多工具都需要用到Python，比如gclient;
- Android platform tools：可使用如下命令来安装
    - Mac: brew cask install android-platform-tools
    - Linux: sudo apt-get install android-tools-adb

## 二、安装环境

- 确保adb可用，可通过which adb检测命令是否可用。
- Fork一份Flutter Framework代码，https://github.com/flutter/flutter
- 将flutter的bin添加到PATH
- 设置环境变量：添加export PATH=`your_flutter_path`/bin:$PATH
    - 默认bash，则是open ~/.bash_profile
    - 对于zsh，则是open ~/.zshrc
- 执行命令flutter update-packages，来获取Flutter所依赖的Dart Packages

## 三、导入IDE

- Android Studio的Plugins中搜索flutter，安装flutter插件后重启AS；
- 通过AS的File -> Open加载已下载的flutter项目
    - 这里需要注意，打开的目录是flutter/packages/flutter，否则可能代码间跳转会有些问题
- 执行flutter doctor
- 执行flutter packages upgrade
- 执行flutter packages get

这便完成了flutter framework的源码环境。


参考资料：[Setting up the Framework development environment](https://github.com/flutter/flutter/wiki/Setting-up-the-Framework-development-environment)
