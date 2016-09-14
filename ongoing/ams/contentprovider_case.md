##  揭秘ContentProvider

### 1. 引言

今天，跟大家分享一下作为Android四大组件之一的ContentProvider的那些鲜为人知的秘密。 故事的导火线是由于通话过程或者使用短信过程有低概率出现退出的BUG，并且这些BUG历史悠久，从去年就一直有出现，低概率事件在本地无法复现，很难现场分析。这些BUG都有一个基本特征，让我们锁定在ContentProvider:


am_kill : [0,18624,com.android.mms,0,depends on provider com.miui.yellowpage/.providers.invocation.InvocationProxy in dying proc com.miui.yellowpage]
am_kill : [0,2612,com.android.incallui,1,depends on provider com.miui.yellowpage/.providers.yellowpage.YellowPageProvider in dying proc com.miui.yellowpage]

在bug库里面有着很多由于ContentProvider的坑所造成的bug.

历史比我还悠久
``````````````````````
第一层纱布

第二层纱布

第三层纱布

### 揭秘


### 调试神技

1. 开发者选项

后台进程限制


注意下面3种情况：

 // 当进程对象为空时，则设置curProcState=16， curAdj=15 【这是一个可疑点】
 //top app; isReceivingBroadcast；executingServices；除此之外则为PROCESS_STATE_CACHED_EMPTY【】
 //content provider情况 ，设置为空进程【】

#### 其他

updateOomAdjLocked() 杀空进程

yellowpage 是如何成为ActivityManager.PROCESS_STATE_CACHED_EMPTY的？ 需要查找哪些地方能修改app.curProcState ？

答案是： computeOomAdjLocked()过程导致的修改。


NOT top/recevier/services  =>  2 变成 16

一旦client成为top => 16变成2
