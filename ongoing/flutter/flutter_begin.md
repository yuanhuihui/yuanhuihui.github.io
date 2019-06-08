
## 图形渲染引擎

- 跨平台，开发效率高， （跨端切换问题？）
- 热重载，（失效的场景？）
- 媲美原生的高性能渲染
  - Skia作为Flutter SDK的一部分，那么包大小增加，但是Skia优化特性更新速度快。(Skia是不是可以去掉来优化包大小？)

- Skia开源图形引擎
  - 用于Chrome, ANdorid,Firefox, Adobe等。 是Google开源的（Skia的优化是一个点，难度估计比较大？）。 //TODO: 可以研究Skia的源码

-  性能分析工具
  - 渲染柱状图(Performance Overlay)，来区分是UI thread还是GPU thread问题
    - UI是上层逻辑
    - GPU慢是绘图引擎导致的
      - 分析Flutter应用的Skia调用
        - flutter run --profile --trace-skia  //TODO: 试试这个工具命令
      - 捕捉SkPicture分析每一条绘图指令
        - flutter screenshot --type=skia --observatory-port=<port>   //TODO: https://debugger.skia.org/ ，单步分析每一条绘图指令。 看看有没有多余的指令。
      - 场景的Skia函数调用性能瓶颈 （老旧设备能提升2倍性能）
        - saveLayer: 非常费时，每调用一次在GPU分配新的绘图缓冲区，切换绘图目标，尤其是老GPU设置。 //TODO: 只会体现在Skia.flush()耗时长。 GPU性能体验不方便的地方
        - clipPath: 比saveLayer小不少，但依然很高。 如果不是十分必要，不要在app中使用。
        - 现在默认不出现在任何组件（clipBehavior：Clip。none），只有Opacity，ShaderMask才使用以上两个函数


工具： Dart VM observatory, SkDebugger, Dart DevTools, Performance Overlay


疑难性能问题： github.com/flutter/flutter/issues.


Google Flutter： 于潇

https://flutter.github.io/devtools/inspector
flutter run --track-widget-creation
