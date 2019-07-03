fps的性能稳定性监控：
https://www.yuque.com/xytech/flutter/qyr9wx

pipeitem的depth需要再研究一下， https://medium.com/flutter/profiling-flutter-applications-using-the-timeline-a1a434964af3

你们优化的方向？

1. 内存泄露
2. fps问题
3. gpu需要时间，skia花时间
  3.1 简化demo来提issue。 小视频demo
4. pageview的缓存机制，看看能否优化
  3.1 简化demo来提issue
5. 阻尼问题


AndroidShellHolder(1) -> Shell(1) -> Rasterizer(1) -> CompositorContext(1) -> engine_time

这里加一条通路：ui.window -> RuntimeController -> Engine  -> Shell

- 一个Scene对应一个LayerTree

动画的原理是什么？
ui/gpu的每一个过程到底在做什么？
LayerTree对应几个？


- dart-sdk里面的东西？sky_engine，sky_services是什么？


1. 调用栈回溯，遇到lambda/closure就无法查找的问题

1. Profiler::DumpStackTrace(bool for_crash)  
  没有symbols的问题，如何解决？
