---
layout: post
title:  "Android源码环境搭建"
date:   2016-08-13 20:30:00
catalog:  true
tags:
    - android
---



## 一. 准备

本文介绍采用Android Studio来搭建源码调试环境

#### 1.1 下载Android Studio


**调整内存大小: ** Android Studio需要大量的内存来加载Android源码，所以经常会遇到内存不足的问题, 需要加大内存.
点击`Help`-> `Edit Custom VM Options`, 比如 "-Xms4096m -Xmx4096m"


更多资料:

- [Android Studio官网](https://developer.android.com/studio/index.html)
- [配置 Android Studio]( https://developer.android.com/studio/intro/studio-config.html#low_memory)

#### 1.2 下载Android源代码

相关资料:

- [搭建编译环境](https://source.android.com/source/initializing)
- [下载源代码](https://source.android.com/source/downloading)
- [编译准备工作](https://source.android.com/source/building)

另外也可参考 [搭建Android 7.0的源码环境](http://gityuan.com/2016/08/20/Android_N/)


## 二. 搭建源码环境

### 2.1 生成IDE相关文件

idegen专门为IDE环境调试源码而设计的工具， 依次执行如下命令：

    soruce build/envsetup.sh  
    mmm development/tools/idegen/  
    ./development/tools/idegen/idegen.sh

以上3个步骤的含义依次如下:

    Step 1: 用于初始化环境变量
    Step 2: 生成文件out/host/linux-x86/framework/idegen.jar
    Step 3: 源码根目录生成文件android.ipr(工程相关设置), android.iml(模块相关配置)

### 2.2 源码导入Android Studio

打开Android Studio， 点击`File` -> `Open`，选中前面生成的**android.ipr**文件即可， 该过程较耗时

**(a) 加载前配置文件提速：**

打开`android.iml`文件，有大量excludeFolder，是指不会导入到AS的模块，默认除了以下14个文件夹之外的所有文件都会导致到AS工程，
这显然还会非常庞大的，那么我们可以有选择的导入 如下：

    <excludeFolder url="file://$MODULE_DIR$/.repo"/>
    <excludeFolder url="file://$MODULE_DIR$/external/bluetooth"/>
    <excludeFolder url="file://$MODULE_DIR$/frameworks/base/docs"/>
    <excludeFolder url="file://$MODULE_DIR$/out/host"/>
    <excludeFolder url="file://$MODULE_DIR$/prebuilt"/>


**(b) 加载后提速：**

如果已经把全部项目导入到Android Studio，又想删除怎么办，其实有一个简单的方法就是进入目录`Project Structure` -> `Modules`，
可快速去除某些模块, 其中红色代码Exclueded选项(即代表已删除的目录), 如下图:

![as_modules](/images/as/as_modules.png)

### 2.3 配置源码正确跳转
这里的配置JDK/SDK，是用于解决在分析和调试源码的过程，能正确地跳转到目标源码，而非SDK中的代码。
点击`File`菜单下的`Project Structure`.

#### Step 1 新建JDK

Project Structure -> SDKs, 新建 `JDK(None)`, 其中JDK目录可选择跟原本JDK一致即可,
然后删除其classpath和SourcePath的内容，确保使用Android系统源码文件

![jdk_none](/images/as/jdk_none.png)


#### Step 2 配置SDK

Project Structure -> SDKs, 选中`Android API 25 Platform`, 然后选择其Java SDK为前面新建的`JDK(None)`

![sdk_none](/images/as/sdk_none.png)

#### Step 3 选择SDK

Project Structure -> Project -> 选中Project SDK, 选择前面的`Android API 25 Platform`

![project_sdk](/images/as/project_sdk.png)


#### Step 4 建立依赖
Project Structure -> Modules -> android -> Dependencies:
先删除Android API 25 Platform之外的所有依赖, 然后点击下图绿色的`+`号来选择`Jars or directories`，将frameworks添加进来, 也可添加其他所关注的源码；

![project_dependencies](/images/as/project_dependencies.png)

下图便是添加后的结果图:

![project_result](/images/as/project_result.png)


## 三. 在线调试


前面已搭建好了Android的源码调试环境, 接下来可以在线调试源码. 首先,需要一台具有debug版的手机, 打开开发者选项, 允许USB调试.

### 3.1 attach系统进程

frameworks各大核心服务运行在system_server进程, 在调试器上名字为system_process,通过如下操作attach到我们要调试的目标进程,
同理, 要调试其他app进程也是这个方式.

![as_attach](/images/as/as_attach.png)



### 3.2 进入调试

首先需要设置断点, 一旦进入断点便会停下来, 可以查看当时各个线程/变量值. 关于调试下一步等快捷键, 只需点击Tools即可看到.

![as_debugger](/images/as/as_debugger.png)
