## App启动时长

	adb shell am start -w packagename/activity

- ThisTime：App的最后一个Activity的启动时长; (单位ms)
- TotalTime：App的一系列Activity的启动总时长;
- WaitTime：startActivityAndWait()方法调用的总时长；

关系：ThisTime <= TotalTime <= WaitTime；

当App启动过程中，只有一个Activity，则ThisTime == TotalTime;


WaitTime就是总的耗时，包括前一个应用Activity pause的时间和新应用启动的时间；



### 其他

[-> Am.java]

    private void runStart() throws Exception {
            ...
            final long startTime = SystemClock.uptimeMillis();
            if (mWaitOption) {
                result = mAm.startActivityAndWait(null, null, intent, mimeType,
                            null, null, 0, mStartFlags, profilerInfo, null, mUserId);
            } else {
                res = mAm.startActivityAsUser(null, null, intent, mimeType,
                        null, null, 0, mStartFlags, profilerInfo, null, mUserId);
            }
            final long endTime = SystemClock.uptimeMillis();
    }

公式：

	ThisTime = result.thisTime = curTime - displayStartTime
	TotalTime = result.totalTime = curTime - stack.mLaunchStartTime
	WaitTime = endTime-startTime

ActivityRecord.reportLaunchTimeLocked(long curTime)

回推查找到：

Activity.reportFullyDrawn() 错了，不在这里

在整个framework/base下搜不到调用。

PowerUsageSummary.refreshStats() （package里面，这里很奇怪？）

窗口界面显示出来后，WMS才调用reportLaunchTimeLocked()通知AMS Activity启动完成


ActivityRecord.windowsDrawnLocked

ActivityStack.setLaunchTime


### 关系

startTime -> mLaunchStartTime -> displayStartTime -> curTime -> endTime


拿网易新闻来说：

 am start -W com.netease.newsreader.activity/com.netease.nr.biz.ad.AdActivity

totalTime与thisTime都是一样，且都是第1个Activity的启动时间，其并非第二的时间。