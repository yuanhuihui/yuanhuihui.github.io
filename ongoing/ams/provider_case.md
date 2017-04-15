
#### 4.1 AT.installProvider

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
