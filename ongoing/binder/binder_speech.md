

1. Binder是什么？
2. Binder采用怎样的架构设计？
3. 为什么Android要采用Binder作为进程间通信方式？
4. Binder是如何实现的一次通信只拷贝一次内存？
5. binder有这么多优势，native daemon为何采用socket？zygote为何采用socket? installerd
6. Binder线程池是如何管理与运作的？什么情况下会binder线程池占满？
7. Binder服务是如何注册到系统的？又是如何查看某个服务的？
8. native层与java层binder有什么关系？如果Java层和Native层分别注册同名的binder，查询服务该显示哪一个？
9. Binder调用是否为阻塞操作？oneway是否会阻塞？同步与异步Binder是如何实现的？
10. linkToDeath的原理是什么？BBinder能做这个操作吗(不可以)？一个BpBinder可以注册多个死亡回调（可以）？   native多个，但kernel只会有一个
11. linkToDeath/ unlinkToDeath的原理是什么，这个过程是否涉及进程间通信？ 不涉及
12. binderDied是如何触发的？有没有可能进程被杀而不会触发呢？
13. 代理端发起binder请求，并交由服务端正在处理，如果此时代理端进程死亡，服务端的活是否会停止？
14. binder通信过程，transaction too large，该如何破？采用 ParceledListSlice
15. binder的使用场景有哪些？
16. 调用同一个进程的binder接口，是否需要走一遍完整的binder driver流程？
17. 使用binder过程有哪些需要注意的地方？ 内存，频繁，oneway, 异步
18. 很多情况下，为什么ANR触发时，app主线程都卡在binder调用，这是系统的锅，还是app的锅？
19. Binder有没有什么缺点？lock, 内存大小限制
20. 最新Binder机制有哪些改进与优化？


binder属于上乘内功心法，几乎做app开发和framework开发的人只需要一两行代码就可以完成一次binder通信，
强大的binder机制已经完美做好了一切事宜。

所以几乎大家都感觉不到binder的真实存在，以至于有人看到我写binder，起初以为是错写了bundle对象，。


为了适合对binder比较陌生的，有些基础知识；
同时为了兼顾对binder本身比较熟悉的人，有所收获，所以难易皆有。


泛泛而谈，只讲入门，可能有人会觉得深度不够；深入原理，可能会听得云里雾里。全面展开讲，并非两三个小时能说清楚。

问一问 其他人还有什么问题？

Binder系统比较复杂，带着个人理解尝试去领悟作者的设计思想。

博大精深，我也只是略知一二，今天跟大家一起交流与学习，讲得过程，大家有什么不同见解，欢迎提出来讨论，
在场也有很多专家和大牛。

Binder内功 ”易掌握，难精通“




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


### 主线
binder路由
binder数据传输过程
binder高效性
binder传输大数据而导致的问题，
思考题：binder死亡回调后pid复用问题。



知乎的binder文章，需要修改
1. binder的主要使用除了system_server跟app,当然app之间也可以使用
2. 采用binder并非googla决定，而是android团队决定
3. 说一说binder的缺陷，以及新的改进：数据量的限制以及binder大锁的效率问题。新的binder已有大幅度的性能优化。
