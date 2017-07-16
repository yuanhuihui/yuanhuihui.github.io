---
layout: post
title:  "Android Studio导入Android系统源码笔记"
date:   2016-06-13 20:30:00
catalog:  true
tags:
    - android
---



## 一. 准备
IDEGen自身生成Android IDE配置，可用于IntelliJ IDEA( Android Studio基于IDEA开发)和 Eclipse。

1. 下载Android Studio(简称AS)；

2. 下载Android系统源码；

3. 调整AS内存参数；

AS需要大量的内存来加载Android源码，所以需要配置VM options， 点击Help -> Edit Custom VM Options，

比如 "-Xms748m -Xmx748m"。

## 二. 生成IDE相关文件
idegen专门为IDE环境调试源码而设计的工具， 依次执行如下命令：

    soruce build/envsetup.sh
    mmm development/tools/idegen/
    ./development/tools/idegen/idegen.sh

说明：

- 第一行命令，用于初始化环境变量；
- 第二行命令，用于生成文件out/host/linux-x86/framework/idegen.jar；
- 第三行命令，用于源码根目录生成文件android.ipr(工程相关设置), android.iml(模块相关配置)

## 三. 源码导入

### 3.1 优化导入速度

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

### 3.2 导入源码

打开AS，点击File -> Open，选中前面生成的android.ipr文件即可， 这个过程比较耗时，耐心等待。

### 3.3 配置JDK/SDK
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
