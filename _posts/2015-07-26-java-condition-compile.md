---
layout: post
title:  "Java中的条件编译"
date:   2015-7-26 22:09:12
catalog:  true
tags:
    - java
    - performance
---


> 在代码中添加大量log，对于CPU和内存的影响如何，会不会降低性能？相信有不少人对此有疑问，本文将详细解答该问题。

# 一、概述

**条件编译**是指源程序的代码行，可以在满足一定条件的情况下才进行编译，而未选中的源码，不会生成中间码或机器码，即部分内容参与编译。

**条件编译的好处：**对于不同硬件平台或者软件平台，或者不同功能模块的代码，编写到在同一个源文件，从而方便程序的维护和移植。

很多程序设计语言都提供条件编译的功能，比如C/++c采用预处理器指示符来达到条件编译。而Java语言并没有提供直接的预处理器，那么Java是不是就没有条件编译呢？先告诉大家，答案是Java存在条件编译，在这之前先说说C/C++的条件编译。

# 二、C/C++条件编译

对于C/C++，常见的预处理指令：

    #include 引入源代码文件
    #define 宏定义
    #undef 取消已存在的宏定义
    #if 如果条件为真，则编译后面的代码
    #ifdef 如果宏已定义，则编译后面的代码
    #ifndef 如果宏未定义，则编译后面的代码
    #elif 如果前面的#if条件为假，并且当前条件为真，则编译后面的代码
    #endif 结束前面的#if……#else条件编译语句块

条件编译常见形式：

(1) 当通过#define已定义过该 标识符，则程序编译阶段会选择编译代码段1，否则编译代码段2

    #ifdef 标识符
            代码段1
    #else
            代码段2
    #endif

(2) 当通过#define未定义过该 标识符，则程序编译阶段会选择编译代码段1，否则编译代码段2。功能正好与(1)相反

    #ifndef 标识符
            代码段1
    #else
            代码段2
    #endif

（3） 当 表达式为真，则程序编译阶段会选择编译代码段1，否则编译代码段2

    #if  表达式
            代码段1
    #else
            代码段2
    #endif

# 三、Java条件编译

Java语法的条件编译，是通过**判断条件为常量的if语句**实现的。其原理是Java语言的语法糖，根据if判断条件的真假，编译器直接把分支为false的代码块消除。通过该方式实现的条件编译，必须在方法体内实现，而无法在正整个Java类的结构或者类的属性上进行条件编译，这与C/C++的条件编译相比，确实更有局限性。在Java语言设计之初并没有引入条件编译的功能，虽有局限，但是总比没有更强。


**反编译分析技术：**

对于Debug.java文件，执行：

    javac Debug.java  //编译后 生成Debug.class文件
    javap -c Debug.class //通过javap，反编译class文件

接下来，展开几项对比分析：

## 3.1 final对比

该对比项是针对是否采用final变量与非final变量的对比:


源码：

    // 空方法
    public void voidMethod(){

    }

    //final常量
    private final boolean FINAL_FLAG_FALSE = false;
    public void constantFalseFlag(){
        if(FLAG_FALSE){
            System.out.println("debug log...");
        }
    }

    // 非final
    private boolean  falseFlag= false;
    public void falseFlag(){
        if(falseFlag){
            System.out.println("debug log...");
        }
    }

反编译解析后的结果如下：

```Java
// 空方法
public void voidMethod();
   Code:
      0: return

//final常量
public void constantFalseFlag();
   Code:
      0: return

// 非final
public void falseFlag();
   Code:
      0: aload_0
      1: getfield      #3     // Field falseFlag:Z
      4: ifeq          15
      7: getstatic     #5     // Field java/lang/System.out:Ljava/io/PrintStream;
     10: ldc           #6     // String debug log...
     12: invokevirtual #7     // Method java/io/PrintStream.println:(Ljava/lang/String;)V
     15: return
```

从反编译的`Code`字段，可以看出`constantFalseFlag()`方法体内的内容经过编译后，对于常量false分支，是不可达分支，则在编译成class字节码文件时剪出该分支，最终效果等价于`voidMethod()`。而对于`falseFlag()`方法，则多了5条指令。

可见，对于常量为false的if语句，由于恒为false，等同于条件编译的功能。

另外除了反编译的方式来对比分析，如果不了解反编译后的语法，还可以简单地对比编译后的.Class文件的大小，也会发现if(false){}内部的代码块会自动剪除。
