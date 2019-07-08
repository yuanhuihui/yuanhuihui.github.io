---
layout: post
title:  "深入理解Flutter应用启动"
date:   2019-06-29 21:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5的源码剖析， 分析flutter的启动流程，相关源码：


## 一、概述

## 二、启动流程

### 2.1 runApp
/packages/flutter/lib/src/widgets/binding.dart

```Java
void runApp(Widget app) {
  WidgetsFlutterBinding.ensureInitialized()  //[见小节2.2]
    ..attachRootWidget(app)   //[见小节2.3]
    ..scheduleWarmUpFrame();  //[见小节2.5]
}
```

### 2.2 WidgetsFlutterBinding.ensureInitialized

```Java
class WidgetsFlutterBinding extends BindingBase with GestureBinding, ServicesBinding, SchedulerBinding, PaintingBinding, SemanticsBinding, RendererBinding, WidgetsBinding {

  static WidgetsBinding ensureInitialized() {
    if (WidgetsBinding.instance == null)
      WidgetsFlutterBinding();  //初始化
    return WidgetsBinding.instance;
  }
}
```

WidgetsBinding这是一个单例模式，负责创建WidgetsBinding对象，WidgetsFlutterBinding类混入7个mixin。


#### 2.2.1 初始化BindingBase

```Java
abstract class BindingBase {
  BindingBase() {
    developer.Timeline.startSync('Framework initialization');

    initInstances();  // [见小节2.2.2]
    initServiceExtensions();

    developer.postEvent('Flutter.FrameworkInitialization', <String, String>{});
    developer.Timeline.finishSync();
  }
}
```

先初始化父类BindingBase的构造函数，mixin对于with的顺序有关，initInstances首先执行的便是最右边的WidgetsBinding类中的initInstances()方法，由于该方法都包含super.initInstances()，故会依次调用以下这些mixin的initInstances()方法进行初始化。


```Java
WidgetsBinding
  RendererBinding
    SemanticsBinding
      PaintingBinding
        SchedulerBinding
          ServicesBinding
            GestureBinding
```

#### 2.2.2 WidgetsBinding.initInstances

```Java
mixin WidgetsBinding on BindingBase, SchedulerBinding, GestureBinding, RendererBinding, SemanticsBinding {
  BuildOwner get buildOwner => _buildOwner;
  final BuildOwner _buildOwner = BuildOwner();

  void initInstances() {
    super.initInstances();
    _instance = this;
    buildOwner.onBuildScheduled = _handleBuildScheduled;
    ui.window.onLocaleChanged = handleLocaleChanged;
    ui.window.onAccessibilityFeaturesChanged = handleAccessibilityFeaturesChanged;
    //处理导航的方法回调
    SystemChannels.navigation.setMethodCallHandler(_handleNavigationInvocation);
    //处理系统消息，比如内存紧张
    SystemChannels.system.setMessageHandler(_handleSystemMessage);
  }
}
```

初始化window的onLocaleChanged和onAccessibilityFeaturesChanged回调方法。

#### 2.2.3 RendererBinding.initInstances

```Java
mixin RendererBinding on BindingBase, ServicesBinding, SchedulerBinding, SemanticsBinding, HitTestable {
  PipelineOwner get pipelineOwner => _pipelineOwner;
  PipelineOwner _pipelineOwner;
  RenderView get renderView => _pipelineOwner.rootNode;

  @override
  void initInstances() {
    super.initInstances();
    _instance = this;
    //创建PipelineOwner对象
    _pipelineOwner = PipelineOwner(
      onNeedVisualUpdate: ensureVisualUpdate,
      onSemanticsOwnerCreated: _handleSemanticsOwnerCreated,
      onSemanticsOwnerDisposed: _handleSemanticsOwnerDisposed,
    );
    ui.window
      ..onMetricsChanged = handleMetricsChanged
      ..onTextScaleFactorChanged = handleTextScaleFactorChanged
      ..onSemanticsEnabledChanged = _handleSemanticsEnabledChanged
      ..onSemanticsAction = _handleSemanticsAction;
    initRenderView();  //初始化
    _handleSemanticsEnabledChanged();
    assert(renderView != null);
    addPersistentFrameCallback(_handlePersistentFrameCallback);
  }

  void initRenderView() {
    renderView = RenderView(configuration: createViewConfiguration());
    //将该view添加到需要layout和paint列表
    renderView.scheduleInitialFrame();
  }
}
```

其他mixin此处先省略...


### 2.3 WidgetsBinding.attachRootWidget

```Java
mixin WidgetsBinding on BindingBase, SchedulerBinding, GestureBinding, RendererBinding, SemanticsBinding {
    Element _renderViewElement;

    void attachRootWidget(Widget rootWidget) {
      _renderViewElement = RenderObjectToWidgetAdapter<RenderBox>(
        container: renderView,
        debugShortDescription: '[root]',
        child: rootWidget
      ).attachToRenderTree(buildOwner, renderViewElement); //[见小节2.4]
    }
}
```

RenderObjectToWidgetAdapter是RenderObject到Element树的一个桥接。


### 2.4 RenderObjectToWidgetAdapter.attachToRenderTree

```Java
RenderObjectToWidgetElement<T> attachToRenderTree(BuildOwner owner, [RenderObjectToWidgetElement<T> element]) {
  if (element == null) {
    owner.lockState(() {
      element = createElement(); //创建RenderObjectToWidgetElement对象
      element.assignOwner(owner);
    });
    //执行build过程
    owner.buildScope(element, () {
      element.mount(null, null);
    });
  } else {
    element._newWidget = this;
    element.markNeedsBuild();
  }
  return element;
}
```

然后执行BuildOwner.buildScope()进行build构建操作。 再回到小节2.1，接着开始执行scheduleWarmUpFrame

### 2.5 SchedulerBinding.scheduleWarmUpFrame

```Java
void scheduleWarmUpFrame() {
  if (_warmUpFrame || schedulerPhase != SchedulerPhase.idle)
    return;

  _warmUpFrame = true;
  Timeline.startSync('Warm-up frame');
  final bool hadScheduledFrame = _hasScheduledFrame;
  //使用定时器来确保在两者间能执行微任务
  Timer.run(() {
    handleBeginFrame(null);
  });
  Timer.run(() {
    handleDrawFrame();
    //这帧结束后重置时间
    resetEpoch();
    _warmUpFrame = false;
    if (hadScheduledFrame)
      scheduleFrame();
  });

  lockEvents(() async {
    await endOfFrame;
    Timeline.finishSync();
  });
}
```

预热帧结束后调用resetEpoch，以便在热重载情况下，下一帧假装在预热帧之后立刻发生。
由于预热帧的时间戳通常会在过去(最后一个真实帧的时间)，如果不重置时间，则会出现从预热帧中的旧时间突然跳转到 “真实”框架中的新时间。
最大的问题就是隐式动画最终会在过去被触发，然后跳过每一帧并在新时间结束，从而出现帧跳跃的情况。
