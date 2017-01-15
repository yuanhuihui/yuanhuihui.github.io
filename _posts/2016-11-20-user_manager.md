---
layout: post
title:  "多用户管理UserManager"
date:   2016-11-20 11:31:00
catalog:  true
tags:
    - android

---

> 基于Android 6.0的源码剖析多用户模型

    framework/base/services/core/java/com/android/server/pm/UserManagerService.java
    framework/base/core/java/android/os/UserManager.java
    framework/base/core/java/android/content/pm/UserInfo.java
    framework/base/core/java/android/os/UserHandle.java

## 一.概述

Android多用户模型，通过UserManagerService(以下简称为UMS)对多用户进行创建、删除、查询等管理操作。

- Binder服务端：UserManagerService继承于IUserManager.Stub，作为binder服务端；
- Binder客户端：UserManager的成员变量mService继承于IUserManager.Stub.Proxy，该变量作为binder客户端。UserManager的大部分核心工作都是交由其成员变量mService，再通过binder调用到UserManagerService所相应的方法。
 
### 1.1 概念
 
先来介绍userId, uid, appId，SharedAppGid这几个概念的关系
 
- userId：是指用户Id；
- appId： 是指跟用户空间无关的应用程序id；取值范围 0<= appId <100000
- uid:是指跟用户空间紧密相关的应用程序id;
- SharedAppGid:是指可共享的应用id；

转换关系：

    uid = userId * 100000  + appId
    SharedAppGid = 40000   + appId
 
另外，PER_USER_RANGE = 100000， 意味着每个user空间最大可以有100000个appid。这些区间分布如下：

- system appid:     [1000, 9999]
- application appid:[10000, 19999]
- Shared AppGid:    [50000, 59999]
- isolated appid:   [99000, 99999]

### 1.2 UserHandle

常见方法：

|方法|含义|
|---|---|
|isSameUser|比较两个uid的userId是否相同|
|isSameApp|比较两个uid的appId是否相同|
|isApp|appId是否属于区间[10000,19999]|
|isIsolated|appId是否属于区间[99000,99999]|
|getIdentifier|获取UserHandle所对应的userId|

常见成员变量：(UserHandle的成员变量mHandle便是userId)

|userId|赋值|含义|
|---|---|---
|USER_OWNER|0|拥有者|
|USER_ALL|-1|所有用户
|USER_CURRENT|-2|当前活动用户
|USER_CURRENT_OR_SELF|-3|当前用户或者调用者所在用户
|USER_NULL|-1000|未定义用户

类成员变量：

    UserHandle OWNER = new UserHandle(USER_OWNER); // 0
    UserHandle ALL = new UserHandle(USER_ALL); // -1
    UserHandle CURRENT = new UserHandle(USER_CURRENT); // -2
    UserHandle CURRENT_OR_SELF = new UserHandle(USER_CURRENT_OR_SELF); // -3
    
关于UID默认情况下，客户端可使用rocess.myUserHandle()； 服务端可使用UserHandle.getCallingUserId();

### 1.3 解析UID
执行`adb shell ps`命令输出当前系统所有进程信息，以下列举部分进程，其中第一列代表的是当前进程
所属的UID。

    USER      PID   PPID  VSIZE  RSS   WCHAN              PC  NAME
    root      1     0     2108   1068  SyS_epoll_ 0000000000 S /init
    root      2     0     0      0       kthreadd 0000000000 S kthreadd
    root      275   1     13276  1640  hrtimer_na 0000000000 S /system/bin/vold
    root      319   1     4148   904   SyS_epoll_ 0000000000 S /system/bin/lmkd
    system    320   1     3848   1072  binder_thr 0000000000 S /system/bin/servicemanager
    system    321   1     138396 10324 SyS_epoll_ 0000000000 S /system/bin/surfaceflinger
    root      331   1     4472   792   __skb_recv 0000000000 S /system/bin/debuggerd64
    radio     333   1     71240  4928  hrtimer_na 0000000000 S /system/bin/rild
    drm       334   1     20128  2048  binder_thr 0000000000 S /system/bin/drmserver
    media     336   1     122404 9536  binder_thr 0000000000 S /system/bin/mediaserver
    root      338   1     3880   736   unix_strea 0000000000 S /system/bin/installd
    root      359   1     1670784 40732 poll_sched 0000000000 S zygote64
    system    1586  359   1880668 134868 SyS_epoll_ 0000000000 S system_server
    radio     3341  359   1371948 55264 SyS_epoll_ 0000000000 S com.android.phone
    media_rw  3409  275   19676  13828 inotify_re 0000000000 S /system/bin/sdcard
    u0_a23    4152  359   1301552 27184 SyS_epoll_ 0000000000 S com.android.incallui
    u0_a89    10920 360   1118036 129224 SyS_epoll_ 0000000000 S com.tencent.mobileqq
    u0_a94    15481 360   939456 52004 SyS_epoll_ 0000000000 S com.sina.weibo
    ..

可以看到UID有root, system,radio,media等都属于系统uid定义在在Process.java文件，如下：

|uid|值|含义|
|---|---|---|
|ROOT_UID|0|root uid|
|SYSTEM_UID|1000|用于systemserver进程|
|PHONE_UID|1001|telephony所属的uid|
|BLUETOOTH_UID|1002|蓝牙所属的uid
|LOG_UID|1007|log所属的uid
|WIFI_UID|1008|
|MEDIA_UID|1013|用于mediaserver进程|
|VPN_UID|1016|
|DRM_UID|1019|
|MEDIA_RW_GID|1023|具有写内部媒体存储权限的uid
|NFC_UID|1027|
|PACKAGE_INFO_GID|1032|
|SHARED_RELRO_UID|1037|
|SHELL_UID|2000|shell uid|
|SHARED_USER_GID|9997|

除了系统UID，还有另一类普通的应用uid，命令以u开头，代表的是普通app的uid，例如u0_a94代表的是uid=10094，
这个转换过程，见UserHandle.java的formatUid()方法：

    public static void formatUid(StringBuilder sb, int uid) {
         if (uid < Process.FIRST_APPLICATION_UID) {
             sb.append(uid);
         } else {
             sb.append('u');
             sb.append(getUserId(uid));
             final int appId = getAppId(uid);
             if (appId >= Process.FIRST_ISOLATED_UID && appId <= Process.LAST_ISOLATED_UID) {
                 sb.append('i');
                 sb.append(appId - Process.FIRST_ISOLATED_UID);
             } else if (appId >= Process.FIRST_APPLICATION_UID) {
                 sb.append('a');
                 sb.append(appId - Process.FIRST_APPLICATION_UID);
             } else {
                 sb.append('s');
                 sb.append(appId);
             }
         }
     }

举例说明：

    u0i20 = 0 * 100000 + (99000 + 20) = 99020    
    u1a30 = 1 * 100000 + (10000 + 30) = 110030    
    u2s1001 = 2 * 100000 +      1001  = 201001  

### 1.4 UserInfo

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


### 1.5 UserState 

    //用户启动中
    public final static int STATE_BOOTING = 0;
    //用户正常运行状态
    public final static int STATE_RUNNING = 1;
    //用户正在停止中
    public final static int STATE_STOPPING = 2;
    //用户处于关闭状态
    public final static int STATE_SHUTDOWN = 3;
    
用户生命周期线： 

    STATE_BOOTING -> STATE_RUNNING -> STATE_STOPPING -> STATE_SHUTDOWN.
    
可通过AMS.switchUser()来切换用户，并更新mCurrentUserId为新切换的用户。


## 二. 流程

### 2.1 启动阶段
[-> PackageManagerService.java]

    public PackageManagerService(...) {
        ...
        //【见小节2.2】
        sUserManager = new UserManagerService(context, this, mInstallLock, mPackages);
        ...
    }

UMS是在PackageManagerService对象初始化的过程中创建。

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

## 三. userId的用处

### 3.1 客户端(ContextImpl)

**Service**

    public boolean bindService(Intent service, ServiceConnection conn,
            int flags) {
        warnIfCallingFromSystemProcess();
        //此处Process.myUserHandle获取的是获取当前进程uid所属的userId来创建UserHandle对象。
        return bindServiceCommon(service, conn, flags, Process.myUserHandle());
    }

    public ComponentName startService(Intent service) {
        warnIfCallingFromSystemProcess();
        //mUser也是通过Process.myUserHandle()方法获取
        return startServiceCommon(service, mUser);
    }

**Broadcast**

    public void sendBroadcast(Intent intent) {
        warnIfCallingFromSystemProcess();
        String resolvedType = intent.resolveTypeIfNeeded(getContentResolver());
        try {
            intent.prepareToLeaveProcess();
            ActivityManagerNative.getDefault().broadcastIntent(
                    mMainThread.getApplicationThread(), intent, resolvedType, null,
                    Activity.RESULT_OK, null, null, null, AppOpsManager.OP_NONE, null, false, false,
                    getUserId());
        } catch (RemoteException e) {
            throw new RuntimeException("Failure from system", e);
        }
    }

无论是广播，服务，Activity，在没有指定UserId的情况下，都采用默认的当前进程uid所对应的userId。

### 3.2 服务端(AMS)
广播，服务，Activity启动的过程，经过Binder进入system_server进程，则都会会采用如下方法将userId进行转换：

    int handleIncomingUser(int callingPid, int callingUid, int userId, boolean allowAll,
            int allowMode, String name, String callerPackage) {
        final int callingUserId = UserHandle.getUserId(callingUid);
        if (callingUserId == userId) {
            return userId;
        }
        
        // userId转换【见下文】
        int targetUserId = unsafeConvertIncomingUser(userId);

        if (callingUid != 0 && callingUid != Process.SYSTEM_UID) {
            final boolean allow;
            ... //对于非system uid，则会进行各种权限检查。
        }
        
        if (!allowAll && targetUserId < 0) {
            throw new IllegalArgumentException(...);
        }
        
        //检查shell权限
        if (callingUid == Process.SHELL_UID && targetUserId >= UserHandle.USER_OWNER) {
            if (mUserManager.hasUserRestriction(UserManager.DISALLOW_DEBUGGING_FEATURES,
                    targetUserId)) {
                throw new SecurityException(...);
            }
        }
        return targetUserId;
    }
    
    int unsafeConvertIncomingUser(int userId) {
        return (userId == UserHandle.USER_CURRENT || userId == UserHandle.USER_CURRENT_OR_SELF)
                ? mCurrentUserId : userId;
    }

该方法主要功能：

1. 当调用者userId等于userId时，则直接返回该userId；否则往下执行；
2. 当USER_CURRENT或USER_CURRENT_OR_SELF类型的userId，则返回mCurrentUserId；否则继续采用userId；
3. 对于非system uid，则会进行各种权限检查。
