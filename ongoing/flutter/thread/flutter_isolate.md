

## Task Runner

- Platform Task Runner: Android或者iOS的主线程；


为什么多两个1.ui线程，而真正的ui线程名字却叫作Thread-xxx呢？？


## isolate

third_party/dart/runtime/vm/isolate.cc

isolate 是一种不共享状态的多线程技术，dart语言设计 isolate 这种体系能避免线程竞争等情况的出现。也是因为 isolate 之间是不能共享状态的，所以 isolate 中只能调用静态方法或者顶层方法。主 isolate 和其他 isolate 通过接口进行通信。这样，各个 isolate 中的状态就是独立的。


Flutter的代码都是默认跑在root isolate上

异步任务：MicroTask和Event


isolates之间通信方法有两种：

- 高级API：Compute函数 (用起来方便)
- 低级API：ReceivePort

isolate之间的通信
- 由于isolate之间没有共享内存，所以他们之间的通信唯一方式只能是通过Port进行，而且Dart中的消息传递总是异步的。

isolate与普通线程的区别
- 我们可以看到isolate神似Thread，但实际上两者有本质的区别。操作系统内的线程之间是可以有共享内存的而isolate没有，这是最为关键的区别。

Dart的Isolate是Dart虚拟机自己管理的，Flutter Engine无法直接访问。Root Isolate通过Dart的C++调用能力把UI渲染相关的任务提交到UI Runner执行这样就可以跟Flutter Engine相关模块进行交互，Flutter UI相关的任务也被提交到UI Runner也可以相应的给Isolate一些事件通知，UI Runner同时也处理来自App方面Native Plugin的任务。

https://zhuanlan.zhihu.com/p/40069285

### UI

 UI Task Runner功能（Root isolate就是运行在这个线程上，所以isolate就可以理解为单线程，有event loop的架构）

1）用于执行Dart root isolate代码
2）渲染逻辑，告诉Engine最终的渲染
3）处理来自Native Plugins的消息
4）timers
5）microtasks
6）异步 I/O 操作(sockets, file handles, 等)
