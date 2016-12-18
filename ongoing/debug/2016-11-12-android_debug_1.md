---
layout: post
title:  "Android调试技巧(二)"
date:   2016-6-21 22:19:53
catalog:    true
tags:
    - android
    - debug
    - stability

---

> 本文主要介绍一些常见的调试技巧

## 重要命令

adb bugreport > bugreport.txt

### 重要目录

/data/anr/traces.txt
/data/tombstones/tombstone_X
/data/system/dropbox/

## 其他

- lsof
- iostat -x
- mount
- ionice
- service list
- top
- setprop ctl.start bootanim //启动开机动画
- setprop ctl.stop bootanim  //关闭开机动画
http://blog.csdn.net/jinzhuojun/article/details/18080871
