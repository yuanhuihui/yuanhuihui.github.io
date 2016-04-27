---
layout: post
title:  "如何自学Android"
date:   2016-04-24 22:10:22
categories: android
excerpt:  如何自学Android
---

* content
{:toc}

---

> 引言：在知乎上回答了 [自学编程一年，压力过大，该怎么办？ - Gityuan 的回答](https://www.zhihu.com/question/41198536/answer/90560766?from=profile_answer_card)，之后有不少知乎朋友私信或email给我，希望能讲讲学习Android的心得。

看到很多人提问**非科班该如何学习编程**，其实科班也基本靠自学。有句话叫“师傅领进门修行靠个人”，再厉害的老师能教你的东西都是很有限的，真正的修行还是要靠自己。我本科是学数学的，虽然研究生是计算机专业，但研究生往往是做研究工作，并不会接触编程这么基本的东西，关于编程相关我都是靠自学。对于Android这一块，是参加工作还开始接触，开始自己学习的。

学习级别，很多人都往往划分成入门、初级、中间..骨灰级等。这里就简单地划分为两级：基础篇和进阶篇。另外，本文涉及到的所有书籍都是[Gityuan](http://weibo.com/gityuan) 在学习过程中所读过的比较经典的一些书籍，才推荐给大家。


## 一、基础篇

**看书的姿态：**学习过程往往大家都需要看书，网上一搜，往往会有一大推的书推荐给大家去阅读，面对这么多书，该如何选择，如何阅读的呢，对于同一个层级的书籍选择一本精读，其余的粗读、略读即可，大同小异，对于精读的书籍需要反复的阅读。

### 1.1 Java篇

Java是Android的基础，建议初学者一定要先学习Java基本知识，进而再学习Android，循序渐进，切莫心急，只有扎实的基础才能建造牢固的上层建筑。

**Java书籍**

- **Thinking in Java**： 中文版《Java编程思想 》，这是一本非常经典的Java书籍，很多人都说这个书不适合初学者，我记得自己当初看的第一本Java书便是这本书。看完第一遍对Java有了整体的理解，但很多细节没有完全理解，查了资源又看了第二遍，对Java有了更深地理解。再后来一段时间后，能力也有所提升，再拿起这本书又看了第三遍，发现对面向对象有了更深一步的理解，这本书就是适合反复的阅读。
- **Effective Java**：Java进阶书，这本书采用“条目”的方式来展开的，总提出了78条Java具体的建议，对Java平台精妙之处的独到见解，还提供优秀的代码范例。作为Java进阶之书，对Java水平的提升大有裨益。
- **Java concurrency in Practice**：中文版《Java并发编程实战》，本书采用循序渐进的讲解方式，从并发编程的基本理论讲起，再讲述了结构化并发应用，性能与测试，最后将显式锁、原子变量、非阻塞算法这些高级主题。对于Java并发这一块算得上是一本很棒的书。
- **Java Performance**：中文版《Java性能优化权威指南》，Java之父James Gosling推荐的一本Java应用性能优化的经典之作，包含算法结构、内存、I/O、磁盘使用方式，内容通俗易懂，还介绍了大量的监控和测量工具。关于优化都是属于较深的领域，对Java有一定基础后，很有必要了解看看。


**Java虚拟机**，这是作为进阶Java高手必需有所了解：

- [The Java Language Specification](https://docs.oracle.com/javase/specs/jls/se7/html/index.html)，官方Java文档（英文版）
- [The Java® Virtual Machine Specification](https://docs.oracle.com/javase/specs/jvms/se7/html/)，官方Jvm文档（英文版）
- 深入理解java虚拟机：这是国内关于Java虚拟机讲得非常全面的一本书，从Java GC到Java虚拟机内部实现以及优化策略，作为Java高手非常值得一看的书籍。
	
本文的重点是讲如何学习Android，所以姑且把Java基础与进阶的书都放到Android学习的基础篇里。作为Android开发者来说，完全没有必要一开始都对Java理解得那么深，只有要看一两本Java基本书，掌握Java面向对象的思想的核心要义即万物皆为对象，掌握Java基本语法，基本就可以开启Android的学习之路。在后续对Android也有一定理解后，再慢慢不断提升Java和Android水平。

有朋友私信我觉着这个java书难度有点高，可能是本人在看Java书籍之前，还看过些许C和C++的入门书的缘故，所以看的第一本书《Java编程思想》。如果你真的是零基础，第一次接触编程，想以Java作为自己的入门语言，那么你可以先看看《Java语言程序设计》(基础篇) 或者《Java从入门到精通》，作为初学者险掌握Java基本语法，平时遇到不熟悉的方法，多查看API文档即可，慢慢地就熟悉了。

### 1.2 Android基础篇

有了一定的Java基础（不需要精通Java），就可以开始入门Android。建议初学Android者，一定要先搭建自己的开发环境，先准备jdk和Android Studio环境。再看书的过程，一边看知识点一边写示例程序，一来加深印象，二来提高动手能力。

- 《疯狂Android讲义》：作者李刚，这是我看过的第一个Android书籍，目前有第三版了，我当时看的是第二版基于Android 4.2，书中有大量的实例，记得当时每看完一个实例就跟着敲了一遍，大概花了一周时间把这本书看完并把大部分的实例代码都亲手敲了一遍。
- 《第一行代码》：作者郭霖，网上有不少人都推荐这本书作为Android入门书，但我当时没有看过。这是图灵系列图书，前段时间图灵的编辑看到我的博客gityuan.com，于是联系到我问是否有兴趣出书，便提到郭霖的《第一行代码》也是他们出版社推出的，然后就给我邮寄了一本。我大概扫了一扫这本书，内容的确比较基础，作者文笔不错，书中还穿插了不少打怪涨经验升级的片段，比较风趣，初学者可以看看。

Android的基本书籍，只需一两本即可，没有必要看太多基础书籍，不同能力就该有不同的追求，这里就不再介绍其他基础书籍。 另外，Android开发过程中总是需要各种开发环境、工具的下载，再这里推荐一个不错的网站 [AndroidDevTools.cn](http://www.androiddevtools.cn/)，收集整理了 Android开发、设计等相关的各种工具大集合，非常全面，而且速度也不错哦，最重要的不用翻墙就可下载到最新的工具。

### 1.3 Android一手资料

何为Android一手资料？那就是**Google官方给出的资料**，这里往往是英文版的，营养价值极高。其实你只要英文还凑合+翻墙工具，强烈建议你直接看Android官网的资料，千万别被英语所吓倒，因为很多专业名称，大家一看就明白比如Activity/Service等这些代码名称本身就是英语，剩下地都就非常基础语法，不懂可以随时翻译，我一般都是**用Chrome浏览器+Google翻译插件**，哪里不会点哪里，妈妈再也不用担心我的英语了。

言归正传，如果你能看完并理解下列的内容，那么你完全可以没有必要再看前面介绍的书籍，并且对于Android已有相当熟悉了。

- [developer.android.com](http://developer.android.com/intl/zh-cn/index.html)：Android开发官网，下面列举常用的资料：
	- [Android training](http://developer.android.com/training/index.html)：Android培训文档；
		- 另外由胡凯发起了[Android培训课程中文版](http://hukai.me/android-training-course-in-chinese/index.html)；对官方文档进行翻译；
	- [Android API指南](http://developer.android.com/guide/index.html)：Android组件、Manifest配置文件，动画/图像等相关介绍；
	- [Android Tools](http://developer.android.com/tools/performance/index.html)：性能、测试、Android Studio等各种工具说明文档；
	- [source.android.com](https://source.android.com/)：介绍Android开源码相关的内容；
- [Android Performance Patterns](https://www.youtube.com/playlist?list=PLOU2XLYxmsIKEOXh5TwZEv89aofHzNCiu)：2015年Google陆续在Youtube上发布的Android性能优化的视频，目前已更新第4季。
	- 国内Google组织，优酷上发布了相应的 [(中文)Android 性能模式 第四季](http://v.youku.com/v_show/id_XMTUyMTM0MzgyNA==.html?f=26946827)；
	- 另外由胡凯发起了[Android性能优化典范中文版文档](http://hukai.me)；对官方视频进行翻译并整理；
- [android-developers.blogspot.com](http://android-developers.blogspot.com/)：Android官方博客，有一些比较不错的feature，博客会第一时间呈现。

### 1.4 Android资源整理

到这里，那么你已经具备开发App的本领。平时需要自己动手多写写App，另外就是看看别人优秀的App是如何写的，下面列举一些开源库、工具以及App：

- [android-arsenal.com](http://android-arsenal.com/)：作者[vbauer](https://github.com/vbauer)整理收集Github中各种开源库与工具，并提供搜索功能，是国外整理得最全面的库；
- [Android 开源项目汇总](https://github.com/Trinea/android-open-project)：作者[Trinea](https://github.com/Trinea)整理的各种开源库，是国内整理得最全面的库；
- [codeKK 开源项目源码分析](http://a.codekk.com/)：从源码的角度，分析Android较流行的优秀开源框架；
- [codota.com](http://www.codota.com/)：这是一个代码搜索引擎，收集的是各种API的优秀示例Java代码。

当然还有很多优秀的博客和网站值得推荐... //TODO

## 二、进阶篇

作为程序员，不去阅读源码，仅仅看API文档，只是浮于表象，这是远远不够的。.真正最能锻炼能力的便是直接去阅读源码，不仅限于阅读Andoid系统源码，也包括阅读各种优秀的开源库。

### 2.1 阅读源码的重要性

借用Linux之父Linus Torvalds的一句名言：**Read the fucking source code**。不管是阅读Andoid系统源码还是优秀的开源框架，对能力那都会有一个巨大的提升；首先，能学习到优秀的代码风格和设计思想；能真正做到“知其然，还需知其所以然”；能指导自己更加灵活的使用API，能更加快速地找到系统bug的根源。

### 2.2 阅读源码的准备

1. Java基础：上层framework以及App层都是采用Java语法；
2. C/C++基础：Android的jni/native层代码采用C++，Linux 采用C；
3. Linux：Android内核基于Linux的，了解Linux相关知识对深入掌握Android还是很有必要。
4. Git：Android源码采用git和repo进行管理；
5. Make：Android源码采用Make系统编译，源码系统中会看到很多Android.mk之类的文件；
6. Source Insight：这绝对是看源码的神器；可以在Java、C++、C代码之间无缝衔接；
7. Eclipse：熟悉常用快捷键，工欲善其事必先利其器；虽然Source Insight很方便，但由于对Eclipse的熟悉感，对于framework Java层面的代码，我还是更习惯用Eclipse来看，对于Native代码以及linux代码则采用Source Insight来看；
8. Android Studio：这是Google官方支持的App开发环境，关于Android Studiod使用教程；
9. Google Drawings：这是画图工具，Gityuan博客中的文章都是采用Google Drawing完成，比如[Binder开篇](http://gityuan.com/2015/10/31/binder-prepare/#binder-1)文中的图。
10. StarUML：这是类图，Gityuan博客文章的类图和流程图都是采用StarUML完成，比如[理解Android进程创建流程](http://gityuan.com/2016/03/26/app-process-create/#forkandspecialize-1)文中时序图。

### 2.3 阅读源码的姿态

阅读源码绝不是从源码工程按顺序一个个的文件，从首行看到尾行。正确而高效地阅读源码的姿态应该是以某一个主线为起点，从上层往底层，不断地追溯，在各个模块、文件、方法之间来回跳转，反复地阅读，理清整个流程的逻辑。同时带着思考去看源码，尝试去揣测作者的用意，去理解代码的精妙之处，去思考代码可能存在的缺陷，去总结优秀的代码设计思想。下面说说我在阅读Android源码过程常涉及的库。

**阅读Android源码：**

下面是我以Android开机过程为主线，展开一系列的文章 [Android开篇](http://gityuan.com/android/)中的一副流程图，在公司内部分享时我曾多次以下图为流程整个Android架构，如下图：

点击查看[大图](http://gityuan.com/images/android-process/android-boot.jpg)

![process_status](/images/android-process/android-boot.jpg)

**Android系统源码**

[android.googlesource.com](https://android.googlesource.com/)：Google官方源码，国内无法直接访问，需要翻墙，对于一个程序员来说具备翻墙的能力是非常有必要的。Android源码中包含的库非常之多，下面列举我在看Android源码过程中涉及较多，也是比较常看的一些库：

- [android/platform/packages/apps](https://android.googlesource.com/platform/packages/apps/)：Android自带的app，比如Email,Camera, Music等，对于应用开发工程师主要关注的目录；
- [android/platform/frameworks/base](https://android.googlesource.com/platform/packages/apps/)： Java framework，这是framework工程师看得最多的目录；
- [android/platform/frameworks/native](https://android.googlesource.com/platform/frameworks/native/)：Native framework;
- [android/platform/art](https://android.googlesource.com/platform/art/)：Art虚拟机;
- [android/kernel/common](https://android.googlesource.com/kernel/common/)：Android内核，这是驱动工程师最关注的模块；
- [android/platform/system/core](https://android.googlesource.com/platform/system/core/) ：核心系统;
- [android/platform/libcore](https://android.googlesource.com/platform/libcore/)：平台的lib库;
另外，对于无法翻墙的朋友来说，还可以通过上Github通过 [Android主页](https://github.com/android) 下载Android源码，这些都是定时从Google官方源码的镜像同步而来的。

### 2.4 优秀资源

牛顿曾说过：**“如果我看得更远一点的话，是因为我站在巨人的肩膀上”**，这句话很具有实用价值，看完前面的介绍，你千万不要一上来就一头扎进源码的世界，小心你会进入二次元世界，处于混沌状态，最后崩溃乃至放弃求知之路，一定要合理利用现有的优秀资源。

**Android 系统源码分析**

- [Innost的专栏](http://blog.csdn.net/innost?viewmode=contents)
	- 邓凡平前辈所写博客，条例有序，覆盖了Android系统大部分内容；
	- 《深入理解Android》 （卷I，卷II，卷III）
- [老罗的Android之旅](http://blog.csdn.net/luoshengyang/article/details/8923485)
	- 罗升阳前辈所写博客，从各个层面介绍Android系统；
	- 《Android系统源代码情景分析 》
- [Gityuan源码分析](http://gityuan.com/android/)
	- 对于邓凡平和罗升阳两位前辈的博客基于Android 2.x或4.x，目前Android已发展到Android 6.0。不管Android如何变化，其核心思维变化并没有很大，所以两位前辈的博客还是很有值得学习和参考的地方。话又说回来，Android经过了几个大版本的迭代，无论是从代码结构还是整体逻辑仍有不少变化。故博主计划写一关于Android 6.0源码系列的博文。
	- Gityuan作为Android界新秀，能力尚不及很多前辈，但有一颗乐于分享的心，有一份痴于Android的品质，有一种坚持的态度，已经并一直还在努力奋斗的道路上...

### 2.5 进阶书籍

- 深入理解Linux内核
- 深入Linux内核架构
- Linux内核设计与实现
- Linux设备驱动程序
- 重构 改善既有代码的设计
- 编程珠玑 （卷1, 卷2）
- 设计模式
- 设计模式之禅
- 人月神话

前4本书都是关于Linux，如果你不是需要从事Linux相关开发，只想提升对Android整体的理解，那么只需看一到两本，对Linux的进程、内存、IO以及驱动有所了解，对CPU调度、进程间通信有所熟悉就基本可以。另外，优秀的书还有很多，这里只介绍/列举我看过的书，目前还在看一些优秀的书，后续再更新。

## 三、其他

最后，再说说关于学习编程的番外篇：

- 好奇心比雄心走得更远：很多人对未来空有满腔的雄心壮志，往往不如对技术要有一份好奇心，一份探索欲，再加上一份执着的人。
- 要有open的心态：曾经的我也只是把自己的所思所得都放入自己的云笔记，很少整理，这其实不利于技术发展，有空应该多整理自己零散的知识点，觉得不错的点可以拿出来写成博客，那是对能力的又一层提升。另外，在低头做技术的同时，还应该有空抬头看世界，不能闭门造车。
- 天道酬勤：学历只能代表过去，能力代表现在，潜力代表未来！ 你不把自己逼一把，你压根不知道自己有多优秀，只要努力去学习，去挖掘潜力，进而提升自我技术修为，未来不再是梦！共勉之！
- 解决问题的方式：遇到问题，一定要先尝试自己解决，解决不了再请教他人。这是对自己的一个锻炼，也是对他人的一个尊重，可以有多种途径自行搜索：
	- 百度一下，很多时候还是能有所帮助的，不要过分强调google，完全抛弃百度，毕竟中文看起来比较快；
	- 先中文关键词google一下；再英文关键词google一下；
	- [stackoverflow.com](http://stackoverflow.com/)、[知乎](http://zhihu.com)等技术问答网站内直接搜索；
	- 查看官方文档；
	- 如果有源码，尝试直接看源码，看能否解决；
- 有空可以多逛逛github，多看看Google官方文档，多关注社区，定会收获不少；
- 当然，最最重要的是能静得下心，持之以恒地专研技术。


----------

> 欢迎关注我的微博：[Gityuan](http://weibo.com/gityuan)
> 
> Android全栈工程师：上至能写App，中间能改framework和Native代码，下至能调驱动，整体上解决性能/稳定性/功耗问题。这是我对自己的追求，并一直在努力。

如果觉得不错，可以到我的知乎文章[如何自学Android](https://zhuanlan.zhihu.com/p/20708611)点个赞支持。