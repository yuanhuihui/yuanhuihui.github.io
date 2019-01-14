---
layout: post
title:  "如何自学Android"
date:   2016-04-24 22:10:22
catalog:    true
tags:
    - android
    - 自学编程

---

> 引言：知乎上我曾回答了 [自学编程一年，压力过大，该怎么办？ - Gityuan 的回答](https://www.zhihu.com/question/41198536/answer/90560766?from=profile_answer_card)，之后有不少知乎朋友私信或Email给我，希望能讲讲学习Android的心得。业内有不少同仁写过关于如何自学的文章，本文则是从自身的学习经历和经验，可能并不是适合每一个人，写出来仅供大家参考。

  看到很多人提问`非科班该如何学习编程`，其实科班也基本靠自学。有句话叫“师傅领进门修行靠个人”，再厉害的老师能教你的东西都是很有限的，真正的修行还是要靠自己。博主本科是数学专业，虽研究生是计算机专业，但研究生往往是做研究工作(偏学术型研究)，编程只是工具，可能很多时候Matlab就搞定了基本需求，再或许用一些科研型仿真软件就可完成课题研究中涉及的编程模块，学业上不太需要很多编程。
  
  关于编程(比如Java)完全是靠挤时间自学的，而Android则更是参加工作后才开始自己倒腾。不少人认为我学习能力强、博客产出高，是如何做到的？ `一份兴趣 + 一份坚持`，很简单，只是把大家用来娱乐、游戏等闲散时间，挤出来用于学习技术、写博客而已。

  关于如何学习Android系统, 这就好比读书, 是经由一个由薄读厚,再由厚读薄的过程. 前者是指刚接触一个新领域, 知之甚少,开始不断努力专研探索, 慢慢地随着时间地积累, 当你会发现自己专研得越来越多, 自己掌握得知识体系非常庞大, 
但当遇到一个新问题需要从大脑检索很久,甚至需要重新review一下曾经看过的已知东西, 那么说明自己以完成了"由薄读厚";接下来, 需要进行一个"由厚读薄"的过程, 用程序员都能理解的一个词就是知识归纳与建立索引的过程,通过思考将所有相关联的知识
整理到一起, 形成自己大脑体系的完整知识目录.进而你会发现自己大脑里面留下得便是整个知识架构, 架构里面的每一层只要拉开抽屉就能取出所有完整的知识点. 到此,我觉得才是完成一个知识的学习的过程.
  
接下来从基础篇和高级篇两个层次来说说如何学习Android, 本文涉及的所有书籍都是[Gityuan](http://weibo.com/gityuan) 在学习过程中所读过的部分较经典的一些书籍才推荐给大家。

## 一. Java篇

Java是Android的语言基础，建议初学者一定要先学习Java基本知识，进而再学习Android，循序渐进，只有扎实的基础才能建造牢固的上层建筑。

当然，这里说的要有一定Java基础，而并非让大家上来先精通Java。作为Android开发者来说，完全没有必要一开始都对Java理解得那么深，只有要看过一两本Java基本书，掌握Java面向对象的思想的核心要义`即万物皆为对象`，掌握`Java基本语法`，基本就可以开启Android的学习之路。在后续对Android也有一定理解后，如遇不懂可再回过头看看Java高级知识点，慢慢地同步提升Java和Android水平。

**Java书籍**

- **Thinking in Java**： 中文版《Java编程思想 》，这是一本非常经典的Java书籍，很多人都说这个书不适合初学者，我记得自己当初看的第一本Java书便是这本书。看完第一遍对Java有了整体的理解，但很多细节没有完全理解，查了资源又看了第二遍，对Java有了更深地理解。再后来一段时间后，能力也有所提升，再拿起这本书又看了第三遍，发现对面向对象有了更深一步的理解，这本书就是适合反复的阅读。
- **Effective Java**：Java进阶书，这本书采用“条目”的方式来展开的，总提出了78条Java具体的建议，对Java平台精妙之处的独到见解，还提供优秀的代码范例。作为Java进阶之书，对Java水平的提升大有裨益。
- **Java concurrency in Practice**：中文版《Java并发编程实战》，本书采用循序渐进的讲解方式，从并发编程的基本理论讲起，再讲述了结构化并发应用，性能与测试，最后将显式锁、原子变量、非阻塞算法这些高级主题。对于Java并发这一块算得上是一本很棒的书。
- **Java Performance**：中文版《Java性能优化权威指南》，Java之父James Gosling推荐的一本Java应用性能优化的经典之作，包含算法结构、内存、I/O、磁盘使用方式，内容通俗易懂，还介绍了大量的监控和测量工具。关于优化都是属于较深的领域，对Java有一定基础后，很有必要了解看看。


**Java虚拟机**，这是作为进阶Java高手必需有所了解：

- [The Java Language Specification](https://docs.oracle.com/javase/specs/jls/se7/html/index.html)，官方Java文档（英文版）
- [The Java® Virtual Machine Specification](https://docs.oracle.com/javase/specs/jvms/se7/html/)，官方Jvm文档（英文版）
- 深入理解java虚拟机：这是国内关于Java虚拟机讲得非常全面的一本书，从Java GC到Java虚拟机内部实现以及优化策略，作为Java高手非常值得一看的书籍。

有朋友私信我觉着这个java书难度有点高，可能是本人在看Java书籍之前，还看过些许C和C++的入门书的缘故，所以看的第一本书《Java编程思想》。如果你真的是零基础，第一次接触编程，想以Java作为自己的入门语言，那么你可以先看看《Java语言程序设计》(基础篇) 或者《Java从入门到精通》，作为初学者要先掌握Java基本语法，平时遇到不熟悉的方法，多查看API文档即可，慢慢地就熟悉了。

## 二、Android基础篇

**高效看书的姿态：**学习过程会需要看书，网上一搜，往往会有一大推的书推荐给大家去阅读，面对这么多书，该如何选择，如何阅读的呢，对于同一个层级的书籍选择一本精读，其余的粗读、略读即可，大同小异，对于精读书籍需要反复的阅读。

### 2.1 入门级别

有了一定的Java基础（不需要精通Java），就可以开始入门Android。建议初学Android者，一定要先搭建自己的开发环境，先准备jdk和Android Studio环境，现在就不要再用Eclipse了，对于Android开发者来说过时。在看书的过程一边看知识点一边写着示例程序，一来加深印象，二来提高动手能力。

- 《疯狂Android讲义》：作者李刚，这是我看过的第一个Android书籍，目前有第三版了，我当时看的是第二版基于Android 4.2，书中有大量的实例，记得当时每看完一个实例就跟着敲了一遍，大概花了一周时间把这本书看完并把大部分的实例代码都亲手敲了一遍。
- 《第一行代码》：作者郭霖，网上有不少人都推荐这本书作为Android入门书，但我当时没有看过。这是图灵系列图书，前段时间图灵的编辑看到我的博客gityuan.com，联系到我问是否有兴趣出书，便提到郭霖的《第一行代码》是他们出版社推出的，然后就给我免费邮寄了一本(多谢赠书之谊)。我大概扫了一扫这本书，内容的确比较基础，作者文笔不错，书中还穿插了不少打怪涨经验升级的片段，比较风趣，初学者可以看看。

Android基本书籍，只需一两本即可，没有必要看太多基础书籍，不同能力就该有不同层级的追求，这里就不再介绍其他基础书籍。 另外，Android开发过程中总是需要各种开发环境、工具的下载，再这里推荐一个不错的网站 [AndroidDevTools.cn](http://www.androiddevtools.cn/)，收集整理了 Android开发、设计等相关的各种工具大集合，非常全面，而且速度也不错哦，最重要的不用翻墙就可下载到最新的工具。

有朋友好奇私信我是否即将要出书了，目前没有相关计划，自觉能力尚不及很多前辈，还需加深内功修为，将更多的知识写成文章来分享大家。

### 2.2 一手资料

何为Android一手资料？那就是**Google官方给出的资料**，这里往往是英文版的，营养价值极高。其实只要英文还可以(不行就是在线翻译工具)+翻墙工具，强烈建议你直接看Android官网的资料，千万别被英语所吓倒，因为很多专业名称，大家一看就明白比如Activity/Service/Thread等这些代码名称本身就是英语，剩下的都是较基础语法，不懂可以随时翻译，我一般都是**用Chrome浏览器+Google翻译插件**，哪里不会点哪里，妈妈再也不用担心我的英语了。

言归正传，如果你能看完并理解以下内容，那么你完全可以没有必要再看前面介绍的书籍，并且对于Android已有相当熟悉。

- [developer.android.com](http://developer.android.com/intl/zh-cn/index.html)：Android开发官网，下面列举常用的资料：
    - [Android training](http://developer.android.com/training/index.html)：Android培训文档；相应地，国内有一个中文翻译文档[Android培训课程中文版](http://hukai.me/android-training-course-in-chinese/index.html)；
    - [Android API指南](http://developer.android.com/guide/index.html)：Android组件、Manifest配置文件，动画/图像等相关介绍；
    - [Android Tools](http://developer.android.com/tools/performance/index.html)：性能、测试、Android Studio等各种工具说明文档；
    - [source.android.com](https://source.android.com/)：介绍Android开源码相关的内容；
- [Android Performance Patterns](https://www.youtube.com/playlist?list=PLOU2XLYxmsIKEOXh5TwZEv89aofHzNCiu)：2015年Google陆续在Youtube上发布的Android性能优化的视频，目前已更新第4季。
    - 国内Google组织在优酷上发布了相应的中文视频 [(中文)Android 性能模式 第四季](http://v.youku.com/v_show/id_XMTUyMTM0MzgyNA==.html?f=26946827)；
    - 对官方视频进行翻译并整理：[Android性能优化典范中文版文档](http://hukai.me)；
- [android-developers.blogspot.com](http://android-developers.blogspot.com/)：Android官方博客，有一些比较不错的feature，博客会第一时间呈现。

### 2.3 开源资源

到这里，那么你已经具备开发App的本领。平时需要自己动手多写写App，另外就是看看别人优秀的App是如何写的，下面列举一些开源库、工具以及App：

- [android-arsenal.com](http://android-arsenal.com/)：作者[vbauer](https://github.com/vbauer)整理收集Github中各种开源库与工具，并提供搜索功能，是国外整理得最全面的库；
- [Android 开源项目汇总](https://github.com/Trinea/android-open-project)：作者[Trinea](https://github.com/Trinea)整理的各种开源库，是国内整理得最全面的库；
- [codeKK 开源项目源码分析](http://a.codekk.com/)：从源码的角度，分析Android较流行的优秀开源框架；
- [codota.com](http://www.codota.com/)：这是一个代码搜索引擎，收集的是各种API的优秀示例Java代码。

当然还有很多优秀的博客和网站值得推荐，这里就不一一介绍。

## 三、Android高级篇

作为程序员，不去阅读源码，仅仅看API文档，只是浮于表象，这是远远不够的。真正最能锻炼能力的便是直接去阅读源码，不仅限于阅读Andoid系统源码，也包括阅读各种优秀的开源库。 

**如果想成为Android系统工程师**，那么阅读Android系统源码便是必修课。

**如果想成为高级App开发工程师**，那么阅读Android系统源码算是选修课，阅读一些优秀的开源框架库算是必修课。

**如果你是刚刚入门**，建议先打好基础，千万不要一上看源码，一来看得费劲，二来你可能在代码间来回跳转，可能会迷失在某一个环节，更甚是理解错误，记住一定要循序渐进。

### 3.1 阅读源码的重要性

借用Linux之父Linus Torvalds的一句名言：**Read the fucking source code**。不管是阅读Andoid系统源码还是优秀的开源框架，对能力那都会有一个很大提升；首先，能学习到优秀的代码风格和设计思想；其次，能真正做到“知其然，还知其所以然”；最后，能指导自己更加灵活的使用API，能更加快速地找到系统bug的根源。

### 3.2 阅读源码的准备


1. Java基础：上层framework以及App层都是采用Java语法；
2. C/C++基础：Android的jni/native层代码采用C++，Linux 采用C；
3. Linux内核：Android内核基于Linux的，了解Linux相关知识对深入掌握Android还是很有必要。
4. Git工具：Android源码采用git和repo进行管理；
5. Make：Android源码采用Make系统编译，源码系统中会看到很多Android.mk之类的文件；
6. Source Insight：这绝对是看源码的神器；可以在Java、C++、C代码之间无缝衔接；
7. Android Studio：这是Google官方支持的App开发环境，另外，能方便地阅读framework Java层面的系统源码。
8. Atom: 是Github推出的开源文本编辑器，支持linux、window等多平台，可能不是最好用的，但我已习惯[Atom](http://gityuan.com/2016/06/09/atom/).
9. Google Drawings：这是画图工具，Gityuan博客中的文章都是采用Google Drawing完成，比如[Binder开篇](http://gityuan.com/2015/10/31/binder-prepare/#binder-1)文中的图。
10. StarUML：这是类图，Gityuan博客文章的类图和流程图都是采用StarUML完成，比如[理解Android进程创建流程](http://gityuan.com/2016/03/26/app-process-create/#forkandspecialize-1)文中时序图。

### 3.3 阅读源码的姿态

阅读源码绝不是从源码工程按顺序一个个的文件，从首行看到尾行。正确而高效地阅读源码的姿态应该是以某一个主线为起点，从上层往底层，不断地追溯，在各个模块、文件、方法之间来回跳转，反复地阅读，理清整个流程的逻辑。同时带着思考去看源码，尝试去揣测作者的用意，去理解代码的精妙之处，去思考代码可能存在的缺陷，去总结优秀的代码设计思想。下面说说我在阅读Android源码过程常涉及的库。

**阅读Android源码：**

如下以Android系统启动为主线，展开一系列的文章[Android开篇](http://gityuan.com/android/)中的流程图，在公司内部分享时我曾多次以下图为流程，来阐述Android架构，如下图：

点击查看[大图](http://gityuan.com/images/android-process/android-boot.jpg)

![process_status](/images/android-process/android-boot.jpg)

**Android系统源码**

[android.googlesource.com](https://android.googlesource.com/)：Google官方源码，国内无法直接访问，需要翻墙，对于一个程序员来说具备翻墙的能力是有必要的。Android源码中包含的库非常之多，下面列举我在看Android源码过程中涉及较多，也是比较常看的一些库：

- [android/platform/packages/apps](https://android.googlesource.com/platform/packages/apps/)：Android自带的app，比如Email,Camera, Music等，对于应用开发工程师主要关注的目录；
- [android/platform/frameworks/base](https://android.googlesource.com/platform/packages/apps/)： Java framework，这是framework工程师看得最多的目录；
- [android/platform/frameworks/native](https://android.googlesource.com/platform/frameworks/native/)：Native framework;
- [android/platform/art](https://android.googlesource.com/platform/art/)：Art虚拟机;
- [android/kernel/common](https://android.googlesource.com/kernel/common/)：Android内核，这是驱动工程师最关注的模块；
- [android/platform/system/core](https://android.googlesource.com/platform/system/core/) ：核心系统;
- [android/platform/libcore](https://android.googlesource.com/platform/libcore/)：平台的lib库;

另外，对于无法翻墙的朋友来说，还可以通过上Github通过 [Android主页](https://github.com/android) 下载Android源码，这些都是定时从Google官方源码的镜像同步而来的。还可以从[androidxref](http://androidxref.com)来直接查看Android系统源码。

### 3.4 优秀资源

牛顿曾说过：**“如果我看得更远一点的话，是因为我站在巨人的肩膀上”**，这句话很具有实用价值，看完前面的介绍，你千万不要一上来就一头扎进源码的世界，小心你会进入二次元世界，处于混沌状态，最后崩溃乃至放弃求知之路，一定要合理利用现有的优秀资源。

**Android 系统源码分析**：邓凡平和罗升阳都是我的好朋友，对于Android方面有着很多共通之处，下面推荐给大家。

- [Innost的专栏](http://blog.csdn.net/innost?viewmode=contents)
    - 邓凡平前辈所写博客，条例有序，覆盖了Android系统大部分内容；
    - 《深入理解Android》 （卷I，卷II，卷III）
- [老罗的Android之旅](http://blog.csdn.net/luoshengyang/article/details/8923485)
    - 罗升阳前辈所写博客，从各个层面介绍Android系统；
    - 《Android系统源代码情景分析 》
- [Gityuan源码分析](http://gityuan.com/android/)
    - 前面两位的博客基于Android 2.x或4.x，目前Android已发展到Android 6.0。不管Android如何变化，核心思维变化并不大，两位前辈的博客还是值得学习和参考的地方。但是Android经过几个大版本迭代，无论是从代码结构还是整体逻辑仍有很多变化。故博主(Gityuan)撰写了Android 6.0源码系列的博文。

### 3.5 进阶书籍

- Linux内核设计与实现
- 深入理解Linux内核
- 深入Linux内核架构
- Linux设备驱动程序
- 重构 改善既有代码的设计
- 编程珠玑 （卷1, 卷2）
- 设计模式
- 设计模式之禅
- 人月神话
- ...

前4本书都是关于Linux，如果你不是需要从事Linux相关开发，只想提升对Android整体的理解，那么只需看一到两本，对Linux的进程、内存、IO以及驱动有所了解，对CPU调度、进程间通信有所熟悉就基本可以。另外，优秀的书还有很多，这里只介绍/列举我看过的书，目前还在看一些优秀的书，后续再更新。

**需要再次强调一下，**此处高级篇更主要的是针对系统工程师，对于android开发高级工程师的修炼之路，只需要掌握其中一部分即可，更核心的重点还是在app层面的知识。

## 四、其他

### 4.1 开发书籍推荐

如果还想看更多关于开发书籍的推荐， 可以看看`diycode`发起的，由一群社区较活跃的Android人士(包括Gityuan在内)一起共同撰写的[Android开发书籍推荐](http://www.diycode.cc/wiki/androidbook)。

### 4.2 解决问题的方式
遇到问题，一定要先尝试自己解决，实在解决不了再请教他人。这是对自己的一个锻炼，也是对他人的一个尊重，可以有多种途径自行尝试解决：

- `百度`一下，很多时候还是能有所帮助的，不要过分强调google，完全抛弃百度，毕竟中文资料对大多数人来说理解起来更快；
- `Google`搜索，建议先用中文关键词`google`一下；再英文关键词google一下；
- [stackoverflow.com](http://stackoverflow.com/)、[知乎](http://zhihu.com)等技术问答网站内直接搜索；
- 查看官方文档；
- 如果有源码，尝试直接看源码，看能否解决；
    
另外，有空可以多逛逛`github`，多看看Google官方文档，多关注社区，定会收获不少；

### 4.3 番外篇
最后，再说说关于学习编程的番外篇：

- 好奇心比雄心走得更远：很多人对未来空有满腔的雄心壮志，往往不如对技术要有一份好奇心，一份探索欲，再加上一份执着的人。
- 要有open的心态：曾经的我也只是把自己的所思所得都放入自己的云笔记，很少整理，这其实不利于技术发展，有空应该多整理自己零散的知识点，觉得不错的点可以拿出来写成博客，那是对能力的又一层提升。另外，在低头做技术的同时，还应该有空抬头看世界，不能闭门造车。
- 天道酬勤：学历只能代表过去，能力代表现在，潜力代表未来！ 你不把自己逼一把，你压根不知道自己有多优秀，只要努力去学习，去挖掘潜力，进而提升自我技术修为，未来不再是梦！共勉之！
- 当然，最最重要的是能静得下心，持之以恒地专研技术。
