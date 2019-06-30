AndroidShellHolder(1) -> Shell(1) -> Rasterizer(1) -> CompositorContext(1) -> engine_time

这里加一条通路：ui.window -> RuntimeController -> Engine  -> Shell

- 一个Scene对应一个LayerTree

动画的原理是什么？
ui/gpu的每一个过程到底在做什么？
LayerTree对应几个？
