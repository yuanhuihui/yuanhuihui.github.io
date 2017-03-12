## 一. 概述


用户的使用情况:

    PendingIntent pi = PendingIntent.getBroadcast(context, 0, intent, 0);  
    AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);  

接下来设置闹钟,有3种类型:

    set(int type，long startTime，PendingIntent pi)，//设置一次闹钟
    setRepeating(int type，long startTime，long intervalTime，PendingIntent pi)，//设置重复闹钟
    setInexactRepeating（int type，long startTime，long intervalTime，PendingIntent pi），//设置重复闹钟,但不准确

此处type共有4种类型:

- ELAPSED_REALTIME：不可唤醒, 指定延时时长的闹钟;
- ELAPSED_REALTIME_WAKEUP：可唤醒, 指定延时时长的闹钟;
- RTC：不可唤醒，指定触发时刻的闹钟;
- RTC_WAKEUP：闹可唤醒, 指定触发时刻的闹钟;



##  PendingIntent

PendingIntent.getActivity
PendingIntent.getService
PendingIntent.getBroadcastAsUser

这3个方法,最终都会调用到AMS.getIntentSender,主要的不同在于第一个参数TYPE, 传递到AMS则创建PendingIntentRecord对象,当然如果存在对应的对象则不会创建.

### 1. getBroadcastAsUser

    public static PendingIntent getBroadcastAsUser(Context context, int requestCode,
            Intent intent, int flags, UserHandle userHandle) {
        String packageName = context.getPackageName();
        String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                context.getContentResolver()) : null;
        try {
            intent.prepareToLeaveProcess();
            IIntentSender target =
                ActivityManagerNative.getDefault().getIntentSender(
                    ActivityManager.INTENT_SENDER_BROADCAST, packageName,
                    null, null, requestCode, new Intent[] { intent },
                    resolvedType != null ? new String[] { resolvedType } : null,
                    flags, null, userHandle.getIdentifier());
            return target != null ? new PendingIntent(target) : null;
        } catch (RemoteException e) {
        }
        return null;
    }

### 2. getActivity

    public static PendingIntent getActivityAsUser(Context context, int requestCode,
            Intent intent, int flags, Bundle options, UserHandle user) {
        String packageName = context.getPackageName();
        String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                context.getContentResolver()) : null;
        try {
            intent.migrateExtraStreamToClipData();
            intent.prepareToLeaveProcess();
            IIntentSender target =
                ActivityManagerNative.getDefault().getIntentSender(
                    ActivityManager.INTENT_SENDER_ACTIVITY, packageName,
                    null, null, requestCode, new Intent[] { intent },
                    resolvedType != null ? new String[] { resolvedType } : null,
                    flags, options, user.getIdentifier());
            return target != null ? new PendingIntent(target) : null;
        } catch (RemoteException e) {
        }
        return null;
    }

### 3. getService

    public static PendingIntent getService(Context context, int requestCode,
             Intent intent,  int flags) {
        String packageName = context.getPackageName();
        String resolvedType = intent != null ? intent.resolveTypeIfNeeded(
                context.getContentResolver()) : null;
        try {
            intent.prepareToLeaveProcess();
            IIntentSender target =
                ActivityManagerNative.getDefault().getIntentSender(
                    ActivityManager.INTENT_SENDER_SERVICE, packageName,
                    null, null, requestCode, new Intent[] { intent },
                    resolvedType != null ? new String[] { resolvedType } : null,
                    flags, null, UserHandle.myUserId());
            return target != null ? new PendingIntent(target) : null;
        } catch (RemoteException e) {
        }
        return null;
    }







### else
http://blog.csdn.net/zhangyongfeiyong/article/details/52224300
http://blog.csdn.net/zhangyongfeiyong/article/details/52130413
