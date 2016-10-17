---
layout: post
title:  "多用户管理之UserManager"
date:   2016-09-04 11:30:00
catalog:  true
tags:
    - android

---

	framework/base/services/core/java/com/android/server/pm/UserManagerService.java
	framework/base/core/java/android/os/UserManager.java
	
	framework/base/core/java/android/content/pm/UserInfo.java
	framework/base/core/java/android/os/UserHandle.java
	
## 一.概述

Android多用户模型，通过UserManagerService(以下简称为UMS)对多用户进行创建、删除、查询等管理操作。

- Binder服务端：UserManagerService继承于IUserManager.Stub，作为binder服务端；
- Binder客户端：UserManager的成员变量mService继承于IUserManager.Stub.Proxy，该变量作为binder客户端。UserManager的大部分核心工作都是交由其成员变量mService，再通过binder调用到UserManagerService所相应的方法。

mService具体的赋值过程，位于UserManager.java 如下：

		public synchronized static UserManager get(Context context) {
				 if (sInstance == null) {
						 sInstance = (UserManager) context.getSystemService(Context.USER_SERVICE);
				 }
				 return sInstance;
		}
 
## 二. 流程

### 2.1 启动阶段

[-> PackageManagerService.java]

		public PackageManagerService(...) {
				...
				sUserManager = new UserManagerService(context, this, mInstallLock, mPackages);
				...
		}

UMS是在PackageManagerService对象初始化的过程中创建

### 2.2 UserManagerService
[-> UserManagerService.java]

		UserManagerService(Context context, PackageManagerService pm,
						Object installLock, Object packagesLock) {
				this(context, pm, installLock, packagesLock,
								Environment.getDataDirectory(),
								new File(Environment.getDataDirectory(), "user"));
		}
		
dataDir一般为`/data`，baseUserPath则为`/data/user`，紧接着进入如下方法：

		private UserManagerService(Context context, PackageManagerService pm,
					 Object installLock, Object packagesLock,
					 File dataDir, File baseUserPath) {
			 mContext = context;
			 mPm = pm;
			 mInstallLock = installLock;
			 mPackagesLock = packagesLock;
			 mHandler = new MainHandler();
			 synchronized (mInstallLock) {
					 synchronized (mPackagesLock) {
 						   //创建目录/data/system/users
							 mUsersDir = new File(dataDir, USER_INFO_DIR);
							 mUsersDir.mkdirs();
							 //创建目录/data/system/users/0
							 File userZeroDir = new File(mUsersDir, "0");
							 userZeroDir.mkdirs();
							 FileUtils.setPermissions(mUsersDir.toString(),
											 FileUtils.S_IRWXU|FileUtils.S_IRWXG
											 |FileUtils.S_IROTH|FileUtils.S_IXOTH,
											 -1, -1);
							 //mUserListFile文件路径为/data/system/users/userlist.xml
							 mUserListFile = new File(mUsersDir, USER_LIST_FILENAME);
							 initDefaultGuestRestrictions();
							 //解析userlist.xml文件
							 readUserListLocked();
							 sInstance = this;
					 }
			 }
	 }
	 
其中MainHandler是用于处理消息WRITE_USER_MSG的Handler，UMS初始化过程的主要功能：

- 创建目录/data/system/users
- 创建目录/data/system/users/0
- 解析目录/data/system/users中的userlist.xml获取所有用户id，再分别解析该目录下id.xml(比如1.xml)，并创建相应的UserInfo对象

### UserInfo

UserInfo代表的是一个用户的信息，涉及到的flags及其含义，如下：

|flags|含义|
|---|---|
|FLAG_PRIMARY|主用户，只有一个user具有该标识|
|FLAG_ADMIN|具有管理特权的用户，例如创建或删除其他用户|
|FLAG_GUEST|访客用户，可能是临时的|
|FLAG_RESTRICTED|限制性用户，较普通用户具有更多限制，例如禁止安装app或者管理wifi等|
|FLAG_INITIALIZED|表明用户已初始化|
|FLAG_MANAGED_PROFILE|表明该用户是另一个用户的轮廓|
|FLAG_DISABLED|表明该用户处于不可用状态|

### UserHandle

UserHandle代表的是设备用户

|user id|取值|含义|
|---|---|---|
|USER_ALL|-1|设备上所有的用户
|USER_CURRENT|-2| 当前活动的用户
|USER_CURRENT_OR_SELF|-3| 当前用户或者调用者所在用户
|USER_NULL|-1000|未定义的用户
|USER_OWNER|0|拥有者用户|

- PER_USER_RANGE = 100000，是指每个用户可使用uids区间为100000.
- APPLICATION_UID区间为[10000，19999]
- IISOLATED_UID区间为[99000，99999]
