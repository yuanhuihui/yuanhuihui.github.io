

## 一、概述

动画效果对于系统的用户体验非常重要，精细设计的动画能让用户感觉界面更加顺畅，提升用户体验，接下来看看Flutter动画。

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

- Tween：补间动画，有begin和end两个状态，以及随着时间匀速改变状态的lerp(t)方法；



Ticker.scheduleTick()
  SchedulerBinding.scheduleFrameCallback()
    SchedulerBinding.scheduleFrame()

## 二、原理分析

animationController.forward()  //便启动的动画


PageView

Tween
AnimationWidget

AnimationController
CurvedAnimation

TickerProviderStateMixin 这个干什么的
TickerProvider

https://juejin.im/post/5cdbbc01f265da037b6134d9
