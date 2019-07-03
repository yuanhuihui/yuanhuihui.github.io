
flutter_tools工程下面


## 启动
http://witgao.com/2018/11/04/flutter/Flutter%E6%B7%B1%E5%85%A5%E4%B9%8Bflutter-run%E5%91%BD%E4%BB%A4%E7%A9%B6%E7%AB%9F%E5%81%9A%E4%BA%86%E4%BB%80%E4%B9%88/

1. flutter run


```
DART="$DART_SDK_PATH/bin/dart"
FLUTTER_TOOLS_DIR="$FLUTTER_ROOT/packages/flutter_tools"
SNAPSHOT_PATH="$FLUTTER_ROOT/bin/cache/flutter_tools.snapshot"

"$DART" $FLUTTER_TOOL_ARGS "$SNAPSHOT_PATH" "$@"
```

2. dart flutter_tools.snapshot run

3. dart packages/flutter_tools/bin/flutter_tools_dart run

4. flutter_tools工程里的main方法

[-> flutter/packages/flutter_tools/bin/flutter_tools.dart]


## 核心逻辑

### startApp

[-> lib/src/android/android_device.dart]

```Java
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
  if (!await _checkForSupportedAdbVersion() || !await _checkForSupportedAndroidVersion())
    return LaunchResult.failed();

  final TargetPlatform devicePlatform = await targetPlatform;
  if (!(devicePlatform == TargetPlatform.android_arm ||
        devicePlatform == TargetPlatform.android_arm64) &&
      !(debuggingOptions.buildInfo.isDebug ||
        debuggingOptions.buildInfo.isDynamic)) {
    printError('Profile and release builds are only supported on ARM targets.');
    return LaunchResult.failed();
  }

  BuildInfo buildInfo = debuggingOptions.buildInfo;
  if (buildInfo.targetPlatform == null && devicePlatform == TargetPlatform.android_arm64)
    buildInfo = buildInfo.withTargetPlatform(TargetPlatform.android_arm);

  if (!prebuiltApplication || androidSdk.licensesAvailable && androidSdk.latestVersion == null) {
    printTrace('Building APK');
    final FlutterProject project = await FlutterProject.current();
    await buildApk(
        project: project,
        target: mainPath,
        buildInfo: buildInfo,
    );
    // Package has been built, so we can get the updated application ID and
    // activity name from the .apk.
    package = await AndroidApk.fromAndroidProject(project.android);
  }

  await stopApp(package);

  if (!await _installLatestApp(package))
    return LaunchResult.failed();

  final bool traceStartup = platformArgs['trace-startup'] ?? false;
  final AndroidApk apk = package;
  printTrace('$this startApp');

  ProtocolDiscovery observatoryDiscovery;

  if (debuggingOptions.debuggingEnabled) {
    observatoryDiscovery = ProtocolDiscovery.observatory(
      getLogReader(),
      portForwarder: portForwarder,
      hostPort: debuggingOptions.observatoryPort,
      ipv6: ipv6,
    );
  }

  List<String> cmd;

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
  // This invocation returns 0 even when it fails.
  if (result.contains('Error: ')) {
    printError(result.trim(), wrap: false);
    return LaunchResult.failed();
  }

  if (!debuggingOptions.debuggingEnabled)
    return LaunchResult.succeeded();

  // Wait for the service protocol port here. This will complete once the
  // device has printed "Observatory is listening on...".
  printTrace('Waiting for observatory port to be available...');

  // TODO(danrubel): Waiting for observatory services can be made common across all devices.
  try {
    Uri observatoryUri;

    if (debuggingOptions.buildInfo.isDebug || debuggingOptions.buildInfo.isProfile) {
      observatoryUri = await observatoryDiscovery.uri;
    }

    return LaunchResult.succeeded(observatoryUri: observatoryUri);
  } catch (error) {
    printError('Error waiting for a debug connection: $error');
    return LaunchResult.failed();
  } finally {
    await observatoryDiscovery.cancel();
  }
}
```
