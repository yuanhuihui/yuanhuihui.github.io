---
layout: post
title:  "聊一聊Provider引用计数"
date:   2016-07-30 20:30:00
catalog:  true
tags:
    - android
    - 组件
---

> 基于Android 6.0源码剖析，本文涉及的相关源码：


## 一.概述

上一篇文章[理解ContentProvider原理](http://gityuan.com/2016/07/30/content-provider/)介绍了provider的整个原理,
本文则是从另一个视角provider的创建与结束的过程中关于引用计数的问题.


## 二. 增加计数

### 2.1 CR.query

[-> ContentResolver.java]

    public final  Cursor query( Uri uri,  String[] projection,
             String selection,  String[] selectionArgs,
             String sortOrder) {
        return query(uri, projection, selection, selectionArgs, sortOrder, null);
    }

    public final  Cursor query(final  Uri uri,  String[] projection,
                 String selection,  String[] selectionArgs,
                 String sortOrder,  CancellationSignal cancellationSignal) {
            //获取unstable provider【见小节2.2】
            IContentProvider unstableProvider = acquireUnstableProvider(uri);
            IContentProvider stableProvider = null;
            Cursor qCursor = null;
            try {
                ...
                try {
                    qCursor = unstableProvider.query(mPackageName, uri, projection,
                            selection, selectionArgs, sortOrder, remoteCancellationSignal);
                } catch (DeadObjectException e) {
                    // 远程进程死亡，处理unstable provider死亡过程 [见流程2.2]
                    unstableProviderDied(unstableProvider);

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
                    releaseUnstableProvider(unstableProvider);
                }
                if (stableProvider != null) {
                    releaseProvider(stableProvider);
                }
            }
        }



### unstableProviderDied

    CR.unstableProviderDied
        ACR.unstableProviderDied
            AT.handleUnstableProviderDied
                AT.handleUnstableProviderDiedLocked
                    AMP.unstableProviderDied
                        AMS.unstableProviderDied
                            AMS.appDiedLocked (清理后事)


## 引用计数

### 1. AT.incProviderRefLocked

    private final void incProviderRefLocked(ProviderRefCount prc, boolean stable) {
        if (stable) {
            prc.stableCount += 1; //stable引用计数+1
            if (prc.stableCount == 1) {
                int unstableDelta;
                if (prc.removePending) {
                    //当存在即将移除操作时,需要将
                    unstableDelta = -1;
                    prc.removePending = false;
                    mH.removeMessages(H.REMOVE_PROVIDER, prc); //移除消息
                } else {
                    unstableDelta = 0;
                }
                // [见小节3]
                ActivityManagerNative.getDefault().refContentProvider(
                        prc.holder.connection, 1, unstableDelta);

            }
        } else {
            prc.unstableCount += 1;
            if (prc.unstableCount == 1) {
                if (prc.removePending) {
                    prc.removePending = false;
                    mH.removeMessages(H.REMOVE_PROVIDER, prc);
                } else {
                    ActivityManagerNative.getDefault().refContentProvider(
                            prc.holder.connection, 0, 1);

                }
            }
        }
    }


- 对于stable provider, 当stableCount=1的情况
    - 当removePending = false时, 则refContentProvider传递的后两个参数(1, -1)
    - 当removePending = true 时, 则refContentProvider传递的后两个参数(1, 0)
- 对于unstable provider,当unstableCount=1的情况
    - 当removePending=false时, 则refContentProvider传递的后两个参数(0,1)

### 2. AT.releaseProvider

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
                //stable引用计数减1
                prc.stableCount -= 1;
                if (prc.stableCount == 0) {
                    lastRef = prc.unstableCount == 0;
                    ActivityManagerNative.getDefault().refContentProvider(
                            prc.holder.connection, -1, lastRef ? 1 : 0);
                }
            } else {
                if (prc.unstableCount == 0) {
                    return false;
                }
                prc.unstableCount -= 1;
                if (prc.unstableCount == 0) {
                    lastRef = prc.stableCount == 0;
                    if (!lastRef) {
                        ActivityManagerNative.getDefault().refContentProvider(
                            prc.holder.connection, 0, -1);

                }
            }

            //当最后引用计数时,则发送REMOVE_PROVIDER消息, 主线程收到消息调用AT.completeRemoveProvider
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

- 对于stable provider,当stableCount=0的情况下
    - 当unstableCount = 0时,  则refContentProvider传递的后两个参数(-1, -1)
    - 当unstableCount != 0时, 则refContentProvider传递的后两个参数(-1, 0)
- 对于unstable provider,当unstableCount=0的情况下:
    - 当stableCount != 0 时, 则refContentProvider传递的后两个参数(0,-1)

当最后引用计数时,则发送REMOVE_PROVIDER消息, 主线程收到消息调用AT.completeRemoveProvider.


**对于releaseProvider**

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

### 3. AMS.refContentProvider

    public boolean refContentProvider(IBinder connection, int stable, int unstable) {
        ContentProviderConnection conn;
        conn = (ContentProviderConnection)connection;
        ...
        synchronized (this) {
            if (stable > 0) {
                conn.numStableIncs += stable;
            }

            //修改stable
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

该方法的作用是用于修改conn的stable和unstable引用次数, 对于修改后的stable和unstable值必须大于或等于0,且至少有一项大于0才能正常返回.
否则,以下任一情况会抛出异常IllegalStateException:

- stable < 0
- unstable < 0
- (stable+unstable) <= 0


### 4. AMS.incProviderCountLocked

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

### 5. AMS.decProviderCountLocked

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


### 小结

AT.incProviderRefLocked //增加引用计数
AT.releaseProvider //减小引用计数

AMS.incProviderCountLocked //增加引用计数
AMS.decProviderCountLocked //减小引用计数

## 常见对象

ContentProviderConnection是指连接contentprovider与client之间的连接对象.
关于引用计数问题,最需要关注的便是`stableCount`和`unstableCount`的次数.

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

ProviderRefCount对象是ActivityThread的内部类

    private static final class ProviderRefCount {
        public final IActivityManager.ContentProviderHolder holder;
        public final ProviderClientRecord client;
        public int stableCount;
        public int unstableCount;

        public boolean removePending;
    }

ProviderClientRecord对象也是ActivityThread的内部类

    final class ProviderClientRecord {
        final String[] mNames;
        final IContentProvider mProvider;
        final ContentProvider mLocalProvider;
        final IActivityManager.ContentProviderHolder mHolder;
    }

ContentProviderHolder对象是IActivityManager的内部类

    public static class ContentProviderHolder implements Parcelable {
        public final ProviderInfo info;
        public IContentProvider provider;
        public IBinder connection;
        public boolean noReleaseNeeded;
    }
