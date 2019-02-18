---
layout: post
title:  "理解Android P内部API的限制调用机制"
date:   2019-01-26 23:21:12
catalog:  true
tags:
    - android
    - 实战案例

---

> 本文基于原生Android 9.0源码来解读hidden API的限制调用机制

```Java
libcore/ojluni/src/main/java/java/lang/Class.java
art/runtime/native/java_lang_Class.cc
art/runtime/hidden_api.h
art/runtime/runtime.h
```

## 一、引言

每一次Android大版本的升级，往往会有大量的APP出现兼容性问题，导致这个情况的主要原因是由于APP的热修复SDKs以及依赖Android internal API(内部API)，也就是非SDK API。这些API是指标记@hide的类、方法以及字段，它们不属于官方Android SDK的字段与函数。

Google希望未来Android大版本升级，APP都能正常运行，而很多APP对内部API的调用通过反射或JNI间接调用的方法来调用，破坏兼容性。
为此Google从Android P开始限制对内部API的使用，继续使用则抛出如下异常。

![hidden-api-exp](/images/hidden-api/hidden-api-exp.png)

虽然Google目前对这个限制使用不是很完善，存在一些漏洞，可能有些APP会利用漏洞继续使用，但这是不推荐的方式，标记@hide的类、方法以及字段在跨版本之间的兼容性将会无法保障，如果继续使用，那么后续出现兼容性问题将不再另行通知。因此，建议APP减少使用非SDK接口以提升稳定性。开发者都是按Google的预期使用公平的SDK或者NDK，对于开发者便于维护，对于用户体验更一致，大大有利于Android生态的健康发展。

Android 7.0对Native的NDK的调用限制是手铐，而Android 9.0对Java层SDK的调用限制就是脚铐，那么对于Android应用想再搞一些插件化之类的黑科技便是带着脚手铐跳舞，即便能跳但舞姿已不太优雅了。

## 二、内部API限制

Android P限制APP对内部API的调用，而内部API只能通过反射或JNI间接调用，那么限制机制必然是在反射和JNI方法调用链中插入判断逻辑。
在下面小节2.4.2会讲述到所有的限制场景，这里以反射获取方法的getDeclaredMethod()为例来展开说明，其他反射或JNI调用也是类似的逻辑。

### 2.1 getDeclaredMethod

```Java
@CallerSensitive
public Method getDeclaredMethod(String name, Class<?>... parameterTypes)
    throws NoSuchMethodException, SecurityException {
    return getMethod(name, parameterTypes, false);  //【见小节2.2】
}
```

### 2.2 getMethod

```Java
private Method getMethod(String name, Class<?>[] parameterTypes, boolean recursivePublicMethods)
        throws NoSuchMethodException {
    if (name == null) {  //方法名不能为空
        throw new NullPointerException("name == null");
    }
    if (parameterTypes == null) {
        parameterTypes = EmptyArray.CLASS;
    }
    for (Class<?> c : parameterTypes) {
        if (c == null) {  //参数不能为空
            throw new NoSuchMethodException("parameter type is null");
        }
    }
    //非public方法，则执行getDeclaredMethodInternal【见小节2.3】
    Method result = recursivePublicMethods ? getPublicMethodRecursive(name, parameterTypes)
                                           : getDeclaredMethodInternal(name, parameterTypes);
    //找不到，则抛出异常
    if (result == null ||
        (recursivePublicMethods && !Modifier.isPublic(result.getAccessFlags()))) {
        throw new NoSuchMethodException(name + " " + Arrays.toString(parameterTypes));
    }
    return result;
}
```

### 2.3 getDeclaredMethodInternal

```Java
@FastNative
private native Method getDeclaredMethodInternal(String name, Class<?>[] args);
```
getDeclaredMethodInternal这是一个native方法，经过JNI调用，进入如下方法：

[-> java_lang_Class.cc]

```CPP
static jobject Class_getDeclaredMethodInternal(JNIEnv* env, jobject javaThis,
                                               jstring name, jobjectArray args) {
  ScopedFastNativeObjectAccess soa(env);
  StackHandleScope<1> hs(soa.Self());
  DCHECK_EQ(Runtime::Current()->GetClassLinker()->GetImagePointerSize(), kRuntimePointerSize);
  DCHECK(!Runtime::Current()->IsActiveTransaction());
  Handle<mirror::Method> result = hs.NewHandle(
      mirror::Class::GetDeclaredMethodInternal<kRuntimePointerSize, false>(
          soa.Self(),
          DecodeClass(soa, javaThis),
          soa.Decode<mirror::String>(name),
          soa.Decode<mirror::ObjectArray<mirror::Class>>(args)));
  //检测该方法是否允许访问【小节2.4】
  if (result == nullptr || ShouldBlockAccessToMember(result->GetArtMethod(), soa.Self())) {
    return nullptr;
  }
  return soa.AddLocalReference<jobject>(result.Get());
}
```

### 2.4 ShouldBlockAccessToMember
[-> java_lang_Class.cc]

```CPP
template<typename T>
ALWAYS_INLINE static bool ShouldBlockAccessToMember(T* member, Thread* self)
    REQUIRES_SHARED(Locks::mutator_lock_) {
  //【小节2.5】
  hiddenapi::Action action = hiddenapi::GetMemberAction(
      member, self, IsCallerTrusted, hiddenapi::kReflection);
  //对于不是允许级别的接口，则通知相应监听器
  if (action != hiddenapi::kAllow) {
    hiddenapi::NotifyHiddenApiListener(member);
  }
  return action == hiddenapi::kDeny;
}
```

这里是限制反射访问，此处的access_method等于hiddenapi::kReflection，除此之外还有其他几种模式，如下

#### 2.4.1 AccessMethod

```CPP
enum AccessMethod {
  kNone,        // 测试模式，不会出现在实际场景访问权限
  kReflection,  // Java反射调用
  kJNI,         // JNI调用过程
  kLinking,     // 动态链接过程
};
```

#### 2.4.2 限制场景

ShouldBlockAccessToMember是限制内部API访问的核心路径

- kReflection反射过程：
    - Class_newInstance：对象实例化
    - Class_getDeclaredConstructorInternal：构造方法
    - Class_getDeclaredMethodInternal：获取方法
    - Class_getDeclaredField：获取字段
    - Class_getPublicFieldRecursive：获取字段
- kJNI的JNI调用过程：
    - FindMethodID：查找方法
    - FindFieldID：查找字段
- kLinking动态链接：
    - UnstartedClassNewInstance
    - UnstartedClassGetDeclaredConstructor
    - UnstartedClassGetDeclaredMethod
    - UnstartedClassGetDeclaredField

### 2.5  GetMemberAction
[-> hidden_api.h]

```CPP
template<typename T>
inline Action GetMemberAction(T* member,
                              Thread* self,
                              std::function<bool(Thread*)> fn_caller_is_trusted,
                              AccessMethod access_method)
    REQUIRES_SHARED(Locks::mutator_lock_) {
  //获取hidenn API的可访问标识
  HiddenApiAccessFlags::ApiList api_list = member->GetHiddenApiAccessFlags();

  //获取相应的访问行为【小节2.6】
  Action action = GetActionFromAccessFlags(member->GetHiddenApiAccessFlags());
  if (action == kAllow) {  //允许则直接返回
    return action;
  }

   //检测是否平台调用【小节2.7】
  if (fn_caller_is_trusted(self)) {
    return kAllow;
  }

  //对于hidden接口，且非平台调用【小节2.8】
  return detail::GetMemberActionImpl(member, api_list, action, access_method);
}
```

功能说明：

- 当Action=kAllow，则直接返回；否则执行如下：
- 通过fn_caller_is_trusted看当前是否是系统调用的，如果是系统调用则返回，否则执行如下：
- 通过GetMemberActionImpl()做进一步判断

此处的fn_caller_is_trusted是指IsCallerTrusted

### 2.6 GetActionFromAccessFlags
[-> hidden_api.h]

```CPP
inline Action GetActionFromAccessFlags(HiddenApiAccessFlags::ApiList api_list) {
  if (api_list == HiddenApiAccessFlags::kWhitelist) {
    return kAllow;   //位于白名单，则允许访问
  }

  EnforcementPolicy policy = Runtime::Current()->GetHiddenApiEnforcementPolicy();
  if (policy == EnforcementPolicy::kNoChecks) {
    return kAllow;  //非强制执行策略，则允许访问
  }

  if (policy == EnforcementPolicy::kJustWarn) {
    return kAllowButWarn;
  }
  
  //执行到这，policy>=kDarkGreyAndBlackList
  if (static_cast<int>(policy) > static_cast<int>(api_list)) {
    return api_list == HiddenApiAccessFlags::kDarkGreylist
        ? kAllowButWarnAndToast : kAllowButWarn;
  } else {
    return kDeny;
  }
}
```

以上逻辑用图来展示EnforcementPolicy和HiddenApiAccessFlags在不同取值的情况下，所对应的Action值。
纵轴代表强制策略级别，横轴代表隐藏API的标识，表中数据代表Action，如下所示：

|-|        kWhitelist|	kLightGreylist |	kDarkGreylist|	kBlacklist|
|kNoChecks|	kAllow|	kAllow|	kAllow|	kAllow|
|kJustWarn|	kAllow|	kAllowButWarn|	kAllowButWarn|	kAllowButWarn|
|kDarkGreyAndBlackList|	kAllow|	kAllowButWarn|	kDeny|	kDeny|
|kBlacklistOnly|	kAllow|	kAllowButWarn|	kAllowButWarnAndToast|	kDeny|

图解：

- 当HiddenApiAccessFlags等于kWhitelist，则Action=kAllow，否则如下
- 当EnforcementPolicy等于kNoChecks，则Action=kAllow，否则如下
- 当EnforcementPolicy等于kJustWarn，则Action=kAllowButWarn，否则如下
- 当HiddenApiAccessFlags等于kLightGreylist，则Action=kAllowButWarn，否则如下
- 当HiddenApiAccessFlags等于kDarkGreylist，且等于EnforcementPolicy=kBlacklistOnly，则kAllowButWarnAndToast，否则如下
- 否则Action=kDeny


#### 2.6.1 EnforcementPolicy
EnforcementPolicy的级别如下：

```CPP
enum class EnforcementPolicy {
  kNoChecks             = 0,
  kJustWarn             = 1,  // 保持检查，一切都允许(仅仅记录日志)
  kDarkGreyAndBlackList = 2,  // 禁止深灰色和黑名单
  kBlacklistOnly        = 3,  // 只禁止黑名单
  kMax = kBlacklistOnly,
};​
```

可通过SetHiddenApiEnforcementPolicy()来修改Runtime中的成员变量hidden_api_policy_。

#### 2.6.2 HiddenApiAccessFlags
HiddenApiAccessFlags的级别如下：

```Java
class HiddenApiAccessFlags {
 public:
  enum ApiList {
    kWhitelist = 0,
    kLightGreylist,
    kDarkGreylist,
    kBlacklist,
  };
}
```

#### 2.6.3 Action
Action级别如下：

```Java
enum Action {
  kAllow,         //通过
  kAllowButWarn,  //通过，但日志警告
  kAllowButWarnAndToast,  //通过，且日志警告和弹窗
  kDeny   //拒绝访问
};
```

### 2.7 IsCallerTrusted
[-> java_lang_Class.cc]

```CPP
static bool IsCallerTrusted(Thread* self) REQUIRES_SHARED(Locks::mutator_lock_) {
    ...
    FirstExternalCallerVisitor visitor(self);
    visitor.WalkStack();
    //【见小节2.7.1】
    return visitor.caller != nullptr &&
           hiddenapi::IsCallerTrusted(visitor.caller->GetDeclaringClass());
    }
```

#### 2.7.1 IsCallerTrusted
[-> hidden_api.h]

```CPP
ALWAYS_INLINE
inline bool IsCallerTrusted(ObjPtr<mirror::Class> caller,
                            ObjPtr<mirror::ClassLoader> caller_class_loader,
                            ObjPtr<mirror::DexCache> caller_dex_cache)
    REQUIRES_SHARED(Locks::mutator_lock_) {
  if (caller_class_loader.IsNull()) {
    return true;  // Boot classloader，则返回true
  }

  if (!caller_dex_cache.IsNull()) {
    const DexFile* caller_dex_file = caller_dex_cache->GetDexFile();
    if (caller_dex_file != nullptr && caller_dex_file->IsPlatformDexFile()) {
      return true;  // caller是平台dex文件，则返回true
    }
  }

  if (!caller.IsNull() &&
      caller->ShouldSkipHiddenApiChecks() &&
      Runtime::Current()->IsJavaDebuggable()) {
    return true;  //处于debuggable调试模式且caller已被标记可信任，则返回true
  }
  return false;
}
```

caller被认为是可信任的场景如下：

- 当类加载器是Boot classloader，则返回true
- 当caller是平台dex文件，则返回true
- 处于debuggable调试模式且caller已被标记可信任，则返回true

### 2.8 GetMemberActionImpl
[-> hidden_api.cc]

```Java
template<typename T>
Action GetMemberActionImpl(T* member,
                           HiddenApiAccessFlags::ApiList api_list,
                           Action action,
                           AccessMethod access_method) {
  //获取签名
  MemberSignature member_signature(member);
  Runtime* runtime = Runtime::Current();

  const bool shouldWarn = kLogAllAccesses || runtime->IsJavaDebuggable();
  if (shouldWarn || action == kDeny) {
    //判断是否为可豁免接口【小节2.8.1】
    if (member_signature.IsExempted(runtime->GetHiddenApiExemptions())) {
      action = kAllow;
      MaybeWhitelistMember(runtime, member);
      return kAllow;    
    }

    if (access_method != kNone) {
      //打印包含有关此类成员访问信息的日志消息【小节2.8.2】
      member_signature.WarnAboutAccess(access_method, api_list);
    }
  }
  ...
  if (action == kDeny) {
    return action; //拒绝调用
  }

  if (access_method != kNone) {
    // 根据运行时标志的不同，我们可以将成员移动到白名单中，并在下次访问成员时跳过警告。
    MaybeWhitelistMember(runtime, member);

    //如果此操作需要UI警告，设置适当的标志
    if (shouldWarn &&
        (action == kAllowButWarnAndToast || runtime->ShouldAlwaysSetHiddenApiWarningFlag())) {
      runtime->SetPendingHiddenApiWarning(true);
    }
  }

  return action;
}
```

#### 2.8.1 GetHiddenApiExemptions
[-> runtime.h]

```CPP
class Runtime {
    ...
    // SetHiddenApiEnforcementPolicy()可修改该值
    hiddenapi::EnforcementPolicy hidden_api_policy_;

    //SetHiddenApiExemptions()可修改该值
    std::vector<std::string> hidden_api_exemptions_;
    ...
}
```

GetHiddenApiExemptions()是获取Runtime里面的成员变量hidden_api_exemptions_

#### 2.8.2 WarnAboutAccess
[-> hidden_api.cc]

```CPP
void MemberSignature::WarnAboutAccess(AccessMethod access_method,
                                      HiddenApiAccessFlags::ApiList list) {
  LOG(WARNING) << "Accessing hidden " << (type_ == kField ? "field " : "method ")
               << Dumpable<MemberSignature>(*this) << " (" << list << ", " << access_method << ")";
```

打印包含有关此类成员访问信息的日志消息


## 三、总结

#### 3.1 限制原理总结

（1）从前面的内部API限制过程，可知主要控制逻辑在方法ShouldBlockAccessToMember，调用该方法的核心路径如下：

- kReflection反射过程：
    - Class_newInstance：对象实例化
    - Class_getDeclaredConstructorInternal：构造方法
    - Class_getDeclaredMethodInternal：获取方法
    - Class_getDeclaredField：获取字段
    - Class_getPublicFieldRecursive：获取字段
- kJNI的JNI调用过程：
    - FindMethodID：查找方法
    - FindFieldID：查找字段
- kLinking动态链接：
    - UnstartedClassNewInstance
    - UnstartedClassGetDeclaredConstructor
    - UnstartedClassGetDeclaredMethod
    - UnstartedClassGetDeclaredField


（2）ShouldBlockAccessToMember过程是否运行主要有如下情况：

- 当EnforcementPolicy强制不限制的情况
- 当类加载器是Boot classloader的情况
- 当caller是平台dex文件的情况
- 当处于debuggable调试模式且caller已被标记可信任的情况
- 当GetHiddenApiExemptions为豁免情况


（3）掌握了ShouldBlockAccessToMember原理，也就可以有的放矢了，突破限制方案，比如：

- 修改ART的EnforcementPolicy，也就是Runtime中的成员变量hidden_api_policy_，可以基于地址偏移找到相应的成员，这就不就细说
- 修改隐藏API豁免变量，也就是Runtime中的成员变量hidden_api_exemptions_
- 修改classLoader为BootClassLoader

#### 3.2 黑白名单
关于在Android P的几个预览版本一直在不断调整，目前主要是黑名单、浅灰名单、vendor名单这3个名单，对应文件名：hiddenapi-force-blacklist.txt，hiddenapi-light-greylist.txt，hiddenapi-vendor-list.txt。这些文件在编译阶段生成为hiddenapi，记录在access_flags_字段值。整个过程是在hiddenapi.cc过程的CategorizeAllClasses()中完成的。

![hidden-api-exp](/images/hidden-api/android_hideapi.png)

目前主要使用的是黑名单和浅灰名单，深灰名单暂没有使用：

- 黑名单内容：setHiddenApiExemptions
- 浅灰名单内容：Activity, Service，ContentProvider，ActivityManager, ActivityThread，Application，ContextImpl，Intent等

#### 3.3 非SDK接口说明

1. 非SDK接口限制适用于所有应用，但是会豁免使用平台密钥签署的应用，并且针对系统app的白名单
2. 如果你的应用有必须使用非SDK接口的充分理由，可以向Google提交[功能请求](https://issuetracker.google.com/issues/new?component=328403&template=1027267)，并提供用例详情;
3. 如果你的应用使用很多第三方库，而又难以排除是否正在使用非SDK接口，可以尝试使用AOSP提供的静态分析工具[veridex](https://android.googlesource.com/platform/prebuilts/runtime/+/master/appcompat);
4. 应用运行时检测到非SDK接口的使用，会打印一条`Accessing hidden field|method ...` 形式的logcat警告。当然对于设置android:debuggable=true的可调试应用会显示toast消息，并打印logcat日志。
5. 黑名单/灰名单编码在平台dex文件的字段和函数访问标志位中，无法从系统镜像中找到单独包含这些名单的文件。
6. 黑名单/灰名单在采用相同Android版本是一致的。手机厂商可以向黑名单添加自己的API，但无法从AOSP黑名单或灰名单中移除，Google兼容性定义文件(CDD)来保障这一工作，并在测试过程通过CTS来确保Android运行时强制执行名单。
7. 目前，Google对Android暂时没有限制访问dex2oat二进制文件的计划，但是dex文件格式无法保证会稳定，可能随时会修改或删除dex2oat以及dex衍生文件。

Android 7.0针对Native lib引入了namespace来限制平台lib对外的可见性，普通APP在Android N上不能直接调用系统私有库，Android系统允许调用的公用库定义在[public.libraries.android.txt](https://android.googlesource.com/platform/system/core/+/refs/heads/master/rootdir/etc/public.libraries.android.txt)。 这个feature只针对target SDK为24及以上的APP。

Android 7.0限制对C/C++代码的NDK，Android 9.0限制对Java的SDK。这一以来APP想利用内部API搞黑科技的难度以及不稳定性都会有所增加。

最后说一点，目前网络有一些开发者发表了关于非SDK接口限制的绕过技术，但基本没有APP是通过这些漏洞方式来突破隐藏API的访问，说明大家有所顾忌，这对生态来说是好事。另外关于绕过技术对于Google和手机厂商都已注意到，要简单封杀容易但可能会带来调试与复杂度的提升，所以Google正在积极寻找平衡接口限制与运行时易于调试之间的平衡，相信很快Google会有更完善的解决方案。
