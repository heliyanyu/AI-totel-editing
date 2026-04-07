# Auto-dismiss JianYing update popups
# Run in background: powershell -WindowStyle Hidden -File auto-dismiss-update.ps1
# Or add to Windows startup

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll", SetLastError = true)]
    public static extern IntPtr FindWindow(string lpClassName, string lpWindowName);
    [DllImport("user32.dll")]
    public static extern bool PostMessage(IntPtr hWnd, uint Msg, IntPtr wParam, IntPtr lParam);
    public const uint WM_CLOSE = 0x0010;
}
"@

$titles = @(
    "*version*upgrade*",
    "*update*",
    "*new version*"
)

while ($true) {
    # Find JianYing child windows that look like update dialogs
    $jyWindows = Get-Process -Name "JianyingPro" -ErrorAction SilentlyContinue
    if ($jyWindows) {
        # Use UI Automation to find dialog windows
        $allWindows = [System.Diagnostics.Process]::GetProcessesByName("JianyingPro")
        foreach ($proc in $allWindows) {
            # Try common update dialog window titles
            foreach ($title in @(
                [char]0x8F6F + [char]0x4EF6 + [char]0x7248 + [char]0x672C + [char]0x9700 + [char]0x8981 + [char]0x5347 + [char]0x7EA7
            )) {
                $hwnd = [Win32]::FindWindow([NullString]::Value, $title)
                if ($hwnd -ne [IntPtr]::Zero) {
                    [Win32]::PostMessage($hwnd, [Win32]::WM_CLOSE, [IntPtr]::Zero, [IntPtr]::Zero)
                }
            }
        }
    }
    Start-Sleep -Seconds 2
}
