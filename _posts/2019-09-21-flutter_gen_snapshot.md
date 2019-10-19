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
// 针对Android平台
flutter/bin/cache/artifacts/engine/android-arm-release/darwin-x64/gen_snapshot
--causal_async_stacks
--packages=.packages
--deterministic
--snapshot_kind=app-aot-blobs
--vm_snapshot_data=<FLUTTER_ROOT>/build/app/intermediates/flutter/release/vm_snapshot_data
--isolate_snapshot_data=<FLUTTER_ROOT>/build/app/intermediates/flutter/release/isolate_snapshot_data
--vm_snapshot_instructions=<FLUTTER_ROOT>/build/app/intermediates/flutter/release/vm_snapshot_instr
--isolate_snapshot_instructions=<FLUTTER_ROOT>/build/app/intermediates/flutter/release/isolate_snapshot_instr
--no-sim-use-hardfp
--no-use-integer-division
<FLUTTER_ROOT>/build/app/intermediates/flutter/release/app.dill
```

#### 1.1.2 针对iOS平台

```Java
//针对iOS平台
/usr/bin/arch -x86_64 flutter/bin/cache/artifacts/engine/ios-release/gen_snapshot
  --causal_async_stacks
  --deterministic
  --snapshot_kind=app-aot-assembly
  --assembly=build/aot/arm64/snapshot_assembly.S
  build/aot/app.dill
```

### 1.2 GenSnapshot执行流程图

[点击查看大图](/img/flutter_compile/SeqCodeGen.jpg)

![SeqCodeGen](/img/flutter_compile/SeqCodeGen.jpg)

此处gen_snapshot是一个二进制可执行文件，所对应的执行方法源码为third_party/dart/runtime/bin/gen_snapshot.cc，gen_snapshot将dart代码生成AOT二进制机器码，其中重点过程在precompiler.cc中的DoCompileAll()。


##  二、源码解读gen_snapshot命令

```
BuildAotCommand.runCommand
  AOTSnapshotter.build
    GenSnapshot.run
      gen_snapshot命令
```

### 3.1 gen_snapshot.main
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
  // 初始化Dart虚拟机 [见小节3.1.1]
  error = Dart_Initialize(&init_params);
  //[见小节3.2]
  int result = CreateIsolateAndSnapshot(inputs);
  // 回收Dart虚拟机
  error = Dart_Cleanup();
  EventHandler::Stop();
  return 0;
}
```

该方法主要功能说明：

- Dart_Initialize()来初始化Dart虚拟机环境
- CreateIsolateAndSnapshot


#### 3.1.1 Dart_Initialize
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

### 3.2 CreateIsolateAndSnapshot
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
  //创建isoalte
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
      //[见小节3.3]
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

#### 3.2.1 snapshot的类型

|类型|名称|
|---|---|
|kCore|core|
|kApp|app|
|kCoreJIT|core-jit|
|kAppJIT|app-jit|
|kAppAOTBlobs|app-aot-blobs|
|kAppAOTAssembly|app-aot-assembly|
|kVMAOTAssembly|vm-aot-assembly|

### 3.3 CreateAndWritePrecompiledSnapshot
[-> third_party/dart/runtime/bin/gen_snapshot.cc]

```Java
static void CreateAndWritePrecompiledSnapshot() {
  Dart_Handle result;

  //使用指定的嵌入程序入口点进行预编译 [见小节3.4]
  result = Dart_Precompile();

  //创建一个预编译的snapshot
  bool as_assembly = assembly_filename != NULL;
  if (as_assembly) {
    // kAppAOTAssembly模式
    File* file = OpenFile(assembly_filename);
    RefCntReleaseScope<File> rs(file);
    //iOS采用该方式 [见小节4.1]
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
    //将snapshot写入buffer缓存 [见小节3.7]
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

### 3.4 Dart_Precompile
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
  //[见小节3.5]
  CHECK_ERROR_HANDLE(Precompiler::CompileAll());
  return Api::Success();
#endif
}
```

### 3.5 CompileAll
[-> third_party/dart/runtime/vm/compiler/aot/precompiler.cc]

```Java
RawError* Precompiler::CompileAll() {
  LongJumpScope jump;
  if (setjmp(*jump.Set()) == 0) {
    //创建Precompiler对象
    Precompiler precompiler(Thread::Current());
    //[见小节3.6]
    precompiler.DoCompileAll();
    return Error::null();
  } else {
    return Thread::Current()->StealStickyError();
  }
}
```

在Dart Runtime中生成FlowGraph对象，接着进行一系列执行流的优化，最后把优化后的FlowGraph对象转换为具体相应系统架构（arm/arm64等）的二进制指令

### 3.6 DoCompileAll
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

### 3.7 Dart_CreateAppAOTSnapshotAsBlobs
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

## 四、ios编译

### 4.1 Dart_CreateAppAOTSnapshotAsAssembly

```Java
DART_EXPORT Dart_Handle
Dart_CreateAppAOTSnapshotAsAssembly(Dart_StreamingWriteCallback callback,
                                    void* callback_data) {
#if defined(DART_PRECOMPILER)
  ...
  AssemblyImageWriter image_writer(T, callback, callback_data, NULL, NULL);
  uint8_t* vm_snapshot_data_buffer = NULL;
  uint8_t* isolate_snapshot_data_buffer = NULL;
  FullSnapshotWriter writer(Snapshot::kFullAOT, &vm_snapshot_data_buffer,
                            &isolate_snapshot_data_buffer, ApiReallocate,
                            &image_writer, &image_writer);

  writer.WriteFullSnapshot();
  image_writer.Finalize();

  return Api::Success();
#endif
}
```

### 4.2 WriteFullSnapshot
[-> third_party/dart/runtime/vm/clustered_snapshot.cc]

```Java
void FullSnapshotWriter::WriteFullSnapshot() {
  intptr_t num_base_objects;
  if (vm_snapshot_data_buffer() != NULL) {
    num_base_objects = WriteVMSnapshot();
  } else {
    num_base_objects = 0;
  }

  if (isolate_snapshot_data_buffer() != NULL) {
    WriteIsolateSnapshot(num_base_objects);
  }
}
```

FullSnapshotWriter的成员变量

- clustered_vm_size_ ： VM
- clustered_isolate_size_ ： Isolate
- mapped_data_size_ ：数据
- mapped_text_size_ ：指令

### 4.
[-> ]

```Java

```

### 4.
[-> ]

```Java

```

### 4.
[-> ]

```Java

```

### 4.
[-> ]

```Java

```

## 附录

本文相关源码flutter engine

```Java
flutter/frontend_server/
  - bin/starter.dart
  - lib/server.dart

third_party/dart/pkg/vm/lib/
  - frontend_server.dart
  - kernel_front_end.dart
  - bytecode/gen_bytecode.dart
  - bytecode/assembler.dart

third_party/dart/pkg/front_end/lib/
  - src/api_prototype/kernel_generator.dart
  - src/kernel_generator_impl.dart
  - src/fasta/kernel/kernel_target.dart
  - src/fasta/loader.dart
  - src/fasta/source/source_loader.dart

third_party/dart/pkg/kernel/lib/
  - ast.dart
  - binary/ast_to_binary.dart

third_party/dart/runtime/
  - bin/gen_snapshot.cc
  - vm/dart_api_impl.cc
  - vm/compiler/aot/precompiler.cc
```
