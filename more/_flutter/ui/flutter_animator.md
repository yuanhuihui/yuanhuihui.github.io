

## 一、概述


动画效果对于系统的用户体验非常重要，精细设计的动画能让用户感觉界面更加顺畅，提升用户体验。

#### 1.1 动画分类

对于Flutter来说动画分为两大类：

- 补间动画：给定初值与终值，系统自动补齐中间帧的动画
- 物理动画：遵循一定物理学定律的动画，实现了弹簧、阻尼、重力三种物理效果


#### 1.2 常见动画模式

- List/Grid中的动画：比如item的添加或者删除操作；
- 转场动画（Shared element transition）：比如当前页面打开另一页面的过渡动画；
- 交错动画（Staggered animation）：比如需要部分或者完全交错的动画。

- Animation对象是整个动画中非常核心的一个类；
- AnimationController用于管理Animation；
- CurvedAnimation过程是非线性曲线；
- Tween补间动画
- Listeners和StatusListeners用于监听动画状态改变。


AnimationStatus是枚举类型，有4个值；

|取值|解释|
|---|---|
|dismissed|动画在开始时停止|
|forward|动画从头到尾绘制|
|reverse|动画反向绘制，从尾到头|
|completed|动画在结束时停止|


#### 1.2 类图
Tween，有begin和end两个状态，以及随着时间匀速改变状态的lerp(t)方法；


#### 1.4 动画原理


animationController.forward()  //便启动的动画

TickerProviderStateMixin解释一下

## 二、原理分析

AnimationController.forward
  AnimationController.\_animateToInternal
    AnimationController.\_startSimulation
      Ticker.start()
        Ticker.scheduleTick()
          SchedulerBinding.scheduleFrameCallback()
            SchedulerBinding.scheduleFrame()

底层回调后的执行流程：

Ticker.\_tick
  AnimationController.\_tick


### forward
[-> lib/src/animation/animation_controller.dart]

```Java
TickerFuture forward({ double from }) {
  _direction = _AnimationDirection.forward;
  if (from != null)
    value = from;
  return _animateToInternal(upperBound);
}
```

### \_animateToInternal
[-> lib/src/animation/animation_controller.dart]

```Java
TickerFuture _animateToInternal(double target, { Duration duration, Curve curve = Curves.linear, AnimationBehavior animationBehavior }) {
  final AnimationBehavior behavior = animationBehavior ?? this.animationBehavior;
  double scale = 1.0;
  if (SemanticsBinding.instance.disableAnimations) {
    switch (behavior) {
      case AnimationBehavior.normal:
        scale = 0.05;
        break;
      case AnimationBehavior.preserve:
        break;
    }
  }
  Duration simulationDuration = duration;
  if (simulationDuration == null) {
    final double range = upperBound - lowerBound;
    final double remainingFraction = range.isFinite ? (target - _value).abs() / range : 1.0;
    simulationDuration = this.duration * remainingFraction;
  } else if (target == value) {
    simulationDuration = Duration.zero;
  }
  stop();
  if (simulationDuration == Duration.zero) {
    if (value != target) {
      _value = target.clamp(lowerBound, upperBound);
      notifyListeners();
    }
    _status = (_direction == _AnimationDirection.forward) ?
      AnimationStatus.completed :
      AnimationStatus.dismissed;
    _checkStatusChanged();
    return TickerFuture.complete();
  }
  return _startSimulation(_InterpolationSimulation(_value, target, simulationDuration, curve, scale));
}
```

### \_startSimulation
[-> lib/src/animation/animation_controller.dart]

```Java
TickerFuture _startSimulation(Simulation simulation) {
  _simulation = simulation;
  _lastElapsedDuration = Duration.zero;
  _value = simulation.x(0.0).clamp(lowerBound, upperBound);
  final TickerFuture result = _ticker.start();
  _status = (_direction == _AnimationDirection.forward) ?
    AnimationStatus.forward :
    AnimationStatus.reverse;
  _checkStatusChanged();
  return result;
}
```

### Ticker.start
[-> lib/src/scheduler/ticker.dart]

```Java
TickerFuture start() {
  _future = TickerFuture._();
  if (shouldScheduleTick) {
    scheduleTick();
  }
  if (SchedulerBinding.instance.schedulerPhase.index > SchedulerPhase.idle.index &&
      SchedulerBinding.instance.schedulerPhase.index < SchedulerPhase.postFrameCallbacks.index)
    _startTime = SchedulerBinding.instance.currentFrameTimeStamp;
  return _future;
}
```

### Ticker.scheduleTick
[-> lib/src/scheduler/ticker.dart]

```Java
void scheduleTick({ bool rescheduling = false }) {
  _animationId = SchedulerBinding.instance.scheduleFrameCallback(_tick, rescheduling: rescheduling);
}
```

此处的_tick在flutter引擎层回调

### scheduleFrameCallback
[-> lib/src/scheduler/binding.dart]

```Java
int scheduleFrameCallback(FrameCallback callback, { bool rescheduling = false }) {
  scheduleFrame();
  _nextFrameCallbackId += 1;
  _transientCallbacks[_nextFrameCallbackId] = _FrameCallbackEntry(callback, rescheduling: rescheduling);
  return _nextFrameCallbackId;
}
```

### scheduleFrame
[-> lib/src/scheduler/binding.dart]

```Java
void scheduleFrame() {
  if (_hasScheduledFrame || !_framesEnabled)
    return;
  ui.window.scheduleFrame();
  _hasScheduledFrame = true;
}
```

此处调用了ui.window.scheduleFrame()，会注册vsync监听。当引擎层收到回调后，经过层层调用会执行ui.window.onBeginFrame()，该方法最终会执行_tick方法。

### Ticker.\_tick
[-> lib/src/scheduler/ticker.dart]

```Java
void _tick(Duration timeStamp) {
  _animationId = null;
  _startTime ??= timeStamp;
  _onTick(timeStamp - _startTime);

  if (shouldScheduleTick)
    scheduleTick(rescheduling: true);
}
```

此处的_onTick会调用到具体的使用方，这里以AnimationController为例。

## 实例

### 1 AnimationController
[-> lib/src/animation/animation_controller.dart]

```Java
AnimationController({
   double value,
   this.duration,
   this.debugLabel,
   this.lowerBound = 0.0,
   this.upperBound = 1.0,
   this.animationBehavior = AnimationBehavior.normal,
   @required TickerProvider vsync,
 }) : _direction = _AnimationDirection.forward {
   _ticker = vsync.createTicker(_tick);  
   _internalSetValue(value ?? lowerBound);
 }
```

此处的_tick便是Ticker.\_tick要回调的_onTick()方法。

#### 1.1 AnimationController.\_tick
[-> lib/src/animation/animation_controller.dart]

```Java
void _tick(Duration elapsed) {
  _lastElapsedDuration = elapsed;
  final double elapsedInSeconds = elapsed.inMicroseconds.toDouble() / Duration.microsecondsPerSecond;
  _value = _simulation.x(elapsedInSeconds).clamp(lowerBound, upperBound);
  if (_simulation.isDone(elapsedInSeconds)) {
    _status = (_direction == _AnimationDirection.forward) ?
      AnimationStatus.completed :
      AnimationStatus.dismissed;
    stop(canceled: false);
  }
  notifyListeners();
  _checkStatusChanged();
}
```

### 2 createTicker

```Java
mixin SingleTickerProviderStateMixin<T extends StatefulWidget> on State<T> implements TickerProvider {
  Ticker _ticker;

  @override
  Ticker createTicker(TickerCallback onTick) {
    _ticker = Ticker(onTick, debugLabel: 'created by $this');
    return _ticker;
  }

  ...
}
```

## 五、其他
