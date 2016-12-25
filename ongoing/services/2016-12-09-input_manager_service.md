---
layout: post
title:  "Input输入系统(启动篇)"
date:   2016-12-09 20:09:12
catalog:  true
tags:
    - android

---

> 基于Android 6.0源码， 分析InputManagerService的启动过程

    frameworks/base/services/core/java/com/android/server/input/InputManagerService.java
    frameworks/base/services/core/jni/com_android_server_input_InputManagerService.cpp
    
    frameworks/native/services/inputflinger/
      - InputManager.cpp
      - InputDispatcher.cpp （内含InputDispatcherThread）
      - InputReader.cpp （内含InputReaderThread）
      - EventHub.cpp
      - InputListener.cpp
      
      
## 一. 概述

当用户触摸屏幕或者按键操作，首次触发的是硬件驱动，驱动收到事件后，将该相应事件写入到输入设备节点，
这便产生了最原生态的内核事件。接着，输入系统取出原生态的事件，经过层层封装后成为KeyEvent或者MotionEvent
；最后，交付给相应的目标窗口(Window)来消费该输入事件。可见，输入系统在整个过程起到承上启下的衔接作用。

Input模块的主要组成：

  - Native层的InputReader负责从EventHub取出事件并处理，再交给InputDispatcher；
  - Native层的InputDispatcher接收来自InputReader的输入事件，并记录WMS的窗口信息，用于派发事件到合适的窗口；
  - Java层跟WMS交互，WMS记录所有窗口信息，并同步更新到IMS，为InputDispatcher正确派发事件到ViewRootImpl提供保障；

Input相关的动态库：

- libinput.so：frameworks/native/libs/input/
- libinputflinger.so：frameworks/native/services/inputflinger/
- libinputservice.so： frameworks/base/libs/input/

### 1.1 整体框架类图

InputManagerService作为system_server中的重要服务，继承于IInputManager.Stub，
作为Binder服务端，那么Client位于InputManager的内部通过IInputManager.Stub.asInterface()
获取Binder代理端，C/S两端通信的协议是由IInputManager.aidl来定义的。

![input_binder](/images/input/input_binder.jpg)


Input模块所涉及的重要类的关系如下：

![input_class](/images/input/input_class.jpg)

- IMS的成员变量`mPtr`指向Native层的NativeInputManager对象；NativeInputManager的成员变量
mServiceObj指向Java层的IMS对象；

### 1.2 启动调用栈

IMS服务是伴随着system_server进程的启动而启动，整个调用过程：

    InputManagerService(初始化)
        nativeInit
            NativeInputManager
                EventHub
                InputManager
                    InputDispatcher
                        Looper
                    InputReader
                        QueuedInputListener
                    InputReaderThread
                    InputDispatcherThread
    IMS.start(启动)
        nativeStart
            InputManager.start
                InputReaderThread->run
                InputDispatcherThread->run

整个过程首先创建如下对象：NativeInputManager，EventHub，InputManager，
InputDispatcher，InputReader，InputReaderThread，InputDispatcherThread。
接着便是启动两个工作线程`InputReader`,`InputDispatcher`。
      
## 二. 启动过程

    private void startOtherServices() {
        //初始化IMS对象【见小节2.1】
        inputManager = new InputManagerService(context);
        ServiceManager.addService(Context.INPUT_SERVICE, inputManager);
        ...
        //将InputMonitor对象保持到IMS对象
        inputManager.setWindowManagerCallbacks(wm.getInputMonitor());
        //[见小节2.9]
        inputManager.start();
    }

### 2.1 InputManagerService
[-> InputManagerService.java]

    public InputManagerService(Context context) {
         this.mContext = context;
         // 运行在线程"android.display"
         this.mHandler = new InputManagerHandler(DisplayThread.get().getLooper());
         ...
         
         //初始化native对象【见小节2.2】
         mPtr = nativeInit(this, mContext, mHandler.getLooper().getQueue());
         LocalServices.addService(InputManagerInternal.class, new LocalService());
     }

### 2.2 nativeInit
[-> com_android_server_input_InputManagerService.cpp]

    static jlong nativeInit(JNIEnv* env, jclass /* clazz */,
            jobject serviceObj, jobject contextObj, jobject messageQueueObj) {
        //获取native消息队列
        sp<MessageQueue> messageQueue = android_os_MessageQueue_getMessageQueue(env, messageQueueObj);
        ...
        //创建Native的InputManager【见小节2.3】
        NativeInputManager* im = new NativeInputManager(contextObj, serviceObj,
                messageQueue->getLooper());
        im->incStrong(0);
        return reinterpret_cast<jlong>(im); //返回Native对象的指针
    }

### 2.3 NativeInputManager
[-> com_android_server_input_InputManagerService.cpp]

    NativeInputManager::NativeInputManager(jobject contextObj,
            jobject serviceObj, const sp<Looper>& looper) :
            mLooper(looper), mInteractive(true) {
        JNIEnv* env = jniEnv();

        mContextObj = env->NewGlobalRef(contextObj); //上层IMS的context
        mServiceObj = env->NewGlobalRef(serviceObj); //上层IMS服务
        {
            AutoMutex _l(mLock);
            mLocked.systemUiVisibility = ASYSTEM_UI_VISIBILITY_STATUS_BAR_VISIBLE;
            mLocked.pointerSpeed = 0;
            mLocked.pointerGesturesEnabled = true;
            mLocked.showTouches = false;
        }
        mInteractive = true;
        // 创建EventHub对象【见小节2.4】
        sp<EventHub> eventHub = new EventHub();
        // 创建InputManager对象【见小节2.5】
        mInputManager = new InputManager(eventHub, this, this);
    }
    
### 2.4 EventHub
[-> EventHub.cpp]

    EventHub::EventHub(void) :
            mBuiltInKeyboardId(NO_BUILT_IN_KEYBOARD), mNextDeviceId(1), mControllerNumbers(),
            mOpeningDevices(0), mClosingDevices(0),
            mNeedToSendFinishedDeviceScan(false),
            mNeedToReopenDevices(false), mNeedToScanDevices(true),
            mPendingEventCount(0), mPendingEventIndex(0), mPendingINotify(false) {
        acquire_wake_lock(PARTIAL_WAKE_LOCK, WAKE_LOCK_ID);
        //创建epoll
        mEpollFd = epoll_create(EPOLL_SIZE_HINT);

        mINotifyFd = inotify_init();
        //此处DEVICE_PATH为"/dev/input"，监听该设备路径
        int result = inotify_add_watch(mINotifyFd, DEVICE_PATH, IN_DELETE | IN_CREATE);

        struct epoll_event eventItem;
        memset(&eventItem, 0, sizeof(eventItem));
        eventItem.events = EPOLLIN;
        eventItem.data.u32 = EPOLL_ID_INOTIFY;
        //添加INotify到epoll实例
        result = epoll_ctl(mEpollFd, EPOLL_CTL_ADD, mINotifyFd, &eventItem);

        int wakeFds[2];
        result = pipe(wakeFds); //创建管道

        mWakeReadPipeFd = wakeFds[0];
        mWakeWritePipeFd = wakeFds[1];
        
        //将pipe的读和写都设置为非阻塞方式
        result = fcntl(mWakeReadPipeFd, F_SETFL, O_NONBLOCK);
        result = fcntl(mWakeWritePipeFd, F_SETFL, O_NONBLOCK);

        eventItem.data.u32 = EPOLL_ID_WAKE;
        //添加管道的读端到epoll实例
        result = epoll_ctl(mEpollFd, EPOLL_CTL_ADD, mWakeReadPipeFd, &eventItem);
        ...
    }

该方法主要功能：

- 初始化INotify（监听"/dev/input"），并添加到epoll实例
- 创建非阻塞模式的管道，并添加到epoll;


### 2.5 InputManager
[-> InputManager.cpp]

    InputManager::InputManager(
            const sp<EventHubInterface>& eventHub,
            const sp<InputReaderPolicyInterface>& readerPolicy,
            const sp<InputDispatcherPolicyInterface>& dispatcherPolicy) {
        //创建InputDispatcher对象【见小节2.6】
        mDispatcher = new InputDispatcher(dispatcherPolicy);
        //创建InputReader对象【见小节2.7】
        mReader = new InputReader(eventHub, readerPolicy, mDispatcher);
        initialize();//【见小节2.8】
    }

### 2.6 InputDispatcher
[-> InputDispatcher.cpp]

    InputDispatcher::InputDispatcher(const sp<InputDispatcherPolicyInterface>& policy) :
        mPolicy(policy),
        mPendingEvent(NULL), mLastDropReason(DROP_REASON_NOT_DROPPED),
        mAppSwitchSawKeyDown(false), mAppSwitchDueTime(LONG_LONG_MAX),
        mNextUnblockedEvent(NULL),
        mDispatchEnabled(false), mDispatchFrozen(false), mInputFilterEnabled(false),
        mInputTargetWaitCause(INPUT_TARGET_WAIT_CAUSE_NONE) {
        //创建Looper对象
        mLooper = new Looper(false);

        mKeyRepeatState.lastKeyEntry = NULL;
        //获取分发超时参数
        policy->getDispatcherConfiguration(&mConfig);
    }

此处超时参数来自于IMS，参数默认值keyRepeatTimeout = 500，keyRepeatDelay = 50

### 2.7 InputReader
[-> InputReader.cpp]

    InputReader::InputReader(const sp<EventHubInterface>& eventHub,
            const sp<InputReaderPolicyInterface>& policy,
            const sp<InputListenerInterface>& listener) :
            mContext(this), mEventHub(eventHub), mPolicy(policy),
            mGlobalMetaState(0), mGeneration(1),
            mDisableVirtualKeysTimeout(LLONG_MIN), mNextTimeout(LLONG_MAX),
            mConfigurationChangesToRefresh(0) {
        // 创建输入监听对象
        mQueuedListener = new QueuedInputListener(listener);
        {
            AutoMutex _l(mLock);
            refreshConfigurationLocked(0);
            updateGlobalMetaStateLocked();
        } 
    }

### 2.8 initialize
[-> InputManager.cpp]

    void InputManager::initialize() {
        //创建线程“InputReader”
        mReaderThread = new InputReaderThread(mReader);
        //创建线程”InputDispatcher“
        mDispatcherThread = new InputDispatcherThread(mDispatcher);
    }

    InputReaderThread::InputReaderThread(const sp<InputReaderInterface>& reader) :
            Thread(/*canCallJava*/ true), mReader(reader) {
    }

    InputDispatcherThread::InputDispatcherThread(const sp<InputDispatcherInterface>& dispatcher) :
            Thread(/*canCallJava*/ true), mDispatcher(dispatcher) {
    }
  
创建线程“InputReader”和”InputDispatcher“都是能访问Java代码的native线程

### 2.9 IMS.start
[-> InputManagerService.java]

    public void start() {
        // 启动native对象[见小节2.10]
        nativeStart(mPtr);

        Watchdog.getInstance().addMonitor(this);

        //注册触摸点速度和是否显示功能的观察者
        registerPointerSpeedSettingObserver();
        registerShowTouchesSettingObserver();

        mContext.registerReceiver(new BroadcastReceiver() {
            @Override
            public void onReceive(Context context, Intent intent) {
                updatePointerSpeedFromSettings();
                updateShowTouchesFromSettings();
            }
        }, new IntentFilter(Intent.ACTION_USER_SWITCHED), null, mHandler);

        updatePointerSpeedFromSettings(); //更新触摸点的速度
        updateShowTouchesFromSettings(); //是否在屏幕上显示触摸点
    }
        
### 2.10 nativeStart
[-> com_android_server_input_InputManagerService.cpp]

    static void nativeStart(JNIEnv* env, jclass /* clazz */, jlong ptr) {
        //此处ptr记录的便是NativeInputManager
        NativeInputManager* im = reinterpret_cast<NativeInputManager*>(ptr);
        // [见小节2.11]
        status_t result = im->getInputManager()->start();
        ...
    }
    
### 2.11 InputManager.start
[InputManager.cpp]

    status_t InputManager::start() {
        status_t result = mDispatcherThread->run("InputDispatcher", PRIORITY_URGENT_DISPLAY);
        ...
        result = mReaderThread->run("InputReader", PRIORITY_URGENT_DISPLAY);
        ...
        return OK;
    }
    
启动两个线程,分别是"InputDispatcher"和"InputReader"

### 2.12 小节

- IMS服务中的InputManagerHandler运行在线程"android.display"
- IMS服务中的成员变量mPtr记录Native层的NativeInputManager对象；
- IMS对象的初始化过程的重点在于native初始化，分别创建了以下对象：
  - NativeInputManager；
  - EventHub, InputManager；
  - InputReader，InputDispatcher；
  - InputReaderThread，InputDispatcherThread
- IMS启动过程的主要功能是启动以下两个线程：
  - InputReader：从EventHub取出事件并处理，再交给InputDispatcher
  - InputDispatcher：接收来自InputReader的输入事件，并派发事件到合适的窗口。

从整个启动过程，可知有system_server进程中有3个线程跟Input输入系统息息相关，分别是`android.display`,
`InputReader`,`InputDispatcher`。

Input事件流程：Linux Kernel -> IMS(InputReader -> InputDispatcher) -> WMS -> ViewRootImpl，
后续再进一步介绍。
