---
layout: post
title:  "LocalBroadcastManager原理分析"
date:   2017-04-23 22:19:12
catalog:  true
tags:
    - android

---

## 一. 概述

当不需要通过send broadcasts来完成跨应用的通信，那么建议采用LocalBroadcastManager，
将会是更加地高效、安全地方式，并且对系统带来的影响也是更小。

- BroadcastReceiver采用的binder方式实现跨进程间的通信；
- LocalBroadcastManager使用Handler通信机制。

### 1.1 使用实例

    //1. 自定义广播接收者
    public class LocalReceiver extends BroadcastReceiver {
        public void onReceive(Context context, Intent intent) {
            ...
        }
    }
    LocalReceiver localReceiver = new LocalReceiver();

    //2. 注册广播
    LocalBroadcastManager.getInstance(context)
                 .registerReceiver(localReceiver, new IntentFilter(“gityuan”));
    //4. 发送广播
    LocalBroadcastManager.getInstance(context).sendBroadcast(new Intent("gityuan"));
    //5. 取消注册广播
    LocalBroadcastManager.getInstance(context).unregisterReceiver(localReceiver);
    

LocalBroadcastManager注册只能通过代码注册方式，而不能通过xml中注册静态广播，本地广播并不会跨进程通信，不用
跟system_server交互，即可完成广播全过程。

## 二. 原理分析

### 2.1 LocalBroadcastManager
[-> LocalBroadcastManager.java]

    public final class LocalBroadcastManager {
        public static LocalBroadcastManager getInstance(Context context) {
            synchronized (mLock) {
                if (mInstance == null) {
                    //单例模式，创建LocalBroadcastManager对象
                    mInstance = new LocalBroadcastManager(context.getApplicationContext());
                }
                return mInstance;
            }
        }

        private LocalBroadcastManager(Context context) {
            mAppContext = context;
            //创建运行在主线程的Handler
            mHandler = new Handler(context.getMainLooper()) {

                @Override
                public void handleMessage(Message msg) {
                    switch (msg.what) {
                        case MSG_EXEC_PENDING_BROADCASTS:
                            executePendingBroadcasts();
                            break;
                        default:
                            super.handleMessage(msg);
                    }
                }
            };
        }
    }
    
### 2.2 registerReceiver

```Java
public void registerReceiver(BroadcastReceiver receiver, IntentFilter filter) {
    synchronized (mReceivers) {
        //创建ReceiverRecord对象
        ReceiverRecord entry = new ReceiverRecord(filter, receiver);
        //查询或创建数据到mReceivers
        ArrayList<IntentFilter> filters = mReceivers.get(receiver);
        if (filters == null) {
            filters = new ArrayList<IntentFilter>(1);
            mReceivers.put(receiver, filters);
        }
        filters.add(filter);
        //查询或创建数据到mActions
        for (int i=0; i<filter.countActions(); i++) {
            String action = filter.getAction(i);
            ArrayList<ReceiverRecord> entries = mActions.get(action);
            if (entries == null) {
                entries = new ArrayList<ReceiverRecord>(1);
                mActions.put(action, entries);
            }
            entries.add(entry);
        }
    }
}
```

注册过程，主要是向mReceivers和mActions添加相应数据：

- mReceivers：数据类型为HashMap<BroadcastReceiver, ArrayList<IntentFilter>>，
记录广播接收者与IntentFilter列表的对应关系；
- mActions：数据类型为HashMap<String, ArrayList<ReceiverRecord>>，
记录action与广播接收者的对应关系。

### 2.3 sendBroadcast

    public boolean sendBroadcast(Intent intent) {
        synchronized (mReceivers) {
            final String action = intent.getAction();
            final String type = intent.resolveTypeIfNeeded(
                    mAppContext.getContentResolver());
            final Uri data = intent.getData();
            final String scheme = intent.getScheme();
            final Set<String> categories = intent.getCategories();
            //根据Intent的action来查询相应的广播接收者列表
            ArrayList<ReceiverRecord> entries = mActions.get(intent.getAction());
            if (entries != null) {
                ArrayList<ReceiverRecord> receivers = null;
                for (int i=0; i<entries.size(); i++) {
                    ReceiverRecord receiver = entries.get(i);
                    if (receiver.broadcasting) {
                        continue; //正在处理广播的receiver，则跳过
                    }

                    int match = receiver.filter.match(action, type, scheme, data,
                            categories, "LocalBroadcastManager");
                    if (match >= 0) {
                        if (receivers == null) {
                            receivers = new ArrayList<ReceiverRecord>();
                        }
                        receivers.add(receiver);
                        receiver.broadcasting = true;
                    }
                }

                if (receivers != null) {
                    for (int i=0; i<receivers.size(); i++) {
                        receivers.get(i).broadcasting = false;
                    }
                    //创建相应广播，添加到mPendingBroadcasts队列
                    mPendingBroadcasts.add(new BroadcastRecord(intent, receivers));
                    if (!mHandler.hasMessages(MSG_EXEC_PENDING_BROADCASTS)) {
                        //发送消息【见小节2.3.1】
                        mHandler.sendEmptyMessage(MSG_EXEC_PENDING_BROADCASTS);
                    }
                    return true;
                }
            }
        }
        return false;
    }

主要功能：

- 根据Intent的action来查询相应的广播接收者列表；
- 创建相应广播，添加到mPendingBroadcasts队列；
- 发送MSG_EXEC_PENDING_BROADCASTS消息。

#### 2.3.1 executePendingBroadcasts

    private void executePendingBroadcasts() {
        while (true) {
            BroadcastRecord[] brs = null;
            //将mPendingBroadcasts保存到brs数组
            synchronized (mReceivers) {
                final int N = mPendingBroadcasts.size();
                if (N <= 0) {
                    return;
                }
                brs = new BroadcastRecord[N];
                mPendingBroadcasts.toArray(brs);
                mPendingBroadcasts.clear();
            }
            //回调相应广播接收者的onReceive方法。
            for (int i=0; i<brs.length; i++) {
                BroadcastRecord br = brs[i];
                for (int j=0; j<br.receivers.size(); j++) {
                    br.receivers.get(j).receiver.onReceive(mAppContext, br.intent);
                }
            }
        }
    }

该过程运行在app进程的主线程，所以onReceive()方法不能有耗时操作。
  
### 2.4 unregisterReceiver

```Java
public void unregisterReceiver(BroadcastReceiver receiver) {
    synchronized (mReceivers) {
        //从mReceivers移除该广播接收者
        ArrayList<IntentFilter> filters = mReceivers.remove(receiver);
        if (filters == null) {
            return;
        }
        
        //从mActions移除接收者为空的action
        for (int i=0; i<filters.size(); i++) {
            IntentFilter filter = filters.get(i);
            for (int j=0; j<filter.countActions(); j++) {
                String action = filter.getAction(j);
                ArrayList<ReceiverRecord> receivers = mActions.get(action);
                if (receivers != null) {
                    for (int k=0; k<receivers.size(); k++) {
                        if (receivers.get(k).receiver == receiver) {
                            receivers.remove(k);
                            k--;
                        }
                    }
                    if (receivers.size() <= 0) {
                        mActions.remove(action);
                    }
                }
            }
        }
    }
}
```

## 三. 总结

广播注册/发送/取消注册过程都使用同步锁mReceivers来保护，从而保证进程内的多线程访问安全。
最后，再来看看使用LocalBroadcastManager的优势：

- 发送的广播不会离开当前所在的app, 因此不用担心私有隐私数据的泄漏，确保安全性；
- 其他应用也无法发送这类广播到当前app，则不用担心会暴露漏洞而被其他app所利用；
- 比系统全局的广播更加高效，且对系统整体性能影响更小；

那么不足是什么呢？LocalBroadcastManager只能用于同一个进程不同线程间通信，而不能跨进程，
即便是同一个apk里面的两个进程也不行，需要使用BroadcastReceiver。

LocalBroadcastManager与BroadcastReceiver使用场景：

- 同一个进程的多线程间通信，强烈建议使用LocalBroadcastManager；
- 跨进程的通信，则使用BroadcastReceiver。（当然跨进程实现方式有多种，这里只说广播相关的方案）
