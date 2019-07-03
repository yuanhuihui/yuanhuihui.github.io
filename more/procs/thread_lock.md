### mutex

- pthread_mutex_lock: 互斥锁上锁
- pthread_mutex_unlock: 互斥锁解锁

- pthread_cond_wait: 先会解除当前线程的互斥锁，然后挂线线程，等待条件变量满足条件。一旦条件变量满足条件，则会给线程上锁，继续执行pthread_cond_wait
- pthread_cond_signal:激活等待列表中的线程
- pthread_cond_broadcast: 激活所有等待线程列表中最先入队的线程

## code

    pthread_mutex_t mutex = PTHREAD_MUTEX_INITIALIZER;//init mutex
    pthread_cond_t  cond = PTHREAD_COND_INITIALIZER;//init cond  

    pthread_cond_wait(&cond,&mutex); //wait  
    pthread_cond_signal(&cond); //wakeup
