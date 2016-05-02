---
layout: post
title:  "Android强弱引用"
date:   2015-12-05 15:10:50
catalog:  true
tags:
    - android
    - reference

---

### 1.概述
Android源码中，大量存在sp/wp。RefBase是Android的native层(C++)上所有对象的祖师爷，位同Java世界的Object。在Android Native体系架构中，利用RefBase的sp(strong pointer)和wp(weak pointer)通过一套强弱引用计数实现对对象生命周期的管理。

### 2. RefBase
RefBase有一个成员变量mRefs为weakref_impl指针，weakref_impl对象便是用来管理引用计数的。

|引用类型|强引用计数|弱引用计数|
|---|---|---|
|sp构造|+1|+1|
|wp构造||+1|
|sp析构|-1|-1|
|wp析构||-1|


- 在构造一个实际对象的同时，会自动创建一个weakref_impl对象；
- 强引用为0时，实际对象被delete；
- 弱引用为0时，weakref_impl对象被delete;

### 3. promote
弱引用不能直接操作目标对象，根本原因是在于弱指针类没有重载*和->操作符号，而强指针重载了这两个操作符号。可通过promote()函数，将弱引用提升为强引用对象

- promote作用试图增加目标对象的强引用计数；
- 由于目标对象可能已经被delete掉了，或者是其它的原因导致提升失败；

### 4.生命周期

- flags为0，强引用计数控制实际对象的生命周期，弱引用计数控制weakref_impl对象的生命周期。
	- 强引用计数为0后，实际对象被delete。所以对于这种情况，应使用wp时要由弱生强。
- flags为LIFETIME_WEAK，强引用计数为0，弱引用计数不为0时，实际对象不会被delete。
	- 当弱引用计数减为0时，实际对象和weakref_impl对象会同时被delete。
- flags为LIFETIME_FOREVER，对象不受强弱引用计数的控制，用不会被回收。