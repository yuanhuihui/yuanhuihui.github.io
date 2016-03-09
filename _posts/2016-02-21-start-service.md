---
layout: post
title:  "startService流程分析"
date:   2016-02-21 20:12:50
categories: android 
excerpt:  startService流程分析
---

* content
{:toc}


---

> 基于Android 6.0的源码剖析， 分析android Service启动流程中ActivityManagerService所扮演的角色


	/frameworks/base/services/core/java/com/android/server/am/ActiveServices.java
	/frameworks/base/services/core/java/com/android/server/am/ServiceRecord.java
	/frameworks/base/services/core/java/com/android/server/am/ProcessRecord.java

	/frameworks/base/services/core/java/com/android/server/am/ActivityManagerService.java
	/frameworks/base/core/java/android/app/IActivityManager.java
	/frameworks/base/core/java/android/app/ActivityManagerNative.java (内含ActivityManagerProxy类)
	/frameworks/base/core/java/android/app/ActivityManager.java

	/frameworks/base/core/java/android/app/IApplicationThread.java
	/frameworks/base/core/java/android/app/ApplicationThreadNative.java (内含ApplicationThreadProxy类)
	/frameworks/base/core/java/android/app/ActivityThread.java (内含ApplicationThread类)

	/frameworks/base/core/java/android/app/ContextImpl.java

### 概述

看过前面介绍[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)文章，相信对Binder架构有了较深地理解。在[Android系统启动-开篇](http://www.yuanhh.com/2016/01/03/android-boot/)中讲述了Binder的地位是非常之重要，整个Java framework的提供ActivityManagerService、PackageManagerService等服务都是基于Binder架构来通信的，另外
[handle消息机制](http://www.yuanhh.com/2015/12/26/handler-message/)在进程内的通信使用非常多。本文将开启对ActivityManagerService的分析。  

ActivityManagerService是Android的Java framework的服务框架最重要的服务之一。对于Andorid的Activity、Service、Broadcast、ContentProvider四剑客的管理，包含其生命周期都是通过ActivityManagerService来完成的。对于这四剑客的介绍，此处先略过，后续博主会针对这4剑客分别阐述。

**类图**

下面先看看ActivityManagerService相关的类图：

![activity_manager_classes](/images/android-service/am/activity_manager_classes.png)


单单就一个ActivityManagerService.java文件就代码超过20000万行，我们需要需要一个线，再结合binder的知识，来把我们想要了解的东西串起来，那么本文将从App启动的视角来分析ActivityManagerService。


**启动服务**

在app中启动一个service，就一行语句搞定，

	startService()； //或 binderService()

该过程如下：

![start_service](/images/android-service/am/start_service.png)

当App通过调用Android API方法startService()或binderService()来生成并启动服务的过程，主要是由ActivityManagerService来完成的。

1. ActivityManagerService通过Socket通信方式向Zygote进程请求生成(fork)用于承载服务的进程ActivityThread。此处讲述启动远程服务的过程，即服务运行于单独的进程中，对于运行本地服务则不需要启动服务的过程。ActivityThread是应用程序的主线程；
2. Zygote通过fork的方法，将zygote进程复制生成新的进程，并将ActivityThread相关的资源加载到新进程；
3. ActivityManagerService向新生成的ActivityThread进程，通过Binder方式发送生成服务的请求；
4. ActivityThread启动运行服务，这便于服务启动的简易过程，真正流程远比这服务；

**启动服务的流程图：**

![Seq_start_service](/images/android-service/am/Seq_start_service.png)

图中涉及的首字母缩写：

- AMP:ActivityManagerProxy
- AMN:ActivityManagerNative
- AMS:ActivityManagerService
- AT:ApplicationThread
- ATP:ApplicationThreadProxy
- ATN:ApplicationThreadNative

----------

接下来，我们正式从代码角度来分析服务启动的过程。首先在我们应用程序的Activity类的调用startService()方法，该方法调用【流程1】的方法。

### 1. ContextWrapper.startService

	public class ContextWrapper extends Context {
	    @Override
	    public ComponentName startService(Intent service) {
	        return mBase.startService(service); //其中mBase为ContextImpl对象 【见流程2-1】
	    }
	}

### 2. ContextImpl.startService

**[2-1]**

	class ContextImpl extends Context {
		@Override
	    public ComponentName startService(Intent service) {
	        //当system进程调用此方法时输出warn信息，system进程建立调用startServiceAsUser方法
	        warnIfCallingFromSystemProcess(); 
	        return startServiceCommon(service, mUser); 【见流程2-2】
	    }

**[2-2]**

	    private ComponentName startServiceCommon(Intent service, UserHandle user) {
	        try {
	            //检验service，当service为空则throw异常
	            validateServiceIntent(service); 
	            service.prepareToLeaveProcess();
	            // 调用ActivityManagerNative类 【见流程3】
	            ComponentName cn = ActivityManagerNative.getDefault().startService(
	                mMainThread.getApplicationThread(), service, service.resolveTypeIfNeeded(getContentResolver()), getOpPackageName(), user.getIdentifier());
	            if (cn != null) {
	                if (cn.getPackageName().equals("!")) {
	                    throw new SecurityException("Not allowed to start service " + 
                            service + " without permission " + cn.getClassName());
	                } else if (cn.getPackageName().equals("!!")) {
	                    throw new SecurityException("Unable to start service " + 
                            service  ": " + cn.getClassName());
	                }
	            }
	            return cn;
	        } catch (RemoteException e) {
	            throw new RuntimeException("Failure from system", e);
	        }
	    }
    }

ActivityManagerNative.getDefault()该方法返回的是ActivityManagerProxy对象，那么下一步调用ActivityManagerProxy.startService()方法。


通过Binder通信过程中，提供了一个IActivityManager服务接口，ActivityManagerProxy类与ActivityManagerService类都实现了IActivityManager接口。ActivityManagerProxy作为binder通信的客户端，ActivityManagerService作为binder通信的服务端，根据[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)文章，ActivityManagerProxy.startService()最终调用ActivityManagerService.startService()，整个流程图如下：

![Activity_Manager_Service](/images/android-service/am/Activity_Manager_Service.png)

### 3. ActivityManagerProxy.startService

该类位于文件ActivityManagerNative.java

	public ComponentName startService(IApplicationThread caller, Intent service,
	            String resolvedType, String callingPackage, int userId) throws RemoteException
    {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(caller != null ? caller.asBinder() : null);
        service.writeToParcel(data, 0);
        data.writeString(resolvedType);
        data.writeString(callingPackage);
        data.writeInt(userId);
        //通过Binder 传递数据　【见流程5】
        mRemote.transact(START_SERVICE_TRANSACTION, data, reply, 0);
        reply.readException();
        ComponentName res = ComponentName.readFromParcel(reply);
        data.recycle();
        reply.recycle();
        return res;
    }


### 4. ActivityManagerNative.onTransact

    @Override
    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
            throws RemoteException {
        switch (code) {
        ...
         case START_SERVICE_TRANSACTION: {
            data.enforceInterface(IActivityManager.descriptor);
            IBinder b = data.readStrongBinder();
            //生成ApplicationThreadNative的代理对象，即ApplicationThreadProxy对象
            IApplicationThread app = ApplicationThreadNative.asInterface(b);
            Intent service = Intent.CREATOR.createFromParcel(data);
            String resolvedType = data.readString();
            String callingPackage = data.readString();
            int userId = data.readInt();
            //调用ActivityManagerService的startService()方法【见流程5】
            ComponentName cn = startService(app, service, resolvedType, callingPackage, userId);
            reply.writeNoException();
            ComponentName.writeToParcel(cn, reply);
            return true;
        }
    }

在整个调用过程涉及两个进程，不妨令startService的发起进程记为进程A，ServiceManagerService记为进程B；那么进程A通过Binder机制（采用IActivityManager接口）向进程B发起请求服务，进程B则通过Binder机制(采用IApplicationThread接口)向进程A发起请求服务。也就是说进程A与进程B能相互间主动发起请求，进程通信。

这里涉及IApplicationThread，那么下面直接把其相关的类图展示如下：

![application_thread_classes](/images/android-service/am/application_thread_classes.png)

与IActivityManager的binder通信原理一样，ApplicationThreadProxy作为binder通信的客户端，ApplicationThreadNative作为Binder通信的服务端,ApplicationThread继承ApplicationThreadProxy类，覆写其中的部分方法。

### 5. ActivityManagerService.startService

    @Override
    public ComponentName startService(IApplicationThread caller, Intent service,
            String resolvedType, String callingPackage, int userId)
            throws TransactionTooLargeException {
        //当调用者是孤立进程，则抛出异常。
        enforceNotIsolatedCaller("startService"); 
        
        if (service != null && service.hasFileDescriptors() == true) {
            throw new IllegalArgumentException("File descriptors passed in Intent");
        }
        if (callingPackage == null) {
            throw new IllegalArgumentException("callingPackage cannot be null");
        }
        if (DEBUG_SERVICE) Slog.v(TAG_SERVICE,
                "startService: " + service + " type=" + resolvedType);

        synchronized(this) {
            final int callingPid = Binder.getCallingPid(); //调用者pid
            final int callingUid = Binder.getCallingUid(); //调用者uid
            final long origId = Binder.clearCallingIdentity();
            //此次的mServices为ActiveServices对象 【见流程6-1】
            ComponentName res = mServices.startServiceLocked(caller, service,
                    resolvedType, callingPid, callingUid, callingPackage, userId);
            Binder.restoreCallingIdentity(origId);
            return res;
        }
    }

该方法参数说明：

- caller：IApplicationThread类型，复杂处理
- service：Intent类型，包含需要运行的service信息
- resolvedType：String类型
- callingPackage: String类型，调用该方法的package
- userId: int类型，用户的id


### 6. ActiveServices.startServiceLocked
	
**[6-1]**

    ComponentName startServiceLocked(IApplicationThread caller, Intent service, String resolvedType,
            int callingPid, int callingUid, String callingPackage, int userId)
            throws TransactionTooLargeException {

        final boolean callerFg;
        if (caller != null) {
            final ProcessRecord callerApp = mAm.getRecordForAppLocked(caller);
            if (callerApp == null) 
                throw new SecurityException(""); //抛出异常，此处省略异常字符串
            callerFg = callerApp.setSchedGroup != Process.THREAD_GROUP_BG_NONINTERACTIVE;
        } else {
            callerFg = true;
        }
        //检索服务信息 
        ServiceLookupResult res =  retrieveServiceLocked(service, resolvedType, callingPackage,
                    callingPid, callingUid, userId, true, callerFg);
        if (res == null) {
            return null;
        }
        if (res.record == null) {
            return new ComponentName("!", res.permission != null
                    ? res.permission : "private to package");
        }
        ServiceRecord r = res.record;
        if (!mAm.getUserManagerLocked().exists(r.userId)) { //检查是否存在启动服务的user
            return null;
        }
        NeededUriGrants neededGrants = mAm.checkGrantUriPermissionFromIntentLocked(
                callingUid, r.packageName, service, service.getFlags(), null, r.userId);

        r.lastActivity = SystemClock.uptimeMillis();
        r.startRequested = true;
        r.delayedStop = false;
        r.pendingStarts.add(new ServiceRecord.StartItem(r, false, r.makeNextStartId(),
                service, neededGrants));
        final ServiceMap smap = getServiceMap(r.userId);
        boolean addToStarting = false;
        对于非前台进程的调度
        if (!callerFg && r.app == null && mAm.mStartedUsers.get(r.userId) != null) {
            ProcessRecord proc = mAm.getProcessRecordLocked(r.processName, r.appInfo.uid, false);
            if (proc == null || proc.curProcState > ActivityManager.PROCESS_STATE_RECEIVER) {
                if (r.delayed) {  //已计划延迟启动
                    return r.name;
                }
                if (smap.mStartingBackground.size() >= mMaxStartingBackground) {
                    //当超出 同一时间允许后续启动的最大服务数，则将该服务加入延迟启动的队列。
                    smap.mDelayedStartList.add(r);
                    r.delayed = true;
                    return r.name;
                }
                addToStarting = true;
            } else if (proc.curProcState >= ActivityManager.PROCESS_STATE_SERVICE) {
                //将新的服务加入到后台启动队列，该队列也包含当前正在运行其他services或者receivers的进程
                addToStarting = true;
            } 
        } 
        return startServiceInnerLocked(smap, service, r, callerFg, addToStarting); 【见流程6-2】
    }

**[6-2]**
	
    ComponentName startServiceInnerLocked(ServiceMap smap, Intent service, ServiceRecord r,
            boolean callerFg, boolean addToStarting) throws TransactionTooLargeException {
        ProcessStats.ServiceState stracker = r.getTracker();
        if (stracker != null) {
            stracker.setStarted(true, mAm.mProcessStats.getMemFactorLocked(), r.lastActivity);
        }
        r.callStart = false;
        synchronized (r.stats.getBatteryStats()) {
            r.stats.startRunningLocked(); //用于耗电统计，开启运行的状态
        }
        String error = bringUpServiceLocked(r, service.getFlags(), callerFg, false); 【见流程6-3】
        if (error != null) {
            return new ComponentName("!!", error);
        }
        if (r.startRequested && addToStarting) {
            boolean first = smap.mStartingBackground.size() == 0;
            smap.mStartingBackground.add(r);
            r.startingBgTimeout = SystemClock.uptimeMillis() + BG_START_TIMEOUT;
            if (first) {
                smap.rescheduleDelayedStarts();
            }
        } else if (callerFg) {
            smap.ensureNotStartingBackground(r);
        }
        return r.name;
    }

**[6-3]**


    private final String bringUpServiceLocked(ServiceRecord r, int intentFlags, boolean execInFg,
            boolean whileRestarting) throws TransactionTooLargeException {
        if (r.app != null && r.app.thread != null) {
            sendServiceArgsLocked(r, execInFg, false);
            return null;
        }
        if (!whileRestarting && r.restartDelay > 0) {
            return null; //等待延迟重启的过程，则直接返回
        }

        // 启动service前，把service从重启服务队列中移除
        if (mRestartingServices.remove(r)) {
            r.resetRestartCounter();
            clearRestartingIfNeededLocked(r);
        }
        //service正在启动，将delayed设置为false
        if (r.delayed) {
            getServiceMap(r.userId).mDelayedStartList.remove(r);
            r.delayed = false;
        }

        //确保拥有该服务的user已经启动，否则停止；
        if (mAm.mStartedUsers.get(r.userId) == null) {
            String msg = "";
            bringDownServiceLocked(r);
            return msg;
        }
        //服务正在启动，设置package停止状态为false
        try {
            AppGlobals.getPackageManager().setPackageStoppedState(
                    r.packageName, false, r.userId);
        } catch (RemoteException e) {
        } catch (IllegalArgumentException e) {
            Slog.w(TAG, "Failed trying to unstop package " + r.packageName + ": " + e);
        }

        final boolean isolated = (r.serviceInfo.flags&ServiceInfo.FLAG_ISOLATED_PROCESS) != 0;
        final String procName = r.processName;
        ProcessRecord app;
        if (!isolated) {
            //根据进程名和uid，查询ProcessRecord
            app = mAm.getProcessRecordLocked(procName, r.appInfo.uid, false);
            if (app != null && app.thread != null) {
                try {
                    app.addPackage(r.appInfo.packageName, r.appInfo.versionCode, mAm.mProcessStats);
                    // 启动服务 【见流程10-2】
                    realStartServiceLocked(r, app, execInFg); 
                    return null;
                } catch (TransactionTooLargeException e) {
                    throw e;
                } catch (RemoteException e) {
                    Slog.w(TAG, "Exception when starting service " + r.shortName, e);
                }
            }
        } else {
            app = r.isolatedProc;
        }

        //对于进程没有启动的情况
        if (app == null) {
            //启动service所要运行的进程 【见流程7-1】
            if ((app=mAm.startProcessLocked(procName, r.appInfo, true, intentFlags,
                    "service", r.name, false, isolated, false)) == null) {
                String msg = "" 
                bringDownServiceLocked(r); // 进程启动失败
                return msg;
            }
            if (isolated) {
                r.isolatedProc = app;
            }
        }
        if (!mPendingServices.contains(r)) {
            mPendingServices.add(r); 
        }
        if (r.delayedStop) {
            r.delayedStop = false;
            if (r.startRequested) {
                stopServiceLocked(r); //停止服务
            }
        }
        return null;
    }

 
对于非前台进程调用而需要启动的服务，如果已经有其他的后台服务正在启动中，那么我们可能希望延迟其启动。这是用来避免启动同时启动过多的进程(非必须的)。

### 7. ActivityManagerService.startProcessLocked

**[7-1]**

    final ProcessRecord startProcessLocked(String processName,
            ApplicationInfo info, boolean knownToBeDead, int intentFlags,
            String hostingType, ComponentName hostingName, boolean allowWhileBooting,
            boolean isolated, boolean keepIfLarge) {
        return startProcessLocked(processName, info, knownToBeDead, intentFlags, hostingType,
                hostingName, allowWhileBooting, isolated, 0 /* isolatedUid */, keepIfLarge,
                null /* ABI override */, null /* entryPoint */, null /* entryPointArgs */,
                null /* crashHandler */);  //【见7-2】
    }

**[7-2]**

    final ProcessRecord startProcessLocked(String processName, ApplicationInfo info,
            boolean knownToBeDead, int intentFlags, String hostingType, ComponentName hostingName,
            boolean allowWhileBooting, boolean isolated, int isolatedUid, boolean keepIfLarge,
            String abiOverride, String entryPoint, String[] entryPointArgs, Runnable crashHandler) {
        long startTime = SystemClock.elapsedRealtime();
        ProcessRecord app;
        if (!isolated) {
            //根据进程名和uid检查相应的ProcessRecord
            app = getProcessRecordLocked(processName, info.uid, keepIfLarge);

            if ((intentFlags & Intent.FLAG_FROM_BACKGROUND) != 0) {
                //如果当前处理后台进程，检查当前进程是否处理bad进程列表
                if (mBadProcesses.get(info.processName, info.uid) != null) {
                    return null;
                }
            } else {
                //当用户明确地启动进程，则清空crash次数，以保证其不处于bad进程直到下次再弹出crash对话框。
                mProcessCrashTimes.remove(info.processName, info.uid);
                if (mBadProcesses.get(info.processName, info.uid) != null) {
                    mBadProcesses.remove(info.processName, info.uid);
                    if (app != null) {
                        app.bad = false;
                    }
                }
            }
        } else {
            /对于孤立进程，无法再利用已存在的进程
            app = null;
        }

        if (app != null && app.pid > 0) {
            if (!knownToBeDead || app.thread == null) {
                //如果这是进程中新package，则添加到列表
                app.addPackage(info.packageName, info.versionCode, mProcessStats);
                return app;
            }
            //当application record已经被attached到先前的一个进程，则杀死该进程
            // clean it up now.
            killProcessGroup(app.info.uid, app.pid);
            handleAppDiedLocked(app, true, true);
        }
        String hostingNameStr = hostingName != null? hostingName.flattenToShortString() : null;
        if (app == null) {
            // 创建新的Process Record对象
            app = newProcessRecordLocked(info, processName, isolated, isolatedUid);
            if (app == null) {
                return null;
            }
            app.crashHandler = crashHandler;
        } else {
            ////如果这是进程中新package，则添加到列表
            app.addPackage(info.packageName, info.versionCode, mProcessStats);
        }
        //当系统未准备完毕，则将当前进程加入到mProcessesOnHold
        if (!mProcessesReady && !isAllowedWhileBooting(info) && !allowWhileBooting) {
            if (!mProcessesOnHold.contains(app)) {
                mProcessesOnHold.add(app);
            }
            return app;
        }
        // 启动进程【7-3】
        startProcessLocked(app, hostingType, hostingNameStr, abiOverride, entryPoint, entryPointArgs);
        return (app.pid != 0) ? app : null;
    }

**[7-3]**

    private final void startProcessLocked(ProcessRecord app, String hostingType,
            String hostingNameStr, String abiOverride, String entryPoint, String[] entryPointArgs) {
        long startTime = SystemClock.elapsedRealtime();
        //当app的pid大于0且不是当前进程的pid，则从mPidsSelfLocked中移除该app.pid
        if (app.pid > 0 && app.pid != MY_PID) {
            synchronized (mPidsSelfLocked) {
                mPidsSelfLocked.remove(app.pid);
                mHandler.removeMessages(PROC_START_TIMEOUT_MSG, app);
            }
            app.setPid(0);
        }

        mProcessesOnHold.remove(app);
        updateCpuStats(); //更新cpu统计信息
        try {
            try {
                if (AppGlobals.getPackageManager().isPackageFrozen(app.info.packageName)) {
                    //当前package已被冻结
                    throw new RuntimeException("Package " + app.info.packageName + " is frozen!");
                }
            } catch (RemoteException e) {
                throw e.rethrowAsRuntimeException();
            }
            int uid = app.uid;
            int[] gids = null;
            int mountExternal = Zygote.MOUNT_EXTERNAL_NONE;
            if (!app.isolated) {
                int[] permGids = null;
                try {
                    //通过Package Manager获取gids
                    final IPackageManager pm = AppGlobals.getPackageManager();
                    permGids = pm.getPackageGids(app.info.packageName, app.userId);
                    MountServiceInternal mountServiceInternal = LocalServices.getService(
                            MountServiceInternal.class);
                    mountExternal = mountServiceInternal.getExternalStorageMountMode(uid,
                            app.info.packageName);
                } catch (RemoteException e) {
                    throw e.rethrowAsRuntimeException();
                }
                
                //添加共享app和gids，用于app直接共享资源
                if (ArrayUtils.isEmpty(permGids)) {
                    gids = new int[2];
                } else {
                    gids = new int[permGids.length + 2];
                    System.arraycopy(permGids, 0, gids, 2, permGids.length);
                }
                gids[0] = UserHandle.getSharedAppGid(UserHandle.getAppId(uid));
                gids[1] = UserHandle.getUserGid(UserHandle.getUserId(uid));
            }

            if (mFactoryTest != FactoryTest.FACTORY_TEST_OFF) {
                if (mFactoryTest == FactoryTest.FACTORY_TEST_LOW_LEVEL
                        && mTopComponent != null && app.processName.equals(mTopComponent.getPackageName())) {
                    uid = 0;
                }
                if (mFactoryTest == FactoryTest.FACTORY_TEST_HIGH_LEVEL
                        && (app.info.flags&ApplicationInfo.FLAG_FACTORY_TEST) != 0) {
                    uid = 0;
                }
            }
            int debugFlags = 0;
            //在AndroidManifest.xml中设置androidd:debuggable为true，代表app运行在debug模式
            if ((app.info.flags & ApplicationInfo.FLAG_DEBUGGABLE) != 0) {
                debugFlags |= Zygote.DEBUG_ENABLE_DEBUGGER;
                //开启 检查JNI功能
                debugFlags |= Zygote.DEBUG_ENABLE_CHECKJNI;
            }
            // 在AndroidManifest.xml中设置androidd:vmSafeMode为true，代表app运行在安全模式
            if ((app.info.flags & ApplicationInfo.FLAG_VM_SAFE_MODE) != 0 || mSafeMode == true) {
                debugFlags |= Zygote.DEBUG_ENABLE_SAFEMODE;
            }
            if ("1".equals(SystemProperties.get("debug.checkjni"))) {
                debugFlags |= Zygote.DEBUG_ENABLE_CHECKJNI;
            }
            String jitDebugProperty = SystemProperties.get("debug.usejit");
            if ("true".equals(jitDebugProperty)) {
                debugFlags |= Zygote.DEBUG_ENABLE_JIT;
            } else if (!"false".equals(jitDebugProperty)) {
                if ("true".equals(SystemProperties.get("dalvik.vm.usejit"))) {
                    debugFlags |= Zygote.DEBUG_ENABLE_JIT;
                }
            }
            String genDebugInfoProperty = SystemProperties.get("debug.generate-debug-info");
            if ("true".equals(genDebugInfoProperty)) {
                debugFlags |= Zygote.DEBUG_GENERATE_DEBUG_INFO;
            }
            if ("1".equals(SystemProperties.get("debug.jni.logging"))) {
                debugFlags |= Zygote.DEBUG_ENABLE_JNI_LOGGING;
            }
            if ("1".equals(SystemProperties.get("debug.assert"))) {
                debugFlags |= Zygote.DEBUG_ENABLE_ASSERT;
            }
            String requiredAbi = (abiOverride != null) ? abiOverride : app.info.primaryCpuAbi;
            if (requiredAbi == null) {
                requiredAbi = Build.SUPPORTED_ABIS[0];
            }
            String instructionSet = null;
            if (app.info.primaryCpuAbi != null) {
                instructionSet = VMRuntime.getInstructionSet(app.info.primaryCpuAbi);
            }
            app.gids = gids;
            app.requiredAbi = requiredAbi;
            app.instructionSet = instructionSet;

            boolean isActivityProcess = (entryPoint == null);
            if (entryPoint == null) entryPoint = "android.app.ActivityThread";
            //请求Zygote创建新进程 【见流程8，此处跳级见后面说明】 
            Process.ProcessStartResult startResult = Process.start(entryPoint,
                    app.processName, uid, uid, gids, debugFlags, mountExternal,
                    app.info.targetSdkVersion, app.info.seinfo, requiredAbi, instructionSet,
                    app.info.dataDir, entryPointArgs);

            if (app.isolated) {
                mBatteryStatsService.addIsolatedUid(app.uid, app.info.uid);
            }
            mBatteryStatsService.noteProcessStart(app.processName, app.info.uid);
            if (app.persistent) {
                Watchdog.getInstance().processStarted(app.processName, startResult.pid);
            }

            app.setPid(startResult.pid);
            app.usingWrapper = startResult.usingWrapper;
            app.removed = false;
            app.killed = false;
            app.killedByAm = false;
            //将新创建的进程加入到mPidsSelfLocked
            synchronized (mPidsSelfLocked) {
                this.mPidsSelfLocked.put(startResult.pid, app);
                if (isActivityProcess) {
                    Message msg = mHandler.obtainMessage(PROC_START_TIMEOUT_MSG);
                    msg.obj = app;
                    //延迟发送消息PROC_START_TIMEOUT_MSG
                    mHandler.sendMessageDelayed(msg, startResult.usingWrapper
                            ? PROC_START_TIMEOUT_WITH_WRAPPER : PROC_START_TIMEOUT);
                }
            }
        } catch (RuntimeException e) {
            //进程创建失败
            app.setPid(0);
            mBatteryStatsService.noteProcessFinish(app.processName, app.info.uid);
            if (app.isolated) {
                mBatteryStatsService.removeIsolatedUid(app.uid, app.info.uid);
            }
        }
    }

关于**Process.start()**是通过socket通信，告知[Zygote](http://www.yuanhh.com/22016/02/13/android-zygote/)创建fork子进程，创建完新进程，将ActivityThread类加载到新进程，并调用ActivityThread.main()方法。



### 8. ActivityThread

**[8-1]**

    public static void main(String[] args) {
        //性能统计默认是关闭的
        SamplingProfilerIntegration.start();
        CloseGuard.setEnabled(false);
        Environment.initForCurrentUser();
        EventLogger.setReporter(new EventLoggingReporter());
        AndroidKeyStoreProvider.install();
        //确保可信任的CA证书存放在正确的位置
        final File configDir = Environment.getUserConfigDirectory(UserHandle.myUserId());
        TrustedCertificateStore.setDefaultUserDirectory(configDir);
        Process.setArgV0("<pre-initialized>");

        Looper.prepareMainLooper();
        //创建ActivityThread对象
        ActivityThread thread = new ActivityThread(); 
        //建立Binder通道 【见流程8-2】
        thread.attach(false);
        if (sMainThreadHandler == null) {
            sMainThreadHandler = thread.getHandler();
        }
        // 当设置为true时，可打开消息队列的debug log信息
        if (false) {
            Looper.myLooper().setMessageLogging(new LogPrinter(Log.DEBUG, "ActivityThread"));
        }
        Looper.loop(); //消息循环运行
        throw new RuntimeException("Main thread loop unexpectedly exited");
    }

此处的`mAppThread = new ApplicationThread()`；

**[8-2]**

ApplicationThread类也位于ActivityThread.java文件

    private void attach(boolean system) {
        sCurrentActivityThread = this;
        mSystemThread = system;
        if (!system) {
            ViewRootImpl.addFirstDrawHandler(new Runnable() {
                @Override
                public void run() {
                    ensureJitEnabled(); //开启虚拟机的jit即时编译功能
                }
            });
            android.ddm.DdmHandleAppName.setAppName("<pre-initialized>", UserHandle.myUserId());
            RuntimeInit.setApplicationObject(mAppThread.asBinder());
            //创建ActivityManagerProxy对象
            final IActivityManager mgr = ActivityManagerNative.getDefault();
            try {
                //调用基于IActivityManager接口的Binder通道【见流程9-1】
                mgr.attachApplication(mAppThread); 
            } catch (RemoteException ex) {
                // Ignore
            }

            //观察是否快接近heap的上限 
            BinderInternal.addGcWatcher(new Runnable() {
                @Override public void run() {
                    if (!mSomeActivitiesChanged) {
                        return;
                    }
                    Runtime runtime = Runtime.getRuntime();
                    long dalvikMax = runtime.maxMemory();
                    long dalvikUsed = runtime.totalMemory() - runtime.freeMemory();
                    if (dalvikUsed > ((3*dalvikMax)/4)) {
                        mSomeActivitiesChanged = false;
                        try {
                            mgr.releaseSomeActivities(mAppThread); //释放空间
                        } catch (RemoteException e) {
                        }
                    }
                }
            });
        } else {
            android.ddm.DdmHandleAppName.setAppName("system_process", UserHandle.myUserId());
            try {
                mInstrumentation = new Instrumentation();
                ContextImpl context = ContextImpl.createAppContext(
                        this, getSystemContext().mPackageInfo);
                mInitialApplication = context.mPackageInfo.makeApplication(true, null);
                mInitialApplication.onCreate();
            } catch (Exception e) {
                throw new RuntimeException("Unable to instantiate Application():" + e.toString(), e);
            }
        }
        //添加dropbox日志到libcore
        DropBox.setReporter(new DropBoxReporter());
        ViewRootImpl.addConfigCallback(new ComponentCallbacks2() {
            @Override
            public void onConfigurationChanged(Configuration newConfig) {
                synchronized (mResourcesManager) {
                    if (mResourcesManager.applyConfigurationToResourcesLocked(newConfig, null)) {
                        if (mPendingConfiguration == null ||
                                mPendingConfiguration.isOtherSeqNewer(newConfig)) {
                            mPendingConfiguration = newConfig;
                            sendMessage(H.CONFIGURATION_CHANGED, newConfig);
                        }
                    }
                }
            }
            @Override
            public void onLowMemory() {
            }
            @Override
            public void onTrimMemory(int level) {
            }
        });
    }


### 9. ActivityManagerProxy.attachApplication

**[9-1] ActivityManagerProxy.attachApplication**

    public void attachApplication(IApplicationThread app) throws RemoteException
    {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IActivityManager.descriptor);
        data.writeStrongBinder(app.asBinder());
        mRemote.transact(ATTACH_APPLICATION_TRANSACTION, data, reply, 0); 【见流程9-2】
        reply.readException();
        data.recycle();
        reply.recycle();
    }


**[9-2] ActivityManagerNative.onTransact**

    @Override
    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
            throws RemoteException {
        switch (code) {
        ...
         case ATTACH_APPLICATION_TRANSACTION: {
            data.enforceInterface(IActivityManager.descriptor);
            IApplicationThread app = ApplicationThreadNative.asInterface(
                    data.readStrongBinder());
            if (app != null) {
                attachApplication(app); //此处是ActivityManagerService类中的方法 【见流程9-3】
            }
            reply.writeNoException();
            return true;
        }
        }
    }

**[9-3] ActivityManagerService.attachApplication**

    @Override
    public final void attachApplication(IApplicationThread thread) {
        synchronized (this) {
            int callingPid = Binder.getCallingPid();
            final long origId = Binder.clearCallingIdentity();
            attachApplicationLocked(thread, callingPid); // 【见流程9-4】
            Binder.restoreCallingIdentity(origId);
        }
    }

**[9-4]**

    private final boolean attachApplicationLocked(IApplicationThread thread,
            int pid) {
        ProcessRecord app;
        if (pid != MY_PID && pid >= 0) {
            synchronized (mPidsSelfLocked) {
                app = mPidsSelfLocked.get(pid); // 根据pid获取 ProcessRecord
            }
        } else {
            app = null;
        }
        if (app == null) {
            //ProcessRecord为空，则杀掉该进程
            if (pid > 0 && pid != MY_PID) {
                Process.killProcessQuiet(pid);
            } else {
                try {
                    thread.scheduleExit();
                } catch (Exception e) {
                    // Ignore exceptions.
                }
            }
            return false;
        }
        //如果这个ProcessRecord附到上一个进程，则立刻清空
        if (app.thread != null) {
            handleAppDiedLocked(app, true, true);
        }

        final String processName = app.processName;
        try {
            AppDeathRecipient adr = new AppDeathRecipient(app, pid, thread);
            thread.asBinder().linkToDeath(adr, 0);//绑定死亡通知
            app.deathRecipient = adr;
        } catch (RemoteException e) {
            app.resetPackageList(mProcessStats);
            startProcessLocked(app, "link fail", processName); //重新启动进程
            return false;
        }

        app.makeActive(thread, mProcessStats);
        app.curAdj = app.setAdj = -100;
        app.curSchedGroup = app.setSchedGroup = Process.THREAD_GROUP_DEFAULT;
        app.forcingToForeground = null;
        // 更新前台进程
        updateProcessForegroundLocked(app, false, false);
        app.hasShownUi = false;
        app.debugging = false;
        app.cached = false;
        app.killedByAm = false;
        mHandler.removeMessages(PROC_START_TIMEOUT_MSG, app); //移除进程启动超时的消息
        boolean normalMode = mProcessesReady || isAllowedWhileBooting(app.info);
        List<ProviderInfo> providers = normalMode ? generateApplicationProvidersLocked(app) : null;
        
        try {
            int testMode = IApplicationThread.DEBUG_OFF;
            if (mDebugApp != null && mDebugApp.equals(processName)) {
                testMode = mWaitForDebugger
                    ? IApplicationThread.DEBUG_WAIT: IApplicationThread.DEBUG_ON;
                app.debugging = true;
                if (mDebugTransient) {
                    mDebugApp = mOrigDebugApp;
                    mWaitForDebugger = mOrigWaitForDebugger;
                }
            }
            String profileFile = app.instrumentationProfileFile;
            ParcelFileDescriptor profileFd = null;
            int samplingInterval = 0;
            boolean profileAutoStop = false;
            if (mProfileApp != null && mProfileApp.equals(processName)) {
                mProfileProc = app;
                profileFile = mProfileFile;
                profileFd = mProfileFd;
                samplingInterval = mSamplingInterval;
                profileAutoStop = mAutoStopProfiler;
            }
            boolean enableOpenGlTrace = false;
            if (mOpenGlTraceApp != null && mOpenGlTraceApp.equals(processName)) {
                enableOpenGlTrace = true;
                mOpenGlTraceApp = null;
            }

            boolean isRestrictedBackupMode = false;
            if (mBackupTarget != null && mBackupAppName.equals(processName)) {
                isRestrictedBackupMode = (mBackupTarget.backupMode == BackupRecord.RESTORE)
                        || (mBackupTarget.backupMode == BackupRecord.RESTORE_FULL)
                        || (mBackupTarget.backupMode == BackupRecord.BACKUP_FULL);
            }
            ensurePackageDexOpt(app.instrumentationInfo != null
                    ? app.instrumentationInfo.packageName
                    : app.info.packageName);
            if (app.instrumentationClass != null) {
                ensurePackageDexOpt(app.instrumentationClass.getPackageName());
            }
          
            ApplicationInfo appInfo = app.instrumentationInfo != null
                    ? app.instrumentationInfo : app.info;
            app.compat = compatibilityInfoForPackageLocked(appInfo);
            if (profileFd != null) {
                profileFd = profileFd.dup();
            }
            ProfilerInfo profilerInfo = profileFile == null ? null
                    : new ProfilerInfo(profileFile, profileFd, samplingInterval, profileAutoStop);
            // 绑定应用
            thread.bindApplication(processName, appInfo, providers, app.instrumentationClass,
                    profilerInfo, app.instrumentationArguments, app.instrumentationWatcher,
                    app.instrumentationUiAutomationConnection, testMode, enableOpenGlTrace,
                    isRestrictedBackupMode || !normalMode, app.persistent,
                    new Configuration(mConfiguration), app.compat,
                    getCommonServicesLocked(app.isolated),
                    mCoreSettingsObserver.getCoreSettingsLocked());
            //更新进程LRU队列
            updateLruProcessLocked(app, false, null);
            app.lastRequestedGc = app.lastLowMemory = SystemClock.uptimeMillis();
        } catch (Exception e) {
            //这里有很可能会导致进程无限重启
            app.resetPackageList(mProcessStats);
            app.unlinkDeathRecipient();
            startProcessLocked(app, "bind fail", processName);
            return false;
        }
        
        mPersistentStartingProcesses.remove(app);
        mProcessesOnHold.remove(app);
        boolean badApp = false;
        boolean didSomething = false;
        //检查最顶层可见的Activity是否等待在该进程中运行
        if (normalMode) {
            try {
                if (mStackSupervisor.attachApplicationLocked(app)) {
                    didSomething = true;
                }
            } catch (Exception e) {
                badApp = true;
            }
        }
        //寻找所有需要在该进程中运行的服务 【见流程10-1】
        if (!badApp) {
            try { 
                didSomething |= mServices.attachApplicationLocked(app, processName);
            } catch (Exception e) {
                badApp = true;
            }
        }
        //检查是否在这个进程中有下一个广播接收者
        if (!badApp && isPendingBroadcastProcessLocked(pid)) {
            try {
                didSomething |= sendPendingBroadcastsLocked(app);
            } catch (Exception e) {
                badApp = true;
            }
        }
        //检查是否在这个进程中有下一个backup代理
        if (!badApp && mBackupTarget != null && mBackupTarget.appInfo.uid == app.uid) {
            ensurePackageDexOpt(mBackupTarget.appInfo.packageName);
            try {
                thread.scheduleCreateBackupAgent(mBackupTarget.appInfo,
                        compatibilityInfoForPackageLocked(mBackupTarget.appInfo),
                        mBackupTarget.backupMode);
            } catch (Exception e) {
                badApp = true;
            }
        }
        if (badApp) { //杀掉bad应用
            app.kill("error during init", true);
            handleAppDiedLocked(app, false, true);
            return false;
        }
        if (!didSomething) {
            updateOomAdjLocked(); //更新adj的值
        }
        return true;
    }

### 10. ActiveServices

**[10-1]**

    boolean attachApplicationLocked(ProcessRecord proc, String processName)
            throws RemoteException {
        boolean didSomething = false;
        //启动mPendingServices队列中，等待在该进程启动的服务
        if (mPendingServices.size() > 0) {
            ServiceRecord sr = null;
            try {
                for (int i=0; i<mPendingServices.size(); i++) {
                    sr = mPendingServices.get(i);
                    if (proc != sr.isolatedProc && (proc.uid != sr.appInfo.uid
                            || !processName.equals(sr.processName))) {
                        continue;
                    }
                    mPendingServices.remove(i);
                    i--;
                    // 将当前服务的包信息加入到proc
                    proc.addPackage(sr.appInfo.packageName, sr.appInfo.versionCode,
                            mAm.mProcessStats);
                    // 启动服务，即将进入服务的生命周期 【见流程10-2】
                    realStartServiceLocked(sr, proc, sr.createdFromFg);
                    didSomething = true;
                }
            } catch (RemoteException e) {
                Slog.w(TAG, "Exception in new application when starting service "
                        + sr.shortName, e);
                throw e;
            }
        }
        // 对于正在等待重启并需要运行在该进程的服务，现在是启动它们的大好时机
        if (mRestartingServices.size() > 0) {
            ServiceRecord sr = null;
            for (int i=0; i<mRestartingServices.size(); i++) {
                sr = mRestartingServices.get(i);
                if (proc != sr.isolatedProc && (proc.uid != sr.appInfo.uid
                        || !processName.equals(sr.processName))) {
                    continue;
                }
                mAm.mHandler.removeCallbacks(sr.restarter);
                mAm.mHandler.post(sr.restarter);
            }
        }
        return didSomething;
    }

**[10-2]**

    private final void realStartServiceLocked(ServiceRecord r,
            ProcessRecord app, boolean execInFg) throws RemoteException {
        if (app.thread == null) {
            throw new RemoteException();
        }

        r.app = app;
        r.restartTime = r.lastActivity = SystemClock.uptimeMillis();
        final boolean newService = app.services.add(r);
        bumpServiceExecutingLocked(r, execInFg, "create");
        mAm.updateLruProcessLocked(app, false, null);
        mAm.updateOomAdjLocked();
        boolean created = false;
        try {
            synchronized (r.stats.getBatteryStats()) {
                r.stats.startLaunchedLocked();
            }
            mAm.ensurePackageDexOpt(r.serviceInfo.packageName);
            app.forceProcessStateUpTo(ActivityManager.PROCESS_STATE_SERVICE);
            //服务 进入 onCreate() 【见流程11】
            app.thread.scheduleCreateService(r, r.serviceInfo,
                    mAm.compatibilityInfoForPackageLocked(r.serviceInfo.applicationInfo),
                    app.repProcState);
            r.postNotification();
            created = true;
        } catch (DeadObjectException e) {
            mAm.appDiedLocked(app); //应用死亡处理
            throw e;
        } finally {
            if (!created) {
                final boolean inDestroying = mDestroyingServices.contains(r);
                serviceDoneExecutingLocked(r, inDestroying, inDestroying);
                if (newService) {
                    app.services.remove(r);
                    r.app = null;
                }
                //尝试重新启动服务
                if (!inDestroying) {
                    scheduleServiceRestartLocked(r, false);
                }
            }
        }
        requestServiceBindingsLocked(r, execInFg);
        updateServiceClientActivitiesLocked(app, null, true);
        // If the service is in the started state, and there are no
        // pending arguments, then fake up one so its onStartCommand() will
        // be called.
        if (r.startRequested && r.callStart && r.pendingStarts.size() == 0) {
            r.pendingStarts.add(new ServiceRecord.StartItem(r, false, r.makeNextStartId(),
                    null, null));
        }
        //服务 进入onStartCommand() 【见流程12-1】
        sendServiceArgsLocked(r, execInFg, true);
        if (r.delayed) {
            getServiceMap(r.userId).mDelayedStartList.remove(r);
            r.delayed = false;
        }
        if (r.delayedStop) {
            r.delayedStop = false;
            if (r.startRequested) {
                stopServiceLocked(r); //停止服务
            }
        }
    }

### 11. scheduleCreateService

**[11-1] ApplicationThreadProxy.scheduleCreateService**

    public final void scheduleCreateService(IBinder token, ServiceInfo info,
            CompatibilityInfo compatInfo, int processState) throws RemoteException {
        Parcel data = Parcel.obtain();
        data.writeInterfaceToken(IApplicationThread.descriptor);
        data.writeStrongBinder(token);
        info.writeToParcel(data, 0);
        compatInfo.writeToParcel(data, 0);
        data.writeInt(processState);
        try {
            //【见流程11-2】
            mRemote.transact(SCHEDULE_CREATE_SERVICE_TRANSACTION, data, null, IBinder.FLAG_ONEWAY);
        } catch (TransactionTooLargeException e) {
            throw e;
        }
        data.recycle();
    }

**[11-2] ApplicationThreadNative.onTransact**

    public boolean onTransact(int code, Parcel data, Parcel reply, int flags)
            throws RemoteException {
        switch (code) {
        case SCHEDULE_CREATE_SERVICE_TRANSACTION: {
            data.enforceInterface(IApplicationThread.descriptor);
            IBinder token = data.readStrongBinder();
            ServiceInfo info = ServiceInfo.CREATOR.createFromParcel(data);
            CompatibilityInfo compatInfo = CompatibilityInfo.CREATOR.createFromParcel(data);
            int processState = data.readInt();
            // 【见流程11-3】
            scheduleCreateService(token, info, compatInfo, processState);
            return true;
        }
    }

**[11-3] ApplicationThread.scheduleCreateService**

位于ActivityThread

    public final void scheduleCreateService(IBinder token,
                ServiceInfo info, CompatibilityInfo compatInfo, int processState) {
        updateProcessState(processState, false);
        CreateServiceData s = new CreateServiceData(); //准备服务创建所需的数据
        s.token = token;
        s.info = info;
        s.compatInfo = compatInfo;
        sendMessage(H.CREATE_SERVICE, s); //发送消息 【见流程12-1】
    }

### 12. ActivityThread

**[12-1] ActivityThread.H**

    public void handleMessage(Message msg) {
        switch (msg.what) {
            ...

            case CREATE_SERVICE:
                handleCreateService((CreateServiceData)msg.obj); 【见流程12-2】
                break;
            case BIND_SERVICE:
                handleBindService((BindServiceData)msg.obj);
                break;
            case UNBIND_SERVICE:
                handleUnbindService((BindServiceData)msg.obj);
                break;
            case SERVICE_ARGS: 
                handleServiceArgs((ServiceArgsData)msg.obj);  // serviceStart
                break;
            case STOP_SERVICE:
                handleStopService((IBinder)msg.obj);
                maybeSnapshot();
                break;
        }
    }

**[12-2]**

    private void handleCreateService(CreateServiceData data) {
        //当应用处于后台即将进行GC，而此时被调回到活动状态，则跳过本次gc。
        unscheduleGcIdler();
        //生成服务对象
        LoadedApk packageInfo = getPackageInfoNoCheck(data.info.applicationInfo, data.compatInfo);
        Service service = null;
        try {
            java.lang.ClassLoader cl = packageInfo.getClassLoader();
            //
            service = (Service) cl.loadClass(data.info.name).newInstance();
        } catch (Exception e) {
            if (!mInstrumentation.onException(service, e)) {
                throw new RuntimeException(
                    "Unable to instantiate service " + data.info.name + ": " + e.toString(), e);
            }
        }
        try {
            //创建ContextImpl对象
            ContextImpl context = ContextImpl.createAppContext(this, packageInfo);
            context.setOuterContext(service);
            Application app = packageInfo.makeApplication(false, mInstrumentation);
            service.attach(context, this, data.info.name, data.token, app,
                    ActivityManagerNative.getDefault());
            service.onCreate(); //调用服务的 onCreate()方法 【见流程13】
            mServices.put(data.token, service);
            try {
                ActivityManagerNative.getDefault().serviceDoneExecuting(
                        data.token, SERVICE_DONE_EXECUTING_ANON, 0, 0);
            } catch (RemoteException e) {
                // nothing to do.
            }
        } catch (Exception e) {
            if (!mInstrumentation.onException(service, e)) {
                throw new RuntimeException(
                    "Unable to create service " + data.info.name
                    + ": " + e.toString(), e);
            }
        }
    }

### 13. Service

    public abstract class Service extends ContextWrapper implements ComponentCallbacks2 {
        public void onCreate(){	}
    }

最终调用到抽象类Service.onCreate()方法，对于真正的Service都会通过覆写该方式，调用真正的onCreate()方法。拨云见日，到此总算是进入了Service的生命周期。


### 总结

在整个startService过程，从进程角度来说，流程如下图：

![start_service_process](/images/android-service/start_service/start_service_process.png)

Process A进程：是指调用startService指令所在的进程，也就是启动服务的发起端进程；system_server进程是Android的系统进程，里面有一个线程叫ActivityManager的线程，主要运行ActivityManagerService相关的服务；Zygote进程，这是由init进程孵化而来的，用于创建Java层进程的母体，所有的Java层进程都是由Zygote进程孵化而来；RemoteService进程便是由Zygote进程孵化而来的用于运行Remote服务的进程，即startService所发起的进程。在图中涉及3次进程/线程间的通信方式，Binder方式、Socket方式以及Handler方式，分别用3种不同的颜色来代表3种通信方式在启动服务过程的整个流程所在环节。一般来说，进程内的线程间通信更多的是采用handler（消息队列）的方式来通信，而进程间的通信更多的是采用binder机制，对于Zygote则是采用Socket的通信方式。

如果读者进一步，深入了解Binder和handler背后的原理，可查看[Binder系列](http://www.yuanhh.com/2015/10/31/binder-prepare/)文章，该系列从Android 6.0的源码为基础，展开地深入分析，该系统共有10篇文章。对于handler，可查看- [Android消息机制-Handler(上篇)](http://www.yuanhh.com/2015/12/26/handler-message/)、[Handler(中篇)](http://www.yuanhh.com/2015/12/27/handler-message-2/)、[Handler(下篇)](http://www.yuanhh.com/2016/01/01/handler-message-3/)共3篇文章。

----------

如果觉得本文对您有所帮助，请关注我的**微信公众号：gityuan**， **[微博：Gityuan](http://weibo.com/gityuan)**。 或者[点击这里查看更多关于我的信息](http://www.yuanhh.com/about/)
