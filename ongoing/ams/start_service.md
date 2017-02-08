---
layout: post
title:  "四大组件之提纲篇"
date:   2017-8-22 22:12:30
catalog:    true
tags:
    - android
    - tool
    - debug

---



1. home -> ss -> target
2. ss -> target
3. 

## 一.概述


![ams_binder_class](/images/ams/ams_binder_class.jpg)


## service启动过程




- 主动调用stopService;
- 当包被移除或改变时;
- 当进程启动超时;
- 进程死亡;
- 执行trimApplications操作;
- 其他异常情况等.