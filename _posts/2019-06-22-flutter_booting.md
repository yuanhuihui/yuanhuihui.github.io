---
layout: post
title:  "深入理解Flutter引擎启动"
date:   2019-06-22 23:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter启动流程，相关源码目录见文末附录


## 一、概述

Flutter作为一款跨平台的框架，可以运行在Android、iOS等平台，Android为例讲解如何从Android应用启动流程中衔接到Flutter流程，以及Flutter引擎的启动流程。

熟悉Android的开发者，应该都了解应用的启动会会执行Application和Activity的初始化，调用其onCreate()方法，接下来分别从这个两个方法开始讲起。

### 1.1 Flutter启动概览

#### 1.1.1 FlutterApplication启动

**[FlutterApplication启动流程图](/img/flutter_boot/FlutterApplication_create.jpg)**

![FlutterApplication_create](/img/flutter_boot/FlutterApplication_create.jpg)

#### 1.1.2 FlutterActivity启动

**[FlutterActivity启动流程图](/img/flutter_boot/FlutterActivity_create.jpg)**

![FlutterActivity_create](/img/flutter_boot/FlutterActivity_create.jpg)

#### 1.1.3 Flutter引擎启动图
FlutterActivity启动过程执行到AttachJNI()后开始触发Flutter引擎的启动初始化，而引擎初始化之前会进行TaskRunners的初始化。

**1) [Flutter引擎启动图](/img/flutter_boot/FlutterEngine_create.jpg)**

![FlutterEngine_create](/img/flutter_boot/FlutterEngine_create.jpg)

**2) [TaskRunners启动图](/img/flutter_boot/ThreadHost_create.jpg)**

![ThreadHost_create](/img/flutter_boot/ThreadHost_create.jpg)

### 1.2 类关系图
** [Flutter引擎核心类](/img/flutter_boot/ClassEngine.jpg)**

![ClassEngine](/img/flutter_boot/ClassEngine.jpg)

## 二、FlutterApplication启动流程

在AndrodManifest.xml定义的FlutterApplication，Android应用在启动时候会执行其onCreate()方法，

### 2.1 FlutterApplication.onCreate
[-> FlutterApplication.java]

```Java
public class FlutterApplication extends Application {
    public void onCreate() {
        super.onCreate();
        FlutterMain.startInitialization(this); //[见小节2.2]
    }
    ...
}
```

### 2.2 startInitialization
[-> FlutterMain.java]

```Java
public static void startInitialization(Context applicationContext) {
    startInitialization(applicationContext, new Settings());
}

public static void startInitialization(Context applicationContext, Settings settings) {
    //该方法必须运行在主线程，否则抛出异常
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new IllegalStateException("startInitialization must be called on the main thread");
    }
    //保证startInitialization只执行一次
    if (sSettings != null) {
      return;
    }
    sSettings = settings;

    long initStartTimestampMillis = SystemClock.uptimeMillis();
    initConfig(applicationContext); //[见小节2.3]
    initAot(applicationContext); //[见小节2.4]
    initResources(applicationContext); //[见小节2.5]

    //加载libflutter.so [见小节2.6]
    if (sResourceUpdater == null) {
        System.loadLibrary("flutter");
    } else {
        sResourceExtractor.waitForCompletion();
        File lib = new File(PathUtils.getDataDirectory(applicationContext), DEFAULT_LIBRARY);
        if (lib.exists()) {
            System.load(lib.getAbsolutePath());
        } else {
            System.loadLibrary("flutter");
        }
    }

    long initTimeMillis = SystemClock.uptimeMillis() - initStartTimestampMillis;
    nativeRecordStartTimestamp(initTimeMillis);  //[见小节2.7]
}
```

该方法的主要工作是：

- 初始化配置，获取是否预编译模式，初始化并提取资源文件；
- 加载libflutter.so库；
- 记录启动时间戳；

### 2.3 initConfig
[-> FlutterMain.java]

```Java
private static void initConfig(Context applicationContext) {
    try {
        Bundle metadata = applicationContext.getPackageManager().getApplicationInfo(
            applicationContext.getPackageName(), PackageManager.GET_META_DATA).metaData;
        if (metadata != null) {
            sAotSharedLibraryPath = metadata.getString(PUBLIC_AOT_AOT_SHARED_LIBRARY_PATH, DEFAULT_AOT_SHARED_LIBRARY_PATH);
            sAotVmSnapshotData = metadata.getString(PUBLIC_AOT_VM_SNAPSHOT_DATA_KEY, DEFAULT_AOT_VM_SNAPSHOT_DATA);
            sAotVmSnapshotInstr = metadata.getString(PUBLIC_AOT_VM_SNAPSHOT_INSTR_KEY, DEFAULT_AOT_VM_SNAPSHOT_INSTR);
            sAotIsolateSnapshotData = metadata.getString(PUBLIC_AOT_ISOLATE_SNAPSHOT_DATA_KEY, DEFAULT_AOT_ISOLATE_SNAPSHOT_DATA);
            sAotIsolateSnapshotInstr = metadata.getString(PUBLIC_AOT_ISOLATE_SNAPSHOT_INSTR_KEY, DEFAULT_AOT_ISOLATE_SNAPSHOT_INSTR);
            sFlx = metadata.getString(PUBLIC_FLX_KEY, DEFAULT_FLX);
            sFlutterAssetsDir = metadata.getString(PUBLIC_FLUTTER_ASSETS_DIR_KEY, DEFAULT_FLUTTER_ASSETS_DIR);
        }
    } catch (PackageManager.NameNotFoundException e) {
        throw new RuntimeException(e);
    }
}
```

初始化FlutterMain的相关配置信息，当metadata数据没有配置初值则采用默认值，每一项配置都是String类型，下面列举了每一项配置参数相对应的默认值，如下所示：

|参数名|默认值|
|---|---|
|sAotSharedLibraryPath|app.so|
|sAotVmSnapshotData|vm_snapshot_data|
|sAotVmSnapshotInstr|vm_snapshot_instr|
|sAotIsolateSnapshotData|isolate_snapshot_data|
|sAotIsolateSnapshotInstr|isolate_snapshot_instr|
|sFlx|app.flx|
|sFlutterAssetsDir|flutter_assets|


### 2.4 initAot
[-> FlutterMain.java]

```Java
private static void initAot(Context applicationContext) {
    //获取应用根目录下的所有assets资源路径
    Set<String> assets = listAssets(applicationContext, "");
    sIsPrecompiledAsBlobs = assets.containsAll(Arrays.asList(
        sAotVmSnapshotData,
        sAotVmSnapshotInstr,
        sAotIsolateSnapshotData,
        sAotIsolateSnapshotInstr
    ));
    sIsPrecompiledAsSharedLibrary = assets.contains(sAotSharedLibraryPath);
    //当assets中存在共享库app.so和Dart虚拟机快照，则是预编译应用抛出异常
    if (sIsPrecompiledAsBlobs && sIsPrecompiledAsSharedLibrary) {
      throw new RuntimeException(“...”);
    }
}
```

### 2.5 initResources
[-> FlutterMain.java]

```Java
private static void initResources(Context applicationContext) {
    Context context = applicationContext;
    //执行异步文件清理
    new ResourceCleaner(context).start();

    Bundle metaData = null;
    try {
        metaData = context.getPackageManager().getApplicationInfo(
                context.getPackageName(), PackageManager.GET_META_DATA).metaData;

    } catch (PackageManager.NameNotFoundException e) {
        ...
    }

    if (metaData != null && metaData.getBoolean("DynamicPatching")) {
        //资源更新
        sResourceUpdater = new ResourceUpdater(context);
        if (sResourceUpdater.getDownloadMode() == ResourceUpdater.DownloadMode.ON_RESTART ||
            sResourceUpdater.getDownloadMode() == ResourceUpdater.DownloadMode.ON_RESUME) {
            sResourceUpdater.startUpdateDownloadOnce();
            if (sResourceUpdater.getInstallMode() == ResourceUpdater.InstallMode.IMMEDIATE) {
                sResourceUpdater.waitForDownloadCompletion();
            }
        }
    }
    //资源提取的过程
    sResourceExtractor = new ResourceExtractor(context);

    sResourceExtractor
        .addResource(fromFlutterAssets(sFlx))
        .addResource(fromFlutterAssets(sAotVmSnapshotData))
        .addResource(fromFlutterAssets(sAotVmSnapshotInstr))
        .addResource(fromFlutterAssets(sAotIsolateSnapshotData))
        .addResource(fromFlutterAssets(sAotIsolateSnapshotInstr))
        .addResource(fromFlutterAssets(DEFAULT_KERNEL_BLOB));

    if (sIsPrecompiledAsSharedLibrary) {
      sResourceExtractor.addResource(sAotSharedLibraryPath);
    } else {
      sResourceExtractor
        .addResource(sAotVmSnapshotData)
        .addResource(sAotVmSnapshotInstr)
        .addResource(sAotIsolateSnapshotData)
        .addResource(sAotIsolateSnapshotInstr);
    }
    if (sResourceUpdater != null) {
      sResourceExtractor.addResource(DEFAULT_LIBRARY);
    }
    sResourceExtractor.start();
}

```

资源初始化主要包括对资源文件的清理、更新以及提前操作，这个过程都是在异步线程执行完成。

### 2.6 System.loadLibrary

不论是System.loadLibrary()，还是System.load()最终都会调用到该加载库中的JNI_OnLoad()方法，该过程原理见[loadLibrary动态库加载过程分析](http://gityuan.com/2017/03/26/load_library/)

[-> flutter/shell/platform/android/library_loader.cc]

```Java
JNIEXPORT jint JNI_OnLoad(JavaVM* vm, void* reserved) {
  // 初始化Java虚拟机 [见小节2.6.1]
  fml::jni::InitJavaVM(vm);
  JNIEnv* env = fml::jni::AttachCurrentThread();
  bool result = false;

  // 注册FlutterMain [2.6.2]
  result = shell::FlutterMain::Register(env);

  // 注册PlatformView [见小节2.6.3]
  result = shell::PlatformViewAndroid::Register(env);

  // 注册VSyncWaiter [见小节2.6.4]
  result = shell::VsyncWaiterAndroid::Register(env);
  return JNI_VERSION_1_4;
}
```

在加载libflutter.so的过程，经过层层调用后会执行JNI_OnLoad()方法，该方法的主要功能：

- 初始化Java虚拟机；
- 注册FlutterMain;
- 注册PlatformView;
- 注册VSyncWaiter;


#### 2.6.1 InitJavaVM
[-> flutter/fml/platform/android/jni_util.cc]

```Java
static JavaVM* g_jvm = nullptr;

void InitJavaVM(JavaVM* vm) {
  g_jvm = vm;  //保存在静态变量
}

JNIEnv* AttachCurrentThread() {
  JNIEnv* env = nullptr;
  jint ret = g_jvm->AttachCurrentThread(&env, nullptr);
  return env;
}
```

Android进程在由zygote fork过程中已创建了JavaVM，每一个进程对应一个JavaVM。在这里只是将当前进程的JavaVM实例保存在静态变量，再将当前线程和JavaVM建立关联，获取JNIEnv实例，每个线程对应一个JNIEnv实例。

#### 2.6.2 FlutterMain::Register
[-> flutter/shell/platform/android/flutter_main.cc]

```Java
bool FlutterMain::Register(JNIEnv* env) {
  static const JNINativeMethod methods[] = {
      {
          .name = "nativeInit",
          .signature = "(Landroid/content/Context;[Ljava/lang/String;Ljava/"
                       "lang/String;Ljava/lang/String;Ljava/lang/String;)V",
          .fnPtr = reinterpret_cast<void*>(&Init),
      },
      {
          .name = "nativeRecordStartTimestamp",
          .signature = "(J)V",
          .fnPtr = reinterpret_cast<void*>(&RecordStartTimestamp),
      },
  };

  jclass clazz = env->FindClass("io/flutter/view/FlutterMain");
  ...
  return env->RegisterNatives(clazz, methods, arraysize(methods)) == 0;
}
```

注册了FlutterMain的nativeInit和nativeRecordStartTimestamp的两方法，JNI注册更多详情见[Android JNI原理分析](http://gityuan.com/2016/05/28/android-jni/)。


#### 2.6.3 PlatformViewAndroid::Register
[-> flutter/shell/platform/android/platform_view_android_jni.cc]

```Java
bool PlatformViewAndroid::Register(JNIEnv* env) {
  g_flutter_callback_info_class = new fml::jni::ScopedJavaGlobalRef<jclass>(
      env, env->FindClass("io/flutter/view/FlutterCallbackInformation"));

  g_flutter_callback_info_constructor = env->GetMethodID(
      g_flutter_callback_info_class->obj(), "<init>",
      "(Ljava/lang/String;Ljava/lang/String;Ljava/lang/String;)V");

  g_flutter_jni_class = new fml::jni::ScopedJavaGlobalRef<jclass>(
      env, env->FindClass("io/flutter/embedding/engine/FlutterJNI"));

  g_surface_texture_class = new fml::jni::ScopedJavaGlobalRef<jclass>(
      env, env->FindClass("android/graphics/SurfaceTexture"));

  static const JNINativeMethod callback_info_methods[] = {
      {
          .name = "nativeLookupCallbackInformation",
          .signature = "(J)Lio/flutter/view/FlutterCallbackInformation;",
          .fnPtr = reinterpret_cast<void*>(&shell::LookupCallbackInformation),
      },
  };
  //注册FlutterCallbackInformation类的Native方法
  env->RegisterNatives(g_flutter_callback_info_class->obj(),
                           callback_info_methods,
                           arraysize(callback_info_methods)) != 0);

  g_is_released_method =
      env->GetMethodID(g_surface_texture_class->obj(), "isReleased", "()Z");

  g_attach_to_gl_context_method = env->GetMethodID(
      g_surface_texture_class->obj(), "attachToGLContext", "(I)V");

  g_update_tex_image_method =
      env->GetMethodID(g_surface_texture_class->obj(), "updateTexImage", "()V");

  g_get_transform_matrix_method = env->GetMethodID(
      g_surface_texture_class->obj(), "getTransformMatrix", "([F)V");

  g_detach_from_gl_context_method = env->GetMethodID(
      g_surface_texture_class->obj(), "detachFromGLContext", "()V");

  return RegisterApi(env);  //这里注册了更多Native方法
}

bool RegisterApi(JNIEnv* env) {
  static const JNINativeMethod flutter_jni_methods[] = {
      {
          .name = "nativeAttach",
          .signature = "(Lio/flutter/embedding/engine/FlutterJNI;Z)J",
          .fnPtr = reinterpret_cast<void*>(&AttachJNI),
      },
      ...  //省略若干个方法
      {
          .name = "nativeSurfaceCreated",
          .signature = "(JLandroid/view/Surface;)V",
          .fnPtr = reinterpret_cast<void*>(&SurfaceCreated),
      },
  };

  if (env->RegisterNatives(g_flutter_jni_class->obj(), flutter_jni_methods,
                           arraysize(flutter_jni_methods)) != 0) {
    return false;
  }

  g_handle_platform_message_method =
      env->GetMethodID(g_flutter_jni_class->obj(), "handlePlatformMessage",
                       "(Ljava/lang/String;[BI)V");

  ...  //省略若干个方法
  g_update_semantics_method =
      env->GetMethodID(g_flutter_jni_class->obj(), "updateSemantics",
                       "(Ljava/nio/ByteBuffer;[Ljava/lang/String;)V");
  ...
  return true;
}
```

该方法的主要工作：通过RegisterNatives()注册一些类的Native方法，用于Java调用C++的过程；通过GetMethodID()等方法记录了一些Java方法的jmethodID，用于C++调用Java的过程。将以上方法以及RegisterApi的内容全部展开，完成如下注册：

- 完成注册以下类中的所有Native方法，用于Java调用C++：
  - FlutterCallbackInformation （1个native方法）
  - FlutterJNI （nativeSurfaceCreated等21个native方法）
- 完成记录以下类中的相关Java方法，用于于C++调用Java：
  - FlutterCallbackInformation （1个方法）
  - SurfaceTexture （5个方法）
  - FlutterJNI （handlePlatformMessage等6个方法）

#### 2.6.4 VsyncWaiterAndroid::Register
[-> flutter/shell/platform/android/vsync_waiter_android.cc]

```Java
bool VsyncWaiterAndroid::Register(JNIEnv* env) {
  static const JNINativeMethod methods[] = {{
      .name = "nativeOnVsync",
      .signature = "(JJJ)V",
      .fnPtr = reinterpret_cast<void*>(&OnNativeVsync),
  }};

  jclass clazz = env->FindClass("io/flutter/view/VsyncWaiter");

  g_vsync_waiter_class = new fml::jni::ScopedJavaGlobalRef<jclass>(env, clazz);

  g_async_wait_for_vsync_method_ = env->GetStaticMethodID(
      g_vsync_waiter_class->obj(), "asyncWaitForVsync", "(J)V");

  return env->RegisterNatives(clazz, methods, arraysize(methods)) == 0;
}
```

该注册过程主要工作：

- 将Java层的VsyncWaiter类的nativeOnVsync()方法，映射到C++层的OnNativeVsync()方法，用于该方法的Java调用C++的过程；
- 将Java层的VsyncWaiter类的asyncWaitForVsync()方法，保存到C++层的g_async_wait_for_vsync_method_变量，用于该方法C++调用Java的过程。


### 2.7 nativeRecordStartTimestamp
[-> flutter/shell/platform/android/flutter_main.cc]

```Java
static void RecordStartTimestamp(JNIEnv* env,
                                 jclass jcaller,
                                 jlong initTimeMillis) {
  int64_t initTimeMicros =
      static_cast<int64_t>(initTimeMillis) * static_cast<int64_t>(1000);
  flutter::engine_main_enter_ts = Dart_TimelineGetMicros() - initTimeMicros;
}
```

nativeRecordStartTimestamp这是一个native方法，经过JNI调用会执行nativeRecordStartTimestamp()方法，记录引擎启动耗时时长。

## 三、FlutterActivity启动流程

### 3.1 FlutterActivity.onCreate
[-> platform/android/io/flutter/app/FlutterActivity.java]

```Java
public class FlutterActivity extends Activity implements FlutterView.Provider, PluginRegistry, ViewFactory {    
    private final FlutterActivityDelegate delegate = new FlutterActivityDelegate(this, this);
    private final FlutterActivityEvents eventDelegate = delegate;
    private final FlutterView.Provider viewProvider = delegate;
    private final PluginRegistry pluginRegistry = delegate;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        eventDelegate.onCreate(savedInstanceState); //[见小节3.2]
    }
}
```

FlutterActivity的工作基本全权委托给FlutterActivityDelegate类，包括onCreate()，onResume()等全部的生命周期回调方法。

### 3.2 FlutterActivityDelegate.onCreate
[-> FlutterActivityDelegate.java]

```Java
public void onCreate(Bundle savedInstanceState) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
        Window window = activity.getWindow();
        window.addFlags(LayoutParams.FLAG_DRAWS_SYSTEM_BAR_BACKGROUNDS);
        window.setStatusBarColor(0x40000000);
        window.getDecorView().setSystemUiVisibility(PlatformPlugin.DEFAULT_SYSTEM_UI);
    }
    //从Intent中提取参数
    String[] args = getArgsFromIntent(activity.getIntent());
    // [见小节3.3]
    FlutterMain.ensureInitializationComplete(activity.getApplicationContext(), args);
    //此处viewFactory便是FlutterActivity，该方法目前返回值为null
    flutterView = viewFactory.createFlutterView(activity);
    if (flutterView == null) {
        //nativeView同样是null
        FlutterNativeView nativeView = viewFactory.createFlutterNativeView();
        //[见小节3.4]
        flutterView = new FlutterView(activity, null, nativeView);
        flutterView.setLayoutParams(matchParent);
        activity.setContentView(flutterView);
        launchView = createLaunchView();
        if (launchView != null) {
            addLaunchView();
        }
    }

    if (loadIntent(activity.getIntent())) {
        return;
    }

    String appBundlePath = FlutterMain.findAppBundlePath(activity.getApplicationContext());
    if (appBundlePath != null) {
        //[见小节5.1]
        runBundle(appBundlePath);
    }
}
```

getArgsFromIntent()方法会从Intent中提取的参数如下：

|参数|说明|
|trace-startup|跟踪应用程序的生命周期，自动切换到无大小限制的trace buffer|
|start-paused|启动应用后暂停在Dart调试器，等待调试链接|
|disable-service-auth-codes|关闭跟VM服务通信需要认证的功能|
|use-test-fonts|在各平台的文本布局和测量都不一致，启用该选项将字体分辨率默认为所有的Ahem测试字体|
|enable-dart-profiling|开启Dart profile，结果可通过observatory查看|
|enable-software-rendering|开启Skia的软件渲染方式，用于在模拟器上测试Flutter。默认情况是采用OpenGL或Vulkan|
|skia-deterministic-rendering|跳过SkGraphics::Init()的调用，从而避免某些Skia函数被swap out，保证Skia渲染的100%确定性行为|
|trace-skia|跟踪skia调用，用于调试GPU。默认关闭，以减少跟踪事件数量|
|trace-systrace|采用系统tracer，替代timeline，目前仅支持Android和Fuchsia|
|dump-skp-on-shader-compilation|自动转储触发新着色器编译的skp，默认关闭|
|verbose-logging|默认仅打开error级别的日志，此标志能开启所有严重级别日志|

这些开关都需要再一一实践和使用。

### 3.3 ensureInitializationComplete
[-> FlutterMain.java]

```Java
public static void ensureInitializationComplete(Context applicationContext, String[] args) {
    if (Looper.myLooper() != Looper.getMainLooper()) {
      throw new IllegalStateException("ensureInitializationComplete must be called on the main thread");
    }
    if (sSettings == null) {
      throw new IllegalStateException("ensureInitializationComplete must be called after startInitialization");
    }
    if (sInitialized) {
        return;
    }
    try {
        sResourceExtractor.waitForCompletion();

        List<String> shellArgs = new ArrayList<>();

        shellArgs.add("--icu-symbol-prefix=_binary_icudtl_dat");
        ApplicationInfo applicationInfo = applicationContext.getPackageManager().getApplicationInfo(
            applicationContext.getPackageName(), PackageManager.GET_META_DATA);
        shellArgs.add("--icu-native-lib-path=" + applicationInfo.nativeLibraryDir + File.separator + DEFAULT_LIBRARY);
        //args赋值过程为getArgsFromIntent()
        if (args != null) {
            Collections.addAll(shellArgs, args);
        }
        if (sIsPrecompiledAsSharedLibrary) {
            shellArgs.add("--" + AOT_SHARED_LIBRARY_PATH + "=" +
                new File(PathUtils.getDataDirectory(applicationContext), sAotSharedLibraryPath));
        } else {
            if (sIsPrecompiledAsBlobs) {
                shellArgs.add("--" + AOT_SNAPSHOT_PATH_KEY + "=" +
                    PathUtils.getDataDirectory(applicationContext));
            } else {
                shellArgs.add("--cache-dir-path=" +
                    PathUtils.getCacheDirectory(applicationContext));

                shellArgs.add("--" + AOT_SNAPSHOT_PATH_KEY + "=" +
                    PathUtils.getDataDirectory(applicationContext) + "/" + sFlutterAssetsDir);
            }
            shellArgs.add("--" + AOT_VM_SNAPSHOT_DATA_KEY + "=" + sAotVmSnapshotData);
            shellArgs.add("--" + AOT_VM_SNAPSHOT_INSTR_KEY + "=" + sAotVmSnapshotInstr);
            shellArgs.add("--" + AOT_ISOLATE_SNAPSHOT_DATA_KEY + "=" + sAotIsolateSnapshotData);
            shellArgs.add("--" + AOT_ISOLATE_SNAPSHOT_INSTR_KEY + "=" + sAotIsolateSnapshotInstr);
        }

        if (sSettings.getLogTag() != null) {
            shellArgs.add("--log-tag=" + sSettings.getLogTag());
        }

        String appBundlePath = findAppBundlePath(applicationContext);
        String appStoragePath = PathUtils.getFilesDir(applicationContext);
        String engineCachesPath = PathUtils.getCacheDirectory(applicationContext);
        //[见小节3.3.1]
        nativeInit(applicationContext, shellArgs.toArray(new String[0]),
            appBundlePath, appStoragePath, engineCachesPath);
        sInitialized = true;
    } catch (Exception e) {
        throw new RuntimeException(e);
    }
}
```

该方法重要工作：

- 保证该操作运行在主线程；
- 保证sSettings完成初始化赋值；
- 保证sResourceExtractor完成资源文件的提取工作；
- 拼接所有相关的shellArgs，包括intent中的参数；
- 执行nativeInit来初始化native相关信息；

#### 3.3.1 nativeInit
[-> flutter/shell/platform/android/flutter_main.cc]

```Java
void FlutterMain::Init(JNIEnv* env,
                       jclass clazz,
                       jobject context,
                       jobjectArray jargs,
                       jstring bundlePath,
                       jstring appStoragePath,
                       jstring engineCachesPath) {
  std::vector<std::string> args;
  args.push_back("flutter");
  for (auto& arg : fml::jni::StringArrayToVector(env, jargs)) {
    args.push_back(std::move(arg));
  }
  auto command_line = fml::CommandLineFromIterators(args.begin(), args.end());
  //根据args生成Settings结构体，记录所有相关参数
  auto settings = SettingsFromCommandLine(command_line);

  settings.assets_path = fml::jni::JavaStringToString(env, bundlePath);

  flutter::DartCallbackCache::SetCachePath(
      fml::jni::JavaStringToString(env, appStoragePath));

  fml::paths::InitializeAndroidCachesPath(
      fml::jni::JavaStringToString(env, engineCachesPath));
  //从磁盘中加载缓存
  flutter::DartCallbackCache::LoadCacheFromDisk();

  if (!flutter::DartVM::IsRunningPrecompiledCode()) {
    auto application_kernel_path =
        fml::paths::JoinPaths({settings.assets_path, "kernel_blob.bin"});
    if (fml::IsFile(application_kernel_path)) {
      settings.application_kernel_asset = application_kernel_path;
    }
  }
  //初始化observer的增加和删除方法
  settings.task_observer_add = [](intptr_t key, fml::closure callback) {
    fml::MessageLoop::GetCurrent().AddTaskObserver(key, std::move(callback));
  };

  settings.task_observer_remove = [](intptr_t key) {
    fml::MessageLoop::GetCurrent().RemoveTaskObserver(key);
  };

  g_flutter_main.reset(new FlutterMain(std::move(settings)));
}
```

小节2.6.2注册了nativeInit所对应的方法FlutterMain::Init()，该方法主要功能args以及各种资源文件路径细信息都保存在Settings结构体，记录在FlutterMain中，最后记录在g_flutter_main静态变量。

### 3.4 FlutterView初始化
[-> platform/android/io/flutter/view/FlutterView.java]

```Java
public class FlutterView extends SurfaceView implements BinaryMessenger, TextureRegistry {

  public FlutterView(Context context, AttributeSet attrs, FlutterNativeView nativeView) {
      super(context, attrs);

      Activity activity = getActivity(getContext());

      if (nativeView == null) {
          //初始化FlutterNativeView [见小节3.4.1]
          mNativeView = new FlutterNativeView(activity.getApplicationContext());
      } else {
          mNativeView = nativeView;
      }

      dartExecutor = mNativeView.getDartExecutor();
      flutterRenderer = new FlutterRenderer(mNativeView.getFlutterJNI());
      mIsSoftwareRenderingEnabled = FlutterJNI.nativeGetIsSoftwareRenderingEnabled();
      mMetrics = new ViewportMetrics();
      mMetrics.devicePixelRatio = context.getResources().getDisplayMetrics().density;
      setFocusable(true);
      setFocusableInTouchMode(true);

      mNativeView.attachViewAndActivity(this, activity);

      mSurfaceCallback = new SurfaceHolder.Callback() {
          @Override
          public void surfaceCreated(SurfaceHolder holder) {
              assertAttached();
              mNativeView.getFlutterJNI().onSurfaceCreated(holder.getSurface());
          }

          @Override
          public void surfaceChanged(SurfaceHolder holder, int format, int width, int height) {
              assertAttached();
              mNativeView.getFlutterJNI().onSurfaceChanged(width, height);
          }

          @Override
          public void surfaceDestroyed(SurfaceHolder holder) {
              assertAttached();
              mNativeView.getFlutterJNI().onSurfaceDestroyed();
          }
      };
      getHolder().addCallback(mSurfaceCallback);

      mActivityLifecycleListeners = new ArrayList<>();
      mFirstFrameListeners = new ArrayList<>();

      //创建所有的平台通道channels
      navigationChannel = new NavigationChannel(dartExecutor);
      keyEventChannel = new KeyEventChannel(dartExecutor);
      lifecycleChannel = new LifecycleChannel(dartExecutor);
      localizationChannel = new LocalizationChannel(dartExecutor);
      platformChannel = new PlatformChannel(dartExecutor);
      systemChannel = new SystemChannel(dartExecutor);
      settingsChannel = new SettingsChannel(dartExecutor);

      //创建并设置插件
      PlatformPlugin platformPlugin = new PlatformPlugin(activity, platformChannel);
      addActivityLifecycleListener(platformPlugin);
      mImm = (InputMethodManager) getContext().getSystemService(Context.INPUT_METHOD_SERVICE);
      mTextInputPlugin = new TextInputPlugin(this, dartExecutor);
      androidKeyProcessor = new AndroidKeyProcessor(keyEventChannel, mTextInputPlugin);
      androidTouchProcessor = new AndroidTouchProcessor(flutterRenderer);

      //发送初始化平台台的消息发送给Dart
      sendLocalesToDart(getResources().getConfiguration());
      sendUserPlatformSettingsToDart();
  }
  ...
}
```

#### 3.4.1 FlutterNativeView初始化
[-> FlutterNativeView.java]

```Java
public class FlutterNativeView implements BinaryMessenger {
  public FlutterNativeView(@NonNull Context context) {
      this(context, false);
  }

  public FlutterNativeView(@NonNull Context context, boolean isBackgroundView) {
      mContext = context;
      mPluginRegistry = new FlutterPluginRegistry(this, context);
      mFlutterJNI = new FlutterJNI();
      mFlutterJNI.setRenderSurface(new RenderSurfaceImpl());
      this.dartExecutor = new DartExecutor(mFlutterJNI);
      mFlutterJNI.addEngineLifecycleListener(new EngineLifecycleListenerImpl());
      attach(this, isBackgroundView); //[见小节3.4.2]
  }
}
```

该方法主功能：

- 初始化对象FlutterPluginRegistry；
- 初始化对象FlutterJNI；
- 初始化对象RenderSurfaceImpl，并赋值给mFlutterJNI的成员变量renderSurface；
- 初始化对象DartExecutor；
- 设置引擎生命周期回调监听器；
- 并执行attach方法

#### 3.4.2 FlutterNativeView.attach
[-> FlutterNativeView.java]

```Java
private void attach(FlutterNativeView view, boolean isBackgroundView) {
    mFlutterJNI.attachToNative(isBackgroundView); //[见小节3.4.3]
    //将dartExecutor.messenger赋值给mFlutterJNI.platformMessageHandler
    dartExecutor.onAttachedToJNI();
}
```

[小节2.6.3]的过程已经注册了FlutterJNI的attachToNative()方法，相对应的Native方法为AttachJNI()

#### 3.4.3 FlutterJNI.attachToNative
[-> FlutterJNI.java]

```Java
public void attachToNative(boolean isBackgroundView) {
  nativePlatformViewId = nativeAttach(this, isBackgroundView);  //[见小节3.4.4]
}
```

#### 3.4.4 AttachJNI
[-> flutter/shell/platform/android/platform_view_android_jni.cc]

```Java
static jlong AttachJNI(JNIEnv* env,
                       jclass clazz,
                       jobject flutterJNI,
                       jboolean is_background_view) {
  fml::jni::JavaObjectWeakGlobalRef java_object(env, flutterJNI);
   //[见小节3.4.4]
  auto shell_holder = std::make_unique<AndroidShellHolder>(
      FlutterMain::Get().GetSettings(), java_object, is_background_view);
  if (shell_holder->IsValid()) {
    return reinterpret_cast<jlong>(shell_holder.release());
  } else {
    return 0;
  }
}
```

该方法主要是为了在引擎层初始化AndroidShellHolder对象。


## 四、Flutter引擎启动

### 4.1 AndroidShellHolder初始化
[-> flutter/shell/platform/android/android_shell_holder.cc]

```Java
AndroidShellHolder::AndroidShellHolder(
    flutter::Settings settings,
    fml::jni::JavaObjectWeakGlobalRef java_object,
    bool is_background_view)
    : settings_(std::move(settings)), java_object_(java_object) {
  static size_t shell_count = 1;
  auto thread_label = std::to_string(shell_count++);
  //创建线程私有的key
  FML_CHECK(pthread_key_create(&thread_destruct_key_, ThreadDestructCallback) ==
            0);

  if (is_background_view) {
    thread_host_ = {thread_label, ThreadHost::Type::UI};
  } else {
    //创建目标线程[见小节4.2]
    thread_host_ = {thread_label, ThreadHost::Type::UI | ThreadHost::Type::GPU |
                                      ThreadHost::Type::IO};
  }

  //当UI和GPU线程退出时从JNI分离。
  auto jni_exit_task([key = thread_destruct_key_]() {
    FML_CHECK(pthread_setspecific(key, reinterpret_cast<void*>(1)) == 0);
  });
  thread_host_.ui_thread->GetTaskRunner()->PostTask(jni_exit_task);
  if (!is_background_view) {
    thread_host_.gpu_thread->GetTaskRunner()->PostTask(jni_exit_task);
  }

  fml::WeakPtr<PlatformViewAndroid> weak_platform_view;
  Shell::CreateCallback<PlatformView> on_create_platform_view =
      [is_background_view, java_object, &weak_platform_view](Shell& shell) {
        std::unique_ptr<PlatformViewAndroid> platform_view_android;
        if (is_background_view) {
          ...
        } else {
          platform_view_android = std::make_unique<PlatformViewAndroid>(
              shell,                  
              shell.GetTaskRunners(),  
              java_object,           
              shell.GetSettings().enable_software_rendering
          );
        }
        weak_platform_view = platform_view_android->GetWeakPtr();
        return platform_view_android;
      };

  Shell::CreateCallback<Rasterizer> on_create_rasterizer = [](Shell& shell) {
    return std::make_unique<Rasterizer>(shell.GetTaskRunners());
  };

  // 当前主线程初始化MesageLoop [见小节4.2.2]
  fml::MessageLoop::EnsureInitializedForCurrentThread();
  fml::RefPtr<fml::TaskRunner> gpu_runner;
  fml::RefPtr<fml::TaskRunner> ui_runner;
  fml::RefPtr<fml::TaskRunner> io_runner;
  fml::RefPtr<fml::TaskRunner> platform_runner =
      fml::MessageLoop::GetCurrent().GetTaskRunner();
  if (is_background_view) {
    ...
  } else {
    gpu_runner = thread_host_.gpu_thread->GetTaskRunner();
    ui_runner = thread_host_.ui_thread->GetTaskRunner();
    io_runner = thread_host_.io_thread->GetTaskRunner();
  }
  //创建task_runners对象
  flutter::TaskRunners task_runners(thread_label,    
                                    platform_runner, gpu_runner,    
                                    ui_runner,  io_runner );
  // 创建Shell对象 [见小节4.3]
  shell_ =  Shell::Create(task_runners, settings_,              
                    on_create_platform_view,  on_create_rasterizer);

  platform_view_ = weak_platform_view;
  is_valid_ = shell_ != nullptr;
  if (is_valid_) {
    //提升ui线程和gpu线程的优先级
    task_runners.GetGPUTaskRunner()->PostTask([]() {
      if (::setpriority(PRIO_PROCESS, gettid(), -5) != 0) {
        if (::setpriority(PRIO_PROCESS, gettid(), -2) != 0) {
          FML_LOG(ERROR) << "Failed to set GPU task runner priority";
        }
      }
    });
    task_runners.GetUITaskRunner()->PostTask([]() {
      if (::setpriority(PRIO_PROCESS, gettid(), -1) != 0) {
        FML_LOG(ERROR) << "Failed to set UI task runner priority";
      }
    });
  }
}
```

该方法的主要功能：

- 创建ui，gpu，io这3个线程，并分别初始化MessageLoop
- on_create_platform_view
- on_create_rasterizer
- 创建Shell对象，TaskRunners对象

另外，关于pthread_key_create(pthread_key_t \*key, void (\*destructor)(void\*))，用于创建线程内私有的全局变量，其中第一个参数为key，第二参数为析构函数，等线程退出时会执行。

### 4.2 ThreadHost初始化
[-> flutter/shell/common/thread_host.cc]

```Java
ThreadHost::ThreadHost(std::string name_prefix, uint64_t mask) {
  if (mask & ThreadHost::Type::Platform) {
    platform_thread = std::make_unique<fml::Thread>(name_prefix + ".platform");
  }

  if (mask & ThreadHost::Type::UI) {
    //创建线程 [见小节4.2.1]
    ui_thread = std::make_unique<fml::Thread>(name_prefix + ".ui");
  }

  if (mask & ThreadHost::Type::GPU) {
    gpu_thread = std::make_unique<fml::Thread>(name_prefix + ".gpu");
  }

  if (mask & ThreadHost::Type::IO) {
    io_thread = std::make_unique<fml::Thread>(name_prefix + ".io");
  }
}
```

根据传递的参数，可知首次创建AndroidShellHolder实例的过程，会创建3个线程分别为1.ui, 1.gpu, 1.io。


#### 4.2.1 Thread初始化
[-> flutter/fml/thread.cc]

```Java
Thread::Thread(const std::string& name) : joined_(false) {
  fml::AutoResetWaitableEvent latch;
  fml::RefPtr<fml::TaskRunner> runner;
  thread_ = std::make_unique<std::thread>([&latch, &runner, name]() -> void {
    SetCurrentThreadName(name); //设置线程名
    fml::MessageLoop::EnsureInitializedForCurrentThread(); //初始化 [见小节4.2.2]
    auto& loop = MessageLoop::GetCurrent();
    runner = loop.GetTaskRunner();
    latch.Signal();
    loop.Run(); //运行 [见小节4.2.7]
  });
  latch.Wait();
  task_runner_ = runner;
}
```

#### 4.2.2 EnsureInitializedForCurrentThread
[-> flutter/fml/message_loop.cc]

```Java
FML_THREAD_LOCAL ThreadLocal tls_message_loop([](intptr_t value) {
  delete reinterpret_cast<MessageLoop*>(value);
});

void MessageLoop::EnsureInitializedForCurrentThread() {
  if (tls_message_loop.Get() != 0) {
    return;  //保证只初始化一次
  }
  //创建MessageLoop，并保持在tls_message_loop [见小节4.2.3]
  tls_message_loop.Set(reinterpret_cast<intptr_t>(new MessageLoop()));
}
```

创建MessageLoop对象保存在ThreadLocal类型的tls_message_loop变量中。


#### 4.2.3 MessageLoop初始化
[-> flutter/fml/message_loop.cc]

```Java
MessageLoop::MessageLoop()
    : loop_(MessageLoopImpl::Create()),  //[见小节4.2.4]
      //[见小节4.2.6]
      task_runner_(fml::MakeRefCounted<fml::TaskRunner>(loop_)) {
}
```

创建MessageLoopAndroid对象和TaskRunner对象，并保持在当前的MessageLoop对象的成员变量。


#### 4.2.4 MessageLoopImpl::Create
[-> flutter/fml/message_loop_impl.cc]

```Java
fml::RefPtr<MessageLoopImpl> MessageLoopImpl::Create() {
#if OS_MACOSX
  return fml::MakeRefCounted<MessageLoopDarwin>();
#elif OS_ANDROID
  return fml::MakeRefCounted<MessageLoopAndroid>(); //[见小节4.2.5]
#elif OS_LINUX
  return fml::MakeRefCounted<MessageLoopLinux>();
#elif OS_WIN
  return fml::MakeRefCounted<MessageLoopWin>();
#else
  return nullptr;
#endif
}
```

针对Android平台，则MessageLoopImpl的实例为MessageLoopAndroid。

#### 4.2.5 MessageLoopAndroid初始化
[-> flutter/fml/platform/android/message_loop_android.cc]

```Java
MessageLoopAndroid::MessageLoopAndroid()
    : looper_(AcquireLooperForThread()),
      timer_fd_(::timerfd_create(kClockType, TFD_NONBLOCK | TFD_CLOEXEC)),
      running_(false) {
  static const int kWakeEvents = ALOOPER_EVENT_INPUT;

  ALooper_callbackFunc read_event_fd = [](int, int events, void* data) -> int {
    if (events & kWakeEvents) {
      //不断受到回调
      reinterpret_cast<MessageLoopAndroid*>(data)->OnEventFired();
    }
    return 1;
  };

  int add_result = ::ALooper_addFd(looper_.get(),          // looper
                                   timer_fd_.get(),        // fd
                                   ALOOPER_POLL_CALLBACK,  // ident
                                   kWakeEvents,            // events
                                   read_event_fd,          // callback
                                   this                    // baton
  );
}
```

执行完MessageLoopAndroid初始化后，回到[小节4.2.3]，接着开始执行TaskRunner初始化。

#### 4.2.6 TaskRunner初始化
[-> flutter/fml/task_runner.cc]

```Java
TaskRunner::TaskRunner(fml::RefPtr<MessageLoopImpl> loop)
    : loop_(std::move(loop)) {}
```


#### 4.2.7 MessageLoopAndroid::Run
[-> flutter/fml/platform/android/message_loop_android.cc]

```Java
void MessageLoopAndroid::Run() {
  running_ = true;

  while (running_) {
    int result = ::ALooper_pollOnce(-1,       // infinite timeout
                                    nullptr,  // out fd,
                                    nullptr,  // out events,
                                    nullptr   // out data
    );
    if (result == ALOOPER_POLL_TIMEOUT || result == ALOOPER_POLL_ERROR) {
      // 处理使用ALooper API终止循环的情况
      running_ = false;
    }
  }
}
```

该线程处于pollOnce轮询等待的状态。

### 4.3 Shell::Create
[-> flutter/shell/common/shell.cc]

```Java
std::unique_ptr<Shell> Shell::Create(
    TaskRunners task_runners,
    Settings settings,
    Shell::CreateCallback<PlatformView> on_create_platform_view,
    Shell::CreateCallback<Rasterizer> on_create_rasterizer) {
  PerformInitializationTasks(settings); //[见小节4.3.1]

  TRACE_EVENT0("flutter", "Shell::Create");

  auto vm = DartVMRef::Create(settings); //[见小节4.4]
  auto vm_data = vm->GetVMData();
  //[见小节4.5]
  return Shell::Create(std::move(task_runners),             
                       std::move(settings),                 
                       vm_data->GetIsolateSnapshot(),       // isolate snapshot
                       DartSnapshot::Empty(),               // shared snapshot
                       std::move(on_create_platform_view),  
                       std::move(on_create_rasterizer),     
                       std::move(vm)                        
  );
}
```

#### 4.3.1 PerformInitializationTasks
[-> flutter/shell/common/shell.cc]

```Java
static void PerformInitializationTasks(const Settings& settings) {
  {
    fml::LogSettings log_settings;
    //设置log输出的最小级别
    log_settings.min_log_level =
        settings.verbose_logging ? fml::LOG_INFO : fml::LOG_ERROR;
    fml::SetLogSettings(log_settings);
  }

  static std::once_flag gShellSettingsInitialization = {};
  std::call_once(gShellSettingsInitialization, [&settings] {
    RecordStartupTimestamp(); //记录启动时间

    tonic::SetLogHandler([](const char* message) { FML_LOG(ERROR) << message; });

    if (settings.trace_skia) {
      InitSkiaEventTracer(settings.trace_skia);
    }

    if (!settings.skia_deterministic_rendering_on_cpu) {
      SkGraphics::Init();
    } else {
      FML_DLOG(INFO) << "Skia deterministic rendering is enabled.";
    }

    if (settings.icu_initialization_required) {
      if (settings.icu_data_path.size() != 0) {
        fml::icu::InitializeICU(settings.icu_data_path);
      } else if (settings.icu_mapper) {
        fml::icu::InitializeICUFromMapping(settings.icu_mapper());
      } else {
        FML_DLOG(WARNING) << "Skipping ICU initialization in the shell.";
      }
    }
  });
}
```

默认情况只有ERROR级别的日志才会输出，除非在启动的时候带上参数verbose_logging，则会打印出INFO级别的日志。

### 4.4 DartVMRef::Create
[-> flutter/runtime/dart_vm_lifecycle.cc]

```Java
static std::weak_ptr<DartVM> gVM;

DartVMRef DartVMRef::Create(Settings settings,
                            fml::RefPtr<DartSnapshot> vm_snapshot,
                            fml::RefPtr<DartSnapshot> isolate_snapshot,
                            fml::RefPtr<DartSnapshot> shared_snapshot) {
  std::lock_guard<std::mutex> lifecycle_lock(gVMMutex);

  //当该进程存在一个正在运行虚拟机，则获取其强引用，复用该虚拟机
  if (auto vm = gVM.lock()) {
    return DartVMRef{std::move(vm)};
  }

  std::lock_guard<std::mutex> dependents_lock(gVMDependentsMutex);
  //数据重置
  gVMData.reset();
  gVMServiceProtocol.reset();
  gVMIsolateNameServer.reset();
  gVM.reset();

  auto isolate_name_server = std::make_shared<IsolateNameServer>();
  //创建虚拟机[见小节4.4.1]
  auto vm = DartVM::Create(std::move(settings),          
                           std::move(vm_snapshot),       
                           std::move(isolate_snapshot),  
                           std::move(shared_snapshot),   
                           isolate_name_server           
  );
  ...
  gVMData = vm->GetVMData();
  gVMServiceProtocol = vm->GetServiceProtocol();
  gVMIsolateNameServer = isolate_name_server;
  gVM = vm;

  if (settings.leak_vm) {
    gVMLeak = new std::shared_ptr<DartVM>(vm);
  }

  return DartVMRef{std::move(vm)};
}
```

#### 4.4.1 DartVM::Create
[-> flutter/runtime/dart_vm.cc]

```Java
std::shared_ptr<DartVM> DartVM::Create(
    Settings settings,
    fml::RefPtr<DartSnapshot> vm_snapshot,
    fml::RefPtr<DartSnapshot> isolate_snapshot,
    fml::RefPtr<DartSnapshot> shared_snapshot,
    std::shared_ptr<IsolateNameServer> isolate_name_server) {
  auto vm_data = DartVMData::Create(settings,                     //
                                    std::move(vm_snapshot),       //
                                    std::move(isolate_snapshot),  //
                                    std::move(shared_snapshot)    //
  );
  ...
  //[见小节4.4.2]
  return std::shared_ptr<DartVM>(
      new DartVM(std::move(vm_data), std::move(isolate_name_server)));
}
```

#### 4.4.2 DartVM初始化
[-> flutter/runtime/dart_vm.cc]

```Java
DartVM::DartVM(std::shared_ptr<const DartVMData> vm_data,
               std::shared_ptr<IsolateNameServer> isolate_name_server)
    : settings_(vm_data->GetSettings()),
      vm_data_(vm_data),
      isolate_name_server_(std::move(isolate_name_server)),
      service_protocol_(std::make_shared<ServiceProtocol>()) {
  TRACE_EVENT0("flutter", "DartVMInitializer");
  gVMLaunchCount++;
  {
    TRACE_EVENT0("flutter", "dart::bin::BootstrapDartIo");
    dart::bin::BootstrapDartIo();
    if (!settings_.temp_directory_path.empty()) {
      dart::bin::SetSystemTempDirectory(settings_.temp_directory_path.c_str());
    }
  }

  std::vector<const char*> args;
  //忽略无法识别的flags参数
  args.push_back("--ignore-unrecognized-flags");

  for (auto* const profiler_flag :
       ProfilingFlags(settings_.enable_dart_profiling)) {
    args.push_back(profiler_flag);
  }

  PushBackAll(&args, kDartLanguageArgs, arraysize(kDartLanguageArgs));

  if (IsRunningPrecompiledCode()) {
    PushBackAll(&args, kDartPrecompilationArgs,
                arraysize(kDartPrecompilationArgs));
  }
  //当处于非预编译模式，则开启Dart断言
  bool enable_asserts = !settings_.disable_dart_asserts;

#if FLUTTER_RUNTIME_MODE == FLUTTER_RUNTIME_MODE_DYNAMIC_PROFILE || \
    FLUTTER_RUNTIME_MODE == FLUTTER_RUNTIME_MODE_DYNAMIC_RELEASE
  enable_asserts = false;
#endif

#if !OS_FUCHSIA
  if (IsRunningPrecompiledCode()) {
    enable_asserts = false;
  }
#endif

#if FLUTTER_RUNTIME_MODE == FLUTTER_RUNTIME_MODE_DEBUG
  //调试模式使用JIT，禁用代码页写保护，以避免每次编译前后的内存页保护更改
  PushBackAll(&args, kDartWriteProtectCodeArgs,
              arraysize(kDartWriteProtectCodeArgs));
#endif

  if (enable_asserts) {
    PushBackAll(&args, kDartAssertArgs, arraysize(kDartAssertArgs));
  }

  if (settings_.start_paused) {
    PushBackAll(&args, kDartStartPausedArgs, arraysize(kDartStartPausedArgs));
  }

  if (settings_.disable_service_auth_codes) {
    PushBackAll(&args, kDartDisableServiceAuthCodesArgs,
                arraysize(kDartDisableServiceAuthCodesArgs));
  }

  if (settings_.endless_trace_buffer || settings_.trace_startup) {
    //跟踪启动过程，则会开启无限大小的buffer，保证信息不被丢失
    PushBackAll(&args, kDartEndlessTraceBufferArgs,
                arraysize(kDartEndlessTraceBufferArgs));
  }

  if (settings_.trace_systrace) {
    PushBackAll(&args, kDartSystraceTraceBufferArgs,
                arraysize(kDartSystraceTraceBufferArgs));
    PushBackAll(&args, kDartTraceStreamsArgs, arraysize(kDartTraceStreamsArgs));
  }

  if (settings_.trace_startup) {
    PushBackAll(&args, kDartTraceStartupArgs, arraysize(kDartTraceStartupArgs));
  }

  for (size_t i = 0; i < settings_.dart_flags.size(); i++)
    args.push_back(settings_.dart_flags[i].c_str());

  char* flags_error = Dart_SetVMFlags(args.size(), args.data());
  ...

  DartUI::InitForGlobal();  //[见小节4.4.5]

  {
    TRACE_EVENT0("flutter", "Dart_Initialize");
    Dart_InitializeParams params = {};
    params.version = DART_INITIALIZE_PARAMS_CURRENT_VERSION;
    params.vm_snapshot_data =
        vm_data_->GetVMSnapshot().GetData()->GetSnapshotPointer();
    params.vm_snapshot_instructions =
        vm_data_->GetVMSnapshot().GetInstructionsIfPresent();
    params.create = reinterpret_cast<decltype(params.create)>(
        DartIsolate::DartIsolateCreateCallback);
    params.shutdown = reinterpret_cast<decltype(params.shutdown)>(
        DartIsolate::DartIsolateShutdownCallback);
    params.cleanup = reinterpret_cast<decltype(params.cleanup)>(
        DartIsolate::DartIsolateCleanupCallback);
    params.thread_exit = ThreadExitCallback;
    params.get_service_assets = GetVMServiceAssetsArchiveCallback;
    params.entropy_source = dart::bin::GetEntropy;
    char* init_error = Dart_Initialize(&params);

    //应用生命周期中最早的可记录时间戳发送到timeline，跟渲染第一帧时间差值，可帮忙分析Flutter的启动时间
    if (engine_main_enter_ts != 0) {
      Dart_TimelineEvent("FlutterEngineMainEnter",  // label
                         engine_main_enter_ts,      // timestamp0
                         engine_main_enter_ts,      // timestamp1_or_async_id
                         Dart_Timeline_Event_Duration,  // event type
                         0,                             // argument_count
                         nullptr,                       // argument_names
                         nullptr                        // argument_values
      );
    }
  }

  Dart_SetFileModifiedCallback(&DartFileModifiedCallback);

  //允许Dart vm输出端stdout和stderr
  Dart_SetServiceStreamCallbacks(&ServiceStreamListenCallback,
                                 &ServiceStreamCancelCallback);

  Dart_SetEmbedderInformationCallback(&EmbedderInformationCallback);

  if (settings_.dart_library_sources_kernel != nullptr) {
    std::unique_ptr<fml::Mapping> dart_library_sources =
        settings_.dart_library_sources_kernel();
    //设置dart：*库的源代码以进行调试。
    Dart_SetDartLibrarySourcesKernel(dart_library_sources->GetMapping(),
                                     dart_library_sources->GetSize());
  }
}
```

#### 4.4.3 DartUI::InitForGlobal
[-> flutter/lib/ui/dart_ui.cc]

```Java
void DartUI::InitForGlobal() {
  if (!g_natives) {
    g_natives = new tonic::DartLibraryNatives();
    Canvas::RegisterNatives(g_natives);
    CanvasGradient::RegisterNatives(g_natives);
    CanvasImage::RegisterNatives(g_natives);
    CanvasPath::RegisterNatives(g_natives);
    CanvasPathMeasure::RegisterNatives(g_natives);
    Codec::RegisterNatives(g_natives);
    DartRuntimeHooks::RegisterNatives(g_natives);
    EngineLayer::RegisterNatives(g_natives);
    FontCollection::RegisterNatives(g_natives);
    FrameInfo::RegisterNatives(g_natives);
    ImageFilter::RegisterNatives(g_natives);
    ImageShader::RegisterNatives(g_natives);
    IsolateNameServerNatives::RegisterNatives(g_natives);
    Paragraph::RegisterNatives(g_natives);
    ParagraphBuilder::RegisterNatives(g_natives);
    Picture::RegisterNatives(g_natives);
    PictureRecorder::RegisterNatives(g_natives);
    Scene::RegisterNatives(g_natives);
    SceneBuilder::RegisterNatives(g_natives);
    SceneHost::RegisterNatives(g_natives);
    SemanticsUpdate::RegisterNatives(g_natives);
    SemanticsUpdateBuilder::RegisterNatives(g_natives);
    Vertices::RegisterNatives(g_natives);
    Window::RegisterNatives(g_natives);

    // 第二个isolates不提供UI相关的APIs
    g_natives_secondary = new tonic::DartLibraryNatives();
    DartRuntimeHooks::RegisterNatives(g_natives_secondary);
    IsolateNameServerNatives::RegisterNatives(g_natives_secondary);
  }
}
```

DartLibraryNatives的Register()方法注册各种dart的native方法，用于Dart调用C++代码。

### 4.5 Shell::Create
[-> flutter/shell/common/shell.cc]

```Java
std::unique_ptr<Shell> Shell::Create(
    TaskRunners task_runners,
    Settings settings,
    fml::RefPtr<const DartSnapshot> isolate_snapshot,
    fml::RefPtr<const DartSnapshot> shared_snapshot,
    Shell::CreateCallback<PlatformView> on_create_platform_view,
    Shell::CreateCallback<Rasterizer> on_create_rasterizer,
    DartVMRef vm) {
  ...

  fml::AutoResetWaitableEvent latch;
  std::unique_ptr<Shell> shell;
  fml::TaskRunner::RunNowOrPostTask(
      task_runners.GetPlatformTaskRunner(),
      fml::MakeCopyable([&latch,                                          //
                         vm = std::move(vm),                              //
                         &shell,                                          //
                         task_runners = std::move(task_runners),          //
                         settings,                                        //
                         isolate_snapshot = std::move(isolate_snapshot),  //
                         shared_snapshot = std::move(shared_snapshot),    //
                         on_create_platform_view,                         //
                         on_create_rasterizer                             //
  ]() mutable {
        //[见小节4.5.1]
        shell = CreateShellOnPlatformThread(std::move(vm),
                                            std::move(task_runners),      //
                                            settings,                     //
                                            std::move(isolate_snapshot),  //
                                            std::move(shared_snapshot),   //
                                            on_create_platform_view,      //
                                            on_create_rasterizer          //
        );
        latch.Signal();
      }));
  latch.Wait();  //等待完成
  return shell;
}
```

#### 4.5.1 Shell::CreateShellOnPlatformThread
[-> flutter/shell/common/shell.cc]

```Java
std::unique_ptr<Shell> Shell::CreateShellOnPlatformThread(
    blink::TaskRunners task_runners,
    blink::Settings settings,
    Shell::CreateCallback<PlatformView> on_create_platform_view,
    Shell::CreateCallback<Rasterizer> on_create_rasterizer) {

    //创建Shell对象[见小节4.6]
    auto shell = std::unique_ptr<Shell>(new Shell(task_runners, settings));

    //在主线程创建platform view [见小节4.7]
    auto platform_view = on_create_platform_view(*shell.get());

    //由platform view创建vsync waiter [见小节4.8]
    auto vsync_waiter = platform_view->CreateVSyncWaiter();

    fml::AutoResetWaitableEvent io_latch;
    std::unique_ptr<ShellIOManager> io_manager;
    auto io_task_runner = shell->GetTaskRunners().GetIOTaskRunner();
    fml::TaskRunner::RunNowOrPostTask(
        io_task_runner,
        [&io_latch, &io_manager, &platform_view, io_task_runner ]() {
          TRACE_EVENT0("flutter", "ShellSetupIOSubsystem");
          // 在io线程中创建ShellIOManager对象 [见小节4.9]
          io_manager = std::make_unique<ShellIOManager>(
              platform_view->CreateResourceContext(), io_task_runner);
          io_latch.Signal();
        });
    io_latch.Wait();

    fml::AutoResetWaitableEvent gpu_latch;
    std::unique_ptr<Rasterizer> rasterizer;
    fml::WeakPtr<SnapshotDelegate> snapshot_delegate;
    fml::TaskRunner::RunNowOrPostTask(
        task_runners.GetGPUTaskRunner(),
        [&gpu_latch, &rasterizer, on_create_rasterizer, shell = shell.get(), &snapshot_delegate]() {
          TRACE_EVENT0("flutter", "ShellSetupGPUSubsystem");
          // 在gpu线程中创建Rasterizer对象 [见小节4.10]
          if (auto new_rasterizer = on_create_rasterizer(*shell)) {
            rasterizer = std::move(new_rasterizer);
            snapshot_delegate = rasterizer->GetSnapshotDelegate();
          }
          gpu_latch.Signal();
        });
    gpu_latch.Wait();

    fml::AutoResetWaitableEvent ui_latch;
    std::unique_ptr<Engine> engine;
    fml::TaskRunner::RunNowOrPostTask(
        shell->GetTaskRunners().GetUITaskRunner(),
        fml::MakeCopyable([&ui_latch,                                         //
                           &engine,                                           //
                           shell = shell.get(),                               //
                           isolate_snapshot = std::move(isolate_snapshot),    //
                           shared_snapshot = std::move(shared_snapshot),      //
                           vsync_waiter = std::move(vsync_waiter),            //
                           snapshot_delegate = std::move(snapshot_delegate),  //
                           io_manager = io_manager->GetWeakPtr()              //
    ]() mutable {
          TRACE_EVENT0("flutter", "ShellSetupUISubsystem");
          const auto& task_runners = shell->GetTaskRunners();
          // 创建Animator对象 [见小节4.11]
          auto animator = std::make_unique<Animator>(*shell, task_runners,
                                                     std::move(vsync_waiter));
          // 在ui线程中创建Engine对象 [见小节4.12]
          engine = std::make_unique<Engine>(*shell,                        //
                                            *shell->GetDartVM(),           //
                                            std::move(isolate_snapshot),   //
                                            std::move(shared_snapshot),    //
                                            task_runners,                  //
                                            shell->GetSettings(),          //
                                            std::move(animator),           //
                                            std::move(snapshot_delegate),  //
                                            std::move(io_manager)          //
          );
          ui_latch.Signal();
        }));

    ui_latch.Wait();

    // [见小节4.13]
    if (!shell->Setup(std::move(platform_view), std::move(engine),      
                      std::move(rasterizer), std::move(io_manager))  
    ) {
      return nullptr;
    }
    return shell;
}
```

### 4.6 Shell初始化
[-> flutter/shell/common/shell.cc]

```Java
Shell::Shell(DartVMRef vm, TaskRunners task_runners, Settings settings)
    : task_runners_(std::move(task_runners)),
      settings_(std::move(settings)),
      vm_(std::move(vm)) {
  //运行在主线程，设置service protocol handlers
  service_protocol_handlers_[ServiceProtocol::kScreenshotExtensionName
                                 .ToString()] = {
      task_runners_.GetGPUTaskRunner(),
      std::bind(&Shell::OnServiceProtocolScreenshot, this,
                std::placeholders::_1, std::placeholders::_2)};
  service_protocol_handlers_[ServiceProtocol::kScreenshotSkpExtensionName
                                 .ToString()] = {
      task_runners_.GetGPUTaskRunner(),
      std::bind(&Shell::OnServiceProtocolScreenshotSKP, this,
                std::placeholders::_1, std::placeholders::_2)};
  service_protocol_handlers_[ServiceProtocol::kRunInViewExtensionName
                                 .ToString()] = {
      task_runners_.GetUITaskRunner(),
      std::bind(&Shell::OnServiceProtocolRunInView, this, std::placeholders::_1,
                std::placeholders::_2)};
  service_protocol_handlers_[ServiceProtocol::kFlushUIThreadTasksExtensionName
                                 .ToString()] = {
      task_runners_.GetUITaskRunner(),
      std::bind(&Shell::OnServiceProtocolFlushUIThreadTasks, this,
                std::placeholders::_1, std::placeholders::_2)};
  service_protocol_handlers_[ServiceProtocol::kSetAssetBundlePathExtensionName
                                 .ToString()] = {
      task_runners_.GetUITaskRunner(),
      std::bind(&Shell::OnServiceProtocolSetAssetBundlePath, this,
                std::placeholders::_1, std::placeholders::_2)};
  service_protocol_handlers_
      [ServiceProtocol::kGetDisplayRefreshRateExtensionName.ToString()] = {
          task_runners_.GetUITaskRunner(),
          std::bind(&Shell::OnServiceProtocolGetDisplayRefreshRate, this,
                    std::placeholders::_1, std::placeholders::_2)};
}
```

创建Shell对象，成员变量task_runners_、settings_以及vm_富初值

### 4.7 PlatformViewAndroid初始化
[-> flutter/shell/platform/android/platform_view_android.cc]

```Java
PlatformViewAndroid::PlatformViewAndroid(
    PlatformView::Delegate& delegate,
    flutter::TaskRunners task_runners,
    fml::jni::JavaObjectWeakGlobalRef java_object,
    bool use_software_rendering)
    : PlatformView(delegate, std::move(task_runners)),
      java_object_(java_object),
      //[见小节4.7.1]
      android_surface_(AndroidSurface::Create(use_software_rendering)) {
}
```

on_create_platform_view方法的核心就是创建PlatformViewAndroid对象

#### 4.7.1 AndroidSurface::Create
[-> flutter/shell/platform/android/android_surface.cc]

```Java
std::unique_ptr<AndroidSurface> AndroidSurface::Create(
    bool use_software_rendering) {
  if (use_software_rendering) {
    auto software_surface = std::make_unique<AndroidSurfaceSoftware>();
    return software_surface->IsValid() ? std::move(software_surface) : nullptr;
  }
#if SHELL_ENABLE_VULKAN
  auto vulkan_surface = std::make_unique<AndroidSurfaceVulkan；>();
  return vulkan_surface->IsValid() ? std::move(vulkan_surface) : nullptr;
#else  
  auto gl_surface = std::make_unique<AndroidSurfaceGL>();
  return gl_surface->IsOffscreenContextValid() ? std::move(gl_surface)
                                               : nullptr;
#endif  
}
```

三种不同的[AndroidSurface](http://gityuan.com/img/flutter_gpu/ClassSurface.jpg)，目前android_surface_默认数据类型为AndroidSurfaceGL。

#### 4.7.2 AndroidSurfaceGL::CreateGPUSurface
[-> flutter/shell/platform/android/android_surface_gl.cc]

```Java
std::unique_ptr<Surface> AndroidSurfaceGL::CreateGPUSurface() {
  auto surface = std::make_unique<GPUSurfaceGL>(this);
  return surface->IsValid() ? std::move(surface) : nullptr;
}
```

可见surface_的类型为GPUSurfaceGL。再来看看看AcquireFrame()过程。

### 4.8 CreateVSyncWaiter
[-> flutter/shell/platform/android/platform_view_android.cc]

```Java
std::unique_ptr<VsyncWaiter> PlatformViewAndroid::CreateVSyncWaiter() {
  return std::make_unique<VsyncWaiterAndroid>(task_runners_);
}
```

#### 4.8.1 VsyncWaiterAndroid初始化
[-> flutter/shell/platform/android/vsync_waiter_android.cc]

```Java
VsyncWaiterAndroid::VsyncWaiterAndroid(flutter::TaskRunners task_runners)
    : VsyncWaiter(std::move(task_runners)) {}
```

创建VsyncWaiterAndroid对象，也会初始化父类VsyncWaiter。

### 4.9 ShellIOManager初始化
[-> flutter/shell/common/shell_io_manager.cc]

```Java
ShellIOManager::ShellIOManager(
    sk_sp<GrContext> resource_context,
    fml::RefPtr<fml::TaskRunner> unref_queue_task_runner)
    : resource_context_(std::move(resource_context)),
      resource_context_weak_factory_(
          resource_context_ ? std::make_unique<fml::WeakPtrFactory<GrContext>>(
                                  resource_context_.get())
                            : nullptr),
      unref_queue_(fml::MakeRefCounted<flutter::SkiaUnrefQueue>(
          std::move(unref_queue_task_runner),
          fml::TimeDelta::FromMilliseconds(250))),
    weak_factory_(this) {
}
```

ShellIOManager的初始化过程，会创建GrContext和SkiaUnrefQueue对象。

### 4.10 Rasterizer初始化
[-> flutter/shell/common/rasterizer.cc]

```Java
Rasterizer::Rasterizer(TaskRunners task_runners)
    : Rasterizer(std::move(task_runners),
                 // [4.10.1]
                 std::make_unique<flutter::CompositorContext>()) {}

Rasterizer::Rasterizer(
    TaskRunners task_runners,
    std::unique_ptr<flutter::CompositorContext> compositor_context)
    : task_runners_(std::move(task_runners)),
      compositor_context_(std::move(compositor_context)),
      weak_factory_(this) {
}
```

on_create_rasterizer方法等价于创建Rasterizer对象，在这个过程还会创建CompositorContext对象并赋值给compositor_context_。

### 4.11 Animator初始化
[-> flutter/shell/common/animator.cc]

```Java
Animator::Animator(Delegate& delegate,
                   TaskRunners task_runners,
                   std::unique_ptr<VsyncWaiter> waiter)
    : delegate_(delegate),
      task_runners_(std::move(task_runners)),
      waiter_(std::move(waiter)),
      last_begin_frame_time_(),
      dart_frame_deadline_(0),
      layer_tree_pipeline_(fml::MakeRefCounted<LayerTreePipeline>(2)),
      pending_frame_semaphore_(1),
      frame_number_(1),
      paused_(false),
      regenerate_layer_tree_(false),
      frame_scheduled_(false),
      notify_idle_task_id_(0),
      dimension_change_pending_(false),
      weak_factory_(this) {}
```

### 4.12 Engine初始化
[-> flutter/shell/common/engine.cc]

```Java
Engine::Engine(Delegate& delegate,
               DartVM& vm,
               fml::RefPtr<const DartSnapshot> isolate_snapshot,
               fml::RefPtr<const DartSnapshot> shared_snapshot,
               TaskRunners task_runners,
               Settings settings,
               std::unique_ptr<Animator> animator,
               fml::WeakPtr<SnapshotDelegate> snapshot_delegate,
               fml::WeakPtr<IOManager> io_manager)
    : delegate_(delegate),
      settings_(std::move(settings)),
      animator_(std::move(animator)),
      activity_running_(false),
      have_surface_(false),
      weak_factory_(this) {
  //创建RuntimeController对象[4.12.1]
  runtime_controller_ = std::make_unique<RuntimeController>(
      *this,                                 // runtime delegate
      &vm,                                  
      std::move(isolate_snapshot),           
      std::move(shared_snapshot),            
      std::move(task_runners),               
      std::move(snapshot_delegate),          
      std::move(io_manager),                 
      settings_.advisory_script_uri,         
      settings_.advisory_script_entrypoint,  
      settings_.idle_notification_callback   
  );
}
```

#### 4.12.1 RuntimeController初始化
[-> flutter/runtime/runtime_controller.cc]

```Java
RuntimeController::RuntimeController(
    RuntimeDelegate& p_client,
    DartVM* p_vm,
    fml::RefPtr<const DartSnapshot> p_isolate_snapshot,
    fml::RefPtr<const DartSnapshot> p_shared_snapshot,
    TaskRunners p_task_runners,
    fml::WeakPtr<SnapshotDelegate> p_snapshot_delegate,
    fml::WeakPtr<IOManager> p_io_manager,
    std::string p_advisory_script_uri,
    std::string p_advisory_script_entrypoint,
    std::function<void(int64_t)> p_idle_notification_callback)
    : RuntimeController(p_client,
                        p_vm,
                        std::move(p_isolate_snapshot),
                        std::move(p_shared_snapshot),
                        std::move(p_task_runners),
                        std::move(p_snapshot_delegate),
                        std::move(p_io_manager),
                        std::move(p_advisory_script_uri),
                        std::move(p_advisory_script_entrypoint),
                        p_idle_notification_callback,
                        WindowData{/* default window data */}) {}
```

#### 4.12.2 RuntimeController
[-> flutter/runtime/runtime_controller.cc]

```Java
RuntimeController::RuntimeController(
    RuntimeDelegate& p_client,
    DartVM* p_vm,
    fml::RefPtr<const DartSnapshot> p_isolate_snapshot,
    fml::RefPtr<const DartSnapshot> p_shared_snapshot,
    TaskRunners p_task_runners,
    fml::WeakPtr<SnapshotDelegate> p_snapshot_delegate,
    fml::WeakPtr<IOManager> p_io_manager,
    std::string p_advisory_script_uri,
    std::string p_advisory_script_entrypoint,
    std::function<void(int64_t)> idle_notification_callback,
    WindowData p_window_data)
    : client_(p_client),
      vm_(p_vm),
      isolate_snapshot_(std::move(p_isolate_snapshot)),
      shared_snapshot_(std::move(p_shared_snapshot)),
      task_runners_(p_task_runners),
      snapshot_delegate_(p_snapshot_delegate),
      io_manager_(p_io_manager),
      advisory_script_uri_(p_advisory_script_uri),
      advisory_script_entrypoint_(p_advisory_script_entrypoint),
      idle_notification_callback_(idle_notification_callback),
      window_data_(std::move(p_window_data)),
      root_isolate_(
          //[见小节4.12.4]
          DartIsolate::CreateRootIsolate(vm_->GetVMData()->GetSettings(),
                                         isolate_snapshot_,
                                         shared_snapshot_,
                                         task_runners_,
                                         //[见小节4.12.3]
                                         std::make_unique<Window>(this),
                                         snapshot_delegate_,
                                         io_manager_,
                                         p_advisory_script_uri,
                                         p_advisory_script_entrypoint)) {
  std::shared_ptr<DartIsolate> root_isolate = root_isolate_.lock();
  root_isolate->SetReturnCodeCallback([this](uint32_t code) {
    root_isolate_return_code_ = {true, code};
  });
  if (auto* window = GetWindowIfAvailable()) {
    tonic::DartState::Scope scope(root_isolate);
    window->DidCreateIsolate();
    if (!FlushRuntimeStateToIsolate()) {
      FML_DLOG(ERROR) << "Could not setup intial isolate state.";
    }
  }
}
```

#### 4.12.3 Window初始化
[-> flutter/lib/ui/window/window.cc]

```Java
Window::Window(WindowClient* client) : client_(client) {

}
```

#### 4.12.4 DartIsolate::CreateRootIsolate
[-> flutter/runtime/dart_isolate.cc]

```Java
std::weak_ptr<DartIsolate> DartIsolate::CreateRootIsolate(
    const Settings& settings,
    fml::RefPtr<const DartSnapshot> isolate_snapshot,
    fml::RefPtr<const DartSnapshot> shared_snapshot,
    TaskRunners task_runners,
    std::unique_ptr<Window> window,
    fml::WeakPtr<SnapshotDelegate> snapshot_delegate,
    fml::WeakPtr<IOManager> io_manager,
    std::string advisory_script_uri,
    std::string advisory_script_entrypoint,
    Dart_IsolateFlags* flags) {
  TRACE_EVENT0("flutter", "DartIsolate::CreateRootIsolate");
  Dart_Isolate vm_isolate = nullptr;
  std::weak_ptr<DartIsolate> embedder_isolate;

  //由于是root isolate，这里伪造一个父embedder对象。此处不能使用unique_ptr，因为构造函数是私有的。
  // isolate生命周期完全由VM管理  [见小节4.12.5]
  auto root_embedder_data = std::make_unique<std::shared_ptr<DartIsolate>>(
      std::make_shared<DartIsolate>(
          settings,                      
          std::move(isolate_snapshot),  
          std::move(shared_snapshot),    
          task_runners,                 
          std::move(snapshot_delegate),  
          std::move(io_manager),        
          advisory_script_uri,           
          advisory_script_entrypoint,    
          nullptr  //当isolate准备运行的时候，会设置子isolate preparer
          ));
  //[见小节4.12.6]
  std::tie(vm_isolate, embedder_isolate) = CreateDartVMAndEmbedderObjectPair(
      advisory_script_uri.c_str(),         
      advisory_script_entrypoint.c_str(),  
      nullptr,                             // package root
      nullptr,                             // package config
      flags,                               
      root_embedder_data.get(),            //父类embedder数据
      true,                                //是否root isolate
      &error                               
  );


  std::shared_ptr<DartIsolate> shared_embedder_isolate = embedder_isolate.lock();
  if (shared_embedder_isolate) {
    //只有root isolates能和window交互
    shared_embedder_isolate->SetWindow(std::move(window));
  }
  root_embedder_data.release();
  return embedder_isolate;
}
```

#### 4.12.5 DartIsolate初始化
[-> flutter/runtime/dart_isolate.cc

```Java
DartIsolate::DartIsolate(const Settings& settings,
                         fml::RefPtr<const DartSnapshot> isolate_snapshot,
                         fml::RefPtr<const DartSnapshot> shared_snapshot,
                         TaskRunners task_runners,
                         fml::WeakPtr<SnapshotDelegate> snapshot_delegate,
                         fml::WeakPtr<IOManager> io_manager,
                         std::string advisory_script_uri,
                         std::string advisory_script_entrypoint,
                         ChildIsolatePreparer child_isolate_preparer)
    : UIDartState(std::move(task_runners),
                  settings.task_observer_add,
                  settings.task_observer_remove,
                  std::move(snapshot_delegate),
                  std::move(io_manager),
                  advisory_script_uri,
                  advisory_script_entrypoint,
                  settings.log_tag,
                  settings.unhandled_exception_callback,
                  DartVMRef::GetIsolateNameServer()),
      settings_(settings),
      isolate_snapshot_(std::move(isolate_snapshot)),
      shared_snapshot_(std::move(shared_snapshot)),
      child_isolate_preparer_(std::move(child_isolate_preparer)) {
  phase_ = Phase::Uninitialized;
}
```

#### 4.12.6 CreateDartVMAndEmbedderObjectPair
[-> flutter/runtime/dart_isolate.cc

```Java
DartIsolate::CreateDartVMAndEmbedderObjectPair(
    const char* advisory_script_uri,
    const char* advisory_script_entrypoint,
    const char* package_root,
    const char* package_config,
    Dart_IsolateFlags* flags,
    std::shared_ptr<DartIsolate>* p_parent_embedder_isolate,
    bool is_root_isolate,
    char** error) {
  TRACE_EVENT0("flutter", "DartIsolate::CreateDartVMAndEmbedderObjectPair");

  std::unique_ptr<std::shared_ptr<DartIsolate>> embedder_isolate(p_parent_embedder_isolate);

  if (!is_root_isolate) {
    auto* raw_embedder_isolate = embedder_isolate.release();

    TaskRunners null_task_runners(advisory_script_uri, nullptr, nullptr,
                                  nullptr, nullptr);

    embedder_isolate = std::make_unique<std::shared_ptr<DartIsolate>>(
        std::make_shared<DartIsolate>(
            (*raw_embedder_isolate)->GetSettings(),        
            (*raw_embedder_isolate)->GetIsolateSnapshot(),
            (*raw_embedder_isolate)->GetSharedSnapshot(),   
            null_task_runners,                             
            fml::WeakPtr<SnapshotDelegate>{},              
            fml::WeakPtr<IOManager>{},                     
            advisory_script_uri,         
            advisory_script_entrypoint,  
            (*raw_embedder_isolate)->child_isolate_preparer_));
  }

  // [见小节4.12.7]
  Dart_Isolate isolate = Dart_CreateIsolate(
      advisory_script_uri,         
      advisory_script_entrypoint,  
      (*embedder_isolate)
          ->GetIsolateSnapshot()
          ->GetData()
          ->GetSnapshotPointer(),
      (*embedder_isolate)->GetIsolateSnapshot()->GetInstructionsIfPresent(),
      (*embedder_isolate)->GetSharedSnapshot()->GetDataIfPresent(),
      (*embedder_isolate)->GetSharedSnapshot()->GetInstructionsIfPresent(),
      flags, embedder_isolate.get(), error);
  ...

  if (!(*embedder_isolate)->Initialize(isolate, is_root_isolate)) {
    return {nullptr, {}};
  }

  if (!(*embedder_isolate)->LoadLibraries(is_root_isolate)) {
    return {nullptr, {}};
  }
  auto weak_embedder_isolate = (*embedder_isolate)->GetWeakIsolatePtr();

  //Root isolates是由引擎启动，secondary isolates当被标记为可运行则会在虚拟机中运行
  if (!is_root_isolate) {
    if (!(*embedder_isolate)->child_isolate_preparer_((*embedder_isolate).get())) {
      return {nullptr, {}};
    }
  }

  //embedder的所有权由Dart VM控制，因此返回给调用者的是弱引用
  embedder_isolate.release();
  return {isolate, weak_embedder_isolate};
}
```

#### 4.12.7 Dart_CreateIsolate
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
DART_EXPORT Dart_Isolate
Dart_CreateIsolate(const char* script_uri,
                   const char* name,
                   const uint8_t* snapshot_data,
                   const uint8_t* snapshot_instructions,
                   const uint8_t* shared_data,
                   const uint8_t* shared_instructions,
                   Dart_IsolateFlags* flags,
                   void* callback_data,
                   char** error) {
  API_TIMELINE_DURATION(Thread::Current());
  //[见小节4.12.8]
  return CreateIsolate(script_uri, name, snapshot_data, snapshot_instructions,
                       shared_data, shared_instructions, NULL, 0, flags,
                       callback_data, error);
}
```

#### 4.12.8 CreateIsolate
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
static Dart_Isolate CreateIsolate(const char* script_uri,
                                  const char* name,
                                  const uint8_t* snapshot_data,
                                  const uint8_t* snapshot_instructions,
                                  const uint8_t* shared_data,
                                  const uint8_t* shared_instructions,
                                  const uint8_t* kernel_buffer,
                                  intptr_t kernel_buffer_size,
                                  Dart_IsolateFlags* flags,
                                  void* callback_data,
                                  char** error) {
  Dart_IsolateFlags api_flags;
  if (flags == NULL) {
    Isolate::FlagsInitialize(&api_flags);
    flags = &api_flags;
  }
  // [见小节4.12.9]
  Isolate* I = Dart::CreateIsolate((name == NULL) ? "isolate" : name, *flags);
  ...
  {
    Thread* T = Thread::Current();
    StackZone zone(T);
    HANDLESCOPE(T);
    T->EnterApiScope();
    const Error& error_obj = Error::Handle(
        Z,
        Dart::InitializeIsolate(snapshot_data, snapshot_instructions,
                                shared_data, shared_instructions, kernel_buffer,
                                kernel_buffer_size, callback_data));
    if (error_obj.IsNull()) {
#if defined(DART_NO_SNAPSHOT) && !defined(PRODUCT)
      if (FLAG_check_function_fingerprints && kernel_buffer == NULL) {
        Library::CheckFunctionFingerprints();
      }
#endif  
      T->ExitApiScope();
      T->set_execution_state(Thread::kThreadInNative);
      T->EnterSafepoint();
      if (error != NULL) {
        *error = NULL;
      }
      return Api::CastIsolate(I);
    }
    if (error != NULL) {
      *error = strdup(error_obj.ToErrorCString());
    }
    T->ExitApiScope();
  }
  Dart::ShutdownIsolate();
  return reinterpret_cast<Dart_Isolate>(NULL);
}
```

#### 4.12.9 Dart::CreateIsolate
[-> third_party/dart/runtime/vm/dart.cc]

```Java
Isolate* Dart::CreateIsolate(const char* name_prefix,
                             const Dart_IsolateFlags& api_flags) {
  //创建Isolate
  Isolate* isolate = Isolate::InitIsolate(name_prefix, api_flags);
  return isolate;
}
```

### 4.13 Shell::Setup
[-> flutter/shell/common/shell.cc]

```Java
bool Shell::Setup(std::unique_ptr<PlatformView> platform_view,
                  std::unique_ptr<Engine> engine,
                  std::unique_ptr<Rasterizer> rasterizer,
                  std::unique_ptr<ShellIOManager> io_manager) {
  if (is_setup_) {  //保障只会执行一次
    return false;
  }

  if (!platform_view || !engine || !rasterizer || !io_manager) {
    return false;
  }

  platform_view_ = std::move(platform_view);
  engine_ = std::move(engine);
  rasterizer_ = std::move(rasterizer);
  io_manager_ = std::move(io_manager);

  is_setup_ = true;

  vm_->GetServiceProtocol()->AddHandler(this, GetServiceProtocolDescription());

  PersistentCache::GetCacheForProcess()->AddWorkerTaskRunner(
      task_runners_.GetIOTaskRunner());

  PersistentCache::GetCacheForProcess()->SetIsDumpingSkp(
      settings_.dump_skp_on_shader_compilation);

  return true;
}
```

## 五、加载Dart代码

回到小节3.2，FlutterActivityDelegate.onCreate的过程，接下来执行的便是runBundle

### 5.1  FlutterActivityDelegate.runBundle
[-> platform/android/io/flutter/app/FlutterActivityDelegate.java]

```Java
private void runBundle(String appBundlePath) {
    if (!flutterView.getFlutterNativeView().isApplicationRunning()) {
        FlutterRunArguments args = new FlutterRunArguments();
        ArrayList<String> bundlePaths = new ArrayList<>();
        ResourceUpdater resourceUpdater = FlutterMain.getResourceUpdater();
        if (resourceUpdater != null) {
            File patchFile = resourceUpdater.getInstalledPatch();
            JSONObject manifest = resourceUpdater.readManifest(patchFile);
            if (resourceUpdater.validateManifest(manifest)) {
                bundlePaths.add(patchFile.getPath());
            }
        }
        bundlePaths.add(appBundlePath);
        args.bundlePaths = bundlePaths.toArray(new String[0]);
        args.entrypoint = "main";
        //[见小节5.2]
        flutterView.runFromBundle(args);
    }
}
```

### 5.2  runFromBundle
[-> platform/android/io/flutter/view/FlutterView.java]

```Java
public void runFromBundle(FlutterRunArguments args) {
  preRun();  //重置Accessibility树
  mNativeView.runFromBundle(args); //[见小节5.3]
  postRun();
}
```

### 5.3 runFromBundle
[-> platform/android/io/flutter/view/FlutterNativeView.java]

```Java
public void runFromBundle(FlutterRunArguments args) {
    boolean hasBundlePaths = args.bundlePaths != null && args.bundlePaths.length != 0;
    if (args.bundlePath == null && !hasBundlePaths) {
        throw new AssertionError("Either bundlePath or bundlePaths must be specified");
    } else if ((args.bundlePath != null || args.defaultPath != null) && hasBundlePaths) {
        throw new AssertionError("Can't specify both bundlePath and bundlePaths");
    } else if (args.entrypoint == null) {
        throw new AssertionError("An entrypoint must be specified");
    }
    if (hasBundlePaths) {
         //[见小节5.4]
        runFromBundleInternal(args.bundlePaths, args.entrypoint, args.libraryPath);
    } else {
        runFromBundleInternal(new String[] {args.bundlePath, args.defaultPath},
                args.entrypoint, args.libraryPath);
    }
}
```

### 5.4 runFromBundleInternal
[-> platform/android/io/flutter/view/FlutterNativeView.java]

```Java
private void runFromBundleInternal(String[] bundlePaths, String entrypoint,
    String libraryPath) {
      //[见小节5.5]
    mFlutterJNI.runBundleAndSnapshotFromLibrary(
        bundlePaths,
        entrypoint,
        libraryPath,
        mContext.getResources().getAssets()
    );

    applicationIsRunning = true;
}
```

### 5.5 runBundleAndSnapshotFromLibrary
[-> FlutterJNI.java]

```Java
public void runBundleAndSnapshotFromLibrary(
    @NonNull String[] prioritizedBundlePaths,
    @Nullable String entrypointFunctionName,
    @Nullable String pathToEntrypointFunction,
    @NonNull AssetManager assetManager
) {
  ensureAttachedToNative();
  //[见小节5.6]
  nativeRunBundleAndSnapshotFromLibrary(
      nativePlatformViewId,
      prioritizedBundlePaths,
      entrypointFunctionName,
      pathToEntrypointFunction,
      assetManager
  );
}
```

nativeRunBundleAndSnapshotFromLibrary这是一个Native方法，[小节2.6.3]已介绍过，对应的方法为RunBundleAndSnapshotFromLibrary。

### 5.6 RunBundleAndSnapshotFromLibrary
[-> flutter/shell/platform/android/platform_view_android_jni.cc]

```Java
static void RunBundleAndSnapshotFromLibrary(JNIEnv* env,
                                            jobject jcaller,
                                            jlong shell_holder,
                                            jobjectArray jbundlepaths,
                                            jstring jEntrypoint,
                                            jstring jLibraryUrl,
                                            jobject jAssetManager) {
  auto asset_manager = std::make_shared<flutter::AssetManager>();
  for (const auto& bundlepath :
       fml::jni::StringArrayToVector(env, jbundlepaths)) {
    if (bundlepath.empty()) {
      continue;
    }

    const auto file_ext_index = bundlepath.rfind(".");
    if (bundlepath.substr(file_ext_index) == ".zip") {
      asset_manager->PushBack(std::make_unique<flutter::ZipAssetStore>(
          bundlepath, "assets/flutter_assets"));

    } else {
      asset_manager->PushBack(
          std::make_unique<flutter::DirectoryAssetBundle>(fml::OpenDirectory(
              bundlepath.c_str(), false, fml::FilePermission::kRead)));

      const auto last_slash_index = bundlepath.rfind("/", bundlepath.size());
      if (last_slash_index != std::string::npos) {
        auto apk_asset_dir = bundlepath.substr(
            last_slash_index + 1, bundlepath.size() - last_slash_index);

        asset_manager->PushBack(std::make_unique<flutter::APKAssetProvider>(
            env,                       // jni environment
            jAssetManager,             // asset manager
            std::move(apk_asset_dir))  // apk asset dir
        );
      }
    }
  }

  auto isolate_configuration = CreateIsolateConfiguration(*asset_manager);
  ...

  RunConfiguration config(std::move(isolate_configuration),
                          std::move(asset_manager));
  {
    auto entrypoint = fml::jni::JavaStringToString(env, jEntrypoint);
    auto libraryUrl = fml::jni::JavaStringToString(env, jLibraryUrl);

    if ((entrypoint.size() > 0) && (libraryUrl.size() > 0)) {
      config.SetEntrypointAndLibrary(std::move(entrypoint),
                                     std::move(libraryUrl));
    } else if (entrypoint.size() > 0) {
      config.SetEntrypoint(std::move(entrypoint));
    }
  }
  //[见小节5.7]
  ANDROID_SHELL_HOLDER->Launch(std::move(config));
}
```

### 5.7 AndroidShellHolder::Launch
[-> flutter/shell/platform/android/android_shell_holder.cc]

```Java
void AndroidShellHolder::Launch(RunConfiguration config) {
  if (!IsValid()) {
    return;
  }

  shell_->GetTaskRunners().GetUITaskRunner()->PostTask(
      fml::MakeCopyable([engine = shell_->GetEngine(),  //
                         config = std::move(config)     //
  ]() mutable {
        //[见小节5.8]
        if (!engine || engine->Run(std::move(config)) == Engine::RunStatus::Failure) {
          FML_LOG(ERROR) << "Could not launch engine in configuration.";
        } else {
          FML_LOG(INFO) << "Isolate for engine configuration successfully "
                           "started and run.";
        }
      }));
}
```

### 5.8 Engine::Run
[-> Engine::Run]

```Java
Engine::RunStatus Engine::Run(RunConfiguration configuration) {
  //[见小节5.9]
  auto isolate_launch_status = PrepareAndLaunchIsolate(std::move(configuration));
  if (isolate_launch_status == Engine::RunStatus::Failure) {
    return isolate_launch_status;
  } else if (isolate_launch_status == Engine::RunStatus::FailureAlreadyRunning) {
    return isolate_launch_status;
  }

  std::shared_ptr<DartIsolate> isolate =
      runtime_controller_->GetRootIsolate().lock();

  bool isolate_running =
      isolate && isolate->GetPhase() == DartIsolate::Phase::Running;

  if (isolate_running) {
    tonic::DartState::Scope scope(isolate.get());

    if (settings_.root_isolate_create_callback) {
      settings_.root_isolate_create_callback();
    }

    if (settings_.root_isolate_shutdown_callback) {
      isolate->AddIsolateShutdownCallback(
          settings_.root_isolate_shutdown_callback);
    }
  }

  return isolate_running ? Engine::RunStatus::Success
                         : Engine::RunStatus::Failure;
}
```

### 5.9 Engine::PrepareAndLaunchIsolate
[-> Engine::Run]

```Java
Engine::RunStatus Engine::PrepareAndLaunchIsolate(
    RunConfiguration configuration) {
  TRACE_EVENT0("flutter", "Engine::PrepareAndLaunchIsolate");

  UpdateAssetManager(configuration.GetAssetManager());

  auto isolate_configuration = configuration.TakeIsolateConfiguration();

  std::shared_ptr<DartIsolate> isolate =
      runtime_controller_->GetRootIsolate().lock();
  ...

  if (!isolate_configuration->PrepareIsolate(*isolate)) {
    return RunStatus::Failure;
  }

  if (configuration.GetEntrypointLibrary().empty()) {
      //[见小节5.10]
    if (!isolate->Run(configuration.GetEntrypoint())) {
      return RunStatus::Failure;
    }
  } else {
    if (!isolate->RunFromLibrary(configuration.GetEntrypointLibrary(),
                                 configuration.GetEntrypoint())) {
      return RunStatus::Failure;
    }
  }

  return RunStatus::Success;
}
```

### 5.10 DartIsolate::Run
[-> flutter/runtime/dart_isolate.cc]

```Java
bool DartIsolate::Run(const std::string& entrypoint_name, fml::closure on_run) {
  TRACE_EVENT0("flutter", "DartIsolate::Run");
  ...

  tonic::DartState::Scope scope(this);

  auto user_entrypoint_function =
      Dart_GetField(Dart_RootLibrary(), tonic::ToDart(entrypoint_name.c_str()));
  //[见小节5.11]
  if (!InvokeMainEntrypoint(user_entrypoint_function)) {
    return false;
  }
  phase_ = Phase::Running;

  if (on_run) {
    on_run();
  }
  return true;
}
```

### 5.11 InvokeMainEntrypoint
[-> flutter/runtime/dart_isolate.cc]

```Java
static bool InvokeMainEntrypoint(Dart_Handle user_entrypoint_function) {

  Dart_Handle start_main_isolate_function =
      tonic::DartInvokeField(Dart_LookupLibrary(tonic::ToDart("dart:isolate")),
                             "_getStartMainIsolateFunction", {});

  //[见小节5.12]
  if (tonic::LogIfError(tonic::DartInvokeField(
          Dart_LookupLibrary(tonic::ToDart("dart:ui")), "_runMainZoned",
          {start_main_isolate_function, user_entrypoint_function}))) {
    return false;
  }
  return true;
}
```

经过Dart虚拟机，最终会调用的Dart层的_runMainZoned()方法。

### 5.12 \_runMainZoned
[-> flutter/lib/ui/hooks.dart]

```Java
void _runMainZoned(Function startMainIsolateFunction, Function userMainFunction) {
  startMainIsolateFunction((){
    runZoned<Future<void>>(() {
      const List<String> empty_args = <String>[];
      if (userMainFunction is _BinaryFunction) {
        (userMainFunction as dynamic)(empty_args, '');
      } else if (userMainFunction is _UnaryFunction) {
        (userMainFunction as dynamic)(empty_args);
      } else {
        userMainFunction();  //[见小节5.13]
      }
    }, onError: (Object error, StackTrace stackTrace) {
      _reportUnhandledException(error.toString(), stackTrace.toString());
    });
  }, null);
}
```

runZoned()经过一系列调用，然后执行到userMainFunction()，也就是main.dart文件中的main()方法，这便开启执行整个Dart业务代码。

### 5.12

```Java
void _startMainIsolate(Function entryPoint, List<String> args) {
  _startIsolate(
      null, // no parent port
      entryPoint,
      args,
      null, // no message
      true, // isSpawnUri
      null, // no control port
      null); // no capabilities
}

/**
 * Returns the _startMainIsolate function. This closurization allows embedders
 * to setup trampolines to the main function. This workaround can be removed
 * once support for @pragma("vm:entry_point", "get") as documented in
 * https://github.com/dart-lang/sdk/issues/35720 lands.
 */
@pragma("vm:entry-point", "call")
Function _getStartMainIsolateFunction() {
  return _startMainIsolate;
}

/**
 * Takes the real entry point as argument and invokes it with the initial
 * message.
 */
@pragma("vm:entry-point", "call")
void _startIsolate(
    SendPort parentPort,
    Function entryPoint,
    List<String> args,
    var message,
    bool isSpawnUri,
    RawReceivePort controlPort,
    List capabilities) {
  // The control port (aka the main isolate port) does not handle any messages.
  if (controlPort != null) {
    controlPort.handler = (_) {}; // Nobody home on the control port.
  }

  if (parentPort != null) {
    // Build a message to our parent isolate providing access to the
    // current isolate's control port and capabilities.
    //
    // TODO(floitsch): Send an error message if we can't find the entry point.
    var readyMessage = new List(2);
    readyMessage[0] = controlPort.sendPort;
    readyMessage[1] = capabilities;

    // Out of an excess of paranoia we clear the capabilities from the
    // stack.  Not really necessary.
    capabilities = null;
    parentPort.send(readyMessage);
  }
  assert(capabilities == null);

  // Delay all user code handling to the next run of the message loop. This
  // allows us to intercept certain conditions in the event dispatch, such as
  // starting in paused state.
  RawReceivePort port = new RawReceivePort();
  port.handler = (_) {
    port.close();

    if (isSpawnUri) {
      if (entryPoint is _BinaryFunction) {
        (entryPoint as dynamic)(args, message);
      } else if (entryPoint is _UnaryFunction) {
        (entryPoint as dynamic)(args);
      } else {
        entryPoint();
      }
    } else {
      entryPoint(message);
    }
  };
  // Make sure the message handler is triggered.
  port.sendPort.send(null);
}
```

![runzoned](/img/flutter_boot/runzoned.png)

## 六、总结

Flutter引擎启动过程分为以下几个阶段：

- FlutterApplication启动：执行其onCreate()方法，初始化配置，获取是否预编译模式，提取资源文件；加载libflutter.so库，并记录启动时间戳；
- FlutterActivity启动：执行其onCreate()方法，创建FlutterActivityDelegate、FlutterView、FlutterNativeView、FlutterMain、FlutterJNI等对象，也会初始化以下这些引擎核心类：
  - AndroidShellHolder
  - DartVM
  - Shell
  - PlatformViewAndroid
  - VsyncWaiterAndroid
  - ShellIOManager
  - Rasterizer
  - Animator
  - Engine
  - RuntimeController
  - Window
  - DartIsolate


- FlutterJNI：

## 附录
本文涉及到相关源码文件

```Java
platform/android/io/flutter/app/
  - FlutterApplication.java
  - FlutterActivity.java
  - FlutterActivityDelegate.java

platform/android/io/flutter/view/
  - FlutterMain.java
  - FlutterView.java
  - FlutterNativeView.java
  - VsyncWaiter.java

platform/android/io/flutter/view/
  - embedding/engine/FlutterJNI.java

flutter/shell/platform/android/
  - android_surface.cc
  - android_surface_gl.cc
  - android_shell_holder.cc
  - platform_view_android_jni.cc
  - platform_view_android.cc
  - flutter_main.cc
  - library_loader.cc

flutter/fml/
  - thread.cc
  - task_runner.cc
  - message_loop.cc
  - message_loop_impl.cc
  - platform/android/message_loop_android.cc
  - platform/android/jni_util.cc

flutter/lib/ui/
  - hooks.dart
  - dart_ui.cc
  - window/window.cc

flutter/shell/common/
    - shell.cc
    - rasterizer.cc
    - surface.cc
    - thread_host.cc
    - animator.cc
    - engine.cc
    - shell_io_manager.cc

flutter/runtime/
  - dart_vm_lifecycle.cc
  - dart_vm.cc
  - dart_isolate.cc
  - runtime_controller.cc

third_party/dart/runtime/
  - vm/dart_api_impl.cc
  - vm/dart.cc
  - lib/isolate_patch.dart
```
