am force-stop pkgName  杀掉各个用户空间的app进程

am force-stop --user 999 pkgName 杀掉指定用户空间的app进程

但是目前

am force-stop --user 999 pkgName 会杀死主用户的进程

am kill与预期一致，问题还是force-stop

1.B3（Android M），通过force-stop指定--user 999也会两个用户空间的app进程同时挂掉。表现情况与 A10 (Android L)一致，说明这并非android L与Android M的差异所导致的
2.X4(Android M)的force-stop并不会杀掉主进程。 从log看，双开应用的确是直接被Kill掉，而主应用则是通过bindDied回调 process died信息。X4的确杀进程行为与预期一致，还需进一步对比分析

Process com.qiyi.video:upload_service (pid 22078) has died

代表的是该进程不是am杀死的，而是内存不足杀死的。


add:
scheduleServiceRestartLocked


remove:
unscheduleServiceRestartLocked
bringUpServiceLocked
killServicesLocked
