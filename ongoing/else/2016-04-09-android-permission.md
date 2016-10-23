---
layout: post
title:  "谈谈Android Permission"
date:   2016-03-26 21:10:11
categories: android process
excerpt:  谈谈Android Permission
---

* content
{:toc}

---

> 基于Android 6.0的源码剖析， 谈谈Android Permission


### 2. checkCallingPermission

[-> ActivityManagerService.java]

    int checkCallingPermission(String permission) {
        //Binder.getCallingPid()获取调用方的pid
        //Binder.getCallingUid()获取调用方的uid
        return checkPermission(permission,
                Binder.getCallingPid(),
                UserHandle.getAppId(Binder.getCallingUid())); 【2-1】
    }

###【2-1】checkPermission

[-> ActivityManagerService.java]

    public int checkPermission(String permission, int pid, int uid) {
        if (permission == null) {
            return PackageManager.PERMISSION_DENIED;
        }
        return checkComponentPermission(permission, pid, uid, -1, true); 【2-1-1】
    }

### 【2-1-1】checkComponentPermission

[-> ActivityManagerService.java]

    int checkComponentPermission(String permission, int pid, int uid,
            int owningUid, boolean exported) {
        //对于pid为system_server进程pid，则默认成功授权
        if (pid == MY_PID) {
            return PackageManager.PERMISSION_GRANTED;
        }
        return ActivityManager.checkComponentPermission(permission, uid,
                owningUid, exported);  【2-1-1-1】
    }

###【2-1-1-1】checkComponentPermission

[-> ActivityManager.java]

    public static int checkComponentPermission(String permission, int uid,
            int owningUid, boolean exported) {
        //对于uid为Root或system server，则默认成功授权
        final int appId = UserHandle.getAppId(uid);
        if (appId == Process.ROOT_UID || appId == Process.SYSTEM_UID) {
            return PackageManager.PERMISSION_GRANTED;
        }
        //对于孤立进程，则默认授权失败
        if (UserHandle.isIsolated(uid)) {
            return PackageManager.PERMISSION_DENIED;
        }
        //当拥有者uid与调用方的uid相同时（此处相同是uid取模100000后相同，涉及多用户模型，先不展开讲），则授权成功
        if (owningUid >= 0 && UserHandle.isSameApp(uid, owningUid)) {
            return PackageManager.PERMISSION_GRANTED;
        }
        //当目标没有暴露，即exported=false时，则表示授权失败
        if (!exported) {
            return PackageManager.PERMISSION_DENIED;
        }
        //当权限为空，无需授权，则表示授权成功
        if (permission == null) {
            return PackageManager.PERMISSION_GRANTED;
        }
        try {
            //
            return AppGlobals.getPackageManager()
                    .checkUidPermission(permission, uid); 【2-1-1-1-1】
        } catch (RemoteException e) {
            //不应该此处，进入这可能是PackageManager挂了
        }
        return PackageManager.PERMISSION_DENIED;
    }

###【2-1-1-1-1】checkUidPermission

[-> AppGlobals.java]

    public static IPackageManager getPackageManager() {
        return ActivityThread.getPackageManager();
    }

[-> ActivityThread.java]

    public static IPackageManager getPackageManager() {
        if (sPackageManager != null) {
            return sPackageManager;
        }
        IBinder b = ServiceManager.getService("package");
        sPackageManager = IPackageManager.Stub.asInterface(b);
        return sPackageManager;
    }

AppGlobals.getPackageManager()采用单例模式，向ServiceManager管家查询名为"package"的服务，最后返回的IPackageManager，即binder通信的客户端，经过binder调用，最后交给PackageManagerService对象来完成。


[-> PackageManagerService.java]

    public int checkUidPermission(String permName, int uid) {
        //目前绝大多数的Android手机都是单用户模型，那么此时userId=0；
        final int userId = UserHandle.getUserId(uid);
        //当该userId不存在，则授权失败
        if (!sUserManager.exists(userId)) {
            return PackageManager.PERMISSION_DENIED;
        }

        synchronized (mPackages) {
            Object obj = mSettings.getUserIdLPr(UserHandle.getAppId(uid));
            if (obj != null) {
                final SettingBase ps = (SettingBase) obj;
                final PermissionsState permissionsState = ps.getPermissionsState();
                if (permissionsState.hasPermission(permName, userId)) {
                    return PackageManager.PERMISSION_GRANTED;
                }
                //特殊case: ACCESS_FINE_LOCATION权限包括ACCESS_COARSE_LOCATION
                if (Manifest.permission.ACCESS_COARSE_LOCATION.equals(permName) && permissionsState
                        .hasPermission(Manifest.permission.ACCESS_FINE_LOCATION, userId)) {
                    return PackageManager.PERMISSION_GRANTED;
                }
            } else {
                ArraySet<String> perms = mSystemPermissions.get(uid);
                if (perms != null) {
                    if (perms.contains(permName)) {
                        return PackageManager.PERMISSION_GRANTED;
                    }
                    if (Manifest.permission.ACCESS_COARSE_LOCATION.equals(permName) && perms
                            .contains(Manifest.permission.ACCESS_FINE_LOCATION)) {
                        return PackageManager.PERMISSION_GRANTED;
                    }
                }
            }
        }

        return PackageManager.PERMISSION_DENIED;
    }

对于uid和userId可能有不少人会搞混，简单说userId是针对Android系统而言，指当前手机(或其他Android设备)的使用者的id，目前绝大多数的手机是单用户模型，也就是userId=0。而uid是针对app而言，这是在apk首次安装时由PackageManagerService便设定好了。 appId = uid%100000;


权限检查结果有两种：

- PackageManager.PERMISSION_GRANTED //授权成功
- PackageManager.PERMISSION_DENIED  //授权失败

