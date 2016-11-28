---
layout: post
title:  "DropBoxManager启动篇"
date:   2016-6-12 20:25:33
catalog:    true
tags:
    - android
    - debug

---

## 一、启动流程

DropBoxManagerService(简称DBMS) 记录着系统关键log信息，主要功能用于Debug调试。
Android系统启动过程SystemServer进程时，在startOtherServices()过程会启动DBMS服务，如下：

### 1.1 启动DBMS
[-> SystemServer.java]

    private void startOtherServices() {
        try {
            //初始化DBMS，并登记该服务【见小节1.2】
            ServiceManager.addService(Context.DROPBOX_SERVICE,
                    new DropBoxManagerService(context, new File("/data/system/dropbox")));
        } catch (Throwable e) {
            ...
        }
        ...
    }

其中DROPBOX_SERVICE = "dropbox", DBMS工作目录位于"/data/system/dropbox"，这个过程向ServiceManager
登记名为“dropbox”的服务。后续便可以通过`dumpsys dropbox`来查看该服务的相关信息。

### 1.2 初始化DBMS
[-> DropBoxManagerService.java]

    public final class DropBoxManagerService extends IDropBoxManagerService.Stub {
        ...
        public DropBoxManagerService(final Context context, File path) {
            // 目录/data/system/dropbox
            mDropBoxDir = path;

            mContext = context;
            mContentResolver = context.getContentResolver();

            IntentFilter filter = new IntentFilter();
            // 1.存储设备可用空间低的广播
            filter.addAction(Intent.ACTION_DEVICE_STORAGE_LOW);
            // 2.开机完毕的广播
            filter.addAction(Intent.ACTION_BOOT_COMPLETED);
            context.registerReceiver(mReceiver, filter);

            // 3.Settings数据库变化时，则回调广播接收者的onReceive方法
            //此处CONTENT_URI=content://settings/global"
            mContentResolver.registerContentObserver(
                Settings.Global.CONTENT_URI, true,
                new ContentObserver(new Handler()) {
                    @Override
                    public void onChange(boolean selfChange) {
                        mReceiver.onReceive(context, (Intent) null);
                    }
                });

            mHandler = new Handler() {
                @Override
                public void handleMessage(Message msg) {
                    // 发送广播
                    if (msg.what == MSG_SEND_BROADCAST) {
                        mContext.sendBroadcastAsUser((Intent)msg.obj, UserHandle.OWNER,
                                android.Manifest.permission.READ_LOGS);
                    }
                }
            };
        }
    }

以下任一情况发生，都会触发触发执行mReceiver的onReceive方法：

- 存储设备可用空间低；
- 开机完毕；
- Settings数据库变化；

该方法主要功能是给dropbox目录所对应的存储空间进行瘦身，接下来再说说这个搜身过程。

### 1.3 mReceiver.onReceive
[-> DropBoxManagerService.java]

    private final BroadcastReceiver mReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            if (intent != null && Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) {
                mBooted = true;
                return;
            }

            //收到ACTION_DEVICE_STORAGE_LOW，则强制重新check存储空间
            mCachedQuotaUptimeMillis = 0; 

            //创建工作线程来执行init和trim操作
            new Thread() {
                public void run() {
                    try {
                        init(); //【见小节1.3.1】
                        trimToFit(); //【见小节1.3.2】
                    } catch (IOException e) {
                        ...
                    }
                }
            }.start();
        }
    };

#### 1.3.1 init

    private synchronized void init() throws IOException {
        if (mStatFs == null) {
            if (!mDropBoxDir.isDirectory() && !mDropBoxDir.mkdirs()) {
                ...
            }
            mStatFs = new StatFs(mDropBoxDir.getPath());
            mBlockSize = mStatFs.getBlockSize(); //mBlockSize=4096
        }

        if (mAllFiles == null) {
            File[] files = mDropBoxDir.listFiles();
            // 列举所有的dropbox文件
            mAllFiles = new FileList();
            mFilesByTag = new HashMap<String, FileList>();

            for (File file : files) {
                if (file.getName().endsWith(".tmp")) {
                    file.delete(); //删除后缀为.tmp文件
                    continue;
                }
                // 创建dropbox的实体文件对象
                EntryFile entry = new EntryFile(file, mBlockSize);
                if (entry.tag == null) {
                    continue; //忽略tag为空的文件
                } else if (entry.timestampMillis == 0) {
                    file.delete(); //删除时间戳为0的文件
                    continue;
                }
                //将entry加入到mAllFiles对象
                enrollEntry(entry);
            }
        }
    }

该方法主要功能：创建目录/data/system/dropbox，列举该目录下所有的问题，并删除其中后缀为.tmp或者时间戳为0的文件。

dropbox文件格式为`tag@时间戳.txt`或者`tag@时间戳.txt.gz`，例如`system_server_wtf@1465650845355.txt`

#### 1.3.2 trimToFit

    private synchronized long trimToFit() {

        int ageSeconds = Settings.Global.getInt(mContentResolver,
                Settings.Global.DROPBOX_AGE_SECONDS, DEFAULT_AGE_SECONDS);
        int maxFiles = Settings.Global.getInt(mContentResolver,
                Settings.Global.DROPBOX_MAX_FILES, DEFAULT_MAX_FILES);
        long cutoffMillis = System.currentTimeMillis() - ageSeconds * 1000;
        
        while (!mAllFiles.contents.isEmpty()) {
            EntryFile entry = mAllFiles.contents.first();
            //当最老的文件时间戳在3天之内，且文件个数低于1000，则跳出循环
            if (entry.timestampMillis > cutoffMillis 
                && mAllFiles.contents.size() < maxFiles) break;
            FileList tag = mFilesByTag.get(entry.tag);
            if (tag != null && tag.contents.remove(entry)) tag.blocks -= entry.blocks;
            if (mAllFiles.contents.remove(entry)) mAllFiles.blocks -= entry.blocks;
            if (entry.file != null) entry.file.delete(); //删除文件
        }

        long uptimeMillis = SystemClock.uptimeMillis();
        //除非接收设备存储低的广播，否则间隔5s才能再次执行restat
        if (uptimeMillis > mCachedQuotaUptimeMillis + QUOTA_RESCAN_MILLIS) {
            int quotaPercent = Settings.Global.getInt(mContentResolver,
                    Settings.Global.DROPBOX_QUOTA_PERCENT, DEFAULT_QUOTA_PERCENT);
            int reservePercent = Settings.Global.getInt(mContentResolver,
                    Settings.Global.DROPBOX_RESERVE_PERCENT, DEFAULT_RESERVE_PERCENT);
            int quotaKb = Settings.Global.getInt(mContentResolver,
                    Settings.Global.DROPBOX_QUOTA_KB, DEFAULT_QUOTA_KB);
            //重新统计文件
            mStatFs.restat(mDropBoxDir.getPath());
            int available = mStatFs.getAvailableBlocks();
            int nonreserved = available - mStatFs.getBlockCount() * reservePercent / 100;
            int maximum = quotaKb * 1024 / mBlockSize;
            //可用的块数量
            mCachedQuotaBlocks = Math.min(maximum, Math.max(0, nonreserved * quotaPercent / 100));
            mCachedQuotaUptimeMillis = uptimeMillis;
        }

        if (mAllFiles.blocks > mCachedQuotaBlocks) {
            //公平地限制所有tag的空间
            int unsqueezed = mAllFiles.blocks, squeezed = 0;
            TreeSet<FileList> tags = new TreeSet<FileList>(mFilesByTag.values());
            for (FileList tag : tags) {
                if (squeezed > 0 && tag.blocks <= (mCachedQuotaBlocks - unsqueezed) / squeezed) {
                    break;
                }
                unsqueezed -= tag.blocks;
                squeezed++;
            }
            int tagQuota = (mCachedQuotaBlocks - unsqueezed) / squeezed;

            //移除每个tags中的旧items
            for (FileList tag : tags) {
                if (mAllFiles.blocks < mCachedQuotaBlocks) break;
                while (tag.blocks > tagQuota && !tag.contents.isEmpty()) {
                    EntryFile entry = tag.contents.first();
                    if (tag.contents.remove(entry)) tag.blocks -= entry.blocks;
                    if (mAllFiles.contents.remove(entry)) mAllFiles.blocks -= entry.blocks;

                    try {
                        if (entry.file != null) entry.file.delete();
                        enrollEntry(new EntryFile(mDropBoxDir, entry.tag, entry.timestampMillis));
                    } catch (IOException e) {
                        Slog.e(TAG, "Can't write tombstone file", e);
                    }
                }
            }
        }

        return mCachedQuotaBlocks * mBlockSize;
    }

trimToFit过程中触发条件是：当文件有效时长超过3天，或者最大文件数超过1000，再或者剩余可用存储设备过低；

DBMS有很多常量参数：

- DEFAULT_AGE_SECONDS = 3 * 86400：文件最长可存活时长为3天
- DEFAULT_MAX_FILES = 1000：最大dropbox文件个数为1000
- DEFAULT_QUOTA_KB = 5 * 1024：分配dropbox空间的最大值5M
- DEFAULT_QUOTA_PERCENT = 10：是指dropbox目录最多可占用空间比例10%
- DEFAULT_RESERVE_PERCENT = 10：是指dropbox不可使用的存储空间比例10%
- QUOTA_RESCAN_MILLIS = 5000：重新扫描retrim时长为5s

当然上面这些都是默认值，完全可以通过设置`content://settings/global`数据库中相应项来设定值。

## 二、DropBox工作

当发生以下任一场景，都会调用AMS.addErrorToDropBox()来触发DBMS工作。

- **crash:** 文章[理解Android Crash处理流程](http://gityuan.com/2016/06/24/app-crash/) [小节4]的AMS.handleApplicationCrashInner过程。
- **anr:** 文章[android ANR原理分析](http://gityuan.com/2016/07/02/android-anr/)[小节3.1]的AMS.appNotResponding()过程；
- **watchdog:** 文章[WatchDog工作原理](http://gityuan.com/2016/06/21/watchdog/) [小节3.1]的Watchdog.run()过程;
- **wtf:** 当调用Log.wtf()或者Log.wtfQuiet的过程；
- **lowmem:** 当内存较低时，触发AMS.reportMemUsage()过程；
- ...


### 2.1 AMS.addErrorToDropBox

[–>ActivityManagerService.java]

    public void addErrorToDropBox(String eventType,
            ProcessRecord process, String processName, ActivityRecord activity,
            ActivityRecord parent, String subject,
            final String report, final File logFile,
            final ApplicationErrorReport.CrashInfo crashInfo) {

        //如果是普通App崩溃，则dropboxTag为data_app_crash【见小节2.1.1】
        final String dropboxTag = processClass(process) + "_" + eventType;
        //获取dropbox服务的代理端
        final DropBoxManager dbox = (DropBoxManager)
                mContext.getSystemService(Context.DROPBOX_SERVICE);

        //当不需要输出dropbox报告则直接返回
        if (dbox == null || !dbox.isTagEnabled(dropboxTag)) return;

        final StringBuilder sb = new StringBuilder(1024);
        //输出Process,flags,以及进程中所有package
        appendDropBoxProcessHeaders(process, processName, sb);
        ...
        sb.append("Build: ").append(Build.FINGERPRINT).append("\n");
        sb.append("\n");

        //创建新线程，避免将调用者阻塞在I/O
        Thread worker = new Thread("Error dump: " + dropboxTag) {
            @Override
            public void run() {
                if (report != null) {
                    //比如ANR时输出Cpuinfo，或者lowmem时输出的内存信息
                    sb.append(report); 
                }
                if (logFile != null) {
                    //比如anr或者Watchdog时输出的traces文件(kill -3)，最大上限为256KB
                    sb.append(FileUtils.readTextFile(logFile, DROPBOX_MAX_SIZE,
                                "\n\n[[TRUNCATED]]"));
                }
                if (crashInfo != null && crashInfo.stackTrace != null) {
                    // 比如crash时输出的调用栈
                    sb.append(crashInfo.stackTrace);
                }

                String setting = Settings.Global.ERROR_LOGCAT_PREFIX + dropboxTag;
                int lines = Settings.Global.getInt(mContext.getContentResolver(), setting, 0);
                //当dropboxTag所对应的settings项不等于0，则输出logcat
                if (lines > 0) {
                  //输出evets/system/main/crash这些log信息
                  java.lang.Process logcat = new ProcessBuilder("/system/bin/logcat",
                          "-v", "time", "-b", "events", "-b", "system", "-b", "main",
                          "-b", "crash",
                          "-t", String.valueOf(lines)).redirectErrorStream(true).start();

                  input = new InputStreamReader(logcat.getInputStream());

                  int num;
                  char[] buf = new char[8192];
                  //不断读取input中的log内容，并添加到sb
                  while ((num = input.read(buf)) > 0) sb.append(buf, 0, num);
                  ...
                }
                //将log信息输出到DropBox 【见小节2.2】
                dbox.addText(dropboxTag, sb.toString());
            }
        };

        if (process == null) {
            //当进程为空，意味着system_server进程崩溃，系统可能很快就要挂了,
            //那么不再创建新线程，而是直接在system_server进程中同步运行
            worker.run();
        } else {
            //启动新线程
            worker.start();
        }
    }

该方法主要功能是输出以下内容项：

1. Process,flags, package等头信息；
2. 当report不为空，则比如ANR时输出Cpuinfo，或者lowmem时输出的内存信息
2. 当logFile不为空，则比如anr或者Watchdog时输出的traces文件(kill -3)，最大上限为256KB；
3. 当stack不为空，则比如crash时输出的调用栈；
4. 输出logcat的events/system/main/crash信息。

#### 2.1.1 AMS.processClass

    private static String processClass(ProcessRecord process) {
        //MY_PID代表的是当前进程pid，正是system_server进程
        if (process == null || process.pid == MY_PID) {
            return "system_server";
        } else if ((process.info.flags & ApplicationInfo.FLAG_SYSTEM) != 0) {
            return "system_app";
        } else {
            return "data_app";
        }
    }

dropbox文件名格式为`dropboxTag@xxx.txt`，其中dropboxTag是由processClass(process) + "_" + eventType构成：

- processClass：分为`system_server`, `system_app`, `data_app`;
- eventType：分为`crash`,`anr`,`wtf`等
- xxx：代表时间戳;
- 后缀：除了`.txt`，还有压缩格式`.txt.gz`     

例如`system_server_crash@1465650845355.txt`，代表的是system_server进程出现crash，记录该文件时间戳为1465650845355。

### 2.2 DBM.addText

[-> DropBoxManager.java]

    public void addText(String tag, String data) {
        try { 
            //data数据封装到Entry对象实例 【见小节2.3】
            mService.add(new Entry(tag, 0, data)); 
        } catch (RemoteException e) {
            ...
        }
    }

在DropBoxManager中有addText, addData, addFile方法，三分归一统，对应于DBMS的add()方法。

### 2.3 DBMS.add

    public void add(DropBoxManager.Entry entry) {
        File temp = null;
        OutputStream output = null;
        final String tag = entry.getTag();
        try {
            int flags = entry.getFlags();
            ...
            init(); // 初始化【见小节1.3.1】
            long max = trimToFit(); // 压缩空间【见小节1.3.2】
            long lastTrim = System.currentTimeMillis();
            byte[] buffer = new byte[mBlockSize];
            InputStream input = entry.getInputStream();

            int read = 0;
            while (read < buffer.length) {
                int n = input.read(buffer, read, buffer.length - read);
                if (n <= 0) break;
                read += n;
            }
            //创建临时文件，例如tid=1234的对应文件drop1234.tmp
            temp = new File(mDropBoxDir, "drop" + Thread.currentThread().getId() + ".tmp");
            int bufferSize = mBlockSize;
            if (bufferSize > 4096) bufferSize = 4096;
            if (bufferSize < 512) bufferSize = 512;
            FileOutputStream foutput = new FileOutputStream(temp);
            output = new BufferedOutputStream(foutput, bufferSize);
            //创建gzip压缩文件
            if (read == buffer.length && ((flags & DropBoxManager.IS_GZIPPED) == 0)) {
                output = new GZIPOutputStream(output);
                flags = flags | DropBoxManager.IS_GZIPPED;
            }

            //不断将temp文件数据写入buffer
            do {
                output.write(buffer, 0, read);
                long now = System.currentTimeMillis();
                if (now - lastTrim > 30 * 1000) {
                    max = trimToFit(); //执行时间超过30s则执行trim
                    lastTrim = now;
                }

                read = input.read(buffer);
                if (read <= 0) {
                    FileUtils.sync(foutput);
                    output.close();
                    output = null;
                } else {
                    output.flush();
                }

                long len = temp.length();
                if (len > max) {
                    temp.delete();
                    temp = null;
                    break;
                }
            } while (read > 0);

            long time = createEntry(temp, tag, flags);
            temp = null;

            final Intent dropboxIntent = new Intent(DropBoxManager.ACTION_DROPBOX_ENTRY_ADDED);
            dropboxIntent.putExtra(DropBoxManager.EXTRA_TAG, tag);
            dropboxIntent.putExtra(DropBoxManager.EXTRA_TIME, time);
            if (!mBooted) {
                dropboxIntent.addFlags(Intent.FLAG_RECEIVER_REGISTERED_ONLY);
            }
            //发送广播MSG_SEND_BROADCAST
            mHandler.sendMessage(mHandler.obtainMessage(MSG_SEND_BROADCAST, dropboxIntent));
        } catch (IOException e) {
            ...
        } finally {
            if (output != null) output.close();
            entry.close();
            if (temp != null) temp.delete();
        }
    }

## 三. 总结

DBMS服务的数据保存目录为`/data/system/dropbox`。

当出现crash, anr, wtf，lowmem，以及开机完成时都会通过DropBoxManager，
收集系统的重要信息： Process,flags, package等头信息和logcat信息。
另外就是根据不同场景输出相应的信息，例如：

1. CRASH：输出发生crash时的当前线程的调用栈信息；
2. ANR：输出Cpuinfo，以及重要进程的各个线程的traces文件(kill -3)；
3. Watchdog: 也输出重要进程的各个线程的traces文件(kill -3)
