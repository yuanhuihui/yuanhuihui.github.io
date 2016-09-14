## 1. 冻屏

### 问题描述

 一插上wall charger(强冲)冻结屏幕，辉出现系统冻屏，拔掉wall charger后立即恢复。

### 分析结论

硬件问题，由于SD卡槽变形，出现短路所造成。

## 2. 待机休眠死机

### 问题描述

待机休眠死机


<7>[ 92.821133] PM: Entering mem sleep
<6>[ 92.821139] Suspending console(s) (use no_console_suspend to debug)
<6>[ 92.847089] qpnp_rtc_set_alarm Alarm Set for h:r:s=3:39:36, d/m/y=6/0/70,ctrl_reg=81
<6>[ 92.851557] sc6500_suspend!
<0>[ 104.890540] **** DPM device timeout: f9924000.i2c (qup_i2c)
<0>[ 104.890546] dpm suspend stack:
<6>[ 104.890565] [<c0977be0>] (__schedule+0x618/0x7c0) from [<c0978158>] (schedule_preempt_disabled+0x14/0x20)
<6>[ 104.890576] [<c0978158>] (schedule_preempt_disabled+0x14/0x20) from [<c0976a5c>] (__mutex_lock_slowpath+0x1c8/0x360)
<6>[ 104.890585] [<c0976a5c>] (__mutex_lock_slowpath+0x1c8/0x360) from [<c0976c14>] (mutex_lock+0x20/0x3c)
<6>[ 104.890596] [<c0976c14>] (mutex_lock+0x20/0x3c) from [<c05cb654>] (i2c_qup_pm_suspend_sys+0x1c/0xa4)
<6>[ 104.890609] [<c05cb654>] (i2c_qup_pm_suspend_sys+0x1c/0xa4) from [<c04a36fc>] (platform_pm_suspend+0x2c/0x54)
<6>[ 104.890622] [<c04a36fc>] (platform_pm_suspend+0x2c/0x54) from [<c04a7a84>] (dpm_run_callback+0x44/0x80)
<6>[ 104.890648] [<c04a7a84>] (dpm_run_callback+0x44/0x80) from [<c04a7cd8>] (__device_suspend+0x218/0x2f8)
<6>[ 104.890658] [<c04a7cd8>] (__device_suspend+0x218/0x2f8) from [<c04a9258>] (dpm_suspend+0xb0/0x224)
<6>[ 104.890669] [<c04a9258>] (dpm_suspend+0xb0/0x224) from [<c01d4ae4>] (suspend_devices_and_enter+0x90/0x34c)
<6>[ 104.890679] [<c01d4ae4>] (suspend_devices_and_enter+0x90/0x34c) from [<c01d4e9c>] (pm_suspend+0xfc/0x230)
<6>[ 104.890688] [<c01d4e9c>] (pm_suspend+0xfc/0x230) from [<c01d5064>] (try_to_suspend+0x64/0xa8)
<6>[ 104.890700] [<c01d5064>] (try_to_suspend+0x64/0xa8) from [<c01b11d4>] (process_one_work+0x20c/0x418)
<6>[ 104.890712] [<c01b11d4>] (process_one_work+0x20c/0x418) from [<c01b1590>] (worker_thread+0x184/0x2a4)
<6>[ 104.890723] [<c01b1590>] (worker_thread+0x184/0x2a4) from [<c01b5c6c>] (kthread+0x80/0x90)
<6>[ 104.890737] [<c01b5c6c>] (kthread+0x80/0x90) from [<c0106c24>] (kernel_thread_exit+0x0/0x8)
<6>[ 104.890746] swapper/0 (0): undefined instruction: pc=c04a7df8
<6>[ 104.890752] Code: eb12fce7 e1a00004 e3a01000 ebf18764 (e7f001f2)

### 分析结论

修改Touch的supend机制解决


## 3. Phone Crash

### 问题描述

    6.786827: <2> wait_to_close_es9018 enter //特征
    10.787423: <4> wait_to_close_es9018: ess_headphone is not connected in 4000 ms, close it
    10.787442: <6> headphone_switch_state enter
    10.787457: <2> zhougd--power_gpio_0_L enter
    10.787472: <6> enter es9018_close, line 708
    14.165513: <6> Watchdog bark! Now = 14.165508
    14.165518: <6> Watchdog last pet at 1.165157

### 解决

Audio驱动代码有while循环等待，去掉while等待即可。

## 4. LTR测试报告 memory corruption

 memory corruption 在kernel config

- CONFIG_DEBUG_PAGEALLOC=y
- CONFIG_PANIC_ON_DATA_CORRUPTION=y

再初始化和free_page时写入全aa；在allocate page时，检查是否为aa.

### 结论

USB和 charge的电压 档位相关导致的 crash.


### 其他

Log.getStackTraceString
    Throwable.printStackTrace

    private void printStackTrace(Appendable err, String indent, StackTraceElement[] parentStack)
            throws IOException {
        err.append(toString()); //这是title
        err.append("\n");

        StackTraceElement[] stack = getInternalStackTrace();
        if (stack != null) {
            int duplicates = parentStack != null ? countDuplicates(stack, parentStack) : 0;
            for (int i = 0; i < stack.length - duplicates; i++) {
                err.append(indent);
                err.append("\tat ");
                err.append(stack[i].toString());
                err.append("\n");
            }

            if (duplicates > 0) {
                err.append(indent);
                err.append("\t... ");
                err.append(Integer.toString(duplicates));
                err.append(" more\n");
            }
        }

        // Print suppressed exceptions indented one level deeper.
        if (suppressedExceptions != null) {
            for (Throwable throwable : suppressedExceptions) {
                err.append(indent);
                err.append("\tSuppressed: ");
                throwable.printStackTrace(err, indent + "\t", stack);
            }
        }

        Throwable cause = getCause();
        if (cause != null) {
            err.append(indent);
            err.append("Caused by: ");  //Caused by:
            cause.printStackTrace(err, indent, stack);
        }
    }

printStackTrace(err, "", null);
