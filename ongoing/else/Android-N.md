
## bootcamp --Android N new features:

1. bug website: b.android.com
2. Better native memory bug/leak tools
3. adb: Increased stability for automated testing.

### broadcast

- android.net.conn.CONNECTIVITY_CHANGE 能接收，但不能wakeup
- NEW_PICTURE, 不能接收和发送该广播，通过JobScheduler来实现；

### art

interpreter:更快： 重点代码采用汇编；每次调用时 stack memory节省200 bytes； 降低JIT Profiling开销；
JIT
AOT
