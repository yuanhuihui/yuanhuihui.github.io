## 一、 重启
### 1.1 类别：JE, NE, KE

### 1.2 分析

判定是否上层重启： uptime时间 + system_server, zygote这些pid

### 1.3 特征分析

死锁，Watchdog导致重启

### 关键词

Fatal Exception
Fatal

Kernel panic - not syncing: Fatal exception

panic
Watchdog bark!

Too many open files

SQLiteFullException

No space left on device

Entered the Android system server

Internal error: Oops

WATCHDOG KILLING SYSTEM PROCESS

Rebooting in

Going down for restart now

Exception stack


fault addr  (NE)

SysRq : Show Blocked State



init: Starting service

### powerup

#### kernel/arch/aarm/include/asm/bootinfo.h

#define HW_MAJOR_VERSION_SHIFT 4
#define HW_MAJOR_VERSION_MASK  0xF0
#define HW_MINOR_VERSION_SHIFT 0
#define HW_MINOR_VERSION_MASK  0x0F

typedef enum {
	PU_REASON_EVENT_HWRST,
	PU_REASON_EVENT_SMPL,
	PU_REASON_EVENT_RTC,
	PU_REASON_EVENT_DC_CHG,
	PU_REASON_EVENT_USB_CHG,
	PU_REASON_EVENT_PON1,
	PU_REASON_EVENT_CABLE,
	PU_REASON_EVENT_KPD,
	PU_REASON_EVENT_WARMRST,
	PU_REASON_EVENT_LPK,
	PU_REASON_MAX
} powerup_reason_t;

enum {
	RS_REASON_EVENT_WDOG,
	RS_REASON_EVENT_KPANIC,
	RS_REASON_EVENT_NORMAL,
	RS_REASON_EVENT_OTHER,
	RS_REASON_MAX
};

#define RESTART_EVENT_WDOG		0x10000
#define RESTART_EVENT_KPANIC	0x20000
#define RESTART_EVENT_NORMAL	0x40000
#define RESTART_EVENT_OTHER		0x80000



#### /kernel/arch/arm/kernel/bootinfo.c

static const char * const powerup_reasons[PU_REASON_MAX] = {
	[PU_REASON_EVENT_KPD]		= "keypad",
	[PU_REASON_EVENT_RTC]		= "rtc",
	[PU_REASON_EVENT_CABLE]		= "cable",
	[PU_REASON_EVENT_SMPL]		= "smpl",
	[PU_REASON_EVENT_PON1]		= "pon1",
	[PU_REASON_EVENT_USB_CHG]	= "usb_chg",
	[PU_REASON_EVENT_DC_CHG]	= "dc_chg",
	[PU_REASON_EVENT_HWRST]		= "hw_reset",
	[PU_REASON_EVENT_LPK]		= "long_power_key",
};

static const char * const reset_reasons[RS_REASON_MAX] = {
	[RS_REASON_EVENT_WDOG]		= "wdog",
	[RS_REASON_EVENT_KPANIC]	= "kpanic",
	[RS_REASON_EVENT_NORMAL]	= "reboot",
	[RS_REASON_EVENT_OTHER]		= "other",
};

## 常用解决手段

1. 增加try... catch，强行捕获异常
2. 增加非空判定
3. 硬件或者cpu问题
4. native crash: double free
5. 数组越界

二、 死机

三 boot

07-10 11:12:39.158   317   317 I boot_progress_start: 21357
07-10 11:12:41.302   317   317 I boot_progress_preload_start: 23501
07-10 11:12:46.550   317   317 I boot_progress_preload_end: 28749

//SystemServer.run()  //对应log:  Entered the Android system server!
07-10 11:12:46.961  1756  1756 I boot_progress_system_run: 29152

//下面5行 都位于PMS构造函数
07-10 11:12:48.255  1756  1756 I boot_progress_pms_start: 30454
07-10 11:12:50.757  1756  1756 I boot_progress_pms_system_scan_start: 32956
07-10 11:12:59.829  1756  1756 I boot_progress_pms_data_scan_start: 42028
07-10 11:13:11.252  1756  1756 I boot_progress_pms_scan_end: 53451
07-10 11:13:11.728  1756  1756 I boot_progress_pms_ready: 53927

// AMS.systemReady //对应log: System now ready, 还没开始执行goingCallback.run()
07-10 11:15:31.889  1756  1756 I boot_progress_ams_ready: 194088
// AMS.enableScreenAfterBoot
07-10 11:16:12.068  1756  1806 I boot_progress_enable_screen: 234267

//聚焦home界面
07-10 11:15:50.385  1756  1756 I am_focused_activity: [0,com.miui.home/.launcher.Launcher]

07-10 11:13:12.740  1756  1756 I UsageStatsService: User[0] Rollover scheduled @ 2016-07-11 08:00:00(1468195200000)
