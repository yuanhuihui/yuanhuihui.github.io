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
