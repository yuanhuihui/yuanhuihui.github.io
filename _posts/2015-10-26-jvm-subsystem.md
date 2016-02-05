---
layout: post
title:  "Jvm系列4—执行子系统"
date:   2015-10-26 19:16:10
categories: jvm java 
excerpt:  Jvm系列4—执行子系统
---

* content
{:toc}



---

> 字节码执行引擎

## 一、概述
执行引擎是Java虚拟机非常最核心的部分，对于物理即的执行引擎是直接建立在处理器、硬件、指令集合操作系统层面，而虚拟机执行引擎则是由自行定制的指令集与执行引擎的结构体系。执行引擎在执行Java会有解释执行(通过解释器)和编译执行(通过JIT生成的本地代码)两种选择，对于Android ART又多了一种提前编译器(AOT)。

接下来，主要讲解虚拟机的方法执行过程，对于Java虚拟机的解释器的执行模型（不考虑异常处理）：

	do {
	    atomically calculate pc and fetch opcode at pc;
	    if (operands) fetch operands;
	    execute the action for the opcode;
	} while (there is more to do);

##  对象创建
对象创建，不包括数组和Class对象，例如  
`Person person = new Person()`，

当虚拟机遇到new指令时：

- 在常量池中查找“Person”，看能否定位到Person类的符号引用；如果能，则继续执行。
- 再检查Person类是否已经加载、解析和初始化；如果没有初始化，则先执行类加载过程。
- 类加载后，虚拟机为新生成的person对象在堆上分配相应大小的内存。（对象大小在类加载后确定）
- 内存分配后，虚拟机将分配的内存空间都初始化为零值(不包括对象头)。实例变量不赋初值也能使用对应的零值。
- 设置对象头信息，比如对象的哈希值，gc分代年龄等。

从虚拟机角度，到此一个新的对象已经创建完成。但从Java视角，对象才刚刚开始，init构造方法还没有执行，所有字段还是零。执行完init方法，按java程序的构造方法进行初始化后，对象便是彻底创建完成。

【未完待续】