---
layout: post
title:  "解读Dart虚拟机的参数列表"
date:   2019-09-22 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、概述
在third_party/dart/runtime/vm/flag_list.h定义了Dart虚拟机中所有标志的列表，标志分为以下几大类别：

- Product标记：可以在任何部署模式中设置，包括Product模式
- Release标志：通常可用的标志，除Product模式以外
- Precompile标志：通常可用的标志，除Product模式或已预编译的运行时以外
- Debug标志：只能在启用C++断言的VM调试模式中设置

Product、Release、Precompile、Debug这四类可控参数，可使用的范围逐次递减，比如Product flags可用于所有模式，Debug flags只能用于调试模式。Dart虚拟机总共有106个flags参数

## 二、flags参数

#### 2.1 Product flags

用法：PRODUCT_FLAG_MARCO（名称，类型，默认值，注解）

|名称|默认值|注解|
|collect_dynamic_function_names | true | 收集所有动态函数名称以标识唯一目标|
|enable_kernel_expression_compilation | true |启用内核前端来编译表达式|
|enable_mirrors | true | 允许导入dart:mirrors|
|enable_ffi | true | 允许导入dart:ffi|
|guess_icdata_cid | true | 创建算法等操作的类型反馈|
|lazy_dispatchers | true | 懒惰地生成调度程序|
|polymorphic_with_deopt | true | 反优化的多态调用、巨形调用|
|reorder_basic_blocks | true | 对基本块重新排序|
|use_bare_instructions | true | 启用裸指令模式|
|truncating_left_shift | true | 尽可能优化左移以截断|
|use_cha_deopt | true | 使用类层次分析，即使会导致反优化|
|use_strong_mode_types | true | 基于强模式类型的优化|
|enable_slow_path_sharing | true | 启用共享慢速路径代码|
|enable_multiple_entrypoints | true | 启用多个入口点|
|experimental_unsafe_mode_use_ at_your_own_risk | false | 省略运行时强模式类型检查并禁用基于类型的优化|
|abort_on_oom |  false            | 如果内存分配失败则中止，仅与--old-gen-heap-size一起使用 |
|collect_code |  false          | 尝试GC不常用代码 |
|dwarf_stack_traces | false | 在dylib快照中发出dwarf行号和内联信息，而不表示堆栈跟踪|
|fields_may_be_reset | false | 不要优化静态字段初始化
|link_natives_lazily | false | 懒加载链接本地调用
|precompiled_mode | false | 预编译编译器模式|
|print_snapshot_sizes | false | 打印生成snapshot的大小
|print_snapshot_sizes_verbose | false | 打印生成snapshot的详细大小
|print_benchmarking_metrics | false | 打印其他内存和延迟指标以进行基准测试
|shared_slow_path_triggers_gc | false | 测试：慢路径触发GC|
|trace_strong_mode_types | false | 跟踪基于强模式类型的优化
|use_bytecode_compiler | false | 从字节码编译|
|use_compactor | false | 当在旧空间执行GC时则压缩堆
|enable_testing_pragmas | false | 启用神奇的编译指示以进行测试|
|enable_interpreter | false | 启用解释内核字节码|
|verify_entry_points | false | 通过native API访问无效成员时抛出API错误|
|background_compilation | USING_MULTICORE | 根据是否多核来决定是否后台运行优化编译 |
|concurrent_mark | USING_MULTICORE | 老年代的并发标记
|concurrent_sweep | USING_MULTICORE | 老年代的并发扫描
|use_field_guards | !USING_DBC | 使用字段gurad，跟踪字段类型
|interpret_irregexp | USING_DBC | 使用irregexp字节码解释器|
|causal_async_stacks | !USING_PRODUCT |  非product 则开启改进异步堆栈  |
|marker_tasks |  USING_MULTICORE ? 2 : 0 | 老生代GC标记的任务数，0代表在主线程执行|
|idle_timeout_micros |  1000 * 1000 |长时间后将空闲任务从线程池隔离，单位微秒|
|idle_duration_micros |  500 * 1000 |允许空闲任务运行的时长
|old_gen_heap_size |      (kWordSize <= 4) ? 1536 : 0 |旧一代堆的最大大小，或0（无限制），单位MB
|new_gen_semi_max_size |  (kWordSize <= 4) ? 8 : 16 | 新一代半空间的最大大小，单位MB
|new_gen_semi_initial_size |  (kWordSize <= 4) ? 1 : 2 | 新一代半空间的最大初始大小，单位MB
|compactor_tasks |  2 | 并行压缩使用的任务数|
|getter_setter_ratio |  13 | 用于double拆箱启发式的getter/setter使用率？
|huge_method_cutoff_in_tokens |  20000 | 令牌中的大量方法中断：禁用大量方法的优化？
|max_polymorphic_checks |  4 | 多态检查的最大数量，否则为巨形的？
|max_equality_polymorphic_checks |  32 | 等式运算符中的多态检查的最大数量
|compilation_counter_threshold |  10 | 在解释执行函数编译完成前的函数使用次数要求，-1表示从不|
|optimization_counter_threshold |  30000 | 函数在优化前的用法计数值，-1表示从不
|optimization_level |  2 | 优化级别：1（有利大小），2（默认），3（有利速度）|


optimization_level这是一个可以尝试的参数

#### 2.2 Release flags
用法：RELEASE_FLAG_MARCO（名称，product_value，类型，默认值，注解）

|名称|product值|默认值|注解|
|---|---|---|---|
| eliminate_type_checks  |   true  |   true  | 静态类型分析允许时消除类型检查|
| dedup_instructions  |   true  |   false  | 预编译时规范化指令|
| support_disassembler  |   false  |   true  | 支持反汇编|
| support_il_printer  |   false  |   true  |支持IL打印|
| support_service  |   false  |   true  |支持服务协议
| disable_alloc_stubs_after_gc  |   false  |   false  | 压力测试标识
| disassemble  |   false  |   false  | 反汇编dart代码
| disassemble_optimized  |   false  |   false  | 反汇编优化代码
| dump_megamorphic_stats  |   false  |   false  | dump巨形缓存统计信息
| dump_symbol_stats  |   false  |   false  | dump符合表统计信息
| enable_asserts  |   false  |   false  | 启用断言语句
| log_marker_tasks  |   false  |   false  | 记录老年代GC标记任务的调试信息
| randomize_optimization_counter  |   false  |   false  | 基于每个功能随机化优化计数器阈值，用于测试
| pause_isolates_on_start  |   false  |   false  | 在isolate开始前暂停
| pause_isolates_on_exit  |   false  |   false  | 在isolate退出前暂停
| pause_isolates_on_unhandled_exceptions  |   false  |   false  | 在isolate发生未捕获异常前暂停
| print_ssa_liveranges  |   false  |   false  | 内存分配后打印有效范围
| print_stacktrace_at_api_error  |   false  |   false  | 当API发生错误时，打印native堆栈
| profiler  |   false  |   false  | 开启profiler
| profiler_native_memory  |   false  |   false  | 开启native内存统计收集
| trace_profiler  |   false  |   false  |跟踪profiler
| trace_field_guards  |   false  |   false  | 跟踪字段cids的变化
| verify_after_gc  |   false  |   false  | 在GC之后启用堆验证
| verify_before_gc  |   false  |   false  | 在GC之前启用堆验证
| verbose_gc  |   false  |   false  | 开启详细GC
| verbose_gc_hdr  |   40  |  40  | 打印详细的GC标头间隔

#### 2.3 Precompile flags
用法：PRECOMPILE_FLAG_MARCO（名称，precompiled_value，product_value，类型，默认值，注释）

|名称|precompiled值| product值|默认值|说明|
|---|---|---|---|---|
| load_deferred_eagerly  |   true  |   true  |   false  | 急切加载延迟的库|
| use_osr  |   false  |   true  |   true  |   使用OSR|
| async_debugger  |   false  |   false  |   true  | 调试器支持异步功能|
| support_reload  |   false  |   false  |   true  | 支持isolate重新加载|
| force_clone_compiler_objects  |   false  |   false  |   false  | 强制克隆编译器中所需的对象（ICData和字段）
| stress_async_stacks  |   false  |   false  |   false  | 压测异步堆栈
| trace_irregexp  |   false  |   false  |   false  |  跟踪irregexps
| deoptimize_alot  |   false  |   false  |   false  | 取消优化，从native条目返回到dart代码
| deoptimize_every  |   0  |   0  |    0  | 在每N次堆栈溢出检查中取消优化


#### 2.4 Debug flags
用法：DEBUG_FLAG_MARCO（名称，类型，默认值，注解）

|名称|默认值|注解|
|---|---|---|
| print_variable_descriptors  |  false  | 在反汇编中打印变量描述符                                   
| trace_cha  |  false  | 跟踪类层次分析(CHA)操作
| trace_ic  |  false  | 跟踪IC处理？
| trace_ic_miss_in_optimized  |  false  |跟踪优化中的IC未命中情况                                 
| trace_intrinsified_natives  |  false  |跟踪是否调用固有native                               
| trace_isolates  |  false  | 跟踪isolate的创建与关闭
| trace_handles  |  false  |跟踪handles的分配
| trace_kernel_binary  |  false  |跟踪内核的读写
| trace_natives  |  false  |跟踪native调用
| trace_optimization  |  false  |打印优化详情
| trace_profiler_verbose  |  false  | 跟踪profiler详情
| trace_runtime_calls  |  false  |跟踪runtime调用
| trace_ssa_allocator  |  false  | 跟踪通过SSA的寄存器分配
| trace_type_checks  |  false  |跟踪运行时类型检测
| trace_patching  |  false  | 跟踪代码修补
| trace_optimized_ic_calls  |  false  |跟踪优化代码中的IC调用？                               
| trace_zones  |  false  | 跟踪zone的内存分配大小
| verify_gc_contains  |  false  | 在GC期间开启地址是否包含的验证                                          
| verify_on_transition  |  false  | 验证dart/vm的过渡？
| support_rr  |  false  |支持在RR中运行？

默认值全部都为false，

## 三、实现原理


#### 3.1 FLAG_LIST
[-> third_party/dart/runtime/vm/flags.cc]

```Java
FLAG_LIST(PRODUCT_FLAG_MARCO,
          RELEASE_FLAG_MARCO,
          DEBUG_FLAG_MARCO,
          PRECOMPILE_FLAG_MARCO)
```

FLAG_LIST列举了所有的宏定义，这里有四种不同的宏，接下来逐一展开说明

#### 3.2 flag宏定义
[-> third_party/dart/runtime/vm/flags.cc]

```Java
// (1) Product标记：可以在任何部署模式中设置
#define PRODUCT_FLAG_MARCO(name, type, default_value, comment)                 \
  type FLAG_##name = Flags::Register_##type(&FLAG_##name, #name, default_value, comment);

// (2) Release标志：通常可用的标志，除Product模式以外
#if !defined(PRODUCT)
#define RELEASE_FLAG_MARCO(name, product_value, type, default_value, comment)  \
  type FLAG_##name = Flags::Register_##type(&FLAG_##name, #name, default_value, comment);

// (3) Precompile标志：通常可用的标志，除Product模式或已预编译的运行时以外
#if !defined(PRODUCT) && !defined(DART_PRECOMPILED_RUNTIME)
#define PRECOMPILE_FLAG_MARCO(name, pre_value, product_value, type, default_value, comment) \
  type FLAG_##name = Flags::Register_##type(&FLAG_##name, #name, default_value, comment);

// (4) Debug标志：只能在debug调试模式运行
#if defined(DEBUG)  
#define DEBUG_FLAG_MARCO(name, type, default_value, comment)                   \
  type FLAG_##name =  Flags::Register_##type(&FLAG_##name, #name, default_value, comment);
```

这里涉及到3个宏定义：

- PRODUCT：代表Product模式；
- DART_PRECOMPILED_RUNTIME：代表运行时已预编译模式；
- DEBUG：代表调试模式；

可见，宏定义最终都是调用Flags::Register_XXX()方法，这里以FLAG_LIST中的其中一条定义来展开说明：

```Java
P(collect_code, bool, false, "Attempt to GC infrequently used code.")
//展开后等价如下
type FLAG_collect_code = Flags::Register_bool(&FLAG_collect_code, collect_code, false,
    "Attempt to GC infrequently used code.");
```

#### 3.3 Flags::Register_bool
[-> third_party/dart/runtime/vm/flags.cc]

```Java
bool Flags::Register_bool(bool* addr,
                          const char* name,
                          bool default_value,
                          const char* comment) {
  Flag* flag = Lookup(name);  //[见小节3.4]
  if (flag != NULL) {
    return default_value;
  }
  flag = new Flag(name, comment, addr, Flag::kBoolean);
  AddFlag(flag);
  return default_value;
}
```

#### 3.4 Flags::Lookup
[-> third_party/dart/runtime/vm/flags.cc]

```Java
Flag* Flags::Lookup(const char* name) {
  //遍历flags_来查找是否已存在
  for (intptr_t i = 0; i < num_flags_; i++) {
    Flag* flag = flags_[i];
    if (strcmp(flag->name_, name) == 0) {
      return flag;
    }
  }
  return NULL;
}
```

Flags类中有3个重要的静态成员变量：

```Java
static Flag** flags_; //记录所有的flags对象指针
static intptr_t capacity_;  //代表数组的容量大小
static intptr_t num_flags_;  //代表当前flags对象指针的个数
```

#### 3.5 Flag初始化
[-> third_party/dart/runtime/vm/flags.cc]

```Java
class Flag {
  Flag(const char* name, const char* comment, void* addr, FlagType type)
      : name_(name), comment_(comment), addr_(addr), type_(type) {}

  const char* name_;
  const char* comment_;
  union {
    void* addr_;
    bool* bool_ptr_;
    int* int_ptr_;
    uint64_t* uint64_ptr_;
    charp* charp_ptr_;
    FlagHandler flag_handler_;
    OptionHandler option_handler_;
  };
  FlagType type_;
}
```

#### 3.6 Flags::AddFlag
[-> third_party/dart/runtime/vm/flags.cc]

```Java
class Flag {

  void Flags::AddFlag(Flag* flag) {
    if (num_flags_ == capacity_) {
      if (flags_ == NULL) {
        capacity_ = 256;  //初始化大小为256
        flags_ = new Flag*[capacity_];
      } else {
        intptr_t new_capacity = capacity_ * 2; //扩容
        Flag** new_flags = new Flag*[new_capacity];
        for (intptr_t i = 0; i < num_flags_; i++) {
          new_flags[i] = flags_[i];
        }
        delete[] flags_;
        flags_ = new_flags;
        capacity_ = new_capacity;
      }
    }
    //将flag记录到flags_
    flags_[num_flags_++] = flag;
  }
}
```

最终，所有的flag信息都记录在Flags类的静态成员变量flags_中。

## 四、总结

- Product标记：可以在任何部署模式中设置
- Release标志：通常可用的标志，除Product模式以外
- Precompile标志：通常可用的标志，除Product模式或已预编译的运行时以外
- Debug标志：只能在启用C++断言的VM调试模式中设置
