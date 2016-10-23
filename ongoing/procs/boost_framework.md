BoostFramework

## 一、QPerformance

### perfLockAcquire

**Step 1:**

[--> QPerformance.java]

    public int perfLockAcquire(int duration, int... list) {
        int rc = REQUEST_SUCCEEDED;
        handle = native_perf_lock_acq(handle, duration, list); 【】
        if (handle == 0)
            rc = REQUEST_FAILED;
        return rc;
    }



- duration：单位ms，PerfLock请求的最大时长
- list：优化参数

**Step 2:**

[com_qualcomm_qti_Performance.cpp]

	static jint
	com_qualcomm_qti_performance_native_perf_lock_acq(JNIEnv *env, jobject clazz, jint handle, jint duration, jintArray list)
	{
	    jint listlen = env->GetArrayLength(list);
	    jint buf[listlen];
	    int i=0;
	    int ret = 0;
	    // 创建一个int[]，大小为list容量大小
	    env->GetIntArrayRegion(list, 0, listlen, buf);
	
	    pthread_mutex_lock(&dl_mutex);
	    if (perf_lock_acq == NULL) {
	        //首次调用，需要进行初始化
	        com_qualcomm_qti_performance_native_init(); 【】
	    }
	    if (perf_lock_acq) {
	        // 执行perfLock操作
	        ret = (*perf_lock_acq)(handle, duration, buf, listlen); 【】
	    }
	    pthread_mutex_unlock(&dl_mutex);
	    return ret;
	}

**Step 3:**

### perfLockAcquireTouch

    public int perfLockAcquireTouch(MotionEvent ev, DisplayMetrics metrics,
                                                        int duration, int... list)

当Touch事件满足以下任一条件时，触发native_perf_lock_acq()方法：

1. MotionEvent.ACTION_MOVE时，条件(xdiff > mTouchInfo.mMinDragW) || (ydiff > mTouchInfo.mMinDragH))为真，则触发；
2. MotionEvent.ACTION_UP时，当条件initialVelocity > mMinVelocity为真，则触发。此处duration*= ((1f * initialVelocity)/(1f * mMinVelocity));也就是说滑动速度越快，PerfLock执行时间越长；
3. MotionEvent.ACTION_UP时，当条件(xdiff > mTouchInfo.mMinDragW) || (ydiff > mTouchInfo.mMinDragH))为真，则触发。

触发PerfLock事件的参数有3个，mTouchInfo.mMinDragW，mTouchInfo.mMinDragH，initialVelocity。

mMinDragW = (int)(mWDragPix * 1f/metrics.density)；其中mWDragPix = 12；density是指屏幕的像素密度；也就是说屏幕像素密度越大，触发PerfLock的屏幕移动的物理距离越短。
同理 mMinDragH =  (int)(mHDragPix * 1f/metrics.density)；mHDragPix = 12；

另外 mMinVelocity = 150，单位是pixel/second，表示的是每秒种移动的像素点为150pixel。

### IO相关

perfIOPrefetchStart

    public int perfIOPrefetchStart(int PId, String Pkg_name)
    {
        return native_perf_io_prefetch_start(PId,Pkg_name);
    }

perfIOPrefetchStop

    public int perfIOPrefetchStop(){
        return native_perf_io_prefetch_stop();
    }

### perfLockRelease

[--> QPerformance.java]

    public int perfLockRelease() {
        return native_perf_lock_rel(handle);
    }

## 使用

1. 添加import android.util.BoostFramework;到java源码
2. 创建BoostFramework对象；
3. 使用perfLockAcquire()请求性能优化，并将返回值handle保存到变量；
4. 使用perfLockRelease()释放性能优化操作。

实例：

    BoostFramework mPerf = new BoostFramework();
    mPerf.perfLockAcquire(3000, Performance.CPUS_ON_2,
                       Performance.CPU0_FREQ_LVL_NONTURBO_MAX,
                       Performance.CPU1_FREQ_LVL_NONTURBO_MAX);

实例2：

    BoostFramework mPerf = new BoostFramework();
    BoostFramework sPerf = new BoostFramework();

    //保持至少3个核在运行的状态，持续5s
    mPerf.perfLockAcquire(5000, Performance.CPUS_ON_3);、
    //提前释放
    mPerf.perfLockRelease();
    //保持至少2个核在运行的状态，持续3s
    sPerf.perfLockAcquire(3000, Performance.CPUS_ON_2);
    //提前释放
    sPerf.perfLockRelease();

## 二、JNI

[com_qualcomm_qti_Performance.cpp]

	static JNINativeMethod gMethods[] = {
	    {"native_perf_lock_acq",  "(II[I)I",               (int *)com_qualcomm_qti_performance_native_perf_lock_acq},
	    {"native_perf_lock_rel",  "(I)I",                  (int *)com_qualcomm_qti_performance_native_perf_lock_rel},
	    {"native_perf_io_prefetch_start",  	"(ILjava/lang/String;)I",         (int *)com_qualcomm_qtiperformance_native_perf_io_prefetch_start},
	    {"native_perf_io_prefetch_stop",   	"()I",         (int *)com_qualcomm_qtiperformance_native_perf_io_prefetch_stop},
	    {"native_deinit",         "()V",                   (void *)com_qualcomm_qti_performance_native_deinit},
	};