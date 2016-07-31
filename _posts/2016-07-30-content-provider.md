---
layout: post
title:  "理解ContentProvider原理(一)"
date:   2016-07-30 20:30:00
catalog:  true
tags:
    - android
    - 组件
---

> 基于Android 6.0源码剖析，本文涉及的相关源码：

    frameworks/base/core/java/android/app/ActivityThread.java
    frameworks/base/core/java/android/app/ContextImpl.java
    frameworks/base/core/java/android/app/IActivityManager.java
    frameworks/base/core/java/android/content/ContentResolver.java
    frameworks/base/services/core/java/com/android/server/am/ContentProviderRecord.java

    frameworks/base/core/java/android/content/IContentProvider.java
    frameworks/base/core/java/android/content/ContentProvider.java
    frameworks/base/core/java/android/content/ContentProviderNative.java

## 一、概述
ContentProvider(内容提供者)用于提供数据的统一访问格式，封装底层的具体实现。对于数据的使用者来说，无需知晓数据的来源是数据库、文件，或者网络，只需简单地使用ContentProvider提供的数据操作接口，也就是增(insert)、删(delete)、改(update)、查(query)四个过程。

### 1.1 ContentProvider

ContentProvider作为Android四大组件之一，并没有Activity那样复杂的生命周期，只有简单地onCreate过程。ContentProvider是一个抽象类，当实现自己的ContentProvider类，只需继承于ContentProvider，并且实现以下六个abstract方法即可：

- onCreate()：执行初始化工作；
- insert(Uri, ContentValues)：插入新数据；
- delete(Uri, String, String[])：删除已有数据；
- update(Uri, ContentValues, String, String[])：更新数据；
- query(Uri, String[], String, String[], String)：查询数据；
- getType(Uri)：获取数据MIME类型。

### 1.2 Uri
从ContentProvider的数据操作方法可以看出都依赖于Uri，对于Uri有其固定的数据格式，例如：`content://com.gityuan.articles/android/3`

- 前缀：默认开头`content://`;
- 授权：唯一标识`com.gityuan.articles`;
- 路径：指定数据类别以及数据项`/android/3`;

### 1.3 ContentResolver

其他app或者进程想要操作`ContentProvider`，则需要先获取其相应的`ContentResolver`，再利用ContentResolver类来完成对数据的增删改查操作，下面列举一个查询操作，查询得到的是一个`Cursor`结果集，再通过操作该Cursor便可获取想要查询的结果。

    ContentResolver cr = getContentResolver();  //获取ContentResolver
    Uri uri = Uri.parse("content://com.gityuan.articles/android/3");
    Cursor cursor = cr.query(uri, null, null, null, null);  //执行查询操作
    ...
    cursor.close(); //关闭

### 1.4 类图

![content_provider](/images/contentprovider/content_provider.jpg)

## 二、流程分析

接下来，从源码角度来说说，以数据查询`query`的为例来说说ContentProvider的整个完整流程。

### 2.1 相关成员变量

在开始源码分析之前，先说说涉及到的几个关于contentProvider的重要的成员变量。

#### 2.1.1 AMS

    //位于ActivityManagerService.java
    static final int CONTENT_PROVIDER_PUBLISH_TIMEOUT = 10*1000;
    static final int CONTENT_PROVIDER_RETAIN_TIME = 20*1000;
    final ProviderMap mProviderMap;
    final ArrayList<ContentProviderRecord> mLaunchingProviders
            = new ArrayList<ContentProviderRecord>();

- `CONTENT_PROVIDER_PUBLISH_TIMEOUT`: 对于attached进程，用于publish该进程中的ContentProvider的超时时长为10s，超过10s则会被hung住。
- `CONTENT_PROVIDER_RETAIN_TIME`: 保持ContentProvider所在进程的上次活动状态的持续时长为20s，当超过20s则运行其下降到正常的 cached LRU列表，
这样做的目的是为了避免在低内存情况下，ContentProvider所在进程发生波动。
- `mProviderMap`：记录所有的contentProvider
- `mLaunchingProviders`：记录所有的存在client等待其发布完成的contentProvider列表，一旦发布完成则相应的contentProvider便会从该列表移除；

#### 2.1.2 ProcessRecord

    //位于ProcessRecord.java
    final ArrayMap<String, ContentProviderRecord> pubProviders = new ArrayMap<>();
    final ArrayList<ContentProviderConnection> conProviders = new ArrayList<>();

- `pubProviders`：记录进程中所有创建的ContentProvider；
- `conProviders`：记录进程中所有使用的ContentProvider；

#### 2.1.3 ActivityThread

    //位于 ActivityThread.java
    final ArrayMap<ProviderKey, ProviderClientRecord> mProviderMap
        = new ArrayMap<ProviderKey, ProviderClientRecord>();
    final ArrayMap<IBinder, ProviderRefCount> mProviderRefCountMap
        = new ArrayMap<IBinder, ProviderRefCount>();
    final ArrayMap<IBinder, ProviderClientRecord> mLocalProviders
        = new ArrayMap<IBinder, ProviderClientRecord>();
    final ArrayMap<ComponentName, ProviderClientRecord> mLocalProvidersByName
            = new ArrayMap<ComponentName, ProviderClientRecord>();

- `mProviderMap`：记录所有本地和引用对象；
- `mProviderRefCountMap`：记录所有对其他进程中的ContentProvider的引用计数；
- `mLocalProviders`：记录所有本地的ContentProvider，以IBinder以key；
- `mLocalProvidersByName`：记录所有本地的ContentProvider，以组件名为key。

### 2.2 getContentResolver

Context中调用getContentResolver，经过层层调用(过程省略)，最后调用到ContextImpl类。

[-> ContextImpl.java]

    class ContextImpl extends Context {
        public ContentResolver getContentResolver() {
            return mContentResolver;
        }
    }

该方法获取的`mContentResolver`赋值操作是在`ContextImpl`对象实例化过程完成的：

    mContentResolver= new ApplicationContentResolver(this, mainThread, user);

mContentResolver的真实类型为`ApplicationContentResolver`;该类继承于ContentResolver，位于ContextImpl的内部类。获取到ContentResolver(简称CR)。接下来，再来看看query操作。

### 2.3 CR.query

[-> ContentResolver.java]

    public final  Cursor query( Uri uri,  String[] projection,
             String selection,  String[] selectionArgs,
             String sortOrder) {
        return query(uri, projection, selection, selectionArgs, sortOrder, null);
    }

    public final  Cursor query(final  Uri uri,  String[] projection,
                 String selection,  String[] selectionArgs,
                 String sortOrder,  CancellationSignal cancellationSignal) {
            //获取unstable provider【见小节2.4】
            IContentProvider unstableProvider = acquireUnstableProvider(uri);
            if (unstableProvider == null) {
                return null;
            }
            IContentProvider stableProvider = null;
            Cursor qCursor = null;
            try {
                long startTime = SystemClock.uptimeMillis();
                ...
                try {
                    //执行查询操作【见小节2.5】
                    qCursor = unstableProvider.query(mPackageName, uri, projection,
                            selection, selectionArgs, sortOrder, remoteCancellationSignal);
                } catch (DeadObjectException e) {
                    // 远程进程死亡，处理unstable provider死亡过程
                    unstableProviderDied(unstableProvider);
                    //unstable类型死亡后，再创建stable类型的provider
                    stableProvider = acquireProvider(uri);
                    if (stableProvider == null) {
                        return null;
                    //再次执行查询操作
                    qCursor = stableProvider.query(mPackageName, uri, projection,
                            selection, selectionArgs, sortOrder, remoteCancellationSignal);

                }
                if (qCursor == null) {
                    return null;
                }

                //强制执行查询操作，可能会失败并跑出RuntimeException
                qCursor.getCount();
                //创建对象CursorWrapperInner
                CursorWrapperInner wrapper = new CursorWrapperInner(qCursor,
                        stableProvider != null ? stableProvider : acquireProvider(uri));
                stableProvider = null;
                qCursor = null;
                return wrapper;
            } catch (RemoteException e) {
                return null;
            } finally {
                if (qCursor != null) {
                    qCursor.close();
                }
                if (cancellationSignal != null) {
                    cancellationSignal.setRemote(null);
                }
                if (unstableProvider != null) {
                    releaseUnstableProvider(unstableProvider);
                }
                if (stableProvider != null) {
                    releaseProvider(stableProvider);
                }
            }
        }

该方法涉及到ContentProvider的stable与unstable之分，一般地query的流程：

- 调用acquireUnstableProvider()，尝试获取unstable的ContentProvider;
- 然后执行query操作；

但是当在执行query过程抛出DeadObjectException，即代表ContentProvider所在进程死亡，则开始尝试获取stable的ContentProvider，执行流程：

- 先调用unstableProviderDied来处理刚才创建的unstable的ContentProvider；
- 调用acquireProvider()，尝试获取stable的ContentProvider;
- 然后执行query操作；

如果再次发生ContentProvider进程死亡，则会杀掉该ContentProvider所对应的客户端进程。

不论是acquireUnstableProvider还是acquireProvider方法，最终都会调用ActivityThread的同一个方法acquireProvider()。先用一句话说说stable与unstable的区别，采用unstable类型的ContentProvider的app不会因为远程ContentProvider进程的死亡而被杀，stable则恰恰相反。这便是ContentProvider坑爹之处，对于app无法事先决定创建的ContentProvider是stable，还是unstable
类型的，也便无法得知自己的进程是否会依赖于远程ContentProvider的生死。

###  2.4 CR.acquireUnstableProvider
[-> ContentResolver.java]

    public final IContentProvider acquireUnstableProvider(Uri uri) {
        //此处SCHEME_CONTENT = "content"
        if (!SCHEME_CONTENT.equals(uri.getScheme())) {
            return null;
        }
        String auth = uri.getAuthority();
        if (auth != null) {
            //【见小节2.4.1】
            return acquireUnstableProvider(mContext, uri.getAuthority());
        }
        return null;
    }

#### 2.4.1 ACR.acquireUnstableProvider
[-> ContextImpl.java]

    class ContextImpl extends Context {
        private static final class ApplicationContentResolver extends ContentResolver {
            ...
            protected IContentProvider acquireUnstableProvider(Context c, String auth) {
                //【见小节2.4.2】
                return mMainThread.acquireProvider(c,
                        ContentProvider.getAuthorityWithoutUserId(auth),
                        resolveUserIdFromAuthority(auth), false);
            }
        }
    }

getAuthorityWithoutUserId()的过程是字符截断过程，即去掉auth中的UserId信息，比如`com.gityuan.articles@123`，经过该方法处理后就变成了`com.gityuan.articles`。

#### 2.4.2 AT.acquireProvider
[-> ActivityThread.java]

    public final IContentProvider acquireProvider(
            Context c, String auth, int userId, boolean stable) {
        //【见小节2.4.3】
        final IContentProvider provider = acquireExistingProvider(c, auth, userId, stable);
        if (provider != null) {
            //成功获取已经存在的ContentProvider对象，则直接返回
            return provider;
        }

        IActivityManager.ContentProviderHolder holder = null;
        try {
            //【见小节2.4.4】
            holder = ActivityManagerNative.getDefault().getContentProvider(
                    getApplicationThread(), auth, userId, stable);
        } catch (RemoteException ex) {
        }
        if (holder == null) {
            //无法获取auth所对应的provider则直接返回
            return null;
        }

        //安装provider将会增加引用计数【见小节2.4.6】
        holder = installProvider(c, holder, holder.info,
                true , holder.noReleaseNeeded, stable);
        return holder.provider;
    }

该方法的主要功能：

- 首先，尝试获取已存储的provider，当成功获取则直接返回，否则继续执行；
- 通过AMS来获取provider，当无法获取auth所对应的provider则直接返回，否则继续执行；
- 采用installProvider安装provider，并该provider的增加引用计数。

#### 2.4.3 AT.acquireExistingProvider
[-> ActivityThread.java]

    public final IContentProvider acquireExistingProvider(
            Context c, String auth, int userId, boolean stable) {
        synchronized (mProviderMap) {
            final ProviderKey key = new ProviderKey(auth, userId);
            //从mProviderMap查询是否存在相对应的provider
            final ProviderClientRecord pr = mProviderMap.get(key);
            if (pr == null) {
                return null;
            }

            IContentProvider provider = pr.mProvider;
            IBinder jBinder = provider.asBinder();
            if (!jBinder.isBinderAlive()) {
                //当provider所在进程已经死亡则返回
                handleUnstableProviderDiedLocked(jBinder, true);
                return null;
            }

            ProviderRefCount prc = mProviderRefCountMap.get(jBinder);
            if (prc != null) {
                //增加引用计数
                incProviderRefLocked(prc, stable);
            }
            return provider;
        }
    }

- 首先从`mProviderMap`查询是否存在相对应的provider，若不存在则直接返回，否则继续执行；
- 当provider所在进程已经死亡，则回调死亡处理方法`handleUnstableProviderDiedLocked`后返回，否则继续执行；
- 当provider已经存在引用计数，则继续增加引用计数，否则不增加。

#### 2.4.4 AMS.getContentProvider

ActivityManagerNative.getDefault()返回的是AMP，AMP经过binder IPC通信传递给AMS来完成相应工作，关于这个调用过程前面的文章已经讲过多次这里就不再介绍了。

[-> ActivityManagerService.java]

    public final ContentProviderHolder getContentProvider(
            IApplicationThread caller, String name, int userId, boolean stable) {
        if (caller == null) {
            throw new SecurityException();
        }
        return getContentProviderImpl(caller, name, null, stable, userId);
    }

#### 2.4.5 AMS.getContentProviderImpl

    private final ContentProviderHolder getContentProviderImpl(IApplicationThread caller,
            String name, IBinder token, boolean stable, int userId) {
        ContentProviderRecord cpr;
        ContentProviderConnection conn = null;
        ProviderInfo cpi = null;

        synchronized(this) {
            ProcessRecord r = null;
            if (caller != null) {
                r = getRecordForAppLocked(caller);
                //当调用者的进程记录不存在，则抛出异常
                if (r == null) {
                    throw new SecurityException(...);
                }
            }
            ...
            //此处name为authority，检查其相应的ContentProvider是否已经发布
            cpr = mProviderMap.getProviderByName(name, userId);
            ...

            boolean providerRunning = cpr != null;
            //该ContentProvider已发布
            if (providerRunning) {
                cpi = cpr.info;
                //当允许运行在调用者进程且已发布，则直接返回
                if (r != null && cpr.canRunHere(r)) {
                    ContentProviderHolder holder = cpr.newHolder(null);
                    holder.provider = null;
                    return holder;
                }

                final long origId = Binder.clearCallingIdentity();
                //增加引用计数
                conn = incProviderCountLocked(r, cpr, token, stable);
                if (conn != null && (conn.stableCount+conn.unstableCount) == 1) {
                    if (cpr.proc != null && r.setAdj <= ProcessList.PERCEPTIBLE_APP_ADJ) {
                        //更新进程LRU队列
                        updateLruProcessLocked(cpr.proc, false, null);
                    }
                }

                if (cpr.proc != null) {
                    //更新进程adj
                    boolean success = updateOomAdjLocked(cpr.proc);
                    if (!success) {
                        //provider进程被杀
                        boolean lastRef = decProviderCountLocked(conn, cpr, token, stable);
                        appDiedLocked(cpr.proc);
                        if (!lastRef) {
                            return null;
                        }
                        providerRunning = false;
                        conn = null;
                    }
                }
                Binder.restoreCallingIdentity(origId);
            }

            boolean singleton;
            if (!providerRunning) {
                //根据authority，获取ProviderInfo对象
                cpi = AppGlobals.getPackageManager().
                    resolveContentProvider(name,
                        STOCK_PM_FLAGS | PackageManager.GET_URI_PERMISSION_PATTERNS, userId);
                if (cpi == null) {
                    return null;
                }
                singleton = isSingleton(cpi.processName, cpi.applicationInfo,
                        cpi.name, cpi.flags)
                        && isValidSingletonCall(r.uid, cpi.applicationInfo.uid);
                if (singleton) {
                    userId = UserHandle.USER_OWNER;
                }
                cpi.applicationInfo = getAppInfoForUser(cpi.applicationInfo, userId);

                String msg;
                if ((msg = checkContentProviderPermissionLocked(cpi, r, userId, !singleton))
                        != null) {
                    throw new SecurityException(msg);
                }

                if (!mProcessesReady && !mDidUpdate && !mWaitingUpdate
                        && !cpi.processName.equals("system")) {
                    throw new IllegalArgumentException(...);
                }
                //当拥有该provider的用户并没有运行，则直接返回
                if (!isUserRunningLocked(userId, false)) {
                    return null;
                }

                ComponentName comp = new ComponentName(cpi.packageName, cpi.name);
                cpr = mProviderMap.getProviderByClass(comp, userId);
                final boolean firstClass = cpr == null;
                if (firstClass) {
                    final long ident = Binder.clearCallingIdentity();
                    try {
                        ApplicationInfo ai = AppGlobals.getPackageManager().
                          getApplicationInfo(cpi.applicationInfo.packageName, STOCK_PM_FLAGS, userId);
                        if (ai == null) {
                            return null;
                        }
                        ai = getAppInfoForUser(ai, userId);
                        //创建对象ContentProviderRecord
                        cpr = new ContentProviderRecord(this, cpi, ai, comp, singleton);
                    } finally {
                        Binder.restoreCallingIdentity(ident);
                    }
                }

                if (r != null && cpr.canRunHere(r)) {
                    return cpr.newHolder(null);
                }

                final int N = mLaunchingProviders.size();
                int i;
                //从mLaunchingProviders中查询是否存在该cpr
                for (i = 0; i < N; i++) {
                    if (mLaunchingProviders.get(i) == cpr) {
                        break;
                    }
                }
                //当provider并没有处于mLaunchingProviders队列，则启动它
                if (i >= N) {
                    final long origId = Binder.clearCallingIdentity();
                    try {
                         AppGlobals.getPackageManager().setPackageStoppedState(
                                    cpr.appInfo.packageName, false, userId);
                        //查询进程记录ProcessRecord
                        ProcessRecord proc = getProcessRecordLocked(
                                cpi.processName, cpr.appInfo.uid, false);

                        if (proc != null && proc.thread != null) {
                            if (!proc.pubProviders.containsKey(cpi.name)) {
                                proc.pubProviders.put(cpi.name, cpr);
                                //开始安装provider
                                proc.thread.scheduleInstallProvider(cpi);
                            }
                        } else {
                            // 启动进程
                            proc = startProcessLocked(cpi.processName,
                                    cpr.appInfo, false, 0, "content provider",
                                    new ComponentName(cpi.applicationInfo.packageName,
                                            cpi.name), false, false, false);
                            if (proc == null) {
                                return null;
                            }
                        }
                        cpr.launchingApp = proc;
                        //将cpr添加到mLaunchingProviders
                        mLaunchingProviders.add(cpr);
                    } finally {
                        Binder.restoreCallingIdentity(origId);
                    }
                }

                if (firstClass) {
                    mProviderMap.putProviderByClass(comp, cpr);
                }
                mProviderMap.putProviderByName(name, cpr);
                //增加引用计数
                conn = incProviderCountLocked(r, cpr, token, stable);
                if (conn != null) {
                    conn.waiting = true;
                }
            }
        }

        //等待provider发布完成
        synchronized (cpr) {
            while (cpr.provider == null) {
                if (cpr.launchingApp == null) {
                    return null;
                }
                try {
                    if (conn != null) {
                        conn.waiting = true;
                    }
                    cpr.wait();
                } catch (InterruptedException ex) {
                } finally {
                    if (conn != null) {
                        conn.waiting = false;
                    }
                }
            }
        }
        return cpr != null ? cpr.newHolder(conn) : null;
    }

该方法比较长，简单总结整个过程：

1. 调用getRecordForAppLocked获取调用者的进程记录ProcessRecord；
2. 根据authority，从mProviderMap中查询相应的ContentProviderRecord;
3. 当ContentProvider已发布时：
    - 权限检查
    - 当允许运行在调用者进程且已发布，则直接返回
    - 增加引用计数
    - 更新进程LRU队列
    - 更新进程adj
    - 当provider进程被杀时，则减少引用计数并调用appDiedLocked，且设置ContentProvider为没有发布的状态
4. 当ContentProvider没有发布时：
    - 根据authority，获取ProviderInfo对象；
    - 权限检查
    - 当provider不是运行在system进程，且系统未准备好，则抛出IllegalArgumentException
    - 当拥有该provider的用户并没有运行，则直接返回
    - 根据ComponentName，从mProviderMap中查询相应的ContentProviderRecord;
    - 当首次调用，则创建对象ContentProviderRecord
    - 当允许运行在调用者进程且ProcessRecord不为空，则直接返回
    - 当provider并没有处于mLaunchingProviders队列，则启动它
        - 当ProcessRecord不为空，则加入到pubProviders，并开始安装provider;
        - 当ProcessRecord为空，则启动进程
    - 增加引用计数
5. 等待provider发布完成

**小知识**：CPR.canRunHere
[-> ContentProviderRecord.java]

    public boolean canRunHere(ProcessRecord app) {
        return (info.multiprocess || info.processName.equals(app.processName))
                && uid == app.info.uid;
    }

该ContentProvider是否能运行在调用者所在进程需要满足以下条件：

- 条件1：ContentProvider在AndroidManifest.xml文件配置multiprocess=true；或调用者进程与ContentProvider在同一个进程。
- 条件2：ContentProvider进程跟调用者所在进程是同一个uid。

#### 2.4.6 AT.installProvider

[-> ActivityThread.java]

    private IActivityManager.ContentProviderHolder installProvider(Context context,
            IActivityManager.ContentProviderHolder holder, ProviderInfo info,
            boolean noisy, boolean noReleaseNeeded, boolean stable) {
        ContentProvider localProvider = null;
        IContentProvider provider;
        if (holder == null || holder.provider == null) {
            ...
        } else {
            provider = holder.provider; //进入该分支
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
                //根据jBinder，从mProviderRefCountMap中查询相应的ProviderRefCount
                ProviderRefCount prc = mProviderRefCountMap.get(jBinder);
                if (prc != null) {
                    if (!noReleaseNeeded) {
                        incProviderRefLocked(prc, stable);
                        ActivityManagerNative.getDefault().removeContentProvider(
                                holder.connection, stable);
                        ...
                    }
                } else {
                    ProviderClientRecord client = installProviderAuthoritiesLocked(
                            provider, localProvider, holder);
                    if (noReleaseNeeded) {
                        prc = new ProviderRefCount(holder, client, 1000, 1000);
                    } else {
                        prc = stable
                                ? new ProviderRefCount(holder, client, 1, 0)
                                : new ProviderRefCount(holder, client, 0, 1);
                    }
                    mProviderRefCountMap.put(jBinder, prc);
                }
                retHolder = prc.holder;
            }
        }
        return retHolder;
    }

### 2.5 CPP.query
[-> ContentProviderNative.java ::ContentProviderProxy]

    public Cursor query(String callingPkg, Uri url, String[] projection, String selection,
            String[] selectionArgs, String sortOrder, ICancellationSignal cancellationSignal)
                    throws RemoteException {
        //实例化BulkCursorToCursorAdaptor对象
        BulkCursorToCursorAdaptor adaptor = new BulkCursorToCursorAdaptor();
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        try {
            data.writeInterfaceToken(IContentProvider.descriptor);
            data.writeString(callingPkg);
            url.writeToParcel(data, 0);
            int length = 0;
            if (projection != null) {
                length = projection.length;
            }
            data.writeInt(length);
            for (int i = 0; i < length; i++) {
                data.writeString(projection[i]);
            }
            data.writeString(selection);
            if (selectionArgs != null) {
                length = selectionArgs.length;
            } else {
                length = 0;
            }
            data.writeInt(length);
            for (int i = 0; i < length; i++) {
                data.writeString(selectionArgs[i]);
            }
            data.writeString(sortOrder);
            data.writeStrongBinder(adaptor.getObserver().asBinder());
            data.writeStrongBinder(cancellationSignal != null ? cancellationSignal.asBinder() : null);
            //发送给Binder Bn端【见小节2.5.1】
            mRemote.transact(IContentProvider.QUERY_TRANSACTION, data, reply, 0);

            DatabaseUtils.readExceptionFromParcel(reply);
            if (reply.readInt() != 0) {
                BulkCursorDescriptor d = BulkCursorDescriptor.CREATOR.createFromParcel(reply);
                adaptor.initialize(d);
            } else {
                adaptor.close();
                adaptor = null;
            }
            return adaptor;
        } catch (RemoteException ex) {
            adaptor.close();
            throw ex;
        } catch (RuntimeException ex) {
            adaptor.close();
            throw ex;
        } finally {
            data.recycle();
            reply.recycle();
        }
    }

#### 2.5.1 CPN.onTransact
[-> ContentProviderNative.java]

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
        throws RemoteException {
        switch (code) {
            case QUERY_TRANSACTION:{
                data.enforceInterface(IContentProvider.descriptor);
                String callingPkg = data.readString();
                Uri url = Uri.CREATOR.createFromParcel(data);

                // String[] projection
                int num = data.readInt();
                String[] projection = null;
                if (num > 0) {
                    projection = new String[num];
                    for (int i = 0; i < num; i++) {
                        projection[i] = data.readString();
                    }
                }

                // String selection, String[] selectionArgs...
                String selection = data.readString();
                num = data.readInt();
                String[] selectionArgs = null;
                if (num > 0) {
                    selectionArgs = new String[num];
                    for (int i = 0; i < num; i++) {
                        selectionArgs[i] = data.readString();
                    }
                }

                String sortOrder = data.readString();
                IContentObserver observer = IContentObserver.Stub.asInterface(
                        data.readStrongBinder());
                ICancellationSignal cancellationSignal = ICancellationSignal.Stub.asInterface(
                        data.readStrongBinder());
                //【见小节2.5.2】
                Cursor cursor = query(callingPkg, url, projection, selection, selectionArgs,
                        sortOrder, cancellationSignal);
                if (cursor != null) {
                    CursorToBulkCursorAdaptor adaptor = null;
                    try {
                        //创建CursorToBulkCursorAdaptor对象
                        adaptor = new CursorToBulkCursorAdaptor(cursor, observer,
                                getProviderName());
                        cursor = null;

                        BulkCursorDescriptor d = adaptor.getBulkCursorDescriptor();
                        adaptor = null;

                        reply.writeNoException();
                        reply.writeInt(1);
                        d.writeToParcel(reply, Parcelable.PARCELABLE_WRITE_RETURN_VALUE);
                    } finally {
                        if (adaptor != null) {
                            adaptor.close();
                        }
                        if (cursor != null) {
                            cursor.close();
                        }
                    }
                } else {
                    reply.writeNoException();
                    reply.writeInt(0);
                }
                return true;
            }
            ...
        }
    }

#### 2.5.2 Transport.query
[-> ContentProvider.java ::Transport]

    public Cursor query(String callingPkg, Uri uri, String[] projection,
            String selection, String[] selectionArgs, String sortOrder,
            ICancellationSignal cancellationSignal) {
        validateIncomingUri(uri);
        uri = getUriWithoutUserId(uri);
        if (enforceReadPermission(callingPkg, uri, null) != AppOpsManager.MODE_ALLOWED) {
            if (projection != null) {
                return new MatrixCursor(projection, 0);
            }

            Cursor cursor = ContentProvider.this.query(uri, projection, selection,
                    selectionArgs, sortOrder, CancellationSignal.fromTransport(
                            cancellationSignal));
            if (cursor == null) {
                return null;
            }
            return new MatrixCursor(cursor.getColumnNames(), 0);
        }
        final String original = setCallingPackage(callingPkg);
        try {
            // 回调目标ContentProvider所定义的query方法
            return ContentProvider.this.query(
                    uri, projection, selection, selectionArgs, sortOrder,
                    CancellationSignal.fromTransport(cancellationSignal));
        } finally {
            setCallingPackage(original);
        }
    }

整个查询过程较复杂的，客户端创建BulkCursorToCursorAdaptor，服务端创建的=CursorToCursorAdaptor等还进一步展开，先留坑。。。

##  三、发布ContentProvider
system_server进程调用startProcessLocked()创建子进程后，在子进程会调用AMS.attachApplication()，ATP.bindApplication再经过binder IPC会调用到目标进程的AT.bindApplication()方法，接下来从该方法说起。

### 3.1 AT.bindApplication
[-> ActivityThread.java]

    public final void bindApplication(String processName, ApplicationInfo appInfo,
            List<ProviderInfo> providers, ComponentName instrumentationName,
            ProfilerInfo profilerInfo, Bundle instrumentationArgs,
            IInstrumentationWatcher instrumentationWatcher,
            IUiAutomationConnection instrumentationUiConnection, int debugMode,
            boolean enableOpenGlTrace, boolean trackAllocation, boolean isRestrictedBackupMode,
            boolean persistent, Configuration config, CompatibilityInfo compatInfo,
            Map<String, IBinder> services, Bundle coreSettings) {

        if (services != null) {
            ServiceManager.initServiceCache(services);
        }

        //发送消息SET_CORE_SETTINGS
        setCoreSettings(coreSettings);

        AppBindData data = new AppBindData();
        data.processName = processName;
        data.appInfo = appInfo;
        data.providers = providers;
        data.instrumentationName = instrumentationName;
        data.instrumentationArgs = instrumentationArgs;
        data.instrumentationWatcher = instrumentationWatcher;
        data.instrumentationUiAutomationConnection = instrumentationUiConnection;
        data.debugMode = debugMode;
        data.enableOpenGlTrace = enableOpenGlTrace;
        data.trackAllocation = trackAllocation;
        data.restrictedBackupMode = isRestrictedBackupMode;
        data.persistent = persistent;
        data.config = config;
        data.compatInfo = compatInfo;
        data.initProfilerInfo = profilerInfo;
        sendMessage(H.BIND_APPLICATION, data);
    }

该方法先发送消息`H.SET_CORE_SETTINGS`，再发送消息`H.BIND_APPLICATION`。这里我们主要讲跟provider相关的部分，当主线程收到`H.BIND_APPLICATION`消息后，会调用handleBindApplication方法。

### 3.2 AT.handleBindApplication
[-> ActivityThread.java]

    private void handleBindApplication(AppBindData data) {
        ...
        //设置进程名
        Process.setArgV0(data.processName);
        //实例化app
        Application app = data.info.makeApplication(data.restrictedBackupMode, null);
        ...
        if (!data.restrictedBackupMode) {
            List<ProviderInfo> providers = data.providers;
            if (providers != null) {
                //安装ContentProviders 【见小节3.3】
                installContentProviders(app, providers);
            }
        }
        ...
        //回调app.onCreate()
        mInstrumentation.callApplicationOnCreate(app);
    }

### 3.3 AT.installContentProviders
[-> ActivityThread.java]

    private void installContentProviders(
            Context context, List<ProviderInfo> providers) {
        final ArrayList<IActivityManager.ContentProviderHolder> results =
            new ArrayList<IActivityManager.ContentProviderHolder>();

        for (ProviderInfo cpi : providers) {
            // 安装provider 【见小节3.4】
            IActivityManager.ContentProviderHolder cph = installProvider(context, null, cpi,
                    false /*noisy*/, true /*noReleaseNeeded*/, true /*stable*/);
            if (cph != null) {
                cph.noReleaseNeeded = true;
                results.add(cph);
            }
        }

        try {
            // 发布provider 【见小节3.5】
            ActivityManagerNative.getDefault().publishContentProviders(
                getApplicationThread(), results);
        } catch (RemoteException ex) {
        }
    }

### 3.4 AT.installProvider
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
                c = context.createPackageContext(ai.packageName,
                        Context.CONTEXT_INCLUDE_CODE);
            }
            //无法获取context则直接返回
            if (c == null) {
                return null;
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

一般地，installProvider()的第二个参数holder为空，则用于ContentProvider进程的安装过程；第二个参数holder不为空，则用于Client端的使用。

### 3.5 AMS.publishContentProviders
由AMP.publishContentProviders经过binder IPC，交由AMS.publishContentProviders来处理

    public final void publishContentProviders(IApplicationThread caller,
           List<ContentProviderHolder> providers) {
       if (providers == null) {
           return;
       }

       synchronized (this) {
           final ProcessRecord r = getRecordForAppLocked(caller);
           if (r == null) {
               throw new SecurityException(...);
           }

           final long origId = Binder.clearCallingIdentity();
           final int N = providers.size();
           for (int i = 0; i < N; i++) {
               ContentProviderHolder src = providers.get(i);
               if (src == null || src.info == null || src.provider == null) {
                   continue;
               }
               ContentProviderRecord dst = r.pubProviders.get(src.info.name);
               if (dst != null) {
                   ComponentName comp = new ComponentName(dst.info.packageName, dst.info.name);
                   //将该provider添加到mProviderMap
                   mProviderMap.putProviderByClass(comp, dst);
                   String names[] = dst.info.authority.split(";");
                   for (int j = 0; j < names.length; j++) {
                       mProviderMap.putProviderByName(names[j], dst);
                   }

                   int launchingCount = mLaunchingProviders.size();
                   int j;
                   boolean wasInLaunchingProviders = false;
                   for (j = 0; j < launchingCount; j++) {
                       if (mLaunchingProviders.get(j) == dst) {
                           //将该provider移除mLaunchingProviders队列
                           mLaunchingProviders.remove(j);
                           wasInLaunchingProviders = true;
                           j--;
                           launchingCount--;
                       }
                   }
                   if (wasInLaunchingProviders) {
                       mHandler.removeMessages(CONTENT_PROVIDER_PUBLISH_TIMEOUT_MSG, r);
                   }
                   synchronized (dst) {
                       dst.provider = src.provider;
                       dst.proc = r;
                       //唤醒客户端的wait等待方法
                       dst.notifyAll();
                   }
                   updateOomAdjLocked(r);
               }
           }
           Binder.restoreCallingIdentity(origId);
       }
   }


## 四、小节

### 4.1 CR.query

    ContentResolver.query
        ContentResolver.acquireUnstableProvider
            ApplicationContentResolver.acquireUnstableProvider
                ActivityThread.acquireProvider
                    AT.acquireExistingProvider, return.
                    AMP.getContentProvider
                        AMS.getContentProvider
                            AMS.getContentProviderImpl
                                startProcessLocked
                                    notifyAll
                                cpr.wait
                    AT.installProvider
                        newInstance
                        ContentProvider.this.onCreate();
         ContentProviderProxy.query
            ContentProviderNative.query
                ContentProvider.Transport.query
                    ContentProvider.query


### 4.2 releaseProvider

CASE 1: releaseProvider

    ContextImpl.ApplicationContentResolver.releaseProvider
        AT.releaseProvider (true)
            AMP.refContentProvider
                AMS.refContentProvider
            AT.completeRemoveProvider
                AMP.removeContentProvider
                    AMS.removeContentProvider
                        AMS.decProviderCountLocked

CASE 2: releaseUnstableProvider

    ContextImpl.ApplicationContentResolver.releaseUnstableProvider
        AT.releaseProvider (false)
            AMP.refContentProvider
                AMS.refContentProvider
            AT.completeRemoveProvider
                AMP.removeContentProvider
                    AMS.removeContentProvider
                        AMS.decProviderCountLocked


###  4.3 unstableProviderDied

    CR.unstableProviderDied
        ACR.unstableProviderDied
            AT.handleUnstableProviderDied
                AT.handleUnstableProviderDiedLocked
                    AMP.unstableProviderDied
                        AMS.unstableProviderDied
                            AMS.appDiedLocked

### 4.4 close流程
...

### 未成品

整个文章其实还刚刚介绍的整个流程调用链4.1，后续还需要再进一步解释 4.2，4.3， 4.4，以及增加流程与架构图。。。
