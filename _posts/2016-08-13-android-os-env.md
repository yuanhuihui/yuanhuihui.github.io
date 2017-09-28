---
layout: post
title:  "Android源码环境搭建"
date:   2016-06-13 20:30:00
catalog:  true
tags:
    - android
---



## 一. 准备

本文介绍采用Android Studio来搭建源码调试环境

#### 1.1 下载Android Studio

官网链接: https://developer.android.com/studio/index.html

#### 1.2 下载Android源码

相关资料:

1. [搭建编译环境](https://source.android.com/source/initializing)
2. [下载源代码](https://source.android.com/source/downloading)
3. [编译准备工作](https://source.android.com/source/building)

另外, 也可参考 [搭建Android 7.0的源码环境](http://gityuan.com/2016/08/20/Android_N/)


#### 1.3 生成IDE相关文件

idegen专门为IDE环境调试源码而设计的工具， 依次执行如下命令：

    //Step 1: 用于初始化环境变量
    soruce build/envsetup.sh  
    //Step 2: 生成文件out/host/linux-x86/framework/idegen.jar
    mmm development/tools/idegen/  
    //Step 3: 用于源码根目录生成文件android.ipr(工程相关设置), android.iml(模块相关配置)
    ./development/tools/idegen/idegen.sh


#### 1.4 调整AS内存参数

Android Studio需要大量的内存来加载Android源码，所以经常会遇到内存不足的问题, 需要加大内存.

- 方法一: 点击Help -> Edit Custom VM Options, 比如 "-Xms748m -Xmx748m"。
- 方式二: 可修改IDEA_HOME/bin/studio64.vmoptions中-Xms和-Xmx的值

## 二. 源码导入

#### 2.1 优化速度

打开android.iml文件，有大量excludeFolder，是指不会导入到AS的模块，默认除了以下14个文件夹之外的所有文件都会导致到AS工程，
这显然还会非常庞大的，那么我们可以有选择的导入 如下：

    <excludeFolder url="file://$MODULE_DIR$/./external/emma"/>
    <excludeFolder url="file://$MODULE_DIR$/./external/jdiff"/>
    <excludeFolder url="file://$MODULE_DIR$/out/eclipse"/>
    <excludeFolder url="file://$MODULE_DIR$/.repo"/>
    <excludeFolder url="file://$MODULE_DIR$/external/bluetooth"/>
    <excludeFolder url="file://$MODULE_DIR$/external/chromium"/>
    <excludeFolder url="file://$MODULE_DIR$/external/icu4c"/>
    <excludeFolder url="file://$MODULE_DIR$/external/webkit"/>
    <excludeFolder url="file://$MODULE_DIR$/frameworks/base/docs"/>
    <excludeFolder url="file://$MODULE_DIR$/out/host"/>
    <excludeFolder url="file://$MODULE_DIR$/out/target/common/docs"/>
    <excludeFolder url="file://$MODULE_DIR$/out/target/common/obj/JAVA_LIBRARIES/android_stubs_current_intermediates"/>
    <excludeFolder url="file://$MODULE_DIR$/out/target/product"/>
    <excludeFolder url="file://$MODULE_DIR$/prebuilt"/>

如果已经把全部项目导入到AS，又想删除怎么办，其实有一个简单的方法，进入目录Project Structure -> Modules，
可快速去除某些模块，如下图：

#### 2.2 源码导入

打开Android Studio，点击File -> Open，选中前面生成的android.ipr文件即可， 这个过程比较耗时，耐心等待。

#### 3.3 配置JDK/SDK
这里的配置JDK/SDK，是用于解决在分析和调试源码的过程，能正确地跳转到目标源码，而非SDK中的代码。

步骤：

1. Project Structure -> SDKs -> 新建 JDK(None）：
  - 然后删除其classpath和SourcePath的内容，确保使用Android系统源码文件；
2. Project Structure -> SDKs -> 选中Android API 24 Platform：
  - 然后选择其Java SDK为前面新建的JDK(None);
3. Project Structure -> Project -> 选中Project SDK：
  - 选择前面的Android API 24 Platform；
4. Project Structure -> Modules -> android -> Dependencies:
  - 先删除Android API 24 Platform之外的所有依赖；
  - 点击+选择`Jars or directories`选项，将frameworks添加进来。当然，也可以添加其他你所关注的源码；
