---
layout: post
title:  "源码解读Flutter tools机制"
date:   2019-09-01 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、Flutter tools命令

### 1.1 概述
开发Flutter应用过程，经常会用过Flutter命令，比如flutter run可用于安装并运行Flutter应用，flutter build可用于构建产物，相信有不少人会好奇flutter命令背后的原理。
对于flutter命令的起点位于flutter sdk中路径/flutter/bin/目录中的flutter命令，该命令最终会调用到flutter/packages/flutter_tools工程。

### 1.2 flutter命令参数表

列举Flutter命令、对应类以及说明，实现见下文[小节2.3]。

|名称|对应类|说明|
|---|---|---|
|create   |   CreateCommand|                 创建新的Flutter项目
|build    |    BuildCommand|                Flutter构建命令
|install  |  InstallCommand|               安装Flutter应用到已连接设备
|run      |      RunCommand|               运行Flutter应用于已连接设备
|packages | PackagesCommand|              管理Flutter包的命令
|devices  |  DevicesCommand|              列出所有已连接的设备
|emulators|EmulatorsCommand|              列出，启动，创建模拟器
|attach   |   AttachCommand|                附加到正在运行的应用程序
|trace    |    TraceCommand|             开始和停止跟踪正在运行的Flutter应用程序
|logs     |     LogsCommand|             显示Flutter应用运行中的log
|doctor   |   DoctorCommand|            显示关于已安装工具的信息
|upgrade  |  UpgradeCommand|             升级Flutter
|clean    |    CleanCommand|                删除build/和.dart_tool/ 目录
|analyze  |  AnalyzeCommand|                 分析项目Dart代码
|format   |   FormatCommand|               格式化一个或多个dart文件
|config   |   ConfigCommand|                 配置Flutter settings
|drive    |    DriveCommand|                为当前项目运行Flutter Driver测试
|test     |     TestCommand|              为当前项目运行Flutter 单元测试

另外，对于flutter build有子命令，其子命令的对应类及说明如下：

|命令|对应类|说明|
|---|---|---|
|build aot|BuildAotCommand|构建AOT编译产物|
|build apk|BuildApkCommand|构建Android APK|
|build ios|BuildIOSCommand|构建iOS应用bundle|
|build appbundle|BuildAppBundleCommand|构建Android应用bundle|
|build bundle|BuildBundleCommand|构建Flutter assets|

比如flutter run则执行RunCommand.runCommand()，flutter install则执行InstallCommand.runCommand()。

## 二、深入源码flutter命令

### 2.1 flutter命令起点
[-> /flutter/bin/flutter]

```Java
...
FLUTTER_TOOLS_DIR="$FLUTTER_ROOT/packages/flutter_tools"
SNAPSHOT_PATH="$FLUTTER_ROOT/bin/cache/flutter_tools.snapshot"
STAMP_PATH="$FLUTTER_ROOT/bin/cache/flutter_tools.stamp"
SCRIPT_PATH="$FLUTTER_TOOLS_DIR/bin/flutter_tools.dart"
DART_SDK_PATH="$FLUTTER_ROOT/bin/cache/dart-sdk"

DART="$DART_SDK_PATH/bin/dart"
PUB="$DART_SDK_PATH/bin/pub"

//真正的执行逻辑
"$DART" $FLUTTER_TOOL_ARGS "$SNAPSHOT_PATH" "$@"
```

该方法功能：

- $DART：是指$FLUTTER_ROOT/bin/cache/dart-sdk/bin/dart；
- $SNAPSHOT_PATH：是指$FLUTTER_ROOT/bin/cache/flutter_tools.snapshot，这是由packages/flutter_tools项目编译所生成的产物文件。

那么flutter命令等价于如下：

```Java
/bin/cache/dart-sdk/bin/dart $FLUTTER_TOOL_ARGS "bin/cache/flutter_tools.snapshot" "$@"
```

dart执行flutter_tools.snapshot，其实也就是执行flutter_tools.dart的main()方法，也就是说将上述命令改为如下语句，则运行flutter命令可以执行本地flutter_tools的项目代码，可用于本地调试分析。

```Java
/bin/cache/dart-sdk/bin/dart $FLUTTER_TOOL_ARGS "$FLUTTER_ROOT/packages/flutter_tools/bin/flutter_tools.dart" "$@"
```

接下来，执行流程进入flutter/packages/flutter_tools/目录。


### 2.2 flutter_tools.main
[-> flutter/packages/flutter_tools/bin/flutter_tools.dart]

```Java
import 'package:flutter_tools/executable.dart' as executable;

void main(List<String> args) {
  executable.main(args);  //[见小节2.3]
}
```


### 2.3 executable.main
[-> lib/executable.dart]

```Java
import 'runner.dart' as runner;

Future<void> main(List<String> args) async {
  ...
  //[见小节2.4]
  await runner.run(args, <FlutterCommand>[
    AnalyzeCommand(verboseHelp: verboseHelp),
    AttachCommand(verboseHelp: verboseHelp),
    BuildCommand(verboseHelp: verboseHelp),
    ChannelCommand(verboseHelp: verboseHelp),
    CleanCommand(),
    ConfigCommand(verboseHelp: verboseHelp),
    CreateCommand(),
    DaemonCommand(hidden: !verboseHelp),
    DevicesCommand(),
    DoctorCommand(verbose: verbose),
    DriveCommand(),
    EmulatorsCommand(),
    FormatCommand(),
    GenerateCommand(),
    IdeConfigCommand(hidden: !verboseHelp),
    InjectPluginsCommand(hidden: !verboseHelp),
    InstallCommand(),
    LogsCommand(),
    MakeHostAppEditableCommand(),
    PackagesCommand(),
    PrecacheCommand(),
    RunCommand(verboseHelp: verboseHelp),
    ScreenshotCommand(),
    ShellCompletionCommand(),
    StopCommand(),
    TestCommand(verboseHelp: verboseHelp),
    TraceCommand(),
    TrainingCommand(),
    UpdatePackagesCommand(hidden: !verboseHelp),
    UpgradeCommand(),
    VersionCommand(),
  ], verbose: verbose,
     muteCommandLogging: muteCommandLogging,
     verboseHelp: verboseHelp,
     overrides: <Type, Generator>{
       CodeGenerator: () => const BuildRunner(),
     });
}

```

### 2.4 runner.run
[-> lib/runner.dart]

```Java
Future<int> run(
  List<String> args,
  List<FlutterCommand> commands, {
  bool muteCommandLogging = false,
  bool verbose = false,
  bool verboseHelp = false,
  bool reportCrashes,
  String flutterVersion,
  Map<Type, Generator> overrides,
}) {
  ...
  //创建FlutterCommandRunner对象
  final FlutterCommandRunner runner = FlutterCommandRunner(verboseHelp: verboseHelp);
  //[见小节2.4.1] 将创建的命令对象都加入到_commands
  commands.forEach(runner.addCommand);

  return runInContext<int>(() async {
    ...
    // [见小节2.5]
    await runner.run(args);
    ...
  }, overrides: overrides);
}
```

#### 2.4.1 addCommand
[-> package:args/command_runner.dart]

```Java
void addCommand(Command<T> command) {
  var names = [command.name]..addAll(command.aliases);
  for (var name in names) {
    _commands[name] = command;
    argParser.addCommand(name, command.argParser);
  }
  command._runner = this;
}
```

所有命令都加入到_commands。比如flutter run对应的命令对象为RunCommand，flutter build对应的命令对象为buildCommand。

### 2.5 FlutterCommandRunner.run
[-> lib/src/runner/flutter_command_runner.dart]

```Java
class FlutterCommandRunner extends CommandRunner<void> {

  Future<void> run(Iterable<String> args) {
    return super.run(args); // [见小节2.6]
  }
}
```

### 2.6 CommandRunner.run
[-> package:args/command_runner.dart]

```Java
class CommandRunner<T> {

  Future<T> run(Iterable<String> args) =>
      new Future.sync(() => runCommand(parse(args))); //见下文

  Future<T> runCommand(ArgResults topLevelResults) async {
    var argResults = topLevelResults;
    var commands = _commands;
    Command command;
    var commandString = executableName;

    while (commands.isNotEmpty) {
      ...
      argResults = argResults.command;
      //根据命令名从命令列表中找到相应的命令
      command = commands[argResults.name];
      command._globalResults = topLevelResults;
      command._argResults = argResults;
      commands = command._subcommands;  //查找到子命令
      commandString += " ${argResults.name}";
    }
    // 执行真正对应命令的run()方法 [见小节2.7]
    return (await command.run()) as T;
  }
}
```

该方法会根据命令后通过循环遍历查找子命令，直到找到最后的命令为止。但这些命令都直接或者间接继承于FlutterCommand命令

### 2.7 FlutterCommand.run
[-> lib/src/runner/flutter_command.dart]

```Java
abstract class FlutterCommand extends Command<void> {

  Future<void> run() {
    final DateTime startTime = systemClock.now();

    return context.run<void>(
      name: 'command',
      overrides: <Type, Generator>{FlutterCommand: () => this},
      body: () async {
        ...
        try {
          // [见小节2.8]
          commandResult = await verifyThenRunCommand(commandPath);
        } on ToolExit {
          commandResult = const FlutterCommandResult(ExitStatus.fail);
          rethrow;
        } finally {
          ...
        }
      },
    );
  }
}
```

### 2.8 FlutterCommand.verifyThenRunCommand
[-> lib/src/runner/flutter_command.dart]

```Java
abstract class FlutterCommand extends Command<void> {

  Future<FlutterCommandResult> verifyThenRunCommand(String commandPath) async {
    await validateCommand();
    if (shouldUpdateCache) {
      await cache.updateAll(await requiredArtifacts);
    }
    if (shouldRunPub) {
      //获取pub
      await pubGet(context: PubContext.getVerifyContext(name));
      final FlutterProject project = await FlutterProject.current();
      await project.ensureReadyForPlatformSpecificTooling();
    }
    setupApplicationPackages();
    ...

    // 执行真正对应的命令类
    return await runCommand();
  }
}
```

该方法先执行pubGet()用于下载pubspec.yaml里配置的依赖，该pub对应执行命令为：

```Java
$flutterRoot/bin/cache/dart-sdk/bin/pub --verbosity=warning get --no-precompile
```

最终执行真正对应的命令类的runCommand方法。如果RunCommand.runCommand()过程，见下一篇文章。


## 附录

```Java
/flutter/bin/flutter

/flutter/packages/flutter_tools/
  - bin/flutter_tools.dart
  - lib/executable.dart
  - lib/runner.dart
  - lib/src/runner/flutter_command_runner.dart
  - lib/src/runner/flutter_command.dart  (FlutterCommand是各种Command的父类)

package:args/command_runner.dart
```
