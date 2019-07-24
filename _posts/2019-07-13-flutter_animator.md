---
layout: post
title:  "深入理解Flutter动画原理"
date:   2019-07-13 23:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter动画原理，相关源码目录见文末附录


## 一、概述

动画效果对于系统的用户体验非常重要，好的动画能让用户感觉界面更加顺畅，提升用户体验。

#### 1.1 动画类型

Flutter动画大的分类来说主要分为两大类：

- 补间动画：给定初值与终值，系统自动补齐中间帧的动画
- 物理动画：遵循物理学定律的动画，实现了弹簧、阻尼、重力三种物理效果

在应用使用过程中常见动画模式：

- 动画列表或者网格：例如元素的添加或者删除操作；
- 转场动画Shared element transition：例如从当前页面打开另一页面的过渡动画；
- 交错动画Staggered animations：比如部分或者完全交错的动画。


#### 1.2 类图

核心类：

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


#### 1.3 动画实例

```Java
 //[见小节2.1]
AnimationController animationController = AnimationController(
    vsync: this, duration: Duration(milliseconds: 1000));
Animation animation = Tween(begin: 0.0,end: 10.0).animate(animationController);
animationController.addListener(() {
  setState(() {});
});
 //[见小节2.2]
animationController.forward();
```

该过程说明：

- AnimationController作为Animation子类，在屏幕刷新时生成一系列值，默认情况下从0到1区间的取值。
- Tween的animate()方法来自于父类Animatable，该方法返回的对象类型为_AnimatedEvaluation，而该对象最核心的工作就是通过value来调用Tween的transform()；


调用链：

    AnimationController.forward
      AnimationController.\_animateToInternal
        AnimationController.\_startSimulation
          Ticker.start()
            Ticker.scheduleTick()
              SchedulerBinding.scheduleFrameCallback()
                SchedulerBinding.scheduleFrame()

    Ticker.\_tick
      AnimationController.\_tick
      scheduleTick  ==> 这个过程调用，形成循环

## 二、原理分析

### 2.1 AnimationController初始化
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
  _ticker = vsync.createTicker(_tick);  //[见小节2.1.1]
  _internalSetValue(value ?? lowerBound); //[见小节2.1.4]
}
```

该方法说明：

- AnimationController初始化过程，一般都设置duration和vsync初值；
- upperBound(上边界值)和lowerBound(下边界值)都不能为空，且upperBound必须大于等于lowerBound；
- 创建默认的动画方向为向前(\_AnimationDirection.forward)；
- 调用类型为TickerProvider的vsync对象的createTicker()方法来创建Ticker对象；

TickerProvider作为抽象类，主要的子类有SingleTickerProviderStateMixin和TickerProviderStateMixin，这两个类的区别就是是否支持创建多个TickerProvider，这里SingleTickerProviderStateMixin为例展开。

#### 2.1.1 createTicker
[-> lib/src/widgets/ticker_provider.dart]

```Java
mixin SingleTickerProviderStateMixin<T extends StatefulWidget> on State<T> implements TickerProvider {
  Ticker _ticker;

  Ticker createTicker(TickerCallback onTick) {
     //[见小节2.1.2]
    _ticker = Ticker(onTick, debugLabel: 'created by $this');
    return _ticker;
  }
```

#### 2.1.2 Ticker初始化
[-> lib/src/scheduler/ticker.dart]

```Java
class Ticker {
  Ticker(this._onTick, { this.debugLabel }) {
  }  

  final TickerCallback _onTick;
}
```

将AnimationControllerd对象中的_tick()方法，赋值给Ticker对象的_onTick成员变量，再来看看该_tick方法。

#### 2.1.3 AnimationController.\_tick
[-> lib/src/animation/animation_controller.dart ::AnimationController]

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

再回到小节2.1，接下来开始执行\_internalSetValue()方法。

#### 2.1.4 \_internalSetValue
[-> lib/src/animation/animation_controller.dart ::AnimationController]

```Java
void _internalSetValue(double newValue) {
  _value = newValue.clamp(lowerBound, upperBound);
  if (_value == lowerBound) {
    _status = AnimationStatus.dismissed;
  } else if (_value == upperBound) {
    _status = AnimationStatus.completed;
  } else {
    _status = (_direction == _AnimationDirection.forward) ?
      AnimationStatus.forward :
      AnimationStatus.reverse;
  }
}
```

根据当前的value值来初始化动画状态\_status

### 2.2 forward
[-> lib/src/animation/animation_controller.dart ::AnimationController]

```Java
TickerFuture forward({ double from }) {
  //默认采用向前的动画方向
  _direction = _AnimationDirection.forward;
  if (from != null)
    value = from;
  return _animateToInternal(upperBound); //[见小节2.3]
}
```

\_AnimationDirection是枚举类型，有forward(向前)和reverse(向后)两个值，也就是说该方法的功能是指从from开始向前滑动，

### 2.3 \_animateToInternal
[-> lib/src/animation/animation_controller.dart ::AnimationController]

```Java
TickerFuture _animateToInternal(double target, { Duration duration, Curve curve = Curves.linear }) {
  double scale = 1.0;
  if (SemanticsBinding.instance.disableAnimations) {
    switch (animationBehavior) {
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
    //根据剩余动画的百分比来评估仿真动画剩余时长
    simulationDuration = this.duration * remainingFraction;
  } else if (target == value) {
    //已到达动画终点，不再执行动画
    simulationDuration = Duration.zero;
  }
  //停止老的动画[见小节2.3.1]
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
    //当动画执行时间已到，则直接结束
    return TickerFuture.complete();
  }
  //[见小节2.4]
  return _startSimulation(_InterpolationSimulation(_value, target, simulationDuration, curve, scale));
}
```

默认采用的是线性动画曲线Curves.linear。

#### 2.3.1 AnimationController.stop

```Java
void stop({ bool canceled = true }) {
  _simulation = null;
  _lastElapsedDuration = null;
  //[见小节2.3.2]
  _ticker.stop(canceled: canceled);
}
```

#### 2.3.2 Ticker.stop
[-> lib/src/scheduler/ticker.dart]

```Java
void stop({ bool canceled = false }) {
  if (!isActive) //已经不活跃，则直接返回
    return;

  final TickerFuture localFuture = _future;
  _future = null;
  _startTime = null;

  //[见小节2.3.3]
  unscheduleTick();
  if (canceled) {
    localFuture._cancel(this);
  } else {
    localFuture._complete();
  }
}
```

#### 2.3.3 Ticker.unscheduleTick
[-> lib/src/scheduler/ticker.dart]

```Java
void unscheduleTick() {
  if (scheduled) {
    SchedulerBinding.instance.cancelFrameCallbackWithId(_animationId);
    _animationId = null;
  }
}
```

#### 2.3.4 \_InterpolationSimulation初始化
[-> lib/src/animation/animation_controller.dart ::_InterpolationSimulation]

```
class _InterpolationSimulation extends Simulation {
  _InterpolationSimulation(this._begin, this._end, Duration duration, this._curve, double scale)
    : _durationInSeconds = (duration.inMicroseconds * scale) / Duration.microsecondsPerSecond;

  final double _durationInSeconds;
  final double _begin;
  final double _end;
  final Curve _curve;
}
```

该方法创建插值模拟器对象，并初始化起点、终点、动画曲线以及时长。这里用的Curve是线性模型，也就是说采用的是匀速运动。


### 2.4 \_startSimulation
[-> lib/src/animation/animation_controller.dart]

```Java
TickerFuture _startSimulation(Simulation simulation) {
  _simulation = simulation;
  _lastElapsedDuration = Duration.zero;
  _value = simulation.x(0.0).clamp(lowerBound, upperBound);
  //[见小节2.5]
  final TickerFuture result = _ticker.start();
  _status = (_direction == _AnimationDirection.forward) ?
    AnimationStatus.forward :
    AnimationStatus.reverse;
  //[见小节2.4.1]
  _checkStatusChanged();
  return result;
}
```

#### 2.4.1 \_checkStatusChanged
[-> lib/src/animation/animation_controller.dart]

```Java
void _checkStatusChanged() {
  final AnimationStatus newStatus = status;
  if (_lastReportedStatus != newStatus) {
    _lastReportedStatus = newStatus;
    notifyStatusListeners(newStatus); //通知状态改变
  }
}
```

这里会回调_statusListeners中的所有状态监听器，这里的状态就是指AnimationStatus的dismissed、forward、reverse以及completed。

### 2.5 Ticker.start
[-> lib/src/scheduler/ticker.dart]

```Java
TickerFuture start() {
  _future = TickerFuture._();
  if (shouldScheduleTick) {
    scheduleTick();   //[见小节2.6]
  }
  if (SchedulerBinding.instance.schedulerPhase.index > SchedulerPhase.idle.index &&
      SchedulerBinding.instance.schedulerPhase.index < SchedulerPhase.postFrameCallbacks.index)
    _startTime = SchedulerBinding.instance.currentFrameTimeStamp;
  return _future;
}
```

此处的shouldScheduleTick等于!muted && isActive && !scheduled，也就是没有调度过的活跃状态才会调用Tick。

### 2.6 Ticker.scheduleTick
[-> lib/src/scheduler/ticker.dart]

```Java
void scheduleTick({ bool rescheduling = false }) {
  //[见小节2.7]
  _animationId = SchedulerBinding.instance.scheduleFrameCallback(_tick, rescheduling: rescheduling);
}
```

此处的_tick会在下一次vysnc触发时回调执行，见小节2.9。


### 2.7 scheduleFrameCallback
[-> lib/src/scheduler/binding.dart]

```Java
int scheduleFrameCallback(FrameCallback callback, { bool rescheduling = false }) {
  scheduleFrame();
  _nextFrameCallbackId += 1;
  _transientCallbacks[_nextFrameCallbackId] = _FrameCallbackEntry(callback, rescheduling: rescheduling);
  return _nextFrameCallbackId;
}
```


### 2.8 scheduleFrame
[-> lib/src/scheduler/binding.dart]

```Java
void scheduleFrame() {
  if (_hasScheduledFrame || !_framesEnabled)
    return;
  ui.window.scheduleFrame();
  _hasScheduledFrame = true;
}
```

从文章[Flutter之setState更新机制](http://gityuan.com/2019/07/06/flutter_set_state/)，可知此处调用的ui.window.scheduleFrame()，会注册vsync监听。当当下一次vsync信号的到来时会执行handleBeginFrame()和handleDrawFrame()，该方法最终会执行_tick方法。


### 2.9 Ticker.\_tick
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

## 三、总结

待续...
