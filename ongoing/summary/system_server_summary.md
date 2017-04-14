### 其他

system_server进程的重要线程

    root@gityuan:/ # ps -t | grep " 2621 "                                        
    system    2621  557   2334328 164400 SyS_epoll_ 7f7ebedbe4 S system_server
    system    2651  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S android.bg
    system    2653  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S android.ui
    system    2654  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S android.fg
    system    2656  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S android.io
    system    2657  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S android.display

    system    2658  2621  2334328 164400 futex_wait 7f7eb9d9c4 S CpuTracker
    system    4525  2621  2334328 164400 futex_wait 7f7eb9d9c4 S watchdog

    //Activity
    system    2652  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S ActivityManager

    //Power
    system    2659  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S PowerManagerSer

    //Package
    system    2662  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S PackageManager
    system    3400  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S PackageInstalle
    system    4921  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S PackageDexOptim

    //Alarm
    system    3474  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S AlarmManager

    //Input
    system    3479  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S InputDispatcher
    system    3480  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S InputReader

    //VOLD
    system    3481  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S MountService
    system    3482  2621  2334328 164400 unix_strea 7f7ebee73c S VoldConnector

    system    3485  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S RenderThread
    system    4136  2621  2334328 164400 SyS_epoll_ 7f7ebedbe4 S AudioService

    system    2655  2621  2334328 164400 inotify_re 7f7ebee6ac S FileObserver
    system    4139  2621  2334328 164400 poll_sched 7f7ebedd04 S UEventObserver


其中wchan这一列的含义：

    SyS_epoll_: handler thread ==> SyS_epoll_pwait  SyS_epoll_wait,
    binder_thr: binder thread ==> SyS_ioctl binder_thread_read,  
    unix_strea: VoldConnector ==> SyS_recvmsg  unix_stream_recvmsg,
    futex_wait: watchdog     ==> SyS_futex futex_wait_queue_me   wait()

    inotify_re: FileObserver ==> SyS_read inotify_read,
    poll_sched: UEventObserver ==> SyS_poll poll_schedule_timeout
    __skb_recv: Thread-81  ==> SyS_accept4  __skb_recv_datagram
    do_sigtime: Signal Catcher ==> SyS_rt_sigtimedwait  do_sigtimedwait

其中以下进程都有RenderThread线程

system    2621  557   2329276 161072 SyS_epoll_ 7f7ebedbe4 S system_server
system    4219  557   2286420 164732 SyS_epoll_ 7f7ebedbe4 S com.android.systemui
system    4253  557   1504552 102516 SyS_epoll_ 7f7ebedbe4 S com.android.settings
u0_a20    4442  557   2195832 147300 SyS_epoll_ 7f7ebedbe4 S com.miui.home

RenderThread, EventThread(surfaceflinger),主线程？
