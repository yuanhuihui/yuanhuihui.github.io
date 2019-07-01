---
layout: post
title:  "解读Flutter FPS算法"
date:   2019-06-22 21:15:40
catalog:  true
tags:
    - flutter

---


## 一、概述

Flutter作为Google新推出的移动端跨平台框架，相比其他跨平台技术有着媲美原生的高性能优势。工欲善其事必先利其器，要掌握性能情况，先了解如何统计FPS，谷歌官方提供了性能fps监控的调试开关，将Widget的showPerformanceOverlay属性设置为true，即可可打开性能监控界面，那么具体是如何监控FPS，在开始正式阅读本文前最好大致了解Flutter的渲染机制：

- [Flutter渲染机制—UI线程](http://gityuan.com/2019/06/15/flutter_ui_draw/)**
- [Flutter渲染机制—GPU线程](http://gityuan.com/2019/06/16/flutter_gpu_draw/)**

有了一定基础后，再来看看其实现原理。

## 二、研究FPS算法

### 2.1 开启showPerformanceOverlay

```Java
void main() => runApp(MyApp());

class MyApp extends StatelessWidget {

  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Flutter Demo',
      theme: ThemeData(primarySwatch: Colors.blue),
      home: MyHomePage(title: 'Flutter Demo Home Page'),
      showPerformanceOverlay: true,  //开启性能监控
    );
  }
}
```

这是flutter app启动的入口runApp()，其中在build过程采用的是MaterialApp类，该类在build过程中会创建WidgetsApp对象，并将showPerformanceOverlay=true传递给WidgetsApp对象；
WidgetsApp在构建build过程，会执行PerformanceOverlay.allEnabled()来初始化性能监控UI层，再经过PerformanceOverlayLayer，然后执行到addToScene()方法，接下来再来看一看该方法。

### 2.2 addToScene
[-> lib/src/rendering/layer.dart]

```Java
ui.EngineLayer addToScene(ui.SceneBuilder builder, [Offset layerOffset = Offset.zero]) {
  // 添加性能监控层 [见小节2.3]
  builder.addPerformanceOverlay(optionsMask, overlayRect.shift(layerOffset));
  builder.setRasterizerTracingThreshold(rasterizerThreshold);
  builder.setCheckerboardRasterCacheImages(checkerboardRasterCacheImages);
  builder.setCheckerboardOffscreenLayers(checkerboardOffscreenLayers);
  return null;
}
```

对于监控显示内容可以通过optionsMask来控制选择性开启GPU活UI线程的fps/绘制功能，也可以全部打开，这里就是采用默认的都打开方式。

### 2.3 addPerformanceOverlay
[-> lib/ui/compositing.dart]

```Java
void addPerformanceOverlay(int enabledOptions, Rect bounds) {
  _addPerformanceOverlay(enabledOptions,
                         bounds.left,
                         bounds.right,
                         bounds.top,
                         bounds.bottom);
}
void _addPerformanceOverlay(int enabledOptions,
                            double left,
                            double right,
                            double top,
                            double bottom) native 'SceneBuilder_addPerformanceOverlay';
```

这是一个native方法，最终会调用到如下的C++代码。

### 2.4 SceneBuilder::addPerformanceOverlay
[-> flutter/lib/ui/compositing/scene_builder.cc]

```Java
void SceneBuilder::addPerformanceOverlay(uint64_t enabledOptions,
                                         double left,
                                         double right,
                                         double top,
                                         double bottom) {
  if (!current_layer_) {
    return;
  }
  SkRect rect = SkRect::MakeLTRB(left, top, right, bottom);
  //创建PerformanceOverlayLayer
  auto layer = std::make_unique<flow::PerformanceOverlayLayer>(enabledOptions);
  layer->set_paint_bounds(rect);
  //ContainerLayer
  current_layer_->Add(std::move(layer));
}
```

创建PerformanceOverlayLayer层，并添加到图层。 已添加到当前的图层，每次[flutter渲染过程](http://gityuan.com/2019/06/16/flutter_gpu_draw/)执行到GPU线程时，会调用LayerTree::Paint()方法时，然后会触发fps的统计计时。

### 2.5 LayerTree::Paint
[-> flutter/flow/layers/layer_tree.cc]

```Java
void LayerTree::Paint(CompositorContext::ScopedFrame& frame,
                      bool ignore_raster_cache) const {
  TRACE_EVENT0("flutter", "LayerTree::Paint");
  SkISize canvas_size = frame.canvas()->getBaseLayerSize();
  SkNWayCanvas internal_nodes_canvas(canvas_size.width(), canvas_size.height());
  internal_nodes_canvas.addCanvas(frame.canvas());
  if (frame.view_embedder() != nullptr) {
    auto overlay_canvases = frame.view_embedder()->GetCurrentCanvases();
    for (size_t i = 0; i < overlay_canvases.size(); i++) {
      internal_nodes_canvas.addCanvas(overlay_canvases[i]);
    }
  }

  Layer::PaintContext context = {
      (SkCanvas*)&internal_nodes_canvas,
      frame.canvas(),
      frame.gr_context(),
      frame.view_embedder(),
      frame.context().frame_time(), //用于记录gpu线程耗时
      frame.context().engine_time(), //用于记录ui线程耗时
      frame.context().texture_registry(),
      ignore_raster_cache ? nullptr : &frame.context().raster_cache(),
      checkerboard_offscreen_layers_};

  if (root_layer_->needs_painting())
    root_layer_->Paint(context);  //遍历layer tree
}
```

在遍历整个layer tree的过程会执行到PerformanceOverlayLayer的绘制过程。

### 2.6 PerformanceOverlayLayer::Paint
[-> flutter/flow/layers/performance_overlay_layer.cc]

```Java
void PerformanceOverlayLayer::Paint(PaintContext& context) const {
  const int padding = 8;

  if (!options_)
    return;

  TRACE_EVENT0("flutter", "PerformanceOverlayLayer::Paint");
  SkScalar x = paint_bounds().x() + padding;
  SkScalar y = paint_bounds().y() + padding;
  SkScalar width = paint_bounds().width() - (padding * 2);
  SkScalar height = paint_bounds().height() / 2;
  SkAutoCanvasRestore save(context.leaf_nodes_canvas, true);
  //展示gpu fps[见小节2.7]
  VisualizeStopWatch(*context.leaf_nodes_canvas, context.frame_time, x, y,
                     width, height - padding,
                     options_ & kVisualizeRasterizerStatistics,
                     options_ & kDisplayRasterizerStatistics, "GPU");
  //展示ui fps[见小节2.7]
  VisualizeStopWatch(*context.leaf_nodes_canvas, context.engine_time, x,
                     y + height, width, height - padding,
                     options_ & kVisualizeEngineStatistics,
                     options_ & kDisplayEngineStatistics, "UI");
}
```

该方法说明：

- UI线程的Fps是通过context.engine_time来计算的；
- GPU线程的Fps是通过context.frame_time来计算的；

### 2.7 VisualizeStopWatch
[-> flutter/flow/layers/performance_overlay_layer.cc]

```Java
void VisualizeStopWatch(SkCanvas& canvas,
                        const Stopwatch& stopwatch,
                        SkScalar x,
                        SkScalar y,
                        SkScalar width,
                        SkScalar height,
                        bool show_graph,
                        bool show_labels,
                        const std::string& label_prefix) {
  const int label_x = 8;    // distance from x
  const int label_y = -10;  // distance from y+height

  if (show_graph) {
    SkRect visualization_rect = SkRect::MakeXYWH(x, y, width, height);
    stopwatch.Visualize(canvas, visualization_rect);
  }

  if (show_labels) {
    //获取平均每一帧的时间 [小节2.8]
    double ms_per_frame = stopwatch.MaxDelta().ToMillisecondsF();
    double fps;
    //保证fps会小于60，此处kOneFrameMS等于16.7ms
    if (ms_per_frame < kOneFrameMS) {
      fps = 1e3 / kOneFrameMS;
    } else {
      fps = 1e3 / ms_per_frame;
    }

    std::stringstream stream;
    stream.setf(std::ios::fixed | std::ios::showpoint);
    stream << std::setprecision(1);
    stream << label_prefix << "  " << fps << " fps  " << ms_per_frame
           << "ms/frame";
    DrawStatisticsText(canvas, stream.str(), x + label_x, y + height + label_y);
  }
}
```

### 2.8 Stopwatch::MaxDelta
[-> flutter/flow/instrumentation.cc]

```Java
fml::TimeDelta Stopwatch::MaxDelta() const {
  fml::TimeDelta max_delta;
  //中kMaxSamples = 120，从120的样本中找到最耗时的那一帧耗时
  for (size_t i = 0; i < kMaxSamples; i++) {
    if (laps_[i] > max_delta)
      max_delta = laps_[i];
  }
  return max_delta;
}
```

由此可以得知，官方原生FPS算法：从最近记录的120帧绘制的时间集合中找出最耗时的一帧所花费时间，然后用1000/ms_per_frame来计算FPS，可见该方法计算的结果是最差值，无法客观的评估真实的FPS情况，比如偶尔卡一次和经常卡的情况就无法区分。

接下来，再来研究一下ui线程和gpu线程中的laps_记录这些时间区间的起点和终点。

## 三、原理分析

frame_time和engine_time的时间记录都在DrawToSurface()方法里面，这是绘制过程必走的方法。

### 3.1  DrawToSurface
[-> flutter/shell/common/rasterizer.cc]

```Java
bool Rasterizer::DrawToSurface(flow::LayerTree& layer_tree) {
  auto frame = surface_->AcquireFrame(layer_tree.frame_size());

  //将ui线程耗时时长[见小节3.2 ]
  compositor_context_->engine_time().SetLapTime(layer_tree.construction_time());

  auto* canvas = frame->SkiaCanvas();

  auto* external_view_embedder = surface_->GetExternalViewEmbedder();

  if (external_view_embedder != nullptr) {
    external_view_embedder->BeginFrame(layer_tree.frame_size());
  }
  //计算GPU线程的耗时时长 [见小节3.3.1 ]
  auto compositor_frame = compositor_context_->AcquireFrame(
      surface_->GetContext(), canvas, external_view_embedder,
      surface_->GetRootTransformation(), true);

  if (canvas) {
    canvas->clear(SK_ColorTRANSPARENT);
  }

  if (compositor_frame && compositor_frame->Raster(layer_tree, false)) {
    frame->Submit();
    if (external_view_embedder != nullptr) {
      external_view_embedder->SubmitFrame(surface_->GetContext());
    }
    FireNextFrameCallbackIfPresent();

    if (surface_->GetContext())
      surface_->GetContext()->performDeferredCleanup(kSkiaCleanupExpiration);

    return true;
  }  
  return false;
}
```

### 3.2 UI线程耗时

先来说结论：UI线程的每一帧耗时时长记录在LayerTree的成员变量construction_time_，该值统计的时间区间为：

- 起点：Animator::BeginFrame()方法赋值last_begin_frame_time_，该值最初赋值来源于doFrame()的frameTimeNanos参数;
- 终点：Animator::Render()为结束。


engine_time().SetLapTime()方法将ui线程的本次耗时记录到laps_，如下所示：

```Java
void Stopwatch::SetLapTime(const fml::TimeDelta& delta) {
  current_sample_ = (current_sample_ + 1) % kMaxSamples;
  laps_[current_sample_] = delta;
}
```

#### 3.2.1 UI计时起点

```Java
void Animator::BeginFrame(fml::TimePoint frame_start_time,
                          fml::TimePoint frame_target_time) {
  TRACE_EVENT_ASYNC_END0("flutter", "Frame Request Pending", frame_number_++);

  last_begin_frame_time_ = frame_start_time;  //设置起点时间
  dart_frame_deadline_ = FxlToDartOrEarlier(frame_target_time);
  {
    TRACE_EVENT2("flutter", "Framework Workload", "mode", "basic", "frame",
                 FrameParity());
    delegate_.OnAnimatorBeginFrame(last_begin_frame_time_);
  }
  ...
}
```

该方法的起点时间frame_start_time是来源于doFrame()的frameTimeNanos参数;

#### 3.2.2 UI计时终点

```Java
void Animator::Render(std::unique_ptr<flow::LayerTree> layer_tree) {
  if (dimension_change_pending_ &&
      layer_tree->frame_size() != last_layer_tree_size_) {
    dimension_change_pending_ = false;
  }
  last_layer_tree_size_ = layer_tree->frame_size();

  if (layer_tree) {
    //设置ui线程生成layer tree的时长
    layer_tree->set_construction_time(fml::TimePoint::Now() -
                                      last_begin_frame_time_);
  }

  producer_continuation_.Complete(std::move(layer_tree));
  delegate_.OnAnimatorDraw(layer_tree_pipeline_);
}
```

该帧在ui线程的耗时时长记录在LayerTree的成员变量construction_time_。 其中在UI绘制最核心的方法是drawFrame()，包含以下几个过程：

- Animate: 遍历_transientCallbacks，执行动画操作
- Layout: 计算渲染对象的大小和位置
  - Build: 对象的构造， 对应于buildScope()
- Compositing bits: 更新具有脏合成位的任何渲染对象， 对应于flushCompositingBits()
- Paint: 将绘制命令记录到Layer， 对应于flushPaint()
- Compositing: 将Compositing bits发送给GPU， 对应于compositeFrame()
- Semantics: 编译渲染对象的语义，并将语义发送给操作系统， 对应于flushSemantics()。

细心的同学会发现，ui线程的耗时是不统计最后一个过程，也就是不包括Semantics过程。


### 3.3 GPU线程耗时

先来说结论：GPU线程的每一帧耗时时长是方法Rasterizer::DrawToSurface()耗时时长。

#### 3.3.1 CompositorContext::AcquireFrame
[-> flutter/flow/compositor_context.cc]

```Java
std::unique_ptr<CompositorContext::ScopedFrame> CompositorContext::AcquireFrame(
    GrContext* gr_context,
    SkCanvas* canvas,
    ExternalViewEmbedder* view_embedder,
    const SkMatrix& root_surface_transformation,
    bool instrumentation_enabled) {
  //创建ScopedFrame[3.3.2]
  return std::make_unique<ScopedFrame>(*this, gr_context, canvas, view_embedder,
                                       root_surface_transformation,
                                       instrumentation_enabled);
}
```

#### 3.3.2 ScopedFrame
[-> flutter/flow/compositor_context.cc]

```Java
CompositorContext::ScopedFrame::ScopedFrame(
    CompositorContext& context,
    GrContext* gr_context,
    SkCanvas* canvas,
    ExternalViewEmbedder* view_embedder,
    const SkMatrix& root_surface_transformation,
    bool instrumentation_enabled)
    : context_(context),
      gr_context_(gr_context),
      canvas_(canvas),
      view_embedder_(view_embedder),
      root_surface_transformation_(root_surface_transformation),
      instrumentation_enabled_(instrumentation_enabled) {
  //GPU线程耗时的计时起点
  context_.BeginFrame(*this, instrumentation_enabled_);
}

CompositorContext::ScopedFrame::~ScopedFrame() {
  //GPU线程耗时的计时终点
  context_.EndFrame(*this, instrumentation_enabled_);
}
```

#### 3.3.3 CompositorContext
[-> flutter/flow/compositor_context.cc]

```Java
void CompositorContext::BeginFrame(ScopedFrame& frame,
                                   bool enable_instrumentation) {
  if (enable_instrumentation) {
    frame_count_.Increment();
    frame_time_.Start();
  }
}

void CompositorContext::EndFrame(ScopedFrame& frame,
                                 bool enable_instrumentation) {
  raster_cache_.SweepAfterFrame();
  if (enable_instrumentation) {
    frame_time_.Stop();
  }
}
```

instrumentation_enabled决定是否会统计gpu的耗时，从DrawToSurface()过程可知该参数为true。CompositorContext的frame_time_在CompositorContext的BeginFrame和EndFrame两个过程分别作为gpu线程的起点和终点。


#### 3.3.4 Stopwatch
[-> flutter/flow/instrumentation.cc]

```Java
void Stopwatch::Start() {
  start_ = fml::TimePoint::Now();
  current_sample_ = (current_sample_ + 1) % kMaxSamples;
}

void Stopwatch::Stop() {
  laps_[current_sample_] = fml::TimePoint::Now() - start_;
}
```

## 四、总结

### 4.1 Flutter渲染机制
要理解整个FPS算法过程，先来回顾一下UI线程和GPU线程的处理流程：

**1）[Flutter渲染机制—UI线程](http://gityuan.com/2019/06/15/flutter_ui_draw/)**

![UIDraw_fwk](http://gityuan.com/img/flutter_ui/UIDraw_fwk.jpg)

**2) [Flutter渲染机制—GPU线程](http://gityuan.com/2019/06/16/flutter_gpu_draw/)**

![GPUDraw](http://gityuan.com/img/flutter_gpu/GPUDraw.jpg)

### 4.2 绘制计时图

![fps](http://gityuan.com/img/flutter_fps/fps.jpg)

FPS算法：从最近记录的120帧绘制的时间集合中找出最耗时的一帧所花费时间，FPS = 1000/最耗时帧的时长，可见该方法计算的结果是最差的情况。
每一帧耗时时长计算方式如下：

- UI线程的FPS计时是从doFrame()为时间起点，以绘制过程中compositeFrame()的Animator::Render()方法为终点；
- GPU线程的FPS计时是Rasterizer::DrawToSurface()方法的耗时时长；


**总结：** UI线程和GPU线程每一帧的耗时时长是没问题的，但仅凭最差一帧来代表FPS的算法无法客观的评估真实的FPS情况，应该结合该帧区间所有的帧耗时情况来计算出FPS。

再来看看目前常见的FPS算法，如下所示：

![fps](http://gityuan.com/img/flutter_fps/fps2.jpg)

**解读：**通过利用ui.window的handleBeginFrame和handleDrawFrame两方法来计算每一帧的ui耗时，理解了前面的原理，不难发现该方式有以下两个缺陷：

- 其一，漏算了doFrame()到开始执行BeginFrame()的耗时时间，由于这是通过postTask方式将任务由VsyncThread异步放入ui线程，该ui线程可能正在处理其他task；
- 其二，多计算了HandleDrawFrame()过程中的Semantics过程。

所谓磨刀不误砍柴工，只有完全搞清楚原理，那么更精准的FPS方案也就不什么难事。
