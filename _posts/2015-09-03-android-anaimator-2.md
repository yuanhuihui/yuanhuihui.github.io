---
layout: post
title:  "Android动画系列（二）"
date:   2015-9-3 20:20:00
categories: android
excerpt:  Android属性动画
---

* content
{:toc}



----------

 >本文重点讲述属性动画，关于逐帧动画与补间动画，可查看上一篇文章[**Android动画系列（一）**](http://yuanhuihui.github.io/2015/09/03/android-anaimator-1/)。 
   
属性动画功能非常强大，也是最常用的动画方法。可自定义如下属性：  

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
  
`ValueAnimator`记录动画的运行时间，位移，当前将要绘制的属性。以及
`TimeInterpolator`时间插值器，`TypeEvaluator`估值器。例如，图2的时间插值器是`AccelerateDecelerateInterpolator`, 估值器是`IntEvaluator`。  
  
属性动画设置好起始值和结束值，执行总时间等参数。当调用`start()`动画开始， 在整个动画期间，`ValueAnimator`计算已绘制的时间比(elapsed fraction)，区间[0,1]，代表动画的完成率，0表示0%，1表示100%。动画运行过程中，通过调用`onAnimationUpdate`方法来更新画面，`getAnimatedValue()`获取当前动画的property。

## 二、分析

### 2.1 动画类（Animators）
 `Animator`类提供了关于创造动画的一系列基本的结构，是一个抽象类，主要使用其子类。

#### 2.1.1 `ValueAnimator`	
ValueAnimator是整个属性动画框架的核心类，使用方法如下：
	
	ValueAnimator valueAnim = ValueAnimator.ofFloat(0f, 1f);
	valueAnim.setDuration(250);	
	fadeAnim.start();

再通过动画的`AnimatorUpdateListener`获取动画每一帧的返回值，如果有需要还可以增加`AnimatorListenerAdapter`来指定动画开始、结束、取消、重复等事件发生时的处理方法。

	valueAnim.addUpdateListener(new AnimatorUpdateListener() {
		@Override
	        public void onAnimationUpdate(ValueAnimator animation) {
			int frameValue = (Integer)animation.getAnimatedValue();
			//根据frameValue指定相应的透明度，位移，旋转，缩放等相应的动画
			balls.setAlpha(frameValue);
			
		}
	});
	
	valueAnim.addListener(new AnimatorListenerAdapter() {
		public void onAnimationEnd(Animator animation) {
			//当动画结束时移除相应对象
		    balls.remove(((ObjectAnimator)animation).getTarget());
		}
	});

#### 2.1.2 `ObjectAnimator`
对象动画，继承`ValueAnimator`, 允许指定`target object`，并且`target object`需要有setter方法。  

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
时间插值器，定义了一个时间的映射关系，可能为如下的插值器：


|插值器|描述|
|---|---|
|LinearInterpolator|线性插值|
|AccelerateInterpolator |加速|
|DecelerateInterpolator |减速|
|AccelerateDecelerateInterpolator |先加速，后减速|
|AnticipateInterpolator|先向后，再向前抛向终点|
|OvershootInterpolator|向前抛出终点，再回到终点|
|AnticipateOvershootInterpolator|先向后，再向前抛出终点，再回到终点|
|BounceInterpolator|结束时反弹|
|CycleInterpolator|循环播放|
|TimeInterpolator|用于自定义|

所有插值器都实现了TimeInterpolator接口，需要自定义插值器，只需实现如下接口：

	public interface TimeInterpolator {

	    /*
	     * @param input 代表动画的已执行的时间，∈[0,1]
	     * @return 插值转换后的值
	     */
	    float getInterpolation(float input);
	}

## 2.3 估值器（Evaluators）
估值器，用于计算属性动画的给定属性的取值。与属性的起始值，结束值，`fraction`三个值相关。

|估值器|描述|
|---|---|
|IntEvaluator|用于评估int型的属性值|
|FloatEvaluator|用于评估float型的属性值|
|ArgbEvaluator|用于评估颜色的属性值，采用16进制|
|TypeEvaluator|用于自定义估值器的接口|

所有的估值器都实现了TypeEvaluator接口，自定义估值器，只需实现如下接口：

	public interface TypeEvaluator<T> {
	    /*
	     *
	     * @param fraction   插值器计算转换后的值
	     * @param startValue 属性起始值
	     * @param endValue   属性结束值
	     * @return 转换后的值
	     */
	    public T evaluate(float fraction, T startValue, T endValue);
	}

----------

## 小结

相信读者，通过阅读动画入门这两篇文章，对逐帧动画，补间动画，属性动画有了一个大致的概念与理解。  
如果有兴趣深入了解动画的机制，可查看[**Android动画系列（三）**](http://yuanhuihui.github.io/2015/09/04/android-anaimator-3/)，从源码的视角来进一步阐述动画的原理。

> 参考：<http://developer.android.com/intl/zh-cn/guide/topics/graphics/prop-animation.html>