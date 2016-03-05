---
layout: post
title:  "数组遍历的性能分析"
date:   2015-8-30 0:52:30
categories: performance else 
excerpt:  详细分析为什么处理已排序的数组比未排序的数组要快的底层机理
---

* content
{:toc}


## 问题

> **完全遍历有序和无序的数组，时间复杂度都是O(n)，为什么遍历有序数组比无序数组速度更快？**


下面是一个C++代码，由于一些奇怪的原因，已排序的数据数组比未排序地数组运算差不多快6倍。

	#include <algorithm>
	#include <ctime>
	#include <iostream>
	
	int main()
	{
	    // 生成数据
	    const unsigned arraySize = 32768;
	    int data[arraySize];
	
	    for (unsigned c = 0; c < arraySize; ++c)
	        data[c] = std::rand() % 256;
	
	    // !!! 排过序，接下来的循环运行会更快
	    std::sort(data, data + arraySize);
	
	    // 开始计时
	    clock_t start = clock();
	    long long sum = 0;
	
	    for (unsigned i = 0; i < 100000; ++i)
	    {
	        //主循环
	        for (unsigned c = 0; c < arraySize; ++c)
	        {
	            if (data[c] >= 128)
	                sum += data[c];
	        }
	    }

	    //结束计时
	    double elapsedTime = static_cast<double>(clock() - start) / CLOCKS_PER_SEC;
		
	    std::cout << elapsedTime << std::endl;
	    std::cout << "sum = " << sum << std::endl;
	}

- 对于去掉`std::sort(data, data + arraySize)`，代码运行时间为11.54s.  
- 对于已排序的数据，代码运行时间为1.93s.  
  
  
起初，可能仅仅是语言或者编译器的反常的原因，因此尝试用JAVA实现。

	import java.util.Arrays;
	import java.util.Random;
	
	public class Main
	{
	    public static void main(String[] args)
	    {
	        // 生成数据
	        int arraySize = 32768;
	        int data[] = new int[arraySize];
	
	        Random rnd = new Random(0);
	        for (int c = 0; c < arraySize; ++c)
	            data[c] = rnd.nextInt() % 256;
	
	        // !!! 排过序，接下来的循环运行会更快
	        Arrays.sort(data);
	
	        // 开始计时
	        long start = System.nanoTime();
	        long sum = 0;
	
	        for (int i = 0; i < 100000; ++i)
	        {
	            //主循环
	            for (int c = 0; c < arraySize; ++c)
	            {
	                if (data[c] >= 128)
	                    sum += data[c];
	            }
	        }
	
	        //结束计时
	        System.out.println((System.nanoTime() - start) / 1000000000.0);
	        System.out.println("sum = " + sum);
	    }
	}

结果跟前面的C++的情况，基本一致，也是排序过的数组比未排序的快很多。


----------

## 解答
  
**根本原因是由于分支预测器引起的，下面详细展开解释**  

考虑一种铁路连接器的场景：

![railroad junction](/images/optimize/1.jpg)

为了解释这样现象，假设这是早在1800年，一个在长途或无线电通信出现之前的时代。

你是火车轨道连接器的操作员，你听到火车来了。你根本不知道火车应该往哪个方向走。这时你需要让火车停下车来，询问他火车要往哪个方向走。然后你设置适当的开关。  

列车是很重并且有很大的惯性，因此需要不停地启动和减速。

有更好的方法吗？假设提前猜测火车将要去往哪个方向！
  
- 如果猜测对了，火车不需要停下来，可以直接继续前行。  
- 如果猜测错了，火车需要停下来，回退，然后切换线路。火车再重新进入另一个线路。  

**如果你每一次都猜测对了**，火车每次都不需要停下来。  
**如果你猜测错的次数太频繁**，火车需要花很多时间停下来，回退，重新启动。

----------
考虑一个if语句，对于处理器的来说，它就是一个分支指令地址：  

![railroad junction](/images/optimize/2.png)

当处理器遇到分支，并不知道哪一条路该走，应该怎么办？
处理器中止执行，等待前一条判断语句执行完成。然后你继续正确的线路。

*现代的处理器是复杂的，有很长的管道。因此总是采取“预准备”和“减速”过程。*

是否有更好的方法呢？提取猜测进入哪一条分支 
- 如果猜测对了，继续执行
- 如果猜测错了，需要清空管道，分支回滚，然后重新进入另一个条分支。  

**如果每一次都猜测对了**，处理器每次都不需要停下来。  
**如果猜测错的次数太频繁**，处理器需要很多时间停止运转，回滚，重新运行。

----------
这就是分支预测。这可能不是最好的比喻，因为车可能在路上有信号和标志的方向。但在计算机中，处理器在最后一刻之前并不知道执行哪个分支。  

所以，你如何策略性地猜测，使火车回退再进入另一个轨道的发生次数尽可能少？你看看过去的历史！如果火车99％的时间往左走，那么你猜测往左。如果左右交替发现，那么你猜测火车也将交替选择轨道。如果每3次进入一次某条轨道，你按这个逻辑猜想...  

**换言之，你试着发现规律并以相同的规律预测分支的选择策略**。这就是分支预测器的主要工作。

大多数的引用程序都有一个较好的分支行为。因此现代的分支预测器基本都能实现大于90%的命中率。但是面对无规律的不可预测的分支是，分支预测器就束手无策了。

关于分支预测，进一步阅读["Branch predictor" article on Wikipedia.](http://en.wikipedia.org/wiki/Branch_predictor)。

----------

**前面说到的奇怪现象， 就出在这个if语句：**
  
	if (data[c] >= 128)  
	    sum += data[c];
  
数据随机分布在0~255区间，当数据被排序，数据的前半部分应该不会进入if语句。之后的讲都会进入if语句。  
同一个分支连续进入很多次，这对于分支预测器来说是一个非常友好的。即使是简单的计数器都能正确预测的这样的分支，除非几个迭代它切换方向之后。  
  
**快速可视化：**  

	T = branch taken
	N = branch not taken
	
	data[] = 0, 1, 2, 3, 4, ... 126, 127, 128, 129, 130, ... 250, 251, 252, ...
	branch = N  N  N  N  N  ...   N    N    T    T    T  ...   T    T    T  ...
	
	       = NNNNNNNNNNNN ... NNNNNNNTTTTTTTTT ... TTTTTTTTTT  (easy to predict)    
  
  
然后，当数据完全是随机生成的，分支预测器是无用的，因为它无法预测随机的数据。因此这可能会发生50%左右的错误预测。(无异于随时猜测)  

	data[] = 226, 185, 125, 158, 198, 144, 217, 79, 202, 118,  14, 150, 177, 182, 133, ...
	branch =   T,   T,   N,   T,   T,   T,   T,  N,   T,   N,   N,   T,   T,   T,   N  ...
	
	       = TTNTTTTNTNNTTTN ...   (completely random - hard to predict)

----------

**我们能做什么呢？**
  
如果编译器无法优化分支的进入，如果愿意牺牲一些可读性的话，那可以尝试一些改进。

将原始方案：  

	if (data[c] >= 128)
	    sum += data[c];  

替换优化方案为：
	
	int t = (data[c] - 128) >> 31;
	sum += ~t & data[c];


**等效替换分析：**


在分析之前，先将一下基本知识，

	<< :左移运算符，num << 1，等价于num*2; 
	>> :右移运算符，num >> 1，等价于num/2; 空位以符号位来补齐
	>>> :无符号右移，忽略符号位(最高位)，空位都以0补齐；
	~： 非运算符，当位为0，则结果为1；，但位为1，则结果为0；

正式分析：

- 当data[c]大于128时，`int t = (data[c] - 128) >> 31`，根据带符号的右移位运算法则，得到t=0，则~t=-1(即所有的位都为1); 从而`~t & data[c] = data[c]`，故等效sum += data[c]; 
- 当data[c]小于或者等于128时，`int t = (data[c] - 128) >> 31`，根据带符号的右移位运算法则，得到t=-1，则~t=0; 从而~t & data[c] = 0，故等效此未进入分支;   
  

这消除了分支预测，并与一些位运算来替换它的操作。
（这种方案并不能等价于原始的if语句。但是在当前的if语句情况下，对所有的data[]数值是有效的）  
  
  
Benchmarks: Core i7 920 @ 3.5 GHz  
  
C++ - Visual Studio 2010 - x64 Release  

	//  原始-随机的
	seconds = 11.777
	
	//  原始-已排序的
	seconds = 2.352
	
	//  改进后-随机的
	seconds = 2.564
	
	//  改进后-排序的
	seconds = 2.587

Java - Netbeans 7.1.1 JDK 7 - x64
	
	//  原始-随机的
	seconds = 10.93293813
	
	//  原始-已排序的
	seconds = 5.643797077
	
	//  改进后-随机的
	seconds = 3.113581453
	
	//  改进后-排序的
	seconds = 3.186068823
  

**观察可知：**

- 原始方法: 有非常大的差异在排序与未排序的数据之间
- 改进后方法： 排序与未排序的数据基本无差异
- C++语言下，改进后的方法，对于排序过的数据计算稍微比原始的方法慢一些。
  
一般的经验法则是避免在临界循环数据依赖分支。(比如在这个示例中)

----------


**另外：**

- 在x64上 GCC 4.6.1（-O3 或者 -ftree-vectorize）的环境下，是可以生成条件移动(conditional move，没有想到合适的译文，暂时称为条件移动)，因为在排序与未排序的数据没有区别，一样快。
- VC++ 2010是无法为分支生成条件移动。
- Intel Compiler 11做了一些特殊处理。它交换了两个循环，从而把不可预测的分支提到外循环。因此，它不仅是避免了预测失误，也是快两倍于VC++和GCC。换句话说，ICC通过测试循环来获取更好的性能...
- 如果你给Intel编译器的改进代码，它只是向右向量化...跟含有循环交换的分支一样快。

这一切都表明现代成熟的编译器变在优化代码上有能力做很多变化。


*本文翻译来源于[stackoverflow](http://stackoverflow.com/questions/11227809/why-is-processing-a-sorted-array-faster-than-an-unsorted-array)英文版。*


----------

如果觉得本文对您有所帮助，请关注我的**微信公众号：gityuan**， **[微博：Gityuan](http://weibo.com/gityuan)**。 或者[点击这里查看更多关于我的信息](http://www.yuanhh.com/about/)