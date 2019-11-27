---
layout: post
title:  "深入理解Flutter消息机制"
date:   2019-07-20 23:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter消息处理机制，相关源码目录见文末附录


## 一、概述

在[深入理解Flutter引擎启动](http://gityuan.com/2019/06/22/flutter_booting/) 已经介绍了引擎启动阶段会创建AndroidShellHolder对象，在该过程会执行ThreadHost初始化，MessageLoop便是在这个阶段启动的。

#### 1.1 消息流程图

**[MessageLoop启动流程图](http://gityuan.com/img/flutter_message/MessageLoop_create.jpg)**

![MessageLoop_create](http://gityuan.com/img/flutter_message/MessageLoop_create.jpg)


该过程主要工作：创建线程，并给每个线程中创建相应的MessageLoop，对于Android平台创建的是MessageLoopAndroid，同时还会创建TaskRunner，之后便进入到相应MessageLoop的run()方法。

**[ScheduleMicrotask流程图](http://gityuan.com/img/flutter_message/ScheduleMicrotask.jpg)**

![ScheduleMicrotask](http://gityuan.com/img/flutter_message/ScheduleMicrotask.jpg)

#### 1.2 MessageLoop类图

**[MessageLoop类图](http://gityuan.com/img/flutter_message/MessageModel.jpg)**

![MessageModel](http://gityuan.com/img/flutter_message/MessageModel.jpg)

图解：

- Thread和MessageLoop类都有成员变量记录着TaskRunner类；
- MessageLoopImpl类在Android系统的实现子类为MessageLoopAndroid；

## 二、MessageLoop启动

引擎启动过程会创建UI/GPU/IO这3个线程，代码如下。


```Java
thread_host_ = {thread_label, ThreadHost::Type::UI
                              | ThreadHost::Type::GPU
                              | ThreadHost::Type::IO};
```


### 2.1 ThreadHost初始化
[-> flutter/shell/common/thread_host.cc]

```Java
ThreadHost::ThreadHost(std::string name_prefix, uint64_t mask) {
  if (mask & ThreadHost::Type::Platform) {
    platform_thread = std::make_unique<fml::Thread>(name_prefix + ".platform");
  }

  if (mask & ThreadHost::Type::UI) {
    //创建线程 [见小节2.2]
    ui_thread = std::make_unique<fml::Thread>(name_prefix + ".ui");
  }

  if (mask & ThreadHost::Type::GPU) {
    gpu_thread = std::make_unique<fml::Thread>(name_prefix + ".gpu");
  }

  if (mask & ThreadHost::Type::IO) {
    io_thread = std::make_unique<fml::Thread>(name_prefix + ".io");
  }
}
```

根据传递的参数，可知首次创建AndroidShellHolder实例的过程，会创建3个线程名为1.ui, 1.gpu, 1.io。


### 2.2 Thread初始化
[-> flutter/fml/thread.cc]

```Java
Thread::Thread(const std::string& name) : joined_(false) {
  fml::AutoResetWaitableEvent latch;
  fml::RefPtr<fml::TaskRunner> runner;
  thread_ = std::make_unique<std::thread>([&latch, &runner, name]() -> void {
    SetCurrentThreadName(name); //设置线程名
    fml::MessageLoop::EnsureInitializedForCurrentThread(); //[见小节2.3]
    //从ThreadLocal中获取MessageLoop指针
    auto& loop = MessageLoop::GetCurrent();
    runner = loop.GetTaskRunner();
    latch.Signal();
    loop.Run(); //运行 [见小节2.8]
  });
  latch.Wait();
  task_runner_ = runner;
}
```

Thread线程对象会有两个重要的成员变量：

- thread_: 类型为unique_ptr<std::thread>
- task_runner_: 类型为RefPtr<fml::TaskRunner>

### 2.3 EnsureInitializedForCurrentThread
[-> flutter/fml/message_loop.cc]

```Java
FML_THREAD_LOCAL ThreadLocal tls_message_loop([](intptr_t value) {
  delete reinterpret_cast<MessageLoop*>(value);
});

void MessageLoop::EnsureInitializedForCurrentThread() {
  if (tls_message_loop.Get() != 0) {
    return;  //保证只初始化一次
  }
  //创建MessageLoop，并保持在tls_message_loop [见小节2.4]
  tls_message_loop.Set(reinterpret_cast<intptr_t>(new MessageLoop()));
}
```

创建MessageLoop对象保存在ThreadLocal类型的tls_message_loop变量中。


### 2.4 MessageLoop初始化
[-> flutter/fml/message_loop.cc]

```Java
MessageLoop::MessageLoop()
       //[见小节2.5]
    : loop_(MessageLoopImpl::Create()),
      //[见小节2.7]
      task_runner_(fml::MakeRefCounted<fml::TaskRunner>(loop_)) {
}
```

创建MessageLoopAndroid对象和TaskRunner对象，并保持在当前的MessageLoop对象的成员变量。


### 2.5 MessageLoopImpl::Create
[-> flutter/fml/message_loop_impl.cc]

```Java
fml::RefPtr<MessageLoopImpl> MessageLoopImpl::Create() {
#if OS_MACOSX
  return fml::MakeRefCounted<MessageLoopDarwin>();
#elif OS_ANDROID
  return fml::MakeRefCounted<MessageLoopAndroid>(); //[见小节2.6]
#elif OS_LINUX
  return fml::MakeRefCounted<MessageLoopLinux>();
#elif OS_WIN
  return fml::MakeRefCounted<MessageLoopWin>();
#else
  return nullptr;
#endif
}
```

针对Android平台，则MessageLoopImpl的实例为MessageLoopAndroid对象。

### 2.6 MessageLoopAndroid初始化
[-> flutter/fml/platform/android/message_loop_android.cc]

```Java
MessageLoopAndroid::MessageLoopAndroid()
    : looper_(AcquireLooperForThread()), //[见小节2.6.1]
      timer_fd_(::timerfd_create(kClockType, TFD_NONBLOCK | TFD_CLOEXEC)),
      running_(false) {
  static const int kWakeEvents = ALOOPER_EVENT_INPUT;

  ALooper_callbackFunc read_event_fd = [](int, int events, void* data) -> int {
    if (events & kWakeEvents) {
      //不断收到回调
      reinterpret_cast<MessageLoopAndroid*>(data)->OnEventFired();
    }
    return 1;
  };

  int add_result = ::ALooper_addFd(looper_.get(),          // looper
                                   timer_fd_.get(),        // fd
                                   ALOOPER_POLL_CALLBACK,  // ident
                                   kWakeEvents,            // events
                                   read_event_fd,          // callback
                                   this                    // baton
  );
}
```

#### 2.6.1 AcquireLooperForThread
[-> flutter/fml/platform/android/message_loop_android.cc]

```Java
static ALooper* AcquireLooperForThread() {
  //获取当前线程的loop
  ALooper* looper = ALooper_forThread();

  if (looper == nullptr) {
    // 当前线程没有配置looper，则创建一个loop
    looper = ALooper_prepare(0);
  }

  // 该线程已经有looper，则获取该loop的引用
  ALooper_acquire(looper);
  return looper;
}
```

此处是通过android中的ndk工具实现loop消息机制，对于1.ui, 1.gpu, 1.io线程会创建native的loop，对于main线程会复用Android原生的native loop。

- ALooper_forThread：获取当前线程的loop，对应Looper::getForThread()，通过该线程key向TLS来查询是否存在已创建的c++层的loop
- ALooper_prepare：创建新的loop，对应Looper::prepare()，在TLS中记录着该线程为key，loop为value的数据。
- ALooper_acquire: 获取loop的引用，对应looper->incStrong()，也就是将引用计数加1；


#### 2.6.2 timerfd_create
[-> flutter/fml/platform/linux/timerfd.cc]

```Java
int timerfd_create(int clockid, int flags) {
  return syscall(__NR_timerfd_create, clockid, flags);
}
```

通过系统调用来创建timerfd

### 2.7 TaskRunner初始化
[-> flutter/fml/task_runner.cc]

```Java
TaskRunner::TaskRunner(fml::RefPtr<MessageLoopImpl> loop)
    : loop_(std::move(loop)) {}
```

执行到这里，便完成了MessageLoop的初始化，回到小节2.2，接下来执行Run()方法。

### 2.8 MessageLoopAndroid::Run
[-> flutter/fml/platform/android/message_loop_android.cc]

```Java
void MessageLoopAndroid::Run() {
  running_ = true;

  while (running_) {
    int result = ::ALooper_pollOnce(-1,       // infinite timeout
                                    nullptr,  // out fd,
                                    nullptr,  // out events,
                                    nullptr   // out data
    );
    if (result == ALOOPER_POLL_TIMEOUT || result == ALOOPER_POLL_ERROR) {
      // 处理使用ALooper API终止循环的情况
      running_ = false;
    }
  }
}
```

该线程处于pollOnce轮询等待的状态。


## 三、生产Dart层Microtask

对于Dart框架层可调用scheduleMicrotask()方法是用于向Microtask Queue中添加task，接着从该方法说起。

### 3.1 scheduleMicrotask
[-> third_party/dart/sdk/lib/async/schedule_microtask.dart]

```Java
void scheduleMicrotask(void callback()) {
  _Zone currentZone = Zone.current;
  if (identical(_rootZone, currentZone)) {
    //rootZone [见小节3.2]
    _rootScheduleMicrotask(null, null, _rootZone, callback);
    return;
  }
  _ZoneFunction implementation = currentZone._scheduleMicrotask;
  if (identical(_rootZone, implementation.zone) &&
      _rootZone.inSameErrorZone(currentZone)) {
    _rootScheduleMicrotask(
        null, null, currentZone, currentZone.registerCallback(callback));
    return;
  }
  Zone.current.scheduleMicrotask(Zone.current.bindCallbackGuarded(callback));
}
```

此处以rootZone为例来展开说明

### 3.2 \_rootScheduleMicrotask
[-> third_party/dart/sdk/lib/async/zone.dart]

```Java
void _rootScheduleMicrotask(
    Zone self, ZoneDelegate parent, Zone zone, void f()) {
  if (!identical(_rootZone, zone)) {
    bool hasErrorHandler = !_rootZone.inSameErrorZone(zone);
    if (hasErrorHandler) {
      f = zone.bindCallbackGuarded(f);
    } else {
      f = zone.bindCallback(f);
    }
    zone = _rootZone;
  }
  _scheduleAsyncCallback(f); // [见小节3.3]
}
```

### 3.3 \_scheduleAsyncCallback
[-> third_party/dart/sdk/lib/async/schedule_microtask.dart]

```Java
void _scheduleAsyncCallback(_AsyncCallback callback) {
  _AsyncCallbackEntry newEntry = new _AsyncCallbackEntry(callback);
  if (_nextCallback == null) {
    //当链表为空，则设置当前回调Entry为链表的头部
    _nextCallback = _lastCallback = newEntry;
    if (!_isInCallbackLoop) {
      // [见小节3.4]
      _AsyncRun._scheduleImmediate(_startMicrotaskLoop);
    }
  } else {
    //当链表不为空，则插入链表的尾部
    _lastCallback.next = newEntry;
    _lastCallback = newEntry;
  }
}

class _AsyncRun {
  //[见小节3.3.1]
  external static void _scheduleImmediate(void callback());
}
```

采用一个单向链表来记录callback回调实体，其中_nextCallback是链表头部，_lastCallback是链表尾部；此处的\_scheduleImmediate最终会调用到dart runtime中的schedule_microtask_patch.dart文件。

### 3.4 \_scheduleImmediate
[-> third_party/dart/runtime/lib/schedule_microtask_patch.dart]

```Java
class _AsyncRun {
  static void _scheduleImmediate(void callback()) {
    _ScheduleImmediate._closure(callback); //[见小节3.4.1]
  }
}

typedef void _ScheduleImmediateClosure(void callback());

class _ScheduleImmediate {
  static _ScheduleImmediateClosure _closure;
}
```

对于_ScheduleImmediate._closure的赋值过程，是在引擎启动的过程。

#### 3.4.1 InitDartAsync
在引擎启动过程会创建RootIsolate，有如下调用链：

    DartIsolate::CreateRootIsolate
      DartIsolate::CreateDartVMAndEmbedderObjectPair
        DartIsolate::LoadLibraries
          DartRuntimeHooks::Install
            flutter::InitDartAsync

再来看看InitDartAsync的实现过程，如下所示。

[-> flutter/lib/ui/dart_runtime_hooks.cc]

```Java
static void InitDartAsync(Dart_Handle builtin_library, bool is_ui_isolate) {
  Dart_Handle schedule_microtask;
  if (is_ui_isolate) {
    schedule_microtask = GetFunction(builtin_library, "_getScheduleMicrotaskClosure");
  } else {
    ...
  }
  Dart_Handle async_library = Dart_LookupLibrary(ToDart("dart:async"));
  Dart_Handle set_schedule_microtask = ToDart("_setScheduleImmediateClosure");
  Dart_Handle result = Dart_Invoke(async_library, set_schedule_microtask, 1,
                                   &schedule_microtask);
  PropagateIfError(result);
}
```

可见此处会调用schedule_microtask_patch.dart的_setScheduleImmediateClosure()。

```Java
@pragma("vm:entry-point", "call")
void _setScheduleImmediateClosure(_ScheduleImmediateClosure closure) {
  _ScheduleImmediate._closure = closure;
}
```

可见，经过InitDartAsync()方法，将_getScheduleMicrotaskClosure赋值给_closure。那么前面小节[3.3.1]便开始执行_getScheduleMicrotaskClosure()方法。

#### 3.4.2 \_getScheduleMicrotaskClosure
[-> flutter/lib/ui/natives.dart]

```Java
@pragma('vm:entry-point')
Function _getScheduleMicrotaskClosure() => _scheduleMicrotask;

void _scheduleMicrotask(void callback()) native 'ScheduleMicrotask'; //[见小节3.5]
```

### 3.5 ScheduleMicrotask
[-> flutter/lib/ui/dart_runtime_hooks.cc]

```Java
void ScheduleMicrotask(Dart_NativeArguments args) {
  Dart_Handle closure = Dart_GetNativeArgument(args, 0);
  UIDartState::Current()->ScheduleMicrotask(closure); //[见小节3.6]
}
```

此处的参数closure便是[小节3.3]中的_startMicrotaskLoop。

### 3.6 UIDartState::ScheduleMicrotask
[-> flutter/lib/ui/ui_dart_state.cc]

```Java
void UIDartState::ScheduleMicrotask(Dart_Handle closure) {
  microtask_queue_.ScheduleMicrotask(closure); //[见小节3.7]
}
```

### 3.7 DartMicrotaskQueue::ScheduleMicrotask
[-> third_party/tonic/dart_microtask_queue.cc]

```Java
void DartMicrotaskQueue::ScheduleMicrotask(Dart_Handle callback) {
  queue_.emplace_back(DartState::Current(), callback);
}
```

queue_的类型为MicrotaskQueue，记录着所有的DartState所对应的Dart_Handle回调方法的队列。由前面可知，此处callback为_startMicrotaskLoop()方法。


对于Microtask任务：

- UIDartState::ScheduleMicrotask会向队列中添加Microtask任务，添加后并不会唤醒目标线程；
- UIDartState::FlushMicrotasksNow则会一次性消费掉全部的Microtask微任务。

## 四、生产引擎层Task

在Flutter引擎层会看到有不少TaskRunner::PostTask()的使用地方，如下所示。

```Java
void Animator::RequestFrame(bool regenerate_layer_tree) {
  ...
  task_runners_.GetUITaskRunner()->PostTask([self = weak_factory_.GetWeakPtr(),
                                             frame_number = frame_number_]() {
    self->AwaitVSync();
  });
}
```

### 4.1 TaskRunner::PostTask
[-> flutter/fml/task_runner.cc]

```Java
void TaskRunner::PostTask(fml::closure task) {
  //[见小节4.2]
  loop_->PostTask(std::move(task), fml::TimePoint::Now());
}

void TaskRunner::PostTaskForTime(fml::closure task,
                                 fml::TimePoint target_time) {
  loop_->PostTask(std::move(task), target_time);
}

void TaskRunner::PostDelayedTask(fml::closure task, fml::TimeDelta delay) {
  loop_->PostTask(std::move(task), fml::TimePoint::Now() + delay);
}
```

方法说明；

- PostTask：立刻执行的任务；
- PostTaskForTime：指定时间来执行的任务；
- PostDelayedTask：延迟一段时间来执行的任务；

### 4.2 MessageLoopImpl::PostTask
[-> flutter/fml/message_loop_impl.cc]

```Java
void MessageLoopImpl::PostTask(fml::closure task, fml::TimePoint target_time) {
  RegisterTask(task, target_time);
}
```


### 4.3 MessageLoopImpl::RegisterTask
[-> flutter/fml/message_loop_impl.cc]

```Java
void MessageLoopImpl::RegisterTask(fml::closure task,
                                   fml::TimePoint target_time) {
  if (terminated_) {  //消息loop已终止则结束执行
    return;
  }
  std::lock_guard<std::mutex> lock(delayed_tasks_mutex_);
  //将该任务放入delayed_tasks_队列
  delayed_tasks_.push({++order_, std::move(task), target_time});
  //在指定的时间会唤醒delayed_tasks_所在的线程[见小节4.3.1]
  WakeUp(delayed_tasks_.top().target_time);
}
```

delayed_tasks_的数据类型为DelayedTaskQueue，也就是std::priority_queue<DelayedTask, std::deque<DelayedTask>, DelayedTaskCompare>，该队列是按照执行时间的前后顺序来加入队列的，当执行时间相同则按先后顺序来执行。


```Java
struct DelayedTaskCompare {
  bool operator()(const DelayedTask& a, const DelayedTask& b) {
    return a.target_time == b.target_time ? a.order > b.order
                                          : a.target_time > b.target_time;
  }
};
```

#### 4.3.1 WakeUp
[-> flutter/fml/platform/android/message_loop_android.cc]

```Java
void MessageLoopAndroid::WakeUp(fml::TimePoint time_point) {
  bool result = TimerRearm(timer_fd_.get(), time_point); //[见小节4.3.2]
}

```

每次向延迟任务队列放入消息的同时，会设置目标时间来唤醒的操作。


#### 4.3.2 TimerRearm
[-> flutter/fml/platform/linux/timerfd.cc]

```Java
bool TimerRearm(int fd, fml::TimePoint time_point) {
  const uint64_t nano_secs = time_point.ToEpochDelta().ToNanoseconds();

  struct itimerspec spec = {};
  spec.it_value.tv_sec = (time_t)(nano_secs / NSEC_PER_SEC);
  spec.it_value.tv_nsec = nano_secs % NSEC_PER_SEC;
  spec.it_interval = spec.it_value;
  //设置定时唤醒
  int result = ::timerfd_settime(fd, TFD_TIMER_ABSTIME, &spec, nullptr);
  return result == 0;
}
```

通过系统调用__NR_timerfd_settime来设置定时唤醒。

## 五、消费任务

任务消费有两个时机：

- 帧开始绘制过程Window::BeginFrame()，会调用UIDartState::FlushMicrotasksNow()会消费Microtask；
- MessageLoop的消息循环过程，会同时消费Microtask和引擎层Task；

### 5.1 添加TaskObserver

#### 5.1.1 UIDartState初始化
[-> flutter/lib/ui/ui_dart_state.cc]

```Java
UIDartState::UIDartState(...） {
  //UIDartState对象创建时添加task observer [见小节5.1.2]
  AddOrRemoveTaskObserver(true);
}

UIDartState::~UIDartState() {
  //UIDartState对象销毁时移除task observer
  AddOrRemoveTaskObserver(false ;
}
```

#### 5.1.2 AddOrRemoveTaskObserver
[-> flutter/lib/ui/ui_dart_state.cc]

```Java
void UIDartState::AddOrRemoveTaskObserver(bool add) {
  auto task_runner = task_runners_.GetUITaskRunner();
  ...
  if (add) {
    //[见小节5.1.4]
    add_callback_(reinterpret_cast<intptr_t>(this),
                  [this]() { this->FlushMicrotasksNow(); });
  } else {
    remove_callback_(reinterpret_cast<intptr_t>(this));
  }
}
```

引擎启动的DartIsolate初始化时，会创建一个UIDartState对象，则向MessageLoop中添加一个TaskObserver，其中以当前UIDartState对象为key，以FlushMicrotasksNow()方法为value；当UIDartState对象销毁时移除task observer。 再来看看add_callback_的赋值过程，如下所示。

#### 5.1.3 FlutterMain::Init
在Flutter引擎启动时执行FlutterActivity的onCreate()过程，会调用FlutterMain::Init()方法

[-> flutter/shell/platform/android/flutter_main.cc]

```Java
void FlutterMain::Init(...) {
  ...
  //初始化observer的增加和删除方法
  settings.task_observer_add = [](intptr_t key, fml::closure callback) {
    fml::MessageLoop::GetCurrent().AddTaskObserver(key, std::move(callback));
  };

  settings.task_observer_remove = [](intptr_t key) {
    fml::MessageLoop::GetCurrent().RemoveTaskObserver(key);
  };
}
```

可见，settings的task_observer_add和task_observer_remove分别对应消息循环中的增加和移除TaskObserver的功能。


```Java
DartIsolate::DartIsolate(const Settings& settings, ...)
    : UIDartState(std::move(task_runners),
                  settings.task_observer_add,
                  settings.task_observer_remove, ...),
      ...) {
}
```

而在DartIsolate对象初始化过程，会将settings的这两个方法赋值其成员变量add_callback_和remove_callback_。
可见，add_callback_所对应的便是MessageLoopImpl::AddTaskObserver()方法，如下所示。


#### 5.1.4 AddTaskObserver
[-> flutter/fml/message_loop_impl.cc]

```Java
void MessageLoopImpl::AddTaskObserver(intptr_t key, fml::closure callback) {
  task_observers_[key] = std::move(callback);
}

void MessageLoopImpl::RemoveTaskObserver(intptr_t key) {
  task_observers_.erase(key);
}
```

task_observers_是一个map类型，以UIDartState实例对象为key，以FlushMicrotasksNow()方法为value。

说明：AddTaskObserver()过程便是向task_observers_中添加相应UIDartState的FlushMicrotasksNow()方法，用于在MessageLoop过程来消费Microtask。


### 5.2 FlushTasks
[-> flutter/fml/message_loop_impl.cc]

```Java
void MessageLoopImpl::FlushTasks(FlushType type) {
  TRACE_EVENT0("fml", "MessageLoop::FlushTasks");
  std::vector<fml::closure> invocations;

  {
    std::lock_guard<std::mutex> lock(delayed_tasks_mutex_);
    if (delayed_tasks_.empty()) {
      return;
    }

    auto now = fml::TimePoint::Now();
    //遍历整个延迟任务队列，将时间已到期的任务加入invocations
    while (!delayed_tasks_.empty()) {
      const auto& top = delayed_tasks_.top();
      if (top.target_time > now) {
        break;
      }
      invocations.emplace_back(std::move(top.task));
      delayed_tasks_.pop();
      if (type == FlushType::kSingle) {
        break;
      }
    }
    //唤醒延迟队列所在线程
    WakeUp(delayed_tasks_.empty() ? fml::TimePoint::Max()
                                  : delayed_tasks_.top().target_time);
  }
  //开始执行真正的遍历
  for (const auto& invocation : invocations) {
    invocation(); //执行已到期的任务
    for (const auto& observer : task_observers_) {
      observer.second(); //执行微任务 [见小节5.3]
    }
  }
}
```

该方法说明：

- 遍历整个延迟任务队列，将时间已到期的任务加入invocations队列
- 依次执行所有的任务
- 遍历执行所有的微任务，通前面小节[5.1]可知，此处observer.second()代表的是FlushMicrotasksNow()方法

### 5.3 FlushMicrotasksNow
[-> flutter/lib/ui/ui_dart_state.cc]

```Java
void UIDartState::FlushMicrotasksNow() {
  microtask_queue_.RunMicrotasks(); //[见小节5.4]
}
```

### 5.4 RunMicrotasks
[-> third_party/tonic/dart_microtask_queue.cc]

```Java
void DartMicrotaskQueue::RunMicrotasks() {
  while (!queue_.empty()) {
    MicrotaskQueue local;
    std::swap(queue_, local);
    for (const auto& callback : local) {
      if (auto dart_state = callback.dart_state().lock()) {
        DartState::Scope dart_scope(dart_state.get());
        //执行正在的回调方法
        Dart_Handle result = Dart_InvokeClosure(callback.value(), 0, nullptr);
        ... //异常处理
        dart_state->MessageEpilogue(result);
        if (!Dart_CurrentIsolate())
            return;
      }
    }
  }
}
```

从前面小节[3.7]可知，此处callback.value便是_startMicrotaskLoop()，接下来回调到dart层。

### 5.5 \_startMicrotaskLoop
[-> third_party/dart/sdk/lib/async/schedule_microtask.dart]

```Java
void _startMicrotaskLoop() {
  _isInCallbackLoop = true;
  try {
    _microtaskLoop();
  } finally {
    _lastPriorityCallback = null;
    _isInCallbackLoop = false;
    if (_nextCallback != null) {
      //当前面遍历，当链表不为空，则继续调度下一个微任务 [见小节3.4]
      _AsyncRun._scheduleImmediate(_startMicrotaskLoop);
    }
  }
}
```

### 5.6 \_microtaskLoop
[-> third_party/dart/sdk/lib/async/schedule_microtask.dart]

```Java
void _microtaskLoop() {
  //遍历执行所有的微任务
  while (_nextCallback != null) {
    _lastPriorityCallback = null;
    _AsyncCallbackEntry entry = _nextCallback;
    _nextCallback = entry.next;
    if (_nextCallback == null) _lastCallback = null;
    (entry.callback)();  //执行微任务的回调方法
  }
}
```

此处的callback便是前面生产MicroTask过程的小节[3.1]scheduleMicrotask()方法的参数callback。


## 六、总结

Flutter引擎启动过程，会创建UI/GPU/IO这3个线程，并且会为每个线程依次创建MessageLoop对象，启动后处于epoll_wait等待状态。对于Flutter的消息机制跟Android原生的消息机制有很多相似之处，都有消息(或者任务)、消息队列以及Looper，有一点不同的是Android有一个Handler类，用于发送消息以及执行回调方法，相对应Flutter中有着相近功能的便是TaskRunner。

消息机制采用的是生产者-消费者模型，本文介绍了两类任务：引擎层的Task和Dart层的Microtask，当然还有Future和DartVM中的消息处理，会在下一篇文章讲解。

- Task
  - MessageLoopImpl::RegisterTask()：生产Task
  - MessageLoopImpl::FlushTasks()：消费Task
- Microtask
  - scheduleMicrotask()：生成Microtask
  - Window::BeginFrame()：消费Microtask
  - MessageLoopImpl::FlushTasks()：消费Microtask

在引擎中每次消费任务时调用FlushTasks()方法，遍历整个延迟任务队列delayed_tasks_，将时间已到期的任务加入invocations，紧接着会遍历执行FlushMicrotasksNow()来消费所有的微任务。

## 附录
本文涉及到相关源码文件

```Java
flutter/shell/common/thread_host.cc
flutter/shell/platform/android/flutter_main.cc

flutter/fml/
  - thread.cc
  - task_runner.cc
  - message_loop.cc
  - message_loop_impl.cc
  - platform/android/message_loop_android.cc
  - platform/linux/timerfd.cc


flutter/lib/ui/
  - dart_runtime_hooks.cc
  - natives.dart
  - ui_dart_state.cc

third_party/dart/sdk/lib/async/schedule_microtask.dart
third_party/dart/sdk/lib/async/zone.dart
third_party/dart/runtime/lib/schedule_microtask_patch.dart
third_party/tonic/dart_microtask_queue.cc
```
