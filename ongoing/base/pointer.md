http://blog.csdn.net/lizhiguo0532/article/details/6260114

delete gProcess;
或者


static  void shutdown();

void ProcessState::shutdown(){
    Mutex::Autolock _l(gProcessMutex);
    if(gProcess != NULL) {
        gProcess.clear();
        gProcess = NULL;
    }
}

ProcessState::~ProcessState()
{
    if (mDriverFD >= 0) {
        if (mVMStart != MAP_FAILED) {
            munmap(mVMStart, BINDER_VM_SIZE);
        }
        close(mDriverFD);
    }
    mDriverFD = -1;
}

IPCThreadState::shutdown 有谁调用？？
IPCThreadState是否有机会退出，是否需要完善析构方法。

void IPCThreadState::shutdown()
{
    gShutdown = true;

    if (gHaveTLS) {
        // XXX Need to wait for all thread pool threads to exit!
        IPCThreadState* st = (IPCThreadState*)pthread_getspecific(gTLS);
        if (st) {
            delete st;
            pthread_setspecific(gTLS, NULL);
        }
        pthread_key_delete(gTLS);
        gHaveTLS = false;
    }
}

gTLS是如何赋值的？

https://android.googlesource.com/platform/frameworks/native/+/ff405785386ed8bdee50c4afdc4a4f9a73bcb81e%5E%21/#F0


template<typename T>
void sp<T>::clear() {
    if (m_ptr) {
        m_ptr->decStrong(this);
        m_ptr = 0;
    }
}
