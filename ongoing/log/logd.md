---
layout: post
title:  "logcat原理分析"
date:   2016-12-01 11:30:00
catalog:  true
tags:
    - android

---

    /framework/base/core/java/android/util/Log.java
    /frameworks/base/core/jni/android_util_Log.cpp
    /system/core/liblog/logd_write.c
    /system/core/liblog/uio.c
    
## 一、概述

无论是Android系统开发，还是应用开发，都离不开log，Androd采用logcat输出log。


### 二. Java Log 

### 2.1 Log.i()
[-> android/util/Log.java]

    public static int i(String tag, String msg) {
        // [见小节2.2]
        return println_native(LOG_ID_MAIN, INFO, tag, msg);
    }

Log.java中的方法都是输出到main buffer, 其中println_native是Native方法，
通过JNI调用如下方法。

### 2.2 println_native
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
        // [见小节2.3]
        int res = __android_log_buf_write(bufID, (android_LogPriority)priority, tag, msg);

        if (tag != NULL)
            env->ReleaseStringUTFChars(tagObj, tag);
        env->ReleaseStringUTFChars(msgObj, msg);

        return res;
    }

### 2.3 __android_log_buf_write
[-> logd_write.c]

    int __android_log_buf_write(int bufID, int prio, const char *tag, const char *msg)
    {
        struct iovec vec[3];
        char tmp_tag[32];

        if (!tag)
            tag = "";

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
        // [见小节2.4]
        return write_to_log(bufID, vec, 3);
    }

- 对于满足特殊条件的tag，则会输出到LOG_ID_RADIO缓冲区；
- vec数组依次记录着log的级别，tag, msg.

其中write_to_log函数指针指向__write_to_log_init

    static int (*write_to_log)(log_id_t, struct iovec *vec, size_t nr) = __write_to_log_init;
    
### 2.4 write_to_log
[-> logd_write.c]
    
    static int __write_to_log_init(log_id_t log_id, struct iovec *vec, size_t nr)
    {
    #if !defined(_WIN32)
        pthread_mutex_lock(&log_init_lock);
    #endif

        if (write_to_log == __write_to_log_init) {
            int ret;
            //执行log初始化【见小节2.4.1】
            ret = __write_to_log_initialize();
            if (ret < 0) {
    #if !defined(_WIN32)
                pthread_mutex_unlock(&log_init_lock);
    #endif
    #if (FAKE_LOG_DEVICE == 0)
                if (pstore_fd >= 0) {
                    //【见小节2.5】
                    __write_to_log_daemon(log_id, vec, nr);
                }
    #endif
                return ret;
            }

            write_to_log = __write_to_log_daemon;
        }

    #if !defined(_WIN32)
        pthread_mutex_unlock(&log_init_lock);
    #endif

        return write_to_log(log_id, vec, nr);
    }

#### 2.4.1 __write_to_log_initialize

    static int __write_to_log_initialize()
    {
        int i, ret = 0;

    #if FAKE_LOG_DEVICE
        for (i = 0; i < LOG_ID_MAX; i++) {
            char buf[sizeof("/dev/log_system")];
            snprintf(buf, sizeof(buf), "/dev/log_%s", android_log_id_to_name(i));
            log_fds[i] = fakeLogOpen(buf, O_WRONLY);
        }
    #else
        if (pstore_fd < 0) {
            pstore_fd = TEMP_FAILURE_RETRY(open("/dev/pmsg0", O_WRONLY));
        }

        //首次执行logd_fd = -1
        if (logd_fd < 0) {
            // 初始化socket
            i = TEMP_FAILURE_RETRY(socket(PF_UNIX, SOCK_DGRAM | SOCK_CLOEXEC, 0));
            if (i < 0) {
                ret = -errno;
            } else if (TEMP_FAILURE_RETRY(fcntl(i, F_SETFL, O_NONBLOCK)) < 0) {
                ret = -errno;
                close(i);
            } else {
                struct sockaddr_un un;
                memset(&un, 0, sizeof(struct sockaddr_un));
                un.sun_family = AF_UNIX;
                // socket通道
                strcpy(un.sun_path, "/dev/socket/logdw");
                // 连接该socket
                if (TEMP_FAILURE_RETRY(connect(i, (struct sockaddr *)&un,
                                               sizeof(struct sockaddr_un))) < 0) {
                    ret = -errno;
                    close(i);
                } else {
                    logd_fd = i;
                }
            }
        }
    #endif
        return ret;
    }

此处socket为"/dev/socket/logdw", 将socket的文件描述符赋予该logd_fd.

### 2.5 __write_to_log_daemon

    static int __write_to_log_daemon(log_id_t log_id, struct iovec *vec, size_t nr)
    {
        ssize_t ret;
    #if FAKE_LOG_DEVICE
        int log_fd;

        if ((int)log_id < (int)LOG_ID_MAX) {
            log_fd = log_fds[(int)log_id];
        } 
        ...
        do {
            ret = fakeLogWritev(log_fd, vec, nr);
            if (ret < 0) {
                ret = -errno;
            }
        } while (ret == -EINTR);
    #else
        static const unsigned header_length = 2;
        struct iovec newVec[nr + header_length];
        android_log_header_t header;
        android_pmsg_log_header_t pmsg_header;
        struct timespec ts;
        size_t i, payload_size;
        static uid_t last_uid = AID_ROOT;
        static pid_t last_pid = (pid_t) -1;
        static atomic_int_fast32_t dropped;

        if (!nr) {
            return -EINVAL;
        }

        if (last_uid == AID_ROOT) {
            last_uid = getuid();
        }
        if (last_pid == (pid_t) -1) {
            last_pid = getpid();
        }

        clock_gettime(CLOCK_REALTIME, &ts);

        pmsg_header.magic = LOGGER_MAGIC;
        pmsg_header.len = sizeof(pmsg_header) + sizeof(header);
        pmsg_header.uid = last_uid;
        pmsg_header.pid = last_pid;

        header.tid = gettid();
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
            TEMP_FAILURE_RETRY(writev(pstore_fd, newVec, i));
        }

        if (last_uid == AID_LOGD) { 
            return 0;
        }

        if (logd_fd < 0) {
            return -EBADF;
        }
        
        // [见小节2.6]
        ret = TEMP_FAILURE_RETRY(writev(logd_fd, newVec + 1, i - 1));
        if (ret < 0) {
            ret = -errno;
            if (ret == -ENOTCONN) {
    #if !defined(_WIN32)
                pthread_mutex_lock(&log_init_lock);
    #endif
                close(logd_fd);
                logd_fd = -1;
                ret = __write_to_log_initialize();
    #if !defined(_WIN32)
                pthread_mutex_unlock(&log_init_lock);
    #endif

                if (ret < 0) {
                    return ret;
                }

                ret = TEMP_FAILURE_RETRY(writev(logd_fd, newVec + 1, i - 1));
                if (ret < 0) {
                    ret = -errno;
                }
            }
        }

        if (ret > (ssize_t)sizeof(header)) {
            ret -= sizeof(header);
        } else if (ret == -EAGAIN) {
            atomic_fetch_add_explicit(&dropped, 1, memory_order_relaxed);
        }
    #endif

        return ret;
    }

### 2.6 writev
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
                if (ret < 0) {
                    if (total == 0)
                        total = -1;
                    goto Exit;
                }
                if (ret == 0)
                    goto Exit;

                total += ret;
                buf   += ret;
                len   -= ret;
            }
        }
    Exit:
        return total;
    }
    
### 三. logd 守护进程
write其实是向logd的socket写入日志信息, 接下来看看logd的过程.
            

    LogListener *swl = new LogListener(logBuf, reader);
    if (swl->startListener(300)) {
        exit(1);
    }

    
SocketListener::runListener() 
    LogListener.onDataAvailable 
        LogBuffer::log
            LogBuffer::maybePrune
        LogReader::notifyNewLog
            SocketListener::runOnEachSocket 
            FlushCommand::runSocketCommand
            
#### 3.1 logbuf->log

每一行log,记录为LogBufferElement.

#### 3.2 maybePrune


    void LogBuffer::maybePrune(log_id_t id) {
        size_t sizes = stats.sizes(id); //log占用内存大小
        unsigned long maxSize = log_buffer_size(id); //最大上限 
        if (sizes > maxSize) {
            size_t sizeOver = sizes - ((maxSize * 9) / 10); //超出90%的部分大小
            size_t elements = stats.realElements(id); // 真实的log行数
            size_t minElements = elements / 100; // 1%的log行数
            if (minElements < minPrune) { //保证>=4行数
                minElements = minPrune;
            }
            unsigned long pruneRows = elements * sizeOver / sizes;
            if (pruneRows < minElements) { //保证>= 1%的log行数
                pruneRows = minElements;
            }
            if (pruneRows > maxPrune) { //保证<=256的log行数
                pruneRows = maxPrune;
            }
            prune(id, pruneRows);
        }
    }

pruneRows = elements * sizeOver / sizes = elements * (1- 0.9*(maxSize/sizes)).
这就意味着log行数越多,或者log内存越大,则pruneRows的行数越多, 大致是总行数的10%, 并且满足区间[4, 256]

#### 3.3 prune

1. 处理黑名单以及log最多的那个uid的情况, 删除;
2. 白名单的不删除
