VsyncWaiter::FireCallback放入队列头部，看看优化效果。


https://www.jianshu.com/p/af731d4fa705
闲鱼从CPU、Memory、FPS角度，没有考虑GPU的角度，流畅度呢？？ 里面介绍了CPU/内存的获取过程。

## FPS算法
https://testerhome.com/topics/4775 算法

- adb shell dumpsys SurfaceFlinger --latency SurfaceView  //分析这个数据的过程
- adb shell service call SurfaceFlinger 1013 //


## TODO

- 需要人来做一下这个过程，各指标的对比工作

## saveLayer问题

- 避免超长的build()
- StatefulWidget的性能建议
  - 将state放到树的叶子节点
  - 如果可能使用const widget
- 避免使用 Opacity widget，尤其是在动画中避免使用。 请用 AnimatedOpacity 或 FadeInImage 进行代替
  - Container(color: Color.fromRGBO(255, 0, 0, 0.5)) 远快于 Opacity(opacity: 0.5, child: Container(color: Colors.red)).
- 避免在动画中剪裁。如果可能，请在动画开始之前预先剪切图像
- 对列表和网格列表懒加载




GPU Runner会根据目前帧执行的进度去向UI Task Runner要求下一帧的数据，在任务繁重的时候可能会告诉UI Task Runner延迟任务。这种调度机制确保GPU Task Runner不至于过载，同时也避免了UI Task Runner不必要的消耗。 ？？？ 原理在哪



#### 源码得出的结论

AutoSaveLayer::AutoSaveLayer

- OpacityLayer,ShaderMaskLayer, ColorFilterLayer，BackdropFilterLayer这4个都会调用saveLayer
- ClipRectLayer，ClipRRectLayer，ClipPathLayer，PhysicalShapeLayer这4个只有当设置Clip::antiAliasWithSaveLayer时才调用saveLayer


## 性能问题

- 场景Skia函数调用性能瓶颈
  - saveLayer: 非常费时，每调用一次在GPU分配新的绘图缓冲区，切换绘图目标，尤其是老GPU设备。
    - 只会体现在Skia.flush()耗时长。 GPU性能体验不方便的地方
  - clipPath: 比saveLayer的消耗要小不少，但依然很高。 如果不是十分必要，不要在app中使用。
    - 一旦调用clipPath，那么接下来每一个绘图指令都会受clipPath影响，跟该clipPath做相交操作
  - 现在默认不出现在任何组件（clipBehavior：Clip.none），只有Opacity，ShaderMask才使用以上两个函数
    - （老旧设备能提升2倍性能）

SkCanvas::saveLayer (在这个方法前面打断点看看TODO)
  - 对于35次就是一个很大的数字
  - 这个过程位于LayerTree的paint()里面，但时间很短，为什么呢？GPU接收到saveLayer，会做一个非常简单的预处理就返回，渲染是异步的。原因是由于将绘图指令重新打包，甚至调换顺序，再一起送到GPU里面渲染。
  - 真正的耗时花在SkCanvas::flush过程。  

GPU调试靠经验，有多少函数的调用？
靠差量法来识别耗时的组件调用？

- flutter run --profile --trace-skia --observatory-port 1234
- flutter screenshot --type=skia --observatory-port=1234

https://api.flutter.dev/flutter/dart-ui/Clip-class.html

## 性能点

07-02 05:36:28.477 29103 29132 I GY      : Choreographer doFrame 231599906797036, deta=0.684197 ms
07-02 05:36:28.480 29103 29135 E flutter : [ERROR:flutter/shell/common/animator.cc(214)] GY: BeginFrame
07-02 05:36:28.480 29103 29135 I flutter : GY onBeginFrame now=1562038588480
07-02 05:36:28.480 29103 29135 I flutter : GY deltaTime=18, deltaCounter=1
07-02 05:36:28.480 29103 29135 I flutter : GY ScrollUpdate delta = 0.00
07-02 05:36:28.481 29103 29135 E flutter : [ERROR:flutter/shell/common/animator.cc(153)] GY: Animator::Render() ui took 4.77539ms by Google
07-02 05:36:28.481 29103 29135 I flutter : GY onDrawFrame now=1562038588481, frameTime=1 ms

doDraw才1ms，但vysnc信号过来已经3ms，中间在处理其他message?
另外，gpu线程是不是也在处理其他message导致耗时？


https://medium.com/flutter/profiling-flutter-applications-using-the-timeline-a1a434964af3 绘制原理有优化的空间。


## 经验点

- Frame Request Pending：从vsync注册，到开始消费。 这个长则是ui线程在处理其他task导致的；
- PipelineProduce长，则是ui线程渲染耗时；
- PipelineConsume长，则是gpu线程耗时;
- PipelineProduce和PipelineConsume之间长，则是gp线程处理其他task导致的；


## opengrok flutter
