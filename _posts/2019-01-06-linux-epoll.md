---
layout: post
title:  "深入解读epoll高并发机制"
date:   2019-01-06 21:11:12
catalog:  true
tags:
    - android

---

> 从源码角度来领略一下内核的轮询机制

```C
fs/select.c
kernel/include/linux/poll.h
kernel/include/linux/fs.h
```

## 一、概述

select/poll作为IO多路监控机制，有着明显的缺点。


#### epoll函数

```CPP
int epoll_create(int size)；
int epoll_ctl(int epfd, int op, int fd, struct epoll_event *event)；
int epoll_wait(int epfd, struct epoll_event * events, int maxevents, int timeout);

struct epoll_event {
    __uint32_t events; 
    epoll_data_t data; 
};
```

## 二、epoll机制

待续...
