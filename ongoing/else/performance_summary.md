### 1.应用启动时间慢

case1:Launcher在OnPause的时候，做动态壁纸的同事，添加了截屏的代码，导致慢。

思路：可能是应用导致的，要对比两个版本的apk版本。

### 2.开机启动慢

case 2: 为防止解锁在开机起来后滑不动或者卡顿，所以加了5秒的延迟，对于性能这是不能忍的。

### 3.ANR问题

case 3:通过/data/anr/traces.txt发现，3个线程之间相互waiting to lock，导致死锁。

### 4.退出U盘模式后滑动Launcher卡顿问题


case 4: media扫描时采用带notify的uri，需要与system_server大量的binder通信，进而导致system_server进程大量gc操作，故launcher卡顿。

思路：结合systrace, traceview。

### 5.创建硬件层慢

buildLayer的时候耗时比较长

case 5: kernel的config文件配置错了，导致慢的。

