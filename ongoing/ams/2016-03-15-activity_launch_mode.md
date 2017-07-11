---
layout: post
title:  "Activity启动模式分析"
date:   2016-01-17 20:12:50
categories: android
excerpt:  
---

* content
{:toc}


---

> 基于Android 6.0的源码剖析， 分析Activity启动模式

Activity启动模式有4种：standard、singleTop、singleTask和singleInstance。

Task,Activity

stack

- standard：一个Task中可以有多个相同类型的Activity。注意，此处是相同类型的Activity，而不是同一个Activity对象。例如在Task中有A、B、C、D4个Activity，如果再启动A类Activity， Task就会变成A、B、C、D、A。最后一个A和第一个A是同一类型，却并非同一对象。另外，多个Task中也可以有同类型的Activity。
- singleTop：当某Task中有A、B、C、D4个Activity时，如果D想再启动一个D类型的Activity，那么Task将是什么样子呢？在singleTop模式下，Task中仍然是A、B、C、D，只不过D的onNewIntent函数将被调用以处理这个新Intent，而在standard模式下，则Task将变成A、B、C、D、D，最后的D为新创建的D类型Activity对象。在singleTop这种模式下，只有目标Acitivity当前正好在栈顶时才有效，例如只有处于栈顶的D启动时才有用，如果D启动不处于栈顶的A、B、C等，则无效。
- singleTask：在这种启动模式下，该Activity只存在一个实例，并且将和一个Task绑定。当需要此Activity时，系统会以onNewIntent方式启动它，而不会新建Task和Activity。注意，该Activity虽只有一个实例，但是在Task中除了它之外，还可以有其他的Activity。
- singleInstance：它是singleTask的加强版，即一个Task只能有这么一个设置了singleInstance的Activity，不能再有别的Activity。而在singleTask模式中，Task还可以有其他的Activity。
注意，Android建议一般的应用开发者不要轻易使用最后两种启动模式。因为这些模式虽然名意上为Launch Mode，但是它们也会影响Activity出栈的顺序，导致用户按返回键返回时导致不一致的用户体验。
