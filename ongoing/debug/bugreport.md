## bugreport拆分




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
    - just now的栈信息；
    - last ANR的栈信息;(存在则输出)
    - tombstones信息;(存在这输出)
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

## bugreport解析

将kernel log时间统一化
