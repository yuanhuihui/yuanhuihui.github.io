---
layout: post
title:  "调试系列1：bugreport源码篇"
date:   2016-6-10 22:25:30
catalog:    true
tags:
    - android
    - debug

---

> 基于android 6.0, 分析bugreport过程

    framework/native/cmds/bugreport/bugreport.cpp
    framework/native/cmds/dumpstate/dumpstate.cpp
    framework/native/cmds/dumpstate/utils.c
    
## 一、概述

通过adb命令可获取bugrepport信息，并输出到文件当前路径的bugreport.txt文件：

    adb bugreport > bugreport.txt

对于Android系统调试分析，bugreport信息量非常之大，几乎涵盖整个系统各个层面内容，对于分析BUG是一大利器，本文先从从源码角度来分析一下Bugreport的实现原理。

## 二、原理分析

Android系统源码中framework/native/cmds/bugreport目录通过Android.mk定义了bugreport项目，在系统编译完成后会生成bugreport可执行文件，位于系统/system/bin/bugreport。当执行`adb bugreport`时，便会调用这个可执行文件，进入bugreport.cpp中的main()方法。

### 2.1 bugreport.main

[-> bugreport.cpp]

    int main() {
      //启动dumpstate服务
      property_set("ctl.start", "dumpstate");
      //需要多次尝试，直到dumpstate服务启动完成，才能建立socket通信
      int s;
      for (int i = 0; i < 20; i++) {
        s = socket_local_client("dumpstate", ANDROID_SOCKET_NAMESPACE_RESERVED,
                                SOCK_STREAM);
        if (s >= 0)
          break;
        //休眠1s后再次尝试连接
        sleep(1);
      }
      if (s == -1) {
        printf("Failed to connect to dumpstate service: %s\n", strerror(errno));
        return 1;
      }
      //当3分钟没有任何数据可读，则超时停止读取并退出。
      //dumpstate服务中不存在大于1分钟的timetout，因而不可预见的超时的情况下留有很大的回旋余地。
      struct timeval tv;
      tv.tv_sec = 3 * 60;
      tv.tv_usec = 0;
      if (setsockopt(s, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof(tv)) == -1) {
        printf("WARNING: Cannot set socket timeout: %s\n", strerror(errno));
      }
      while (1) {
        char buffer[65536];
        ssize_t bytes_read = TEMP_FAILURE_RETRY(read(s, buffer, sizeof(buffer)));
        if (bytes_read == 0) {
          break;
        } else if (bytes_read == -1) {
          // EAGAIN意味着timeout，Bugreport读异常终止
          if (errno == EAGAIN) {
            errno = ETIMEDOUT;
          }
          break;
        }
        ssize_t bytes_to_send = bytes_read;
        ssize_t bytes_written;
        //不断循环得将读取数据输出到stdout
        do {
          bytes_written = TEMP_FAILURE_RETRY(write(STDOUT_FILENO,
                           buffer + bytes_read - bytes_to_send, bytes_to_send));
          if (bytes_written == -1) {
            return 1; //将数据无法写入stdout
          }
          bytes_to_send -= bytes_written;
        } while (bytes_written != 0 && bytes_to_send > 0);
      }
      close(s);
      return 0;
    }

该过程先启动`dumpstate`服务，Bugreport再通过socket建立于dumpstate的通信，这个过程会尝试20次socket连接建立直到成功连接。 在socket通道中如果持续3分钟没有任何数据可读，则超时停止读取并退出。由于dumpstate服务中不存在大于1分钟的timetout，因而不可预见的超时的情况下留有很大的回旋余地。

当从socket读取到数据后，写入到标准时输出或者重定向到文件。可见bugreport数据的来源都是dumpstate服务，那么接下来去看看dumpstate服务的工作。

### 2.2 dumpstate.main

[-> dumpstate.cpp]

    int main(int argc, char *argv[]) {
        struct sigaction sigact;
        int do_add_date = 0;
        int do_vibrate = 1;
        char* use_outfile = 0;
        int use_socket = 0;
        int do_fb = 0;
        int do_broadcast = 0;
        if (getuid() != 0) {
            //兼容性考虑，旧版本支持直接调用dumpstate命令，新版本通过调用/system/bin/bugreport来替代。
            //当检测到直接调用，则强制执行bugreport命令。
            return execl("/system/bin/bugreport", "/system/bin/bugreport", NULL);
        }
        ALOGI("begin\n");
        //清空句柄SIGPIPE
        memset(&sigact, 0, sizeof(sigact));
        sigact.sa_handler = sigpipe_handler;
        sigaction(SIGPIPE, &sigact, NULL);
        //提高当前进程的优先级，防止被OOM Killer杀死
        setpriority(PRIO_PROCESS, 0, -20);
        FILE *oom_adj = fopen("/proc/self/oom_adj", "we");
        if (oom_adj) {
            fputs("-17", oom_adj);
            fclose(oom_adj);
        }
        //参数解析
        int c;
        while ((c = getopt(argc, argv, "dho:svqzpB")) != -1) {
            switch (c) {
                case 'd': do_add_date = 1;       break;
                case 'o': use_outfile = optarg;  break;
                case 's': use_socket = 1;        break;
                case 'v': break;  // compatibility no-op
                case 'q': do_vibrate = 0;        break;
                case 'p': do_fb = 1;             break;
                case 'B': do_broadcast = 1;      break;
                case '?': printf("\n");
                case 'h':
                    usage();
                    exit(1);
            }
        }
        //建立socket
        if (use_socket) {
            redirect_to_socket(stdout, "dumpstate");
        }
        //打开vibrator
        FILE *vibrator = 0;
        if (do_vibrate) {
            vibrator = fopen("/sys/class/timed_output/vibrator/enable", "we");
            if (vibrator) {
                vibrate(vibrator, 150);
            }
        }
        //读取/proc/cmdline
        FILE *cmdline = fopen("/proc/cmdline", "re");
        if (cmdline != NULL) {
            fgets(cmdline_buf, sizeof(cmdline_buf), cmdline);
            fclose(cmdline);
        }
        //收集虚拟机和native进程的stack traces(需要root权限)
        dump_traces_path = dump_traces();
        //获取tombstone文件描述符
        get_tombstone_fds(tombstone_data);
        //确保capabilities
        if (prctl(PR_SET_KEEPCAPS, 1) < 0) {
            ALOGE("prctl(PR_SET_KEEPCAPS) failed: %s\n", strerror(errno));
            return -1;
        }
        //切换到非root用户和组，在切换之前都是处于root权限
        gid_t groups[] = { AID_LOG, AID_SDCARD_R, AID_SDCARD_RW,
                AID_MOUNT, AID_INET, AID_NET_BW_STATS };
        if (setgroups(sizeof(groups)/sizeof(groups[0]), groups) != 0) {
            ALOGE("Unable to setgroups, aborting: %s\n", strerror(errno));
            return -1;
        }
        if (setgid(AID_SHELL) != 0) {
            ALOGE("Unable to setgid, aborting: %s\n", strerror(errno));
            return -1;
        }
        if (setuid(AID_SHELL) != 0) {
            ALOGE("Unable to setuid, aborting: %s\n", strerror(errno));
            return -1;
        }
        struct __user_cap_header_struct capheader;
        struct __user_cap_data_struct capdata[2];
        memset(&capheader, 0, sizeof(capheader));
        memset(&capdata, 0, sizeof(capdata));
        capheader.version = _LINUX_CAPABILITY_VERSION_3;
        capheader.pid = 0;
        capdata[CAP_TO_INDEX(CAP_SYSLOG)].permitted = CAP_TO_MASK(CAP_SYSLOG);
        capdata[CAP_TO_INDEX(CAP_SYSLOG)].effective = CAP_TO_MASK(CAP_SYSLOG);
        capdata[0].inheritable = 0;
        capdata[1].inheritable = 0;
        if (capset(&capheader, &capdata[0]) < 0) {
            ALOGE("capset failed: %s\n", strerror(errno));
            return -1;
        }
        //如果需要，则重定向输出
        char path[PATH_MAX], tmp_path[PATH_MAX];
        pid_t gzip_pid = -1;
        if (!use_socket && use_outfile) {
            strlcpy(path, use_outfile, sizeof(path));
            if (do_add_date) {
                char date[80];
                time_t now = time(NULL);
                strftime(date, sizeof(date), "-%Y-%m-%d-%H-%M-%S", localtime(&now));
                strlcat(path, date, sizeof(path));
            }
            if (do_fb) {
                strlcpy(screenshot_path, path, sizeof(screenshot_path));
                strlcat(screenshot_path, ".png", sizeof(screenshot_path));
            }
            strlcat(path, ".txt", sizeof(path));
            strlcpy(tmp_path, path, sizeof(tmp_path));
            strlcat(tmp_path, ".tmp", sizeof(tmp_path));
            redirect_to_file(stdout, tmp_path);
        }
        //这里是真正干活的地方 【见小节 3.3】
        dumpstate();
        //通过震动提醒已完成所有dump操作
        if (vibrator) {
            for (int i = 0; i < 3; i++) {
                vibrate(vibrator, 75);
                usleep((75 + 50) * 1000);
            }
            fclose(vibrator);
        }
        //等待gzip的完成，等进程退出时则会被杀
        if (gzip_pid > 0) {
            fclose(stdout);
            waitpid(gzip_pid, NULL, 0);
        }
        //重命名.tmp文件到最终位置
        if (use_outfile && rename(tmp_path, path)) {
            fprintf(stderr, "rename(%s, %s): %s\n", tmp_path, path, strerror(errno));
        }
        //通过发送广播告知ActivityManager已完成bugreport操作
        if (do_broadcast && use_outfile && do_fb) {
            run_command(NULL, 5, "/system/bin/am", "broadcast", "--user", "0",
                    "-a", "android.intent.action.BUGREPORT_FINISHED",
                    "--es", "android.intent.extra.BUGREPORT", path,
                    "--es", "android.intent.extra.SCREENSHOT", screenshot_path,
                    "--receiver-permission", "android.permission.DUMP", NULL);
        }
        ALOGI("done\n");
        return 0;
    }

整个过程的工作流程：

1. 提高执行dumpsate所在进程的优先级，防止被OOM Killer杀死；
2. 参数解析，可通过命令`adb shell dumpstate -h`查看dumpstate命令所支持的参数；
3. 打开vibrator，用于在执行bugreport时，手机会先震动一下用于提醒开始抓取系统信息；
4. 通过dump_traces()来完成收集虚拟机和native进程的stack traces；
5. 通过get_tombstone_fds来获取tombstone文件描述符；
6. 开始执行切换到非root用户和组，在这之前的执行都处于root权限；
7. **执行dumpstate()，这里是真正干活的地方**；
8. 再次通过震动以提醒dump操作执行完成；
9. 发送广播，告知ActivityManager已完成bugreport操作。

接下来就重点说说`dumpstate()`功能：

### 2.3 dumpstate()

该方法负责整个bugreport内容输出的最为核心的功能。

[-> dumpstate.cpp ]

    static void dumpstate() {
        ...
        property_get("ro.build.display.id", build, "(unknown)");
        property_get("ro.build.fingerprint", fingerprint, "(unknown)");
        property_get("ro.build.type", build_type, "(unknown)");
        property_get("ro.baseband", radio, "(unknown)");
        property_get("ro.bootloader", bootloader, "(unknown)");
        property_get("gsm.operator.alpha", network, "(unknown)");
        strftime(date, sizeof(date), "%Y-%m-%d %H:%M:%S", localtime(&now));
        //开头信息
        printf("========================================================\n");
        printf("== dumpstate: %s\n", date);
        printf("========================================================\n");
        printf("\n");
        printf("Build: %s\n", build);
        printf("Build fingerprint: '%s'\n", fingerprint);
        printf("Bootloader: %s\n", bootloader);
        printf("Radio: %s\n", radio);
        printf("Network: %s\n", network);
        printf("Kernel: "); dump_file(NULL, "/proc/version");
        printf("Command line: %s\n", strtok(cmdline_buf, "\n"));
        printf("\n");
        //记录系统运行时长和休眠时长
        run_command("UPTIME", 10, "uptime", NULL);

        //输出mmcblk0设备信息
        dump_files("UPTIME MMC PERF", mmcblk0, skip_not_stat, dump_stat_from_fd);

        dump_file("MEMORY INFO", "/proc/meminfo");
        run_command("CPU INFO", 10, "top", "-n", "1", "-d", "1", "-m", "30", "-t", NULL);
        run_command("PROCRANK", 20, "procrank", NULL);
        dump_file("VIRTUAL MEMORY STATS", "/proc/vmstat");
        dump_file("VMALLOC INFO", "/proc/vmallocinfo");
        dump_file("SLAB INFO", "/proc/slabinfo");
        dump_file("ZONEINFO", "/proc/zoneinfo");
        dump_file("PAGETYPEINFO", "/proc/pagetypeinfo");
        dump_file("BUDDYINFO", "/proc/buddyinfo");
        dump_file("FRAGMENTATION INFO", "/d/extfrag/unusable_index");
        dump_file("KERNEL WAKELOCKS", "/proc/wakelocks");
        dump_file("KERNEL WAKE SOURCES", "/d/wakeup_sources");
        dump_file("KERNEL CPUFREQ", "/sys/devices/system/cpu/cpu0/cpufreq/stats/time_in_state");
        dump_file("KERNEL SYNC", "/d/sync");
        run_command("PROCESSES", 10, "ps", "-P", NULL);
        run_command("PROCESSES AND THREADS", 10, "ps", "-t", "-p", "-P", NULL);
        run_command("PROCESSES (SELINUX LABELS)", 10, "ps", "-Z", NULL);
        run_command("LIBRANK", 10, "librank", NULL);

        //输出kernel log
        do_dmesg();

        //所有已打开文件
        run_command("LIST OF OPEN FILES", 10, SU_PATH, "root", "lsof", NULL);
        //遍历所有进程的show map
        for_each_pid(do_showmap, "SMAPS OF ALL PROCESSES");
        //显示所有线程的blocked位置
        for_each_tid(show_wchan, "BLOCKED PROCESS WAIT-CHANNELS");

        //SYSTEM LOG
        timeout = logcat_timeout("main") + logcat_timeout("system") + logcat_timeout("crash");
        if (timeout < 20000) {
            timeout = 20000;
        }
        run_command("SYSTEM LOG", timeout / 1000, "logcat", "-v", "threadtime", "-d", "*:v", NULL);

        //EVENT LOG
        timeout = logcat_timeout("events");
        if (timeout < 20000) {
            timeout = 20000;
        }
        run_command("EVENT LOG", timeout / 1000, "logcat", "-b", "events", "-v", "threadtime", "-d", "*:v", NULL);

        //RADIO LOG
        timeout = logcat_timeout("radio");
        if (timeout < 20000) {
            timeout = 20000;
        }
        run_command("RADIO LOG", timeout / 1000, "logcat", "-b", "radio", "-v", "threadtime", "-d", "*:v", NULL);

        //Log统计信息
        run_command("LOG STATISTICS", 10, "logcat", "-b", "all", "-S", NULL);

        //输出当前虚拟机和native进程的vm traces
        if (dump_traces_path != NULL) {
            dump_file("VM TRACES JUST NOW", dump_traces_path);
        }

        //输出上次发生ANR时vm traces，即路径/data/anr/traces.txt
        struct stat st;
        char anr_traces_path[PATH_MAX];
        property_get("dalvik.vm.stack-trace-file", anr_traces_path, "");
        if (!anr_traces_path[0]) {
            printf("*** NO VM TRACES FILE DEFINED (dalvik.vm.stack-trace-file)\n\n");
        } else {
          int fd = TEMP_FAILURE_RETRY(open(anr_traces_path,
                                       O_RDONLY | O_CLOEXEC | O_NOFOLLOW | O_NONBLOCK));
          if (fd < 0) {
              printf("*** NO ANR VM TRACES FILE (%s): %s\n\n", anr_traces_path, strerror(errno));
          } else {
              dump_file_from_fd("VM TRACES AT LAST ANR", anr_traces_path, fd);
          }
        }

        //输出慢操作的vm traces，例如/data/anr/slow1.txt
        if (anr_traces_path[0] != 0) {
            int tail = strlen(anr_traces_path)-1;
            while (tail > 0 && anr_traces_path[tail] != '/') {
                tail--;
            }
            int i = 0;
            while (1) {
                //例如trace文件为/data/anr/slow1.txt
                sprintf(anr_traces_path+tail+1, "slow%02d.txt", i);
                if (stat(anr_traces_path, &st)) {
                    break;
                }
                dump_file("VM TRACES WHEN SLOW", anr_traces_path);
                i++;
            }
        }

        //输出tombstone信息，NUM_TOMBSTONES=10，例如/data/tombstones/tombstone_1
        int dumped = 0;
        for (size_t i = 0; i < NUM_TOMBSTONES; i++) {
            if (tombstone_data[i].fd != -1) {
                dumped = 1;
                dump_file_from_fd("TOMBSTONE", tombstone_data[i].name, tombstone_data[i].fd);
                tombstone_data[i].fd = -1;
            }
        }
        if (!dumped) {
            printf("*** NO TOMBSTONES to dump in %s\n\n", TOMBSTONE_DIR);
        }

        dump_file("NETWORK DEV INFO", "/proc/net/dev");
        dump_file("QTAGUID NETWORK INTERFACES INFO", "/proc/net/xt_qtaguid/iface_stat_all");
        dump_file("QTAGUID NETWORK INTERFACES INFO (xt)", "/proc/net/xt_qtaguid/iface_stat_fmt");
        dump_file("QTAGUID CTRL INFO", "/proc/net/xt_qtaguid/ctrl");
        dump_file("QTAGUID STATS INFO", "/proc/net/xt_qtaguid/stats");

        //输出上次的kernel log
        if (!stat(PSTORE_LAST_KMSG, &st)) {
            //文件为/sys/fs/pstore/console-ramoops
            dump_file("LAST KMSG", PSTORE_LAST_KMSG);
        } else {
            //文件为/proc/last_kmsg
            dump_file("LAST KMSG", "/proc/last_kmsg");
        }

        //输出上次 logcat，内核必须设置CONFIG_PSTORE_PMSG
        run_command("LAST LOGCAT", 10, "logcat", "-L", "-v", "threadtime",
                                                 "-b", "all", "-d", "*:v", NULL);

        //wifi驱动/固件 以及ip相关信息
        run_command("NETWORK INTERFACES", 10, "ip", "link", NULL);
        run_command("IPv4 ADDRESSES", 10, "ip", "-4", "addr", "show", NULL);
        run_command("IPv6 ADDRESSES", 10, "ip", "-6", "addr", "show", NULL);
        run_command("IP RULES", 10, "ip", "rule", "show", NULL);
        run_command("IP RULES v6", 10, "ip", "-6", "rule", "show", NULL);
        dump_route_tables();
        run_command("ARP CACHE", 10, "ip", "-4", "neigh", "show", NULL);
        run_command("IPv6 ND CACHE", 10, "ip", "-6", "neigh", "show", NULL);
        run_command("IPTABLES", 10, SU_PATH, "root", "iptables", "-L", "-nvx", NULL);
        run_command("IP6TABLES", 10, SU_PATH, "root", "ip6tables", "-L", "-nvx", NULL);
        run_command("IPTABLE NAT", 10, SU_PATH, "root", "iptables", "-t", "nat", "-L", "-nvx", NULL);
        run_command("IPTABLE RAW", 10, SU_PATH, "root", "iptables", "-t", "raw", "-L", "-nvx", NULL);
        run_command("IP6TABLE RAW", 10, SU_PATH, "root", "ip6tables", "-t", "raw", "-L", "-nvx", NULL);
        run_command("WIFI NETWORKS", 20, SU_PATH, "root", "wpa_cli", "IFNAME=wlan0", "list_networks", NULL);

        //中断向量表
        dump_file("INTERRUPTS (1)", "/proc/interrupts");
        run_command("NETWORK DIAGNOSTICS", 10, "dumpsys", "connectivity", "--diag", NULL);
        //中断向量表(二次输出)
        dump_file("INTERRUPTS (2)", "/proc/interrupts");

        //获取properties属性值
        print_properties();
        run_command("VOLD DUMP", 10, "vdc", "dump", NULL);
        run_command("SECURE CONTAINERS", 10, "vdc", "asec", "list", NULL);
        //可用空间
        run_command("FILESYSTEMS & FREE SPACE", 10, "df", NULL);
        run_command("LAST RADIO LOG", 10, "parse_radio_log", "/proc/last_radio_log", NULL);

        //背光信息
        printf("------ BACKLIGHTS ------\n");
        printf("LCD brightness="); dump_file(NULL, "/sys/class/leds/lcd-backlight/brightness");
        printf("Button brightness="); dump_file(NULL, "/sys/class/leds/button-backlight/brightness");
        printf("Keyboard brightness="); dump_file(NULL, "/sys/class/leds/keyboard-backlight/brightness");
        printf("ALS mode="); dump_file(NULL, "/sys/class/leds/lcd-backlight/als");
        printf("LCD driver registers:\n"); dump_file(NULL, "/sys/class/leds/lcd-backlight/registers");
        printf("\n");

        //Binder相关
        dump_file("BINDER FAILED TRANSACTION LOG", "/sys/kernel/debug/binder/failed_transaction_log");
        dump_file("BINDER TRANSACTION LOG", "/sys/kernel/debug/binder/transaction_log");
        dump_file("BINDER TRANSACTIONS", "/sys/kernel/debug/binder/transactions");
        dump_file("BINDER STATS", "/sys/kernel/debug/binder/stats");
        dump_file("BINDER STATE", "/sys/kernel/debug/binder/state");

        printf("========================================================\n");
        printf("== Board\n");
        printf("========================================================\n");
        dumpstate_board(); printf("\n");

        //输出framework各种服务的dumpsys信息
        printf("========================================================\n");
        printf("== Android Framework Services\n");
        printf("========================================================\n");
        run_command("DUMPSYS", 60, "dumpsys", NULL); //很耗时则timeout=60s

        printf("========================================================\n");
        printf("== Checkins\n");
        printf("========================================================\n");
        run_command("CHECKIN BATTERYSTATS", 30, "dumpsys", "batterystats", "-c", NULL);
        run_command("CHECKIN MEMINFO", 30, "dumpsys", "meminfo", "--checkin", NULL);
        run_command("CHECKIN NETSTATS", 30, "dumpsys", "netstats", "--checkin", NULL);
        run_command("CHECKIN PROCSTATS", 30, "dumpsys", "procstats", "-c", NULL);
        run_command("CHECKIN USAGESTATS", 30, "dumpsys", "usagestats", "-c", NULL);
        run_command("CHECKIN PACKAGE", 30, "dumpsys", "package", "--checkin", NULL);

        //输出当前 运行中activity/service/provider信息
        printf("========================================================\n");
        printf("== Running Application Activities\n");
        printf("========================================================\n");
        run_command("APP ACTIVITIES", 30, "dumpsys", "activity", "all", NULL);
        printf("========================================================\n");
        printf("== Running Application Services\n");
        printf("========================================================\n");
        run_command("APP SERVICES", 30, "dumpsys", "activity", "service", "all", NULL);
        printf("========================================================\n");
        printf("== Running Application Providers\n");
        printf("========================================================\n");
        run_command("APP SERVICES", 30, "dumpsys", "activity", "provider", "all", NULL);
        printf("========================================================\n");
        printf("== dumpstate: done\n");
        printf("========================================================\n");
    }

该方法涉及run_command其他几个方法见下方：

#### 2.3.1 run_command()

[-> utils.c]

    int run_command(const char *title, int timeout_seconds, const char *command, ...) {
        fflush(stdout);
        uint64_t start = nanotime();
        //通过fork创建子进程
        pid_t pid = fork();
        if (pid < 0) {
            printf("*** fork: %s\n", strerror(errno));
            return pid;
        }

        //子进程执行
        if (pid == 0) {
            const char *args[1024] = {command};
            size_t arg;
            //确保dumpstate结束后能关闭子进程
            prctl(PR_SET_PDEATHSIG, SIGKILL);
            struct sigaction sigact;
            memset(&sigact, 0, sizeof(sigact));
            sigact.sa_handler = SIG_IGN;
            //忽略SIGPIPE
            sigaction(SIGPIPE, &sigact, NULL);
            va_list ap;
            va_start(ap, command);

            if (title) printf("------ %s (%s", title, command);
            for (arg = 1; arg < sizeof(args) / sizeof(args[0]); ++arg) {
                args[arg] = va_arg(ap, const char *);
                if (args[arg] == NULL) break;
                if (title) printf(" %s", args[arg]);
            }
            if (title) printf(") ------\n");
            fflush(stdout);
            //执行命令
            execvp(command, (char**) args);
            printf("*** exec(%s): %s\n", command, strerror(errno));
            fflush(stdout);
            _exit(-1); //进程退出
        }
        //父进程执行，主要处理子进程退出
        int status;
        bool ret = waitpid_with_timeout(pid, timeout_seconds, &status);
        uint64_t elapsed = nanotime() - start;
        if (!ret) {
            if (errno == ETIMEDOUT) {
                printf("*** %s: Timed out after %.3fs (killing pid %d)\n", command,
                       (float) elapsed / NANOS_PER_SEC, pid);
            } else {
                printf("*** %s: Error after %.4fs (killing pid %d)\n", command,
                       (float) elapsed / NANOS_PER_SEC, pid);
            }
            kill(pid, SIGTERM);
            if (!waitpid_with_timeout(pid, 5, NULL)) {
                kill(pid, SIGKILL);
                if (!waitpid_with_timeout(pid, 5, NULL)) {
                    printf("*** %s: Cannot kill %d even with SIGKILL.\n", command, pid);
                }
            }
            return -1;
        }
        if (WIFSIGNALED(status)) {
            printf("*** %s: Killed by signal %d\n", command, WTERMSIG(status));
        } else if (WIFEXITED(status) && WEXITSTATUS(status) > 0) {
            printf("*** %s: Exit code %d\n", command, WEXITSTATUS(status));
        }
        if (title) printf("[%s: %.3fs elapsed]\n\n", command, (float)elapsed / NANOS_PER_SEC);
        return status;
    }

功能是fork子进程并等待它执行完成，或者超时退出。当命令`title`不为空时，每次输出结果，都分别以下面作为开头和结尾:

    ------ <title> (<command>) ------
    [<command>: <执行时长> elapsed]

#### 2.3.2 dump_file()

[-> utils.c]

    int dump_file(const char *title, const char *path) {
        //尝试打开文件
        int fd = TEMP_FAILURE_RETRY(open(path, O_RDONLY | O_NONBLOCK | O_CLOEXEC));
        if (fd < 0) {
            //无法打开文件时，则输出如下信息
            int err = errno;
            if (title) printf("------ %s (%s) ------\n", title, path);
            printf("*** %s: %s\n", path, strerror(err));
            if (title) printf("\n");
            return -1;
        }
        //输出文件内容
        return _dump_file_from_fd(title, path, fd);
    }

当可以正确打开文件时，则执行_dump_file_from_fd，输出文件内容

    static int _dump_file_from_fd(const char *title, const char *path, int fd) {
        if (title) printf("------ %s (%s", title, path);
        if (title) {
            struct stat st;
            //文件路径为/proc/或者/sys/
            if (memcmp(path, "/proc/", 6) && memcmp(path, "/sys/", 5) && !fstat(fd, &st)) {
                char stamp[80];
                time_t mtime = st.st_mtime; //文件上次修改时间
                strftime(stamp, sizeof(stamp), "%Y-%m-%d %H:%M:%S", localtime(&mtime));
                printf(": %s", stamp);
            }
            printf(") ------\n");
        }
        bool newline = false;
        fd_set read_set;
        struct timeval tm;
        while (1) {
            FD_ZERO(&read_set);
            FD_SET(fd, &read_set);
            //30s无数据可读则超时
            tm.tv_sec = 30;
            tm.tv_usec = 0;
            uint64_t elapsed = nanotime();
            int ret = TEMP_FAILURE_RETRY(select(fd + 1, &read_set, NULL, NULL, &tm));
            if (ret == -1) {
                printf("*** %s: select failed: %s\n", path, strerror(errno));
                newline = true;
                break;
            } else if (ret == 0) {
                elapsed = nanotime() - elapsed;
                printf("*** %s: Timed out after %.3fs\n", path,
                       (float) elapsed / NANOS_PER_SEC);
                newline = true;
                break;
            } else {
                char buffer[65536];
                // 读取数据
                ssize_t bytes_read = TEMP_FAILURE_RETRY(read(fd, buffer, sizeof(buffer)));
                if (bytes_read > 0) {
                    fwrite(buffer, bytes_read, 1, stdout);
                    newline = (buffer[bytes_read-1] == '\n');
                } else {
                    if (bytes_read == -1) {
                        printf("*** %s: Failed to read from fd: %s", path, strerror(errno));
                        newline = true;
                    }
                    break;
                }
            }
        }
        close(fd);
        if (!newline) printf("\n");
        if (title) printf("\n");
        return 0;
    }

当打不开文件或者出错则输出：

    ------ <title> (<path>) ------
    *** <path>: <err>

当文件路径为/proc/或者/sys/，则输出时间/文件上次修改时间：

    ------ <title> (<path>: <文件修改时间>) ------

#### 2.3.3 dump_files()

dump_files("UPTIME MMC PERF", mmcblk0, skip_not_stat, dump_stat_from_fd);

其中skip_not_stat是指忽略mmcblk0目录下的非stat文件，dump_files该方法遍历输出mmcblk0(即"/sys/block/mmcblk0/")目录下所有stat文件，具体的输出调用dump_stat_from_fd方法来完成，该方法输出每个分区的读写速度：

    static int dump_stat_from_fd(const char *title __unused, const char *path, int fd) {
        unsigned long fields[11], read_perf, write_perf;
        bool z;
        char *cp, *buffer = NULL;
        size_t i = 0;
        FILE *fp = fdopen(fd, "rb"); //打开文件
        getline(&buffer, &i, fp);
        fclose(fp);
        if (!buffer) {
            return -errno;
        }
        i = strlen(buffer);
        while ((i > 0) && (buffer[i - 1] == '\n')) {
            buffer[--i] = '\0';
        }
        if (!*buffer) {
            free(buffer);
            return 0;
        }
        z = true;
        for (cp = buffer, i = 0; i < (sizeof(fields) / sizeof(fields[0])); ++i) {
            fields[i] = strtol(cp, &cp, 0);
            if (fields[i] != 0) {
                z = false;
            }
        }
        if (z) { /* never accessed */
            free(buffer);
            return 0;
        }
        if (!strncmp(path, mmcblk0, sizeof(mmcblk0) - 1)) {
            path += sizeof(mmcblk0) - 1;
        }
        //例如输出/sys/block/mmcblk0/mmcblk0p13/stat内容
        printf("%s: %s\n", path, buffer);
        free(buffer);
        read_perf = 0;
        if (fields[3]) {
            //计算读的性能
            read_perf = 512 * fields[2] / fields[3];
        }
        write_perf = 0;
        if (fields[7]) {
            //计算写的性能
            write_perf = 512 * fields[6] / fields[7];
        }
        printf("%s: read: %luKB/s write: %luKB/s\n", path, read_perf, write_perf);
        //worst_write_perf默认值为20000kb/s
        if ((write_perf > 1) && (write_perf < worst_write_perf)) {
            worst_write_perf = write_perf;
        }
        return 0;
    }

例如：stat文件共有11个数据：

    mmcblk0p13/stat:  15  369  100  10  57  7239  5000  250  0  900  2610

则mmcblk0p13/stat的read_perf = 512* 100/10 = 5120KB/s， write_perf= 512* 5000/250 = 10240KB/s

#### 2.3.4 dump_traces()

dump虚拟机和native的stack traces，并返回trace文件位置

    const char *dump_traces() {
        const char* result = NULL;
        char traces_path[PROPERTY_VALUE_MAX] = "";

        //traces_path等于/data/anr/traces.txt
        property_get("dalvik.vm.stack-trace-file", traces_path, "");
        if (!traces_path[0]) return NULL;

        char anr_traces_path[PATH_MAX];
        strlcpy(anr_traces_path, traces_path, sizeof(anr_traces_path));
        strlcat(anr_traces_path, ".anr", sizeof(anr_traces_path));
        //文件重命名
        if (rename(traces_path, anr_traces_path) && errno != ENOENT) {
            fprintf(stderr, "rename(%s, %s): %s\n", traces_path, anr_traces_path, strerror(errno));
            return NULL; //没有权限重命令
        }

        char anr_traces_dir[PATH_MAX];
        strlcpy(anr_traces_dir, traces_path, sizeof(anr_traces_dir));
        char *slash = strrchr(anr_traces_dir, '/');
        if (slash != NULL) {
            *slash = '\0';
            //创建文件夹
            if (!mkdir(anr_traces_dir, 0775)) {
                chown(anr_traces_dir, AID_SYSTEM, AID_SYSTEM);
                chmod(anr_traces_dir, 0775);
                if (selinux_android_restorecon(anr_traces_dir, 0) == -1) {
                    fprintf(stderr, "restorecon failed for %s: %s\n", anr_traces_dir, strerror(errno));
                }
            } else if (errno != EEXIST) {
                fprintf(stderr, "mkdir(%s): %s\n", anr_traces_dir, strerror(errno));
                return NULL;
            }
        }

        //创建一个新的空文件traces.txt
        int fd = TEMP_FAILURE_RETRY(open(traces_path, O_CREAT | O_WRONLY | O_TRUNC | O_NOFOLLOW | O_CLOEXEC,
                                         0666));  /* -rw-rw-rw- */
        if (fd < 0) {
            fprintf(stderr, "%s: %s\n", traces_path, strerror(errno));
            return NULL;
        }
        int chmod_ret = fchmod(fd, 0666);
        if (chmod_ret < 0) {
            fprintf(stderr, "fchmod on %s failed: %s\n", traces_path, strerror(errno));
            close(fd);
            return NULL;
        }

        // * walk /proc and kill -QUIT all Dalvik processes */
        DIR *proc = opendir("/proc");
        if (proc == NULL) {
            fprintf(stderr, "/proc: %s\n", strerror(errno));
            goto error_close_fd;
        }

        //当进程完成dump操作时，通过inotify来通知
        int ifd = inotify_init();
        if (ifd < 0) {
            fprintf(stderr, "inotify_init: %s\n", strerror(errno));
            goto error_close_fd;
        }

        int wfd = inotify_add_watch(ifd, traces_path, IN_CLOSE_WRITE);
        if (wfd < 0) {
            fprintf(stderr, "inotify_add_watch(%s): %s\n", traces_path, strerror(errno));
            goto error_close_ifd;
        }

        struct dirent *d;
        int dalvik_found = 0;
        while ((d = readdir(proc))) {
            int pid = atoi(d->d_name);
            if (pid <= 0) continue;

            char path[PATH_MAX];
            char data[PATH_MAX];
            snprintf(path, sizeof(path), "/proc/%d/exe", pid);
            ssize_t len = readlink(path, data, sizeof(data) - 1);
            if (len <= 0) {
                continue;
            }
            data[len] = '\0';

            if (!strncmp(data, "/system/bin/app_process", strlen("/system/bin/app_process"))) {
                snprintf(path, sizeof(path), "/proc/%d/cmdline", pid);
                int cfd = TEMP_FAILURE_RETRY(open(path, O_RDONLY | O_CLOEXEC));
                len = read(cfd, data, sizeof(data) - 1);
                close(cfd);
                if (len <= 0) {
                    continue;
                }
                data[len] = '\0';
                //略过zygote，并不输出它的栈信息
                if (!strncmp(data, "zygote", strlen("zygote"))) {
                    continue;
                }

                ++dalvik_found;
                uint64_t start = nanotime();
                if (kill(pid, SIGQUIT)) {
                    fprintf(stderr, "kill(%d, SIGQUIT): %s\n", pid, strerror(errno));
                    continue;
                }

                /* wait for the writable-close notification from inotify */
                struct pollfd pfd = { ifd, POLLIN, 0 };
                int ret = poll(&pfd, 1, 5000);  /* 5s超时*/
                if (ret < 0) {
                    fprintf(stderr, "poll: %s\n", strerror(errno));
                } else if (ret == 0) {
                    fprintf(stderr, "warning: timed out dumping pid %d\n", pid);
                } else {
                    struct inotify_event ie;
                    read(ifd, &ie, sizeof(ie));
                }

                if (lseek(fd, 0, SEEK_END) < 0) {
                    fprintf(stderr, "lseek: %s\n", strerror(errno));
                } else {
                    dprintf(fd, "[dump dalvik stack %d: %.3fs elapsed]\n",
                            pid, (float)(nanotime() - start) / NANOS_PER_SEC);
                }
            } else if (should_dump_native_traces(data)) {
                //native进程trace
                if (lseek(fd, 0, SEEK_END) < 0) {
                    fprintf(stderr, "lseek: %s\n", strerror(errno));
                } else {
                    static uint16_t timeout_failures = 0;
                    uint64_t start = nanotime();

                    /* If 3 backtrace dumps fail in a row, consider debuggerd dead. */
                    if (timeout_failures == 3) {
                        dprintf(fd, "too many stack dump failures, skipping...\n");
                    // 超时时长为20s
                    } else if (dump_backtrace_to_file_timeout(pid, fd, 20) == -1) {
                        dprintf(fd, "dumping failed, likely due to a timeout\n");
                        timeout_failures++;
                    } else {
                        timeout_failures = 0;
                    }
                    dprintf(fd, "[dump native stack %d: %.3fs elapsed]\n",
                            pid, (float)(nanotime() - start) / NANOS_PER_SEC);
                }
            }
        }

        if (dalvik_found == 0) {
            fprintf(stderr, "Warning: no Dalvik processes found to dump stacks\n");
        }

        static char dump_traces_path[PATH_MAX];
        strlcpy(dump_traces_path, traces_path, sizeof(dump_traces_path));
        strlcat(dump_traces_path, ".bugreport", sizeof(dump_traces_path));
        if (rename(traces_path, dump_traces_path)) {
            fprintf(stderr, "rename(%s, %s): %s\n", traces_path, dump_traces_path, strerror(errno));
            goto error_close_ifd;
        }
        result = dump_traces_path;

        /* replace the saved [ANR] traces.txt file */
        rename(anr_traces_path, traces_path);

    error_close_ifd:
        close(ifd);
    error_close_fd:
        close(fd);
        return result;
    }

该方法其中两个重要的步骤：

- 输出Java进程的trace是通过发送signal 3来dump相应信息。
- 输出native进程的trace是通过dump_backtrace_to_file_timeout，并且超时时长为20s;

#### 2.3.5 do_dmesg()

    void do_dmesg() {
        printf("------ KERNEL LOG (dmesg) ------\n");
        //获取kernel buffer的大小
        int size = klogctl(KLOG_SIZE_BUFFER, NULL, 0);
        if (size <= 0) {
            printf("Unexpected klogctl return value: %d\n\n", size);
            return;
        }
        char *buf = (char *) malloc(size + 1);
        if (buf == NULL) {
            printf("memory allocation failed\n\n");
            return;
        }
        //获取kernel log
        int retval = klogctl(KLOG_READ_ALL, buf, size);
        if (retval < 0) {
            printf("klogctl failure\n\n");
            free(buf);
            return;
        }
        buf[retval] = '\0';
        printf("%s\n\n", buf);
        free(buf);
        return;
    }

### 2.4 总结

bugreport通过socket与dumpstate服务建立通信，在dumpstate.cpp中的dumpstate()方法完成核心功能，该功能依次输出内容项，
主要分为5大类：

1. **current log**： kernel,system, event, radio;
2. **last log**： kernel, system, radio;
3. **vm traces**： just now, last ANR, tombstones
4. **dumpsys**： all, checkin, app
5. **system info**：cpu, memory, io等

从bugreport内容的输出顺序的角度，再详细列举其内容：

1. 系统build以及运行时长等相关信息；
2. 内存/CPU/进程等信息；
3. `kernel log`；
4. lsof、map及Wait-Channels；
5. `system log`；
6. `event log`；
7. radio log;
8. `vm traces`：
    1. VM TRACES JUST NOW (/data/anr/traces.txt.bugreport) (抓bugreport时主动触发)
    2. VM TRACES AT LAST ANR (/data/anr/traces.txt) (存在则输出)
    3. TOMBSTONE (/data/tombstones/tombstone_xx) (存在这输出)
9. network相关信息；
10. `last kernel log`;
11. `last system log`;
12. ip相关信息；
13. 中断向量表
14. property以及fs等信息
15. last radio log;
16. Binder相关信息；
17. dumpsys all：
18. dumpsys checkin相关:
    - dumpsys batterystats电池统计；
    - dumpsys meminfo内存
    - dumpsys netstats网络统计；
    - dumpsys procstats进程统计；
    - dumpsys usagestats使用情况；
    - dumpsys package.
19. dumpsys app相关
    - dumpsys activity;
    - dumpsys activity service all;
    - dumpsys activity provider all.

**Tips**： bugreport几乎涵盖整个系统信息，内容非常长，每一个子项都以`------ xxx ------`开头。
例如APP ACTIVITIES的开头便是 `------ APP ACTIVITIES (dumpsys activity all) ------`，其中括号内的便是输出该信息指令，即`dumpsys activity all`，还有可能是内容所在节点，各个子项目类似的规律，看完前面的源码分析过程，相信你肯定能明白。下面一篇文章再进一步从bugreport内容的角度来说明其寓意。
