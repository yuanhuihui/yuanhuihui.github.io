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
- Binder客户端：ApplicationPackageManager(简称APM)的成员变量`mPM`继承于IPackageManager.Stub.Proxy;
APM继承于PackageManager。

### 1.1 类图

## 二. 启动过程

    private void startBootstrapServices() {
        //启动installer服务【见小节三】
        Installer installer = mSystemServiceManager.startService(Installer.class);
        ...

        String cryptState = SystemProperties.get("vold.decrypt");
        if (ENCRYPTING_STATE.equals(cryptState)) {
            Slog.w(TAG, "Detected encryption in progress - only parsing core apps");
            mOnlyCore = true; //检测到加密过程，则仅仅解析核心应用
        } else if (ENCRYPTED_STATE.equals(cryptState)) {
            Slog.w(TAG, "Device encrypted - only parsing core apps");
            mOnlyCore = true; //加密设备，仅仅解析核心应用
        }
        //【见小节4.1】
        mPackageManagerService = PackageManagerService.main(mSystemContext, installer,
                    mFactoryTestMode != FactoryTest.FACTORY_TEST_OFF, mOnlyCore);
        mFirstBoot = mPackageManagerService.isFirstBoot();
        //【见小节4.3】
        mPackageManager = mSystemContext.getPackageManager();
        ...
    }

    private void startOtherServices() {
        ...
        //启动MountService, PKMS需要用到
        mSystemServiceManager.startService(MOUNT_SERVICE_CLASS);
        //【见小节4.5】
        mPackageManagerService.performBootDexOpt();
        ...  

        mSystemServiceManager.startBootPhase(SystemService.PHASE_SYSTEM_SERVICES_READY);// phase 500
        ...

        //
        mPackageManagerService.systemReady();
        ...
    }

- ENCRYPTING_STATE = "trigger_restart_min_framework"
- ENCRYPTED_STATE = "1"

## 三. 启动Installer

[-> Installer.java]

    public Installer(Context context) {
        super(context);
        //创建InstallerConnection对象
        mInstaller = new InstallerConnection();
    }

    public void onStart() {
      Slog.i(TAG, "Waiting for installd to be ready.");
      //【见小节3.1】
      mInstaller.waitForConnection();
    }

先创建Installer对象，再调用onStart()方法，该方法中主要工作是等待socket通道建立完成。

### 3.1 waitForConnection
[-> InstallerConnection.java]

    public void waitForConnection() {
        for (;;) {
            //【见小节3.2】
            if (execute("ping") >= 0) {
                return;
            }
            Slog.w(TAG, "installd not ready");
            SystemClock.sleep(1000);
        }
    }

通过循环地方式，每次休眠1s

### 3.2 execute
[-> InstallerConnection.java]

    public int execute(String cmd) {
        //【见小节3.3】
        String res = transact(cmd);
        try {
            return Integer.parseInt(res);
        } catch (NumberFormatException ex) {
            return -1;
        }
    }

### 3.3 transact
[-> InstallerConnection.java]

    public synchronized String transact(String cmd) {
        //【见小节3.3.1】
        if (!connect()) {
            return "-1";
        }

        //【见小节3.3.2】
        if (!writeCommand(cmd)) {
            if (!connect() || !writeCommand(cmd)) {
                return "-1";
            }
        }

        //读取应答消息【3.3.3】
        final int replyLength = readReply();
        if (replyLength > 0) {
            String s = new String(buf, 0, replyLength);
            return s;
        } else {
            return "-1";
        }
    }

#### 3.3.1 connect

    private boolean connect() {
        if (mSocket != null) {
            return true;
        }
        Slog.i(TAG, "connecting...");
        try {
            mSocket = new LocalSocket();

            LocalSocketAddress address = new LocalSocketAddress("installd",
                    LocalSocketAddress.Namespace.RESERVED);

            mSocket.connect(address);

            mIn = mSocket.getInputStream();
            mOut = mSocket.getOutputStream();
        } catch (IOException ex) {
            disconnect();
            return false;
        }
        return true;
    }

#### 3.3.2 writeCommand

    private boolean writeCommand(String cmdString) {
        final byte[] cmd = cmdString.getBytes();
        final int len = cmd.length;
        if ((len < 1) || (len > buf.length)) {
            return false;
        }

        buf[0] = (byte) (len & 0xff);
        buf[1] = (byte) ((len >> 8) & 0xff);
        try {
            mOut.write(buf, 0, 2); //写入长度
            mOut.write(cmd, 0, len); //写入具体命令
        } catch (IOException ex) {
            disconnect();
            return false;
        }
        return true;
    }

#### 3.3.3 readReply

    private int readReply() {
        //【见小节3.3.4】
        if (!readFully(buf, 2)) {
            return -1;
        }

        final int len = (((int) buf[0]) & 0xff) | ((((int) buf[1]) & 0xff) << 8);
        if ((len < 1) || (len > buf.length)) {
            disconnect();
            return -1;
        }

        if (!readFully(buf, len)) {
            return -1;
        }

        return len;
    }    

#### 3.3.4 readFully

    private boolean readFully(byte[] buffer, int len) {
         try {
             Streams.readFully(mIn, buffer, 0, len);
         } catch (IOException ioe) {
             disconnect();
             return false;
         }

         return true;
     }

 可见，一次transact过程为先connect()来判断是否建立socket连接，如果已连接则通过writeCommand()
 将命令写入socket的mOut管道，等待从管道的mIn中readFully()读取应答消息。

## 四. PackageManagerService

### 4.1 PKMS.main
[-> PackageManagerService.java]

    public static PackageManagerService main(Context context, Installer installer,
            boolean factoryTest, boolean onlyCore) {
        //初始化PKMS对象
        PackageManagerService m = new PackageManagerService(context, installer,
                factoryTest, onlyCore);
        //将package服务注册到ServiceManager
        ServiceManager.addService("package", m);
        return m;
    }

### 4.2 初始化PKMS


    public PackageManagerService(Context context, Installer installer,
            boolean factoryTest, boolean onlyCore) {
        EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_START,
                SystemClock.uptimeMillis());

        ...
        mLazyDexOpt = "eng".equals(SystemProperties.get("ro.build.type"));
        mMetrics = new DisplayMetrics();
        mSettings = new Settings(mPackages);

        mSettings.addSharedUserLPw("android.uid.system", Process.SYSTEM_UID,
                ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
        mSettings.addSharedUserLPw("android.uid.phone", RADIO_UID,
                ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
        mSettings.addSharedUserLPw("android.uid.log", LOG_UID,
                ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
        mSettings.addSharedUserLPw("android.uid.nfc", NFC_UID,
                ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
        mSettings.addSharedUserLPw("android.uid.bluetooth", BLUETOOTH_UID,
                ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);
        mSettings.addSharedUserLPw("android.uid.shell", SHELL_UID,
                ApplicationInfo.FLAG_SYSTEM, ApplicationInfo.PRIVATE_FLAG_PRIVILEGED);

        long dexOptLRUThresholdInMinutes;
        if (mLazyDexOpt) {
            dexOptLRUThresholdInMinutes = 30; // only last 30 minutes of apps for eng builds.
        } else {
            dexOptLRUThresholdInMinutes = 7 * 24 * 60; // apps used in the 7 days for users.
        }
        mDexOptLRUThresholdInMills = dexOptLRUThresholdInMinutes * 60 * 1000;
        ...

        mInstaller = installer;
        mPackageDexOptimizer = new PackageDexOptimizer(this);
        mMoveCallbacks = new MoveCallbacks(FgThread.get().getLooper());

        mOnPermissionChangeListeners = new OnPermissionChangeListeners(
                FgThread.get().getLooper());

        getDefaultDisplayMetrics(context, mMetrics);

        SystemConfig systemConfig = SystemConfig.getInstance();
        mGlobalGids = systemConfig.getGlobalGids();
        mSystemPermissions = systemConfig.getSystemPermissions();
        mAvailableFeatures = systemConfig.getAvailableFeatures();

        synchronized (mInstallLock) {
        // writer
        synchronized (mPackages) {
            //创建名为“PackageManager”的handler线程
            mHandlerThread = new ServiceThread(TAG,
                    Process.THREAD_PRIORITY_BACKGROUND, true /*allowIo*/);
            mHandlerThread.start();
            mHandler = new PackageHandler(mHandlerThread.getLooper());
            Watchdog.getInstance().addThread(mHandler, WATCHDOG_TIMEOUT);

            //创建各种目录
            File dataDir = Environment.getDataDirectory();
            mAppDataDir = new File(dataDir, "data");
            mAppInstallDir = new File(dataDir, "app");
            mAppLib32InstallDir = new File(dataDir, "app-lib");
            mAsecInternalPath = new File(dataDir, "app-asec").getPath();
            mUserAppDataDir = new File(dataDir, "user");
            mDrmAppPrivateInstallDir = new File(dataDir, "app-private");

            sUserManager = new UserManagerService(context, this,
                    mInstallLock, mPackages);
            ...

            ArrayMap<String, String> libConfig = systemConfig.getSharedLibraries();
            for (int i=0; i<libConfig.size(); i++) {
                mSharedLibraries.put(libConfig.keyAt(i),
                        new SharedLibraryEntry(libConfig.valueAt(i), null));
            }
            ...

            mRestoredSettings = mSettings.readLPw(this, sUserManager.getUsers(false),
                    mSdkVersion, mOnlyCore);
            ...

            long startTime = SystemClock.uptimeMillis();

            EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_SYSTEM_SCAN_START,
                    startTime);

            final int scanFlags = SCAN_NO_PATHS | SCAN_DEFER_DEX | SCAN_BOOTING | SCAN_INITIAL;
            final ArraySet<String> alreadyDexOpted = new ArraySet<String>();

            final String bootClassPath = System.getenv("BOOTCLASSPATH");
            final String systemServerClassPath = System.getenv("SYSTEMSERVERCLASSPATH");

            if (bootClassPath != null) {
                String[] bootClassPathElements = splitString(bootClassPath, ':');
                for (String element : bootClassPathElements) {
                    alreadyDexOpted.add(element);
                }
            }

            if (systemServerClassPath != null) {
                String[] systemServerClassPathElements = splitString(systemServerClassPath, ':');
                for (String element : systemServerClassPathElements) {
                    alreadyDexOpted.add(element);
                }
            }
            ...

            if (mSharedLibraries.size() > 0) {
                for (String dexCodeInstructionSet : dexCodeInstructionSets) {
                    for (SharedLibraryEntry libEntry : mSharedLibraries.values()) {
                        final String lib = libEntry.path;
                        ...
                        int dexoptNeeded = DexFile.getDexOptNeeded(lib, dexCodeInstructionSet,
                                "speed", false);
                        if (dexoptNeeded != DexFile.NO_DEXOPT_NEEDED) {
                            alreadyDexOpted.add(lib);
                            //执行dexopt操作
                            mInstaller.dexopt(lib, Process.SYSTEM_UID, dexCodeInstructionSet,
                                    dexoptNeeded, DEXOPT_PUBLIC /*dexFlags*/);
                        }
                    }
                }
            }

            File frameworkDir = new File(Environment.getRootDirectory(), "framework");

            alreadyDexOpted.add(frameworkDir.getPath() + "/framework-res.apk");
            alreadyDexOpted.add(frameworkDir.getPath() + "/core-libart.jar");

            String[] frameworkFiles = frameworkDir.list();
            if (frameworkFiles != null) {
                for (String dexCodeInstructionSet : dexCodeInstructionSets) {
                    for (int i=0; i<frameworkFiles.length; i++) {
                        File libPath = new File(frameworkDir, frameworkFiles[i]);
                        String path = libPath.getPath();

                        if (alreadyDexOpted.contains(path)) {
                            continue;
                        }

                        if (!path.endsWith(".apk") && !path.endsWith(".jar")) {
                            continue;
                        }

                        int dexoptNeeded = DexFile.getDexOptNeeded(path, dexCodeInstructionSet,
                                "speed", false);
                        if (dexoptNeeded != DexFile.NO_DEXOPT_NEEDED) {
                            mInstaller.dexopt(path, Process.SYSTEM_UID, dexCodeInstructionSet,
                                    dexoptNeeded, DEXOPT_PUBLIC /*dexFlags*/);
                        }

                    }
                }
            }

            final VersionInfo ver = mSettings.getInternalVersion();
            mIsUpgrade = !Build.FINGERPRINT.equals(ver.fingerprint);
            mPromoteSystemApps =
                    mIsUpgrade && ver.sdkVersion <= Build.VERSION_CODES.LOLLIPOP_MR1;

            if (mPromoteSystemApps) {
                Iterator<PackageSetting> pkgSettingIter = mSettings.mPackages.values().iterator();
                while (pkgSettingIter.hasNext()) {
                    PackageSetting ps = pkgSettingIter.next();
                    if (isSystemApp(ps)) {
                        mExistingSystemPackages.add(ps.name);
                    }
                }
            }

            File vendorOverlayDir = new File(VENDOR_OVERLAY_DIR);
            scanDirLI(vendorOverlayDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags | SCAN_TRUSTED_OVERLAY, 0);

            // Find base frameworks (resource packages without code).
            scanDirLI(frameworkDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR
                    | PackageParser.PARSE_IS_PRIVILEGED,
                    scanFlags | SCAN_NO_DEX, 0);

            // Collected privileged system packages.
            final File privilegedAppDir = new File(Environment.getRootDirectory(), "priv-app");
            scanDirLI(privilegedAppDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR
                    | PackageParser.PARSE_IS_PRIVILEGED, scanFlags, 0);

            // Collect ordinary system packages.
            final File systemAppDir = new File(Environment.getRootDirectory(), "app");
            scanDirLI(systemAppDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags, 0);

            // Collected privileged vendor packages.
            final File privilegedVendorAppDir = new File(Environment.getVendorDirectory(), "priv-app");
            scanDirLI(privilegedVendorAppDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR
                    | PackageParser.PARSE_IS_PRIVILEGED, scanFlags, 0);

            // Collect all vendor packages.
            File vendorAppDir = new File(Environment.getVendorDirectory(), "app");
            vendorAppDir = vendorAppDir.getCanonicalFile();
            scanDirLI(vendorAppDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags, 0);

            // Collect all OEM packages.
            final File oemAppDir = new File(Environment.getOemDirectory(), "app");
            scanDirLI(oemAppDir, PackageParser.PARSE_IS_SYSTEM
                    | PackageParser.PARSE_IS_SYSTEM_DIR, scanFlags, 0);

            //移除文件
            mInstaller.moveFiles();

            // Prune any system packages that no longer exist.
            final List<String> possiblyDeletedUpdatedSystemApps = new ArrayList<String>();
            if (!mOnlyCore) {
                Iterator<PackageSetting> psit = mSettings.mPackages.values().iterator();
                while (psit.hasNext()) {
                    PackageSetting ps = psit.next();

                    if ((ps.pkgFlags & ApplicationInfo.FLAG_SYSTEM) == 0) {
                        continue;
                    }

                    final PackageParser.Package scannedPkg = mPackages.get(ps.name);
                    if (scannedPkg != null) {
                        if (mSettings.isDisabledSystemPackageLPr(ps.name)) {
                            removePackageLI(ps, true);
                            mExpectingBetter.put(ps.name, ps.codePath);
                        }
                        continue;
                    }

                    if (!mSettings.isDisabledSystemPackageLPr(ps.name)) {
                        psit.remove();
                        removeDataDirsLI(null, ps.name);
                    } else {
                        final PackageSetting disabledPs = mSettings.getDisabledSystemPkgLPr(ps.name);
                        if (disabledPs.codePath == null || !disabledPs.codePath.exists()) {
                            possiblyDeletedUpdatedSystemApps.add(ps.name);
                        }
                    }
                }
            }

            ArrayList<PackageSetting> deletePkgsList = mSettings.getListOfIncompleteInstallPackagesLPr();
            for(int i = 0; i < deletePkgsList.size(); i++) {
                //clean up here
                cleanupInstallFailedPackage(deletePkgsList.get(i));
            }
            //删除临时文件
            deleteTempPackageFiles();

            //移除不相干包中的所有共享userID
            mSettings.pruneSharedUsersLPw();

            if (!mOnlyCore) {
                EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_DATA_SCAN_START, SystemClock.uptimeMillis());
                scanDirLI(mAppInstallDir, 0, scanFlags | SCAN_REQUIRE_KNOWN, 0);

                scanDirLI(mDrmAppPrivateInstallDir, PackageParser.PARSE_FORWARD_LOCK,
                        scanFlags | SCAN_REQUIRE_KNOWN, 0);

                for (String deletedAppName : possiblyDeletedUpdatedSystemApps) {
                    PackageParser.Package deletedPkg = mPackages.get(deletedAppName);
                    mSettings.removeDisabledSystemPackageLPw(deletedAppName);

                    String msg;
                    if (deletedPkg == null) {
                        removeDataDirsLI(null, deletedAppName);
                    } else {
                        deletedPkg.applicationInfo.flags &= ~ApplicationInfo.FLAG_SYSTEM;

                        PackageSetting deletedPs = mSettings.mPackages.get(deletedAppName);
                        deletedPs.pkgFlags &= ~ApplicationInfo.FLAG_SYSTEM;
                    }
                }

                for (int i = 0; i < mExpectingBetter.size(); i++) {
                    final String packageName = mExpectingBetter.keyAt(i);
                    if (!mPackages.containsKey(packageName)) {
                        final File scanFile = mExpectingBetter.valueAt(i);

                        final int reparseFlags;
                        if (FileUtils.contains(privilegedAppDir, scanFile)) {
                            reparseFlags = PackageParser.PARSE_IS_SYSTEM
                                    | PackageParser.PARSE_IS_SYSTEM_DIR
                                    | PackageParser.PARSE_IS_PRIVILEGED;
                        } else if (FileUtils.contains(systemAppDir, scanFile)) {
                            reparseFlags = PackageParser.PARSE_IS_SYSTEM
                                    | PackageParser.PARSE_IS_SYSTEM_DIR;
                        } else if (FileUtils.contains(vendorAppDir, scanFile)) {
                            reparseFlags = PackageParser.PARSE_IS_SYSTEM
                                    | PackageParser.PARSE_IS_SYSTEM_DIR;
                        } else if (FileUtils.contains(oemAppDir, scanFile)) {
                            reparseFlags = PackageParser.PARSE_IS_SYSTEM
                                    | PackageParser.PARSE_IS_SYSTEM_DIR;
                        } else {
                            continue;
                        }

                        mSettings.enableSystemPackageLPw(packageName);

                        try {
                            // 扫描包名
                            scanPackageLI(scanFile, reparseFlags, scanFlags, 0, null);
                        } catch (PackageManagerException e) {
                            Slog.e(TAG, "Failed to parse original system package: "
                                    + e.getMessage());
                        }
                    }
                }
            }
            mExpectingBetter.clear();

            updateAllSharedLibrariesLPw();

            for (SharedUserSetting setting : mSettings.getAllSharedUsersLPw()) {
                adjustCpuAbisForSharedUserLPw(setting.packages, null /* scanned package */,
                        false /* force dexopt */, false /* defer dexopt */,
                        false /* boot complete */);
            }

            mPackageUsage.readLP();

            EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_SCAN_END,
                    SystemClock.uptimeMillis());

            int updateFlags = UPDATE_PERMISSIONS_ALL;
            if (ver.sdkVersion != mSdkVersion) {
                updateFlags |= UPDATE_PERMISSIONS_REPLACE_PKG | UPDATE_PERMISSIONS_REPLACE_ALL;
            }
            updatePermissionsLPw(null, null, StorageManager.UUID_PRIVATE_INTERNAL, updateFlags);
            ver.sdkVersion = mSdkVersion;

            if (!onlyCore && (mPromoteSystemApps || !mRestoredSettings)) {
                for (UserInfo user : sUserManager.getUsers(true)) {
                    mSettings.applyDefaultPreferredAppsLPw(this, user.id);
                    applyFactoryDefaultBrowserLPw(user.id);
                    primeDomainVerificationsLPw(user.id);
                }
            }

            if (mIsUpgrade && !onlyCore) {
                Slog.i(TAG, "Build fingerprint changed; clearing code caches");
                for (int i = 0; i < mSettings.mPackages.size(); i++) {
                    final PackageSetting ps = mSettings.mPackages.valueAt(i);
                    if (Objects.equals(StorageManager.UUID_PRIVATE_INTERNAL, ps.volumeUuid)) {
                        deleteCodeCacheDirsLI(ps.volumeUuid, ps.name);
                    }
                }
                ver.fingerprint = Build.FINGERPRINT;
            }

            checkDefaultBrowser();

            mExistingSystemPackages.clear();
            mPromoteSystemApps = false;

            ver.databaseVersion = Settings.CURRENT_DATABASE_VERSION;

            mSettings.writeLPr();

            EventLog.writeEvent(EventLogTags.BOOT_PROGRESS_PMS_READY,
                    SystemClock.uptimeMillis());

            mRequiredVerifierPackage = getRequiredVerifierLPr();
            mRequiredInstallerPackage = getRequiredInstallerLPr();

            mInstallerService = new PackageInstallerService(context, this);

            mIntentFilterVerifierComponent = getIntentFilterVerifierComponentNameLPr();
            mIntentFilterVerifier = new IntentVerifierProxy(mContext,
                    mIntentFilterVerifierComponent);

        } // synchronized (mPackages)
        } // synchronized (mInstallLock)

        Runtime.getRuntime().gc();

        LocalServices.addService(PackageManagerInternal.class, new PackageManagerInternalImpl());
    }

PKMS对象初始化过程的5次Event事件：

1. BOOT_PROGRESS_PMS_START
2. BOOT_PROGRESS_PMS_SYSTEM_SCAN_START
3. BOOT_PROGRESS_PMS_DATA_SCAN_START
4. BOOT_PROGRESS_PMS_SCAN_END
5. BOOT_PROGRESS_PMS_READY

### 4.3 getPackageManager
[-> ContextImpl.java]

    public PackageManager getPackageManager() {
        if (mPackageManager != null) {
            return mPackageManager;
        }

        //【见小节4.4】
        IPackageManager pm = ActivityThread.getPackageManager();
        if (pm != null) {
            return (mPackageManager = new ApplicationPackageManager(this, pm));
        }

        return null;
    }

### 4.4 getPackageManager

[-> ActivityThread.java]

    public static IPackageManager getPackageManager() {
        if (sPackageManager != null) {
            return sPackageManager;
        }
        IBinder b = ServiceManager.getService("package");
        sPackageManager = IPackageManager.Stub.asInterface(b);
        return sPackageManager;
    }

### 4.5 performBootDexOpt
[-> PackageManagerService.java]

    public void performBootDexOpt() {
       // 确保只有system或者root uid有权限执行该方法
       enforceSystemOrRoot("Only the system can request dexopt be performed");

       //运行在同一个进程,此处拿到的MountService的服务端
       IMountService ms = PackageHelper.getMountService();
       if (ms != null) {
           final boolean isUpgrade = isUpgrade();
           boolean doTrim = isUpgrade;
           if (doTrim) {
               Slog.w(TAG, "Running disk maintenance immediately due to system update");
           } else {
               final long interval = android.provider.Settings.Global.getLong(
                       mContext.getContentResolver(),
                       android.provider.Settings.Global.FSTRIM_MANDATORY_INTERVAL,
                       DEFAULT_MANDATORY_FSTRIM_INTERVAL);
               if (interval > 0) {
                   final long timeSinceLast = System.currentTimeMillis() - ms.lastMaintenance();
                   if (timeSinceLast > interval) {
                       doTrim = true;
                   }
               }
           }
           //执行fstrim操作
           if (doTrim) {
               ms.runMaintenance();
           }
       }

       final ArraySet<PackageParser.Package> pkgs;
       synchronized (mPackages) {
           pkgs = mPackageDexOptimizer.clearDeferredDexOptPackages();
       }

       if (pkgs != null) {
           ArrayList<PackageParser.Package> sortedPkgs = new ArrayList<PackageParser.Package>();

           for (Iterator<PackageParser.Package> it = pkgs.iterator(); it.hasNext();) {
               PackageParser.Package pkg = it.next();
               if (pkg.coreApp) {
                   sortedPkgs.add(pkg);
                   it.remove();
               }
           }
           // Give priority to system apps that listen for pre boot complete.
           Intent intent = new Intent(Intent.ACTION_PRE_BOOT_COMPLETED);
           ArraySet<String> pkgNames = getPackageNamesForIntent(intent);
           for (Iterator<PackageParser.Package> it = pkgs.iterator(); it.hasNext();) {
               PackageParser.Package pkg = it.next();
               if (pkgNames.contains(pkg.packageName)) {
                   if (DEBUG_DEXOPT) {
                       Log.i(TAG, "Adding pre boot system app " + sortedPkgs.size() + ": " + pkg.packageName);
                   }
                   sortedPkgs.add(pkg);
                   it.remove();
               }
           }
           // Filter out packages that aren't recently used.
           filterRecentlyUsedApps(pkgs);

           // Add all remaining apps.
           for (PackageParser.Package pkg : pkgs) {
               if (DEBUG_DEXOPT) {
                   Log.i(TAG, "Adding app " + sortedPkgs.size() + ": " + pkg.packageName);
               }
               sortedPkgs.add(pkg);
           }

           // If we want to be lazy, filter everything that wasn't recently used.
           if (mLazyDexOpt) {
               filterRecentlyUsedApps(sortedPkgs);
           }

           int i = 0;
           int total = sortedPkgs.size();
           File dataDir = Environment.getDataDirectory();
           long lowThreshold = StorageManager.from(mContext).getStorageLowBytes(dataDir);
           if (lowThreshold == 0) {
               throw new IllegalStateException("Invalid low memory threshold");
           }
           for (PackageParser.Package pkg : sortedPkgs) {
               long usableSpace = dataDir.getUsableSpace();
               if (usableSpace < lowThreshold) {
                   Log.w(TAG, "Not running dexopt on remaining apps due to low memory: " + usableSpace);
                   break;
               }
               performBootDexOpt(pkg, ++i, total);
           }
       }
   }

### 4.6 systemReady

    public void systemReady() {
        mSystemReady = true;

        boolean compatibilityModeEnabled = android.provider.Settings.Global.getInt(
                mContext.getContentResolver(),
                android.provider.Settings.Global.COMPATIBILITY_MODE, 1) == 1;
        PackageParser.setCompatibilityModeEnabled(compatibilityModeEnabled);

        int[] grantPermissionsUserIds = EMPTY_INT_ARRAY;

        synchronized (mPackages) {

            ArrayList<PreferredActivity> removed = new ArrayList<PreferredActivity>();
            for (int i=0; i<mSettings.mPreferredActivities.size(); i++) {
                PreferredIntentResolver pir = mSettings.mPreferredActivities.valueAt(i);
                removed.clear();
                for (PreferredActivity pa : pir.filterSet()) {
                    if (mActivities.mActivities.get(pa.mPref.mComponent) == null) {
                        removed.add(pa);
                    }
                }
                if (removed.size() > 0) {
                    for (int r=0; r<removed.size(); r++) {
                        PreferredActivity pa = removed.get(r);
                        Slog.w(TAG, "Removing dangling preferred activity: "
                                + pa.mPref.mComponent);
                        pir.removeFilter(pa);
                    }
                    mSettings.writePackageRestrictionsLPr(
                            mSettings.mPreferredActivities.keyAt(i));
                }
            }

            for (int userId : UserManagerService.getInstance().getUserIds()) {
                if (!mSettings.areDefaultRuntimePermissionsGrantedLPr(userId)) {
                    grantPermissionsUserIds = ArrayUtils.appendInt(
                            grantPermissionsUserIds, userId);
                }
            }
        }
        sUserManager.systemReady();

        // If we upgraded grant all default permissions before kicking off.
        for (int userId : grantPermissionsUserIds) {
            mDefaultPermissionPolicy.grantDefaultPermissions(userId);
        }

        // Kick off any messages waiting for system ready
        if (mPostSystemReadyMessages != null) {
            for (Message msg : mPostSystemReadyMessages) {
                msg.sendToTarget();
            }
            mPostSystemReadyMessages = null;
        }

        // Watch for external volumes that come and go over time
        final StorageManager storage = mContext.getSystemService(StorageManager.class);
        storage.registerListener(mStorageListener);

        mInstallerService.systemReady();
        mPackageDexOptimizer.systemReady();

        MountServiceInternal mountServiceInternal = LocalServices.getService(
                MountServiceInternal.class);
        mountServiceInternal.addExternalStoragePolicy(
                new MountServiceInternal.ExternalStorageMountPolicy() {
            @Override
            public int getMountMode(int uid, String packageName) {
                if (Process.isIsolated(uid)) {
                    return Zygote.MOUNT_EXTERNAL_NONE;
                }
                if (checkUidPermission(WRITE_MEDIA_STORAGE, uid) == PERMISSION_GRANTED) {
                    return Zygote.MOUNT_EXTERNAL_DEFAULT;
                }
                if (checkUidPermission(READ_EXTERNAL_STORAGE, uid) == PERMISSION_DENIED) {
                    return Zygote.MOUNT_EXTERNAL_DEFAULT;
                }
                if (checkUidPermission(WRITE_EXTERNAL_STORAGE, uid) == PERMISSION_DENIED) {
                    return Zygote.MOUNT_EXTERNAL_READ;
                }
                return Zygote.MOUNT_EXTERNAL_WRITE;
            }

            @Override
            public boolean hasExternalStorage(int uid, String packageName) {
                return true;
            }
        });
    }
