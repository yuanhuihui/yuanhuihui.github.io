---
layout: post
title:  "WMS之启动窗口(StartingWindow)篇"
date:   2017-01-15 20:32:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析启动窗口的启动和结束过程。

## 一. 概述

Activity组件启动后，窗口并非马上显示，而是先显示starting window，作为Activity的预览窗口。

[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)介绍了Activity
的启动过程，那么本文将从window角度再来说说这个过程。

## 二. 启动startingWindow

    AMS.startActivity 
      ASS.startActivityMayWait
        ASS.startActivityLocked
          AS.startActivityLocked

就从该方法说起。

### 2.1 AS.startActivityLocked
[-> ActivityStack.java]

    final void startActivityLocked(ActivityRecord r, boolean newTask,
            boolean doResume, boolean keepCurTransition, Bundle options) {
        TaskRecord rTask = r.task;
        final int taskId = rTask.taskId;
        if (!r.mLaunchTaskBehind && (taskForIdLocked(taskId) == null || newTask)) {
            //task中的上一个activity已被移除，或者ams重用该task,则将该task移到顶部
            insertTaskAtTop(rTask, r);
            mWindowManager.moveTaskToTop(taskId);
        }
        TaskRecord task = null;
        if (!newTask) {
            boolean startIt = true;
            for (int taskNdx = mTaskHistory.size() - 1; taskNdx >= 0; --taskNdx) {
                task = mTaskHistory.get(taskNdx);
                if (task.getTopActivity() == null) {
                    //该task所有activity都finishing
                    continue;
                }
                if (task == r.task) {
                    if (!startIt) {
                        task.addActivityToTop(r);
                        r.putInHistory();
                        mWindowManager.addAppToken(task.mActivities.indexOf(r), r.appToken,
                                r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                                (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0,
                                r.userId, r.info.configChanges, task.voiceSession != null,
                                r.mLaunchTaskBehind);
                        ActivityOptions.abort(options);
                        return;
                    }
                    break;
                } else if (task.numFullscreen > 0) {
                    startIt = false;
                }
            }
        }

        if (task == r.task && mTaskHistory.indexOf(task) != (mTaskHistory.size() - 1)) {
            mStackSupervisor.mUserLeaving = false;
        }

        task = r.task;
        task.addActivityToTop(r);
        task.setFrontOfTask();

        r.putInHistory();
        mActivityTrigger.activityStartTrigger(r.intent, r.info, r.appInfo);
        if (!isHomeStack() || numActivities() > 0) {
            //当切换到新的task，或者下一个activity进程目前并没有运行，则
            boolean showStartingIcon = newTask;
            ProcessRecord proc = r.app;
            if (proc == null) {
                proc = mService.mProcessNames.get(r.processName, r.info.applicationInfo.uid);
            }

            if (proc == null || proc.thread == null) {
                showStartingIcon = true; //进程没有启动，则显示启动窗口
            }
            if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_NO_ANIMATION) != 0) {
                mWindowManager.prepareAppTransition(AppTransition.TRANSIT_NONE, keepCurTransition);
                mNoAnimActivities.add(r);
            } else {
                mWindowManager.prepareAppTransition(newTask
                        ? r.mLaunchTaskBehind
                                ? AppTransition.TRANSIT_TASK_OPEN_BEHIND
                                : AppTransition.TRANSIT_TASK_OPEN
                        : AppTransition.TRANSIT_ACTIVITY_OPEN, keepCurTransition);
                mNoAnimActivities.remove(r);
            }
            mWindowManager.addAppToken(task.mActivities.indexOf(r),
                    r.appToken, r.task.taskId, mStackId, r.info.screenOrientation, r.fullscreen,
                    (r.info.flags & ActivityInfo.FLAG_SHOW_FOR_ALL_USERS) != 0, r.userId,
                    r.info.configChanges, task.voiceSession != null, r.mLaunchTaskBehind);
            boolean doShow = true;
            if (newTask) {
                if ((r.intent.getFlags() & Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED) != 0) {
                    resetTaskIfNeededLocked(r, r);
                    doShow = topRunningNonDelayedActivityLocked(null) == r;
                }
            } else if (options != null && new ActivityOptions(options).getAnimationType()
                    == ActivityOptions.ANIM_SCENE_TRANSITION) {
                doShow = false;
            }
            if (r.mLaunchTaskBehind) {
                mWindowManager.setAppVisibility(r.appToken, true);
                ensureActivitiesVisibleLocked(null, 0);
            } else if (SHOW_APP_STARTING_PREVIEW && doShow) {
                ...
                //【见小节2.2】
                mWindowManager.setAppStartingWindow(
                        r.appToken, r.packageName, r.theme,
                        mService.compatibilityInfoForPackageLocked(
                                 r.info.applicationInfo), r.nonLocalizedLabel,
                        r.labelRes, r.icon, r.logo, r.windowFlags,
                        prev != null ? prev.appToken : null, showStartingIcon);
                r.mStartingWindowShown = true;
            }
        } else {
            ...
        }

        if (doResume) {
            mStackSupervisor.resumeTopActivitiesLocked(this, r, options);
        }
    }

该方法主要功能：

1. 将该Activity所对应的AMS和WMS的task，分别移至栈顶；
2. 从mTaskHistory获取该Activity所属的task;
3. 当Activity所属进程没有启动，则需要显示启动窗口，即showStartingIcon=true;
4. 创建AppWindowToken，并添加到WMS的mTokenMap；
5. 设置启动窗口(StartingWindow);
6. 恢复栈顶部的Activity;

### 2.2  WMS.setAppStartingWindow
[-> WindowManagerService.java]

    public void setAppStartingWindow(IBinder token, String pkg,
            int theme, CompatibilityInfo compatInfo,
            CharSequence nonLocalizedLabel, int labelRes, int icon, int logo,
            int windowFlags, IBinder transferFrom, boolean createIfNeeded) {

        synchronized(mWindowMap) {
            //从mTokenMap中查找相应的Token
            AppWindowToken wtoken = findAppWindowToken(token);
            if (wtoken == null) {
                return; //当app的token为空，则直接返回
            }

            if (!okToDisplay()) {
                return; //当屏幕处于冻结状态，则直接返回
            }

            if (wtoken.startingData != null) {
                return; //当启动数据不为空，则无需再次设置
            }

            if (transferFrom != null) {
                AppWindowToken ttoken = findAppWindowToken(transferFrom);
                if (ttoken != null) {
                    WindowState startingWindow = ttoken.startingWindow;
                    if (startingWindow != null && ttoken.startingView != null) {
                        mSkipAppTransitionAnimation = true;
                        final long origId = Binder.clearCallingIdentity();

                        //将上一个显示Activity的启动窗口信息转移到新的token
                        wtoken.startingData = ttoken.startingData;
                        wtoken.startingView = ttoken.startingView;
                        wtoken.startingDisplayed = ttoken.startingDisplayed;
                        ttoken.startingDisplayed = false;
                        wtoken.startingWindow = startingWindow;
                        wtoken.reportedVisible = ttoken.reportedVisible;
                        ttoken.startingData = null;
                        ttoken.startingView = null;
                        ttoken.startingWindow = null;
                        ttoken.startingMoved = true;
                        startingWindow.mToken = wtoken;
                        startingWindow.mRootToken = wtoken;
                        startingWindow.mAppToken = wtoken;

                        startingWindow.getWindowList().remove(startingWindow);
                        mWindowsChanged = true;
                        ttoken.windows.remove(startingWindow);
                        ttoken.allAppWindows.remove(startingWindow);
                        addWindowToListInOrderLocked(startingWindow, true);

                        if (ttoken.allDrawn) {
                            wtoken.allDrawn = true;
                            wtoken.deferClearAllDrawn = ttoken.deferClearAllDrawn;
                        }
                        if (ttoken.firstWindowDrawn) {
                            wtoken.firstWindowDrawn = true;
                        }
                        if (!ttoken.hidden) {
                            wtoken.hidden = false;
                            wtoken.hiddenRequested = false;
                            wtoken.willBeHidden = false;
                        }
                        if (wtoken.clientHidden != ttoken.clientHidden) {
                            wtoken.clientHidden = ttoken.clientHidden;
                            wtoken.sendAppVisibilityToClients();
                        }
                        ttoken.mAppAnimator.transferCurrentAnimation(
                                wtoken.mAppAnimator, startingWindow.mWinAnimator);
                        //更新当前可聚焦的窗口
                        updateFocusedWindowLocked(UPDATE_FOCUS_WILL_PLACE_SURFACES,
                                true /*updateInputWindows*/);
                        getDefaultDisplayContentLocked().layoutNeeded = true;
                        //刷新系统UI【见小节】
                        performLayoutAndPlaceSurfacesLocked();
                        Binder.restoreCallingIdentity(origId);
                        return;
                    } else if (ttoken.startingData != null) {
                        wtoken.startingData = ttoken.startingData;
                        ttoken.startingData = null;
                        ttoken.startingMoved = true;
                        Message m = mH.obtainMessage(H.ADD_STARTING, wtoken);
                        //加入消息队列的头部，需要立马执行
                        mH.sendMessageAtFrontOfQueue(m);
                        return;
                    }
                    final AppWindowAnimator tAppAnimator = ttoken.mAppAnimator;
                    final AppWindowAnimator wAppAnimator = wtoken.mAppAnimator;
                    if (tAppAnimator.thumbnail != null) {
                        if (wAppAnimator.thumbnail != null) {
                            wAppAnimator.thumbnail.destroy();
                        }
                        wAppAnimator.thumbnail = tAppAnimator.thumbnail;
                        wAppAnimator.thumbnailX = tAppAnimator.thumbnailX;
                        wAppAnimator.thumbnailY = tAppAnimator.thumbnailY;
                        wAppAnimator.thumbnailLayer = tAppAnimator.thumbnailLayer;
                        wAppAnimator.thumbnailAnimation = tAppAnimator.thumbnailAnimation;
                        tAppAnimator.thumbnail = null;
                    }
                }
            }

            if (!createIfNeeded) {
                return; //当不存在启动窗口，且发起者不希望创建，则直接返回
            }

            if (theme != 0) {
                AttributeCache.Entry ent = AttributeCache.instance().get(pkg, theme,
                        com.android.internal.R.styleable.Window, mCurrentUserId);
                if (ent == null) {
                    return;
                }
                if (ent.array.getBoolean(
                        com.android.internal.R.styleable.Window_windowIsTranslucent, false)) {
                    return;
                }
                if (ent.array.getBoolean(
                        com.android.internal.R.styleable.Window_windowIsFloating, false)) {
                    return;
                }
                if (ent.array.getBoolean(
                        com.android.internal.R.styleable.Window_windowShowWallpaper, false)) {
                    if (mWallpaperTarget == null) {
                        windowFlags |= FLAG_SHOW_WALLPAPER;
                    } else {
                        return;
                    }
                }
            }
            //创建启动数据，并发送消息到"android.display"线程来处理ADD_STARTING消息；【见小节2.3】
            wtoken.startingData = new StartingData(pkg, theme, compatInfo, nonLocalizedLabel,
                    labelRes, icon, logo, windowFlags);
            Message m = mH.obtainMessage(H.ADD_STARTING, wtoken);
            mH.sendMessageAtFrontOfQueue(m);
        }
    }

该方法主要功能：


1. 当上一个显示Activity的ttoken不为空的情况，有两种case:
  - 当ttoken的startingWindow和startingView都不为空，则将该启动窗口信息转移到新的token，然后调用performLayoutAndPlaceSurfacesLocked()进行布局和刷新UI；则完成并返回；
  - 当ttoken的startingData不为空(上一个activity启动窗口准备好，但没有完成)，则借用该ttoken启动数据，并发送消息到"android.display"线程来处理ADD_STARTING消息；则完成并返回；
2. 当不存在启动窗口，且发起者不希望创建，则直接返回；
3. 当主题theme不为空，主题满足以下任一情况，则都会直接返回；
    - 该主题实体为空；
    - 半透明；
    - 浮动窗口；
    - 需要显示壁纸；
4. 最后，创建启动数据，并发送消息到"android.display"线程来处理ADD_STARTING消息；

也就是说最核心的过程便是向"android.display"线程来处理ADD_STARTING消息。接下来，进入“android.display”线程中WindowManagerService.H.handleMessage().

### 2.3 WMS.H.handleMessage
[-> WindowManagerService.java ::H]

    final class H extends Handler {
      public void handleMessage(Message msg) {
        switch (msg.what) {
          case ADD_STARTING: {
              final AppWindowToken wtoken = (AppWindowToken)msg.obj;
              final StartingData sd = wtoken.startingData;
              if (sd == null) {
                  return; //动画被取消则返回
              }
              
              //【见小节2.4】
              View view = mPolicy.addStartingWindow(
                    wtoken.token, sd.pkg, sd.theme, sd.compatInfo,
                    sd.nonLocalizedLabel, sd.labelRes, sd.icon, sd.logo, sd.windowFlags);

              if (view != null) {
                  boolean abort = false;
                  synchronized(mWindowMap) {
                      if (wtoken.removed || wtoken.startingData == null) {
                          //当创建已被移除或者转移给其他activity，则需要移除它
                          if (wtoken.startingWindow != null) {
                              wtoken.startingWindow = null;
                              wtoken.startingData = null;
                              abort = true;
                          }
                      } else {
                          wtoken.startingView = view;
                      }
                  }
                  if (abort) {
                      mPolicy.removeStartingWindow(wtoken.token, view);
                  }
              }
          } break;
          ...
        }
      }
    }
    
此处mPolicy为PhoneWindowManager

### 2.4  PWM.addStartingWindow
[-> PhoneWindowManager.java]

    public View addStartingWindow(IBinder appToken, String packageName, int theme,
            CompatibilityInfo compatInfo, CharSequence nonLocalizedLabel, int labelRes,
            int icon, int logo, int windowFlags) {
        if (!SHOW_STARTING_ANIMATIONS) {
            return null;
        }
        if (packageName == null) {
            return null;
        }

        WindowManager wm = null;
        View view = null;

        try {
            Context context = mContext;
            if (theme != context.getThemeResId() || labelRes != 0) {
                context = context.createPackageContext(packageName, 0);
                context.setTheme(theme);
            }

            PhoneWindow win = new PhoneWindow(context);
            win.setIsStartingWindow(true);
            final TypedArray ta = win.getWindowStyle();
            if (ta.getBoolean(
                        com.android.internal.R.styleable.Window_windowDisablePreview, false)
                || ta.getBoolean(
                        com.android.internal.R.styleable.Window_windowShowWallpaper,false)) {
                return null;
            }

            Resources r = context.getResources();
            win.setTitle(r.getText(labelRes, nonLocalizedLabel));
            //设置窗口类型为启动窗口类型
            win.setType(WindowManager.LayoutParams.TYPE_APPLICATION_STARTING);

            synchronized (mWindowManagerFuncs.getWindowManagerLock()) {
                if (mKeyguardHidden) {
                    windowFlags |= FLAG_SHOW_WHEN_LOCKED;
                }
            }

            //设置不可触摸和聚焦
            win.setFlags(
                windowFlags|
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE|
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|
                WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM,
                windowFlags|
                WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE|
                WindowManager.LayoutParams.FLAG_NOT_FOCUSABLE|
                WindowManager.LayoutParams.FLAG_ALT_FOCUSABLE_IM);

            win.setDefaultIcon(icon);
            win.setDefaultLogo(logo);

            win.setLayout(WindowManager.LayoutParams.MATCH_PARENT,
                    WindowManager.LayoutParams.MATCH_PARENT);

            final WindowManager.LayoutParams params = win.getAttributes();
            params.token = appToken;
            params.packageName = packageName;
            params.windowAnimations = win.getWindowStyle().getResourceId(
                    com.android.internal.R.styleable.Window_windowAnimationStyle, 0);
            params.privateFlags |=
                    WindowManager.LayoutParams.PRIVATE_FLAG_FAKE_HARDWARE_ACCELERATED;
            params.privateFlags |= WindowManager.LayoutParams.PRIVATE_FLAG_SHOW_FOR_ALL_USERS;

            if (!compatInfo.supportsScreen()) {
                params.privateFlags |= WindowManager.LayoutParams.PRIVATE_FLAG_COMPATIBLE_WINDOW;
            }

            params.setTitle("Starting " + packageName);
            //获取WindowManager对象 [见小节2.4.1]
            wm = (WindowManager)context.getSystemService(Context.WINDOW_SERVICE);
            view = win.getDecorView();

            if (win.isFloating()) {
                return null; //浮动窗口，则不允许作为启动窗口
            }
            //【见小节2.5】
            wm.addView(view, params);
            // 当窗口成功添加到WMS，则返回该对象
            return view.getParent() != null ? view : null;
        }  catch (RuntimeException e) {
            ...
        } finally {
            if (view != null && view.getParent() == null) {
                wm.removeViewImmediate(view);
            }
        }

        return null;
    }

#### 2.4.1 getSystemService
[-> ContextImpl.java]

    class ContextImpl extends Context {
        public Object getSystemService(String name) {
            //[见下方]
            return SystemServiceRegistry.getSystemService(this, name);
        }
    }

[-> SystemServiceRegistry.java]

    final class SystemServiceRegistry {
        public static Object getSystemService(ContextImpl ctx, String name) {
            ServiceFetcher<?> fetcher = SYSTEM_SERVICE_FETCHERS.get(name);
            return fetcher != null ? fetcher.getService(ctx) : null;
        }
    }

#### 2.4.2 SystemServiceRegistry
[-> SystemServiceRegistry.java]

    final class SystemServiceRegistry {
        static {
            registerService(Context.WINDOW_SERVICE, WindowManager.class,
                new CachedServiceFetcher<WindowManager>() {

                public WindowManager createService(ContextImpl ctx) {
                    //创建WindowManagerImpl对象
                    return new WindowManagerImpl(ctx.getDisplay());
                }});
        }
        
        static <T> void registerService(String serviceName, Class<T> serviceClass,
                ServiceFetcher<T> serviceFetcher) {
            SYSTEM_SERVICE_NAMES.put(serviceClass, serviceName);
            SYSTEM_SERVICE_FETCHERS.put(serviceName, serviceFetcher);
        }

        static abstract class CachedServiceFetcher<T> implements ServiceFetcher<T> {
            private final int mCacheIndex;

            public CachedServiceFetcher() {
                mCacheIndex = sServiceCacheSize++;
            }

            public final T getService(ContextImpl ctx) {
                //缓存Service的地方
                final Object[] cache = ctx.mServiceCache;
                synchronized (cache) {
                    Object service = cache[mCacheIndex];
                    if (service == null) {
                        service = createService(ctx);
                        cache[mCacheIndex] = service;
                    }
                    return (T)service;
                }
            }

            public abstract T createService(ContextImpl ctx);
        }
    }

此处ctx.mServiceCache的创建方法:

        public static Object[] createServiceCache() {
            return new Object[sServiceCacheSize];
        }

这样设计的好处后面再需要同一个服务则可以直接从cache中取出,而无需每次都去创建对象.

接下来，进入WindowManagerImpl对象的addView()方法

### 2.5 WMI.addView
[-> WindowManagerImpl.java]

    public void addView(View view,  ViewGroup.LayoutParams params) {
        applyDefaultToken(params);
        mGlobal.addView(view, params, mDisplay, mParentWindow);
    }

先不往下写了,后续再展开. 这个过程就是增加视图.

## 三. 结束startingWindow

组件启动之后, 需要先把startingWindow去掉,再显示真正的窗口. window更新的过程都会调用WMS.performLayoutAndPlaceSurfacesLocked方法,
接下来,从这个方法说起.

### 3.1 performLayoutAndPlaceSurfacesLocked
[-> WindowManagerService.java]

    private final void performLayoutAndPlaceSurfacesLocked() {
        int loopCount = 6;
        do {
            mTraversalScheduled = false;
            // [见小节3.2]
            performLayoutAndPlaceSurfacesLockedLoop();
            mH.removeMessages(H.DO_TRAVERSAL);
            loopCount--;
        } while (mTraversalScheduled && loopCount > 0);
        mInnerFields.mWallpaperActionPending = false;
    }

### 3.2 performLayoutAndPlaceSurfacesLockedLoop

    private final void performLayoutAndPlaceSurfacesLockedLoop() {
        if (mInLayout) {
            return;
        }

        if (mWaitingForConfig) {
            return; //configuration已改变,但没有完成,则直接返回
        }

        if (!mDisplayReady) {
            return; //初始化未完成,则直接返回
        }
        mInLayout = true;
        ...

        try {
            // [见小节3.3]
            performLayoutAndPlaceSurfacesLockedInner(recoveringMemory);

            mInLayout = false;
            if (needsLayout()) {
                if (++mLayoutRepeatCount < 6) {
                    requestTraversalLocked();
                } else {
                    mLayoutRepeatCount = 0;
                }
            } else {
                mLayoutRepeatCount = 0;
            }

            if (mWindowsChanged && !mWindowChangeListeners.isEmpty()) {
                mH.removeMessages(H.REPORT_WINDOWS_CHANGE);
                mH.sendEmptyMessage(H.REPORT_WINDOWS_CHANGE);
            }
        } catch (RuntimeException e) {
            mInLayout = false;
        }
    }

### 3.3 performLayoutAndPlaceSurfacesLockedInner

    private final void performLayoutAndPlaceSurfacesLockedInner(boolean recoveringMemory) {
        ...
        
        SurfaceControl.openTransaction();
        try {
            ...
            boolean focusDisplayed = false;

            for (int displayNdx = 0; displayNdx < numDisplays; ++displayNdx) {
                final DisplayContent displayContent = mDisplayContents.valueAt(displayNdx);
                 WindowList windows = displayContent.getWindowList();
                ...
                
                int repeats = 0;
                do {
                    repeats++;
                    if (repeats > 6) {
                        displayContent.layoutNeeded = false; //迭代次数过多,则跳出循环
                        break;
                    }
                    if (repeats < 4) {
                        //执行layout操作[]
                        performLayoutLockedInner(displayContent, repeats == 1,
                                false /*updateInputWindows*/);
                    } 
                    ...
                } while (displayContent.pendingLayoutChanges != 0);

                ...
                final int N = windows.size();
                for (i=N-1; i>=0; i--) {
                    WindowState w = windows.get(i);
                    final TaskStack stack = w.getStack();
                    ...
                    if (w.mHasSurface) {
                         //[见小节3.4]
                         final boolean committed =  winAnimator.commitFinishDrawingLocked();
                         if (isDefaultDisplay && committed) {
                             if (w.mAttrs.type == TYPE_DREAM) {
                                 displayContent.pendingLayoutChanges |=
                                         WindowManagerPolicy.FINISH_LAYOUT_REDO_LAYOUT;
                             }
                             if ((w.mAttrs.flags & FLAG_SHOW_WALLPAPER) != 0) {
                                 mInnerFields.mWallpaperMayChange = true;
                                 displayContent.pendingLayoutChanges |=
                                         WindowManagerPolicy.FINISH_LAYOUT_REDO_WALLPAPER;
                                 }
                             }
                         }
                         winAnimator.setSurfaceBoundariesLocked(recoveringMemory);
                     }
                }
                ..
            }

            if (focusDisplayed) {
                mH.sendEmptyMessage(H.REPORT_LOSING_FOCUS);
            }
            
            mDisplayManagerInternal.performTraversalInTransactionFromWindowManager();

        } catch (RuntimeException e) {
            ...
        } finally {
            SurfaceControl.closeTransaction();
        }

        final WindowList defaultWindows = defaultDisplay.getWindowList();
        //app transition准备就绪
        if (mAppTransition.isReady()) {
            defaultDisplay.pendingLayoutChanges |= handleAppTransitionReadyLocked(defaultWindows);
        }
        //app transition已完成
        if (!mAnimator.mAppWindowAnimating && mAppTransition.isRunning()) {
            defaultDisplay.pendingLayoutChanges |= handleAnimatingStoppedAndTransitionLocked();
        }
        ...
        
        if (mFocusMayChange) {
            mFocusMayChange = false;
            if (updateFocusedWindowLocked(UPDATE_FOCUS_PLACING_SURFACES,
                    false /*updateInputWindows*/)) {
                updateInputWindowsNeeded = true;
                defaultDisplay.pendingLayoutChanges |= WindowManagerPolicy.FINISH_LAYOUT_REDO_ANIM;
            }
        }
        ...
        if (mInnerFields.mOrientationChangeComplete) {
            if (mWindowsFreezingScreen != WINDOWS_FREEZING_SCREENS_NONE) {
                mWindowsFreezingScreen = WINDOWS_FREEZING_SCREENS_NONE;
                mLastFinishedFreezeSource = mInnerFields.mLastWindowFreezeSource;
                mH.removeMessages(H.WINDOW_FREEZE_TIMEOUT);
            }
            stopFreezingDisplayLocked();
        }

        // 销毁所有不再可见窗口的surface
        boolean wallpaperDestroyed = false;
        i = mDestroySurface.size();
        if (i > 0) {
            do {
                i--;
                WindowState win = mDestroySurface.get(i);
                win.mDestroying = false;
                if (mInputMethodWindow == win) {
                    mInputMethodWindow = null;
                }
                if (win == mWallpaperTarget) {
                    wallpaperDestroyed = true;
                }
                win.mWinAnimator.destroySurfaceLocked();
            } while (i > 0);
            mDestroySurface.clear();
        }

        // 移除所有正在退出的token
        for (int displayNdx = 0; displayNdx < numDisplays; ++displayNdx) {
            final DisplayContent displayContent = mDisplayContents.valueAt(displayNdx);
            ArrayList<WindowToken> exitingTokens = displayContent.mExitingTokens;
            for (i = exitingTokens.size() - 1; i >= 0; i--) {
                WindowToken token = exitingTokens.get(i);
                if (!token.hasVisible) {
                    exitingTokens.remove(i);
                    if (token.windowType == TYPE_WALLPAPER) {
                        mWallpaperTokens.remove(token);
                    }
                }
            }
        }
        
        // 移除所有正在退出的applicatin
        for (int stackNdx = mStackIdToStack.size() - 1; stackNdx >= 0; --stackNdx) {
            final AppTokenList exitingAppTokens =
                    mStackIdToStack.valueAt(stackNdx).mExitingAppTokens;
            for (i = exitingAppTokens.size() - 1; i >= 0; i--) {
                AppWindowToken token = exitingAppTokens.get(i);
                if (!token.hasVisible && !mClosingApps.contains(token) &&
                        (!token.mIsExiting || token.allAppWindows.isEmpty())) {
                    token.mAppAnimator.clearAnimation();
                    token.mAppAnimator.animating = false;
                    token.removeAppFromTaskLocked();
                }
            }
        }
        ...

        mInputMonitor.updateInputWindowsLw(true /*force*/);
        ...
        
        if (mTurnOnScreen) {
            if (mAllowTheaterModeWakeFromLayout
                    || Settings.Global.getInt(mContext.getContentResolver(),
                        Settings.Global.THEATER_MODE_ON, 0) == 0) {
                mPowerManager.wakeUp(SystemClock.uptimeMillis(), "android.server.wm:TURN_ON");
            }
            mTurnOnScreen = false;
        }

        if (mInnerFields.mUpdateRotation) {
            if (DEBUG_ORIENTATION) Slog.d(TAG, "Performing post-rotate rotation");
            if (updateRotationUncheckedLocked(false)) {
                mH.sendEmptyMessage(H.SEND_NEW_CONFIGURATION);
            } else {
                mInnerFields.mUpdateRotation = false;
            }
        }

        if (mWaitingForDrawnCallback != null ||
                (mInnerFields.mOrientationChangeComplete && !defaultDisplay.layoutNeeded &&
                        !mInnerFields.mUpdateRotation)) {
            checkDrawnWindowsLocked();
        }
        ...

        for (int displayNdx = mDisplayContents.size() - 1; displayNdx >= 0; --displayNdx) {
            mDisplayContents.valueAt(displayNdx).checkForDeferredActions();
        }

        if (updateInputWindowsNeeded) {
            mInputMonitor.updateInputWindowsLw(false /*force*/);
        }
        setFocusedStackFrame();
        
        enableScreenIfNeededLocked();//确定屏幕处于使能状态
        scheduleAnimationLocked(); //调度动画
    }

### 3.4 commitFinishDrawingLocked
[-> WindowStateAnimator.java]

    boolean commitFinishDrawingLocked() {

        if (mDrawState != COMMIT_DRAW_PENDING && mDrawState != READY_TO_SHOW) {
            return false;
        }

        mDrawState = READY_TO_SHOW;
        final AppWindowToken atoken = mWin.mAppToken;
        if (atoken == null || atoken.allDrawn || mWin.mAttrs.type == TYPE_APPLICATION_STARTING) {
            //[见小节3.5]
            return performShowLocked();
        }
        return false;
    }
    
### 3.5 performShowLocked
[-> WindowStateAnimator.java]

    boolean performShowLocked() {
        if (mWin.isHiddenFromUserLocked()) {
            mWin.hideLw(false); //隐藏该layer
            return false;
        }

        if (mDrawState == READY_TO_SHOW && mWin.isReadyForDisplayIgnoringKeyguard()) {
            mService.enableScreenIfNeededLocked();
            applyEnterAnimationLocked(); //动画进入

            mDrawState = HAS_DRAWN;
            mService.scheduleAnimationLocked(); //调度动画

            int i = mWin.mChildWindows.size();
            while (i > 0) {
                i--;
                WindowState c = mWin.mChildWindows.get(i);
                if (c.mAttachedHidden) {
                    c.mAttachedHidden = false;
                    if (c.mWinAnimator.mSurfaceControl != null) {
                        c.mWinAnimator.performShowLocked();
                        final DisplayContent displayContent = c.getDisplayContent();
                        if (displayContent != null) {
                            displayContent.layoutNeeded = true;
                        }
                    }
                }
            }

            if (mWin.mAttrs.type != TYPE_APPLICATION_STARTING
                    && mWin.mAppToken != null) {
                mWin.mAppToken.firstWindowDrawn = true;

                if (mWin.mAppToken.startingData != null) {
                    clearAnimation();
                    mService.mFinishedStarting.add(mWin.mAppToken);
                    // 结束StartingWindow
                    mService.mH.sendEmptyMessage(H.FINISHED_STARTING);
                }
                mWin.mAppToken.updateReportedVisibilityLocked();
            }
            return true;
        }
        return false;
    }

通过向"android.display"线程的mH发送FINISHED_STARTING消息.接下来进入handleMessage方法.

### 3.6 H.FINISHED_STARTING
[-> WindowManagerService.java ::H]

    final class H extends Handler {
        public void handleMessage(Message msg) {
            case FINISHED_STARTING: {
                IBinder token = null;
                View view = null;
                while (true) {
                    synchronized (mWindowMap) {
                        final int N = mFinishedStarting.size();
                        if (N <= 0) {
                            break;
                        }
                        AppWindowToken wtoken = mFinishedStarting.remove(N-1);

                        view = wtoken.startingView;
                        token = wtoken.token;
                        wtoken.startingData = null;
                        wtoken.startingView = null;
                        wtoken.startingWindow = null;
                        wtoken.startingDisplayed = false;
                    }
                    //[见小节3.7]
                    mPolicy.removeStartingWindow(token, view);
                    
                }
            } break;
            ...
        }
    }

此处mPolicy为PhoneWindowManager对象.

### 3.7 removeStartingWindow
[-> PhoneWindowManager.java]

    public void removeStartingWindow(IBinder appToken, View window) {

        if (window != null) {
            WindowManager wm = (WindowManager)mContext.getSystemService(Context.WINDOW_SERVICE);
            wm.removeView(window);
        }
    }

### 3.8 WMI.removeView
[-> WindowManagerImpl.java]

    public void removeView(View view) {
        mGlobal.removeView(view, false);
    }

## 四. 总结

可见,startingWindow的整个启动和结束过程, 主要发送在"android.display"这个Looper线程, 其中启动和结束最终分别调用了WindowManagerGlobal对象的addView()和removeView()操作,其间还有动画调度操作.
流程如下:

    AS.startActivityLocked
        WMS.setAppStartingWindow
            PhoneWindowManager.addStartingWindow
                WindowManagerImpl.addView


    WMS.performLayoutAndPlaceSurfacesLocked
        WMS.performLayoutAndPlaceSurfacesLockedLoop
            WMS.performLayoutAndPlaceSurfacesLockedInner
                WindowStateAnimator.commitFinishDrawingLocked
                    WindowStateAnimator.performShowLocked
                        PhoneWindowManager.removeStartingWindow
                            WindowManagerImpl.removeView

关于窗口的添加和删除,后续再进一步展开.
