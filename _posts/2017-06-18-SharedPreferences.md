---
layout: post
title:  "全面剖析SharedPreferences"
date:   2017-06-18 20:20:00
catalog:  true
tags:
    - android
---


## 一. 概述

SharedPreferences(简称SP)是Android中很常用的数据存储方式，SP采用key-value（键值对）形式, 主要用于轻量级的数据存储, 尤其适合保存应用的配置参数, 但不建议使用SP
来存储大规模的数据, 可能会降低性能.

SP采用xml文件格式来保存数据, 该文件所在目录位于/data/data/<package name>/shared_prefs/

### 1.1 使用示例

    SharedPreferences sharedPreferences = getSharedPreferences("gityuan", Context.MODE_PRIVATE);

    Editor editor = sharedPreferences.edit();
    editor.putString("blog", "www.gityuan.com");
    editor.putInt("years", 3);
    editor.commit();


生成的gityuan.xml文件内容如下：

    <?xml version='1.0' encoding='utf-8' standalone='yes' ?>
    <map>
       <string name="blog">"www.gityuan.com</string>
       <int name="years" value="3" />
    </map>


### 1.2 架构图

[点击查看大图](http://www.gityuan.com/images/sp/shared_preference.jpg)

![shared_preference](/images/sp/shared_preference.jpg)

SharedPreferences与Editor只是两个接口. SharedPreferencesImpl和EditorImpl分别实现了对应接口.
另外, ContextImpl记录着SharedPreferences的重要数据, 如下:

- sSharedPrefsCache:以包名为key, 二级key是以SP文件, 以SharedPreferencesImpl为value的嵌套map结构.
这里需要sSharedPrefsCache是静态类成员变量, 每个进程是保存唯一一份, 且由ContextImpl.class锁保护.
- mSharedPrefsPaths:记录所有的SP文件, 以文件名为key, 具体文件为value的map结构;
- mPreferencesDir:是指SP所在目录, 是指/data/data/<package name>/shared_prefs/


[点击查看大图](http://www.gityuan.com/images/sp/shared_preferences_arch.jpg)

![shared_preferences_arch](/images/sp/shared_preferences_arch.jpg)

图解:

1. putxxx()操作: 把数据写入到EditorImpl.mModified;
2. apply()或者commit()操作:
    - 先调用commitToMemory(), 将数据同步到SharedPreferencesImpl的mMap, 并保存到MemoryCommitResult的mapToWriteToDisk,
    - 再调用enqueueDiskWrite(), 写入到磁盘文件; 先之前把原有数据保存到.bak为后缀的文件,用于在写磁盘的过程出现任何异常可恢复数据;
3. getxxx()操作: 从SharedPreferencesImpl.mMap读取数据.

## 二. SharedPreferences

### 2.1 获取方式

#### 2.1.1 getPreferences
[-> Activity.java]

    public SharedPreferences getPreferences(int mode) {
        //[见下文]
        return getSharedPreferences(getLocalClassName(), mode);
    }

Activity.getPreferences(mode): 以当前Activity的类名作为SP的文件名. 即xxxActivity.xml.

#### 2.1.2 getDefaultSharedPreferences
[-> PreferenceManager.java]

    public static SharedPreferences getDefaultSharedPreferences(Context context) {
        //[见下文]
        return context.getSharedPreferences(getDefaultSharedPreferencesName(context),
               getDefaultSharedPreferencesMode());
    }

PreferenceManager.getDefaultSharedPreferences(Context): 以包名加上_preferences作为文件名, 以MODE_PRIVATE模式创建SP文件.
即packgeName_preferences.xml.

#### 2.1.3 getSharedPreferences
当然也可以直接调用Context.getSharedPreferences(name, mode), 以上所有的方法最终都是调用到如下方法:

[-> ContextImpl.java]

    class ContextImpl extends Context {
        private ArrayMap<String, File> mSharedPrefsPaths;

        public SharedPreferences getSharedPreferences(String name, int mode) {
            File file;
            synchronized (ContextImpl.class) {
                if (mSharedPrefsPaths == null) {
                    mSharedPrefsPaths = new ArrayMap<>();
                }
                //先从mSharedPrefsPaths查询是否存在相应文件
                file = mSharedPrefsPaths.get(name);
                if (file == null) {
                    //如果文件不存在, 则创建新的文件 [见小节2.1.4]
                    file = getSharedPreferencesPath(name);
                    mSharedPrefsPaths.put(name, file);
                }
            }
            //[见小节2.2]
            return getSharedPreferences(file, mode);
        }
    }

#### 2.1.4 getSharedPreferencesPath
[-> ContextImpl.java]

    public File getSharedPreferencesPath(String name) {
        return makeFilename(getPreferencesDir(), name + ".xml");
    }

    private File getPreferencesDir() {
        synchronized (mSync) {
            if (mPreferencesDir == null) {
                //创建目录/data/data/package name/shared_prefs/
                mPreferencesDir = new File(getDataDir(), "shared_prefs");
            }
            return ensurePrivateDirExists(mPreferencesDir);
        }
    }
流程说明:

1. 先从mSharedPrefsPaths查询是否存在相应文件;
2. 如果文件不存在, 则创建新的xml文件; 如果目录也不存在, 则先创建目录创建目录/data/data/package name/shared_prefs/
3. 其中mSharedPrefsPaths用于记录所有的SP文件, 是以文件名为key的Map数据结构.


### 2.2 getSharedPreferences
[-> ContextImpl.java]

    public SharedPreferences getSharedPreferences(File file, int mode) {
        checkMode(mode); //[见小节2.2.1]
        SharedPreferencesImpl sp;
        synchronized (ContextImpl.class) {
            //[见小节2.2.2]
            final ArrayMap<File, SharedPreferencesImpl> cache = getSharedPreferencesCacheLocked();
            sp = cache.get(file);
            if (sp == null) {
                //创建SharedPreferencesImpl[见小节2.3]
                sp = new SharedPreferencesImpl(file, mode);
                cache.put(file, sp);
                return sp;
            }
        }

        //指定多进程模式, 则当文件被其他进程改变时,则会重新加载
        if ((mode & Context.MODE_MULTI_PROCESS) != 0 ||
            getApplicationInfo().targetSdkVersion < android.os.Build.VERSION_CODES.HONEYCOMB) {
            sp.startReloadIfChangedUnexpectedly();
        }
        return sp;
    }

#### 2.2.1 checkMode
[-> ContextImpl.java]

    private void checkMode(int mode) {
        if (getApplicationInfo().targetSdkVersion >= Build.VERSION_CODES.N) {
            if ((mode & MODE_WORLD_READABLE) != 0) {
                throw new SecurityException("MODE_WORLD_READABLE no longer supported");
            }
            if ((mode & MODE_WORLD_WRITEABLE) != 0) {
                throw new SecurityException("MODE_WORLD_WRITEABLE no longer supported");
            }
        }
    }

从Android N开始, 创建的SP文件模式, 不允许MODE_WORLD_READABLE和MODE_WORLD_WRITEABLE模块, 否则会直接抛出异常SecurityException.
另外, 顺带说一下MODE_MULTI_PROCESS这种多进程的方式也是Google不推荐的方式, 后续同样会不再支持, 强烈建议App不用使用该方式来实现多个进程实现
同一个SP文件.

当设置MODE_MULTI_PROCESS模式, 则每次getSharedPreferences过程, 会检查SP文件上次修改时间和文件大小, 一旦所有修改则会重新从磁盘加载文件.

#### 2.2.2 getSharedPreferencesCacheLocked
[-> ContextImpl.java]

    private ArrayMap<File, SharedPreferencesImpl> getSharedPreferencesCacheLocked() {
        if (sSharedPrefsCache == null) {
            sSharedPrefsCache = new ArrayMap<>();
        }

        final String packageName = getPackageName();
        ArrayMap<File, SharedPreferencesImpl> packagePrefs = sSharedPrefsCache.get(packageName);
        if (packagePrefs == null) {
            packagePrefs = new ArrayMap<>();
            sSharedPrefsCache.put(packageName, packagePrefs);
        }
        return packagePrefs;
    }

### 2.3 SharedPreferencesImpl初始化
[-> SharedPreferencesImpl.java]

    SharedPreferencesImpl(File file, int mode) {
        mFile = file;
        //创建为.bak为后缀的备份文件
        mBackupFile = makeBackupFile(file);
        mMode = mode;
        mLoaded = false;
        mMap = null;
        startLoadFromDisk(); //[见小节2.3.1]
    }

同名的.bak备份文件用于发生异常时, 可通过备份文件来恢复数据.

#### 2.3.1 startLoadFromDisk
[-> SharedPreferencesImpl.java]

    private void startLoadFromDisk() {
        synchronized (this) {
            mLoaded = false;
        }
        new Thread("SharedPreferencesImpl-load") {
            public void run() {
                loadFromDisk(); //[见小节2.3.2]
            }
        }.start();
    }

mLoaded用于标记SP文件已加载到内存. 创建线程去实现从磁盘加载sp文件的工作.

#### 2.3.2 loadFromDisk
[-> SharedPreferencesImpl.java]

    private void loadFromDisk() {
        synchronized (SharedPreferencesImpl.this) {
            if (mLoaded) {
                return;
            }
            if (mBackupFile.exists()) {
                mFile.delete();
                mBackupFile.renameTo(mFile);
            }
        }

        Map map = null;
        StructStat stat = null;
        try {
            stat = Os.stat(mFile.getPath());
            if (mFile.canRead()) {
                BufferedInputStream str = null;
                try {
                    str = new BufferedInputStream(new FileInputStream(mFile), 16*1024);
                    map = XmlUtils.readMapXml(str);
                } catch (XmlPullParserException | IOException e) {
                    ...
                } finally {
                    IoUtils.closeQuietly(str);
                }
            }
        } catch (ErrnoException e) {
            ...
        }

        synchronized (SharedPreferencesImpl.this) {
            mLoaded = true;
            if (map != null) {
                mMap = map; //从文件读取的信息保存到mMap
                mStatTimestamp = stat.st_mtime; //更新修改时间
                mStatSize = stat.st_size; //更新文件大小
            } else {
                mMap = new HashMap<>();
            }
            notifyAll(); //唤醒处于等待状态的线程
        }
    }


整个获取SharedPreferences简单总结:

- 首次使用则创建相应xml文件;
- 异步加载文件内容到内存; 此时执行getXXX()和setxxx()以及edit()方法都是阻塞等待的, 直到文件数据全部加载到内存;
- 一旦完全加载到内存, 后续的getXXX()则是直接访问内存.

### 2.4 查询数据

#### 2.4.1 getString
[-> SharedPreferencesImpl.java]

    public String getString(String key, @Nullable String defValue) {
        synchronized (this) {
            //检查是否加载完成[见小节2.4.2]
            awaitLoadedLocked();
            String v = (String)mMap.get(key);
            return v != null ? v : defValue;
        }
    }

- 当loadFromDisk没有执行完成, 则会阻塞查询操作;
- 当数据加载完成, 则直接从mMap来查询相应数据;

#### 2.4.2 awaitLoadedLocked
[-> SharedPreferencesImpl.java]

    private void awaitLoadedLocked() {
        if (!mLoaded) {
            BlockGuard.getThreadPolicy().onReadFromDisk();
        }
        while (!mLoaded) {
            try {
                wait(); //当没有加载完成,则进入等待状态
            } catch (InterruptedException unused) {
            }
        }
    }

## 三. Editor

###　3.1　edit
[-> SharedPreferencesImpl.java]

    public Editor edit() {
        synchronized (this) {
            awaitLoadedLocked(); //[见小节2.4.2]
        }

        return new EditorImpl(); //创建EditorImpl
    }

该过程同样要等待awaitLoadedLocked完成, 然后创建EditorImpl对象.
而EditorImpl作为SharedPreferencesImpl的内部类,其继承于Editor类.

### 3.2 EditorImpl
[-> SharedPreferencesImpl.java::　EditorImpl]

    public final class EditorImpl implements Editor {
        private final Map<String, Object> mModified = Maps.newHashMap();
        private boolean mClear = false;

        //插入数据
        public Editor putString(String key, @Nullable String value) {
            synchronized (this) {
                //插入数据, 先暂存到mModified对象
                mModified.put(key, value);
                return this;
            }
        }
        //移除数据
        public Editor remove(String key) {
            synchronized (this) {
                mModified.put(key, this);
                return this;
            }
        }

        //清空全部数据
        public Editor clear() {
            synchronized (this) {
                mClear = true;
                return this;
            }
        }
    }

从这里可以看出, 这些数据修改操作仅仅是修改mModified和mClear. 直到数据提交commit或许apply过程,
才会真正的把数据更新到SharedPreferencesImpl(简称SPI). 比如设置mClear=true则会情况SPI的mMap数据.

## 四. 数据提交

这里重点来说说数据提交的两个重要方法commit()和apply().

### 4.1 commit
[-> SharedPreferencesImpl.java::　EditorImpl]

    public boolean commit() {
        //将数据更新到内存[见小节4.2]
        MemoryCommitResult mcr = commitToMemory();
        //将内存数据同步到文件[见小节4.3]
        SharedPreferencesImpl.this.enqueueDiskWrite(mcr, null);
        try {
            //进入等待状态, 直到写入文件的操作完成
            mcr.writtenToDiskLatch.await();
        } catch (InterruptedException e) {
            return false;
        }
        //通知监听则, 并在主线程回调onSharedPreferenceChanged()方法
        notifyListeners(mcr);
        // 返回文件操作的结果数据
        return mcr.writeToDiskResult;
    }

### 4.2 commitToMemory
[-> SharedPreferencesImpl.java::　EditorImpl]

    private MemoryCommitResult commitToMemory() {
        MemoryCommitResult mcr = new MemoryCommitResult();
        synchronized (SharedPreferencesImpl.this) {
            if (mDiskWritesInFlight > 0) {
                mMap = new HashMap<String, Object>(mMap);
            }
            mcr.mapToWriteToDisk = mMap;
            mDiskWritesInFlight++;

            //是否有监听key改变的监听者
            boolean hasListeners = mListeners.size() > 0;
            if (hasListeners) {
                mcr.keysModified = new ArrayList<String>();
                mcr.listeners = new HashSet<OnSharedPreferenceChangeListener>(mListeners.keySet());
            }

            synchronized (this) {
                //当mClear为true, 则直接清空mMap
                if (mClear) {
                    if (!mMap.isEmpty()) {
                        mcr.changesMade = true;
                        mMap.clear();
                    }
                    mClear = false;
                }

                for (Map.Entry<String, Object> e : mModified.entrySet()) {
                    String k = e.getKey();
                    Object v = e.getValue();
                    //注意此处的this是个特殊值, 用于移除相应的key操作.
                    if (v == this || v == null) {
                        if (!mMap.containsKey(k)) {
                            continue;
                        }
                        mMap.remove(k);
                    } else {
                        if (mMap.containsKey(k)) {
                            Object existingValue = mMap.get(k);
                            if (existingValue != null && existingValue.equals(v)) {
                                continue;
                            }
                        }
                        mMap.put(k, v);
                    }

                    mcr.changesMade = true; // changesMade代表数据是否有改变
                    if (hasListeners) {
                        mcr.keysModified.add(k); //记录发生改变的key
                    }
                }
                mModified.clear(); //清空EditorImpl中的mModified数据
            }
        }
        return mcr;
    }

该方法的主要功能: 把EditorImpl数据更新到SPI.

- 将mMap信息赋值给mapToWriteToDisk, 并mDiskWritesInFlight加1;
- 当mClear为true, 则直接清空mMap;
- 当value值为this或null, 则移除相应的key;
- 当value值发生改变, 则会更新到mMap;

只要有key/value发生改变(新增, 删除), 则设置mcr.changesMade = true. 最后会清空EditorImpl中的mModified数据.


### 4.3 enqueueDiskWrite
[-> SharedPreferencesImpl.java]

    private void enqueueDiskWrite(final MemoryCommitResult mcr,
                                  final Runnable postWriteRunnable) {
        final Runnable writeToDiskRunnable = new Runnable() {
                public void run() {
                    synchronized (mWritingToDiskLock) {
                        //执行文件写入操作[见小节4.3.1]
                        writeToFile(mcr);
                    }
                    synchronized (SharedPreferencesImpl.this) {
                        mDiskWritesInFlight--;
                    }
                    //此时postWriteRunnable为null不执行该方法
                    if (postWriteRunnable != null) {
                        postWriteRunnable.run();
                    }
                }
            };

        final boolean isFromSyncCommit = (postWriteRunnable == null);

        if (isFromSyncCommit) { //commit方法会进入该分支
            boolean wasEmpty = false;
            synchronized (SharedPreferencesImpl.this) {
                //commitToMemory过程会加1,则wasEmpty=true
                wasEmpty = mDiskWritesInFlight == 1;
            }
            if (wasEmpty) {
                //跳转到上面
                writeToDiskRunnable.run();
                return;
            }
        }
        //不执行该方法
        QueuedWork.singleThreadExecutor().execute(writeToDiskRunnable);
    }

#### 4.3.1 writeToFile

    private void writeToFile(MemoryCommitResult mcr) {
        if (mFile.exists()) {
            if (!mcr.changesMade) { //没有key发生改变, 则直接返回
                mcr.setDiskWriteResult(true);
                return;
            }
            if (!mBackupFile.exists()) {
                //当备份文件不存在, 则把mFile重命名为备份文件
                if (!mFile.renameTo(mBackupFile)) {
                    mcr.setDiskWriteResult(false);
                    return;
                }
            } else {
                mFile.delete(); //否则,直接删除mFile
            }
        }

        try {
            FileOutputStream str = createFileOutputStream(mFile);
            if (str == null) {
                mcr.setDiskWriteResult(false);
                return;
            }
            //将mMap全部信息写入文件
            XmlUtils.writeMapXml(mcr.mapToWriteToDisk, str);
            FileUtils.sync(str);
            str.close();
            ContextImpl.setFilePermissionsFromMode(mFile.getPath(), mMode, 0);
            try {
                final StructStat stat = Os.stat(mFile.getPath());
                synchronized (this) {
                    mStatTimestamp = stat.st_mtime;
                    mStatSize = stat.st_size;
                }
            } catch (ErrnoException e) {
                ...
            }
            //写入成功, 则删除备份文件
            mBackupFile.delete();
            //返回写入成功, 唤醒等待线程
            mcr.setDiskWriteResult(true);
            return;
        } catch (XmlPullParserException e) {
            ...
        } catch (IOException e) {
            ...
        }
        //如果写入文件的操作失败, 则删除未成功写入的文件
        if (mFile.exists()) {
            if (!mFile.delete()) {
                ...
            }
        }
        //返回写入失败, 唤醒等待线程
        mcr.setDiskWriteResult(false);
    }

该方法的主要功能:

1. 当没有key发生改变, 则直接返回; 否则执行step2;
2. 将mMap全部信息写入文件, 如果写入成功则删除备份文件,如果写入失败则删除mFile.

可见, 每次commit是把全部数据更新到文件, 所以每个文件的数据量必须保证足够精简.
再来看看apply过程.

### 4.4 apply
[-> SharedPreferencesImpl.java::　EditorImpl]

    public void apply() {
        //把数据更新到内存[见小节4.2]
        final MemoryCommitResult mcr = commitToMemory();
        final Runnable awaitCommit = new Runnable() {
                public void run() {
                    try {
                        //进入等待状态
                        mcr.writtenToDiskLatch.await();
                    } catch (InterruptedException ignored) {
                    }
                }
            };

        //将awaitCommit添加到QueuedWork
        QueuedWork.add(awaitCommit);

        Runnable postWriteRunnable = new Runnable() {
                public void run() {
                    awaitCommit.run();
                    //从QueuedWork移除
                    QueuedWork.remove(awaitCommit);
                }
            };

        //[见小节4.4.1]
        SharedPreferencesImpl.this.enqueueDiskWrite(mcr, postWriteRunnable);
        notifyListeners(mcr);
    }


#### 4.4.1 enqueueDiskWrite
[-> SharedPreferencesImpl.java]

    private void enqueueDiskWrite(final MemoryCommitResult mcr,
                                  final Runnable postWriteRunnable) {
        final Runnable writeToDiskRunnable = new Runnable() {
                public void run() {
                    synchronized (mWritingToDiskLock) {
                        //执行文件写入操作[见小节4.3.1]
                        writeToFile(mcr);
                    }
                    synchronized (SharedPreferencesImpl.this) {
                        mDiskWritesInFlight--;
                    }

                    if (postWriteRunnable != null) {
                        postWriteRunnable.run();
                    }
                }
            };

        final boolean isFromSyncCommit = (postWriteRunnable == null);
        if (isFromSyncCommit) {
            ... //postWriteRunnable不为空
        }
        //将任务放入单线程的线程池来执行
        QueuedWork.singleThreadExecutor().execute(writeToDiskRunnable);
    }

#### 4.4.2 QueuedWork
[-> QueuedWork.java]

    public class QueuedWork {

        private static final ConcurrentLinkedQueue<Runnable> sPendingWorkFinishers =
           new ConcurrentLinkedQueue<Runnable>();

        public static void add(Runnable finisher) {
            sPendingWorkFinishers.add(finisher);
        }

        public static void remove(Runnable finisher) {
            sPendingWorkFinishers.remove(finisher);
        }

        public static void waitToFinish() {
            Runnable toFinish;
            while ((toFinish = sPendingWorkFinishers.poll()) != null) {
                toFinish.run();
            }
        }

        public static boolean hasPendingWork() {
            return !sPendingWorkFinishers.isEmpty();
        }
    }

可见, apply跟commit的最大区别 在于apply的写入文件操作是在单线程的线程池来完成.

- apply方法开始的时候, 会把awaitCommit放入QueuedWork;
- 文件写入操作完成, 则会把相应的awaitCommit从QueuedWork中移除.

QueuedWork在这里存在的价值主要是用于在Stop Service, finish BroadcastReceiver过程用于
判定是否处理完所有的异步SP操作.


## 五. 总结

apply 与commit的对比

- apply没有返回值, commit有返回值能知道修改是否提交成功
- apply是将修改提交到内存，再异步提交到磁盘文件; commit是同步的提交到磁盘文件;
- 多并发的提交commit时，需等待正在处理的commit数据更新到磁盘文件后才会继续往下执行，从而降低效率;
而apply只是原子更新到内存，后调用apply函数会直接覆盖前面内存数据，从一定程度上提高很多效率。

获取SP与Editor:

- getSharedPreferences()是从ContextImpl.sSharedPrefsCache唯一的SPI对象;
- edit()每次都是创建新的EditorImpl对象.

优化建议:

- 强烈建议不要在sp里面存储特别大的key/value, 有助于减少卡顿/anr
- 请不要高频地使用apply, 尽可能地批量提交;commit直接在主线程操作, 更要注意了
- 不要使用MODE_MULTI_PROCESS;
- 高频写操作的key与高频读操作的key可以适当地拆分文件, 由于减少同步锁竞争;
- 不要一上来就执行getSharedPreferences().edit(), 应该分成两大步骤来做, 中间可以执行其他代码.
- 不要连续多次edit(), 应该获取一次获取edit(),然后多次执行putxxx(), 减少内存波动; 经常看到大家喜欢封装方法, 结果就导致这种情况的出现.
- 每次commit时会把全部的数据更新的文件, 所以整个文件是不应该过大的, 影响整体性能;
