---
layout: post
title:  "Android三种动画实现"
date:   2015-09-04 19:00:00
catalog:    true
tags:
    - android


---

> 作为Android开发者，动画是非常重要的知识点，本文主要从入门角度来探索动画。

## 一、概述

Android的动画主要包括三大类：逐帧动画Frame、补间动画Tween、属性动画，其中属性动画功能非常强大，也是最常用的动画方法。
下面先列举一下这3类动画的实例代码，已形成初步印象：

```Java
//逐帧动画，需资源文件frame_animation.xml
ImageView img = (ImageView)findViewById(R.id.wheel_image);
img.setBackgroundResource(R.drawable.frame_animation);
AnimationDrawable frameAnimation = (AnimationDrawable) img.getBackground();
frameAnimation.start();

//补间动画，需资源文件tween_animation.xml
ImageView img = (ImageView)findViewById(R.id.wheel_image);
Animation tweenAnimation = AnimationUtils.loadAnimation(this, R.anim.tween_animation);
img.startAnimation(tweenAnimation);

// 属性动画，不需资源文件
ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f);
anim.setDuration(1000);
anim.start();
```

接下来，再来细说各种动画。

## 二、逐帧动画Frame

逐帧动画是最容易理解，最简单的动画。但需要把动画过程的每一帧静态图片都放到资源文件夹`res/drawbale`下，然后由Android来控制依次显示这些静态图片，利用人眼“视觉暂留”的原理，从而产生“动画”的错觉。实现方式与电影、动漫的原理一样。

每一帧的图片，可以是比如.jpg, .png格式的图片文件，也可以是通过xml定义的图形。下面通过一个实例来讲解逐帧动画的使用。

#### 2.1 动画资源文件

`frame_animation.xml`放在文件夹`res/drawable/`下，该逐帧动画包含3张图片wheel0.png, wheel1.png, wheel2.png:

     <animation-list android:id="@+id/selected" android:oneshot="false">
        <item android:drawable="@drawable/wheel0" android:duration="50" />
        <item android:drawable="@drawable/wheel1" android:duration="50" />
        <item android:drawable="@drawable/wheel2" android:duration="50" />
     </animation-list>

#### 2.2 代码实现

     ImageView img = (ImageView)findViewById(R.id.wheel_image);
     img.setBackgroundResource(R.drawable.frame_animation);
     AnimationDrawable frameAnimation = (AnimationDrawable) img.getBackground();
     frameAnimation.start();

**参数说明**

- android:oneshot， 其值为true则动画只播放一遍, false则循环播放;
- android:duration，代表该帧时长，单位ms(毫秒)。


## 三、补间动画Tween

补间动画，只需指定动画开始帧、结束帧，而对于动画中间的过程，都有系统计算来填充的，而无需定义中间的每一帧。
动画变化主要包括4类型： 

- Alpha：透明度动画
- Scale：缩放动画
- Translate：位移动画
- RotateAnaimation：旋转动画

#### 3.1 动画资源文件

`tween_animation.xml`放在文件夹`res/anim/`下, 该动画同时包括透明度，缩放，位移，旋转4种变化，当然也可以是其中一种，或几种变化的组合。

```Java
<?xml version="1.0" encoding="utf-8"?>
<set xmlns:android="http://schemas.android.com/apk/res/android"
    android:interpolator="@[package:]anim/interpolator_resource"
    android:shareInterpolator="true">

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
</set>
```

#### 3.2 代码实现

     ImageView img = (ImageView)findViewById(R.id.wheel_image);
     Animation tweenAnimation = AnimationUtils.loadAnimation(this, R.anim.tween_animation);
     img.startAnimation(tweenAnimation);

#### 3.3 参数说明

- android:interpolator 插值器，指定动画的效果，见[**Android动画插值器**](http://gityuan.com/2015/09/05/android-anaimator-3/)；
- android:shareInterpolator， true：所有子元素共享同一插值器；false不共享；
- android:fillBefore， true：动画执行完成后停留在动画的第一帧；
- android:fillAfter ， true：动画执行完成后停留在动画的最后一帧；
- android:fillEnabled，true：fillBefore/fillAfter才能生效
- android:duration， 动画持续时长，每一个动画都可以单独指定duration，单位ms(毫秒)

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


## 四、属性动画

属性动画，是补间动画的增强版，但更加灵活。可直接修改任何属性，使之形成动画，功能非常强大，也是最常用的动画。
属性动画自定义如下属性：

- 动画时间（Duration）：指定动画总共完成所需要的时间，默认为300ms;
- 时间插值器（Time interpolation）： 是一个基于当前动画已消耗时间的函数，用来计算属性的值；
- 重复次数（Repeat count）：指定动画是否重复执行，重复执行的次数，也可以指定动画向反方向地回退操作；
- 动画集（Animator sets）：将一系列动画放进一个组，可以设置同时执行或者按序执行；
- 延迟刷新时间（Frame refresh delay）：指定动画刷新的频率，默认为每10ms刷新一帧，但应用程序的帧的刷新频率最终取决于整个系统的忙闲程序与系统的时钟频率。


### 4.1 属性动画类

![animations work](/images/animator/3.jpg)

上图描述了属性动画在绘制动画过程的相关类：

- ValueAnimator：记录动画的运行时间，位移，当前将要绘制的属性
- TimeInterpolator：时间插值器，用于根据随着时间的变化来计算当前属性变化的百分比
- TypeEvaluator：估值器，用于根据属性改变的百分比来计算改变后的属性值

属性动画设置好起始值和结束值，执行总时间等参数。当调用start()动画开始， 在整个动画期间，ValueAnimator计算已绘制的时间比(elapsed fraction)，区间[0,1]，代表动画的完成率。动画运行过程中，通过调用onAnimationUpdate方法来更新画面，getAnimatedValue()获取当前动画的property。

#### 4.1.1 ValueAnimator
Animator类提供了关于创造动画的一系列基本的结构，是一个抽象类。ValueAnimator是整个属性动画框架的核心类，使用方法如下：

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

#### 4.1.2 ObjectAnimator
对象动画，继承`ValueAnimator`, 允许指定`target object`，并且`target object`需要有setter方法。

    ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f);
    anim.setDuration(1000);
    anim.start();

#### 4.1.3 AnimatorSet
动画的集合，用于组合一系列动画。

    AnimatorSet  animatorSet = new AnimatorSet();
    animatorSet.play(bounceAnim).before(squashAnim1);
    animatorSet.play(squashAnim1).with(squashAnim2);
    animatorSet.play(bounceBackAnim).after(stretchAnim2);
    animatorSet.start();

### 4.2 代码实现

    // 属性动画，不需资源文件
    ObjectAnimator anim = ObjectAnimator.ofFloat(targetObject, "alpha", 0f, 1f);
    anim.setDuration(1000);
    anim.start();
    
### 4.3 插值器（Interpolators）
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

想要更加深入地了解插值器，可查看[**Android动画插值器**](http://gityuan.com/2015/09/05/android-anaimator-3/)。

### 4.4 估值器（Evaluators）
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

## 五、小结

相信读者，通过阅读动画入门这两篇文章，对逐帧动画，补间动画，属性动画有了一个大致的概念与理解，能明白动画的基本用法。
相关资料：<http://developer.android.com/intl/zh-cn/guide/topics/graphics/prop-animation.html>

如果有兴趣深入了解动画的机制，可查看[**Android动画之原理篇（四）**](http://gityuan.com/2015/09/06/android-anaimator-4/)，从源码的视角来进一步阐述动画的原理。
