---
layout: post
title:  "Java类加载器(ClassLoader)"
date:   2016-01-24 20:31:33
catalog:  true
tags:
    - java
    - jvm
    - classloader

---

> 本文主要讲述Java ClassLoader的工作原理，这为后面将Android App代码热替换或者插件化升级做铺垫

## 一、 类加载器

ClassLoader即常说的类加载器，其功能是用于从Class文件加载所需的类，主要场景用于热部署、代码热替换等场景。

系统提供3种的类加载器：Bootstrap ClassLoader、Extension ClassLoader、Application ClassLoader

### 1.1 Bootstrap ClassLoader


启动类加载器，一般由C++实现，是虚拟机的一部分。该类加载器主要职责是将JAVA_HOME路径下的\lib目录中能被虚拟机识别的类库(比如rt.jar)加载到虚拟机内存中。Java程序无法直接引用该类加载器

### 1.2 Extension ClassLoader

扩展类加载器，由Java实现，独立于虚拟机的外部。该类加载器主要职责将JAVA_HOME路径下的\lib\ext目录中的所有类库，开发者可直接使用扩展类加载器。 该加载器是由sun.misc.Launcher$ExtClassLoader实现。

### 1.3 Application ClassLoader

应用程序类加载器，该加载器是由sun.misc.Launcher$AppClassLoader实现，该类加载器负责加载用户类路径上所指定的类库。开发者可通过ClassLoader.getSystemClassLoader()方法直接获取，故又称为系统类加载器。当应用程序没有自定义类加载器时，默认采用该类加载器。

ClassLoader.java

    public static ClassLoader getSystemClassLoader() {
        initSystemClassLoader(); //初始化系统类加载器 【见下文】
        if (scl == null) {
            return null;
        }
        SecurityManager sm = System.getSecurityManager();
        if (sm != null) {
            ClassLoader ccl = getCallerClassLoader();
            if (ccl != null && ccl != scl && !scl.isAncestor(ccl)) {
                sm.checkPermission(SecurityConstants.GET_CLASSLOADER_PERMISSION);
            }
        }
        return scl;
    }

系统类加载器初始化：

    private static synchronized void initSystemClassLoader() {
        if (!sclSet) {
            if (scl != null)
                throw new IllegalStateException("recursive invocation");
            sun.misc.Launcher l = sun.misc.Launcher.getLauncher();
            if (l != null) {
                Throwable oops = null;
                scl = l.getClassLoader();
                try {
                    scl = AccessController.doPrivileged(
                        new SystemClassLoaderAction(scl));
                } catch (PrivilegedActionException pae) {
                    oops = pae.getCause();
                    if (oops instanceof InvocationTargetException) {
                        oops = oops.getCause();
                    }
                }
                if (oops != null) {
                    if (oops instanceof Error) {
                        throw (Error) oops;
                    } else {
                        throw new Error(oops);
                    }
                }
            }
            sclSet = true;
        }
    }

## 二、双亲委派模型

ClassLoader的双亲委派模型中，各个ClassLoader之间的关系是通过组合关系来复用父加载器。当一个ClassLoader收到来类加载的请求，首先把该请求委派该父类ClassLoader处理，当父类ClassLoader无法处理时，才由当前类ClassLoader来处理。对于每个ClassLoader这个方式，也就是父类的优先于子类处理类加载的请求，那么也就是说任何一个请求第一次处理的便是最顶层的Bootstrap ClassLoader(启动类加载器)。

类加载器的层级查找顺序依次为：启动类加载器，扩展类加载器，系统类加载器。系统类加载器是默认的应用程序类加载器。

![classloader](/images/jvm/classloader.png)

这样的好处是不同层次的类加载器具有不同优先级，比如所有Java对象的超级父类java.lang.Object，位于rt.jar，无论哪个类加载器加载该类，最终都是由启动类加载器进行加载，保证安全。即使用户自己编写一个java.lang.Object类并放入程序中，虽能正常编译，但不会被加载运行，保证不会出现混乱。那么有人会继续追问，如果自己再自定义一个类加载器来加载自己定义的java.lang.Object类呢? 这样做也是不会成功的，虚拟机将会抛出一异常。


    protected Class<?> loadClass(String name, boolean resolve)
        throws ClassNotFoundException
    {
        synchronized (getClassLoadingLock(name)) {
            //检查该类是否已经加载过
            Class c = findLoadedClass(name);
            if (c == null) {
                //如果该类没有加载，则进入该分支
                long t0 = System.nanoTime();
                try {
                    if (parent != null) {
                        //当父类的加载器不为空，则通过父类的loadClass来加载该类
                        c = parent.loadClass(name, false);
                    } else {
                        //当父类的加载器为空，则调用启动类加载器来加载该类
                        c = findBootstrapClassOrNull(name);
                    }
                } catch (ClassNotFoundException e) {
                    //非空父类的类加载器无法找到相应的类，则抛出异常
                }

                if (c == null) {
                    //当父类加载器无法加载时，则调用findClass方法来加载该类
                    long t1 = System.nanoTime();
                    c = findClass(name); //用户可通过覆写该方法，来自定义类加载器

                    //用于统计类加载器相关的信息
                    sun.misc.PerfCounter.getParentDelegationTime().addTime(t1 - t0);
                    sun.misc.PerfCounter.getFindClassTime().addElapsedTimeFrom(t1);
                    sun.misc.PerfCounter.getFindClasses().increment();
                }
            }
            if (resolve) {
                //对类进行link操作
                resolveClass(c);
            }
            return c;
        }
    }

当开发者需要自定义类加载器时，可通过覆写loadClass()方法或者findClass()。

## 三、自定义类加载器

每一个ClassLoader都拥有自己独立的类名称空间，类是由ClassLoader将其加载到Java虚拟机中，故类是由加载它的ClassLoader和该类本身一起确定其在Java 运行时环境的唯一性。故只有同一个ClassLoader加载的同一个类，才能算是Java 运行时环境中的相同的两个类。哪怕是来自同一个Class文件，即使被同一个虚拟机加载的两个类，只要ClassLoader不同，那么也属于不同的类。对于equals()、isinstanceof()等方法来判断对象的相等或所属关系都是需要基于同一个ClassLoader。

自定义类加载器示例：

	package com.yuanhh.classloader;
	
	import java.io.IOException;
	import java.io.InputStream;
	
	public class ClassLoadDemo{
	
	    public static void main(String[] args) throws Exception {
	        
	        ClassLoader clazzLoader = new ClassLoader() {
	            @Override
	            public Class<?> loadClass(String name) throws ClassNotFoundException {
	                try {
	                    String clazzName = name.substring(name.lastIndexOf(".") + 1) + ".class";
	                    
	                    InputStream is = getClass().getResourceAsStream(clazzName);
	                    if (is == null) {
	                        return super.loadClass(name);
	                    }
	                    byte[] b = new byte[is.available()];
	                    is.read(b);
	                    return defineClass(name, b, 0, b.length);
	                } catch (IOException e) {
	                    throw new ClassNotFoundException(name);
	                }
	            }
	        };
	        
	        String currentClass = "com.yuanhh.classloader.ClassLoadDemo";
	        Class<?> clazz = clazzLoader.loadClass(currentClass);
	        Object obj = clazz.newInstance();
	        
	        System.out.println(obj.getClass());
	        System.out.println(obj instanceof com.yuanhh.classloader.ClassLoadDemo);
	    }
	}

上面代码的输出结果：

	class com.yuanhh.classloader.ClassLoadDemo
	false

输出结果的第一行，可以看出这个对象的确是`com.yuanhh.classloader.ClassLoadDemo`实例化的对象；但第二句是false，这是由于代码中的obj是由用户自定义的类加载器clazzLoader来加载的，可通过obj.getClass().getClassLoader()获取该对象的类加载器为com.yuanhh.classloader.ClassLoadDemo$xxx，而虚拟机本身会由系统类加载器加载的类ClassLoadDemo，可通过ClassLoadDemo.class.getClassLoader()得其类加载器为sun.misc.Launcher$AppClassLoader@XXX。所以可得出结论：即使都是来自同一个Class文件，加载器不同，仍然是两个不同的类，所以返回值是false。

通过`Class.forName()`方法加载的类，采用的是系统类加载器。

## 四、 经典应用场景

- Tomcat，类加载器架构，自己定义了多个类加载器，
	- 保证了同一个服务器的两个Web应用程序的Java类库隔离；
	- 保证了同一个服务器的两个Web应用程序的Java类库又可以相互共享；比如多个Spring组织的应用程序不能共享，会造成资源浪费；
	- 保证了服务器尽可能保证自身的安全不受不受部署Web应用程序影响；
	- 支持JSP应用的服务器，大多需要支持热替换(HotSwap)功能。

- OSGi(Open Service GateWay Initiative)，是基于Java语言的动态模块化规范。已成为Java世界的“事实上”的模块化标准，最为熟悉的案例的Eclipse IDE。