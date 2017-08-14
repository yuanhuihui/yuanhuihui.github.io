http://light3moon.com/2015/01/28/Android%20Binder%20%E5%88%86%E6%9E%90%E2%80%94%E2%80%94%E6%AD%BB%E4%BA%A1%E9%80%9A%E7%9F%A5[DeathRecipient]/


Binder死亡通知机制之linkToDeath, 需要画一张图
binder异常，需要添加到android.mk

Proc-todo
thread-todo
node-aync_todo
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

joinThreadPool
{
    while (1){
        processPendingDerefs()
            writeTransactionData // BC_TRANSACTION
            waitForResponse //等待BR_REPLY(非oneway)

        binder_thread_write  // 写入BC_XXX
        binder_thread_read  // 读取BR_TRANSACTION

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
