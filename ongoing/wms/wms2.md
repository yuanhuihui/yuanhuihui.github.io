- system_server: WMS.main
- "android.display"线程: new WMS
- "android.ui"线程: PhoneWindowManager.init


## WindowManagerService


WindowState
Window
WindowAnimator: 管理窗口动画
WindowManagerPolicy

InputManagerService
Choreographer: 负责所有窗口动画的渲染
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

- IWindowManager：app进程 --> system_server进程 通信；
- IWindowSession：app进程 --> system_server进程 通信；
- IApplicationToken: app进程 --> system_server进程 通信；

- IWindow: system_server进程 --> app进程 通信；


Session extends IWindowSession.Stub, 作为Binder服务端
WindowManagerService extends IWindowManager.Stub:   Binder的服务端

ActivityRecord.Token extends IApplicationToken.Stub (服务端,)

BaseIWindow extends IWindow.Stub: Binder服务端 (运行在app这边)
ViewRootImpl.W extends IWindow.Stub (运行在app这边)


