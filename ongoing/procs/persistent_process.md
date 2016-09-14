

### AMS.systemReady

    if (mFactoryTest != FactoryTest.FACTORY_TEST_LOW_LEVEL) {
        try {
            List apps = AppGlobals.getPackageManager().
                getPersistentApplications(STOCK_PM_FLAGS);
            if (apps != null) {
                int N = apps.size();
                int i;
                for (i=0; i<N; i++) {
                    ApplicationInfo info
                        = (ApplicationInfo)apps.get(i);
                    if (info != null &&
                            !info.packageName.equals("android")) {
                        addAppLocked(info, false, null /* ABI override */);
                    }
                }
            }
        } catch (RemoteException ex) {
            // pm is in same process, this will never happen.
        }
    }


### AMS.addAppLocked

    final ProcessRecord addAppLocked(ApplicationInfo info, boolean isolated,
            String abiOverride) {
        ProcessRecord app;
        if (!isolated) {
            app = getProcessRecordLocked(info.processName, info.uid, true);
        } else {
            app = null;
        }

        if (app == null) {
            app = newProcessRecordLocked(info, null, isolated, 0);
            updateLruProcessLocked(app, false, null);
            updateOomAdjLocked();
        }

        // This package really, really can not be stopped.
        try {
            AppGlobals.getPackageManager().setPackageStoppedState(
                    info.packageName, false, UserHandle.getUserId(app.uid));
        } catch (RemoteException e) {
        } catch (IllegalArgumentException e) {
            Slog.w(TAG, "Failed trying to unstop package "
                    + info.packageName + ": " + e);
        }

        if ((info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
            app.persistent = true;
            app.maxAdj = ProcessList.PERSISTENT_PROC_ADJ;newProcessRecord
        }
        if (app.thread == null && mPersistentStartingProcesses.indexOf(app) < 0) {
            mPersistentStartingProcesses.add(app);
            startProcessLocked(app, "added application", app.processName, abiOverride,
                    null /* entryPoint */, null /* entryPointArgs */);
        }

        return app;
    }


### log信息

从Event log中,可知道查找 am_proc_start中关键词为"added application"

dumpsys信息:  "Persisent processes that are starting"


### 实例

312822 kB:       0 kB: Persistent

            85854 kB:       0 kB: system (pid 1274)    ==> system_server
            87884 kB:       0 kB: com.android.systemui (pid 2817)
             8151 kB:       0 kB: com.miui.core (pid 2920)
            16039 kB:       0 kB: com.xiaomi.xmsf (pid 2936)
            36982 kB:       0 kB: com.securespaces.android.ssm.service (pid 3152)

            15717 kB:       0 kB: com.xiaomi.finddevice (pid 3390)
            29525 kB:       0 kB: com.android.phone (pid 3426)
            16948 kB:       0 kB: com.miui.whetstone (pid 3355)
             4167 kB:       0 kB: com.quicinc.cne.CNEService (pid 3318)
             2993 kB:       0 kB: com.qualcomm.qcrilmsgtunnel (pid 3341)
             2927 kB:       0 kB: com.qualcomm.qti.rcsbootstraputil (pid 3360)
             2873 kB:       0 kB: com.qualcomm.qti.services.secureui:sui_service (pid 3415)
             2762 kB:       0 kB: com.fingerprints.serviceext (pid 3382)


### 哪些底层设置

setSystemProcess()  ==> "android"

addAppLocked ==> Persistent应用

newProcessRecordLocked:

    if (!mBooted && !mBooting
            && userId == UserHandle.USER_OWNER
            && (info.flags & PERSISTENT_MASK) == PERSISTENT_MASK) {
        r.persistent = true;
    }

### 链接

http://my.oschina.net/youranhongcha/blog/269591
