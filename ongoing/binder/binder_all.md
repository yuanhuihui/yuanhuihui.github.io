Binder系统(精简版)

### 注册过程

    virtual status_t addService(const String16& name, const sp<IBinder>& service,
            bool allowIsolated)
    {
        Parcel data, reply; //Parcel是数据通信包
        data.writeInterfaceToken(IServiceManager::getInterfaceDescriptor());   
        data.writeString16(name);        // name为 "media.player"
        data.writeStrongBinder(service); // MediaPlayerService对象【见小节3.2.1】
        data.writeInt32(allowIsolated ? 1 : 0); // allowIsolated= false
        status_t err = remote()->transact(ADD_SERVICE_TRANSACTION, data, &reply);
        return err == NO_ERROR ? reply.readExceptionCode() : err;
    }
    
    IPC.transact(
        int32_t handle,  
        uint32_t code, 
        const Parcel& data,
        Parcel* reply, 
        uint32_t flags)
                                      
addService -> BpBinder::transact -> IPC.transact

handle = 0
code = ADD_SERVICE_TRANSACTION
data = Parcel

1. 数据封装到parcel对象, 即br_data -> data.


注册过程，service server端创建binder_node, service manger端创建binder_ref.

#### writeStrongBinder：先将IBinder转换为flat_binder_object，再把flat_binder_object写入out

IBinder -> flat_binder_object

1）BBinder则
  obj.type = BINDER_TYPE_BINDER; 
  obj.binder = reinterpret_cast<uintptr_t>(BBinder->getWeakRefs());
  obj.cookie = reinterpret_cast<uintptr_t>(BBinder);
  
2）BpBinde则
  obj.type = BINDER_TYPE_HANDLE; 
  obj.handle = handle;

#### 
binder_transaction_data
flat_binder_object

####

proc->refs_by_desc, 根据handle找到binder_ref

handle只在本进程有含义，且是唯一的，并且对应唯一的binder_ref. 
同一个binder服务，在不同进程的handle是不同的。


#### 

binder_transaction也是链条关系。


handle值计算方法规律：

每个进程binder_proc所记录的binder_ref的handle值是从1开始递增的；
所有进程binder_proc所记录的handle=0的binder_ref都指向service manager；
同一个服务的binder_node在不同进程的binder_ref的handle值可以不同；
