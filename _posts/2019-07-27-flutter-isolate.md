---
layout: post
title:  "深入理解Flutter的Isolate创建过程"
date:   2019-07-27 23:25:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter的isolate机制，相关源码目录见文末附录


## 一、概述

Root isolate负责UI渲染以及用户交互操作，需要及时响应，当存在耗时操作，则必须创建新的isolate，否则UI渲染会被阻塞。
创建isolate的方法便是Isolate.spawn()，本文将从源码角度来讲解该方法的核心工作机制。


#### 1.1 Isolate创建流程图
**[Isolate创建流程](/img/flutter_isolate/isolate.jpg)**

![Isolate创建流程](/img/flutter_isolate/isolate.jpg)

#### 1.2 相关类图

**[Isolate相关类图](/img/flutter_isolate/ClassIsolate.jpg)**

![Isolate相关类图](/img/flutter_isolate/ClassIsolate.jpg)


对于Root Isolate来说，RuntimeController初始化过程会创建该Isolate对象，在该对象析构时会关闭该isolate对象；

- 创建Isolate对象：dart_api_impl.cc中的Dart_CreateIsolate，会调用到dart.cc的CreateIsolate()
- 关闭Isolate对象：dart_api_impl.cc中的Dart_ShutdownIsolate，会调用到dart.cc的ShutdownIsolate()


## 二、原理分析

### 2.1 Isolate.spawn
[-> third_party/dart/sdk/lib/isolate/isolate.dart]

```Java
class Isolate {
  external static Future<Isolate> spawn<T>(
      void entryPoint(T message), T message,
      {bool paused: false,
      bool errorsAreFatal,
      SendPort onExit,
      SendPort onError,
      String debugName});
}
```

这是一个external方法，返回值是一个Future类型，真正的实现在isolate_patch.dart文件。

### 2.2 Isolate.spawn
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
@patch
class Isolate {

  static Future<Isolate> spawn<T>(void entryPoint(T message), T message,
      {bool paused: false,
      bool errorsAreFatal,
      SendPort onExit,
      SendPort onError,
      String debugName}) async {
    RawReceivePort readyPort;
    try {
      ...
      //创建接收端口
      readyPort = new RawReceivePort();

      // 不继承父isoalte的包配置设置，采用命令行所设置的数据
      var packageConfig = VMLibraryHooks.packageConfigString;
      var script = VMLibraryHooks.platformScript;
      if (script.scheme == "package") {
        script = await Isolate.resolvePackageUri(script);
      }

      // [见小节2.3]
      _spawnFunction(
          readyPort.sendPort, script.toString(),
          entryPoint, message,
          paused, errorsAreFatal,
          onExit, onError,
          null, packageConfig,
          debugName);

      return await _spawnCommon(readyPort); // [见小节2.20]
    } catch (e, st) {
      if (readyPort != null) {
        readyPort.close();
      }
      return await new Future<Isolate>.error(e, st);
    }
  }

}
```

该方法主要功能：

- 创建RawReceivePort，详见[深入理解Flutter异步Future机制](http://gityuan.com/2019/07/21/flutter_future/)文章已介绍；
- VMLibraryHooks.packageConfigString赋值过程在builtin.dart中的_setPackagesMap()过程
- VMLibraryHooks.platformScript计算一次后，会将计算的脚本uri缓存起来
- \_spawnFunction是多对应native方法Isolate_spawnFunction()。

### 2.3 Isolate_spawnFunction
[-> third_party/dart/runtime/lib/isolate.cc]

```Java
DEFINE_NATIVE_ENTRY(Isolate_spawnFunction, 0, 11) {
  GET_NON_NULL_NATIVE_ARGUMENT(SendPort, port, arguments->NativeArgAt(0));
  GET_NON_NULL_NATIVE_ARGUMENT(String, script_uri, arguments->NativeArgAt(1));
  //方法和消息
  GET_NON_NULL_NATIVE_ARGUMENT(Instance, closure, arguments->NativeArgAt(2));
  GET_NON_NULL_NATIVE_ARGUMENT(Instance, message, arguments->NativeArgAt(3));
  GET_NON_NULL_NATIVE_ARGUMENT(Bool, paused, arguments->NativeArgAt(4));
  GET_NATIVE_ARGUMENT(Bool, fatalErrors, arguments->NativeArgAt(5));
  GET_NATIVE_ARGUMENT(SendPort, onExit, arguments->NativeArgAt(6));
  GET_NATIVE_ARGUMENT(SendPort, onError, arguments->NativeArgAt(7));
  GET_NATIVE_ARGUMENT(String, packageRoot, arguments->NativeArgAt(8));
  GET_NATIVE_ARGUMENT(String, packageConfig, arguments->NativeArgAt(9));
  GET_NATIVE_ARGUMENT(String, debugName, arguments->NativeArgAt(10));

  if (closure.IsClosure()) {
    Function& func = Function::Handle();
    func = Closure::Cast(closure).function();
    if (func.IsImplicitClosureFunction() && func.is_static()) {
      //通过父函数以保障获取正常的函数名
      func = func.parent_function();

      bool fatal_errors = fatalErrors.IsNull() ? true : fatalErrors.value();
      Dart_Port on_exit_port = onExit.IsNull() ? ILLEGAL_PORT : onExit.Id();
      Dart_Port on_error_port = onError.IsNull() ? ILLEGAL_PORT : onError.Id();

      SerializedObjectBuffer message_buffer;
      {
        MessageWriter writer(true);
        //创建message [见小节2.3.1]
        message_buffer.set_message(writer.WriteMessage(
            message, ILLEGAL_PORT, Message::kNormalPriority));
      }

      const char* utf8_package_root = NULL;
      const char* utf8_package_config = packageConfig.IsNull() ? NULL : String2UTF8(packageConfig);
      const char* utf8_debug_name = debugName.IsNull() ? NULL : String2UTF8(debugName);
      // [见小节2.3.3]
      IsolateSpawnState* state = new IsolateSpawnState(
          port.Id(), isolate->origin_id(), isolate->init_callback_data(),
          String2UTF8(script_uri), func, &message_buffer,
          isolate->spawn_count_monitor(), isolate->spawn_count(),
          utf8_package_root, utf8_package_config, paused.value(), fatal_errors,
          on_exit_port, on_error_port, utf8_debug_name);

      //由于调用Isolate.spawn方法，故需要复制父isolate代码
      state->isolate_flags()->copy_parent_code = true;
      // [见小节2.3.4]
      ThreadPool::Task* spawn_task = new SpawnIsolateTask(state);

      //增加spawn数量
      isolate->IncrementSpawnCount();  
      // [见小节2.4]
      if (!Dart::thread_pool()->Run(spawn_task)) {
         // 在线程池运行失败后，则执行清除收尾工作
        state->DecrementSpawnCount();
        ...
      }
    }
  }
  ...
  return Object::null();
}
```

创建Message对象保存spawn()方法传递过来的message参数，然后将该新建Message对象再保存到SerializedObjectBuffer类型的message_buffer对象，最后再将其赋值给IsolateSpawnState对象，简而言之就是message消息记录在IsolateSpawnState对象的serialized_message_成员变量。另外，entryPoint也记录在IsolateSpawnState对象对象。

#### 2.3.1 MessageWriter::WriteMessage
[-> third_party/dart/runtime/vm/snapshot.cc]

```Java
Message* MessageWriter::WriteMessage(const Object& obj,
                                     Dart_Port dest_port,
                                     Message::Priority priority) {
  ...
  {
    LongJumpScope jump;
    if (setjmp(*jump.Set()) == 0) {
      NoSafepointScope no_safepoint;
      WriteObject(obj.raw()); //记录消息内容
    } else {
      FreeBuffer();
      has_exception = true;
    }
  }
  MessageFinalizableData* finalizable_data = finalizable_data_;
  finalizable_data_ = NULL;
  //[见小节2.3.2]
  return new Message(dest_port, buffer(), BytesWritten(), finalizable_data, priority);
}
```

此处消息的端口号等于0，优先级等于kNormalPriority。


#### 2.3.2 Message初始化
[-> third_party/dart/runtime/vm/message.cc]

```Java
Message::Message(Dart_Port dest_port,
                 uint8_t* snapshot,
                 intptr_t snapshot_length,
                 MessageFinalizableData* finalizable_data,
                 Priority priority,
                 Dart_Port delivery_failure_port)
    : next_(NULL),
      dest_port_(dest_port),
      delivery_failure_port_(delivery_failure_port),
      snapshot_(snapshot),
      snapshot_length_(snapshot_length),
      finalizable_data_(finalizable_data),
      priority_(priority) {
}
```

#### 2.3.3 IsolateSpawnState初始化
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
IsolateSpawnState::IsolateSpawnState(Dart_Port parent_port,
                                     Dart_Port origin_id,
                                     void* init_data,
                                     const char* script_url,
                                     const Function& func,
                                     SerializedObjectBuffer* message_buffer,
                                     Monitor* spawn_count_monitor,
                                     intptr_t* spawn_count,
                                     const char* package_root,
                                     const char* package_config,
                                     bool paused,
                                     bool errors_are_fatal,
                                     Dart_Port on_exit_port,
                                     Dart_Port on_error_port,
                                     const char* debug_name)
    : isolate_(NULL),
      parent_port_(parent_port),
      origin_id_(origin_id),
      init_data_(init_data),
      on_exit_port_(on_exit_port),
      on_error_port_(on_error_port),
      script_url_(script_url),
      package_root_(package_root),
      package_config_(package_config),
      library_url_(NULL),
      class_name_(NULL),
      function_name_(NULL),
      debug_name_(debug_name),
      serialized_args_(NULL),
      serialized_message_(message_buffer->StealMessage()),
      spawn_count_monitor_(spawn_count_monitor),
      spawn_count_(spawn_count),
      paused_(paused),
      errors_are_fatal_(errors_are_fatal) {
  const Class& cls = Class::Handle(func.Owner());
  const Library& lib = Library::Handle(cls.library());
  const String& lib_url = String::Handle(lib.url());
  library_url_ = NewConstChar(lib_url.ToCString());

  String& func_name = String::Handle();
  func_name ^= func.name();
  func_name ^= String::ScrubName(func_name);
  function_name_ = NewConstChar(func_name.ToCString());
  if (!cls.IsTopLevel()) {
    const String& class_name = String::Handle(cls.Name());
    class_name_ = NewConstChar(class_name.ToCString());
  }

  //继承标识
  Isolate::Current()->FlagsCopyTo(isolate_flags());
}
```

#### 2.3.4 SpawnIsolateTask初始化
[-> third_party/dart/runtime/lib/isolate.cc]

```Java
class SpawnIsolateTask : public ThreadPool::Task {
 public:
  explicit SpawnIsolateTask(IsolateSpawnState* state) : state_(state) {}

 private:
    IsolateSpawnState* state_;

}
```

### 2.4 ThreadPool::Run
[-> third_party/dart/runtime/vm/thread_pool.cc]

```Java
bool ThreadPool::Run(Task* task) {
  Worker* worker = NULL;
  bool new_worker = false;
  {
    MutexLocker ml(&mutex_);
    if (idle_workers_ == NULL) {
      //[见小节2.4.1]
      worker = new Worker(this);
      new_worker = true;
      count_started_++;

      //将新创建的worker添加到all_workers_链表
      worker->all_next_ = all_workers_;
      all_workers_ = worker;
      worker->owned_ = true;
      count_running_++;
    } else {
      //从idle的worker队列中获取第一个worker
      worker = idle_workers_;
      idle_workers_ = worker->idle_next_;
      worker->idle_next_ = NULL;
      count_idle_--;
      count_running_++;
    }
  }

  //设置任务，并唤醒worker[2.4.2]
  worker->SetTask(task);
  if (new_worker) {
    //当首次创建Worker则启动线程池 [见小节2.4.3]
    worker->StartThread();
  }
  return true;
}
```

根据前面，可知此处的task参数的实例为SpawnIsolateTask。

#### 2.4.1 Worker初始化
[-> third_party/dart/runtime/vm/thread_pool.cc]

```Java
ThreadPool::Worker::Worker(ThreadPool* pool)
    : pool_(pool),
      task_(NULL),
      id_(OSThread::kInvalidThreadId),
      done_(false),
      owned_(false),
      all_next_(NULL),
      idle_next_(NULL),
      shutdown_next_(NULL) {}
```

#### 2.4.2 Worker::SetTask
[-> third_party/dart/runtime/vm/thread_pool.cc]

```Java
void ThreadPool::Worker::SetTask(Task* task) {
  MonitorLocker ml(&monitor_);
  task_ = task; //将新创建的SpawnIsolateTask保存在Worker的task_变量
  ml.Notify();  //唤醒处于等待状态的worker
}
```

#### 2.4.3 Worker::StartThread
[-> third_party/dart/runtime/vm/thread_pool.cc]

```Java
void ThreadPool::Worker::StartThread() {
  //[见小节2.4.3]
  int result = OSThread::Start("Dart ThreadPool Worker", &Worker::Main,
                               reinterpret_cast<uword>(this));
}
```

创建名为"Dart ThreadPool Worker"的线程，入口函数为Worker::Main()

#### 2.4.3 OSThread::Start
[-> third_party/dart/runtime/vm/os_thread_android.cc]

```Java
int OSThread::Start(const char* name,
                    ThreadStartFunction function,
                    uword parameter) {
  pthread_attr_t attr;
  int result = pthread_attr_init(&attr);
  result = pthread_attr_setstacksize(&attr, OSThread::GetMaxStackSize());
  ThreadStartData* data = new ThreadStartData(name, function, parameter);

  pthread_t tid;
  //通过pthread_create来创建线程
  result = pthread_create(&tid, &attr, ThreadStart, data);
  result = pthread_attr_destroy(&attr);
  ...
  return 0;
}
```

线程创建后则执行入口函数Worker::Main，这是由小节[2.4.2]中设置的函数方法。

### 2.5 Worker::Main
[-> third_party/dart/runtime/vm/thread_pool.cc]

```Java
void ThreadPool::Worker::Main(uword args) {
  Worker* worker = reinterpret_cast<Worker*>(args);
  OSThread* os_thread = OSThread::Current();
  ThreadId id = os_thread->id();
  ThreadPool* pool;

  // 根据当前栈指针设置线程的stack_base
  os_thread->RefineStackBoundsFromSP(OSThread::GetCurrentStackPointer());

  {
    MonitorLocker ml(&worker->monitor_);
    worker->id_ = id;
    pool = worker->pool_;
  }
  //[见小节2.5.1]
  bool released = worker->Loop();

  if (!released) {
    ThreadJoinId join_id = OSThread::GetCurrentThreadJoinId(os_thread);
    {
      MutexLocker ml(&pool->mutex_);
      JoinList::AddLocked(join_id, &pool->join_list_);
    }

    //从shutdown列表移除，并通知线程池
    {
      MonitorLocker eml(&pool->exit_monitor_);
      pool->RemoveWorkerFromShutdownList(worker);
      delete worker;
      eml.Notify();
    }
  } else {
    delete worker;
  }

  //线程退出
  if (Dart::thread_exit_callback() != NULL) {
    (*Dart::thread_exit_callback())();
  }
}
```

#### 2.5.1 Worker::Loop
[-> third_party/dart/runtime/vm/thread_pool.cc]

```Java
bool ThreadPool::Worker::Loop() {
  MonitorLocker ml(&monitor_);
  int64_t idle_start;
  while (true) {
    Task* task = task_;
    task_ = NULL;

    ml.Exit();
    task->Run();  //[见小节2.6]
    delete task;
    ml.Enter();

    if (IsDone()) {
      return false;
    }
    pool_->SetIdleAndReapExited(this);
    idle_start = OS::GetCurrentMonotonicMicros();
    while (true) {
      //等待一段时间
      Monitor::WaitResult result = ml.WaitMicros(ComputeTimeout(idle_start));
      if (task_ != NULL) {
        break;  //还有任务则继续执行
      }
      if (IsDone()) {  //完成，则返回false
        return false;
      }
      //超时，则返回true
      if ((result == Monitor::kTimedOut) && pool_->ReleaseIdleWorker(this)) {
        return true;
      }
    }
  }
  return false;
}
```


### 2.6 SpawnIsolateTask.Run
[-> third_party/dart/runtime/lib/isolate.cc]

```Java
class SpawnIsolateTask : public ThreadPool::Task {

  virtual void Run() {
    char* error = NULL;
    //[见小节2.6.1]
    Dart_IsolateCreateCallback callback = Isolate::CreateCallback();
    ...

    Dart_IsolateFlags api_flags = *(state_->isolate_flags());
    const char* name = (state_->debug_name() == NULL) ? state_->function_name()
                                                      : state_->debug_name();
    // 创建Isolate对象 [见小节2.7]
    Isolate* isolate = reinterpret_cast<Isolate*>((callback)(
        state_->script_url(), name, state_->package_root(),
        state_->package_config(), &api_flags, state_->init_data(), &error));
    state_->DecrementSpawnCount();
    ...

    if (state_->origin_id() != ILLEGAL_PORT) {
      isolate->set_origin_id(state_->origin_id());
    }
    MutexLocker ml(isolate->mutex());
    state_->set_isolate(reinterpret_cast<Isolate*>(isolate));
    isolate->set_spawn_state(state_);
    state_ = NULL;
    if (isolate->is_runnable()) {
      isolate->Run(); //[见小节2.13]
    }
  }
};
```

该方法中经过层层调用最终是指[小节2.10.1]中的Isolate对象，先来看看Dart_IsolateCreateCallback的赋值过程，这要从DartVM初始化说起。

#### 2.6.1 DartVM初始化
[-> flutter/runtime/dart_vm.cc]

```Java
DartVM::DartVM(std::shared_ptr<const DartVMData> vm_data,
               std::shared_ptr<IsolateNameServer> isolate_name_server) {
    ...
    params.create = reinterpret_cast<decltype(params.create)>(
                   DartIsolate::DartIsolateCreateCallback);
    char* init_error = Dart_Initialize(&params);
    ...

}
```

Dart_Initialize()方法会调用Dart::Init()，层层调用到Isolate对象的SetCreateCallback()方法，从而得到create_callback_等于DartIsolateCreateCallback。

### 2.7 DartIsolate::DartIsolateCreateCallback
[-> flutter/runtime/dart_isolate.cc]

```Java
Dart_Isolate DartIsolate::DartIsolateCreateCallback(
    const char* advisory_script_uri,
    const char* advisory_script_entrypoint,
    const char* package_root,
    const char* package_config,
    Dart_IsolateFlags* flags,
    std::shared_ptr<DartIsolate>* parent_embedder_isolate,
    char** error) {
  ...
  //[见小节2.8]
  return CreateDartVMAndEmbedderObjectPair(
             advisory_script_uri,         
             advisory_script_entrypoint,
             package_root,               
             package_config,              
             flags,                       
             parent_embedder_isolate,     
             false,   // is root isolate
             error                        
             ).first;
}
```

### 2.8 CreateDartVMAndEmbedderObjectPair
[-> flutter/runtime/dart_isolate.cc]

```Java
std::pair<Dart_Isolate, std::weak_ptr<DartIsolate>> DartIsolate::CreateDartVMAndEmbedderObjectPair(
    const char* advisory_script_uri,
    const char* advisory_script_entrypoint,
    const char* package_root,
    const char* package_config,
    Dart_IsolateFlags* flags,
    std::shared_ptr<DartIsolate>* p_parent_embedder_isolate,
    bool is_root_isolate,
    char** error) {
  TRACE_EVENT0("flutter", "DartIsolate::CreateDartVMAndEmbedderObjectPair");

  std::unique_ptr<std::shared_ptr<DartIsolate>> embedder_isolate(
      p_parent_embedder_isolate);

  if (!is_root_isolate) { //非root isolate
    auto* raw_embedder_isolate = embedder_isolate.release();
    TaskRunners null_task_runners(advisory_script_uri, nullptr, nullptr,
                                  nullptr, nullptr);
    //创建DartIsolate [见小节2.8.1]
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

  //创建DartVM isolate [见小节2.9]
  Dart_Isolate isolate = Dart_CreateIsolate(
      advisory_script_uri,         
      advisory_script_entrypoint,  
      (*embedder_isolate)->GetIsolateSnapshot()->GetData()->GetSnapshotPointer(),
      (*embedder_isolate)->GetIsolateSnapshot()->GetInstructionsIfPresent(),
      (*embedder_isolate)->GetSharedSnapshot()->GetDataIfPresent(),
      (*embedder_isolate)->GetSharedSnapshot()->GetInstructionsIfPresent(),
            flags, embedder_isolate.get(), error);

  (*embedder_isolate)->Initialize(isolate, is_root_isolate)；
  (*embedder_isolate)->LoadLibraries(is_root_isolate)；

  auto weak_embedder_isolate = (*embedder_isolate)->GetWeakIsolatePtr();

  if (!is_root_isolate) {
    if (!(*embedder_isolate)->child_isolate_preparer_((*embedder_isolate).get())) {
      return {nullptr, {}};
    }
  }

  embedder_isolate.release();
  return {isolate, weak_embedder_isolate};
}
```

#### 2.8.1 DartIsolate初始化
[-> flutter/runtime/dart_isolate.cc]

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
    //[见小节2.8.2]
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

#### 2.8.2 UIDartState初始化
[-> flutter/lib/ui/ui_dart_state.cc]

```Java
UIDartState::UIDartState(
    TaskRunners task_runners,
    TaskObserverAdd add_callback,
    TaskObserverRemove remove_callback,
    fml::WeakPtr<SnapshotDelegate> snapshot_delegate,
    fml::WeakPtr<IOManager> io_manager,
    std::string advisory_script_uri,
    std::string advisory_script_entrypoint,
    std::string logger_prefix,
    UnhandledExceptionCallback unhandled_exception_callback,
    std::shared_ptr<IsolateNameServer> isolate_name_server)
    : task_runners_(std::move(task_runners)),
      add_callback_(std::move(add_callback)),
      remove_callback_(std::move(remove_callback)),
      snapshot_delegate_(std::move(snapshot_delegate)),
      io_manager_(std::move(io_manager)),
      advisory_script_uri_(std::move(advisory_script_uri)),
      advisory_script_entrypoint_(std::move(advisory_script_entrypoint)),
      logger_prefix_(std::move(logger_prefix)),
      unhandled_exception_callback_(unhandled_exception_callback),
      isolate_name_server_(std::move(isolate_name_server)) {
  AddOrRemoveTaskObserver(true /* add */);
}
```

### 2.9 Dart_CreateIsolate
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
Dart_CreateIsolate(const char* script_uri,
                   const char* name,
                   const uint8_t* snapshot_data,
                   const uint8_t* snapshot_instructions,
                   const uint8_t* shared_data,
                   const uint8_t* shared_instructions,
                   Dart_IsolateFlags* flags,
                   void* callback_data,
                   char** error) {
  //[见小节2.10]
  return CreateIsolate(script_uri, name, snapshot_data, snapshot_instructions,
                       shared_data, shared_instructions, NULL, 0, flags,
                       callback_data, error);
}
```

### 2.10 CreateIsolate
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
    Isolate::FlagsInitialize(&api_flags); //设置默认flags
    flags = &api_flags;
  }
  // [见小节2.11]
  Isolate* I = Dart::CreateIsolate((name == NULL) ? "isolate" : name, *flags);
  ...
  {
    Thread* T = Thread::Current();
    StackZone zone(T);
    HANDLESCOPE(T);
    T->EnterApiScope();
    //初始化 [见小节2.12]
    const Error& error_obj = Error::Handle(Z,
                  Dart::InitializeIsolate(snapshot_data, snapshot_instructions,
                                shared_data, shared_instructions, kernel_buffer,
                                kernel_buffer_size, callback_data));
    if (error_obj.IsNull()) {
      T->ExitApiScope();
      //设置线程状态，并进入安全点
      T->set_execution_state(Thread::kThreadInNative);
      T->EnterSafepoint();
      return Api::CastIsolate(I);
    }
    T->ExitApiScope();
  }
  //如果发现一次则，关闭isolate
  Dart::ShutdownIsolate();
  return reinterpret_cast<Dart_Isolate>(NULL);
}
```

该方法说明：

- 调用Dart::CreateIsolate()来创建isolate对象；
- 调用Dart::InitializeIsolate来初始化isolate相关信息；

### 2.11 Dart::CreateIsolate
[-> third_party/dart/runtime/vm/dart.cc]

```Java
Isolate* Dart::CreateIsolate(const char* name_prefix,
                             const Dart_IsolateFlags& api_flags) {
  //初始化isolae [见小节2.10.1]
  Isolate* isolate = Isolate::InitIsolate(name_prefix, api_flags);
  return isolate;
}
```

创建真正的Isolate对象。

#### 2.10.1 Isolate::InitIsolate
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
Isolate* Isolate::InitIsolate(const char* name_prefix,
                              const Dart_IsolateFlags& api_flags,
                              bool is_vm_isolate) {
  //创建Isolate
  Isolate* result = new Isolate(api_flags);

  bool is_service_or_kernel_isolate = false;
  if (ServiceIsolate::NameEquals(name_prefix)) {
    is_service_or_kernel_isolate = true;
  }
#if !defined(DART_PRECOMPILED_RUNTIME)
  if (KernelIsolate::NameEquals(name_prefix)) {
    KernelIsolate::SetKernelIsolate(result);
    is_service_or_kernel_isolate = true;
  }
#endif
  //初始化堆[见小节2.10.2]
  Heap::Init(result,
             is_vm_isolate ? 0 : FLAG_new_gen_semi_max_size * MBInWords,
             (is_service_or_kernel_isolate ? kDefaultMaxOldGenHeapSize
                                           : FLAG_old_gen_heap_size) * MBInWords);
  // [见小节2.10.3]
  if (!Thread::EnterIsolate(result)) {
    ... //当进入isolate失败，则关闭并删除isolate，并直接返回
    return NULL;
  }

  //创建isolate的消息处理对象
  MessageHandler* handler = new IsolateMessageHandler(result);
  result->set_message_handler(handler);

  //创建Dart API状态的对象
  ApiState* state = new ApiState();
  result->set_api_state(state);
  result->set_main_port(PortMap::CreatePort(result->message_handler()));
  result->set_origin_id(result->main_port());
  result->set_pause_capability(result->random()->NextUInt64());
  result->set_terminate_capability(result->random()->NextUInt64());
  result->BuildName(name_prefix);

  //添加到isolate列表 [见小节2.10.4]
  if (!AddIsolateToList(result)) {
    //当添加失败，则关闭并删除isolate，并直接返回
    ...
  }
  return result;
}
```

该方法主要功能：

- 创建isolate对象；可见[小节2.6]中的Isolate真正的便是该方法所创建的Isolate对象。
- 创建Heap，IsolateMessageHandler，ApiState对象，都保存到该isolate对象的成员变量；
- 如果整个过程执行成功，则将新创建的isolate添加到isolates_list_head_链表；如果失败，则会关闭并删除isolate对象。

#### 2.10.2 Heap::Init
[-> third_party/dart/runtime/vm/heap/heap.cc]

```Java
void Heap::Init(Isolate* isolate,
                intptr_t max_new_gen_words,
                intptr_t max_old_gen_words) {
  //创建堆Heap
  Heap* heap = new Heap(isolate, max_new_gen_words, max_old_gen_words);
  isolate->set_heap(heap);
}
```

#### 2.10.3 Thread::EnterIsolate
[-> third_party/dart/runtime/vm/thread.cc]

```Java
bool Thread::EnterIsolate(Isolate* isolate) {
  const bool kIsMutatorThread = true;
  Thread* thread = isolate->ScheduleThread(kIsMutatorThread);
  if (thread != NULL) {
    thread->task_kind_ = kMutatorTask;
    thread->StoreBufferAcquire();
    if (isolate->marking_stack() != NULL) {
      thread->MarkingStackAcquire();
      thread->DeferredMarkingStackAcquire();
    }
    return true;
  }
  return false;
}
```

#### 2.10.4 Isolate::AddIsolateToList
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
bool Isolate::AddIsolateToList(Isolate* isolate) {
  MonitorLocker ml(isolates_list_monitor_);
  if (!creation_enabled_) {
    return false;
  }
  isolate->next_ = isolates_list_head_;
  isolates_list_head_ = isolate;
  return true;
}
```

### 2.12 Dart::InitializeIsolate
[-> third_party/dart/runtime/vm/dart.cc]

```Java
RawError* Dart::InitializeIsolate(const uint8_t* snapshot_data,
                                  const uint8_t* snapshot_instructions,
                                  const uint8_t* shared_data,
                                  const uint8_t* shared_instructions,
                                  const uint8_t* kernel_buffer,
                                  intptr_t kernel_buffer_size,
                                  void* data) {
  Thread* T = Thread::Current();
  Isolate* I = T->isolate();
  StackZone zone(T);
  HandleScope handle_scope(T);
  ObjectStore::Init(I);

  Error& error = Error::Handle(T->zone());
  error = Object::Init(I, kernel_buffer, kernel_buffer_size);

  if ((snapshot_data != NULL) && kernel_buffer == NULL) {
    //读取snapshot，并初始化状态
    const Snapshot* snapshot = Snapshot::SetupFromBuffer(snapshot_data);

    if (!IsSnapshotCompatible(vm_snapshot_kind_, snapshot->kind())) {
        ...
    }
    FullSnapshotReader reader(snapshot, snapshot_instructions, shared_data,
                              shared_instructions, T);
    //读取isolate的Snapshot
    const Error& error = Error::Handle(reader.ReadIsolateSnapshot());
    ReversePcLookupCache::BuildAndAttachToIsolate(I);
  } else {
    ...
  }

  Object::VerifyBuiltinVtables();
  ...

  const Code& miss_code = Code::Handle(I->object_store()->megamorphic_miss_code());
  I->set_ic_miss_code(miss_code);
  I->heap()->InitGrowthControl();
  I->set_init_callback_data(data);
  Api::SetupAcquiredError(I);

  ServiceIsolate::MaybeMakeServiceIsolate(I);
  //发送Isolate启动的消息
  ServiceIsolate::SendIsolateStartupMessage();

  //创建tag表
  I->set_tag_table(GrowableObjectArray::Handle(GrowableObjectArray::New()));
  //设置默认的UserTag
  const UserTag& default_tag = UserTag::Handle(UserTag::DefaultTag());
  I->set_current_tag(default_tag);
  return Error::null();
}
```

到这里Isolate的创建过程便真正完成，接下来回到[小节2.6]，便开始执行run()方法。


### 2.13 Isolate::Run
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
void Isolate::Run() {
  //[见小节2.14]
  message_handler()->Run(Dart::thread_pool(), RunIsolate, ShutdownIsolate,
                         reinterpret_cast<uword>(this));
}
```


### 2.14 MessageHandler::Run
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
void MessageHandler::Run(ThreadPool* pool,
                         StartCallback start_callback,
                         EndCallback end_callback,
                         CallbackData data) {
  bool task_running;
  MonitorLocker ml(&monitor_);
  pool_ = pool;
  start_callback_ = start_callback;
  end_callback_ = end_callback;
  callback_data_ = data;
  //创建MessageHandlerTask对象
  task_ = new MessageHandlerTask(this);
  //[见小节2.15]
  task_running = pool_->Run(task_);
}
```

由前面过程可知ThreadPool::Run()过程：当没有处于空闲状态的worker，则会创建新的Worker，并创建新的名为“Dart ThreadPool Worker”的线程，然后进入Worker::Loop()过程，再从task_中取出task，然后执行task->Run()方法；当存在空闲状态的worker，则直接唤醒然后执行相应task的Run()方法。

此处的ThreadPool::Run()方法跟[小节2.4]是一致的，唯一不同的此处的参数为MessageHandlerTask对象，该对象跟SpawnIsolateTask类似，都是继承于ThreadPool::Task类，接下来看看MessageHandlerTask的Run方法。

### 2.15 MessageHandlerTask.Run
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
class MessageHandlerTask : public ThreadPool::Task {
 public:
  explicit MessageHandlerTask(MessageHandler* handler) : handler_(handler) {
  }

  virtual void Run() {
    handler_->TaskCallback(); //[见小节2.16]
  }

 private:
  MessageHandler* handler_;
};
```

### 2.16 MessageHandler::TaskCallback
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
void MessageHandler::TaskCallback() {
  MessageStatus status = kOK;
  bool run_end_callback = false;
  bool delete_me = false;
  EndCallback end_callback = NULL;
  CallbackData callback_data = 0;
  {
    MonitorLocker ml(&monitor_);
    if (status == kOK) {
      if (start_callback_) {
        ml.Exit();
        //[见小节2.17]
        status = start_callback_(callback_data_);
        start_callback_ = NULL;
        ml.Enter();
      }

      bool handle_messages = true;
      while (handle_messages) {
        handle_messages = false;

        if (status != kShutdown) {
          //回调待处理消息 [见小节2.18]
          status = HandleMessages(&ml, (status == kOK), true);
        }

        if (status == kOK && HasLivePorts()) {
          // [见小节2.19]
          handle_messages = CheckIfIdleLocked(&ml);
        }
      }
    }
    //当isolate发生错误 或者 不再有活着的端口时，则会退出isolate
    ...
    task_ = NULL;
  }
  if (run_end_callback) {
    //执行isolate的ShutdownIsolate()方法
    end_callback(callback_data);
  }
  if (delete_me) {
    delete this;
  }
}
```

### 2.17 RunIsolate
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
static MessageHandler::MessageStatus RunIsolate(uword parameter) {
  Isolate* isolate = reinterpret_cast<Isolate*>(parameter);
  IsolateSpawnState* state = NULL;
  {
    MutexLocker ml(isolate->mutex());
    state = isolate->spawn_state();
  }
  {
    StartIsolateScope start_scope(isolate);
    Thread* thread = Thread::Current();
    StackZone zone(thread);
    HandleScope handle_scope(thread);
    ... //当isolate的退出和错误含有有效端口，则添加到isolate相应的监听器

    Object& result = Object::Handle();
    result = state->ResolveFunction();
    bool is_spawn_uri = state->is_spawn_uri();
    unction& func = Function::Handle(thread->zone());
    func ^= result.raw();
    func = func.ImplicitClosureFunction();

    const Array& capabilities = Array::Handle(Array::New(2));
    Capability& capability = Capability::Handle();
    capability = Capability::New(isolate->pause_capability());
    capabilities.SetAt(0, capability);
    //检查isolate是否需要启动
    if (state->paused()) {
      bool added = isolate->AddResumeCapability(capability);
      isolate->message_handler()->increment_paused();
    }
    capability = Capability::New(isolate->terminate_capability());
    capabilities.SetAt(1, capability);

    const Array& args = Array::Handle(Array::New(7));
    args.SetAt(0, SendPort::Handle(SendPort::New(state->parent_port())));
    args.SetAt(1, Instance::Handle(func.ImplicitStaticClosure()));
    args.SetAt(2, Instance::Handle(state->BuildArgs(thread)));
    args.SetAt(3, Instance::Handle(state->BuildMessage(thread)));
    args.SetAt(4, is_spawn_uri ? Bool::True() : Bool::False());
    args.SetAt(5, ReceivePort::Handle(ReceivePort::New(isolate->main_port(), true /* control port */)));
    args.SetAt(6, capabilities);

    const Library& lib = Library::Handle(Library::IsolateLibrary());
    const String& entry_name = String::Handle(String::New("_startIsolate"));
    const Function& entry_point = Function::Handle(lib.LookupLocalFunction(entry_name));
    //执行_startIsolate方法[2.17.1]
    result = DartEntry::InvokeFunction(entry_point, args);
    ...
  }
  return MessageHandler::kOK;
}

```

#### 2.17.1 \_startIsolate
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
void _startIsolate(
    SendPort parentPort,
    Function entryPoint,
    List<String> args,
    var message,
    bool isSpawnUri,
    RawReceivePort controlPort,
    List capabilities) {
  ...

  RawReceivePort port = new RawReceivePort();
  port.handler = (_) {
    port.close();

    if (isSpawnUri) {
      ...
    } else {
      entryPoint(message);  //执行真正的用户自定义操作
    }
  };
  port.sendPort.send(null);
}
```

历经千山万水，终于开始最开始[小节2.1]中指定的方法entryPoint(message)。

### 2.18 MessageHandler::HandleMessages
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
MessageHandler::MessageStatus MessageHandler::HandleMessages(
    MonitorLocker* ml,
    bool allow_normal_messages,
    bool allow_multiple_normal_messages) {
  StartIsolateScope start_isolate(isolate());

  MessageStatus max_status = kOK;
  Message::Priority min_priority =
      ((allow_normal_messages && !paused()) ? Message::kNormalPriority
                                            : Message::kOOBPriority);

  Message* message = DequeueMessage(min_priority);
  while (message != NULL) {
    intptr_t message_len = message->Size();
    ml->Exit();
    Message::Priority saved_priority = message->priority();
    Dart_Port saved_dest_port = message->dest_port();
    //执行消息回调
    MessageStatus status = HandleMessage(message);
    if (status > max_status) {
      max_status = status;
    }
    message = NULL;
    ml->Enter();
    ...

    //有时候只允许处理一个普通消息则需要退出
    if ((saved_priority == Message::kNormalPriority) &&
        !allow_multiple_normal_messages) {
      // 已处理一个普通消息，则不再允许
      allow_normal_messages = false;
    }

    //重新评估最低允许优先级。 可能发生错误、不再允许处理普通消息、或者处于暂停状态，但都不影响OOB消息的执行
    min_priority = (((max_status == kOK) && allow_normal_messages && !paused())
                        ? Message::kNormalPriority
                        : Message::kOOBPriority);
    //取出下一个消息
    message = DequeueMessage(min_priority);
  }
  return max_status;
}
```

更多关于HandleMessages()的细节，见文章[深入理解Flutter异步Future机制](http://gityuan.com/2019/07/21/flutter_future/)中的[小节4.3]

### 2.19 MessageHandler::CheckIfIdleLocked
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
bool MessageHandler::CheckIfIdleLocked(MonitorLocker* ml) {
  if ((isolate() == NULL) || (idle_start_time_ == 0) ||
      (FLAG_idle_timeout_micros == 0)) {
    // No idle task to schedule.
    return false; //没有待调度的空闲任务
  }
  const int64_t now = OS::GetCurrentMonotonicMicros();
  const int64_t idle_expirary = idle_start_time_ + FLAG_idle_timeout_micros;
  if (idle_expirary > now) {
    paused_for_messages_ = true;
    //等待一段时间，直到下次新消息或者OOB消息的到来
    ml->WaitMicros(idle_expirary - now);
    paused_for_messages_ = false;
    return true;
  }
  // 立刻执行idle任务 [见小节2.19.1]
  RunIdleTaskLocked(ml);
  return true;
}
```

#### 2.19.1 MessageHandler::RunIdleTaskLocked
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
void MessageHandler::RunIdleTaskLocked(MonitorLocker* ml) {
  //在deadline之前的这段空闲时间里执行内存清理操作，
  const int64_t now = OS::GetCurrentMonotonicMicros();
  const int64_t deadline = now + FLAG_idle_duration_micros;
  ml->Exit();
  {
    StartIsolateScope start_isolate(isolate());
    isolate()->NotifyIdle(deadline); //唤醒执行GC操作
  }
  ml->Enter();
  idle_start_time_ = 0;
}
```

对堆内存进行GC操作。 接下来再回到最开始的[小节2.2]执行\_spawnCommon()操作。

### 2.20 \_spawnCommon
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
static Future<Isolate> _spawnCommon(RawReceivePort readyPort) {
  Completer completer = new Completer<Isolate>.sync();
  readyPort.handler = (readyMessage) {
    readyPort.close();
    if (readyMessage is List && readyMessage.length == 2) {
      SendPort controlPort = readyMessage[0];
      List capabilities = readyMessage[1];
      completer.complete(new Isolate(controlPort,
          pauseCapability: capabilities[0],
          terminateCapability: capabilities[1]));
    } else if (readyMessage is String) {
      //启动新isolate过程发生错误
      completer.completeError(new IsolateSpawnException(
          'Unable to spawn isolate: ${readyMessage}'));
    } else {
      ...
    }
  };
  return completer.future;
}
```

## 三、总结

Flutter的dart代码默认运行在root isolate，即便是创建的异步future方法也不例外，而对于耗时方法势必会导致UI线程阻塞，从而导致卡顿。如何解决这个问题呢，那就是针对耗时的操作，需要创建新的isolate，isolate采用的是同一进程内的多线程间内存不共享的设计方案。dart语言之所以这样设计isolate，是为了避免线程竞争出现。正因为isolate之间无法共享内存数据，为此同时设计了套SendPort/ReceivePort的Port端口通信机制，让各isolate间彼此独立，但又可以相互的通信。对于port通信的实现原理其实还是异步消息机制。Dart的Isolate是由Dart VM管理的，对于Flutter引擎也无法直接访问。

通过阅读整个isolate源码过程，不难发现，每一次创建新的isolate的同时会通过pthread_create()来创建一个OSThread线程，isolate的工作便是在该线程中运行，其实可以简单理解成isolate是一种内存不共享的线程，isolate只是在系统现在线程基础之上做了一层封装而已。可通过Dart_CreateIsolate和Dart_ShutdownIsolate分别对应isolate的创建与关闭。
