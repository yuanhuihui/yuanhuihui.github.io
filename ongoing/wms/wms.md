## WindowManagerService

PhoneWindowManager extends WindowManagerPolicy


WindowState
Window
WindowAnimator
WindowManagerPolicy

InputManagerService
Choreographer
DisplayContent
WindowToken
AppWindowToken 很重要， 位于ActivityRecord



## 继承关系





## 对应

AMS.JAVA <–> WMS.JAVA 如下一一对应：

ActivityStack <–> TaskStack
TaskRecord <–> Task



##  如何通信

3组 binder ipc:

- IWindowSession：app进程 --> system_server进程 通信；
- IWindowManager：app进程 --> system_server进程 通信；
- IWindow: system_server进程 --> app进程 通信；


Session extends IWindowSession.Stub, 作为Binder服务端
WindowManagerService extends IWindowManager.Stub:   Binder的服务端
