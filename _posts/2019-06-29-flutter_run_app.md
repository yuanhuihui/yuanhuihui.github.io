---
layout: post
title:  "深入理解Flutter应用启动"
date:   2019-06-29 21:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter应用的启动流程，相关源码目录见文末附录


## 一、概述

上一篇文章[深入理解Flutter引擎启动](http://gityuan.com/2019/06/22/flutter_booting/) 已经介绍了FlutterApplication和FlutterActivity的onCreate()方法执行过程，
并触发Flutter引擎的启动，并最终执行到runApp(Widget app)方法，这才刚刚开始执行dart的业务代码，本文便从该方法讲起说一说flutter应用内逻辑的执行流程。

### 1.1 起点

```Java
void main() => runApp(MyApp());

class MyApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Gityuan Flutter Demo',
      theme: ThemeData(
        primarySwatch: Colors.blue,
      ),
      home: GityuanHomePage(title: 'Gityuan Flutter Demo Home Page'),
    );
  }
}
```

这是一段flutter app的demo代码，可见root widget就是MyApp对象。

### 1.2 启动流程图

**1) [runApp启动流程图](/img/flutter_runapp/RunApp.jpg)**

![RunApp](/img/flutter_runapp/RunApp.jpg)


### 1.3 相关类图

**1) [Widget/Element/RenderObject类图](http://gityuan.com/img/flutter_runapp/ClassTree.jpg)**

![ClassTree](http://gityuan.com/img/flutter_runapp/ClassTree.jpg)

Flutter中有3个比较重要的树Widget/Element/RenderObject，可以看出Widget/Element继承于共同的父类DiagnosticableTree，RenderObject继承于AbstractNode父类。
这3颗树之间是什么关系，如何相互关联，接下来会详细展开，并在文末会有更详细的类关系图。

## 二、应用启动流程

### 2.1 runApp
[-> lib/src/widgets/binding.dart]

```Java
void runApp(Widget app) {
  WidgetsFlutterBinding.ensureInitialized()  //[见小节2.2]
    ..attachRootWidget(app)   //[见小节2.4]
    ..scheduleWarmUpFrame();  //[见小节2.7]
}
```

### 2.2 ensureInitialized
[-> lib/src/widgets/binding.dart]

```Java
class WidgetsFlutterBinding extends BindingBase with GestureBinding, ServicesBinding, SchedulerBinding, PaintingBinding, SemanticsBinding, RendererBinding, WidgetsBinding {

  static WidgetsBinding ensureInitialized() {
    if (WidgetsBinding.instance == null)
      WidgetsFlutterBinding();  //首次初始化，先初始化父类BindingBase [小节2.2.1]
    return WidgetsBinding.instance;
  }
}
```

WidgetsFlutterBinding这是一个单例模式，负责创建WidgetsFlutterBinding对象，WidgetsFlutterBinding继承抽象类BindingBase，并且附带7个mixin，对于mixin语法来说顺序是很重要，相同的方法会由后面的mixin覆盖前面的mixin方法，类关系图如下：

![ClassBinding](/img/flutter_runapp/class_widget_flutter_binding.jpg)

图解：

- BindingBase：抽象基类
- WidgetsBinding：绑定组件树
- RendererBinding：绑定渲染树
- SemanticsBinding：绑定语义树
- PaintingBinding：绑定绘制操作
- SchedulerBinding：绑定帧绘制回调函数，以及widget生命周期相关事件
- ServicesBinding：绑定平台服务消息，注册Dart层和C++层的消息传输服务；
- GestureBinding：绑定手势事件，用于检测应用的各种手势相关操作；

#### 2.2.1 BindingBase初始化
[-> lib/src/foundation/binding.dart]

```Java
abstract class BindingBase {
  BindingBase() {
    developer.Timeline.startSync('Framework initialization');

    initInstances();  //初始化状态 [见小节2.3]
    initServiceExtensions(); //扩展调试相关服务

    developer.postEvent('Flutter.FrameworkInitialization', <String, String>{});
    developer.Timeline.finishSync();
  }
}
```

该方法的主要工作：

- 执行initInstances()方法会依次调用到每一下mixin来初始化一些状态；
- 执行initServiceExtensions方法会依次调用WidgetsBinding，RendererBinding，SchedulerBinding，ServicesBinding，BindingBase这5个类，主要是根据不同的包(release/profile/debug)调用registerServiceExtension()方法来注册各种扩展服务用于debug。


### 2.3 initInstances

mixin对于with的顺序有关，initInstances首先执行的便是最右边的WidgetsBinding类中的initInstances()方法，由于该方法都包含super.initInstances()，故会依次调用以下这些mixin的initInstances()方法进行初始化，调用栈如下图：

![widget_binding_init](/img/flutter_runapp/widget_binding_init.png)

#### 2.3.1 WidgetsBinding.initInstances
[-> lib/src/widgets/binding.dart]

```Java
mixin WidgetsBinding on BindingBase, SchedulerBinding, GestureBinding, RendererBinding, SemanticsBinding {
  final BuildOwner _buildOwner = BuildOwner();
  Element _renderViewElement;

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

WidgetsBinding初始化过程会设置window的如下回调方法：

- onLocaleChanged
- onAccessibilityFeaturesChanged

#### 2.3.2 RendererBinding.initInstances
[-> lib/src/rendering/binding.dart]

```Java
mixin RendererBinding on BindingBase, ServicesBinding, SchedulerBinding, SemanticsBinding, HitTestable {
  PipelineOwner _pipelineOwner;
  RenderView get renderView => _pipelineOwner.rootNode;

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
    initRenderView();  //初始化RenderView，见下文
    _handleSemanticsEnabledChanged();
    addPersistentFrameCallback(_handlePersistentFrameCallback);
  }
}
```

RendererBinding初始化过程，创建PipelineOwner、RenderView对象以及设置window的如下回调方法：

- onMetricsChanged
- onTextScaleFactorChanged
- onSemanticsEnabledChanged
- onSemanticsAction


```Java
void initRenderView() {
  renderView = RenderView(configuration: createViewConfiguration(), window: window);
  renderView.scheduleInitialFrame(); //初始化首帧
}

set renderView(RenderView value) {
  _pipelineOwner.rootNode = value;
}
```

创建对象RenderView，并保持到_pipelineOwner.rootNode里面，可通过RendererBinding.renderView获取。

#### 2.3.3 SemanticsBinding
[-> lib/src/semantics/binding.dart]

```Java
mixin SemanticsBinding on BindingBase {
  static SemanticsBinding _instance;

  void initInstances() {
    super.initInstances();
    _instance = this;
    _accessibilityFeatures = window.accessibilityFeatures;
  }
}
```

#### 2.3.4 PaintingBinding
[-> lib/src/painting/binding.dart]

```Java
mixin PaintingBinding on BindingBase, ServicesBinding {
  static ShaderWarmUp shaderWarmUp = const DefaultShaderWarmUp();

  void initInstances() {
    super.initInstances();
    _instance = this;
    _imageCache = createImageCache(); //创建image缓存
    if (shaderWarmUp != null) {
      shaderWarmUp.execute();
    }
  }
}
```

该过程会创建image缓存。

#### 2.3.5 SchedulerBinding
[-> lib/src/scheduler/binding.dart]

```Java
mixin SchedulerBinding on BindingBase, ServicesBinding {
  void initInstances() {
    super.initInstances();
    _instance = this;
    window.onBeginFrame = _handleBeginFrame;
    window.onDrawFrame = _handleDrawFrame;
    SystemChannels.lifecycle.setMessageHandler(_handleLifecycleMessage);
    readInitialLifecycleStateFromNativeWindow();
  }
}
```

SchedulerBinding初始化过程，设置生命周期回调以及设置window的如下回调方法：

- onMetricsChanged
- onBeginFrame
- onDrawFrame

#### 2.3.6 ServicesBinding
[-> lib/src/services/binding.dart]

```Java
mixin ServicesBinding on BindingBase {
  void initInstances() {
    super.initInstances();
    _instance = this;
    window
      ..onPlatformMessage = BinaryMessages.handlePlatformMessage;
    initLicenses();
  }
}
```

ServicesBinding初始化过程，window的如下回调方法：

- onPlatformMessage

#### 2.3.7 GestureBinding
[-> lib/src/gestures/binding.dart]

```Java
mixin GestureBinding on BindingBase implements HitTestable, HitTestDispatcher, HitTestTarget {
  void initInstances() {
    super.initInstances();  //这里调用到BindingBase类，该类是个空方法
    _instance = this;
    window.onPointerDataPacket = _handlePointerDataPacket;
  }
```

GestureBinding初始化过程，window的如下回调方法：

- onPointerDataPacket

创建完WidgetsBinding，接下来执行其attachRootWidget()方法

### 2.4 WidgetsBinding.attachRootWidget
[-> lib/src/widgets/binding.dart]

```Java
mixin WidgetsBinding on BindingBase, SchedulerBinding, GestureBinding, RendererBinding, SemanticsBinding {
    Element get renderViewElement => _renderViewElement;
    Element _renderViewElement;

    void attachRootWidget(Widget rootWidget) {
      //创建桥接对象[见小节2.4.1]
      _renderViewElement = RenderObjectToWidgetAdapter<RenderBox>(
        container: renderView,
        debugShortDescription: '[root]',
        child: rootWidget
      ).attachToRenderTree(buildOwner, renderViewElement); //[见小节2.5]
    }
}
```

该方法所涉及的变量：

- rootWidget: 是指flutter应用自定义的根Widget，由开发者自定义；
- renderView: 指由RendererBinding初始化过程创建的RenderView(该类继承于RenderObject)，见小节[2.3.2];
- _renderViewElement: 是由attachToRenderTree()执行后的返回值，类型为Element子类；

可通过WidgetsBinding的renderViewElement来获取创建的RenderObjectToWidgetElement对象。

#### 2.4.1 RenderObjectToWidgetAdapter
[-> lib/src/widgets/binding.dart]

```Java
class RenderObjectToWidgetAdapter<T extends RenderObject> extends RenderObjectWidget {
  final Widget child;
  final RenderObjectWithChildMixin<T> container;
  final String debugShortDescription;   //用于调试：简短描述该widget

  RenderObjectToWidgetAdapter({
    this.child,
    this.container,
    this.debugShortDescription,
  }) : super(key: GlobalObjectKey(container));
}
```

RenderObjectToWidgetAdapter是从[RenderObject]到[Element]树的一个桥接对象，该类的核心方法有：

- createElement：返回的是RenderObjectToWidgetElement类型；
- createRenderObject：返回的便是这个container，也就是renderView；

### 2.5 attachToRenderTree
[-> lib/src/widgets/binding.dart ::RenderObjectToWidgetAdapter]

```Java
class RenderObjectToWidgetAdapter<T extends RenderObject> extends RenderObjectWidget {

  RenderObjectToWidgetElement<T> createElement() => RenderObjectToWidgetElement<T>(this);

  RenderObjectToWidgetElement<T> attachToRenderTree(BuildOwner owner, [RenderObjectToWidgetElement<T> element]) {
    if (element == null) {
      owner.lockState(() {
        element = createElement(); //创建Element对象，见小节2.5.1
        element.assignOwner(owner); //将owner赋值给element成员_owner
      });
      owner.buildScope(element, () {  //执行build过程，见小节2.5.2
        element.mount(null, null);
    } else {
      element._newWidget = this;
      element.markNeedsBuild();
    }
    return element;
  }

}
```

首次调用attachToRenderTree时，element为空则会创建RenderObjectToWidgetElement对象，如果再次调用则会复用已创建的element对象。

#### 2.5.1 createElement
[-> lib/src/widgets/binding.dart ::RenderObjectToWidgetAdapter]

```Java
RenderObjectToWidgetElement<T> createElement() => RenderObjectToWidgetElement<T>(this);
```

此处this便是RenderObjectToWidgetAdapter对象，该过程会将RenderObjectToWidgetAdapter保存在父类Element的widget成员变量中。

#### 2.5.2 BuildOwner.buildScope
[-> lib/src/widgets/framework.dart]

```Java
void buildScope(Element context, [VoidCallback callback]) {
  if (callback == null && _dirtyElements.isEmpty)
    return;
  Timeline.startSync('Build', arguments: timelineWhitelistArguments);
  try {
    if (callback != null) {
      _dirtyElementsNeedsResorting = false;
      callback();  //此处回调为mount() ，见小节2.5.3
    }
    ...
    _dirtyElements.sort(Element._sort);
    int dirtyCount = _dirtyElements.length;
    while (index < dirtyCount) {
        _dirtyElements[index].rebuild(); //针对脏元素执行rebuild操作
        ...
    }
  } finally {
    ...
    Timeline.finishSync();
  }
}
```

#### 2.5.3 RenderObjectToWidgetElement.mount
[-> lib/src/widgets/binding.dart]

```Java
void mount(Element parent, dynamic newSlot) {
  super.mount(parent, newSlot);  //[见小节2.5.4]
  _rebuild(); //[见小节2.6]
}
```

#### 2.5.4 RenderObjectElement.mount
[-> lib/src/widgets/framework.dart]

```Java
abstract class RenderObjectElement extends Element {

    void mount(Element parent, dynamic newSlot) {
      super.mount(parent, newSlot);  //[见小节2.5.5]
      _renderObject = widget.createRenderObject(this);
      attachRenderObject(newSlot); //将newSlot依附到RenderObject上
      _dirty = false;
    }
}
```

此处的widget是RenderObjectToWidgetAdapter对象，那么_renderObject返回的便是renderView对象；

#### 2.5.5 Element.mount
[-> lib/src/widgets/framework.dart]

```Java
abstract class Element extends DiagnosticableTree implements BuildContext {
    void mount(Element parent, dynamic newSlot) {
      _parent = parent;
      _slot = newSlot;
      _depth = _parent != null ? _parent.depth + 1 : 1;
      _active = true;
      if (parent != null)
        _owner = parent.owner;
      if (widget.key is GlobalKey) {
        final GlobalKey key = widget.key;
        key._register(this); //注册并建立globalKey和Element的关联
      }
      _updateInheritance();
    }
}
```

在前面小节[2.5.3]在执行完mount操作后，便会开始执行下面的_rebuild()方法。

### 2.6 RenderObjectToWidgetElement._rebuild
[-> lib/src/widgets/binding.dart]

```Java
void _rebuild() {
  try {
    //[见小节2.6.1]
    _child = updateChild(_child, widget.child, _rootChildSlot);
  } catch (exception, stack) {
    ...
  }
}
```


#### 2.6.1 Element.updateChild
[-> lib/src/widgets/framework.dart]

```Java
Element updateChild(Element child, Widget newWidget, dynamic newSlot) {
  if (newWidget == null) {
    if (child != null)
      deactivateChild(child); //移除旧的子元素
    return null;
  }
  if (child != null) {
    if (child.widget == newWidget) {
      if (child.slot != newSlot)
        updateSlotForChild(child, newSlot); //更新子元素在父级所用的slot
      return child;
    }
    if (Widget.canUpdate(child.widget, newWidget)) {
      if (child.slot != newSlot)
        updateSlotForChild(child, newSlot);
      child.update(newWidget);
      return child;
    }
    deactivateChild(child);
  }
  return inflateWidget(newWidget, newSlot); //为给定的widget创建新Element [见小节2.6.2]
}
```

#### 2.6.2 Element.inflateWidget
[-> lib/src/widgets/framework.dart]

```Java
Element inflateWidget(Widget newWidget, dynamic newSlot) {
  final Key key = newWidget.key;
  if (key is GlobalKey) {
    //从_inactiveElements中查找是否有可复用的Element
    final Element newChild = _retakeInactiveElement(key, newWidget);
    if (newChild != null) {
      newChild._activateWithParent(this, newSlot);
      //找到可复用Element，则从相应列表移除，并更新子视图
      final Element updatedChild = updateChild(newChild, newWidget, newSlot);
      return updatedChild;
    }
  }
  //否则创建新的Element
  final Element newChild = newWidget.createElement();
  newChild.mount(this, newSlot);
  return newChild;
}
```

### 2.7 SchedulerBinding.scheduleWarmUpFrame
[-> lib/src/scheduler/binding.dart]

```Java
void scheduleWarmUpFrame() {
  // _warmUpFrame用于保证不会再没有绘制完成的情况下，再次回调绘制方法
  if (_warmUpFrame || schedulerPhase != SchedulerPhase.idle)
    return;

  _warmUpFrame = true;
  Timeline.startSync('Warm-up frame');
  final bool hadScheduledFrame = _hasScheduledFrame;
  Timer.run(() {
    //使用定时器执行帧准备绘制的方法
    handleBeginFrame(null);
  });
  Timer.run(() {
    //使用定时器执行帧绘制的方法
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

另外关于handleBeginFrame和handleDrawFrame的渲染绘制过程，见文章[Flutter渲染机制—UI线程](http://gityuan.com/2019/06/15/flutter_ui_draw/)中的第四Framework层处理流程部分。

## 三、小结

runApp(MyApp)是flutter应用开始真正执行业务逻辑代码的起点，整个过程主要工作：

- WidgetsFlutterBinding初始化：这是一个单例模式，负责创建WidgetsFlutterBinding对象，WidgetsFlutterBinding继承抽象类BindingBase，并且附带7个mixin，初始化渲染、语义化、绘制、平台消息以及手势等一系列操作；
- attachRootWidget：遍历挂载整个视图树，并建立Widget、Element、RenderObject之间的连接与关系，此处Element的具体类型为RenderObjectToWidgetElement；
- scheduleWarmUpFrame：调度预热帧，执行帧绘制方法handleBeginFrame和handleDrawFrame。

**) [Widget/Element/RenderObject类图](http://gityuan.com/img/flutter_runapp/ClassTreeDet.jpg)**

![ClassTreeDet](http://gityuan.com/img/flutter_runapp/ClassTreeDet.jpg)

从WidgetsFlutterBinding是单例模式，从小节[2.4]得WidgetsBinding的renderViewElement记录着唯一的RenderObjectToWidgetElement对象，从小节[2.3.2]可知RendererBinding的renderView记录着唯一的RenderView对象；也就是说每个flutter应用创建的Root Widget跟Element、RenderObject一一对应，且单例唯一。

MyApp是用户定义的根Widget，为了建立三棵树的关系，RenderObjectToWidgetAdapter起到重要的桥接功能，该类的createElement方法创建RenderObjectToWidgetElement对象，createRenderObject()方法获取的是RenderView。
