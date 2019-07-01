
### 5.1 pipeLine
说一说管道：

- “Frame Request Pending”：从Animator::RequestFrame开始，到Animator::BeginFrame()结束，运行在ui线程；
- ”PipelineProduce“： LayerTree生产者，从Animator::BeginFrame()到Animator::Render()结束，运行在ui线程；
- ”PipelineConsume“： LayerTree消费者，从Animator::Render()到GPU执行完栅格化操作，运行在gpu线程；


```Java
void Animator::RequestFrame(bool regenerate_layer_tree) {
  ...

  task_runners_.GetUITaskRunner()->PostTask([self = weak_factory_.GetWeakPtr(),
                                             frame_number = frame_number_]() {
    TRACE_EVENT_ASYNC_BEGIN0("flutter", "Frame Request Pending", frame_number);
    self->AwaitVSync();
  });
}

void Animator::BeginFrame(fml::TimePoint frame_start_time,
                          fml::TimePoint frame_target_time) {
  TRACE_EVENT_ASYNC_END0("flutter", "Frame Request Pending", frame_number_++);
  ...
}
```


```Java
ProducerContinuation Produce() {
  return ProducerContinuation{
      std::bind(&Pipeline::ProducerCommit, this, std::placeholders::_1,
                std::placeholders::_2),  // continuation
      GetNextPipelineTraceID()};         // trace id
}

PipelineConsumeResult Consume(Consumer consumer) {
  {
    std::lock_guard<std::mutex> lock(queue_mutex_);
    std::tie(resource, trace_id) = std::move(queue_.front());
    queue_.pop();
    items_count = queue_.size();
  }

  {
    TRACE_EVENT0("flutter", "PipelineConsume");
    consumer(std::move(resource));
  }
  ...

  return items_count > 0 ? PipelineConsumeResult::MoreAvailable
                         : PipelineConsumeResult::Done;
}

class ProducerContinuation {

  ~ProducerContinuation() {
    if (continuation_) {
      continuation_(nullptr, trace_id_);
      TRACE_EVENT_ASYNC_END0("flutter", "PipelineProduce", trace_id_);
    }
  }

  void Complete(ResourcePtr resource) {
    if (continuation_) {
      continuation_(std::move(resource), trace_id_);
      continuation_ = nullptr;
      TRACE_EVENT_ASYNC_END0("flutter", "PipelineProduce", trace_id_);
    }
  }

  ProducerContinuation(Continuation continuation, size_t trace_id)
      : continuation_(continuation), trace_id_(trace_id) {
    TRACE_EVENT_ASYNC_BEGIN0("flutter", "PipelineProduce", trace_id_);
  }
};
```
