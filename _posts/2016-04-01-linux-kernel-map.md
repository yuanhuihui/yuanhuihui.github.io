---
layout: post
title:  "Linux Kernel简介"
date:   2016-04-01 22:22:53
catalog:    true
tags:
    - linux

---

## 一. Linux全局观

先来看一幅Linux kernel map：点击查看[大图](http://www.gityuan.com/images/linux/linux_kernel_map.png)

![linux kernel map](/images/linux/linux_kernel_map.png)

这是makelinux网站提供的一幅非常经典的Linux内核图，涵盖了内核最为核心的方法.
Linux除了驱动开发外，还有很多通用子系统，比如CPU, memory, file system等核心模块，即便不做底层驱动开发，
掌握这些模块对于加深理解整个系统运转机制还是很有帮助。

## 二. Kernel源码目录结构

简要列举Kernel[源代码](https://www.kernel.org)的常见目录：

|目录|解释|部分子目录|
|---|---|---|
|kernel|内核管理相关，进程调度等|sched/fork等|
|fs|文件子系统|ext4/f2fs/fuse/debugfs/proc等|
|mm|内存子系统|
|drivers|设备驱动|staging/cpufreq/gpu等|
|arch|所有CPU体系结构相关的代码|armm64/x86等|
|include|头文件|linux/uapi/asm_generic等|
|lib| 标准通用的C库|
|ipc| 进程间通信相关|
|init|初始化过程(非系统引导阶段)|
|block|块设备驱动程序|-|
|crypto|加密、解密、校验算法|-|
|Documentation|说明文档|-|


## 三. 资料

- [lxr.free-electrons](http://lxr.free-electrons.com)：LXR（The Linux Cross Referencer），提供方便地kernel在线源码阅读。
- [makelinux.net](http://www.makelinux.net/kernel_map/)：可快速跳转到linux kernel map所涉及的任一方法；
