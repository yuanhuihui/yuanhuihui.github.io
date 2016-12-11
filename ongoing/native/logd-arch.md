

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
