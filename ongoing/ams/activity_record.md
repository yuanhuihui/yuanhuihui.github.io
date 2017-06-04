

ActivityRecord并没有继承于Binder, 所以采用成员变量ActivityRecord.appToken, 继承于Token
    Token extends IApplicationToken.Stub
其传递到客户端的是ContextImpl.mActivityToken, 以及Activity.mToken都是Token的代理对象;
