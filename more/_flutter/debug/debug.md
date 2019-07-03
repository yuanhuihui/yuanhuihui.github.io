1. pushOpacity中通过开关，添加调试信息， 增加类似showPerformanceOverlay的功能
2. 直接关闭所有的savelayer看看性能效果如何？
3. ui线程的reuse过程，计算不准确，需要调整
4. layout中的build是必须的吗，有没有优化空间；
5. ui和gpu有没有可能存在其他的task，导致绘制慢的问题
6. 在绘制的链路上，减少post的操作，可以直接在当前线程执行。
6. checkerboard_offscreen_layers 可以看AutoSaveLayer， 见代码flutter/flow/layers/layer.h
7. set_rasterizer_tracing_threshold设置丢帧的监控，见代码flutter/flow/layers/layer_tree.h，
以及还有checkerboard_raster_cache_images_，checkerboard_offscreen_layers_



### 问题
HandleOOBMessage，带外数据(Out of Band, OOB）是一种重要的的消息

third_party/dart/runtime/vm/isolate.cc

IsolateMessageHandler::HandleMessage



typedef enum {
  kNormalPriority = 0,  // Deliver message when idle.
  kOOBPriority = 1,     // Deliver message asap.

  // Iteration.
  kFirstPriority = 0,
  kNumPriorities = 2,
} Priority;

bool IsOOB() const { return priority_ == Message::kOOBPriority; }



## 这是一种方式：

Timeline.startSync("Paint")
Timeline.finishSync()


TRACE_EVENT_ASYNC_BEGIN0("flutter", "Frame Request Pending", frame_number);
TRACE_EVENT_ASYNC_END0("flutter", "Frame Request Pending", frame_number_++);

TRACE_EVENT0("flutter", "PipelineConsume");
