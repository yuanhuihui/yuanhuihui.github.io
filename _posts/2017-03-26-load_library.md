---
layout: post
title:  "loadLibrary动态库加载过程分析"
date:   2017-03-26 20:30:00
catalog:  true
tags:
    - android
    - 组件
---

>  本文讲述的Android系统体系架构， 分析动态库的加载过程.

    libcore/luni/src/main/java/java/lang/System.java
    libcore/luni/src/main/java/java/lang/Runtime.java
    libcore/luni/src/main/native/java_lang_System.cpp
    bionic/linker/linker.cpp
    art/runtime/native/java_lang_Runtime.cc
    art/runtime/java_vm_ext.cc

## 一. 概述

动态库操作,所需要的头文件的#include<dlfcn.h>, 最为核心的方法如下:

    void *dlopen(const char * pathname,int mode);  //打开动态库  
    void *dlsym(void *handle,const char *name);  //获取动态库对象地址  
    char *dlerror(vid);   //错误检测  
    int dlclose(void * handle); //关闭动态库  

而对于android上层的Java代码来说,都封装好了, 只需要一行代码就即可完成动态库的加载过程,如下:

    System.loadLibrary("gityuan_jni");

接下来,解析这行代码背后的故事.

## 二. 动态库加载过程

### 2.1 System.loadLibrary
[-> System.java]

    public static void loadLibrary(String libName) {
        Runtime.getRuntime().loadLibrary(libName, VMStack.getCallingClassLoader());
    }

此处getCallingClassLoader返回的是调用者所定义的ClassLoader.


### 2.2 Runtime.loadLibrary
[-> Runtime.java]

    void loadLibrary(String libraryName, ClassLoader loader) {
        if (loader != null) {
            //[见小节2.4.1]
            String filename = loader.findLibrary(libraryName);
            if (filename == null) {
                throw new UnsatisfiedLinkError(...);
            }
            //成功执行完doLoad,则返回.[见小节2.5]
            String error = doLoad(filename, loader);
            if (error != null) {
                throw new UnsatisfiedLinkError(error);
            }
            return;
        }
        //当loader为空的情况下执行[见2.3]
        String filename = System.mapLibraryName(libraryName);
        List<String> candidates = new ArrayList<String>();
        String lastError = null;

        //此处的mLibPaths取值 [见小节三]
        for (String directory : mLibPaths) {
            String candidate = directory + filename;
            candidates.add(candidate);

            if (IoUtils.canOpenReadOnly(candidate)) {
                String error = doLoad(candidate, loader);
                if (error == null) {
                    return; //成功执行完doLoad,则返回.
                }
                lastError = error;
            }
        }

        if (lastError != null) {
            throw new UnsatisfiedLinkError(lastError);
        }
        throw new UnsatisfiedLinkError("Library " + libraryName + " not found; tried " + candidates);
    }

加载库的两条路径,如下:

- 当loader不为空时, 通过该loader来findLibrary()查看目标库所在路径;
- 当loader为空时, 则从默认目录mLibPaths下来查找是否存在该动态库;

不管loader是否为空, 找到目标库所在路径后,都会调用doLoad来真正用于加载动态库.


### 2.3 loader为空的情况
[-> System.java]

    public static String mapLibraryName(String nickname) {
        if (nickname == null) {
            throw new NullPointerException("nickname == null");
        }
        return "lib" + nickname + ".so";
    }

该方法的功能是将xxx动态库的名字转换为libxxx.so.
比如前面传递过来的nickname为gityuan_jni, 经过该方法处理后返回的名字为libgityuan_jni.so.

mLibPaths取值分两种情况:

- 对于64系统,则为/system/lib64和/vendor/lib64;
- 对于32系统,则为/system/lib和/vendor/lib.

假设此处为64位系统, 则会去查找/system/lib64/libgityuan_jni.so或/vendor/lib64/libgityuan_jni.so库是否存在.

绝大多数的动态库都在/system/lib64或/system/lib路径下.通过canOpenReadOnly方法来判定目标动态库是否存在,
找到则直接返回,否则抛出UnsatisfiedLinkError异常.

### 2.4 loader不为空的情况

ClassLoader一般来说都是PathClassLoader, 这就不再解释. 从该对象的findLibrary说起. 由于PathClassLoader继承于
BaseDexClassLoader对象, 并且没有覆写该方法, 故调用其父类所对应的方法.

#### 2.4.1 findLibrary
[-> BaseDexClassLoader.java]

    public class BaseDexClassLoader extends ClassLoader {
        private final DexPathList pathList;

        public BaseDexClassLoader(String dexPath, File optimizedDirectory,
                String libraryPath, ClassLoader parent) {
            super(parent);
            //dexPath一般是指apk所在路径【小节2.4.2】
            this.pathList = new DexPathList(this, dexPath, libraryPath, optimizedDirectory);
        }

        public String findLibrary(String name) {
            return pathList.findLibrary(name); //[见小节2.4.3]
        }
    }

#### 2.4.2 DexPathList
[-> DexPathList.java]

    public DexPathList(ClassLoader definingContext, String dexPath,
            String libraryPath, File optimizedDirectory) {
        ...
        this.definingContext = definingContext;

        ArrayList<IOException> suppressedExceptions = new ArrayList<IOException>();
        //记录所有的dexFile文件
        this.dexElements = makePathElements(splitDexPath(dexPath), optimizedDirectory, suppressedExceptions);

        //app目录的native库
        this.nativeLibraryDirectories = splitPaths(libraryPath, false);
        //系统目录的native库
        this.systemNativeLibraryDirectories = splitPaths(System.getProperty("java.library.path"), true);
        List<File> allNativeLibraryDirectories = new ArrayList<>(nativeLibraryDirectories);
        allNativeLibraryDirectories.addAll(systemNativeLibraryDirectories);
        //记录所有的Native动态库
        this.nativeLibraryPathElements = makePathElements(allNativeLibraryDirectories, null,
                                                          suppressedExceptions);
        ...
    }

DexPathList初始化过程,主要功能是收集以下两个变量信息:

1. dexElements: 记录所有的dexFile文件
2. nativeLibraryPathElements: 记录所有的Native动态库, 包括app目录的native库和系统目录的native库.

接下来便是从pathList中查询目标动态库.

#### 2.4.3 findLibrary
[-> DexPathList.java]

    public String findLibrary(String libraryName) {
        String fileName = System.mapLibraryName(libraryName);

        for (Element element : nativeLibraryPathElements) {
            //[见小节2.4.4]
            String path = element.findNativeLibrary(fileName);
            if (path != null) {
                return path;
            }
        }
        return null;
    }

gityuan_jni同样也是经过mapLibraryName(), 处理后得到的名字为libgityuan_jni.so.
接下来,从所有的动态库nativeLibraryPathElements(包含两个系统路径)查询是否存在匹配的.
这里举例说明, 一般地会在以下两个路径查找(以64位为例):

- /data/app/com.gityuan.blog-1/lib/arm64
- /vendor/lib64
- /system/lib64


#### 2.4.4 findNativeLibrary
[-> DexPathList.java  ::Element]

    final class DexPathList {
        static class Element {

            public String findNativeLibrary(String name) {
                maybeInit();
                if (isDirectory) {
                    String path = new File(dir, name).getPath();
                    if (IoUtils.canOpenReadOnly(path)) {
                        return path;
                    }
                } else if (zipFile != null) {
                    String entryName = new File(dir, name).getPath();
                    if (isZipEntryExistsAndStored(zipFile, entryName)) {
                      return zip.getPath() + zipSeparator + entryName;
                    }
                }
                return null;
            }
        }
    }

遍历查询,一旦找到则返回所找到的目标动态库.
接下来, 再回到[小节2.2]来看看动态库的加载doLoad:


### 2.5 Runtime.doLoad
[-> Runtime.java]

    private String doLoad(String name, ClassLoader loader) {
        String ldLibraryPath = null;
        String dexPath = null;
        if (loader == null) {
            ldLibraryPath = System.getProperty("java.library.path");
        } else if (loader instanceof BaseDexClassLoader) {
            BaseDexClassLoader dexClassLoader = (BaseDexClassLoader) loader;
            ldLibraryPath = dexClassLoader.getLdLibraryPath();
        }
        synchronized (this) {
            //[见小节2.5.1]
            return nativeLoad(name, loader, ldLibraryPath);
        }
    }

此处ldLibraryPath有两种情况：

- 当loader为空，　则ldLibraryPath为系统目录下的Ｎative库；
- 当lodder不为空，　则ldLibraryPath为ａpp目录下的Ｎative库；

接下来, 继续看看nativeLoad.

#### 2.5.1 nativeLoad
[-> java_lang_Runtime.cc]

    static jstring Runtime_nativeLoad(JNIEnv* env, jclass, jstring javaFilename, jobject javaLoader,
                                      jstring javaLdLibraryPathJstr) {
      ScopedUtfChars filename(env, javaFilename);
      if (filename.c_str() == nullptr) {
        return nullptr;
      }

      SetLdLibraryPath(env, javaLdLibraryPathJstr);

      std::string error_msg;
      {
        JavaVMExt* vm = Runtime::Current()->GetJavaVM();
        //[见小节2.5.2]
        bool success = vm->LoadNativeLibrary(env, filename.c_str(), javaLoader, &error_msg);
        if (success) {
          return nullptr;
        }
      }

      env->ExceptionClear();
      return env->NewStringUTF(error_msg.c_str());
    }

nativeLoad方法经过jni,进入该方法执行.

#### 2.5.2 LoadNativeLibrary
[-> java_vm_ext.cc]

    bool JavaVMExt::LoadNativeLibrary(JNIEnv* env, const std::string& path, jobject class_loader,
                                      std::string* error_msg) {
      error_msg->clear();

      SharedLibrary* library;
      Thread* self = Thread::Current();
      {
        MutexLock mu(self, *Locks::jni_libraries_lock_);
        library = libraries_->Get(path); //检查该动态库是否已加载
      }
      if (library != nullptr) {
        if (env->IsSameObject(library->GetClassLoader(), class_loader) == JNI_FALSE) {
          //不能加载同一个采用多个不同的ClassLoader
          return false;
        }
        ...
        return true;
      }

      const char* path_str = path.empty() ? nullptr : path.c_str();
      //通过dlopen打开动态共享库.该库不会立刻被卸载直到引用技术为空.
      void* handle = dlopen(path_str, RTLD_NOW);
      bool needs_native_bridge = false;
      if (handle == nullptr) {
        if (android::NativeBridgeIsSupported(path_str)) {
          handle = android::NativeBridgeLoadLibrary(path_str, RTLD_NOW);
          needs_native_bridge = true;
        }
      }

      if (handle == nullptr) {
        *error_msg = dlerror(); //打开失败
        VLOG(jni) << "dlopen(\"" << path << "\", RTLD_NOW) failed: " << *error_msg;
        return false;
      }


      bool created_library = false;
      {
        std::unique_ptr<SharedLibrary> new_library(
            new SharedLibrary(env, self, path, handle, class_loader));
        MutexLock mu(self, *Locks::jni_libraries_lock_);
        library = libraries_->Get(path);
        if (library == nullptr) {
          library = new_library.release();
          //创建共享库,并添加到列表
          libraries_->Put(path, library);
          created_library = true;
        }
      }
      ...

      bool was_successful = false;
      void* sym;
      //查询JNI_OnLoad符号所对应的方法
      if (needs_native_bridge) {
        library->SetNeedsNativeBridge();
        sym = library->FindSymbolWithNativeBridge("JNI_OnLoad", nullptr);
      } else {
        sym = dlsym(handle, "JNI_OnLoad");
      }

      if (sym == nullptr) {
        was_successful = true;
      } else {
        //需要先覆盖当前ClassLoader.
        ScopedLocalRef<jobject> old_class_loader(env, env->NewLocalRef(self->GetClassLoaderOverride()));
        self->SetClassLoaderOverride(class_loader);

        typedef int (*JNI_OnLoadFn)(JavaVM*, void*);
        JNI_OnLoadFn jni_on_load = reinterpret_cast<JNI_OnLoadFn>(sym);
        // 真正调用JNI_OnLoad()方法的过程
        int version = (*jni_on_load)(this, nullptr);

        if (runtime_->GetTargetSdkVersion() != 0 && runtime_->GetTargetSdkVersion() <= 21) {
          fault_manager.EnsureArtActionInFrontOfSignalChain();
        }
        //执行完成后, 需要恢复到原来的ClassLoader
        self->SetClassLoaderOverride(old_class_loader.get());
        ...
      }

      library->SetResult(was_successful);
      return was_successful;
    }

该过程简单总结:

1. 检查该动态库是否已加载;
2. 通过dlopen打开动态共享库;
3. 创建SharedLibrary共享库,并添加到libraries_列表;
4. 找到JNI_OnLoad符号所对应的方法, 并调用该方法.

## 三. mLibPaths初始化

mLibPaths的初始化过程, 要从libcore/luni/src/main/java/java/lang/System.java类的静态代码块初始化开始说起.
对于类的静态代码块,编译过程会将所有的静态代码块和静态成员变量的赋值过程都收集整合到clinit方法, 即类的初始化方法.如下:


    public final class System {
        static {
            ...
            //[见小节3.1]
            unchangeableSystemProperties = initUnchangeableSystemProperties();
            systemProperties = createSystemProperties();
            addLegacyLocaleSystemProperties();
        }
    }

### 3.1 initUnchangeableSystemProperties
[-> System.java]

    private static Properties initUnchangeableSystemProperties() {
        VMRuntime runtime = VMRuntime.getRuntime();
        Properties p = new Properties();
        ...
        p.put("java.boot.class.path", runtime.bootClassPath());
        p.put("java.class.path", runtime.classPath());
        // [见小节3.2]
        parsePropertyAssignments(p, specialProperties());
        ...
        return p;
    }


这个过程会将大量的key-value对保存到Properties对象, 这种重点看specialProperties

#### 3.1.1 parsePropertyAssignments
[-> System.java]

    private static void parsePropertyAssignments(Properties p, String[] assignments) {
        for (String assignment : assignments) {
            int split = assignment.indexOf('=');
            String key = assignment.substring(0, split);
            String value = assignment.substring(split + 1);
            p.put(key, value);
        }
    }

将assignments数据解析后保存到Properties对象.

### 3.2 specialProperties
[-> java_lang_System.cpp]

    static jobjectArray System_specialProperties(JNIEnv* env, jclass) {
        std::vector<std::string> properties;
        char path[PATH_MAX];
        ...

        const char* library_path = getenv("LD_LIBRARY_PATH");
        if (library_path == NULL) {
            // [见小节3.3]
            android_get_LD_LIBRARY_PATH(path, sizeof(path));
            library_path = path;
        }
        properties.push_back(std::string("java.library.path=") + library_path);
        return toStringArray(env, properties);
    }

环境变量LD_LIBRARY_PATH为空, 可通过adb shell env命令来查看环境变量的值.
接下来进入android_get_LD_LIBRARY_PATH方法, 该方法调用do_android_get_LD_LIBRARY_PATH,见下文:

### 3.3 do_android_get_LD_LIBRARY_PATH
[-> linker.cpp]

    void do_android_get_LD_LIBRARY_PATH(char* buffer, size_t buffer_size) {
      //[见小节3.4]
      size_t required_len = strlen(kDefaultLdPaths[0]) + strlen(kDefaultLdPaths[1]) + 2;
      char* end = stpcpy(buffer, kDefaultLdPaths[0]);
      *end = ':';
      strcpy(end + 1, kDefaultLdPaths[1]);
    }

可见赋值过程还得看kDefaultLdPaths数组.


### 3.4 kDefaultLdPaths
[-> linker.cpp]

    static const char* const kDefaultLdPaths[] = {
    #if defined(__LP64__)
      "/vendor/lib64",
      "/system/lib64",
    #else
      "/vendor/lib",
      "/system/lib",
    #endif
      nullptr
    };

对于linux 64位操作系统则定义__LP64__宏, 可知mLibPaths取值分两种情况:

- 对于64系统,则为/system/lib64和/vendor/lib64;
- 对于32系统,则为/system/lib和/vendor/lib.

也可以通过System.getProperty("java.library.path")来获取该值.
