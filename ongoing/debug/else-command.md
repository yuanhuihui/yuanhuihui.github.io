## wm

交由服务WindowManagerService来完成

查看

	wm density
	wm size

修改

	wm density 480
	wm size 1080x1920


## input

交由服务InputManagerService类的injectInputEvent()方法完成

格式：

    input text <string>
    input keyevent <key code number or name>
    input tap <x> <y>
    input swipe <x1> <y1> <x2> <y2>

例如：

	input text hello    //输入字符串“hello”
	input tap 100 200    //点击坐标（100，200）
	input swipe 100 100 200 200    //从坐标（100，100）滑动到（200，200）

	input keyevent --longpress 3   //长按Home键
	input keyevent 4  //按Back键
	input keyevent 24 //按音量(+)键
	input keyevent 25 //按音量(-)键
	input keyevent 26 //按power键