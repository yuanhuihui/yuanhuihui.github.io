

--------------------

## 杀进程方式

	Process.killProcess(int pid)；
	kill -9 <pid>  //可杀任何指定的进程
	am kill  <PACKAGE>  //当该应用处于后台时才能被杀掉




### 1.killBackgroundProcesses

	am kill  <PACKAGE>
	↓
	AMS.killBackgroundProcesses(final String packageName, int userId)
	↓
	AMS.killPackageProcessesLocked(packageName, appId, userId,
	                        ProcessList.SERVICE_ADJ, false, true, true, false, "kill background");
	↓
		AMS.removeProcessLocked
			ProcessRecord.kill()
				Process.killProcessQuiet(pid);
					Process.sendSignalQuiet(pid, SIGNAL_KILL);
						android_util_Process.android_os_Process_SendSignalQuiet
							Signal.kill(pid, SIGNAL_KILL)

				Process.killProcessGroup(info.uid, pid);
					android_util_Process.android_os_Process_killProcessGroup
						ProcessGroup.KillProcessGroup(uid, pid, SIGNAL_KILL)
							ProcessGroup.killProcessGroupOnce()
								loop: Signal.kill(pid, SIGNAL_KILL)

			AMS.handleAppDiedLocked()
				AMS.cleanUpApplicationRecordLocked()
					ActiveServices.killServicesLocked()
		updateOomAdjLocked

/acct/uid_<uid>/pid_<pid>/cgroup.procs



## 流程分析

### 1. killBackgroundProcesses

[-> ActivityManagerService.java]

    @Override
    public void killBackgroundProcesses(final String packageName, int userId) {
        if (checkCallingPermission(android.Manifest.permission.KILL_BACKGROUND_PROCESSES)
                != PackageManager.PERMISSION_GRANTED &&
                checkCallingPermission(android.Manifest.permission.RESTART_PACKAGES)
                        != PackageManager.PERMISSION_GRANTED) {
            //权限不足时抛出异常
            throw new SecurityException(msg);
        }

        userId = handleIncomingUser(Binder.getCallingPid(), Binder.getCallingUid(),
                userId, true, ALLOW_FULL_ONLY, "killBackgroundProcesses", null);
        //执行到这里，说明调用方的权限验证已通过，接下来清空远程调用端的uid和pid，用当前本地进程的uid和pid替代。
        long callingId = Binder.clearCallingIdentity();
        try {
            IPackageManager pm = AppGlobals.getPackageManager();
            synchronized(this) {
                int appId = -1;
                try {
                    appId = UserHandle.getAppId(pm.getPackageUid(packageName, 0));
                } catch (RemoteException e) {
                }

                //packageName是无效包名，直接返回
                if (appId == -1) {
                    return;
                }
                【2】
                killPackageProcessesLocked(packageName, appId, userId,
                        ProcessList.SERVICE_ADJ, false, true, true, false, "kill background");
            }
        } finally {
            //恢复远程调用端的uid和pid信息，正好是`clearCallingIdentity`的反过程
            Binder.restoreCallingIdentity(callingId);
        }
    }


### 2. killPackageProcessesLocked

[-> ActivityManagerService.java]

minOomAdj=SERVICE_ADJ, callerWillRestart=false, allowRestart=true, doit=true, evenPersistent=false, reason="kill background"

    private final boolean killPackageProcessesLocked(String packageName, int appId,
            int userId, int minOomAdj, boolean callerWillRestart, boolean allowRestart,
            boolean doit, boolean evenPersistent, String reason) {
        ArrayList<ProcessRecord> procs = new ArrayList<>();

        //
        final int NP = mProcessNames.getMap().size();
        for (int ip=0; ip<NP; ip++) {
            SparseArray<ProcessRecord> apps = mProcessNames.getMap().valueAt(ip);
            final int NA = apps.size();
            for (int ia=0; ia<NA; ia++) {
                ProcessRecord app = apps.valueAt(ia);
                //对于persistent进程，则直接跳过
                if (app.persistent && !evenPersistent) {
                    continue;
                }
                if (app.removed) {
                    if (doit) {
                        procs.add(app);
                    }
                    continue;
                }

                //对于adj低于SERVICE_ADJ(服务进程)则直接跳过
                if (app.setAdj < minOomAdj) {
                    continue;
                }

                //对于没有指定包名时，调用所有进程
                if (packageName == null) {
                    if (userId != UserHandle.USER_ALL && app.userId != userId) {
                        continue;
                    }
                    if (appId >= 0 && UserHandle.getAppId(app.uid) != appId) {
                        continue;
                    }
                } else {
                    final boolean isDep = app.pkgDeps != null
                            && app.pkgDeps.contains(packageName);
                    if (!isDep && UserHandle.getAppId(app.uid) != appId) {
                        continue;
                    }
                    if (userId != UserHandle.USER_ALL && app.userId != userId) {
                        continue;
                    }
                    if (!app.pkgList.containsKey(packageName) && !isDep) {
                        continue;
                    }
                }

                // Process has passed all conditions, kill it!
                if (!doit) {
                    return true;
                }
                app.removed = true;
                procs.add(app);
            }
        }

        int N = procs.size();
        for (int i=0; i<N; i++) {
            removeProcessLocked(procs.get(i), callerWillRestart, allowRestart, reason);
        }
        updateOomAdjLocked();
        return N > 0;
    }


















### killAllBackgroundProcesses

	am kill-all

原理与killBackgroundProcesses接近，不同的是会杀掉所有的后台进程

### forceStopPackage

AMS.forceStopPackage

	pm.setPackageStoppedState(packageName, true, user);
	AMS.forceStopPackageLocked
		AMS.killPackageProcessesLocked
