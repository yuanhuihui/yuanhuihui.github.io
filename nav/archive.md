---
layout: page
title: Navigation
description: Here is the information you need
permalink: /archive/
---

### Blogs
<hr>
<div class="post-preview">
    <font color="blue">[January 31, 2016]  </font>
     <a target="_blank" href="http://gityuan.com/android/"><font color="#EE0000">[置顶]</font>Android 操作系统架构开篇</a>
</div>
<hr>
<div class="post-preview">
    <font color="blue">[June 1, 2019]  </font>
     <a target="_blank" href="http://gityuan.com/flutter/"><font color="#EE0000">[置顶]</font>Flutter 跨平台演进及架构开篇</a>
</div>
<hr>
{% for post in site.posts %}
<div class="post-preview">
    <font color="blue">[{{ post.date | date: "%B %-d, %Y" }}]  </font>
     <a target="_blank" href="{{ post.url | prepend: site.baseurl }}"> {{ post.title }}  </a>
</div>
<hr>
{% endfor %}
