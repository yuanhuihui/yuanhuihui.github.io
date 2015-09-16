---
layout: post
title:  "Android动画之入门篇（一）"
date:   2015-9-3 20:10:00
categories: android
excerpt:  Android动画入门
---

* content
{:toc}

----------

>作为Android开发者，动画是非常重要的知识点，本文主要从入门角度来探索动画。  
Android的动画主要包括三大类：**逐帧（Frame）动画**，**补间（Tween）动画**，**属性动画**。

## 1. 逐帧（Frame）动画  

逐帧动画是最容易理解，最简单的动画。但需要把动画过程的每一帧静态图片都放到资源文件夹`res/drawbale`下，然后由Android来控制依次显示这些静态图片，利用人眼“视觉暂留”的原理，从而产生“动画”的错觉。实现方式与电影、动漫的原理一样。  
  
每一帧的图片，可以是比如.jpg, .png格式的图片文件，也可以是通过xml定义的图形。下面通过一个实例来讲解逐帧动画的使用。

**1.1 动画资源文件**   

`frame_animation.xml`放在文件夹`res/drawable/`下，该逐帧动画包含3张图片wheel0.png, wheel1.png, wheel2.png:

	 <animation-list android:id="@+id/selected" android:oneshot="false">
	    <item android:drawable="@drawable/wheel0" android:duration="50" />
	    <item android:drawable="@drawable/wheel1" android:duration="50" />
	    <item android:drawable="@drawable/wheel2" android:duration="50" />
	 </animation-list>

**1.2 调用方法**  

	 ImageView img = (ImageView)findViewById(R.id.wheel_image);
	 img.setBackgroundResource(R.drawable.frame_animation);
	 AnimationDrawable frameAnimation = (AnimationDrawable) img.getBackground();
	 frameAnimation.start();

**1.3 参数说明**

- android:oneshot,  true：动画只播放一遍, false：循环播放;  
- android:duration：该帧时长，单位ms(毫秒)。


----------


## 2. 补间（Tween）动画  

补间动画，只需指定动画开始帧、结束帧，而对于动画中间的过程，都有系统计算来填充的，而无需定义中间的每一帧。  
动画变化主要包括4类型： 透明度动画(`Alpha`)，缩放动画(`Scale`)，位移动画(`Translate`)，旋转动画(`RotateAnaimation`)

**1.1 动画资源文件**   

`tween_animation.xml`放在文件夹`res/anim/`下, 该动画同时包括透明度，缩放，位移，旋转4种变化，当然也可以是其中一种，或几种变化的组合。

	<?xml version="1.0" encoding="utf-8"?>  
	<set xmlns:android="http://schemas.android.com/apk/res/android"  
		android:interpolator="@[package:]anim/interpolator_resource"  
		android:shareInterpolator=["true" | "false"] >  

		<alpha  
			android:fromAlpha="0.5"  
			android:toAlpha="1.0"
			android:duration="1000" />

		<scale  
			android:fromXScale="0.01"  
			android:toXScale="1.0"  
			android:fromYScale="0.01"  
			android:toYScale="1.0"  
			android:pivotX="50%"  
			android:pivotY="50%"
			android:fillAfter="true" />  

		<translate  
			android:fromXDelta="0.01"  
			android:toXDelta="0.95"  
			android:fromYDelta="0.01"  
			android:toYDelta="0.95" />  

		<rotate  
			android:fromDegrees="0.01"  
			android:toDegrees="360"  
			android:pivotX="50%"  
			android:pivotY="50%" />  
	<set>

**1.2 调用方法**  

	 ImageView img = (ImageView)findViewById(R.id.wheel_image);
	 Animation tweenAnimation = AnimationUtils.loadAnimation(this, R.anim.tween_animation);
	 img.startAnimation(tweenAnimation);

**1.3 参数说明**

- android:interpolator   插值器，用于指定动画的效果; 插值器原理，请移步[**Android动画之原理篇（三）**](http://www.yuanhh.com/2015/09/05/android-anaimator-3/)；
- android:shareInterpolator， true：所有子元素共享同一插值器；false不共享；
- android:fillBefore， true：动画执行完成后停留在动画的第一帧；
- android:fillAfter ， true：动画执行完成后停留在动画的最后一帧；
- android:fillEnabled，true：fillBefore/fillAfter才能生效
- android:duration， 动画持续时长，每一个动画都可以单独指定duration；  

- **alpha，透明度动画，其中0表示完全透明，1表示完全不透明：**
	- fromAlpha： 起始透明度
	- toAlpha  ： 结束透明度  
  
- **scale，缩放动画，其中0表示收缩到无，1表示正常无缩放：**
	- fromXScale： 起始X坐标的缩放比例
	- toXScale  ： 结束X坐标的缩放比例
	- fromYScale： 起始Y坐标的缩放比例
	- toYScale  ： 结束Y坐标的缩放比例
	- pivotX    ： 轴中点X坐标的位置比例
	- pivotY    ： 轴中点Y坐标的位置比例
  
  
- **translate，位移动画：**
	- fromXDelta： 起始X方向位置比例
	- toXDelta  ： 结束X方向位置比例
	- fromYDelta： 起始Y方向位置比例
	- toYDelta  ： 结束Y方向位置比例

- **rotate， 旋转动画：**
	- fromDegrees： 起始角度，单位度
	- toDegrees  ： 结束角度，单位度
	- pivotX    ： 旋转中点X坐标的位置比例
	- pivotY    ： 旋转中点Y坐标的位置比例


----------

## 3. 属性动画

属性动画，是补间动画的增强版，但更加灵活。可直接修改任何属性，使之形成动画，功能非常强大，也是最常用的动画。**下面举个简单的例子:**

	ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f);
	anim.setDuration(1000);
	anim.start();

关于属性动画的详细介绍在下一篇文章中，详细介绍[**Android动画之入门篇（二）**](http://www.yuanhh.com/2015/09/04/android-anaimator-2/)