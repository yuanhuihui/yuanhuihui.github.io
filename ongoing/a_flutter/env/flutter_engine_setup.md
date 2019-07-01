---
layout: post
title:  "搭建Flutter引擎的开发环境"
date:   2019-06-07 21:15:40
catalog:  true
tags:
    - flutter

---


## 一、相关依赖

- MacOS：目前只有MacOS同时支持Android和iOS的交叉编译功能，Linux或Windows也是可以的；
- git：用于源码的版本控制;
- ssh client：用于Github的认证;
- IDE: [带有Flutter插件的Android Studio](https://flutter.dev/docs/development/tools/android-studio)，这是官方推荐的旗舰IDE;
- depot_tools：内含gclient命令；
- Python: 很多工具都需要用到Python，比如gclient;
- JDK;


## 二、安装环境

### 2.1 安装depot_tools

1) 克隆depot_tools仓库，执行如下命令：

```C
git clone https://chromium.googlesource.com/chromium/tools/depot_tools.git
```

2) 设置环境变量，编辑 ~/.bashrc或者 ~/.zshrc，添加如下内容：

```C
export PATH=$PATH:/path/to/depot_tools
```

### 2.2 安装Homebrew

打开终端，输入如下命令：

```
/usr/bin/ruby -e "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/master/install)"
```

### 2.3 安装ant和ninja

```
brew install ant
brew install ninja
```

### 2.4 下载代码

1）创建名为engine的空文件夹
2) 在engine目录下新建.gclient配置文件，文件内容如下：

```
solutions = [
  {
    "managed": False,
    "name": "src/flutter",
    "url": "git@github.com:<your_name_here>/engine.git",
    "custom_deps": {},
    "deps_file": "DEPS",
    "safesync_url": "",
  },
]
```

3) 拉取flutter引擎以及相关依赖

```C
cd engine
gclient sync
```

## 三、 编译


https://bytedance.feishu.cn/space/doc/doccnjrZsMFBipO9oVf6yG#
