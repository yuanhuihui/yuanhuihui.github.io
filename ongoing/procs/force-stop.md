---
layout: post
title:  "force-stop分析"
date:   2016-05-31 20:30:00
catalog:  true
tags:
    - android

---

## 一.概述

    am force-stop pkgName  杀掉各个用户空间的app进程
    am force-stop --user 999 pkgName 杀掉指定用户空间的app进程


## 二. 流程分析

### 2.1 AMS.forceStopPackage

		public void forceStopPackage(final String packageName, int userId) {
				if (checkCallingPermission(android.Manifest.permission.FORCE_STOP_PACKAGES)
								!= PackageManager.PERMISSION_GRANTED) {
						//需要权限permission.FORCE_STOP_PACKAGES
						throw new SecurityException();
				}
				final int callingPid = Binder.getCallingPid();
				userId = handleIncomingUser(callingPid, Binder.getCallingUid(),
								userId, true, ALLOW_FULL_ONLY, "forceStopPackage", null);
				long callingId = Binder.clearCallingIdentity();
				try {
						IPackageManager pm = AppGlobals.getPackageManager();
						synchronized(this) {
								int[] users = userId == UserHandle.USER_ALL
												? getUsersLocked() : new int[] { userId };
								for (int user : users) {
										int pkgUid = -1;
										pkgUid = pm.getPackageUid(packageName, user);
										//设置应用包的状态
										pm.setPackageStoppedState(packageName, true, user);

										if (isUserRunningLocked(user, false)) {
												//【见流程2.2】
												forceStopPackageLocked(packageName, pkgUid, "from pid " + callingPid);
										}
								}
						}
				} finally {
						Binder.restoreCallingIdentity(callingId);
				}
		}
    
### 2.2 AMS.forceStopPackageLocked

		private void forceStopPackageLocked(final String packageName, int uid, String reason) {
				forceStopPackageLocked(packageName, UserHandle.getAppId(uid), false,
								false, true, false, false, UserHandle.getUserId(uid), reason);
				Intent intent = new Intent(Intent.ACTION_PACKAGE_RESTARTED,
								Uri.fromParts("package", packageName, null));
				//系统启动完毕后,则mProcessesReady=true
				if (!mProcessesReady) {
						intent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY
										| Intent.FLAG_RECEIVER_FOREGROUND);
				}
				intent.putExtra(Intent.EXTRA_UID, uid);
				intent.putExtra(Intent.EXTRA_USER_HANDLE, UserHandle.getUserId(uid));
				broadcastIntentLocked(null, null, intent,
								null, null, 0, null, null, null, AppOpsManager.OP_NONE,
								null, false, false, MY_PID, Process.SYSTEM_UID, UserHandle.getUserId(uid));
		}
