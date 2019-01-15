---
layout: post
title:  "理解Java反射机制"
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

对于正常方式来调用方法，往往只需要一行到两行代码，即可完成相应工作。而反射则显得比较繁琐，之所以繁琐仍会才用反射方式，是因为反射能干很多正常实例化对象的方式所无法做到的事。比如操作那些private的类、方法、属性，以及@hide标记过的类、方法、属性。

为了到达即能有反射的功效，同时调用方法简单易用，建议大家自己封装一个反射工具类ReflectUtils。（注：以下实例为了代码精简，忽略Exception以及异常处理逻辑。）

#### 3.1 创建对象

```Java
//根据类名来获取类
Class clazz = Class.forName("java.lang.String");
//根据对象来获取类
Class clazz = object.getClass();
//根据类来实例化对象
Object obj = clazz.newInstance();

//获取无参的构造函数
Constructor c = clazz.getConstructor(null);
//获取参数为String,int的构造函数
Constructor c = clazz.getConstructor(String.class, int.class);
//用于调用私有构造方法
c.setAccessible(true);
Object obj = c.newInstance("gityuan.com", 2015);
```

#### 3.2 获取/修改属性

1) 获取对象的属性:

```Java
public static Object getField(Object object, String fieldName) {
    Class clazz = object.getClass();
    Field field = clazz.getDeclaredField(fieldName);
    field.setAccessible(true);
    return field.get(object)；
}
```

2) 修改对象的属性:

```Java
public static boolean setField(Object object, String fieldName, Object fieldValue) {
    Class clazz = object.getClass();
    Field field = clazz.getDeclaredField(fieldName);
    field.setAccessible(true);
    return field.set(object, fieldValue);
}
```

3) 获取类的静态属性:

    public static Object getField(Class clazz, String fieldName) {
        Field field = clazz.getDeclaredField(fieldName);
        field.setAccessible(true);
        return field.get(null)；
    }
    
4) 修改类的静态属性:

    public static boolean setField(Class clazz, String fieldName, Object fieldValue) {
        Field field = clazz.getDeclaredField(fieldName);
        field.setAccessible(true);
        return field.set(null, fieldValue);
    }

#### 3.3 调用方法

1) 调用对象方法

```Java
public static Object invokeMethod(Object object, String methodName, Class[] argsType, Object... args) {
    Class clazz = object.getClass();
    Method method = clazz.getDeclaredMethod(methodName, argsType);
    return method.invoke(object, args);
}
```
    
2) 调用类的静态方法

```Java
public static Object invokeMethod(Class clazz, String methodName, Class[] argsType, Object... args) {
    Method method = clazz.getDeclaredMethod(methodName, argsType);
    method.setAccessible(true);  
    return method.invoke(null, args);
}
```

#### 3.4 调用内部类

假设com.reflect.Outer类，有一个内部类inner和静态内部类StaticInner。
那么静态内部类的构造函数为Outer$StaticInner(); 而普通内部类的构造函数为Outer$Inner(Outer outer)，多了一个final的Outer类型属性，即Outer$Inner.this$0，用于存储外部类的属性值，也就是说非static内部类保持了外部类的引用。

直接实例化内部类方法如下：

    // 静态内部类
    Outer.StaticInner sInner = new Outer.StaticInner();
    // 非静态内部类
    Outer.Inner inner = new Outer().new Inner();
    

内部类的类名使用采用$符号，来连接外部类与内部类，格式为outer$Inner

```Java
    String className = "com.reflect.Outer$Inner";
    Class.forName(className);
```

除了格式了差异，关于内部类的属性和方法操作基本相似，下面以调用该静态类的静态方法为例

```Java
public static Object invokeMethod(String methodName, Class[] argsType, Object... args) {
    Class clazz = Class.forName(“com.reflect.Outer$StaticInner");
    Method method = clazz.getDeclaredMethod(methodName, argsType);
    method.setAccessible(true);  
    return method.invoke(null, args);
}
```
    
### 四、小节

反射机制为解耦合提供了保障机制，也为在运行时动态修改属性和调用方法提供的可能性。在Android的源码中，我们会发现有很多被"@hide"标记的类，它的作用是使这个类或方法在生成SDK时不可见。那么应用程序便不可以直接调用。而反射机制可调用@hide标记的类或方法，如入无人之地，畅通无阻。不过从Android P开始就不允许调用@hide方法，会在虚拟机层面拦截直接抛出异常。
