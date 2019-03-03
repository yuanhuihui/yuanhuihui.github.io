---
layout: post
title:  "理解Android.bp"
date:   2018-06-02 23:23:46
catalog:  true
tags:
    - android

---

> 介绍Android最新的编译系统

### 一、简介

早期的Android系统都是采用Android.mk的配置来编译源码，从Android 7.0开始引入Android.bp。很明显Android.bp的出现就是为了替换掉Android.mk。

再来说一说跟着Android版本相应的**发展演变过程:**

- Android 7.0引入ninja和kati
- Android 8.0使用Android.bp来替换Android.mk，引入Soong
- Android 9.0强制使用Android.bp

转换关系图如下：

![android_build](/images/android_bp/android_build.jpg);

通过Kati将Android.mk转换成ninja格式的文件，通过Buleprint+ Soong将Android.bp转换成ninja格式的文件，通过androidmk将将Android.mk转换成Android.bp，但针对没有分支、循环等流程控制的Android.mk才有效。

这里涉及到Ninja, kati, Soong, bp概念，接下来分别简单介绍一下。

#### 1. Ninja

ninja是一个编译框架，会根据相应的ninja格式的配置文件进行编译，但是ninja文件一般不会手动修改，而是通过将Android.bp文件转换成ninja格文件来编译。

#### 2. Android.bp

Android.bp的出现就是为了替换Android.mk文件。bp跟mk文件不同，它是纯粹的配置，没有分支、循环等流程控制，不能做算数逻辑运算。如果需要控制逻辑，那么只能通过Go语言编写。

#### 3. Soong

Soong类似于之前的Makefile编译系统的核心，负责提供Android.bp语义解析，并将之转换成Ninja文件。Soong还会编译生成一个androidmk命令，用于将Android.mk文件转换为Android.bp文件，不过这个转换功能仅限于没有分支、循环等流程控制的Android.mk才有效。

#### 4. Blueprint

Blueprint是生成、解析Android.bp的工具，是Soong的一部分。Soong负责Android编译而设计的工具，而Blueprint只是解析文件格式，Soong解析内容的具体含义。Blueprint和Soong都是由Golang写的项目，从Android 7.0，prebuilts/go/目录下新增Golang所需的运行环境，在编译时使用。

#### 5. Kati

kati是专为Android开发的一个基于Golang和C++的工具，主要功能是把Android中的Android.mk文件转换成Ninja文件。代码路径是build/kati/，编译后的产物是ckati。

### 二、Android.bp语法

Android.bp是一种纯粹的配置文件，设计简单，没有条件判断或控制流语句，采用在Go语言编写控制逻辑。

Android.bp文件记录着模块信息，每一个模块以模块类型开始，后面跟着一组模块的属性，以名值对(name: value)表示，每个模块都必须有一个 name属性。基本格式，以frameworks/base/services/Android.bp文件为例

```C
java_library {
    name: "services",

    dex_preopt: {
        app_image: true,
        profile: "art-profile",
    },

    srcs: [
        "java/**/*.java",
    ],

    static_libs: [
        "services.core",
        "services.accessibility",
        "services.appwidget",
        "services.autofill",
        "services.backup",
        "services.companion",
        "services.coverage",
        "services.devicepolicy",
        "services.midi",
        "services.net",
        "services.print",
        "services.restrictions",
        "services.usage",
        "services.usb",
        "services.voiceinteraction",
        "android.hidl.base-V1.0-java",
    ],

    libs: [
        "android.hidl.manager-V1.0-java",
        "miuisdk",
        "miuisystemsdk"
    ],

}

cc_library_shared {
    name: "libandroid_servers",
    defaults: ["libservices.core-libs"],
    whole_static_libs: ["libservices.core"],
}
```
