---
layout: post
title:  "Flutter前端编译frontend_server"
date:   2019-09-14 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、概述

书接上文[源码解读Flutter run机制](http://gityuan.com/2019/09/07/flutter_run/)的第四节 flutter build aot命令将dart源码编译成AOT产物，其主要工作为前端编译器frontend_server和机器码生成，本文先介绍前端编译器frontend_server的工作原理。

### 1.1 frontend_server命令
KernelCompiler.compile()过程等价于如下命令：

```Java
// 该frontend_server命令 同时适用于Android和iOS
flutter/bin/cache/dart-sdk/bin/dart
  flutter/bin/cache/artifacts/engine/darwin-x64/frontend_server.dart.snapshot
  --sdk-root flutter/bin/cache/artifacts/engine/common/flutter_patched_sdk/
  --strong
  --target=flutter
  --aot --tfa
  -Ddart.vm.product=true
  --packages .packages
  --output-dill /build/app/intermediates/flutter/release/app.dill
  --depfile     /build/app/intermediates/flutter/release/kernel_compile.d
  --"package" /lib/main.dart
```

可见，通过dart虚拟机启动frontend_server.dart.snapshot，将dart代码转换成app.dill形式的kernel文件。frontend_server.dart.snapshot入口位于Flutter引擎中的
flutter/frontend_server/bin/starter.dart。


### 1.2 frontend_server执行流程图

（1）[点击查看大图](/img/flutter_compile/SeqAST.jpg)

![SeqAST](/img/flutter_compile/SeqAST.jpg)

frontend_server前端编译器将dart代码转换为AST，并生成app.dill文件，其中bytecode生成过程默认是关闭的。

（2）[点击查看大图](/img/flutter_compile/FlutterComplile.jpg)

![FlutterComplile](/img/flutter_compile/FlutterComplile.jpg)

Component的成员变量:

- uriToSource的类型为Map<Uri, Source> ，用于从源文件URI映射到行开始表和源代码。给定一个源文件URI和该文件中的偏移量，就可以转换为该文件中line：column的位置。


## 二、 源码解读frontend_server

```
BuildAotCommand.runCommand
  AOTSnapshotter.compileKernel
    KernelCompiler.compile
      frontend_server命令
```

### 2.1 starter.main
[-> flutter/frontend_server/bin/starter.dart]

```Java
void main(List<String> args) async {
  final int exitCode = await starter(args);
  ...
}
```

### 2.2 server.starter
[-> flutter/frontend_server/lib/server.dart]

```Java
Future<int> starter(
    List<String> args, {
      frontend.CompilerInterface compiler,
      Stream<List<int>> input,
      StringSink output,
    }) async {
  ...
  //解析参数 [见小节2.2.1]
  ArgResults options = frontend.argParser.parse(args);
  //创建前端编译器实例对象
  compiler ??= new _FlutterFrontendCompiler(output,
      trackWidgetCreation: options['track-widget-creation'],
      unsafePackageSerialization: options['unsafe-package-serialization']);

  if (options.rest.isNotEmpty) {
    //解析命令行的剩余参数 [见小节2.3]
    return await compiler.compile(options.rest[0], options) ? 0 : 254;
  }
  ...
}
```

该方法主要工作：

- 解析KernelCompiler.compile()方法中传递过来的参数；
- 创建前端编译器实例对象_FlutterFrontendCompiler；
- 执行编译操作；

#### 2.2.1 frontend参数解析
前端编译器的可选参数：

|参数|说明|默认值|
|---|---|---|
|aot| 在AOT模式下运行编译器（启用整个程序转换）|false|
|tfa| 在AOT模式下启用全局类型流分析和相关转换| false|
|train| 通过示例命令行运行以生成快照| false|
|incremental| 以增量模式运行编译器| flase|
|link-platform| 批处理模式，平台kernel文件链接到结果的内核文件| true|
|embed-source-text| 源码加入到生成的dill文件，便于得到用于调试的堆栈信息| true|
|track-widget-creation| 运行内核转换器来跟踪widgets创建的位置| false|
|strong| 已过时flags| true|
|import-dill| 从已存在的dill文件中引入库| null|
|output-dill| 将生成的dill文件输出路径| null|
|output-incremental-dill| 将生成的增量dill文件输出路径| null|
|depfile| | 仅用于批量，输出Ninja的depfile| |
|packages| 用于编译的.packages文件| null|
|sdk-root| SDK根目录的路径| ../../out/android_debug/flutter_patched_sdk|
|target| 确定哪些核心库可用，可取值vm、flutter、flutter_runner、dart_runner| vm|

- 增量模式运行编译器应该能加快编译速度
- track-widget-creation、aot、tfa参数的使用场景

### 2.3 \_FlutterFrontendCompiler.compile
[-> flutter/frontend_server/lib/server.dart]

```Java
class _FlutterFrontendCompiler implements frontend.CompilerInterface{
  final frontend.CompilerInterface _compiler;

  _FlutterFrontendCompiler(StringSink output,
      {bool trackWidgetCreation: false, bool unsafePackageSerialization}) :
          //创建编译器对象
          _compiler = new frontend.FrontendCompiler(output,
          transformer: trackWidgetCreation ? new WidgetCreatorTracker() : null,
          unsafePackageSerialization: unsafePackageSerialization);

  Future<bool> compile(String filename, ArgResults options, {IncrementalCompiler generator}) async {
      // filename是入口文件名 [见小节2.4]  
    return _compiler.compile(filename, options, generator: generator);
  }
}
```

创建前端编译器实例对象_FlutterFrontendCompiler，其内部有一个重要的成员变量frontend.FrontendCompiler，该对象主要是在FrontendCompile功能的基础之上编译中添加了一个widgetCreatorTracker的内核转换器，所以核心工作都是交由FrontendCompiler来执行。

### 2.4 FrontendCompiler.compile
[-> third_party/dart/pkg/vm/lib/frontend_server.dart]

```Java
class FrontendCompiler implements CompilerInterface {

  Future<bool> compile(String entryPoint, ArgResults options, {IncrementalCompiler generator,}) async {
    _options = options;
    _fileSystem = createFrontEndFileSystem(options['filesystem-scheme'], options['filesystem-root']);
    //源码入口函数名，也就是lib/main.dart
    _mainSource = _getFileOrUri(entryPoint);
    _kernelBinaryFilenameFull = _options['output-dill'] ?? '$entryPoint.dill';
    _kernelBinaryFilenameIncremental = _options['output-incremental-dill'] ??
        (_options['output-dill'] != null
            ? '${_options['output-dill']}.incremental.dill'
            : '$entryPoint.incremental.dill');
    _kernelBinaryFilename = _kernelBinaryFilenameFull;
    _initializeFromDill = _options['initialize-from-dill'] ?? _kernelBinaryFilenameFull;
    final String boundaryKey = new Uuid().generateV4();
    _outputStream.writeln('result $boundaryKey');
    final Uri sdkRoot = _ensureFolderPath(options['sdk-root']);
    final String platformKernelDill = options['platform'] ?? 'platform_strong.dill';
    ...

    Component component;
    if (options['incremental']) {
      _compilerOptions = compilerOptions;
      setVMEnvironmentDefines(environmentDefines, _compilerOptions);

      _compilerOptions.omitPlatform = false;
      _generator = generator ?? _createGenerator(new Uri.file(_initializeFromDill));
      await invalidateIfInitializingFromDill();
      component = await _runWithPrintRedirection(() => _generator.compile());
    } else {
      ...
      // [见小节2.5]
      component = await _runWithPrintRedirection(() => compileToKernel(
          _mainSource, compilerOptions,
          aot: options['aot'],
          useGlobalTypeFlowAnalysis: options['tfa'],
          environmentDefines: environmentDefines));
    }
    if (component != null) {
      if (transformer != null) {
        transformer.transform(component);
      }
      //[见小节2.10] 写入dill文件
      await writeDillFile(component, _kernelBinaryFilename,
          filterExternal: importDill != null);

      await _outputDependenciesDelta(component);
      final String depfile = options['depfile'];
      if (depfile != null) {
        await writeDepfile(compilerOptions.fileSystem, component,
            _kernelBinaryFilename, depfile);
      }
      _kernelBinaryFilename = _kernelBinaryFilenameIncremental;
    }
    return errors.isEmpty;
  }
}
```

该方法主要功能：

- 执行compileToKernel，将dart转换为kernel文件，也就是中间语言文件；
- 再将中间数据写入app.dill文件

### 2.5 compileToKernel
[-> third_party/dart/pkg/vm/lib/kernel_front_end.dart]

```Java
Future<Component> compileToKernel(Uri source, CompilerOptions options,
    {bool aot: false,
    bool useGlobalTypeFlowAnalysis: false,
    Map<String, String> environmentDefines,
    bool genBytecode: false,
    bool emitBytecodeSourcePositions: false,
    bool emitBytecodeAnnotations: false,
    bool dropAST: false,
    bool useFutureBytecodeFormat: false,
    bool enableAsserts: false,
    bool enableConstantEvaluation: true,
    bool useProtobufTreeShaker: false}) async {
  //替代错误处理程序以检测是否存在编译错误
  final errorDetector = new ErrorDetector(previousErrorHandler: options.onDiagnostic);
  options.onDiagnostic = errorDetector;

  setVMEnvironmentDefines(environmentDefines, options);
  //将dart代码转换为component对象 [见小节2.6]
  final component = await kernelForProgram(source, options);

  if (aot && component != null) {
    // 执行全局转换器 [见小节2.7]
    await _runGlobalTransformations(
        source,
        options,
        component,
        useGlobalTypeFlowAnalysis,
        environmentDefines,
        enableAsserts,
        enableConstantEvaluation,
        useProtobufTreeShaker,
        errorDetector);
  }

  if (genBytecode && !errorDetector.hasCompilationErrors && component != null) {
    //生成字节码，genBytecode默认为false，不执行该操作 [见小节2.8]
    await runWithFrontEndCompilerContext(source, options, component, () {
      generateBytecode(component,
          emitSourcePositions: emitBytecodeSourcePositions,
          emitAnnotations: emitBytecodeAnnotations,
          useFutureBytecodeFormat: useFutureBytecodeFormat,
          environmentDefines: environmentDefines);
    });
    if (dropAST) {
      new ASTRemover(component).visitComponent(component);
    }
  }

  //恢复错误处理程序
  options.onDiagnostic = errorDetector.previousErrorHandler;
  return component;
}
```

该方法主要功能：

- kernelForProgram：将dart代码转换为component对象；
- \_runGlobalTransformations：执行全局转换器；
- generateBytecode：默认genBytecode为false，AST不生成kernel字节码

### 2.6 kernelForProgram
[-> third_party/dart/pkg/front_end/lib/src/api_prototype/kernel_generator.dart]

```Java
Future<CompilerResult> kernelForProgram(
    Uri source, CompilerOptions options) async {
  return (await kernelForProgramInternal(source, options));
}

Future<CompilerResult> kernelForProgramInternal(
    Uri source, CompilerOptions options,
    {bool retainDataForTesting: false}) async {
  var pOptions = new ProcessedOptions(options: options, inputs: [source]);
  return await CompilerContext.runWithOptions(pOptions, (context) async {
    //生成component [见小节2.6.1]
    var component = (await generateKernelInternal())?.component;
    if (component == null) return null;
    // 输入source应该是包含main方法的脚步，否则将报告错误
    if (component.mainMethod == null) {
      context.options.report(
          messageMissingMain.withLocation(source, -1, noLength),
          Severity.error);
      return null;
    }
    return component;
  });
}
```

该方法的主要功能是将整个dart程序代码生成component对象。编译整个程序，生成程序的内核表示，该程序的主库位于给定的源码。 给定包含main方法的文件的Uri，通过该函数的import, export, part声明来发现整个程序，并将结果转换为Dart Kernel格式。 需要注意的是，当[options]中的compileSdk=true，则生成的组件将包含SDK代码。

Component的成员变量libraries，记录所有的lib库，包括app源文件、package以及三方库。每个Library对象会有Class、Field、procedure等组成。


#### 2.6.1 generateKernelInternal
[-> third_party/dart/pkg/front_end/lib/src/kernel_generator_impl.dart]

```Java
Future<CompilerResult> generateKernelInternal(
    {bool buildSummary: false,
    bool buildComponent: true,
    bool truncateSummary: false}) async {
  var options = CompilerContext.current.options;
  var fs = options.fileSystem;
  Loader sourceLoader;
  return withCrashReporting<CompilerResult>(() async {
    UriTranslator uriTranslator = await options.getUriTranslator();

    var dillTarget = new DillTarget(options.ticker, uriTranslator, options.target);
    ...
    await dillTarget.buildOutlines();

    //创建KernelTarget
    var kernelTarget = new KernelTarget(fs, false, dillTarget, uriTranslator);
    sourceLoader = kernelTarget.loader;
    kernelTarget.setEntryPoints(options.inputs);
    Component summaryComponent = await kernelTarget.buildOutlines(nameRoot: nameRoot);

    if (buildSummary) {
      ...
    }

    Component component;
    if (buildComponent) {
      //[见小节2.6.2]
      component = await kernelTarget.buildComponent(verify: options.verify);
    }
    ...
    return new InternalCompilerResult(
        summary: summary,
        component: component,
        classHierarchy:
            includeHierarchyAndCoreTypes ? kernelTarget.loader.hierarchy : null,
        coreTypes:
            includeHierarchyAndCoreTypes ? kernelTarget.loader.coreTypes : null,
        deps: new List<Uri>.from(CompilerContext.current.dependencies),
        kernelTargetForTesting: retainDataForTesting ? kernelTarget : null);
    }, () => sourceLoader?.currentUriForCrashReporting ?? options.inputs.first);
}
```

#### 2.6.2 buildComponent
[-> third_party/dart/pkg/front_end/lib/src/fasta/kernel/kernel_target.dart]

```Java
class KernelTarget extends TargetImplementation {

  Component component;  //成员变量--组件

  Future<Component> buildComponent({bool verify: false}) async {
    if (loader.first == null) return null;
    return withCrashReporting<Component>(() async {
      //[见小节2.6.3]
      await loader.buildBodies();
      finishClonedParameters();
      loader.finishDeferredLoadTearoffs();
      loader.finishNoSuchMethodForwarders();
      List<SourceClassBuilder> myClasses = collectMyClasses();
      loader.finishNativeMethods();
      loader.finishPatchMethods();
      finishAllConstructors(myClasses);
      runBuildTransformations();

      if (verify) this.verify();
      installAllComponentProblems(loader.allComponentProblems);
      return component;
    }, () => loader?.currentUriForCrashReporting);
  }
}
```

KernelTarget的component记录整个dart代码的各种信息。

#### 2.6.3 buildBodies
[-> third_party/dart/pkg/front_end/lib/src/fasta/loader.dart]

```Java
Future<Null> buildBodies() async {
  for (LibraryBuilder library in builders.values) {
    if (library.loader == this) {
      currentUriForCrashReporting = library.uri;
      //[见小节2.6.4]
      await buildBody(library);
    }
  }
  currentUriForCrashReporting = null;
  logSummary(templateSourceBodySummary);
}
```

此处的loader为SourceLoader，是在KernelTarget对象创建过程初始化的。

#### 2.6.4 buildBody
[-> third_party/dart/pkg/front_end/lib/src/fasta/source/source_loader.dart]

```Java
class SourceLoader extends Loader<Library> {

  Future<Null> buildBody(LibraryBuilder library) async {
    if (library is SourceLibraryBuilder) {
      //词法分析
      Token tokens = await tokenize(library, suppressLexicalErrors: true);
      DietListener listener = createDietListener(library);
      DietParser parser = new DietParser(listener);
      //语法分析
      parser.parseUnit(tokens);
      for (SourceLibraryBuilder part in library.parts) {
        if (part.partOfLibrary != library) {
          // part部分包含在多个库中，此处跳过
          continue;
        }
        Token tokens = await tokenize(part);
        if (tokens != null) {
          listener.uri = part.fileUri;
          listener.partDirectiveIndex = 0;
          parser.parseUnit(tokens);
        }
      }
    }
  }
}
```

该方法主要工作：

- 词法分析tokenize：对库中dart源码，根据一定的词法规则解析成词法单元tokens；
- 语法分析parser：对tokens根据Dart语法规则解析成抽象语法树；

说明，这个过程采用两次标记源文件，以保持较低的内存使用率。 这是第二次，第一次是在上面的[buildOutline]中，所以这抑制词法错误。

### 2.7 \_runGlobalTransformations
[-> third_party/dart/pkg/vm/lib/kernel_front_end.dart]

```Java
Future _runGlobalTransformations(
    Uri source,
    CompilerOptions compilerOptions,
    Component component,
    bool useGlobalTypeFlowAnalysis,
    Map<String, String> environmentDefines,
    bool enableAsserts,
    bool enableConstantEvaluation,
    bool useProtobufTreeShaker,
    ErrorDetector errorDetector) async {
  if (errorDetector.hasCompilationErrors) return;

  final coreTypes = new CoreTypes(component);
  _patchVmConstants(coreTypes);

  //mixin应用在前端创建mixin应用时，所有后端(以及从一开始就进行的所有转换)能都受益于mixin重复数据删除。
  //AOT除外， JIT构建情况下，都需要运行此转换
  mixin_deduplication.transformComponent(component);

  if (enableConstantEvaluation) {
    await _performConstantEvaluation(source, compilerOptions, component,
        coreTypes, environmentDefines, enableAsserts);

    if (errorDetector.hasCompilationErrors) return;
  }

  if (useGlobalTypeFlowAnalysis) {
    globalTypeFlow.transformComponent(
        compilerOptions.target, coreTypes, component);
  } else {
    devirtualization.transformComponent(coreTypes, component);
    no_dynamic_invocations_annotator.transformComponent(component);
  }

  if (useProtobufTreeShaker) {
    if (!useGlobalTypeFlowAnalysis) {
      throw 'Protobuf tree shaker requires type flow analysis (--tfa)';
    }

    protobuf_tree_shaker.removeUnusedProtoReferences(
        component, coreTypes, null);

    globalTypeFlow.transformComponent(
        compilerOptions.target, coreTypes, component);
  }

  // 避免通过从平台文件读取重新计算CSA
  void ignoreAmbiguousSupertypes(cls, a, b) {}
  final hierarchy = new ClassHierarchy(component,
      onAmbiguousSupertypes: ignoreAmbiguousSupertypes);
  call_site_annotator.transformLibraries(
      component, component.libraries, coreTypes, hierarchy);

  // 不确定gen_snapshot是否要进行混淆处理，但是如果这样做，则需要混淆处理禁止。
  obfuscationProhibitions.transformComponent(component, coreTypes);
}
```

执行混淆等转换工作

### 2.8 runWithFrontEndCompilerContext
[-> third_party/dart/pkg/vm/lib/kernel_front_end.dart]

```Java
Future<T> runWithFrontEndCompilerContext<T>(Uri source,
    CompilerOptions compilerOptions, Component component, T action()) async {
  final processedOptions =
      new ProcessedOptions(options: compilerOptions, inputs: [source]);

  //在上下文中运行，则可以获取uri源的tokens
  return await CompilerContext.runWithOptions(processedOptions,
      (CompilerContext context) async {
    // 为了使fileUri / fileOffset->行/列映射，则需要预填充映射。
    context.uriToSource.addAll(component.uriToSource);
    //此处action对应的是generateBytecode()方法 [见小节2.8.1]
    return action();
  });
}
```



```
generateBytecode
  BytecodeGenerator.visitLibrary(Library node)
    visitList(node.procedures, BytecodeGenerator);
      Procedure.accept(BytecodeGenerator);
        BytecodeGenerator.visitProcedure(Procedure);
          BytecodeGenerator.defaultMember(Procedure)
            _genxxx
              asm.emitPush
```

third_party/dart/pkg/vm/lib/bytecode/dbc.dart 中定义很多指令

#### 2.8.1 generateBytecode
[-> third_party/dart/pkg/vm/lib/bytecode/gen_bytecode.dart]

```Java

void generateBytecode(
  ast.Component component, {
  bool emitSourcePositions: false,
  bool emitAnnotations: false,
  bool omitAssertSourcePositions: false,
  bool useFutureBytecodeFormat: false,
  Map<String, String> environmentDefines: const <String, String>{},
  ErrorReporter errorReporter,
  List<Library> libraries,
}) {
  final coreTypes = new CoreTypes(component);
  void ignoreAmbiguousSupertypes(Class cls, Supertype a, Supertype b) {}
  final hierarchy = new ClassHierarchy(component,
      onAmbiguousSupertypes: ignoreAmbiguousSupertypes);
  final typeEnvironment = new TypeEnvironment(coreTypes, hierarchy);
  final constantsBackend = new VmConstantsBackend(coreTypes);
  final errorReporter = new ForwardConstantEvaluationErrors();
  //从component获取libraries
  libraries ??= component.libraries;
  //创建字节码生成器对象
  final bytecodeGenerator = new BytecodeGenerator(
      component,
      coreTypes,
      hierarchy,
      typeEnvironment,
      constantsBackend,
      environmentDefines,
      emitSourcePositions,
      emitAnnotations,
      omitAssertSourcePositions,
      useFutureBytecodeFormat,
      errorReporter);
  for (var library in libraries) {
    //[见小节2.8.2]
    bytecodeGenerator.visitLibrary(library);
  }
}
```

遍历component中的所有libraries。

#### 2.8.2 visitLibrary
[-> third_party/dart/pkg/vm/lib/bytecode/gen_bytecode.dart]

```Java
class BytecodeGenerator extends RecursiveVisitor<Null> {

  visitLibrary(Library node) {
    if (node.isExternal) {
      return;
    }
    //对于class的visit会调用到下方的visitClass
    visitList(node.classes, this);
    //初始化fieldDeclarations和functionDeclarations来记录类的字段和方法
    startMembers();
    // [见小节2.8.3]
    visitList(node.procedures, this);
    visitList(node.fields, this);
    endMembers(node);
  }

  visitClass(Class node) {
    startMembers();
    visitList(node.constructors, this);
    visitList(node.procedures, this);
    visitList(node.fields, this);
    endMembers(node);
  }
}
```

该方法主要功能：

- 通过visitList来访问库中的classes，procedures，fields。
  - 先访问类中的构造函数constructors、方法procedures以及字段fields；
  - 再访问库中不属于任何类的一些方法和字段；
- fieldDeclarations和functionDeclarations来记录类的字段和方法，最终保存在bytecodeComponent的成员变量members；

#### 2.8.3 visitList
[-> third_party/dart/pkg/kernel/lib/ast.dart]

```Java
void visitList(List<Node> nodes, Visitor visitor) {
  for (int i = 0; i < nodes.length; ++i) {
    // [见小节2.8.4]
    nodes[i].accept(visitor);
  }
}
```

该方法说明：

- 此处的nodes，可以是classes，constructors，procedures或者fields
- 此处的visitor，便是BytecodeGenerator

#### 2.8.4 accept
[-> third_party/dart/pkg/kernel/lib/ast.dart]

```Java
class Procedure extends Member {
  accept(MemberVisitor v) => v.visitProcedure(this);
}

class Field extends Member {
  R accept<R>(MemberVisitor<R> v) => v.visitField(this);
}

class Constructor extends Member {
  R accept<R>(MemberVisitor<R> v) => v.visitConstructor(this);
}

```

此处的v是BytecodeGenerator，而BytecodeGenerator间接继承于TreeVisitor，在TreeVisitor由大量的visitXXX()方法，最终都是调用到defaultMember()，如下所示。

```Java
class TreeVisitor<R> {
  // [见小节2.8.5]
  R visitConstructor(Constructor node) => defaultMember(node);
  R visitProcedure(Procedure node) => defaultMember(node);
  R visitField(Field node) => defaultMember(node);
}
```

#### 2.8.5 defaultMember
[-> third_party/dart/pkg/vm/lib/bytecode/gen_bytecode.dart]

```Java
defaultMember(Member node) {
  // 当该方法表示重定向工厂构造函数，并且没有可运行的主体，则直接返回
  if (node is Procedure && node.isRedirectingFactoryConstructor) {
    return;
  }
  try {
    bool hasCode = false;
    start(node);
    //字段类型
    if (node is Field) {  
      if (hasInitializerCode(node)) {
        hasCode = true;
        if (node.isConst) {
          _genPushConstExpr(node.initializer);
        } else {
          _generateNode(node.initializer);
        }
        _genReturnTOS();
      }
      //方法类型
    } else if ((node is Procedure && !node.isRedirectingFactoryConstructor) ||
        (node is Constructor)) {
      if (!node.isAbstract) {
        hasCode = true;
        if (node is Constructor) {
          _genConstructorInitializers(node);
        }
        if (node.isExternal) {
          final String nativeName = getExternalName(node);
          if (nativeName != null) {
            _genNativeCall(nativeName);
          } else {
            asm.emitPushNull();
          }
        } else {
          _generateNode(node.function?.body);
          // 如果无法访问此字节码，则BytecodeAssembler会将其消除。
          asm.emitPushNull();
        }
        _genReturnTOS();
      }
    } else {
      throw 'Unexpected member ${node.runtimeType} $node';
    }
    end(node, hasCode);
  } on BytecodeLimitExceededException {
    // 不生成字节码，回滚到内核语法树AST
    hasErrors = true;
    end(node, false);
  }
}
```

该方法主要功能是 根据node类型：字段、方法或者构造方法，则生成相应的汇编指令。 这里会有很多_genXXX()方法，最终是调用asm.emitXXX()方法，
此处的asm的数据类型为BytecodeAssembler。 接下来以emitPushNull为例子，继续往下说。

#### 2.8.6 emitPushNull
[-> third_party/dart/pkg/vm/lib/bytecode/assembler.dart]

```Java
class BytecodeAssembler {

  final List<int> bytecode = new List<int>();
  final Uint32List _encodeBufferIn;
  final Uint8List _encodeBufferOut;

  void emitPushNull() {
    emitWord(_encode0(Opcode.kPushNull));
  }

  void emitWord(int word) {
    if (isUnreachable) {
      return;
    }
    _encodeBufferIn[0] = word;  //opcode写入_encodeBufferIn
    bytecode.addAll(_encodeBufferOut);
  }
  //将操作码转换整型
  int _encode0(Opcode opcode) => _uint8(opcode.index);
  ...
}
```

可见，所有的字节码信息最终都写入到BytecodeAssembler的bytecode列表。另外，Opcode操作码位于dbc.dart，里面定义了各种操作码。

### 2.9 writeDillFile
[-> third_party/dart/pkg/vm/lib/frontend_server.dart]

```Java
writeDillFile(Component component, String filename,
    {bool filterExternal: false}) async {
  final IOSink sink = new File(filename).openWrite();
  final BinaryPrinter printer = filterExternal
      ? new LimitedBinaryPrinter(
          sink, (lib) => !lib.isExternal, true /* excludeUriToSource */)
      : printerFactory.newBinaryPrinter(sink);

  component.libraries.sort((Library l1, Library l2) {
    return "${l1.fileUri}".compareTo("${l2.fileUri}");
  });

  component.computeCanonicalNames();
  for (Library library in component.libraries) {
    library.additionalExports.sort((Reference r1, Reference r2) {
      return "${r1.canonicalName}".compareTo("${r2.canonicalName}");
    });
  }
  if (unsafePackageSerialization == true) {
    writePackagesToSinkAndTrimComponent(component, sink);
  }
  //[见小节2.9.1]
  printer.writeComponentFile(component);
  await sink.close();
}
```

再回到[小节2.4]，执行完compileToKernel()后开始执行writeDillFile，该方法主要功能便是将component内容写入app.dill文件。

- component：是指compileToKernel()方法执行后得到的，记录dart代码中类、方法、字段等所有相关信息
- filename：是指前面传递--output-dill参数值，也就是app.dill

#### 2.9.1 writeComponentFile
[-> third_party/dart/pkg/kernel/lib/binary/ast_to_binary.dart]

```Java
void writeComponentFile(Component component) {
  computeCanonicalNames(component);
  final componentOffset = getBufferOffset();
  writeUInt32(Tag.ComponentFile);
  writeUInt32(Tag.BinaryFormatVersion);
  writeListOfStrings(component.problemsAsJson);
  indexLinkTable(component);
  _collectMetadata(component);
  if (_metadataSubsections != null) {
    // 将asm.bytecode写入文件
    _writeNodeMetadataImpl(component, componentOffset);
  }
  libraryOffsets = <int>[];
  CanonicalName main = getCanonicalNameOfMember(component.mainMethod);
  if (main != null) {
    checkCanonicalName(main);
  }
  writeLibraries(component);
  writeUriToSource(component.uriToSource);
  writeLinkTable(component);
  _writeMetadataSection(component);
  writeStringTable(stringIndexer);
  writeConstantTable(_constantIndexer);
  writeComponentIndex(component, component.libraries);

  _flush();
}
```

这便完成的kernel编译以及文件生成过程。

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
