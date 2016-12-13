

源码

    system/core/logd/main.cpp

## 启动过程

### init.rc

    service logd /system/bin/logd
        class core
        socket logd stream 0666 logd logd
        socket logdr seqpacket 0666 logd logd
        socket logdw dgram 0222 logd logd
        group root system

### main()
[-> main.cpp]

    int main(int argc, char *argv[]) {
        int fdPmesg = -1;
        bool klogd = true;
        if (klogd) {
            fdPmesg = open("/proc/kmsg", O_RDONLY | O_NDELAY);
        }
        fdDmesg = open("/dev/kmsg", O_WRONLY);

        //处理reinit命令
        if ((argc > 1) && argv[1] && !strcmp(argv[1], "--reinit")) {
            int sock = TEMP_FAILURE_RETRY(
                socket_local_client("logd",
                                    ANDROID_SOCKET_NAMESPACE_RESERVED,
                                    SOCK_STREAM));
            ...
            static const char reinit[] = "reinit";
            //写入"reinit"
            ssize_t ret = TEMP_FAILURE_RETRY(write(sock, reinit, sizeof(reinit)));
            ...
            
            struct pollfd p;
            memset(&p, 0, sizeof(p));
            p.fd = sock;
            p.events = POLLIN;
            ret = TEMP_FAILURE_RETRY(poll(&p, 1, 100));
            ...
            
            static const char success[] = "success";
            char buffer[sizeof(success) - 1];
            memset(buffer, 0, sizeof(buffer));
            //读取"success"
            ret = TEMP_FAILURE_RETRY(read(sock, buffer, sizeof(buffer)));
            ...
            
            return strncmp(buffer, success, sizeof(success) - 1) != 0;
        }

        // Reinit Thread
        sem_init(&reinit, 0, 0);
        sem_init(&uidName, 0, 0);
        sem_init(&sem_name, 0, 1);
        pthread_attr_t attr;
        if (!pthread_attr_init(&attr)) {
            struct sched_param param;

            memset(&param, 0, sizeof(param));
            pthread_attr_setschedparam(&attr, &param);
            pthread_attr_setschedpolicy(&attr, SCHED_BATCH);
            if (!pthread_attr_setdetachstate(&attr,
                                             PTHREAD_CREATE_DETACHED)) {
                pthread_t thread;
                reinit_running = true;
                //创建线程"logd.daemon", 该线程入口函数reinit_thread_start()
                if (pthread_create(&thread, &attr, reinit_thread_start, NULL)) {
                    reinit_running = false;
                }
            }
            pthread_attr_destroy(&attr);
        }

        if (drop_privs() != 0) {
            return -1;
        }

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

- LogReader: 监听/dev/socket/logdr, 当client连接上则将buffer信息写入client. 所对应线程名"logd.reader"
- LogListener: 监听/dev/socket/logdw, 新日志添加到LogBuffer, 并且LogReader发送更新给已连接的client.  所对应线程名"logd.writer"
- CommandListener: 监听/dev/socket/logd, 处理logd管理命令. 所对应线程名"logd.control"
- LogAudit: 所对应线程名"logd.auditd"
- LogKlog:  所对应线程名"logd.klogd"
- 入口reinit_thread_start: 所对应线程名"logd.daemon"
- LogTimeEntry::threadStart:  所对应线程名"ogd.reader.per"

从手机中查看logd进程的情况:

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

其中"logd.reader.per"的创建时机

LogReader::notifyNewLog -> SocketListener::runOnEachSocket
或者LogReader::onDataAvailable 

都会调用如下路径:

    FlushCommand::runSocketCommand
        LogTimeEntry::startReader_Locked
            pthread_create(&mThread, &attr, LogTimeEntry::threadStart, this)
    

## 三. 各个线程状态

### logd.writer
这个线程,所执行的是LogListener

SocketListener::runListener() 
    LogListener.onDataAvailable 
        logbuf->log
        LogReader::notifyNewLog
            SocketListener::runOnEachSocket 
            FlushCommand::runSocketCommand





## 总结

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

NB:
- number support multipliers (K or M) for convenience. Range is limited
  to between 64K and 256M for log buffer sizes. Individual logs override the
  global default.
