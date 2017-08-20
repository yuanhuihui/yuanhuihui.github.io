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
15. BnServiceManager，BpServiceManager有一个是多余的？


问一问 其他人还有什么问题？

Binder系统比较复杂，带着个人理解尝试去领悟作者的设计思想。

我也只是略懂Binder的十之一二，还有很多不太懂的地方，讲得过程，大家有什么不同的看法，还请多多指教。

”易掌握，难精通“

Binder内功


历史：

1. 回溯到1991年，乔治 霍夫曼（George Hoffman），时任Be公司的工程师，启动了一个名叫”OpenBinder”的项目，
旨在研究高效的信息传输方式。
2. 后来，Be公司被Parm Source收购，OpenBinder交由Dinnie Hackborn（哈克伯恩）负责继续开发。成为ParmOS的进程通信基础
3. 2003年10月，安迪鲁宾（Andy Rubin）等人创建Android公司，并组建Android团队。Andy从ParmOS公司带着一批人，其中包括Hackborn
4. 2005年8月17日，Google低调收购了成立仅22个月的高科技企业Android及其团队。安迪鲁宾成为Google公司工程部副总裁，继续负责Android项目。
5. 2008年9月，谷歌正式发布了Android 1.0系统。
6. 2017年，十年的迭代，已发布Android 8.0系统。


PPT: 图片，进程用户与内核空间共享问题，举例：

进程间通信--> 人与人的通信
传递的数据 --> 钱

我们把钱交给银行，银行再把钱贷款给别人。效果就是完成了我们-->别人的这样一个过程。陌生人。 大家都可以访问的平台--> 银行。
我们直接把钱给别人。熟人
我们约定好，钱存在家里某某抽屉里，你去取就好了。亲人






知乎的binder文章，需要修改
1. binder的主要使用除了system_server跟app,当然app之间也可以使用
2. 采用binder并非googla决定，而是android团队决定
3. 说一说binder的缺陷，以及新的改进：数据量的限制以及binder大锁的效率问题。新的binder已有大幅度的性能优化。
