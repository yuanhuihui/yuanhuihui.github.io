## WindowManagerService

PhoneWindowManager extends WindowManagerPolicy

IWindowManager
IWindowSession



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

IWindowSession作为一组Binder通信组

Session extends IWindowSession.Stub, 作为Binder服务端
WindowManagerService extends IWindowManager.Stub:   Binder的服务端
