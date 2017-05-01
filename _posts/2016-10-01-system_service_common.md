---
layout: post
title:  "Android系统服务的注册方式"
date:   2016-10-01 21:12:40
catalog:  true
tags:
    - android

---

## 一. 概述

启动启动过程有采用过两种不同的方式来注册系统服务：

- ServiceManager的addService()
- SystemServiceManager的startService()

其核心都是向servicemanager进程注册binder服务，但功能略有不同，下面从源码角度详加说明。

## 二. SM.addService方式

这里以InputManagerService服务为例, 说明这类服务的启动方式:

    inputManager = new InputManagerService(context, null); //先创建服务对象
    ServiceManager.addService(Context.INPUT_SERVICE, inputManager); //[见小节2.1]
    

### 2.1 SM.addService
[-> ServiceManager.java]

    public static void addService(String name, IBinder service) {
        try {
            // [见小节2.2 和 2.3]
            getIServiceManager().addService(name, service, false);
        } catch (RemoteException e) {
            Log.e(TAG, "error in addService", e);
        }
    }

### 2.2 SM.getIServiceManager
[-> ServiceManager.java]

    private static IServiceManager getIServiceManager() {
        if (sServiceManager != null) {
            return sServiceManager;
        }
        //【见2.2.1】
        sServiceManager = ServiceManagerNative.asInterface(BinderInternal.getContextObject());
        return sServiceManager;
    }

采用了单例模式获取ServiceManager  getIServiceManager()返回的是ServiceManagerProxy(简称SMP)对象.

其中BinderInternal.getContextObject(), 等价于new BpBinder(0), handle=0意味着指向的是远程进程/system/bin/servicemanager中的
[ServiceManager服务](http://gityuan.com/2015/11/08/binder-get-sm/).


#### 2.2.1 asInterface
[-> ServiceManagerNative.java]

    public abstract class ServiceManagerNative extends Binder implements IServiceManager
    {

        static public IServiceManager asInterface(IBinder obj)
        {
            if (obj == null) {
                return null;
            }
            IServiceManager in =
                (IServiceManager)obj.queryLocalInterface(descriptor);
            if (in != null) {
                return in;
            }
            //创建ServiceManagerProxy对象[见小节2.2.2]
            return new ServiceManagerProxy(obj);
        }
    }

#### 2.2.2 ServiceManagerProxy创建
[-> ServiceManagerNative.java ::ServiceManagerProxy]

    class ServiceManagerProxy implements IServiceManager {
        private IBinder mRemote;
        
        public ServiceManagerProxy(IBinder remote) {
            mRemote = remote;
        }
        ...
    }


可见, getIServiceManager()过程是获取一个用于跟远程ServiceManager服务(这个用于管理所有binder服务的大管家)进行通信的binder代理端.

### 2.3 SMP.addService
[-> ServiceManagerNative.java ::ServiceManagerProxy]

    public void addService(String name, IBinder service, boolean allowIsolated)
            throws RemoteException {
        Parcel data = Parcel.obtain();
        Parcel reply = Parcel.obtain();
        data.writeInterfaceToken(IServiceManager.descriptor);
        data.writeString(name);
        data.writeStrongBinder(service);
        data.writeInt(allowIsolated ? 1 : 0);
        mRemote.transact(ADD_SERVICE_TRANSACTION, data, reply, 0);
        reply.recycle();
        data.recycle();
    }

通过mRemote向将ADD_SERVICE_TRANSACTION的事件发送给ServiceManager. 接下来的内容见[Binder系列5—注册服务(addService)](http://gityuan.com/2015/11/14/binder-add-service/#addservice).

## 三. SSM.startService方式

通过这种方式启动的服务,有一个特点都是继承于SystemService对象, 这里以PowerManagerService为例来说明:

    //[见小节3.1]
    mSystemServiceManager = new SystemServiceManager(mSystemContext); 
    //[见小节3.2]
    mPowerManagerService = mSystemServiceManager.startService(PowerManagerService.class);


### 3.1 SSM初始化
[-> SystemServiceManager.java]

    public class SystemServiceManager {
        private final Context mContext;
        
        //接收lifecycle事件的服务
        private final ArrayList<SystemService> mServices = new ArrayList<SystemService>();
        
        public SystemServiceManager(Context context) {
            mContext = context;
        }
        
    }

mSystemServiceManager只会创建一次，后续其他服务通过该方式启动，直接调用其startService()方法即可。

### 3.2 SSM.startService
[-> SystemServiceManager.java]

    public <T extends SystemService> T startService(Class<T> serviceClass) {
        final String name = serviceClass.getName();

        //保证要启动的服务是继承于SystemService,否则抛出异常
        if (!SystemService.class.isAssignableFrom(serviceClass)) {
            throw new RuntimeException(...);
        }
        
        final T service;
        try {
            Constructor<T> constructor = serviceClass.getConstructor(Context.class);
            //通过反射创建目标服务类的对象
            service = constructor.newInstance(mContext);
        } catch (Exception ex) {
            ...
        }
        //将该服务添加到mServices
        mServices.add(service);

        try {
            //执行服务的onStart过程 
            service.onStart();
        } catch (RuntimeException ex) {
            ...
        }
        return service;
    }

mSystemServiceManager.startService(xxx.class) 功能主要：

1. 创建xxx类的对象,执行该对象的构造函数；
2. 将该对象添加到mSystemServiceManager的成员变量mServices；
3. 调用该对象的onStart();

看到这并没有看到服务是如何注册到ServiceManager, 这里继续以PowerManagerService为例,其实是在onStart()完成.

#### 3.2.1 onStart
[-> PowerManagerService.java]

    public void onStart() {
        //[见小节3.2.2]
        publishBinderService(Context.POWER_SERVICE, new BinderService());
        publishLocalService(PowerManagerInternal.class, new LocalService());

        Watchdog.getInstance().addMonitor(this);
        Watchdog.getInstance().addThread(mHandler);
    }

PowerManagerService定义了一个内部类BinderService, 继承于IPowerManager.Stub服务. 再调用publishBinderService来注册服务.

#### 3.2.2 publishBinderService
[-> SystemService.java]

    public abstract class SystemService {
        protected final void publishBinderService(String name, IBinder service) {
            publishBinderService(name, service, false);
        }

        protected final void publishBinderService(String name, IBinder service,
                boolean allowIsolated) {
            ServiceManager.addService(name, service, allowIsolated);
        }
    }

到此可见, 采用该方式真正注册服务的过程,同样也是采用ServiceManager.addService方式.

通过这种方式启动的服务, 都是继承于SystemService类, 那么这种方式启动的服务有什么特殊之处吗? 答应就是startBootPhase的过程:

### 3.3 SSM.startBootPhase
[-->SystemServiceManager.java]

    public void startBootPhase(final int phase) {
        mCurrentPhase = phase;

        final int serviceLen = mServices.size();
        for (int i = 0; i < serviceLen; i++) {
            final SystemService service = mServices.get(i);
            try {
                service.onBootPhase(mCurrentPhase);
            } catch (Exception ex) {
                ...
        }
    }

所有通过该方式注册的继承于SystemService的服务,都会被添加到mServices. 该方法会根据当前系统启动到不同的阶段, 则回调所有服务onBootPhase()方法

#### 3.3.1 BootPhase
系统开机启动过程, 当执行到system_server进程时, 将启动过程划分了几个阶段, 定义在SystemService.java文件

    public static final int PHASE_WAIT_FOR_DEFAULT_DISPLAY = 100; 
    public static final int PHASE_LOCK_SETTINGS_READY = 480;
    public static final int PHASE_SYSTEM_SERVICES_READY = 500;
    public static final int PHASE_ACTIVITY_MANAGER_READY = 550;
    public static final int PHASE_THIRD_PARTY_APPS_CAN_START = 600;
    public static final int PHASE_BOOT_COMPLETED = 1000;

这些阶段跟系统服务大致的顺序图,如下:

![system_server服务启动流程](/images/boot/systemServer/system_server_boot_process.jpg)

PHASE_BOOT_COMPLETED=1000，该阶段是发生在Boot完成和home应用启动完毕, 对于系统服务更倾向于监听该阶段，而非监听广播ACTION_BOOT_COMPLETED


### 四. 总结

方式1. ServiceManager.addService(): 

  - 功能：向ServiceManager注册该服务. 
  - 特点：服务往往直接或间接继承于Binder服务；
  - 举例：input, window, package；

方式2. SystemServiceManager.startService:

  - 功能：
      - 创建服务对象；
      - 执行该服务的onStart()方法；该方法会执行上面的SM.addService()；
      - 根据启动到不同的阶段会回调onBootPhase()方法； 
      - 另外，还有多用户模式下用户状态的改变也会有回调方法；例如onStartUser();
  - 特点：服务往往自身或内部类继承于SystemService； 
  - 举例：power, activity；

两种方式真正注册服务的过程都会调用到ServiceManager.addService()方法. 对于方式2多了一个服务对象创建以及
根据不同启动阶段采用不同的动作的过程。可以理解为方式2比方式1的功能更丰富。
