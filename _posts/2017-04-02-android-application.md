---
layout: post
title:  "理解Application创建过程"
date:   2017-04-02 20:12:30
catalog:    true
tags:
    - android

---

## 一. 概述

system进程和app进程都运行着一个或多个app，每个app都会有一个对应的Application对象(该对象
跟LoadedApk一一对应)。下面分别以下两种进程创建Application的过程：

- system_server进程；
- app进程；

## 二. system_server进程

### 2.1 SystemServer.run
[-> SystemServer.java]

    public final class SystemServer {
        private void run() {
            ...
            createSystemContext(); //[见2.2]
            startBootstrapServices(); //开始启动服务
            ...
        }
    }

### 2.2 createSystemContext
[-> SystemServer.java]

    private void createSystemContext() {
        ActivityThread activityThread = ActivityThread.systemMain(); //[见2.3]
        mSystemContext = activityThread.getSystemContext();  //[见2.6.1]
        mSystemContext.setTheme(android.R.style.Theme_DeviceDefault_Light_DarkActionBar);
    }

### 2.3 AT.systemMain
[-> ActivityThread.java]

    public static ActivityThread systemMain() {
        ...
        ActivityThread thread = new ActivityThread();  //[见2.4]
        thread.attach(true);  //[见2.5]
        return thread;
    }

### 2.4 AT初始化
[-> ActivityThread.java]

    public final class ActivityThread {
        //创建ApplicationThread对象
        final ApplicationThread mAppThread = new ApplicationThread();
        final Looper mLooper = Looper.myLooper();
        final H mH = new H();
        //当前进程中首次初始化的app对象
        Application mInitialApplication;
        final ArrayList<Application> mAllApplications;
        //标记当前进程是否为system进程
        boolean mSystemThread = false;
        //记录system进程的ContextImpl对象
        private ContextImpl mSystemContext;

        final ArrayMap<String, WeakReference<LoadedApk>> mPackages;
        static Handler sMainThreadHandler;
        private static ActivityThread sCurrentActivityThread;

        ActivityThread() {
            mResourcesManager = ResourcesManager.getInstance();
        }
    }

其中mInitialApplication的赋值过程分两种场景:

- system_server进程是由ActivityThread.attach()过程赋值;
- 普通app进程是由是由ActivityThread.handleBindApplication()过程赋值;这是进程刚创建后attach到system_server后,
便会binder call到app进程来执行该方法.

AT.currentApplication返回的便是mInitialApplication对象。创建完ActivityThread对象，接下来执行attach()操作。

### 2.5 AT.attach
[-> ActivityThread.java]

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system; //设置mSystemThread为true
        if (!system) {
            ...
        } else { //system进程才执行该流程
            //创建Instrumentation
            mInstrumentation = new Instrumentation();
            //[见小节2.6]
            ContextImpl context = ContextImpl.createAppContext(
                    this, getSystemContext().mPackageInfo);
            //[见小节2.7]
            mInitialApplication = context.mPackageInfo.makeApplication(true, null);
            mInitialApplication.onCreate();
            ...
        }
    }

attach的主要功能：

- 根据LoadedApk对象来创建ContextImpl，对于system进程LoadedApk对象取值为mSystemContext；
- 初始化Application信息。


### 2.6 CI.createAppContext
[-> ContextImpl.java]

    static ContextImpl createAppContext(ActivityThread mainThread, LoadedApk packageInfo) {
        //[见小节2.6.4]
        return new ContextImpl(null, mainThread,
                packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
    }

创建ContextImpl对象有多种方法，常见的有：

    createSystemContext(ActivityThread mainThread)
    createAppContext(ActivityThread mainThread, LoadedApk packageInfo)
    createApplicationContext(ApplicationInfo application, int flags)
    createPackageContext(String packageName, int flags)

此处，packageInfo是getSystemContext().mPackageInfo，getSystemContext()获取的ContextImpl对象，
其成员变量mPackageInfo便是LoadedApk对象。所以先来看看getSystemContext()过程。

#### 2.6.1 AT.getSystemContext

    public ContextImpl getSystemContext() {
        synchronized (this) {
            if (mSystemContext == null) {
                mSystemContext = ContextImpl.createSystemContext(this);
            }
            return mSystemContext;
        }
    }

单例模式创建mSystemContext对象。

#### 2.6.2 CI.createSystemContext

    static ContextImpl createSystemContext(ActivityThread mainThread) {
        //创建LoadedApk对象 【见小节2.6.3】
        LoadedApk packageInfo = new LoadedApk(mainThread);
        // 创建ContextImpl【见小节2.6.4】
        ContextImpl context = new ContextImpl(null, mainThread,
                packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
        ...
        return context;
    }

#### 2.6.3 LoadedApk初始化

    public final class LoadedApk {
        private final ActivityThread mActivityThread;
        private ApplicationInfo mApplicationInfo;
        private Application mApplication;
        final String mPackageName;
        private final ClassLoader mBaseClassLoader;
        private ClassLoader mClassLoader;

        LoadedApk(ActivityThread activityThread) {
            mActivityThread = activityThread; //ActivityThread对象
            mApplicationInfo = new ApplicationInfo(); //创建ApplicationInfo对象
            mApplicationInfo.packageName = "android";
            mPackageName = "android";  //默认包名为"android"
            ...
            mBaseClassLoader = null;
            mClassLoader = ClassLoader.getSystemClassLoader(); //创建ClassLoader
            ...
        }
    }

只有一个参数的LoadedApk构造方法只有createSystemContext()过程才会创建，
其中LoadedApk初始化过程会创建ApplicationInfo对象，且包名为“android”。
创建完LoadedApk对象，接下里创建ContextImpl对象。

#### 2.6.4 ContextImpl初始化

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

首次执行getSystemContext，会创建LoadedApk和contextImpl对象，接下来利用刚创建的LoadedApk对象来创建新的ContextImpl对象。

### 2.7 makeApplication
[-> LoadedApk.java]

    public Application makeApplication(boolean forceDefaultAppClass,
            Instrumentation instrumentation) {
        //保证一个LoadedApk对象只创建一个对应的Application对象
        if (mApplication != null) {
            return mApplication;
        }

        String appClass = mApplicationInfo.className;
        if (forceDefaultAppClass || (appClass == null)) {
            appClass = "android.app.Application"; //system_server进程, 则进入该分支
        }

        //创建ClassLoader对象【见小节2.8】
        java.lang.ClassLoader cl = getClassLoader();
        if (!mPackageName.equals("android")) {
            initializeJavaContextClassLoader();  //[见小节2.9]
        }

        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        //创建Application对象[见2.10]
        Application app = mActivityThread.mInstrumentation.newApplication(cl, appClass, appContext);
        appContext.setOuterContext(app);
        ...

        mActivityThread.mAllApplications.add(app);
        mApplication = app; //将刚创建的app赋值给mApplication
        ...
        return app;
    }

### 2.8  getClassLoader
[-> LoadedApk.java]

    public ClassLoader getClassLoader() {
        synchronized (this) {
            if (mClassLoader != null) {
                return mClassLoader;
            }

            if (mPackageName.equals("android")) {
                if (mBaseClassLoader == null) {
                    //创建Classloader对象
                    mClassLoader = ClassLoader.getSystemClassLoader();
                } else {
                    mClassLoader = mBaseClassLoader;
                }
                return mClassLoader;
            }

            // 当包名不为"android"的情况
            if (mRegisterPackage) {
                //【见小节2.8.1】
                ActivityManagerNative.getDefault().addPackageDependency(mPackageName);
            }

            zipPaths.add(mAppDir);
            libPaths.add(mLibDir);
            apkPaths.addAll(zipPaths);
            ...

            if (mApplicationInfo.isSystemApp()) {
                isBundledApp = true;
                //对于系统app，则添加vendor/lib, system/lib库
                libPaths.add(System.getProperty("java.library.path"));
                ...
            }

            final String zip = TextUtils.join(File.pathSeparator, zipPaths);

            //获取ClassLoader对象【见小节2.8.2】
            mClassLoader = ApplicationLoaders.getDefault().getClassLoader(zip,
                    mApplicationInfo.targetSdkVersion, isBundledApp, librarySearchPath,
                    libraryPermittedPath, mBaseClassLoader);
            return mClassLoader;
        }
    }

#### 2.8.1 AMS.addPackageDependency

    public void addPackageDependency(String packageName) {
        synchronized (this) {
            int callingPid = Binder.getCallingPid();
            if (callingPid == Process.myPid()) {
                return;
            }
            ProcessRecord proc;
            synchronized (mPidsSelfLocked) {
                //查询的进程
                proc = mPidsSelfLocked.get(Binder.getCallingPid());
            }
            if (proc != null) {
                if (proc.pkgDeps == null) {
                    proc.pkgDeps = new ArraySet<String>(1);
                }
                //将目标包名加入到调用者进程的pkgDeps
                proc.pkgDeps.add(packageName);
            }
        }
    }

#### 2.8.2 AL.getClassLoader
[-> ApplicationLoaders.java]

    public ClassLoader getClassLoader(String zip, int targetSdkVersion, boolean isBundled,
                                  String librarySearchPath, String libraryPermittedPath,
                                  ClassLoader parent) {
        //获取父类的类加载器
        ClassLoader baseParent = ClassLoader.getSystemClassLoader().getParent();

        synchronized (mLoaders) {
            if (parent == null) {
                parent = baseParent;
            }

            if (parent == baseParent) {
                ClassLoader loader = mLoaders.get(zip);
                if (loader != null) {
                    return loader;
                }
                //创建PathClassLoader对象
                PathClassLoader pathClassloader = PathClassLoaderFactory.createClassLoader(
                                              zip,
                                              librarySearchPath,
                                              libraryPermittedPath,
                                              parent,
                                              targetSdkVersion,
                                              isBundled);
                mLoaders.put(zip, pathClassloader);
                return pathClassloader;
            }

            PathClassLoader pathClassloader = new PathClassLoader(zip, parent);
            return pathClassloader;
        }
    }



### 2.9 initializeJavaContextClassLoader
[-> LoadedApk.java]

    private void initializeJavaContextClassLoader() {
        IPackageManager pm = ActivityThread.getPackageManager();
        android.content.pm.PackageInfo pi;
        pi = pm.getPackageInfo(mPackageName, 0, UserHandle.myUserId());

        boolean sharedUserIdSet = (pi.sharedUserId != null);
        boolean processNameNotDefault =
            (pi.applicationInfo != null &&
             !mPackageName.equals(pi.applicationInfo.processName));
        boolean sharable = (sharedUserIdSet || processNameNotDefault);
        ClassLoader contextClassLoader =
            (sharable)
            ? new WarningContextClassLoader()
            : mClassLoader;
        //设置当前线程的Context ClassLoader
        Thread.currentThread().setContextClassLoader(contextClassLoader);
    }

### 2.10 newApplication
[-> Instrumentation.java]

    public Application newApplication(ClassLoader cl, String className, Context context)
            throws InstantiationException, IllegalAccessException,
            ClassNotFoundException {
        return newApplication(cl.loadClass(className), context);
    }

此处cl便是前面getClassLoader所获取的PathClassLoader对象。通过其方法loadClass()来加载目标Application对象；

#### 2.10.1 newApplication
[-> Instrumentation.java]

    static public Application newApplication(Class<?> clazz, Context context)
           throws InstantiationException, IllegalAccessException,
           ClassNotFoundException {
       Application app = (Application)clazz.newInstance(); //【见小节2.10.2】
       app.attach(context); //【见小节2.10.3】
       return app;
    }

#### 2.10.2 Application初始化
[-> Application.java]

    public class Application extends ContextWrapper implements ComponentCallbacks2 {
        public LoadedApk mLoadedApk;

        public Application() {
            super(null);
        }
    }

#### 2.10.3 App.attach
[-> Application.java]

    final void attach(Context context) {
        attachBaseContext(context); //Application的mBase
        mLoadedApk = ContextImpl.getImpl(context).mPackageInfo;
    }

该方法主要功能:

1. 将新创建的ContextImpl对象保存到Application的父类成员变量mBase;
2. 将新创建的LoadedApk对象保存到Application的父员变量mLoadedApk;

## 三. App进程

### 3.1 ActivityThread.main
[-> ActivityThread.java]

    public static void main(String[] args) {
        ,,,
        ActivityThread thread = new ActivityThread();
        thread.attach(false);
        ,,,
    }

这是运行在app进程，当进程由zygote fork后执行ActivityThread的main方法。

### 3.2 AT.attach
[-> ActivityThread.java]

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system;
        if (!system) {
            //初始化RuntimeInit.mApplicationObject值
            RuntimeInit.setApplicationObject(mAppThread.asBinder());
            final IActivityManager mgr = ActivityManagerNative.getDefault();
            mgr.attachApplication(mAppThread); //[见小节3.3]
        } else {
            ...
        }
    }

经过binder调用，进入system_server进程，执行如下操作。

### 3.3 AMS.attachApplication
[-> ActivityManagerService.java]

    public final void attachApplication(IApplicationThread thread) {
        synchronized (this) {
            int callingPid = Binder.getCallingPid();
            final long origId = Binder.clearCallingIdentity();
            attachApplicationLocked(thread, callingPid);
            Binder.restoreCallingIdentity(origId);
        }
    }
    
    private final boolean attachApplicationLocked(IApplicationThread thread,
            int pid) {
        ProcessRecord app;
        if (pid != MY_PID && pid >= 0) {
            synchronized (mPidsSelfLocked) {
                app = mPidsSelfLocked.get(pid); // 根据pid获取ProcessRecord
            }
        }
        ...
        
        ApplicationInfo appInfo = app.instrumentationInfo != null
                ? app.instrumentationInfo : app.info;
        //[见流程3.4]
        thread.bindApplication(processName, appInfo, providers, app.instrumentationClass,
                profilerInfo, app.instrumentationArguments, app.instrumentationWatcher,
                app.instrumentationUiAutomationConnection, testMode, enableOpenGlTrace,
                isRestrictedBackupMode || !normalMode, app.persistent,
                new Configuration(mConfiguration), app.compat,
                getCommonServicesLocked(app.isolated),
                mCoreSettingsObserver.getCoreSettingsLocked());
        ...

        return true;
    }

system_server收到attach操作, 然后再向新创建的进程执行handleBindApplication()过程:

### 3.4 AT.handleBindApplication
[-> ActivityThread.java  ::H]

当主线程收到H.BIND_APPLICATION,则调用handleBindApplication

    private void handleBindApplication(AppBindData data) {
        mBoundApplication = data;
        Process.setArgV0(data.processName);//设置进程名
        ...
        //获取LoadedApk对象[见小节3.5]
        data.info = getPackageInfoNoCheck(data.appInfo, data.compatInfo);
        ...

        // 创建ContextImpl上下文[2.6.4]
        final ContextImpl appContext = ContextImpl.createAppContext(this, data.info);
        ...

        try {
            // 此处data.info是指LoadedApk, 通过反射创建目标应用Application对象[见小节2.7]
            Application app = data.info.makeApplication(data.restrictedBackupMode, null);
            mInitialApplication = app;
            ...
            mInstrumentation.onCreate(data.instrumentationArgs);
            mInstrumentation.callApplicationOnCreate(app);

        } finally {
            StrictMode.setThreadPolicy(savedPolicy);
        }
    }

在handleBindApplication()的过程中,会同时设置以下两个值:

- LoadedApk.mApplication
- ActivityThread.mInitialApplication

### 3.5 getPackageInfoNoCheck
[-> ActivityThread.java]

    public final LoadedApk getPackageInfoNoCheck(ApplicationInfo ai,
            CompatibilityInfo compatInfo) {
        return getPackageInfo(ai, compatInfo, null, false, true, false);
    }

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
                //创建LoadedApk对象
                packageInfo = new LoadedApk(this, aInfo, compatInfo, baseLoader,
                            securityViolation, includeCode &&
                            (aInfo.flags&ApplicationInfo.FLAG_HAS_CODE) != 0, registerPackage);

                if (mSystemThread && "android".equals(aInfo.packageName)) {
                    ...
                }

                if (differentUser) {
                    ...
                } else if (includeCode) {
                    //将新创建的LoadedApk加入到mPackages
                    mPackages.put(aInfo.packageName,
                            new WeakReference<LoadedApk>(packageInfo));
                } else {
                    ...
                }
            }
            return packageInfo;
        }
    }

创建LoadedApk对象,并将将新创建的LoadedApk加入到mPackages. 也就是说每个app都会创建唯一的LoadedApk对象.
此处aInfo来源于ProcessRecord.info变量, 也就是进程中的第一个app.

## 四. 总结

(一)system_server进程 [查看大图](http://www.gityuan.com/images/application/system_application.jpg)

其application创建过程都创建对象有ActivityThread，Instrumentation, ContextImpl，LoadedApk，Application。
流程图如下：

![system_application](/images/application/system_application.jpg)

(二) app进程 [查看大图](http://www.gityuan.com/images/application/app_application.jpg)

其application创建过程都创建对象有ActivityThread，ContextImpl，LoadedApk，Application。
流程图如下：

![app_application](/images/application/app_application.jpg)

App进程的Application创建过程，跟system进程的核心逻辑都差不多。只是app进程多了两次binder调用。
