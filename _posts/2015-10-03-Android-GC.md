---
layout: post
title:  "Dalvik与ART的GC调试"
date:   2015-10-03 22:10:54
catalog:  true
tags:
    - android
    - 虚拟机

---

> 本文主要讲述Dalvik与ART两种Android虚拟机，在GC时产生log信息的含义，便于分析。

## 一、Dalvik

### 1.1 GC含义

Dalvik虚拟机，每一次GC打印内容格式：

    D/dalvikvm: <GC_Reason> <Amount_freed>, <Heap_stats>, <External_memory_stats>, <Pause_time>

中文版：

    D/dalvikvm: <GC触发原因> <GC释放内存大小>, <堆统计信息>, <外部内存统计>, <暂停时间>

**含义解析**

- GC Reason(GC触发原因)
    - GC_CONCURRENT：当已分配内存达到某一值时，触发并发GC；
    - GC_FOR_MALLOC：当尝试在堆上分配内存不足时触发的GC；系统必须停止应用程序并回收内存；
    - GC_HPROF_DUMP_HEAP： 当需要创建HPROF文件来分析堆内存时触发的GC；
    - GC_EXPLICIT：当明确的调用GC时，例如调用System.gc()等；
    - GC_EXTERNAL_ALLOC： 仅在API级别为10或者更低时（新版本分配内存都在Dalvik堆上）

- Amount freed
GC回收的内存大小

- Heap stats
堆上的空闲内存百分比 （已用内存）/（堆上总内存）

- External memory stats
API级别为10或者更低：（已分配的内存量）/ （即将发生垃圾的极限）

- Pause time（暂停时间）
较大的堆将有较大的暂停时间。并发暂停时间显示有两个停顿：一个是垃圾回收的开头和另一接近垃圾回收的结尾。

### 1.2 实例

**实例：** D/dalvikvm: `GC_CONCURRENT` freed `2049K`, `65% free 3571K/9991K`, external `4703K/5261K`, paused `2ms+2ms`

**含义：**

- GC触发原因：GC_CONCURRENT;
- GC释放内存大小：2049K;
- 堆统计信息：堆空闲内存为65%，已用内存:3571K， 堆上总内存：9991K;
- 暂停时间：总共暂时4ms。

### 1.3 小结

根据不断增加的日志信息，观察增加的堆统计信息（在上例中的3571K/9991K值），若该值持续增加，可能有内存泄漏。

## 二、ART

ART的log不同于Dalvik的log机制，正常情况不会打印非明确调用的GCs的log信息。GCs打印出来的log信息都是被认为是执行比较缓慢的信息，更准确地说，就是**GC暂停的时间超过5ms或者GC执行的总时间超过100ms**。
如果app不处于暂停的感知状态，那么没有GC会被认为是缓慢的。但是明确地调用GCs会记录log信息。

### 2.1 GC含义

ART虚拟机，每一次GC打印内容格式：

    I/art: <GC_Reason> <GC_Name> <Objects_freed>(<Size_freed>) AllocSpace Objects, <Large_objects_freed>(<Large_object_size_freed>) <Heap_stats> LOS objects, <Pause_time(s)>

中文版：

    I/art: <GC触发原因> <GC名称>   <释放对象个数>(<释放字节数>)    AllocSpace Objects, <释放大对象个数>(<释放大对象字节数>)  <堆统计> LOS objects, <暂停时间>

### 2.2 GC解析

#### 2.2.1 GC Reason

1. `Concurrent`： 并发GC，不会使app线程挂起，该GC是在后台线程运行的，也不会阻止内存分配。
2. `Alloc`:当**堆内存已满**时，app尝试申请内存，会触发该GC。在这种情况下，垃圾回收发生在正在分配内存的线程。
3. `Explicit`: 明确的调用垃圾回收，比如gc().与dalvik一样，应尽可能避免明确调用gc。**不建议使用**，由于程序的GC会阻塞分配线程和不必要的CPU周期，如果其他线程获取抢占资源也可能导致jank。
4. `NativeAlloc`:    垃圾回收是由于**native内存过重**而触发的，例如Bitmaps或者RenderScript分配的对象。
5. `CollectorTransition`: 由于堆过渡触发的。收集器转换包括拷贝所有的对象从一个自由列表支持空间到指针空间，也包括反过来拷贝。目前垃圾回收器传输仅发生在**低内存设备的app进程状态转移**，包含从一个可感知的暂停状态转换到非暂停可感知状态，或者非暂停态到暂停态。
6. `HomogeneousSpaceCompact`:齐性空间压缩是指空闲列表到压缩的空闲列表空间，通常发生在当app已经移动到暂停可感知的进程状态。这样做的主要原因是减少了内存使用情况和**堆碎片整理**。
7. `DisableMovingGc`:这并非真实的GC触发原因，只是标记垃圾回收被阻塞，由于并非堆压缩正在发生时使用了GetPrimitiveArrayCritical。由于其对移动收集器的限制，使用GetPrimitiveArrayCritical是**强烈不建议**。
8. `HeapTrim`:    这并非GC触发原因，只是标记垃圾回收被阻塞直到堆整理完成。

#### 2.2.2 GC Name

1. `Concurrent mark sweep (CMS)`: 完整的堆垃圾回收器，能释放**除去图片空间之外**的所有的垃圾。
2. `Concurrent partial mark sweep`:    绝大多数的堆垃圾回收器，能释放**除去图片和zygote空间之外**的所有的垃圾。
3. `Concurrent sticky mark sweep`:    一般性的垃圾回收器，只能释放上一次GC所关联的对象。该垃圾回收器运行得**更常用，有更低的暂停时间**。
4. `Marksweep + semispace`:    非并发gc,复制GC用于堆过渡以及齐性空间压缩（堆碎片整理）。

#### 2.2.3 GC其他参数

- Objects_freed：    从非大对象空间回收到的对象数；
- Size_freed：从非大对象空间回收到的字节数；
- Large_objects_freed：从大对象空间回收到的对象数；
- Large_object_size_freed：从大对象空间回收到的字节数；
- Heap_stats：    堆上的空闲内存百分比 （已用内存）/（堆上总内存）；
- Pause_time：暂停时间跟GC正在运行时引用对象被改变的对象数成正比。目前，ART的CMD GC仅有一次停顿，出现在GC的结尾附近。移动GC有一个长的暂停时间持续在GC的大多数期间。

### 2.3 实例

I/art : `Explicit` `concurrent mark sweep GC` freed `104710`(`7MB`) AllocSpace objects, `21`(`416KB`) LOS objects, `33% free, 25MB/38MB`, paused `1.230ms` total `67.216ms`

**含义：**

- GC触发原因：Explicit
- GC名称：concurrent mark sweep GC
- 释放对象个数：104710
- 释放字节数：7MB
- 释放大对象个数：21
- 释放大对象字节数：416KB
- 堆统计：堆空闲内存为33%，已用内存:25MB， 总内存总：38MB
- 暂停时间：GC暂停时长：1.230ms，GC总时长：67.216ms

### 2.4 小结

1. 当看到大量的GC log信息在logcat，可查看堆统计(如样例中 5MB/38MB)。如果这个值持续增长，并且一直不见它变小，那可能发生了内存泄露。
2. 如果看到GC触发条件是`Alloc`，那当前环境已经接近堆内存的上限了，在不久后很快会出现OOM。



----------

# 参考

<http://developer.android.com/tools/debugging/debugging-memory.html>
