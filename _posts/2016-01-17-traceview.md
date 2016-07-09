---
layout: post
title:  "性能工具Traceview"
date:   2016-01-17 22:37:22
catalog:  true
tags:
    - android
    - performance
    - debug

---

## Traceview

性能分析功能，首推Systrace，建议看看另一篇文章[性能工具Systrace](http://gityuan.com/2016/01/17/systrace/)，关于Trracview就简单地讲一下。


**代码实现:**

    Debug.startMethodTracing("demo");
    Debug.stopMethodTracing();


**视图:**

![traceview](/images/android-tools/traceview.png)

**参数说明:**

1. `Name`：
该线程运行过程中所调用的函数名
2. `Incl Cpu Time`：
某函数占用的CPU时间，包含内部调用其它函数的CPU时间
3. `Excl Cpu Time`：
某函数占用的CPU时间，但不含内部调用其它函数所占用的CPU时间
4. `Incl Real Time`：
某函数运行的真实时间（以毫秒为单位），内含调用其它函数所占用的真实时间
5. `Excl Real Time`：
某函数运行的真实时间（以毫秒为单位），不含调用其它函数所占用的真实时间
6. `Call+Recur Calls/Total`：
某函数被调用次数以及递归调用占总调用次数的百分比
7. `Cpu Time/Call`：
某函数调用CPU时间（Incl Cpu time）与调用次数的比，等价于该函数平均执行时长。
8. `Real Time/Call`：
某函数调用CPU时间（Incl Real time）与调用次数的比。等价于该函数平均真实时长


**重点关注项:**

- `Cpu Time/Call` 函数平均执行时间较长的函数；
- `Call+Recur Calls/Total`，调用次数非常频繁的函数。
