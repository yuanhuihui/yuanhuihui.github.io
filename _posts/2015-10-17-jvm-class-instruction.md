---
layout: post
title:  "Jvm系列1—Class文件格式"
date:   2015-10-17 10:16:10
catalog:  true
tags:
    - java
    - jvm
    
---

> Java编译过程是将Java文件转换为Claaa文件，从而实现了跨平台的功能， 本文详细讲述Class文件结构。

# 一、 概述
计算机只能识别0和1，所以大家编写的程序都需要经过编译器，转换为由0和1组成的二进制本地机器码(Native Code)。随着虚拟机的不断发展，很多程序语言开始选择与操作系统和机器指令集无关的格式作为编译后的存储格式（Class文件），从而实现"Write Once, Run Anywhere"。  
Java设计之初，考虑后期能让Java虚拟机运行其他语言，目前有越来越多的其他语言都可以直接需要在Java虚拟机，虚拟机只能识别Class文件，至于是由何种语言编译而来的，虚拟机并不关心，如下图：

![Jvm_class_loading_1](/images/jvm/Jvm_class_loading_1.png)

可以看出不管是由Java语言，还是JRuby等其他语言，只能能生成.class字节码文件，就都可以运行在Java虚拟机上。故发布规范文档时，Java规范拆分为Java语言规范和Java虚拟机规范。  

Java语法中定义各种变量、关键字、运算符的语义最终由多个字节码命令组合而成。因此字节码命令所能提供的语义描述能力必然要比Java语言本身更加强大。


# 二、Class组成
 Class文件是一组以8位字节为单位的二进制流，中间没有任何分隔符，非常紧凑。 当需要占用8位以上的数据时，会按照Big-endian顺序，高位在前，低位在后的方式来分割成多个8位字节来存储。  

- 任何一个Class文件都对应着唯一的类或接口的定义信息；
- 类或接口并不一定定义在文件里，也可以通过类加载器直接生成。

Java虚拟机规范规定：Class文件格式采用伪结构来存储数据，伪结构中只有无符号数和表这两种数据类型。

- 无符号数：是基本数据类型，以u1、u2、u4、u8分别代表1个字节、2个字节、4个字节、8个字节的无符号数。无符号数用于描述数字、索引引用、数量值、字符串值。
- 表：是由多个无符号数或者子表作为数据项构成的符合数据类型。用于描述有层次关系的复合结构的数据。整个Class其实就是一张表。

## 2.1 相关概念

下面介绍几个概述：

#### 全限定名
是指把类全名中的“.”号，用“/”号替换，并且在最后加入一个“；”分号后生成的名称。比如`java.lang.Object`对应的全限定名为`java/lang/Object;` 。

#### 简单名 
这个比较好理解，就是直接的方法名或者字段。比如`toString()`方法，不需要包名作为前缀了。

#### 字段描述符  
用于描述字段的数据类型。  

规则如下：

| 基本类型字符   | 对应类型        |
| --------   | :-----  | 
|B|	byte|
|C|	char|
|D|	double|
|F|	float|
|I|	int|
|S|	short|
|J|	long
|Z|	boolean|
|V|void|
|L+classname +;| 对象类型|
|[|	数组类型|

例如：
 
- 基本类型：int    ==>  I
- 对象类型：String ==>  Ljava/lang/String;
- 数组类型：long[] ==>  [J

#### 方法描述符 
用来描述方法的参数列表(数量、类型以及顺序)和返回值。 

格式：(参数描述符列表)返回值描述符。  
例如：`Object m(int i, double d, Thread t) {..}`  ==>  `IDLjava/lang/Thread;)Ljava/lang/Object;`

## 2.2 ClassFile结构
一个Class类文件是由一个ClassFile结构组成：

	ClassFile {
	    u4             magic;               //魔数，固定值0xCAFEBABE
	    u2             minor_version;       //次版本号
	    u2             major_version;       //主版本号
	    u2             constant_pool_count; //常量的个数
	    cp_info        constant_pool[constant_pool_count-1];  //具体的常量池内容
	    u2             access_flags;        //访问标识
	    u2             this_class;          //当前类索引
	    u2             super_class;         //父类索引
	    u2             interfaces_count;    //接口的个数
	    u2             interfaces[interfaces_count];          //具体的接口内容
	    u2             fields_count;        //字段的个数
	    field_info     fields[fields_count];                  //具体的字段内容
	    u2             methods_count;       //方法的个数
	    method_info    methods[methods_count];                //具体的方法内容
	    u2             attributes_count;    //属性的个数
	    attribute_info attributes[attributes_count];          //具体的属性内容
	}

一个Class文件的大小：26 + cp_info[] + u2[] + field_info[] + method_info[] + attribute_info[]

接下来，将具体来介绍ClassFile文件的各个组成部分。

# 三、ClassFile文件组成

### 3.1 魔数 
每个Class文件头4个字节称为魔数(Magic Number),作用是用于确定这个Class文件是否能被虚拟机所接受，魔数固定值0xCAFEBABE。这是身份识别，比如jpeg等图片文件头也会有魔数。

### 3.2 版本号 
紧跟魔数，也占用4个字节。从第5字节到第8字节存储的分别是 次版本号，主版本号。

### 3.3 常量池  
常量池是Class文件空间最大的数据项之一，长度不固定。

a. 常量池长度  
用u2类型代表常量池容量计数值，u2紧跟版本号。u2的大小等于常量池的常量个数+1。对于u2=0的特殊情况，代表没有使用常量池。

b. 常量池内容,格式如下：

	cp_info {
	    u1 tag;
	    u1 info[];
	}

包括两个类常量，字面量和符号引用：

- 字面量：与Java语言层面的常量概念相近，包含文本字符串、声明为final的常量值等。
- 符号引用：编译语言层面的概念，包括以下3类：
	- 类和接口的全限定名
	- 字段的名称和描述符
	- 方法的名称和描述符

常量池中每一项常量都是一个表结构，每个表的开始第一位是u1类型的标志位tag, 代表当前这个常量的类型。在JDK 1.7.中共有14种不同的表结构的类型，如下：

![constant_type](/images/jvm/constant_type.png)

Class文件都是二进制格式，可通过`Jdk/bin/javap.exe`工具，分析Class文件字节码。关于javap用法，可通过`javap --help`来查看。

### 3.4 访问标识 
2个字节代表，标示用于识别一些类或者接口层次的访问信息.

| 标识名   |  标识值        | 解释|
| --------   | :-----  |  ----|
|ACC_PUBLIC|	0x0001|	声明为public;可以从包外部访问|
|ACC_FINAL|	0x0010|	被声明为final;不允许子类修改|
|ACC_SUPER|	0x0020|	当被invokespecial指令调用时，将特殊对待父类的方法|
|ACC_INTERFACE|	0x0200|	接口标识符|
|ACC_ABSTRACT|	0x0400|	声明为abstract;不能被实例化|
|ACC_SYNTHETIC|	0x1000|	声明为synthetic;不存在于源代码，由编译器生成|
|ACC_ANNOTATION|	0x2000|声明为注释类型|
|ACC_ENUM|	0x4000|	声明为枚举类型|

### 3.5 类/父类索引

当前类索引和父类索引占用大小都为u2类型，由于一个类智能继承一个父类，故父类索引只有一个。除了java.lang.Object对象的父类索引为0，其他所有类都有父类。

### 3.6 接口索引

一个类可以实现多个接口，故利用interfaces_count来记录该类所实现的接口个数，interfaces[interfaces_count]来记录所有实现的接口内容。

### 3.7 字段表

字段表用于描述类或接口中声明的变量，格式如下：

	field_info {
	    u2             access_flags; //访问标识
	    u2             name_index;  //名称索引
	    u2             descriptor_index; //描述符索引
	    u2             attributes_count; //属性个数
	    attribute_info attributes[attributes_count];  //属性表的具体内容
	}

字段访问标识如下：(表中加粗项是字段独有的)

| 标识名   |  标识值        | 解释|
| --------   | :-----  |  ----|
|ACC_PUBLIC|	0x0001|	声明为 public; 可以从包外部访问|
|ACC_PRIVATE|	0x0002|	声明为 private; 只有定义的类可以访问|
|ACC_PROTECTED|	0x0004|	声明为 protected;只有子类和相同package的类可访问|
|ACC_STATIC|	0x0008|	声明为 static；属于类变量|
|ACC_FINAL|	0x0010|	声明为 final; 对象构造后无法直接修改值|
|**ACC_VOLATILE**|	0x0040|	声明为 volatile; 不会被缓存,直接刷新到主屏幕|
|**ACC_TRANSIENT**|	0x0080|	声明为 transient; 不能被序列化|
|ACC_SYNTHETIC|	0x1000|	声明为 synthetic; 不存在于源代码，由编译器生成|
|ACC_ENUM|	0x4000|	声明为enum|

Java语法中，接口中的字段默认包含ACC_PUBLIC, ACC_STATIC, ACC_FINAL标识。ACC_FINAL，ACC_VOLATILE不能同时选择等规则。

紧跟其后的name_index和descriptor_index是对常量池的引用，分别代表着字段的简单名和方法的描述符。

### 3.8 方法表

方法表用于描述类或接口中声明的方法，格式如下：

	method_info {
	    u2             access_flags; //访问标识
	    u2             name_index;  //名称索引
	    u2             descriptor_index;  //描述符索引
	    u2             attributes_count;  //属性个数
	    attribute_info attributes[attributes_count]; //属性表的具体内容
	}

方法访问标识如下：(表中加粗项是方法独有的)

| 标识名   |  标识值        | 解释|
| --------   | :-----  |  ----|
|ACC_PUBLIC|	0x0001|	声明为 public; 可以从包外部访问|
|ACC_PRIVATE|	0x0002|	声明为 private; 只有定义的类可以访问|
|ACC_PROTECTED|	0x0004|	声明为 protected;只有子类和相同package的类可访问|
|ACC_STATIC|	0x0008|	声明为 static；属于类变量|
|ACC_FINAL|	0x0010|	声明为 final; 不能被覆写|
|**ACC_SYNCHRONIZED**|	0x0020|	声明为 synchronized; 同步锁包裹|
|ACC_BRIDGE|	0x0040|	桥接方法, 由编译器生成|
|**ACC_VARARGS**|	0x0080|	声明为 接收不定长参数|
|**ACC_NATIVE**|	0x0100|	声明为 native; 由非Java语言来实现|
|**ACC_ABSTRACT**|	0x0400|	声明为 abstract; 没有提供实现|
|**ACC_STRICT**|	0x0800|	声明为 strictfp; 浮点模式是FP-strict|
|ACC_SYNTHETIC|	0x1000|	声明为 synthetic; 不存在于源代码，由编译器生成|

- 对于方法里的Java代码，进过编译器编译成字节码指令后，存放在方法属性表集合中“code”的属性内。  
- 当子类没有覆写父类方法，则方法集合中不会出现父类的方法信息。
- Java语言中重载方法，必须与原方法同名，且特征签名不同。特征签名是指方法中各个参数在常量池的字段符号引用的集合，不包括返回值。当时Class文件格式中，特征签名范围更广，允许方法名和特征签名都相同，但返回值不同的方法，合法地共存子啊同一个Class文件中。


### 3.9 属性表

属性表格式：

	attribute_info {
	    u2 attribute_name_index;   //属性名索引
	    u4 attribute_length;       //属性长度
	    u1 info[attribute_length]; //属性的具体内容
	}

属性表的限制相对宽松，不需要各个属性表有严格的顺序，只有不与已有的属性名重复，任何自定义的编译器都可以向属性表中写入自定义的属性信息，Java虚拟机运行时会忽略掉无法识别的属性。  
关于虚拟机规范中预定义的属性，这里不展开讲了，列举几个常用的。

| 属性名   |  使用位置        | 解释|
| --------   | :-----  |  ----|
|Code|	方法表| 方法体的内容|
|ConstantValue|	字段表|	final关键字定义的常量值|
|Deprecated|	类、方法表、字段表|声明为deprecated|
|InnerClasses| 类文件|内部类的列表|
|LineNumberTable| Code属性| Java源码的行号与字节码指令的对应关系|
|LocalVariableTable|Code属性|方法的局部变量描述|
|Signature|类、方法表、字段表|用于支持泛型的方法签名，由于Java的泛型采用擦除法，避免类型信息被擦除后导致签名混乱，Signature记录相关信息|


**Code属性**  
java程序方法体中的代码，经编译后得到的字节码指令存储在Code属性内，Code属性位于方法表的属性集合中。但与native或者abstract的方法则不会存在Code属性中。

Code属性的格式如下：

	Code_attribute {
	    u2 attribute_name_index; //常量池中的uft8类型的索引，值固定为”Code“
	    u4 attribute_length; //属性值长度，为整个属性表长度-6
	    u2 max_stack;   //操作数栈的最大深度值，jvm运行时根据该值佩服栈帧
	    u2 max_locals;  //局部变量表最大存储空间，单位是slot
	    u4 code_length; // 字节码指令的个数
	    u1 code[code_length]; // 具体的字节码指令
	    u2 exception_table_length; //异常的个数
	    {   u2 start_pc; 
	        u2 end_pc;
	        u2 handler_pc; //当字节码在[start_pc, end_pc)区间出现catch_type或子类，则转到handler_pc行继续处理。
	        u2 catch_type; //当catch_type=0，则任意异常都需转到handler_pc处理
	    } exception_table[exception_table_length]; //具体的异常内容
	    u2 attributes_count;     //属性的个数
	    attribute_info attributes[attributes_count]; //具体的属性内容
	}

- slot是虚拟机未局部变量分配内存使用的最小单位。对于byte/char/float/int/short/boolean/returnAddress等长度不超过32位的局部变量，每个占用1个Slot；对于long和double这两种64位的数据类型则需要2个Slot来存放。
- 实例方法中有隐藏参数this, 显式异常处理器的参数，方法体定义的局部变量都使用局部变量表来存放。
- max_locals，不是所有局部变量所占Slot之和，因为Slot可以重用，javac编译器会根据变量的作用域来分配Slot给各个变量使用，从而计算出max_locals大小。
- 虚拟机规范限制严格方法不允许超过65535个字节码，否则拒绝编译。

Code属性是Class文件中最重要的属性，Java程序的幸福课分为代码(方法体中的Java代码)和元数据(包含类、接口、字段、方法定义以及其他信息)两部分。


**ConstantValue属性**  
ConstantValue属性是指被static关键字修饰的变量（也称为类变量）。

- 类变量:  在类构造器<clinit>方法或者使用ConstantValue属性来赋值
- 实例变量：在实例构造器<init>方法进行赋值



----------

参考资料

1. <https://docs.oracle.com/javase/specs/jvms/se7/html/>
2. Java语言规范《The Java Language Specification》
3. Java虚拟机规范《The Java Virtual Machine Specification》
4. 《深入理解Java虚拟机》
