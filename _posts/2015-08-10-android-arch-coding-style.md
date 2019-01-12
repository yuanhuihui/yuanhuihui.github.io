---
layout: post
title:  "Android开发规范"
date:   2015-08-10 21:14:54
catalog:  true
tags:
    - android
    - app
---

>Google官方Java代码风格参考规范[链接](http://google-styleguide.googlecode.com/svn/trunk/javaguide.html)， 中文翻译参考版[链接](http://hawstein.com/posts/google-java-style.html)。

## 命名规范

### 1. 包命名
规则：包名全部小写，采用反域名命名规则，一级包名是顶级域名，通常为com, edu, gov, net, org等，二级包名，通过为公司名或部门名或者个人名，三级包名通常为项目名，四级包名为模块名或者层级名。以下是从层级包名来划分android项目中采用的包划分结构

    com.domain.xxx.activity  //用户界面中所有的Activity类
    com.domain.xxx.fragment  //界面中所有的Fragment类
    com.domain.xxx.adapter   //界面中所有的Adapter类（适配器类）
    com.domain.xxx.view      //自定义的View类
    com.domain.xxx.service   //后台Service类
    com.domain.xxx.util      //项目中常用的公共工具类（网络, IO, 日志等）
    com.domain.xxx.bean      //实体模型类
    com.domain.xxx.db        //数据库操作相关的类
    com.domain.xxx.config    //所有的配置相关的类
    com.domain.xxx.api       //网络api接口相关de 类

### 2. 类命名
规则：采用**大驼峰式**命名法，首字母大写，尽量避免缩写，除非该缩写是众所周知的，比如HTML，URL,如果类名称包含单词缩写，则单词缩写的每个字母均应大写。以下列举的是android中几种最为常用的类的命名。

    class LoginActivity;     //activity类
    class DiscoverFragment;  //fragment类
    class AnalysisService;   //service类
    class WakeupRankAdapter; //adapter类
    class StringUtils;       //工具类
    class UserBean;          //模型类
    class ApiImpl;           //接口实现类


### 3. 接口命名
规则：命名规则与类命名一样采用**大驼峰式**命名法，首字母大写，多以able, ible, er结尾

    interface Comparable;
    interface Accessible;
    interface OnClickListener;

### 4. 方法
规则：采用**小驼峰**命名法，首字母小写，方法名采用动词或动名词结构。方法的命名应该与方法的真正行为具有对应关系，下面给出一些方法名的动词前缀标示的建议。

|方法名|描述|
| ---   | :---  |
|getXX() | 获取某个属性的返回值
|setXX()   |设置某个属性值
|initXX()  |初始化方法，如初始化布局initView()
|isXX()     |判断是否true的方法；
|checkXX()  |与isXX意义等价
|processXX() |处理数据
|updateXX()  |更新数据
|saveXX()    |保存数据
|addXX()    |添加数据
|deleteXX()  |删除数据
|resetXX()   |重置数据
|clearXX()   |清除数据
|removeXX()  |移除数据或者视图等，如removeView();
|drawXX()    |绘制数据或者视图


### 5. 变量
规则：采用**小驼峰**命名法，首字母小写。变量名应简短且能描述其用途，尽量避免拼音，无意义地缩写。除非是临时变量，否则不建议使用单个字符的变量名，如i, j, k。对于变量命名，还有一种风格是google的以字母m为前缀（m为member缩写），在android 源码中随处可见。

    private int userName;  //java的一般性风格
    private int mUserName; //google的成员变量风格，m为member的缩写

### 6. 常量
规则：常量使用**全大写字母**加下划线的方式命名。

    public static final int TAG= "tag";
    public static final int START_CLASS_NOT_FOUND = -2;

---
**下面介绍的与android关系更加紧密：**

### 7. 控件变量名
规则：首先需要满足第5条变量的规则，
模式：逻辑名 + view缩写

    Button sendNewsBtn;
    TextView passwordTxt;

### 8. 控件ID
规则：view缩写_模块名_逻辑名

    android:id="@+id/btn_news_send"  //样例

view缩写如下：

|View| 缩写|
| --- | :---|
|TextView |    txt
|EditText    |edit
|Button    |btn
|ImageButton    |ibtn
|ImageView    |img
|ListView    |lv
|RadioGroup    |rgroup
|RadioButton    |rbtn
|ProgressBar|    rbar
|SeekBar    |seek
|CheckBox    |cb
|Spinner    |spinner
|TableLayout|    table
|TableRow    |row
|LinearLayout|    ll
|RelativeLayout|    rl
|ScrollView    |scroll
|SearchView    |search
|TabHost    |thost
|TabWidget    |twidget


### 9. 资源文件名

#### 9.1 layout的文件命名
规则：全部小写，采用下划线命名法。layout文件命名：组件类型\_{模块\_}功能.xml

    activity_news_title.xml //样例

|命名规范| 组件类型 |
| --------   | :-----  |
|activity_{模块_}功能   | Activity命名格式
|fragment_{模块_}功能   | Fragment命名格式
|dialog_{模块_}功能     | Dialog命名格式
|popup_{模块_}功能      | PopupWindow命名格式
|item_list_{模块_}功能  | ListView的item命名格式
|item_grid_{模块_}功能  | GridView的item命名格式


#### 9.2  drawable的文件命名
模式：前缀{_控件}{_范围}{_后缀}，控件、范围、后缀可选

    bg_login_pressed.png //样例


|drawable| 命名细则 |
| --------   | :-----  |
| 图标类| 添加ic前缀
| 背景类| 添加bg前缀
| 分隔类| 添加div前缀
| 默认类| 添加def前缀
| 区分状态时，默认状态| 添加normal后缀
| 区分状态时，按下时的状态| 添加pressed后缀
| 区分状态时，选中时的状态| 添加selected后缀
| 区分状态时，不可用时的状态| 添加disable后缀
| 多种状态的| 添加selector后缀


#### 9.3 动画的文件命名
规则：{范围_}动画类型_动画方向。


    login_fade_in.xml //样例


|动画命名| 描述 |
| --------   | :-----  |
| fade_in| 淡入
| fade_out| 淡出
| push_down_in| 从下方推入
| push_down_out| 从下方推出
| slide_in_from_top| 从头部滑动进入
| zoom_enter| 变形进入
| shrink_to_middle| 中间缩小

### 10. 资源内的name命名

#### 10.1 strings.xml
模式：activity名_{范围_}逻辑名

    <string name="login_username">用户名</string> //样例


#### 10.2 colors.xml
模式：前缀{_控件}{_范围}{_后缀}， 控件、范围、后缀可选，


    <color name="bg_login">#FFFFFF</color> //样例


|colors| 命名细则 |
| --------   | :-----  |
|背景颜色|添加bg前缀
|文本颜色|添加text前缀
|分割线颜色|添加div前缀
|区分状态时，默认状态的颜色|添加normal后缀
|区分状态时，按下时的颜色|添加pressed后缀
|区分状态时，选中时的颜色|添加selected后缀
|区分状态时，不可用时的颜色|添加disable后缀


---

## 代码风格

### 原则

- 不要直接忽略Exceptions

    例如下面的示例，永远不要这样做，无法预测未来可能的变化

        void setServerPort(String value) {
            try {
                serverPort = Integer.parseInt(value);
            } catch (NumberFormatException e) { }
        }

    正确的做法应该如下：

        void setServerPort(String value) throws ConfigurationException {
            try {
                serverPort = Integer.parseInt(value);
            } catch (NumberFormatException e) {
                throw new ConfigurationException("Port " + value + " is not valid.");
            }
        }

- import采用完全限定名

    不提倡：

        import foo.*;

    正确做法：

        import foo.Bar;

- 括号风格：

    不提倡：

        if (condition)
            body();

    正确做法：

        if (condition) {
            body();
        }


- 使用空格来缩进

    使用4个空格缩进来代表块，而绝不使用tab键；
    使用8个空格来代表行包裹，包括函数调用。

### 注释

- 1.类注释，每个类完成后应该有作者姓名和联系方式的注释，对自己的代码负责

        /**
         * 作者: gityuan
         * 时间: 13-12-20 19：25
         * 描述: 用户登录
         * 联系方式: gityuan@gmail.com
         */
        public class Login{
                ...
        }


- 2.方法注释，每一个成员方法（包括自定义成员方法、覆盖方法、属性方法）的方法头都必须做方法头注释

        /*
         * 方法名：
         * 功    能：
         * 参    数：
         * 返回值：无
         */


- 3.快注释

        private class MessageObserver extends ContentObserver {
            public MessageObserver() {
                super(mainHandler);
            }

            public void onChange(boolean hasChanged) {
             // 发送更新UI的消息
             mHandler.sendMessage(mHandler.obtainMessage(0x2));
            }
        }


- 4.资源文件注释

        <!--红色  -->
        <color name="red">#FF0000</color>
        <!--深蓝色  -->
        <color name="dark_blue">#0079FF</color>
