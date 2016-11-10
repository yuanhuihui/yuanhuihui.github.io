#### 4.3.1 AT.handleUnstableProviderDiedLocked
[-> ActivityThread.java]

    final void handleUnstableProviderDiedLocked(IBinder provider, boolean fromClient) {
        ProviderRefCount prc = mProviderRefCountMap.get(provider);
        if (prc != null) {
            //将provider信息从mProviderRefCountMap和mProviderMap中移除
            mProviderRefCountMap.remove(provider);
            for (int i=mProviderMap.size()-1; i>=0; i--) {
                ProviderClientRecord pr = mProviderMap.valueAt(i);
                if (pr != null && pr.mProvider.asBinder() == provider) {
                    mProviderMap.removeAt(i);
                }
            }

            if (fromClient) {
                try {
                    ActivityManagerNative.getDefault().unstableProviderDied(
                            prc.holder.connection);
                } catch (RemoteException e) {

                }
            }
        }
    }

#### AMS.unstableProviderDied

    public void unstableProviderDied(IBinder connection) {
        ContentProviderConnection conn;
        try {
            conn = (ContentProviderConnection)connection;
        } catch (ClassCastException e) {
            throw new IllegalArgumentException(msg);
        }
        if (conn == null) {
            throw new NullPointerException("connection is null");
        }

        //从conn对象中获取ContentProviderRecord变量的IContentProvider
        synchronized (this) {
            provider = conn.provider.provider;
        }

        if (provider == null) {
            return;
        }

        if (provider.asBinder().pingBinder()) {
            //caller回调告知该provider死亡，但事实上能够ping通，说明还存活则直接返回；
            synchronized (this) {
                return;
            }
        }

        //这里进入死亡处理流程
        synchronized (this) {
            if (conn.provider.provider != provider) {
                //IContentProvider对象已改变，则无需清理直接返回；
                return;
            }

            ProcessRecord proc = conn.provider.proc;
            if (proc == null || proc.thread == null) {
                //进程已完成清理，则直接返回；
                return;
            }

            //这才到真正的死亡处理过程，但provider死得有点过早
            final long ident = Binder.clearCallingIdentity();
            try {
                //【】
                appDiedLocked(proc);
            } finally {
                Binder.restoreCallingIdentity(ident);
            }
        }
    }


### 3.3 Cursor.close

调用链

    CR.CursorWrapperInner.close
        CW.close
        CR.releaseProvider


#### 3.3.1 CursorWrapperInner.close
[-> ContentResolver.java]

    @Override
    public void close() {
        //【见小节3.3.2】
        super.close();
        ContentResolver.this.releaseProvider(mContentProvider);
        mProviderReleased = true;

        if (mCloseGuard != null) {
            mCloseGuard.close();
        }
    }


#### 3.3.2 CursorWrapper.close
[-> CursorWrapper.java]

    public void close() {
        //mCursor数据类型为BulkCursorToCursorAdaptor【见小节3.3.3】
        mCursor.close();
    }

#### 3.3.3 BCTCA.close
[-> BulkCursorToCursorAdaptor.java]

    public void close() {
        //释放内存CursorWindow【见小节3.3.4】
        super.close();

        if (mBulkCursor != null) {
            try {
                mBulkCursor.close(); //【】释放远程对象
            } catch (RemoteException ex) {
                ...
            } finally {
                mBulkCursor = null;
            }
        }
    }

#### 3.3.4 AbstractCursor.close
[-> AbstractCursor.java]

    public void close() {
        mClosed = true;
        //移除所有已经注册的Observable
        mContentObservable.unregisterAll();
        //【见小节3.3.5】
        onDeactivateOrClose();
    }


#### 3.3.5 AbstractWindowedCursor.close
[-> AbstractWindowedCursor.java]

    protected void onDeactivateOrClose() {
        //【见小节3.3.6】
        super.onDeactivateOrClose();
        closeWindow();
    }

#### 3.3.6 AbstractCursor
[-> AbstractCursor.java]

    protected void onDeactivateOrClose() {
        if (mSelfObserver != null) {
            mContentResolver.unregisterContentObserver(mSelfObserver);
            mSelfObserverRegistered = false;
        }
        mDataSetObservable.notifyInvalidated();
    }


#### 3.3.7 AbstractWindowedCursor.closeWindow
[-> AbstractWindowedCursor.java]

    protected void closeWindow() {
        if (mWindow != null) {
            mWindow.close();
            mWindow = null;
        }
    }


### 小节

如客户端不显示调用close，将导致服务端进程的资源无法释放

    一旦CP进程死亡，AMS能根据该ContentProviderRecorder中保存的客户端信息找到使用该CP的所有客户端进程，然后再杀死它们。
  客户端能否撤销这种紧密关系呢？答案是肯定的，但这和Cursor是否关闭有关。这里先简单描述一下流程：
  ·  当Cursor关闭时，ContextImpl的releaseProvider会被调用。根据前面的介绍，它最终会调用ActivityThread的releaseProvider函数。
  ·  ActivityThread的releaseProvider函数会导致completeRemoveProvider被调用，在其内部根据该CP的引用计数判断是否需要调用AMS的removeContentProvider。
  ·  通过AMS的removeContentProvider将删除对应ContentProviderRecord中此客户端进程的信息，这样一来，客户端进程和目标CP进程的紧密关系就荡然无存了。


## 几个方法

incProviderRefLocked
AMS.incProviderCountLocked
ams.decProviderCountLocked


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
