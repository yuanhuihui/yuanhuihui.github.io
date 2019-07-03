## 路径问题

Internal storage:  getFilesDir(),getCacheDir()   或者直接new File(“/data/data/packagename”,fileName)
External storage: getExternalFilesDir(),  getExternalPublicFilesDir(),  getExternalStorageDirectory()
    - cache放在/storage/emulated/0/Android/data/package/cache


### getExternalFilesDirs

#### 1 ContextImpl.getExternalFilesDirs

    public File[] getExternalFilesDirs(String type) {
        synchronized (mSync) {
            if (mExternalFilesDirs == null) {
                // [2]
                mExternalFilesDirs = Environment.buildExternalStorageAppFilesDirs(getPackageName());
            }

            File[] dirs = mExternalFilesDirs;
            if (type != null) {
                // 将type连接起来,构建目录
                dirs = Environment.buildPaths(dirs, type);
            }

            //[2.2] 创建目录
            return ensureDirsExistOrFilter(dirs);
        }
    }

#### 2 Environment.buildExternalStorageAppFilesDirs

Environment.buildExternalStorageAppFilesDirs(getPackageName());
    //连接路径,构建目录的数组 [3]
    buildPaths(getExternalDirs(), "Android", "data", packageName, "files");

#### 2.2 ContextImpl.ensureDirsExistOrFilter

    private File[] ensureDirsExistOrFilter(File[] dirs) {
        File[] result = new File[dirs.length];
        for (int i = 0; i < dirs.length; i++) {
            File dir = dirs[i];
            if (!dir.exists()) {
                if (!dir.mkdirs()) {
                    //再次check
                    if (!dir.exists()) {
                        final IMountService mount = IMountService.Stub.asInterface(
                                ServiceManager.getService("mount"));
                        try {
                            // 向vold发送mkdir命令, mConnector.execute("volume", "mkdirs", appPath);
                            final int res = mount.mkdirs(getPackageName(), dir.getAbsolutePath());
                            if (res != 0) {
                                dir = null;
                            }
                        } catch (Exception e) {
                            dir = null;
                        }
                    }
                }
            }
            result[i] = dir;
        }
        return result;
    }


#### 3 Environment.getExternalDirs

UserEnvironment

    public File[] getExternalDirs() {
        // [4]
        final StorageVolume[] volumes = StorageManager.getVolumeList(mUserId,
                StorageManager.FLAG_FOR_WRITE);
        final File[] files = new File[volumes.length];
        for (int i = 0; i < volumes.length; i++) {
            files[i] = volumes[i].getPathFile();
        }
        return files;
    }

#### 4 MountService.getVolumeList

    public StorageVolume[] getVolumeList(int uid, String packageName, int flags) {
        final boolean forWrite = (flags & StorageManager.FLAG_FOR_WRITE) != 0;

        final ArrayList<StorageVolume> res = new ArrayList<>();
        boolean foundPrimary = false;

        final int userId = UserHandle.getUserId(uid);
        final boolean reportUnmounted;
        final long identity = Binder.clearCallingIdentity();
        try {
            //来判定是否mount [5]
            reportUnmounted = !mMountServiceInternal.hasExternalStorage(
                    uid, packageName);
        } finally {
            Binder.restoreCallingIdentity(identity);
        }

        synchronized (mLock) {
            for (int i = 0; i < mVolumes.size(); i++) {
                final VolumeInfo vol = mVolumes.valueAt(i);
                // 只针对可写或者可读的volume
                if (forWrite ? vol.isVisibleForWrite(userId) : vol.isVisibleForRead(userId)) {
                    //建立存储volumes
                    final StorageVolume userVol = vol.buildStorageVolume(mContext, userId,
                            reportUnmounted);
                    if (vol.isPrimary()) {
                        res.add(0, userVol);
                        foundPrimary = true;
                    } else {
                        res.add(userVol);
                    }
                }
            }
        }

        if (!foundPrimary) {
            Log.w(TAG, "No primary storage defined yet; hacking together a stub");

            final boolean primaryPhysical = SystemProperties.getBoolean(
                    StorageManager.PROP_PRIMARY_PHYSICAL, false);

            final String id = "stub_primary";
            final File path = Environment.getLegacyExternalStorageDirectory();
            final String description = mContext.getString(android.R.string.unknownName);
            final boolean primary = true;
            final boolean removable = primaryPhysical;
            final boolean emulated = !primaryPhysical;
            final long mtpReserveSize = 0L;
            final boolean allowMassStorage = false;
            final long maxFileSize = 0L;
            final UserHandle owner = new UserHandle(userId);
            final String uuid = null;
            final String state = Environment.MEDIA_REMOVED;

            res.add(0, new StorageVolume(id, StorageVolume.STORAGE_ID_INVALID, path,
                    description, primary, removable, emulated, mtpReserveSize,
                    allowMassStorage, maxFileSize, owner, uuid, state));
        }

        return res.toArray(new StorageVolume[res.size()]);
    }

#### 5. AppOpsService.systemReady


    mountServiceInternal.addExternalStoragePolicy(
        new MountServiceInternal.ExternalStorageMountPolicy() {
            @Override
            public int getMountMode(int uid, String packageName) {
                if (Process.isIsolated(uid)) {
                    return Zygote.MOUNT_EXTERNAL_NONE;
                }
                if (noteOperation(AppOpsManager.OP_READ_EXTERNAL_STORAGE, uid,
                        packageName) != AppOpsManager.MODE_ALLOWED) {
                    return Zygote.MOUNT_EXTERNAL_NONE;
                }
                if (noteOperation(AppOpsManager.OP_WRITE_EXTERNAL_STORAGE, uid,
                        packageName) != AppOpsManager.MODE_ALLOWED) {
                    return Zygote.MOUNT_EXTERNAL_READ;
                }
                return Zygote.MOUNT_EXTERNAL_WRITE;
            }

            @Override
            public boolean hasExternalStorage(int uid, String packageName) {
                final int mountMode = getMountMode(uid, packageName);
                return mountMode == Zygote.MOUNT_EXTERNAL_READ
                        || mountMode == Zygote.MOUNT_EXTERNAL_WRITE;
            }
        });



getExternalDirs()获取所有外置存储的目录路径.
