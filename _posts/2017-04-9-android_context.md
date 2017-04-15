---
layout: post
title:  "理解Android Context"
date:   2017-4-09 23:33:30
catalog:    true
tags:
    - android

---

## 一. 概述

接触过Android的小伙伴, 一定不会对Context感到陌生, 有大量的场景使用都离不开Context, 下面列举部分常见场景:

- 启动Activity (startActivity)
- 启动服务 (startService)
- 发送广播 (sendBroadcast), 注册广播接收者 (registerReceiver)
- 获取ContentResolver (getContentResolver)
- 获取类加载器 (getClassLoader)
- 打开或创建数据库 (openOrCreateDatabase)
- 获取资源 (getResources)
- ...

 四大组件,各种资源操作以及其他很多场景都离不开Context, 那么Context到底是何方神圣呢?
中文意思为上下文, 顾名思义就是在某一个场景中本身所包含的一些潜在信息. 举个例子来说明, 比如当下你正在看Gityuan博客
作为一个Context, 那么这个上下文就会隐藏 博客作者, 博客网址, 博客目录等信息, 其中通过Contet.getAuthor()就能返回"Gityuan".
这就是上下文, 某一个场景背后所隐藏的信息.

回到主题, Android Context本身是一个抽象类. ContextImpl, Activity, Service, Application这些都是Context的直接或间接子类,
下面通过看看这些类的关系,如下: [点击查看大图](http://www.gityuan.com/images/context/context.jpg)

![context](/images/context/context.jpg)


图解:

1. Application, Activity, Service都会通过attach()方法会调用到ContextWrapper的attachBaseContext;
从而设置其父类ContextWrapper的成员变量mBase值为ContextImpl对象;ContextWrapper的核心工作都是交给mBase来完成, 也就是ContextImpl类.
2. Android四大组件都会属于某一个Application,那么这些组件获取Application的途径:
    - Activity/Service: 是通过调用其方法getApplication(),可主动获取当前所在mApplication;
        - mApplication是由LoadedApk.makeApplication()过程所初始化的;
    - Receiver: 是通过其方法onReceive()的第一个参数指向通当前所在Application,也就是只有接收到广播的时候才能拿到当前的Application对象;
    - provider: 目前没有提供直接获取当前所在Application的方法, 但可通过getContext()可以获取当前的ContextImpl.

## 二. 组件分析
要理解Context, 需要依次来看看四大组件的初始化过程.

### 2.1 Activity
[-> ActivityThread.java]

    private Activity performLaunchActivity(ActivityClientRecord r, Intent customIntent) {
        ...
        ActivityInfo aInfo = r.activityInfo;
        if (r.packageInfo == null) {
            //step 1: 创建LoadedApk对象
            r.packageInfo = getPackageInfo(aInfo.applicationInfo, r.compatInfo,
                    Context.CONTEXT_INCLUDE_CODE);
        }
        ... //component初始化过程

        java.lang.ClassLoader cl = r.packageInfo.getClassLoader();
        //step 2: 创建Activity对象
        Activity activity = mInstrumentation.newActivity(cl, component.getClassName(), r.intent);
        ...

        //step 3: 创建Application对象
        Application app = r.packageInfo.makeApplication(false, mInstrumentation);

        if (activity != null) {
            //step 4: 创建ContextImpl对象
            Context appContext = createBaseContextForActivity(r, activity);
            CharSequence title = r.activityInfo.loadLabel(appContext.getPackageManager());
            Configuration config = new Configuration(mCompatConfiguration);
            //step5: 将Application/ContextImpl都attach到Activity对象 [见小节4.3.1]
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
                //step 6: 执行回调onCreate
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


startActivity的过程最终会在目标进程执行performLaunchActivity()方法, 该方法主要功能:

1. 创建对象LoadedApk;
2. 创建对象Activity;
3. 创建对象Application;
4. 创建对象ContextImpl;
5. Application/ContextImpl都attach到Activity对象;
6. 执行onCreate()等回调;

### 2.2 Service
[-> ActivityThread.java]

    private void handleCreateService(CreateServiceData data) {
        ...
        //step 1: 创建LoadedApk
        LoadedApk packageInfo = getPackageInfoNoCheck(
            data.info.applicationInfo, data.compatInfo);

        java.lang.ClassLoader cl = packageInfo.getClassLoader();
        //step 2: 创建Service对象
        service = (Service) cl.loadClass(data.info.name).newInstance();

        //step 3: 创建ContextImpl对象
        ContextImpl context = ContextImpl.createAppContext(this, packageInfo);
        context.setOuterContext(service);

        //step 4: 创建Application对象
        Application app = packageInfo.makeApplication(false, mInstrumentation);

        //step 5: 将Application/ContextImpl都attach到Activity对象 [见小节4.3.2]
        service.attach(context, this, data.info.name, data.token, app,
                ActivityManagerNative.getDefault());

        //step 6: 执行onCreate回调
        service.onCreate();
        mServices.put(data.token, service);
        ActivityManagerNative.getDefault().serviceDoneExecuting(
                data.token, SERVICE_DONE_EXECUTING_ANON, 0, 0);
        ...
    }

整个过程:

1. 创建对象LoadedApk;
2. 创建对象Service;
3. 创建对象ContextImpl;
4. 创建对象Application;
5. Application/ContextImpl分别attach到Service对象;
6. 执行onCreate()回调;


### 2.3 BroadcastReceiver
[-> ActivityThread.java]

    private void handleReceiver(ReceiverData data) {
        ...
        String component = data.intent.getComponent().getClassName();
        //step 1: 创建LoadedApk对象
        LoadedApk packageInfo = getPackageInfoNoCheck(
                data.info.applicationInfo, data.compatInfo);

        IActivityManager mgr = ActivityManagerNative.getDefault();
        java.lang.ClassLoader cl = packageInfo.getClassLoader();
        data.intent.setExtrasClassLoader(cl);
        data.intent.prepareToEnterProcess();
        data.setExtrasClassLoader(cl);
        //step 2: 创建BroadcastReceiver对象
        BroadcastReceiver receiver = (BroadcastReceiver)cl.loadClass(component).newInstance();

        //step 3: 创建Application对象
        Application app = packageInfo.makeApplication(false, mInstrumentation);

        //step 4: 创建ContextImpl对象
        ContextImpl context = (ContextImpl)app.getBaseContext();
        sCurrentBroadcastIntent.set(data.intent);
        receiver.setPendingResult(data);

        //step 5: 执行onReceive回调 [见小节4.3.3]
        receiver.onReceive(context.getReceiverRestrictedContext(), data.intent);
        ...
    }

整个过程:

1. 创建对象LoadedApk;
2. 创建对象BroadcastReceiver;
3. 创建对象Application;
4. 创建对象ContextImpl;
5. 执行onReceive()回调;

### 2.4 Provider
[-> ActivityThread.java]

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
                //step 1/2: 创建LoadedApk和ContextImpl对象
                c = context.createPackageContext(ai.packageName,Context.CONTEXT_INCLUDE_CODE);
            }

            final java.lang.ClassLoader cl = c.getClassLoader();
            //step 3: 创建ContentProvider对象
            localProvider = (ContentProvider)cl.loadClass(info.name).newInstance();
            provider = localProvider.getIContentProvider();

            //step 4/5: ContextImpl都attach到ContentProvider对象,并执行回调onCreate [见小节4.3.4]
            localProvider.attachInfo(c, info);
        } else {
            ...
        }
        ...
        return retHolder;
    }

该方法主要功能:

1. 创建对象LoadedApk;
2. 创建对象ContextImpl;
3. 创建对象ContentProvider;
4. ContextImpl都attach到Service对象;
5. 执行onCreate回调;

### 2.5 Application
[-> ActivityThread.java]

    private void handleBindApplication(AppBindData data) {
        //step 1: 创建LoadedApk对象
        data.info = getPackageInfoNoCheck(data.appInfo, data.compatInfo);
        ...
        //step 2: 创建ContextImpl对象;
        final ContextImpl appContext = ContextImpl.createAppContext(this, data.info);

        //step 3: 创建Instrumentation
        mInstrumentation = new Instrumentation();

        //step 4: 创建Application对象; [见小节3.2]
        Application app = data.info.makeApplication(data.restrictedBackupMode, null);
        mInitialApplication = app;

        //step 5: 安装providers
        List<ProviderInfo> providers = data.providers;
        installContentProviders(app, providers);

        //step 6: 执行Application.Create回调
        mInstrumentation.callApplicationOnCreate(app);

该过程主要功能:

1. 创建对象LoadedApk
2. 创建对象ContextImpl;
3. 创建对象Instrumentation;
4. 创建对象Application;
5. 安装providers;
6. 执行Create回调;

## 三. 原理分析

上面介绍了4大组件以及Application的初始化过程, 接下来再进一步说明其中LoadedApk, ContextImpl, Application的初始化过程.

### 3.1 创建LoadedApk

#### 3.1.1 AT.getPackageInfo
[-> ActivityThread.java]

    public final LoadedApk getPackageInfo(ApplicationInfo ai, CompatibilityInfo compatInfo,
            int flags) {
        boolean includeCode = (flags&Context.CONTEXT_INCLUDE_CODE) != 0;
        //是否违反隐私问题
        boolean securityViolation = includeCode && ai.uid != 0
                && ai.uid != Process.SYSTEM_UID && (mBoundApplication != null
                        ? !UserHandle.isSameApp(ai.uid, mBoundApplication.appInfo.uid)
                        : true);
        boolean registerPackage = includeCode && (flags&Context.CONTEXT_REGISTER_PACKAGE) != 0;
        ...
        return getPackageInfo(ai, compatInfo, null, securityViolation, includeCode,
                registerPackage);
    }

当securityViolation=true,则代表违反隐私问题, 会抛出SecurityException异常.

#### 3.1.2 AT.getPackageInfo
[-> ActivityThread.java]

    private LoadedApk getPackageInfo(ApplicationInfo aInfo, CompatibilityInfo compatInfo,
        ClassLoader baseLoader, boolean securityViolation, boolean includeCode,
            boolean registerPackage) {
        final boolean differentUser = (UserHandle.myUserId() != UserHandle.getUserId(aInfo.uid));
        synchronized (mResourcesManager) {
            WeakReference<LoadedApk> ref;
            if (differentUser) {
                ref = null;
            } else if (includeCode) {
                ref = mPackages.get(aInfo.packageName); //从mPackages查询
            } else {
                ...
            }

            LoadedApk packageInfo = ref != null ? ref.get() : null;
            if (packageInfo == null || (packageInfo.mResources != null
                    && !packageInfo.mResources.getAssets().isUpToDate())) {
                //创建LoadedApk对象, 此时baseLoader为null
                packageInfo = new LoadedApk(this, aInfo, compatInfo, baseLoader,
                            securityViolation, includeCode &&
                            (aInfo.flags&ApplicationInfo.FLAG_HAS_CODE) != 0, registerPackage);
                ...

                if (differentUser) {
                    ...
                } else if (includeCode) {
                    //将新创建的LoadedApk加入到mPackages
                    mPackages.put(aInfo.packageName, new WeakReference<LoadedApk>(packageInfo));
                } else {
                    ...
                }
            }
            return packageInfo;
        }
    }

该方法主要功能:

- mPackages的数据类型为ArrayMap<String, WeakReference<LoadedApk>>,记录着每一个包名所对应的LoadedApk对象的弱引用;
- 当mPackages没有找到相应的LoadedApk对象, 则创建该对象并加入到mPackages.

#### 3.1.3 AT.getPackageInfoNoCheck

    public final LoadedApk getPackageInfoNoCheck(ApplicationInfo ai,
            CompatibilityInfo compatInfo) {
        return getPackageInfo(ai, compatInfo, null, false, true, false);
    }

除了Activity的初始化, 其他组件初始化都是采用该方法,有默认参数值, 主要功能还是一致的.

- securityViolation=false,则不进行是否违反隐私的监测;
- registerPackage=false, 则在获取类加载器(getClassLoader)时,不会将该package添加到当前所在进程的成员变量pkgDeps.

### 3.2 创建Application
有了LoadedApk对象, 接下来可以创建Application对象, 该对象一个Apk只会创建一次.

#### 3.2.1 LoadedApk.makeApplication
[-> LoadedApk.java]

    public Application makeApplication(boolean forceDefaultAppClass,
            Instrumentation instrumentation) {
        //保证一个LoadedApk对象只创建一个对应的Application对象
        if (mApplication != null) {
            return mApplication;
        }

        String appClass = mApplicationInfo.className;
        if (forceDefaultAppClass || (appClass == null)) {
            appClass = "android.app.Application"; //设置应用类名
        }


        java.lang.ClassLoader cl = getClassLoader();
        if (!mPackageName.equals("android")) {
            initializeJavaContextClassLoader();
        }

        //创建ContextImpl对象
        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        //创建Application对象, 并将appContext attach到新创建的Application[见3.2.2]
        Application app = mActivityThread.mInstrumentation.newApplication(cl, appClass, appContext);
        appContext.setOuterContext(app);
        ...

        mActivityThread.mAllApplications.add(app);
        mApplication = app; //将刚创建的app赋值给mApplication
        ...
        return app;
    }

该方法主要功能:

1. 获取当前应用的ClassLoader对象,根据是否为"android"来决定调用initializeJavaContextClassLoader()的过程;
2. 根据当前ActivityThread对象来创建相应的ContextImpl对象
3. 创建Application对象, 初始化其成员变量:
    - mBase指向新创建ContextImpl;
    - mLoadedApk指向当前所在的LoadedApk对象;
4. 将新创建的Application对象保存到ContextImpl的成员变量mOuterContext.

关于initializeJavaContextClassLoader()的过程, 见文章[理解Application初始化](http://gityuan.com/2017/04/02/android-application/)的[小节2.9].

关于应用类名采用的是Apk中声明的应用类名,即Manifest.xml中定义的类名. 有两种特殊情况会强制
设置应用类名为"android.app.Application":

- 当forceDefaultAppClass=true, 目前只有system_server进程初始化包名为"android"的apk过程会调用;
- Apk没有自定义应用类名的情况.

#### 3.2.2 newApplication
[-> Instrumentation.java]

    static public Application newApplication(Class<?> clazz, Context context)
            throws InstantiationException, IllegalAccessException, ClassNotFoundException {
        Application app = (Application)clazz.newInstance(); //创建Application
        app.attach(context); //执行attach操作[见小节4.3.5]
        return app;
    }

### 3.3 创建ContextImpl

创建ContextImpl的方式有多种, 不同的组件初始化调用不同的方法,如下:

- Activity: 调用createBaseContextForActivity初始化;
- Service/Application: 调用createAppContext初始化;
- Provider: 调用createPackageContext初始化;
- BroadcastReceiver: 直接从Application.getBaseContext()来获取ContextImpl对象;

#### 3.3.1 createBaseContextForActivity
[-> ActivityThread.java]

    private Context createBaseContextForActivity(ActivityClientRecord r, final Activity activity) {
        int displayId = Display.DEFAULT_DISPLAY;
        try {
            displayId = ActivityManagerNative.getDefault().getActivityDisplayId(r.token);
        } catch (RemoteException e) {
        }

        //创建ContextImpl对象
        ContextImpl appContext = ContextImpl.createActivityContext(
                this, r.packageInfo, displayId, r.overrideConfig);
        appContext.setOuterContext(activity);
        Context baseContext = appContext;
        ...

        return baseContext;
    }

[-> ContextImpl.java]

    static ContextImpl createActivityContext(ActivityThread mainThread,
            LoadedApk packageInfo, int displayId, Configuration overrideConfiguration) {
        return new ContextImpl(null, mainThread, packageInfo,
                null, null, false,
                null, overrideConfiguration, displayId);
    }

Activity采用该方法来初始化ContextImpl对象.

#### 3.3.2 createAppContext
[-> ContextImpl.java]

    static ContextImpl createAppContext(ActivityThread mainThread, LoadedApk packageInfo) {
        if (packageInfo == null) throw new IllegalArgumentException("packageInfo");
        return new ContextImpl(null, mainThread, packageInfo,
                 null, null, false,
                 null, null, Display.INVALID_DISPLAY);
    }

Service/Application采用该方法来初始化ContextImpl对象.

#### 3.3.3 createPackageContext
[-> ContextImpl.java]

    public Context createPackageContext(String packageName, int flags)
            throws NameNotFoundException {
        return createPackageContextAsUser(packageName, flags,
                mUser != null ? mUser : Process.myUserHandle());
    }

    public Context createPackageContextAsUser(String packageName, int flags, UserHandle user)
            throws NameNotFoundException {
        final boolean restricted = (flags & CONTEXT_RESTRICTED) == CONTEXT_RESTRICTED;
        if (packageName.equals("system") || packageName.equals("android")) {
            return new ContextImpl(this, mMainThread, mPackageInfo, mActivityToken,
                    user, restricted, mDisplay, null, Display.INVALID_DISPLAY);
        }

        //创建LoadedApk
        LoadedApk pi = mMainThread.getPackageInfo(packageName, mResources.getCompatibilityInfo(),
                flags | CONTEXT_REGISTER_PACKAGE, user.getIdentifier());
        if (pi != null) {
            //创建ContextImpl
            ContextImpl c = new ContextImpl(this, mMainThread, pi,
                    mActivityToken,user, restricted,
                    mDisplay, null, Display.INVALID_DISPLAY);
            if (c.mResources != null) {
                return c;
            }
        }

    }

provider采用该方法来初始化ContextImpl对象.

#### 3.3.4  ContextImpl初始化
[-> ContextImpl.java]

    class ContextImpl extends Context {
        final ActivityThread mMainThread;
        final LoadedApk mPackageInfo;
        private final IBinder mActivityToken;
        private final String mBasePackageName;
        private Context mOuterContext;
        //缓存Binder服务
        final Object[] mServiceCache = SystemServiceRegistry.createServiceCache();

        private ContextImpl(ContextImpl container, ActivityThread mainThread,
                LoadedApk packageInfo, IBinder activityToken, UserHandle user, boolean restricted,
                Display display, Configuration overrideConfiguration, int createDisplayWithId) {
            mOuterContext = this; //ContextImpl对象
            mMainThread = mainThread; // ActivityThread赋值
            mPackageInfo = packageInfo; // LoadedApk赋值
            mBasePackageName = packageInfo.mPackageName; //mBasePackageName等于“android”
            ...
        }
    }

## 四. Context对比

### 4.1 Context核心方法

再来说说Context相关的几个核心方法:

|对象|方法|含义|返回值类型|
|---|---|---|
|Activity|getApplication()|获取当前所在应用mApplication|Application|
|Service|getApplication()|获取当前所在应用mApplication|Application|
|ContextWrapper|getApplicationContext|等价于ContextImpl的getApplicationContext() |Application|
|ContextImpl|getApplicationContext|mPackageInfo.mApplication或者mMainThread.mInitialApplication |Application|
|ContextWrapper|getBaseContext|获取mBase|ContextImpl|
|ContextImpl|getOuterContext|获取mOuterContext|ContextImpl|
|ContextImpl|getApplicationInfo|mPackageInfo.mApplicationInfo |ApplicationInfo|

Tips:


- ContextImpl的mOuterContext指向外部的Context, 一般地为Application/Activity/Service对象.对于BroadcastReceiver和Provider
- getApplication()和getApplicationContext()这两个方法在大多数情况下是一致的,

### 4.2 getApplicationContext
[-> ContextImpl.java]

    public Context getApplicationContext() {
        return (mPackageInfo != null) ?
                mPackageInfo.getApplication() : mMainThread.getApplication();
    }

说明:

1. mPackageInfo.getApplication(): 返回的是LoadedApk.mApplication
    - Activity/Servie/BroadcastReceiver/Application初始化过程都调用makeApplication()赋值;
2. mMainThread.getApplication(): 返回的是AT.mInitialApplication
    - AT.handleBindApplication()赋值;
    - system_server进程的AT.attach()赋值;

### 4.3 attach过程对比

#### 4.3.1 Activity
[-> Activity.java]

    final void attach(Context context, ActivityThread aThread,
            Instrumentation instr, IBinder token, int ident,
            Application application, Intent intent, ActivityInfo info,
            CharSequence title, Activity parent, String id,
            NonConfigurationInstances lastNonConfigurationInstances,
            Configuration config, String referrer, IVoiceInteractor voiceInteractor) {
        attachBaseContext(context); //调用父类方法设置mBase.
        mUiThread = Thread.currentThread();
        mMainThread = aThread;
        mApplication = application;
        mIntent = intent;
        mComponent = intent.getComponent();
        mActivityInfo = info;
        ...
    }

将新创建的ContextImpl赋值到父类ContextWrapper.mBase变量.

#### 4.3.2 Service
[-> Service.java]

    public final void attach(
            Context context,
            ActivityThread thread, String className, IBinder token,
            Application application, Object activityManager) {
        attachBaseContext(context); //调用父类方法设置mBase.
        mClassName = className;
        mToken = token;
        mApplication = application;
        ...
    }

将新创建的ContextImpl赋值到父类ContextWrapper.mBase变量.

#### 4.3.3 BroadcastReceiver
[-> ContextImpl.java]

    final Context getReceiverRestrictedContext() {
        if (mReceiverRestrictedContext != null) {
            return mReceiverRestrictedContext;
        }
        return mReceiverRestrictedContext = new ReceiverRestrictedContext(getOuterContext());
    }

对于广播来说Context的传递过程, 跟其他组件完全不同. 广播是在onCreate过程通过参数将ReceiverRestrictedContext传递过去的.

#### 4.3.4 ContentProvider
[-> ContentProvider.java]

    public void attachInfo(Context context, ProviderInfo info) {
        attachInfo(context, info, false);
    }

    private void attachInfo(Context context, ProviderInfo info, boolean testing) {
        mNoPerms = testing;

        if (mContext == null) {
            //将新创建ContextImpl对象保存到ContentProvider对象的成员变量mContext
            mContext = context;
            ...
            if (info != null) {
                setReadPermission(info.readPermission);
                setWritePermission(info.writePermission);
                setPathPermissions(info.pathPermissions);
                mExported = info.exported;
                mSingleUser = (info.flags & ProviderInfo.FLAG_SINGLE_USER) != 0;
                setAuthorities(info.authority);
            }
            // 执行onCreate回调;
            ContentProvider.this.onCreate();
        }
    }

该方法主要功能:

- 将新创建ContextImpl对象保存到ContentProvider对象的成员变量mContext;
    - 可通过getContext()获取该ContextImpl;
- 执行onCreate回调;

#### 3.3.5  Application
[-> Application.java]

    final void attach(Context context) {
        attachBaseContext(context); //Application的mBase
        mLoadedApk = ContextImpl.getImpl(context).mPackageInfo;
    }

该方法主要功能:

1. 将新创建的ContextImpl对象保存到Application的父类成员变量mBase;
2. 将当前所在的LoadedApk对象保存到Application的父员变量mLoadedApk;

## 五. 总结

(一) 下面用一幅图来看看核心组件的初始化过程会创建哪些对象:

|类型|LoadedApk|ContextImpl|Application|对象|回调方法|
|---|---|---|---|---|---|
|Activity|√|√|√| Activity|onCreate|
|Service|√|√|√| Service|onCreate|
|Receiver|√|√|√| BroadcastReceiver|onReceive|
|Provider|√|√|×| Provider|onCreate|
|Application|√|√|√| Application|onCreate|

每个Apk都对应唯一的application对象和LoadedApk对象, 当Apk中任意组件的创建过程中,
当其所对应的的LoadedApk和Application没有初始化则会创建, 且只会创建一次.

另外大家会注意到唯有Provider在初始化过程并不会去创建所相应的Application对象.也就意味着当有多个Apk运行在同一个进程的情况下, 第二个apk通过Provider初始化过程再调用getContext().getApplicationContext()返回的并非Application对象, 而是NULL. 这里要注意会抛出空指针异常.


(二) 关于Context attach过程:

- Activity/Service/Application: 调用attachBaseContext(), 将新创建的ContextImpl赋值到父类ContextWrapper.mBase变量;
- ContentProvider: 调用attachInfo(),将新创建ContextImpl对象保存到ContentProvider对象的成员变量mContext;
    - 可通过getContext()获取该ContextImpl;
- BroadcastReceiver: 在onCreate过程通过参数将ReceiverRestrictedContext传递过去的.


(三) 最后, 说一说Context的使用场景

|类型|startActivity|startService|bindService|sendBroadcast|registerReceiver|
|---|---|---|---|---|---|
|Activity|√|√|√| √| √|
|Service|-|√|√| √| √|
|Receiver|-|√|×| √| -|
|Provider|-|√|√| √| √|
|Application|-|√|√| √| √|

说明:

- Receiver不允许bindService/registerReceiver, 这是由于限制性上下文(ReceiverRestrictedContext)所决定的,会直接抛出异常.
- Receiver不允许registerReceiver,也并非绝对的. 当receiver == null用于获取sticky广播;
- startActivity在Activity中可正常使用, 如果是其他组件的话需要startActivity则必须带上FLAG_ACTIVITY_NEW_TASK flags.
- 另外UI相关则要Activity中使用.
