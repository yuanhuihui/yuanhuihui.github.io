---
layout: post
title:  "Android Launcher源码"
date:   2015-09-20 19:55:00
catalog:  true
tags:
    - android

---

## 一、引言

最近遇到同一芯片平台的两款手机，在桌面滑动跟手性为何还有所差异呢，于是乎研究了一下Launcher滑动相关源码。
本文主要是介绍Launcher3屏幕滑动过程，首先需要了解Android的触摸事件分发机制。关于分发机制，可查看文章[Android事件分发机制](http://gityuan.com/2015/09/19/android-touch/)。

#### 1.1 常用类简介

1. **Launcher.java:** launcher主要的activity，是launcher桌面第一次启动的activity.
2. **Workspace.java:** 抽象的桌面。由N个cellLayout组成,从cellLayout更高一级的层面上对事件的处理。
3. **PagedView.java:** 是workspace的父类，用来桌面的左右滑屏
4. **CellLayout.java：** 组成workspace的view,继承自viewgroup，既是一个dragSource，又是一个dropTarget,可以将它里面的item拖出去，也可以容纳拖动过来的item。在workspace_screen里面定了一些它的view参数。
5. **LauncherModel.java:** 辅助的文件。里面有许多封装的对数据库的操作。包含几个线程，其中最主要的是ApplicationsLoader和DesktopItemsLoader。ApplicationsLoader在加载所有应用程序时使用，DesktopItemsLoader在加载workspace的时候使用。其他的函数就是对数据库的封装，比如在删除，替换，添加程序的时候做更新数据库和UI的工作。
6. **LauncherProvider.java:** launcher的数据库，里面存储了桌面的item的信息。在创建数据库的时候会loadFavorites(db)方法，loadFavorites()会解析xml目录下的default_workspace.xml文件，把其中的内容读出来写到数据库中，这样就做到了桌面的预制。

#### 1.2 初始化参数
PagedView是滑屏最主要的类,下面是init()方法出初始化参数，假设以1080*1440分辨率，即densiy=3为例，来计算各个阈值。

    protected void init() {
        mDirtyPageContent = new ArrayList<Boolean>();
        mDirtyPageContent.ensureCapacity(32);
        mScroller = new LauncherScroller(getContext()); //初始化滚动器LauncherScroller
        setDefaultInterpolator(new ScrollInterpolator()); //设置插值器为ScrollInterpolator
        mCurrentPage = 0;
        mCenterPagesVertically = true;

        // 获取ViewConfiguration
        final ViewConfiguration configuration = ViewConfiguration.get(getContext());

        //mTouchSlop = 16dp；
        mTouchSlop = configuration.getScaledPagingTouchSlop();
        //mPagingTouchSlop = 16dp;
        mPagingTouchSlop = configuration.getScaledPagingTouchSlop();
        //最大速度8000dp/s;
        mMaximumVelocity = configuration.getScaledMaximumFlingVelocity();
        //获取屏幕密度系数mDensity
        mDensity = getResources().getDisplayMetrics().density;

        //用于删除的抛出阈值: -1440*3
        mFlingToDeleteThresholdVelocity =
                (int) (mFlingToDeleteThresholdVelocity * mDensity);

        //滚动速度阈值 500 *3 px/s
        mFlingThresholdVelocity = (int) (FLING_THRESHOLD_VELOCITY * mDensity);
        //最小滚动速度值 250 *3  px/s
        mMinFlingVelocity = (int) (MIN_FLING_VELOCITY * mDensity);
        //最小snap速度值1500 *3 px/s
        mMinSnapVelocity = (int) (MIN_SNAP_VELOCITY * mDensity);
        setOnHierarchyChangeListener(this);
    }

下面主要讲述：Workspace，PagedView 这两个关于滑屏最为核心的类，也是代码量最大的类。

## 二、滑动原理
先来看看launcher桌面的整体UI布局图：

![launcher ui](/images/launcher/1.png)

手指在Launcher上滑动分为三个阶段：手指按下，手指滑动，手指离开。

#### 2.1 手指按下
当手指按下时，触发ACTION_DOWN事件，由Activity

![launcher_down](/images/launcher/launcher_down.jpg)

当手指按下时，还没有准备滚动，此时`mTouchState = TOUCH_STATE_REST`，故Worksapce，PagedView并不会拦截事件，虽然没有拦截器进行拦截，也没有onTouchEvent消费，但由于CellLayout的clickable="true"，故ACTION_DOWN事件仍然是被消费了，具体说明见上一篇文章[Android事件分发机制](http://gityuan.com/2015/09/19/android-touch/).

#### 2.2 手指移动：

![launcher_move](/images/launcher/launcher_move.jpg)

决定屏幕是否开始滑动的阈值计算：

```Java
mTouchSlop = configuration.getScaledPagingTouchSlop()
mTouchSlop = res.getDimensionPixelSize(
            com.android.internal.R.dimen.config_viewConfigurationTouchSlop)*2;
```

常量定义在文件data/res/values/config.xml中`<dimen name="config_viewConfigurationTouchSlop">8dp</dimen>`。
故**mTouchSlop** = 8dp * 2 = 16dp，这是系统默认值。

当手指移动距离>mTouchSlop时，Wokespace开始拦截ACTION_MOVE事件，并调用scrollBy(),**这是整个过程第一次屏幕移动**。每收到一次ACTION_MOVE事件，并执行scrollBy()事件，直到用户手指离开屏幕。scrollBy()事件最终调用的是View.scrollTo()来进行屏幕的滚动操作。

#### 2.3 手指离开

![launcher_up](/images/launcher/launcher_up.jpg)

达到下面两种情况之一，都可以触发launcher滑屏事件:

1) 当滑动距离超过屏幕宽度的0.4倍,SIGNIFICANT_MOVE_THRESHOLD = 0.4

```Java
boolean isSignificantMove = Math.abs(deltaX) > pageWidth * SIGNIFICANT_MOVE_THRESHOLD;
```

2) 当速度大于500dp/s, 且滑动距离大于 25px

```Java
boolean isFling = mTotalMotionX > MIN_LENGTH_FOR_FLING &&  Math.abs(velocityX) > mFlingThresholdVelocity;
```

当满足屏幕翻页的条件时，开始执行翻页动画，通过插值器ScrollInterpolator来计算每一步需要移动的距离。
插值函数为：`f(t)=1+(t-1)^5`。不断循环，直到timePassed > mDuration时，动画结束。

## 三、源码分析

#### 3.1 determineScrollingStart滑动检测

用于判断是否进行滑动操作

    protected void determineScrollingStart(MotionEvent ev, float touchSlopScale) {
        final int pointerIndex = ev.findPointerIndex(mActivePointerId);
        if (pointerIndex == -1) return;

        final float x = ev.getX(pointerIndex);
        final float y = ev.getY(pointerIndex);
        if (!isTouchPointInViewportWithBuffer((int) x, (int) y)) return;

        final int xDiff = (int) Math.abs(x - mLastMotionX);
        final int yDiff = (int) Math.abs(y - mLastMotionY);

        final int touchSlop = Math.round(touchSlopScale * mTouchSlop);
        boolean xPaged = xDiff > mPagingTouchSlop;
        boolean xMoved = xDiff > touchSlop;
        boolean yMoved = yDiff > touchSlop;

        //当滑动距离足够时，才开始滑动
        if (xMoved || xPaged || yMoved) {
            if (mUsePagingTouchSlop ? xPaged : xMoved) {
                // Scroll if the user moved far enough along the X axis
                mTouchState = TOUCH_STATE_SCROLLING;
                mTotalMotionX += Math.abs(mLastMotionX - x);
                mLastMotionX = x;
                mLastMotionXRemainder = 0;
                mTouchX = getViewportOffsetX() + getScrollX();
                mSmoothingTime = System.nanoTime() / NANOTIME_DIV;
                onScrollInteractionBegin();
                pageBeginMoving();
            }
        }
    }

#### 3.2 snapToPage滑屏方法

手指离开屏幕后，调用的滑动动画的方法

    protected void snapToPage(int whichPage, int delta, int duration, boolean immediate,
                              TimeInterpolator interpolator) {

        whichPage = validateNewPage(whichPage);

        mNextPage = whichPage;
        View focusedChild = getFocusedChild();
        if (focusedChild != null && whichPage != mCurrentPage &&
                focusedChild == getPageAt(mCurrentPage)) {
            focusedChild.clearFocus();
        }

        sendScrollAccessibilityEvent();

        pageBeginMoving();
        awakenScrollBars(duration);
        if (immediate) {
            duration = 0;
        } else if (duration == 0) {
            duration = Math.abs(delta);
        }

        if (!mScroller.isFinished()) {
            abortScrollerAnimation(false);
        }

        if (interpolator != null) {
            mScroller.setInterpolator(interpolator);
        } else {
            // 插值器为ScrollInterpolator
            mScroller.setInterpolator(mDefaultInterpolator);
        }

        //这个整个滑动的开始点
        mScroller.startScroll(mUnboundedScrollX, 0, delta, 0, duration);

        updatePageIndicator();

        // Trigger a compute() to finish switching pages if necessary
        if (immediate) {
            computeScroll();
        }

        // Defer loading associated pages until the scroll settles
        mDeferLoadAssociatedPagesUntilScrollCompletes = true;

        mForceScreenScrolled = true;
        invalidate();
    }

#### 3.3 ScrollInterpolator插值器

滑屏时的插值器

    private static class ScrollInterpolator implements Interpolator {
        public ScrollInterpolator() {
        }

        public float getInterpolation(float t) {
            t -= 1.0f;
            return t * t * t * t * t + 1;
        }
    }


#### 3.4 LauncherScroller滑动器
launcher桌面的滑动器

```Java
    mDeceleration = computeDeceleration(ViewConfiguration.getScrollFriction());
    mPhysicalCoeff = computeDeceleration(0.84f); // look and feel tuning

    //计算 pixels/(s^2)
    private float computeDeceleration(float friction) {
        return SensorManager.GRAVITY_EARTH   // g (m/s^2)
                      * 39.37f               // inch/meter
                      * mPpi                 // pixels per inch
                      * friction;
    }

    //获取速度
    public float getCurrVelocity() {
        return mMode == FLING_MODE ?
                mCurrVelocity : mVelocity - mDeceleration * timePassed() / 2000.0f;
    }
```

#### 3.5 computeScroll
computeScroll()：重写了父类的computeScroll()；主要功能是计算拖动的位移量、更新背景、设置要显示的屏幕

## 四、总结

从芯片平台CPU、内存大小、驱动、Framework等角度对比都没有差异的情况下，通过研究Laucher滑动机制，发现这两款手机动画插值器也一致。
从文章[dp、sp与px关系](http://gityuan.com/2015/09/02/Android-multi-screen-adapter/)中，可得知1dp在物理上是固定的，
1dp约等于1/160英寸，而px则是受屏幕的dpi影响，这就对滑动触发时机有略有影响，这只有敏感度极高的人才能感受到差异。
