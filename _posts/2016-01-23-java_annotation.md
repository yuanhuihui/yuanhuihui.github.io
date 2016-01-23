---
layout: post
title:  "Java注解(Annotation)"
date:   2016-01-23 15:20:40
categories: java
excerpt:  Java注解(Annotation)
---

* content
{:toc}


---


> 本文讲述Java Annotation的原理，如何自定义Java注解以及通过反射解析注解。

## 一、注解

### 1.1 概述

注解(Annotation)在JDK1.5之后增加的一个新特性，注解的引入意义很大，有很多非常有名的框架，比如Hibernate、Spring等框架中都大量使用注解。注解作为程序的元数据嵌入到程序。注解可以被解析工具或编译工具解析，此处注意注解不同于注释(comment)。


当一个接口直接继承java.lang.annotation.Annotation接口时，仍是接口，而并非注解。要想自定义注解类型，只能通过@interface关键字的方式，其实通过该方式会隐含地继承.Annotation接口。

### 1.2 API 摘要

所有与Annotation相关的API摘要如下：

  
(1). 注解类型(Annotation Types) API

|注解类型|含义|
|---|---|
|Documented|表示含有该注解类型的元素(带有注释的)会通过javadoc或类似工具进行文档化|
|Inherited|表示注解类型能被自动继承|
|Retention|表示注解类型的存活时长|
|Target|表示注解类型所适用的程序元素的种类|

(2). 枚举(Enum) API

|枚举|含义
|---|---|
|ElementType|程序元素类型，用于Target注解类型|
|RetentionPolicy|注解保留策略，用于Retention注解类型|

(3). 异常和错误 API

|异常/错误|含义|
|---|---|
|AnnotationTypeMismatchException|当注解经过编译(或序列化)后，注解类型改变的情况下，程序视图访问该注解所对应的元素，则抛出此异常
|IncompleteAnnotationException|当注解经过编译(或序列化)后，将其添加到注解类型定义的情况下，程序视图访问该注解所对应的元素，则抛出此异常。|
|AnnotationFormatError|当注解解析器试图从类文件中读取注解并确定注解出现异常时，抛出该错误|  


## 二、注解类型

前面讲到注解类型共4种，分别为Documented、Inherited、Retention、Target，接下来从jdk1.7的源码角度，来分别加以说明：

### 2.1 Documented

源码：

	@Documented
	@Retention(RetentionPolicy.RUNTIME)
	@Target(ElementType.ANNOTATION_TYPE)
	public @interface Documented {
	}


@Documented：表示拥有该注解的元素可通过javadoc此类的工具进行文档化。该类型应用于注解那些影响客户使用带注释(comment)的元素声明的类型。如果类型声明是用Documented来注解的，这种类型的注解被作为被标注的程序成员的公共API。

例如，上面源码@Retention的定义中有一行`@Documented`，意思是指当前注解的元素会被javadoc工具进行文档化，那么在查看Java API文档时可查看当该注解元素。

### 2.2 Inherited

源码：

	@Documented
	@Retention(RetentionPolicy.RUNTIME)
	@Target(ElementType.ANNOTATION_TYPE)
	public @interface Inherited {
	}

@Inherited：表示该注解类型被自动继承，如果用户在当前类中查询这个元注解类型并且当前类的声明中不包含这个元注解类型，那么也将自动查询当前类的父类是否存在Inherited元注解，这个动作将被重复执行知道这个标注类型被找到，或者是查询到顶层的父类。

### 2.3 Retention

源码：

	@Documented
	@Retention(RetentionPolicy.RUNTIME)
	@Target(ElementType.ANNOTATION_TYPE)
	public @interface Retention {
	    RetentionPolicy value();
	}

@Retention：表示该注解类型的注解保留的时长。当注解类型声明中没有@Retention元注解，则默认保留策略为RetentionPolicy.CLASS。关于保留策略(RetentionPolicy)是枚举类型，共定义3种保留策略，如下表：

|RetentionPolicy|含义|
|---|---|
|SOURCE|仅存在Java源文件，经过编译器后便丢弃相应的注解
|CLASS|存在Java源文件，以及经编译器后生成的Class字节码文件，但在运行时VM不再保留注释|
|RUNTIME|存在源文件、编译生成的Class字节码文件，以及保留在运行时VM中，可通过反射性地读取注解


例如，上面源码@Retention的定义中有一行`@Retention(RetentionPolicy.RUNTIME)`，意思是指当前注解的保留策略为RUNTIME，即存在Java源文件，也存在经过编译器编译后的生成的Class字节码文件，同时在运行时虚拟机(VM)中也保留该注解，可通过反射机制获取当前注解内容。

### 2.4 Target

源码：

	@Documented
	@Retention(RetentionPolicy.RUNTIME)
	@Target(ElementType.ANNOTATION_TYPE)
	public @interface Target {
	    ElementType[] value();
	}

@Target：表示该注解类型的所使用的程序元素类型。当注解类型声明中没有@Target元注解，则默认为可适用所有的程序元素。如果存在指定的@Target元注解，则编译器强制实施相应的使用限制。关于程序元素(ElementType)是枚举类型，共定义8种程序元素，如下表：

|ElementType|含义|
|---|---|
|ANNOTATION_TYPE|注解类型声明
|CONSTRUCTOR|构造方法声明
|FIELD|字段声明（包括枚举常量）
|LOCAL_VARIABLE |局部变量声明
|METHOD|方法声明
|PACKAGE|包声明
|PARAMETER|参数声明
|TYPE|类、接口（包括注解类型）或枚举声明

例如，上面源码@Target的定义中有一行`@Target(ElementType.ANNOTATION_TYPE)`，意思是指当前注解的元素类型是注解类型。

## 三、内建注解

Java提供了多种内建的注解，下面接下几个比较常用的注解：@Override、@Deprecated、@SuppressWarnings这3个注解。

### 3.1 @Override(覆写)

源码：

	@Target(ElementType.METHOD)
	@Retention(RetentionPolicy.SOURCE)
	public @interface Override {
	}

用途：用于告知编译器，我们需要覆写超类的当前方法。如果某个方法带有该注解但并没有覆写超类相应的方法，则编译器会生成一条错误信息。

注解类型分析：@Override可适用元素为方法，仅仅保留在java源文件中。

### 3.2 @Deprecated(不赞成使用)

源码：

	@Documented
	@Retention(RetentionPolicy.RUNTIME)
	@Target(value={CONSTRUCTOR, FIELD, LOCAL_VARIABLE, METHOD, PACKAGE, PARAMETER, TYPE})
	public @interface Deprecated {
	}

用途：用于告知编译器，某一程序元素(比如方法，成员变量)不建议使用时，应该使用这个注解。Java在javadoc中推荐使用该注解，一般应该提供为什么该方法不推荐使用以及相应替代方法。

注解类型分析： @Deprecated可适合用于除注解类型声明之外的所有元素，保留时长为运行时VM。

### 3.3 @SuppressWarnings(压制警告)

源码：

	@Target({TYPE, FIELD, METHOD, PARAMETER, CONSTRUCTOR, LOCAL_VARIABLE})
	@Retention(RetentionPolicy.SOURCE)
	public @interface SuppressWarnings {
	    String[] value();
	}

用于：用于告知编译器忽略特定的警告信息，例在泛型中使用原生数据类型。

注解类型分析： @SuppressWarnings可适合用于除注解类型声明和包名之外的所有元素，仅仅保留在java源文件中。

该注解有方法value(）,可支持多个字符串参数，例如：

	@SupressWarning(value={"uncheck","deprecation"}) 

前面讲的@Override，@Deprecated都是无需参数的，而压制警告是需要带有参数的，可用参数如下：

|参数|含义|
|---|---|
|deprecation|使用了过时的类或方法时的警告|
|unchecked|执行了未检查的转换时的警告|
|fallthrough|当Switch程序块进入进入下一个case而没有Break时的警告|
|path|在类路径、源文件路径等有不存在路径时的警告|
|serial|当可序列化的类缺少serialVersionUID定义时的警告|
|finally|任意finally子句不能正常完成时的警告|
|all|以上所有情况的警告|



### 3.4 对比

3种内建注解的对比：

|内建注解|Target|Retention|
|---|---|---|
|Override|METHOD|SOURCE
|SuppressWarnings|除ANNOTATION_TYPE和PACKAGE外的所有|SOURCE|
|Deprecated|除ANNOTATION_TYPE外的所有|RUNTIME

## 四、 实战

### 4.1 自定义注解

创建自定义注解，与创建接口有几分相似，但注解需要以@开头，下面先声明一个自定义注解（AuthorAnno.java）文件：

	package com.yuanhh.annotation;
	import java.lang.annotation.Documented;
	import java.lang.annotation.ElementType;
	import java.lang.annotation.Inherited;
	import java.lang.annotation.Retention;
	import java.lang.annotation.RetentionPolicy;
	import java.lang.annotation.Target;
	
	@Documented
	@Target(ElementType.METHOD)
	@Inherited
	@Retention(RetentionPolicy.RUNTIME)
	public @interface AuthorAnno{
	    String name();
	    String website() default "Yuanhh.com";
	    int revision() default 1;
	}

自定义注解规则：

1. 注解方法不带参数，比如`name()`，`website()`；
2. 注解方法返回值类型：基本类型、String、Enums、Annotation以及前面这些类型的数组类型
3. 注解方法可有默认值，比如`default "Yuanhh.com"`，默认website="Yuanhh.com"


有了前面的自定义注解@AuthorAnno，那么我们便可以在代码中使用(AnnotationDemo.java)，如下：

	package com.yuanhh.annotation;
	
	public class AnnotationDemo {
	    @AuthorAnno(name="yuanhh", website="yuanhh.com", revision=1)
	    public static void main(String[] args) {
	        System.out.println("I am main method");
	    }
	    
	    @SuppressWarnings({ "unchecked", "deprecation" })
	    @AuthorAnno(name="yuanhh", website="yuanhh.com", revision=2)
	    public void demo(){
	        System.out.println("I am demo method");
	    }
	}

由于该注解的保留策略为RetentionPolicy.RUNTIME，故可在运行期通过反射机制来使用，否则无法通过反射机制来获取。

### 4.2 注解解析

接下来，通过反射技术来解析自定义注解@AuthorAnno，关于反射类位于包java.lang.reflect，其中有一个接口`AnnotatedElement`，该接口定义了注释相关的几个核心方法，如下：

|返回值|方法|解释|
|---|---|---|
|<T extends Annotation> T|getAnnotation(Class<T> annotationClass)|当存在该元素的指定类型注解，则返回相应注释，否则返回null|
|Annotation[]|getAnnotations() |返回此元素上存在的所有注解|
|Annotation[]|getDeclaredAnnotations()| 返回直接存在于此元素上的所有注解。
|boolean|isAnnotationPresent(Class<? extends Annotation> annotationClass)|当存在该元素的指定类型注解，则返回true，否则返回false|


前面自定义的注解，适用对象为Method。类Method继承类AccessibleObject，而类AccessibleObject实现了AnnotatedElement接口，那么可以利用上面的反射方法，来实现解析@AuthorAnno的功能(AnnotationParser.java)，内容如下：

	package com.yuanhh.annotation;
	import java.lang.reflect.Method;
	
	public class AnnotationParser {
	    public static void main(String[] args) throws SecurityException, ClassNotFoundException {
	        String clazz = "com.yuanhh.annotation.AnnotationDemo";
	        Method[]  demoMethod = AnnotationParser.class
	                .getClassLoader().loadClass(clazz).getMethods();
	        
	        for (Method method : demoMethod) {
	            if (method.isAnnotationPresent(AuthorAnno.class)) {
	                 AuthorAnno authorInfo = method.getAnnotation(AuthorAnno.class);
	                 System.out.println("method: "+ method);
	                 System.out.println("name= "+ authorInfo.name() + 
	                         " , website= "+ authorInfo.website()
	                        + " , revision= "+authorInfo.revision());
	            }
	        }
	    }
	}

程序运行的输出结果：

	method: public void com.yuanhh.annotation.AnnotationDemo.demo()
	name= yuanhh , website= yuanhh.com , revision= 2
	method: public static void com.yuanhh.annotation.AnnotationDemo.main(java.lang.String[])
	name= yuanhh , website= yuanhh.com , revision= 1


这里通过反射将注解直接输出只是出于demo，完全可以根据拿到的注解信息做更多有意义的事。


----------

关于注解、反射的内容，可直接查看oracle提供的Java API： <http://docs.oracle.com/javase/7/docs/api/>