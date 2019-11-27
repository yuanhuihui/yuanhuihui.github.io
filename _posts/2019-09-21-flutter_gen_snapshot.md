---
layout: post
title:  "Flutter机器码生成gen_snapshot"
date:   2019-09-21 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、概述

书接上文[源码解读Flutter run机制](http://gityuan.com/2019/09/07/flutter_run/)的第四节 flutter build aot命令将dart源码编译成AOT产物，其主要工作为前端编译器frontend_server和机器码生成，本文再来介绍机器码生成的工作原理。

### 1.1 GenSnapshot命令
GenSnapshot.run具体命令根据前面的封装，针对Android和iOS平台各有不同：

#### 1.1.1 针对Android平台

```Java
flutter/bin/cache/artifacts/engine/android-arm-release/darwin-x64/gen_snapshot                   \
  --causal_async_stacks                                                                          \
  --packages=.packages                                                                           \
  --deterministic                                                                                \
  --snapshot_kind=app-aot-blobs                                                                  \
  --vm_snapshot_data=build/app/intermediates/flutter/release/vm_snapshot_data                    \
  --isolate_snapshot_data=build/app/intermediates/flutter/release/isolate_snapshot_data          \
  --vm_snapshot_instructions=build/app/intermediates/flutter/release/vm_snapshot_instr           \
  --isolate_snapshot_instructions=build/app/intermediates/flutter/release/isolate_snapshot_instr \
  --no-sim-use-hardfp                                                                            \
  --no-use-integer-division                                                                      \
  build/app/intermediates/flutter/release/app.dill
```

上述命令用于Android平台将dart kernel转换为机器码。

#### 1.1.2 针对iOS平台

```Java
/usr/bin/arch -x86_64 flutter/bin/cache/artifacts/engine/ios-release/gen_snapshot \
  --causal_async_stacks                                                           \
  --deterministic                                                                 \
  --snapshot_kind=app-aot-assembly                                                \
  --assembly=build/aot/arm64/snapshot_assembly.S                                  \
  build/aot/app.dill                                                              
```

上述命令用于iOS平台将dart kernel转换为机器码。

### 1.2 机器码生成流程图

[点击查看大图](/img/flutter_compile/SeqCodeGen.jpg)

![SeqCodeGen](/img/flutter_compile/SeqCodeGen.jpg)

此处gen_snapshot是一个二进制可执行文件，所对应的执行方法源码为third_party/dart/runtime/bin/gen_snapshot.cc，gen_snapshot将dart代码生成AOT二进制机器码，其中重点过程在precompiler.cc中的DoCompileAll()。

#### 1.2.1 小结

先通过Dart_Initialize()来初始化Dart虚拟机环境，


#### 1.2.2 snapshot类型

|类型|名称|
|---|---|
|kCore|core|
|kCoreJIT|core-jit|
|kApp|app|
|kAppJIT|app-jit|
|kAppAOTBlobs|app-aot-blobs|
|kAppAOTAssembly|app-aot-assembly|
|kVMAOTAssembly|vm-aot-assembly|

##  二、源码解读GenSnapshot

```
BuildAotCommand.runCommand
  AOTSnapshotter.build
    GenSnapshot.run
      gen_snapshot.main
```

### 2.1 gen_snapshot.main
[-> third_party/dart/runtime/bin/gen_snapshot.cc]

```Java
int main(int argc, char** argv) {
  const int EXTRA_VM_ARGUMENTS = 7;
  CommandLineOptions vm_options(argc + EXTRA_VM_ARGUMENTS);
  CommandLineOptions inputs(argc);

  //从命令行运行时，除非指定其他参数，否则使用更大的新一代半空间大小和更快的新一代生长因子
  if (kWordSize <= 4) {
    vm_options.AddArgument("--new_gen_semi_max_size=16");
  } else {
    vm_options.AddArgument("--new_gen_semi_max_size=32");
  }
  vm_options.AddArgument("--new_gen_growth_factor=4");
  vm_options.AddArgument("--deterministic");

  //解析命令行参数
  if (ParseArguments(argc, argv, &vm_options, &inputs) < 0) {
    return kErrorExitCode;
  }
  DartUtils::SetEnvironment(environment);

  if (!Platform::Initialize()) {
    return kErrorExitCode;
  }
  Console::SaveConfig();
  Loader::InitOnce();
  DartUtils::SetOriginalWorkingDirectory();
  //设置事件handler
  TimerUtils::InitOnce();
  EventHandler::Start();

  if (IsSnapshottingForPrecompilation()) {
    vm_options.AddArgument("--precompilation");
  } else if ((snapshot_kind == kCoreJIT) || (snapshot_kind == kAppJIT)) {
    vm_options.AddArgument("--fields_may_be_reset");
  }

  char* error = Dart_SetVMFlags(vm_options.count(), vm_options.arguments());

  Dart_InitializeParams init_params;
  memset(&init_params, 0, sizeof(init_params));
  init_params.version = DART_INITIALIZE_PARAMS_CURRENT_VERSION;
  init_params.file_open = DartUtils::OpenFile;
  init_params.file_read = DartUtils::ReadFile;
  init_params.file_write = DartUtils::WriteFile;
  init_params.file_close = DartUtils::CloseFile;
  init_params.entropy_source = DartUtils::EntropySource;
  init_params.start_kernel_isolate = false;

  std::unique_ptr<MappedMemory> mapped_vm_snapshot_data;
  std::unique_ptr<MappedMemory> mapped_vm_snapshot_instructions;
  std::unique_ptr<MappedMemory> mapped_isolate_snapshot_data;
  std::unique_ptr<MappedMemory> mapped_isolate_snapshot_instructions;
  //将这4个产物文件mmap到内存
  if (load_vm_snapshot_data_filename != NULL) {
    mapped_vm_snapshot_data =
        MapFile(load_vm_snapshot_data_filename, File::kReadOnly,
                &init_params.vm_snapshot_data);
  }
  if (load_vm_snapshot_instructions_filename != NULL) {
    mapped_vm_snapshot_instructions =
        MapFile(load_vm_snapshot_instructions_filename, File::kReadExecute,
                &init_params.vm_snapshot_instructions);
  }
  if (load_isolate_snapshot_data_filename) {
    mapped_isolate_snapshot_data =
        MapFile(load_isolate_snapshot_data_filename, File::kReadOnly,
                &isolate_snapshot_data);
  }
  if (load_isolate_snapshot_instructions_filename != NULL) {
    mapped_isolate_snapshot_instructions =
        MapFile(load_isolate_snapshot_instructions_filename, File::kReadExecute,
                &isolate_snapshot_instructions);
  }
  // 初始化Dart虚拟机 [见小节2.1.1]
  error = Dart_Initialize(&init_params);
  //[见小节2.2]
  int result = CreateIsolateAndSnapshot(inputs);
  // 回收Dart虚拟机
  error = Dart_Cleanup();
  EventHandler::Stop();
  return 0;
}
```

该方法主要功能说明：

- 初始化参数，并将这4个产物文件mmap到内存
- 执行Dart_Initialize()来初始化Dart虚拟机环境
- CreateIsolateAndSnapshot


#### 2.1.1 Dart_Initialize
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
DART_EXPORT char* Dart_Initialize(Dart_InitializeParams* params) {
  ...
  return Dart::Init(params->vm_snapshot_data, params->vm_snapshot_instructions,
                    params->create, params->shutdown, params->cleanup,
                    params->thread_exit, params->file_open, params->file_read,
                    params->file_write, params->file_close,
                    params->entropy_source, params->get_service_assets,
                    params->start_kernel_isolate);
}
```

[深入理解Dart虚拟机启动](http://gityuan.com/2019/06/23/dart-vm/)的[小节2.10]记录了Dart虚拟机的初始化过程。

### 2.2 CreateIsolateAndSnapshot
[-> third_party/dart/runtime/bin/gen_snapshot.cc]

```Java
static int CreateIsolateAndSnapshot(const CommandLineOptions& inputs) {
  uint8_t* kernel_buffer = NULL;
  intptr_t kernel_buffer_size = NULL;
  ReadFile(inputs.GetArgument(0), &kernel_buffer, &kernel_buffer_size);

  Dart_IsolateFlags isolate_flags;
  Dart_IsolateFlagsInitialize(&isolate_flags);
  if (IsSnapshottingForPrecompilation()) {
    isolate_flags.obfuscate = obfuscate;
    isolate_flags.entry_points = no_entry_points;
  }

  IsolateData* isolate_data = new IsolateData(NULL, NULL, NULL, NULL);
  Dart_Isolate isolate;
  char* error = NULL;
  //创建isolate
  if (isolate_snapshot_data == NULL) {
    // 将vmservice库加入到核心snapshot，因此将其加载到main isolate
    isolate_flags.load_vmservice_library = true;
    isolate = Dart_CreateIsolateFromKernel(NULL, NULL, kernel_buffer,
                                           kernel_buffer_size, &isolate_flags,
                                           isolate_data, &error);
  } else {
    isolate = Dart_CreateIsolate(NULL, NULL, isolate_snapshot_data,
                                 isolate_snapshot_instructions, NULL, NULL,
                                 &isolate_flags, isolate_data, &error);
  }

  Dart_EnterScope();
  Dart_Handle result = Dart_SetEnvironmentCallback(DartUtils::EnvironmentCallback);

  result = Dart_SetRootLibrary(Dart_LoadLibraryFromKernel(kernel_buffer, kernel_buffer_size));

  MaybeLoadExtraInputs(inputs);
  MaybeLoadCode();
  // 根据产物类别 来创建相应产物
  switch (snapshot_kind) {
    case kCore:
      CreateAndWriteCoreSnapshot();
      break;
    case kCoreJIT:
      CreateAndWriteCoreJITSnapshot();
      break;
    case kApp:
      CreateAndWriteAppSnapshot();
      break;
    case kAppJIT:
      CreateAndWriteAppJITSnapshot();
      break;
    case kAppAOTBlobs:
    case kAppAOTAssembly:
      //[见小节2.3]
      CreateAndWritePrecompiledSnapshot();
      break;
    case kVMAOTAssembly: {
      File* file = OpenFile(assembly_filename);
      RefCntReleaseScope<File> rs(file);
      result = Dart_CreateVMAOTSnapshotAsAssembly(StreamingWriteCallback, file);
      CHECK_RESULT(result);
      break;
    }
    default:
      UNREACHABLE();
  }

  Dart_ExitScope();
  Dart_ShutdownIsolate();
  return 0;
}

```

编译产物类型有7类，见[小节1.2.2]。 根据不同类型调用不同的CreateAndWriteXXXSnapshot()方法：

- kCore：CreateAndWriteCoreSnapshot
- kCoreJIT：CreateAndWriteCoreJITSnapshot
- kApp：CreateAndWriteAppSnapshot
- kAppJIT：CreateAndWriteAppJITSnapshot
- kAppAOTBlobs：CreateAndWritePrecompiledSnapshot
- kAppAOTAssembly：CreateAndWritePrecompiledSnapshot
- kVMAOTAssembly：Dart_CreateVMAOTSnapshotAsAssembly


此处介绍AOT模式下，接下来执行CreateAndWritePrecompiledSnapshot()过程。

### 2.3 CreateAndWritePrecompiledSnapshot
[-> third_party/dart/runtime/bin/gen_snapshot.cc]

```Java
static void CreateAndWritePrecompiledSnapshot() {
  Dart_Handle result;

  //使用指定的嵌入程序入口点进行预编译 [见小节2.4]
  result = Dart_Precompile();

  //创建一个预编译的snapshot
  bool as_assembly = assembly_filename != NULL;
  if (as_assembly) {
    // kAppAOTAssembly模式
    File* file = OpenFile(assembly_filename);
    RefCntReleaseScope<File> rs(file);
    //iOS采用该方式 [见小节三]
    result = Dart_CreateAppAOTSnapshotAsAssembly(StreamingWriteCallback, file);
  } else {
    // kAppAOTBlobs模式
    const uint8_t* shared_data = NULL;
    const uint8_t* shared_instructions = NULL;
    std::unique_ptr<MappedMemory> mapped_shared_data;
    std::unique_ptr<MappedMemory> mapped_shared_instructions;
    if (shared_blobs_filename != NULL) {
      AppSnapshot* shared_blobs = NULL;
      shared_blobs = Snapshot::TryReadAppSnapshot(shared_blobs_filename);
      const uint8_t* ignored;
      shared_blobs->SetBuffers(&ignored, &ignored, &shared_data,
                               &shared_instructions);
    } else {
      if (shared_data_filename != NULL) {
        mapped_shared_data =
            MapFile(shared_data_filename, File::kReadOnly, &shared_data);
      }
      if (shared_instructions_filename != NULL) {
        mapped_shared_instructions =
            MapFile(shared_instructions_filename, File::kReadOnly,
                    &shared_instructions);
      }
    }
    ...
    //将snapshot写入buffer缓存 [见小节四]
    result = Dart_CreateAppAOTSnapshotAsBlobs(
        &vm_snapshot_data_buffer, &vm_snapshot_data_size,
        &vm_snapshot_instructions_buffer, &vm_snapshot_instructions_size,
        &isolate_snapshot_data_buffer, &isolate_snapshot_data_size,
        &isolate_snapshot_instructions_buffer, &isolate_snapshot_instructions_size,
        shared_data, shared_instructions);

    if (blobs_container_filename != NULL) {
      Snapshot::WriteAppSnapshot(
          blobs_container_filename, vm_snapshot_data_buffer,
          vm_snapshot_data_size, vm_snapshot_instructions_buffer,
          vm_snapshot_instructions_size, isolate_snapshot_data_buffer,
          isolate_snapshot_data_size, isolate_snapshot_instructions_buffer,
          isolate_snapshot_instructions_size);
    } else {
      // 将内存中的产物数据写入相应的文件
      WriteFile(vm_snapshot_data_filename,
            vm_snapshot_data_buffer, vm_snapshot_data_size);
      WriteFile(vm_snapshot_instructions_filename,
            vm_snapshot_instructions_buffer, vm_snapshot_instructions_size);
      WriteFile(isolate_snapshot_data_filename,
            isolate_snapshot_data_buffer, isolate_snapshot_data_size);
      WriteFile(isolate_snapshot_instructions_filename,
            isolate_snapshot_instructions_buffer, isolate_snapshot_instructions_size);
    }
  }

  // 如果需要，序列化混淆图
  if (obfuscation_map_filename != NULL) {
    uint8_t* buffer = NULL;
    intptr_t size = 0;
    result = Dart_GetObfuscationMap(&buffer, &size);
    WriteFile(obfuscation_map_filename, buffer, size);
  }
}
```

该方法说明：

- 调用Dart_Precompile()执行AOT编译
- 将snapshot代码写入buffer
- 将buffer写入这四个二进制文件vm_snapshot_data，vm_snapshot_instructions，isolate_snapshot_data，isolate_snapshot_instructions

该方法最终将Dart代码彻底编译为二进制可执行的机器码文件

### 2.4 Dart_Precompile
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
DART_EXPORT Dart_Handle Dart_Precompile() {
  ...
#if defined(DART_PRECOMPILER)
  DARTSCOPE(Thread::Current());
  API_TIMELINE_BEGIN_END(T);
  if (!FLAG_precompiled_mode) {
    return Api::NewError("Flag --precompilation was not specified.");
  }
  Dart_Handle result = Api::CheckAndFinalizePendingClasses(T);
  if (Api::IsError(result)) {
    return result;
  }
  CHECK_CALLBACK_STATE(T);
  //[见小节2.4.1]
  CHECK_ERROR_HANDLE(Precompiler::CompileAll());
  return Api::Success();
#endif
}
```

#### 2.4.1 CompileAll
[-> third_party/dart/runtime/vm/compiler/aot/precompiler.cc]

```Java
RawError* Precompiler::CompileAll() {
  LongJumpScope jump;
  if (setjmp(*jump.Set()) == 0) {
    //创建Precompiler对象
    Precompiler precompiler(Thread::Current());
    //[见小节2.4.2]
    precompiler.DoCompileAll();
    return Error::null();
  } else {
    return Thread::Current()->StealStickyError();
  }
}
```

在Dart Runtime中生成FlowGraph对象，接着进行一系列执行流的优化，最后把优化后的FlowGraph对象转换为具体相应系统架构（arm/arm64等）的二进制指令

#### 2.4.2 DoCompileAll
[-> third_party/dart/runtime/vm/compiler/aot/precompiler.cc]

```Java
void Precompiler::DoCompileAll() {
  {
    StackZone stack_zone(T);
    zone_ = stack_zone.GetZone();

    if (FLAG_use_bare_instructions) {
      // 使用zone_来保障全局object对象池的生命周期能伴随整个AOT编译过程
      global_object_pool_builder_.InitializeWithZone(zone_);
    }

    {
      HANDLESCOPE(T);
      // 确保类层次稳定，因此会先支持CHA分析类层次结构
      FinalizeAllClasses();
      ClassFinalizer::SortClasses();

      // 收集类型使用情况信息，使我们可以决定何时/如何优化运行时类型测试
      TypeUsageInfo type_usage_info(T);

      // 一个类的子类的cid范围，用于is/as的类型检查
      HierarchyInfo hierarchy_info(T);

      // 预编译构造函数以计算信息，例如优化的指令数（用于内联启发法）
      ClassFinalizer::ClearAllCode(FLAG_use_bare_instructions);
      PrecompileConstructors();

      ClassFinalizer::ClearAllCode(FLAG_use_bare_instructions);

      // 所有存根都已经生成，它们都共享同一个池。 使用该池来初始化全局对象池，
      // 以确保存根和此处编译的代码都具有相同的池。
      if (FLAG_use_bare_instructions) {
        // 在这里使用任何存根来获取它的对象池（所有存根在裸指令模式下共享相同的对象池）
        const Code& code = StubCode::InterpretCall();
        const ObjectPool& stub_pool = ObjectPool::Handle(code.object_pool());

        global_object_pool_builder()->Reset();
        stub_pool.CopyInto(global_object_pool_builder());

        //我们有两个需要使用新的全局对象池重新生成的全局代码对象，即
        // 大型未命中处理程序代码 和 构建方法提取器代码
        MegamorphicCacheTable::ReInitMissHandlerCode(
            isolate_, global_object_pool_builder());

        auto& stub_code = Code::Handle();

        stub_code = StubCode::GetBuildMethodExtractorStub(global_object_pool_builder());
        I->object_store()->set_build_method_extractor_code(stub_code);

        stub_code = StubCode::BuildIsolateSpecificNullErrorSharedWithFPURegsStub(
                global_object_pool_builder());
        I->object_store()->set_null_error_stub_with_fpu_regs_stub(stub_code);

        stub_code = StubCode::BuildIsolateSpecificNullErrorSharedWithoutFPURegsStub(
                global_object_pool_builder());
        I->object_store()->set_null_error_stub_without_fpu_regs_stub(stub_code);

        stub_code = StubCode::BuildIsolateSpecificStackOverflowSharedWithFPURegsStub(
                global_object_pool_builder());
        I->object_store()->set_stack_overflow_stub_with_fpu_regs_stub(stub_code);

        stub_code = StubCode::BuildIsolateSpecificStackOverflowSharedWithoutFPURegsStub(
                global_object_pool_builder());
        I->object_store()->set_stack_overflow_stub_without_fpu_regs_stub(stub_code);

        stub_code = StubCode::BuildIsolateSpecificWriteBarrierWrappersStub(
                global_object_pool_builder());
        I->object_store()->set_write_barrier_wrappers_stub(stub_code);

        stub_code = StubCode::BuildIsolateSpecificArrayWriteBarrierStub(
                global_object_pool_builder());
        I->object_store()->set_array_write_barrier_stub(stub_code);
      }

      CollectDynamicFunctionNames();

      // 从C++发生的分配和调用的起点添加为根
      AddRoots();
      // 将所有以@pragma（'vm：entry-point'）注释的值添加为根
      AddAnnotatedRoots();

      //编译前面找到的根作为目标，并逐步添加该目标的调用者，直到达到固定点为止
      Iterate();

      // 用新的[Type]专用存根替换安装在[Type]上的默认类型测试存根
      AttachOptimizedTypeTestingStub();

      if (FLAG_use_bare_instructions) {
        // 生成实际的对象池实例，并将其附加到对象存储。AOT运行时将在dart入口代码存根中使用它。
        const auto& pool = ObjectPool::Handle(
            ObjectPool::NewFromBuilder(*global_object_pool_builder()));
        I->object_store()->set_global_object_pool(pool);
        global_object_pool_builder()->Reset();

        if (FLAG_print_gop) {
          THR_Print("Global object pool:\n");
          pool.DebugPrint();
        }
      }

      I->set_compilation_allowed(false);

      TraceForRetainedFunctions();
      DropFunctions();
      DropFields();
      TraceTypesFromRetainedClasses();
      DropTypes();
      DropTypeArguments();

      // 在删除类之前清除这些类的死实例或者未使用的符号
      I->object_store()->set_unique_dynamic_targets(Array::null_array());
      Class& null_class = Class::Handle(Z);
      Function& null_function = Function::Handle(Z);
      Field& null_field = Field::Handle(Z);
      I->object_store()->set_future_class(null_class);
      I->object_store()->set_pragma_class(null_class);
      I->object_store()->set_pragma_name(null_field);
      I->object_store()->set_pragma_options(null_field);
      I->object_store()->set_completer_class(null_class);
      I->object_store()->set_symbol_class(null_class);
      I->object_store()->set_compiletime_error_class(null_class);
      I->object_store()->set_growable_list_factory(null_function);
      I->object_store()->set_simple_instance_of_function(null_function);
      I->object_store()->set_simple_instance_of_true_function(null_function);
      I->object_store()->set_simple_instance_of_false_function(null_function);
      I->object_store()->set_async_set_thread_stack_trace(null_function);
      I->object_store()->set_async_star_move_next_helper(null_function);
      I->object_store()->set_complete_on_async_return(null_function);
      I->object_store()->set_async_star_stream_controller(null_class);
      DropMetadata();
      DropLibraryEntries();
    }
    DropClasses();
    DropLibraries();

    BindStaticCalls();
    SwitchICCalls();
    Obfuscate();

    ProgramVisitor::Dedup();
    zone_ = NULL;
  }

  intptr_t symbols_before = -1;
  intptr_t symbols_after = -1;
  intptr_t capacity = -1;
  if (FLAG_trace_precompiler) {
    //获取symbol表的统计信息
    Symbols::GetStats(I, &symbols_before, &capacity);
  }

  Symbols::Compact();

  if (FLAG_trace_precompiler) {
    Symbols::GetStats(I, &symbols_after, &capacity);
    THR_Print("Precompiled %" Pd " functions,", function_count_);
    THR_Print(" %" Pd " dynamic types,", class_count_);
    THR_Print(" %" Pd " dynamic selectors.\n", selector_count_);

    THR_Print("Dropped %" Pd " functions,", dropped_function_count_);
    THR_Print(" %" Pd " fields,", dropped_field_count_);
    THR_Print(" %" Pd " symbols,", symbols_before - symbols_after);
    THR_Print(" %" Pd " types,", dropped_type_count_);
    THR_Print(" %" Pd " type arguments,", dropped_typearg_count_);
    THR_Print(" %" Pd " classes,", dropped_class_count_);
    THR_Print(" %" Pd " libraries.\n", dropped_library_count_);
  }
}
```

这个过程比较复杂，其主要工作内容如下：

- FinalizeAllClasses()：确保类层次稳定，因此会先支持CHA分析类层次结构；
- PrecompileConstructors()：预编译构造函数以计算信息，例如优化的指令数（用于内联启发法）；
- StubCode：通过StubCode::InterpretCall得到的code来获取它的对象池，再利用StubCode::BuildXXX()系列方法获取的结果保存在object_store；
- CollectDynamicFunctionNames()：收集动态函数的方法名；
- AddRoots()：从C++发生的分配和调用的起点添加为根；
- AddAnnotatedRoots()：将所有以@pragma（'vm：entry-point'）注释的值添加为根;
- Iterate(): 这是编译最为核心的地方，编译前面找到的根作为目标，并逐步添加该目标的调用者，直到达到固定点为止；
- DropXXX(): 调用DropFunctions，DropFields，DropTypes等一系列操作 去掉方法、字段、类、库等；
- BindStaticCalls()：绑定静态调用方法，说明tree-shaker后并非所有的函数都会被编译；
- SwitchICCalls()：已编译所有静态函数，则切到实例调用(instance call)队列，迭代所有对象池；
- Obfuscate()：执行代码混淆操作，并保持混淆map表；
- ProgramVisitor::Dedup()：清理各数据段的重复数据，比如CodeSourceMaps、StackMaps等；
- Symbols::Compact(): 执行完整的垃圾回收，整理后压缩symbols；

到此Dart_Precompile()过程执行完成。

Dart_Precompile()执行完再回到[小节2.3]，再来分别看看产物生成的过程。

- iOS：执行Dart_CreateAppAOTSnapshotAsAssembly()方法；
- Android：执行Dart_CreateAppAOTSnapshotAsBlobs()方法。


## 三、 iOS快照产物生成
### 3.1 Dart_CreateAppAOTSnapshotAsAssembly
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
DART_EXPORT Dart_Handle
Dart_CreateAppAOTSnapshotAsAssembly(Dart_StreamingWriteCallback callback,
                                    void* callback_data) {
#if defined(DART_PRECOMPILER)
  ...
  //初始化AssemblyImageWriter对象
  AssemblyImageWriter image_writer(T, callback, callback_data, NULL, NULL);
  uint8_t* vm_snapshot_data_buffer = NULL;
  uint8_t* isolate_snapshot_data_buffer = NULL;
  FullSnapshotWriter writer(Snapshot::kFullAOT, &vm_snapshot_data_buffer,
                            &isolate_snapshot_data_buffer, ApiReallocate,
                            &image_writer, &image_writer);
  //[见小节3.2]
  writer.WriteFullSnapshot();
  //[见小节3.7]
  image_writer.Finalize();
  return Api::Success();
#endif
}
```

创建AssemblyImageWriter对象过程，初始化其成员变量StreamingWriteStream类型的assembly_stream_和Dwarf*类型的dwarf_

- assembly_stream_初始化：创建大小等于512KB的buffer_，callback_为StreamingWriteCallback，callback_为snapshot_assembly.S
- dwarf_初始化：其成员变量stream_指向assembly_stream_；

创建FullSnapshotWriter对象过程，初始化其成员变量kind_等于Snapshot::kFullAOT。vm_snapshot_data_buffer_和isolate_snapshot_data_buffer_分别指向vm_snapshot_data_buffer和isolate_snapshot_data_buffer的地址。

### 3.2 WriteFullSnapshot
[-> third_party/dart/runtime/vm/clustered_snapshot.cc]

```Java
void FullSnapshotWriter::WriteFullSnapshot() {
  intptr_t num_base_objects;
  if (vm_snapshot_data_buffer() != NULL) {
    //[见小节3.3]
    num_base_objects = WriteVMSnapshot();
  } else {
    num_base_objects = 0;
  }

  if (isolate_snapshot_data_buffer() != NULL) {
    //[见小节3.6]
    WriteIsolateSnapshot(num_base_objects);
  }

  if (FLAG_print_snapshot_sizes) {
    OS::Print("VMIsolate(CodeSize): %" Pd "\n", clustered_vm_size_);
    OS::Print("Isolate(CodeSize): %" Pd "\n", clustered_isolate_size_);
    OS::Print("ReadOnlyData(CodeSize): %" Pd "\n", mapped_data_size_);
    OS::Print("Instructions(CodeSize): %" Pd "\n", mapped_text_size_);
    OS::Print("Total(CodeSize): %" Pd "\n",
              clustered_vm_size_ + clustered_isolate_size_ + mapped_data_size_ +
                  mapped_text_size_);
  }
}
```

产物大小的分类来自于FullSnapshotWriter的几个成员变量

- clustered_vm_size_：是vm的数据段，包含符号表和stub代码
- clustered_isolate_size_：是isolate的数据段，包含object store
- ReadOnlyData：是由vm和isolate的只读数据段组成
- Instructions：是由vm和isolate的代码段组成

### 3.3 WriteVMSnapshot
[-> third_party/dart/runtime/vm/clustered_snapshot.cc]

```Java
intptr_t FullSnapshotWriter::WriteVMSnapshot() {
  Serializer serializer(thread(), kind_, vm_snapshot_data_buffer_, alloc_,
                        kInitialSize, vm_image_writer_, /*vm=*/true,
                        profile_writer_);

  serializer.ReserveHeader();  //预留空间来记录快照buffer的大小
  serializer.WriteVersionAndFeatures(true);
  const Array& symbols = Array::Handle(Dart::vm_isolate()->object_store()->symbol_table());
  //写入符号表 [见小节3.3.1]
  intptr_t num_objects = serializer.WriteVMSnapshot(symbols);
  serializer.FillHeader(serializer.kind());  //填充头部信息
  clustered_vm_size_ = serializer.bytes_written();

  if (Snapshot::IncludesCode(kind_)) {  //kFullAOT模式满足条件
    vm_image_writer_->SetProfileWriter(profile_writer_);
    //[见小节3.4]
    vm_image_writer_->Write(serializer.stream(), true);
    mapped_data_size_ += vm_image_writer_->data_size(); //数据段
    mapped_text_size_ += vm_image_writer_->text_size(); //代码段
    vm_image_writer_->ResetOffsets();
    vm_image_writer_->ClearProfileWriter();
  }

  //集群部分+直接映射的数据部分
  vm_isolate_snapshot_size_ = serializer.bytes_written();
  return num_objects;
}
```

创建Serializer对象过程，初始化其成员变量WriteStream类型的stream_。VM snapshot的根节点是符号表和stub代码(App-AOT、App-JIT、Core-JIT)


serializer通过其成员变量stream_写入如下内容：

- FillHeader：头部内容
- WriteVersionAndFeatures：版本信息
- WriteVMSnapshot：符号表

#### 3.3.1 Serializer::WriteVMSnapshot
[-> third_party/dart/runtime/vm/clustered_snapshot.cc]

```Java
intptr_t Serializer::WriteVMSnapshot(const Array& symbols) {
  NoSafepointScope no_safepoint;
  //添加虚拟机isolate的基本对象
  AddVMIsolateBaseObjects();

  //VM snapshot的根节点 入栈，也就是是符号表和stub代码
  Push(symbols.raw());
  if (Snapshot::IncludesCode(kind_)) {
    for (intptr_t i = 0; i < StubCode::NumEntries(); i++) {
      Push(StubCode::EntryAt(i).raw());
    }
  }
  //写入stream_
  Serialize();

  //写入VM snapshot的根节点
  WriteRootRef(symbols.raw());
  if (Snapshot::IncludesCode(kind_)) {
    for (intptr_t i = 0; i < StubCode::NumEntries(); i++) {
      WriteRootRef(StubCode::EntryAt(i).raw());
    }
  }

  //  虚拟机isolate快照的完整 作为isolate快照的基本对象
  //返回对象个数
  return next_ref_index_ - 1;
}
```

### 3.4 ImageWriter::Write
[-> third_party/dart/runtime/vm/image_snapshot.cc]

```Java
void ImageWriter::Write(WriteStream* clustered_stream, bool vm) {
  Thread* thread = Thread::Current();
  Zone* zone = thread->zone();
  Heap* heap = thread->isolate()->heap();

  //处理收集的原始指针，构建以下名称将分配在Dart堆
  for (intptr_t i = 0; i < instructions_.length(); i++) {
    InstructionsData& data = instructions_[i];
    const bool is_trampoline = data.trampoline_bytes != nullptr;
    if (is_trampoline) continue;

    data.insns_ = &Instructions::Handle(zone, data.raw_insns_);
    data.code_ = &Code::Handle(zone, data.raw_code_);

    //重置isolate快照的对象id
    heap->SetObjectId(data.insns_->raw(), 0);
  }
  for (intptr_t i = 0; i < objects_.length(); i++) {
    ObjectData& data = objects_[i];
    data.obj_ = &Object::Handle(zone, data.raw_obj_);
  }

  //在群集快照之后附加直接映射的RO数据对象
  offset_space_ = vm ? V8SnapshotProfileWriter::kVmData
                     : V8SnapshotProfileWriter::kIsolateData;
  //[见小节3.4.1]
  WriteROData(clustered_stream);

  offset_space_ = vm ? V8SnapshotProfileWriter::kVmText
                     : V8SnapshotProfileWriter::kIsolateText;
  //[见小节3.5]
  WriteText(clustered_stream, vm);
}
```

此处clustered_stream的是指Serializer的成员变量stream_。

#### 3.4.1 WriteROData
[-> third_party/dart/runtime/vm/image_snapshot.cc]

```Java
void ImageWriter::WriteROData(WriteStream* stream) {
  stream->Align(OS::kMaxPreferredCodeAlignment);  //32位对齐

  //堆页面的起点
  intptr_t section_start = stream->Position();
  stream->WriteWord(next_data_offset_);  // Data length.
  stream->Align(OS::kMaxPreferredCodeAlignment);

  //堆页面中对象的起点
  for (intptr_t i = 0; i < objects_.length(); i++) {
    const Object& obj = *objects_[i].obj_;
    AutoTraceImage(obj, section_start, stream);

    NoSafepointScope no_safepoint;
    uword start = reinterpret_cast<uword>(obj.raw()) - kHeapObjectTag;
    uword end = start + obj.raw()->HeapSize();

    //写有标记和只读位的对象标头
    uword marked_tags = obj.raw()->ptr()->tags_;
    marked_tags = RawObject::OldBit::update(true, marked_tags);
    marked_tags = RawObject::OldAndNotMarkedBit::update(false, marked_tags);
    marked_tags = RawObject::OldAndNotRememberedBit::update(true, marked_tags);
    marked_tags = RawObject::NewBit::update(false, marked_tags);

    stream->WriteWord(marked_tags);
    start += sizeof(uword);
    for (uword* cursor = reinterpret_cast<uword*>(start);
         cursor < reinterpret_cast<uword*>(end); cursor++) {
      stream->WriteWord(*cursor);
    }
  }
}
```

### 3.5 AssemblyImageWriter::WriteText
[-> ]third_party/dart/runtime/vm/image_snapshot.cc]

```Java
void AssemblyImageWriter::WriteText(WriteStream* clustered_stream, bool vm) {
  Zone* zone = Thread::Current()->zone();
  //写入头部
  const char* instructions_symbol = vm ? "_kDartVmSnapshotInstructions" : "_kDartIsolateSnapshotInstructions";
  assembly_stream_.Print(".text\n");
  assembly_stream_.Print(".globl %s\n", instructions_symbol);
  assembly_stream_.Print(".balign %" Pd ", 0\n", VirtualMemory::PageSize());
  assembly_stream_.Print("%s:\n", instructions_symbol);

  //写入头部空白字符，使得指令快照看起来像堆页
  intptr_t instructions_length = next_text_offset_;
  WriteWordLiteralText(instructions_length);
  intptr_t header_words = Image::kHeaderSize / sizeof(uword);
  for (intptr_t i = 1; i < header_words; i++) {
    WriteWordLiteralText(0);
  }

  //写入序幕.cfi_xxx
  FrameUnwindPrologue();

  Object& owner = Object::Handle(zone);
  String& str = String::Handle(zone);
  ObjectStore* object_store = Isolate::Current()->object_store();

  TypeTestingStubNamer tts;
  intptr_t text_offset = 0;

  for (intptr_t i = 0; i < instructions_.length(); i++) {
    auto& data = instructions_[i];
    const bool is_trampoline = data.trampoline_bytes != nullptr;
    if (is_trampoline) {     //针对跳床函数
      const auto start = reinterpret_cast<uword>(data.trampoline_bytes);
      const auto end = start + data.trampline_length;
       //写入.quad xxx字符串
      text_offset += WriteByteSequence(start, end);
      delete[] data.trampoline_bytes;
      data.trampoline_bytes = nullptr;
      continue;
    }

    const intptr_t instr_start = text_offset;
    const Instructions& insns = *data.insns_;
    const Code& code = *data.code_;
    // 1. 写入 头部到入口点
    {
      NoSafepointScope no_safepoint;

      uword beginning = reinterpret_cast<uword>(insns.raw_ptr());
      uword entry = beginning + Instructions::HeaderSize(); //ARM64 32位对齐

      //指令的只读标记
      uword marked_tags = insns.raw_ptr()->tags_;
      marked_tags = RawObject::OldBit::update(true, marked_tags);
      marked_tags = RawObject::OldAndNotMarkedBit::update(false, marked_tags);
      marked_tags = RawObject::OldAndNotRememberedBit::update(true, marked_tags);
      marked_tags = RawObject::NewBit::update(false, marked_tags);
      //写入标记
      WriteWordLiteralText(marked_tags);
      beginning += sizeof(uword);
      text_offset += sizeof(uword);
      text_offset += WriteByteSequence(beginning, entry);
    }

    // 2. 在入口点写入标签
    owner = code.owner();
    if (owner.IsNull()) {  
      // owner为空，说明是一个常规的stub，其中stub列表定义在stub_code_list.h中的VM_STUB_CODE_LIST
      const char* name = StubCode::NameOfStub(insns.EntryPoint());
      if (name != nullptr) {
        assembly_stream_.Print("Precompiled_Stub_%s:\n", name);
      } else {
        if (name == nullptr) {
          // isolate专有的stub代码[见小节3.5.1]
          name = NameOfStubIsolateSpecificStub(object_store, code);
        }
        assembly_stream_.Print("Precompiled__%s:\n", name);
      }
    } else if (owner.IsClass()) {
      //owner为Class，说明是该类分配的stub，其中class列表定义在class_id.h中的CLASS_LIST_NO_OBJECT_NOR_STRING_NOR_ARRAY
      str = Class::Cast(owner).Name();
      const char* name = str.ToCString();
      EnsureAssemblerIdentifier(const_cast<char*>(name));
      assembly_stream_.Print("Precompiled_AllocationStub_%s_%" Pd ":\n", name,
                             i);
    } else if (owner.IsAbstractType()) {
      const char* name = tts.StubNameForType(AbstractType::Cast(owner));
      assembly_stream_.Print("Precompiled_%s:\n", name);
    } else if (owner.IsFunction()) { //owner为Function，说明是一个常规的dart函数
      const char* name = Function::Cast(owner).ToQualifiedCString();
      EnsureAssemblerIdentifier(const_cast<char*>(name));
      assembly_stream_.Print("Precompiled_%s_%" Pd ":\n", name, i);
    } else {
      UNREACHABLE();
    }

#ifdef DART_PRECOMPILER
    // 创建一个标签用于DWARF
    if (!code.IsNull()) {
      const intptr_t dwarf_index = dwarf_->AddCode(code);
      assembly_stream_.Print(".Lcode%" Pd ":\n", dwarf_index);
    }
#endif

    {
      // 3. 写入 入口点到结束
      NoSafepointScope no_safepoint;
      uword beginning = reinterpret_cast<uword>(insns.raw_ptr());
      uword entry = beginning + Instructions::HeaderSize();
      uword payload_size = insns.raw()->HeapSize() - insns.HeaderSize();
      uword end = entry + payload_size;
      text_offset += WriteByteSequence(entry, end);
    }
  }

  FrameUnwindEpilogue();

#if defined(TARGET_OS_LINUX) || defined(TARGET_OS_ANDROID) ||                  \
    defined(TARGET_OS_FUCHSIA)
  assembly_stream_.Print(".section .rodata\n");
#elif defined(TARGET_OS_MACOS) || defined(TARGET_OS_MACOS_IOS)
  assembly_stream_.Print(".const\n");
#else
  UNIMPLEMENTED();
#endif
  //写入数据段
  const char* data_symbol = vm ? "_kDartVmSnapshotData" : "_kDartIsolateSnapshotData";
  assembly_stream_.Print(".globl %s\n", data_symbol);
  assembly_stream_.Print(".balign %" Pd ", 0\n",
                         OS::kMaxPreferredCodeAlignment);
  assembly_stream_.Print("%s:\n", data_symbol);
  uword buffer = reinterpret_cast<uword>(clustered_stream->buffer());
  intptr_t length = clustered_stream->bytes_written();
  WriteByteSequence(buffer, buffer + length);
}
```

#### 3.5.1 NameOfStubIsolateSpecificStub
[[-> ]third_party/dart/runtime/vm/image_snapshot.cc]

```Java
const char* NameOfStubIsolateSpecificStub(ObjectStore* object_store,
                                          const Code& code) {
  if (code.raw() == object_store->build_method_extractor_code()) {
    return "_iso_stub_BuildMethodExtractorStub";
  } else if (code.raw() == object_store->null_error_stub_with_fpu_regs_stub()) {
    return "_iso_stub_NullErrorSharedWithFPURegsStub";
  } else if (code.raw() ==
             object_store->null_error_stub_without_fpu_regs_stub()) {
    return "_iso_stub_NullErrorSharedWithoutFPURegsStub";
  } else if (code.raw() ==
             object_store->stack_overflow_stub_with_fpu_regs_stub()) {
    return "_iso_stub_StackOverflowStubWithFPURegsStub";
  } else if (code.raw() ==
             object_store->stack_overflow_stub_without_fpu_regs_stub()) {
    return "_iso_stub_StackOverflowStubWithoutFPURegsStub";
  } else if (code.raw() == object_store->write_barrier_wrappers_stub()) {
    return "_iso_stub_WriteBarrierWrappersStub";
  } else if (code.raw() == object_store->array_write_barrier_stub()) {
    return "_iso_stub_ArrayWriteBarrierStub";
  }
  return nullptr;
}
```

再回到[小节3.1]，执行完WriteVMSnapshot()方法，然后执行WriteIsolateSnapshot()方法。


### 3.6 WriteIsolateSnapshot
[-> third_party/dart/runtime/vm/clustered_snapshot.cc]

```Java
void FullSnapshotWriter::WriteIsolateSnapshot(intptr_t num_base_objects) {
  Serializer serializer(thread(), kind_, isolate_snapshot_data_buffer_, alloc_,
                        kInitialSize, isolate_image_writer_, /*vm=*/false,
                        profile_writer_);
  ObjectStore* object_store = isolate()->object_store();

  serializer.ReserveHeader();
  serializer.WriteVersionAndFeatures(false);

  // Isolate快照的根为object store
  serializer.WriteIsolateSnapshot(num_base_objects, object_store);
  serializer.FillHeader(serializer.kind());
  clustered_isolate_size_ = serializer.bytes_written();

  if (Snapshot::IncludesCode(kind_)) {
    isolate_image_writer_->SetProfileWriter(profile_writer_);
    //[见小节3.4]
    isolate_image_writer_->Write(serializer.stream(), false);
#if defined(DART_PRECOMPILER)
    isolate_image_writer_->DumpStatistics();
#endif
    mapped_data_size_ += isolate_image_writer_->data_size();
    mapped_text_size_ += isolate_image_writer_->text_size();
    isolate_image_writer_->ResetOffsets();
    isolate_image_writer_->ClearProfileWriter();
  }

  // 集群部分 + 直接映射的数据部分
  isolate_snapshot_size_ = serializer.bytes_written();
}
```

### 3.7 AssemblyImageWriter::Finalize
[-> third_party/dart/runtime/vm/image_snapshot.cc]

```Java
void AssemblyImageWriter::Finalize() {
#ifdef DART_PRECOMPILER
  dwarf_->Write();
#endif
}
```

#### 3.7.1 Dwarf.Write
[-> third_party/dart/runtime/vm/dwarf.h]

```Java
class Dwarf : public ZoneAllocated {

  void Write() {
    WriteAbbreviations();
    WriteCompilationUnit();
    WriteLines();
  }
}
```

Dwarf数据采用数的形式，其节点称为DIE，每个DIE均以缩写代码开头，并且该缩写描述了该DIE的属性及其表示形式。


## 四、 Android快照产物生成

### 4.1 Dart_CreateAppAOTSnapshotAsBlobs
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
DART_EXPORT Dart_Handle
Dart_CreateAppAOTSnapshotAsBlobs(uint8_t** vm_snapshot_data_buffer,
                                 intptr_t* vm_snapshot_data_size,
                                 uint8_t** vm_snapshot_instructions_buffer,
                                 intptr_t* vm_snapshot_instructions_size,
                                 uint8_t** isolate_snapshot_data_buffer,
                                 intptr_t* isolate_snapshot_data_size,
                                 uint8_t** isolate_snapshot_instructions_buffer,
                                 intptr_t* isolate_snapshot_instructions_size,
                                 const uint8_t* shared_data,
                                 const uint8_t* shared_instructions) {
#if defined(DART_PRECOMPILER)
  DARTSCOPE(Thread::Current());
  API_TIMELINE_DURATION(T);
  Isolate* I = T->isolate();
  CHECK_NULL(vm_snapshot_data_buffer);
  CHECK_NULL(vm_snapshot_data_size);
  CHECK_NULL(vm_snapshot_instructions_buffer);
  CHECK_NULL(vm_snapshot_instructions_size);
  CHECK_NULL(isolate_snapshot_data_buffer);
  CHECK_NULL(isolate_snapshot_data_size);
  CHECK_NULL(isolate_snapshot_instructions_buffer);
  CHECK_NULL(isolate_snapshot_instructions_size);

  const void* shared_data_image = NULL;
  if (shared_data != NULL) {
    shared_data_image = Snapshot::SetupFromBuffer(shared_data)->DataImage();
  }
  const void* shared_instructions_image = shared_instructions;

  TIMELINE_DURATION(T, Isolate, "WriteAppAOTSnapshot");
  BlobImageWriter vm_image_writer(T, vm_snapshot_instructions_buffer,
                ApiReallocate, 2 * MB, nullptr, nullptr, nullptr);
  BlobImageWriter isolate_image_writer(T, isolate_snapshot_instructions_buffer,
                ApiReallocate, 2 * MB , shared_data_image, shared_instructions_image, nullptr);
  FullSnapshotWriter writer(Snapshot::kFullAOT,
                vm_snapshot_data_buffer, isolate_snapshot_data_buffer,
                ApiReallocate, &vm_image_writer, &isolate_image_writer);
  //[见小节3.1]
  writer.WriteFullSnapshot();
  *vm_snapshot_data_size = writer.VmIsolateSnapshotSize();
  *vm_snapshot_instructions_size = vm_image_writer.InstructionsBlobSize();
  *isolate_snapshot_data_size = writer.IsolateSnapshotSize();
  *isolate_snapshot_instructions_size = isolate_image_writer.InstructionsBlobSize();
  return Api::Success();
#endif
}
```

该方法主要功能是将snapshot写入buffer缓存：

- vm_snapshot_data_buffer
- vm_snapshot_instructions_buffer
- isolate_snapshot_data_buffer
- isolate_snapshot_instructions_buffer

再下一步将这些数据写入文件。




## 附录

```Java
third_party/dart/runtime/
  - bin/gen_snapshot.cc
  - vm/dart_api_impl.cc
  - vm/compiler/aot/precompiler.cc
```
