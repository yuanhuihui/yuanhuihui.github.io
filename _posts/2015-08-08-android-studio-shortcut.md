---
layout: post
title:  "AndroidStudio常用快捷键"
date:   2015-08-08 20:10:10
catalog:  true
tags:
    - android
    - tool
---


> 本文的快捷键是在Linux，且Keymaps为default的情况下的映射关系， 本文介绍在分析Android系统源码过程，经常使用的快捷键。

## 一、阅读代码

|功能 |快捷键组合|反向组合键|
| :--------   | :-----  |:-----  |
|上(下)一个方法 |Alt + ↑     |Alt + ↓     |
|跳至括号开头/结尾|Ctrl + [ | Ctrl + ] |
|展开(收缩)|Ctrl + +|Ctrl + -|
|全部展开(收缩)|Ctrl + Shift + +|Ctrl + Shift + -|
|移动光标至行首(尾)|Home|End|
|查看方法参数信息|Ctrl + P|
|查询上下文信息|Alt + Q|
|(全局)查找 |Ctrl + F |Ctrl + Shift + F |
|(全局)替换 |Ctrl + R |Ctrl + Shift + R |
|(全局)光标处查找 |  Ctrl + F7 |  Alt + F7  |
|查找下(上)一处出现 |F3 | Shift + F3 |
|跳转至源码|F4|
|搜索任意内容| **双击 Shift**|
|查找文件 |Ctrl + Shift + N |
|查找类 |**Ctrl + N** |
|查找方法|**Ctrl + F12**|
|跳转至某一行 | Ctrl + G|
|调用层级|**Ctrl + Alt + H**|
|查看类继承关系|**Ctrl + H**|
|高亮选中单词|**Ctrl + SHIFT +F7**|
|选中文本|Ctrl + W连按|
|跳转至声明/实现|Ctrl + B|Ctrl + Alt + B|
|跳转至超类方法|Ctrl + U|
|最近打开的文件|Ctrl + E|
|关闭当前Tabs|Ctrl + F4|
|选中功能|Ctrl + W连按|
|前进|Ctrl  + ←|自定义
|后退|Ctrl  + →|自定义


## 二、编辑代码

| 功能   |  快捷键组合 |反向组合键|
| :--------   | :-----  | :----  |
|调出live Template | **Ctrl + J** |
|操作提示 | **Alt + Enter** |
|当前行下/上移 | Alt + Shift +　↓ |Alt + Shift +　↑|
|(取消)撤消|Ctrl + Z| Ctrl + Shift + Z|
|剪切|Ctrl + X|
|复制| Ctrl + C|
|复制（不保留格式）| Ctrl + Shift +　C|
|复制（包含引用）| Ctrl + Alt + Shift +　C|
|粘贴|Ctrl + V|
|删除行|Ctrl + Y|
|复制当前行至下一行|Ctrl + D|
|合并行|Ctrl + Shift +Ｊ|
|开始新的一行(光标之下/上)|Shift + Enter| Shift + Alt + Enter|
|Surround With|Ctrl +Alt＋T|
|格式化代码|**Ctrl + Alt + L**|
|优化Imports|**Ctrl + Alt + O**|
|重命名|**Shift  + F6**|
|修改方法签名|Ctrl + F6|
|拷贝文件|F5|
|移动文件|F6|
|安全删除|Alt + Delete|
|引入属性|Ctrl + Alt + E|
|引入定义|Ctrl + Alt + D|
|引入常量|Ctrl + Alt + C|
|引入类型定义|Ctrl + Alt + K|
|引入局部变量|Ctrl + Alt + V|
|引入类变量|Ctrl + Alt + F|
|引入参数|Ctrl + Alt + P|
|引入方法|Ctrl + Alt + M|
|保存|Ctrl +Ｓ|
|选中当前单词|Ctrl + W|


## 三、调试代码

| 功能   |  快捷键组合        |
| :--------   | :-----  |
|运行|Shift + F10|
|Debug| Shift + F9|
|单步进入|F7|
|单步智能进入|**Shift +　F7**|
|单步跳过|**F8**|
|跳过Debug,执行程序|F9|
|查看断点|Ctrl + Shift +　F8|
