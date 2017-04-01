---
layout: post
title:  "理解Context上下文"
date:   2017-3-13 20:12:30
catalog:    true
tags:
    - android

---


## Context对象


### Context


ContextWrapper.getBaseContext: 返回的是成员变量mBase, 即ContextImpl
ContextWrapper.getApplicationContext: 返回的是mBase.getApplicationContext(); 也就是ContextImpl.getApplicationContext.
ContextImpl.getApplicationInfo: 返回的是mPackageInfo.mApplicationInfo (数据类型为ApplicationInfo)
ContextImpl.getApplicationContext:返回的是mPackageInfo.mApplication或者mMainThread.mInitialApplication  (数据类型为Application)


以下两个都是通过LoadedApk.makeApplication所创建的

Service.getApplication: 返回的是成员变量Service.mApplication; (数据类型为Application)
Activity.getApplication:返回的是成员变量Activity.mApplication; (数据类型为Application)


Tips: 连个getApplication和getApplicationContext这两个方法在大多数情况下是一直的.


### 图解

- Application, Activity, Service都会通过attach()方法会调用到ContextWrapper的attachBaseContext,
从而设置其成员变量mBase值为ContextImpl.
- ContextWrapper的核心工作都是交给mBase来完成, 也就是ContextImpl类.
- Application对象获取: Activity, Service提供了getApplication. receiver是通过参数给到的. provider不需要提供,但可通过getContext()可以获取当前的ContextImpl.

## 核心对象初始化

### Activity

    private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
        ...
        ActivityInfo aInfo = r.activityInfo;
        //创建LoadedApk对象
        r.packageInfo = getPackageInfo(aInfo.applicationInfo, r.compatInfo,
                Context.CONTEXT_INCLUDE_CODE);

        ... //component初始化过程

        java.lang.ClassLoader cl = r.packageInfo.getClassLoader();
        //创建Activity对象
        Activity activity = mInstrumentation.newActivity(
                cl, component.getClassName(), r.intent);
        ...

        //创建Application对象
        Application app = r.packageInfo.makeApplication(false, mInstrumentation);

        if (activity != null) {
            //创建ContextImpl对象
            Context appContext = createBaseContextForActivity(r, activity);
            CharSequence title = r.activityInfo.loadLabel(appContext.getPackageManager());
            Configuration config = new Configuration(mCompatConfiguration);
            //将Application/ContextImpl都attach到Activity对象
            activity.attach(appContext, this, getInstrumentation(), r.token,
                    r.ident, app, r.intent, r.activityInfo, title, r.parent,
                    r.embeddedID, r.lastNonConfigurationInstances, config,
                    r.referrer, r.voiceInteractor);

            ...
            int theme = r.activityInfo.getThemeResource();
            if (theme != 0) {
                activity.setTheme(theme);
            }

            activity.mCalled = false;
            if (r.isPersistable()) {
                //执行回调onCreate
                mInstrumentation.callActivityOnCreate(activity, r.state, r.persistentState);
            } else {
                mInstrumentation.callActivityOnCreate(activity, r.state);
            }

            r.activity = activity;
            r.stopped = true;
            if (!r.activity.mFinished) {
                activity.performStart(); //执行回调onStart
                r.stopped = false;
            }
            if (!r.activity.mFinished) {
                //执行回调onRestoreInstanceState
                if (r.isPersistable()) {
                    if (r.state != null || r.persistentState != null) {
                        mInstrumentation.callActivityOnRestoreInstanceState(activity, r.state,
                                r.persistentState);
                    }
                } else if (r.state != null) {
                    mInstrumentation.callActivityOnRestoreInstanceState(activity, r.state);
                }
            }
            ...
            r.paused = true;
            mActivities.put(r.token, r);
        }

        return activity;
    }

该方法主要功能:

- 创建LoadedApk对象
- 创建Activity对象
- 创建Application对象
- 创建ContextImpl对象
- 将Application/ContextImpl都attach到Activity对象
- 执行onCreate等回调

### Service

    private void handleCreateService(CreateServiceData data) {
        ...
        //创建LoadedApk
        LoadedApk packageInfo = getPackageInfoNoCheck(
            data.info.applicationInfo, data.compatInfo);

        java.lang.ClassLoader cl = packageInfo.getClassLoader();
        //创建Service对象
        service = (Service) cl.loadClass(data.info.name).newInstance();

        //创建ContextImpl对象
        ContextImpl context = ContextImpl.createAppContext(this, packageInfo);
        context.setOuterContext(service);

        //创建Application对象
        Application app = packageInfo.makeApplication(false, mInstrumentation);

        //将Application信息attach到Service对象
        service.attach(context, this, data.info.name, data.token, app,
                ActivityManagerNative.getDefault());

        //执行onCreate回调
        service.onCreate();
        mServices.put(data.token, service);
        ActivityManagerNative.getDefault().serviceDoneExecuting(
                data.token, SERVICE_DONE_EXECUTING_ANON, 0, 0);
        ...
    }

整个过程:

- 创建LoadedApk;
- 创建Service对象;
- 创建ContextImpl对象;
- 创建Application对象;
- 将Application/ContextImpl都attach到Service对象
- 执行onCreate回调;

### BroadcastReceiver

    private void handleReceiver(ReceiverData data) {
        ...
        String component = data.intent.getComponent().getClassName();
        //创建LoadedApk对象
        LoadedApk packageInfo = getPackageInfoNoCheck(
                data.info.applicationInfo, data.compatInfo);

        IActivityManager mgr = ActivityManagerNative.getDefault();
        java.lang.ClassLoader cl = packageInfo.getClassLoader();
        data.intent.setExtrasClassLoader(cl);
        data.intent.prepareToEnterProcess();
        data.setExtrasClassLoader(cl);
        //创建BroadcastReceiver对象
        BroadcastReceiver receiver = (BroadcastReceiver)cl.loadClass(component).newInstance();

        //创建Application对象
        Application app = packageInfo.makeApplication(false, mInstrumentation);

        //创建ContextImpl对象
        ContextImpl context = (ContextImpl)app.getBaseContext();
        sCurrentBroadcastIntent.set(data.intent);
        receiver.setPendingResult(data);

        //执行onReceive回调
        receiver.onReceive(context.getReceiverRestrictedContext(), data.intent);
        ...
    }

整个过程:

- 创建LoadedApk;
- 创建BroadcastReceiver对象;
- 创建Application对象;
- 创建ContextImpl对象;
- 执行onReceive回调


### Provider

private IActivityManager.ContentProviderHolder installProvider(Context context,
        IActivityManager.ContentProviderHolder holder, ProviderInfo info,
        boolean noisy, boolean noReleaseNeeded, boolean stable) {
    ContentProvider localProvider = null;
    IContentProvider provider;
    if (holder == null || holder.provider == null) {
        Context c = null;
        ApplicationInfo ai = info.applicationInfo;
        if (context.getPackageName().equals(ai.packageName)) {
            c = context;
        } else if (mInitialApplication != null &&
                mInitialApplication.getPackageName().equals(ai.packageName)) {
            c = mInitialApplication;
        } else {
            //创建ContextImpl对象和LoadedApk对象
            c = context.createPackageContext(ai.packageName,Context.CONTEXT_INCLUDE_CODE);
        }

        final java.lang.ClassLoader cl = c.getClassLoader();
        //创建ContentProvider对象
        localProvider = (ContentProvider)cl.loadClass(info.name).newInstance();
        provider = localProvider.getIContentProvider();

        //将ContextImpl都attach到ContentProvider对象,并执行回调onCreate
        localProvider.attachInfo(c, info);
    } else {
        ...
    }
    ...
    return retHolder;
}

该方法主要功能:

- 创建LoadedApk;
- 创建ContextImpl对象;
- 创建ContentProvider对象
- 将ContextImpl都attach到Service对象
- 执行回调onCreate

###　Ａpplication


    private void handleBindApplication(AppBindData data) {
        //创建LoadedApk对象
        data.info = getPackageInfoNoCheck(data.appInfo, data.compatInfo);
        ...
        //创建ContextImpl对象;
        final ContextImpl appContext = ContextImpl.createAppContext(this, data.info);

        //创建Instrumentation
        mInstrumentation = new Instrumentation();

        //创建Application对象;
        Application app = data.info.makeApplication(data.restrictedBackupMode, null);
        mInitialApplication = app;

        //安装providers
        List<ProviderInfo> providers = data.providers;
        installContentProviders(app, providers);

        //执行Application.Create回调
        mInstrumentation.callApplicationOnCreate(app);

该过程主要功能:

- 创建LoadedApk对象
- 创建ContextImpl对象;
- 创建Instrumentation
- 创建Application对象;
- 安装providers
- 执行Application.Create回调

### 小节

|类型|LoadedApk|ContextImpl|Application|组件|attach|回调|
|---|---|---|---|---|---|
|Activity|||||
