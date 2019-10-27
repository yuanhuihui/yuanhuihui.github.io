---
layout: post
title:  "搭建Flutter Engine源码编译环境"
date:   2019-08-03 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、准备环境

#### 1.1 准备

- OS：MacOS同时支持Android和iOS的交叉编译功能，Linux只支持Android产物的交叉编译；
- git：用于源码的版本控制;
- ssh client：用于Github的认证;
- IDE: [带有Flutter插件的Android Studio](https://flutter.dev/docs/development/tools/android-studio)，这是官方推荐的旗舰IDE;
- depot_tools：内含gclient命令；
- Python: 很多工具都需要用到Python，比如gclient;
- JDK：Java开发工具;


#### 1.2 安装depot_tools

1)克隆depot_tools仓库， 获取gclient命令，执行如下：

```C
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
```

2) 设置环境变量，编辑 ~/.bashrc或者 ~/.zshrc，添加如下内容：

```C
export PATH=$PATH:/path/to/depot_tools
```

#### 1.3 安装Homebrew

打开终端，输入如下命令：

```
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

#### 1.4 安装ant和ninja

```
brew install ant
brew install ninja
```

## 二、引擎代码下载

Step 1: 创建名为engine的空文件夹;    
Step 2: 在engine目录下新建.gclient配置文件，文件内容如下：

```
solutions = [
  {
    "managed": False,
    "name": "src/flutter",
    //此处url需改为真实的个人或者公司引擎地址
    "url": "git@github.com:<your_name_here>/engine.git",
    "custom_deps": {},
    "deps_file": "DEPS",
    "safesync_url": "",
  },
]
```

Step 3. 拉取flutter引擎以及相关依赖

```C
cd engine
gclient sync  //拉取Flutter引擎所有依赖的关联库
```

gclient执行完成后，获取flutter引擎的源码目录结构如下所示：

![flutter_engine_src](/img/flutter_engine_env/flutter_engine_src.png)

- src/flutter是引擎所对应的源码；
- src/third_party是引擎所需要的三方库，包括dart, skia, libcxx等三方库

## 三、 引擎代码编译

#### 3.1 编译Android引擎

**Step 1: 准备构建文件**    
执行./flutter/tools/gn命令会在src/out目录下生成相应的文件夹，用于存放该平台的编译产物。

```Java
cd src  //进入src目录
./flutter/tools/gn --runtime-mode profile //生成Host编译产物存放文件
./flutter/tools/gn --android --runtime-mode profile //生成Android编译产物存放文件
```


![gn_cmd_help](/img/flutter_engine_env/gn_cmd_help.png)

gn参数说明：

- unoptimized：是否优化性能，加上该参数则意味着运行性能会降低，但会大幅度提升编译速度
- runtime-mode：制定Flutter的运行模式，可取值{debug,profile,release}；
- android-cpu: 指定Android产物所运行的平台，可取值{arm,x64,x86,arm64}
- ios-cpu: 指定iOS产物所运行的平台，可取值{arm,arm64}

**Step 2: 构建可执行文件**    
执行ninja命令，开始真正的构建过程

```Java
ninja -C out/host_profile -j 6
ninja -C out/android_profile -j 6
```

说明：

- 构造Android或者iOS引擎版本，需要同步构建一个相应版本的host。比如使用android_debug_unopt，则需要同时构建host_debug_unopt；
- -C：紧跟着的参数便是gn命令所生成的目录路径
- -j：指定并发编译的进程个数，该值不宜超过PC的CPU核数

```Java
//也支持同时执行多个ninja任务
ninja -C out/host_profile && ninja -C out/android_profile -j 6
```

#### 3.2 编译iOS引擎
**Step 1: 准备构建文件**    
执行./flutter/tools/gn命令会在src/out目录下生成相应的文件夹，用于存放该平台的编译产物。

```Java
cd src  //进入src目录
./flutter/tools/gn --runtime-mode profile //生成Host编译产物存放文件
./flutter/tools/gn --ios --runtime-mode profile //生成iOS编译产物存放文件
```

**Step 2: 构建可执行文件**    
执行ninja命令，开始真正的构建过程

```Java
ninja -C out/host_profile -j 6
ninja -C out/ios_profile -j 6
```

#### 3.3 使用本地引擎运行Flutter应用

**1) 构建本地引擎后，使用以下命令运行Flutter应用：**

```Java
flutter run --local-engine-src-path <FLUTTER_ENGINE_ROOT>/engine/src --local-engine=android_profile
```

参数说明：

- local-engine-src-path：指定Flutter引擎存储库的路径，也就是src根目录的绝对路径
- local-engine：指定使用哪个引擎版本，比如android_profile

这一点非常重要：使用保存有host_xxx引擎构建版本，当使用本地引擎，因为Flutter使用host构建版本中的dart，这是flutter tools会自动在host中寻找。

**2) 修改Dart文件:**

当引擎中修改了Dart源代码，则需要在pubspec.yaml中添加dependency_overrides部分，指定新的sky_engine和sky_services路径，以用于使用自定义引擎的flutter应用程序。

```Java
dependency_overrides:
  sky_engine:
    path: <FLUTTER_ENGINE_ROOT>/engine/src/out/host_profile/gen/dart-pkg/sky_engine
  sky_services:
    path: <FLUTTER_ENGINE_ROOT>/engine/src/out/host_profile/gen/dart-pkg/sky_services
```

#### 3.4 IDE配置

推荐用Clion，查看C++代码比较方便。

- 先使用./flutter/tools/gn编译引擎后，会在src/out目录下生成compile_commands.json 文件，Clion通过该文件可完成C++源码的方法跳转功能
- 进入src/flutter目录，将 compile_commands.json 软连接到 flutter 目录，或者直接拷贝到该目录；
- 使用Clion打开 src/flutter 目录，则能识别到compile_commands.json，可以开始阅读源码了；

## 参考文档

- https://github.com/flutter/flutter/wiki/Setting-up-the-Engine-development-environment
- https://github.com/flutter/flutter/wiki/Compiling-the-engine
- https://github.com/flutter/flutter/wiki/The-flutter-tool
