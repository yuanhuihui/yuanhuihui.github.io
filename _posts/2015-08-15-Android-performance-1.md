---
layout: post
title:  "Android 性能优化(一)"
date:   2015-08-15 22:10:10
categories: Android performance
excerpt:  android渲染原理的详细讲解
---

* content
{:toc}


![android developer](/images/android-studio-performance-1/instruction.jpg)

>2015年，Google陆续发布了关于[Android Performance Patterns](https://www.youtube.com/playlist?list=PLOU2XLYxmsIKEOXh5TwZEv89aofHzNCiu)的专题小视频，发布在Youtube上，目前已有49个短视频，，帮助开发者创造更加完美的App。本文主要讲解Android的渲染机制，内容源于google developer视频[34-41]。

---

## 一. Render Performance
渲染问题是开发App遇到的最常见的问题，设计师总是希望界面能有更多的动画，特效，图片等时尚的素材能融入到APP中，但另一方面这些复杂的图形和动画却不一定能流畅地运行在所有设备上。那么我们需要了解渲染是怎么样的过程，从而在尽最大可能来兼容两者。

* Android系统每隔16ms发出VSYNC信号，触发UI进行渲染，达到我们常说的60fps。 为了能实现流畅的画面，程序必须在16ms内完成渲染操作。

	![render 1](/images/android-studio-performance-1/1_1.jpg)

* 如果某一次渲染操作花费的时间是24ms，那么此次的渲染在完成16/24=67%的时候，会收到系统的VSYNC信号，但是渲染操作尚未完成，就会发生dropped frame(丢帧)，用户看到的界面还是停留在上一次的画面。在等到下次渲染成功时，由画面1 直接跳到画面3，用户会有卡顿的感觉。
![render 2](/images/android-studio-performance-1/1_2.jpg)

* CPU或者GPU的负载过重，从而无法在16ms内完成渲染操作的可能情况：

		- 过于复杂的layout；
		- 过多的层叠绘制的布局（Overdraw）；
		- 过多的动画执行的次数；
		- 过多的复杂计算；

* 性能分析工具：

		- HierarchyViewer，查看布局是否过于复杂；
		- Show GPU Overdraw，查看布局Overdraw情况；
		- TraceView，查看CPU使用情况；


---

## 二. Overdraw

*  Overdraw(过度绘制)描述的是屏幕上的某个像素在同一帧的时间内被绘制了多次。在多层次的UI结构里面，如果不可见的UI也在做绘制的操作，这就会导致某些像素区域被绘制了多次。这就浪费大量的CPU以及GPU资源。

	![overdraw](/images/android-studio-performance-1/overdraw.jpg)

* 当设计上追求更华丽的视觉效果的时候，容易陷入采用越来越多的层叠组件来实现这种视觉效果的怪圈。这很容易导致大量的性能问题，为了获得最佳的性能，必须尽量减少Overdraw的情况发生。可以通过手机设置里面的开发者选项，打开Show GPU Overdraw的选项，可以观察UI上的Overdraw情况。
		![overdraw2](/images/android-studio-performance-1/overdraw2.jpg)

* 蓝色，淡绿，淡红，深红代表了4种不同程度的Overdraw情况，我们的目标就是尽量减少红色Overdraw，看到更多的蓝色区域。
	
	- UI布局存在大量重叠的部分
	- 非必须的重叠背景。例如某个Activity有一个背景，然后里面的Layout又有自己的背景，同时子View又分别有自己的背景。
	- 仅仅是通过移除非必须的背景图片，就能够减少大量的红色Overdraw区域，增加蓝色区域的占比。

---

## 三. VSYNC

 >刷新频率：屏幕在一秒内刷新频幕的次数，由硬件的固定参数决定，比如60HZ。
 帧率：GPU在一秒内绘制的帧数，比如60fps，30fps。
 Jank：用来衡量界面滑动时的流畅度指标

* GPU负责获取图像数据进行渲染，渲染频率由帧率决定；然后硬件负责把渲染后的内容展现给用户，频率由刷新频率决定；两者不停地交互协作进行。

![vsync1](/images/android-studio-performance-1/vsync1.jpg)

* 帧率与刷新频率不一致时，就会容易出现断裂的画面，往往是上下两部分内容，一部分来自上一帧，另一个部分来自新的一帧，不同帧的数据发生重叠。VSYNC告诉GPU装载新帧之前，必须等到屏幕完成前一帧的显示操作，从而可以避免画面断裂。

![vsync2](/images/android-studio-performance-1/vsync2.jpg)

* 帧率超过刷新频率只是一种理想的状况，在超过60fps的情况下，GPU所产生的帧数据会因为等待VSYNC的刷新信息而被Hold住，这样能够保持每次刷新都有实际的新的数据可以显示。

![vsync3](/images/android-studio-performance-1/vsync3.jpg)

* 遇到更多的情况是帧率小于刷新频率，某些帧显示的画面内容就会与上一帧的画面相同。糟糕的事情是，帧率从超过60fps突然掉到60fps以下，这样就会发生LAG，JANK，HITCHING等卡顿掉帧的不顺滑的情况

![vsync4](/images/android-studio-performance-1/vsync4.jpg)



* 所有的处理都在16ms内完成，所有的帧都在收到VSync信号前按时交付，那么用户就获得流畅、平滑的体验

![这里写图片描述](http://img.blog.csdn.net/20150710103030493)

* 如果A帧显示过程中在构建的B帧，未能在一个VSync信号到达前按时交付，那么用户显示的还是A帧，那么就发现了一次Jank, Jank所在的比重越大，用户体验也糟糕。

![这里写图片描述](http://img.blog.csdn.net/20150710103044763)

---

## 四. Profile GPU Rendering
> 打开方式：设置-->开发者模式-->GPU呈现模式分析(Profile GPU Rendering) -->
>在屏幕上显示为条形图

* 在手机画面上看到丰富的GPU绘制图形信息，屏幕上方的图像反应的是通知栏的使用时间，屏幕下方的图像反应的是当前活动Activity的渲染情况。
	
	![gpu_render_1](/images/android-studio-performance-1/gpu_render_1.jpg)

* 当我们与应用程序互动时，会看到一条垂直的柱状图在屏幕上，按照从左到右的顺序显示的；每一个垂直的柱状图代表一帧的渲染时间，柱状图越长，代表渲染时间越长。
其中绿色标记线代表16毫秒，要确保一秒钟内达到60帧的速率，需要确保这些帧的每一条线都在16毫秒的绿色标记线以下。
![gpu_render_2](/images/android-studio-performance-1/gpu_render_2.jpg)

* 每个垂直柱状图实际是由三种颜色堆叠在一起的，下面将详细讲解三种不同颜色的含义：

1. 蓝色：代表测量绘制的时间，也就是需要花多长的时间去创建和更新你的Java Display Lists.
		
	- 视图在实际渲染之前，必须先转换成一个GPU所能识别的格式。
	- 接着，Display List对象被系统送入cache
	- 当**蓝色条过长**：代表一堆视图突然变得无效，或者  一个或多个自定义的视图中存在特别复杂的On-Draw绘制函数

	![gpu_render_3](/images/android-studio-performance-1/gpu_render_3.jpg)

2. 红色：代表的是Android 2D的渲染执行Display List所花的执行时间；
		
	- 为了绘制到屏幕上，android 需要使用OpenGLES API将数据发送到GPU，最终在屏幕上显示出来。一个越复杂的视图，比如自定义视图，需要越多复杂的OpenGL指令来绘制它。
	- 当**红色过长**：可是是由于视图过于复杂；也可能是由于重新提交了视图绘制而造成的，而这些视图并非无效的，比如视图旋转，需要先清理这个区域的视图，这可能会影响到这个视图下面的视图，因为这些视图都需要进行重新绘制的操作。

	![gpu_render_4](/images/android-studio-performance-1/gpu_render_4.jpg)

3. 橙色部分表示的是处理时间，或者说这是CPU告诉GPU它已经完成了渲染一帧，这是一个阻塞调用。CPU会一致等待GPU发出接命令的响应。
	 
 - 当**橙色过长**：意味着给GPU太多的工作，太多复杂视图需要OpenGL命令去绘制和处理。

---

## 五. Why 60fps?

* 通常都会提到60fps与16ms，可是知道为何会是以程序是否达到60fps来作为App性能的衡量标准吗？这是因为人眼与大脑之间的协作无法感知超过60fps的画面更新。

* 12fps大概类似手动快速翻动书籍的帧率，这明显是可以感知到不够顺滑的。24fps使得人眼感知的是连续线性的运动，这其实是归功于运动模糊的效果。24fps是电影胶圈通常使用的帧率，因为这个帧率已经足够支撑大部分电影画面需要表达的内容，同时能够最大的减少费用支出。但是低于30fps是无法顺畅表现绚丽的画面内容的，此时就需要用到60fps来达到想要的效果，当然超过60fps是没有必要的。

* 开发app的性能目标就是保持60fps，这意味着每一帧你只有16ms=1000/60的时间来处理所有的任务。

---

## 六. Android, UI and the GPU

对于android程序，复杂的XML布局文件是如何被识别而绘制出来？activity的画面是如何绘制到屏幕上的？

* Rasterization(栅格化)是绘制XML布局文件中是由一系列Button, TextView, Bitmap, String等组件的基本操作。帧是由像素点构成的，屏幕绘制一帧时，像素点是一行一行的进行填充的。而针对每个组件，需要通过栅格化把它拆分到不同的像素上进行显示。这是一个费时操作。GPU本身被设计成使用一组特定的图元，引入GPU从而加快栅格化的操作。
	
	![ui_gpu_1](/images/android-studio-performance-1/ui_gpu_1.jpg)

* CPU负责把UI组件Polygons（多边形化），Texture（纹理化）；再由GPU负责栅格化渲染；
	
	![ui_gpu_2](/images/android-studio-performance-1/ui_gpu_2.jpg)

UI对象被绘制在频幕上，首先在CPU上转换成多边形和纹理，再传递给GPU进行光栅化处理，这两个过程也并非迅速完成。所幸的是OpenGL ES API允许你将内容传送到GPU内存中，在下次需要渲染的时候直接进行操作。

* 渲染性能优化策略：

		- 尽量减少需要CPU转换对象的数量；
		- 尽量减少提交到GPU的数量；
		- 尽可能多且快的将更多的数据上传到GPU，然后留在GPU中 尽可能长的时间内不去修改，这是是Android系统遵守的一项原则。

具体：主题提供了一些资源，包括位图和一些可绘制的东西，被组合在一起形成一个纹理 并且驻留在GPU中。需要使用这些资源，都是值从纹理里面获取渲染，不需要任何转换，故尽量使用这些资源。随着UI组件的越来越丰富，有了更多演变的形态。例如，图片显示，CPU计算加载到内存，再传递给GPU渲染; 文字显示，CPU换算成纹理，再传递给GPU渲染；动画则更为负责，后续再介绍动画。

---

## 七. Invalidations, Layouts, and Performance

* Android需要把XML布局文件转换成GPU能够识别并绘制的对象。这个操作是在DisplayList的帮助下完成的。DisplayList持有所有将要交给GPU绘制到屏幕上的数据信息。

* 在某个View第一次需要被渲染时，DisplayList会因此而被创建，当这个View要显示到屏幕上时，我们会执行GPU的绘制指令来进行渲染。如果你在后续有执行类似移动这个View的位置等操作而需要再次渲染这个View时，我们就仅仅需要额外操作一次渲染指令就够了。然而如果你修改了View中的某些可见组件，那么之前的DisplayList就无法继续使用了，我们需要回头重新创建一个DisplayList并且重新执行渲染指令并更新到屏幕上。

* 需要注意的是：任何时候View中的绘制内容发生变化时，都会重新执行创建DisplayList，渲染DisplayList，更新到屏幕上等一系列操作。这个流程的表现性能取决于你的View的复杂程度，View的状态变化以及渲染管道的执行性能。举个例子，假设某个Button的大小需要增大到目前的两倍，在增大Button大小之前，需要通过父View重新计算并摆放其他子View的位置。修改View的大小会触发整个HierarcyView的重新计算大小的操作。如果是修改View的位置则会触发HierarchView重新计算其他View的位置。如果布局很复杂，这就会很容易导致严重的性能问题。我们需要尽量减少Overdraw。

![7_1](/images/android-studio-performance-1/7_1.jpg)

* 减少Measure Layout的计算时间：
	- 尽量较少无效布局来提高整体的性能
	- 尽量保持扁平化布局，
	- 移除非必需的UI组件

---

## 八. Overdraw, Cliprect, QuickReject

* 引起性能问题的一个很重要的方面是因为过多复杂的绘制操作。我们可以通过工具来检测并修复标准UI组件的Overdraw问题，但是针对高度自定义的UI组件则显得有些力不从心。

* 有一个窍门是我们可以通过执行几个APIs方法来显著提升绘制操作的性能。前面有提到过，非可见的UI组件进行绘制更新会导致Overdraw。例如Nav Drawer从前置可见的Activity滑出之后，如果还继续绘制那些在Nav Drawer里面不可见的UI组件，这就导致了Overdraw。为了解决这个问题，Android系统会通过避免绘制那些完全不可见的组件来尽量减少Overdraw。那些Nav Drawer里面不可见的View就不会被执行浪费资源。

![8](/images/android-studio-performance-1/8.jpg)

* 但是不幸的是，对于那些过于复杂的自定义的View(重写了onDraw方法)，Android系统无法检测具体在onDraw里面会执行什么操作，系统无法监控并自动优化，也就无法避免Overdraw了。但是我们可以通过canvas.clipRect()来帮助系统识别那些可见的区域。这个方法可以指定一块矩形区域，只有在这个区域内才会被绘制，其他的区域会被忽视。这个API可以很好的帮助那些有多组重叠组件的自定义View来控制显示的区域。同时clipRect方法还可以帮助节约CPU与GPU资源，在clipRect区域之外的绘制指令都不会被执行，那些部分内容在矩形区域内的组件，仍然会得到绘制。


![8_2](/images/android-studio-performance-1/8_2.jpg)

* 除了clipRect方法之外，我们还可以使用canvas.quickreject()来判断是否没和某个矩形相交，从而跳过那些非矩形区域内的绘制操作。


---
总之，尽可能保证每一帧在16ms内完成所有的渲染操作，让App更加顺畅。
 
