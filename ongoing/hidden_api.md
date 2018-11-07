前四个Preview 3:

1. 创建黑名单、深灰：hiddenapi-dark-greylist.txt，hiddenapi-blacklist.txt
2. 删除黑名单：hiddenapi-blacklist.txt
3. 创建浅灰、vendor名单：hiddenapi-vendor-list.txt， hiddenapi-light-greylist.txt
4. 删除深灰名单：hiddenapi-dark-greylist.txt
5. 创建黑名单：hiddenapi-force-blacklist.txt

最终： 强制黑，浅灰，vendor
hiddenapi-force-blacklist.txt，hiddenapi-light-greylist.txt，hiddenapi-vendor-list.txt  

txt文件在编译阶段生成为hiddenapi，记录在access_flags_字段值。整个过程是在hiddenapi.cc过程完成的 CategorizeAllClasses()

目前主要是两个黑名单和浅灰名单。

黑名单：setHiddenApiExemptions， 
浅灰名单：Activity, Service，ContentProvider，ActivityManager, ActivityThread，Application，ContextImpl，Intent等


要突破限制，要么伪装成系统调用(调整ClassLoader), 修改hidden api熟悉

解决方案：

1. 修改ART的EnforcementPolicy
1. 修改classLoader为BootClassLoader
2. 修改豁免的signature，GetHiddenApiExemptions方法已放入黑名单

### art

Art/runtime/hidden_api.h

- kAllow：通过
- kAllowButWarn：通过，但日志警告
- kAllowButWarnAndToast：通过，且日志警告和弹窗
- kDeny：拒绝访问

### 调用过程

getDeclaredMethod
  getDeclaredMethodInternal
    Class_getDeclaredMethodInternal  [-> java_lang_Class.cc]
      ShouldBlockAccessToMember
        GetMemberAction [-> hidden_api.h]
          GetActionFromAccessFlags

在GetActionFromAccessFlags()过程：


enum class EnforcementPolicy {
  kNoChecks             = 0,
  kJustWarn             = 1,  // keep checks enabled, but allow everything (enables logging)
  kDarkGreyAndBlackList = 2,  // ban dark grey & blacklist
  kBlacklistOnly        = 3,  // ban blacklist violations only
  kMax = kBlacklistOnly,
};​


kWhitelist
kLightGreylist
kDarkGreylist
kDeny

跟ApplicationInfo设置的级别有关


https://zhuanlan.zhihu.com/p/37819685
