restartDelay

### 1.ServiceRecord.Java  
    resetRestartCounter() --> restartDelay = 0;

### 2.realStartServiceLocked(ServiceRecord, ProcessRecord, boolean)
    当created失败，且不在mDestroyingServices列表中，则会执行scheduleServiceRestartLocked

### 3.bringUpServiceLocked(ServiceRecord, int, boolean, boolean)
    用来判断
    if (mRestartingServices.remove(r)) {
        r.resetRestartCounter();
        clearRestartingIfNeededLocked(r);
    }

### 4. scheduleServiceRestartLocked(ServiceRecord, boolean)

    if (r.restartDelay == 0) {
        r.restartCount++;
        r.restartDelay = minDuration; //1000ms
    } else {
        if (now > (r.restartTime+resetTime)) {
            r.restartCount = 1;
            r.restartDelay = minDuration; //1000ms
        } else {
            //1分钟内，再次重启，则delay时间乘以4
            r.restartDelay *= SERVICE_RESTART_DURATION_FACTOR;
            if (r.restartDelay < minDuration) {
                r.restartDelay = minDuration;
            }
        }
    }

    mRestartingServices.add(r);


### 5. unscheduleServiceRestartLocked(ServiceRecord r, int callingUid, boolean force)

    if (!force && r.restartDelay == 0) {
        return false;
    }

    boolean removed = mRestartingServices.remove(r);
    if (removed || callingUid != r.appInfo.uid) {
        r.resetRestartCounter();
    }


### killServicesLocked

if (!allowRestart) {
    mRestartingServices.remove(r)
}

这里是个可能突破点

ActiveServies.bindServiceLocked中：

#### 1.
ServiceLookupResult res =
           retrieveServiceLocked(service, resolvedType, callingPackage,
                   Binder.getCallingPid(), Binder.getCallingUid(), userId, true, callerFg);
ServiceRecord s = res.record;

#### 2.

retrieveServiceLocked(){
    ServiceMap smap = getServiceMap(userId);
}

#### 3.

    private ServiceMap getServiceMap(int callingUser) {
        ServiceMap smap = mServiceMap.get(callingUser);
        if (smap == null) {
            smap = new ServiceMap(mAm.mHandler.getLooper(), callingUser);
            mServiceMap.put(callingUser, smap);
        }
        return smap;
    }

也就是说从mServiceMap来获取ServiceRecord


那么哪些地方可能修改mServiceMap呢？

force-stop
    bringDownDisabledPackageServicesLocked


#### mRestartingServices情况

- add
scheduleServiceRestartLocked

- remove
unscheduleServiceRestartLocked 会执行r.resetRestartCounter();
bringUpServiceLocked 会执行r.resetRestartCounter();
killServicesLocked 这里不会reset可能是问题点之一
