

ActivityThread.java

public void dumpGfxInfo(FileDescriptor fd, String[] args) {
    dumpGraphicsInfo(fd);
    WindowManagerGlobal.getInstance().dumpGfxInfo(fd, args);
}
