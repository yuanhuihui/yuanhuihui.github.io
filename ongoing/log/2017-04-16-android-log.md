---
layout: post
title:  "Android log机制分析"
date:   2016-12-01 11:30:00
catalog:  true
tags:
    - android

---

    frameworks/base/core/java/android/util/
        - Log.java
        - Slog.java
        - EventLog.java

    frameworks/base/core/jni/android_util_Log.cpp

    /system/core/logcat/logcat.cpp
    /system/core/liblog/logd_write.c
    /system/core/liblog/uio.c

    /system/core/logd/
        - main.cpp
        - LogBuffer.cpp
        - LogStatistics.cpp
    /system/core/libsysutils/src/SocketListener.cpp

## 一. 概述

无论是Android系统开发，还是应用开发，都离不开log，Androd上层采用logcat输出log。


### 1.1 logcat命令说明
可通过adb命令直接输出指定的log:

    logcat -b events // 输出指定buffer的log
    logcat -s "ActivityManager"
    logcat -L //上次重启时的log
    logcat -f [filename] //将log保存到指定文件
    logcat -g //缓冲区大小
    logcat -S  //统计log信息

-b <buffer>默认是指-b main -b system -b crash, 当然一可以指定其他参数, 或者直接指定all.

## 二. log函数使用

### 2.1 Java层

默认定义了5个Buffer缓冲区,如下:

|ID|名称|使用方式|
|---|---|---|
|LOG_ID_MAIN|main|Log.i|
|LOG_ID_RADIO|radio|Rlog.i|
|LOG_ID_EVENTS|events|EventLog.writeEvent|
|LOG_ID_SYSTEM|system|Slog.i|
|LOG_ID_CRASH|crash|-|


log级别:

|级别|对应值|使用场景|
|---|---|
|VERBOSE|2|冗长信息|
|DEBUG|3|调试信息|
|INFO|4|普通信息
|WARN|5|警告信息
|ERROR|6|错误信息
|ASSERT|7|普通但重要的信息


### 2.2 Native层

### 2.3 Kernel层

Linux Kernel最常使用的是printk，用法如下：

    //第一个参数是级别， 第二个是具体log内容
    printk(KERN_INFO x);

日志级别的定义位于kernel/include/linux/printk.h文件，如下：

|级别|对应值|使用场景|
|---|---|
|KERN_EMERG|<0>|系统不可用状态|
|KERN_ALERT|<1>|警报信息，必须立即采取信息|
|KERN_CRIT|<2>|严重错误信息
|KERN_ERR|<3>|错误信息
|KERN_WARNING|<4>|警告信息
|KERN_NOTICE|<5>|普通但重要的信息
|KERN_INFO|<6>|普通信息
|KERN_DEBUG|<7>|调试信息

日志输出到文件/proc/kmsg，可通过`cat /proc/kmsg`来获取内核log信息。

cat /proc/sys/kernel/printk
### 2.4 buffer大小

LogBuffer.cpp

[persist.logd.size]: [2M]
[persist.logd.size.radio]: [4M]

可知
radio = 4M, 其他都为2M.


## 三. 原理分析

### 3.1 Log.i
[-> android/util/Log.java]

    public static int i(String tag, String msg) {
        // [见小节3.2]
        return println_native(LOG_ID_MAIN, INFO, tag, msg);
    }

Log.java中的方法都是输出到main buffer, 其中println_native是Native方法，
通过JNI调用如下方法。

### 3.2 println_native
[-> android_util_Log.cpp]

    static jint android_util_Log_println_native(JNIEnv* env, jobject clazz,
            jint bufID, jint priority, jstring tagObj, jstring msgObj)
    {
        const char* tag = NULL;
        const char* msg = NULL;
        ...

        //获取log标签和内容
        if (tagObj != NULL)
            tag = env->GetStringUTFChars(tagObj, NULL);
        msg = env->GetStringUTFChars(msgObj, NULL);
        // [见小节3.3]
        int res = __android_log_buf_write(bufID, (android_LogPriority)priority, tag, msg);

        if (tag != NULL)
            env->ReleaseStringUTFChars(tagObj, tag);
        env->ReleaseStringUTFChars(msgObj, msg);

        return res;
    }

### 3.3  __android_log_buf_write
[-> logd_write.c]

    int __android_log_buf_write(int bufID, int prio, const char *tag, const char *msg)
    {
        struct iovec vec[3];
        char tmp_tag[32];
        ...

        if ((bufID != LOG_ID_RADIO) &&
             (!strcmp(tag, "HTC_RIL") ||
            !strncmp(tag, "RIL", 3) || // RIL为前缀
            !strncmp(tag, "IMS", 3) || // IMS为前缀
            !strcmp(tag, "AT") ||
            !strcmp(tag, "GSM") ||
            !strcmp(tag, "STK") ||
            !strcmp(tag, "CDMA") ||
            !strcmp(tag, "PHONE") ||
            !strcmp(tag, "SMS"))) {
                bufID = LOG_ID_RADIO;
                //满足以上条件的tag，则默认输出到radio缓冲区，并修改相应的tags
                snprintf(tmp_tag, sizeof(tmp_tag), "use-Rlog/RLOG-%s", tag);
                tag = tmp_tag;
        }
        ...

        vec[0].iov_base   = (unsigned char *) &prio;
        vec[0].iov_len    = 1;
        vec[1].iov_base   = (void *) tag;
        vec[1].iov_len    = strlen(tag) + 1;
        vec[2].iov_base   = (void *) msg;
        vec[2].iov_len    = strlen(msg) + 1;
        // [见小节3.4]
        return write_to_log(bufID, vec, 3);
    }

- 对于满足特殊条件的tag，则会输出到LOG_ID_RADIO缓冲区；
- vec数组依次记录着log的级别，tag, msg.

其中write_to_log函数指针指向__write_to_log_init

    static int (*write_to_log)(log_id_t, struct iovec *vec, size_t nr) = __write_to_log_init;

### 3.4 write_to_log
[-> logd_write.c]

    static int __write_to_log_init(log_id_t log_id, struct iovec *vec, size_t nr)
    {
        ...
        if (write_to_log == __write_to_log_init) {
            int ret;
            ret = __write_to_log_initialize(); //执行log初始化【见小节3.4.1】
            if (ret < 0) {
                if (pstore_fd >= 0) {
                    __write_to_log_daemon(log_id, vec, nr); //【见小节3.5】
                }
                return ret;
            }
            write_to_log = __write_to_log_daemon;
        }
        ...
        return write_to_log(log_id, vec, nr);
    }

#### 3.4.1 __write_to_log_initialize

    static int __write_to_log_initialize()
    {
        int i, ret = 0;
        if (pstore_fd < 0) {
            //打开pstore文件, 用于panic时记录上次重启前的log
            pstore_fd = TEMP_FAILURE_RETRY(open("/dev/pmsg0", O_WRONLY));
        }

        if (logd_fd < 0) { //首次执行logd_fd = -1
            // 初始化socket
            i = TEMP_FAILURE_RETRY(socket(PF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0));
            if (i < 0) {
                ret = -errno;
            //设置为非阻塞模式
            } else if (TEMP_FAILURE_RETRY(fcntl(i, F_SETFL, O_NONBLOCK)) < 0) {
                ret = -errno;
                close(i);
            } else {
                struct sockaddr_un un;
                memset(&un, 0, sizeof(struct sockaddr_un));
                un.sun_family = AF_UNIX;
                strcpy(un.sun_path, "/dev/socket/logdw"); // socket通道
                // 连接该socket
                if (TEMP_FAILURE_RETRY(connect(i, (struct sockaddr *)&un,
                                               sizeof(struct sockaddr_un))) < 0) {
                    ret = -errno;
                    close(i);
                } else {
                    logd_fd = i; // 将新打开的socket的文件描述符赋予该logd_fd.
                }
            }
        }
        return ret;
    }

该方法主要功能:

1. 打开pstore文件, 用于panic时记录上次重启前的log; (只打开一次);
2. 初始化并连接socket ("/dev/socket/logdw"), 设置为非阻塞模式;
3. 将socket的文件描述符赋予该logd_fd.

接下来进入真正写log的方法.

### 3.5 __write_to_log_daemon

    static int __write_to_log_daemon(log_id_t log_id, struct iovec *vec, size_t nr)
    {
        ssize_t ret;
        ...
        static const unsigned header_length = 2;
        struct iovec newVec[nr + header_length];
        android_log_header_t header;
        android_pmsg_log_header_t pmsg_header;
        struct timespec ts;
        size_t i, payload_size;
        static uid_t last_uid = AID_ROOT;
        static pid_t last_pid = (pid_t) -1;
        static atomic_int_fast32_t dropped;
        ...

        if (last_uid == AID_ROOT) {
            last_uid = getuid(); //获取uid
        }
        if (last_pid == (pid_t) -1) {
            last_pid = getpid(); //获取pid
        }

        clock_gettime(CLOCK_REALTIME, &ts); //获取realtime

        pmsg_header.magic = LOGGER_MAGIC;
        pmsg_header.len = sizeof(pmsg_header) + sizeof(header);
        pmsg_header.uid = last_uid;
        pmsg_header.pid = last_pid;

        header.tid = gettid(); //获取tid
        header.realtime.tv_sec = ts.tv_sec;
        header.realtime.tv_nsec = ts.tv_nsec;

        newVec[0].iov_base   = (unsigned char *) &pmsg_header;
        newVec[0].iov_len    = sizeof(pmsg_header);
        newVec[1].iov_base   = (unsigned char *) &header;
        newVec[1].iov_len    = sizeof(header);

        if (logd_fd > 0) {
            int32_t snapshot = atomic_exchange_explicit(&dropped, 0, memory_order_relaxed);
            if (snapshot) {
                android_log_event_int_t buffer;

                header.id = LOG_ID_EVENTS;
                buffer.header.tag = htole32(LIBLOG_LOG_TAG);
                buffer.payload.type = EVENT_TYPE_INT;
                buffer.payload.data = htole32(snapshot);

                newVec[2].iov_base = &buffer;
                newVec[2].iov_len  = sizeof(buffer);
                ret = TEMP_FAILURE_RETRY(writev(logd_fd, newVec + 1, 2));
                if (ret != (ssize_t)(sizeof(header) + sizeof(buffer))) {
                    atomic_fetch_add_explicit(&dropped, snapshot, memory_order_relaxed);
                }
            }
        }
        header.id = log_id;

        for (payload_size = 0, i = header_length; i < nr + header_length; i++) {
            newVec[i].iov_base = vec[i - header_length].iov_base;
            payload_size += newVec[i].iov_len = vec[i - header_length].iov_len;
            // 限制每条log最大为4076b
            if (payload_size > LOGGER_ENTRY_MAX_PAYLOAD) {
                newVec[i].iov_len -= payload_size - LOGGER_ENTRY_MAX_PAYLOAD;
                if (newVec[i].iov_len) {
                    ++i;
                }
                payload_size = LOGGER_ENTRY_MAX_PAYLOAD;
                break;
            }
        }
        pmsg_header.len += payload_size;

        if (pstore_fd >= 0) {
            //写入pstore
            TEMP_FAILURE_RETRY(writev(pstore_fd, newVec, i));
        }
        ...

        // 写入logd[见小节3.6]
        ret = TEMP_FAILURE_RETRY(writev(logd_fd, newVec + 1, i - 1));
        ...
        if (ret > (ssize_t)sizeof(header)) {
            ret -= sizeof(header);
        } else if (ret == -EAGAIN) {
            atomic_fetch_add_explicit(&dropped, 1, memory_order_relaxed);
        }
        return ret;
    }

该方法的主要功能, 准备log相关的信息:

- pid
- uid
- tid
- realtime
- msg

### 3.6 writev
[-> uio.c]

    int  writev( int  fd, const struct iovec*  vecs, int  count )
    {
        int   total = 0;
        for ( ; count > 0; count--, vecs++ ) {
            const char*  buf = vecs->iov_base;
            int          len = vecs->iov_len;

            while (len > 0) {
                //将数据写入fd
                int  ret = write( fd, buf, len );
                ...
                total += ret;
                buf   += ret;
                len   -= ret;
            }
        }
    Exit:
        return total;
    }

此处write过程其实是向logd的socket ("/dev/socket/logdw")写入日志信息, 接下来看看logd的过程.

## 四. logd守护进程

logd作为守护进程

    service logd /system/bin/logd
        class core
        socket logd stream 0666 logd logd
        socket logdr seqpacket 0666 logd logd
        socket logdw dgram 0222 logd logd
        group root system

创建3个socket通道,用于进程间通信.

### 4.1  main()
[-> /system/core/logd/main.cpp]

    int main(int argc, char *argv[]) {
        int fdPmesg = -1;
        bool klogd = true;
        if (klogd) {
            //以只读方式 打开内核log的/proc/kmsg
            fdPmesg = open("/proc/kmsg", O_RDONLY | O_NDELAY);
        }
        //以读写方式打开/dev/kmsg
        fdDmesg = open("/dev/kmsg", O_WRONLY);

        //处理reinit命令
        if ((argc > 1) && argv[1] && !strcmp(argv[1], "--reinit")) {
            int sock = TEMP_FAILURE_RETRY(socket_local_client("logd",
                            ANDROID_SOCKET_NAMESPACE_RESERVED,SOCK_STREAM));
            ...
            static const char reinit[] = "reinit";
            //写入"reinit"
            ssize_t ret = TEMP_FAILURE_RETRY(write(sock, reinit, sizeof(reinit)));
            ...

            struct pollfd p;
            memset(&p, 0, sizeof(p));
            p.fd = sock;
            p.events = POLLIN;
            ret = TEMP_FAILURE_RETRY(poll(&p, 1, 100)); //进入poll轮询
            ...

            static const char success[] = "success";
            char buffer[sizeof(success) - 1];
            memset(buffer, 0, sizeof(buffer));
            //读取数据,保存到buffer
            ret = TEMP_FAILURE_RETRY(read(sock, buffer, sizeof(buffer)));
            ...
            //比较读取的数据是否为"success"
            return strncmp(buffer, success, sizeof(success) - 1) != 0;
        }

        sem_init(&reinit, 0, 0);
        sem_init(&uidName, 0, 0);
        sem_init(&sem_name, 0, 1);
        pthread_attr_t attr;
        if (!pthread_attr_init(&attr)) {
            ...
            if (!pthread_attr_setdetachstate(&attr, PTHREAD_CREATE_DETACHED)) {
                pthread_t thread;
                reinit_running = true;
                //创建线程"logd.daemon", 该线程入口函数reinit_thread_start()
                if (pthread_create(&thread, &attr, reinit_thread_start, NULL)) {
                    reinit_running = false;
                }
            }
            pthread_attr_destroy(&attr);
        }
        ...

        LastLogTimes *times = new LastLogTimes();

        //创建LogBuffer对象
        logBuf = new LogBuffer(times);

        signal(SIGHUP, reinit_signal_handler);

        if (property_get_bool_svelte("logd.statistics")) {
            logBuf->enableStatistics();
        }

        //监听/dev/socket/logdr, 当client连接上则将buffer信息写入client.
        LogReader *reader = new LogReader(logBuf);
        if (reader->startListener()) {
            exit(1);
        }

        //监听/dev/socket/logdw, 新日志添加到LogBuffer, 并且LogReader发送更新给已连接的client
        LogListener *swl = new LogListener(logBuf, reader);
        if (swl->startListener(300)) {
            exit(1);
        }

        //监听/dev/socket/logd, 处理logd管理命令
        CommandListener *cl = new CommandListener(logBuf, reader, swl);
        if (cl->startListener()) {
            exit(1);
        }

        bool auditd = property_get_bool("logd.auditd", true);

        LogAudit *al = NULL;
        if (auditd) {
            bool dmesg = property_get_bool("logd.auditd.dmesg", true);
            al = new LogAudit(logBuf, reader, dmesg ? fdDmesg : -1);
        }

        LogKlog *kl = NULL;
        if (klogd) {
            kl = new LogKlog(logBuf, reader, fdDmesg, fdPmesg, al != NULL);
        }

        readDmesg(al, kl);

        if (kl && kl->startListener()) {
            delete kl;
        }

        if (al && al->startListener()) {
            delete al;
        }

        TEMP_FAILURE_RETRY(pause());

        exit(0);
    }

该方法功能:

1. LogReader: 监听/dev/socket/logdr, 当client连接上则将buffer信息写入client. 所对应线程名"logd.reader"
2. LogListener: 监听/dev/socket/logdw, 新日志添加到LogBuffer, 并且LogReader发送更新给已连接的client.  所对应线程名"logd.writer"
3. CommandListener: 监听/dev/socket/logd, 处理logd管理命令. 所对应线程名"logd.control"
4. LogAudit: 所对应线程名"logd.auditd"
5. LogKlog:  所对应线程名"logd.klogd"
6. 入口reinit_thread_start: 所对应线程名"logd.daemon"
7. LogTimeEntry::threadStart:  所对应线程名"ogd.reader.per"

另外, ANDROID_SOCKET_NAMESPACE_RESERVED代表位于/dev/socket名字空间.

通过adb命令, 可以看到logd进程有9个子线程.

    logd      381   1     21880  9132  sigsuspend 7f8301fdac S /system/bin/logd
    system    382   381   21880  9132  futex_wait 7f82fcf9c4 S logd.daemon
    logd      383   381   21880  9132  poll_sched 7f8301fd1c S logd.reader
    logd      384   381   21880  9132  poll_sched 7f8301fd1c S logd.writer
    logd      385   381   21880  9132  poll_sched 7f8301fd1c S logd.control
    logd      392   381   21880  9132  poll_sched 7f8301fd1c S logd.klogd
    logd      393   381   21880  9132  poll_sched 7f8301fd1c S logd.auditd
    logd      3716  381   21880  9132  futex_wait 7f82fcf9c4 S logd.reader.per
    logd      4329  381   21880  9132  futex_wait 7f82fcf9c4 S logd.reader.per
    logd      5224  381   21880  9132  futex_wait 7f82fcf9c4 S logd.reader.per

接下来, 继续回到前面log输出过程, 接下来进入logd的LogListener处理过程, 如下:

### 4.2 LogListener
[-> LogListener.cpp]

    int main(int argc, char *argv[]) {
        ...
        logBuf = new LogBuffer(times); //[见小节4.2.1]
        LogListener *swl = new LogListener(logBuf, reader); //[见小节4.2.2]
        if (swl->startListener(300)) { //[见小节4.3]
            exit(1);
        }
        ...
    }

#### 4.2.1 LogBuffer.init(
[-> LogBuffer.cpp]

    void LogBuffer::init() {
        static const char global_tuneable[] = "persist.logd.size";
        static const char global_default[] = "ro.logd.size";
        //获取buffer默认大小
        unsigned long default_size = property_get_size(global_tuneable);
        if (!default_size) {
            default_size = property_get_size(global_default);
        }

        log_id_for_each(i) {
            char key[PROP_NAME_MAX];

            snprintf(key, sizeof(key), "%s.%s",
                     global_tuneable, android_log_id_to_name(i));
            unsigned long property_size = property_get_size(key);

            if (!property_size) {
                snprintf(key, sizeof(key), "%s.%s",
                         global_default, android_log_id_to_name(i));
                //比如获取的是persist.logd.size.system所对应的值
                property_size = property_get_size(key);
            }

            if (!property_size) {
                property_size = default_size;
            }

            if (!property_size) {
                //此值为256k
                property_size = LOG_BUFFER_SIZE;
            }

            if (setSize(i, property_size)) {
                //此值为64k
                setSize(i, LOG_BUFFER_MIN_SIZE);
            }
        }
    }

buffer大小的优先级顺序为:

1. persist.logd.size.xxx; 比如persist.logd.size.system;
2. persist.logd.size;
3. ro.logd.size;
4. LOG_BUFFER_SIZE, 即256k;
5. LOG_BUFFER_MIN_SIZE, 即64k.


#### 4.2.2 LogListener
[-> LogListener.cpp]

    LogListener::LogListener(LogBuffer *buf, LogReader *reader) :
            SocketListener(getLogSocket(), false),
            logbuf(buf),
            reader(reader) {
    }

此处getLogSocket()过程创建logdw的服务端,并监听客户端消息.

#### 4.2.3  SocketListener

    SocketListener::SocketListener(int socketFd, bool listen) {
        init(NULL, socketFd, listen, false);
    }

    void SocketListener::init(const char *socketName, int socketFd, bool listen, bool useCmdNum) {
        mListen = listen; // mListen=false
        mSocketName = socketName;
        mSock = socketFd;
        mUseCmdNum = useCmdNum;
        pthread_mutex_init(&mClientsLock, NULL);
        mClients = new SocketClientCollection();
    }

### 4.3 startListener
[-> SocketListener.cpp]

    int SocketListener::startListener() {
        return startListener(4);
    }

    int SocketListener::startListener(int backlog) {

        if (!mSocketName && mSock == -1) {
            ...
        } else if (mSocketName) {
            if ((mSock = android_get_control_socket(mSocketName)) < 0) {
                ...
            }
            fcntl(mSock, F_SETFD, FD_CLOEXEC);
        }

        if (mListen && listen(mSock, backlog) < 0) {
            return -1;
        } else if (!mListen)
            mClients->push_back(new SocketClient(mSock, false, mUseCmdNum));

        if (pipe(mCtrlPipe)) {
            return -1;
        }

        //创建线程[见小节4.4]
        if (pthread_create(&mThread, NULL, SocketListener::threadStart, this)) {
            return -1;
        }

        return 0;
    }

### 4.4 threadStart
[-> SocketListener.cpp]

    void *SocketListener::threadStart(void *obj) {
        SocketListener *me = reinterpret_cast<SocketListener *>(obj);

        me->runListener(); //[见小节4.5]
        pthread_exit(NULL);
        return NULL;
    }

### 4.5 runListener
[-> SocketListener.cpp]

    void SocketListener::runListener() {
        SocketClientCollection pendingList;
        while(1) {
            ...
            while (!pendingList.empty()) {
                it = pendingList.begin(); //找到第一个即将要处理的客户端
                SocketClient* c = *it;
                pendingList.erase(it);
                //处理该消息[见小节4.6]
                if (!onDataAvailable(c)) {
                    release(c, false);
                }
                c->decRef();
            }
        }
    }

### 4.6 onDataAvailable
[-> LogListener.cpp]

    bool LogListener::onDataAvailable(SocketClient *cli) {
        static bool name_set;
        if (!name_set) {
            prctl(PR_SET_NAME, "logd.writer");
            name_set = true;
        }

        char buffer[sizeof_log_id_t + sizeof(uint16_t) + sizeof(log_time)
            + LOGGER_ENTRY_MAX_PAYLOAD];
        struct iovec iov = { buffer, sizeof(buffer) };
        memset(buffer, 0, sizeof(buffer));

        char control[CMSG_SPACE(sizeof(struct ucred))];
        struct msghdr hdr = {
            NULL,
            0,
            &iov, //记录buffer地址指针
            1,
            control,
            sizeof(control),
            0,
        };

        int socket = cli->getSocket();
         //通过socket接收消息,保存到hdr,其n代表消息长度
        ssize_t n = recvmsg(socket, &hdr, 0);
        ...

        struct ucred *cred = NULL;
        struct cmsghdr *cmsg = CMSG_FIRSTHDR(&hdr);
        //获取ucred信息
        while (cmsg != NULL) {
            if (cmsg->cmsg_level == SOL_SOCKET
                    && cmsg->cmsg_type  == SCM_CREDENTIALS) {
                cred = (struct ucred *)CMSG_DATA(cmsg);
                break;
            }
            cmsg = CMSG_NXTHDR(&hdr, cmsg);
        }
        if (cred == NULL) {
            return false;
        }
        ...

        //获取android_log_header_t结构体指针
        android_log_header_t *header = reinterpret_cast<android_log_header_t *>(buffer);
        if (header->id >= LOG_ID_MAX || header->id == LOG_ID_KERNEL) {
            return false;
        }
        char *msg = ((char *)buffer) + sizeof(android_log_header_t);
        n -= sizeof(android_log_header_t);

        //[见小节4.7]
        if (logbuf->log((log_id_t)header->id, header->realtime,
                cred->uid, cred->pid, header->tid, msg,
                ((size_t) n <= USHRT_MAX) ? (unsigned short) n : USHRT_MAX) >= 0) {
            //[见小节4.8]
            reader->notifyNewLog();
        }
        return true;
    }

该方法主要功能:

- LogBuffer.log()的参数说明:
    - android_log_header_t提供 log_id, realtime, tid
    - ucred提供 uid, pid.
    - msghdr提供 msg

### 4.7 LogBuffer.log
[-> LogBuffer.cpp]

    int LogBuffer::log(log_id_t log_id, log_time realtime,
                       uid_t uid, pid_t pid, pid_t tid,
                       const char *msg, unsigned short len) {
        ...
        //创建一条log信息
        LogBufferElement *elem = new LogBufferElement(log_id, realtime,
                                                      uid, pid, tid, msg, len);
        int prio = ANDROID_LOG_INFO;
        const char *tag = NULL;
        if (log_id == LOG_ID_EVENTS) {
            tag = android::tagToName(elem->getTag());
        } else {
            prio = *msg;
            tag = msg + 1;
        }
        if (!__android_log_is_loggable(prio, tag, ANDROID_LOG_VERBOSE)) {
            pthread_mutex_lock(&mLogElementsLock);
            stats.add(elem); //对于不运行输出log的状态下, 只统计log信息, 记录log本身
            stats.subtract(elem);
            pthread_mutex_unlock(&mLogElementsLock);
            delete elem;
            return -EACCES;
        }
        pthread_mutex_lock(&mLogElementsLock);
        LogBufferElementCollection::iterator it = mLogElements.end();
        LogBufferElementCollection::iterator last = it;
        //根据时间排序,找到应该插入的点
        while (last != mLogElements.begin()) {
            --it;
            if ((*it)->getRealTime() <= realtime) {
                break;
            }
            last = it;
        }

        //将log信息插入合适的位置
        if (last == mLogElements.end()) {
            mLogElements.push_back(elem);
        } else {
            uint64_t end = 1;
            bool end_set = false;
            bool end_always = false;

            LogTimeEntry::lock();
            LastLogTimes::iterator t = mTimes.begin();
            while(t != mTimes.end()) {
                LogTimeEntry *entry = (*t);
                if (entry->owned_Locked()) {
                    if (!entry->mNonBlock) {
                        end_always = true;
                        break;
                    }
                    if (!end_set || (end <= entry->mEnd)) {
                        end = entry->mEnd;
                        end_set = true;
                    }
                }
                t++;
            }
            if (end_always|| (end_set && (end >= (*last)->getSequence()))) {
                mLogElements.push_back(elem);
            } else {
                mLogElements.insert(last,elem);
            }
            LogTimeEntry::unlock();
        }

        stats.add(elem);  //[4.7.1]
        maybePrune(log_id); //[4.7.2]
        pthread_mutex_unlock(&mLogElementsLock);
        return len;
    }

#### 4.7.1 stats.add
[-> LogStatistics.cpp]

    void LogStatistics::add(LogBufferElement *e) {
        log_id_t log_id = e->getLogId();
        unsigned short size = e->getMsgLen();
        mSizes[log_id] += size; //对应的buffer所使用大小增加
        ++mElements[log_id]; //对应的buffer中log记录加1;

        mSizesTotal[log_id] += size;
        ++mElementsTotal[log_id];

        if (log_id == LOG_ID_KERNEL) {
            return;
        }

        //以uid为单位, 添加到uidTable表格
        uidTable[log_id].add(e->getUid(), e);

        if (!enable) {
            return;
        }

        pidTable.add(e->getPid(), e);
        tidTable.add(e->getTid(), e);

        uint32_t tag = e->getTag();
        if (tag) {
            tagTable.add(tag, e);
        }
    }

将log信息分别记录到uidTable, pidTable, tidTable, tagTable.

#### 4.7.2 maybePrune
[-> LogBuffer.cpp]

    void LogBuffer::maybePrune(log_id_t id) {
        size_t sizes = stats.sizes(id); //log占用内存大小
        unsigned long maxSize = log_buffer_size(id); //最大上限,比如2M
        if (sizes > maxSize) {
            size_t sizeOver = sizes - ((maxSize * 9) / 10); //超出90%的部分大小
            size_t elements = stats.realElements(id); // 真实的log行数
            size_t minElements = elements / 100; // 真实的log行数的1%行

            //minPrune = 4, 保证1%的log行数>=4
            if (minElements < minPrune) {
                minElements = minPrune;
            }
            unsigned long pruneRows = elements * sizeOver / sizes;
            if (pruneRows < minElements) { //保证>= 1%的log行数
                pruneRows = minElements;
            }

            //maxPrune = 256, 保证pruneRows<=256;
            if (pruneRows > maxPrune) {
                pruneRows = maxPrune;
            }
            prune(id, pruneRows); //[见小节4.7.3]
        }
    }


假设某个buffer的大小为2M:

    pruneRows = elements * sizeOver / sizes
              = elements * (1 - 0.9*(maxSize/sizes))
              = elements * (1 - 1.8/sizes);

其中elements代表的是当前buffer的log总行数;sizes代表对的是当前buffer的log总大小;
这就意味着某个buffer中的log真实行数越多,或者log的内存大小越大,则需要pruneRows的行数越多, 大致是总行数的10%, 并且满足区间[4, 256].


#### 4.7.3 prune
[-> LogBuffer.cpp]

    bool LogBuffer::prune(log_id_t id, unsigned long pruneRows, uid_t caller_uid) {
        LogTimeEntry *oldest = NULL;
        bool busy = false;
        bool clearAll = pruneRows == ULONG_MAX;

        LogTimeEntry::lock();

        LastLogTimes::iterator times = mTimes.begin();
        while(times != mTimes.end()) {
            LogTimeEntry *entry = (*times);
            if (entry->owned_Locked() && entry->isWatching(id)
                    && (!oldest ||
                        (oldest->mStart > entry->mStart) ||
                        ((oldest->mStart == entry->mStart) &&
                         (entry->mTimeout.tv_sec || entry->mTimeout.tv_nsec)))) {
                oldest = entry;
            }
            times++;
        }

        LogBufferElementCollection::iterator it;

        if (caller_uid != AID_ROOT) {
            it = mLastSet[id] ? mLast[id] : mLogElements.begin();
            while (it != mLogElements.end()) {
                LogBufferElement *element = *it;

                if ((element->getLogId() != id) || (element->getUid() != caller_uid)) {
                    ++it;
                    continue;
                }

                if (!mLastSet[id] || ((*mLast[id])->getLogId() != id)) {
                    mLast[id] = it;
                    mLastSet[id] = true;
                }

                if (oldest && (oldest->mStart <= element->getSequence())) {
                    busy = true;
                    if (oldest->mTimeout.tv_sec || oldest->mTimeout.tv_nsec) {
                        oldest->triggerReader_Locked();
                    } else {
                        oldest->triggerSkip_Locked(id, pruneRows);
                    }
                    break;
                }

                it = erase(it);
                pruneRows--;
            }
            LogTimeEntry::unlock();
            return busy;
        }

        //修剪 log最多的内容: 黑名单, uid, system uid的pid
        bool hasBlacklist = (id != LOG_ID_SECURITY) && mPrune.naughty();
        while (!clearAll && (pruneRows > 0)) {
            uid_t worst = (uid_t) -1;
            size_t worst_sizes = 0;
            size_t second_worst_sizes = 0;
            pid_t worstPid = 0;

            if (worstUidEnabledForLogid(id) && mPrune.worstUidEnabled()) {
                {   
                    std::unique_ptr<const UidEntry *[]> sorted = stats.sort(
                        AID_ROOT, (pid_t)0, 2, id);

                    if (sorted.get() && sorted[0] && sorted[1]) {
                        worst_sizes = sorted[0]->getSizes();
                        //buffer总大小的1/8为阈值
                        size_t threshold = log_buffer_size(id) / 8;
                        if ((worst_sizes > threshold)
                                && (worst_sizes > (10 * sorted[0]->getDropped()))) {
                            worst = sorted[0]->getKey();
                            second_worst_sizes = sorted[1]->getSizes();
                            if (second_worst_sizes < threshold) {
                                second_worst_sizes = threshold;
                            }
                        }
                    }
                }

                if ((worst == AID_SYSTEM) && mPrune.worstPidOfSystemEnabled()) {
                    // 对于system_server进程,根据pid来决策
                    std::unique_ptr<const PidEntry *[]> sorted = stats.sort(
                        worst, (pid_t)0, 2, id, worst);
                    if (sorted.get() && sorted[0] && sorted[1]) {
                        worstPid = sorted[0]->getKey(); //最糟糕的pid
                        second_worst_sizes = worst_sizes
                                           - sorted[0]->getSizes()
                                           + sorted[1]->getSizes();
                    }
                }
            }

            if ((worst == (uid_t) -1) && !hasBlacklist) {
                break;
            }

            bool kick = false;
            bool leading = true;
            it = mLastSet[id] ? mLast[id] : mLogElements.begin();
            bool gc = pruneRows <= 1;
            if (!gc && (worst != (uid_t) -1)) {
                {   
                    LogBufferIteratorMap::iterator found = mLastWorstUid[id].find(worst);
                    if ((found != mLastWorstUid[id].end())
                            && (found->second != mLogElements.end())) {
                        leading = false;
                        it = found->second;
                    }
                }
                if (worstPid) {
                    // begin scope for pid worst found iterator
                    LogBufferPidIteratorMap::iterator found
                        = mLastWorstPidOfSystem[id].find(worstPid);
                    if ((found != mLastWorstPidOfSystem[id].end())
                            && (found->second != mLogElements.end())) {
                        leading = false;
                        it = found->second;
                    }
                }
            }
            static const timespec too_old = {
                EXPIRE_HOUR_THRESHOLD * 60 * 60, 0
            };
            LogBufferElementCollection::iterator lastt;
            lastt = mLogElements.end();
            --lastt;
            LogBufferElementLast last;
            while (it != mLogElements.end()) {
                LogBufferElement *element = *it;

                if (oldest && (oldest->mStart <= element->getSequence())) {
                    busy = true;
                    if (oldest->mTimeout.tv_sec || oldest->mTimeout.tv_nsec) {
                        oldest->triggerReader_Locked();
                    }
                    break;
                }

                if (element->getLogId() != id) {
                    ++it;
                    continue;
                }

                if (leading && (!mLastSet[id] || ((*mLast[id])->getLogId() != id))) {
                    mLast[id] = it;
                    mLastSet[id] = true;
                }

                unsigned short dropped = element->getDropped();

                // remove any leading drops
                if (leading && dropped) {
                    it = erase(it);
                    continue;
                }

                if (dropped && last.coalesce(element, dropped)) {
                    it = erase(it, true);
                    continue;
                }

                if (hasBlacklist && mPrune.naughty(element)) {
                    last.clear(element);
                    it = erase(it);
                    if (dropped) {
                        continue;
                    }

                    pruneRows--;
                    if (pruneRows == 0) {
                        break;
                    }

                    if (element->getUid() == worst) {
                        kick = true;
                        if (worst_sizes < second_worst_sizes) {
                            break;
                        }
                        worst_sizes -= element->getMsgLen();
                    }
                    continue;
                }

                if ((element->getRealTime() < ((*lastt)->getRealTime() - too_old))
                        || (element->getRealTime() > (*lastt)->getRealTime())) {
                    break;
                }

                if (dropped) {
                    last.add(element);
                    if (worstPid
                            && ((!gc && (element->getPid() == worstPid))
                                || (mLastWorstPidOfSystem[id].find(element->getPid())
                                    == mLastWorstPidOfSystem[id].end()))) {
                        mLastWorstPidOfSystem[id][element->getUid()] = it;
                    }
                    if ((!gc && !worstPid && (element->getUid() == worst))
                            || (mLastWorstUid[id].find(element->getUid())
                                == mLastWorstUid[id].end())) {
                        mLastWorstUid[id][element->getUid()] = it;
                    }
                    ++it;
                    continue;
                }

                if ((element->getUid() != worst)
                        || (worstPid && (element->getPid() != worstPid))) {
                    leading = false;
                    last.clear(element);
                    ++it;
                    continue;
                }

                pruneRows--;
                if (pruneRows == 0) {
                    break;
                }

                kick = true;

                unsigned short len = element->getMsgLen();

                // do not create any leading drops
                if (leading) {
                    it = erase(it);
                } else {
                    stats.drop(element);
                    element->setDropped(1);
                    if (last.coalesce(element, 1)) {
                        it = erase(it, true);
                    } else {
                        last.add(element);
                        if (worstPid && (!gc
                                    || (mLastWorstPidOfSystem[id].find(worstPid)
                                        == mLastWorstPidOfSystem[id].end()))) {
                            mLastWorstPidOfSystem[id][worstPid] = it;
                        }
                        if ((!gc && !worstPid) || (mLastWorstUid[id].find(worst)
                                    == mLastWorstUid[id].end())) {
                            mLastWorstUid[id][worst] = it;
                        }
                        ++it;
                    }
                }
                if (worst_sizes < second_worst_sizes) {
                    break;
                }
                worst_sizes -= len;
            }
            last.clear();

            if (!kick || !mPrune.worstUidEnabled()) {
                break; // the following loop will ask bad clients to skip/drop
            }
        }

        bool whitelist = false;
        bool hasWhitelist = (id != LOG_ID_SECURITY) && mPrune.nice() && !clearAll;
        it = mLastSet[id] ? mLast[id] : mLogElements.begin();
        while((pruneRows > 0) && (it != mLogElements.end())) {
            LogBufferElement *element = *it;

            if (element->getLogId() != id) {
                it++;
                continue;
            }

            if (!mLastSet[id] || ((*mLast[id])->getLogId() != id)) {
                mLast[id] = it;
                mLastSet[id] = true;
            }

            if (oldest && (oldest->mStart <= element->getSequence())) {
                busy = true;
                if (whitelist) {
                    break;
                }

                if (stats.sizes(id) > (2 * log_buffer_size(id))) {
                    // kick a misbehaving log reader client off the island
                    oldest->release_Locked();
                } else if (oldest->mTimeout.tv_sec || oldest->mTimeout.tv_nsec) {
                    oldest->triggerReader_Locked();
                } else {
                    oldest->triggerSkip_Locked(id, pruneRows);
                }
                break;
            }

            if (hasWhitelist && !element->getDropped() && mPrune.nice(element)) {
                // WhiteListed
                whitelist = true;
                it++;
                continue;
            }

            it = erase(it);
            pruneRows--;
        }

        // Do not save the whitelist if we are reader range limited
        if (whitelist && (pruneRows > 0)) {
            it = mLastSet[id] ? mLast[id] : mLogElements.begin();
            while((it != mLogElements.end()) && (pruneRows > 0)) {
                LogBufferElement *element = *it;

                if (element->getLogId() != id) {
                    ++it;
                    continue;
                }

                if (!mLastSet[id] || ((*mLast[id])->getLogId() != id)) {
                    mLast[id] = it;
                    mLastSet[id] = true;
                }

                if (oldest && (oldest->mStart <= element->getSequence())) {
                    busy = true;
                    if (stats.sizes(id) > (2 * log_buffer_size(id))) {
                        // kick a misbehaving log reader client off the island
                        oldest->release_Locked();
                    } else if (oldest->mTimeout.tv_sec || oldest->mTimeout.tv_nsec) {
                        oldest->triggerReader_Locked();
                    } else {
                        oldest->triggerSkip_Locked(id, pruneRows);
                    }
                    break;
                }

                it = erase(it);
                pruneRows--;
            }
        }

        LogTimeEntry::unlock();

        return (pruneRows > 0) && busy;
    }


1. 处理黑名单以及log最多的那个uid的情况, 以及system uid中pid最多的, 删除;
2. 白名单的不删除

 PruneList::init()过程会完成黑白名单.

## 五. 总结

每一行log记录为LogBufferElement.

    SocketListener::runListener()
        LogListener.onDataAvailable
            LogBuffer::log
                LogBuffer::maybePrune
            LogReader::notifyNewLog
                SocketListener::runOnEachSocket
                FlushCommand::runSocketCommand

参数说明：

    name                       type default  description
    logd.auditd                 bool  true   Enable selinux audit daemon
    logd.auditd.dmesg           bool  true   selinux audit messages duplicated and
                                             sent on to dmesg log
    logd.klogd                  bool depends Enable klogd daemon
    logd.statistics             bool depends Enable logcat -S statistics.
    ro.config.low_ram           bool  false  if true, logd.statistics & logd.klogd
                                             default false
    ro.build.type               string       if user, logd.statistics & logd.klogd
                                             default false
    persist.logd.logpersistd    string       Enable logpersist daemon, "logcatd"
                                             turns on logcat -f in logd context
    persist.logd.size          number 256K   default size of the buffer for all
                                             log ids at initial startup, at runtime
                                             use: logcat -b all -G <value>
    persist.logd.size.main     number 256K   Size of the buffer for the main log
    persist.logd.size.system   number 256K   Size of the buffer for the system log
    persist.logd.size.radio    number 256K   Size of the buffer for the radio log
    persist.logd.size.event    number 256K   Size of the buffer for the event log
    persist.logd.size.crash    number 256K   Size of the buffer for the crash log

例如:

setprop persist.logd.size.system 2m
