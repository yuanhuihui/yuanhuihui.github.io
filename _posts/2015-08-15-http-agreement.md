---
layout: post
title:  "浅谈HTTP协议"
date:   2015-08-15 22:10:54
categories: http
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

 - 请求行
	POST  /  HTTP/1.1 
	{请求方法} {资源路径} {协议版本}

 - 请求头(header)
header 紧跟请求行的下一行，所有的请求头，除Host外，都是可选的。

 - 消息体(body)
消息的主体部分，有多种形式，消息体的数据格式通过 header 里面的 Content-Type 属性指定。

此外请求行必须以CRLF结尾，不允许出现单独的CR或LF字符。

### 2.消息实例
- GET:

		GET /api/info?name=yhh&age=25 HTTP/1.1
		Host: www.example.com
	
- GOST:

		POST / HTTP/1.1
		Host: www.example.com



### 3. 请求方法

HTTP/1.1协议共定义八种请求方法：

|序号|	方法	|描述|
|---|---|---|
|1|	GET|	请求指定的页面信息，并返回实体主体。
|2|	HEAD|	类似于get请求，只不过返回的响应中没有具体的内容，用于获取报头
|3|	POST|	向指定资源提交数据进行处理请求（例如提交表单或者上传文件）。数据被包含在请求体中。POST请求可能会导致新的资源的建立和/或已有资源的修改。
|4|	PUT|	从客户端向服务器传送的数据取代指定的文档的内容。
|5|	DELETE|	请求服务器删除指定的页面。
|6|	CONNECT|	HTTP/1.1协议中预留给能够将连接改为管道方式的代理服务器。
|7|	OPTIONS|	允许客户端查看服务器的性能。
|8|	TRACE|	回显服务器收到的请求，主要用于测试或诊断。

### 4.请求头信息
提供了关于请求，响应或者其他的发送实体的信息

|头|描述|
|---|---|---|
|Allow|	服务器支持哪些请求方法（如GET、POST等）|
|Content-Encoding|	文档的**编码方法**，只有在解码后才得到Content-Type头指定的内容类型。利用gzip压缩文档能够显著地减少HTML文档的下载时间,但并非所有浏览器都支持gzip。
|Content-Length| 表示**内容长度**，只有当浏览器使用持久HTTP连接时才需要这个数据。如果想要利用持久连接的优势，可以把输出文档写入ByteArrayOutputStram，完成后查看其大小，然后把该值放入Content-Length头，最后通过byteArrayStream.writeTo(response.getOutputStream()发送内容。
|Content-Type|	表示文档的**MIME类型**, Servlet默认为text/plain，但通常需要显式地指定为text/html。由于经常要设置Content-Type，因此HttpServletResponse提供了一个专用的方法setContentType。 
|Date|	当前的**GMT时间**，可以用setDateHeader来设置这个头以避免转换时间格式的麻烦。
|Expires|	文档的**有效期时长**，过期则不再缓存
|Last-Modified|	文档的**最后改动时间**，客户可以通过If-Modified-Since请求头提供一个日期，该请求将被视为一个条件GET，只有改动时间迟于指定时间的文档才会返回，否则返回一个304（Not Modified）状态。Last-Modified也可用setDateHeader方法来设置。
|Location|	表示提取**文档位置**，Location通常不是直接设置的，而是通过HttpServletResponse的sendRedirect方法，该方法同时设置状态代码为302。
|Refresh| 表示浏览器的间隔多少时间刷新文件，表示N秒之后刷新本页面或访问指定页面，此为扩展头，不属于HTTP 1.1正式规范。
|Set-Cookie| 设置和页面关联的Cookie，应使用HttpServletResponse提供的专用方法addCookie。

## 二. 响应(Response)

### 1.消息格式

 ![http response](/images/http/response_header.png)

一个完整的 HTTP/1.1消息格式分三部分：

 - 响应行
	HTTP/1.1 200 OK
	{协议版本} {状态码} {状态描述} 

 - 响应头(header)
header 紧跟响应行的下一行，详细请接下去看。

 - 响应体(body)
消息的主体部分，就是服务器返回的资源内容

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
