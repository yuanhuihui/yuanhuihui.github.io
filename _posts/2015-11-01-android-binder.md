---
layout: post
title:  "从源码角度剖析Binder原理（一）"
date:   2015-11-01 20:10:54
categories: android
excerpt:  从源码角度剖析Binder原理
---

* content
{:toc}


---
> 基于Android 6.0的源码剖析

## 一、概述

### 1.1 概述
Android系统中，每个应用程序是由Android的Activity、Service、Broadcast，ContentProvider这四剑客的中一个或多个组合而成。比如多个Activity可能运行在不同的进程中，那么针对这种跨进程Activity间的通信，Android采用的是Binder进程间通信机制。不仅于此，整个Android系统架构中，大量采用了Binder机制作为进程间通信方案，当然也存在部分其他的IPC方式，比如Zygote通信便是采用socket。

Binder作为Android系统提供的一种IPC（进程间通信）机制，无论从系统开发还是应用开发，都是Android系统中最重要的组成，也是最难理解的一块知识点。要深入了解Binder机制，最好的方法便是阅读源码，借用Linux鼻祖Linus Torvalds曾说过的一句话：Read The Fucking Source Code。

### 1.2 Binder

Binder通信采用c/s架构，包含client、server、ServiceManager、以及binder驱动，其中ServiceManager用于管理系统中的各种服务。

![ServiceManager](/images/binder/IPC-Binder.jpg)

图中的三个步骤都是基于Binder机制通信的。既然是基于Binder机制通信，那么同样也是C/S架构，则每个步骤都有相应的客户端与服务端。  

1. **注册服务**：Server进程要先注册Service到ServiceManager。该过程：Server是客户端，ServiceManager是服务端。
2. **获取服务**：Client进程使用某个Service前，须先向ServiceManager中获取相应的Service。该过程：Client是客户端，ServiceManager是服务端。
3. **使用服务**：Client根据得到的Service信息建立与Service所在的Server进程通信的通路，然后就可以直接与Service交互。该过程：client是客户端，server是服务端。 

从上图中，Client,Server,Service Manager之间交互都是虚线表示，是由于它们彼此之间不是直接交互的，而是都通过与Binder驱动设备交互，从而实现IPC通信方式。其中Binder驱动是内核空间，Client,Server,Service Manager属于用户空间。另外，Binder驱动和Service Manager可以看做是Android平台的基础架构，而Client和Server是Android的应用层，只需自定义实现client,Server端，借助Android的基本平台架构便可以直接进行IPC通信。


其中ServiceManager是Android进程间通信机制Binder的守护进程。Client与Server要进行通信，都需要先获取ServiceManager接口，才能进行通信服务。
  
BpBinder和BBinder都是Android中与Binder通信相关的代表，它们都从IBinder类中派生而来，关系图如下：  


![Binder关系图](/images/binder/Ibinder_classes.jpg)

- client端：BpBinder.transact()来发送事务请求；
- server端：BBinder.transact()会接收到相应事务。

前面讲到Binder通信包含注册服务、获取服务、使用服务3个阶段，本文先讲解注册服务的过程。

## 二、注册服务
整个Android系统有大量的binder使用场景，为了更加形象地讲解注册过程，本节以MediaServer为例。在开始开展源码剖析之前，先申明本文涉及的源码，会有部分的精简，主要是去掉所有log输出语句，已减少代码篇幅过于长。  

涉及的源码文件路径：

	1. /framework/native/libs/binder
	核心类：Binder.cpp,  BpBinder.cpp，  IInterface.cpp,  IPCThreadState.cpp,  
		IServiceManager.cpp,  Parcel.cpp,  ProcessState.cpp,  Static.cpp

	2. /framework/native/include/binder
	核心类：Binder.h,  BinderService.h,  BpBinder.h,  IInterface.h,  
		IPCThreadState.h,  IServiceManager.h,  Parcel.h,  ProcessState.h  

	3. /framework/native/include/private/binder
	核心类： binder_module.h,  Static.h  

	4. /framework/native/cmds/servicemanager
	核心类：binder.c,  binder.h,  service_manager.c


	/framework/av/media/mediaserver
	核心类： main_mediaserver.cpp
	/framework/av/media/libmedia/
	核心类： IMediaDeathNotifier.cpp, MediaMetadataRetriever.cpp
	/framework/av/media/libmediaplayerservice/
	核心类： MediaPlayerService.cpp
 
### 2.1 源码入口 

main_mediaserver.cpp是可执行程序，入口函数main代码如下：

	int main(int argc __unused, char** argv)
	{
		...
        InitializeIcuOrDie();  //【新增】初始化ICU，国际通用编码方案，用于解决多语言问题。
        sp<ProcessState> proc(ProcessState::self()); //获得ProcessState实例	（见2.1节）	
        sp<IServiceManager> sm = defaultServiceManager(); //获取ServiceManager实例（见2.2节）
        AudioFlinger::instantiate();         //AudioFlinger服务
        MediaPlayerService::instantiate();   //多媒体服务（见2.3节）
        ResourceManagerService::instantiate(); //【新增】初始化资源管理服务
        CameraService::instantiate();         //相机服务
        AudioPolicyService::instantiate();    //AudioPolicy服务
        SoundTriggerHwService::instantiate(); //SoundTriggerHwService服务
        RadioService::instantiate(); //【新增】//收音机服务
        registerExtensions();
        ProcessState::self()->startThreadPool();  //创建线程池（见2.4节）
        IPCThreadState::self()->joinThreadPool(); //将当前线程加入到线程池（见2.5节）
     }
  
上面的main方法，主要分5个类步骤，后面围绕这5个步骤展开说明，如下图：

![workflow](/images/binder/workflow.jpg)

----------

### 2.2 获得ProcessState实例

先展示一张，方法调用关系图
![ipc1](/images/binder/ipc1.jpg)

这一小节主要是分析下面这条语句的代码详细调用，层层剥开。

	sp<ProcessState> proc(ProcessState::self())  

**（1）获取ProcessState对象—— ProcessState::self()**

此处(1)对应前面的方法调用关系图中的(1)，依次类推，后续的(n)也相对应于图中的第(n)小步。

位于`ProcessState.cpp`文件, 代码如下：

	sp<ProcessState> ProcessState::self()
	{
	    Mutex::Autolock _l(gProcessMutex);
	    if (gProcess != NULL) {
	        return gProcess;
	    }
	    gProcess = new ProcessState;  //实例化ProcessState（2）
	    return gProcess;
	}
从代码可以看出，self函数是单例模式，从而保证每一个进程只有一个`ProcessState`对象。其中`gProcess`和`gProcessMutex`是保存在`Static.cpp`类的全局变量。

**（2）初始化ProcessState对象—— new ProcessState**

位于`ProcessState.cpp`文件, 代码如下：

	ProcessState::ProcessState()
	    : mDriverFD(open_driver()) // 打开Binder驱动（3）
	    , mVMStart(MAP_FAILED)
	    , mThreadCountLock(PTHREAD_MUTEX_INITIALIZER)  // [Android 6.0新增]
	    , mThreadCountDecrement(PTHREAD_COND_INITIALIZER) // [Android 6.0新增]
	    , mExecutingThreadsCount(0)   // [Android 6.0新增]
	    , mMaxThreads(DEFAULT_MAX_BINDER_THREADS)  // [Android 6.0新增]
	    , mManagesContexts(false)
	    , mBinderContextCheckFunc(NULL)
	    , mBinderContextUserData(NULL)
	    , mThreadPoolStarted(false)
	    , mThreadPoolSeq(1)

	ProcessState::ProcessState()
	    : mDriverFD(open_driver()) // 打开Binder驱动（3）
	    , mVMStart(MAP_FAILED)
	    , mManagesContexts(false)
	    , mBinderContextCheckFunc(NULL)
	    , mBinderContextUserData(NULL)
	    , mThreadPoolStarted(false)
	    , mThreadPoolSeq(1)
	{
	    if (mDriverFD >= 0) {
	        //采用内存映射函数mmap，给binder分配一块虚拟地址空间,用来接收transactions。
	        mVMStart = mmap(0, BINDER_VM_SIZE, PROT_READ, MAP_PRIVATE | MAP_NORESERVE, mDriverFD, 0);
	        if (mVMStart == MAP_FAILED) {
	            close(mDriverFD); //没有足够空间分配给/dev/binder, 关闭设备
	            mDriverFD = -1;
	        }
	    }
	}

- `ProcessState`的单例模式的惟一性，因此一个进程只打开binder设备一次,其中ProcessState的成员变量`mDriverFD`记录binder驱动的fd，用于访问binder设备。
- `BIDNER_VM_SIZE = (1*1024*1024) - (4096 *2)`, binder分配的默认内存大小为1M-8k。
- `DEFAULT_MAX_BINDER_THREADS = 15`，binder默认的最大可并发访问的线程数为15。

**（3）打开Binder驱动—— open_driver()**

位于`ProcessState.cpp`文件, 代码如下：

	static int open_driver()
	{
	    int fd = open("/dev/binder", O_RDWR); //打开/dev/binder设备，建立与内核的Binder驱动的交互通道
	    if (fd >= 0) {
	        fcntl(fd, F_SETFD, FD_CLOEXEC);
	        int vers = 0;
	        status_t result = ioctl(fd, BINDER_VERSION, &vers);
	        if (result == -1) {
	            close(fd);
	            fd = -1;
	        }
	        if (result != 0 || vers != BINDER_CURRENT_PROTOCOL_VERSION) {
	            close(fd);
	            fd = -1;
	        }
	        size_t maxThreads = DEFAULT_MAX_BINDER_THREADS;
	        result = ioctl(fd, BINDER_SET_MAX_THREADS, &maxThreads);//通过ioctl设置binder驱动，能支持的最大线程数
	        if (result == -1) {
	            ALOGE("Binder ioctl to set max threads failed: %s", strerror(errno));
	        }
	    } else {
	        ALOGW("Opening '/dev/binder' failed: %s\n", strerror(errno));
	    }
	    return fd;
	}

open_driver作用是打开/dev/binder设备，它是android内核中专门针对进程间通信而设计的虚拟设备。该设备支持的最大线程数默认是15。


**小结**

到此，`sp<ProcessState> proc(ProcessState::self())`分析完成，主要完成工作：  

- 当ProcessState对象已经创建，则直接返回，否则依次进行下面步骤;
- 打开内核的/dev/binder设备，建立与内核的Binder驱动的交互通道;
- 利用`mmap`为Binder驱动分配一块内存空间;
- 将Binder驱动的fd赋值`ProcessState`对象中的变量`mDriverFD`，用于交互操作。


----------

### 2.3 获取ServiceManager实例

sp<IServiceManager> sm = defaultServiceManager();

**(8) 获取默认ServiceManager对象—— defaultServiceManager**

位于`IServiceManager.cpp`文件, 代码如下：

	sp<IServiceManager> defaultServiceManager()
	{
	    if (gDefaultServiceManager != NULL) return gDefaultServiceManager;
	    
	    {
	        AutoMutex _l(gDefaultServiceManagerLock);
	        while (gDefaultServiceManager == NULL) {
	            gDefaultServiceManager = interface_cast<IServiceManager>(
	                ProcessState::self()->getContextObject(NULL)); ////(代码见9, 12)
	            if (gDefaultServiceManager == NULL)
	                sleep(1);
	        }
	    }
	    
	    return gDefaultServiceManager;
	}

这也是单例模式，我们发现与一般的单例模式不太一样，里面多了一层while循环，这是google在2013年1月Todd Poynor提交的修改。defaultServiceManager需要等待service manager就绪。当我们尝试创建一个本地的代理时，如果service manager没有准备好，那么就会失败，这时sleep 1秒后会重新尝试获取，直到成功。

**(9)偷龙转凤—— interface_cast\<IServiceManager\>()**

位于`IInterface.h`文件，定义的模板函数：

	template<typename INTERFACE>
	inline sp<INTERFACE> interface_cast(const sp<IBinder>& obj)
	{
	    return INTERFACE::asInterface(obj);
	}
故`interface_cast<IServiceManager>()` 等价于 `IServiceManager::asInterface()`.

接下来去看看IServiceManager文件，发现并没有找到asInterface(）函数，感觉线索断了，不知往下一步该往哪分析了。其实通过下面两行宏来完成这次偷龙转凤的：

	DECLARE_META_INTERFACE(IServiceManager);  //位于IServiceManager.h
	IMPLEMENT_META_INTERFACE(ServiceManager,"android.os.IServiceManager")  //位于IServiceManager.cpp

同样位于`IInterface.h`文件中，定义了两个宏，分别于之对应。宏定义在这里就不写了，下面是把变量带入后的真身：[DECLARE_META_INTERFACE(IServiceManager)]：

	static const android::String16 descriptor;
	 
	//终于找到asInterface函数
	static android::sp< IServiceManager > asInterface(const android::sp<android::IBinder>& obj)
	 
	//另外还定义getInterfaceDescriptor函数
	virtual const android::String16& getInterfaceDescriptor() const;
	 
	IServiceManager ();                                                   
	virtual ~IServiceManager();

同样[IMPLEMENT_META_INTERFACE(ServiceManager,"android.os.IServiceManager")]，主要是把上面定义的方法给实现了，代码如下：

	const android::String16 IServiceManager::descriptor(“android.os.IServiceManager”);

	const android::String16& IServiceManager::getInterfaceDescriptor() const
	{ 
	     return IServiceManager::descriptor;
	}    
	
	 android::sp<IServiceManager> IServiceManager::asInterface(const android::sp<android::IBinder>& obj)
	{
	       android::sp<IServiceManager> intr;
	        if(obj != NULL) {                                              
	           intr = static_cast<IServiceManager *>(                         
	               obj->queryLocalInterface(IServiceManager::descriptor).get());  
	           if (intr == NULL) {
	               intr = new BpServiceManager(obj); //后面会介绍，其实obj就是new BpBinder(0)
	            }
	        }
	       return intr;
	}

	IServiceManager::IServiceManager () { }
	IServiceManager::~ IServiceManager() { }

故`IServiceManager::asInterface()` 等价于 `new BpServiceManager()`。括号内的参数后面会介绍。细心的读者，应该已经知道参数，就是IBinder。

经过几经辗转，可得出一个结论：  
`interface_cast<IServiceManager>()` 等价于 `new BpServiceManager()`。

**（10）初始化BpServiceManager对象—— new BpServiceManager**

**(10.1)** 位于`IServiceManager.cpp`文件, 代码如下：

    BpServiceManager(const sp<IBinder>& impl)
        : BpInterface<IServiceManager>(impl)
    {
    }

**(10.2)** 接着，调用父类BpInterface初始化，位于`IInterface.h`文件，代码如下：

	inline BpInterface<INTERFACE>::BpInterface(const sp<IBinder>& remote)
	    :BpRefBase(remote)
	{
	}

**(10.3)** 再调用其父类BpRefBase初始化，位于`Binder.cpp`文件，代码如下：

	BpRefBase::BpRefBase(const sp<IBinder>& o)
	    : mRemote(o.get()), mRefs(NULL), mState(0)
	{
	    extendObjectLifetime(OBJECT_LIFETIME_WEAK);
	
	    if (mRemote) {
	        mRemote->incStrong(this);           
	        mRefs = mRemote->createWeak(this);  
	    }
	}

`new BpServiceManager()`，在初始化过程中，比较重要工作的是将类BpRefBase的mRemote指向IBinder,通过后文可知mRemote具体指向new BpBinder(0).


**(12) getContextObject**

位于`ProcessState.cpp`文件, 代码如下：

	sp<IBinder> ProcessState::getContextObject(const sp<IBinder>& /*caller*/)
	{
	    return getStrongProxyForHandle(0);  //(代码见13)
	}

**(13) getStrongProxyForHandle**

位于`ProcessState.cpp`文件, 代码如下：

	sp<IBinder> ProcessState::getStrongProxyForHandle(int32_t handle)
	{
	    sp<IBinder> result;
	
	    AutoMutex _l(mLock);
	
	    handle_entry* e = lookupHandleLocked(handle); //(代码见14)
	
	    if (e != NULL) {
	        IBinder* b = e->binder;
	        if (b == NULL || !e->refs->attemptIncWeak(this)) {
	            if (handle == 0) {
	                Parcel data;
	                status_t status = IPCThreadState::self()->transact(
	                        0, IBinder::PING_TRANSACTION, data, NULL, 0); //transact
	                if (status == DEAD_OBJECT)
	                   return NULL;
	            }
	
	            b = new BpBinder(handle);  // (代码见15)
	            e->binder = b;
	            if (b) e->refs = b->getWeakRefs();
	            result = b;
	        } else {
	            result.force_set(b);
	            e->refs->decWeak(this);
	        }
	    }	
	    return result;
	}
其中`lookupHandleLocked(handle)`，根据查找handle值来查相对应的`hanlde_entry`,`hanlde_entry`是一个结构体，里面记录IBinder和weakref_type两个指针。当在`hanlde_entry`没有找到跟handle值相对应的IBinder，或存在的弱引用无法获取时，需要创建一个新的`BpBinder`。

针对handle==0的特殊情况，通过执行一个transact操作，来判断BpBinder代理是否创建完毕。如果在context manager还未生效前，一个BpBinder的本地引用就已经被创建，那么驱动将无法提供context manager的引用。

**(14) lookupHandleLocked**

位于`ProcessState.cpp`文件, 代码如下：  

	ProcessState::handle_entry* ProcessState::lookupHandleLocked(int32_t handle)
	{
	    const size_t N=mHandleToObject.size();
	    if (N <= (size_t)handle) {
	        handle_entry e;
	        e.binder = NULL;
	        e.refs = NULL;
	        status_t err = mHandleToObject.insertAt(e, N, handle+1-N);
	        if (err < NO_ERROR) return NULL;
	    }
	    return &mHandleToObject.editItemAt(handle);
	}
根据handle值，查找是否有对应的资源项，如果没有则创建一个新项。

**(15)  new BpBinder(handle) ** 

位于`BpBinder.cpp`文件, 代码如下：

	BpBinder::BpBinder(int32_t handle)
	    : mHandle(handle)
	    , mAlive(1)
	    , mObitsSent(0)
	    , mObituaries(NULL)
	{
	    extendObjectLifetime(OBJECT_LIFETIME_WEAK);
	    IPCThreadState::self()->incWeakHandle(handle);
	}

**小结**

1. `sp<IServiceManager> sm = defaultServiceManager();`  
最终等价于：`sp<IServiceManager> sm = new BpServiceManager(new BpBinder(0));`

2. BpBinder代表客户端，BBinder代表服务端。
3. BpBinder通过handler来对应BBinder, 在整个Binder系统中，handle=0代表ServiceManager所对应的BBinder。
4. BpServiceManager对象实现了IServiceManager的业务函数，又有成员变量mRemote = new BpBinder(0)，用于实现通信工作。


----------
### 2.3 初始化MediaPlayer服务


再展示第二张 方法调用关系图
![ipc2](/images/binder/ipc2.jpg)

  
	MediaPlayerService::instantiate(); 

**(1) 初始化MediaPlayerService**

位于`MediaPlayerService.cpp`文件, 代码如下：
	
	void MediaPlayerService::instantiate() {
	    defaultServiceManager()->addService(
	           String16("media.player"), new MediaPlayerService());
	}

由前面分析，可知defaultServiceManager()返回的是BpServiceManager。故此处等价于调用BpServiceManager->addService。
MediaPlayerService的初始化过程，此处就省略，后面有时间会单独介绍。

**(3)添加服务addService**

参数： BpServiceManager.add("android.os.IServiceManager", new MediaPlayerService,false)

位于`IServiceManager.cpp`文件, 代码如下：

    virtual status_t addService(const String16& name, const sp<IBinder>& service,
            bool allowIsolated)
    {
        Parcel data, reply; //Parcel是数据通信包
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());   //写入RPC的头信息，"android.os.IServiceManager"
        data.writeString16(name);  // 服务的名称，"media.player"
        data.writeStrongBinder(service); //具体MediaPlayerService服务
        data.writeInt32(allowIsolated ? 1 : 0); // 0
        status_t err = remote()->transact(ADD_SERVICE_TRANSACTION, data, &reply);
        return err == NO_ERROR ? reply.readExceptionCode() : err;
    }

- 其中IServiceManager::getInterfaceDescriptor()等于"android.os.IServiceManager"；
- remote()就是BpBinder()。

**（4）BpBinder::transact**

调用参数方法：transact(ADD_SERVICE_TRANSACTION, data, &reply, 0);

位于`BpBinder.cpp`文件, 代码如下：

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

真正工作交给IPCThreadState来进行transact工作。


**（5）IPCThreadState**

**<5.1> IPCThreadState::self()**

	IPCThreadState* IPCThreadState::self()
	{
	    if (gHaveTLS) { //gHaveTLS首次进入为false
	restart:
	        const pthread_key_t k = gTLS;
	        IPCThreadState* st = (IPCThreadState*)pthread_getspecific(k);
	        if (st) return st;
	        return new IPCThreadState;
	    }
	    
	    if (gShutdown) return NULL;
	    
	    pthread_mutex_lock(&gTLSMutex);
	    if (!gHaveTLS) {
	        if (pthread_key_create(&gTLS, threadDestructor) != 0) {
	            pthread_mutex_unlock(&gTLSMutex);
	            return NULL;
	        }
	        gHaveTLS = true;
	    }
	    pthread_mutex_unlock(&gTLSMutex);
	    goto restart;
	}

TLS是指Thread local storage(线程本地储存空间)，每个线程都拥有自己的TLS，并且是私有空间，线程之间不会共享。通过pthread_getspecific/pthread_setspecific函数可以获取/设置这些空间中的内容。从线程本地存储空间中获得保存在其中的IPCThreadState对象。

**<5.2> new IPCThreadState**

	IPCThreadState::IPCThreadState()
	    : mProcess(ProcessState::self()),
	      mMyThreadId(gettid()),    
	      mStrictModePolicy(0),
	      mLastTransactionBinderFlags(0)
	{
	    pthread_setspecific(gTLS, this);
	    clearCaller();
	    mIn.setDataCapacity(256);
	    mOut.setDataCapacity(256);
	}

每个线程都有一个`IPCThreadState`，每个`IPCThreadState`中都有一个mIn、一个mOut。成员变量mProcess保存了ProcessState变量(每个进程只有一个)。

- mIn 用来接收来自Binder设备的数据，默认大小为256字节；
- mOut用来存储发往Binder设备的数据，默认大小为256字节。

**<5.3> transact过程**

transact (0，ADD_SERVICE_TRANSACTION, data, &reply, 0);

	status_t IPCThreadState::transact(int32_t handle,
	                                  uint32_t code, const Parcel& data,
	                                  Parcel* reply, uint32_t flags)
	{
	    status_t err = data.errorCheck(); //数据错误检查
	    
	    flags |= TF_ACCEPT_FDS;
	    
	    ....

	    if (err == NO_ERROR) {
	        err = writeTransactionData(BC_TRANSACTION, flags, handle, code, data, NULL); // 传输数据
	    }
	    
	    if (err != NO_ERROR) {
	        if (reply) reply->setError(err);
	        return (mLastError = err);
	    }
	    
	    if ((flags & TF_ONE_WAY) == 0) { //flgs =0, 进入该分支
	        if (reply) {
	            err = waitForResponse(reply); //等待响应
	        } else {
	            Parcel fakeReply;
	            err = waitForResponse(&fakeReply);
	        }

	    } else {
	        err = waitForResponse(NULL, NULL);
	    }
	    
	    return err;
	}

工作分3部分：

- errorCheck()  //数据错误检查
- writeTransactionData() // 传输数据
- waitForResponse()  //f等待响应


另外：请求消息码和回应消息码的对应关系
请求码：应用程序向binder设备请求的消息，以BC_开头，总17条；详细见本文最后的附录
响应码：binder设备向应用程序回复的消息，以BR_开头，总18条。详细见本文最后的附录

**(7) 发送请求 writeTransactionData**

writeTransactionData(BC_TRANSACTION, 0, 0, ADD_SERVICE_TRANSACTION, data, NULL)

位于`IPCThreadState.cpp`文件, 代码如下：

	status_t IPCThreadState::writeTransactionData(int32_t cmd, uint32_t binderFlags,
	    int32_t handle, uint32_t code, const Parcel& data, status_t* statusBuffer)
	{
	    binder_transaction_data tr;
	
	    tr.target.ptr = 0;
	    tr.target.handle = handle; // handle=0
	    tr.code = code;  // ADD_SERVICE_TRANSACTION
	    tr.flags = binderFlags; // 0 
	    tr.cookie = 0;
	    tr.sender_pid = 0;
	    tr.sender_euid = 0;
	    
	    const status_t err = data.errorCheck();
	    if (err == NO_ERROR) {
	        tr.data_size = data.ipcDataSize();  // data为Media服务相关的parcel
	        tr.data.ptr.buffer = data.ipcData();
	        tr.offsets_size = data.ipcObjectsCount()*sizeof(binder_size_t);
	        tr.data.ptr.offsets = data.ipcObjects();
	    } else if (statusBuffer) {
	        tr.flags |= TF_STATUS_CODE;
	        *statusBuffer = err;
	        tr.data_size = sizeof(status_t);
	        tr.data.ptr.buffer = reinterpret_cast<uintptr_t>(statusBuffer);
	        tr.offsets_size = 0;
	        tr.data.ptr.offsets = 0;
	    } else {
	        return (mLastError = err);
	    }
	    
	    mOut.writeInt32(cmd); //cmd = BC_TRANSACTION
	    mOut.write(&tr, sizeof(tr)); //写入binder_transaction_data数据
	    
	    return NO_ERROR;
	}

- handle的值用来标识目的端，其中0是ServiceManager的标志。
- `binder_transaction_data` 是和binder设备通信的数据结构。最终是把所有相关信息写到`mOut`。

**(8) 等待响应 waitForResponse**

waitForResponse(&reply, NULL);

位于`IPCThreadState.cpp`文件, 代码如下：

不断循环地与Binder驱动设备交互，获取响应信息

	status_t IPCThreadState::waitForResponse(Parcel *reply, status_t *acquireResult)
	{
	    int32_t cmd;
	    int32_t err;
	
	    while (1) {
	        if ((err=talkWithDriver()) < NO_ERROR) break; //
	        err = mIn.errorCheck();
	        if (err < NO_ERROR) break;
	        if (mIn.dataAvail() == 0) continue;
	        
	        cmd = mIn.readInt32();
	
	        switch (cmd) {
	        case BR_TRANSACTION_COMPLETE:
	            if (!reply && !acquireResult) goto finish;
	            break;
	        
	        case BR_DEAD_REPLY:
	            err = DEAD_OBJECT;
	            goto finish;
	
	        case BR_FAILED_REPLY:
	            err = FAILED_TRANSACTION;
	            goto finish;
	        
	        case BR_ACQUIRE_RESULT:
	            {
	                const int32_t result = mIn.readInt32();
	                if (!acquireResult) continue;
	                *acquireResult = result ? NO_ERROR : INVALID_OPERATION;
	            }
	            goto finish;
	        
	        case BR_REPLY:
	            {
	                binder_transaction_data tr;
	                err = mIn.read(&tr, sizeof(tr));
	                if (err != NO_ERROR) goto finish;
	
	                if (reply) {
	                    if ((tr.flags & TF_STATUS_CODE) == 0) {
	                        reply->ipcSetDataReference(
	                            reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
	                            tr.data_size,
	                            reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
	                            tr.offsets_size/sizeof(binder_size_t),
	                            freeBuffer, this);
	                    } else {
	                        err = *reinterpret_cast<const status_t*>(tr.data.ptr.buffer);
	                        freeBuffer(NULL,
	                            reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
	                            tr.data_size,
	                            reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
	                            tr.offsets_size/sizeof(binder_size_t), this);
	                    }
	                } else {
	                    freeBuffer(NULL,
	                        reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
	                        tr.data_size,
	                        reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
	                        tr.offsets_size/sizeof(binder_size_t), this);
	                    continue;
	                }
	            }
	            goto finish;
	
	        default:
	            err = executeCommand(cmd);  //执行
	            if (err != NO_ERROR) goto finish;
	            break;
	        }
	    }
	
	finish:
	    if (err != NO_ERROR) {
	        if (acquireResult) *acquireResult = err;
	        if (reply) reply->setError(err);
	        mLastError = err;
	    }
	    
	    return err;
	}

talkWithDriver，才是真正往Binder设备写数据，与读取Binder设备数据的过程。


** (9) executeCommand**

executeCommand(BR_TRANSACTION)

根据收到的响应消息，执行相应的操作。

位于`IPCThreadState.cpp`文件, 代码如下：

	status_t IPCThreadState::executeCommand(int32_t cmd)
	{
	    BBinder* obj;
	    RefBase::weakref_type* refs;
	    status_t result = NO_ERROR;
	    
	    switch (cmd) {
	    case BR_ERROR:
	        result = mIn.readInt32();
	        break;
	        
	    case BR_OK:
	        break;
	        
	    case BR_ACQUIRE:
	        refs = (RefBase::weakref_type*)mIn.readPointer();
	        obj = (BBinder*)mIn.readPointer();
	        obj->incStrong(mProcess.get());
	        mOut.writeInt32(BC_ACQUIRE_DONE);
	        mOut.writePointer((uintptr_t)refs);
	        mOut.writePointer((uintptr_t)obj);
	        break;
	        
	    case BR_RELEASE:
	        refs = (RefBase::weakref_type*)mIn.readPointer();
	        obj = (BBinder*)mIn.readPointer();
	        mPendingStrongDerefs.push(obj);
	        break;
	        
	    case BR_INCREFS:
	        refs = (RefBase::weakref_type*)mIn.readPointer();
	        obj = (BBinder*)mIn.readPointer();
	        refs->incWeak(mProcess.get());
	        mOut.writeInt32(BC_INCREFS_DONE);
	        mOut.writePointer((uintptr_t)refs);
	        mOut.writePointer((uintptr_t)obj);
	        break;
	        
	    case BR_DECREFS:
	        refs = (RefBase::weakref_type*)mIn.readPointer();
	        obj = (BBinder*)mIn.readPointer();
	        mPendingWeakDerefs.push(refs);
	        break;
	        
	    case BR_ATTEMPT_ACQUIRE:
	        refs = (RefBase::weakref_type*)mIn.readPointer();
	        obj = (BBinder*)mIn.readPointer(); 
            const bool success = refs->attemptIncStrong(mProcess.get());
            mOut.writeInt32(BC_ACQUIRE_RESULT);
            mOut.writeInt32((int32_t)success);
	        break;
	    
	    case BR_TRANSACTION:
	        {
	            binder_transaction_data tr;
	            result = mIn.read(&tr, sizeof(tr));
	            if (result != NO_ERROR) break;
	            
	            Parcel buffer;
	            buffer.ipcSetDataReference(
	                reinterpret_cast<const uint8_t*>(tr.data.ptr.buffer),
	                tr.data_size,
	                reinterpret_cast<const binder_size_t*>(tr.data.ptr.offsets),
	                tr.offsets_size/sizeof(binder_size_t), freeBuffer, this);
	            
	            const pid_t origPid = mCallingPid;
	            const uid_t origUid = mCallingUid;
	            const int32_t origStrictModePolicy = mStrictModePolicy;
	            const int32_t origTransactionBinderFlags = mLastTransactionBinderFlags;
	
	            mCallingPid = tr.sender_pid;
	            mCallingUid = tr.sender_euid;
	            mLastTransactionBinderFlags = tr.flags;
	
	            int curPrio = getpriority(PRIO_PROCESS, mMyThreadId);
	            if (gDisableBackgroundScheduling) {
	                if (curPrio > ANDROID_PRIORITY_NORMAL) {
	                    setpriority(PRIO_PROCESS, mMyThreadId, ANDROID_PRIORITY_NORMAL);
	                }
	            } else {
	                if (curPrio >= ANDROID_PRIORITY_BACKGROUND) {
	                    set_sched_policy(mMyThreadId, SP_BACKGROUND);
	                }
	            }
	
	            Parcel reply;
	            status_t error;
				// tr.cookie里存放的是BBinder，此处b是BBinder的实现子类
	            if (tr.target.ptr) {
	                sp<BBinder> b((BBinder*)tr.cookie);
		            error = b->transact(tr.code, buffer, &reply, tr.flags);

	            } else {
	                error = the_context_object->transact(tr.code, buffer, &reply, tr.flags);
	            }
	            
	            if ((tr.flags & TF_ONE_WAY) == 0) {
	                if (error < NO_ERROR) reply.setError(error);
	                sendReply(reply, 0);
	            }
	            
	            mCallingPid = origPid;
	            mCallingUid = origUid;
	            mStrictModePolicy = origStrictModePolicy;
	            mLastTransactionBinderFlags = origTransactionBinderFlags;
	            
	        }
	        break;
	    
	    case BR_DEAD_BINDER:
	        {  //收到binder驱动发来的service死掉的消息，只有Bp端能收到
	            BpBinder *proxy = (BpBinder*)mIn.readPointer();
	            proxy->sendObituary();
	            mOut.writeInt32(BC_DEAD_BINDER_DONE);
	            mOut.writePointer((uintptr_t)proxy);
	        } break;
	        
	    case BR_CLEAR_DEATH_NOTIFICATION_DONE:
	        {
	            BpBinder *proxy = (BpBinder*)mIn.readPointer();
	            proxy->getWeakRefs()->decWeak(proxy);
	        } break;
	        
	    case BR_FINISHED:
	        result = TIMED_OUT;
	        break;
	        
	    case BR_NOOP:
	        break;
	        
	    case BR_SPAWN_LOOPER:
	        mProcess->spawnPooledThread(false);//收到来自驱动的指示以创建一个新线程，用于和Binder通信
	        break;
	        
	    default:
	        result = UNKNOWN_ERROR;
	        break;
	    }
	
	    if (result != NO_ERROR) {
	        mLastError = result;
	    }
	    
	    return result;
	}

**(10)与Binder驱动交互 talkWithDriver**

talkWithDriver(true)

位于`IPCThreadState.cpp`文件, 代码如下：

	status_t IPCThreadState::talkWithDriver(bool doReceive)
	{
	    if (mProcess->mDriverFD <= 0) {
	        return -EBADF;
	    }
	    
	    binder_write_read bwr;
	    
	    const bool needRead = mIn.dataPosition() >= mIn.dataSize();
	    const size_t outAvail = (!doReceive || needRead) ? mOut.dataSize() : 0;
	    
	    bwr.write_size = outAvail;
	    bwr.write_buffer = (uintptr_t)mOut.data();
	
	    if (doReceive && needRead) {
			//接收数据缓冲区信息的填充。如果以后收到数据，就直接填在mIn中了。
	        bwr.read_size = mIn.dataCapacity();
	        bwr.read_buffer = (uintptr_t)mIn.data();
	    } else {
	        bwr.read_size = 0;
	        bwr.read_buffer = 0;
	    }
	    
	    if ((bwr.write_size == 0) && (bwr.read_size == 0)) return NO_ERROR;
	
	    bwr.write_consumed = 0;
	    bwr.read_consumed = 0;
	    status_t err;
	    do {
	#if defined(HAVE_ANDROID_OS)
	        if (ioctl(mProcess->mDriverFD, BINDER_WRITE_READ, &bwr) >= 0) //ioctl不停的读写操作
	            err = NO_ERROR;
	        else
	            err = -errno;
	#else
	        err = INVALID_OPERATION;
	#endif
	        if (mProcess->mDriverFD <= 0) {
	            err = -EBADF;
	        }
	       
	    } while (err == -EINTR);
	
	    if (err >= NO_ERROR) {
	        if (bwr.write_consumed > 0) {
	            if (bwr.write_consumed < mOut.dataSize())
	                mOut.remove(0, bwr.write_consumed);
	            else
	                mOut.setDataSize(0);
	        }
	        if (bwr.read_consumed > 0) {
	            mIn.setDataSize(bwr.read_consumed);
	            mIn.setDataPosition(0);
	        }
	        return NO_ERROR;
	    }
	    return err;
	}

`binder_write_read`是用来与Binder设备交换数据的结构, 通过ioctl与mDriverFD通信。该方法是真正与Binder驱动进行数据读写交互的过程。


**(11)服务端事务处理 BBinder::transact**

位于`Binder.cpp`文件, 代码如下：

	status_t BBinder::transact(
	    uint32_t code, const Parcel& data, Parcel* reply, uint32_t flags)
	{
	    data.setDataPosition(0);
	
	    status_t err = NO_ERROR;
	    switch (code) {
	        case PING_TRANSACTION:
	            reply->writeInt32(pingBinder());
	            break;
	        default:
	            err = onTransact(code, data, reply, flags); (见代码12)
	            break;
	    }
	
	    if (reply != NULL) {
	        reply->setDataPosition(0);
	    }
	
	    return err;
	}

**(12) BBinder::onTransact**

位于`Binder.cpp`文件, 代码如下：

	status_t BBinder::onTransact(
	    uint32_t code, const Parcel& data, Parcel* reply, uint32_t /*flags*/)
	{
	    switch (code) {
	        case INTERFACE_TRANSACTION:
	            reply->writeString16(getInterfaceDescriptor());
	            return NO_ERROR;
	
	        case DUMP_TRANSACTION: {
	            int fd = data.readFileDescriptor();
	            int argc = data.readInt32();
	            Vector<String16> args;
	            for (int i = 0; i < argc && data.dataAvail() > 0; i++) {
	               args.add(data.readString16());
	            }
	            return dump(fd, args);
	        }
	
	        case SYSPROPS_TRANSACTION: {
	            report_sysprop_change();
	            return NO_ERROR;
	        }
	
	        default:
	            return UNKNOWN_TRANSACTION;
	    }
	}

### 2.4 创建线程池
	ProcessState::self()->startThreadPool();  

**(16)startThreadPool**

位于`ProcessState.cpp`文件, 代码如下：

	void ProcessState::startThreadPool()
	{
	    AutoMutex _l(mLock);    //多线程同步 自动锁
	    if (!mThreadPoolStarted) {
	        mThreadPoolStarted = true;
	        spawnPooledThread(true);
	    }
	}

**(17) spawnPooledThread(true)**

	void ProcessState::spawnPooledThread(bool isMain)
	{
	    if (mThreadPoolStarted) {
	        String8 name = makeBinderThreadName(); //获取Binder线程名
	        sp<Thread> t = new PoolThread(isMain);
	        t->run(name.string());
	    }
	}

- 获取Binder线程名，格式为`Binder_x`, 其中x为整数。每个进程中的binder编码是从1开始，依次递增;
- 在终端通过 `ps -t | grep Binder`，能看到当前所有的Binder线程。

### 2.5 Join线程池
	IPCThreadState::self()->joinThreadPool();

位于`IPCThreadState.cpp`文件, 代码如下：

	void IPCThreadState::joinThreadPool(bool isMain)
	{
        //isMain为true，则需要循环处理
	    mOut.writeInt32(isMain ? BC_ENTER_LOOPER : BC_REGISTER_LOOPER);
	    set_sched_policy(mMyThreadId, SP_FOREGROUND); //设置前台调度策略
	        
	    status_t result;
	    do {
	        processPendingDerefs();
	        result = getAndExecuteCommand();
	
	        if (result < NO_ERROR && result != TIMED_OUT && result != -ECONNREFUSED && result != -EBADF) {
	            abort();
	        }
	        
	        if(result == TIMED_OUT && !isMain) {
	            break;
	        }
	    } while (result != -ECONNREFUSED && result != -EBADF);
	    
	    mOut.writeInt32(BC_EXIT_LOOPER);
	    talkWithDriver(false);
	}

将线程调度策略设置SP_FOREGROUND，当已启动的线程由后台的scheduling group创建，可以避免由后台线程优先级来执行初始化的transaction。


----------

### 附录：Binder相关数据结构

**1.binder_write_read**

	struct binder_write_read {
		binder_size_t		write_size;	/* bytes to write */
		binder_size_t		write_consumed;	/* bytes consumed by driver */
		binder_uintptr_t	write_buffer;
		binder_size_t		read_size;	/* bytes to read */
		binder_size_t		read_consumed;	/* bytes consumed by driver */
		binder_uintptr_t	read_buffer;
	};

**2.binder_transaction_data**

	struct binder_transaction_data {
		union {
			__u32	handle;	
			binder_uintptr_t ptr;	
		} target;
		binder_uintptr_t	cookie;	
		__u32		code;		
	
		__u32	        flags;
		pid_t		sender_pid;
		uid_t		sender_euid;
		binder_size_t	data_size;	
		binder_size_t	offsets_size;	
	
		union {
			struct {
				binder_uintptr_t	buffer;
				binder_uintptr_t	offsets;
			} ptr;
			__u8	buf[8];
		} data;
	};

**3. binder请求码**

	enum binder_driver_command_protocol {
		//transaction发送命令
		BC_TRANSACTION = _IOW('c', 0, struct binder_transaction_data),
		BC_REPLY = _IOW('c', 1, struct binder_transaction_data),
	
		BC_ACQUIRE_RESULT = _IOW('c', 2, __s32),
		BC_FREE_BUFFER = _IOW('c', 3, binder_uintptr_t),
	
		BC_INCREFS = _IOW('c', 4, __u32),
		BC_ACQUIRE = _IOW('c', 5, __u32),
		BC_RELEASE = _IOW('c', 6, __u32),
		BC_DECREFS = _IOW('c', 7, __u32),
	
		BC_INCREFS_DONE = _IOW('c', 8, struct binder_ptr_cookie),
		BC_ACQUIRE_DONE = _IOW('c', 9, struct binder_ptr_cookie),
	
		BC_ATTEMPT_ACQUIRE = _IOW('c', 10, struct binder_pri_desc),
		BC_REGISTER_LOOPER = _IO('c', 11),
	
		BC_ENTER_LOOPER = _IO('c', 12),
		BC_EXIT_LOOPER = _IO('c', 13),
	
		BC_REQUEST_DEATH_NOTIFICATION = _IOW('c', 14, struct binder_handle_cookie),
	
		BC_CLEAR_DEATH_NOTIFICATION = _IOW('c', 15, struct binder_handle_cookie),
	
		BC_DEAD_BINDER_DONE = _IOW('c', 16, binder_uintptr_t),
	};

**4. binder响应码**

	enum binder_driver_return_protocol {
		//错误码
		BR_ERROR = _IOR('r', 0, __s32),
		//ok
		BR_OK = _IO('r', 1),
		
		//响应transaction
		BR_TRANSACTION = _IOR('r', 2, struct binder_transaction_data),
	
		//消息回复
		BR_REPLY = _IOR('r', 3, struct binder_transaction_data),
	
	
		BR_ACQUIRE_RESULT = _IOR('r', 4, __s32),
	
		// 死亡回复
		BR_DEAD_REPLY = _IO('r', 5),
	
	
		BR_TRANSACTION_COMPLETE = _IO('r', 6),
	
		BR_INCREFS = _IOR('r', 7, struct binder_ptr_cookie),
		BR_ACQUIRE = _IOR('r', 8, struct binder_ptr_cookie),
		BR_RELEASE = _IOR('r', 9, struct binder_ptr_cookie),
		BR_DECREFS = _IOR('r', 10, struct binder_ptr_cookie),
	
		BR_ATTEMPT_ACQUIRE = _IOR('r', 11, struct binder_pri_ptr_cookie),
	
		BR_NOOP = _IO('r', 12),
	
		BR_SPAWN_LOOPER = _IO('r', 13),
	
		BR_FINISHED = _IO('r', 14),
	
		BR_DEAD_BINDER = _IOR('r', 15, binder_uintptr_t),
	
		BR_CLEAR_DEATH_NOTIFICATION_DONE = _IOR('r', 16, binder_uintptr_t),
	
		BR_FAILED_REPLY = _IO('r', 17),
	
	};

## 思考
- binder分配的默认内存大小为 1M-8k， 内存大小的设置依据？
- binder默认的最大可并发访问的线程数为15，为什么不是2^4=16？
- defaultServiceManager中，获取server，失败后sleep 1s，建议可以缩短，提升响应速度。
- IPCThreadState，用来接收/发送来自Binder设备的数据mIn=256，mOut=256。mIn, mOut都是Parcel类型。每一次talkWithDriver,当mIn,mOut占满时，总512字节。每个线程拥有一个IPCThreadState，最大15个线程。