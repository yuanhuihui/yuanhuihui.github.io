---
layout: post
title:  "Installd守护进程"
date:   2016-11-13 21:15:40
catalog:  true
tags:
    - android

---

> 基于Android 6.0的源码剖析installd的过程

    system/core/rootdir/init.rc
    frameworks/base/cmds/installd/installd.cpp
    rameworks/base/cmds/installd/commands.cpp
    rameworks/base/cmds/installd/utils.cpp


## 一、 概述

PackageManagerServie(简称PKMS)服务负责应用的安装、卸载等相关工作，而真正干活的还是installd。
其中PKMS执行权限为system，而进程installd的执行权限为root。

### 1.1 启动
installd是由Android系统的init进程(pid=1)，在解析init.rc文件的如下代码块时，通过fork创建的用户空间的守护进程installd.

    service installd /system/bin/installd
        class main
        socket installd stream 600 system system
    
installd是随着系统启动过程中main class而启动的，并且会创建一个socket套接字，用于跟上层的PKMS进行交互。
installd的启动入口frameworks/base/cmds/installd/installd.c的main()方法，接下来从这里开始说起。
     
## 二. installd启动

### 2.1 main
[-> installd.cpp]

    int main(const int argc __unused, char *argv[]) {
        char buf[BUFFER_MAX]; //buffer大小为1024Byte
        struct sockaddr addr;
        socklen_t alen;
        int lsocket, s;
        ...

        //初始化全局信息【见小节2.2】
        if (initialize_globals() < 0) {
                exit(1);
        }
        
        //初始化相关目录【见小节2.3】
        if (initialize_directories() < 0) {
            exit(1);
        }
        
        //获取套接字"installd"
        lsocket = android_get_control_socket(SOCKET_PATH);
        
        if (listen(lsocket, 5)) { //监听socket消息
            exit(1);
        }
        fcntl(lsocket, F_SETFD, FD_CLOEXEC);

        for (;;) {
            alen = sizeof(addr);
            s = accept(lsocket, &addr, &alen); //接受socket消息
            if (s < 0) {
                continue;
            }
            fcntl(s, F_SETFD, FD_CLOEXEC);

            for (;;) {
                unsigned short count;
                //读取指令的长度
                if (readx(s, &count, sizeof(count))) {
                    break;
                }
                if ((count < 1) || (count >= BUFFER_MAX)) {
                    break;
                }
                //读取指令的内容
                if (readx(s, buf, count)) {
                    break;
                }
                buf[count] = 0;
                ...
                
                //执行指令【见小节2.4】
                if (execute(s, buf)) break;
            }
            close(s);
        }
        return 0;
    }

installd进程，通过监听套接字”installd"，当接收到socket消息则执行相应的指令。

### 2.2  initialize_globals
[-> installd.cpp]

int initialize_globals() {
    // 数据目录/data/
    if (get_path_from_env(&android_data_dir, "ANDROID_DATA") < 0) {
        return -1;
    }

    // app目录/data/app/
    if (copy_and_append(&android_app_dir, &android_data_dir, APP_SUBDIR) < 0) {
        return -1;
    }

    // 受保护的app目录/data/priv-app/
    if (copy_and_append(&android_app_private_dir, &android_data_dir, PRIVATE_APP_SUBDIR) < 0) {
        return -1;
    }

    // app本地库目录/data/app-lib/
    if (copy_and_append(&android_app_lib_dir, &android_data_dir, APP_LIB_SUBDIR) < 0) {
        return -1;
    }

    // sdcard挂载点/mnt/asec
    if (get_path_from_env(&android_asec_dir, "ASEC_MOUNTPOINT") < 0) {
        return -1;
    }

    // 多媒体目录/data/media
    if (copy_and_append(&android_media_dir, &android_data_dir, MEDIA_SUBDIR) < 0) {
        return -1;
    }

    // 外部app目录/mnt/expand
    if (get_path_from_string(&android_mnt_expand_dir, "/mnt/expand/") < 0) {
        return -1;
    }

    // 系统和厂商目录
    android_system_dirs.count = 4;

    android_system_dirs.dirs = (dir_rec_t*) calloc(android_system_dirs.count, sizeof(dir_rec_t));
    ...

    dir_rec_t android_root_dir;
    // 目录/system
    if (get_path_from_env(&android_root_dir, "ANDROID_ROOT") < 0) {
        return -1;
    }

    // 目录/system/app
    android_system_dirs.dirs[0].path = build_string2(android_root_dir.path, APP_SUBDIR);
    android_system_dirs.dirs[0].len = strlen(android_system_dirs.dirs[0].path);
    
    // 目录/system/app-lib
    android_system_dirs.dirs[1].path = build_string2(android_root_dir.path, PRIV_APP_SUBDIR);
    android_system_dirs.dirs[1].len = strlen(android_system_dirs.dirs[1].path);

    // 目录/vendor/app/
    android_system_dirs.dirs[2].path = strdup("/vendor/app/");
    android_system_dirs.dirs[2].len = strlen(android_system_dirs.dirs[2].path);

    // 目录/oem/app/
    android_system_dirs.dirs[3].path = strdup("/oem/app/");
    android_system_dirs.dirs[3].len = strlen(android_system_dirs.dirs[3].path);

    return 0;
}


### 2.3 initialize_directories

    int initialize_directories() {
        int res = -1;

        //读取当前文件系统版本
        char version_path[PATH_MAX];
        snprintf(version_path, PATH_MAX, "%s.layout_version", android_data_dir.path);

        int oldVersion;
        if (fs_read_atomic_int(version_path, &oldVersion) == -1) {
            oldVersion = 0;
        }
        int version = oldVersion;

        // 目录/data/user
        char *user_data_dir = build_string2(android_data_dir.path, SECONDARY_USER_PREFIX);
        // 目录/data/data
        char *legacy_data_dir = build_string2(android_data_dir.path, PRIMARY_USER_PREFIX);
        // 目录/data/user/0
        char *primary_data_dir = build_string3(android_data_dir.path, SECONDARY_USER_PREFIX, "0");
        ...

        //将/data/user/0链接到/data/data
        if (access(primary_data_dir, R_OK) < 0) {
            if (symlink(legacy_data_dir, primary_data_dir)) {
                goto fail;
            }
        }

        ... //处理data/media 相关
        
        return res;
    }


### 2.4 execute

    static int execute(int s, char cmd[BUFFER_MAX])
    {
        char reply[REPLY_MAX];
        char *arg[TOKEN_MAX+1];
        unsigned i;
        unsigned n = 0;
        unsigned short count;
        int ret = -1;
        reply[0] = 0;

        arg[0] = cmd;
        while (*cmd) {
            if (isspace(*cmd)) {
                *cmd++ = 0;
                n++;
                arg[n] = cmd;
                if (n == TOKEN_MAX) {
                    goto done;
                }
            }
            if (*cmd) {
              cmd++; //计算参数个数
            }
        }

        for (i = 0; i < sizeof(cmds) / sizeof(cmds[0]); i++) {
            if (!strcmp(cmds[i].name,arg[0])) {
                if (n != cmds[i].numargs) {
                    //参数个数不匹配，直接返回
                    ALOGE("%s requires %d arguments (%d given)\n",
                        cmds[i].name, cmds[i].numargs, n);
                } else {
                    //执行相应的命令[见小节2.5]
                    ret = cmds[i].func(arg + 1, reply);
                }
                goto done;
            }
        }

    done:
        if (reply[0]) {
            n = snprintf(cmd, BUFFER_MAX, "%d %s", ret, reply);
        } else {
            n = snprintf(cmd, BUFFER_MAX, "%d", ret);
        }
        if (n > BUFFER_MAX) n = BUFFER_MAX;
        count = n;
        
        //将命令执行后的返回值写入socket套接字
        if (writex(s, &count, sizeof(count))) return -1;
        if (writex(s, cmd, count)) return -1;
        return 0;
    }

### 2.6 命令表

    struct cmdinfo cmds[] = {
        { "ping",                 0, do_ping },
        { "install",              5, do_install }, //安装app
        { "dexopt",               9, do_dexopt }, //dex优化
        { "markbootcomplete",     1, do_mark_boot_complete },
        { "movedex",              3, do_move_dex },
        { "rmdex",                2, do_rm_dex },
        { "remove",               3, do_remove },
        { "rename",               2, do_rename },
        { "fixuid",               4, do_fixuid },
        { "freecache",            2, do_free_cache },
        { "rmcache",              3, do_rm_cache },
        { "rmcodecache",          3, do_rm_code_cache },
        { "getsize",              8, do_get_size },
        { "rmuserdata",           3, do_rm_user_data },
        { "cpcompleteapp",        6, do_cp_complete_app },
        { "movefiles",            0, do_movefiles },
        { "linklib",              4, do_linklib },
        { "mkuserdata",           5, do_mk_user_data },
        { "mkuserconfig",         1, do_mk_user_config },
        { "rmuser",               2, do_rm_user },
        { "idmap",                3, do_idmap },
        { "restorecondata",       4, do_restorecon_data },
        { "createoatdir",         2, do_create_oat_dir },
        { "rmpackagedir",         1, do_rm_package_dir },
        { "linkfile",             3, do_link_file }
    };
    
此命令表总共有25的命令，该表中第二列是指命令所需的参数个数，第三列是指命令所指向的函数。
不同的Android版本该表格都会有所不同，此处留坑，后续再整理下。。。

## 三. Installer

当守护进程installd启动完成后，上层framework便可以通过socket跟该守护进程进行通信。
在SystemServer启动服务的过程中创建Installer对象，便会有一次跟installd通信的过程。

[-> SystemServer.java]

    private void startBootstrapServices() {
        //启动installer服务【见小节3.0】
        Installer installer = mSystemServiceManager.startService(Installer.class);
        ...

    }

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
        //【见小节3.4】
        if (!connect()) {
            return "-1";
        }

        //【见小节3.5】
        if (!writeCommand(cmd)) {
            if (!connect() || !writeCommand(cmd)) {
                return "-1";
            }
        }

        //读取应答消息【3.6】
        final int replyLength = readReply();
        if (replyLength > 0) {
            String s = new String(buf, 0, replyLength);
            return s;
        } else {
            return "-1";
        }
    }

### 3.4 connect

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

### 3.5 writeCommand

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

命令写入socket套接字，installd进程收到该命令后，便开始执行ping操作并返回结果。

### 3.6 readReply

    private int readReply() {
        //【见小节3.6.1】
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

#### 3.6.1 readFully

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
 
## 四 总结
 
 上层PKMS收集完相应信息，通过socket交给守护进程installd，该进程才是真正干活的进程。未完。。。
