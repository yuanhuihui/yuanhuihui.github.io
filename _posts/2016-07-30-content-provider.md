---
layout: post
title:  "理解ContentProvider原理"
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

- insert(Uri, ContentValues)：插入新数据；
- delete(Uri, String, String[])：删除已有数据；
- update(Uri, ContentValues, String, String[])：更新数据；
- query(Uri, String[], String, String[], String)：查询数据；
- onCreate()：执行初始化工作；
- getType(Uri)：获取数据MIME类型。


**Uri:** 从ContentProvider的数据操作方法可以看出都依赖于Uri，对于Uri有其固定的数据格式，例如：`content://com.gityuan.articles/android/3`

|字段|含义|对应项|
|---|---|---|
|前缀|默认的固定开头格式|content://|
|授权|唯一标识provider|com.gityuan.articles|
|路径|数据类别以及数据项|/android/3|

### 1.2 ContentResolver

其他app或者进程想要操作`ContentProvider`，则需要先获取其相应的`ContentResolver`，再利用ContentResolver类来完成对数据的增删改查操作，下面列举一个查询操作，查询得到的是一个`Cursor`结果集，再通过操作该Cursor便可获取想要查询的结果。

    ContentResolver cr = getContentResolver();  //获取ContentResolver
    Uri uri = Uri.parse("content://com.gityuan.articles/android/3");
    Cursor cursor = cr.query(uri, null, null, null, null);  //执行查询操作
    ...
    cursor.close(); //关闭



### 1.3 继承关系图


![content_provider](/images/contentprovider/content_provider.jpg)

- CPP与CPN是一对Binder通信的C/S两端;
- ACR(ApplicationContentResolver)继承于ContentResolver, 位于ContextImpl的内部类. ACR的实现往往是通过调用其成员变量mMainThread(数据类型为ActivityThread)来完成;


### 1.4 重要成员变量

在开始源码分析之前，先说说涉及到的几个关于contentProvider的重要的成员变量。

|类名|成员变量|含义|
|---|---|---|
|AMS|CONTENT_PROVIDER_PUBLISH_TIMEOUT|默认值为10s|
|AMS|mProviderMap|记录所有contentProvider|
|AMS|mLaunchingProviders|记录存在客户端等待publish的ContentProviderRecord|
|PR|pubProviders|该进程创建的ContentProviderRecord|
|PR|conProviders|该进程使用的ContentProviderConnection|
|AT|mLocalProviders|记录所有本地的ContentProvider，以IBinder以key|
|AT|mLocalProvidersByName|记录所有本地的ContentProvider，以组件名为key|
|AT|mProviderMap|记录该进程的contentProvider|
|AT|mProviderRefCountMap|记录所有对其他进程中的ContentProvider的引用计数|


- PR:ProcessRecord, AT: ActivityThread
- `CONTENT_PROVIDER_PUBLISH_TIMEOUT`(10s): provider所在进程发布其ContentProvider的超时时长为10s，超过10s则会系统所杀。
- `mLaunchingProviders`：记录的每一项是一个ContentProviderRecord对象, 所有的存在client等待其发布完成的contentProvider列表，一旦发布完成则相应的contentProvider便会从该列表移除；
- `mProviderMap`： AMS和AT都有一个同名的成员变量, AMS的数据类型为ProviderMap,而AT则是以ProviderKey为key的ArrayMap类型.
- `mLocalProviders`和`mLocalProvidersByName`：都是用于记录所有本地的ContentProvider,不同的只是key.

## 二、查询ContentProvider

接下来，从源码角度来说说，以`query`的为例来说说ContentProvider的整个完整流程,首先获取ContentResolver再执行相应query方法.

    ContentResolver cr = getContentResolver();  //获取ContentResolver
    Cursor cursor = cr.query(uri, null, null, null, null);  //执行查询操作

### 2.1 getContentResolver

[-> ContextImpl.java]

    class ContextImpl extends Context {
        public ContentResolver getContentResolver() {
            return mContentResolver;
        }
    }

Context中调用getContentResolver，经过层层调用来到ContextImpl类。返回值`mContentResolver`赋值是在`ContextImpl`对象实例化过程完成的.mContentResolver的真实类型为`ApplicationContentResolver`，接下来再来看看query查询操作。

### 2.2 CR.query

[-> ContentResolver.java]

    public final  Cursor query( Uri uri,  String[] projection,
             String selection,  String[] selectionArgs,
             String sortOrder) {
        return query(uri, projection, selection, selectionArgs, sortOrder, null);
    }

    public final  Cursor query(final  Uri uri,  String[] projection,
                 String selection,  String[] selectionArgs,
                 String sortOrder,  CancellationSignal cancellationSignal) {
            //获取unstable provider【见小节2.3】
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
                    //执行查询操作【见小节2.9】
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

一般地获取unstable的provider：

1. 调用acquireUnstableProvider()，尝试获取unstable的ContentProvider;
2. 然后执行query操作；

当执行query过程抛出DeadObjectException，即代表ContentProvider所在进程死亡，则尝试获取stable的ContentProvider:

1. 先调用unstableProviderDied(), 清理刚创建的unstable的ContentProvider；
2. 调用acquireProvider()，尝试获取stable的ContentProvider; 此时当ContentProvider进程死亡，则会杀掉该ContentProvider的客户端进程。
3. 然后执行query操作；

先用一句话说说stable与unstable的区别，采用unstable类型的ContentProvider的app不会因为远程ContentProvider进程的死亡而被杀，stable则恰恰相反。这便是ContentProvider坑爹之处，对于app无法事先决定创建的ContentProvider是stable，还是unstable
类型的，也便无法得知自己的进程是否会依赖于远程ContentProvider的生死。

###  2.3 CR.acquireUnstableProvider
[-> ContentResolver.java]

    public final IContentProvider acquireUnstableProvider(Uri uri) {
        //此处SCHEME_CONTENT = "content"
        if (!SCHEME_CONTENT.equals(uri.getScheme())) {
            return null;
        }
        String auth = uri.getAuthority();
        if (auth != null) {
            //【见小节2.4】
            return acquireUnstableProvider(mContext, uri.getAuthority());
        }
        return null;
    }

### 2.4 ACR.acquireUnstableProvider
[-> ContextImpl.java ::ApplicationContentResolver]

    class ContextImpl extends Context {
        private static final class ApplicationContentResolver extends ContentResolver {
            ...
            protected IContentProvider acquireUnstableProvider(Context c, String auth) {
                //【见小节2.5】
                return mMainThread.acquireProvider(c,
                        ContentProvider.getAuthorityWithoutUserId(auth),
                        resolveUserIdFromAuthority(auth), false);
            }
        }
    }

不论是acquireUnstableProvider还是acquireProvider方法，最终都会调用ActivityThread的同一个方法acquireProvider()。
getAuthorityWithoutUserId()的过程是字符截断过程，即去掉auth中的UserId信息，比如`com.gityuan.articles@123`，经过该方法处理后就变成了`com.gityuan.articles`。

### 2.5 AT.acquireProvider
[-> ActivityThread.java]

    public final IContentProvider acquireProvider(
            Context c, String auth, int userId, boolean stable) {
        //【见小节2.5.1】
        final IContentProvider provider = acquireExistingProvider(c, auth, userId, stable);
        if (provider != null) {
            //成功获取已经存在的ContentProvider对象，则直接返回
            return provider;
        }

        IActivityManager.ContentProviderHolder holder = null;
        try {
            //【见小节2.6】
            holder = ActivityManagerNative.getDefault().getContentProvider(
                    getApplicationThread(), auth, userId, stable);
        } catch (RemoteException ex) {
        }
        if (holder == null) {
            //无法获取auth所对应的provider则直接返回
            return null;
        }

        //安装provider将会增加引用计数【见小节2.8】
        holder = installProvider(c, holder, holder.info,
                true , holder.noReleaseNeeded, stable);
        return holder.provider;
    }

该方法的主要功能：

- 首先，尝试获取已存储的provider，当成功获取则直接返回，否则继续执行；
- 通过AMS来获取provider，当无法获取auth所对应的provider则直接返回，否则继续执行；
- 采用installProvider安装provider，并该provider的增加引用计数。

#### 2.5.1 AT.acquireExistingProvider
[-> ActivityThread.java]

    public final IContentProvider acquireExistingProvider(
            Context c, String auth, int userId, boolean stable) {
        synchronized (mProviderMap) {
            final ProviderKey key = new ProviderKey(auth, userId);
            //从AT.mProviderMap查询是否存在相对应的provider
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

- 首先从ActivityThread的`mProviderMap`查询是否存在相对应的provider，若不存在则直接返回；
- 当provider记录存在,但其所在进程已经死亡，则调用`handleUnstableProviderDiedLocked`清理provider信息,并返回；
- 当provider记录存在,且进程存活的情况下,则在provider引用计数不为空时则继续增加引用计数。

### 2.6 AMS.getContentProvider
[-> ActivityManagerService.java]

    public final ContentProviderHolder getContentProvider(
            IApplicationThread caller, String name, int userId, boolean stable) {
        if (caller == null) {
            throw new SecurityException();
        }
        //见小节2.7】
        return getContentProviderImpl(caller, name, null, stable, userId);
    }

ActivityManagerNative.getDefault()返回的是AMP，AMP经过binder IPC通信传递给AMS来完成相应工作, 从这里开始便进入了system_server进程。

### 2.7 AMS.getContentProviderImpl
[-> ActivityManagerService.java]

    private final ContentProviderHolder getContentProviderImpl(IApplicationThread caller,
            String name, IBinder token, boolean stable, int userId) {
        ContentProviderRecord cpr;
        ContentProviderConnection conn = null;
        ProviderInfo cpi = null;

        synchronized(this) {
            //获取调用者的进程记录ProcessRecord；
            ProcessRecord r = getRecordForAppLocked(caller);
            //从AMS中查询相应的ContentProviderRecord
            cpr = mProviderMap.getProviderByName(name, userId);
            ...
            boolean providerRunning = cpr != null;

            // 目标provider已存在的情况 [见小节2.7.1]
            if (providerRunning) {
                ...
            }

            // 目标provider不存在的情况 [见小节2.7.2]
            if (!providerRunning) {
                ...
            }
        }

        //循环等待provider发布完成 [见小节2.7.3]
        synchronized (cpr) {
            while (cpr.provider == null) {
                ...
            }
        }

        return cpr != null ? cpr.newHolder(conn) : null;
    }

该方法比较长,也是获取provider的核心实现代码, 这里分成以下3部分:

- 目标provider已存在的情况;
- 目标provider不存在的情况;
- 循环等待provider发布完成;

#### 2.7.1  目标provider已存在

    private final ContentProviderHolder getContentProviderImpl(IApplicationThread caller,
            String name, IBinder token, boolean stable, int userId) {
        ContentProviderRecord cpr;
        ContentProviderConnection conn = null;
        ProviderInfo cpi = null;

        synchronized(this) {
            //该ContentProvider已发布
            if (providerRunning) {
                cpi = cpr.info;
                //当允许运行在调用者进程且已发布，则直接返回[见小节2.7.4]
                if (r != null && cpr.canRunHere(r)) {
                    ContentProviderHolder holder = cpr.newHolder(null);
                    holder.provider = null;
                    return holder;
                }

                final long origId = Binder.clearCallingIdentity();
                //增加引用计数[见小节2.8.3]
                conn = incProviderCountLocked(r, cpr, token, stable);
                if (conn != null && (conn.stableCount+conn.unstableCount) == 1) {
                    if (cpr.proc != null && r.setAdj <= ProcessList.PERCEPTIBLE_APP_ADJ) {
                        //更新进程LRU队列
                        updateLruProcessLocked(cpr.proc, false, null);
                    }
                }

                if (cpr.proc != null) {
                    boolean success = updateOomAdjLocked(cpr.proc); //更新进程adj
                    if (!success) {
                        //provider进程被杀,则减少引用计数 [见小节2.8.2]
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
            ...
        }
        ...
    }


当ContentProvider所在进程已存在时的功能：

- 权限检查
- 当允许运行在调用者进程且已发布，则直接返回
- 增加引用计数
- 更新进程LRU队列
- 更新进程adj
- 当provider进程被杀时，则减少引用计数并调用appDiedLocked，且设置ContentProvider为没有发布的状态

#### 2.7.2 目标provider不存在

    private final ContentProviderHolder getContentProviderImpl(IApplicationThread caller,
            String name, IBinder token, boolean stable, int userId) {
        ...
        synchronized(this) {
            ...
            if (!providerRunning) {
                //根据authority，获取ProviderInfo对象
                cpi = AppGlobals.getPackageManager().resolveContentProvider(name,
                        STOCK_PM_FLAGS | PackageManager.GET_URI_PERMISSION_PATTERNS, userId);
                ...
                singleton = isSingleton(cpi.processName, cpi.applicationInfo,
                        cpi.name, cpi.flags)
                        && isValidSingletonCall(r.uid, cpi.applicationInfo.uid);
                if (singleton) {
                    userId = UserHandle.USER_OWNER;
                }
                cpi.applicationInfo = getAppInfoForUser(cpi.applicationInfo, userId);
                ...

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

                        ai = getAppInfoForUser(ai, userId);
                        //创建对象ContentProviderRecord
                        cpr = new ContentProviderRecord(this, cpi, ai, comp, singleton);
                    } finally {
                        Binder.restoreCallingIdentity(ident);
                    }
                }

                // [见小节2.7.4]
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
                                //启动provider进程启动并发布provider[见小节三]
                                proc.thread.scheduleInstallProvider(cpi);
                            }
                        } else {
                            // 启动进程[见小节三]
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
        ...
    }



当ContentProvider所在进程没有存在时的功能：

- 根据authority，获取ProviderInfo对象；
- 权限检查
- 当provider不是运行在system进程，且系统未准备好，则抛出IllegalArgumentException
- 当拥有该provider的用户并没有运行，则直接返回
- 根据ComponentName，从AMS.mProviderMap中查询相应的ContentProviderRecord;
- 当首次调用，则创建对象ContentProviderRecord
- 当允许运行在调用者进程且ProcessRecord不为空，则直接返回
- 当provider并没有处于mLaunchingProviders队列，则启动它
    - 当ProcessRecord不为空，则加入到pubProviders，并开始安装provider;
    - 当ProcessRecord为空，则启动进程
- 增加引用计数


#### 2.7.3 等待目标provider发布

    private final ContentProviderHolder getContentProviderImpl(IApplicationThread caller,
            String name, IBinder token, boolean stable, int userId) {
        ...
        //循环等待provider发布
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


循环等待,直到provider发布完成才会退出循环.

#### 2.7.4 canRunHere
[-> ContentProviderRecord.java]

    public boolean canRunHere(ProcessRecord app) {
        return (info.multiprocess || info.processName.equals(app.processName))
                && uid == app.info.uid;
    }

该ContentProvider是否能运行在调用者所在进程需要满足以下条件：

- 条件1：ContentProvider在AndroidManifest.xml文件配置multiprocess=true；或调用者进程与ContentProvider在同一个进程。
- 条件2：ContentProvider进程跟调用者所在进程是同一个uid。


一般地, 程序进行到此处[小节2.5] AT.acquireProvider方法应该已成功获取了Provider对象, 接下来便是在调用端安装Provider.

### 2.8 AT.installProvider

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
                ...
            } else {
                //根据jBinder，从mProviderRefCountMap中查询相应的ProviderRefCount
                ProviderRefCount prc = mProviderRefCountMap.get(jBinder);
                if (prc != null) {
                    //只有当需要释放引用时则进入该分支
                    if (!noReleaseNeeded) {
                        incProviderRefLocked(prc, stable);
                        //[见流程2.8.1]
                        ActivityManagerNative.getDefault().removeContentProvider(
                                holder.connection, stable);
                        ...
                    }
                } else {
                    //[见流程2.8.4]
                    ProviderClientRecord client = installProviderAuthoritiesLocked(
                            provider, localProvider, holder);
                    if (noReleaseNeeded) {
                        //[见流程2.8.5]
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

获取ContentProviderHolder对象,该对象的成员变量provider记录着ContentProviderProxy对象.

#### 2.8.1 AMS.removeContentProvider
[-> ActivityManagerService.java]

    public void removeContentProvider(IBinder connection, boolean stable) {
        enforceNotIsolatedCaller("removeContentProvider");
        long ident = Binder.clearCallingIdentity();
        try {
            synchronized (this) {
                ContentProviderConnection conn;
                try {
                    conn = (ContentProviderConnection)connection;
                } catch (ClassCastException e) {
                    throw new IllegalArgumentException(msg);
                }
                ...

                //[见流程2.8.2]
                if (decProviderCountLocked(conn, null, null, stable)) {
                    updateOomAdjLocked();
                }
            }
        } finally {
            Binder.restoreCallingIdentity(ident);
        }
    }

#### 2.8.2 AMS.decProviderCountLocked
[-> ActivityManagerService.java]

    boolean decProviderCountLocked(ContentProviderConnection conn,
            ContentProviderRecord cpr, IBinder externalProcessToken, boolean stable) {
        if (conn != null) {
            cpr = conn.provider;
            if (stable) {
                conn.stableCount--;
            } else {
                conn.unstableCount--;
            }
            //当provider连接的 stable和unstable引用次数都为0时,则移除该连接对象信息
            if (conn.stableCount == 0 && conn.unstableCount == 0) {
                cpr.connections.remove(conn);
                conn.client.conProviders.remove(conn);
                stopAssociationLocked(conn.client.uid, conn.client.processName, cpr.uid, cpr.name);
                return true;
            }
            return false;
        }
        cpr.removeExternalProcessHandleLocked(externalProcessToken);
        return false;
    }

减小provider引用所相反的操作便是增加引用incProviderCountLocked,再来说说增加引用计数

#### 2.8.3 AMS.incProviderCountLocked
[-> ActivityManagerService.java]

    ContentProviderConnection incProviderCountLocked(ProcessRecord r,
            final ContentProviderRecord cpr, IBinder externalProcessToken, boolean stable) {
        if (r != null) {
            for (int i=0; i<r.conProviders.size(); i++) {
                //从当前进程所使用的provider中查询与目标provider一致的信息
                ContentProviderConnection conn = r.conProviders.get(i);
                if (conn.provider == cpr) {
                    if (stable) {
                        conn.stableCount++;
                        conn.numStableIncs++;
                    } else {
                        conn.unstableCount++;
                        conn.numUnstableIncs++;
                    }
                    return conn;
                }
            }
            //当查询不到时,则新建provider连接对象
            ContentProviderConnection conn = new ContentProviderConnection(cpr, r);
            if (stable) {
                conn.stableCount = 1;
                conn.numStableIncs = 1;
            } else {
                conn.unstableCount = 1;
                conn.numUnstableIncs = 1;
            }
            cpr.connections.add(conn);
            r.conProviders.add(conn);
            startAssociationLocked(r.uid, r.processName, cpr.uid, cpr.name, cpr.info.processName);
            return conn;
        }
        cpr.addExternalProcessHandleLocked(externalProcessToken);
        return null;
    }

#### 2.8.4 AT.installProviderAuthoritiesLocked
[-> ActivityThread.java]

    private ProviderClientRecord installProviderAuthoritiesLocked(IContentProvider provider,
            ContentProvider localProvider, IActivityManager.ContentProviderHolder holder) {
        final String auths[] = holder.info.authority.split(";");
        final int userId = UserHandle.getUserId(holder.info.applicationInfo.uid);

        final ProviderClientRecord pcr = new ProviderClientRecord(
                auths, provider, localProvider, holder);
        for (String auth : auths) {
            final ProviderKey key = new ProviderKey(auth, userId);
            final ProviderClientRecord existing = mProviderMap.get(key);
            if (existing != null) {
                ... //已发布
            } else {
                mProviderMap.put(key, pcr);
            }
        }
        return pcr;
    }

#### 2.8.5 ProviderRefCount
[-> ActivityThread.java ::ProviderRefCount]

    private static final class ProviderRefCount {
        public final IActivityManager.ContentProviderHolder holder;
        public final ProviderClientRecord client;
        public int stableCount;
        public int unstableCount;

        //当该标记设置,意味着stable和unstable的引用都会设置为0
        public boolean removePending;

        ProviderRefCount(IActivityManager.ContentProviderHolder inHolder,
                ProviderClientRecord inClient, int sCount, int uCount) {
            holder = inHolder;
            client = inClient;
            stableCount = sCount;
            unstableCount = uCount;
        }
    }

- stableCount代表的是stable引用的次数;
- unstableCount代表的是unstable引用的次数;


### 2.9 CPP.query
回到[小节2.3]执行完acquireUnstableProvider()操作则成功获取了

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
            //发送给Binder服务端【见小节2.10】
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

### 2.10 CPN.onTransact
[-> ContentProviderNative.java]

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
        throws RemoteException {
        switch (code) {
            case QUERY_TRANSACTION:{
                data.enforceInterface(IContentProvider.descriptor);
                String callingPkg = data.readString();
                Uri url = Uri.CREATOR.createFromParcel(data);

                int num = data.readInt();
                String[] projection = null;
                if (num > 0) {
                    projection = new String[num];
                    for (int i = 0; i < num; i++) {
                        projection[i] = data.readString();
                    }
                }

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
                //【见小节2.11】
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

### 2.11 Transport.query
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

query过程更为繁琐,本文就不再介绍,到这里便真正调用到了目标provider的query方法.


##  三、发布ContentProvider


有两种场景会触发发布ContentProvider, 最终都会进入[小节3.3]installContentProviders操作

### 3.1 场景一(进程不存在)

system_server进程调用[startProcessLocked()](http://localhost:4000/2016/10/10/app-process-create-2/)创建子进程,并attach到system_server之后, 便会再通过binder IPC会调用到该子进程AT.bindApplication()方法

#### 3.1.1 AT.bindApplication
[-> ActivityThread.java]


    public final void bindApplication(...) {
        ...
        AppBindData data = new AppBindData();
        data.providers = providers;
        ...
        sendMessage(H.BIND_APPLICATION, data);
    }

当主线程收到`H.BIND_APPLICATION`消息后，会调用handleBindApplication方法。

#### 3.1.2 AT.handleBindApplication
[-> ActivityThread.java]

    private void handleBindApplication(AppBindData data) {
        ...
        Process.setArgV0(data.processName); //设置进程名
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

### 3.2 场景二(provider未发布)
获取provider的过程,发现所对应的provider还没有发布,则进入小节[2.7.2], 此时当目标进程不存在是则触发创建进程的过程,跟场景一类似.当目标进程存在并且attach过,则需要触发provider来执行publish的操作.

#### 3.2.1 AT.scheduleInstallProvider
[-> ActivityThread.java]

    public void scheduleInstallProvider(ProviderInfo provider) {
        sendMessage(H.INSTALL_PROVIDER, provider);
    }

#### 3.2.2  AT.handleInstallProvider
[-> ActivityThread.java]

    public void handleInstallProvider(ProviderInfo info) {
        final StrictMode.ThreadPolicy oldPolicy = StrictMode.allowThreadDiskWrites();
        try {
            //[见流程3.3]
            installContentProviders(mInitialApplication, Lists.newArrayList(info));
        } finally {
            StrictMode.setThreadPolicy(oldPolicy);
        }
    }

无论是场景一, 还是场景二, 最后都会进入主线程来执行installContentProviders的操作,如下:

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

该过程主要是通过反射，创建目标ContentProvider对象,并调用该对象onCreate方法.

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

一旦publish成功,则会移除provider发布超时的消息,并且调用notifyAll()来唤醒所有等待的Client端进程.

## 四、小结

本文以ContentProvider的查询过程为例展开了对Provider的整个使用过程的源码分析.先获取provider,然后安装provider信息,最后便是真正的查询操作.

### 4.1 场景一

进程不存在: 当provider进程不存在时,先创建进程并publish相关的provider:

![content_provider_ipc](/images/contentprovider/content_provider_ipc.jpg)

- 图中左侧则是client端进程向system_server请求获取provider的过程, 最右侧则是provider所在进程发布provier信息的一个过程. 这两个过程都需要通过Binder向system_server进行通信.
- 图中有两个installProvider()的调用过程, 当第二个参数holder为空，则用于ContentProvider所在进程的发布provider过程；第二个参数holder不为空，则用于Client端安装provider的过。
- 调用AMS.getContentProviderImpl获取provider的过程中,当cpr.provider ==null则进入wait()状态,直到notifyAll()事件的到来;否则直接进入AT.installProvider.
- 进程在启动过程便会publish该进程相应的provider信息,并调用notifyAll()来唤醒所有在等待该provider的进程/线程.
- 关于`CONTENT_PROVIDER_PUBLISH_TIMEOUT`超时时机是指在startProcessLocked之后会调用AMS.attachApplicationLocked为起点，一直到AMS.publishContentProviders的过程。

### 4.2 场景二

provider未发布:有时在请求provider的时,provider进程存在,但provide的记录对象cpr ==null,这时的流程如下:

![content_provider_ipc2](/images/contentprovider/content_provider_ipc2.jpg)


- Client进程在获取provider的过程,发现cpr为空,则调用scheduleInstallProvider来向provider所在进程发出一个oneway的binder请求,并进入wait()状态.
- provider进程安装完provider信息,则notifyAll()处于等待状态的进程/线程;

如果provider在publish完成之后, 这时再次请求该provider,那就便没有的最右侧的这个过程,直接在AMS.getContentProviderImpl之后便进入AT.installProvider的过程,而不会再次进入wait()过程.

最后,关于provider分为stable provider和unstable provider, 一句话来说就是stable provider建立的是强连接, 客户端进程的与provider进程是存在依赖关系, 即provider进程死亡则会导致客户端进程被杀.
