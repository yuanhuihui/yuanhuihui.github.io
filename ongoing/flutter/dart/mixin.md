- with：类的混入mixin，顺序很重要
    - 可以mixins多个mixins类
    - 可以mixins多个类

extends单个，implements，with可以多个；有abstract，mixin


- mixin：复用类代码的一种途径
  - mixins类只能继承自object
  - mixins类不能有构造函数
  - on：需要使用该mixin，则必须先实现该接口或者继承该类，这个顺序不重要


https://github.com/dart-lang/language/blob/master/accepted/2.1/super-mixins/feature-specification.md#dart-2-mixin-declarations
