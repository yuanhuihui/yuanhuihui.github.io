---
layout: page
title: archive
permalink: /archive/
header-img: "img/nav-resource.jpg"
---

### Blogs
<hr>
<div class="post-preview">
    <font color="blue">[January 31, 2016]  </font> 
     <a target="_blank" href="http://gityuan.com/android/"><font color="#EE0000">[置顶]</font>Android系统开篇</a> 
</div>
<hr>
{% for post in site.posts %}
<div class="post-preview">
    <font color="blue">[{{ post.date | date: "%B %-d, %Y" }}]  </font> 
     <a target="_blank" href="{{ post.url | prepend: site.baseurl }}"> {{ post.title }}  </a> 
</div>
<hr>
{% endfor %}
