

### 1. 类相关

- implements：隐形接口，实现一个或者多个接口， 并实现每个接口要求的 API。 这个跟java的interface不一样，普通class也可以被实现；
  - class 就是 interface
- extends：类的继承
  - Flutter中的继承是单继承
  - 构造函数不能继承
  - 子类重写超类的方法，要用@override
  - 子类调用超类的方法，要用super
- with：类的混入mixin，顺序很重要
    - 可以mixins多个mixins类
    - 可以mixins多个类

extends单个，implements，with可以多个；有abstract，mixin


- mixin：复用类代码的一种途径
  - mixins类只能继承自object
  - mixins类不能有构造函数
  - on：需要使用该mixin，则必须先实现该接口或者继承该类，这个顺序不重要
- abstract：用于抽象类；
- typedef：为函数其别名



### 2. 可见性

- import
  - as关键词可标识库
  - show/hide关键词可导入库的一部分
  - deferred as：延迟加载库
- library
- export
- part

说明：

  //指定库的前缀名
  import 'package:lib2/lib2.dart' as lib2;

  //延迟加载库
  import 'package:greetings/hello.dart' deferred as hello;
  //使用的地方
  Future greet() async {
    await hello.loadLibrary();
    hello.printGreeting();
  }

  // Import only foo.
  import 'package:lib1/lib1.dart' show foo;

  // Import all names EXCEPT foo.
  import 'package:lib2/lib2.dart' hide foo;


### 3.异步

- async
- await
- Future
