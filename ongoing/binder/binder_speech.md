1. Binder IPC，到底是如何通信的？
2. Binder采用怎样的架构设计？系统到底哪些地方会使用binder?
2. Binder线程池是如何运作？什么情况下会binder线程池占满？
3. Binder的高效体现在哪？ 一次内存拷贝，到底是怎么一回事？
4. native层与java层 binder通信之间是什么关系？
5. Binder是阻塞还是非阻塞？oneway是否可能阻塞？
6. 同步与异步Binder是如何实现的？
7. 代理端发起binder请求，并交由服务端正在处理，如果此时代理端进程死亡，服务端的活是否会停止？
7. linkToDeath的原理是什么？ 一个BpBinder可以link多个DeathRecipient？  native可以，但kernel只会有一个
8. binderDied是如何触发的？有没有可能进程被杀而不会触发呢？
9. 什么场景使用binder来通信，为何native daemon进程基本采用socket，而不直接改用binder?
10. 使用binder过程有哪些需要注意的地方？ 内存，频繁，oneway, 异步
11. 很多情况下，为什么ANR触发时，app主线程都卡在binder调用，这是系统的锅，还是app的锅？
12. binder通信过程，transaction too large，该如何破？
13. Binder有没有什么不足？
14. binder最新有什么进展？


问一问 其他人还有什么问题？

Binder系统比较复杂，带着个人理解尝试去领悟作者的设计思想。

我也只是略懂Binder的十之一二，还有很多不太懂的地方，讲得过程，大家有什么不同的看法，还请多多指教。
