---
layout: post
title:  "浅谈HTTP协议"
date:   2015-04-01 22:10:54
categories: web
excerpt:  浅谈HTTP协议的基本内容
---

* content
{:toc}


---

> HTTP是一个属于应用层的面向对象的协议，工作于客户端-服务端架构为上。浏览器作为HTTP客户端通过URL向HTTP服务端发送请求。本文只介绍目前应用比较广泛的**HTTP/1.1**协议，下面从请求与响应两部分分开展开讲解。

## 一. 请求(Request)

### 1.消息格式

![http request](/images/http/request_header.png)
 
一个完整的 HTTP/1.1消息格式分三部分：

 - **请求行**: 	 {请求方法} {资源路径} {协议版本}

 -  **请求头**:  紧跟请求行的下一行，所有的请求头，除Host外都是可选的。

 - **消息体**: 消息的主体部分，消息体的数据格式通过 header 里面的 Content-Type 属性指定。

此外请求行必须以CRLF结尾，不允许出现单独的CR或LF字符。

### 2.消息实例
- GET:

		GET /user?id=10 HTTP/1.1
		Host: www.example.com
	
- GOST:

		POST /user HTTP/1.1
		Host: www.example.com



### 3.请求方法

HTTP/1.1协议共定义八种请求方法：

|序号|	方法	|描述|
|---|---|---|
|1|	GET|	请求指定的页面信息，并返回实体主体。
|2|	POST|	向指定资源提交数据进行处理请求（例如提交表单或者上传文件）。数据被包含在请求体中。POST请求可能会导致新的资源的建立和/或已有资源的修改。
|3|	PUT|	从客户端向服务器传送的数据取代指定的文档的内容。
|4|	DELETE|	请求服务器删除指定的页面。
|2|	HEAD|	类似于get请求，只不过返回的响应中没有具体的内容，用于获取报头
|6|	CONNECT|	HTTP/1.1协议中预留给能够将连接改为管道方式的代理服务器。
|7|	OPTIONS|	允许客户端查看服务器的性能。
|8|	TRACE|	回显服务器收到的请求，主要用于测试或诊断。

### 4.请求头
提供了关于请求，响应或者其他的发送实体的信息

|头|描述|
|---|---|---|
|Allow|	服务器支持哪些请求方法（如GET、POST等）|
|Content-Encoding|	文档的**编码方法**，只有在解码后才得到Content-Type头指定的内容类型。利用gzip压缩文档能够显著地减少HTML文档的下载时间,但并非所有浏览器都支持gzip。
|Content-Length| 表示**实体内容长度**，只有当浏览器使用持久HTTP连接时才需要这个数据。
|Content-Type|	表示文档的**MIME类型**, Servlet默认为text/plain，但通常需要显式地指定为text/html，HttpServletResponse提供了一个专用的方法setContentType。 
|Date|	当前的**GMT时间**，可以用setDateHeader来设置这个头以避免转换时间格式的麻烦。
|Expires|	文档的**有效期时长**，过期则不再缓存
|Last-Modified|	文档的**最后改动时间**，Last-Modified也可用setDateHeader方法来设置。
|Location|	表示提取**文档位置**，Location通常不是直接设置的，而是通过HttpServletResponse的sendRedirect方法，该方法同时设置状态代码为302。
|Refresh| 表示浏览器的文件的**刷新间隔**，N秒后刷新本页面或访问指定页面，此为扩展头，不属于HTTP 1.1正式规范。
|Set-Cookie| 设置和页面关联的Cookie，应使用HttpServletResponse提供的专用方法addCookie。

## 二. 响应(Response)

### 1.消息格式

 ![http response](/images/http/response_header.png)

一个完整的 HTTP/1.1消息格式分三部分：

 - **响应行**：{协议版本} {状态码} {状态描述} 

 - **响应头**： 紧跟响应行的下一行，详细请接下去看。

 - **响应体**：消息的主体部分，就是服务器返回的资源内容。

此外请求行必须以CRLF结尾，不允许出现单独的CR或LF字符。


### 2.响应实例

	HTTP/1.1 200 OK
	Date: Mon, 25 Jul 2008 12:12:32 GMT
	Server: Apache
	Last-Modified: Wed, 12 Jul 2008 18:18:20 GMT
	ETag: "34aa387-d-1568eb00"
	Accept-Ranges: bytes
	Content-Length: 50
	Vary: Accept-Encoding
	Content-Type: text/plain
  
### 3.状态码表

- 1xx消息——请求已被服务器接收，继续处理
- 2xx成功——请求已成功被服务器接收、理解、并接受
- 3xx重定向——需要后续操作才能完成这一请求
- 4xx请求错误——请求含有词法错误或者无法被执行
- 5xx服务器错误——服务器在处理某个正确请求时发生错误

详细列表

|状态码|英文名|描述|
|---|---|---|
|100|	Continue|	客户端应继续其请求
|101|	Switching Protocols|	服务器根据客户端的请求切换协议。只能切换到更高级的协议，例如，切换到HTTP的新版本协议
|200|	OK|	一般用于GET与POST请求
|201|	Created|	成功请求并创建了新的资源
|202|	Accepted|	已经接受请求，但未处理完成
|203|	Non-Authoritative Information| 请求成功。但返回的meta信息不在原始的服务器，而是一个副本
|204|	No Content|服务器成功处理，但未返回内容。在未更新网页的情况下，可确保浏览器继续显示当前文档
|205|	Reset Content|	服务器处理成功，用户终端（例如：浏览器）应重置文档视图。可通过此返回码清除浏览器的表单域
|206|	Partial Content|	服务器成功处理了部分GET请求
|300|	Multiple Choices|	请求的资源可包括多个位置，相应可返回一个资源特征与地址的列表用于用户终端（例如：浏览器）选择
|301|	Moved Permanently|	请求的资源已被永久的移动到新URI，返回信息会包括新的URI，浏览器会自动定向到新URI。今后任何新的请求都应使用新的URI代替
|302|	Found|	与301类似。但资源只是临时被移动。客户端应继续使用原有URI
|303|	See Other|	与301类似。使用GET和POST请求查看
|304|	Not Modified|	所请求的资源未修改，服务器返回此状态码时，不会返回任何资源。客户端通常会缓存访问过的资源，通过提供一个头信息指出客户端希望只返回在指定日期之后修改的资源
|305|	Use Proxy|	所请求的资源必须通过代理访问
|306|	Unused|	已经被废弃的HTTP状态码
|307|	Temporary Redirect|	与302类似。使用GET请求重定向
|400|	Bad Request|	客户端请求的语法错误，服务器无法理解
|401|	Unauthorized|	请求要求用户的身份认证
|402|	Payment Required|	保留，将来使用
|403|	Forbidden|	服务器理解请求客户端的请求，但是拒绝执行此请求
|404|	Not Found|	服务器无法根据客户端的请求找到资源（网页）。通过此代码，网站设计人员可设置"您所请求的资源无法找到"的个性页面
|405|	Method Not Allowed|	客户端请求中的方法被禁止
|406|	Not Acceptable	|服务器无法根据客户端请求的内容特性完成请求
|407|	Proxy Authentication Required|	请求要求代理的身份认证，与401类似，但请求者应当使用代理进行授权
|408|	Request Time-out|	服务器等待客户端发送的请求时间过长，超时
|409|	Conflict|	服务器完成客户端的PUT请求是可能返回此代码，服务器处理请求时发生了冲突
|410|	Gone|	客户端请求的资源已经不存在。410不同于404，如果资源以前有现在被永久删除了可使用410代码，网站设计人员可通过301代码指定资源的新位置
|411|	Length Required|	服务器无法处理客户端发送的不带Content-Length的请求信息
|412|	Precondition Failed	|客户端请求信息的先决条件错误
|413|	Request Entity Too Large	|由于请求的实体过大，服务器无法处理，因此拒绝请求。为防止客户端的连续请求，服务器可能会关闭连接。如果只是服务器暂时无法处理，则会包含一个Retry-After的响应信息
|414|	Request-URI Too Large|	请求的URI过长（URI通常为网址），服务器无法处理
|415|	Unsupported Media Type|	服务器无法处理请求附带的媒体格式
|416|	Requested range not satisfiable|	客户端请求的范围无效
|417|	Expectation Failed|	服务器无法满足Expect的请求头信息
|500|	Internal Server Error|	服务器内部错误，无法完成请求
|501|	Not Implemented	|服务器不支持请求的功能，无法完成请求
|502|	Bad Gateway	|充当网关或代理的服务器，从远端服务器接收到了一个无效的请求
|503|	Service Unavailable|	由于超载或系统维护，服务器暂时的无法处理客户端的请求。延时的长度可包含在服务器的Retry-After头信息中
|504|	Gateway Time-out|	充当网关或代理的服务器，未及时从远端服务器获取请求
|505|	HTTP Version not supported	|服务器不支持请求的HTTP协议的版本，无法完成处理

### 4.Content-Type
IANA机构定义了8个大类的媒体类型，对应于HTTP头中的Content-Type的值，媒体类型分别是:

- application— (比如: application/vnd.ms-excel.)
- audio (比如: audio/mpeg.)
- image (比如: image/png.)
- message (比如,:message/http.)
- model(比如:model/vrml.)
- multipart (比如:multipart/form-data.)
- text(比如:text/html.)
- video(比如:video/quicktime.)
