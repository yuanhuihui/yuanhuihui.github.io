---
layout: post
title:  "PMS基础篇"
date:   2016-10-02 20:09:12
catalog:  true
tags:
    - android

---

	frameworks/base/services/core/java/com/android/server/pm/PackageManagerService.java
	frameworks/base/core/java/android/content/pm/PackageManager.java

	frameworks/base/core/android/java/content/pm/IPackageManager.aidl
	frameworks/base/core/java/android/content/pm/PackageParser.java

	frameworks/base/cmds/pm/src/com/android/commands/pm/Pm.java

## 一.概述

PackageManagerService(简称PMS)，是Android系统核心服务之一，管理着所有跟package相关的工作，比如安装、卸载应用。

IPackageManager.aidl由工具转换后自动生成binder的服务端IPackageManager.Stub和客户端IPackageManager.Stub.Proxy。

- Binder服务端：PackageManagerService继承于IPackageManager.Stub；
- Binder客户端：ApplicationPackageManager的成员变量mPM继承于IPackageManager.Stub.Proxy；


	PackageManagerService extends IPackageManager.Stub
	ApplicationPackageManager extends PackageManager
	PackageManager
	
## 二. 源码

### 2.1 CI.getPackageManager

[-> ContextImpl.java]

		public PackageManager getPackageManager() {
				if (mPackageManager != null) {
						return mPackageManager;
				}

				IPackageManager pm = ActivityThread.getPackageManager();
				if (pm != null) {
						// Doesn't matter if we make more than one instance.
						return (mPackageManager = new ApplicationPackageManager(this, pm));
				}

				return null;
		}

mSettings.addSharedUserLPw
