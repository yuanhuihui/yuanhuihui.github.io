---
layout: post
title:  浅谈HTTP RESTful架构"
date:   2015-07-15 21:20:50
categories: http
excerpt:  浅谈HTTP RESTful架构
---

* content
{:toc}


---

>  **RESTful** 是一种非常流行的软件架构，或者说设计风格而非新的技术标准。提供了一组设计原则和约束条件，主要用于客户端与服务器的交互。RESTful架构更简洁，更有层次，更易于实现缓存等机制。

## 要点
RESTful, 全称Representational State Transfer，翻译是“表现层状态转化”。REST通常基于使用HTTP，URI，和XML以及HTML这些现有的广泛流行的协议和标准。要理解RESTful概念，需要明白下面的概念：

-  资源
		
		只有就是网络的一个具体信息实体，可是是文本、音频、视频、服务，每一个资源具体是由一个对应的URI对应。
		
- 表现层
		
		表现层是指对资源在特定时刻的状态的描述，可以在客户端-服务器端之间交换。具体表现为HTML/XML/JSON/图片/音频/视频等格式。
	
- 状态转化

		状态转移是指客户端和服务器端之间转化代表资源状态的描述。当客户端需要资源时，需要通过让服务器发生“状态转化”，从而实现操作资源的目的。服务器端状态转化由客户端执行不同的操作而发生相应的转化，HTTP请求方法在RESTful API中的映射关系：

	|资源| POST|DELETE| PUT| GET| 
	|---|---|---|---|---|
	|http://demo.com/res/|获取资源|新建资源|更新资源|删除资源|
	|等效于数据库操作|增|删|改|查|

## RESTful实例

- 展现某一件商品
	
		GET http://www.store.com/product/123           //正确
		GET http://www.store.com/product/show/123 //错误

- 购买某一件商品
	
		POST http://www.store.com/shoplist/321         //正确
		POST http://www.store.com/product/buy/321   //错误

URI作为一种资源，应该是实体，是名称，而不应该包含动词，具体的动作应该体现在HTTP协议中。

## 优点

-  更高效利用缓存来提高响应速度
-  通讯本身的无状态性可以让不同的服务器的处理一系列请求中的不同请求，提高服务器的扩展性
- 相对于其他叠加在HTTP协议之上的机制，REST的软件依赖性更小
- 不需要额外的资源发现机制
- 在软件技术演进中的长期的兼容性更好







