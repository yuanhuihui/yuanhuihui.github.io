app.crashing = true;
    NativeCrashListener.consumeNativeCrashData
    AMS.makeAppCrashingLocked


app.notResponding = true;
    AMS.appNotResponding
    AMS.makeAppNotRespondingLocked

app.killedByAm = true;
    ProcessRecord.kill

app.killed = true;
    ProcessRecord.kill
    AMS.appDiedLocked
