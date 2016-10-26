

1. 对象锁

方法内的synchronized(this)   等价于  public synchronized void test2()   

2. 类锁

方法内的synchronized(TestSynchronized.class)     等价于 public static synchronized void test2()   

3. 
类锁和对象锁是两个不一样的锁，控制着不同的区域，它们是互不干扰的
