
## 一、概览

1) 启动过程：（位于flutter/shell/platform/android/io/flutter）

- FlutterApplication
- FlutterActivity
- FlutterActivityDelegate
- FlutterMain
- FlutterView
- FlutterNativeView
- FlutterJNI


2) flutter/shell/platform/android/platform_view_android_jni.cc

以下几个对象的关系：

- AndroidShellHolder
- Shell
- Window
- RuntimeController
- Engine
- Animator
- PlatformViewAndroid
- VsyncWaiterAndroid
  - 由PlatformViewAndroid::CreateVSyncWaiter()

注：AndroidShellHolder,Shell,Animator 都运行在主线程。


### 启动

```Java
FlutterJNI.onSurfaceCreated  --> FlutterJNI.java      (JNI_OnLoad会注册一个JNI，nativeSurfaceCreated往下调用)
  shell::SurfaceCreated  --> platform_view_android_jni.cc
    PlatformViewAndroid::NotifyCreated  --> platform_view_android.cc
      PlatformView::NotifyCreated  --> platform_view.cc
        Shell::OnPlatformViewCreated  --> shell.cc
          Engine::OnOutputSurfaceCreated  --> engine.cc  //(视频则Shell::OnPlatformViewMarkTextureFrameAvailable)
            Engine::ScheduleFrame   --> engine.cc
```

## 二、流程

attach
  attachToNative
    nativeAttach
      AttachJNI

flutter/shell/platform/android/platform_view_android_jni.cc 的AttachJNI()会创建AndroidShellHolder

### 2.1 AndroidShellHolder
flutter/shell/platform/android/android_shell_holder.cc

```Java
AndroidShellHolder::AndroidShellHolder(
    blink::Settings settings,
    fml::jni::JavaObjectWeakGlobalRef java_object,
    bool is_background_view)
    : settings_(std::move(settings)), java_object_(java_object) {
  static size_t shell_count = 1;
  auto thread_label = std::to_string(shell_count++);

  FML_CHECK(pthread_key_create(&thread_destruct_key_, ThreadDestructCallback) ==
            0);

  if (is_background_view) {
    thread_host_ = {thread_label, ThreadHost::Type::UI};
  } else {
    thread_host_ = {thread_label, ThreadHost::Type::UI | ThreadHost::Type::GPU |
                                      ThreadHost::Type::IO};
  }

  // Detach from JNI when the UI and GPU threads exit.
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
          platform_view_android = std::make_unique<PlatformViewAndroid>(
              shell,                   // delegate
              shell.GetTaskRunners(),  // task runners
              java_object              // java object handle for JNI interop
          );

        } else {
          platform_view_android = std::make_unique<PlatformViewAndroid>(
              shell,                   // delegate
              shell.GetTaskRunners(),  // task runners
              java_object,             // java object handle for JNI interop
              shell.GetSettings()
                  .enable_software_rendering  // use software rendering
          );
        }
        weak_platform_view = platform_view_android->GetWeakPtr();
        return platform_view_android;
      };

  //创建Rasterizer对象
  Shell::CreateCallback<Rasterizer> on_create_rasterizer = [](Shell& shell) {
    return std::make_unique<Rasterizer>(shell.GetTaskRunners());
  };

  fml::MessageLoop::EnsureInitializedForCurrentThread();
  fml::RefPtr<fml::TaskRunner> gpu_runner;
  fml::RefPtr<fml::TaskRunner> ui_runner;
  fml::RefPtr<fml::TaskRunner> io_runner;
  fml::RefPtr<fml::TaskRunner> platform_runner =
      fml::MessageLoop::GetCurrent().GetTaskRunner();
  if (is_background_view) {
    auto single_task_runner = thread_host_.ui_thread->GetTaskRunner();
    gpu_runner = single_task_runner;
    ui_runner = single_task_runner;
    io_runner = single_task_runner;
  } else {
    gpu_runner = thread_host_.gpu_thread->GetTaskRunner();
    ui_runner = thread_host_.ui_thread->GetTaskRunner();
    io_runner = thread_host_.io_thread->GetTaskRunner();
  }
  blink::TaskRunners task_runners(thread_label,     // label
                                  platform_runner,  // platform
                                  gpu_runner,       // gpu
                                  ui_runner,        // ui
                                  io_runner         // io
  );

  shell_ =
      Shell::Create(task_runners,             // task runners
                    settings_,                // settings
                    on_create_platform_view,  // platform view create callback
                    on_create_rasterizer      // rasterizer create callback
      );

  platform_view_ = weak_platform_view;
  FML_DCHECK(platform_view_);

  is_valid_ = shell_ != nullptr;

  if (is_valid_) {
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

#### 2.1.1 Shell::CreateShellOnPlatformThread

```Java
std::unique_ptr<Shell> Shell::CreateShellOnPlatformThread(
    blink::TaskRunners task_runners,
    blink::Settings settings,
    Shell::CreateCallback<PlatformView> on_create_platform_view,
    Shell::CreateCallback<Rasterizer> on_create_rasterizer) {

    //创建Shell对象
    auto shell = std::unique_ptr<Shell>(new Shell(task_runners, settings));

    //在当前platform线程来创建platform view
    auto platform_view = on_create_platform_view(*shell.get());

    //由platform view创建vsync waiter，这用于后面的engine对象来创建animator
    auto vsync_waiter = platform_view->CreateVSyncWaiter();

    ... //省略其他线程的工作

    fml::TaskRunner::RunNowOrPostTask(
    shell->GetTaskRunners().GetUITaskRunner(),
    fml::MakeCopyable([shell = shell.get(),                               //
                       vsync_waiter = std::move(vsync_waiter),            //
                       snapshot_delegate = std::move(snapshot_delegate),  //
                       resource_context = std::move(resource_context),    //
                       unref_queue = std::move(unref_queue)               //
    ]() mutable {

      auto vm = blink::DartVM::ForProcess(shell->settings_);
      shell->vm_ = vm;

      //UI线程来执行animator动画，但vsync是通过platform线程来获取
      const auto& task_runners = shell->GetTaskRunners();
      //创建Animator对象
      auto animator = std::make_unique<Animator>(*shell, task_runners,
                                                 std::move(vsync_waiter));
      //创建Engine对象
      auto engine = std::make_unique<Engine>(*shell,                        //
                                        *vm,            //
                                        vm->GetIsolateSnapshot(),   //
                                        blink::DartSnapshot::Empty(),    //
                                        task_runners,                  //
                                        shell->GetSettings(),          //
                                        std::move(animator),           //
                                        std::move(snapshot_delegate),  //
                                        std::move(resource_context),   //
                                        std::move(unref_queue)         //
      );
      shell->engine_ = std::move(engine);
      vm->GetServiceProtocol().AddHandler(shell, shell->GetServiceProtocolDescription());
      shell->engine_created_ = true;
      shell->ui_latch_.Signal();
    }));
    ...
}
```

### 2.1 DartVM::DartVM
[flutter/lib/ui/dart_ui.cc]

```Java
DartVM::DartVM(const Settings& settings,
               fml::RefPtr<DartSnapshot> vm_snapshot,
               fml::RefPtr<DartSnapshot> isolate_snapshot,
               fml::RefPtr<DartSnapshot> shared_snapshot)
    : settings_(settings),
      vm_snapshot_(std::move(vm_snapshot)),
      isolate_snapshot_(std::move(isolate_snapshot)),
      shared_snapshot_(std::move(shared_snapshot)),
      weak_factory_(this) {
  TRACE_EVENT0("flutter", "DartVMInitializer");
  ...
  DartUI::InitForGlobal();  //[见小节2.1.1]
  ...
}
```

#### 2.1.1 DartUI::InitForGlobal
[flutter/lib/ui/dart_ui.cc]

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
    Window::RegisterNatives(g_natives);  // [见小节2.1.2]

    // 第二个isolates不提供UI相关的APIs
    g_natives_secondary = new tonic::DartLibraryNatives();
    DartRuntimeHooks::RegisterNatives(g_natives_secondary);
    IsolateNameServerNatives::RegisterNatives(g_natives_secondary);
  }
}
```

#### 2.1.2 RegisterNatives
[flutter/lib/ui/window/window.cc]


```Java
void Window::RegisterNatives(tonic::DartLibraryNatives* natives) {
  natives->Register({
      {"Window_defaultRouteName", DefaultRouteName, 1, true},
      {"Window_scheduleFrame", ScheduleFrame, 1, true},
      {"Window_sendPlatformMessage", _SendPlatformMessage, 4, true},
      {"Window_respondToPlatformMessage", _RespondToPlatformMessage, 3, true},
      {"Window_render", Render, 2, true},
      {"Window_updateSemantics", UpdateSemantics, 2, true},
      {"Window_setIsolateDebugName", SetIsolateDebugName, 2, true},
      {"Window_addNextFrameCallback", _AddNextFrameCallback, 2, true}
  });
}
```

###

```Java
SchedulerBinding.scheduleWarmUpFrame
  RenderView.performLayout
    RenderObject.layout
      _RenderLayoutBuilder.performLayout
        _LayoutBuilderElement._layout
          BuildOwner.buildScope
```

### 文章
https://blog.csdn.net/weixin_33755649/article/details/91430355  启动过程:

https://www.ccarea.cn/wp-content/uploads/2019/04/FlutterInit.jpg ， 这个图很全面


https://juejin.im/post/5ca56bd56fb9a05e58494cfe

https://juejin.im/post/5cc278a6f265da0378759c87
https://www.colabug.com/5912380.html

https://www.ccarea.cn/archives/593

https://time.geekbang.org/column/article/73651

https://zhuanlan.zhihu.com/p/50576888

https://www.jianshu.com/p/7a6da5bd3200
