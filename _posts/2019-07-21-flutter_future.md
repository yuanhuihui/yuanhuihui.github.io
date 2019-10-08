---
layout: post
title:  "深入理解Flutter异步Future机制"
date:   2019-07-21 23:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter的Future处理机制，相关源码目录见文末附录


## 一、概述

Flutter框架层采用dart语言，在Dart中随处可见的异步代码，有大量的库函数返回的是Futrue对象，dart本身是单线程执行模型，dart应用在其主isolate执行应用的main()方法时开始运行，当main()执行完成后，主isolate所在线程再逐个处理队列中的任务，包括但不限于通过Future所创建的任务，但整个过程都运行在同一个单线程。

```Java
new Future(() => print("Hello Gityuan"));
```

这行代码中print操作便是运行在UI线程，需要注意的是如果这是一行耗时操作，则要使用独立的isolate或者worker来并行，已保证UI线程的及时响应。接下来从Flutter引擎源码角度，来讲解这一行代码的整个完整流程，先来看几张整体流程图。

#### 1.1 Future创建流程
**[Future创建流程](http://gityuan.com/img/flutter_future/future.jpg)**

![Future创建流程](http://gityuan.com/img/flutter_future/future.jpg)

图解：

- Future创建过程：
  - 创建Timer，并将\_Timer.\_handleMessage()放入到_handlerMap；
  - 对于无延迟的Future则会将该Timer加入到ZeroTimer链表尾部；
  - 创建的新端口号port和回调handler一起记得到一条新的entry，再把该entry加入到map_的第port个槽位；
  - 创建ReceivePort和SendPort对象；
- 位于isolate.cc中的RawReceivePortImpl_factory和RawReceivePortImpl_get_sendport都是native方法，是从Dart调用到C++的桥梁层；

#### 1.2 Future处理流程
**[Future发送与处理流程](http://gityuan.com/img/flutter_future/future_send.jpg)**

![Future发送与处理流程](http://gityuan.com/img/flutter_future/future_send.jpg)

图解：

- 任务发送过程：
  - 通过message记录的port值来从map_中找到handler，再通过该找到的MessageHandler来发送消息；
  - 根据message优先级，当为普通消息，则将其加入到queue_队列；当为OOB消息，则将其加入到oob_queue_队列；
  - 通过PostTask来向UI线程发送任务；
- 任务接收过程：
  - 先从oob_queue_队列中取出头部的消息，当该消息为空且接收到待处理的消息级别为普通消息，则再从queue_队列取出头部消息；
  - 通过port从_handlerMap中找到Dart层回调方法\_Timer.\_handleMessage()；
  - 再从ZeroTimer链表中添加所有时间已过期的消息以及无延迟的消息；
  - 然后回调执行真正的future中定义的业务逻辑代码。
- 位于dart_entry.cc中的DartLibraryCalls的LookupHandler和HandleMessage，是从C++调用到Dart的桥梁层；

#### 1.3 Port类图

**[Port类图](http://gityuan.com/img/flutter_future/PortModel.jpg)**

![Port类图](http://gityuan.com/img/flutter_future/PortModel.jpg)

图解：

- PortMap每次通过CreatePort()方法所创建的端口都记录在_map；
- 图中从上至下：SendPort位于isolate.dart， \_SendPortImpl位于isolate_patch.dart，C++版本的SendPort位于runtime/vm/object.cc；同样ReceivePort也是同理。

#### 1.4 MessageHandler类图

**[MessageHandler类图](http://gityuan.com/img/flutter_future/MessageHandler.jpg)**

![MessageHandler类图](http://gityuan.com/img/flutter_future/MessageHandler.jpg)

图解：

- MessageHandler位于runtime/vm/message_handler.cc
- IsolateMessageHandler位于runtime/vm/isolate.cc
- DartMessageHandler位于tonic/dart_message_handler.cc


## 二、Future创建

### 2.1 new Future
[-> third_party/dart/sdk/lib/async/future.dart]

```Java
factory Future(FutureOr<T> computation()) {
  _Future<T> result = new _Future<T>();
  //[见小节2.2]
  Timer.run(() {
    try {
      //[见小节4.8]
      result._complete(computation());
    } catch (e, s) {
      _completeWithErrorCallback(result, e, s);
    }
  });
  return result;
}
```

除了直接创建Future，还有如下方法：

- Future.delayed：指定延迟一段时间后开始执行。

### 2.2 Timer.run
[-> third_party/dart/sdk/lib/async/timer.dart]

```Java
static void run(void callback()) {
  new Timer(Duration.zero, callback);   //[见下文]
}

factory Timer(Duration duration, void callback()) {
  if (Zone.current == Zone.root) {
    return Zone.current.createTimer(duration, callback);   //[见小节2.3]
  }
  return Zone.current.createTimer(duration, Zone.current.bindCallbackGuarded(callback));
}
```

这里以RootZone为例展开来说。

### 2.3 \_RootZone.createTimer
[-> third_party/dart/sdk/lib/async/zone.dart]

```Java
class _RootZone extends _Zone {

  Timer createTimer(Duration duration, void f()) {
    return Timer._createTimer(duration, f);   //[见小节2.4]
  }
}
```

\_createTimer是timer.dart中的一个external方法，所对应的实现位于timer_patch.dart

```Java
external static Timer _createTimer(Duration duration, void callback());

```

### 2.4 Time.\_createTimer
[-> third_party/dart/runtime/lib/timer_patch.dart]

```Java
class Timer {
  @patch
  static Timer _createTimer(Duration duration, void callback()) {
    if (_TimerFactory._factory == null) {
      //采用VMLibraryHooks的timerFactory [见小节2.5]
      _TimerFactory._factory = VMLibraryHooks.timerFactory;
    }

    int milliseconds = duration.inMilliseconds;
    if (milliseconds < 0) milliseconds = 0;
    return _TimerFactory._factory(milliseconds, (_) {
      callback();
    }, false);
  }
}

class _TimerFactory {
  static _TimerFactoryClosure _factory;
}
```

_TimerFactory._factory的初始化过程是在DartIsolate::CreateRootIsolate()过程层层调用到dart_runtime_hooks.cc文件中的InitDartInternal()方法。

#### 2.4.1 InitDartInternal
[-> flutter/lib/ui/dart_runtime_hooks.cc]

```Java
static void InitDartInternal(Dart_Handle builtin_library, bool is_ui_isolate) {
  ...
  if (is_ui_isolate) {
    Dart_Handle method_name = Dart_NewStringFromCString("_setupHooks");
    result = Dart_Invoke(builtin_library, method_name, 0, NULL);
  }

  Dart_Handle setup_hooks = Dart_NewStringFromCString("_setupHooks");

  Dart_Handle io_lib = Dart_LookupLibrary(ToDart("dart:io"));
  result = Dart_Invoke(io_lib, setup_hooks, 0, NULL);

  Dart_Handle isolate_lib = Dart_LookupLibrary(ToDart("dart:isolate"));
  result = Dart_Invoke(isolate_lib, setup_hooks, 0, NULL);
  ...
}
```

此处builtin_library为“dart:ui”，该方法的功能便是执行dart:ui、dart:io、dart:isolate这3个库中的\_setupHooks()方法来设置hook插桩点。

#### 2.4.2 \_setupHooks
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
@pragma("vm:entry-point", "call")
_setupHooks() {
  VMLibraryHooks.timerFactory = _Timer._factory;
}
```

### 2.5 \_Timer.\_factory
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
class _Timer implements Timer {
  static Timer _factory(int milliSeconds, void callback(Timer timer), bool repeating) {
    if (repeating) {
      return new _Timer.periodic(milliSeconds, callback);
    }
    //[见下文]
    return new _Timer(milliSeconds, callback);
  }

  factory _Timer(int milliSeconds, void callback(Timer timer)) {
    return _createTimer(callback, milliSeconds, false);  //[见小节2.6]
  }
}
```

### 2.6 \_Timer.\_createTimer
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
static Timer _createTimer(
    void callback(Timer timer), int milliSeconds, bool repeating) {
  if (milliSeconds < 0) {
    milliSeconds = 0;
  }

  int now = VMLibraryHooks.timerMillisecondClock();
  int wakeupTime = (milliSeconds == 0) ? now : (now + 1 + milliSeconds);
  //[见小节2.6.1]
  _Timer timer = new _Timer._internal(callback, wakeupTime, milliSeconds, repeating);
  //[见小节2.7]
  timer._enqueue();  
  return timer;
}
```

#### 2.6.1 \_Timer.\_internal
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
_Timer._internal(
    this._callback, this._wakeupTime, this._milliSeconds, this._repeating)
    : _id = _nextId();
```

### 2.7 \_Timer.\_enqueue
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
void _enqueue() {
  if (_milliSeconds == 0) {
    //添加到ZeroTimer的链表尾部
    if (_firstZeroTimer == null) {
      _lastZeroTimer = this;
      _firstZeroTimer = this;
    } else {
      _lastZeroTimer._indexOrNext = this;
      _lastZeroTimer = this;
    }
    //通知[见小节2.8]
    _notifyZeroHandler();
  } else {
    _heap.add(this);
    if (_heap.isFirst(this)) {
      _notifyEventHandler();
    }
  }
}
```

对于无延迟的任务，添加到ZeroTimer的链表尾部。

### 2.8 \_Timer.\_notifyZeroHandler
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
static void _notifyZeroHandler() {
  if (_sendPort == null) {
    _createTimerHandler(); //创建定时handler[见小节2.9]
  }
  _sendPort.send(_ZERO_EVENT); //通过port发送[见小节3.1]
}
```

### 2.9 \_Timer.\_createTimerHandler
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
static void _createTimerHandler() {
   //[见小节2.10]
  _receivePort = new RawReceivePort(_handleMessage);
  //[见小节2.11]
  _sendPort = _receivePort.sendPort;
  _scheduledWakeupTime = null;
}
```

该方法的主要功能：

- 将_handleMessage保存在_handleMessage数组中；
- 创建Dart_Port端口，保存在ReceivePort中；
- 将ReceivePort的sendPort赋值给_sendPort；

### 2.10 RawReceivePort初始化
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
@patch
class RawReceivePort {
  factory RawReceivePort([Function handler]) {
   //[见小节2.10.1]
    _RawReceivePortImpl result = new _RawReceivePortImpl();
    result.handler = handler;
    return result;
  }
}
```

#### 2.10.1 \_RawReceivePortImpl初始化
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
class _RawReceivePortImpl implements RawReceivePort {
     //[见小节2.10.2]
  factory _RawReceivePortImpl() native "RawReceivePortImpl_factory";

  void set handler(Function value) {
    _handlerMap[this._get_id()] = value;
  }
}
```

#### 2.10.2 RawReceivePortImpl_factory
[-> third_party/dart/runtime/lib/isolate.cc]

```Java
DEFINE_NATIVE_ENTRY(RawReceivePortImpl_factory, 0, 1) {
  //创建port端口 [见小节2.10.3]
  Dart_Port port_id = PortMap::CreatePort(isolate->message_handler());
  //创建ReceivePort [见小节2.10.4]
  return ReceivePort::New(port_id, false);
}
```

#### 2.10.3 PortMap::CreatePort
[-> third_party/dart/runtime/vm/port.cc]

```Java
Dart_Port PortMap::CreatePort(MessageHandler* handler) {
  MutexLocker ml(mutex_);

  Entry entry;
  entry.port = AllocatePort();  //采用随机数生成一个整型的端口号
  entry.handler = handler;
  entry.state = kNewPort;

  intptr_t index = entry.port % capacity_;
  Entry cur = map_[index];
  while (cur.port != 0) {
    index = (index + 1) % capacity_;
    cur = map_[index];
  }

  if (map_[index].handler == deleted_entry_) {
    deleted_--;
  }
  map_[index] = entry;

  used_++;
  MaintainInvariants();
  return entry.port;
}
```

map_是一个记录端口entry的HashMap，每一个entry里面有端口号，handler，以及端口状态。

- 端口号port采用的是用随机数生成一个整型的端口号，
- handler是并记录handler指针；
- 端口状态state有3种类型，包括kNewPort(新分配的端口)，kLivePort(普通端口)，kControlPort(特殊控制类的端口)

创建完端口后，再回到小节[2.10.2]初始化ReceivePort。

#### 2.10.4 ReceivePort::New
[-> third_party/dart/runtime/vm/object.cc]

```Java
RawReceivePort* ReceivePort::New(Dart_Port id,
                                 bool is_control_port,
                                 Heap::Space space) {
  Thread* thread = Thread::Current();
  Zone* zone = thread->zone();
  //创初始化SendPort [见小节2.10.5]
  const SendPort& send_port =
      SendPort::Handle(zone, SendPort::New(id, thread->isolate()->origin_id()));

  ReceivePort& result = ReceivePort::Handle(zone);
  {
    RawObject* raw = Object::Allocate(ReceivePort::kClassId,
                                      ReceivePort::InstanceSize(), space);
    NoSafepointScope no_safepoint;
    result ^= raw;
    //保存send_port指针
    result.StorePointer(&result.raw_ptr()->send_port_, send_port.raw());
  }
  if (is_control_port) {
    PortMap::SetPortState(id, PortMap::kControlPort); //控制端口
  } else {
    PortMap::SetPortState(id, PortMap::kLivePort); //普通端口
  }
  return result.raw();
}
```

#### 2.10.5 SendPort::New
[-> third_party/dart/runtime/vm/object.cc]

```Java
RawSendPort* SendPort::New(Dart_Port id,
                           Dart_Port origin_id,
                           Heap::Space space) {
  SendPort& result = SendPort::Handle();
  {
    RawObject* raw = Object::Allocate(SendPort::kClassId, SendPort::InstanceSize(), space);
    NoSafepointScope no_safepoint;
    result ^= raw;
    result.StoreNonPointer(&result.raw_ptr()->id_, id);
    result.StoreNonPointer(&result.raw_ptr()->origin_id_, origin_id);
  }
  return result.raw();
}
```

此处SendPort的id便是前面通过PortMap::CreatePort()所创建的端口号。

再回到小节2.9来看看_sendPort的赋值过程。

### 2.11 \_RawReceivePortImpl.sendPort
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
class _RawReceivePortImpl implements RawReceivePort {

  SendPort get sendPort {
    return _get_sendport(); //[见下文]
  }
   //[见小节2.11.1]
  _get_sendport() native "RawReceivePortImpl_get_sendport";
}
```

从_receivePort中获取发送端口，并保存在_sendPort变量。

#### 2.11.1 RawReceivePortImpl_get_sendport
[-> third_party/dart/runtime/lib/isolate.cc]

```Java
DEFINE_NATIVE_ENTRY(RawReceivePortImpl_get_sendport, 0, 1) {
  GET_NON_NULL_NATIVE_ARGUMENT(ReceivePort, port, arguments->NativeArgAt(0));
  return port.send_port();
}
```

#### 2.11.2 ReceivePort.send_port
[-> third_party/dart/runtime/vm/object.h]

```Java
class ReceivePort : public Instance {
 public:
  RawSendPort* send_port() const { return raw_ptr()->send_port_; }
  ...

 private:
  FINAL_HEAP_OBJECT_IMPLEMENTATION(ReceivePort, Instance);
};
```

再来看看SendPort方法所所对应的类，如下所示。

#### 2.11.3 Object::Init
[-> third_party/dart/runtime/vm/object.cc]

```Java
RawError* Object::Init(Isolate* isolate,
                       const uint8_t* kernel_buffer,
                       intptr_t kernel_buffer_size) {
    ...
    Library& isolate_lib = Library::Handle(zone, Library::LookupLibrary(thread, Symbols::DartIsolate()));
    cls = Class::New<ReceivePort>();
    RegisterPrivateClass(cls, Symbols::_RawReceivePortImpl(), isolate_lib);
    pending_classes.Add(cls);

    cls = Class::New<SendPort>();
    RegisterPrivateClass(cls, Symbols::_SendPortImpl(), isolate_lib);
    pending_classes.Add(cls);
   ...
}
```

可知：

- C++层的ReceivePort类对应于 Dart层中DartIsolate库里的\_RawReceivePortImpl类；
- C++层的SendPort类对应于 Dart层中DartIsolate库里的\_SendPortImpl类；


可见，[小节2.8]的\_Timer.\_notifyZeroHandler()过程会创建_RawReceivePortImpl类型的_receivePort和_SendPortImpl类型的_sendPort，然后再通过send()发送_ZERO_EVENT消息。

## 三、任务发送

### 3.1 \_SendPortImpl.send
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
class _SendPortImpl implements SendPort {
  @pragma("vm:entry-point", "call")
  void send(var message) {
    _sendInternal(message); //[见下文]
  }

  void _sendInternal(var message) native "SendPortImpl_sendInternal_";
}
```

\_sendInternal是一个native方法

### 3.2 SendPortImpl_sendInternal_
[-> third_party/dart/runtime/lib/isolate.cc]

```Java
DEFINE_NATIVE_ENTRY(SendPortImpl_sendInternal_, 0, 2) {
  GET_NON_NULL_NATIVE_ARGUMENT(SendPort, port, arguments->NativeArgAt(0));
  GET_NON_NULL_NATIVE_ARGUMENT(Instance, obj, arguments->NativeArgAt(1));

  const Dart_Port destination_port_id = port.Id();

  if (ApiObjectConverter::CanConvert(obj.raw())) {
    //[见小节3.3]
    PortMap::PostMessage(
        new Message(destination_port_id, obj.raw(), Message::kNormalPriority));
  } else {
    ...
  }
  return Object::null();
}
```

此处消息Priority优先级有两个级别：kNormalPriority和kOOBPriority(高优先级)

#### 3.2.1 Message初始化
[-> third_party/dart/runtime/vm/message.cc]

```Java
Message::Message(Dart_Port dest_port,
                 RawObject* raw_obj,
                 Priority priority,
                 Dart_Port delivery_failure_port)
    : next_(NULL),
      dest_port_(dest_port),
      delivery_failure_port_(delivery_failure_port),
      snapshot_(reinterpret_cast<uint8_t*>(raw_obj)),
      snapshot_length_(0),
      finalizable_data_(NULL),
      priority_(priority) {
}
```

创建的消息参数有端口号port，消息内容_ZERO_EVENT，消息优先级kOOBPriority。

### 3.3 PortMap::PostMessage
[-> third_party/dart/runtime/vm/port.cc]

```Java
bool PortMap::PostMessage(Message* message, bool before_events) {
  MutexLocker ml(mutex_);
  //查询端口
  intptr_t index = FindPort(message->dest_port());
  ...
  MessageHandler* handler = map_[index].handler;
  //找到消息的handler，发送消息[见小节3.4]
  handler->PostMessage(message, before_events);
  return true;
}
```

PortMap有一个成员变量map_记录着所有的端口Entry信息，包括端口号、端口状态以及消息回调handler。

```
typedef struct {
  Dart_Port port;
  MessageHandler* handler;
  PortState state;
} Entry;
```

该handler是由PortMap::CreatePort()过程赋值的。

### 3.4 MessageHandler::PostMessage
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
void MessageHandler::PostMessage(Message* message, bool before_events) {
  Message::Priority saved_priority;
  bool task_running = true;
  {
    MonitorLocker ml(&monitor_);
    saved_priority = message->priority();
    //根据消息优先级来加入不同的消息队列[3.4.1]
    if (message->IsOOB()) {
      oob_queue_->Enqueue(message, before_events);
    } else {
      queue_->Enqueue(message, before_events);
    }
    if (paused_for_messages_) {
      ml.Notify(); //当work处于CheckIfIdleLocked检测后处于wait状态，则唤醒
    }
    message = NULL;

    if ((pool_ != NULL) && (task_ == NULL)) {
      task_ = new MessageHandlerTask(this);
      task_running = pool_->Run(task_);
    }
  }
  //调用IsolateMessageHandler对象的方法[见小节3.5]
  MessageNotify(saved_priority);
}
```

MessageHandler有两个消息队列，分别是用于记录普通消息的queue_队列和OOB消息oob_queue_队列；

- MessageHandler的成员变量pool_赋值过程是在MessageHandler::Run()方法;
- MessageHandler的成员变量task_赋值过程也是在MessageHandler::Run()或者PostMessage()方法；

可见，此处会执行pool_->Run的时机便是执行过MessageHandler::Run()方法，并且task_已经被MessageHandler::TaskCallback所消费的情况。

#### 3.4.1 MessageQueue::Enqueue
[-> third_party/dart/runtime/vm/message.cc]

```Java
void MessageQueue::Enqueue(Message* msg, bool before_events) {
  if (head_ == NULL) { //该队列没有消息
    head_ = msg;
    tail_ = msg;
  } else {
    if (!before_events) {
      //默认情况下，加到队列尾部
      tail_->next_ = msg;
      tail_ = msg;
    } else {
      //添加到队列头部
      if (head_->dest_port() != Message::kIllegalPort) {
        msg->next_ = head_;
        head_ = msg;
      } else {
        Message* cur = head_;
        while (cur->next_ != NULL) {
          //插入具有有效端口的消息的前面
          if (cur->next_->dest_port() != Message::kIllegalPort) {
            msg->next_ = cur->next_;
            cur->next_ = msg;
            return;
          }
          cur = cur->next_;
        }
        // 所有pending消息都是isolate库的控制消息，则添加到尾部
        tail_->next_ = msg;
        tail_ = msg;
      }
    }
  }
}
```

该方法主要功能是将消息插入消息队列：

- 当队列为空，则直接插入队列，否则执行下面操作
- 当before_events默认值为false，代表则插入队列尾部，否则执行下面操作
- 当队列头部是有效消息，则插入队列头部，否则执行下面操作
- 从队列头部遍历整个消息队列，直到找到有效消息则插入该消息的前面，否则执行下面操作
- 将消息插入队列尾部

#### 3.4.2 Isolate::InitIsolate
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
Isolate* Isolate::InitIsolate(...) {
  Isolate* result = new Isolate(api_flags);
  MessageHandler* handler = new IsolateMessageHandler(result);
  result->set_message_handler(handler);
  ...
}
```

在Isolate初始化过程会设置消息handler为IsolateMessageHandler。


### 3.5 IsolateMessageHandler::MessageNotify
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
#define I (isolate())

void IsolateMessageHandler::MessageNotify(Message::Priority priority) {
  if (priority >= Message::kOOBPriority) {
    //对于OOB消息，即便线程繁忙也要尽快执行
    I->ScheduleInterrupts(Thread::kMessageInterrupt);
  }
  Dart_MessageNotifyCallback callback = I->message_notify_callback();
  if (callback) {
    (*callback)(Api::CastIsolate(I)); //[见小节3.6]
  }
}
```

message_notify_callback具体是哪个callback呢？见DartIsolate::Initialize()过程

#### 3.5.1 DartIsolate::Initialize
[-> flutter/runtime/dart_isolate.cc]

```Java
bool DartIsolate::Initialize(Dart_Isolate dart_isolate, bool is_root_isolate) {
  ...
  auto* isolate_data = static_cast<std::shared_ptr<DartIsolate>*>(
    Dart_IsolateData(dart_isolate));
  //[见小节3.5.2]
  SetMessageHandlingTaskRunner(GetTaskRunners().GetUITaskRunner(),
                             is_root_isolate);
  ...
}
```

#### 3.5.2 DartIsolate::SetMessageHandlingTaskRunner
[-> flutter/runtime/dart_isolate.cc]

```Java
void DartIsolate::SetMessageHandlingTaskRunner(
    fml::RefPtr<fml::TaskRunner> runner, bool is_root_isolate) {
  //只有root isolate才会执行该过程
  if (!is_root_isolate || !runner) {
    return;
  }
  message_handling_task_runner_ = runner;

  //[见小节3.5.3]
  message_handler().Initialize([runner](std::function<void()> task) { runner->PostTask(task); });
}
```

这里需要重点注意的是，只有root isolate才会执行Initialize()过程。

#### 3.5.3 DartMessageHandler::Initialize
[-> third_party/tonic/dart_message_handler.cc]

```Java
void DartMessageHandler::Initialize(TaskDispatcher dispatcher) {
  //设置task_dispatcher_
  task_dispatcher_ = dispatcher;
  //设置message_notify_callback
  Dart_SetMessageNotifyCallback(MessageNotifyCallback);
}
```

由此可见：

- task_dispatcher_值等价于UITaskRunner->PostTask()，执行的是向UI线程PostTask的操作；
- message_notify_callback值等价于DartMessageHandler::MessageNotifyCallback；


### 3.6 DartMessageHandler::MessageNotifyCallback
[-> third_party/tonic/dart_message_handler.cc]

```Java
void DartMessageHandler::MessageNotifyCallback(Dart_Isolate dest_isolate) {
  auto dart_state = DartState::From(dest_isolate);
   //[见小节3.7]
  dart_state->message_handler().OnMessage(dart_state);
}
```

此处message_handler()赋值过程是在DartState初始化时机，如下所示。

#### 3.6.1 DartState
[-> third_party/tonic/dart_state.cc]

```Java
DartState::DartState(int dirfd, std::function<void(Dart_Handle)> message_epilogue)
    : isolate_(nullptr),
      class_library_(new DartClassLibrary),
      message_handler_(new DartMessageHandler()),
      file_loader_(new FileLoader(dirfd)),
      message_epilogue_(message_epilogue),
      has_set_return_code_(false) {}
```

DartIsolate间接继承于DartState，在DartIsolate初始化过程会调用DartState的初始化。故message_handler()所对应的便是DartMessageHandler对象。

### 3.7 DartMessageHandler::OnMessage
[-> third_party/tonic/dart_message_handler.cc]

```Java
void DartMessageHandler::OnMessage(DartState* dart_state) {
  auto task_dispatcher_ = dart_state->message_handler().task_dispatcher_;

  auto weak_dart_state = dart_state->GetWeakPtr();
  //[见小节3.8]
  task_dispatcher_([weak_dart_state]() {
    if (auto dart_state = weak_dart_state.lock()) {
      dart_state->message_handler().OnHandleMessage(dart_state.get());
    }
  });
}
```

关于task_dispatcher_的赋值过程，前面[小节3.5.3]已说明，等价于UITaskRunner->PostTask()。

### 3.8 TaskRunner::PostTask
[-> flutter/fml/task_runner.cc]

```Java
void TaskRunner::PostTask(fml::closure task) {
  loop_->PostTask(std::move(task), fml::TimePoint::Now());
}
```

从[小节3.5.2]可知，future的send过程最终是将Task放入到UI线程，再由[深入理解Flutter消息机制](http://gityuan.com/2019/07/20/flutter_message_loop/)的[小节4.1]可知最终会向delayed_tasks_中添加一个task。


## 四、任务接收

前面小节[3.8] DartMessageHandler::OnMessage过程，会通过UITaskRunner->PostTask()向UI线程post一个任务，该任务是OnHandleMessage()方法。

### 4.1 DartMessageHandler::OnHandleMessage
[-> third_party/tonic/dart_message_handler.cc]

```Java
void DartMessageHandler::OnHandleMessage(DartState* dart_state) {
  ...
  DartIsolateScope scope(dart_state->isolate());
  DartApiScope dart_api_scope;
  Dart_Handle result = Dart_Null();
  bool error = false;

  if (!handled_first_message()) {
    ... //当触发第一个消息时，检查是否需要暂停isoale启动
  }

  if (Dart_IsPausedOnStart()) {
    ...
  } else if (Dart_IsPausedOnExit()) {
    ...
  } else {
    result = Dart_HandleMessage();  //[见小节4.2]
    ...
  }
  ...
}
```

### 4.2 Dart_HandleMessage
[-> third_party/dart/runtime/vm/dart_api_impl.cc]

```Java
DART_EXPORT Dart_Handle Dart_HandleMessage() {
  Thread* T = Thread::Current();
  Isolate* I = T->isolate();

  TransitionNativeToVM transition(T);
   //[见小节4.3]
  if (I->message_handler()->HandleNextMessage() != MessageHandler::kOK) {
    return Api::NewHandle(T, T->StealStickyError());
  }
  return Api::Success();
}
```

### 4.3 MessageHandler::HandleNextMessage
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
MessageHandler::MessageStatus MessageHandler::HandleNextMessage() {
  MonitorLocker ml(&monitor_);
  return HandleMessages(&ml, true, false); //[见下文]
}

MessageHandler::MessageStatus MessageHandler::HandleMessages(
    MonitorLocker* ml,
    bool allow_normal_messages,
    bool allow_multiple_normal_messages) {
  StartIsolateScope start_isolate(isolate());

  MessageStatus max_status = kOK;
  Message::Priority min_priority =
      ((allow_normal_messages && !paused()) ? Message::kNormalPriority
                                            : Message::kOOBPriority);
  //[见小节4.3.1]
  Message* message = DequeueMessage(min_priority);
  while (message != NULL) {
    intptr_t message_len = message->Size();
    ml->Exit();
    Message::Priority saved_priority = message->priority();
    Dart_Port saved_dest_port = message->dest_port();
    //[见小节4.4]
    MessageStatus status = HandleMessage(message);
    if (status > max_status) {
      max_status = status;
    }
    message = NULL;
    ml->Enter();
    ...

    //有时候只允许处理一个普通消息则需要退出，当然此处可以处理多个OOB消息是没问题的
    if ((saved_priority == Message::kNormalPriority) &&
        !allow_multiple_normal_messages) {
      // 已处理一个普通消息，则不再允许
      allow_normal_messages = false;
    }

    //重新评估最低允许优先级。 可能发生错误、不再允许处理普通消息、或者处于暂停状态，但都不影响OOB消息的执行
    min_priority = (((max_status == kOK) && allow_normal_messages && !paused())
                        ? Message::kNormalPriority
                        : Message::kOOBPriority);
    //取出下一个消息[见小节4.3.1]
    message = DequeueMessage(min_priority);
  }
  return max_status;
}
```

由小节3.4.2，可知调用的是IsolateMessageHandler类的HandleMessage()。

#### 4.3.1 MessageHandler::DequeueMessage
[-> third_party/dart/runtime/vm/message_handler.cc]

```Java
Message* MessageHandler::DequeueMessage(Message::Priority min_priority)
  //从oob消息队列头部取出一个消息[见小节4.3.2]
  Message* message = oob_queue_->Dequeue();
  //当oob消息队列为空，则从普通消息队列取出一条消息
  if ((message == NULL) && (min_priority < Message::kOOBPriority)) {
    message = queue_->Dequeue();
  }
  return message;
}
```

message在执行send过程会填充目标端口port信息，见[小节3.2.1]所示。

#### 4.3.2 MessageQueue::Dequeue
[-> third_party/dart/runtime/vm/message.cc]

```Java
Message* MessageQueue::Dequeue() {
  //从头部取出消息
  Message* result = head_;
  if (result != NULL) {
    head_ = result->next_;
    if (head_ == NULL) {
      tail_ = NULL;
    }
    return result;
  }
  return NULL;
}
```
### 4.4 IsolateMessageHandler::HandleMessage
[-> third_party/dart/runtime/vm/isolate.cc]

```Java
MessageHandler::MessageStatus IsolateMessageHandler::HandleMessage(
    Message* message) {
  Thread* thread = Thread::Current();
  StackZone stack_zone(thread);
  Zone* zone = stack_zone.GetZone();
  HandleScope handle_scope(thread);

  //如果消息在带内，则查找要分派的处理程序。如果端口关闭，则删除该消息而不对其反序列化。
  Object& msg_handler = Object::Handle(zone);
  if (!message->IsOOB() && (message->dest_port() != Message::kIllegalPort)) {
    //[见小节4.4.1]
    msg_handler = DartLibraryCalls::LookupHandler(message->dest_port());
    ...
  }
  ...

  MessageStatus status = kOK;
  if (message->IsOOB()) {
    if (msg.IsArray()) {
      const Array& oob_msg = Array::Cast(msg);
      if (oob_msg.Length() > 0) {
        const Object& oob_tag = Object::Handle(zone, oob_msg.At(0));
        if (oob_tag.IsSmi()) {
          switch (Smi::Cast(oob_tag).Value()) {
            case Message::kServiceOOBMsg: {
              if (FLAG_support_service) {
                //Service OOB消息
                const Error& error = Error::Handle(Service::HandleIsolateMessage(I, oob_msg));
                ...
              }
              break;
            }
            case Message::kIsolateLibOOBMsg: {
              // Isolate库的OOB消息
              const Error& error = Error::Handle(HandleLibMessage(oob_msg));
              ...
              break;
            }
          }
        }
      }
    }
  } else if (message->dest_port() == Message::kIllegalPort) {
    if (msg.IsArray()) {
      const Array& msg_arr = Array::Cast(msg);
      if (msg_arr.Length() > 0) {
        const Object& oob_tag = Object::Handle(zone, msg_arr.At(0));
        if (oob_tag.IsSmi() &&
            (Smi::Cast(oob_tag).Value() == Message::kDelayedIsolateLibOOBMsg)) {
          //延迟的Isolate库的OOB消息
          const Error& error = Error::Handle(HandleLibMessage(msg_arr));
          ...
        }
      }
    }
  } else {
    //普通消息执行[见小节4.5]
    const Object& result = Object::Handle(zone, DartLibraryCalls::HandleMessage(msg_handler, msg));
    ...
  }
  delete message;
  return status;
}
```

该方法说明：

- 服务类型的OOB消息，则执行Service::HandleIsolateMessage
- Isolate库或者延迟的Isolate库消息，则执行IsolateMessageHandler::HandleLibMessage
- 普通消息，则执行DartLibraryCalls::HandleMessage

#### 4.4.1 DartLibraryCalls::LookupHandler
[-> third_party/dart/runtime/vm/dart_entry.cc]

```Java
RawObject* DartLibraryCalls::LookupHandler(Dart_Port port_id) {
  Thread* thread = Thread::Current();
  Zone* zone = thread->zone();
  Function& function = Function::Handle(
      zone, thread->isolate()->object_store()->lookup_port_handler());
  const int kTypeArgsLen = 0;
  const int kNumArguments = 1;
  if (function.IsNull()) {
    Library& isolate_lib = Library::Handle(zone, Library::IsolateLibrary());
    const String& class_name = String::Handle(
        zone, isolate_lib.PrivateName(Symbols::_RawReceivePortImpl()));
    const String& function_name = String::Handle(
        zone, isolate_lib.PrivateName(Symbols::_lookupHandler()));
    //从_RawReceivePortImpl类中的_lookupHandler()方法
    function = Resolver::ResolveStatic(isolate_lib, class_name, function_name,
                                       kTypeArgsLen, kNumArguments,
                                       Object::empty_array());
    thread->isolate()->object_store()->set_lookup_port_handler(function);
  }
  const Array& args = Array::Handle(zone, Array::New(kNumArguments));
  //参数为端口号
  args.SetAt(0, Integer::Handle(zone, Integer::New(port_id)));
  //调用function方法 [见小节4.4.2]
  const Object& result = Object::Handle(zone, DartEntry::InvokeFunction(function, args));
  return result.raw();
}
```

根据端口号port_id来找到相应的handler。

#### 4.4.2 \_RawReceivePortImpl.\_lookupHandler
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
class _RawReceivePortImpl implements RawReceivePort {

  @pragma("vm:entry-point", "call")
  static _lookupHandler(int id) {
    var result = _handlerMap[id];
    return result;
  }
}
```

从前面小节[2.9]可知，\_handlerMap中取出的便是_handleMessage。

### 4.5 DartLibraryCalls::HandleMessage
[-> third_party/dart/runtime/vm/dart_entry.cc]

```Java
RawObject* DartLibraryCalls::HandleMessage(const Object& handler,
                                           const Instance& message) {
  Thread* thread = Thread::Current();
  Zone* zone = thread->zone();
  Isolate* isolate = thread->isolate();
  Function& function = Function::Handle(
      zone, isolate->object_store()->handle_message_function());
  const int kTypeArgsLen = 0;
  const int kNumArguments = 2;
  if (function.IsNull()) {
    Library& isolate_lib = Library::Handle(zone, Library::IsolateLibrary());
    const String& class_name = String::Handle(
        zone, isolate_lib.PrivateName(Symbols::_RawReceivePortImpl()));
    const String& function_name = String::Handle(
        zone, isolate_lib.PrivateName(Symbols::_handleMessage()));
    //从_RawReceivePortImpl类中的_handleMessage()方法
    function = Resolver::ResolveStatic(isolate_lib, class_name, function_name,
                                       kTypeArgsLen, kNumArguments,
                                       Object::empty_array());
    isolate->object_store()->set_handle_message_function(function);
  }
  const Array& args = Array::Handle(zone, Array::New(kNumArguments));
  //
  args.SetAt(0, handler);
  args.SetAt(1, message);
  //调用function方法 [见小节4.5.2]
  const Object& result = Object::Handle(zone, DartEntry::InvokeFunction(function, args));
  return result.raw();
}
```

#### 4.5.2 \_RawReceivePortImpl.\_handleMessage
[-> third_party/dart/runtime/lib/isolate_patch.dart]

```Java
static void _handleMessage(Function handler, var message) {
  //[见小节4.6]
  handler(message);
  _runPendingImmediateCallback();
}
```

通过LookupHandler找到的handler为timer_impl.dart中的\_handleMessage()方法，赋值过程见小节[2.9]。

### 4.6 \_Timer.\_handleMessage
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
static void _handleMessage(msg) {
  var pendingTimers;
  if (msg == _ZERO_EVENT) {
    pendingTimers = _queueFromZeroEvent(); //非延迟队列[见小节4.6.1]
  } else {
    _scheduledWakeupTime = null;
    pendingTimers = _queueFromTimeoutEvent(); //延迟队列
  }
  _runTimers(pendingTimers); //[见小节4.7]
  _notifyEventHandler();
}
```

#### 4.6.1 \_Timer.\_queueFromZeroEvent
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
static List _queueFromZeroEvent() {
  var pendingTimers = new List();

  var timer;
  //收集pending timers所有过期的timer
  while (!_heap.isEmpty && (_heap.first._compareTo(_firstZeroTimer) < 0)) {
    timer = _heap.removeFirst();
    pendingTimers.add(timer);
  }
  //添加第一个无延迟的timer
  timer = _firstZeroTimer;
  _firstZeroTimer = timer._indexOrNext;
  timer._indexOrNext = null;
  pendingTimers.add(timer);
  return pendingTimers;
}
```

### 4.7 \_Timer.\_runTimers
[-> third_party/dart/runtime/lib/timer_impl.dart]

```Java
static void _runTimers(List pendingTimers) {
  ...
  _handlingCallbacks = true;
  var i = 0;
  try {
    for (; i < pendingTimers.length; i++) {
      var timer = pendingTimers[i];
      timer._indexOrNext = null;

      if (timer._callback != null) {
        //从[小节2.6.1]可知此处_callback便是真正业务逻辑需要执行的方法
        var callback = timer._callback;
        if (!timer._repeating) {
          timer._callback = null;
        } else if (timer._milliSeconds > 0) {
          var ms = timer._milliSeconds;
          int overdue =
              VMLibraryHooks.timerMillisecondClock() - timer._wakeupTime;
          if (overdue > ms) {
            int missedTicks = overdue ~/ ms;
            timer._wakeupTime += missedTicks * ms;
            timer._tick += missedTicks;
          }
        }
        timer._tick += 1;

        callback(timer);  //执行真正的业务回调[见小节4.8]
        //重复的timer再次插入队列
        if (timer._repeating && (timer._callback != null)) {
          timer._advanceWakeupTime();
          timer._enqueue();
        }
        //执行pending micro tasks，来自_pendingImmediateCallback
        var immediateCallback = _removePendingImmediateCallback();
        if (immediateCallback != null) {
          immediateCallback();
        }
      }
    }
  } finally {
    _handlingCallbacks = false;
    for (i++; i < pendingTimers.length; i++) {
      var timer = pendingTimers[i];
      timer._enqueue();
    }
    _notifyEventHandler();
  }
}
```

经过复杂的调用，callback所对应的是[小节2.1]的回调方法_complete()。

### 4.8 \_Future.\_complete
[-> third_party/dart/sdk/lib/async/future_impl.dart]

```Java
class _Future<T> implements Future<T> {
  final Zone _zone;
  _Future() : _zone = Zone.current;

  void _complete(FutureOr<T> value) {
    if (value is Future<T>) {
      if (value is _Future<T>) {
        _chainCoreFuture(value, this);
      } else {
        _chainForeignFuture(value, this);
      }
    } else {
      _FutureListener listeners = _removeListeners();
      _setValue(value);
      _propagateToListeners(this, listeners); //处理相应方法
    }
  }
}
```

回到执行业务自定义的Future方法内容。

## 五、总结

Future的整个执行过程主要工作：

- Future创建过程：
  - 创建Timer，并将\_Timer.\_handleMessage()放入到_handlerMap；
  - 对于无延迟的Future则会将该Timer加入到ZeroTimer链表尾部；
  - 创建的新端口号port和回调handler一起记得到一条新的entry，再把该entry加入到map_的第port个槽位；
  - 创建ReceivePort和SendPort对象；
- 任务发送过程：
  - 通过message记录的port值来从map_中找到handler，再通过该找到的MessageHandler来发送消息；
  - 根据message优先级，当为普通消息，则将其加入到queue_队列；当为OOB消息，则将其加入到oob_queue_队列；
  - 通过PostTask来向UI线程发送任务；
- 任务接收过程：
  - 先从oob_queue_队列中取出头部的消息，当该消息为空且接收到待处理的消息级别为普通消息，则再从queue_队列取出头部消息；
  - 通过port从_handlerMap中找到Dart层回调方法\_Timer.\_handleMessage()；
  - 再从ZeroTimer链表中添加所有时间已过期的消息以及无延迟的消息；
  - 然后回调执行真正的future中定义的业务逻辑代码。

这里有一个主要注意的地方，那就是Future操作只是异步执行，不会阻塞本次在UI线程的执行，但是其执行关键点[小节3.7]中通过TaskRunner::PostTask()将Task放入UI线程，那么意味着如果Future内存在耗时操作依然是影响UI线程的后续渲染绘制流畅度，所以说对于开发者不能在Future中做耗时操作。如果要做耗时操作，为保证应用的及时响应，应该将任务放到独立线程的isolate或者worker。


## 附录
本文涉及到相关源码文件

```Java

third_party/dart/sdk/lib/async/
  - future.dart
  - zone.dart
  - timer.dart
  - future_impl.dart

third_party/dart/runtime/lib/
  - isolate.cc
  - isolate_patch.dart
  - timer_impl.dart
  - timer_patch.dart

third_party/dart/runtime/vm/
  - isolate.cc
  - port.cc
  - dart_api_impl.cc
  - dart_entry.cc
  - message_handler.cc
  - message.cc
  - object.cc

flutter/lib/ui/dart_runtime_hooks.cc
flutter/runtime/dart_isolate.cc
third_party/tonic/dart_message_handler.cc
```
