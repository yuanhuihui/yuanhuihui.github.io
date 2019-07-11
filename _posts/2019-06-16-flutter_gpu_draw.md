---
layout: post
title:  "Flutter渲染机制—GPU线程"
date:   2019-06-16 23:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter渲染机制，相关源码目录见文末附录

## 一、概述

看Flutter的渲染绘制过程的核心过程包括在ui线程和gpu线程，上一篇文章[Flutter渲染机制—UI线程](http://gityuan.com/2019/06/15/flutter_ui_draw/)已经详细介绍了UI线程的工作原理，
本文则介绍GPU线程的工作原理，这里需要注意的是，gpu线程是指运行着GPU Task Runner的名叫gpu的线程，其实依然是是在CPU上执行，用于将ui线程传递过来的layer tree转换为GPU命令并方法送到GPU，但这个执行过程会等待GPU的执行结果。

#### 1.1 GPU线程的绘制流程图

**1) [GPU线程处理流程图](http://gityuan.com/img/flutter_gpu/GPUDraw.jpg)**

![GPUDraw](http://gityuan.com/img/flutter_gpu/GPUDraw.jpg)

Flutter渲染机制在UI线程执行到compositeFrame()过程经过多层调用，将栅格化的任务Post到GPU线程来执行。GPU线程一旦空闲则会执行Rasterizer的draw()操作。图中LayerTree::Paint()过程是一个比较重要的操作，会嵌套调用不同layer的Paint过程，比如TransformLayer，PhysicalShapeLayer，ClipRectLayer，PictureLayer等都执行完成会执行flush()将数据发送给GPU。


#### 1.2 Surface类图

**[Surface类关系图](http://gityuan.com/img/flutter_gpu/ClassSurface.jpg)**

![ClassSurface](http://gityuan.com/img/flutter_gpu/ClassSurface.jpg)

三种不同的AndroidSurface，见小节2.6.3，说明如下：

- 硬件VSYNC方式，且开启VULKAN，则采用AndroidSurfaceVulkan，这是当前默认的方式；
- 硬件VSYNC方式，且未开启VULKAN，则采用AndroidSurfaceGL;
- 使用软件模拟的VSYNC方式，则采用AndroidSurfaceSoftware;


#### 1.3 Layer类图

[Layer类关系图](http://gityuan.com/img/flutter_gpu/ClassLayer.jpg)

![ClassLayer](http://gityuan.com/img/flutter_gpu/ClassLayer.jpg)

LayerTree的root_layer来源于SceneBuilder过程初始化，第一个调用PushLayer()的layer便成为root_layer_，后面的调用会形成一个树状结构。从上图，可知ContainerLayer共有9个子类，由这些子类组合成为了一个layer tree，具体的组合方式取决于业务使用方，在LayerTree的Prepoll和Paint过程便会调用这些layer的方法，下面来看看这9个类：

1. ClipRectLayer：圆角矩形裁剪层，可指定矩形和裁剪行为参数，其中裁剪行为有Clip.none，hardEdge，antiAlias，antiAliasWithSaveLayer四种行为；
2. ClipRRectLayer：矩形裁剪层，可指定圆角矩形和裁剪行为参数，同上四种行为；
3. ClipPathLayer：路径裁剪层，可指定路径和裁剪行为参数，同上四种行为；
4. OpacityLayer：透明层，可指定透明度和偏移量参数，其中偏移量是指从画布坐标系原点到调用者坐标系原点的偏移量；
5. ShaderMaskLayer：着色层，可指定着色器、矩阵和混合模式参数；
6. ColorFilterLayer：颜色过滤层，可指定颜色和混合模式参数；
7. Transformayer：变换图层，可指定转换矩阵参数；
8. BackdropFilterLayer：背景过滤层，可指定背景图参数；
9. PhysicalShapeLayer：物理形状层，可指定颜色等八个参数。

## 二、GPU线程渲染过程

### 2.1 MessageLoopImpl::RunExpiredTasks
[-> flutter/fml/message_loop_impl.cc]

```Java
void MessageLoopImpl::RunExpiredTasks() {
  TRACE_EVENT0("fml", "MessageLoop::RunExpiredTasks");
  std::vector<fml::closure> invocations;

  {
    std::lock_guard<std::mutex> lock(delayed_tasks_mutex_);
    //当没有待处理的task则直接返回
    if (delayed_tasks_.empty()) {
      return;
    }

    auto now = fml::TimePoint::Now();
    while (!delayed_tasks_.empty()) {
      const auto& top = delayed_tasks_.top();
      if (top.target_time > now) {
        break;
      }
      invocations.emplace_back(std::move(top.task));
      delayed_tasks_.pop();
    }

    WakeUp(delayed_tasks_.empty() ? fml::TimePoint::Max()
                                  : delayed_tasks_.top().target_time);
  }

  for (const auto& invocation : invocations) {
    invocation();  // [见小节3.6]
    for (const auto& observer : task_observers_) {
      observer.second();
    }
  }
}
```

gpu线程是不断循环处理消息的过程。

#### 2.1.1 Shell::OnAnimatorDraw
[-> flutter/shell/common/shell.cc]

```Java
void Shell::OnAnimatorDraw(
    fml::RefPtr<flutter::Pipeline<flow::LayerTree>> pipeline) {

  //向GPU线程提交绘制任务
  task_runners_.GetGPUTaskRunner()->PostTask(
      [rasterizer = rasterizer_->GetWeakPtr(),
       pipeline = std::move(pipeline)]() {
        if (rasterizer) {
          rasterizer->Draw(pipeline); //[见小节2.1.1]
        }
      });
}
```

书接上文[Flutter渲染机制—UI线程](http://gityuan.com/2019/06/15/flutter_ui_draw/)的[小节4.10.5]的Shell::OnAnimatorDraw()方法，向gpu线程post任务，交由gpu线程来处理。


### 2.2 Rasterizer::Draw
[-> flutter/shell/common/rasterizer.cc]

```Java
void Rasterizer::Draw(
    fml::RefPtr<flutter::Pipeline<flow::LayerTree>> pipeline) {
  TRACE_EVENT0("flutter", "GPURasterizer::Draw");

  flutter::Pipeline<flow::LayerTree>::Consumer consumer =
      std::bind(&Rasterizer::DoDraw, this, std::placeholders::_1);

  //消费pipeline的任务 [见小节2.3]
  switch (pipeline->Consume(consumer)) {
    case flutter::PipelineConsumeResult::MoreAvailable: {
      task_runners_.GetGPUTaskRunner()->PostTask(
          [weak_this = weak_factory_.GetWeakPtr(), pipeline]() {
            if (weak_this) {
              weak_this->Draw(pipeline);
            }
          });
      break;
    }
    default:
      break;
  }
}
```

执行完Consume()后返回值为PipelineConsumeResult::MoreAvailable，则说明还有任务需要处理，则再次执行不同LayerTree的Draw()过程。

### 2.3 Pipeline::Consume
[-> flutter/synchronization/pipeline.h]

```Java
PipelineConsumeResult Consume(Consumer consumer) {
  if (consumer == nullptr) {
    return PipelineConsumeResult::NoneAvailable;
  }

  // 当ui线程生产了layer tree，则此处可消费
  if (!available_.TryWait()) {
    return PipelineConsumeResult::NoneAvailable;
  }

  ResourcePtr resource;
  size_t trace_id = 0;
  size_t items_count = 0;

  {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    //从队列中取出头部的资源
    std::tie(resource, trace_id) = std::move(queue_.front());
    queue_.pop();
    items_count = queue_.size();
  }

  {
    TRACE_EVENT0("flutter", "PipelineConsume");
    consumer(std::move(resource));  //消费管道中的一项资源[见小节2.4]
  }

  //消费完成，则将消息量empty_执行加1操作
  empty_.Signal();
  TRACE_FLOW_END("flutter", "PipelineItem", trace_id);
  return items_count > 0 ? PipelineConsumeResult::MoreAvailable
                         : PipelineConsumeResult::Done;
}
```

根据小节2.1，可知这里的consumer绑定的是Rasterizer::DoDraw()，接下里看看这个方法。

### 2.4 Rasterizer::DoDraw
[-> flutter/shell/common/rasterizer.cc]

```Java
void Rasterizer::DoDraw(std::unique_ptr<flow::LayerTree> layer_tree) {
  if (!layer_tree || !surface_) {
    return;
  }
  //[见小节2.5]
  if (DrawToSurface(*layer_tree)) {
    //将layer tree记录到last_layer_tree_
    last_layer_tree_ = std::move(layer_tree);
  }
}
```

### 2.5 Rasterizer::DrawToSurface
[-> flutter/shell/common/rasterizer.cc]

```Java

bool Rasterizer::DrawToSurface(flow::LayerTree& layer_tree) {
  //此处的surface_为GPUSurfaceGL，得到的是SurfaceFrame [见小节2.6]
  auto frame = surface_->AcquireFrame(layer_tree.frame_size());

  if (frame == nullptr) {
    return false;
  }

  //将ui线程生成layer tree所花费时间，记录到合成器上下文的engine_time里
  compositor_context_->engine_time().SetLapTime(layer_tree.construction_time());
  //获取SkCanvas指针
  auto* canvas = frame->SkiaCanvas();

  auto* external_view_embedder = surface_->GetExternalViewEmbedder();

  if (external_view_embedder != nullptr) {
    external_view_embedder->BeginFrame(layer_tree.frame_size());
  }
  //返回的是ScopedFrame，[见小节2.7]
  auto compositor_frame = compositor_context_->AcquireFrame(
      surface_->GetContext(), canvas, external_view_embedder,
      surface_->GetRootTransformation(), true);

  if (canvas) {
    canvas->clear(SK_ColorTRANSPARENT);
  }

  // [见小节2.8]
  if (compositor_frame && compositor_frame->Raster(layer_tree, false)) {
     //[见小节2.9]
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

该方法主要功能：

- 执行AndroidSurface的AcquireFrame()来获取SurfaceFrame，此处AndroidSurface为GPUSurfaceGL子类；
- layer_tree.construction_time()记录ui线程生成layer tree所花费时间，将其记录到compositor_context_的engine_time，用于计算fps；
- 执行CompositorContext的AcquireFrame()来获取ScopedFrame；
- 执行ScopedFrame的Raster()进行绘制操作；
- 执行SurfaceFrame的Submit()来进行flush和SwapBuffers操作。

### 2.6 AndroidSurface::AcquireFrame

要知道surface_到底是怎么来的，先来看看AndroidSurface::Create()过程。

#### 2.6.1 PlatformView::NotifyCreated
[-> flutter/shell/common/platform_view.h]

```Java
void PlatformView::NotifyCreated() {
    delegate_.OnPlatformViewCreated(CreateRenderingSurface()); //[见小节2.6.2]
}
```
OnPlatformViewCreated()过程会通过rasterizer->Setup(std::move(surface))来初始化surface_变量，而surface_便是由CreateRenderingSurface()方法赋值初始化的，如下所示。

#### 2.6.2 PlatformViewAndroid::CreateRenderingSurface
[-> flutter/shell/platform/android/platform_view_android.cc]

```Java
std::unique_ptr<Surface> PlatformViewAndroid::CreateRenderingSurface() {
  if (!android_surface_) {
    return nullptr;
  }
  //[见小节2.6.3/ 2.6.4]
  return android_surface_->CreateGPUSurface();
}
```

这里有两点需要关注一下：

- android_surface_变量：通过AndroidSurface::Create完成赋值初始化，返回的数据类型为AndroidSurfaceGL，见小节2.6.3；
- CreateGPUSurface()：该方法返回的数据类型为GPUSurfaceGL，见小节2.6.4；

#### 2.6.3 AndroidSurface::Create
[-> flutter/shell/platform/android/android_surface.cc]

```Java
std::unique_ptr<AndroidSurface> AndroidSurface::Create(
    bool use_software_rendering) {
  if (use_software_rendering) {
    auto software_surface = std::make_unique<AndroidSurfaceSoftware>();
    return software_surface->IsValid() ? std::move(software_surface) : nullptr;
  }
#if SHELL_ENABLE_VULKAN
  auto vulkan_surface = std::make_unique<AndroidSurfaceVulkan；>();
  return vulkan_surface->IsValid() ? std::move(vulkan_surface) : nullptr;
#else  
  auto gl_surface = std::make_unique<AndroidSurfaceGL>();
  return gl_surface->IsOffscreenContextValid() ? std::move(gl_surface)
                                               : nullptr;
#endif  
}
```

三种不同的[AndroidSurface](http://gityuan.com/img/flutter_gpu/ClassSurface.jpg)，目前android_surface_默认数据类型为AndroidSurfaceGL。

#### 2.6.4 AndroidSurfaceGL::CreateGPUSurface
[-> flutter/shell/platform/android/android_surface_gl.cc]

```Java
std::unique_ptr<Surface> AndroidSurfaceGL::CreateGPUSurface() {
  auto surface = std::make_unique<GPUSurfaceGL>(this);
  return surface->IsValid() ? std::move(surface) : nullptr;
}
```

可见surface_的类型为GPUSurfaceGL。再来看看看AcquireFrame()过程。

#### 2.6.5 GPUSurfaceGL::AcquireFrame
[-> flutter/shell/gpu/gpu_surface_gl.cc]

```Java
std::unique_ptr<SurfaceFrame> GPUSurfaceGL::AcquireFrame(const SkISize& size) {
  ...
  //此处delegate_是AndroidSurfaceGL，将其onscreen_context_设置为current
  if (!delegate_->GLContextMakeCurrent()) {
    return nullptr;
  }

  const auto root_surface_transformation = GetRootTransformation();

  sk_sp<SkSurface> surface =
      AcquireRenderSurface(size, root_surface_transformation);

  if (surface == nullptr) {
    return nullptr;
  }

  surface->getCanvas()->setMatrix(root_surface_transformation);

  SurfaceFrame::SubmitCallback submit_callback =
      [weak = weak_factory_.GetWeakPtr()](const SurfaceFrame& surface_frame,
                                          SkCanvas* canvas) {
        return weak ? weak->PresentSurface(canvas) : false;
      };

  //创建SurfaceFrame指针
  return std::make_unique<SurfaceFrame>(surface, submit_callback);
}
```

该过程会创建SurfaceFrame并设置SubmitCallback方法()。

### 2.7 CompositorContext::AcquireFrame
[-> flutter/flow/compositor_context.cc]

```Java
std::unique_ptr<CompositorContext::ScopedFrame> CompositorContext::AcquireFrame(
    GrContext* gr_context,
    SkCanvas* canvas,
    ExternalViewEmbedder* view_embedder,
    const SkMatrix& root_surface_transformation,
    bool instrumentation_enabled) {
  //创建ScopedFrame指针
  return std::make_unique<ScopedFrame>(*this, gr_context, canvas, view_embedder,
                                       root_surface_transformation,
                                       instrumentation_enabled);
}
```

创建ScopedFrame，其成遍历context_记录着CompositorContext，而CompositorContext是在Rasterizer对象初始化的时候创建的。

### 2.8 ScopedFrame::Raster
[-> flutter/flow/compositor_context.cc]

```Java
bool CompositorContext::ScopedFrame::Raster(flow::LayerTree& layer_tree,
                                            bool ignore_raster_cache) {
  layer_tree.Preroll(*this, ignore_raster_cache);
  layer_tree.Paint(*this, ignore_raster_cache);
  return true;
}
```

从小节2.5可知ignore_raster_cache等于false，会采用raster缓存。

### 2.9 LayerTree::Preroll
[-> flutter/flow/layers/layer_tree.cc]

```Java
void LayerTree::Preroll(CompositorContext::ScopedFrame& frame,
                        bool ignore_raster_cache) {
  TRACE_EVENT0("flutter", "LayerTree::Preroll");
  SkColorSpace* color_space =
      frame.canvas() ? frame.canvas()->imageInfo().colorSpace() : nullptr;
  frame.context().raster_cache().SetCheckboardCacheImages(
      checkerboard_raster_cache_images_);
  PrerollContext context = {
      //此处采用raster缓存
      ignore_raster_cache ? nullptr : &frame.context().raster_cache(),
      frame.gr_context(),
      frame.view_embedder(),
      color_space,
      kGiantRect,
      frame.context().frame_time(),
      frame.context().engine_time(),
      frame.context().texture_registry(),
      checkerboard_offscreen_layers_};
  //执行相应layer子类的preroll方法
  root_layer_->Preroll(&context, frame.root_surface_transformation());
}
```

该方法主要功能：

- frame是由小节2.7过程赋值，其类型为ScopedFrame；
- 用于统计fps的frame_time和engine_time是来自于CompositorContext的成员；
- 从root_layer_记录图层树的根节点，根据根节点的具体ContainerLayer子类类型来执行相应类的Preroll方法()， 这里以ContainerLayer为例子来说明。


#### 2.9.1 ContainerLayer::Preroll
[-> flutter/flow/layers/container_layer.cc]

```Java
void ContainerLayer::Preroll(PrerollContext* context, const SkMatrix& matrix) {
  TRACE_EVENT0("flutter", "ContainerLayer::Preroll");

  SkRect child_paint_bounds = SkRect::MakeEmpty();
  //[见小节2.9.2]
  PrerollChildren(context, matrix, &child_paint_bounds);
  //设置绘制范围
  set_paint_bounds(child_paint_bounds);
}
```

该方法主要功能是遍历所有子图层，执行具体图层的Preroll()方法，并设置绘制范围。

#### 2.9.2 ContainerLayer::PrerollChildren
[-> flutter/flow/layers/container_layer.cc]

```Java
void ContainerLayer::PrerollChildren(PrerollContext* context,
                                     const SkMatrix& child_matrix,
                                     SkRect* child_paint_bounds) {
  for (auto& layer : layers_) {
    PrerollContext child_context = *context;
    //遍历所有的图层，依次执行preroll
    layer->Preroll(&child_context, child_matrix);
    //根据需要设置是否需要合成
    if (layer->needs_system_composite()) {
      set_needs_system_composite(true);
    }
    child_paint_bounds->join(layer->paint_bounds());
  }
}
```

### 2.10 LayerTree::Paint
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
      frame.context().frame_time(),
      frame.context().engine_time(),
      frame.context().texture_registry(),
      ignore_raster_cache ? nullptr : &frame.context().raster_cache(),
      checkerboard_offscreen_layers_};
  //当paint_bounds_不为空则需要绘制
  if (root_layer_->needs_painting())
    root_layer_->Paint(context);
}
```

paint_bounds_是在Preroll过程调用set_paint_bounds方法来赋值的，当paint_bounds_不为空则需要绘制。

对于Paint绘制过程，调用哪个方法取决于图层树结构中相应的layer类型，详见[Layer类图](http://gityuan.com/img/flutter_gpu/ClassLayer.jpg)
。每个执行Paint()过程会再调用PaintChildren来遍历layers_的子图层，下面列举图上几个类的Paint绘制方法。

#### 2.10.1 TransformLayer::Paint
[-> flutter/flow/layers/transform_layer.cc]

```Java
void TransformLayer::Paint(PaintContext& context) const {
  TRACE_EVENT0("flutter", "TransformLayer::Paint");
  FML_DCHECK(needs_painting());

  SkAutoCanvasRestore save(context.internal_nodes_canvas, true);
  context.internal_nodes_canvas->concat(transform_);
  PaintChildren(context);
}
```

#### 2.10.2 PhysicalShapeLayer::Paint
[-> flutter/flow/layers/physical_shape_layer.cc]

```Java
void PhysicalShapeLayer::Paint(PaintContext& context) const {
  TRACE_EVENT0("flutter", "PhysicalShapeLayer::Paint");
  FML_DCHECK(needs_painting());

  if (elevation_ != 0) {
    DrawShadow(context.leaf_nodes_canvas, path_, shadow_color_, elevation_,
               SkColorGetA(color_) != 0xff, device_pixel_ratio_);
  }

  SkPaint paint;
  paint.setColor(color_);
  if (clip_behavior_ != Clip::antiAliasWithSaveLayer) {
    context.leaf_nodes_canvas->drawPath(path_, paint);
  }

  int saveCount = context.internal_nodes_canvas->save();
  switch (clip_behavior_) {
    case Clip::hardEdge:
      context.internal_nodes_canvas->clipPath(path_, false);
      break;
    case Clip::antiAlias:
      context.internal_nodes_canvas->clipPath(path_, true);
      break;
    case Clip::antiAliasWithSaveLayer:
      context.internal_nodes_canvas->clipPath(path_, true);
      context.internal_nodes_canvas->saveLayer(paint_bounds(), nullptr);
      break;
    case Clip::none:
      break;
  }

  if (clip_behavior_ == Clip::antiAliasWithSaveLayer) {
    context.leaf_nodes_canvas->drawPaint(paint);
  }

  PaintChildren(context);

  context.internal_nodes_canvas->restoreToCount(saveCount);
}
```

#### 2.10.3 ClipRectLayer::Paint
[-> flutter/flow/layers/clip_rect_layer.cc]

```Java
void ClipRectLayer::Paint(PaintContext& context) const {
  TRACE_EVENT0("flutter", "ClipRectLayer::Paint");
  FML_DCHECK(needs_painting());

  SkAutoCanvasRestore save(context.internal_nodes_canvas, true);
  context.internal_nodes_canvas->clipRect(paint_bounds(),
                                          clip_behavior_ != Clip::hardEdge);
  if (clip_behavior_ == Clip::antiAliasWithSaveLayer) {
    context.internal_nodes_canvas->saveLayer(paint_bounds(), nullptr);
  }
  PaintChildren(context);
  if (clip_behavior_ == Clip::antiAliasWithSaveLayer) {
    context.internal_nodes_canvas->restore();
  }
}
```

#### 2.10.4 PictureLayer::Paint
[-> flutter/flow/layers/picture_layer.cc]

```Java
void PictureLayer::Paint(PaintContext& context) const {
  TRACE_EVENT0("flutter", "PictureLayer::Paint");
  FML_DCHECK(picture_.get());
  FML_DCHECK(needs_painting());

  SkAutoCanvasRestore save(context.leaf_nodes_canvas, true);
  context.leaf_nodes_canvas->translate(offset_.x(), offset_.y());
#ifndef SUPPORT_FRACTIONAL_TRANSLATION
  context.leaf_nodes_canvas->setMatrix(RasterCache::GetIntegralTransCTM(
      context.leaf_nodes_canvas->getTotalMatrix()));
#endif

  if (context.raster_cache) {
    const SkMatrix& ctm = context.leaf_nodes_canvas->getTotalMatrix();
    RasterCacheResult result = context.raster_cache->Get(*picture(), ctm);
    if (result.is_valid()) {
      result.draw(*context.leaf_nodes_canvas);
      return;
    }
  }
  context.leaf_nodes_canvas->drawPicture(picture());
}
```

#### 2.10.5 OpacityLayer::Paint
[-> flutter/flow/layers/opacity_layer.cc]

```Java
void OpacityLayer::Paint(PaintContext& context) const {
  TRACE_EVENT0("flutter", "OpacityLayer::Paint");

  SkPaint paint;
  paint.setAlpha(alpha_);

  SkAutoCanvasRestore save(context.internal_nodes_canvas, true);
  context.internal_nodes_canvas->translate(offset_.fX, offset_.fY);

  if (context.view_embedder == nullptr && layers().size() == 1 &&
      context.raster_cache) {
    const SkMatrix& ctm = context.leaf_nodes_canvas->getTotalMatrix();
    RasterCacheResult child_cache =
        context.raster_cache->Get(layers()[0].get(), ctm);
    if (child_cache.is_valid()) {
      child_cache.draw(*context.leaf_nodes_canvas, &paint);
      return;
    }
  }

  SkRect saveLayerBounds;
  paint_bounds()
      .makeOffset(-offset_.fX, -offset_.fY)
      .roundOut(&saveLayerBounds);

  Layer::AutoSaveLayer save_layer =
      Layer::AutoSaveLayer::Create(context, saveLayerBounds, &paint);
  PaintChildren(context);
}
```

### 2.11 SurfaceFrame::Submit
[-> flutter/shell/common/surface.cc]

```Java
bool SurfaceFrame::Submit() {
  if (submitted_) {
    return false;
  }
  submitted_ = PerformSubmit(); //[见小节2.11.1]
  return submitted_;
}
```

再回到小节2.5，执行完Raster()后需要执行Submit()提交。

#### 2.11.1 SurfaceFrame::PerformSubmit
[-> flutter/shell/common/surface.cc]

```Java
bool SurfaceFrame::PerformSubmit() {
  if (submit_callback_ == nullptr) {
    return false;
  }
  //[见小节2.11.2]
  if (submit_callback_(*this, SkiaCanvas())) {
    return true;
  }

  return false;
}
```

此处的submit_callback_是由[小节2.6.4]中赋值的，对应的方法是PresentSurface()

#### 2.11.2 GPUSurfaceGL::PresentSurface
[-> flutter/shell/gpu/gpu_surface_gl.cc]

```Java
bool GPUSurfaceGL::PresentSurface(SkCanvas* canvas) {
  if (delegate_ == nullptr || canvas == nullptr || context_ == nullptr) {
    return false;
  }

  if (offscreen_surface_ != nullptr) {
    TRACE_EVENT0("flutter", "CopyTextureOnscreen");
    SkPaint paint;
    SkCanvas* onscreen_canvas = onscreen_surface_->getCanvas();
    onscreen_canvas->clear(SK_ColorTRANSPARENT);
    onscreen_canvas->drawImage(offscreen_surface_->makeImageSnapshot(), 0, 0,
                               &paint);
  }

  {
    TRACE_EVENT0("flutter", "SkCanvas::Flush");
    //获取SkSurface的fCachedCanvas，再调用其flush()，[见小节2.12]
    onscreen_surface_->getCanvas()->flush();
  }

  if (!delegate_->GLContextPresent()) { //[见小节2.13]
    return false;
  }

  if (delegate_->GLContextFBOResetAfterPresent()) {
    auto current_size =
        SkISize::Make(onscreen_surface_->width(), onscreen_surface_->height());

    auto new_onscreen_surface =
        WrapOnscreenSurface(context_.get(),            // GL context
                            current_size,              // root surface size
                            delegate_->GLContextFBO()  // window FBO ID
        );

    if (!new_onscreen_surface) {
      return false;
    }
    onscreen_surface_ = std::move(new_onscreen_surface);
  }
  return true;
}
```

此处delegate_为AndroidSurfaceGL类型。

### 2.12 SkCanvas::flush
[-> third_party/skia/src/core/SkCanvas.cpp]

```Java
void SkCanvas::flush() {
    this->onFlush();
}
```

#### 2.12.1 SkCanvas::onFlush
[-> third_party/skia/src/core/SkCanvas.cpp]

```Java
void SkCanvas::onFlush() {
    SkBaseDevice* device = this->getDevice();
    if (device) {
        device->flush();
    }
}
```

### 2.13 AndroidSurfaceGL::GLContextPresent
[-> flutter/shell/platform/android/android_context_gl.cc]

```Java
bool AndroidSurfaceGL::GLContextPresent() {
  return onscreen_context_->SwapBuffers();
}
```

#### 2.13.1 AndroidContextGL::SwapBuffers
[-> flutter/shell/platform/android/android_context_gl.cc]

```Java
bool AndroidContextGL::SwapBuffers() {
  TRACE_EVENT0("flutter", "AndroidContextGL::SwapBuffers");
  return eglSwapBuffers(environment_->Display(), surface_);
}
```

## 三、总结

1）生产者-消费者模式

- 管道Pipeline中的信号量available_，初始值为0，只有当UI线程执行一次ProducerCommit()则进行加1操作，该值大于0，从而允许GPU线程来执行Consume()方法则进行减1操作。
- 管道Pipeline中的信号量empty_，初始值为depth(默认等于2，该值初始化在Animator.cc中LayerTreePipeline创建过程)，UI线程生产layer tree交给GPU线程光栅化操作一次则进行减1操作，当GPU线程执行完成Consume()方法后才会执行加1操作。

也就是说：

- 当管道中待处理的光栅化任务等于depth个的时候（池子满了），则UI线程无法执行Animator::BeginFrame()，而是等于下一次Vsync信号再尝试执行；
- 当管道中没有待处理的光栅化任务的时候（池子空了），则GPU线程无法执行Rasterizer::Draw()，而是直接返回，等待UI线程向其添加任务。


2）gpu线程的主要工作是将layer tree进行光栅化再发送给GPU，其中最为核心方法ScopedFrame::Raster()，其主要工作如下所示：

- LayerTree::Preroll: 绘制前的一些准备工作
- LayerTree::Paint: 此处会嵌套调用各个不同的layer的绘制方法
- SkCanvas::Flush: 将数据flush到GPU，需要注意的是saveLayer的耗时；
- AndroidContextGL::SwapBuffers: 缓存交换操作

这几个过程是Timeline中ui线程的标签项，[如图所示](http://gityuan.com/img/flutter_ui/timeline_gpu_draw.png)：

![timeline_gpu_draw](http://gityuan.com/img/flutter_ui/timeline_gpu_draw.png)

UI线程是”PipelineProduce“，相对应的GPU线程则是”PipelineConsume“，贯穿整个Rasterizer::DoDraw()过程。


## 附录
本文涉及到相关源码文件

```Java
flutter/shell/common/
    - shell.cc
    - rasterizer.cc
    - surface.cc
    - platform_view.h

flutter/shell/platform/android/
    - platform_view_android.cc
    - android_surface.cc
    - android_surface_gl.cc
    - android_context_gl.cc

flutter/flow/layers/
    - layer_tree.cc
    - container_layer.cc
    - transform_layer.cc
    - physical_shape_layer.cc
    - clip_rect_layer.cc
    - picture_layer.cc

flutter/fml/message_loop_impl.cc
flutter/synchronization/pipeline.h
flutter/flow/compositor_context.cc
flutter/shell/gpu/gpu_surface_gl.cc
third_party/skia/src/core/SkCanvas.cpp

```
