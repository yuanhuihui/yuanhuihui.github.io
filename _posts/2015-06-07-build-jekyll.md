---
layout: post
title:  "搭建Jekyll本地写作环境"
date:   2015-06-07 23:10:28
catalog:  true
tags:
    - else
---


>  前言：Jekyll是一个开源的博客生成工具，类似WordPress。但与之不同的是，jekyll只生成静态网页，并不需要数据库支持。
>  通常配合第三方评论系统使用，例如Disqus, 最关键的是jekyll可以免费部署在Github上，而且可以绑定自己的域名。

## 一、安装Ruby

Jekyll是用ruby语言编写的，所以我们首先要在装好ruby环境，下面分别讲一下Ma和Window环境。

### Mac环境

1. 安装Homebrew：Mac必备命令，类似ubuntu的apt-get命令，安装命令如下：

        ruby -e "$(curl -fsSL https://raw.github.com/mxcl/homebrew/go)"

2. 安装ruby：mac自带, 没有则使用brew安装

        brew install ruby

### Window环境
1.  下载[RubyInstaller](http://rubyinstaller.org/downloads/)

        选择合适版本，注意操作系统是否64位版本。

2.  安装Ruby

        记得要勾选 Add Ruby executables to your PATH，其作用是绑定ruby环境变量，另外安装目录不可以包含空格。

3. 下载DevKit：与RubyInstller同一链接，页面稍下方有“DEVELOPMENT KIT”

        注意：DevKit版本要与上面的ruby版本是匹配的。

4. 安装DevKit：解压DevKit完成后打开CMD窗口，回到Devkit根目录，输入：

        ruby dk.rb init
        ruby dk.rb install


---

##  二、安装Jekyll

对于Linux或者MAC则打开终端窗口，对于Window则打开CMD窗口。

### 1. 更换源

    *  无翻墙软件，可使用国内淘宝提供的源

            gem sources --remove https://rubygems.org/
            gem sources -a https://ruby.taobao.org/
            gem sources -l

    * 有翻墙软件，可以使用如下源

            gem sources --remove https://rubygems.org/
            gem sources -a  http://rubygems.org/


### 2.  安装jekyll

        gem install jekyll

开始安装，因为是联网安装，所以可能时间比较常，耐心等待，至此Jekyll 安装全部完成。

另外，该命令执行过程出现You don't have write permissions for the /Library/Ruby/Gems/2.3.0 directory.
则可以考虑重新安装Ruby或者是执行在gem install命令前加sudo来提权执行。

### 3. 安装paginate
    gem install jekyll-paginate

并在_config.yml 中加入一句 gems: [jekyll-paginate]

---

## 三、使用jekyll

*  先把github博客Clone下来

        git clone https://github.com/[username]/[username].github.io.git
        git clone git@github.com:[username]/[username].github.io.git

clone有两种方法，第一种是https方法，通过直接输入账号密码的格式提交代码；第二种是ssh的方式，需要提前配置SSH，之后可直接push代码。

* 启动jekyll服务

        cd xxxx.github.io.git
        jekyll serve --watch

*  浏览：[http://localhost:4000/index.html](http://localhost:4000/index.html)

**注意事项：**提交文章时时间非常重要的，提交文章的时间最好比当前时间早一段时间，时差问题，可能会导致文章提交失败。

高亮： <https://highlightjs.org/static/demo/>

## 四、提交文章

### 1. 配置git用户名和邮箱

    $ git config --global user.name "{username}"     //用户名替换{username}
    $ git config --global user.email "{email}"    //邮箱替换{email}

### 2. 配置SSH

    $ ssh-keygen -t rsa -C"{email}"    //邮箱替换{email}

一路回车到命令完成，win7系统默认在文件夹`C:\Users\{你的用户名}\.ssh` ，该文件夹有`id_rsa`（私钥） 和 `id_rsa.pub`（公钥） 两个文件。

将`id_rsa.pub`内容复制到自己的Github主页的`Settings -> SSH keys`，添加完毕即可。

### 3. 提交

    $ cd {username.github.io}
    $ git add .
    $ git commit -m "提交简介"
    $ git push origin master
