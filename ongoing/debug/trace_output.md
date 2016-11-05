### 相关源码

    art/runtime/gc/heap.cc
    /art/runtime/
        signal_catcher.cc
        runtime.cc
        intern_table.cc
        thread_list.cc
        java_vm_ext.cc
        class_linker.cc



当signal_catcher线程收到 signal 3信息的时候便会进入如下方法来打印信息:


### 1.  SignalCatcher::HandleSigQuit
[-> signal_catcher.cc]

    void SignalCatcher::HandleSigQuit() {
      Runtime* runtime = Runtime::Current();
      std::ostringstream os;
      os << "\n" << "----- pid " << getpid() << " at " << GetIsoDate() << " -----\n";

      DumpCmdLine(os);

      std::string fingerprint = runtime->GetFingerprint();
      os << "Build fingerprint: '" << (fingerprint.empty() ? "unknown" : fingerprint) << "'\n";
      os << "ABI: '" << GetInstructionSetString(runtime->GetInstructionSet()) << "'\n";
      os << "Build type: " << (kIsDebugBuild ? "debug" : "optimized") << "\n";
      // [见下节]
      runtime->DumpForSigQuit(os);

      os << "----- end " << getpid() << " -----\n";
      Output(os.str());
    }

### 2. Runtime::DumpForSigQuit
[-> runtime.cc]

    void Runtime::DumpForSigQuit(std::ostream& os) {
      GetClassLinker()->DumpForSigQuit(os); //[2.1]
      GetInternTable()->DumpForSigQuit(os); //[2.2]
      GetJavaVM()->DumpForSigQuit(os); //[2.3]
      GetHeap()->DumpForSigQuit(os); //[2.4]
      TrackedAllocators::Dump(os);
      os << "\n";

      thread_list_->DumpForSigQuit(os); //[2.5]
      BaseMutex::DumpAll(os);
    }

#### 2.1 ClassLinker
class_linker.cc

    void ClassLinker::DumpForSigQuit(std::ostream& os) {
      Thread* self = Thread::Current();
      if (dex_cache_image_class_lookup_required_) {
        ScopedObjectAccess soa(self);
        MoveImageClassesToClassTable();
      }
      ReaderMutexLock mu(self, *Locks::classlinker_classes_lock_);
      os << "Zygote loaded classes=" << pre_zygote_class_table_.Size() << " post zygote classes="
         << class_table_.Size() << "\n";
    }

#### 2.2 InternTable
intern_table.cc

    void InternTable::DumpForSigQuit(std::ostream& os) const {
      os << "Intern table: " << StrongSize() << " strong; " << WeakSize() << " weak\n";
    }

#### 2.3 JavaVMExt
java_vm_ext.cc

    void JavaVMExt::DumpForSigQuit(std::ostream& os) {
      os << "JNI: CheckJNI is " << (check_jni_ ? "on" : "off");
      if (force_copy_) {
        os << " (with forcecopy)";
      }
      Thread* self = Thread::Current();
      {
        ReaderMutexLock mu(self, globals_lock_);
        os << "; globals=" << globals_.Capacity();
      }
      {
        MutexLock mu(self, weak_globals_lock_);
        if (weak_globals_.Capacity() > 0) {
          os << " (plus " << weak_globals_.Capacity() << " weak)";
        }
      }
      os << '\n';

      {
        MutexLock mu(self, *Locks::jni_libraries_lock_);
        os << "Libraries: " << Dumpable<Libraries>(*libraries_) << " (" << libraries_->size() << ")\n";
      }
    }

#### 2.4 Heap
heap.cc

    void Heap::DumpForSigQuit(std::ostream& os) {
      os << "Heap: " << GetPercentFree() << "% free, " << PrettySize(GetBytesAllocated()) << "/"
         << PrettySize(GetTotalMemory()) << "; " << GetObjectsAllocated() << " objects\n";
      DumpGcPerformanceInfo(os);  //输出大量gc相关的信息
    }

#### 2.5 ThreadList
[-> thread_list.cc]

    void ThreadList::DumpForSigQuit(std::ostream& os) {
        {
            ScopedObjectAccess soa(Thread::Current());

            if (suspend_all_historam_.SampleSize() > 0) {
              Histogram<uint64_t>::CumulativeData data;
              suspend_all_historam_.CreateHistogram(&data);
              suspend_all_historam_.PrintConfidenceIntervals(os, 0.99, data);  // Dump time to suspend.
            }
        }
        Dump(os);
        DumpUnattachedThreads(os);
    }

##### 2.5.1 Dump
[-> thread_list.cc]

    void ThreadList::Dump(std::ostream& os) {
      {
        MutexLock mu(Thread::Current(), *Locks::thread_list_lock_);
        os << "DALVIK THREADS (" << list_.size() << "):\n";
      }
      DumpCheckpoint checkpoint(&os);
      size_t threads_running_checkpoint = RunCheckpoint(&checkpoint);
      if (threads_running_checkpoint != 0) {
        checkpoint.WaitForThreadsToRunThroughCheckpoint(threads_running_checkpoint);
      }
    }

##### 2.5.2 DumpUnattachedThreads
[-> thread_list.cc]

    void ThreadList::DumpUnattachedThreads(std::ostream& os) {
      DIR* d = opendir("/proc/self/task");
      if (!d) {
        return;
      }

      Thread* self = Thread::Current();
      dirent* e;
      while ((e = readdir(d)) != nullptr) {
        char* end;
        pid_t tid = strtol(e->d_name, &end, 10);
        if (!*end) {
          bool contains;
          {
            MutexLock mu(self, *Locks::thread_list_lock_);
            contains = Contains(tid);
          }
          if (!contains) {
            DumpUnattachedThread(os, tid); //[见下文3.1]
          }
        }
      }
      closedir(d);
    }

`DALVIK THREADS (25)`代表的是当前虚拟机中的线程个数为25

## 三. 真正的输出

### 3.1 DumpUnattachedThread
[-> thread_list.cc]

    static void DumpUnattachedThread(std::ostream& os, pid_t tid) NO_THREAD_SAFETY_ANALYSIS {
      Thread::DumpState(os, nullptr, tid); //[见下文3.2]
      DumpKernelStack(os, tid, "  kernel: ", false);

      if (false) {
        DumpNativeStack(os, tid, "  native: ");
      }
      os << "\n";
    }

### 3.1 Thread::DumpState
[-> thread.cc]


    void Thread::DumpState(std::ostream& os, const Thread* thread, pid_t tid) {
      std::string group_name;
      int priority;
      bool is_daemon = false;
      Thread* self = Thread::Current();

      if (thread != nullptr) {
        ScopedObjectAccessUnchecked soa(self);
        Thread* this_thread = const_cast<Thread*>(thread);
        Closure* flip_func = this_thread->GetFlipFunction();
        if (flip_func != nullptr) {
          flip_func->Run(this_thread);
        }
      }

      if (gAborting == 0 && self != nullptr && thread != nullptr && thread->tlsPtr_.opeer != nullptr) {
        ScopedObjectAccessUnchecked soa(self);
        priority = soa.DecodeField(WellKnownClasses::java_lang_Thread_priority)
            ->GetInt(thread->tlsPtr_.opeer);
        is_daemon = soa.DecodeField(WellKnownClasses::java_lang_Thread_daemon)
            ->GetBoolean(thread->tlsPtr_.opeer);

        mirror::Object* thread_group =
            soa.DecodeField(WellKnownClasses::java_lang_Thread_group)->GetObject(thread->tlsPtr_.opeer);

        if (thread_group != nullptr) {
          ArtField* group_name_field =
              soa.DecodeField(WellKnownClasses::java_lang_ThreadGroup_name);
          mirror::String* group_name_string =
              reinterpret_cast<mirror::String*>(group_name_field->GetObject(thread_group));
          group_name = (group_name_string != nullptr) ? group_name_string->ToModifiedUtf8() : "<null>";
        }
      } else {
        priority = GetNativePriority();
      }

      std::string scheduler_group_name(GetSchedulerGroupName(tid));
      if (scheduler_group_name.empty()) {
        scheduler_group_name = "default";
      }

      if (thread != nullptr) {
        os << '"' << *thread->tlsPtr_.name << '"';
        if (is_daemon) {
          os << " daemon";
        }
        os << " prio=" << priority
           << " tid=" << thread->GetThreadId()
           << " " << thread->GetState();  //获取线程状态
        if (thread->IsStillStarting()) {
          os << " (still starting up)";
        }
        os << "\n";
      } else {
        os << '"' << ::art::GetThreadName(tid) << '"'
           << " prio=" << priority
           << " (not attached)\n";
      }

      if (thread != nullptr) {
        MutexLock mu(self, *Locks::thread_suspend_count_lock_);
        os << "  | group=\"" << group_name << "\""
           << " sCount=" << thread->tls32_.suspend_count
           << " dsCount=" << thread->tls32_.debug_suspend_count
           << " obj=" << reinterpret_cast<void*>(thread->tlsPtr_.opeer)
           << " self=" << reinterpret_cast<const void*>(thread) << "\n";
      }

      os << "  | sysTid=" << tid
         << " nice=" << getpriority(PRIO_PROCESS, tid)
         << " cgrp=" << scheduler_group_name;
      if (thread != nullptr) {
        int policy;
        sched_param sp;
        CHECK_PTHREAD_CALL(pthread_getschedparam, (thread->tlsPtr_.pthread_self, &policy, &sp),
                           __FUNCTION__);
        os << " sched=" << policy << "/" << sp.sched_priority
           << " handle=" << reinterpret_cast<void*>(thread->tlsPtr_.pthread_self);
      }
      os << "\n";

      std::string scheduler_stats;
      if (ReadFileToString(StringPrintf("/proc/self/task/%d/schedstat", tid), &scheduler_stats)) {
        scheduler_stats.resize(scheduler_stats.size() - 1);  // Lose the trailing '\n'.
      } else {
        scheduler_stats = "0 0 0";
      }

      char native_thread_state = '?';
      int utime = 0;
      int stime = 0;
      int task_cpu = 0;
      GetTaskStats(tid, &native_thread_state, &utime, &stime, &task_cpu);

      os << "  | state=" << native_thread_state
         << " schedstat=( " << scheduler_stats << " )"
         << " utm=" << utime
         << " stm=" << stime
         << " core=" << task_cpu
         << " HZ=" << sysconf(_SC_CLK_TCK) << "\n";
      if (thread != nullptr) {
        os << "  | stack=" << reinterpret_cast<void*>(thread->tlsPtr_.stack_begin) << "-"
            << reinterpret_cast<void*>(thread->tlsPtr_.stack_end) << " stackSize="
            << PrettySize(thread->tlsPtr_.stack_size) << "\n";

        os << "  | held mutexes=";
        for (size_t i = 0; i < kLockLevelCount; ++i) {
          if (i != kMonitorLock) {
            BaseMutex* mutex = thread->GetHeldMutex(static_cast<LockLevel>(i));
            if (mutex != nullptr) {
              os << " \"" << mutex->GetName() << "\"";
              if (mutex->IsReaderWriterMutex()) {
                ReaderWriterMutex* rw_mutex = down_cast<ReaderWriterMutex*>(mutex);
                if (rw_mutex->GetExclusiveOwnerTid() == static_cast<uint64_t>(tid)) {
                  os << "(exclusive held)";
                } else {
                  os << "(shared held)";
                }
              }
            }
          }
        }
        os << "\n";
      }
    }

#### 3.2.1 GetState
[-> art/runtime/thread.h]

    ThreadState GetState() const {
       DCHECK_GE(tls32_.state_and_flags.as_struct.state, kTerminated);
       DCHECK_LE(tls32_.state_and_flags.as_struct.state, kSuspended);
       return static_cast<ThreadState>(tls32_.state_and_flags.as_struct.state);
    }

状态表:

    kStarting,                        // NEW            TS_WAIT      native thread started, not yet ready to run managed code
    kTerminated,                      // TERMINATED     TS_ZOMBIE    Thread.run has returned, but Thread* still around
    kRunnable,                        // RUNNABLE       TS_RUNNING   runnable
    kNative,                          // RUNNABLE       TS_RUNNING   running in a JNI native method
    kSuspended,                       // RUNNABLE       TS_RUNNING   suspended by GC or debugger

    kBlocked,                         // BLOCKED        TS_MONITOR   blocked on a monitor
    kSleeping,                        // TIMED_WAITING  TS_SLEEPING  in Thread.sleep()
    kTimedWaiting,                    // TIMED_WAITING  TS_WAIT      in Object.wait() with a timeout
    kWaiting,                         // WAITING        TS_WAIT      in Object.wait()

    kWaitingForGcToComplete,          // WAITING        TS_WAIT      blocked waiting for GC
    kWaitingForCheckPointsToRun,      // WAITING        TS_WAIT      GC waiting for checkpoints to run
    kWaitingPerformingGc,             // WAITING        TS_WAIT      performing GC
    kWaitingForDebuggerSend,          // WAITING        TS_WAIT      blocked waiting for events to be sent
    kWaitingForDebuggerToAttach,      // WAITING        TS_WAIT      blocked waiting for debugger to attach
    kWaitingInMainDebuggerLoop,       // WAITING        TS_WAIT      blocking/reading/processing debugger events
    kWaitingForDebuggerSuspension,    // WAITING        TS_WAIT      waiting for debugger suspend all
    kWaitingForJniOnLoad,             // WAITING        TS_WAIT      waiting for execution of dlopen and JNI on load code
    kWaitingForSignalCatcherOutput,   // WAITING        TS_WAIT      waiting for signal catcher IO to complete
    kWaitingInMainSignalCatcherLoop,  // WAITING        TS_WAIT      blocking/reading/processing signals
    kWaitingForDeoptimization,        // WAITING        TS_WAIT      waiting for deoptimization suspend all
    kWaitingForMethodTracingStart,    // WAITING        TS_WAIT      waiting for method tracing to start
    kWaitingForVisitObjects,          // WAITING        TS_WAIT      waiting for visiting objects
    kWaitingForGetObjectsAllocated,   // WAITING        TS_WAIT      waiting for getting the number of allocated objects


[-> kernel/include/linux/sched.h]

    #define TASK_RUNNING		0         //R
    #define TASK_INTERRUPTIBLE	1         //S
    #define TASK_UNINTERRUPTIBLE	2     //D
    #define __TASK_STOPPED		4         //T
    #define __TASK_TRACED		8         //T
    #define EXIT_ZOMBIE		16            //Z
    #define EXIT_DEAD		32            //X


进程状态: R/S/D/T/Z/X

R: Runnable, Native, Suspended
S: TimedWaiting, Waiting, Sleeping, Native,  Blocked

### 3.3 DumpKernelStack
[-> art/runtime/utils.cc]

    void DumpKernelStack(std::ostream& os, pid_t tid, const char* prefix, bool include_count) {
      if (tid == GetTid()) {
        return;
      }

      std::string kernel_stack_filename(StringPrintf("/proc/self/task/%d/stack", tid));
      std::string kernel_stack;
      if (!ReadFileToString(kernel_stack_filename, &kernel_stack)) {
        os << prefix << "(couldn't read " << kernel_stack_filename << ")\n";
        return;
      }

      std::vector<std::string> kernel_stack_frames;
      Split(kernel_stack, '\n', &kernel_stack_frames);

      kernel_stack_frames.pop_back();
      for (size_t i = 0; i < kernel_stack_frames.size(); ++i) {

        const char* text = kernel_stack_frames[i].c_str();
        const char* close_bracket = strchr(text, ']');
        if (close_bracket != nullptr) {
          text = close_bracket + 2;
        }
        os << prefix;
        if (include_count) {
          os << StringPrintf("#%02zd ", i);
        }
        os << text << "\n";
      }
    }
