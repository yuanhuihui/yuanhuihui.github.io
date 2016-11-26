---
layout: post
title:  "ContentProvider引用计数"
date:   2016-11-19 20:30:00
catalog:  true
tags:
    - android
    - 组件
---

> 基于Android 6.0源码剖析，本文涉及的相关源码：


## 一.概述

上一篇文章[理解ContentProvider原理](http://gityuan.com/2016/07/30/content-provider/)介绍了provider的整个原理,
本文以查询操作为例,说一说provider引用计数的问题.

### 1.1 query操作

    public final  Cursor query(final  Uri uri,  String[] projection,
                 String selection,  String[] selectionArgs,
                 String sortOrder,  CancellationSignal cancellationSignal) {
        //增加引用[见小节二]
        IContentProvider unstableProvider = acquireUnstableProvider(uri);
        IContentProvider stableProvider = null;
        Cursor qCursor = null;
        try {
            ...
            try {
                qCursor = unstableProvider.query(mPackageName, uri, projection,
                        selection, selectionArgs, sortOrder, remoteCancellationSignal);
            } catch (DeadObjectException e) {
                //减少引用[见小节三]
                unstableProviderDied(unstableProvider);

                //增加引用[见小节二]
                stableProvider = acquireProvider(uri);
                qCursor = stableProvider.query(mPackageName, uri, projection,
                        selection, selectionArgs, sortOrder, remoteCancellationSignal);
            }
            ...
            return wrapper;
        } catch (RemoteException e) {
            return null;
        } finally {
            ...
            if (unstableProvider != null) {
                releaseUnstableProvider(unstableProvider);//减少引用[见小节三]
            }
            if (stableProvider != null) {
                releaseProvider(stableProvider);//减少引用[见小节三]
            }
        }
    }

- provider引用计数的增加时机: acquireUnstableProvider()或者acquireProvider()
- provider引用计数的减少时机: releaseUnstableProvider()或者releaseProvider()或unstableProviderDied()

### 1.2 相关对象

    public final class ContentProviderConnection extends Binder {
        public final ContentProviderRecord provider;
        public final ProcessRecord client;
        public final long createTime; //创建时间
        public int stableCount; //stable引用次数
        public int unstableCount; //unstable引用次数
        public boolean waiting; //该连接的client正在等待provider发布
        public boolean dead; //该连接的provider已处于死亡状态
        //用于调试
        public int numStableIncs; //stable计数总的增加次数
        public int numUnstableIncs; //unstable计数总的增加次数
    }

    private static final class ProviderRefCount {
        public final IActivityManager.ContentProviderHolder holder;
        public final ProviderClientRecord client;
        public int stableCount;
        public int unstableCount;
        public boolean removePending;
    }

以上两个对象记录provider引用相关的对象:

- ContentProviderConnection: 连接contentprovider与client之间的连接对象
- ProviderRefCount: ActivityThread的内部类,该引用保存到Client端.

## 二. 增加引用计数

acquireUnstableProvider过程具体过程见文章,[理解ContentProvider原理](http://gityuan.com/2016/07/30/content-provider/), 对于acquireProvider的调用栈跟acquireUnstableProvider过程非常相近,都会调用到AT.acquireProvider(),主要差别在于stable值. 这里仅仅列举其调用栈如下:

CASE 1: acquireUnstableProvider

    CR.acquireUnstableProvider
        ACR.acquireUnstableProvider
            AT.acquireProvider   // stable = false
                AT.acquireExistingProvider //增加计数[见小节2.1]
                AMP.getContentProvider
                    AMS.getContentProvider
                        AMS.getContentProviderImpl //增加计数[见小节2.2]
                AT.installProvider

CASE 2: acquireProvider

    CR.acquireProvider
        ACR.acquireProvider  
            AT.acquireProvider   // stable = true
                AT.acquireExistingProvider
                AMP.getContentProvider
                    AMS.getContentProvider
                        AMS.getContentProviderImpl
                AT.installProvider

整个过程中有两个地方会增加引用计数: [小节2.2] acquireExistingProvider和  [小节2.3] getContentProviderImpl

### 2.1 AT.acquireExistingProvider

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
                handleUnstableProviderDiedLocked(jBinder, true);
                return null;
            }

            ProviderRefCount prc = mProviderRefCountMap.get(jBinder);
            if (prc != null) {
                //增加引用计数[见小节2.1.1]
                incProviderRefLocked(prc, stable);
            }
            return provider;
        }
    }


- acquireUnstableProvider的调用, 则stable=false.
- acquireProvider的调用, 则stable=true.

#### 2.1.1 AT.incProviderRefLocked

    private final void incProviderRefLocked(ProviderRefCount prc, boolean stable) {
        if (stable) {
            prc.stableCount += 1; //stable引用计数+1
            if (prc.stableCount == 1) {
                int unstableDelta;
                if (prc.removePending) {
                    unstableDelta = -1;
                    prc.removePending = false;
                    mH.removeMessages(H.REMOVE_PROVIDER, prc); //移除消息
                } else {
                    unstableDelta = 0;
                }
                // [见小节2.1.2]
                ActivityManagerNative.getDefault().refContentProvider(
                        prc.holder.connection, 1, unstableDelta);

            }
        } else {
            prc.unstableCount += 1; //unstable引用计数+1
            if (prc.unstableCount == 1) {
                if (prc.removePending) {
                    prc.removePending = false;
                    mH.removeMessages(H.REMOVE_PROVIDER, prc);
                } else {
                    // [见小节2.1.2]
                    ActivityManagerNative.getDefault().refContentProvider(
                            prc.holder.connection, 0, 1);
                }
            }
        }
    }

该方法先增加ProviderRefCount对象的引用,再通过Binder调用AMS.refContentProvider来增加ContentProviderConnection的引用.

- 对于stable provider, 当stableCount=1的情况
    - 当removePending = false时, 则refContentProvider传递的后两个参数(1, -1)
    - 当removePending = true 时, 则refContentProvider传递的后两个参数(1, 0)
- 对于unstable provider,当unstableCount=1的情况
    - 当removePending=false时, 则refContentProvider传递的后两个参数(0,1)

#### 2.1.2 AMP.refContentProvider

    public boolean refContentProvider(IBinder connection, int stable, int unstable)
            throws RemoteException {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(connection);
        data.writeInt(stable);
        data.writeInt(unstable);
        //[见小节2.1.3]
        mRemote.transact(REF_CONTENT_PROVIDER_TRANSACTION, data, reply, 0);
        reply.readException();
        boolean res = reply.readInt() != 0;
        data.recycle();
        reply.recycle();
        return res;
    }

#### 2.1.3 AMN.onTransact

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
            throws RemoteException {
        switch (code) {
            case REF_CONTENT_PROVIDER_TRANSACTION: {
                data.enforceInterface(IActivityManager.descriptor);
                IBinder b = data.readStrongBinder();
                int stable = data.readInt();
                int unstable = data.readInt();
                //[见小节2.1.4]
                boolean res = refContentProvider(b, stable, unstable);
                reply.writeNoException();
                reply.writeInt(res ? 1 : 0);
                return true;
            }
            ...
        }
    }

#### 2.1.4 AMS.refContentProvider

    public boolean refContentProvider(IBinder connection, int stable, int unstable) {
        ContentProviderConnection conn;
        conn = (ContentProviderConnection)connection;
        ...
        synchronized (this) {
            if (stable > 0) {
                conn.numStableIncs += stable;
            }

            //修改stableCount
            stable = conn.stableCount + stable;

            if (stable < 0) {
                throw new IllegalStateException("stableCount < 0: " + stable);
            }

            if (unstable > 0) {
                conn.numUnstableIncs += unstable;
            }

            //修改unstableCount
            unstable = conn.unstableCount + unstable;

            if (unstable < 0) {
                throw new IllegalStateException("unstableCount < 0: " + unstable);
            }
            if ((stable+unstable) <= 0) {
                throw new IllegalStateException("ref counts can't go to zero here: stable="
                        + stable + " unstable=" + unstable);
            }
            conn.stableCount = stable;
            conn.unstableCount = unstable;
            return !conn.dead;
        }
    }


该方法是修改conn的stable和unstable引用次数,并返回connection是否存活. 存活则返回1,死亡则返回0.
修改后的stable和unstable值必须大于或等于0,且至少有一项大于0才能正常返回.以下任一情况会抛出异常IllegalStateException:

- stable < 0
- unstable < 0
- (stable+unstable) <= 0



### 2.2 AMS.getContentProviderImpl

    private final ContentProviderHolder getContentProviderImpl(IApplicationThread caller,
            String name, IBinder token, boolean stable, int userId) {
        ContentProviderRecord cpr;
        ContentProviderConnection conn = null;
        ProviderInfo cpi = null;

        synchronized(this) {
            ProcessRecord r = getRecordForAppLocked(caller);
            //从AMS中查询相应的ContentProviderRecord
            cpr = mProviderMap.getProviderByName(name, userId);
            ...
            boolean providerRunning = cpr != null;

            if (providerRunning) {
                ...
                // 目标provider已存在的情况 [见小节2.2.1]
                conn = incProviderCountLocked(r, cpr, token, stable);
                ...
            }

            if (!providerRunning) {
                ...
                // 目标provider不存在的情况 [见小节2.2.1]
                conn = incProviderCountLocked(r, cpr, token, stable);
                ...
            }
        }
        ...
        return cpr != null ? cpr.newHolder(conn) : null;
    }

#### 2.2.1 AMS.incProviderCountLocked

    ContentProviderConnection incProviderCountLocked(ProcessRecord r,
            final ContentProviderRecord cpr, IBinder externalProcessToken, boolean stable) {
        if (r != null) {
            for (int i=0; i<r.conProviders.size(); i++) {
                ContentProviderConnection conn = r.conProviders.get(i);
                //从当前进程所使用的provider中查询与目标provider一致的信息
                if (conn.provider == cpr) {
                    if (stable) {
                        conn.stableCount++;  //stable计数加1
                        conn.numStableIncs++;
                    } else {
                        conn.unstableCount++;  //unstable计数加1
                        conn.numUnstableIncs++;
                    }
                    return conn;
                }
            }

            //当查询不到时,则新建provider连接对象
            ContentProviderConnection conn = new ContentProviderConnection(cpr, r);
            if (stable) {
                conn.stableCount = 1;  //stable计数置为1
                conn.numStableIncs = 1;
            } else {
                conn.unstableCount = 1; //unstable计数置为1
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

### 2.3 小节

增加引用计数的过程:removePending是指当前正在处于移除引用计数的过程,当removePending=true代表正处于移除最后引用的情况.而此时有需要增加引用计数,所以会抵消一次unstableCount加1的操作.

ContentProviderConnection引用计数情况:

|方法|stableCount|unstableCount|条件
|---|---|---|
|acquireProvider|+1|0|removePending=false|
|acquireProvider|+1|-1|removePending=true|
|acquireUnstableProvider|0|+1|removePending=false|
|acquireUnstableProvider|0|0|removePending=true|

增加引用计数的具体方法:

- AT.incProviderRefLocked  ==> AMS.refContentProvider  
- AMS.incProviderCountLocked

## 三. 减小引用计数

releaseProvider跟releaseUnstableProvider过程很相似, 都会调用到AT.releaseProvider(), 其主要区别在于参数stable. 另外还有方法unstableProviderDied()也是用于减小引用计数.

CASE 1: releaseUnstableProvider

    ApplicationContentResolver.releaseUnstableProvider
        AT.releaseProvider   // stable = false [见小节3.1]
            AMP.refContentProvider
                AMS.refContentProvider
            AT.completeRemoveProvider //减小计数[见小节3.2]
                AMP.removeContentProvider
                    AMS.removeContentProvider
                        AMS.decProviderCountLocked

CASE 2: releaseProvider

    ApplicationContentResolver.releaseProvider
        AT.releaseProvider   // stable = true [见小节3.1]
            AMP.refContentProvider
                AMS.refContentProvider
            AT.completeRemoveProvider //减小计数[见小节3.2]
                AMP.removeContentProvider
                    AMS.removeContentProvider
                        AMS.decProviderCountLocked

### 3.1  AT.releaseProvider

    public final boolean releaseProvider(IContentProvider provider, boolean stable) {
        if (provider == null) {
            return false; //provider为空则直接返回
        }

        IBinder jBinder = provider.asBinder();
        synchronized (mProviderMap) {
            ProviderRefCount prc = mProviderRefCountMap.get(jBinder);
            if (prc == null) {
                return false;  //provider引用对象为空则直接返回
            }

            boolean lastRef = false;
            if (stable) {
                if (prc.stableCount == 0) {
                    return false; //引用次数为0则直接返回
                }

                prc.stableCount -= 1; //stable引用计数减1
                if (prc.stableCount == 0) {
                    lastRef = prc.unstableCount == 0;
                    //[见小节3.1.1]
                    ActivityManagerNative.getDefault().refContentProvider(
                            prc.holder.connection, -1, lastRef ? 1 : 0);
                }
            } else {
                if (prc.unstableCount == 0) {
                    return false;
                }
                prc.unstableCount -= 1; //unstable引用计数减1
                if (prc.unstableCount == 0) {
                    lastRef = prc.stableCount == 0;
                    if (!lastRef) {
                        //[见小节3.1.1]
                        ActivityManagerNative.getDefault().refContentProvider(
                            prc.holder.connection, 0, -1);

                }
            }

            //当执行完该方法,引用技术变成0时,则发送REMOVE_PROVIDER消息[见小节3.2]
            if (lastRef) {
                if (!prc.removePending) {
                    prc.removePending = true;
                    Message msg = mH.obtainMessage(H.REMOVE_PROVIDER, prc);
                    mH.sendMessage(msg);
                }
            }
            return true;
        }
    }

该方法先减小ProviderRefCount对象的引用,再通过Binder调用AMS.refContentProvider来减小ContentProviderConnection的引用.

- 对于stable provider,当stableCount=0的情况下
    - 当unstableCount != 0时, 则refContentProvider传递的后两个参数(-1, 0)
    - 当unstableCount = 0时,  则refContentProvider传递的后两个参数(-1, 1)
- 对于unstable provider,当unstableCount=0的情况下:
    - 当stableCount != 0 时, 则refContentProvider传递的后两个参数(0,-1)

当最后引用计数时,则发送REMOVE_PROVIDER消息, 主线程收到消息调用AT.completeRemoveProvider.

#### 3.1.1 AMS.refContentProvider

    public boolean refContentProvider(IBinder connection, int stable, int unstable) {
        ContentProviderConnection conn;
        conn = (ContentProviderConnection)connection;
        ...
        synchronized (this) {
            if (stable > 0) {
                conn.numStableIncs += stable;
            }

            //修改stableCount
            stable = conn.stableCount + stable;

            if (stable < 0) {
                throw new IllegalStateException("stableCount < 0: " + stable);
            }

            if (unstable > 0) {
                conn.numUnstableIncs += unstable;
            }

            //修改unstableCount
            unstable = conn.unstableCount + unstable;

            if (unstable < 0) {
                throw new IllegalStateException("unstableCount < 0: " + unstable);
            }
            if ((stable+unstable) <= 0) {
                throw new IllegalStateException("ref counts can't go to zero here: stable="
                        + stable + " unstable=" + unstable);
            }
            conn.stableCount = stable;
            conn.unstableCount = unstable;
            return !conn.dead;
        }
    }

### 3.2  AT.completeRemoveProvider

    final void completeRemoveProvider(ProviderRefCount prc) {
        synchronized (mProviderMap) {
            if (!prc.removePending) {
                return;
            }

            prc.removePending = false;

            final IBinder jBinder = prc.holder.provider.asBinder();
            ProviderRefCount existingPrc = mProviderRefCountMap.get(jBinder);
            if (existingPrc == prc) {
                mProviderRefCountMap.remove(jBinder);
            }

            for (int i=mProviderMap.size()-1; i>=0; i--) {
                ProviderClientRecord pr = mProviderMap.valueAt(i);
                IBinder myBinder = pr.mProvider.asBinder();
                if (myBinder == jBinder) {
                    mProviderMap.removeAt(i);
                }
            }
        }
        // [见小节3.2.1]
        ActivityManagerNative.getDefault().removeContentProvider(
                prc.holder.connection, false);

    }

#### 3.2.1 AMP.removeContentProvider

    public void removeContentProvider(IBinder connection, boolean stable) throws RemoteException {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(connection);
        data.writeInt(stable ? 1 : 0);
        //[见小节3.2.2]
        mRemote.transact(REMOVE_CONTENT_PROVIDER_TRANSACTION, data, reply, 0);
        reply.readException();
        data.recycle();
        reply.recycle();
    }

#### 3.2.2 AMN.onTransact

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
            throws RemoteException {
        switch (code) {
            case REMOVE_CONTENT_PROVIDER_TRANSACTION: {
                data.enforceInterface(IActivityManager.descriptor);
                IBinder b = data.readStrongBinder();
                boolean stable = data.readInt() != 0;
                //[见小节3.2.3]
                removeContentProvider(b, stable);
                reply.writeNoException();
                return true;
            }
        ...
        }
    }

#### 3.2.3  AMS.removeContentProvider

    public void removeContentProvider(IBinder connection, boolean stable) {
        enforceNotIsolatedCaller("removeContentProvider");
        long ident = Binder.clearCallingIdentity();
        try {
            synchronized (this) {
                ContentProviderConnection conn;
                conn = (ContentProviderConnection)connection;
                ...
                //[见小节3.2.4]
                if (decProviderCountLocked(conn, null, null, stable)) {
                    updateOomAdjLocked();
                }
            }
        } finally {
            Binder.restoreCallingIdentity(ident);
        }
    }

#### 3.2.4 AMS.decProviderCountLocked

    boolean decProviderCountLocked(ContentProviderConnection conn,
            ContentProviderRecord cpr, IBinder externalProcessToken, boolean stable) {
        if (conn != null) {
            cpr = conn.provider;
            if (stable) {
                conn.stableCount--; //stable计数减1
            } else {
                conn.unstableCount--;  //unstable计数减1
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


### 3.3 小节

减小引用计数:

|方法|stableCount|unstableCount|条件
|---|---|---|
|releaseProvider|-1|0|lastRef=false|
|releaseProvider|-1|1|lastRef=true|
|releaseUnstableProvider|0|-1|lastRef=false|
|releaseUnstableProvider|0|0|lastRef=true|


减小引用计数的具体方法:

- AT.releaseProvider ==> AMS.refContentProvider
- AMS.decProviderCountLocked

 当stable和unstable引用计数都为0时则移除connection信息


## 四. Provider死亡

#### 4.1 进程死亡

对于unstable的provider可直接调用unstableProviderDied,或者是当provider进程死亡后会有死亡回调[binderDied](http://gityuan.com/2016/10/02/binder-died/),这两个方法最终都会调用到appDiedLocked().

调用链如下:

        ACR.unstableProviderDied
            AT.handleUnstableProviderDied
                AT.handleUnstableProviderDiedLocked //[见小节4.2]
                    AMP.unstableProviderDied
                        AMS.unstableProviderDied
                            AMS.appDiedLocked

#### 4.2 AT.handleUnstableProviderDiedLocked

    final void handleUnstableProviderDiedLocked(IBinder provider, boolean fromClient) {
        ProviderRefCount prc = mProviderRefCountMap.get(provider);
        if (prc != null) {

            mProviderRefCountMap.remove(provider);
            for (int i=mProviderMap.size()-1; i>=0; i--) {
                ProviderClientRecord pr = mProviderMap.valueAt(i);
                if (pr != null && pr.mProvider.asBinder() == provider) {
                    mProviderMap.removeAt(i);
                }
            }

            if (fromClient) {
                //[见小节4.3]
                ActivityManagerNative.getDefault().unstableProviderDied(
                        prc.holder.connection);
            }
        }
    }

#### 4.3 AMS.unstableProviderDied

    public void unstableProviderDied(IBinder connection) {
        ContentProviderConnection conn = (ContentProviderConnection)connection;

        IContentProvider provider;
        synchronized (this) {
            provider = conn.provider.provider;
        }

        if (provider == null) {
            return;
        }

        if (provider.asBinder().pingBinder()) {
            //provider进程仍然存活,则不清理
            synchronized (this) {
                return;
            }
        }

        synchronized (this) {
            if (conn.provider.provider != provider) {
                return;
            }

            ProcessRecord proc = conn.provider.proc;
            if (proc == null || proc.thread == null) {
                //进程信息已清理
                return;
            }

            final long ident = Binder.clearCallingIdentity();
            try {
                appDiedLocked(proc); //[见小节4.4]
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
        }
    }

#### 4.4 AMS.cleanUpApplicationRecordLocked

    private final boolean cleanUpApplicationRecordLocked(...) {
        ...
        for (int i = app.pubProviders.size() - 1; i >= 0; i--) {
            //获取该进程已发布的ContentProvider
            ContentProviderRecord cpr = app.pubProviders.valueAt(i);
            // allowRestart=true，一般地always=false
            final boolean always = app.bad || !allowRestart;

            //ContentProvider服务端被杀，则client端进程也会被杀[见小节4.5]
            boolean inLaunching = removeDyingProviderLocked(app, cpr, always);
            if ((inLaunching || always) && cpr.hasConnectionOrHandle()) {
                restart = true; //需要重启
            }

            cpr.provider = null;
            cpr.proc = null;
        }
        app.pubProviders.clear();

        //处理正在启动并且是有client端正在等待的ContentProvider
        if (cleanupAppInLaunchingProvidersLocked(app, false)) {
            restart = true;
        }

        //取消已连接的ContentProvider的注册
        if (!app.conProviders.isEmpty()) {
            for (int i = app.conProviders.size() - 1; i >= 0; i--) {
                ContentProviderConnection conn = app.conProviders.get(i);
                conn.provider.connections.remove(conn);

                stopAssociationLocked(app.uid, app.processName, conn.provider.uid,
                        conn.provider.name);
            }
            app.conProviders.clear();
        }
        ...
    }

#### 4.5 AMS.removeDyingProviderLocked

    private final boolean removeDyingProviderLocked(ProcessRecord proc,
              ContentProviderRecord cpr, boolean always) {
      final boolean inLaunching = mLaunchingProviders.contains(cpr);

      if (!inLaunching || always) {
          synchronized (cpr) {
              cpr.launchingApp = null;
              cpr.notifyAll(); //通知处于等待状态的进程
          }
          mProviderMap.removeProviderByClass(cpr.name, UserHandle.getUserId(cpr.uid));
          String names[] = cpr.info.authority.split(";");
          for (int j = 0; j < names.length; j++) {
              mProviderMap.removeProviderByName(names[j], UserHandle.getUserId(cpr.uid));
          }
      }

      for (int i = cpr.connections.size() - 1; i >= 0; i--) {
          ContentProviderConnection conn = cpr.connections.get(i);
          if (conn.waiting) {
              if (inLaunching && !always) {
                  continue;
              }
          }
          ProcessRecord capp = conn.client;
          conn.dead = true;
          if (conn.stableCount > 0) {
              if (!capp.persistent && capp.thread != null
                      && capp.pid != 0
                      && capp.pid != MY_PID) {
                  //非persistent进程,则杀掉跟provider具有依赖关系的进程
                  capp.kill("depends on provider "
                          + cpr.name.flattenToShortString()
                          + " in dying proc " + (proc != null ? proc.processName : "??"), true);
              }
          } else if (capp.thread != null && conn.provider.provider != null) {
              //unstable的类型则不会被杀,也会调用到[小节4.2]
              capp.thread.unstableProviderDied(conn.provider.provider.asBinder());

              cpr.connections.remove(i);
              if (conn.client.conProviders.remove(conn)) {
                  stopAssociationLocked(capp.uid, capp.processName, cpr.uid, cpr.name);
              }
          }
      }

      if (inLaunching && always) {
          mLaunchingProviders.remove(cpr);
      }
      return inLaunching;
    }

removeDyingProviderLocked()方法的功能非常值得注意，引用计数跟进程的存活息息相关：

- 对于stable类型的provider(即conn.stableCount > 0),则会杀掉所有跟该provider建立stable连接的非persistent进程.
- 对于unstable类的provider(即conn.unstableCount > 0),并不会导致client进程被级联所杀.


## 五. 总结

provider引用计数的增加与减少关系: removePending是指即将被移除的引用, lastRef是指当前引用为0.

|方法|stableCount|unstableCount|条件
|---|---|---|
|acquireProvider|+1|0|removePending=false|
|acquireProvider|+1|-1|removePending=true|
|acquireUnstableProvider|0|+1|removePending=false|
|acquireUnstableProvider|0|0|removePending=true|
|releaseProvider|-1|0|lastRef=false|
|releaseProvider|-1|1|lastRef=true|
|releaseUnstableProvider|0|-1|lastRef=false|
|releaseUnstableProvider|0|0|lastRef=true|


当Client进程存在对某个provider的引用时,则会根据provider类型进行不同的处理:

- 对于stable provider: 会杀掉所有跟该provider建立stable连接的非persistent进程.
- 对于unstable provider: 不会导致client进程被级联所杀,只会回调unstableProviderDied来清理相关信息.

当stable和unstable引用计数都为0时则移除connection信息:

- AMS.removeContentProvider()过程移除该connection相关的所有信息
