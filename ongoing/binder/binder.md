


### IO
BR_FAILED_REPLY = _IO('r', 17)

asm-generic/ioctl.h


#define _IOC_NONE 0U
#define _IOC_WRITE 1U
#define _IOC_READ 2U
#define _IOC_NRSHIFT = 0
#define _IOC_NRBITS 8
#define _IOC_TYPEBITS 8
#define _IOC_SIZEBITS 14
#define _IOC_TYPECHECK(t) (sizeof(t))


#define _IO(type,nr) _IOC(_IOC_NONE, (type), (nr), 0)
#define _IOR(type,nr,size) _IOC(_IOC_READ, (type), (nr), (_IOC_TYPECHECK(size)))
#define _IOW(type,nr,size) _IOC(_IOC_WRITE, (type), (nr), (_IOC_TYPECHECK(size)))
#define _IOWR(type,nr,size) _IOC(_IOC_READ | _IOC_WRITE, (type), (nr), (_IOC_TYPECHECK(size)))

#define _IOC(dir,type,nr,size) (((dir) << _IOC_DIRSHIFT) | ((type) << _IOC_TYPESHIFT) | ((nr) << _IOC_NRSHIFT) | ((size) << _IOC_SIZESHIFT))
= dir << 30  | type << 8 | nr | size << 16

_IOC_DIRSHIFT = _IOC_SIZESHIFT + _IOC_SIZEBITS = 16 + 14 = 30
_IOC_TYPESHIFT  =  _IOC_NRSHIFT + _IOC_NRBITS = 0 + 8 = 8
_IOC_NRSHIFT = 0
_IOC_SIZESHIFT = _IOC_TYPESHIFT + _IOC_TYPEBITS = 8 + 8 = 16


_IOC(0,"r", 17, 0)

return_error 前8位代表type, 后八位代表number.
r=114, c=99


return_error只有两种, 要么BR_FAILED_REPLY,要么BR_DEAD_REPLY


###

Binder死亡通知机制之linkToDeath, 需要画一张图
binder异常，需要添加到android.mk



Proc-todo
thread-todo
node-aync_todo



发起端
BpBinder.transact
  writeTransactionData
  waitForResponse
    talkwithDriver
      ioctl
        binder_thread_write 
          binder_transaction(处理BC_TRANSACTION --> BW_TRANSACTION_COMPLETE,BW_TRANSACTION
        binder_thread_read （处理BW_TRANSACTION_COMPLETE -> BR_TRANSACTION_COMPLETE
      
目标端：
binder_thread_read （处理BW_TRANSACTION -> BR_TRANSACTION
  executeCommand() （回到getAndExecuteCommand，交谈一次结束后，执行executeCommand）
    BBinder.transact
      xxx.onTransact

## Client

writeTransactionData //BC_TRANSACTION
waitForResponse
{
    while (1) {
        talkWithDriver()
        switch (cmd)
            case BR_TRANSACTION_COMPLETE:
            case BR_DEAD_REPLY:
            case BR_FAILED_REPLY:
            case BR_REPLY:  goto finish;
            default: executeCommand() //继续执行
    }
}

其中前4个BR_命令会退出waitForResponse()循环.

## Server

joinThreadPool
{
    while (1){
        processPendingDerefs() // BC_XXX
        getAndExecuteCommand()
            talkWithDriver()
            executeCommand()
    }
}

## 其中

    talkWithDriver
        binder_thread_write //BC_TRANSACTION
          //BINDER_WORK_TRANSACTION + BINDER_WORK_TRANSACTION_COMPLETE
          binder_transaction
        binder_thread_read //生成BR_TRANSACTION_COMPLETE + BR_TRANSACTION

    executeCommand
        case BR_TRANSACTION:
            BBinder.transact(&reply)
            sendReply(reply)
              writeTransactionData()  //BC_REPLY
              waitForResponse()
            freeBuffer() //BC_FREE_BUFFER

## 进一步转换

### client

waitForResponse
{
    while (1) {
        binder_thread_write //BC_TRANSACTION
        binder_thread_read //BR_TRANSACTION_COMPLETE + BR_TRANSACTION

        switch (cmd)
            case BR_REPLY:  goto finish;            
            default: executeCommand()
                BBinder.transact(&reply)
                sendReply(reply)
                  writeTransactionData()  //发送BC_REPLY
                  waitForResponse() //等待BR_TRANSACTION_COMPLETE
                freeBuffer() //BC_FREE_BUFFER
    }
}  

### server

joinThreadPool
{
    while (1){
        processPendingDerefs()
            writeTransactionData // BC_TRANSACTION
            waitForResponse //等待BR_REPLY(非oneway)

        executeCommand
            BBinder.transact(&reply)
            sendReply(reply)
              writeTransactionData()  //写入BC_REPLY
              waitForResponse()  //等待BR_TRANSACTION_COMPLETE
            freeBuffer() //发送BC_FREE_BUFFER, async_todo加入当前thread-todo
    }
}

http://m.blog.csdn.net/article/details?id=52145934
http://blog.csdn.net/coding_glacier/article/details/7520199
http://blog.csdn.net/ccjhdopc/article/details/51094755
