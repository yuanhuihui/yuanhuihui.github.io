---
layout: post
title:  "Android类加载器ClassLoader"
date:   2017-03-19 11:30:00
catalog:  true
tags:
    - android

---


>  本文讲述的Android系统体系架构，说一说ClassLoader加载过程

```Java
libcore/dalvik/src/main/java/dalvik/system/
    - PathClassLoader.java
    - DexClassLoader.java
    - BaseDexClassLoader.java
    - DexPathList.java
    - DexFile.java

art/runtime/native/dalvik_system_DexFile.cc

libcore/ojluni/src/main/java/java/lang/ClassLoader.java
```


## 一. 概述

Android从5.0开始就采用art虚拟机, 该虚拟机有些类似Java虚拟机, 程序运行过程也需要通过ClassLoader
将目标类加载到内存.

传统Jvm主要是通过读取class字节码来加载, 而art则是从dex字节码来读取. 这是一种更为优化的方案,
可以将多个.class文件合并成一个classes.dex文件. 下面直接来看看ClassLoader的关系

#### 1.1 关系类图

![](/images/classloader/classloader.jpg)

## 二. 五种类构造器
接下来，依次看看PathClassLoader，DexClassLoader，BaseDexClassLoader，BootClassLoader，ClassLoader这5个类加载器

#### 2.1 PathClassLoader

    public class PathClassLoader extends BaseDexClassLoader {

        public PathClassLoader(String dexPath, ClassLoader parent) {
            super(dexPath, null, null, parent);
        }

        public PathClassLoader(String dexPath, String libraryPath,
                ClassLoader parent) {
            super(dexPath, null, libraryPath, parent);
        }
    }

PathClassLoader比较简单, 继承于BaseDexClassLoader. 封装了一下构造函数, 默认
optimizedDirectory=null.

#### 2.2 DexClassLoader

    public class DexClassLoader extends BaseDexClassLoader {

        public DexClassLoader(String dexPath, String optimizedDirectory,
                String libraryPath, ClassLoader parent) {
            super(dexPath, new File(optimizedDirectory), libraryPath, parent);
        }
    }

DexClassLoader也同样,只是简单地封装了BaseDexClassLoader对象,并没有覆写父类的任何方法.

#### 2.3 BaseDexClassLoader

    public class BaseDexClassLoader extends ClassLoader {
        private final DexPathList pathList;  //记录dex文件路径信息

        public BaseDexClassLoader(String dexPath, File optimizedDirectory,
            String libraryPath, ClassLoader parent) {
            super(parent);
            this.pathList = new DexPathList(this, dexPath, libraryPath, optimizedDirectory);
        }
    }

BaseDexClassLoader构造函数, 有一个非常重要的过程, 那就是初始化DexPathList对象.

另外该构造函数的参数说明:

- dexPath: 包含目标类或资源的apk/jar列表;当有多个路径则采用:分割;
- optimizedDirectory: 优化后dex文件存在的目录, 可以为null;
- libraryPath: native库所在路径列表;当有多个路径则采用:分割;
- ClassLoader:父类的类加载器.

#### 2.4 ClassLoader

    public abstract class ClassLoader {
        private ClassLoader parent;  //记录父类加载器

        protected ClassLoader() {
            this(getSystemClassLoader(), false); //见下文
        }

        protected ClassLoader(ClassLoader parentLoader) {
            this(parentLoader, false);
        }

        ClassLoader(ClassLoader parentLoader, boolean nullAllowed) {
            if (parentLoader == null && !nullAllowed) {
                //父类的类加载器为空,则抛出异常
                throw new NullPointerException("parentLoader == null && !nullAllowed");
            }
            parent = parentLoader;
        }
    }

再来看看SystemClassLoader，这里的getSystemClassLoader()返回的是PathClassLoader类。

    public abstract class ClassLoader {

        static private class SystemClassLoader {
            public static ClassLoader loader = ClassLoader.createSystemClassLoader();
        }

        public static ClassLoader getSystemClassLoader() {
            return SystemClassLoader.loader;
        }

        private static ClassLoader createSystemClassLoader() {
            //此处classPath默认值为"."
            String classPath = System.getProperty("java.class.path", ".");
            // BootClassLoader见小节2.5
            return new PathClassLoader(classPath, BootClassLoader.getInstance());
        }
    }

#### 2.5  BootClassLoader

    class BootClassLoader extends ClassLoader {
        private static BootClassLoader instance;

        public static synchronized BootClassLoader getInstance() {
            if (instance == null) {
                instance = new BootClassLoader();
            }

            return instance;
        }

        public BootClassLoader() {
            super(null, true);
        }
}

以上所有的ClassLoader都直接或间接着继承于抽象类ClassLoader.

## 三. PathClassLoader加载类的过程

此处以PathClassLoader为例来说明类的加载过程，先初始化，然后执行loadClass()方法来加载相应的类。
例如：

```Java
new PathClassLoader("/system/framework/tcmclient.jar", ClassLoader.getSystemClassLoader());
```

### 3.1 初始化

```Java
public class PathClassLoader extends BaseDexClassLoader {

    public PathClassLoader(String dexPath, ClassLoader parent) {
        super(dexPath, null, null, parent);  //见下文
    }
}

public class BaseDexClassLoader extends ClassLoader {
    private final DexPathList pathList;

    public BaseDexClassLoader(String dexPath, File optimizedDirectory,
        String libraryPath, ClassLoader parent) {
        super(parent);  //见下文
        //收集dex文件和Native动态库【见小节3.2】
        this.pathList = new DexPathList(this, dexPath, libraryPath, optimizedDirectory);
    }
}

public abstract class ClassLoader {
    private ClassLoader parent;  //父类加载器

    protected ClassLoader(ClassLoader parentLoader) {
        this(parentLoader, false);
    }

    ClassLoader(ClassLoader parentLoader, boolean nullAllowed) {
        parent = parentLoader; 
    }
}
```

### 3.2 DexPathList
[-> DexPathList.java]

```Java
final class DexPathList {
    private Element[] dexElements;
    private final List<File> nativeLibraryDirectories;
    private final List<File> systemNativeLibraryDirectories;

    final class DexPathList {
    public DexPathList(ClassLoader definingContext, String dexPath,
            String libraryPath, File optimizedDirectory) {
        ...
        this.definingContext = definingContext;
        ArrayList<IOException> suppressedExceptions = new ArrayList<IOException>();
        
        //记录所有的dexFile文件【小节3.2.1】
        this.dexElements = makePathElements(splitDexPath(dexPath), optimizedDirectory, suppressedExceptions);

        //app目录的native库
        this.nativeLibraryDirectories = splitPaths(libraryPath, false);
        //系统目录的native库
        this.systemNativeLibraryDirectories = splitPaths(System.getProperty("java.library.path"), true);
        List<File> allNativeLibraryDirectories = new ArrayList<>(nativeLibraryDirectories);
        allNativeLibraryDirectories.addAll(systemNativeLibraryDirectories);
        //记录所有的Native动态库
        this.nativeLibraryPathElements = makePathElements(allNativeLibraryDirectories, null, suppressedExceptions);
        ...
    }
}
```

DexPathList初始化过程,主要功能是收集以下两个变量信息:

1. dexElements: 根据多路径的分隔符“;”将dexPath转换成File列表，记录所有的dexFile
2. nativeLibraryPathElements: 记录所有的Native动态库, 包括app目录的native库和系统目录的native库。

#### 3.2.1 makePathElements
[-> DexPathList.java]

```Java
private static Element[] makePathElements(List<File> files, File optimizedDirectory,
        List<IOException> suppressedExceptions) {
    //【见小节3.2.2】
    return makeDexElements(files, optimizedDirectory, suppressedExceptions, null);
}
```

#### 3.2.2 makeDexElements

```Java
private static Element[] makeDexElements(List<File> files, File optimizedDirectory,
        List<IOException> suppressedExceptions, ClassLoader loader) {
    return makeDexElements(files, optimizedDirectory, suppressedExceptions, loader, false);
}

private static Element[] makeDexElements(List<File> files, File optimizedDirectory,
        List<IOException> suppressedExceptions, ClassLoader loader, boolean isTrusted) {
  Element[] elements = new Element[files.size()];  //获取文件个数
  int elementsPos = 0;
  for (File file : files) {
      if (file.isDirectory()) {
          elements[elementsPos++] = new Element(file);
      } else if (file.isFile()) {
          String name = file.getName();
          DexFile dex = null;
          //匹配以.dex为后缀的文件
          if (name.endsWith(DEX_SUFFIX)) {
              //【小节3.2.3】
              dex = loadDexFile(file, optimizedDirectory, loader, elements);
              if (dex != null) {
                  elements[elementsPos++] = new Element(dex, null);
              }
          } else {
              dex = loadDexFile(file, optimizedDirectory, loader, elements);              
              if (dex == null) {
                  elements[elementsPos++] = new Element(file);
              } else {
                  elements[elementsPos++] = new Element(dex, file);
              }
          }
          if (dex != null && isTrusted) {
            dex.setTrusted();
          }
      } else {
          System.logW("ClassLoader referenced unknown path: " + file);
      }
  }
  if (elementsPos != elements.length) {
      elements = Arrays.copyOf(elements, elementsPos);
  }

  return elements;
}
```

该方法的主要功能是创建Element数组

#### 3.2.3 loadDexFile
[-> DexPathList.java]

```Java
private static DexFile loadDexFile(File file, File optimizedDirectory, ClassLoader loader,
                                   Element[] elements)
        throws IOException {
    if (optimizedDirectory == null) {
        return new DexFile(file, loader, elements);  //创建DexFile对象
    } else {
        String optimizedPath = optimizedPathFor(file, optimizedDirectory);
        return DexFile.loadDex(file.getPath(), optimizedPath, 0, loader, elements);
    }
}
```

#### 3.2.4 创建对象DexFile
[-> DexFile]

```Java
DexFile(File file, ClassLoader loader, DexPathList.Element[] elements)
        throws IOException {
    this(file.getPath(), loader, elements);
}

DexFile(String fileName, ClassLoader loader, DexPathList.Element[] elements) throws IOException {
    //【小节3.2.5】
    mCookie = openDexFile(fileName, null, 0, loader, elements);
    mInternalCookie = mCookie;
    mFileName = fileName;
}
```

#### 3.2.5 openDexFile
[-> DexFile]

```Java
private static Object openDexFile(String sourceName, String outputName, int flags,
        ClassLoader loader, DexPathList.Element[] elements) throws IOException {
    //【见小节3.2.6】
    return openDexFileNative(new File(sourceName).getAbsolutePath(),
                             (outputName == null) ? null : new File(outputName).getAbsolutePath(),
                             flags,
                             loader,
                             elements);
}
```

此时参数取值说明：

- sourceName为PathClassLoader构造函数传递的dexPath中以分隔符划分之后的文件名；
- outputName为null；
- flags=0
- loader为null；
- elements为makeDexElements()过程生成的Element数组；

#### 3.2.6 DexFile_openDexFileNative
[-> dalvik_system_DexFile.cc]

```CPP
static jobject DexFile_openDexFileNative(JNIEnv* env,
                                         jclass,
                                         jstring javaSourceName,
                                         jstring javaOutputName ATTRIBUTE_UNUSED,
                                         jint flags ATTRIBUTE_UNUSED,
                                         jobject class_loader,
                                         jobjectArray dex_elements) {
  ScopedUtfChars sourceName(env, javaSourceName);
  if (sourceName.c_str() == nullptr) {
    return 0;
  }
  Runtime* const runtime = Runtime::Current();
  ClassLinker* linker = runtime->GetClassLinker();
  std::vector<std::unique_ptr<const DexFile>> dex_files;
  std::vector<std::string> error_msgs;
  const OatFile* oat_file = nullptr;

  dex_files = runtime->GetOatFileManager().OpenDexFilesFromOat(sourceName.c_str(),
                                                               class_loader,
                                                               dex_elements,
                                                               /*out*/ &oat_file,
                                                               /*out*/ &error_msgs);

  if (!dex_files.empty()) {
    jlongArray array = ConvertDexFilesToJavaArray(env, oat_file, dex_files);
    ...
    return array;
  } else {
    ...
    return nullptr;
  }
}
```

PathClassLoader创建完成后，就已经拥有了目标程序的文件路径，native lib路径，以及parent类加载器对象。接下来开始执行loadClass()来加载相应的类。

### 3.3 loadClass
[-> ClassLoader.java]

    public abstract class ClassLoader {

        public Class<?> loadClass(String className) throws ClassNotFoundException {
            return loadClass(className, false);
        }

        protected Class<?> loadClass(String className, boolean resolve) throws ClassNotFoundException {
            //判断当前类加载器是否已经加载过指定类，若已加载则直接返回【小节3.3.1】
            Class<?> clazz = findLoadedClass(className);

            if (clazz == null) { 
                //如果没有加载过，则调用parent的类加载递归加载该类，若已加载则直接返回
                clazz = parent.loadClass(className, false);
                
                if (clazz == null) {
                    //还没加载，则调用当前类加载器来加载[见小节3.2]
                    clazz = findClass(className);
                }
            }
            return clazz;
        }
    }

该方法的加载流程如下：

1. 判断当前类加载器是否已经加载过指定类，若已加载则直接返回，否则继续执行；
2. 调用parent的类加载递归加载该类，检测是否加载，若已加载则直接返回，否则继续执行；
3. 调用当前类加载器，通过findClass加载。

#### 3.3.1 findLoadedClass
[-> ClassLoader.java]

```Java
protected final Class<?> findLoadedClass(String name) {
    ClassLoader loader;
    if (this == BootClassLoader.getInstance())
        loader = null;
    else
        loader = this;
    return VMClassLoader.findLoadedClass(loader, name);
}
```

### 3.4 findClass
[-> BaseDexClassLoader.java]

    public class BaseDexClassLoader extends ClassLoader {
        protected Class<?> findClass(String name) throws ClassNotFoundException {
            //[见小节3.5]
            Class c = pathList.findClass(name, suppressedExceptions);
            ...
            return c;
        }
    }

### 3.5  DexPathList.findClass
[-> DexPathList.java]

    public Class findClass(String name, List<Throwable> suppressed) {
        for (Element element : dexElements) {
            DexFile dex = element.dexFile;
            if (dex != null) {
                //找到目标类，则直接返回[见小节3.6]
                Class clazz = dex.loadClassBinaryName(name, definingContext, suppressed);
                if (clazz != null) {
                    return clazz;
                }
            }
        }
        return null;
    }

**功能说明：**

这里是核心逻辑，一个Classloader可以包含多个dex文件，每个dex文件被封装到一个Element对象，这些Element对象排列成有序的数组
dexElements。当查找某个类时，会遍历所有的dex文件，如果找到则直接返回，不再继续遍历dexElements。也就是说当两个类不同的dex中出现，会优先处理排在前面的dex文件，这便是热修复的核心精髓，将需要修复的类所打包的dex文件插入到dexElements前面。

### 3.6 DexFile.loadClassBinaryName
[-> DexFile.java]

    public final class DexFile {

        public Class loadClassBinaryName(String name, ClassLoader loader, List<Throwable> suppressed) {
            return defineClass(name, loader, mCookie, suppressed);  //【见下文】
        }

        private static Class defineClass(String name, ClassLoader loader, Object cookie,
                                         List<Throwable> suppressed) {
            Class result = null;
            try {
                result = defineClassNative(name, loader, cookie);  //【小节3.7】
            } catch (NoClassDefFoundError e) {
                if (suppressed != null) {
                    suppressed.add(e);
                }
            } catch (ClassNotFoundException e) {
                if (suppressed != null) {
                    suppressed.add(e);
                }
            }
            return result;
        }
    }

defineClassNative()这是native方法, 进入如下方法.

### 3.7 defineClassNative
[-> dalvik_system_DexFile.cc]

    static jclass DexFile_defineClassNative(JNIEnv* env, jclass, jstring javaName, jobject javaLoader,
                                            jobject cookie) {
      std::unique_ptr<std::vector<const DexFile*>> dex_files = ConvertJavaArrayToNative(env, cookie);
      if (dex_files.get() == nullptr) {
        return nullptr; //dex文件为空, 则直接返回
      }

      ScopedUtfChars class_name(env, javaName);
      if (class_name.c_str() == nullptr) {
        return nullptr; //类名为空, 则直接返回
      }

      const std::string descriptor(DotToDescriptor(class_name.c_str()));
      const size_t hash(ComputeModifiedUtf8Hash(descriptor.c_str())); //将类名转换为hash码
      for (auto& dex_file : *dex_files) {
        const DexFile::ClassDef* dex_class_def = dex_file->FindClassDef(descriptor.c_str(), hash);
        if (dex_class_def != nullptr) {
          ScopedObjectAccess soa(env);
          ClassLinker* class_linker = Runtime::Current()->GetClassLinker();
          class_linker->RegisterDexFile(*dex_file);
          StackHandleScope<1> hs(soa.Self());
          Handle<mirror::ClassLoader> class_loader(
              hs.NewHandle(soa.Decode<mirror::ClassLoader*>(javaLoader)));
          //获取目标类
          mirror::Class* result = class_linker->DefineClass(soa.Self(), descriptor.c_str(), hash,
                                                            class_loader, *dex_file, *dex_class_def);
          if (result != nullptr) {
            // 找到目标对象
            return soa.AddLocalReference<jclass>(result);
          }
        }
      }
      return nullptr; //没有找到目标类
    }

在native层创建目标类的对象并添加到虚拟机列表。

## 四. 总结

几种类加载器：

- PathClassLoader: 主要用于系统和app的类加载器,其中optimizedDirectory为null, 采用默认目录/data/dalvik-cache/
- DexClassLoader: 可以从包含classes.dex的jar或者apk中，加载类的类加载器, 可用于执行动态加载,但必须是app私有可写目录来缓存odex文件. 能够加载系统没有安装的apk或者jar文件， 因此很多插件化方案都是采用DexClassLoader;
- BaseDexClassLoader: 比较基础的类加载器, PathClassLoader和DexClassLoader都只是在构造函数上对其简单封装而已.
- BootClassLoader: 作为父类的类构造器。


热修复核心逻辑：在DexPathList.findClass()过程，一个Classloader可以包含多个dex文件，每个dex文件被封装到一个Element对象，这些Element对象排列成有序的数组dexElements。当查找某个类时，会遍历所有的dex文件，如果找到则直接返回，不再继续遍历dexElements。也就是说当两个类不同的dex中出现，会优先处理排在前面的dex文件，这便是热修复的核心精髓，将需要修复的类所打包的dex文件插入到dexElements前面。

类加载过程常见的ClassNotFound原因：

- ABI异常：常见在系统APP，为了减小system分区大小会将apk源文件中的classes.dex文件移除，对于既然可运行在64位又可运行在32位模式的应用，当被强制设置32位时，openDexFileNative在查找不到oat文件时会运行在解释模式，而classes.dex文件不再则出现ClassNotFound异常。
- MultiDex处理不当，由于每个Dex文件中方法个数不能超过65536，引入MultiDex机制。dex2oat会自动查找Apk文件中的classes.dex，classes2.dex，...classesN.dex等文件，编译到/data/dalvik-cache下生成oat文件。这里需要文件名跟classesN.dex格式，并且一定要与classes.dex一起放置在第一级目录，有些APP不按照要求来，导致ClassNotFound异常。
