---
layout: post
title:  "Flutter渲染机制探索"
date:   2019-06-07 21:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5的源码剖析， 分析flutter渲染机制，相关源码：

    widgets/framework.dart
    widgets/binding.dart
    scheduler/binding.dart

## 一、概述

StatefulElement
  ComponentElement
    Element

## 二、Widget渲染流程
当StatefulWidget的UI发生更新时，会调用setState()方法来实现UI的更新，接下来从该方法说起。

### 2.1 setState
[-> framework.dart:: StatelessWidget]

```Java
abstract class State<T extends StatefulWidget> extends Diagnosticable {
  StatefulElement _element;

  void setState(VoidCallback fn) {
    ...
    _element.markNeedsBuild();  //[见小姐2.2]
  }
}
```

这里需要注意setState()不应该在dispose()之后调用，可通过mounted属性值来判断父widget是否还包含该widget。

### 2.2 markNeedsBuild
[-> framework.dart:: Element]

```Java
abstract class Element extends DiagnosticableTree implements BuildContext {
  void markNeedsBuild() {
    if (!_active)
      return;
    if (dirty)
      return;
    _dirty = true;
    owner.scheduleBuildFor(this);   //[见小姐2.3]
  }
}
```

设置_dirty为true，

### 2.3 scheduleBuildFor
[-> framework.dart:: BuildOwner]

```Java
void scheduleBuildFor(Element element) {
  if (element._inDirtyList) {
    _dirtyElementsNeedsResorting = true;
    return;
  }
  if (!_scheduledFlushDirtyElements && onBuildScheduled != null) {
    _scheduledFlushDirtyElements = true;
    onBuildScheduled();  //[见小姐2.4]
  }
  _dirtyElements.add(element);  //记录所有的脏元素
  element._inDirtyList = true;
}
```

此处的onBuildScheduled为_handleBuildScheduled方法。

### 2.4 \_handleBuildScheduled
[-> binding.dart:: WidgetsBinding]

```Java
mixin WidgetsBinding on BindingBase, SchedulerBinding, GestureBinding, RendererBinding, SemanticsBinding {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    buildOwner.onBuildScheduled = _handleBuildScheduled;   //赋值onBuildScheduled
    ui.window.onLocaleChanged = handleLocaleChanged;
    ui.window.onAccessibilityFeaturesChanged = handleAccessibilityFeaturesChanged;
    SystemChannels.navigation.setMethodCallHandler(_handleNavigationInvocation);
    SystemChannels.system.setMessageHandler(_handleSystemMessage);
  }

  void _handleBuildScheduled() {
    ensureVisualUpdate();  //[见小姐2.5]
  }
}
```

### 2.5 ensureVisualUpdate
[-> scheduler/binding.dart:: SchedulerBinding]

```Java
mixin SchedulerBinding on BindingBase, ServicesBinding {
  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    ui.window.onBeginFrame = _handleBeginFrame;
    ui.window.onDrawFrame = _handleDrawFrame;
    SystemChannels.lifecycle.setMessageHandler(_handleLifecycleMessage);
  }

  void ensureVisualUpdate() {
    switch (schedulerPhase) {
      case SchedulerPhase.idle:
      case SchedulerPhase.postFrameCallbacks:
        scheduleFrame();  //[见小姐2.6]
        return;
      case SchedulerPhase.transientCallbacks:
      case SchedulerPhase.midFrameMicrotasks:
      case SchedulerPhase.persistentCallbacks:
        return;
    }
  }
}
```

schedulerPhase的初始值为SchedulerPhase.idle。SchedulerPhase是一个enum枚举类型，可取值为：

- idle: 没有正在处理的帧，可能正在执行的是WidgetsBinding.scheduleTask，scheduleMicrotask，Timer，事件handlers，活着其他回调等
- transientCallbacks: SchedulerBinding.handleBeginFrame过程， 处理动画状态更新
- midFrameMicrotasks: 处理transientCallbacks阶段触发的微任务（Microtasks）
- persistentCallbacks: WidgetsBinding.drawFrame和SchedulerBinding.handleDrawFrame过程，build/layout/paint流水线工作
- postFrameCallbacks: 主要是情理和计划执行下一帧的工作

### 2.6 scheduleFrame
[-> scheduler/binding.dart:: SchedulerBinding]

```Java
void scheduleFrame() {
  //只有当APP处于用户可见状态才会准备调度下一帧方法
  if (_hasScheduledFrame || !_framesEnabled)
    return;
  ui.window.scheduleFrame();  // native方法
  _hasScheduledFrame = true;
}
```

### 2.7 window.scheduleFrame
[-> lib/ui/window.dart:: Window]

```Java
void scheduleFrame() native 'Window_scheduleFrame';
```

window是Flutter引擎中跟图形相关接口打交道的核心类，这里是一个native方法

#### 2.7.1
[-> window.cc ]

```C++
void ScheduleFrame(Dart_NativeArguments args) {
  UIDartState::Current()->window()->client()->ScheduleFrame();
}
```

通过RegisterNatives()完成native方法的注册，“Window_scheduleFrame”所对应的native方法如上所示。

### 2.8

```Java
void _handleBeginFrame(Duration rawTimeStamp) {
  if (_warmUpFrame) {
    _ignoreNextEngineDrawFrame = true;
    return;
  }
  handleBeginFrame(rawTimeStamp);
}

void _handleDrawFrame() {
  if (_ignoreNextEngineDrawFrame) {
    _ignoreNextEngineDrawFrame = false;
    return;
  }
  handleDrawFrame();
}
```

### 2.9 handleBeginFrame

```Java
void handleBeginFrame(Duration rawTimeStamp) {
  Timeline.startSync('Frame', arguments: timelineWhitelistArguments);
  _firstRawTimeStampInEpoch ??= rawTimeStamp;
  _currentFrameTimeStamp = _adjustForEpoch(rawTimeStamp ?? _lastRawTimeStamp);
  if (rawTimeStamp != null)
    _lastRawTimeStamp = rawTimeStamp;

  profile(() {
    _profileFrameNumber += 1;
    _profileFrameStopwatch.reset();
    _profileFrameStopwatch.start();
  });

  assert(schedulerPhase == SchedulerPhase.idle);
  _hasScheduledFrame = false;
  try {
    Timeline.startSync('Animate', arguments: timelineWhitelistArguments);
    _schedulerPhase = SchedulerPhase.transientCallbacks;
    final Map<int, _FrameCallbackEntry> callbacks = _transientCallbacks;
    _transientCallbacks = <int, _FrameCallbackEntry>{};
    callbacks.forEach((int id, _FrameCallbackEntry callbackEntry) {
      if (!_removedIds.contains(id))
        _invokeFrameCallback(callbackEntry.callback, _currentFrameTimeStamp, callbackEntry.debugStack);
    });
    _removedIds.clear();
  } finally {
    _schedulerPhase = SchedulerPhase.midFrameMicrotasks;
  }
}
```

### 2.10 handleDrawFrame

```Java
void handleDrawFrame() {
  assert(_schedulerPhase == SchedulerPhase.midFrameMicrotasks);
  Timeline.finishSync(); // end the "Animate" phase
  try {
    // PERSISTENT FRAME CALLBACKS
    _schedulerPhase = SchedulerPhase.persistentCallbacks;
    for (FrameCallback callback in _persistentCallbacks)
      _invokeFrameCallback(callback, _currentFrameTimeStamp);

    // POST-FRAME CALLBACKS
    _schedulerPhase = SchedulerPhase.postFrameCallbacks;
    final List<FrameCallback> localPostFrameCallbacks =
        List<FrameCallback>.from(_postFrameCallbacks);
    _postFrameCallbacks.clear();
    for (FrameCallback callback in localPostFrameCallbacks)
      _invokeFrameCallback(callback, _currentFrameTimeStamp);
  } finally {
    _schedulerPhase = SchedulerPhase.idle;
    Timeline.finishSync(); // end the Frame
    profile(() {
      _profileFrameStopwatch.stop();
      _profileFramePostEvent();
    });
    _currentFrameTimeStamp = null;
  }
}
```
