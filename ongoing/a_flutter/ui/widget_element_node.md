

- Widget：存放渲染内容、视图布局信息,widget的属性最好都是immutable(如何更新数据呢？查看后续内容)
- Element：存放上下文，通过Element遍历视图树，Element同时持有Widget和RenderObject
- RenderObject：根据Widget的布局属性进行layout，paint Widget传人的内容

UI操作相关：
https://mp.weixin.qq.com/s/pU75twMDry4VUYtTHeV_IQ
