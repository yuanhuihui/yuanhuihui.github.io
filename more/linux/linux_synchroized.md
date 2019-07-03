内核提供的同步机制


- 原子操作：由编译器保证，保证一个线程的操作不会被其他线程打断
  - <asm/atomic.h>
- 自旋锁：
  - 不可递归，否则会自己递归死锁
  - 要禁止被中断，否则可能持锁线程与中断处理程序死锁
  - spin_lock/ spin_lock_irq/ spin_unlock/ spin_unlock_irq
  - <asm/spinlock.h>
- 读写自旋锁
  - 读锁之间共享
  - 写锁之间互斥
  - 读写锁之间互斥
  - read_lock/ read_lock_irq/ write_lock/ write_unlock_irq
- 信号量
  - down_interruptible/down/ up
  - <linux/semaphore.h>
- 读写信号量
  - <asm/rwsem.h>
- 互斥体
  - mutex_lock/mutex_unlock
  - <linux/mutex.h>
- 完成变量
  - wait_for_completion/complete
  - <linux/completion.h>
- 大内核锁
  - 不再使用
- 顺序锁
  - 适用于：读者很多，写者很少，且写优于读的场景
  - kernel/timer.c
- 禁止抢占
  - preempt_disable/preempt_enable
  - <linux/preempt.h>
- 顺序和屏障
  - rmb

http://www.cnblogs.com/wang_yb/archive/2013/05/01/3052865.html
