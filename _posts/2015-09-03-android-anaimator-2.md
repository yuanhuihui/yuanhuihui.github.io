---
layout: post
title:  "Android动画入门（二）"
date:   2015-9-3 20:20:00
categories: android
excerpt:  Android属性动画
---

* content
{:toc}



----------

 属性动画功能非常强大，可自定义如下属性：  

- 动画时间（Duration）, 指定动画总共完成所需要的时间，默认为300ms;
- 时间插值器（Time interpolation）, 是一个基于当前动画已消耗时间的函数，用来计算属性的值；   
- 重复次数（Repeat count）：指定动画是否重复执行，重复执行的次数，也可以指定动画向反方向地回退操作；    
- 动画集（Animator sets），将一系列动画放进一个组，可以设置同时执行或者按序执行；  
- 延迟刷新时间（Frame refresh delay）：指定动画刷新的频率，默认为每10ms刷新一帧，但应用程序的帧的刷新频率最终取决于整个系统的忙闲程序与系统的时钟频率。

## 一、动画工作  
  
### 1.1 线性插值的动画  

图1是在屏幕上进行水平位移的动画，总时间是40ms，移动总距离为40pixels(像素)，每10ms刷新一帧，同时移动10pixels。在第40ms动画结束，停止在水平位置40pixels的位置。整个动画过程采用的是线程插值器（ linear interpolation），意味着以匀速移动。  
  
![linear animation](/images/animator/1.png)  
图1. 线性插值的动画    
  
  
### 1.2 非线性插值的动画 

当然，也可以指定差值器是非线性的，图2采用的是先加速，再减速的差值器。同样是在40ms内移动40pixels。在开始的时候，动画一直加速到一半的距离（20pixels）,然后在减速剩下的一半距离直到动画结束。从图2可以看出，动画的两头的位移量低于中间部门的位移量。    
  
![non-linear animation](/images/animator/2.png)   
图2. 非线性插值的动画  
  
  
### 1.3 动画过程  
图3描述了属性动画在整个过程中，主要类的工作流程：    
  
![animations work](/images/animator/3.jpg)  
图3. 动画过程  
  
`ValueAnimator`记录动画的已运行时间，已运行距离，当前将要绘制的属性值。还包含
`TimeInterpolator`时间插值器，`TypeEvaluator`估值器，定义每次动画时如何计算属性值。例如，图2的时间插值器是`AccelerateDecelerateInterpolator`, 估值器是`IntEvaluator`。  
  
属性动画，设置好起始值和结束值，执行总时间等参数。当调用`start()`动画开始， 在整个动画期间，`ValueAnimator`计算已绘制的时间比(elapsed fraction)，区间[0,1]，代表动画的完成率，0表示0%，1表示100%。动画运行过程中，通过调用`onAnimationUpdate`方法来更新画面，`getAnimatedValue()`获取当前动画的property。

## 二、详细分析

### 2.1 动画类（Animators）
 `Animator`类提供了关于创造动画的一系列基本的结构，是一个抽象类，主要使用其子类。

#### 2.1.1 `ValueAnimator`	
	
	ValueAnimator fadeAnim = ValueAnimator.ofFloat(0f, 1f);
	fadeAnim.setDuration(250);
	fadeAnim.addListener(new AnimatorListenerAdapter() {
		public void onAnimationEnd(Animator animation) {
		    balls.remove(((ObjectAnimator)animation).getTarget());
		}
	});
	fadeAnim.start();

#### 2.1.2 `ObjectAnimator`
对象动画，继承`ValueAnimator`, 允许指定`target object`。  

	ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f);
	anim.setDuration(1000);
	anim.start();

#### 2.1.3 `AnimatorSet`
动画的集合，用于组合一系列动画。  

	AnimatorSet  animatorSet = new AnimatorSet();
	animatorSet.play(bounceAnim).before(squashAnim1);
	animatorSet.play(squashAnim1).with(squashAnim2);
	animatorSet.play(bounceBackAnim).after(stretchAnim2);
	animatorSet.start();

### 2.2 插值器（Interpolators）
时间插值器，定义了一个时间的函数关系：y = f(x),其中x=`elapsed time` / `duration`.  
f(x)可能为如下的插值器：


|插值器|描述|
|---|---|
|LinearInterpolator|线性|
|AccelerateInterpolator |加速|
|DecelerateInterpolator |减速|
|AccelerateDecelerateInterpolator |先加速后减速|
|AnticipateInterpolator|反向|
|AnticipateOvershootInterpolator|反向超越|
|BounceInterpolator|跳跃|
|CycleInterpolator|循环|
|OvershootInterpolator|超越|
|TimeInterpolator|用于自定义|

## 2.3 估值器（Evaluators）
估值器，用于计算属性动画的给定属性的取值。与属性的起始值，结束值，`fraction`三个值相关。

|估值器|描述|
|---|---|
|IntEvaluator|整型|
|FloatEvaluator|浮点型|
|ArgbEvaluator|颜色|
|TypeEvaluator|自定义|


----------

> 参考：<http://developer.android.com/intl/zh-cn/guide/topics/graphics/prop-animation.html>