---
layout: post
title:  "Android动画之插值器（三）"
date:   2015-9-5 22:20:00
catalog:  true
tags:
    - android
    - 动画


----------

 >本文从源码的角度，来展开对动画的深入解析，关于动画基本用法，可查看[**Android动画之入门篇(一）**](http://gityuan.com/2015/09/03/android-anaimator-1/)，[**Android动画之入门篇（二）**](http://gityuan.com/2015/09/04/android-anaimator-2/)。 
   

关于动画有两个非常重要的类，那就是插值器(Interpolators)与 估值器（Evaluators），下面将详细讲解。

## 一、 插值器
时间插值器，定义了一个时间的函数：y = f(t),其中t=`elapsed time` / `duration`.  

每个插值器的源码流程都相同，下面以AccelerateInterpolator为例，说明插值器的内部原理：

	//系统自带的所有插值器都继承了BaseInterpolator
	public class AccelerateInterpolator extends BaseInterpolator implements NativeInterpolatorFactory {
	    private final float mFactor;
	    private final double mDoubleFactor;
	
	    //无参数的构造方法, factor默认为1
	    public AccelerateInterpolator() {
	        mFactor = 1.0f;
	        mDoubleFactor = 2.0;
	    }
	
	    //有参数的构造方法
	    public AccelerateInterpolator(float factor) {
	        mFactor = factor;
	        mDoubleFactor = 2 * mFactor;
	    }
	
	     //构造方法，通过资源文件获取参数
	    public AccelerateInterpolator(Context context, AttributeSet attrs) {
	        this(context.getResources(), context.getTheme(), attrs);
	    }
	
	    /** @hide 隐藏方法，真正用来解析资源文件的方法*/
	    public AccelerateInterpolator(Resources res, Theme theme, AttributeSet attrs) {
	        TypedArray a;
	        if (theme != null) {
	            a = theme.obtainStyledAttributes(attrs, R.styleable.AccelerateInterpolator, 0, 0);
	        } else {
	            a = res.obtainAttributes(attrs, R.styleable.AccelerateInterpolator);
	        }
	        
	        //资源文件未定义factor时，默认为1.0f
	        mFactor = a.getFloat(R.styleable.AccelerateInterpolator_factor, 1.0f);
	        mDoubleFactor = 2 * mFactor;
	        setChangingConfiguration(a.getChangingConfigurations());
	        // 回收TypedArray，释放相应的内存资源
	        a.recycle();
	    }
	    
	    //插值计算的核心方法，定义了插值的映射关系
	    public float getInterpolation(float input) {
	        if (mFactor == 1.0f) {
	            return input * input;
	        } else {
	            return (float)Math.pow(input, mDoubleFactor);
	        }
	    }
	
	    /** @hide */
	    @Override
	    public long createNativeInterpolator() {
	        return NativeInterpolatorFactoryHelper.createAccelerateInterpolator(mFactor);
	    }
	}
	
其中 `BaseInterpolaor`实现了`Interpolator`接口，而`Interpolator`接口并没有定义任何方法和属性，只是单纯地继承了`TimeInterpolator`

	abstract public class BaseInterpolator implements Interpolator {
	    private int mChangingConfiguration;
	    /**
	     * @hide
	     */
	    public int getChangingConfiguration() {
	        return mChangingConfiguration;
	    }
	
	    /**
	     * @hide
	     */
	    void setChangingConfiguration(int changingConfiguration) {
	        mChangingConfiguration = changingConfiguration;
	    }
	}

`TimeInterpolator`接口自定义了一个方法`getInterpolation`,这就是所有插值器最为核心的方法。

	public interface TimeInterpolator {

	    /*
	     * @param input 代表动画的已执行的时间，∈[0,1]
	     * @return 插值转换后的值
	     */
	    float getInterpolation(float input);
	}

通过分析每一个插值器的插值方法的源码，下面总结了所有插值器的插值函数：  

### 1.1 Linear
- 资源ID: @android:anim/linear_interpolator
- 构造方法：  
	- `public LinearInterpolator()`; //没有任何可调参数 

- 插值函数：
	- 公式：`y=t`
- 插值曲线：  
![Linear Interpolator](/images/interpolator/1.png)

### 1.2 Accelerate 
- 资源ID: @android:anim/accelerate_interpolator
- 构造方法：  
	- `public AccelerateInterpolator()`；//默认factor=1  
	- `public AccelerateInterpolator(float factor)`；    
	- `public AccelerateInterpolator(Context context, AttributeSet attrs)`; //通过资源文件获取factor值，默认为1。

- 插值函数：factor为加速因子，记为f, 默认值为1  
	- 公式：`y=t^(2f)`  
	- 缺省：`y=t^2`
- 插值曲线：  
![Accelerate Interpolator](/images/interpolator/2.png)

### 1.3 Decelerate
- 资源ID: @android:anim/decelerate_interpolator
- 构造方法：  
	- `public AccelerateInterpolator()`；//默认factor=1  
	- `public AccelerateInterpolator(float factor)`；    
	- `public AccelerateInterpolator(Context context, AttributeSet attrs)`; //通过资源文件获取factor值，默认为1。

- 插值函数：factor为减速因子，记为f, 默认值为1  
	- 公式：`y= 1-(1-t）^(2f)`,  
	- 缺省：`y= 2t-t^2`
- 插值曲线：  
![Decelerate Interpolator](/images/interpolator/3.png)

### 1.4 AccelerateDecelerate
- 资源ID: @android:anim/accelerate_decelerate_interpolator
- 构造方法：  
	- `public AccelerateDecelerateInterpolator()`；  //没有任何可调参数  
资源文件获取factor值。

- 插值函数：
	- 公式：`y = 0.5cos((t+1)π)+0.5` 
- 插值曲线：  
![AccelerateDecelerate Interpolator](/images/interpolator/4.png)


### 1.5 Anticipate
- 资源ID: @android:anim/anticipate_interpolator
- 构造方法：  
	- `public AnticipateInterpolator()`；//默认tension=2
	- `public AnticipateInterpolator(float tension)`；    
	- `public AnticipateInterpolator(Context context, AttributeSet attrs)`; //通过资源文件获取tension值。

- 插值函数：tension`为张力因子，记为s, 默认值为2  
	- 公式：`y = t*t*((s+1)t-s)`,  
	- 缺省：`y = t*t*(3t-2)`
- 插值曲线：  
![Anticipate Interpolator](/images/interpolator/5.png)


### 1.6 Overshoot
- 资源ID: @android:anim/overshoot_interpolator
- 构造方法：  
	- `public OvershootInterpolator()`；//默认tension=2
	- `public OvershootInterpolator(float tension)`；    
	- `public OvershootInterpolator(Context context, AttributeSet attrs)`; //通过资源文件获取tension值。

- 插值函数：tension`为张力因子，记为s, 默认值为2  
	- 公式：`y  = (t-1)(t-1)((s+1)(t-1)+s) + 1`,  
	- 缺省：`y = (t-1)(t-1)(3t-1) + 1`  
- 插值曲线：  
![ Overshoot Interpolator](/images/interpolator/6.png)

### 1.7 AnticipateOvershoot
- 资源ID: @android:anim/anticipate_overshoot_interpolator
- 构造方法：  
	- `public AnticipateOvershootInterpolator()`；//默认tension=3
	- `public AnticipateOvershootInterpolator(float tension)`； //tension = 1.5*tension
	- `public AnticipateOvershootInterpolator(float tension, float extraTension)`; //tension =  tension * extraTension
	- `public AnticipateOvershootInterpolator(Context context, AttributeSet attrs)`; //通过资源文件获取tension值。

- 插值函数：tension`为张力因子，记为s
	- 公式：
		- `y  = 2t*t*(2t*s+2t-s), 当t < 0.5时`,  
		- `y = 2(t-1)(t-1)(2(s+1)(t-1)+s) + 1 ,  当t >= 0.5时`, 
		
	- 缺省：
		- `y = 2t*t*(8t-3),  当t < 0.5时`,  
		- `y = 2(t-1)(t-1)(8t-5) + 1 ,  当t >= 0.5时`,  
- 插值曲线：  
![ AnticipateOvershoot Interpolator](/images/interpolator/7.png)


### 1.8 Bounce
- 资源ID: @android:anim/bounce_interpolator
- 构造方法：  
	- `public BounceInterpolator()`；//没有任何可调参数  

- 插值函数： 
	- 公式：   
        -  y = 8*(1.1226t)^2 ，当 t < 0.3535
        -  y = 8*(1.1226t - 0.54719)^2 + 0.7 ，当 t < 0.7408
        -  y = 8*(1.1226t - 0.8526)^2 + 0.9 ，当 t < 0.9644
        -  y = 8*(1.1226t - 1.0435)^2 + 0.95 ，当 t <= 1.0
- 插值曲线：  
![Bounce Interpolator](/images/interpolator/8.png)

### 1.9 Cycle
- 资源ID: @android:anim/cycle_interpolator
- 构造方法：  
	- `public CycleInterpolator(float cycles)`；    
	- `public CycleInterpolator(Context context, AttributeSet attrs)`; //通过资源文件获取cycles值，默认为1。

- 插值函数：cycles`为循环次数，记为c 
	- 公式：`y  = sin（2*c*t*π）`,  
	- 缺省：`y = sin（2*t*π）`  
- 插值曲线：  
![ Cycle Interpolator](/images/interpolator/9.png)

----------


## 二、 估值器
估值器，用于计算属性动画的给定属性的取值，与属性的起始值，结束值，`fraction`三个值相关。

每个估值器的源码流程都相似，所有的估值器都实现了TypeEvaluator接口，接口采用泛型，可自定义各种类型的估值器，只需实现如下接口即可：

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


### 2.1 IntEvaluator  
用于评估Integer型的属性值，起始值与结束值，以及evaluate返回值都是Integer类型。评估的返回值与fraction成一次函数，即线性关系。

	public class IntEvaluator implements TypeEvaluator<Integer> {
	
	    /**
	     * 函数关系：result = x0 + t * (x1 - x0)
	     *
	     * @param fraction   
	     * @param startValue 属性起始值，Integer类型
	     * @param endValue   属性结束值，Integer类型
	     * @return 与fraction成线性关系。
	     */
	    public Integer evaluate(float fraction, Integer startValue, Integer endValue) {
	        int startInt = startValue;
        	return (int)(startInt + fraction * (endValue - startInt));
	    }
	}


### 2.2 FloatEvaluator
用于评估Float型的属性值，起始值与结束值，以及evaluate返回值都是Float类型，同样也是线程关系。

	public class FloatEvaluator implements TypeEvaluator<Number> {
	
	    /**
	     * @param fraction   
	     * @param startValue 属性起始值，float类型
	     * @param endValue   属性结束值，float类型
	     * @return 与fraction成线性关系。
	     */
	    public Float evaluate(float fraction, Number startValue, Number endValue) {
        float startFloat = startValue.floatValue();
        return startFloat + fraction * (endValue.floatValue() - startFloat);
    }
	}

### 2.3 ArgbEvaluator
用于评估颜色的属性值，采用16进制。将ARGB四个量，同步进行动画渐变，同样也是采用线性的。

	public class ArgbEvaluator implements TypeEvaluator {
	    private static final ArgbEvaluator sInstance = new ArgbEvaluator();
	
	   /*
	    * @hide
	    *   貌似采用单例的方式，可该方法确实@hide隐藏方法，同时并没有将构造方法定义为private。
	    *   意味着单例对于上层开发者来说是不可见的，这样单例就没有起效果，google难道只是为了framework
	    *   的单例使用，很诡异的设计。
 	    */
	    public static ArgbEvaluator getInstance() {
	        return sInstance;
	    }
	
	    public Object evaluate(float fraction, Object startValue, Object endValue) {
	        int startInt = (Integer) startValue;
	        int startA = (startInt >> 24) & 0xff;
	        int startR = (startInt >> 16) & 0xff;
	        int startG = (startInt >> 8) & 0xff;
	        int startB = startInt & 0xff;
	
	        int endInt = (Integer) endValue;
	        int endA = (endInt >> 24) & 0xff;
	        int endR = (endInt >> 16) & 0xff;
	        int endG = (endInt >> 8) & 0xff;
	        int endB = endInt & 0xff;
	
	        return (int)((startA + (int)(fraction * (endA - startA))) << 24) |
	                (int)((startR + (int)(fraction * (endR - startR))) << 16) |
	                (int)((startG + (int)(fraction * (endG - startG))) << 8) |
	                (int)((startB + (int)(fraction * (endB - startB))));
	    }
	}

----------

## 三、小结
本文主要分两部分，插值器与估值器。通过源码方式概括性分析插值器的代码实现方式；再从数学角度，逐一进行剖析系统自带的9种插值器的插值函数以及其插值曲线。对于3种Evaluators，通过分析源码，其方式较为简单，需要注意的一点是evaluate中的fraction是插值器转换后的值，而不是`elapsed time`。