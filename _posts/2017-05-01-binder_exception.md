---
layout: post
title:  "Binder异常解析"
date:   2017-05-01 23:11:50
catalog:  true
tags:
    - android
    - binder

---

## 一. 概述

Android有时会抛出Binder相关的异常，比如DeadObjectException，TransactionTooLargeException等。
当遇到这些异常，到底是哪个环节出问题而抛出的呢？总共有哪些类型的异常会被抛出呢？

### 1.1 RemoteException

    public class RemoteException extends AndroidException {

        //重新抛出RuntimeException
        public RuntimeException rethrowAsRuntimeException() {
            throw new RuntimeException(this);
        }

        public RuntimeException rethrowFromSystemServer() {
            if (this instanceof DeadObjectException) {
                throw new RuntimeException(new DeadSystemException());
            } else {
                throw new RuntimeException(this);
            }
        }
    }

更多Android相关异常：

![binderException](/images/binder/binderException.jpg)


下面以startService为例来说明这个异常抛出过程。

## 二. 代理端

### 2.1 AMP.startService
[-> ContextImpl.java]

    public ComponentName startService(Intent service) {
        return startServiceCommon(service, mUser);
    }

    private ComponentName startServiceCommon(Intent service, UserHandle user) {
        try {
            ...
            //通过AMS的代理去启动服务[2.2]
            ComponentName cn = ActivityManagerNative.getDefault().startService(
                mMainThread.getApplicationThread(), service, service.resolveTypeIfNeeded(
                            getContentResolver()), getOpPackageName(), user.getIdentifier());
            ...
            return cn;
        } catch (RemoteException e) {
            throw e.rethrowFromSystemServer(); //捕获异常并再抛出异常
        }
    }

ActivityManagerNative.getDefault()获取的是ActivityManagerProxy对象，简称AMP。

### 2.2 AMP.startService

    public ComponentName startService(IApplicationThread caller, Intent service,
                String resolvedType, String callingPackage, int userId) throws RemoteException
    {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        ...
        //[见小节2.3]
        mRemote.transact(START_SERVICE_TRANSACTION, data, reply, 0);
        //[见小节4.2]
        reply.readException();
        ...
    }

App进程调用startService去启动服务，其中`mRemote`指向AMS服务的BinderProxy对象。

### 2.3 BP.transactNative
[-> Binder.java ::BinderProxy]

    final class BinderProxy implements IBinder {
        public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            return transactNative(code, data, reply, flags);
        }
    }

此时code=START_SERVICE_TRANSACTION, data和reply数据类型为Parcel， flags=0

### 2.4 android_os_BinderProxy_transact
[-> android_util_Binder.cpp]

    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        //抛异常
        if (dataObj == NULL) {
            jniThrowNullPointerException(env, NULL);
            return JNI_FALSE;
        }
;
        //抛异常
        IBinder* target = (IBinder*) env->GetLongField(obj, gBinderProxyOffsets.mObject);
        if (target == NULL) {
            jniThrowException(env, "java/lang/IllegalStateException", "Binder has been finalized!");
            return JNI_FALSE;
        }

        //Binder IPC过程[见小节2.5]
        status_t err = target->transact(code, *data, reply, flags);

        //解析异常[见小节4.1]
        signalExceptionForError(env, obj, err, true , data->dataSize());

    }


这里会有异常抛出：

- 当抛出异常`NullPointerException`: 代表dataObj为空, 意味着Java层传递下来的parcel data数据为空;
- 当抛出异常`IllegalStateException`: 代表BpBinder为空，意味着Native层的BpBinder已经被释放;
- 当进入`signalExceptionForError()`: 根据transact执行具体情况抛出相应的异常, 见小节[4.1].


### 2.5 BpBinder.transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            //[见小节2.6]
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

当binder死亡,则返回err=`DEAD_OBJECT`，所对应抛出的异常为DeadObjectException

### 2.6 IPC.transact
[-> IPCThreadState.cpp]

    status_t IPCThreadState::transact(int32_t handle,
                                      uint32_t code, const Parcel& data,
                                      Parcel* reply, uint32_t flags)
    {
        status_t err = data.errorCheck(); //错误检查
        flags |= TF_ACCEPT_FDS;

        if (err == NO_ERROR) {
            err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL);
        }

        if (err != NO_ERROR) {
            if (reply) reply->setError(err);
            return (mLastError = err); //返回writeTransactionData的执行结果err
        }

        if ((flags & TF_ONE_WAY) == 0) {
            if (reply) {
                err = waitForResponse(reply); //[见小节2.7]
            } else {
                Parcel fakeReply;
                err = waitForResponse(&fakeReply);
            }
        } else {
            err = waitForResponse(NULL, NULL);
        }
        return err; //返回waitForResponse的执行结果err
    }

返回值err的来源：

- 返回err=`DEAD_OBJECT`
- 返回writeTransactionData的执行结果err
- 返回waitForResponse的执行结果err

### 2.7 IPC.waitForResponse
[-> IPCThreadState.cpp]

进入IPCThreadState::transact()方法, 向目标进程发起binder请求后，自己便会调用waitForResponse(),该方法会根据不同的响应码来获取响应的error.

    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        uint32_t cmd;
        int32_t err;

        while (1) {
            // 向Binder驱动写入交互
            if ((err=talkWithDriver()) < NO_ERROR) break;
            err = mIn.errorCheck();
            ...
            switch (cmd) {

            case BR_DEAD_REPLY:
                err = DEAD_OBJECT;
                goto finish;

            case BR_FAILED_REPLY:
                err = FAILED_TRANSACTION;
                goto finish;

            default:
                err = executeCommand(cmd); //[见小节2.7.1]
                if (err != NO_ERROR) goto finish;
                break;
            }
        }
        ...
        return err;
    }

- 当收到`BR_DEAD_REPLY`,则抛出err=DEAD_OBJECT
- 当收到`BR_FAILED_REPLY`, 则抛出err=FAILED_TRANSACTION.
- 否则，返回的是executeCommand的err

#### 2.7.1 IPC.executeCommand

        status_t IPCThreadState::executeCommand(int32_t cmd)
        {
            BBinder* obj;
            RefBase::weakref_type* refs;
            status_t result = NO_ERROR;

            switch ((uint32_t)cmd) {
            case BR_ERROR:
                //从mIn中读取出错误码
                result = mIn.readInt32();
                break;
            ...

            default:
                result = UNKNOWN_ERROR;
                break;
            }
            return result;
        }

小节2.7 talkWithDriver过程便会跟binder驱动交互

## 三. 服务端

见文章[彻底理解Android Binder通信架构](http://gityuan.com/2016/09/04/binder-start-service/)，
当服务端收到bindr请求，则此时进入execTransact()过程。

### 3.1 Binder.execTransact
[-> Binder.java]

    private boolean execTransact(int code, long dataObj, long replyObj,
            int flags) {
        Parcel data = Parcel.obtain(dataObj);
        Parcel reply = Parcel.obtain(replyObj);

        boolean res;
        try {
            //执行onTransact方法
            res = onTransact(code, data, reply, flags);
        } catch (RemoteException e) {
            if ((flags & FLAG_ONEWAY) != 0) {
                Log.w(TAG, "Binder call failed.", e);
            } else {
                reply.setDataPosition(0);
                reply.writeException(e); //[见小节3.2]
            }
            res = true;
        } catch (RuntimeException e) {
            if ((flags & FLAG_ONEWAY) != 0) {
                Log.w(TAG, "Caught a RuntimeException from the binder stub implementation.", e);
            } else {
                reply.setDataPosition(0);
                reply.writeException(e); //[见小节3.2]
            }
            res = true;
        } catch (OutOfMemoryError e) {
            Log.e(TAG, "Caught an OutOfMemoryError from the binder stub implementation.", e);
            RuntimeException re = new RuntimeException("Out of memory", e);
            reply.setDataPosition(0);
            reply.writeException(re); //[见小节3.2]
            res = true;
        }
        //[见小节3.3]
        checkParcel(this, code, reply, "Unreasonably large binder reply buffer");
        reply.recycle();
        data.recycle();
        return res;
    }

服务端会发送的异常有3大类：

- RemoteException
- RuntimeException
- OutOfMemoryError

### 3.2 writeException

    public final void writeException(Exception e) {
        int code = 0;
        if (e instanceof SecurityException) {
            code = EX_SECURITY;
        } else if (e instanceof BadParcelableException) {
            code = EX_BAD_PARCELABLE;
        } else if (e instanceof IllegalArgumentException) {
            code = EX_ILLEGAL_ARGUMENT;
        } else if (e instanceof NullPointerException) {
            code = EX_NULL_POINTER;
        } else if (e instanceof IllegalStateException) {
            code = EX_ILLEGAL_STATE;
        } else if (e instanceof NetworkOnMainThreadException) {
            code = EX_NETWORK_MAIN_THREAD;
        } else if (e instanceof UnsupportedOperationException) {
            code = EX_UNSUPPORTED_OPERATION;
        }
        writeInt(code);
        StrictMode.clearGatheredViolations();
        if (code == 0) {
            if (e instanceof RuntimeException) {
                throw (RuntimeException) e;
            }
            throw new RuntimeException(e);
        }
        writeString(e.getMessage());
    }

此处写入的异常类型：

- NullPointerException
- SecurityException
- BadParcelableException
- IllegalArgumentException
- IllegalStateException
- NetworkOnMainThreadException
- UnsupportedOperationException

### 3.3 checkParcel

    static void checkParcel(IBinder obj, int code, Parcel parcel, String msg) {
         // 检查parcel数据是否大于800KB
         if (CHECK_PARCEL_SIZE && parcel.dataSize() >= 800*1024) {
             StringBuilder sb = new StringBuilder();
             sb.append(msg);
             sb.append(": on ");
             sb.append(obj);
             sb.append(" calling ");
             sb.append(code);
             sb.append(" size ");
             sb.append(parcel.dataSize());
             sb.append(" (data: ");
             parcel.setDataPosition(0);
             sb.append(parcel.readInt());
             sb.append(", ");
             sb.append(parcel.readInt());
             sb.append(", ");
             sb.append(parcel.readInt());
             sb.append(")");
             Slog.wtfStack(TAG, sb.toString());
         }
     }


## 四. 异常解析

- [小节2.4]过程调用signalExceptionForError()，且canThrowRemoteException=true
- [小节2.2]过程调用Parcel.readException()

### 4.1 signalExceptionForError
[-> android_util_Binder.cpp]

    void signalExceptionForError(JNIEnv* env, jobject obj, status_t err,
            bool canThrowRemoteException, int parcelSize)
    {
        switch (err) {
            case UNKNOWN_ERROR:
                jniThrowException(env, "java/lang/RuntimeException", "Unknown error");
                break;
            case NO_MEMORY:
                jniThrowException(env, "java/lang/OutOfMemoryError", NULL);
                break;
            case INVALID_OPERATION:
                jniThrowException(env, "java/lang/UnsupportedOperationException", NULL);
                break;
            case BAD_VALUE:
                jniThrowException(env, "java/lang/IllegalArgumentException", NULL);
                break;
            case BAD_INDEX:
                jniThrowException(env, "java/lang/IndexOutOfBoundsException", NULL);
                break;
            case BAD_TYPE:
                jniThrowException(env, "java/lang/IllegalArgumentException", NULL);
                break;
            case NAME_NOT_FOUND:
                jniThrowException(env, "java/util/NoSuchElementException", NULL);
                break;
            case PERMISSION_DENIED:
                jniThrowException(env, "java/lang/SecurityException", NULL);
                break;
            case NOT_ENOUGH_DATA:
                jniThrowException(env, "android/os/ParcelFormatException", "Not enough data");
                break;
            case NO_INIT:
                jniThrowException(env, "java/lang/RuntimeException", "Not initialized");
                break;
            case ALREADY_EXISTS:
                jniThrowException(env, "java/lang/RuntimeException", "Item already exists");
                break;
            case DEAD_OBJECT:
                jniThrowException(env, canThrowRemoteException
                        ? "android/os/DeadObjectException"
                                : "java/lang/RuntimeException", NULL);
                break;
            case UNKNOWN_TRANSACTION:
                jniThrowException(env, "java/lang/RuntimeException", "Unknown transaction code");
                break;
            case FAILED_TRANSACTION: {
                ALOGE("!!! FAILED BINDER TRANSACTION !!!  (parcel size = %d)", parcelSize);
                const char* exceptionToThrow;
                char msg[128];
                //transaction失败的底层原因有可能很多种，这里无法确定是那种，后续binder driver会进一步完善
                if (canThrowRemoteException && parcelSize > 200*1024) {
                    exceptionToThrow = "android/os/TransactionTooLargeException";
                    snprintf(msg, sizeof(msg)-1, "data parcel size %d bytes", parcelSize);
                } else {
                    exceptionToThrow = (canThrowRemoteException)
                            ? "android/os/DeadObjectException"
                            : "java/lang/RuntimeException";
                    snprintf(msg, sizeof(msg)-1,
                            "Transaction failed on small parcel; remote process probably died");
                }
                jniThrowException(env, exceptionToThrow, msg);
            } break;
            case FDS_NOT_ALLOWED:
                jniThrowException(env, "java/lang/RuntimeException",
                        "Not allowed to write file descriptors here");
                break;
            case UNEXPECTED_NULL:
                jniThrowNullPointerException(env, NULL);
                break;
            case -EBADF:
                jniThrowException(env, "java/lang/RuntimeException",
                        "Bad file descriptor");
                break;
            case -ENFILE:
                jniThrowException(env, "java/lang/RuntimeException",
                        "File table overflow");
                break;
            case -EMFILE:
                jniThrowException(env, "java/lang/RuntimeException",
                        "Too many open files");
                break;
            case -EFBIG:
                jniThrowException(env, "java/lang/RuntimeException",
                        "File too large");
                break;
            case -ENOSPC:
                jniThrowException(env, "java/lang/RuntimeException",
                        "No space left on device");
                break;
            case -ESPIPE:
                jniThrowException(env, "java/lang/RuntimeException",
                        "Illegal seek");
                break;
            case -EROFS:
                jniThrowException(env, "java/lang/RuntimeException",
                        "Read-only file system");
                break;
            case -EMLINK:
                jniThrowException(env, "java/lang/RuntimeException",
                        "Too many links");
                break;
            default:
                ALOGE("Unknown binder error code. 0x%" PRIx32, err);
                String8 msg;
                msg.appendFormat("Unknown binder error code. 0x%" PRIx32, err);
                jniThrowException(env, canThrowRemoteException
                        ? "android/os/RemoteException" : "java/lang/RuntimeException", msg.string());
                break;
        }
    }
    
该方法根据传入的`err`, 在native层通过jniThrowException来抛出不同的异常类型

### 4.2 Parcel.readException
[-> Parcel.java]

    public final void readException() {
        int code = readExceptionCode(); //读取异常码
        if (code != 0) {
            String msg = readString(); //读取异常描述内容
            //[见小节4.2.1]
            readException(code, msg);
        }
    }

#### 4.2.1 readException

    public final void readException(int code, String msg) {
        switch (code) {
            case EX_SECURITY:
                throw new SecurityException(msg);
            case EX_BAD_PARCELABLE:
                throw new BadParcelableException(msg);
            case EX_ILLEGAL_ARGUMENT:
                throw new IllegalArgumentException(msg);
            case EX_NULL_POINTER:
                throw new NullPointerException(msg);
            case EX_ILLEGAL_STATE:
                throw new IllegalStateException(msg);
            case EX_NETWORK_MAIN_THREAD:
                throw new NetworkOnMainThreadException();
            case EX_UNSUPPORTED_OPERATION:
                throw new UnsupportedOperationException(msg);
        }
        throw new RuntimeException("Unknown exception code: " + code
                + " msg " + msg);
    }

## 五. 总结

2.4 android_os_BinderProxy_transact()

- 当抛出异常`NullPointerException`: 代表dataObj为空, 意味着Java层传递下来的parcel data数据为空;
- 当抛出异常`IllegalStateException`: 代表BpBinder为空，意味着Native层的BpBinder已经被释放;
- 当进入`signalExceptionForError()`: 根据transact执行具体情况抛出相应的异常, 见小节[4.1].

2.5 BpBinder.transact（）

- 当mAlive=false, 则抛出err=DEAD_OBJECT，所对应异常为DeadObjectException

2.7 IPC.waitForResponse()

- 当收到BR_DEAD_REPLY,则抛出err=DEAD_OBJECT:
  - 则抛出异常为DeadObjectException
- 当收到BR_FAILED_REPLY, 则抛出err=FAILED_TRANSACTION：
  - 当parcelSize > 200M, 则抛出TransactionTooLargeException，异常内容为"data parcel size %d bytes";
  - 当parcelSize <= 200M, 则抛出DeadObjectException，异常内容为"Transaction failed on small parcel; remote process probably died";

说明：

FAILED_TRANSACTION,这是所有exception中可能出现频率最高的,即便抛出TransactionTooLargeException,并不意味着就是transaction数据太大, 有可能是transaction异常,或者FD关闭, 这个应该需要进一步细化详细的异常情况.
当parcelSize <= 200M时抛出FAILED_TRANSACTION异常, Google根据大量实践经验得出往往都是在binder transaction正在途中时, 远程进程正好死亡而导致的.
  
##### 5.1 signalExceptionForError

错误码跟Exception的对应关系：

|错误码|Exception|描述信息|
|---|---|
|NO_MEMORY|OutOfMemoryError|
|INVALID_OPERATION|UnsupportedOperationException|
|BAD_VALUE|IllegalArgumentException|
|BAD_INDEX|IndexOutOfBoundsException|
|BAD_TYPE|IllegalArgumentException|
|NAME_NOT_FOUND|NoSuchElementException|
|PERMISSION_DENIED|SecurityException|
|NOT_ENOUGH_DATA|ParcelFormatException|Not enough data|

前面这些各种异常，描述信息一般为空。接下来,再来看看常见的RuntimeException类别：

|错误码|描述信息|
|---|---|---|
|UNKNOWN_ERROR|Unknown error|
|NO_INIT|Not initialized|
|ALREADY_EXISTS|Item already exists|
|UNKNOWN_TRANSACTION|Unknown transaction code|
|FDS_NOT_ALLOWED|Not allowed to write file descriptors here|
|-EBADF |Bad file descriptor|
|-ENFILE|File table overflow|
|-EMFILE|Too many open files|
|-EFBIG |File too large|
|-ENOSPC|No space left on device|
|-ESPIPE|Illegal seek|
|-EROFS |Read-only file system|
|-EMLINK|Too many links|
