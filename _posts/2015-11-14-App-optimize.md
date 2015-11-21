---
layout: post
title:  "APP优化(一)"
date:   2015-11-14 21:21:50
categories: android performance
excerpt:  APP优化
---

* content
{:toc}


---

本文是针对Android的App开发优化(一)。



# 一、代码优化

## 1.  广播
 
应用程序内部广播通信，优先采用LocalBroadcastManager，安全性更好，运行效率更高。

**优势：**平时常说BroadcastReceiver，采用的是Binder通信方式，这是跨进程的通信方式，系统资源消耗固然更多。而广播LocalBroadcastManager，采用的是Handler通信机制，Handler的实现是应用内的通信方式，所以效率与安全性都更高。

**用法：**

**(1) 创建广播接收者**

	//广播类型
	public static final String ACTION_SEND = "1";

	//自定义广播接收者
	public class AppBroadcastReceiver extends BroadcastReceiver {	

	    @Override
	    public void onReceive(Context context, Intent intent) {
	        //TODO
	    }
	}

	//创建广播接收者
	AppBroadcastReceiver appReceiver = new AppBroadcastReceiver();

**(2) 注册/取消注册**

	//注册广播接收者，LocalBroadcastManager注册广播只能通过代码注册的方式
	LocalBroadcastManager.getInstance(context).registerReceiver(appReceiver, 
		new IntentFilter(ACTION_SEND));

	//取消注册广播接收者
	LocalBroadcastManager.getInstance(context).unregisterReceiver(appReceiver);

**(3) 发送广播**

	LocalBroadcastManager.getInstance(context).sendBroadcast(new Intent(ACTION_SEND));


## 2.  线程池

线程创建优先采用线程池`ThreadPoolExecutor`，而不是`new Thread()`；
另外设置线程优先级为后台运行优先级，能有效减少Runnable创建的线程和和UI线程之间的资源竞争。

**优势：** 通过`new Thread()`来创建线程是比较常用的方式，而使用线程池的方式有不少优势如下：  

- 线程可重复利用，节省线程的创建与销毁开销，性能有所提升；
- 方便控制并发线程数，提高资源的利用率，减少过多的资源竞争；


**用法：**  
	
	//创建Runable对象
	Runnable runnable = new Runnable() {
            @Override
            public void run() {
                android.os.Process.setThreadPriority(android.os.Process.THREAD_PRIORITY_BACKGROUND);
                //TODO
            }
        };
	//创建线程池
	ExecutorService threadPoolExecutor = new ThreadPoolExecutor(
		corePoolSize, maximumPoolSize, 
		keepAliveTime, unit, workQueue);

	//执行runnable
    threadPoolExecutor.execute(runnable);
  
对于corePoolSize，一般往往可以设置为`Runtime.getRuntime().availableProcessors()`，代表当前系统活跃的CPU个数。

另外系统采用工厂模式，通过设置ThreadPoolExecutor的不同参数，提供四种默认线程池：   
**(1) newCachedThreadPool**  
可缓存线程池，若线程空闲60s则回收，若无空闲线程可无限创建新线程，定义如下：
	`new ThreadPoolExecutor(0, Integer.MAX_VALUE,
                              60L, TimeUnit.SECONDS,
                              new SynchronousQueue<Runnable>());`

调用方法：  

	ExecutorService cachedThreadPool = Executors.newCachedThreadPool();
	cachedThreadPool.execute(runnable);

**(2) newFixedThreadPool**
定长线程，固定线程池大小，定义如下：
	`new ThreadPoolExecutor(nThreads, nThreads,
                                      0L, TimeUnit.MILLISECONDS,
                                      new LinkedBlockingQueue<Runnable>());`

调用方法：  

	ExecutorService fixedThreadPool = Executors.newFixedThreadPool(nThreads);
	fixedThreadPool.execute(runnable);

**(3) newSingleThreadExecutor**   
只有一个线程的线程池，定义如下：
	`new FinalizableDelegatedExecutorService
            (new ThreadPoolExecutor(1, 1,
                                    0L, TimeUnit.MILLISECONDS,
                                    new LinkedBlockingQueue<Runnable>()));`

调用方法：  

	ExecutorService singleThreadPool = Executors.newSingleThreadExecutor();
	newSingleThreadExecutor.execute(runnable);

**(4) newScheduledThreadPool**  
可定时周期执行的线程池，定义如下：
	`new ThreadPoolExecutor(corePoolSize, Integer.MAX_VALUE, 0, NANOSECONDS,
              new DelayedWorkQueue());`

调用方法：  

	ExecutorService scheduledThreadPool = Executors.newScheduledThreadPool(corePoolSize);
	scheduledThreadPool.schedule(runnable, delay, TimeUnit.SECONDS);

## 3.  ArrayList Vs LinkedList
ArrayList基于动态数组的数据结构， 对于随机访问(get/set)，ArrayList效率比LinkedList高；  
LinkedList基于链表的数据结构，对于新增和删除(add/remove)，LinedList效率比ArrayList高；

（1）对于list, 优先选择ArrayList，除非少数需要大量的插入/删除操作才使用LinkedList。因为当数据量非常大时get操作，LinkedList时间复杂度为o(n), 而ArrayList时间复杂度为o(1)。

（2）循环遍历

LinkedList采用foreach方式， 效率最高。for循环方式效率大幅度降低。

	List<Integer> list = new LinkedList<Integer>();
	for (Integer j : list) {
		... //TODO
	}

ArrayList采用for循环+临时变量保存size，效率最高。 foreach方式效率略微降低。

	List<Integer> list = new ArrayList<Integer>();
	int len = list.size();
	for (int j = 0; j < len; j++) {
		list.get(j);
	}
  
  
(3)采用new ArrayList()方式，初始大小为0，首次增加数组时，扩充大小到12，以后到数组需要增长时，会将大小增加50%，并将原来的成员全部复制到新的数组内。所以尽可能将ArrayList提前设置成目标大小，或者接近目标大小，以减少数组不断创建与复制的过程，提高效率。



## 4.  HashMap Vs SparseArray

(1)同时需要key和value，采用如下遍历方法：  

	Map<String, String> map = new HashMap<String, String>();
	for (Map.Entry<String, String> entry : map.entrySet()) {
            entry.getKey();
            entry.getValue();
    }
	
(2)只需要获取key，采用如下遍历方法：

	Map<String, String> map = new HashMap<String, String>();
	for (String key : map.keySet()) {
		// key process
	}

 (3) 当HashMap的key是整型时，采用SparseArray，效率更高。避免了对key与value的自动装箱与解箱操作。



## 5. Bitmap

- 使用BitmapFactory.Options对图片进行缩略读取；减小内存使用量；
	- inSampleSize：缩放比例，在把图片载入内存之前，先计算出一个合适的缩放比例，避免不必要的大图载入
	- decode format：解码格式，选择ARGB_8888/RBG_565/ARGB_4444/ALPHA_8，能减小内存空间
- 使用SoftReference:当内存不足时，虚拟机会自动回收它；
- 使用Bitmap.recycle()释放图片，虚拟机gc时回收Bitmap;
- 根据手机尺寸大小，配置不同大小的图片，保证使用尽可能小的图片资源。





## 6. Object Pool
内存对象，通过对象池技术来达到重复利用，减少对象重复创建。，从而减少内存分配和回收。

- 复用系统自带的资源，framework-res.apk中包含很多内置资源，比如字符串/颜色/图片/样式/布局等。可减少APK大小、内存开销。
-  缓存算法LRU

## 7. Job Scheduler
使用Job Scheduler，应用需要做的事情就是判断哪些任务是不紧急的，可以交给Job Scheduler来处理，Job Scheduler集中处理收到的任务，选择合适的时间，合适的网络，再一起进行执行。



## 8. Android避免使用Enum
Enum比静态常量，至少需要多过于2倍以上的内存空间，应该在Android中避免使用枚举。


## 9. onDraw()
由于onDraw方法调用比较频繁，需避免对象创建操作，因为迅速增加内存，同样引起频繁的gc，甚至内存抖动。

## 10. 

- 内部类引用导致Activity的泄漏，尤其是Handler
- 监听器即使注销
- 考虑使用Application Context而不是Activity Context
- onLowMemory()与onTrimMemory()
- 使用nano protobufs序列化数据
- IntentService



## 11

- Adapter 利用convertView.getTag()与 ViewHolder
- 窗口默认有一个不透明的背景，可以去掉的： getWindow().setBackground(null),或者修改xml
- UI局部刷新
- 在性能敏感的代码，避免创建Java对象。比如onMeasure(), onLayout(), onDraw()， getView()等
- 使用弱引用

## 参考

- <http://www.trinea.cn/android/hashmap-loop-performance/>
- <http://developer.android.com/training/displaying-bitmaps/index.html>
- <http://hukai.me/android-performance-oom/>