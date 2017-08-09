


## 一. Client端

### 1.1 AMP.startService
[-> ActivityManagerNative.java  ::ActivityManagerProxy]

    public ComponentName startService(IApplicationThread caller, Intent service,
                String resolvedType, String callingPackage, int userId) throws RemoteException
    {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        ...
        mRemote.transact(START_SERVICE_TRANSACTION, data, reply, 0);
        reply.readException();
        ...
    }

其中`mRemote`指向AMS服务的BinderProxy对象。

### 1.2 BP.transactNative
[-> Binder.java ::BinderProxy]

    final class BinderProxy implements IBinder {
        public boolean transact(int code, Parcel data, Parcel reply, int flags) throws RemoteException {
            return transactNative(code, data, reply, flags);
        }
    }

### 1.3 android_os_BinderProxy_transact
[-> android_util_Binder.cpp]

    static jboolean android_os_BinderProxy_transact(JNIEnv* env, jobject obj,
        jint code, jobject dataObj, jobject replyObj, jint flags)
    {
        //抛异常1
        if (dataObj == NULL) {
            jniThrowNullPointerException(env, NULL);
            return JNI_FALSE;
        }
;
        //抛异常2
        IBinder* target = (IBinder*) env->GetLongField(obj, gBinderProxyOffsets.mObject);
        if (target == NULL) {
            jniThrowException(env, "java/lang/IllegalStateException", "Binder has been finalized!");
            return JNI_FALSE;
        }

        //Binder IPC过程
        status_t err = target->transact(code, *data, reply, flags);

        //抛异常3
        signalExceptionForError(env, obj, err, true , data->dataSize());

    }


这里会有异常抛出：

- 当抛出异常`NullPointerException`: 代表dataObj为空, 意味着Java层传递下来的parcel data数据为空;
- 当抛出异常`IllegalStateException`: 代表BpBinder为空，意味着Native层的BpBinder已经被释放;
- 当进入`signalExceptionForError()`: 根据transact执行具体情况抛出相应的异常, 见小节[].


### 1.4 BpBinder.transact
[-> BpBinder.cpp]

    status_t BpBinder::transact(
        uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
    {
        if (mAlive) {
            status_t status = IPCThreadState::self()->transact(
                mHandle, code, data, reply, flags);
            if (status == DEAD_OBJECT) mAlive = 0;
            return status;
        }
        return DEAD_OBJECT;
    }

当binder死亡,则返回状态`DEAD_OBJECT`.

### 1.5 IPC.waitForResponse
[-> IPCThreadState.cpp]

进入IPCThreadState::transact()方法, 该方法中会调用waitForResponse(),该方法会根据不同的响应码来获取响应的error.


    status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
    {
        uint32_t cmd;
        int32_t err;

        while (1) {
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
                err = executeCommand(cmd);
                if (err != NO_ERROR) goto finish;
                break;
            }
        }
        ...
        return err;
    }

- 当收到`BR_DEAD_REPLY`,则抛出DEAD_OBJECT
- 当收到`BR_FAILED_REPLY`, 则抛出FAILED_TRANSACTION.


### 1.6 IPC.executeCommand

        status_t IPCThreadState::executeCommand(int32_t cmd)
        {
            BBinder* obj;
            RefBase::weakref_type* refs;
            status_t result = NO_ERROR;

            switch ((uint32_t)cmd) {
            case BR_ERROR:
                result = mIn.readInt32();
                break;
            ...

            default:
                printf("*** BAD COMMAND %d received from Binder driver\n", cmd);
                result = UNKNOWN_ERROR;
                break;
            }

            return result;
        }

当收到`BR_ERROR`时,便会从mIn中读取出错误码.



### 1.7 Parcel.readException
[-> Parcel.java]

    public final void readException() {
        //通过readInt()读取异常码
        int code = readExceptionCode();
        if (code != 0) {
            //再读取异常描述内容
            String msg = readString();
            readException(code, msg);
        }
    }


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


- NullPointerException
- SecurityException
- BadParcelableException
- IllegalArgumentException
- IllegalStateException
- NetworkOnMainThreadException
- UnsupportedOperationException

### execTransact
[-> Binder.java]

    private boolean execTransact(int code, long dataObj, long replyObj,
            int flags) {
        Parcel data = Parcel.obtain(dataObj);
        Parcel reply = Parcel.obtain(replyObj);

        boolean res;
        try {
            res = onTransact(code, data, reply, flags);
        } catch (RemoteException e) {
            if ((flags & FLAG_ONEWAY) != 0) {
                Log.w(TAG, "Binder call failed.", e);
            } else {
                reply.setDataPosition(0);
                reply.writeException(e);
            }
            res = true;
        } catch (RuntimeException e) {
            if ((flags & FLAG_ONEWAY) != 0) {
                Log.w(TAG, "Caught a RuntimeException from the binder stub implementation.", e);
            } else {
                reply.setDataPosition(0);
                reply.writeException(e);
            }
            res = true;
        } catch (OutOfMemoryError e) {
            Log.e(TAG, "Caught an OutOfMemoryError from the binder stub implementation.", e);
            RuntimeException re = new RuntimeException("Out of memory", e);
            reply.setDataPosition(0);
            reply.writeException(re);
            res = true;
        }
        checkParcel(this, code, reply, "Unreasonably large binder reply buffer");
        reply.recycle();
        data.recycle();

        return res;
    }


- RemoteException
- RuntimeException
- OutOfMemoryError

## 二.Server端

### 2.1

### signalExceptionForError
[-> android_util_Binder.cpp]

该方法根据传入的`err`, 在native层通过jniThrowException来抛出不同的异常类型


##### 类别1

|错误码|Exception|描述信息|可能的场景|
|---|---|---|---|
|NO_MEMORY|OutOfMemoryError|-|Parcel.cpp中执行写操作|
|INVALID_OPERATION|UnsupportedOperationException|-||
|BAD_VALUE|IllegalArgumentException|-|
|BAD_INDEX|IndexOutOfBoundsException|-|
|BAD_TYPE|IllegalArgumentException||
|NAME_NOT_FOUND|NoSuchElementException||
|PERMISSION_DENIED|SecurityException||
|NOT_ENOUGH_DATA|ParcelFormatException|Not enough data|

接下来,再来看看常见的RuntimeException类别

#### 类别2

以下都是RuntimeException

|错误码|描述信息|可能的场景|
|---|---|---|
|UNKNOWN_ERROR|Unknown error||
|NO_INIT|Not initialized||
|ALREADY_EXISTS|Item already exists||
|UNKNOWN_TRANSACTION|Unknown transaction code||
|FDS_NOT_ALLOWED|Not allowed to write file descriptors here||
|-EBADF |Bad file descriptor|比如mDriverFD<0|
|-ENFILE|File table overflow||
|-EMFILE|Too many open files||
|-EFBIG |File too large||
|-ENOSPC|No space left on device||
|-ESPIPE|Illegal seek||
|-EROFS |Read-only file system||
|-EMLINK|Too many links||


#### 类别3
还有几种非常场常见的exception

(1)DEAD_OBJECT: 当canThrowRemoteException=true,则抛出DeadObjectException,否则抛出RuntimeException

(2)FAILED_TRANSACTION:

- 当canThrowRemoteException=true,且parcelSize > 200M, 则抛出TransactionTooLargeException;异常描述内容"data parcel size %d bytes";
- 当canThrowRemoteException=true,且parcelSize <= 200M, 则抛出DeadObjectException;异常描述内容"Transaction failed on small parcel; remote process probably died";
- 当canThrowRemoteException=false, 则抛出RuntimeException; 异常描述内容`同上`.

FAILED_TRANSACTION,这是所有exception中可能出现频率最高的,即便抛出TransactionTooLargeException,并不意味着就是transaction数据太大, 有可能是transaction异常,或者FD关闭, 这个应该需要进一步细化详细的异常情况.
当parcelSize <= 200M时抛出FAILED_TRANSACTION异常, Google根据大量实践经验得出往往都是在binder transaction正在途中时, 远程进程正好死亡而导致的.


(3)default: 当canThrowRemoteException=true,则抛出RemoteException,否则抛出RuntimeException,且异常描述内容为"Unknown binder error code"; (这是针对完全未知的错误码的default分支处理流程)


规律:

- 当收到`BR_DEAD_REPLY`,则抛出DEAD_OBJECT
- 当收到`BR_FAILED_REPLY`, 则抛出FAILED_TRANSACTION.
