http://light3moon.com/2015/01/28/Android%20Binder%20%E5%88%86%E6%9E%90%E2%80%94%E2%80%94%E6%AD%BB%E4%BA%A1%E9%80%9A%E7%9F%A5[DeathRecipient]/

Proc-todo
thread-todo
node-aync_todo


B死亡，A会收到马上收到通知
-> binder_thread_read (put_user_preempt_disabled(thread->return_error2, *ptr))
-> waitForResponse (reply->setError(err))


发起端
BpBinder.transact
  writeTransactionData
  waitForResponse
    talkwithDriver
      ioctl
        binder_thread_write 
          binder_transaction(处理BC_TRANSACTION --> BW_TRANSACTION_COMPLETE,BW_TRANSACTION
        binder_thread_read （处理BW_TRANSACTION_COMPLETE -> BR_TRANSACTION_COMPLETE
    异步通信，收到cmd==BR_TRANSACTION_COMPLETE，则结束执行
    同步通信，继续等待直到BR_DEAD_REPLY，BR_FAILED_REPLY，BR_REPLY，才结束等待。
    当然，如果此时收到其他BR_XXX, 则执行executeCommand
      
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
