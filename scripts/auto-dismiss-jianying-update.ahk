; Auto-dismiss JianYing update popup
; Run this script in background, it will auto-click "Cancel" on update dialogs
;
; Install: https://www.autohotkey.com/download/
; Usage: double-click this file to run in background

#Persistent
#SingleInstance Force
SetTimer, CheckUpdatePopup, 500
return

CheckUpdatePopup:
; Match JianYing windows with update-related titles
if WinExist("ahk_exe JianyingPro.exe")
{
    ; Look for the update dialog and send Escape to dismiss it
    ControlGet, btnList, List,, SysListView321, ahk_exe JianyingPro.exe

    ; Try clicking "Cancel" / "取消" button if it exists
    IfWinExist, 软件版本需要升级
    {
        WinActivate
        Send {Escape}
    }

    ; Also try matching the generic update prompt
    IfWinExist, 发现新版本
    {
        WinActivate
        Send {Escape}
    }

    IfWinExist, 版本更新
    {
        WinActivate
        Send {Escape}
    }
}
return
