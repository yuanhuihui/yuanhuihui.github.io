---
layout: post
title:  "深入理解Flutter的Platform Channel机制"
date:   2019-08-10 23:15:40
catalog:  true
tags:
    - flutter

---

> 基于Flutter 1.5，从源码视角来深入剖析flutter的channel，相关源码目录见文末附录

## 一、概述

Flutter 官方提供了一种 Platform Channel 的方案，用于 Dart 和平台之间相互通信。

核心原理：

- Flutter应用通过Platform Channel将传递的数据编码成消息的形式，跨线程发送到该应用所在的宿主(Android或iOS)；
- 宿主接收到Platform Channel的消息后，调用相应平台的API，也就是原生编程语言来执行相应方法；
- 执行完成后将结果数据通过同样方式原路返回给应用程序的Flutter部分。

整个过程的消息和响应是异步的，所以不会直接阻塞用户界面。

#### 1.1 流程图

**[MethodChannel调用流程](/img/method_channel/MethodChannel.jpg)**

![MethodChannel](/img/method_channel/MethodChannel.jpg)

FlutterViewHandlePlatformMessage()方法会调用到Java层的FlutterJNI.handlePlatformMessage()方法。

**[MethodChannel返回流程](/img/method_channel/ChannelReply.jpg)**

![ChannelReply](/img/method_channel/ChannelReply.jpg)

#### 1.2 Channel类说明

1) Flutter提供了三种不同的Channel：

- BasicMessageChannel：传递字符串和半结构化数据
- MethodChannel：方法调用
- EventChannel：数据流的通信


2) 方法编解码MethodCodec有两个子类：

- StandardMethodCodec
- JSONMethodCodec

3) 消息编解码MessageCodec有4个子类：

- StandardMessageCodec
- StringCodec
- JSONMessageCodec
- BinaryCodec

4) BinaryMessages

\_handlers的数据类型为map，其中以MethodChannel的name为key，以返回值为Future<ByteData>的Function为value。

//待完善

#### 1.3 实例
以官方提供的Android平台获取电池电量的实例，有Flutter端和Android端两部分代码。

Flutter端代码：

```Java
class _HomePageState extends State<HomePage> {
  //创建MethodChannel [见小节2.1]
  static const platform = const MethodChannel('samples.flutter.io/battery');

  Future<void> _getBatteryLevel() async {
    try {
       //调用相应通道的方法 [见小节2.2]
       int batteryLevel = await platform.invokeMethod('getBatteryLevel');
    } on PlatformException catch (e) {
      ...
    }
  }
}
```

Android端代码：

```Java
public class MainActivity extends FlutterActivity {
    private static final String CHANNEL = "samples.flutter.io/battery";

    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        //创建方法通道 [见小节4.1]
        new MethodChannel(getFlutterView(), CHANNEL).setMethodCallHandler(
                new MethodCallHandler() {
                    public void onMethodCall(MethodCall call, Result result) {
                      if (call.method.equals("getBatteryLevel")) {
                          //调用android端的BatteryManager来获取电池电量信息
                          int batteryLevel = getBatteryLevel();
                          if (batteryLevel != -1) {
                              //将函数执行的成功结果回传到Flutter端
                              result.success(batteryLevel);   
                          } else {
                              //将函数执行的失败结果回传到Flutter端
                              result.error("UNAVAILABLE", "Battery level not available.", null);
                          }
                      } else {
                          result.notImplemented();
                      }
                    }
                });
    }
}
```

## 二、Dart层

### 2.1 MethodChannel初始化
[-> lib/src/services/platform_channel.dart]

```Java
class MethodChannel {
    //[见小节2.1.1]
    const MethodChannel(this.name, [this.codec = const StandardMethodCodec()]);
    final String name;
    final MethodCodec codec;
}
```

默认用的是标准方法编解码器StandardMethodCodec

#### 2.1.1 StandardMethodCodec初始化
[-> lib/src/services/message_codecs.dart]

```Java
class StandardMethodCodec implements MethodCodec {
  //[见小节2.1.2]
  const StandardMethodCodec([this.messageCodec = const StandardMessageCodec()]);

  final StandardMessageCodec messageCodec;
}
```

#### 2.1.2 StandardMessageCodec初始化
[-> lib/src/services/message_codecs.dart]

```Java
class StandardMessageCodec implements MessageCodec<dynamic> {

  const StandardMessageCodec();
}
```

### 2.2 MethodChannel.invokeMethod
[-> lib/src/services/platform_channel.dart]

```Java
class MethodChannel {

    Future<T> invokeMethod<T>(String method, [ dynamic arguments ]) async {
      //[见小节2.3]
      final ByteData result = await BinaryMessages.send(name,
          codec.encodeMethodCall(MethodCall(method, arguments)),
      );
      ...
      final T typedResult = codec.decodeEnvelope(result);
      return typedResult;
    }
}
```

该方法主要功能：

- 创建MethodCall对象[小节2.2.1]；
- 通过StandardMethodCodec的encodeMethodCall将MethodCall转换为ByteData数据类型[小节2.2.2]；
- 然后调用BinaryMessages的send来发送消息[小节2.3]
- 最后，decodeEnvelope来解码结果

#### 2.2.1 MethodCall初始化
[-> lib/src/services/message_codec.dart]

```Java
class MethodCall {
  const MethodCall(this.method, [this.arguments]);
  final String method; //方法名，非空
  final dynamic arguments;
}
```

#### 2.2.2 encodeMethodCall
[-> lib/src/services/message_codecs.dart]

```Java
class StandardMethodCodec implements MethodCodec {

    ByteData encodeMethodCall(MethodCall call) {
      //创建一个用于写的buffer [见小节2.2.3]
      final WriteBuffer buffer = WriteBuffer();
      //调用StandardMessageCodec将数据写入buffer
      messageCodec.writeValue(buffer, call.method);
      messageCodec.writeValue(buffer, call.arguments);
      return buffer.done();
    }
}
```

#### 2.2.3 WriteBuffer初始化
[-> lib/src/foundation/serialization.dart]

```Java
class WriteBuffer {
  WriteBuffer() {
    _buffer = Uint8Buffer();
    _eightBytes = ByteData(8);
    _eightBytesAsList = _eightBytes.buffer.asUint8List();
  }

  Uint8Buffer _buffer;
  ByteData _eightBytes;
  Uint8List _eightBytesAsList;

  ByteData done() {
    final ByteData result = _buffer.buffer.asByteData(0, _buffer.lengthInBytes);
    _buffer = null;
    return result;
  }
  ...
}

```

### 2.3 BinaryMessages.send
[-> lib/src/services/platform_messages.dart]

```Java
class BinaryMessages {

  static Future<ByteData> send(String channel, ByteData message) {
    final _MessageHandler handler = _mockHandlers[channel];
    if (handler != null)
      return handler(message);
    //[见小节2.4]
    return _sendPlatformMessage(channel, message);
  }
}
```

\_mockHandlers是用于调试的。

### 2.4 BinaryMessages.\_sendPlatformMessage
[-> lib/src/services/platform_messages.dart]

```Java
static Future<ByteData> _sendPlatformMessage(String channel, ByteData message) {
  //[见小节2.4.1]
  final Completer<ByteData> completer = Completer<ByteData>();
  //[见小节2.5]
  ui.window.sendPlatformMessage(channel, message, (ByteData reply) {
    try {
      //[见小节6.6]
      completer.complete(reply);
    } catch (exception, stack) {
      ...
    }
  });
  return completer.future;
}
```

#### 2.4.1 Completer初始化
[-> third_party/dart/sdk/lib/async/future.dart]

```Java
factory Completer() => new _AsyncCompleter<T>();
```

#### 2.4.2 \_AsyncCompleter初始化
[-> third_party/dart/sdk/lib/async/future_impl.dart]

```Java
class _AsyncCompleter<T> extends _Completer<T> {
  void complete([FutureOr<T> value]) {
    future._asyncComplete(value);
  }
}

abstract class _Completer<T> implements Completer<T> {
  final _Future<T> future = new _Future<T>();
  void complete([FutureOr<T> value]);
}
```

### 2.5 window.sendPlatformMessage
[-> flutter/lib/ui/window.dart]

```Java
class Window {
    void sendPlatformMessage(String name, ByteData data,
                             PlatformMessageResponseCallback callback) {
      final String error =
          _sendPlatformMessage(name, _zonedPlatformMessageResponseCallback(callback), data);
      if (error != null)
        throw new Exception(error);
    }

    //[见小节3.1]
    String _sendPlatformMessage(String name,
                            PlatformMessageResponseCallback callback,
                            ByteData data) native 'Window_sendPlatformMessage';
}
```

#### 2.5.1 window.\_zonedPlatformMessageResponseCallback
[-> flutter/lib/ui/window.dart]

```Java
static PlatformMessageResponseCallback _zonedPlatformMessageResponseCallback(
                              PlatformMessageResponseCallback callback) {
  //储存在注册回调所在的zone区域
  final Zone registrationZone = Zone.current;

  return (ByteData data) {
    registrationZone.runUnaryGuarded(callback, data);
  };
}
```

接下来执行\_sendPlatformMessages，这是一个native方法，会调用到Flutter引擎层。


## 三、引擎层

### 3.1 \_SendPlatformMessage
[-> flutter/lib/ui/window/window.cc]

```Java
void _SendPlatformMessage(Dart_NativeArguments args) {
  tonic::DartCallStatic(&SendPlatformMessage, args);
}

void Window::RegisterNatives(tonic::DartLibraryNatives* natives) {
  natives->Register({
      {"Window_defaultRouteName", DefaultRouteName, 1, true},
      {"Window_scheduleFrame", ScheduleFrame, 1, true},
      {"Window_sendPlatformMessage", _SendPlatformMessage, 4, true},
      ...
  });
}
```

Window.dart中的\_sendPlatformMessage()最终对应于引擎层中window.cc的\_SendPlatformMessage()方法，为了更好理解引擎中的调用关系，见如下**[Enggine核心类图](/img/flutter_boot/ClassEngine.jpg)**

![ClassEngine](/img/flutter_boot/ClassEngine.jpg)


### 3.2 SendPlatformMessage
[-> flutter/lib/ui/window/window.cc]

```Java
Dart_Handle SendPlatformMessage(Dart_Handle window,
                                const std::string& name,
                                Dart_Handle callback,
                                Dart_Handle data_handle) {
  UIDartState* dart_state = UIDartState::Current();
  if (!dart_state->window()) {
    return tonic::ToDart("Platform messages can only be sent from the main isolate");
  }

  fml::RefPtr<PlatformMessageResponse> response;
  if (!Dart_IsNull(callback)) {
    //PlatformMessageResponseDart对象中采用的是UITaskRunner
    response = fml::MakeRefCounted<PlatformMessageResponseDart>(
        tonic::DartPersistentValue(dart_state, callback),
        dart_state->GetTaskRunners().GetUITaskRunner());
  }
  if (Dart_IsNull(data_handle)) {
    dart_state->window()->client()->HandlePlatformMessage(
        fml::MakeRefCounted<PlatformMessage>(name, response));
  } else {
    tonic::DartByteData data(data_handle);
    const uint8_t* buffer = static_cast<const uint8_t*>(data.data());
    //[见小节3.3]
    dart_state->window()->client()->HandlePlatformMessage(
        fml::MakeRefCounted<PlatformMessage>(
            name, std::vector<uint8_t>(buffer, buffer + data.length_in_bytes()),
            response));
  }

  return Dart_Null();
}
```

该方法主要功能：

- 该方法是发送平台消息，则只允许从主isolate中发出，否则会跑出异常
- 该SendPlatformMessage方法的参数name代表是channel名，data_handle是记录待执行的方法名和参数，callback是执行后回调反馈结果数据的方法
- 创建PlatformMessageResponseDart对象，保存callback方法
- 调用RuntimeController的HandlePlatformMessage来处理平台消息

### 3.3 RuntimeController::HandlePlatformMessage
[-> flutter/runtime/runtime_controller.cc]

```Java
void RuntimeController::HandlePlatformMessage(
    fml::RefPtr<PlatformMessage> message) {
  //[见小节3.4]
  client_.HandlePlatformMessage(std::move(message));
}
```

### 3.4 Engine::HandlePlatformMessage
[-> flutter/shell/common/engine.cc]

```Java
static constexpr char kAssetChannel[] = "flutter/assets";

void Engine::HandlePlatformMessage(fml::RefPtr<PlatformMessage> message) {
  if (message->channel() == kAssetChannel) {
    HandleAssetPlatformMessage(std::move(message));
  } else {
    //[见小节3.5]
    delegate_.OnEngineHandlePlatformMessage(std::move(message));
  }
}
```

### 3.5 Shell::OnEngineHandlePlatformMessage
[-> flutter/shell/common/shell.cc]

```Java
constexpr char kSkiaChannel[] = "flutter/skia";

void Shell::OnEngineHandlePlatformMessage(
    fml::RefPtr<PlatformMessage> message) {
  if (message->channel() == kSkiaChannel) {
    HandleEngineSkiaMessage(std::move(message));
    return;
  }
  //[见小节3.6]
  task_runners_.GetPlatformTaskRunner()->PostTask(
      [view = platform_view_->GetWeakPtr(), message = std::move(message)]() {
        if (view) {
          view->HandlePlatformMessage(std::move(message));
        }
      });
}
```

接下来将HandlePlatformMessage的工作交给主线程的PlatformTaskRunner来处理，对于PlatformView在Android平台的实例为PlatformViewAndroid。

### 3.6 PlatformViewAndroid::HandlePlatformMessage
[-> flutter/shell/platform/android/platform_view_android.cc]

```Java
void PlatformViewAndroid::HandlePlatformMessage(
    fml::RefPtr<flutter::PlatformMessage> message) {
  JNIEnv* env = fml::jni::AttachCurrentThread();
  fml::jni::ScopedJavaLocalRef<jobject> view = java_object_.get(env);

  int response_id = 0;
  if (auto response = message->response()) {
    response_id = next_response_id_++;
    pending_responses_[response_id] = response; //保存response
  }
  auto java_channel = fml::jni::StringToJavaString(env, message->channel());
  if (message->hasData()) {
    fml::jni::ScopedJavaLocalRef<jbyteArray> message_array(
        env, env->NewByteArray(message->data().size()));
    env->SetByteArrayRegion(
        message_array.obj(), 0, message->data().size(),
        reinterpret_cast<const jbyte*>(message->data().data()));
    message = nullptr;
    //[见小节3.7]
    FlutterViewHandlePlatformMessage(env, view.obj(), java_channel.obj(),
                                     message_array.obj(), response_id);
  } else {
    message = nullptr;

    FlutterViewHandlePlatformMessage(env, view.obj(), java_channel.obj(),
                                     nullptr, response_id);
  }
}
```

PlatformViewAndroid对象的pending_responses_是一个map数据类型，里面记录着所有的待响应的PlatformMessageResponse数据。


### 3.7 FlutterViewHandlePlatformMessage
[-> flutter/shell/platform/android/platform_view_android_jni.cc]

```Java
void FlutterViewHandlePlatformMessage(JNIEnv* env, jobject obj,
                                      jstring channel, jobject message,
                                      jint responseId) {
  env->CallVoidMethod(obj, g_handle_platform_message_method, channel, message, responseId);
}
```

g_handle_platform_message_method方法所对应的便是Java层的FlutterJNI.java中的handlePlatformMessage()方法。

## 四、宿主层

### 4.1 MethodChannel初始化
[-> io/flutter/plugin/common/MethodChannel.java]

```Java
public final class MethodChannel {
    private final BinaryMessenger messenger;
    private final String name;
    private final MethodCodec codec;

    public MethodChannel(BinaryMessenger messenger, String name) {
        //创建MethodChannel
        this(messenger, name, StandardMethodCodec.INSTANCE);
    }

    public MethodChannel(BinaryMessenger messenger, String name, MethodCodec codec) {
        this.messenger = messenger;
        this.name = name;
        this.codec = codec;
    }
}
```

再来看看MethodChannel的成员变量messenger，是一个BinaryMessenger类型的接口，由前面[1.3]是通过getFlutterView()方法所获取的。

#### 4.1.1 FlutterActivity.getFlutterView
[-> io/flutter/app/FlutterActivity.java]

```Java
public class FlutterActivity extends Activity implements FlutterView.Provider, PluginRegistry, ViewFactory {
    private final FlutterActivityDelegate delegate = new FlutterActivityDelegate(this, this);
    private final FlutterView.Provider viewProvider = delegate;

    public FlutterView getFlutterView() {
        return viewProvider.getFlutterView(); //[见小节4.1.2]
    }
}
```

#### 4.1.2 FlutterActivityDelegate.getFlutterView
[-> io/flutter/app/FlutterActivityDelegate.java]

```Java
public final class FlutterActivityDelegate
        implements FlutterActivityEvents, FlutterView.Provider, PluginRegistry {
    public FlutterView getFlutterView() {
        return flutterView;
    }
}
```

此处的flutterView的赋值过程是在FlutterActivityDelegate的onCreate()过程，如下所示。

```Java
public void onCreate(Bundle savedInstanceState) {
    ...
    FlutterNativeView nativeView = viewFactory.createFlutterNativeView();
    flutterView = new FlutterView(activity, null, nativeView);
}
```

### 4.2 MethodChannel.setMethodCallHandler
[-> io/flutter/plugin/common/MethodChannel.java]

```Java
public final class MethodChannel {

    public void setMethodCallHandler(final @Nullable MethodCallHandler handler) {
        //[见小节4.2.1]
        messenger.setMessageHandler(name,
            handler == null ? null : new IncomingMethodCallHandler(handler));
}
```

此处的messenger是指FlutterView，此处的handler为IncomingMethodCallHandler。


#### 4.2.1 FlutterView.setMessageHandler
[-> io/flutter/view/FlutterView.java]

```Java
public void setMessageHandler(String channel, BinaryMessageHandler handler) {
    //[见小节4.2.2]
    mNativeView.setMessageHandler(channel, handler);
}
```

#### 4.2.2 FlutterNativeView.setMessageHandler
[-> FlutterNativeView.java]

```Java
public void setMessageHandler(String channel, BinaryMessageHandler handler) {
    //[见小节4.2.3]
    dartExecutor.setMessageHandler(channel, handler);
}
```


#### 4.2.3 DartExecutor.setMessageHandler
[-> io/flutter/embedding/engine/dart/DartExecutor.java]

```Java
public void setMessageHandler(@NonNull String channel, @Nullable BinaryMessenger.BinaryMessageHandler handler) {
  //[见小节4.2.4]
  messenger.setMessageHandler(channel, handler);
}
```

#### 4.2.4 DartMessenger.setMessageHandler
[-> io/flutter/embedding/engine/dart/DartMessenger.java]

```Java
class DartMessenger implements BinaryMessenger, PlatformMessageHandler {
    private final Map<String, BinaryMessenger.BinaryMessageHandler> messageHandlers;

    public void setMessageHandler(@NonNull String channel, @Nullable BinaryMessenger.BinaryMessageHandler handler) {
      if (handler == null) {
        messageHandlers.remove(channel);
      } else {
        //将channel和handler放入到messageHandlers
        messageHandlers.put(channel, handler);
      }
    }
}
```

messageHandlers记录着每一个channel所对应的handler方法。

再回到[小节4.2]，可知此处handler为IncomingMethodCallHandler，初始化过程见[小节4.2.5]。

#### 4.2.5 IncomingMethodCallHandler初始化
[-> io/flutter/plugin/common/MethodChannel.java]

```Java
public final class MethodChannel {

    private final class IncomingMethodCallHandler implements BinaryMessageHandler {
        private final MethodCallHandler handler;

        IncomingMethodCallHandler(MethodCallHandler handler) {
            this.handler = handler;
        }
    }
}
```

## 五、Java层

再回到小节[3.7]FlutterViewHandlePlatformMessage方法，经过JNI将调用FlutterJNI.handlePlatformMessage()方法。

### 5.1 FlutterJNI.handlePlatformMessage
[-> flutter/shell/platform/android/io/flutter/embedding/engine/FlutterJNI.java]

```Java
private void handlePlatformMessage(final String channel, byte[] message, final int replyId) {
  if (platformMessageHandler != null) {
    platformMessageHandler.handleMessageFromDart(channel, message, replyId);
  }
}
```

FlutterNativeView初始化过程，attach中会执行DartExecutor.onAttachedToJNI()来设置platformMessageHandler，其值等于DartMessenger，如下所示。

#### 5.1.1 DartExecutor.onAttachedToJNI
[-> io/flutter/embedding/engine/dart/DartExecutor.java]

```Java
public class DartExecutor implements BinaryMessenger {

  private final FlutterJNI flutterJNI;
  private final DartMessenger messenger;

  public DartExecutor(@NonNull FlutterJNI flutterJNI) {
    this.flutterJNI = flutterJNI;
    //创建DartMessenger对象
    this.messenger = new DartMessenger(flutterJNI);
  }

  public void onAttachedToJNI() {
    //[见小节5.1.2]
    flutterJNI.setPlatformMessageHandler(messenger);
  }
```

#### 5.1.2 FlutterJNI.setPlatformMessageHandler
[-> flutter/shell/platform/android/io/flutter/embedding/engine/FlutterJNI.java]

```Java
public void setPlatformMessageHandler(@Nullable PlatformMessageHandler platformMessageHandler) {
  this.platformMessageHandler = platformMessageHandler;
}
```

### 5.2 DartMessenger.handleMessageFromDart
[-> io/flutter/embedding/engine/dart/DartMessenger.java]

```Java
public void handleMessageFromDart(final String channel,
                        byte[] message, final int replyId) {
  //从messageHandlers中获取handler
  BinaryMessenger.BinaryMessageHandler handler = messageHandlers.get(channel);
  if (handler != null) {
    try {
      final ByteBuffer buffer = (message == null ? null : ByteBuffer.wrap(message));
      //[见小节5.3] [见小节5.2.1]
      handler.onMessage(buffer, new Reply(flutterJNI, replyId));
    } catch (Exception ex) {
      ...
    }
  } else {
    ...
  }
}
```

由[小节4.2.4]可知，此处的handler为IncomingMethodCallHandler，先来看看其成员变量Reply的初始化过程。

#### 5.2.1 Reply初始化
[-> io/flutter/embedding/engine/dart/DartMessenger.java]

```Java
class DartMessenger implements BinaryMessenger, PlatformMessageHandler {

  private static class Reply implements BinaryMessenger.BinaryReply {
    private final FlutterJNI flutterJNI;
    private final int replyId;
    private final AtomicBoolean done = new AtomicBoolean(false);

    Reply(@NonNull FlutterJNI flutterJNI, int replyId) {
      this.flutterJNI = flutterJNI;
      this.replyId = replyId;
    }
  }
}
```

### 5.3 IncomingMethodCallHandler.onMessage
[-> io/flutter/plugin/common/MethodChannel.java]

```Java
private final class IncomingMethodCallHandler implements BinaryMessageHandler {

    public void onMessage(ByteBuffer message, final BinaryReply reply) {
        //从消息中解码出MethodCall
        final MethodCall call = codec.decodeMethodCall(message);
        try {
            //[见小节5.4]
            handler.onMethodCall(call, new Result() {
                @Override
                public void success(Object result) {
                    //[见小节6.1]
                    reply.reply(codec.encodeSuccessEnvelope(result));
                }

                @Override
                public void error(String errorCode, String errorMessage, Object errorDetails) {
                    reply.reply(codec.encodeErrorEnvelope(errorCode, errorMessage, errorDetails));
                }

                @Override
                public void notImplemented() {
                    reply.reply(null);
                }
            });
        } catch (RuntimeException e) {
            ...
        }
    }
}
```

### 5.4 MethodCallHandler.onMethodCall

```Java
new MethodCallHandler() {
  public void onMethodCall(MethodCall call, Result result) {
    if (call.method.equals("getBatteryLevel")) {
        //调用android端的BatteryManager来获取电池电量信息
        int batteryLevel = getBatteryLevel();

        if (batteryLevel != -1) {
            //将结果返回
            result.success(batteryLevel);
        } else {
            result.error("UNAVAILABLE", "Battery level not available.", null);
        }
    } else {
        result.notImplemented();
    }
  }
}
```

当方法执行成功后，会调用result.success()方法，再回到[小节5.3]，可知会执行相对应BinaryReply.reply()方法。


## 六、回传结果

### 6.1 Reply.reply
[-> io/flutter/embedding/engine/dart/DartMessenger.java]

```Java
class DartMessenger implements BinaryMessenger, PlatformMessageHandler {

  private static class Reply implements BinaryMessenger.BinaryReply {
    public void reply(ByteBuffer reply) {
      if (reply == null) {
        flutterJNI.invokePlatformMessageEmptyResponseCallback(replyId);
      } else {
        //[见小节6.2]
        flutterJNI.invokePlatformMessageResponseCallback(replyId, reply, reply.position());
      }
    }
  }
}
```

### 6.2 invokePlatformMessageResponseCallback
[-> io/flutter/embedding/engine/FlutterJNI.java]

```Java
public void invokePlatformMessageResponseCallback(int responseId, ByteBuffer message, int position) {
  if (isAttached()) {
    //[见小节6.3]
    nativeInvokePlatformMessageResponseCallback(
          nativePlatformViewId, responseId, message, position);
  }
}
```

### 6.3 InvokePlatformMessageResponseCallback
[-> platform_view_android_jni.cc]

```Java
static void InvokePlatformMessageResponseCallback(JNIEnv* env,
                                                  jobject jcaller,
                                                  jlong shell_holder,
                                                  jint responseId,
                                                  jobject message,
                                                  jint position) {
  ANDROID_SHELL_HOLDER->GetPlatformView()
      ->InvokePlatformMessageResponseCallback(env,         //
                                              responseId,  //
                                              message,     //
                                              position     //
      );
}
```


### 6.4 InvokePlatformMessageResponseCallback
[-> flutter/shell/platform/android/platform_view_android.cc]

```Java
void PlatformViewAndroid::InvokePlatformMessageResponseCallback(
        JNIEnv* env, jint response_id,
        jobject java_response_data, jint java_response_position) {
  //从pending_responses_根据response_id来查找PlatformMessageResponse
  auto it = pending_responses_.find(response_id);
  uint8_t* response_data = static_cast<uint8_t*>(env->GetDirectBufferAddress(java_response_data));
  //返回结果数据
  std::vector<uint8_t> response = std::vector<uint8_t>(response_data, response_data + java_response_position);
  auto message_response = std::move(it->second);
  pending_responses_.erase(it);
  //[见小节6.5]
  message_response->Complete(std::make_unique<fml::DataMapping>(std::move(response)));
}
```

message_responsed所对应的真实类型为PlatformMessageResponseDart，赋值过程[见小节3.2]。


### 6.5 Complete
[-> flutter/lib/ui/window/platform_message_response_dart.cc]

```Java
void PlatformMessageResponseDart::Complete(std::unique_ptr<fml::Mapping> data) {
  is_complete_ = true;
  //post到UI线程来执行
  ui_task_runner_->PostTask(fml::MakeCopyable(
      [callback = std::move(callback_), data = std::move(data)]() mutable {
        std::shared_ptr<tonic::DartState> dart_state = callback.dart_state().lock();
        tonic::DartState::Scope scope(dart_state);
        Dart_Handle byte_buffer = WrapByteData(std::move(data));
        //[见小节6.6]
        tonic::DartInvoke(callback.Release(), {byte_buffer});
      }));
}
```

到此就发生了线程切换操作，将任务post到UI线程的UITaskRunner来执行。

### 6.6 DartInvoke
[-> third_party/tonic/logging/dart_invoke.cc]

```Java
Dart_Handle DartInvoke(Dart_Handle closure, std::initializer_list<Dart_Handle> args) {
  int argc = args.size();
  Dart_Handle* argv = const_cast<Dart_Handle*>(args.begin());
  Dart_Handle handle = Dart_InvokeClosure(closure, argc, argv);
  return handle;
}
```

该方法参数closure，也就是PlatformMessageResponseDart中的callback_，不断回溯可知所对应方法便是小节[2.4]sendPlatformMessage()的第3个参数，如下所示。

```Java
(ByteData reply) {
  try {
    completer.complete(reply); //[见小节6.7]
  } catch (exception, stack) {
    ...
  }
}
```

### 6.7 \_AsyncCompleter.complete
[-> third_party/dart/sdk/lib/async/future_impl.dart]


```Java
class _AsyncCompleter<T> extends _Completer<T> {
  void complete([FutureOr<T> value]) {
    future._asyncComplete(value);  //[见小节6.8]
  }
}
```

### 6.8 \_Future.\_asyncComplete
[-> third_party/dart/sdk/lib/async/future_impl.dart]

```Java
class _Future<T> implements Future<T> {
  void _asyncComplete(FutureOr<T> value) {
    if (value is Future<T>) {
      _chainFuture(value);
      return;
    }
    _setPendingComplete(); //设置状态为_statePendingComplete
    //[见小节6.9]
    _zone.scheduleMicrotask(() {
      _completeWithValue(value);
    });
  }
}
```

通过scheduleMicrotask()将任务封装成微任务交给UI线程

### 6.9 \_Future.\_completeWithValue
[-> third_party/dart/sdk/lib/async/future_impl.dart]

```Java
void _completeWithValue(T value) {
  _FutureListener listeners = _removeListeners();
  _setValue(value);
  _propagateToListeners(this, listeners); //[见小节6.10]
}
```

### 6.10 \_Future.\_propagateToListeners
[-> third_party/dart/sdk/lib/async/future_impl.dart]

```Java
static void _propagateToListeners(_Future source, _FutureListener listeners) {
  while (true) {
    ...
    //一般情况下futures只有一个监听器
    while (listeners._nextListener != null) {
      _FutureListener listener = listeners;
      listeners = listener._nextListener;
      listener._nextListener = null;
      _propagateToListeners(source, listener);
    }
    _FutureListener listener = listeners;

    //待传回的返回结果数据
    final sourceResult = source._resultOrListeners;
    if (hasError || listener.handlesValue || listener.handlesComplete) {
      Zone zone = listener._zone;
      ...
      Zone oldZone;
      if (!identical(Zone.current, zone)) {
         //当current不是该llistener所在的zone，则切换current
        oldZone = Zone._enter(zone);
      }
      ...
      void handleValueCallback() {
        //【见小节6.11】
        listenerValueOrError = listener.handleValue(sourceResult);
      }

      if (listener.handlesComplete) {
        handleWhenCompleteCallback();
      } else if (!hasError) {
        if (listener.handlesValue) {
          handleValueCallback();
        }
      } else {
        ...
      }
      if (oldZone != null) Zone._leave(oldZone);   //回到原来的zone
    }
    _Future result = listener.result;
    listeners = result._removeListeners();
    ...
    source = result;
  }
}

```

### 6.11 \_FutureListener.handleValue
[-> third_party/dart/sdk/lib/async/future_impl.dart]

```Java
class _FutureListener<S, T> {

    FutureOr<T> handleValue(S sourceResult) {
      return _zone.runUnary<FutureOr<T>, S>(_onValue, sourceResult);
    }
}
```

## 七、总结

MethodChannel的执行流程涉及到主线程和UI线程的交互，代码从Dart到C++再到Java层，执行完相应逻辑后原路返回，从Java层到C++层再到Dart层。

- [小节3.5] Shell::OnEngineHandlePlatformMessage 将任务发送给主线程
- [小节6.5] PlatformMessageResponseDart::Complete 将任务发送给UI线程
