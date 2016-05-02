---
layout: post
title:  "Jvm系列2—字节码指令"
date:   2015-10-24 22:09:12
catalog:  true
tags:
    - java
    - jvm

---

> 介绍java虚拟机的指令功能，至少能阅读java代码生成的字节码指令含义

# 一、概述

Java虚拟机采用基于栈的架构，其指令由操作码和操作数组成。  

- 操作码：一个字节长度(0~255)，意味着指令集的操作码个数不能操作256条。
- 操作数：一条指令可以有零或者多个操作数，且操作数可以是1个或者多个字节。编译后的代码没有采用操作数长度对齐方式，比如16位无符号整数需使用两个字节储存(假设为byte1和byte2)，那么真实值是 `(byte1 << 8) | byte2`。

放弃操作数对齐操作数对齐方案：

- 优势：可以省略很多填充和间隔符号，从而减少数据量，具有更高的传输效率；Java起初就是为了面向网络、智能家具而设计的，故更加注重传输效率。
- 劣势：运行时从字节码里构建出具体数据结构，需要花费部分CPU时间，从而导致解释执行字节码会损失部分性能。

## 二、指令

大多数指令包含了其操作所对应的数据类型信息，比如iload，表示从局部变量表中加载int型的数据到操作数栈；而fload表示加载float型数据到操作数栈。由于操作码长度只有1Byte，因此Java虚拟机的指令集对于特定操作只提供有限的类型相关指令，并非为每一种数据类型都有相应的操作指令。必要时，有些指令可用于将不支持的类型转换为可被支持的类型。

对于byte,short,char,boolean类型，往往没有单独的操作码，通过编译器在编译期或者运行期将其扩展。对于byte,short采用带符号扩展，chart,boolean采用零位扩展。相应的数组也是采用类似的扩展方式转换为int类型的字节码来处理。 下面分门别类来介绍Java虚拟机指令，都以int类型的数据操作为例。

栈是指操作数栈

### 2.1 栈操作相关

#### load和store

- load 命令：用于将局部变量表的指定位置的相应类型变量加载到栈顶；
- store命令：用于将栈顶的相应类型数据保入局部变量表的指定位置；

|变量进栈|含义|变量保存|含义
|---|---|
|iload|第1个int型变量进栈|istore|栈顶nt数值存入第1局部变量|
|iload_0|第1个int型变量进栈|istore_0|栈顶int数值存入第1局部变量|
|iload_1|第2个int型变量进栈|istore_1|栈顶int数值存入第2局部变量|
|iload_2|第3个int型变量进栈|istore_2|栈顶int数值存入第3局部变量|
|iload_3|第4个int型变量进栈|istore_3|栈顶int数值存入第4局部变量|
|||||
|lload|第1个long型变量进栈|lstore|栈顶long数值存入第1局部变量|
|fload|第1个float型变量进栈|fstore|栈顶float数值存入第1局部变量|
|dload|第1个double型变量进栈|dstore|栈顶double数值存入第1局部变量|
|aload|第1个ref型变量进栈|astore|栈顶ref对象存入第1局部变量|


#### const、push和ldc
- const、push：将相应类型的常量放入栈顶
- ldc:则是从常量池中将常量

|常量进栈|含义|
|---|---|
|aconst_null|null进栈|
|iconst_m1|int型常量-1进栈|
|iconst_0|int型常量0进栈|
|iconst_1|int型常量1进栈|
|iconst_2|int型常量2进栈|
|iconst_3|int型常量3进栈|
|iconst_4|int型常量4进栈|
|iconst_5|int型常量5进栈|
|||
|lconst_0|long型常量0进栈|
|fconst_0|float型常量0进栈|
|dconst_0|double型常量0进栈|
|||
|bipush|byte型常量进栈|
|sipush|short型常量进栈|


|常量池操作|含义|
|---|---|
|ldc|int、float或String型常量从常量池推送至栈顶|
|ldc_w|int、float或String型常量从常量池推送至栈顶（宽索引）|
|ldc2_w|long或double型常量从常量池推送至栈顶（宽索引）|

#### pop和dup

- pop用于栈顶数值出栈操作；
- dup用于赋值栈顶的指定个数的数值，并将其压入栈顶指定次数；

|栈顶操作|含义|
|---|---|
|pop|栈顶数值出栈(不能是long/double)|
|pop2|栈顶数值出栈(long/double型1个，其他2个)|
|||
|dup|复制栈顶数值，并压入栈顶|
|dup_x1|复制栈顶数值，并压入栈顶2次|
|dup_x2|复制栈顶数值，并压入栈顶3次|
|dup2|复制栈顶2个数值，并压入栈顶|
|dup2_x1|复制栈顶2个数值，并压入栈顶2次|
|dup2_x2|复制栈顶2个数值，并压入栈顶3次|
|||
|swap|栈顶的两个数值互换，且不能是long/double|

**注意：dup2**对于long、double类型的数据就是一个，对于其他类型的数据，才是真正的两个，这个的2代表的是2个slot的数据。


### 2.2 对象相关

#### 字段调用

|字段调用|含义|
|---|---|
|getstatic|获取类的静态字段，将其值压入栈顶|
|putstatic|给类的静态字段赋值|
|getfield|获取对象的字段，将其值压入栈顶|
|putfield|给对象的字段赋值|

#### 方法调用

|方法调用|作用|解释|
|---|---|---|
|invokevirtual|调用实例方法|虚方法分派
|invokestatic|调用类方法|static方法
|invokeinterface|调用接口方法|运行时搜索合适方法调用
|invokespecial|调用特殊实例方法|包括实例初始化方法、父类方法
|invokedynamic|由用户引导方法决定|运行时动态解析出调用点限定符所引用方法

#### 方法返回 

|方法返回|含义|
|---|---|
|ireturn|当前方法返回int|
|lreturn|当前方法返回long|
|freturn|当前方法返回float|
|dreturn|当前方法返回double|
|areturn|当前方法返回ref|

#### 对象和数组

- 创建类实例： new
- 创建数组：newarray、anewarray、multianewarray
- 数组元素 加载到 操作数栈：xaload (x可为b,c,s,i,l,f,d,a)
- 操作数栈的值 存储到数组元素： xastore (x可为b,c,s,i,l,f,d,a)
- 数组长度：arraylength
- 类实例类型：instanceof、checkcast

### 2.3 运算指令

运算指令是用于对操作数栈上的两个数值进行某种运算，并把结果重新存入到操作栈顶。Java虚拟机只支持整型和浮点型两类数据的运算指令，所有指令如下：

|运算|int|long|float|double|
|---|---|---|---|---|
|加法|iadd|ladd|fadd|dadd|
|减法|isub|lsub|fsub|dsub|
|乘法|imul|lmul|fmul|dmul|
|除法|idiv|ldiv|fdiv|ddiv|
|求余|irem|lrem|frem|drem|
|取反|ineg|lneg|fneg|dneg|
  
**其他运算：**

- 位移：ishl,ishr,iushr,lshl,lshr,lushr
- 按位或： ior,lor
- 按位与： iand, land
- 按位异或： ixor, lxor
- 自增：iin
- 比较：dcmpg,dcmpl,fcmpg,fcmpl,lcmp

### 2.4 类型转换

类型转换用于将两种不同类型的数值进行转换。


(1) 对于宽化类型转换(小范围向大范围转换)，无需显式的转换指令，并且是安全的操作。各种范围从小到大依次排序： int, long, float, double。

(2)对于窄化类型转换，必须显式地调用类型转换指令，并且该过程很可能导致精度丢失。转换规则中需要特别注意的是当浮点值为NaN, 则转换结果为int或long的0。虽然窄化运算可能会发生上/下限溢出和精度丢失等情况，但虚拟机规范明确规定窄化转换U不可能导致虚拟机抛出异常。

类型转换指令：`i2b, i2c,f2i`等等。


### 2.5 流程控制

控制指令是指有条件或无条件地修改PC寄存器的值，从而达到控制流程的目标

- 条件分支：ifeq、iflt、ifnull、ifnonnull等
- 复合分支：tableswitch、lookupswitch
- 无条件分支：goto、goto_w、jsr、jsr_w、ret

### 2.6 同步与异常

**异常：**

Java程序显式抛出异常： athrow指令。在Java虚拟机中，处理异常(catch语句)不是由字节码指令来实现，而是采用异常表来完成。

**同步：**

方法级的同步和方法内部分代码的同步，都是依靠管程(Monitor)来实现的。 

Java语言使用synchronized语句块，那么Java虚拟机的指令集中通过monitorenter和monitorexit两条指令来完成synchronized的功能。为了保证monitorenter和monitorexit指令一定能成对的调用（不管方法正常结束还是异常结束），编译器会自动生成一个异常处理器，该异常处理器的主要目的是用于执行monitorexit指令。


### 2.7 小结

在基于堆栈的的虚拟机中，指令的主战场便是操作数栈，除了load是从局部变量表加载数据到操作数栈以及store储存数据到局部变量表，其余指令基本都是用于操作数栈的。