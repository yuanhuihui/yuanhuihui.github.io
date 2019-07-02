###

TaskRunner::PostTask --> 添加task
  MessageLoopImpl::PostTask
    MessageLoopImpl::RegisterTask

###

FlutterMain::Register
  FlutterMain::Init
    MessageLoop::AddTaskObserver
      MessageLoopImpl::AddTaskObserver
      MessageLoopImpl::RemoveTaskObserver

settings.task_observer_add就是添加的方法。

UIDartState::AddOrRemoveTaskObserver

这里添加的是vUIDartState::FlushMicrotasksNow

###

MessageLoop::RunExpiredTasks
  Dart_HandleMessage
    HandleOOBMessage
    
###


在Thread::Thread()创建过程，以及AndroidShellHolder()初始化的过程：
    MessageLoop::EnsureInitializedForCurrentThread
      MessageLoop::MessageLoop()
        MessageLoopImpl::Create
          MessageLoopAndroid()
            MessageLoopAndroid::OnEventFired
                MessageLoop::RunExpiredTasksNow
                  MessageLoopImpl::RunExpiredTasksNow
                    MessageLoopImpl::RunExpiredTasks



TaskRunner, MessageLoopImpl之间的关系
