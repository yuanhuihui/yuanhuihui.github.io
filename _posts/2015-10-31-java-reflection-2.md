---
layout: post
title:  "Java反射之实用篇"
date:   2015-10-31 22:10:10
categories: Java
excerpt:  Java 反射
---

* content
{:toc}



---
关于Java反射，文章[Java反射之基础篇]((http://www.yuanhh.com/2015/10/30/java-reflection/))已基本介绍了反射的用法，但是反射的整个调用过程仍比较繁琐，尤其是对于新手，显得比较晦涩。下面介绍些更为简单有效的反射实用内容。

## 一、反射用法
前面介绍到，反射是为了在运行态能操作类和对象，接下来重点介绍如何反射使用。
  
对于正常方式来调用方法，往往只需要一行到两行代码，即可完成相应工作。而反射则显得比较繁琐，之所以繁琐仍会才用反射方式，是因为反射能干很多正常实例化对象的方式所无法做到的事。比如操作那些private的类、方法、属性，以及@hide标记过的类、方法、属性。  
  
为了到达即能有反射的功效，同时调用方法简单易用，写了一个`ReflectUtils`类。对于方法调用，与正常对象的调用过程差不多。主要由以下4类需要用到反射的地方：

1. 调用类的静态方法
2. 调用类的非静态方法
3. set/get类的静态属性
4. set/get类的非静态属性 

### 1.1 `ReflectUtils`类用法
调用流程一般为先获取类或对象，再调用相应方法。针对上述4种需求，用法分别如下：

**1. 调用类的静态方法**  
对于参数方法，只需把参数，紧跟方法名后面，可以跟不定长的参数个数。

		Class<?> clazz = ReflectUtils.getClazz("com.yuanhh.model.Outer"); //获取class
		ReflectUtils.invokeStaticMethod(clazz, "outerStaticMethod");  //无参方法
		ReflectUtils.invokeStaticMethod(clazz, "outerStaticMethod","yuanhh"); //有参数方法

**2. 调用类的非静态方法**  
  
		Object obj = ReflectUtils.newInstance("com.yuanhh.model.Outer");  //实例化对象
		ReflectUtils.invokeMethod(obj, "outerMethod");  //无参方法
		ReflectUtils.invokeMethod(obj, "outerMethod", "yuanhh"); //有参方法
**3. set/get类的静态属性**  
  
		ReflectUtils.getStaticField(clazz, "outerStaticField"); //get操作
		ReflectUtils.setStaticField(clazz, "outerStaticField", "new value"); //set操作

**4. set/get类的非静态属性**   

		ReflectUtils.getField(obj, "outerField");  //get操作
		ReflectUtils.setField(obj, "outerField", "new value"); //set操作


如果只知道类名，需先查看该类的所有方法详细参数信息，可以通过调用**`dumpClass(String className)`**
，返回值是String,记录着所有构造函数，成员方法，属性值的信息。

### 1.2 核心代码

关于`ReflectUtils`类，列表部分核心方法。

先定义一个`Outer`类, 包名假设为`com.yuanhh.model`，对于该类，非public，构造方法，成员方法，属性都是private：  
  
	class Outer {
	    private String outerField = "outer Field";
	    private static String outerStaticField = "outer static Field";
	    
	    private Outer(){
	        System.out.println("I'am outer construction without args");
	    }
	    
	    private Outer(String outerField){
	        this.outerField = outerField;
	        System.out.println("I'am outer construction with args "+ this.outerField);
	    }
	    
	    private void outerMethod(){
	        System.out.println("I'am outer method");
	    }
	    
	    private void outerMethod(String param){
	        System.out.println("I'am outer method with param "+param);
	    }
	    
	    private static void outerStaticMethod(){
	        System.out.println("I'am outer static method");
	    }
	     
		private static void outerStaticMethod(String param){
	        System.out.println("I'am outer static method with param "+param);
	    }
	}


构造函数，获取类的实例化对象：

    /**
     * 实例化获取类名对应的类
     *
     * @param clazz           类
     * @param constructorArgs 构造函数的各个参数
     * @return 实例化对象
     */
    public static Object newInstance(Class clazz, Object... constructorArgs) {
        if (clazz == null) {
            return null;
        }

        Object object = null;

        int argLen = constructorArgs == null ? 0 : constructorArgs.length;
        Class<?>[] parameterTypes = new Class[argLen];
        for (int i = 0; i < argLen; i++) {
            parameterTypes[i] = constructorArgs[i].getClass();
        }

        try {
            Constructor constructor = clazz.getDeclaredConstructor(parameterTypes);
            if (!constructor.isAccessible()) {
                constructor.setAccessible(true);
            }
            object = constructor.newInstance(constructorArgs);

        } catch (Exception e) {
            e.printStackTrace();
        }

        return object;
    }

对象方法的反射调用如下：

	/**
     * 反射调用方法
     *
     * @param object     反射调用的对象实例
     * @param methodName 反射调用的对象方法名
     * @param methodArgs 反射调用的对象方法的参数列表
     * @return 反射调用执行的结果
     */
    public static Object invokeMethod(Object object, String methodName,
                                      Object... methodArgs) {
        if (object == null) {
            return null;
        }

        Object result = null;
        Class<?> clazz = object.getClass();
        try {
            Method method = clazz.getDeclaredMethod(methodName, obj2class(methodArgs));
            if (method != null) {
                if (!method.isAccessible()) {
                    method.setAccessible(true);  //当私有方法时，设置可访问
                }
                result = method.invoke(object, methodArgs);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }

        return result;

    }

对象属性值的反射获取方法：

	/**
     * 反射调用，获取属性值
     *
     * @param object    操作对象
     * @param fieldName 对象属性
     * @return 属性值
     */
    public static Object getField(Object object, String fieldName) {
        if (object == null) {
            return null;
        }

        Object result = null;
        Class<?> clazz = object.getClass();
        try {
            Field field = clazz.getDeclaredField(fieldName);
            if (field != null) {
                if (!field.isAccessible()) {
                    field.setAccessible(true);
                }
                result = field.get(object);
            }
        } catch (Exception e) {
            e.printStackTrace();
        }
        return result;
    }

类属性的反射设置过程：

	/**
     * 反射调用，设置属性值
     *
     * @param clazz    操作类
     * @param fieldName 属性名
     * @param value     属性的新值
     * @return 设置是否成功
     */
    public static boolean setStaticField(Class clazz, String fieldName, Object value) {
        if (clazz == null) {
            return false;
        }

        Object result = null;
        try {
            Field field = clazz.getDeclaredField(fieldName);
            if (field != null) {
                if (!field.isAccessible()) {
                    field.setAccessible(true);
                }
                field.set(null, value);
            }
        } catch (Exception e) {
            e.printStackTrace();
            return false;
        }
        return true;
    }

## 二、内部类的反射用法
对于内部类，这里比较复杂，而内部类又分static内部类与非static内部类，两者的反射方式还是有区别的，刚开始在这边折腾了好一阵子，一直反射失败。static内部类与非static内部类的反射调用，根本区别在于构造方法不一样。下面通过代码来告诉如何正确。  
  
### 2.1 static与非static内部类的反射差异
先定义一个包含两个内部类的类：  

	class Outer {
	    /**
	     *  普通内部类
	     */
	    class Inner {
	        private String innerField = "inner Field";
	        
	        private Inner(){
	            System.out.println("I'am Inner construction without args");
	        }
	        
	        private Inner(String innerField){
	            this.innerField = innerField;
	            System.out.println("I'am Inner construction with args "+ this.innerField);
	        }
	        
	        private void innerMethod(){
	            System.out.println("I'am inner method");
	        }
	    }
	    
	    /**
	     * 静态内部类
	     */
	    static class StaticInner {
	        
	        private String innerField = "StaticInner Field";
	        private static String innerStaticField = "StaticInner static Field";
	        
	        private StaticInner(){
	            System.out.println("I'am StaticInner construction without args");
	        }
	        
	        private StaticInner(String innerField){
	            this.innerField = innerField;
	            System.out.println("I'am StaticInner construction with args "+ this.innerField);
	        }
	        
	        private void innerMethod(){
	            System.out.println("I'am StaticInner method");
	        }
	        
	        private static void innerStaticMethod(){
	            System.out.println("I'am StaticInner static method");
	        }
	    }
	}

对于上面两个内部类，如果直接实例化内部类，该怎么做，抛开private等权限不够的问题，应该是这样的：  

- 静态内部类：`Outer.StaticInner  sInner = new Outer.StaticInner();`
- 非静态内部类： `Outer.Inner inner = new Outer().new Inner();`

这种差异，在于内部类的构造方法不一样。我们可以通过下面的方法`dumpClass()`来比较。

	/**
     * 获取类的所有 构造函数，属性，方法
     *
     * @param className 类名
     * @return
     */
    public static String dumpClass(String className) {
        StringBuffer sb = new StringBuffer();
        Class<?> clazz;
        try {
            clazz = Class.forName(className);
        } catch (ClassNotFoundException e) {
            e.printStackTrace();
            return "";
        }

        Constructor<?>[] cs = clazz.getDeclaredConstructors();
        sb.append("------  Constructor  ------>  ").append("\n");
        for (Constructor<?> c : cs) {
            sb.append(c.toString()).append("\n");
        }

        sb.append("------  Field  ------>").append("\n");
        Field[] fs = clazz.getDeclaredFields();
        for (Field f : fs) {
            sb.append(f.toString()).append("\n");
            ;
        }
        sb.append("------  Method  ------>").append("\n");
        Method[] ms = clazz.getDeclaredMethods();
        for (Method m : ms) {
            sb.append(m.toString()).append("\n");
        }
        return sb.toString();
    }

通过`dumpClass()`,对比我们会发现，

- static内部类的默认构造函数：
`private void com.yuanhh.model.Outer$StaticInner.innerMethod()`    
- 非static内部类的默认构造函数：
`private com.yuanhh.model.Outer$Inner(com.yuanhh.model.Outer)`,多了一个参数`com.yuanhh.model.Outer`,也就是说非static内部类保持了外部类的引用。从属性，我们也会发现多了一个final属性`final com.yuanhh.model.Outer com.yuanhh.model.Outer$Inner.this$0`，这正是用于存储外部类的属性值。  
  
正是这差异，导致两者的反射调用过程中构造方法的使用不一样。另外内部类的类名使用采用$符号，来连接外部类与内部类，格式为outer$inner。

### 2.2 static内部类的 `ReflectUtils`类用法
1. 调用类的静态方法（先获取类，再调用）  

		Class<?> clazz = ReflectUtils.getClazz("com.yuanhh.model.Outer$StaticInner"); //获取class
		ReflectUtils.invokeStaticMethod(clazz, "innerStaticMethod");  //无参方法
		ReflectUtils.invokeStaticMethod(clazz, "innerStaticMethod","yuanhh"); //有参数方法

2. 调用类的非静态方法（先获取对象，再调用）

		Object obj = ReflectUtils.newInstance("com.yuanhh.model.Outer$StaticInner");  //实例化对象
		ReflectUtils.invokeMethod(obj, "innerMethod");  //无参方法
		ReflectUtils.invokeMethod(obj, "innerMethod", "yuanhh"); //有参方法
3. set/get类的静态属性（先获取类，再调用）

		ReflectUtils.getStaticField(clazz, "innerField"); //get操作
		ReflectUtils.setStaticField(clazz, "innerField", "new value"); //set操作

4. set/get类的非静态属性（先获取对象，再调用）

		ReflectUtils.getField(obj, "innerField");  //get操作
		ReflectUtils.setField(obj, "innerField", "new value"); //set操作
### 2.2 非static内部类的 `ReflectUtils`类用法
非static内部类，不能定义静态方法和静态属性，故操作只有两项：

2. 调用类的非静态方法（先获取对象，再调用）

		// 获取外部类实例，这是static内部类所不需要的，注意点
		Object outObj = ReflectUtils.newInstance("com.yuanhh.model.Outer"); 
		Object obj = ReflectUtils.newInstance("com.yuanhh.model.Outer$Inner"， outObj);  //实例化对象
		ReflectUtils.invokeMethod(obj, "innerMethod");  //无参方法
		ReflectUtils.invokeMethod(obj, "innerMethod", "yuanhh"); //有参方法


4. set/get类的非静态属性（先获取对象，再调用）

		ReflectUtils.getField(obj, "innerField");  //get操作
		ReflectUtils.setField(obj, "innerField", "new value"); //set操作

## 三、小结

- 主要`ReflectUtils`类的用法，只需要按**1.1 `ReflectUtils`类用法**的方式使用即可，比如反射调用方法，只需知道类与方法名，即可调用完成`invokeMethod(Object object, String methodName)`操作简单。
- static与非static内部类的区别,在2.2与2.3这两节，对于内部类差异仅仅在于传递参数多了一个$符号，以及非static内部类实例化需要加上外部类的实例。
- `ReflectUtils`类，以及本文所有涉及的代码，即将打包上传。



