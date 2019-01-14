---
layout: post
title:  "AndroidStudio常用快捷键"
date:   2016-08-20 20:10:10
catalog:  true
tags:
    - android
    - tool
---

**说明：**

- 本文中的快捷键是针对Linux环境，且Keymaps为default情况下的映射关系。不同系统对应不同快捷键是记忆负担，为此作者把MAC电脑的快捷键调整为这套Linux快捷键，设置是在Keymap项中设置。
- 标红或加粗的快捷键，是Gityuan多年阅读Android系统源码过程中高频率使用的一些快捷键
- 关联快捷键，是指具有关联关系的快捷键，把相关联的键放到一组，是为了便于记忆，比如展开和收缩，当前查找与全局查找。

## 一、阅读代码

|功能 |快捷键组合|关联快捷键(或备注)|
| :--------   | :-----  |:-----  |
|搜索方法调用链 (Call Hierarchy)|`Ctrl + Alt + H`|递归搜索方法
|搜索变量调用处 (Find Usages)|`Alt + F7`|搜索变量/方法
|搜索类继承关系 (Type Hierarchy)|`Ctrl + H`|搜索子类
|查找方法 (File Structure)|`Ctrl + F12`|
|查找类 (Navigate Class)|`Ctrl + N`|
|查找文件 (Navigate File)|`Ctrl + Shift + N`|
|搜索任意内容|`双击 Shift`|
|跳转至某一行 (Navigate Line)|`Ctrl + G`|
|跳转至源码 (Jump to Source)|`F4`|
|(全局)查找 (Find) |`Ctrl + F` |Ctrl + Shift + F |
|(全局)替换 (Replace) |`Ctrl + R` |Ctrl + Shift + R |
|高亮选中单词|`Ctrl + SHIFT +F7`|
|前进 (Forward)|`Ctrl + →`|自定义|
|后退 (Back)|`Ctrl + ←`|自定义|
|上(下)一个方法 |Alt + ↑     |Alt + ↓     |
|跳至括号开头/结尾|Ctrl + [ | Ctrl + ] |
|展开(收缩)|Ctrl + +|Ctrl + -|
|全部展开(收缩)|Ctrl + Shift + +|Ctrl + Shift + -|
|移动光标至行首(尾)|Home|End|
|查看方法参数信息|Ctrl + P|
|查询上下文信息|Alt + Q|
|(全局)光标处查找 |  Ctrl + F7 |  Alt + F7  |
|查找下(上)一处出现 |F3 | Shift + F3 |
|选中文本|Ctrl + W连按|
|跳转至声明/实现|Ctrl + B|Ctrl + Alt + B|
|跳转至超类方法|Ctrl + U|
|最近打开的文件|Ctrl + E|
|关闭当前Tabs|Ctrl + F4|
|选中功能|Ctrl + W连按|

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
|单步进入|**F7**|
|单步跳过|**F8**|
|执行至断点处|**F9**|
|单步智能进入|Shift +　F7|
|查看断点|Ctrl + Shift +　F8|
|运行|Shift + F10|
|Debug| Shift + F9|
