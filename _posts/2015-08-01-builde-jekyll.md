---
layout: post
title:  "Windows下搭建本地Jekyll"
date:   2015-08-01 23:10:28
categories: github
excerpt: Windows下搭建本地Jekyll 建立个人博客
---




* content
{:toc}


---

>  前言：Jekyll是一个开源的博客生成工具，类似WordPress。但与之不同的是，jekyll只生成静态网页，并不需要数据库支持。
>  通常配合第三方评论系统使用，例如Disqus, 多说。最关键的是jekyll可以免费部署在Github上，而且可以绑定自己的域名。

## 安装Ruby

Jekyll是用ruby语言编写的，所以我们首先要在windows上装好ruby环境。

### 1.  下载[RubyInstaller](http://rubyinstaller.org/downloads/)
	
> 选择合适版本，注意操作系统是否64位版本。

### 2.  安装Ruby

> 记得要勾选 Add Ruby executables to your PATH，其作用是绑定ruby环境变量，另外安装目录不可以包含空格。

### 3. 下载DevKit
与RubyInstller同一链接，页面稍下方有“DEVELOPMENT KIT”
	
> 注意：DevKit版本要与上面的ruby版本是匹配的。

### 4. 安装DevKit

解压DevKit完成后打开CMD窗口，回到Devkit根目录，输入：

		ruby dk.rb init
		ruby dk.rb install
	    

---
		
##  安装Jekyll

### 1. 更换源

*  国内源
	
		gem sources --remove https://rubygems.org/
		gem sources -a https://ruby.taobao.org/
		gem sources -l
			
		
*  国外源（合适有翻墙软件的用户）
	
		gem sources --remove https://rubygems.org/
		gem sources -a  http://rubygems.org/
		

### 2.  安装jekyll

		gem install jekyll
		
开始安装，因为是联网安装，所以可能时间比较常，耐心等待。至此Jekyll 安装全部完成。

---

## 使用jekyll

*  先把github博客Clone下来,然后启动jekyll服务

		git clone https://github.com/xxxx/xxxx.github.io.git
		
		cd xxxx.github.io.git
		
		jekyll serve --watch
		
*  浏览：[http://localhost:4000/index.html](http://localhost:4000/index.html)