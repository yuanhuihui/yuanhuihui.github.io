---
layout: post
title:  "Android事件分发机制"
date:   2015-09-19 1:05:00
categories:  Android
excerpt:  Android事件分发机制
---

* content
{:toc}

---

> 本文源码来自andorid sdk 22，不同版本会有细微差别，但核心机制是一致的

## 概述

在开始讲述touch事件流程之前，还简单介绍下TouchEvent,View和ViewGroup。

### 1. MotionEvent对象

- **1.1**  整个事件分发流程中，会有大量MotionEvent对象，该对象用于记录所有与移动相关的事件，比如手指触摸屏幕事件。
- **1.2**  一次完整的MotionEvent事件，是从用户触摸屏幕到离开屏幕。整个过程的动作序列：ACTION_DOWN(1次)  ->  ACTION_MOVE(N次)  ->  ACTION_UP(1次), 
- **1.3**  多点触摸，每一个触摸点`Pointer`会有一个id和index。对于多指操作，通过pointerindex来获取指定Pointer的触屏位置。比如，对于单点操作时获取x坐标通过`getX()`，而多点操作获取x坐标通过`getX(pointerindex)`

### 2. View
- **2.1**  View是所有视图对象的父类，实现了动画相关的`Drawable.Callback`接口， 按键相关的`KeyEvent.Callback`接口， 交互处理相关的`AccessibilityEventSource`接口。比如Button继承自View。
- **2.2**  TouchEvent事件处理相关的方法：
	- dispatchTouchEvent(MotionEvent event)
	- onTouchEvent(MotionEvent event)
  
### 3. ViewGroup
- **3.1**  ViewGroup，是一个`abstract`类，一组View的集合，可以包含View和ViewGroup,是所有布局的父类或间接父类。继承了`View`，实现了`ViewParent`（用于与父视图交互的接口）， `ViewManager`（用于添加、删除、更新子视图到Activity的接口）。比如常用的LinearLayout，RelativeLayout都是继承自ViewGroup。  
- **3.2**  TouchEvent事件处理相关的方法：
	- dispatchTouchEvent(MotionEvent event)
	- onInterceptTouchEvent(MotionEvent ev)
	- onTouchEvent(MotionEvent event)
	
### 4. Activity
- **4.1**  Activity是Android四大基本组件之一，这里只介绍Activity与touch相关的方法。当手指触摸到屏幕时，屏幕硬件一行行不断地扫描每个像素点，获取到触摸事件后，从底层产生中断上报。再通过native层调用Java层InputEventReceiver中的dispatchInputEvent方法。经过层层调用，交由Activity的`dispatchTouchEvent`方法来处理。
- **4.2** TouchEvent事件处理相关的方法：
	- dispatchTouchEvent(MotionEvent event)
	- onTouchEvent(MotionEvent event)
  

## 分发流程

**1. Activity.dispatchTouchEvent()**  

这是Touch事件传递到上层的第一个处理方法，是由触屏事件调用。如果重写该方法，则会在分发事件之前拦截所有的触摸事件。源码如下：

    public boolean dispatchTouchEvent(MotionEvent ev) {
        if (ev.getAction() == MotionEvent.ACTION_DOWN) {
            //第一次按下操作时，用户希望能与设备进行交互，可通过实现该方法
            onUserInteraction();
        }
        
        //获取当前Activity的顶层窗口是PhoneWindow
        if (getWindow().superDispatchTouchEvent(ev)) { //见代码(1.1)
            return true;
        }
        //当没有任何view处理时，交由activity的onTouchEvent处理
        return onTouchEvent(ev); // 见代码(1.2)
    }

**1.1 PhoneWindow.superDispatchTouchEvent()**  

PhoneWindow的最顶View是DecorView，再交由DecorView处理。而DecorView的间距父类是ViewGroup,接着调用
ViewGroup.dispatchTouchEvent()方法。为了精简篇幅，有些中间函数调用不涉及关键逻辑，可能会直接跳过。 

	public boolean superDispatchTouchEvent(KeyEvent event) {
        return mDecor.superDispatcTouchEvent(event); // 见代码(2)
    }
**1.2 Activity.onTouchEvent()**   

    public boolean onTouchEvent(MotionEvent event) {
        //当窗口需要关闭时，消费掉当前event
        if (mWindow.shouldCloseOnTouch(this, event)) {
            finish();
            return true;
        }

        return false;
    }

**2. ViewGroup.dispatchTouchEvent()**
这是整个touch事件流程中，最核心的方法，涵盖了大部分的事件分发的逻辑，这个方法由200多行（这么冗长的方法，阅读起来很费劲，google你这是故意的么），言归正传，下面重点讲解。

	@Override
    public boolean dispatchTouchEvent(MotionEvent ev) {
        
        if (mInputEventConsistencyVerifier != null) {
            //用于Debug，通知verifier来检查Touch事件
            mInputEventConsistencyVerifier.onTouchEvent(ev, 1);
        }

        // 当事件targets能够聚焦视图，开始常规的事件分发。可能后续会处理点击。
        if (ev.isTargetAccessibilityFocus() && isAccessibilityFocusedViewOrHost()) {
            ev.setTargetAccessibilityFocus(false);
        }

        boolean handled = false;
        //  根据隐私策略而来决定是否过滤本次触摸事件
        if (onFilterTouchEventForSecurity(ev)) {  //见代码(2.1)
            final int action = ev.getAction();
            final int actionMasked = action & MotionEvent.ACTION_MASK;

            //手指按下操作
            if (actionMasked == MotionEvent.ACTION_DOWN) {
                // 取消并清除之前所有的触摸targets，可能是由于ANR或者其他状态改变
                cancelAndClearTouchTargets(ev);
                // 重置触摸状态
                resetTouchState();
            }

            final boolean intercepted;
            //手指按下操作
            if (actionMasked == MotionEvent.ACTION_DOWN
                    || mFirstTouchTarget != null) {
                //可通过调用requestDisallowInterceptTouchEvent，不让父View拦截事件
                final boolean disallowIntercept = (mGroupFlags & FLAG_DISALLOW_INTERCEPT) != 0;
                //判断是否允许调用拦截器
                if (!disallowIntercept) { 
                    //调用拦截方法
                    intercepted = onInterceptTouchEvent(ev); //见代码(2.2)
                    ev.setAction(action); 
                } else {
                    intercepted = false;
                }
            } else {
                // 当没有触摸targets，且不是down事件时，开始持续拦截触摸。
                intercepted = true;
            }

            // 如果已拦截或者某个view正在处理gesture时，开始正常的事件分发
            if (intercepted || mFirstTouchTarget != null) {
                ev.setTargetAccessibilityFocus(false);
            }

            // 检测取消器.
            final boolean canceled = resetCancelNextUpFlag(this)
                    || actionMasked == MotionEvent.ACTION_CANCEL;

            //更新触摸targets列表
            final boolean split = (mGroupFlags & FLAG_SPLIT_MOTION_EVENTS) != 0;
            TouchTarget newTouchTarget = null;
            boolean alreadyDispatchedToNewTouchTarget = false;
            if (!canceled && !intercepted) {

                //把事件分发给所有的子视图，寻找可以获取焦点的视图。
                View childWithAccessibilityFocus = ev.isTargetAccessibilityFocus()
                        ? findChildWithAccessibilityFocus() : null;

                if (actionMasked == MotionEvent.ACTION_DOWN
                        || (split && actionMasked == MotionEvent.ACTION_POINTER_DOWN)
                        || actionMasked == MotionEvent.ACTION_HOVER_MOVE) {
                    final int actionIndex = ev.getActionIndex(); // down事件等于0
                    final int idBitsToAssign = split ? 1 << ev.getPointerId(actionIndex)
                            : TouchTarget.ALL_POINTER_IDS; 

                    // 清空早先的触摸targets的pointer ids
                    removePointersFromTouchTargets(idBitsToAssign);

                    final int childrenCount = mChildrenCount;
                    if (newTouchTarget == null && childrenCount != 0) {
                        final float x = ev.getX(actionIndex);
                        final float y = ev.getY(actionIndex);
                        // 从视图最上层到下层，获取所有能接收该事件的子视图
                        final ArrayList<View> preorderedList = buildOrderedChildList(); //见代码(2.3)
                        final boolean customOrder = preorderedList == null
                                && isChildrenDrawingOrderEnabled();
                        final View[] children = mChildren;

                        /* 从最底层的父视图开始遍历，
                        ** 找寻newTouchTarget，并赋予view与 pointerIdBits；
                        ** 如果已经存在找寻newTouchTarget，说明正在接收一定范围内的触摸事件，则跳出循环。
                        */
                        for (int i = childrenCount - 1; i >= 0; i--) {
                            final int childIndex = customOrder
                                    ? getChildDrawingOrder(childrenCount, i) : i;
                            final View child = (preorderedList == null)
                                    ? children[childIndex] : preorderedList.get(childIndex);

                            // 如果当前视图无法获取用户焦点，则跳过本次循环
                            if (childWithAccessibilityFocus != null) {
                                if (childWithAccessibilityFocus != child) {
                                    continue;
                                }
                                childWithAccessibilityFocus = null;
                                i = childrenCount - 1;
                            }
                            //如果view不可见，或者触摸点的坐标在在view的范围内，则跳过本次循环
                            if (!canViewReceivePointerEvents(child)
                                    || !isTransformedTouchPointInView(x, y, child, null)) {
                                ev.setTargetAccessibilityFocus(false);
                                continue;
                            }

                            newTouchTarget = getTouchTarget(child);
                            if (newTouchTarget != null) {
                                // 当前视图接收到触摸事件，赋予新的poniter id给触摸target,并退出整个循环。
                                newTouchTarget.pointerIdBits |= idBitsToAssign;
                                break;
                            }
        
                            //重置取消或抬起标志位
                            resetCancelNextUpFlag(child);     
                            //如果触摸位置在child的区域内，则把事件分发给子View                         
                            if (dispatchTransformedTouchEvent(ev, false, child, idBitsToAssign)) { //见代码(2.4)  
                                // 获取TouchDown的时间点
                                mLastTouchDownTime = ev.getDownTime();
                                // 获取TouchDown的Index
                                if (preorderedList != null) {
                                    // childIndex points into presorted list, find original index
                                    for (int j = 0; j < childrenCount; j++) {
                                        if (children[childIndex] == mChildren[j]) {
                                            mLastTouchDownIndex = j;
                                            break;
                                        }
                                    }
                                } else {
                                    mLastTouchDownIndex = childIndex;
                                }
                                //获取TouchDown的x,y坐标
                                mLastTouchDownX = ev.getX();
                                mLastTouchDownY = ev.getY();
                                //添加TouchTarget
                                newTouchTarget = addTouchTarget(child, idBitsToAssign);
                                alreadyDispatchedToNewTouchTarget = true;
                                break;
                            }
                            ev.setTargetAccessibilityFocus(false);
                        }
                        // 清除视图列表，以防视图被暴露
                        if (preorderedList != null) preorderedList.clear();
                    }

                    if (newTouchTarget == null && mFirstTouchTarget != null) {
                        //将mFirstTouchTarget的链表最后的touchTarget赋给newTouchTarget
                        newTouchTarget = mFirstTouchTarget;
                        while (newTouchTarget.next != null) {
                            newTouchTarget = newTouchTarget.next;
                        }
                        newTouchTarget.pointerIdBits |= idBitsToAssign;
                    }
                }
            }

            // mFirstTouchTarget赋值是在通过addTouchTarget方法获取的；
            // 只有处理ACTION_DOWN事件，才会进入addTouchTarget方法。
            // 这也正是当View没有消费ACTION_DOWN事件，则不会接收其他MOVE,UP等事件的原因
            if (mFirstTouchTarget == null) {
                //没有触摸target,则由当前ViewGroup来处理
                handled = dispatchTransformedTouchEvent(ev, canceled, null,
                        TouchTarget.ALL_POINTER_IDS);
            } else {
                //如果View消费ACTION_DOWN事件，那么MOVE,UP等事件相继开始执行
                TouchTarget predecessor = null;
                TouchTarget target = mFirstTouchTarget;
                while (target != null) {
                    final TouchTarget next = target.next;
                    if (alreadyDispatchedToNewTouchTarget && target == newTouchTarget) {
                        handled = true;
                    } else {
                        final boolean cancelChild = resetCancelNextUpFlag(target.child)
                                || intercepted;
                        if (dispatchTransformedTouchEvent(ev, cancelChild,
                                target.child, target.pointerIdBits)) {
                            handled = true;
                        }
                        if (cancelChild) {
                            if (predecessor == null) {
                                mFirstTouchTarget = next;
                            } else {
                                predecessor.next = next;
                            }
                            target.recycle();
                            target = next;
                            continue;
                        }
                    }
                    predecessor = target;
                    target = next;
                }
            }

            //当发生抬起或取消事件，更新触摸targets 
            if (canceled
                    || actionMasked == MotionEvent.ACTION_UP
                    || actionMasked == MotionEvent.ACTION_HOVER_MOVE) {
                resetTouchState();
            } else if (split && actionMasked == MotionEvent.ACTION_POINTER_UP) {
                final int actionIndex = ev.getActionIndex();
                final int idBitsToRemove = 1 << ev.getPointerId(actionIndex);
                removePointersFromTouchTargets(idBitsToRemove);
            }
        }
        //通知verifier由于当前时间未处理，那么该事件其余的都将被忽略
        if (!handled && mInputEventConsistencyVerifier != null) {
            mInputEventConsistencyVerifier.onUnhandledEvent(ev, 1);
        }
        return handled;
    }

- 


**2.1 ViewGroup.onFilterTouchEventForSecurity()**  
出于考虑隐私策略而过滤触摸事件。当返回true，表示继续分发事件；当返回flase,表示该事件应该被过滤掉，不再进行任何分发。

    public boolean onFilterTouchEventForSecurity(MotionEvent event) {
        //noinspection RedundantIfStatement
        if ((mViewFlags & FILTER_TOUCHES_WHEN_OBSCURED) != 0
                && (event.getFlags() & MotionEvent.FLAG_WINDOW_IS_OBSCURED) != 0) {
            // Window is obscured, drop this touch.
            return false;
        }
        return true;
    }

**2.2 ViewGroup.onInterceptTouchEvent()**  

当返回true，表示该事件被当前视图拦截；当返回false，继续执行事件分发。如果在Activity中直接拦截了，那么将事件不会再往其他View分发，而是由Activity.onTouchEvent()方法处理。

    public boolean onInterceptTouchEvent(MotionEvent ev) {
        return false;
    }

**2.3  ViewGroup.buildOrderedChildList()**
获取一个视图组的先序列表，通过虚拟的Z轴来排序。  

	ArrayList<View> buildOrderedChildList() {
        final int count = mChildrenCount;
        if (count <= 1 || !hasChildWithZ()) return null;

        if (mPreSortedChildren == null) {
            mPreSortedChildren = new ArrayList<View>(count);
        } else {
            mPreSortedChildren.ensureCapacity(count);
        }

        final boolean useCustomOrder = isChildrenDrawingOrderEnabled();
        for (int i = 0; i < mChildrenCount; i++) {
            // 添加下一个子视图到列表
            int childIndex = useCustomOrder ? getChildDrawingOrder(mChildrenCount, i) : i;
            View nextChild = mChildren[childIndex];
            float currentZ = nextChild.getZ(); //见代码(2.3.1)

            int insertIndex = i;
            //按Z轴，从小到大排序所有的子视图
            while (insertIndex > 0 && mPreSortedChildren.get(insertIndex - 1).getZ() > currentZ) {
                insertIndex--;
            }
            mPreSortedChildren.add(insertIndex, nextChild);
        }
        return mPreSortedChildren;
    }

**2.3.1  ViewGroup.getZ()**  

`getZ()`用于获取Z轴坐标。屏幕只有x,y坐标，而Z是虚拟的，可通过`setElevation()`,`setTranslationZ()`或者`setZ()`方法来修改Z轴的坐标值。 

    public float getZ() {
        return getElevation() + getTranslationZ();
    }

**2.4 ViewGroup.dispatchTransformedTouchEvent（）** 
该方法是ViewGroup真正处理事件的地方，分发子View来处理事件，过滤掉不相干的pointer ids。当子视图为null时，MotionEvent将会发送给该ViewGroup。

    private boolean dispatchTransformedTouchEvent(MotionEvent event, boolean cancel,
            View child, int desiredPointerIdBits) {
        final boolean handled;

        // Canceling motions is a special case.  We don't need to perform any transformations
        // 发生取消操作时，不再执行后续的任何操作
        final int oldAction = event.getAction();
        if (cancel || oldAction == MotionEvent.ACTION_CANCEL) {
            event.setAction(MotionEvent.ACTION_CANCEL);
            if (child == null) {
                handled = super.dispatchTouchEvent(event);
            } else {
                handled = child.dispatchTouchEvent(event);
            }
            event.setAction(oldAction);
            return handled;
        }

        final int oldPointerIdBits = event.getPointerIdBits();
        final int newPointerIdBits = oldPointerIdBits & desiredPointerIdBits;

        //由于某些原因，发生不一致的操作，那么将抛弃该事件
        if (newPointerIdBits == 0) {
            return false;
        }

        
        final MotionEvent transformedEvent;
        //判断预期的pointer id与事件的pointer id是否相等
        if (newPointerIdBits == oldPointerIdBits) {
            if (child == null || child.hasIdentityMatrix()) {
                if (child == null) {
                    //不存在子视图时，ViewGroup调用View.dispatchTouchEvent分发事件，再调用ViewGroup.onTouchEvent来处理事件
                    handled = super.dispatchTouchEvent(event);  // 见代码(2.5)
                } else {
                    final float offsetX = mScrollX - child.mLeft;
                    final float offsetY = mScrollY - child.mTop;
                    event.offsetLocation(offsetX, offsetY);

                    handled = child.dispatchTouchEvent(event);//将触摸事件分发给子视图
                    
                    event.offsetLocation(-offsetX, -offsetY); //调整该事件的位置
                }
                return handled;
            }
            transformedEvent = MotionEvent.obtain(event); //拷贝该事件，来创建一个新的MotionEvent
        } else {
            //分离事件，获取包含newPointerIdBits的MotionEvent
            transformedEvent = event.split(newPointerIdBits); 
        }

        if (child == null) {
            //不存在子视图时，ViewGroup调用View.dispatchTouchEvent分发事件，再调用ViewGroup.onTouchEvent来处理事件
            handled = super.dispatchTouchEvent(transformedEvent); //见代码(2.5) 
        } else {
            final float offsetX = mScrollX - child.mLeft;
            final float offsetY = mScrollY - child.mTop;
            transformedEvent.offsetLocation(offsetX, offsetY);
            if (! child.hasIdentityMatrix()) {
                //将该视图的矩阵进行转换
                transformedEvent.transform(child.getInverseMatrix());
            }

            handled = child.dispatchTouchEvent(transformedEvent); //见代码(2.5) 
        }

        //回收transformedEvent
        transformedEvent.recycle();
        return handled;
    }
最终调用View.dispatchTouchEvent方法来分发事件。

**2.5 View.dispatchTouchEvent()**

    public boolean dispatchTouchEvent(MotionEvent event) {
        //判断事件是否需要由能够聚焦处理
        if (event.isTargetAccessibilityFocus()) {           
            if (!isAccessibilityFocusedViewOrHost()) {
                return false;
            }
            event.setTargetAccessibilityFocus(false);
        }

        boolean result = false;

        if (mInputEventConsistencyVerifier != null) {
            mInputEventConsistencyVerifier.onTouchEvent(event, 0);
        }

        final int actionMasked = event.getActionMasked();
        if (actionMasked == MotionEvent.ACTION_DOWN) {
            //在Down事件之前，如果存在滚动曹总，则停止。不存在则不进行操作
            stopNestedScroll();
        }

        if (onFilterTouchEventForSecurity(event)) {
            //当存在OnTouchListener，且视图状态为ENABLED时，调用onTouch()方法
            ListenerInfo li = mListenerInfo;
            if (li != null && li.mOnTouchListener != null
                    && (mViewFlags & ENABLED_MASK) == ENABLED
                    && li.mOnTouchListener.onTouch(this, event)) {
                //如果已经消费事件，则返回True
                result = true;
            }
            //如果OnTouch（)没有消费Touch事件则调用OnTouchEvent()
            if (!result && onTouchEvent(event)) { // 见代码(2.6)
                //如果已经消费事件，则返回True
                result = true;
            }
        }

        if (!result && mInputEventConsistencyVerifier != null) {
            mInputEventConsistencyVerifier.onUnhandledEvent(event, 0);
        }

        // 处理取消或抬起操作
        if (actionMasked == MotionEvent.ACTION_UP ||
                actionMasked == MotionEvent.ACTION_CANCEL ||
                (actionMasked == MotionEvent.ACTION_DOWN && !result)) {
            stopNestedScroll();
        }

        return result;
    }

- 1. 先由OnTouchListener的OnTouch()来处理事件，当返回True，则消费该事件，否则进入2。
- 2. onTouchEvent处理事件，的那个返回True时，消费该事件。否则不会处理

**2.6 View.onTouchEvent()**

    public boolean onTouchEvent(MotionEvent event) {
        final float x = event.getX();
        final float y = event.getY();
        final int viewFlags = mViewFlags;

        if ((viewFlags & ENABLED_MASK) == DISABLED) {
            if (event.getAction() == MotionEvent.ACTION_UP && (mPrivateFlags & PFLAG_PRESSED) != 0) {
                setPressed(false);
            }
            // 当View状态为DISABLED，如果可点击或可长按，则返回True，即消费事件
            return (((viewFlags & CLICKABLE) == CLICKABLE ||
                    (viewFlags & LONG_CLICKABLE) == LONG_CLICKABLE));
        }

        if (mTouchDelegate != null) {
            if (mTouchDelegate.onTouchEvent(event)) {
                return true;
            }
        }
        //当可点击或可长按
        if (((viewFlags & CLICKABLE) == CLICKABLE ||
                (viewFlags & LONG_CLICKABLE) == LONG_CLICKABLE)) {
            switch (event.getAction()) {
                case MotionEvent.ACTION_UP:
                    boolean prepressed = (mPrivateFlags & PFLAG_PREPRESSED) != 0;
                    if ((mPrivateFlags & PFLAG_PRESSED) != 0 || prepressed) {
                        // take focus if we don't have it already and we should in
                        // touch mode.
                        boolean focusTaken = false;
                        if (isFocusable() && isFocusableInTouchMode() && !isFocused()) {
                            focusTaken = requestFocus();
                        }

                        if (prepressed) {
                            // The button is being released before we actually
                            // showed it as pressed.  Make it show the pressed
                            // state now (before scheduling the click) to ensure
                            // the user sees it.
                            setPressed(true, x, y);
                       }

                        if (!mHasPerformedLongPress) {
                            //这是Tap操作，移除长按回调方法
                            removeLongPressCallback();

                            // Only perform take click actions if we were in the pressed state
                            if (!focusTaken) {
                                // Use a Runnable and post this rather than calling
                                // performClick directly. This lets other visual state
                                // of the view update before click actions start.
                                if (mPerformClick == null) {
                                    mPerformClick = new PerformClick();
                                }
                                //调用View.OnClickListener
                                if (!post(mPerformClick)) {
                                    performClick();
                                }
                            }
                        }

                        if (mUnsetPressedState == null) {
                            mUnsetPressedState = new UnsetPressedState();
                        }

                        if (prepressed) {
                            postDelayed(mUnsetPressedState,
                                    ViewConfiguration.getPressedStateDuration());
                        } else if (!post(mUnsetPressedState)) {
                            // If the post failed, unpress right now
                            mUnsetPressedState.run();
                        }

                        removeTapCallback();
                    }
                    break;

                case MotionEvent.ACTION_DOWN:
                    mHasPerformedLongPress = false;

                    if (performButtonActionOnTouchDown(event)) {
                        break;
                    }

                    //获取是否处于可滚动的视图内
                    boolean isInScrollingContainer = isInScrollingContainer();

                    if (isInScrollingContainer) {
                        mPrivateFlags |= PFLAG_PREPRESSED;
                        if (mPendingCheckForTap == null) {
                            mPendingCheckForTap = new CheckForTap();
                        }
                        mPendingCheckForTap.x = event.getX();
                        mPendingCheckForTap.y = event.getY();
                        //当处于可滚动视图内，则延迟TAP_TIMEOUT，再反馈按压状态，用来判断用户是否想要滚动。默认延时为100ms
                        postDelayed(mPendingCheckForTap, ViewConfiguration.getTapTimeout());
                    } else {
                        //当不再滚动视图内，则立刻反馈按压状态
                        setPressed(true, x, y);
                        //检测是否是长按
                        checkForLongClick(0);
                    }
                    break;

                case MotionEvent.ACTION_CANCEL:
                    setPressed(false);
                    removeTapCallback();
                    removeLongPressCallback();
                    break;

                case MotionEvent.ACTION_MOVE:
                    drawableHotspotChanged(x, y);

                    // Be lenient about moving outside of buttons
                    if (!pointInView(x, y, mTouchSlop)) {
                        // Outside button
                        removeTapCallback();
                        if ((mPrivateFlags & PFLAG_PRESSED) != 0) {
                            // Remove any future long press/tap checks
                            removeLongPressCallback();

                            setPressed(false);
                        }
                    }
                    break;
            }

            return true;
        }

        return false;
    }

## 流程图
![touch](/images/touch/touch1.jpg)

## 结论
1. onInterceptTouchEvent返回值true表示事件拦截， onTouch/onTouchEvent 返回值true表示事件消费;
2. Activity的最顶层Window是PhoneWindow，PhoneWindow的最顶层View是DecorView;
3. 事件分发始于Activity.dispatchTouchEvent()，从最上层的ViewGroup不断往下View或ViewGroup传递。中间的ViewGroup可通过onInterceptTouchEvent()对事件做拦截中途拦截，则不再往下分发；
4. 只有当disallowIntercept的值为false时，才会调用onInterceptTouchEvent方法，而disallowIntercept值取决于调用requestDisallowInterceptTouchEvent这个方法，这个方法常常是子View调用，不让父View拦截事件。
5. 如果事件从上往下传递过程中一直没有被停止，且最底层子 View 没有消费事件，事件会反向往上传递，这时父View(ViewGroup)可以通过onTouchEvent/onTouch方法进行消费，直到Activity 的 onTouchEvent()。  
6. 如果 View 没有对 ACTION_DOWN 进行消费，之后的其他事件不会传递过来。只有调用addTouchTarget，mFirstTouchTarget才可能不为空。要调用addTouchTarget 必须有子View消费了Action.Down事件，否则调用super.dispatchTouchEvent(event)，也就是View的分发方法
7. onTouch优先于onTouchEvent执行. 当onTouch方法中通过返回true将事件消费掉，onTouchEvent将不会再执行。另外，onTouch能够得到执行需要两个前提条件，第一mOnTouchListener的值不能为空，第二当前点击的控件必须是enable的
 


## 参考

1. [Android事件分发机制完全解析，带你从源码的角度彻底理解(上)](http://blog.csdn.net/guolin_blog/article/details/9097463)
2. [Android事件分发机制完全解析，带你从源码的角度彻底理解(下)](http://blog.csdn.net/guolin_blog/article/details/9153747)
3. [Andriod 从源码的角度详解View,ViewGroup的Touch事件的分发机制](http://blog.csdn.net/xiaanming/article/details/21696315)
4. [公共技术点之 View 事件传递](http://a.codekk.com/detail/Android/Trinea/%E5%85%AC%E5%85%B1%E6%8A%80%E6%9C%AF%E7%82%B9%E4%B9%8B%20View%20%E4%BA%8B%E4%BB%B6%E4%BC%A0%E9%80%92)