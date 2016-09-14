## Android Studio调试framework源码

### 一、概述

AS基于IntelliJ IDEA开发，故本文也适用于IntelliJ IDEA。 AS调试环境准备条件：

- Ubuntu
- Openjdk
- AS
- AOSP

### 二、修改步骤

#### 1. 内存调整

内存配置项，可修改IDEA_HOME/bin/studio64.vmoptions中-Xms和-Xmx的值，适当增加AS内存

#### 2. 配置AS的jdk/sdk



### 其他

无法打断的问题：

1. http://stackoverflow.com/questions/11591662/cannot-set-java-breakpoint-in-intellij-idea
2. 是由于本地代码修改，而导致的不同步问题。

### 参考

http://www.cnblogs.com/Lefter/p/4176991.html
