---
layout: post
title:  "Linux Kernel源码"
date:   2016-12-18 22:22:53
catalog:    true
tags:
    - linux

---

## 一、目录结构

Kernel源代码下载如下：[https://www.kernel.org](https://www.kernel.org)

- arch: 所有CPU体系结构相关的代码
  - arm64/
- include：头文件
  - linux/
  - uapi
  - asm-generic/	
- drivers: 设备驱动
  - staging/
  - cpufreq/
  - cpuidle/
  - gpu
- kernel:
  - sched
- fs：文件子系统
  - proc
- mm: 内存子系统

- ipc: 进程间通信
- lib: 标准通用的C库
- tools: 工具
- Documentation: 文档
