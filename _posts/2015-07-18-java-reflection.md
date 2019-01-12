---
layout: post
title:  "解读Java反射机制"
date:   2015-07-18 22:10:10
catalog:  true
tags:
    - java

---

> 对于Java使用者来说，反射机制可以说是不得不了解的重要技能之一

### 一、概述

JAVA反射机制，可在运行态直接操作任意类或对象的所有属性和方法，主要有以下几个功能：

- 在运行时获取任意对象所属的类
- 在运行时构造类的实例对象
- 在运行时获取或修改类/成员的属性
- 在运行时调用某个类/对象的方法
- 另外还可获取类的其他信息，比如描述修饰符、父类信息等

针对动态语言，大致认同的一个定义是：“程序运行时，允许改变程序结构或变量类型，这种语言称为动态语言”。反射机制在运行时只能调用methods或改变fields内容，却无法修改程序结构或变量类型。从这个观点看，Perl，Python，Ruby是动态语言，C++，Java，C#不是动态语言。

### 二、反射原理

用于操作反射相关的主要有以下5个类：

- java.lang.Class： 代表类
- java.lang.reflect.Constructor:  代表类的构造方法
- java.lang.reflect.Field:  代表类的属性
- java.lang.reflect.Method:  代表类的方法
- java.lang.reflect.Modifier：代表类、方法、属性的描述修饰符。

Constructor、Field、Method这三个类都继承AccessibleObject，该对象有一个非常重要的方法`setAccessible(boolean flag)`, 用于保证反射可调用非Public的属性与方法。Modifier是指描述修饰符，包含如下范围：
public, protected, private, abstract, static, final, transient, volatile, synchronized, native, strictfp, interface。

#### 2.1 Constructor
通过java.lang.reflect.Constructor来操作类的构造方法

|方法|含义|
|---|---|
|getConstructors()|获得类的所有public构造方法|
|getDeclaredConstructors()|获得类的所有构造方法|
|getConstructor(Class[] parameterTypes)|获得类的特定public构造方法|
|getDeclaredConstructor(Class[] params)|获取类的特定构造方法|

#### 2.2 Field
通过java.lang.reflect.Field来获取和修改成员属性，其中getField和getDeclaredField的核心区别就是是否指定类型为public

|方法|含义|
|---|---|
|getFields()|获得类的所有public属性|
|getDeclaredFields()|获得类的所有属性|
|getField(String name)|获得类的特定public属性|
|getDeclaredField(String name)|获取类的特定属性|

#### 2.3 Method
通过java.lang.reflect.Method来执行成员方法

|方法|含义|
|---|---|
|getMethods()|获得类的所有public成员方法|
|getDeclaredMethods()|获得类的所有成员方法|
|getMethod(String name, Class[] parameterTypes)|获得类的特定public成员方法|
|getDeclaredMethod(String name, Class[] parameterTypes)|获取类的特定成员方法|

#### 2.4 Class类的原理

Java所有的类都是继承于类Object，其内声明了多个应该被所有Java类覆写的方法：hashCode()、equals()、clone()、toString()、notify()、wait()、getClass(）等，其中getClass返回的便是一个Class类的对象。Class类也同样是继承Object类，拥有相应的方法。

Java程序在运行时，运行时系统对每一个对象都有一项类型标识，用于记录对象所属的类。虚拟机使用运行时类型来选择相应方法去执行，保存所有对象类型信息的类便是Class类。Class类没有公共构造方法，Class对象是在加载类时由 Java 虚拟机以及通过调用ClassLoader的defineClass 方法自动构造的，因此不能显式地声明一个Class对象。

虚拟机为每种类型管理一个独一无二的Class对象。也就是说，每个类型都有一个Class对象。运行程序时，Java虚拟机(JVM)首先检查是否所要加载的类对应的Class对象是否已经加载。如果没有加载，JVM就会根据类名查找.class文件，并将其Class对象载入。

基本的 Java 类型（boolean、byte、char、short、int、long、float 和 double）和关键字 void 也都对应一个 Class 对象。 每个数组属于被映射为 Class 对象的一个类，所有具有相同元素类型和维数的数组都共享该 Class 对象。一般某个类的Class对象被载入内存，它就用来创建这个类的所有对象。

### 三、反射实例


- 在运行时获取任意对象所属的类
    `Class<?> clazz = Class.forName(String className);`
- 在运行时构造类的实例对象
    `Object obj = clazz.newInstance();`
- 在运行时获取或修改类/成员的属性
    `field.set(Object obj, Object value)；`
    `field.get(Object obj)；`
- 在运行时调用某个类/对象的方法：`method.invoke(Object obj, Object... args)；`
- 另外还可获取类的其他信息，比如modifiers、superclass等


#### 取任意对象所属的类

Class<?> clazz = Class.forName(String className);//根据类名来获取类对象
Object obj = clazz.newInstance(); //构造

![class newinstance](/images/java-reflect/java_reflect_1.jpg)

#### 2.如何调用私有类，或者类的私有方法或属性？
- 私有类： 通过getDeclaredConstructor获取constructor，再调用constructor.setAccessible(true);
- 私有方法：通过getDeclaredMethod获取method，再调用method.setAccessible(true);
- 私有属性：通过getDeclaredField获取field，再调用field.setAccessible(true);


#### 3.@hide标记是做什么的，反射能否调用@hide标记的类？
在Android的源码中，我们会发现有很多被"@hide"标记的类，它的作用是使这个类或方法在生成SDK时不可见。那么应用程序便不可以直接调用。而反射机制可调用@hide标记的类或方法，如入无人之地，畅通无阻。

#### 4.如何通过反射调用内部类？
假设com.reflect.Outer类有一个内部类inner，调用方法如下：

    String className = "com.reflect.Outer$inner";
    Class.forName(className);
