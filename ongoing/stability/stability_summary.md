1. anr 或者watchdog,都会调用 AMS.dumpStackTraces, 而这个过程会清空 /data/anr/traces.txt文件, 从而导致信息丢失.
那么我们需要将这个信息添加到dropbox里面.

2. crash的过程并不会输出traces.