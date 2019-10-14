---
layout: post
title:  "源码解读Flutter run机制"
date:   2019-09-21 21:15:40
catalog:  true
tags:
    - flutter

---

## 一、概述


flutter run执行过程的日志可大致知道该过程至少包括gradle构建APK以及安装APK的流程。

![flutter_run_cmd](/img/flutter_command/flutter_run_cmd.png)

相信有不少人会好奇flutter命令背后的原理，这里就以[小节二]中flutter run命令为起点展开，flutter run 命令对应 RunCommand，该命令执行过程中包括以下4个部分组成：

- [小节三] flutter build apk 命令对应 BuildApkCommand
- [小节四] flutter build aot 命令对应 BuildAotCommand
- [小节五] flutter build bundle 命令对应 BuildBundleCommand
- [小节六] flutter install 命令对应 InstallCommand

说明以下过程都位于工程flutter/packages/flutter_tools/目录。

## 二、flutter run命令

根据文章[Flutter tools](http://gityuan.com/2019/09/14/flutter_tool/)可知，对于flutter run命令，那么对应执行的便是RunCommand.runCommand()。

### 2.1 RunCommand.runCommand
[-> lib/src/commands/run.dart]

```Java
Future<FlutterCommandResult> runCommand() async {
  // debug模式会默认开启热加载模式，如果不需要则添加参数--no-hot
  final bool hotMode = shouldUseHotMode();
  ...
  //遍历所有已连接设备，runCommand的validateCommand过程会发现所有已连接设备
  for (Device device in devices) {
    final FlutterDevice flutterDevice = await FlutterDevice.create(
      device,
      trackWidgetCreation: argResults['track-widget-creation'],
      dillOutputPath: argResults['output-dill'],
      fileSystemRoots: argResults['filesystem-root'],
      fileSystemScheme: argResults['filesystem-scheme'],
      viewFilter: argResults['isolate-filter'],
      experimentalFlags: expFlags,
      target: argResults['target'],
      buildMode: getBuildMode(),
    );
    flutterDevices.add(flutterDevice);
  }

  ResidentRunner runner;
  final String applicationBinaryPath = argResults['use-application-binary'];
  if (hotMode) {
    runner = HotRunner(
      flutterDevices,
      target: targetFile,
      //创建调试flag的开关
      debuggingOptions: _createDebuggingOptions(),
      benchmarkMode: argResults['benchmark'],
      applicationBinary: applicationBinaryPath == null
          ? null : fs.file(applicationBinaryPath),
      projectRootPath: argResults['project-root'],
      packagesFilePath: globalResults['packages'],
      dillOutputPath: argResults['output-dill'],
      saveCompilationTrace: argResults['train'],
      stayResident: stayResident,
      ipv6: ipv6,
    );
  } else {
    runner = ColdRunner(
      flutterDevices,
      target: targetFile,
      debuggingOptions: _createDebuggingOptions(),
      traceStartup: traceStartup,
      awaitFirstFrameWhenTracing: awaitFirstFrameWhenTracing,
      applicationBinary: applicationBinaryPath == null
          ? null : fs.file(applicationBinaryPath),
      saveCompilationTrace: argResults['train'],
      stayResident: stayResident,
      ipv6: ipv6,
    );
  }
  ...

  // [见小节2.2]
  final int result = await runner.run(
    appStartedCompleter: appStartedTimeRecorder,
    route: route,
    shouldBuild: !runningWithPrebuiltApplication && argResults['build'],
  );
  ...
}
```

这里以hot reload为例来接着往下说。

### 2.2 HotRunner.run
[-> lib/src/run_hot.dart]

```Java
class HotRunner extends ResidentRunner {
  Future<int> run({
    Completer<DebugConnectionInfo> connectionInfoCompleter,
    Completer<void> appStartedCompleter,
    String route,
    bool shouldBuild = true,
  }) async {
    ...
    firstBuildTime = DateTime.now();

    for (FlutterDevice device in flutterDevices) {
      //[见小节2.3]
      final int result = await device.runHot(
        hotRunner: this,
        route: route,
        shouldBuild: shouldBuild,
      );
    }
    //与设备建立连接
    return attach(
      connectionInfoCompleter: connectionInfoCompleter,
      appStartedCompleter: appStartedCompleter,
    );
  }
}
```


### 2.3 FlutterDevice.runHot
[-> lib/src/resident_runner.dart]

```Java
class FlutterDevice {

  Future<int> runHot({HotRunner hotRunner, String route, bool shouldBuild,}) async {
    final bool prebuiltMode = hotRunner.applicationBinary != null;
    final String modeName = hotRunner.debuggingOptions.buildInfo.friendlyModeName;

    final TargetPlatform targetPlatform = await device.targetPlatform;
    package = await ApplicationPackageFactory.instance.getPackageForPlatform(
        targetPlatform, applicationBinary: hotRunner.applicationBinary,
    );
    ...
    //[见小节2.4/2.5] 启动应用
    final Future<LaunchResult> futureResult = device.startApp(
      package,
      mainPath: hotRunner.mainPath,
      debuggingOptions: hotRunner.debuggingOptions,
      platformArgs: platformArgs,
      route: route,
      prebuiltApplication: prebuiltMode,
      usesTerminalUi: hotRunner.usesTerminalUI,
      ipv6: hotRunner.ipv6,
    );
    final LaunchResult result = await futureResult;
    ...
    return 0;
  }
}
```

应用启动过程，这里小节2.4介绍Android，小节2.5是介绍iOS的启动过程。

### 2.4 AndroidDevice.startApp
[-> lib/src/android/android_device.dart]

```Java
class AndroidDevice extends Device {

  Future<LaunchResult> startApp(
    ApplicationPackage package, {
    String mainPath,
    String route,
    DebuggingOptions debuggingOptions,
    Map<String, dynamic> platformArgs,
    bool prebuiltApplication = false,
    bool usesTerminalUi = true,
    bool ipv6 = false,
  }) async {
    ...
    //获取平台信息arm64/arm/x64/x86
    final TargetPlatform devicePlatform = await targetPlatform;

    if (!prebuiltApplication || androidSdk.licensesAvailable && androidSdk.latestVersion == null) {
      final FlutterProject project = await FlutterProject.current();
      //通过gradle来构建APK [小节3.2]
      await buildApk(project: project, target: mainPath, buildInfo: buildInfo,);
      //APK已构建，则从中获取应用id(包名)和activity名
      package = await AndroidApk.fromAndroidProject(project.android);
    }
    //通过adb am force-stop来强杀该应用
    await stopApp(package);

    //该方法会installApp()安装APK [小节6.2]
    if (!await _installLatestApp(package))
      return LaunchResult.failed();
    ...

    if (debuggingOptions.debuggingEnabled) {
      //调试模式，开启observatory
      observatoryDiscovery = ProtocolDiscovery.observatory(
        getLogReader(),
        portForwarder: portForwarder,
        hostPort: debuggingOptions.observatoryPort,
        ipv6: ipv6,
      );
    }

    List<String> cmd;
    // 通过adb am start来启动应用
    cmd = adbCommandForDevice(<String>[
      'shell', 'am', 'start',
      '-a', 'android.intent.action.RUN',
      '-f', '0x20000000', // FLAG_ACTIVITY_SINGLE_TOP
      '--ez', 'enable-background-compilation', 'true',
      '--ez', 'enable-dart-profiling', 'true',
    ]);

    if (traceStartup)
      cmd.addAll(<String>['--ez', 'trace-startup', 'true']);
    if (route != null)
      cmd.addAll(<String>['--es', 'route', route]);
    if (debuggingOptions.enableSoftwareRendering)
      cmd.addAll(<String>['--ez', 'enable-software-rendering', 'true']);
    if (debuggingOptions.skiaDeterministicRendering)
      cmd.addAll(<String>['--ez', 'skia-deterministic-rendering', 'true']);
    if (debuggingOptions.traceSkia)
      cmd.addAll(<String>['--ez', 'trace-skia', 'true']);
    if (debuggingOptions.traceSystrace)
      cmd.addAll(<String>['--ez', 'trace-systrace', 'true']);
    if (debuggingOptions.dumpSkpOnShaderCompilation)
      cmd.addAll(<String>['--ez', 'dump-skp-on-shader-compilation', 'true']);
    if (debuggingOptions.debuggingEnabled) {
      if (debuggingOptions.buildInfo.isDebug) {
        cmd.addAll(<String>['--ez', 'enable-checked-mode', 'true']);
        cmd.addAll(<String>['--ez', 'verify-entry-points', 'true']);
      }
      if (debuggingOptions.startPaused)
        cmd.addAll(<String>['--ez', 'start-paused', 'true']);
      if (debuggingOptions.disableServiceAuthCodes)
        cmd.addAll(<String>['--ez', 'disable-service-auth-codes', 'true']);
      if (debuggingOptions.useTestFonts)
        cmd.addAll(<String>['--ez', 'use-test-fonts', 'true']);
      if (debuggingOptions.verboseSystemLogs) {
        cmd.addAll(<String>['--ez', 'verbose-logging', 'true']);
      }
    }
    cmd.add(apk.launchActivity);
    final String result = (await runCheckedAsync(cmd)).stdout;
    ...

    if (!debuggingOptions.debuggingEnabled)
      return LaunchResult.succeeded();
    try {
      Uri observatoryUri;
      //debug或者profile模式，开启observatory服务来跟设备交互
      if (debuggingOptions.buildInfo.isDebug || debuggingOptions.buildInfo.isProfile) {
        observatoryUri = await observatoryDiscovery.uri;
      }
      return LaunchResult.succeeded(observatoryUri: observatoryUri);
    } catch (error) {
      ...
    } finally {
      await observatoryDiscovery.cancel();
    }
  }
}
```

关于TargetPlatform，是通过adb shell getprop获取属性值来查看ro.product.cpu.abi的值，来获取平台信息arm64/arm/x64/x86。

该方法的主要功能是以下完成如下几件事：

1. 通过gradle来构建APK
2. 通过adb am force-stop来强杀旧的应用
3. 通过adb install来安装APK
4. 通过adb am start来启动应用
5. 对于debug或者profile模式，等待开启observatory服务

### 2.5 IOSDevice.startApp
[-> lib/src/ios/devices.dart]

```Java
class IOSDevice extends Device {

  Future<LaunchResult> startApp(
    ApplicationPackage package, {
    String mainPath,
    String route,
    DebuggingOptions debuggingOptions,
    Map<String, dynamic> platformArgs,
    bool prebuiltApplication = false,
    bool usesTerminalUi = true,
    bool ipv6 = false,
  }) async {
    if (!prebuiltApplication) {
      //ideviceinfo中获取CPUArchitecture，从而判断是armv7还是arm64
      final String cpuArchitecture = await iMobileDevice.getInfoForDevice(id, 'CPUArchitecture');
      final IOSArch iosArch = getIOSArchForName(cpuArchitecture);

      // Step 1: 构建预编译/DBC应用
      final XcodeBuildResult buildResult = await buildXcodeProject(
          app: package,
          buildInfo: debuggingOptions.buildInfo,
          targetOverride: mainPath,
          buildForDevice: true,
          usesTerminalUi: usesTerminalUi,
          activeArch: iosArch,
      );

    } else {
      if (!await installApp(package))
        return LaunchResult.failed();
    }

    // Step 2: 检查应用程序是否存在于指定路径
    final IOSApp iosApp = package;
    final Directory bundle = fs.directory(iosApp.deviceBundlePath);

    // Step 3: 在设备上尝试安装应用
    final List<String> launchArguments = <String>['--enable-dart-profiling'];

    if (debuggingOptions.startPaused)
      launchArguments.add('--start-paused');

    if (debuggingOptions.disableServiceAuthCodes)
      launchArguments.add('--disable-service-auth-codes');

    if (debuggingOptions.useTestFonts)
      launchArguments.add('--use-test-fonts');

    if (debuggingOptions.debuggingEnabled) {
      launchArguments.add('--enable-checked-mode');
      launchArguments.add('--verify-entry-points');
    }

    if (debuggingOptions.enableSoftwareRendering)
      launchArguments.add('--enable-software-rendering');

    if (debuggingOptions.skiaDeterministicRendering)
      launchArguments.add('--skia-deterministic-rendering');

    if (debuggingOptions.traceSkia)
      launchArguments.add('--trace-skia');

    if (debuggingOptions.dumpSkpOnShaderCompilation)
      launchArguments.add('--dump-skp-on-shader-compilation');

    if (debuggingOptions.verboseSystemLogs) {
      launchArguments.add('--verbose-logging');
    }

    if (platformArgs['trace-startup'] ?? false)
      launchArguments.add('--trace-startup');

    int installationResult = -1;
    Uri localObservatoryUri;

    if (!debuggingOptions.debuggingEnabled) {
      ...
    } else {
      //调试模式，则打开observatory服务
      final ProtocolDiscovery observatoryDiscovery = ProtocolDiscovery.observatory(
        getLogReader(app: package),
        portForwarder: portForwarder,
        hostPort: debuggingOptions.observatoryPort,
        ipv6: ipv6,
      );

      final Future<Uri> forwardObservatoryUri = observatoryDiscovery.uri;
      //启动应用
      final Future<int> launch = const IOSDeploy().runApp(
        deviceId: id,
        bundlePath: bundle.path,
        launchArguments: launchArguments,
      );

      localObservatoryUri = await launch.then<Uri>((int result) async {
        installationResult = result;
        //等待observatory服务启动完成
        return await forwardObservatoryUri;
      }).whenComplete(() {
        observatoryDiscovery.cancel();
      });
    }
    ...
    return LaunchResult.succeeded(observatoryUri: localObservatoryUri);
  }
}
```

该方法主要功能：

1. 构建预编译/DBC应用
2. 检查应用程序是否存在于指定路径
3. 通过ios-deploy命令来安装并运行应用
4. 对于debug或者profile模式，等待开启observatory服务

关于运行时参数跟Android基本一致。


### 2.6 flutter run参数小结
flutter run最核心的功能是：

- 通过gradle来构建APK
- 通过adb install来安装APK
- 通过adb am start来启动应用


对于am start过程有很多debuggingOptions可选的调试参数，如下所示：

|flags|含义|
|---|---|
|trace-startup|跟踪启动|
|route||
|enable-software-rendering|开启软件渲染|
|skia-deterministic-rendering||
|trace-skia|跟踪skia|
|trace-systrace|跟进systrace|
|dump-skp-on-shader-compilation||
|enable-checked-mode||
|verify-entry-points||
|start-paused|应用启动后暂停|
|disable-service-auth-codes|关闭observatory服务鉴权|
|use-test-fonts|使用测试字体|
|verbose-logging|输出verbose日志|

由此可见，如果你希望运行某个已经安装过的flutter应用，可以跳过安装等环节，可以直接执行应用启动，如下命令：

```
adb shell am start -a android.intent.action.RUN -f 0x20000000
    --ez enable-background-compilation true
    --ez enable-dart-profiling true
    --ez disable-service-auth-codes true
    com.gityuan.flutterdemo/.MainActivity
```

## 三、flutter build apk命令

对于flutter build apk命令，那么对应执行的便是BuildApkCommand类，那么接下来便是执行BuildApkCommand.runCommand()。

### 3.1 BuildApkCommand.runCommand
[-> lib/src/commands/build_apk.dart]

```Java
class BuildApkCommand extends BuildSubCommand {
  Future<FlutterCommandResult> runCommand() async {
    // [见小节3.2]
    await buildApk(
      project: await FlutterProject.current(),
      target: targetFile,
      buildInfo: getBuildInfo(),
    );
    return null;
  }
}
```

### 3.2 buildApk
[-> lib/src/android/apk.dart]

```Java
Future<void> buildApk({
  @required FlutterProject project,
  @required String target,
  BuildInfo buildInfo = BuildInfo.debug,
}) async {
  // [见小节3.3]
  await buildGradleProject(
    project: project,
    buildInfo: buildInfo,
    target: target,
    isBuildingBundle: false,
  );
  androidSdk.reinitialize();
}
```

### 3.3 buildGradleProject
[-> lib/src/android/gradle.dart]

```Java
Future<void> buildGradleProject({
  @required FlutterProject project,
  @required BuildInfo buildInfo,
  @required String target,
  @required bool isBuildingBundle,
}) async {

  updateLocalProperties(project: project, buildInfo: buildInfo);
  // [见小节3.3.1] 获取gradle命令
  final String gradle = await _ensureGradle(project);

  switch (getFlutterPluginVersion(project.android)) {
    case FlutterPluginVersion.none:
    case FlutterPluginVersion.v1:
      return _buildGradleProjectV1(project, gradle);
    case FlutterPluginVersion.managed:
    case FlutterPluginVersion.v2:
      // [见小节3.4]
      return _buildGradleProjectV2(project, gradle, buildInfo, target, isBuildingBundle);
  }
}
```

更新local.properties文件的构建模式、版本名和版本号。 FlutterPlugin v1读取local.properties以确定构建模式， 插件v2使用标准的Android方法来确定要构建的内容。版本名称和版本号由pubspec.yaml文件提供并可以用flutter build命令覆盖。默认的Gradle脚本读取版本名称和编号从local.properties文件中。

#### 3.3.1 \_ensureGradle
[-> lib/src/android/gradle.dart]

```Java
Future<String> _ensureGradle(FlutterProject project) async {
  _cachedGradleExecutable ??= await _initializeGradle(project);
  return _cachedGradleExecutable;
}

Future<String> _initializeGradle(FlutterProject project) async {
  final Directory android = project.android.hostAppGradleRoot;
  final Status status = logger.startProgress('Initializing gradle...', timeout: timeoutConfiguration.slowOperation);
  // [见小节3.3.2]
  String gradle = _locateGradlewExecutable(android);
  if (gradle == null) {
    injectGradleWrapper(android);
    gradle = _locateGradlewExecutable(android);
  }
  // 通过检查版本来验证Gradle可执行文件。如果需要，请下载并安装Gradle发行版。
  await runCheckedAsync(<String>[gradle, '-v'], environment: _gradleEnv);
  status.stop();
  return gradle;
}
```

#### 3.3.2 \_locateGradlewExecutable
[-> lib/src/android/gradle.dart]

```Java
String _locateGradlewExecutable(Directory directory) {
  final File gradle = directory.childFile(
    platform.isWindows ? 'gradlew.bat' : 'gradlew',
  );

  if (gradle.existsSync()) {
    os.makeExecutable(gradle);
    return gradle.absolute.path;
  } else {
    return null;
  }
}
```

该方法说明：

- 对于window环境，则是gradlew.bat；
- 其他环境，则是gradlew；

### 3.4 \_buildGradleProjectV2
[-> lib/src/android/gradle.dart]

```Java
Future<void> _buildGradleProjectV2(
  FlutterProject flutterProject,
  String gradle,
  BuildInfo buildInfo,
  String target,
  bool isBuildingBundle,  
) async {
  final GradleProject project = await _gradleProject();

  String assembleTask;
  // 前面传递过来isBuildingBundle为false
  if (isBuildingBundle) {
    assembleTask = project.bundleTaskFor(buildInfo);
  } else {
    assembleTask = project.assembleTaskFor(buildInfo);
  }
  //获取gradle路径
  final String gradlePath = fs.file(gradle).absolute.path;
  final List<String> command = <String>[gradlePath];

  if (artifacts is LocalEngineArtifacts) {
    final LocalEngineArtifacts localEngineArtifacts = artifacts;
    command.add('-PlocalEngineOut=${localEngineArtifacts.engineOutPath}');
  }
  if (target != null) {
    command.add('-Ptarget=$target');
  }
  command.add('-Ptrack-widget-creation=${buildInfo.trackWidgetCreation}');
  if (buildInfo.compilationTraceFilePath != null)
    command.add('-Pcompilation-trace-file=${buildInfo.compilationTraceFilePath}');
  if (buildInfo.createPatch)
    command.add('-Ppatch=true');
  if (buildInfo.extraFrontEndOptions != null)
    command.add('-Pextra-front-end-options=${buildInfo.extraFrontEndOptions}');
  if (buildInfo.extraGenSnapshotOptions != null)
    command.add('-Pextra-gen-snapshot-options=${buildInfo.extraGenSnapshotOptions}');
  if (buildInfo.fileSystemRoots != null && buildInfo.fileSystemRoots.isNotEmpty)
    command.add('-Pfilesystem-roots=${buildInfo.fileSystemRoots.join('|')}');
  if (buildInfo.fileSystemScheme != null)
    command.add('-Pfilesystem-scheme=${buildInfo.fileSystemScheme}');
  if (buildInfo.buildSharedLibrary && androidSdk.ndk != null) {
    command.add('-Pbuild-shared-library=true');
  }
  if (buildInfo.targetPlatform != null)
    command.add('-Ptarget-platform=${getNameForTargetPlatform(buildInfo.targetPlatform)}');
  command.add(assembleTask);

  bool potentialAndroidXFailure = false;
  //运行组装了一串参数的gradle命令
  final int exitCode = await runCommandAndStreamOutput(
    command,
    workingDirectory: flutterProject.android.hostAppGradleRoot.path,
    allowReentrantFlutter: true,
    environment: _gradleEnv,
    ...
  );
  status.stop();

  if (!isBuildingBundle) {
    //获取apk文件
    final File apkFile = _findApkFile(project, buildInfo);
    //将APK复制到app.apk，以便`flutter run`, `flutter install`这些命令能找到
    apkFile.copySync(project.apkDirectory.childFile('app.apk').path);

    final File apkShaFile = project.apkDirectory.childFile('app.apk.sha1');
    apkShaFile.writeAsStringSync(calculateSha(apkFile));
    ...
  } else {
    ...
  }
}
```

构建过程主要是调用gradle命令，如下所示

#### 3.4.1 gradle命令与参数说明

gradlew命令：

gradlew -Ptarget=lib/main.dart -Ptrack-widget-creation=false -Ptarget-platform=android-arm assembleRelease


|参数|说明|
|---|---|
|PlocalEngineOut|引擎产物|
|Ptarget|取值lib/main.dart|
|Ptrack-widget-creation|默认为false|
|Pcompilation-trace-file||
|Ppatch||
|Pextra-front-end-options||
|Pextra-gen-snapshot-options||
|Pfilesystem-roots||
|Pfilesystem-scheme||
|Pbuild-shared-library|是否采取共享库|
|Ptarget-platform|目标平台|

### 3.5 flutter的gradle构建

gradlew assembleRelease这便是Anroid平台比较常见的编译命令。 会执行build.gradle文件，里面有一行重要的语句，如下所示。

```
apply from: "$flutterRoot/packages/flutter_tools/gradle/flutter.gradle"
```

#### 3.5.1 flutter.gradle
[-> gradle/flutter.gradle]

```
CopySpec getAssets() {
    return project.copySpec {
        from "${intermediateDir}"

        include "flutter_assets/**" // the working dir and its files

        if (buildMode == 'release' || buildMode == 'profile') {
            if (buildSharedLibrary) {
                include "app.so"
            } else {
                include "vm_snapshot_data"
                include "vm_snapshot_instr"
                include "isolate_snapshot_data"
                include "isolate_snapshot_instr"
            }
        }
    }
}
```

可知flutter产物可以是app.so或者是xxx_snapshot_xxx。

#### 3.5.2 buildBundle
[-> gradle/flutter.gradle]

```Java
void buildBundle() {
    intermediateDir.mkdirs()

    if (buildMode == "profile" || buildMode == "release") {
        //执行flutter build aot
        project.exec {
            executable flutterExecutable.absolutePath
            workingDir sourceDir
            if (localEngine != null) {
                args "--local-engine", localEngine
                args "--local-engine-src-path", localEngineSrcPath
            }
            args "build", "aot"
            args "--suppress-analytics"
            args "--quiet"
            args "--target", targetPath
            args "--target-platform", "android-arm"
            args "--output-dir", "${intermediateDir}"
            if (trackWidgetCreation) {
                args "--track-widget-creation"
            }
            if (extraFrontEndOptions != null) {
                args "--extra-front-end-options", "${extraFrontEndOptions}"
            }
            if (extraGenSnapshotOptions != null) {
                args "--extra-gen-snapshot-options", "${extraGenSnapshotOptions}"
            }
            if (buildSharedLibrary) {
                args "--build-shared-library"
            }
            if (targetPlatform != null) {
                args "--target-platform", "${targetPlatform}"
            }
            args "--${buildMode}"
        }
    }
    //flutter build bundle
    project.exec {
        executable flutterExecutable.absolutePath
        workingDir sourceDir
        if (localEngine != null) {
            args "--local-engine", localEngine
            args "--local-engine-src-path", localEngineSrcPath
        }
        args "build", "bundle"
        args "--suppress-analytics"
        args "--target", targetPath
        if (verbose) {
            args "--verbose"
        }
        if (fileSystemRoots != null) {
            for (root in fileSystemRoots) {
                args "--filesystem-root", root
            }
        }
        if (fileSystemScheme != null) {
            args "--filesystem-scheme", fileSystemScheme
        }
        if (trackWidgetCreation) {
            args "--track-widget-creation"
        }
        if (compilationTraceFilePath != null) {
            args "--compilation-trace-file", compilationTraceFilePath
        }
        if (createPatch) {
            args "--patch"
            args "--build-number", project.android.defaultConfig.versionCode
            if (buildNumber != null) {
                assert buildNumber == project.android.defaultConfig.versionCode
            }
        }
        if (baselineDir != null) {
            args "--baseline-dir", baselineDir
        }
        if (extraFrontEndOptions != null) {
            args "--extra-front-end-options", "${extraFrontEndOptions}"
        }
        if (extraGenSnapshotOptions != null) {
            args "--extra-gen-snapshot-options", "${extraGenSnapshotOptions}"
        }
        if (targetPlatform != null) {
            args "--target-platform", "${targetPlatform}"
        }
        if (buildMode == "release" || buildMode == "profile") {
            args "--precompiled"
        } else {
            args "--depfile", "${intermediateDir}/snapshot_blob.bin.d"
        }
        args "--asset-dir", "${intermediateDir}/flutter_assets"
        if (buildMode == "debug") {
            args "--debug"
        }
        if (buildMode == "profile" || buildMode == "dynamicProfile") {
            args "--profile"
        }
        if (buildMode == "release" || buildMode == "dynamicRelease") {
            args "--release"
        }
        if (buildMode == "dynamicProfile" || buildMode == "dynamicRelease") {
            args "--dynamic"
        }
    }
}
```

该方法核心功能是两部分：

- flutter build aot：针对profile或者release模式
- flutter build bundle

### 3.6 build apk等价命令

build apk的过程主要分为以下两个过程，也就是[小节3.4.2]的buildBundle中过程展开后的如下两个命令：

```Java
flutter build aot
  --suppress-analytics
  --quiet
  --target lib/main.dart
  --output-dir /build/app/intermediates/flutter/release/
  --target-platform android-arm
  --extra-front-end-options
  --extra-gen-snapshot-options
  --release
```

```Java
flutter build bundle
  --suppress-analytics
  --verbose  
  --target lib/main.dart
  --target-platform android-arm
  --extra-front-end-options
  --extra-gen-snapshot-options
  --asset-dir /build/app/intermediates/flutter/release/flutter_assets
  --precompiled
  --release
```

## 四、 flutter build aot命令

### 4.1 BuildAotCommand.runCommand
[-> lib/src/commands/build_aot.dart]

```Java
class BuildAotCommand extends BuildSubCommand with TargetPlatformBasedDevelopmentArtifacts {

  Future<FlutterCommandResult> runCommand() async {
    //解析目标平台
    final String targetPlatform = argResults['target-platform'];
    final TargetPlatform platform = getTargetPlatformForName(targetPlatform);
    //解析编译模式
    final BuildMode buildMode = getBuildMode();

    Status status;
    //解析aot产物路径
    final String outputPath = argResults['output-dir'] ?? getAotBuildDirectory();
    final bool reportTimings = argResults['report-timings'];
    try {
      //解析dart主函数路径
      String mainPath = findMainDartFile(targetFile);
      final AOTSnapshotter snapshotter = AOTSnapshotter(reportTimings: reportTimings);

      //编译到内核 [见小节4.2]
      mainPath = await snapshotter.compileKernel(
        platform: platform,
        buildMode: buildMode,
        mainPath: mainPath,
        packagesPath: PackageMap.globalPackagesPath,
        trackWidgetCreation: false,
        outputPath: outputPath,
        extraFrontEndOptions: argResults[FlutterOptions.kExtraFrontEndOptions],
      );

      //构建AOT快照
      if (platform == TargetPlatform.ios) {
        // iOS架构分为armv7和arm64
        final Iterable<IOSArch> buildArchs = argResults['ios-arch'].map<IOSArch>(getIOSArchForName);
        final Map<IOSArch, String> iosBuilds = <IOSArch, String>{};
        for (IOSArch arch in buildArchs)
          iosBuilds[arch] = fs.path.join(outputPath, getNameForIOSArch(arch));

        final Map<IOSArch, Future<int>> exitCodes = <IOSArch, Future<int>>{};
        iosBuilds.forEach((IOSArch iosArch, String outputPath) {
          //生成AOT快照 并编译为特定架构的App.framework [见小节4.4]
          exitCodes[iosArch] = snapshotter.build(
            platform: platform,
            iosArch: iosArch,
            buildMode: buildMode,
            mainPath: mainPath,
            packagesPath: PackageMap.globalPackagesPath,
            outputPath: outputPath,
            buildSharedLibrary: false,
            extraGenSnapshotOptions: argResults[FlutterOptions.kExtraGenSnapshotOptions],
          ).then<int>((int buildExitCode) {
            return buildExitCode;
          });
        });

        //将特定于架构的App.frameworks合并到一个多架构的App.framework中
        if ((await Future.wait<int>(exitCodes.values)).every((int buildExitCode) => buildExitCode == 0)) {
          final Iterable<String> dylibs = iosBuilds.values.map<String>((String outputDir) => fs.path.join(outputDir, 'App.framework', 'App'));
          fs.directory(fs.path.join(outputPath, 'App.framework'))..createSync();
          await runCheckedAsync(<String>['lipo']
            ..addAll(dylibs)
            ..addAll(<String>['-create', '-output', fs.path.join(outputPath, 'App.framework', 'App')]),
          );
        } else {
          status?.cancel();
          exitCodes.forEach((IOSArch iosArch, Future<int> exitCodeFuture) async {
            final int buildExitCode = await exitCodeFuture;
            printError('Snapshotting ($iosArch) exited with non-zero exit code: $buildExitCode');
          });
        }
      } else {
        // Android AOT快照 [见小节4.4]
        final int snapshotExitCode = await snapshotter.build(
          platform: platform,
          buildMode: buildMode,
          mainPath: mainPath,
          packagesPath: PackageMap.globalPackagesPath,
          outputPath: outputPath,
          buildSharedLibrary: argResults['build-shared-library'],
          extraGenSnapshotOptions: argResults[FlutterOptions.kExtraGenSnapshotOptions],
        );
      }
    } on String catch (error) {
      ...
    }
    ...
    return null;
  }
}
```

该方法主要功能：

- 生成kernel文件， 这是dart定义的一种特殊数据格式，由dart虚拟机解释模式执行；
- 生成AOT可执行文件，根据kernel来生成的一种二进制机器码，执行速度更快；release模式打进apk的便是机器码；

#### 4.2.1 build aot参数说明
该过程参数说明：

- -output-dir：指定aot产物输出路径，缺省默认等于“build/aot”；
- -target：指定应用的主函数，缺省默认等于“lib/main.dart”；
- -target-platform：指定目标平台，可取值有android-arm，android-arm64，android-x64, android-x86，ios， darwin-linux_x64， linux-x64，web；
- -ios-arch：指定ios架构类型，可取值有arm64，armv7，仅用于iOS；
- -build-shared-library：指定是否构建共享库，仅用于Android；iOS强制为false；
- -release：指定编译模式，可取值有debug, profile, release, dynamicProfile, dynamicRelease；
- -extra-front-end-options：指定用于编译kernel的可选参数
- –extra-gen-snapshot-options：指定用于构建AOT快照的可选参数

也就是说执行flutter build aot必须指定的参数是target-platform和release参数。

### 4.2 compileKernel
[-> lib/src/base/build.dart]

```Java
class AOTSnapshotter {

  Future<String> compileKernel({
    @required TargetPlatform platform,
    @required BuildMode buildMode,
    @required String mainPath,
    @required String packagesPath,
    @required String outputPath,
    @required bool trackWidgetCreation,
    List<String> extraFrontEndOptions = const <String>[],
  }) async {
    final FlutterProject flutterProject = await FlutterProject.current();
    final Directory outputDir = fs.directory(outputPath);
    outputDir.createSync(recursive: true);
    //路径为 build/aot/kernel_compile.d
    final String depfilePath = fs.path.join(outputPath, 'kernel_compile.d');
    final KernelCompiler kernelCompiler = await kernelCompilerFactory.create(flutterProject);
    final CompilerOutput compilerOutput = await _timedStep('frontend',
      //[见小节4.3]
      () => kernelCompiler.compile(
      sdkRoot: artifacts.getArtifactPath(Artifact.flutterPatchedSdkPath, mode: buildMode),
      mainPath: mainPath,
      packagesPath: packagesPath,
      outputFilePath: getKernelPathForTransformerOptions(
        fs.path.join(outputPath, 'app.dill'),
        trackWidgetCreation: trackWidgetCreation,
      ),
      depFilePath: depfilePath,
      extraFrontEndOptions: extraFrontEndOptions,
      linkPlatformKernelIn: true,
      aot: true,
      trackWidgetCreation: trackWidgetCreation,
      targetProductVm: buildMode == BuildMode.release,
    ));

    //将路径写入frontend_server，因为当更改时需要重新生成
    final String frontendPath = artifacts.getArtifactPath(Artifact.frontendServerSnapshotForEngineDartSdk);
    await fs.directory(outputPath).childFile('frontend_server.d').writeAsString('frontend_server.d: $frontendPath\n');
    return compilerOutput?.outputFilename;
  }
}
```


### 4.3 KernelCompiler.compile
[-> lib/src/compile.dart]

```Java
class KernelCompiler {

  Future<CompilerOutput> compile({
    String sdkRoot,
    String mainPath,
    String outputFilePath,
    String depFilePath,
    TargetModel targetModel = TargetModel.flutter,
    bool linkPlatformKernelIn = false,
    bool aot = false,
    @required bool trackWidgetCreation,
    List<String> extraFrontEndOptions,
    String incrementalCompilerByteStorePath,
    String packagesPath,
    List<String> fileSystemRoots,
    String fileSystemScheme,
    bool targetProductVm = false,
    String initializeFromDill,
  }) async {
    final String frontendServer = artifacts.getArtifactPath(
      Artifact.frontendServerSnapshotForEngineDartSdk
    );
    FlutterProject flutterProject;
    if (fs.file('pubspec.yaml').existsSync()) {
      flutterProject = await FlutterProject.current();
    }

    Fingerprinter fingerprinter;
    if (depFilePath != null) {
      fingerprinter = Fingerprinter(
        fingerprintPath: '$depFilePath.fingerprint',
        paths: <String>[mainPath],
        properties: <String, String>{
          'entryPoint': mainPath,
          'trackWidgetCreation': trackWidgetCreation.toString(),
          'linkPlatformKernelIn': linkPlatformKernelIn.toString(),
          'engineHash': Cache.instance.engineRevision,
          'buildersUsed': '${flutterProject != null ? flutterProject.hasBuilders : false}',
        },
        depfilePaths: <String>[depFilePath],
        pathFilter: (String path) => !path.startsWith('/b/build/slave/'),
      );

    }
    //获取dart命令路径
    final String engineDartPath = artifacts.getArtifactPath(Artifact.engineDartBinary);

    }
    final List<String> command = <String>[
      engineDartPath,
      frontendServer,
      '--sdk-root',
      sdkRoot,
      '--strong',
      '--target=$targetModel',
    ];
    if (trackWidgetCreation)
      command.add('--track-widget-creation');
    if (!linkPlatformKernelIn)
      command.add('--no-link-platform');
    if (aot) {
      command.add('--aot');
      command.add('--tfa');
    }
    if (targetProductVm) {
      command.add('-Ddart.vm.product=true');
    }
    if (incrementalCompilerByteStorePath != null) {
      command.add('--incremental');
    }
    Uri mainUri;
    if (packagesPath != null) {
      command.addAll(<String>['--packages', packagesPath]);
      mainUri = PackageUriMapper.findUri(mainPath, packagesPath, fileSystemScheme, fileSystemRoots);
    }
    if (outputFilePath != null) {
      command.addAll(<String>['--output-dill', outputFilePath]);
    }
    if (depFilePath != null && (fileSystemRoots == null || fileSystemRoots.isEmpty)) {
      command.addAll(<String>['--depfile', depFilePath]);
    }
    if (fileSystemRoots != null) {
      for (String root in fileSystemRoots) {
        command.addAll(<String>['--filesystem-root', root]);
      }
    }
    if (fileSystemScheme != null) {
      command.addAll(<String>['--filesystem-scheme', fileSystemScheme]);
    }
    if (initializeFromDill != null) {
      command.addAll(<String>['--initialize-from-dill', initializeFromDill]);
    }

    if (extraFrontEndOptions != null)
      command.addAll(extraFrontEndOptions);

    command.add(mainUri?.toString() ?? mainPath);
    ...
    //执行命令 [见小节4.3.1]
    await processManager.start(command);
    await fingerprinter.writeFingerprint();
    ...
  }
}
```


#### 4.3.1 frontend_server命令
KernelCompiler.compile()过程等价于如下命令：

```Java
flutter/bin/cache/dart-sdk/bin/dart
  flutter/bin/cache/artifacts/engine/darwin-x64/frontend_server.dart.snapshot
  --sdk-root flutter/bin/cache/artifacts/engine/common/flutter_patched_sdk_product/
  --strong
  --target=flutter
  --aot --tfa
  -Ddart.vm.product=true
  --packages .packages
  --output-dill build/app/intermediates/flutter/release/app.dill
  --depfile     build/app/intermediates/flutter/release/kernel_compile.d
  package:flutter_app/main.dart
```

可见，通过dart虚拟机启动frontend_server.dart.snapshot，将dart代码编程成app.dill形式的kernel文件。frontend_server.dart.snapshot的入口位于Flutter引擎中的
flutter/frontend_server/bin/starter.dart。

关于这个过程的kernel编译以及文件的生成过程，将在下一篇文章将进一步展开说明。

再回到[小节4.1]，接下来执行AOTSnapshotter.build()方法。

### 4.4 AOTSnapshotter.build
[-> lib/src/base/build.dart]

```Java
class AOTSnapshotter {

  Future<int> build({
    @required TargetPlatform platform,
    @required BuildMode buildMode,
    @required String mainPath,
    @required String packagesPath,
    @required String outputPath,
    @required bool buildSharedLibrary,
    IOSArch iosArch,
    List<String> extraGenSnapshotOptions = const <String>[],
  }) async {
    FlutterProject flutterProject;
    if (fs.file('pubspec.yaml').existsSync()) {
      flutterProject = await FlutterProject.current();
    }
    //非debug模式下的android arm/arm64或者ios才支持aot
    if (!_isValidAotPlatform(platform, buildMode)) {
      return 1;
    }

    //iOS忽略共享库
    if (platform == TargetPlatform.ios)
      buildSharedLibrary = false;

    final PackageMap packageMap = PackageMap(packagesPath);

    final Directory outputDir = fs.directory(outputPath);
    outputDir.createSync(recursive: true);

    final String skyEnginePkg = _getPackagePath(packageMap, 'sky_engine');
    final String uiPath = fs.path.join(skyEnginePkg, 'lib', 'ui', 'ui.dart');
    final String vmServicePath = fs.path.join(skyEnginePkg, 'sdk_ext', 'vmservice_io.dart');

    final List<String> inputPaths = <String>[uiPath, vmServicePath, mainPath];
    final Set<String> outputPaths = <String>{};

    final String depfilePath = fs.path.join(outputDir.path, 'snapshot.d');
    final List<String> genSnapshotArgs = <String>['--deterministic',];
    if (extraGenSnapshotOptions != null && extraGenSnapshotOptions.isNotEmpty) {
      genSnapshotArgs.addAll(extraGenSnapshotOptions);
    }

    final String assembly = fs.path.join(outputDir.path, 'snapshot_assembly.S');
    if (buildSharedLibrary || platform == TargetPlatform.ios) {
      // Assembly AOT snapshot.
      outputPaths.add(assembly);
      genSnapshotArgs.add('--snapshot_kind=app-aot-assembly');
      genSnapshotArgs.add('--assembly=$assembly');
    } else {
      // Blob AOT snapshot.
      final String vmSnapshotData = fs.path.join(outputDir.path, 'vm_snapshot_data');
      final String isolateSnapshotData = fs.path.join(outputDir.path, 'isolate_snapshot_data');
      final String vmSnapshotInstructions = fs.path.join(outputDir.path, 'vm_snapshot_instr');
      final String isolateSnapshotInstructions = fs.path.join(outputDir.path, 'isolate_snapshot_instr');
      outputPaths.addAll(<String>[vmSnapshotData, isolateSnapshotData, vmSnapshotInstructions, isolateSnapshotInstructions]);
      genSnapshotArgs.addAll(<String>[
        '--snapshot_kind=app-aot-blobs',
        '--vm_snapshot_data=$vmSnapshotData',
        '--isolate_snapshot_data=$isolateSnapshotData',
        '--vm_snapshot_instructions=$vmSnapshotInstructions',
        '--isolate_snapshot_instructions=$isolateSnapshotInstructions',
      ]);
    }

    if (platform == TargetPlatform.android_arm || iosArch == IOSArch.armv7) {
      //将softfp用于Android armv7设备。这是armv7 iOS构建的默认设置
      genSnapshotArgs.add('--no-sim-use-hardfp');
      // Pixel不支持32位模式
      genSnapshotArgs.add('--no-use-integer-division');
    }
    genSnapshotArgs.add(mainPath);

    final Fingerprinter fingerprinter = Fingerprinter(
      fingerprintPath: '$depfilePath.fingerprint',
      paths: <String>[mainPath]..addAll(inputPaths)..addAll(outputPaths),
      properties: <String, String>{
        'buildMode': buildMode.toString(),
        'targetPlatform': platform.toString(),
        'entryPoint': mainPath,
        'sharedLib': buildSharedLibrary.toString(),
        'extraGenSnapshotOptions': extraGenSnapshotOptions.join(' '),
        'engineHash': Cache.instance.engineRevision,
        'buildersUsed': '${flutterProject != null ? flutterProject.hasBuilders : false}',
      },
      depfilePaths: <String>[],
    );
    //自从上次运行以来，输入和输出都没有更改，则跳过该构建流程
    if (await fingerprinter.doesFingerprintMatch()) {
      return 0;
    }

    final SnapshotType snapshotType = SnapshotType(platform, buildMode);
    //[见小节4.5]
    final int genSnapshotExitCode = await _timedStep('gen_snapshot',
      () => genSnapshot.run(
        snapshotType: snapshotType,
        additionalArgs: genSnapshotArgs,
        iosArch: iosArch,
    ));

    // 将路径写入gen_snapshot，因为在滚动Dart SDK时必须重新生成快照
    final String genSnapshotPath = GenSnapshot.getSnapshotterPath(snapshotType);
    await outputDir.childFile('gen_snapshot.d').writeAsString('gen_snapshot.d: $genSnapshotPath\n');

    //在iOS上，使用Xcode将snapshot编译到动态库中，最终可见将其链接到应用程序。
    if (platform == TargetPlatform.ios) {
      final RunResult result = await _buildIosFramework(iosArch: iosArch, assemblyPath: assembly, outputPath: outputDir.path);
    } else if (buildSharedLibrary) {
      final RunResult result = await _buildAndroidSharedLibrary(assemblyPath: assembly, outputPath: outputDir.path);
    }

    //计算和记录构建指纹
    await fingerprinter.writeFingerprint();
    return 0;
  }
}
```

该方法说明：

- 对于iOS或者采用共享库方式的Android，则产物类型snapshot_kind为app-aot-assembly
  - 对于Android，则生成app.so
- 对于非共享库方式的Android，则产物类型snapshot_kind为app-aot-blobs
  - 生成vmSnapshotData，isolateSnapshotData，vmSnapshotInstructions，isolateSnapshotInstructions这四个产物


### 4.5 GenSnapshot.run
[-> lib/src/base/build.dart]

```Java
class GenSnapshot {

  Future<int> run({
    @required SnapshotType snapshotType,
    IOSArch iosArch,
    Iterable<String> additionalArgs = const <String>[],
  }) {
    final List<String> args = <String>[
      '--causal_async_stacks',
    ]..addAll(additionalArgs);
    //获取gen_snapshot命令的路径
    final String snapshotterPath = getSnapshotterPath(snapshotType);

    //iOS gen_snapshot是一个多体系结构二进制文件。 作为i386二进制文件运行将生成armv7代码。 作为x86_64二进制文件运行将生成arm64代码。
    // /usr/bin/arch可用于运行具有指定体系结构的二进制文件
    if (snapshotType.platform == TargetPlatform.ios) {
      final String hostArch = iosArch == IOSArch.armv7 ? '-i386' : '-x86_64';
      return runCommandAndStreamOutput(<String>['/usr/bin/arch', hostArch, snapshotterPath]..addAll(args));
    }
    return runCommandAndStreamOutput(<String>[snapshotterPath]..addAll(args));
  }
}
```

runCommandAndStreamOutput便会执行如下这一串命令：

#### 4.5.1 GenSnapshot命令

GenSnapshot.run具体命令根据前面的封装，最终等价于：

```Java
// 这是针对Android的genSnapshot命令
flutter/bin/cache/artifacts/engine/android-arm-release/darwin-x64/gen_snapshot
  --causal_async_stacks
  --deterministic
  --snapshot_kind=app-aot-blobs
  --vm_snapshot_data=build/app/intermediates/flutter/release/vm_snapshot_data
  --isolate_snapshot_data=build/app/intermediates/flutter/release/isolate_snapshot_data
  --vm_snapshot_instructions=build/app/intermediates/flutter/release/vm_snapshot_instr
  --isolate_snapshot_instructions=build/app/intermediates/flutter/release/isolate_snapshot_instr
  --no-sim-use-hardfp
  --no-use-integer-division
  build/aot/app.dill
```

```Java
//这是针对iOS的genSnapshot命令
/usr/bin/arch -x86_64 flutter/bin/cache/artifacts/engine/ios-release/gen_snapshot
  --causal_async_stacks
  --deterministic
  --snapshot_kind=app-aot-assembly
  --assembly=build/aot/arm64/snapshot_assembly.S
  build/aot/app.dill
```

此处gen_snapshot是一个二进制可执行文件，所对应的执行方法源码为third_party/dart/runtime/bin/gen_snapshot.cc，将在下一篇文章将进一步展开说明。


## 五、flutter build bundle命令

### 5.1 BuildBundleCommand.runCommand
[-> lib/src/commands/build_bundle.dart]

```Java
class BuildBundleCommand extends BuildSubCommand {
  Future<FlutterCommandResult> runCommand() async {
    final String targetPlatform = argResults['target-platform'];
    final TargetPlatform platform = getTargetPlatformForName(targetPlatform);
    final BuildMode buildMode = getBuildMode();

    final String buildNumber = argResults['build-number'] != null ? argResults['build-number'] : null;
    //[见小节5.2]
    await build(
      platform: platform,
      buildMode: buildMode,
      mainPath: targetFile,
      manifestPath: argResults['manifest'],
      depfilePath: argResults['depfile'],
      privateKeyPath: argResults['private-key'],
      assetDirPath: argResults['asset-dir'],
      precompiledSnapshot: argResults['precompiled'],
      reportLicensedPackages: argResults['report-licensed-packages'],
      trackWidgetCreation: argResults['track-widget-creation'],
      compilationTraceFilePath: argResults['compilation-trace-file'],
      createPatch: argResults['patch'],
      buildNumber: buildNumber,
      baselineDir: argResults['baseline-dir'],
      extraFrontEndOptions: argResults[FlutterOptions.kExtraFrontEndOptions],
      extraGenSnapshotOptions: argResults[FlutterOptions.kExtraGenSnapshotOptions],
      fileSystemScheme: argResults['filesystem-scheme'],
      fileSystemRoots: argResults['filesystem-root'],
    );
    return null;
  }
}
```

### 5.2 build
[-> lib/src/bundle.dart]

```Java
Future<void> build(...) async {
  ...
  final AssetBundle assets = await buildAssets(
    manifestPath: manifestPath,
    assetDirPath: assetDirPath,
    packagesPath: packagesPath,
    reportLicensedPackages: reportLicensedPackages,
  );

  if (!precompiledSnapshot) {
    ... //relase模式，参数中会带上--precompiled，则不会编译kernel文件
  }

  //[见小节5.3]
  await assemble(
    buildMode: buildMode,
    assetBundle: assets,
    kernelContent: kernelContent,
    privateKeyPath: privateKeyPath,
    assetDirPath: assetDirPath,
    compilationTraceFilePath: compilationTraceFilePath,
  );
}
```



### 5.3 assemble
[-> lib/src/bundle.dart]

```Java
Future<void> assemble({
  BuildMode buildMode,
  AssetBundle assetBundle,
  DevFSContent kernelContent,
  String privateKeyPath = defaultPrivateKeyPath,
  String assetDirPath,
  String compilationTraceFilePath,
}) async {
  // 目录 build/flutter_assets/
  assetDirPath ??= getAssetBuildDirectory();

  final Map<String, DevFSContent> assetEntries = Map<String, DevFSContent>.from(assetBundle.entries);
  if (kernelContent != null) {
    if (compilationTraceFilePath != null) {
      final String vmSnapshotData = artifacts.getArtifactPath(Artifact.vmSnapshotData, mode: buildMode);
      final String isolateSnapshotData = fs.path.join(getBuildDirectory(), _kIsolateSnapshotData);
      final String isolateSnapshotInstr = fs.path.join(getBuildDirectory(), _kIsolateSnapshotInstr);
      assetEntries[_kVMSnapshotData] = DevFSFileContent(fs.file(vmSnapshotData));
      assetEntries[_kIsolateSnapshotData] = DevFSFileContent(fs.file(isolateSnapshotData));
      assetEntries[_kIsolateSnapshotInstr] = DevFSFileContent(fs.file(isolateSnapshotInstr));
    } else {
      final String vmSnapshotData = artifacts.getArtifactPath(Artifact.vmSnapshotData, mode: buildMode);
      final String isolateSnapshotData = artifacts.getArtifactPath(Artifact.isolateSnapshotData, mode: buildMode);
      assetEntries[_kKernelKey] = kernelContent;
      assetEntries[_kVMSnapshotData] = DevFSFileContent(fs.file(vmSnapshotData));
      assetEntries[_kIsolateSnapshotData] = DevFSFileContent(fs.file(isolateSnapshotData));
    }
  }
  ensureDirectoryExists(assetDirPath);
  //[见小节5.4]
  await writeBundle(fs.directory(assetDirPath), assetEntries);
}
```

### 5.4 writeBundle
[-> lib/src/bundle.dart]

```Java
Future<void> writeBundle(
  Directory bundleDir,
  Map<String, DevFSContent> assetEntries,
) async {
  if (bundleDir.existsSync())
    bundleDir.deleteSync(recursive: true);
  bundleDir.createSync(recursive: true);

  await Future.wait<void>(
    assetEntries.entries.map<Future<void>>((MapEntry<String, DevFSContent> entry) async {
      final File file = fs.file(fs.path.join(bundleDir.path, entry.key));
      file.parent.createSync(recursive: true);
      await file.writeAsBytes(await entry.value.contentsAsBytes());
    }));
}
```

将一些文件放进了build/app/intermediates/flutter/release/flutter_assets目录下。

- AssetManifest.json
- FontManifest.json
- LICENSE
- fonts/MaterialIcons-Regular.ttf
- packages/cupertino_icons/assets/CupertinoIcons.ttf


## 六、flutter install命令

### 6.1 InstallCommand.runCommand
[-> lib/src/commands/install.dart]

```Java
class InstallCommand extends FlutterCommand with DeviceBasedDevelopmentArtifacts {
  Future<FlutterCommandResult> runCommand() async {
    final ApplicationPackage package = await applicationPackages.getPackageForPlatform(await device.targetPlatform);

    Cache.releaseLockEarly();
    //[见小节6.2]
    if (!await installApp(device, package))
      throwToolExit('Install failed');

    return null;
  }
}
```

### 6.2 installApp
[-> lib/src/commands/install.dart]

```Java
Future<bool> installApp(Device device, ApplicationPackage package, { bool uninstall = true }) async {
  //当app已存在，则先卸载老的apk，再安装新的apk
  if (uninstall && await device.isAppInstalled(package)) {
    if (!await device.uninstallApp(package))
      printError('Warning: uninstalling old version failed');
  }

  return device.installApp(package);
}
```

### 6.3 AndroidDevice.installApp
[-> lib/src/android/android_device.dart]

```Java
Future<bool> installApp(ApplicationPackage app) async {
  final AndroidApk apk = app;
  ...
  //执行的命令是adb install -t -r [apk_path]来安装APK
  final RunResult installResult = await runAsync(adbCommandForDevice(<String>['install', '-t', '-r', apk.file.path]));
  status.stop();
  //执行完安装命令，会再通过检查日志来判断是非安装成功
  ...
  return true;
}
```

执行的命令是adb install -t -r [apk_path]来安装APK


## 七、总结

#### 7.1 flutter run架构图

[点击查看大图](/img/flutter_command/flutterRun.jpg)

![flutterRun](/img/flutter_command/flutterRun.jpg)

图解：

flutter命令的整个过程位于目录flutter/packages/flutter_tools/，对于flutter run命令核心功能包括以下几部分：

- 通过gradle来构建APK，即等价于flutter build apk，由以下两部分组成：
  - flutter build aot，分为如下两个核心过程，该过程详情见下一篇文章
    - frontend_server前端编译器生成kernel文件
    - gen_snapshot来编译成AOT产物
  - flutter build bundle，将相关文件放入flutter_assets目录
- 通过adb install来安装APK
- 通过adb am start来启动应用

这个过程涉及多个flutter命令，其包含关系如下所示：

![flutterRun](/img/flutter_command/flutter_run_3.jpg)


#### 7.2 flutter run参数

对于flutter 1.5及以上的版本，抓取timeline报错的情况下，可采用以下两个方案之一：

方案1：flutter run --disable-service-auth-codes

根据前面的知识，可知该方案每次都要重新build，install，然后再am start应用，对于手机中已经安装的应用可直接通过am start来快速启动应用，关于am start过程有很多debuggingOptions可选的调试参数，如下所示：

|flags|含义|
|---|---|
|trace-startup|跟踪启动|
|route||
|enable-software-rendering|开启软件渲染|
|skia-deterministic-rendering||
|trace-skia|跟踪skia|
|trace-systrace|跟进systrace|
|dump-skp-on-shader-compilation||
|enable-checked-mode||
|verify-entry-points||
|start-paused|应用启动后暂停|
|disable-service-auth-codes|关闭observatory服务鉴权|
|use-test-fonts|使用测试字体|
|verbose-logging|输出verbose日志|

由此可见，如果你希望运行某个已经安装过的flutter应用，可以跳过安装等环节，可以直接执行应用启动，如下命令：


方案2：adb shell am start -a android.intent.action.RUN -f 0x20000000 --ez enable-background-compilation true --ez enable-dart-profiling true --ez disable-service-auth-codes true --ez trace-skia true com.gityuan.flutterdemo/.MainActivity

如果不确定该应用的activity名，可以通过以下命令获取：

```
adb shell dumpsys SurfaceFlinger --list  //方式一
adb shell dumpsys activity a -p io.flutter.demo.gallery //方式二
```

#### 7.3 gradle参数说明

|参数|说明|
|---|---|
|PlocalEngineOut|引擎产物|
|Ptarget|取值lib/main.dart|
|Ptrack-widget-creation|默认为false|
|Pcompilation-trace-file||
|Ppatch||
|Pextra-front-end-options||
|Pextra-gen-snapshot-options||
|Pfilesystem-roots||
|Pfilesystem-scheme||
|Pbuild-shared-library|是否采取共享库|
|Ptarget-platform|目标平台|

gradle参数说明会传递到build aot过程，其对应参数说明：

- -output-dir：指定aot产物输出路径，缺省默认等于“build/aot”；
- -target：指定应用的主函数，缺省默认等于“lib/main.dart”；
- -target-platform：指定目标平台，可取值有android-arm，android-arm64，android-x64, android-x86，ios， darwin-linux_x64， linux-x64，web；
- -ios-arch：指定ios架构类型，可取值有arm64，armv7，仅用于iOS；
- -build-shared-library：指定是否构建共享库，仅用于Android；iOS强制为false；
- -release：指定编译模式，可取值有debug, profile, release, dynamicProfile, dynamicRelease；
- -extra-front-end-options：指定用于编译kernel的可选参数
- –extra-gen-snapshot-options：指定用于构建AOT快照的可选参数

#### 7.4 Android AOT产物生成命令

```Java
// build aot命令
flutter/bin/flutter build aot
  --suppress-analytics
  --quiet
  --target lib/main.dart
  --output-dir /build/app/intermediates/flutter/release/
  --target-platform android-arm
  --extra-front-end-options
  --extra-gen-snapshot-options
  --release
```

```Java
//frontend_server命令
flutter/bin/cache/dart-sdk/bin/dart
  flutter/bin/cache/artifacts/engine/darwin-x64/frontend_server.dart.snapshot
  --sdk-root flutter/bin/cache/artifacts/engine/common/flutter_patched_sdk_product/
  --strong
  --target=flutter
  --aot --tfa
  -Ddart.vm.product=true
  --packages .packages
  --output-dill build/app/intermediates/flutter/release/app.dill
  --depfile     build/app/intermediates/flutter/release/kernel_compile.d
  package:flutter_app/main.dart
```

```Java
//gen_snapshot命令
flutter/bin/cache/artifacts/engine/android-arm-release/darwin-x64/gen_snapshot
  --causal_async_stacks
  --deterministic
  --snapshot_kind=app-aot-blobs
  --vm_snapshot_data=build/app/intermediates/flutter/release/vm_snapshot_data
  --isolate_snapshot_data=build/app/intermediates/flutter/release/isolate_snapshot_data
  --vm_snapshot_instructions=build/app/intermediates/flutter/release/vm_snapshot_instr
  --isolate_snapshot_instructions=build/app/intermediates/flutter/release/isolate_snapshot_instr
  --no-sim-use-hardfp
  --no-use-integer-division
  build/aot/app.dill
```

可见Android的AOT产物都位于/build/app/intermediates/flutter/release/目录。

#### 7.4  iOS AOT产物生成命令

```Java
// build aot命令
flutter/bin/flutter build aot
  --suppress-analytics
  --target=lib/main.dart
  --output-dir=build/aot
  --target-platform=ios
  --ios-arch=armv7,arm64
  --release
```


```Java
//frontend_server命令
flutter/bin/cache/dart-sdk/bin/dart
  flutter/bin/cache/artifacts/engine/darwin-x64/frontend_server.dart.snapshot
  --sdk-root flutter/bin/cache/artifacts/engine/common/flutter_patched_sdk_product/
  --strong
  --target=flutter
  --aot --tfa
  -Ddart.vm.product=true
  --packages .packages
  --output-dill build/aot/app.dill
  --depfile     build/aot/kernel_compile.d
  package:flutter_app/main.dart
```


```Java
//gen_snapshot命令
/usr/bin/arch -x86_64 flutter/bin/cache/artifacts/engine/ios-release/gen_snapshot
  --causal_async_stacks
  --deterministic
  --snapshot_kind=app-aot-assembly
  --assembly=build/aot/arm64/snapshot_assembly.S
  build/aot/app.dill
```

可见，iOS的产物都位于build/aot目录

## 附录
flutter/packages/flutter_tools/

```Java
lib/src/commands/run.dart
lib/src/commands/build_apk.dart
lib/src/commands/build_aot.dart
lib/src/commands/build_bundle.dart
lib/src/commands/install.dart

lib/src/ios/devices.dart
lib/src/android/android_device.dart
lib/src/android/apk.dart
lib/src/android/gradle.dart

lib/src/base/build.dart
lib/src/bundle.dart
lib/src/compile.dart
lib/src/run_hot.dart
lib/src/resident_runner.dart
```
