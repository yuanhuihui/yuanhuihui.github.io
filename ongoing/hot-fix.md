热修复fluter， 插件化

阿里AndFix、Sophix，微信Tinker，Andfix 是支付宝提出的一种底层结构替换的方案

360

BAT的框架

美团

安全方面， selinux


AndFix
Dexposed
Sophix

插件化与热修复

### 热修复&插件化

- 插件化：把更多的功能做成解耦合的独立模块，以插件的形式存在，可减少主程序的规模，比如按需加载。四大组件的动态加载
- 热修复：是从修复BUG的角度出发，在无需二次安装的情况下修复已知问题。

热修复机制：DexClassLoader在加载时利用dexElements的顺序来实现，将带有补丁的dex放到dexElements的第一位，则可覆盖老的dex。

从Classloader出发，采用代理、hook、其他底层实现，

#### 各厂商的插件化汇总

- 阿里系
    - Andfix
    - Sophix（甘晓琳）
    - atlas（手淘）
    - DeXposed
- 腾讯系
    - QQ空间的超级补丁方案  （补丁文件很大）
    - 微信的Tinker   （差量包补丁）
- 360
    - dronidPlugin
    - RePlugin （droidcon）
    
#### 对比
- QQ空间，插桩，https://mp.weixin.qq.com/s?__biz=MzI1MTA1MzM2Nw==&mid=400118620&idx=1&sn=b4fdd5055731290eef12ad0d17f39d4a&scene=0#wechat_redirect

Classloader，四大组件生命周期管理，Activity代理，dex加载顺序, xposed版app_process替代原生zygote进程和虚拟机的拦截（通过反射调用，但是Android P已经封杀了这种机制）。修改hook方法，然后挂钩上层Java代码

只需hook一次，坑位法

对比点：支持方法替换、方法增删，方法反射调用，即时生效，多DEX，资源更新，so库更新，android版本支持，安全机制，性能损耗，补丁大小。
插件：Activity生命周期的管理，采用代理方式

解决Activity必须注册，先注册几个代理Activity。启动的时候才是真正的activity

用插件化的性能影响比较大。

Exposed（阿里）
Nuwa（实现类似于QQ空间）
Tinker（微信）

- 腾讯系：微信的Tinker、QQ空间的超级补丁、手机QQ的QFix
- 阿里系：AndFix、Dexposed、阿里百川、Sophix

即时生效，方法替换，类替换，资源替换，so替换，


### 发展历程及现状
关于插件化技术的起源可以追溯到5年前

2012年的 AndroidDynamicLoader ，他的原理是动态加载不同的Fragment实现UI替换，可以说是开山鼻祖了，但是这种方案可扩展性不强。
再到后来出现了23Code,他可以直接下载一个自定义控件的demo，并且运行起来。

2014年一个里程碑式的年份，任玉刚（俗称主席）发布了dynamic-load-apk,也叫做DL。在这个框架里提供了两个很重要的思路：

如何管理插件内Activity的生命周期： 使用 DLProxyActivity 采用静态代理的方式去调用插件中Activity的生命周期方法。
如何加载插件内的资源文件：通过反射调用AssetManager 中到的addAssetPath方法就可以将特定路径的资源加载到系统内存中使用。

以上两点，可以说是非常有意义的，尤其是第二点关于插件资源的记载，是后期出现的许多框架的参考思路。这个框架也有一些局限，不支持插件内Service、BroadcastReceiver等需要注册才能使用的组件，同时插件apk也需要按照其开发规范来实现，总体来说还是有一定的成本，但无论怎样都是一个很有价值的框架。（话说这个框架貌似已经不再维护了，最近一次关于代码的更新都是2年前了，o(╥﹏╥)o）。

2015年 DroidPlugin
DroidPlugin 是Andy Zhang在Android系统上实现了一种新的 插件机制 :它可以在无需安装、修改的情况下运行APK文件,此机制对改进大型APP的架构，实现多团队协作开发具有一定的好处。 这段话是DroidPlugin在Github README 文档中的介绍。这款来自360的插件化框架.
2015年 DynamicAPK 这个就……，貌似因为License的原因已经完全不更新了。
2017 RePlugin 这是360 开源的插件化框架，按照他自己的说法，相较于其他框架，他对系统的hook只有一处，那就是ClassLoader，这样从理论来说，貌似会有更好的稳定性。
2017年 atlas这个是阿里今年刚刚开源的插件化开发框架，可以说是非常强大；具体原理参考详解 Atlas 框架原理；还没有用过。
Small  最后再说一下Small，个人感觉Small 所提供了一种比插件化更高层次的概念，组件化；把一个完整的APP看成是由许多可以复用模块组件组成（这个有点像React Native的开发理念）；开发起来像是搭积木的感觉。有兴趣的可以去Small官网了解一下。

https://www.jianshu.com/p/704cac3eb13d

### Flutter

Flutter是Google开发的一套全新的跨平台、开源UI框架，支持iOS、Android系统开发，并且是未来新操作系统Fuchsia的默认开发套件


Flutter的目标是使同一套代码同时运行在Android和iOS系统上，并且拥有媲美原生应用的性能，Flutter甚至提供了两套控件来适配Android和iOS（滚动效果、字体和控件图标等等），为了让App在细节处看起来更像原生应用。

HTML+JavaScript渲染成原生控件的React Native、Weex等

- Weex：执行性能差，一致性体验差，android版本碎片化问题
- React Native：渲染工作交还给了系统，虽然同样使用类HTML+JS的UI构建逻辑，但是最终会生成对应的自定义原生控件，以充分利用原生控件相对于WebView的较高的绘制效率，框架本身需要处理大量平台相关的逻辑以及Android版本碎片化问题。
- Flutter则开辟了一种全新的思路，从头到尾重写一套跨平台的UI框架，包括UI控件、渲染逻辑甚至开发语言。渲染引擎依靠跨平台的Skia图形库来实现，依赖系统的只有图形绘制相关的接口，可以在最大程度上保证不同平台、不同设备的体验一致性，逻辑处理使用支持AOT的Dart语言，执行效率也比JavaScript高得多。

Flutter所使用的Dart语言同时支持AOT和JIT运行方式，JIT模式下还有一个备受欢迎的开发利器“热刷新”（Hot Reload）

Flutter使用的Dart语言无法直接调用Android系统提供的Java接口，需要使用插件来实现中转。

JIT & AOT运行模式，支持开发时的快速迭代和正式发布后最大程度发挥硬件性能。

JIT? AOT?

安全：加密传输、签名校验
