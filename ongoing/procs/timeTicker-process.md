

### 1. ALMS.onStart
    mTimeTickSender = PendingIntent.getBroadcastAsUser(getContext(), 0,
            new Intent(Intent.ACTION_TIME_TICK).addFlags(
                    Intent.FLAG_RECEIVER_REGISTERED_ONLY
                    | Intent.FLAG_RECEIVER_FOREGROUND), 0,
                    UserHandle.ALL);

### 2. PendingIntent.getBroadcastAsUser

    public static PendingIntent getBroadcastAsUser(Context context, int requestCode,
             Intent intent, int flags, UserHandle userHandle) {
         String packageName = context.getPackageName();
         String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                 context.getContentResolver()) : null;
         try {
             intent.prepareToLeaveProcess();
             //【3】获取target
             IIntentSender target =
                 ActivityManagerNative.getDefault().getIntentSender(
                     ActivityManager.INTENT_SENDER_BROADCAST, packageName,
                     null, null, requestCode, new Intent[] { intent },
                     resolvedType != null ? new String[] { resolvedType } : null,
                     flags, null, userHandle.getIdentifier());
             // 创建PendingIntent
             return target != null ? new PendingIntent(target) : null;
         } catch (RemoteException e) {
         }
         return null;
     }

### 3. AMS.getIntentSender

    public IIntentSender getIntentSender(int type,
            String packageName, IBinder token, String resultWho,
            int requestCode, Intent[] intents, String[] resolvedTypes,
            int flags, Bundle options, int userId) {

        //各种参数检验

        synchronized(this) {
            //各种权限检验
            int callingUid = Binder.getCallingUid();
            int origUserId = userId;
            userId = handleIncomingUser(Binder.getCallingPid(), callingUid, userId,
                    type == ActivityManager.INTENT_SENDER_BROADCAST,
                    ALLOW_NON_FULL, "getIntentSender", null);
            if (origUserId == UserHandle.USER_CURRENT) {
                userId = UserHandle.USER_CURRENT;
            }
            try {
                if (callingUid != 0 && callingUid != Process.SYSTEM_UID) {
                    int uid = AppGlobals.getPackageManager()
                            .getPackageUid(packageName, UserHandle.getUserId(callingUid));
                    if (!UserHandle.isSameApp(callingUid, uid)) {
                        throw new SecurityException(”“);
                    }
                }
                //【4】
                return getIntentSenderLocked(type, packageName, callingUid, userId,
                        token, resultWho, requestCode, intents, resolvedTypes, flags, options);

            } catch (RemoteException e) {
                throw new SecurityException(e);
            }
        }
    }

### 4. AMS.getIntentSenderLocked

    rec = new PendingIntentRecord(this, key, callingUid);
    return rec;

那么target = PendingIntentRecord


## 可能调用mTimeTickSender

ALMS.restorePendingWhileIdleAlarmsLocked
ALMS.scheduleTimeTickEvent


IIntentSender的服务端：PendingIntentRecord
