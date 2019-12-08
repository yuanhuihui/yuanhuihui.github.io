---
layout: post
title:  "ServiceIsolate工作原理"
date:   2019-10-12 22:15:40
catalog:  true
tags:
    - flutter

---

## 一、概述

在前面文章[深入理解Dart虚拟机启动](http://gityuan.com/2019/06/23/dart-vm/)中，有讲到Dart虚拟机中有一个比较重要的isolate，创建的isolate名为”vm-service”，运行在独立的线程，也就是ServiceIsolate，这是用于系统调试相关功能的一个isolate，提供虚拟机相关服务，比如hot reload，timeline等。这里先来看看ServiceIsolate的启动过程以及监听处理流程。

## 二、启动ServiceIsolate

在dart虚拟机启动过程，会执行Dart::Init()操作，该过程中初始化timeline以及在线程池中启动ServiceIsolate。

### 2.1 Dart::Init
[-> third_party/dart/runtime/vm/dart.cc]

```Java
char* Dart::Init(Dart_IsolateCreateCallback create,
                 Dart_IsolateShutdownCallback shutdown,
                 Dart_IsolateCleanupCallback cleanup,
                 Dart_ThreadExitCallback thread_exit,
                 ...) {
  ...
#if defined(SUPPORT_TIMELINE)
  Timeline::Init();
  TimelineDurationScope tds(Timeline::GetVMStream(), "Dart::Init");
  TimelineDurationScope tds(Timeline::GetVMStream(), "ReadVMSnapshot");
  TimelineDurationScope tds(Timeline::GetVMStream(), "FinalizeVMIsolate");
#endif

  Isolate::SetCreateCallback(create);
  Isolate::SetShutdownCallback(shutdown);
  Isolate::SetCleanupCallback(cleanup);
  const bool is_dart2_aot_precompiler = FLAG_precompiled_mode && !kDartPrecompiledRuntime;
  if (!is_dart2_aot_precompiler &&
      (FLAG_support_service || !kDartPrecompiledRuntime)) {
    ServiceIsolate::Run();  //[见小节]
  }
  ...
}
```

启动ServiceIsolate的条件，需要满足以下两者之一：

- 当kDartPrecompiledRuntime = true，且FLAG_support_service = true；
- 当kDartPrecompiledRuntime = false，且FLAG_precompiled_mode = false；


再来看一看DartVM初始化过程

```Java
DartVM::DartVM(std::shared_ptr<const DartVMData> vm_data,
               std::shared_ptr<IsolateNameServer> isolate_name_server) {
    ...
    TRACE_EVENT0("flutter", "Dart_Initialize");
    Dart_InitializeParams params = {};
    params.create = reinterpret_cast<decltype(params.create)>(
    DartIsolate::DartIsolateCreateCallback);
    params.shutdown = reinterpret_cast<decltype(params.shutdown)>(
    DartIsolate::DartIsolateShutdownCallback);
    params.cleanup = reinterpret_cast<decltype(params.cleanup)>(
    DartIsolate::DartIsolateCleanupCallback);
    params.thread_exit = ThreadExitCallback;
    ...
}
```

可见，ServiceIsolate的创建callback方法是指DartIsolate::DartIsolateCreateCallback()，后面会用到这个信息。

### 2.2 ServiceIsolate::Run
[-> third_party/dart/runtime/vm/service_isolate.cc]

```Java
void ServiceIsolate::Run() {
  {
    MonitorLocker ml(monitor_);
    state_ = kStarting;
    ml.NotifyAll();
  }
  //将任务交给线程池中的worker线程来执行任务[见小节]
  bool task_started = Dart::thread_pool()->Run(new RunServiceTask());
}
```

将RunServiceTask任务交给线程池中的worker线程来执行任务，过程会创建创建名为“vm-service”的isolate。

### 2.3 RunServiceTask
[-> third_party/dart/runtime/vm/service_isolate.cc]

```Java
class RunServiceTask : public ThreadPool::Task {
 public:
  virtual void Run() {
    char* error = NULL;
    Isolate* isolate = NULL;

    Dart_IsolateCreateCallback create_callback =
        ServiceIsolate::create_callback();

    Dart_IsolateFlags api_flags;
    Isolate::FlagsInitialize(&api_flags);
    //创建ServiceIsolate [见小节2.3]
    isolate = reinterpret_cast<Isolate*>(
        create_callback(ServiceIsolate::kName, ServiceIsolate::kName, NULL,
                        NULL, &api_flags, NULL, &error));


    bool got_unwind;
    {
      StartIsolateScope start_scope(isolate);
      //[见小节2.4]
      got_unwind = RunMain(isolate);
    }
    ...
    isolate->message_handler()->Run(Dart::thread_pool(), NULL, ShutdownIsolate,
                                    reinterpret_cast<uword>(isolate));
  }
```

此处的create_callback便是DartIsolate::DartIsolateCreateCallback，如下所示。

#### 2.3.1 DartIsolateCreateCallback
[-> flutter/runtime/dart_isolate.cc]

```Java
Dart_Isolate DartIsolate::DartIsolateCreateCallback(
    const char* advisory_script_uri,
    const char* advisory_script_entrypoint,
    const char* package_root,
    const char* package_config,
    Dart_IsolateFlags* flags,
    std::shared_ptr<DartIsolate>* parent_embedder_isolate,
    char** error) {
  if (parent_embedder_isolate == nullptr &&
      strcmp(advisory_script_uri, DART_VM_SERVICE_ISOLATE_NAME) == 0) {
    return DartCreateAndStartServiceIsolate(package_root,package_config,  
                                            flags, error
    );
  }
  ...
}
```

此处DART_VM_SERVICE_ISOLATE_NAME就是"vm-service"。

```Java
Dart_Isolate DartIsolate::DartCreateAndStartServiceIsolate(
    const char* package_root,
    const char* package_config,
    Dart_IsolateFlags* flags,
    char** error) {
  auto vm_data = DartVMRef::GetVMData();

  const auto& settings = vm_data->GetSettings();

  if (!settings.enable_observatory) {
    return nullptr;
  }

  TaskRunners null_task_runners("io.flutter." DART_VM_SERVICE_ISOLATE_NAME,
                                nullptr, nullptr, nullptr, nullptr);

  flags->load_vmservice_library = true;

  std::weak_ptr<DartIsolate> weak_service_isolate =
      DartIsolate::CreateRootIsolate(
          vm_data->GetSettings(),         // settings
          vm_data->GetIsolateSnapshot(),  // isolate snapshot
          vm_data->GetSharedSnapshot(),   // shared snapshot
          null_task_runners,              // task runners
          nullptr,                        // window
          {},                             // snapshot delegate
          {},                             // IO Manager
          DART_VM_SERVICE_ISOLATE_NAME,   // script uri
          DART_VM_SERVICE_ISOLATE_NAME,   // script entrypoint
          flags                           // flags
      );


  tonic::DartState::Scope scope(service_isolate);
  //[见小节2.3.2]
  if (!DartServiceIsolate::Startup(
          settings.ipv6 ? "::1" : "127.0.0.1",  // server IP address
          settings.observatory_port,            // server observatory port
          tonic::DartState::HandleLibraryTag,   // embedder library tag handler
          false,  //  disable websocket origin check
          settings.disable_service_auth_codes,  // disable VM service auth codes
          error                                 // error (out)
          )) {
    return nullptr;
  }
  ...
  return service_isolate->isolate();
}
```

- 可通过settings.enable_observatory来决定是否开启observatory的isolate；
- 启动ip为127.0.0.1的服务；


#### 2.3.2 DartServiceIsolate::Startup
[-> flutter/runtime/dart_service_isolate.cc]

```Java
bool DartServiceIsolate::Startup(std::string server_ip,
                                 intptr_t server_port,
                                 Dart_LibraryTagHandler embedder_tag_handler,
                                 bool disable_origin_check,
                                 bool disable_service_auth_codes,
                                 char** error) {
  Dart_Isolate isolate = Dart_CurrentIsolate();
  ...

  Dart_Handle uri = Dart_NewStringFromCString("dart:vmservice_io");
  Dart_Handle library = Dart_LookupLibrary(uri);
  Dart_Handle result = Dart_SetRootLibrary(library);
  result = Dart_SetNativeResolver(library, GetNativeFunction, GetSymbol);

  Dart_ExitScope();
  Dart_ExitIsolate();
  //该过程会执行Isolate::Run()方法
  Dart_IsolateMakeRunnable(isolate);

  Dart_EnterIsolate(isolate);
  Dart_EnterScope();
  library = Dart_RootLibrary();

  //设置HTTP server的ip地址，对于ipv4则为127.0.0.1
  Dart_SetField(library, Dart_NewStringFromCString("_ip"),
                         Dart_NewStringFromCString(server_ip.c_str()));
  //当指定端口号，则立即启动服务；如果没有指定，则找到第一个可用的端口号
  bool auto_start = server_port >= 0;
  if (server_port < 0) {
    server_port = 0;
  }
  //设置HTTP server的端口号，
  Dart_SetField(library, Dart_NewStringFromCString("_port"),
                         Dart_NewInteger(server_port));
  Dart_SetField(library, Dart_NewStringFromCString("_autoStart"),
                         Dart_NewBoolean(auto_start));
  Dart_SetField(library, Dart_NewStringFromCString("_originCheckDisabled"),
                    Dart_NewBoolean(disable_origin_check));
  Dart_SetField(library, Dart_NewStringFromCString("_authCodesDisabled"),
                    Dart_NewBoolean(disable_service_auth_codes));
  return true;
}
```

设置root library为dart:vmservice_io。

### 2.4 RunMain
[-> third_party/dart/runtime/vm/service_isolate.cc]

```Java
bool RunMain(Isolate* I) {
  Thread* T = Thread::Current();
  StackZone zone(T);
  HANDLESCOPE(T);

  const Library& root_library = Library::Handle(Z, I->object_store()->root_library());
  const String& entry_name = String::Handle(Z, String::New("main"));
  const Function& entry = Function::Handle(
      Z, root_library.LookupFunctionAllowPrivate(entry_name));
  //找到并执行dart:vmservice_io库的main()方法 [见小节2.5]
  const Object& result = Object::Handle(
      Z, DartEntry::InvokeFunction(entry, Object::empty_array()));
  const ReceivePort& rp = ReceivePort::Cast(result);
  ServiceIsolate::SetLoadPort(rp.Id());
  return false;
}
```

### 2.5 vmservice_io.main
[-> third_party/dart/runtime/bin/vmservice/vmservice_io.dart]

```Java
main() {
  new VMService();
  if (_autoStart) {
    _lazyServerBoot();  //[见小节2.5.1]
    server.startup();   //[见小节2.6]
    Timer.run(() {});   //用于执行所有的microtasks.
  }
  scriptLoadPort.handler = _processLoadRequest;
  _registerSignalHandlerTimer = new Timer(shortDelay, _registerSignalHandler);
  return scriptLoadPort;
}
```

#### 2.5.1 \_lazyServerBoot
[-> third_party/dart/runtime/bin/vmservice/vmservice_io.dart]

```Java
_lazyServerBoot() {
  if (server != null) {
    return;
  }
   //[见小节2.5.2]
  var service = new VMService();
   //[见小节2.5.4]
  server = new Server(service, _ip, _port, _originCheckDisabled, _authCodesDisabled);
}
```

该过程创建VMService和Server对象

#### 2.5.2 VMService初始化
[-> third_party/dart/sdk/lib/vmservice/vmservice.dart]

```Java
final RawReceivePort isolateControlPort = new RawReceivePort();

class VMService extends MessageRouter {

  factory VMService() {
    if (VMService._instance == null) {
      VMService._instance = new VMService._internal(); //如下文
      _onStart(); //通知虚拟机，服务正在运行
    }
    return _instance;
  }

  VMService._internal() : eventPort = isolateControlPort {
    eventPort.handler = messageHandler; //设置消息处理handler
  }
}
```

#### 2.5.3 messageHandler
[-> third_party/dart/sdk/lib/vmservice/vmservice.dart]

```Java
  void messageHandler(message) {
    if (message is List) {
      if (message.length == 2) {
        // 事件处理
        _eventMessageHandler(message[0], new Response.from(message[1]));
        return;
      }
      if (message.length == 1) {
        _exit();  //vm service退出的消息
        return;
      }
      if (message.length == 3) {
        final opcode = message[0];
        if (opcode == Constants.METHOD_CALL_FROM_NATIVE) {
          _handleNativeRpcCall(message[1], message[2]);
          return;
        } else {
          assert((opcode == Constants.WEB_SERVER_CONTROL_MESSAGE_ID) ||
              (opcode == Constants.SERVER_INFO_MESSAGE_ID));
          _serverMessageHandler(message[0], message[1], message[2]);
          return;
        }
      }
      if (message.length == 4) {
        //关于isolate的创建和销毁的消息
        _controlMessageHandler(message[0], message[1], message[2], message[3]);
        return;
      }
    }
  }
```

根据消息长度调用相应的Handler：

- 当长度等于1，则调用_exit来退出vm service；
- 当长度等于2，则调用_eventMessageHandler来处理事件；
- 当长度等于3，分为两种情况：
  - 当消息opcode等于METHOD_CALL_FROM_NATIVE，则调用_handleNativeRpcCall来处理Native的RPC调用；
  - 否则，则调用_serverMessageHandler来处理消息；
- 当长度等于4，则调用_controlMessageHandler来通知创建或销毁一个isolate；

#### 2.5.4 Server初始化
[-> third_party/dart/runtime/bin/vmservice/server.dart]

```Java
class Server {
  static const WEBSOCKET_PATH = '/ws';
  static const ROOT_REDIRECT_PATH = '/index.html';

  final VMService _service;
  final String _ip;
  final int _port;
  final bool _originCheckDisabled;
  final bool _authCodesDisabled;
  HttpServer _server;

  Server(this._service, this._ip, this._port, this._originCheckDisabled,
      bool authCodesDisabled)
      : _authCodesDisabled = (authCodesDisabled || Platform.isFuchsia);
}

```

### 2.6 server.startup
[-> third_party/dart/runtime/bin/vmservice/server.dart]

```Java
Future startup() async {
  ...
  Future<bool> poll() async {
    try {
      var address;
      var addresses = await InternetAddress.lookup(_ip);
      for (var i = 0; i < addresses.length; i++) {
        address = addresses[i];
        if (address.type == InternetAddressType.IP_V4) break;
      }
      //监听HTTP请求
      _server = await HttpServer.bind(address, _port);
      return true;
    } catch (e, st) {
      return false;
    }
  }

  //轮询尝试，最多10次没有连接成功，则退出
  int attempts = 0;
  final int maxAttempts = 10;
  //尝试跟指定地址和端口建立http请求进行绑定
  while (!await poll()) {
    attempts++;
    if (attempts > maxAttempts) {
      _notifyServerState("");
      onServerAddressChange(null);
      return this;
    }
    await new Future<Null>.delayed(const Duration(seconds: 1));
  }
  //进入监听状态
  _server.listen(_requestHandler, cancelOnError: true);
  //这便是熟悉的那行，标志着服务启动成功
  serverPrint('Observatory listening on $serverAddress');

  //将服务地址通知到VmService，写入其成员变量server_uri_
  _notifyServerState(serverAddress.toString());
  //将服务地址通知到ServiceIsolate，写入其成员变量server_address_
  onServerAddressChange('$serverAddress');
  return this;
}

```

服务进入监听状态，一旦收到请求，则会调用\_requestHandler。

## 三、处理请求


```Java
Server._requestHandler
  client.onRequest
    vmservice.routeRequest
      vmservice._routeRequestImpl
        message.sendToVM
          message.sendRootServiceMessage  (接下来进入C++)
            Service::HandleRootMessage
              Service::InvokeMethod
```

### 3.1 Server.\_requestHandler
[-> third_party/dart/runtime/bin/vmservice/server.dart]

```Java
Future _requestHandler(HttpRequest request) async {
  ...
  final String path = _checkAuthTokenAndGetPath(request.uri);
  //创建一个client对象，内有vmservice [见小节3.1.1]
  final client = new HttpRequestClient(request, _service);
  //创建message对象，[见小节3.1.2]
  final message = new Message.fromUri(client, Uri.parse(path));
  // [见小节3.2]
  client.onRequest(message);
}
```

#### 3.1.1 HttpRequestClient初始化
[-> third_party/dart/runtime/bin/vmservice/server.dart]

```Java
class HttpRequestClient extends Client {
  final HttpRequest request;

  HttpRequestClient(this.request, VMService service)
      : super(service, sendEvents: false); //见下文
}
```

[-> third_party/dart/sdk/lib/vmservice/client.dart]

```Java
abstract class Client {
  final VMService service;
  final bool sendEvents;

  Client(this.service, {bool sendEvents: true}) : this.sendEvents = sendEvents {
    service._addClient(this);  //将当前的client添加到VMService
  }
}
```

#### 3.1.2 Message.fromUri
[-> third_party/dart/sdk/lib/vmservice/message.dart]

```Java
Message.fromUri(this.client, Uri uri)
    : type = MessageType.Request,
      serial = '',
      method = _methodNameFromUri(uri) { //从uri中获取方法名
  params.addAll(uri.queryParameters);
}
```

Message对象都有一个成员变量method

- 方法名method，对于fromUri是从分割后的第一部分
- 消息类型type有有3大类：Request, Notification, Response

### 3.2 client.onRequest
[-> third_party/dart/sdk/lib/vmservice/client.dart]

```Java
abstract class Client {
  final VMService service;

  void onRequest(Message message) {
    //
    service.routeRequest(service, message).then(post);
  }
}
```

### 3.3 vmservice.routeRequest
[-> third_party/dart/sdk/lib/vmservice/vmservice.dart]

```Java
Future<Response> routeRequest(VMService _, Message message) async {
  return new Response.from(await _routeRequestImpl(message));
}

Future _routeRequestImpl(Message message) async {
  try {
    if (message.completed) {
      return await message.response;
    }
    if (message.method == 'streamListen') {
      return await _streamListen(message);
    }
    if (message.method == 'streamCancel') {
      return await _streamCancel(message);
    }
    if (message.method == '_registerService') {
      return await _registerService(message);
    }
    if (message.method == '_spawnUri') {
      return await _spawnUri(message);
    }
    if (devfs.shouldHandleMessage(message)) {
      return await devfs.handleMessage(message);
    }
    if (_hasNamespace(message.method)) {
      return await _handleService(message);
    }
    if (message.params['isolateId'] != null) {
      return await runningIsolates.routeRequest(this, message);
    }
    return await message.sendToVM(); //[见小节3.4]
  } catch (e, st) {
    return message.response;
  }
}
```

### 3.4 message.sendToVM
[-> third_party/dart/sdk/lib/vmservice/message.dart]

```Java
Future<Response> sendToVM() {
  final receivePort = new RawReceivePort();
  receivePort.handler = (value) {
    receivePort.close();
    _setResponseFromPort(value);
  };
  var keys = params.keys.toList(growable: false);
  var values = params.values.toList(growable: false);
  if (!_methodNeedsObjectParameters(method)) {
    keys = _makeAllString(keys);
    values = _makeAllString(values);
  }

  final request = new List(6)
    ..[0] = 0
    ..[1] = receivePort.sendPort
    ..[2] = serial
    ..[3] = method
    ..[4] = keys
    ..[5] = values;

  if (_methodNeedsObjectParameters(method)) {
    sendObjectRootServiceMessage(request);  //[见小节3.5]
  } else {
    sendRootServiceMessage(request);  //[见小节3.5]
  }

  return _completer.future;
}
```

sendRootServiceMessage，这是一个native方法，调用到vmservice.cc中相应的方法

### 3.5 message.sendRootServiceMessage
[-> third_party/dart/runtime/lib/vmservice.cc]

```Java
DEFINE_NATIVE_ENTRY(VMService_SendRootServiceMessage, 0, 1) {
#ifndef PRODUCT
  GET_NON_NULL_NATIVE_ARGUMENT(Array, message, arguments->NativeArgAt(0));
  if (FLAG_support_service) {
    return Service::HandleRootMessage(message);  //[见小节3.6]
  }
#endif
  return Object::null();
}
```

```Java
DEFINE_NATIVE_ENTRY(VMService_SendObjectRootServiceMessage, 0, 1) {
#ifndef PRODUCT
  GET_NON_NULL_NATIVE_ARGUMENT(Array, message, arguments->NativeArgAt(0));
  if (FLAG_support_service) {
    return Service::HandleObjectRootMessage(message);
  }
#endif
  return Object::null();
}
```

### 3.6 Service::HandleRootMessage
[-> third_party/dart/runtime/vm/service.cc]

```Java
RawError* Service::HandleRootMessage(const Array& msg_instance) {
  Isolate* isolate = Isolate::Current();
  return InvokeMethod(isolate, msg_instance);  //[见小节3.7]
}

RawError* Service::HandleObjectRootMessage(const Array& msg_instance) {
  Isolate* isolate = Isolate::Current();
  return InvokeMethod(isolate, msg_instance, true);  //[见小节3.7]
}
```

### 3.7 Service::InvokeMethod
[-> third_party/dart/runtime/vm/service.cc]

```Java
RawError* Service::InvokeMethod(Isolate* I, const Array& msg,
                                bool parameters_are_dart_objects) {
  Thread* T = Thread::Current();
  {
    StackZone zone(T);
    HANDLESCOPE(T);
    Instance& reply_port = Instance::Handle(Z);
    Instance& seq = String::Handle(Z);
    String& method_name = String::Handle(Z);
    Array& param_keys = Array::Handle(Z);
    Array& param_values = Array::Handle(Z);
    reply_port ^= msg.At(1);
    seq ^= msg.At(2);
    method_name ^= msg.At(3);
    param_keys ^= msg.At(4);
    param_values ^= msg.At(5);

    JSONStream js;
    Dart_Port reply_port_id =
        (reply_port.IsNull() ? ILLEGAL_PORT : SendPort::Cast(reply_port).Id());
    js.Setup(zone.GetZone(), reply_port_id, seq, method_name, param_keys,
             param_values, parameters_are_dart_objects);
    ...
    const char* c_method_name = method_name.ToCString();
    //从service_methods_[]找到目标方法 [3.7.1]
    const ServiceMethodDescriptor* method = FindMethod(c_method_name);
    if (method != NULL) {
      if (method->entry(T, &js)) {  //执行相应方法
        js.PostReply();
      }
      return T->StealStickyError();
    }
    ...
  }
}
```

#### 3.7.1 FindMethod
[-> third_party/dart/runtime/vm/service.cc]

```Java
const ServiceMethodDescriptor* FindMethod(const char* method_name) {
  intptr_t num_methods = sizeof(service_methods_) / sizeof(service_methods_[0]);
  for (intptr_t i = 0; i < num_methods; i++) {
    const ServiceMethodDescriptor& method = service_methods_[i];
    if (strcmp(method_name, method.name) == 0) {
      return &method;
    }
  }
  return NULL;
}
```

在service.cc中有一个成员变量service_methods_[]记录了所有的定义的方法。比如获取timeline的过程，如下所示。

#### 3.7.2 service_methods_数组

```Java
struct ServiceMethodDescriptor {
  const char* name;
  const ServiceMethodEntry entry;
  const MethodParameter* const* parameters;
};

static const ServiceMethodDescriptor service_methods_[] = {
  { "_echo", Echo,
    NULL },
  { "_respondWithMalformedJson", RespondWithMalformedJson,
    NULL },
  { "_respondWithMalformedObject", RespondWithMalformedObject,
    NULL },
  { "_triggerEchoEvent", TriggerEchoEvent,
    NULL },
  { "addBreakpoint", AddBreakpoint,
    add_breakpoint_params },
  { "addBreakpointWithScriptUri", AddBreakpointWithScriptUri,
    add_breakpoint_with_script_uri_params },
  { "addBreakpointAtEntry", AddBreakpointAtEntry,
    add_breakpoint_at_entry_params },
  { "_addBreakpointAtActivation", AddBreakpointAtActivation,
    add_breakpoint_at_activation_params },
  { "_buildExpressionEvaluationScope", BuildExpressionEvaluationScope,
    build_expression_evaluation_scope_params },
  { "_clearCpuProfile", ClearCpuProfile,
    clear_cpu_profile_params },
  { "_clearVMTimeline", ClearVMTimeline,
    clear_vm_timeline_params, },
  { "_compileExpression", CompileExpression, compile_expression_params },
  { "_enableProfiler", EnableProfiler,
    enable_profiler_params, },
  { "evaluate", Evaluate,
    evaluate_params },
  { "evaluateInFrame", EvaluateInFrame,
    evaluate_in_frame_params },
  { "_getAllocationProfile", GetAllocationProfile,
    get_allocation_profile_params },
  { "_getAllocationSamples", GetAllocationSamples,
      get_allocation_samples_params },
  { "_getNativeAllocationSamples", GetNativeAllocationSamples,
      get_native_allocation_samples_params },
  { "getClassList", GetClassList,
    get_class_list_params },
  { "_getCpuProfile", GetCpuProfile,
    get_cpu_profile_params },
  { "_getCpuProfileTimeline", GetCpuProfileTimeline,
    get_cpu_profile_timeline_params },
  { "_writeCpuProfileTimeline", WriteCpuProfileTimeline,
    write_cpu_profile_timeline_params },
  { "getFlagList", GetFlagList,
    get_flag_list_params },
  { "_getHeapMap", GetHeapMap,
    get_heap_map_params },
  { "_getInboundReferences", GetInboundReferences,
    get_inbound_references_params },
  { "_getInstances", GetInstances,
    get_instances_params },
  { "getIsolate", GetIsolate,
    get_isolate_params },
  { "getMemoryUsage", GetMemoryUsage,
    get_memory_usage_params },
  { "_getIsolateMetric", GetIsolateMetric,
    get_isolate_metric_params },
  { "_getIsolateMetricList", GetIsolateMetricList,
    get_isolate_metric_list_params },
  { "getObject", GetObject,
    get_object_params },
  { "_getObjectStore", GetObjectStore,
    get_object_store_params },
  { "_getObjectByAddress", GetObjectByAddress,
    get_object_by_address_params },
  { "_getPersistentHandles", GetPersistentHandles,
      get_persistent_handles_params, },
  { "_getPorts", GetPorts,
    get_ports_params },
  { "_getReachableSize", GetReachableSize,
    get_reachable_size_params },
  { "_getRetainedSize", GetRetainedSize,
    get_retained_size_params },
  { "_getRetainingPath", GetRetainingPath,
    get_retaining_path_params },
  { "getScripts", GetScripts,
    get_scripts_params },
  { "getSourceReport", GetSourceReport,
    get_source_report_params },
  { "getStack", GetStack,
    get_stack_params },
  { "_getUnusedChangesInLastReload", GetUnusedChangesInLastReload,
    get_unused_changes_in_last_reload_params },
  { "_getTagProfile", GetTagProfile,
    get_tag_profile_params },
  { "_getTypeArgumentsList", GetTypeArgumentsList,
    get_type_arguments_list_params },
  { "getVersion", GetVersion,
    get_version_params },
  { "getVM", GetVM,
    get_vm_params },
  { "_getVMMetric", GetVMMetric,
    get_vm_metric_params },
  { "_getVMMetricList", GetVMMetricList,
    get_vm_metric_list_params },
  { "_getVMTimeline", GetVMTimeline,
    get_vm_timeline_params },
  { "_getVMTimelineFlags", GetVMTimelineFlags,
    get_vm_timeline_flags_params },
  { "invoke", Invoke, invoke_params },
  { "kill", Kill, kill_params },
  { "pause", Pause,
    pause_params },
  { "removeBreakpoint", RemoveBreakpoint,
    remove_breakpoint_params },
  { "reloadSources", ReloadSources,
    reload_sources_params },
  { "_reloadSources", ReloadSources,
    reload_sources_params },
  { "resume", Resume,
    resume_params },
  { "_requestHeapSnapshot", RequestHeapSnapshot,
    request_heap_snapshot_params },
  { "_evaluateCompiledExpression", EvaluateCompiledExpression,
    evaluate_compiled_expression_params },
  { "setExceptionPauseMode", SetExceptionPauseMode,
    set_exception_pause_mode_params },
  { "setFlag", SetFlag,
    set_flags_params },
  { "setLibraryDebuggable", SetLibraryDebuggable,
    set_library_debuggable_params },
  { "setName", SetName,
    set_name_params },
  { "_setTraceClassAllocation", SetTraceClassAllocation,
    set_trace_class_allocation_params },
  { "setVMName", SetVMName,
    set_vm_name_params },
  { "_setVMTimelineFlags", SetVMTimelineFlags,
    set_vm_timeline_flags_params },
  { "_collectAllGarbage", CollectAllGarbage,
    collect_all_garbage_params },
  { "_getDefaultClassesAliases", GetDefaultClassesAliases,
    get_default_classes_aliases_params },
};
```

## 四、小结

ServiceIsolate处理监听状态，根据具体的命令，最终会执行执行到service.cc的成service_methods_数组中所定义的方法。看到这里，你可能还不了解其功能。
这只是为下一篇文章介绍timeline工作原理做铺垫而已。
