---
layout: post
title:  "深入理解setState更新机制"
date:   2019-07-06 21:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5的源码剖析， 分析flutter的StatefulWidget的UI更新机制，相关源码：

    widgets/framework.dart
    widgets/binding.dart
    scheduler/binding.dart
    lib/ui/window.dart
    flutter/runtime/runtime_controller.cc

## 一、概述

对于Flutter来说，万物皆为Widget，常见的Widget子类为StatelessWidget(无状态)和StatefulWidget(有状态)；

- StatelessWidget：内部没有保存状态，界面创建后不会发生改变；
- StatefulWidget：内部有保存状态，当状态发生改变，调用setState()方法会触发StatefulWidget的UI发生更新，对于自定义继承自StatefulWidget的子类，必须要重写createState()方法。

接下来看看setState()究竟干了哪些操作。

## 二、Widget更新流程

### 2.1 setState
[-> framework.dart:: State]

```Java
abstract class State<T extends StatefulWidget> extends Diagnosticable {
  StatefulElement _element;

  void setState(VoidCallback fn) {
    ...
    _element.markNeedsBuild();  //[见小节2.2]
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
    owner.scheduleBuildFor(this);   //[见小节2.3]
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
    onBuildScheduled();  //[见小节2.4]
  }
  _dirtyElements.add(element);  //记录所有的脏元素
  element._inDirtyList = true;
}
```

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
    ensureVisualUpdate();  //[见小节2.5]
  }
}
```

在[Flutter应用启动](http://gityuan.com/2019/06/29/flutter_run_app/)过程初始化WidgetsBinding时，赋值onBuildScheduled等于_handleBuildScheduled()。


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
        scheduleFrame();  //[见小节2.6]
        return;
      case SchedulerPhase.transientCallbacks:
      case SchedulerPhase.midFrameMicrotasks:
      case SchedulerPhase.persistentCallbacks:
        return;
    }
  }
}
```

schedulerPhase的初始值为SchedulerPhase.idle。SchedulerPhase是一个enum枚举类型，有以下5个可取值：

|状态|含义|
|---|---|
|**idle**| 没有正在处理的帧，可能正在执行的是WidgetsBinding.scheduleTask，scheduleMicrotask，Timer，事件handlers，或者其他回调等|
|**transientCallbacks**| SchedulerBinding.handleBeginFrame过程， 处理动画状态更新|
|**midFrameMicrotasks**| 处理transientCallbacks阶段触发的微任务（Microtasks）|
|**persistentCallbacks**| WidgetsBinding.drawFrame和SchedulerBinding.handleDrawFrame过程，build/layout/paint流水线工作|
|**postFrameCallbacks**| 主要是清理和计划执行下一帧的工作|


### 2.6 scheduleFrame
[-> scheduler/binding.dart:: SchedulerBinding]

```Java
void scheduleFrame() {
  //只有当APP处于用户可见状态才会准备调度下一帧方法
  if (_hasScheduledFrame || !_framesEnabled)
    return;
  ui.window.scheduleFrame();  // native方法 [见小节2.7]
  _hasScheduledFrame = true;
}
```

### 2.7 scheduleFrame
[-> lib/ui/window.dart:: Window]

```Java
void scheduleFrame() native 'Window_scheduleFrame';
```

window是Flutter引擎中跟图形相关接口打交道的核心类，这里是一个native方法

#### 2.7.1 ScheduleFrame(C++)
[-> window.cc ]

```C++
void ScheduleFrame(Dart_NativeArguments args) {
  //  [见小节2.7.2]
  UIDartState::Current()->window()->client()->ScheduleFrame();
}
```

通过RegisterNatives()完成native方法的注册，“Window_scheduleFrame”所对应的native方法如上所示。

#### 2.7.2 RuntimeController::ScheduleFrame
[flutter/runtime/runtime_controller.cc]

```C++
void RuntimeController::ScheduleFrame() {
  client_.ScheduleFrame(); //  [见小节2.7.3]
}
```

#### 2.7.3 Engine::ScheduleFrame
flutter/shell/common/engine.cc

```C++
void Engine::ScheduleFrame(bool regenerate_layer_tree) {
  animator_->RequestFrame(regenerate_layer_tree);
}
```

文章[Flutter渲染机制—UI线程](http://gityuan.com/2019/06/15/flutter_ui_draw/)文中小节[2.1]介绍Engine::ScheduleFrame()经过层层调用，最终会注册Vsync回调。
等待下一次vsync信号的到来，然后再经过层层调用最终会调用到Window::BeginFrame()。

### 2.8  Window::BeginFrame
[-> flutter/lib/ui/window/window.cc]

```Java
void Window::BeginFrame(fml::TimePoint frameTime) {
  std::shared_ptr<tonic::DartState> dart_state = library_.dart_state().lock();
  if (!dart_state)
    return;
  tonic::DartState::Scope scope(dart_state);

  int64_t microseconds = (frameTime - fml::TimePoint()).ToMicroseconds();

  // [见小节4.2]
  DartInvokeField(library_.value(), "_beginFrame",
                  {
                      Dart_NewInteger(microseconds),
                  });

  //执行MicroTask
  UIDartState::Current()->FlushMicrotasksNow();

  // [见小节4.4]
  DartInvokeField(library_.value(), "_drawFrame", {});
}
```

Window::BeginFrame()过程主要工作：

- 执行_beginFrame
- 执行FlushMicrotasksNow
- 执行_drawFrame

可见，Microtask位于beginFrame和drawFrame之间，那么Microtask的耗时会影响ui绘制过程。


### 2.9 handleBeginFrame
[-> lib/src/scheduler/binding.dart:: SchedulerBinding]

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

  //此时阶段等于SchedulerPhase.idle;
  _hasScheduledFrame = false;
  try {
    Timeline.startSync('Animate', arguments: timelineWhitelistArguments);
    _schedulerPhase = SchedulerPhase.transientCallbacks;
    //执行动画的回调方法
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

该方法主要功能是遍历\_transientCallbacks，执行相应的Animate操作，可通过scheduleFrameCallback()/cancelFrameCallbackWithId()来完成添加和删除成员，再来简单看看这两个方法。

### 2.10 handleDrawFrame
[-> lib/src/scheduler/binding.dart:: SchedulerBinding]

```Java
void handleDrawFrame() {
  assert(_schedulerPhase == SchedulerPhase.midFrameMicrotasks);
  Timeline.finishSync(); // 标识结束"Animate"阶段
  try {
    _schedulerPhase = SchedulerPhase.persistentCallbacks;
    //执行PERSISTENT FRAME回调
    for (FrameCallback callback in _persistentCallbacks)
      _invokeFrameCallback(callback, _currentFrameTimeStamp);

    _schedulerPhase = SchedulerPhase.postFrameCallbacks;
    // 执行POST-FRAME回调
    final List<FrameCallback> localPostFrameCallbacks = List<FrameCallback>.from(_postFrameCallbacks);
    _postFrameCallbacks.clear();
    for (FrameCallback callback in localPostFrameCallbacks)
      _invokeFrameCallback(callback, _currentFrameTimeStamp);
  } finally {
    _schedulerPhase = SchedulerPhase.idle;
    Timeline.finishSync(); //标识结束”Frame“阶段
    profile(() {
      _profileFrameStopwatch.stop();
      _profileFramePostEvent();
    });
    _currentFrameTimeStamp = null;
  }
}
```

该方法主要功能：

- 遍历\_persistentCallbacks，执行相应的回调方法，可通过addPersistentFrameCallback()注册，一旦注册后不可移除，后续每一次frame回调都会执行；
- 遍历\_postFrameCallbacks，执行相应的回调方法，可通过addPostFrameCallback()注册，handleDrawFrame()执行完成后会清空_postFrameCallbacks内容。


## 三、小结

可见，setState()过程主要工作是记录所有的脏元素，添加到BuildOwner对象的_dirtyElements成员变量，然后调用scheduleFrame来注册Vsync回调。 当下一次vsync信号的到来时会执行handleBeginFrame()和handleDrawFrame()来更新UI。
