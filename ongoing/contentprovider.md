## 1. 获取ContentResolver

ContextImpl.getContentResolver
    mContentResolver = new ApplicationContentResolver(this, mainThread, user);

## 2.query

ContentResolver.query
    ContentResolver.acquireUnstableProvider (其他)
        ApplicationContentResolver.acquireUnstableProvider
            ActivityThread.acquireProvider
                AMP.getContentProvider
                    AMS.getContentProvider
                        AMS.getContentProviderImpl
                ActivityThread.installProvider



ams.getContentProviderImpl源码

private final ContentProviderHolder getContentProviderImpl() {
    ProcessRecord r = getRecordForAppLocked(caller);

    boolean providerRunning = cpr != null;
    if (providerRunning) {
        if (r != null && cpr.canRunHere(r)) {
           // This provider has been published or is in the process
           // of being published...  but it is also allowed to run
           // in the caller's process, so don't make a connection
           // and just let the caller instantiate its own instance.
           ContentProviderHolder holder = cpr.newHolder(null);
           holder.provider = null;
           return holder;
        }
    }

    if (!providerRunning) {
        if (r != null && cpr.canRunHere(r)) {
            // If this is a multiprocess provider, then just return its
            // info and allow the caller to instantiate it.  Only do
            // this if the provider is the same user as the caller's
            // process, or can run as root (so can be in any process).
            return cpr.newHolder(null);
        }
    }

    // If the provider is not already being launched, then get it started.
    proc = startProcessLocked(cpi.processName,
                        cpr.appInfo, false, 0, "content provider",
                        new ComponentName(cpi.applicationInfo.packageName,
                                cpi.name), false, false, false);

    incProviderCountLocked()
    // Wait for the provider to be published...
    synchronized (cpr) {
        cpr.wait();
    }

最终得到CursorWrapperInner类型

## CP进程启动过程

    ams.attachApplicationLocked
        ApplicationThread.bindApplication
            AT.handleBindApplication
                AT.handleBindApplication
                    AMP.publishContentProviders
                        AMS.publishContentProviders

publish方法中：  dst.notifyAll();

##  Cursor

close

ContentProviderProxy.query
    ContentProviderNative.query


    一旦CP进程死亡，AMS能根据该ContentProviderRecorder中保存的客户端信息找到使用该CP的所有客户端进程，然后再杀死它们。
  客户端能否撤销这种紧密关系呢？答案是肯定的，但这和Cursor是否关闭有关。这里先简单描述一下流程：
  ·  当Cursor关闭时，ContextImpl的releaseProvider会被调用。根据前面的介绍，它最终会调用ActivityThread的releaseProvider函数。
  ·  ActivityThread的releaseProvider函数会导致completeRemoveProvider被调用，在其内部根据该CP的引用计数判断是否需要调用AMS的removeContentProvider。
  ·  通过AMS的removeContentProvider将删除对应ContentProviderRecord中此客户端进程的信息，这样一来，客户端进程和目标CP进程的紧密关系就荡然无存了。
