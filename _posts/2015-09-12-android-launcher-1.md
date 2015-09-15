---
layout: post
title:  "Android Launcher原理分析"
date:   2015-9-12 20:10:00
categories: android
excerpt:  Android Launcher原理
---

* content
{:toc}

----------

## 原理
Launcher3屏幕滑动，主要需要关注的类为 Launcher, PagedView, Workspace。
 其中第一次启动activity是Launcher.java，PagedView是 workspace的父类，用来桌面的左右滑屏。关于滑动过程，首先需要了解Android的触摸事件流程。关于触摸流程，可查看文章[Android Touch事件流程](http://www.yuanhh.com/2015/08/20/android-touch/).

部分常量参数

	public static final int ACTION_DOWN             = 0;  
	public static final int ACTION_UP               = 1;  
	public static final int ACTION_MOVE             = 2;  


    protected final static int TOUCH_STATE_REST = 0;
    protected final static int TOUCH_STATE_SCROLLING = 1;
    protected final static int TOUCH_STATE_PREV_PAGE = 2;
    protected final static int TOUCH_STATE_NEXT_PAGE = 3;
    protected final static int TOUCH_STATE_REORDERING = 4;

屏幕 mDensity = getResources().getDisplayMetrics().density;

ViewConfiguration类中开始滚动的阈值是通过：  
文件data/res/values/config.xml中<dimen name="config_viewConfigurationTouchSlop">8dp</dimen>位
config_viewConfigurationTouchSlop的2倍。


### 1. 参数初始化:  
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


### 2.滑动流程：  

#### 1. 手指按下：  
Workspace.onInterceptTouchEvent()，return false.  
↓  
PagedView.onInterceptTouchEvent(), return false.  
↓  
Workspace.onTouch()，return false.  是由CellLayout调用。  
↓    

#### 2. 手指屏幕移动：  
Workspace.onInterceptTouchEvent()，return false.  
↓  
PagedView.onInterceptTouchEvent(), return false.  
↓  
Workspace.determineScrollingStart()  
↓  
PagedView.determineScrollingStart()  
当移动距离> mTouchSlop时， mTouchState = TOUCH_STATE_SCROLLING;  
↓  
Workspace.onInterceptTouchEvent()，return false.  
↓  
PagedView.onInterceptTouchEvent(), return true. 事件拦截
↓  
PagedView.onTouchEvent().  循环处理Touch_move事件，直到手指抬起  
↓    
PagedView.scrollBy((int) deltaX, 0);  滚动操作. **这是整个过程第一次屏幕移动**。
↓   

#### 3. 手指离开屏幕  
达到下面两种情况之一，都可以触发launcher滑屏事件:  

- 滑动距离超过屏幕宽度的0.4倍,SIGNIFICANT_MOVE_THRESHOLD = 0.4
    `boolean isSignificantMove = Math.abs(deltaX) > pageWidth * SIGNIFICANT_MOVE_THRESHOLD;` 

- 速度 大于500dp/s, 且滑动距离大于 25px。  
   `boolean isFling = mTotalMotionX > MIN_LENGTH_FOR_FLING &&  Math.abs(velocityX) > mFlingThresholdVelocity;`

**进入滑屏分支**  
SmoothPagedView.snapToPageWithVelocity(finalPage, velocityX);  
↓  
PagedView.snapToPageWithVelocity(finalPage, velocityX);  
↓  
PagedView.snapToPage(whichPage, delta, duration);计算需要滑动的距离`delta`,与滑动的时间`duration`  
↓  
LauncherScroller.startScroll(mUnboundedScrollX, 0, delta, 0, duration);  
↓  
PagedView.invalidate(); view重绘  
↓  
SmoothPagedView.computeScroll()；  
↓  
PagedView.computeScroll()；  
↓  
PagedView.computeScrollHelper()；  
↓  
PagedView.scrollTo()；  
↓  
PagedView.invalidate()； 不断循环，直到timePassed > mDuration, 跳出循环。

## 部分源码

#### 1. determineScrollingStart滑动检测 

	protected void determineScrollingStart(MotionEvent ev, float touchSlopScale) {
        // Disallow scrolling if we don't have a valid pointer index
        final int pointerIndex = ev.findPointerIndex(mActivePointerId);
        if (pointerIndex == -1) return;

        // Disallow scrolling if we started the gesture from outside the viewport
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

#### 2. snapToPage滑屏方法  

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

#### 3.ScrollInterpolator插值器

    private static class ScrollInterpolator implements Interpolator {
        public ScrollInterpolator() {
        }

        public float getInterpolation(float t) {
            t -= 1.0f;
            return t * t * t * t * t + 1;
        }
    }

#### 4. LauncherScroller滑动器
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

### 小结
待续
