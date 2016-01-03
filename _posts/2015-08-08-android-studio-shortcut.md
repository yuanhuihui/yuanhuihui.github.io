---
layout: post
title:  "Android Studio 快捷键"
date:   2015-08-08 20:10:10
categories: Android tool
excerpt: Android 快捷键说明。
---

* content
{:toc}


本文的快捷键是在windows下，且Keymaps为default的情况下的映射关系，从以下几个方面来详细介绍快捷键：

> * 导航
> * 搜索
> * 编辑代码
> * 查看代码
> * 视图切换
> * 重构
> * 运行与调试
> * 其他


## 一、导航

| 功能   |  快捷键组合        |
| --------   | :-----  | 
|前进|Ctrl + Alt + ←|
|后退|Ctrl + Alt + →|
|跳转到大括号开头|Ctrl + [ |
|跳转到大括号结尾|Ctrl + ] |
| 跳转上一次编辑的位置|  Ctrl + Shift +　Backspace     |
|关闭当前Tabs|Ctrl + F4|
| 跳转至某个Class |  Ctrl + N     |
| 跳转至某个文件 |  Ctrl + + Shift + N     |
| 跳转至某一行 |  Ctrl + G     |
|跳转导航栏|Alt + Home|
|跳转至声明|Ctrl + B|
|跳转至实现|Ctrl + Alt + B|
|跳转至超类的方法|Ctrl + U|
|跳转至测试|Ctrl + Shift + T|


## 二、搜索

| 功能   |  快捷键组合        |组合2|
| :--------   | :-----  | :----  |
|当前查找 | Ctrl + F  | Alt + F3           | 
|当前替换 | Ctrl + R            | 
|全局查找 | Ctrl + Shift + F           | 
|全局替换 | Ctrl + Shift + R            | 
|查找下一处出现 |  Ctrl + L  | F3          | 
|查找上一处出现 | Ctrl + Shift + L　| Shift + F3 | 
|搜索任意内容| **双击 Shift**     | 
|当前查找（光标处） |  Ctrl + F7     | 
|全局查找（光标处）  |  Alt + F7     | 
|同时选中所有被引用点（光标处） |Ctrl + Alt +Shift + J　|
|显示所有被引用点（光标处）|  Ctrl + Alt +　F7     | 

>小技巧： 所有搜索都支持基本的正则表达式和无序匹配关键字

## 三、编辑代码 

| 功能   |  快捷键组合        |组合2
| :--------   | :-----  | :----  |
| 调出live Template | **Ctrl + J** |
| 操作提示 | **Alt + Enter** |
| 当前行下移 | Alt + Shift +　↓ |
|当前行上移|Alt + Shift +　↑|
|撤消|Ctrl + Z|Alt + BackSpace|
|取消撤消|Ctrl + Shift + Z|Alt + Shift+ BackSpace|
|剪切|Ctrl + X|Ctrl + Delete|
|复制| Ctrl + C| Ctrl +Insert|
|复制（不保留格式）| Ctrl + Shift +　C|
|复制（包含引用）| Ctrl + Alt + Shift +　C|
|粘贴|Ctrl + V|Shift + Insert|
|删除行|Ctrl + Y|
|删除单词至词尾|Ctrl + Delete|
|删除单词至词首|Ctrl + Backspace|
|复制当前行至下一行|Ctrl + D|
|合并行|Ctrl + Shift +Ｊ|
|开始新的一行(光标之下)|Shift + Enter|
|开始新的一行(光标之上)|Shift +Alt Enter|

>小技巧： live Template中有大量的模板,对于提高编程效率有极大帮助,比如编辑器中输入fnc按回车则生成 () findViewById(R.id.);再比如输入logd则生成 Log.d(TAG, " ");输入inn则生成if (= null) {}等等

## 四、查看代码 

| 功能   |  快捷键组合        |
| :--------   | :-----  | 
|上一个方法 |  Alt + ↑     | 
|下一个方法 |  Alt + ↓     | 
|展开|Ctrl + +|
|收缩|Ctrl + -|
|全部展开|Ctrl + Shift + +|
|全部收缩|Ctrl + Shift + -|
|跳转至源码|**F4**|
|移动光标至行首|Home|
|移动光标至行尾|End|
|移动光标至页首|Ctrl + Page Up|
|移动光标至页尾|Ctrl + Page Down|
|将光标所在行移动至页面居中|Ctrl + M|
|查看方法参数信息|Ctrl + P|
|查询上下文信息|Alt + Q|
|打开Override方法| Ctrl + O|
|Surround With|Ctrl +Alt＋T|
|格式化代码|Ctrl + Alt + L|
|优化Imports|Ctrl + Alt + O|

## 五、视图切换 

| 功能   |  快捷键组合        |
| --------   | :-----  | :---- |
| 显示目录窗口 |  Alt + 1     |
| 显示收藏窗口 |Alt + 2     | 
| 显示Android窗口 |  Alt + 6     |
| 显示结构窗口 | **Alt + 7**    |
| 显示VCS窗口 |  Alt + 9     |


>小技巧： 窗口切换过程后若想快速回到编辑界面，可重复切换操作，或者点击**ESC**键。

## 六、重构 

| 功能   |  快捷键组合        |
| :--------   | :-----  | 
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


## 七、运行与Debug 

| 功能   |  快捷键组合        |
| :--------   | :-----  | 
|运行|Shift + F10|
|Debug| Shift + F9|
|单步进入|F7|
|单步智能进入|Shift +　F7|
|单步跳过|F8|
|跳过Debug,执行程序|F9|


## 八、其它

| 功能   |  快捷键组合        |
| :--------   | :-----  | 
|打开设置|Ctrl + Alt + S|
|保存|Ctrl +Ｓ|
|Git Add |Ctrl + Alt + A|
|Git Push |Ctrl + Shift + K|
|Git Revert |Ctrl + Alt + Z|
|同步 |Ctrl + Alt +Ｙ|


