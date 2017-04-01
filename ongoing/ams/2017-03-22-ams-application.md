---
layout: post
title:  "理解Application初始化"
date:   2017-3-12 20:12:30
catalog:    true
tags:
    - android

---

## 二. system_server进程

### 2.1 SystemServer.run
[-> SystemServer.java]

    public final class SystemServer {
        private void run() {
            ...
            createSystemContext(); //[见2.2]
            ...
            startBootstrapServices();
            startCoreServices();
            startOtherServices();
            ...
        }
    }

### 2.2 createSystemContext
[-> SystemServer.java]

    private void createSystemContext() {
        ActivityThread activityThread = ActivityThread.systemMain(); //[见2.3]
        mSystemContext = activityThread.getSystemContext();  //[见2.x]
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

### 2.4 ActivityThread创建
[-> ActivityThread.java]

    public final class ActivityThread {
        final ApplicationThread mAppThread = new ApplicationThread();
        final Looper mLooper = Looper.myLooper();
        final H mH = new H();
        Application mInitialApplication;
        final ArrayList<Application> mAllApplications;

        boolean mSystemThread = false;

        final ArrayMap<String, WeakReference<LoadedApk>> mPackages;
        final ArrayMap<String, WeakReference<LoadedApk>> mResourcePackages;
        final GcIdler mGcIdler = new GcIdler();
        static Handler sMainThreadHandler;
        private static ActivityThread sCurrentActivityThread;

        ActivityThread() {
            mResourcesManager = ResourcesManager.getInstance();
        }
    }


### 2.5 AT.attach
[-> ActivityThread.java]

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system;
        if (!system) {
            ...
        } else {
            try {
                mInstrumentation = new Instrumentation();
                ContextImpl context = ContextImpl.createAppContext(
                        this, getSystemContext().mPackageInfo); //[见小节2.6]
                //[见小节2.8]
                mInitialApplication = context.mPackageInfo.makeApplication(true, null);
                mInitialApplication.onCreate();
            } catch (Exception e) {
                ...
            }
        }
    }


### 2.6 CI.createAppContext
[-> ContextImpl.java]

    static ContextImpl createAppContext(ActivityThread mainThread, LoadedApk packageInfo) {
        return new ContextImpl(null, mainThread,
                packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
    }


#### 2.6.1 ContextImpl创建

    class ContextImpl extends Context {
        private static ArrayMap<String, ArrayMap<String, SharedPreferencesImpl>> sSharedPrefs;
        final ActivityThread mMainThread;
        final LoadedApk mPackageInfo;
        private final IBinder mActivityToken;
        private final UserHandle mUser;
        private final ApplicationContentResolver mContentResolver;
        private final String mBasePackageName;
        private Context mOuterContext;
        final Object[] mServiceCache = SystemServiceRegistry.createServiceCache();
        private final ApplicationContentResolver mContentResolver;

        private ContextImpl(ContextImpl container, ActivityThread mainThread,
                LoadedApk packageInfo, IBinder activityToken, UserHandle user, boolean restricted,
                Display display, Configuration overrideConfiguration, int createDisplayWithId) {
            mOuterContext = this;
            mMainThread = mainThread;
            mActivityToken = activityToken;
            ...

            mPackageInfo = packageInfo;
            mResourcesManager = ResourcesManager.getInstance();
            ...

            if (container != null) {
                ...
            } else {
                //此处packageInfo为uLoadedApk.
                mBasePackageName = packageInfo.mPackageName;
                ApplicationInfo ainfo = packageInfo.getApplicationInfo();
                if (ainfo.uid == Process.SYSTEM_UID && ainfo.uid != Process.myUid()) {
                    mOpPackageName = ActivityThread.currentPackageName(); //[见2.6.2]
                } else {
                    mOpPackageName = mBasePackageName;
                }
            }

            mContentResolver = new ApplicationContentResolver(this, mainThread, user);
        }
    }

#### 2.6.2 AT.currentPackageName

    public static String currentPackageName() {
        ActivityThread am = currentActivityThread();
        return (am != null && am.mBoundApplication != null)
            ? am.mBoundApplication.appInfo.packageName : null;
    }

另外, 顺便说一说currentApplication过程:

    public static Application currentApplication() {
        ActivityThread am = currentActivityThread();
        return am != null ? am.mInitialApplication : null;
    }


此处mInitialApplication的赋值过程分两种场景:

- system_server进程是由ActivityThread.attach()过程赋值;
- 普通app进程是由是由ActivityThread.handleBindApplication()过程赋值;这是进程刚创建后attach到system_server后,
便会binder call到app进程来执行该方法.

对于ContextImpl的成员变量mPackageInfo, 数据类型为LoadedApk,是由以下过程初始化的:

### 2.7 AT.getSystemContext

    public ContextImpl getSystemContext() {
        synchronized (this) {
            if (mSystemContext == null) {
                //[见小节2.6.2]
                mSystemContext = ContextImpl.createSystemContext(this);
            }
            return mSystemContext;
        }
    }

#### 2..2 CI.createSystemContext

    static ContextImpl createSystemContext(ActivityThread mainThread) {
        LoadedApk packageInfo = new LoadedApk(mainThread); //[见小节2.6.3]
        ContextImpl context = new ContextImpl(null, mainThread,
                packageInfo, null, null, false, null, null, Display.INVALID_DISPLAY);
        ...
        return context;
    }

#### 2..3 LoadedApk创建

    public final class LoadedApk {
        private final ActivityThread mActivityThread;
        private ApplicationInfo mApplicationInfo;
        private Application mApplication;
        final String mPackageName;
        private final ClassLoader mBaseClassLoader;
        private ClassLoader mClassLoader;

        LoadedApk(ActivityThread activityThread) {
            mActivityThread = activityThread;
            mApplicationInfo = new ApplicationInfo(); //创建ApplicationInfo对象
            mApplicationInfo.packageName = "android";
            mPackageName = "android"; //默认包名为"android"
            mAppDir = null;
            mResDir = null;
            mSplitAppDirs = null;
            mSplitResDirs = null;
            mOverlayDirs = null;
            mSharedLibraries = null;
            mDataDir = null;
            mDataDirFile = null;
            mLibDir = null;
            mBaseClassLoader = null;
            mSecurityViolation = false;
            mIncludeCode = true;
            mRegisterPackage = false;
            mClassLoader = ClassLoader.getSystemClassLoader(); //创建ClassLoader
            mResources = Resources.getSystem();
        }
    }

#### 2..3.1 ApplicationInfo创建
[-> ApplicationInfo.java]

    public class ApplicationInfo extends PackageItemInfo implements Parcelable {
        public String taskAffinity;
        public String processName;
        public String className;
        public int uid;
        public static final int FLAG_SYSTEM = 1<<0;
        public static final int FLAG_PERSISTENT = 1<<3;
        ...

        public ApplicationInfo() {
        }
    }

再回到小节2.5, ActivityThread.attach过程, 开始执行makeApplication.

### 2.8 makeApplication
[-> LoadedApk.java]

    public Application makeApplication(boolean forceDefaultAppClass,
            Instrumentation instrumentation) {
        if (mApplication != null) {
            return mApplication;
        }

        String appClass = mApplicationInfo.className;
        if (forceDefaultAppClass || (appClass == null)) {
            appClass = "android.app.Application"; //system_server进程, 则进入该分支
        }

        java.lang.ClassLoader cl = getClassLoader();
        if (!mPackageName.equals("android")) {
            ...
        }

        ContextImpl appContext = ContextImpl.createAppContext(mActivityThread, this);
        //[见2.9]
        Application app = mActivityThread.mInstrumentation.newApplication(cl, appClass, appContext);
        appContext.setOuterContext(app);
        ...

        mActivityThread.mAllApplications.add(app);
        mApplication = app;

        if (instrumentation != null) {
            ... //instrumentation为空, 不进入该分支
        }
        ...
        return app;
    }


### 2.9 newApplication
[-> Instrumentation.java]

    public Application newApplication(ClassLoader cl, String className, Context context)
            throws InstantiationException, IllegalAccessException,
            ClassNotFoundException {
        return newApplication(cl.loadClass(className), context);
    }


#### 2.9.1 newApplication
[-> Instrumentation.java]

    static public Application newApplication(Class<?> clazz, Context context)
           throws InstantiationException, IllegalAccessException,
           ClassNotFoundException {
       Application app = (Application)clazz.newInstance();
       app.attach(context);
       return app;
    }

#### 2.9.2 Application初始化
[-> Application.java]

public class Application extends ContextWrapper implements ComponentCallbacks2 {
    public LoadedApk mLoadedApk;

    public Application() {
        super(null);
    }
}

#### 2.9.3 App.attach
[-> Application.java]

    final void attach(Context context) {
        attachBaseContext(context); //设置Application的mBase
        mLoadedApk = ContextImpl.getImpl(context).mPackageInfo;
    }

## 三. App进程

### 3.1 ActivityThread.main
[-> ActivityThread.java]

    public static void main(String[] args) {
        ,,,
        ActivityThread thread = new ActivityThread();
        thread.attach(false);
        ,,,
    }


### 3.2 AT.attach
[-> ActivityThread.java]

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system;
        if (!system) {
            //初始化RuntimeInit.mApplicationObject值
            RuntimeInit.setApplicationObject(mAppThread.asBinder());
            final IActivityManager mgr = ActivityManagerNative.getDefault();
            try {
                mgr.attachApplication(mAppThread); //向system_server执行attach过程.
            } catch (RemoteException ex) {
                // Ignore
            }
        } else {
            ...
        }
    }

system_server收到attach操作之后, 然后再向新创建的进程执行handleBindApplication()过程:

### 3.3 AT.handleBindApplication
[-> ActivityThread.java  ::H]

当主线程收到H.BIND_APPLICATION,则调用handleBindApplication

    private void handleBindApplication(AppBindData data) {
        mBoundApplication = data;
        ...
        Process.setArgV0(data.processName);//设置进程名
        ...
        //获取LoadedApk对象[见小节3.4]
        data.info = getPackageInfoNoCheck(data.appInfo, data.compatInfo);
        ...

        // 创建ContextImpl上下文
        final ContextImpl appContext = ContextImpl.createAppContext(this, data.info);
        ...

        try {
            // 此处data.info是指LoadedApk, 通过反射创建目标应用Application对象[见小节3.5]
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
- AT.mInitialApplication

### 3.4 getPackageInfoNoCheck
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



## 四. CI.getApplicationContext

    public Context getApplicationContext() {
        return (mPackageInfo != null) ?
                mPackageInfo.getApplication() : mMainThread.getApplication();
    }

另外:

- LoadedApk.mApplication: mPackageInfo.getApplication(), 赋值过程:
    - makeApplication(), 3大组件会调用该方法.
- AT.mInitialApplication: mMainThread.getApplication(), 赋值过程:
    - AT.handleBindApplication() 普通app进程;
    - AT.attach  system_server进程;


创建LoadedApk的情况, 只有Activity, Service, broadcast.

### 4.1 AT.installProvider

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
                // 进入此处创建, 多apk. 最终掉用到AT.getPackageInfo()创建LoadedApk以及ContextImpl对象.
                c = context.createPackageContext(ai.packageName,
                        Context.CONTEXT_INCLUDE_CODE);
            }

            try {
                final java.lang.ClassLoader cl = c.getClassLoader();
                //通过反射，创建目标ContentProvider对象
                localProvider = (ContentProvider)cl.
                    loadClass(info.name).newInstance();
                provider = localProvider.getIContentProvider();
                if (provider == null) {
                    return null;
                }
                //回调目标ContentProvider.onCreate方法
                localProvider.attachInfo(c, info);
            } catch (java.lang.Exception e) {
                return null;
            }
        } else {
            ...
        }

        IActivityManager.ContentProviderHolder retHolder;
        synchronized (mProviderMap) {
            IBinder jBinder = provider.asBinder();
            if (localProvider != null) {
                ComponentName cname = new ComponentName(info.packageName, info.name);
                ProviderClientRecord pr = mLocalProvidersByName.get(cname);
                if (pr != null) {
                    provider = pr.mProvider;
                } else {
                    holder = new IActivityManager.ContentProviderHolder(info);
                    holder.provider = provider;
                    holder.noReleaseNeeded = true;
                    pr = installProviderAuthoritiesLocked(provider, localProvider, holder);
                    mLocalProviders.put(jBinder, pr);
                    mLocalProvidersByName.put(cname, pr);
                }
                retHolder = pr.mHolder;
            } else {
                ...
            }
        }
        return retHolder;
    }

#### 4.2  CI.createPackageContext

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
            ContextImpl c = new ContextImpl(this, mMainThread, pi, mActivityToken,
                    user, restricted, mDisplay, null, Display.INVALID_DISPLAY);
            if (c.mResources != null) {
                return c;
            }
        }

    }

#### 4.3  getPackageInfo

    public final LoadedApk getPackageInfo(String packageName, CompatibilityInfo compatInfo,
            int flags, int userId) {
        final boolean differentUser = (UserHandle.myUserId() != userId);
        synchronized (mResourcesManager) {
            WeakReference<LoadedApk> ref;
            if (differentUser) {
                ref = null;
            } else if ((flags & Context.CONTEXT_INCLUDE_CODE) != 0) {
                ref = mPackages.get(packageName);
            } else {
                ref = mResourcePackages.get(packageName);
            }

            LoadedApk packageInfo = ref != null ? ref.get() : null;
            if (packageInfo != null && (packageInfo.mResources == null
                    || packageInfo.mResources.getAssets().isUpToDate())) {
                ...
                return packageInfo;
            }
        }

        // 查询ApplicationInfo
        ApplicationInfo ai = getPackageManager().getApplicationInfo(packageName,
                PackageManager.GET_SHARED_LIBRARY_FILES, userId);


        if (ai != null) {
            return getPackageInfo(ai, compatInfo, flags);
        }
        return null;
    }

#### 4.4

    public final LoadedApk getPackageInfo(ApplicationInfo ai, CompatibilityInfo compatInfo,
            int flags) {
        boolean includeCode = (flags&Context.CONTEXT_INCLUDE_CODE) != 0;
        boolean securityViolation = includeCode && ai.uid != 0
                && ai.uid != Process.SYSTEM_UID && (mBoundApplication != null
                        ? !UserHandle.isSameApp(ai.uid, mBoundApplication.appInfo.uid)
                        : true);
        boolean registerPackage = includeCode && (flags&Context.CONTEXT_REGISTER_PACKAGE) != 0;
        ...
        return getPackageInfo(ai, compatInfo, null, securityViolation, includeCode,
                registerPackage);
    }

#### 4.5

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
                //创建LoadedApk对象, baseLoader为null
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
    
###
