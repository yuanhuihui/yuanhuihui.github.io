

## 一. 概述

Activity组件启动后，窗口并非马上显示，而是先显示starting window，作为Activity的预览窗口。

[startActivity启动过程分析](http://gityuan.com/2016/03/12/start-activity/)介绍了Activity
的启动过程，那么本文将从window角度再来说说这个过程。

## 二. 启动过程

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
                //【见小节1.2】
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

### 1.2  WMS.setAppStartingWindow
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
            //创建启动数据，并发送消息到"android.display"线程来处理ADD_STARTING消息；【见小节1.3】
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

### 1.3 WMS.H.handleMessage
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
              
              //【见小节1.4】
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

### 1.4  PWM.addStartingWindow
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
            //获取WindowManager对象
            wm = (WindowManager)context.getSystemService(Context.WINDOW_SERVICE);
            view = win.getDecorView();

            if (win.isFloating()) {
                return null; //浮动窗口，则不允许作为启动窗口
            }
            //【见小节1.5】
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

接下来，进入WindowManagerImpl对象的addView()方法

### 1.5 WM.addView
http://blog.csdn.net/luoshengyang/article/details/8577789
