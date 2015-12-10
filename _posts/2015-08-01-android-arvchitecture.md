---
layout: post
title:  "Android体系架构"
date:   2015-08-01 11:30:00
categories:  Android
excerpt:  Android
---

* content
{:toc}

>  
本文讲述的Android系统体系架构，是指应用层之下的整个系统内部的架构层级关系。而并非常说的4层架构：应用层，framework，运行库与环境，Linux内核，而是把系统内部的流程调用划分更加详细。

## 一、架构

Android系统体系架构图：

![android architecture](/images/android-arch/1.png)
 
Android系统体系架构分为5层，自顶而下分别是：

- 应用程序框架（Application Framework）
- 进程通信层（Binder IPC）
- 系统服务层（Android System Services）
- 硬件抽象层（HAL）
- Linux内核（Linux Kernel）
- 
----------

### 1.1 应用程序框架（Application Framework）
应用框架，对于App开发者使用最为频繁。而硬件开发者，只需要认识到这些APIs是HAL层接口的映射就可以了。  
  
### 1.2 进程通信层（Binder IPC）
Binder Inter-Process Communication(IPC),进程间通信机制允许framework来跨进程边界，来调用Android的系统服务的代码，这使得框架API与Android系统服务能够进行交互。对于开发者来说，这种通信机制是隐藏的。  
  
### 1.3 系统服务层（Android System Services）
功能是通过framework APIs与系统服务通信，以实现底层硬件的访问。服务是模块化的，主要部件如Window Manager, Search Service,或者Notification Manager.Android包括两类服务：系统服务（如Window Manager，Notification Manager）和媒体服务（包括播放和录制的媒体服务）。  
  
### 1.4 硬件抽象层（HAL） 
硬件抽象层（HAL）定义了一个标准接口用于硬件厂商的实现. HAL允许功能实现，而不会影响或修改上层的系统。HAL的实现被打包成模块（.so）文件，并在适当的时候被加载进Android系统。  
  
  
![HAL components](/images/android-arch/2.png)  
  硬件抽象层组件  

- **标准HAL结构**  
每个特定的硬件HAL接口特性被定义在`hardware/libhardware/include/hardware/hardware.h`,这保证HAL具有可预测的结构。该接口允许Android系统来加载相应HAL模块的正确版本。HAL接口有两个通用组件：模块与设备。  
  
- **HAL模块**  
HAL的实现被用于构建成模块（.so）文件，并在适当的时机通过Android动态链接到系统。你可以通过为每一个HAL的实现创建`Android.mk`文件并指向源码文件，来实现将其构建到系统中。一般来说，你的共享库必须被命名为符合规定的格式，以保证他们能被找到被正确加载。命名模式为为 `<module_type>:<device_name>`.

### 1.5 Linux内核（Linux Kernel）
开发设备驱动程序类似于开发一个典型的Linux设备驱动程序。Android使用Linux内核，再加上一些特殊的特性，如wake locks, Binder IPC驱动，以及用于移动嵌入式平台重要的其他功能。这些增加主要用于系统功能，而不会影响驱动程序的开发。  
  

----------

## 二、实战  
对于Android的体系结构，通过上面的讲解，还是比较抽象，下面将通过具体的一个模块Audio来举例说明。先展示一张Audio的体系结构图：
  
![Audio architecture](/images/android-arch/3.png)
  
- **Application framework**, 应用程序框架包括使用android.media API与audio硬件交互的app代码。在内部，这个代码调用相应的JNI类来访问与audio硬件交互的native代码。
  
- **JNI**, JNI代码关联android.media调用native代码来访问audio硬件. JNI代码位于`frameworks/base/core/jni/`和`frameworks/base/media/jni`.  
  
- **Native framework**, native框架提供一个相当于android.media包的本地框架，调用IPC代理来访问媒体服务器的音频专用的服务。native框架代码位于`frameworks/av/media/libmedia`.  
  
- **Binder IPC**, IPC代理可跨进程通信，该代理位于`frameworks/av/media/libmedia`,并以字母"I"开头。
  
- **Media server**，媒体服务包括audio服务，是真正与HAL实现层交互的代码。media server代码位于`frameworks/av/services/audioflinger`.  
  
- **HAL**，HAL定义了audio服务调用的标准接口，audio硬件必须正确实现的功能。 audio HAL层接口位于`hardware/libhardware/include/hardware`.关于更多可查看`hardware/audio.h`.  
  
- **Kernel driver**，audio驱动是与硬件和HAL实现的交互。可以使用Linux声音架构(ALSA),开发声音系统(OSS),或者自定义的驱动（HAL与驱动程序无关）。

## 三、小结
通过对Android体系的从上层到底层的一个梳理过程，希望能对andorid源码有完整的认识，对模块调用有一个较清晰的体会。