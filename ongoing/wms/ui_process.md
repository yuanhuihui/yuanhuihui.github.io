ActivityManager: Displayed com.miui.notes/.v8.activity.FolderListActivity: +183ms



### 启动流程

AppWindowToken.updateReportedVisibilityLocked
    WMS.handleMessage()  REPORT_APPLICATION_TOKEN_DRAWN
        AR.Token.windowsDrawn (其中Token extends IApplicationToken.Stub )
            AR.windowsDrawnLocked
                AR.reportLaunchTimeLocked
    
AppWindowToken.updateReportedVisibilityLocked
    WMS.handleMessage()  REPORT_APPLICATION_TOKEN_WINDOWS
        AR.Token.windowsVisible            
            AR.windowsVisibleLocked
            
            
WMS.performLayoutAndPlaceSurfacesLocked
    WMS.performLayoutAndPlaceSurfacesLockedLoop
        WMS.performLayoutAndPlaceSurfacesLockedInner