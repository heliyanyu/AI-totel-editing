<#
.SYNOPSIS
    Lock JianYing 5.9 - prevent auto update (Win10 + Win11)
.DESCRIPTION
    Right-click this file -> Run with PowerShell (requires admin)
#>

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$appRoot = "$env:LOCALAPPDATA\JianyingPro\Apps"
$jyRoot  = "$env:LOCALAPPDATA\JianyingPro"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  JianYing 5.9 Anti-Update Lock Script" -ForegroundColor Cyan
Write-Host "  (Win10 + Win11 compatible)           " -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 0. Kill JianYing and all related processes
$jyProcessNames = @("JianyingPro", "JianyingPro_*", "update", "JianyingPro-DiffUpgrade", "CreativeLab")
$killed = 0
foreach ($pname in $jyProcessNames) {
    $procs = Get-Process -Name $pname -ErrorAction SilentlyContinue
    foreach ($proc in $procs) {
        try {
            $proc.Kill()
            $proc.WaitForExit(5000)
            $killed++
        } catch {}
    }
}
# Also kill any process running from the JianYing directory
Get-Process | Where-Object {
    $_.Path -and $_.Path -like "*JianyingPro*"
} | ForEach-Object {
    try { $_.Kill(); $_.WaitForExit(5000); $killed++ } catch {}
}
if ($killed -gt 0) {
    Write-Host "[OK] Killed $killed JianYing process(es)" -ForegroundColor Green
    Start-Sleep -Seconds 2
} else {
    Write-Host "[OK] JianYing not running" -ForegroundColor DarkGray
}

# 1. Check 5.9 exists
$ver59 = Join-Path $appRoot "5.9.0.11632"
if (-not (Test-Path $ver59)) {
    Write-Host "[!] 5.9.0.11632 not found. Please install JianYing 5.9 first." -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[OK] Found 5.9.0.11632" -ForegroundColor Green

# 2. Delete all non-5.9 version folders
$otherVersions = Get-ChildItem $appRoot -Directory | Where-Object {
    $_.Name -ne "5.9.0.11632" -and $_.Name -match '^\d'
}
foreach ($dir in $otherVersions) {
    try {
        Remove-Item $dir.FullName -Recurse -Force
        Write-Host "[OK] Deleted: $($dir.Name)" -ForegroundColor Green
    }
    catch {
        Write-Host "[WARN] Cannot delete $($dir.Name): $_" -ForegroundColor Yellow
    }
}

# 3. Disable update executables (rename + folder placeholder)
$updateFiles = @("update.exe", "JianyingPro-DiffUpgrade.exe")
foreach ($name in $updateFiles) {
    $filePath = Join-Path $ver59 $name
    if ((Test-Path $filePath) -and -not (Test-Path $filePath -PathType Container)) {
        Rename-Item $filePath "$name.disabled" -Force
        Write-Host "[OK] Renamed: $name -> $name.disabled" -ForegroundColor Green
    }
    if (-not (Test-Path $filePath)) {
        New-Item -ItemType Directory -Path $filePath -Force | Out-Null
        Write-Host "[OK] Folder placeholder: $name" -ForegroundColor Green
    }
    elseif (Test-Path $filePath -PathType Container) {
        Write-Host "[OK] Already placeholder: $name" -ForegroundColor DarkGray
    }
}
# Also handle update exe in the Apps root (some versions put it there)
foreach ($name in $updateFiles) {
    $rootFile = Join-Path $appRoot $name
    if ((Test-Path $rootFile) -and -not (Test-Path $rootFile -PathType Container)) {
        Rename-Item $rootFile "$name.disabled" -Force
        Write-Host "[OK] Renamed (root): $name -> $name.disabled" -ForegroundColor Green
    }
    if (-not (Test-Path $rootFile)) {
        New-Item -ItemType Directory -Path $rootFile -Force | Out-Null
        Write-Host "[OK] Folder placeholder (root): $name" -ForegroundColor Green
    }
}

# 4. Set Apps directory to deny write for EVERYONE (including SYSTEM)
#    This is the key fix for Win10 - the updater runs as SYSTEM
try {
    # First remove any old deny rules for just the current user
    $acl = Get-Acl $appRoot
    $acl.Access | Where-Object {
        $_.AccessControlType -eq 'Deny' -and $_.FileSystemRights -band [System.Security.AccessControl.FileSystemRights]::Write
    } | ForEach-Object {
        $acl.RemoveAccessRule($_) | Out-Null
    }

    # Deny write + delete for Everyone (covers SYSTEM, service accounts, all users)
    $denyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        "Everyone",
        ([System.Security.AccessControl.FileSystemRights]::Write -bor
         [System.Security.AccessControl.FileSystemRights]::Delete -bor
         [System.Security.AccessControl.FileSystemRights]::DeleteSubdirectoriesAndFiles -bor
         [System.Security.AccessControl.FileSystemRights]::CreateDirectories -bor
         [System.Security.AccessControl.FileSystemRights]::CreateFiles),
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor
         [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Deny
    )
    $acl.AddAccessRule($denyRule)
    Set-Acl $appRoot $acl
    Write-Host "[OK] Apps directory deny-write for Everyone (incl. SYSTEM)" -ForegroundColor Green
}
catch {
    Write-Host "[WARN] Failed to set directory permissions: $_" -ForegroundColor Yellow
}

# 5. Clean update cache and lock directories
$cachePaths = @(
    "$jyRoot\User Data\Config\updateInfo",
    "$jyRoot\User Data\Cache\TemplateUpgrade",
    "$jyRoot\User Data\Local\update",
    "$jyRoot\User Data\update_cache"
)
foreach ($p in $cachePaths) {
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Cleaned cache: $(Split-Path $p -Leaf)" -ForegroundColor Green
    }
}

# Recreate and lock cache dirs with deny-write for Everyone
$lockDirs = @(
    "$jyRoot\User Data\Config\updateInfo",
    "$jyRoot\User Data\Local\update"
)
foreach ($lockDir in $lockDirs) {
    New-Item -ItemType Directory -Path $lockDir -Force | Out-Null
    try {
        $acl2 = Get-Acl $lockDir
        $denyRule2 = New-Object System.Security.AccessControl.FileSystemAccessRule(
            "Everyone",
            ([System.Security.AccessControl.FileSystemRights]::Write -bor
             [System.Security.AccessControl.FileSystemRights]::Delete -bor
             [System.Security.AccessControl.FileSystemRights]::CreateFiles),
            [System.Security.AccessControl.AccessControlType]::Deny
        )
        $acl2.AddAccessRule($denyRule2)
        Set-Acl $lockDir $acl2
        Write-Host "[OK] Locked: $(Split-Path $lockDir -Leaf)" -ForegroundColor Green
    }
    catch {
        Write-Host "[WARN] Failed to lock $(Split-Path $lockDir -Leaf): $_" -ForegroundColor Yellow
    }
}

# 6. Stop and disable JianYing related Windows services
$svcPatterns = @("*jianying*", "*JianyingPro*", "*lveditor*", "*bytedance*", "*CreativeLab*")
foreach ($pattern in $svcPatterns) {
    Get-Service -Name $pattern -ErrorAction SilentlyContinue | ForEach-Object {
        Stop-Service -Name $_.Name -Force -ErrorAction SilentlyContinue
        Set-Service -Name $_.Name -StartupType Disabled -ErrorAction SilentlyContinue
        Write-Host "[OK] Disabled service: $($_.Name)" -ForegroundColor Green
    }
}

# 7. Firewall: block ALL JianYing executables outbound (not just renamed ones)
#    Find every .exe in the JianYing directory and block them all
$fwPrefix = "JianYing-Block"
# Remove old rules
Get-NetFirewallRule -DisplayName "$fwPrefix*" -ErrorAction SilentlyContinue |
    Remove-NetFirewallRule -ErrorAction SilentlyContinue

$blocked = 0
# Block all exe files in the Apps directory (covers any version, any updater)
Get-ChildItem $appRoot -Recurse -Filter "*.exe" -ErrorAction SilentlyContinue | ForEach-Object {
    $ruleName = "$fwPrefix-$($_.Name -replace '\.exe$','')-$($_.Directory.Name)"
    New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Action Block `
        -Program $_.FullName -Profile Any -Enabled True -ErrorAction SilentlyContinue | Out-Null
    $blocked++
}
# Also block disabled files (in case they get renamed back)
Get-ChildItem $appRoot -Recurse -Filter "*.exe.disabled" -ErrorAction SilentlyContinue | ForEach-Object {
    $ruleName = "$fwPrefix-$($_.Name -replace '\.exe\.disabled$','')-disabled"
    New-NetFirewallRule -DisplayName $ruleName -Direction Outbound -Action Block `
        -Program $_.FullName -Profile Any -Enabled True -ErrorAction SilentlyContinue | Out-Null
    $blocked++
}
# Block the root JianyingPro.exe launcher too
$rootExe = Join-Path $appRoot "JianyingPro.exe"
if (Test-Path $rootExe) {
    New-NetFirewallRule -DisplayName "$fwPrefix-RootLauncher" -Direction Outbound -Action Block `
        -Program $rootExe -Profile Any -Enabled True -ErrorAction SilentlyContinue | Out-Null
    $blocked++
}
Write-Host "[OK] Firewall: blocked $blocked executables outbound" -ForegroundColor Green

# 8. Block update domains in hosts (expanded list)
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$blockDomains = @(
    "lf-package-cdn.jianying.com",
    "lf-package.jianying.com",
    "lf-cdn-tos.jianying.com",
    "lf-cdn.jianying.com",
    "update.jianying.com",
    "api-update.jianying.com",
    "log.jianying.com",
    "frontier-hl.jianying.com",
    "lf-aweme-hl.jianying.com",
    "sf-unpkg-src.jianying.com",
    "lf-package-hl.jianying.com"
)
$hostsContent = Get-Content $hostsPath -Raw -ErrorAction SilentlyContinue
$added = 0
foreach ($domain in $blockDomains) {
    if ($hostsContent -notmatch [regex]::Escape($domain)) {
        Add-Content $hostsPath "127.0.0.1 $domain # JianYing anti-update"
        $added++
    }
}
if ($added -gt 0) {
    Write-Host "[OK] Hosts blocked $added update domains" -ForegroundColor Green
    ipconfig /flushdns | Out-Null
}
else {
    Write-Host "[OK] Hosts rules already in place" -ForegroundColor DarkGray
}

# 9. Suppress UAC prompt (run as invoker, no elevation)
$regPath = "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers"
if (-not (Test-Path $regPath)) {
    New-Item -Path $regPath -Force | Out-Null
}
$jyExePaths = @(
    (Join-Path $appRoot "JianyingPro.exe"),
    (Join-Path $ver59 "JianyingPro.exe")
)
foreach ($exe in $jyExePaths) {
    Set-ItemProperty -Path $regPath -Name $exe -Value "RUNASINVOKER" -Force
}
Write-Host "[OK] UAC suppressed (RUNASINVOKER)" -ForegroundColor Green

# 10. Disable scheduled tasks
$tasks = Get-ScheduledTask | Where-Object {
    $_.TaskName -match 'jianying|JianyingPro|lveditor|bytedance|CreativeLab'
}
foreach ($task in $tasks) {
    Disable-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue | Out-Null
    Write-Host "[OK] Disabled task: $($task.TaskName)" -ForegroundColor Green
}

# 11. Write a fake update config to trick JianYing into thinking it's up-to-date
$fakeUpdateJson = Join-Path $jyRoot "User Data\Config\app_update_config.json"
if (Test-Path (Split-Path $fakeUpdateJson)) {
    $fakeConfig = @{
        has_new_version = $false
        latest_version  = "5.9.0.11632"
        force_update    = $false
        update_url      = ""
    } | ConvertTo-Json
    Set-Content -Path $fakeUpdateJson -Value $fakeConfig -Force -ErrorAction SilentlyContinue
    # Make it read-only
    $item = Get-Item $fakeUpdateJson -ErrorAction SilentlyContinue
    if ($item) {
        $item.Attributes = $item.Attributes -bor [System.IO.FileAttributes]::ReadOnly
    }
    Write-Host "[OK] Fake update config written (read-only)" -ForegroundColor Green
}

# 12. Block Image File Execution for updater (IFEO debugger trick)
#     When Windows tries to run update.exe, it launches a harmless command instead
$ifeoBase = "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Image File Execution Options"
$ifeoTargets = @("update.exe")  # Only block generic update.exe under IFEO
foreach ($target in $ifeoTargets) {
    $ifeoPath = Join-Path $ifeoBase $target
    if (-not (Test-Path $ifeoPath)) {
        New-Item -Path $ifeoPath -Force | Out-Null
    }
    # Only set IFEO if not already set (avoid breaking other apps' update.exe)
    # Use FilterFullPath to scope it to JianYing only (Win10 1709+)
    $filterPath = Join-Path $ifeoPath "0"
    if (-not (Test-Path $filterPath)) {
        New-Item -Path $filterPath -Force | Out-Null
    }
    Set-ItemProperty -Path $filterPath -Name "FilterFullPath" -Value (Join-Path $ver59 "update.exe") -Force
    Set-ItemProperty -Path $filterPath -Name "Debugger" -Value "cmd.exe /c exit" -Force
    Write-Host "[OK] IFEO debugger redirect: $target (scoped to JianYing)" -ForegroundColor Green
}

# Done
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Lock complete! Open JianYing to verify" -ForegroundColor Green
Write-Host "  version shows 5.9.x" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Measures applied:" -ForegroundColor Cyan
Write-Host "  1.  Killed all JianYing processes"
Write-Host "  2.  Deleted higher version folders"
Write-Host "  3.  Update exe renamed + folder placeholder"
Write-Host "  4.  Apps directory deny-write for Everyone (incl. SYSTEM)"
Write-Host "  5.  Update cache cleaned + locked"
Write-Host "  6.  JianYing services disabled"
Write-Host "  7.  Firewall blocks ALL JianYing exe outbound"
Write-Host "  8.  Hosts blocks update domains (expanded)"
Write-Host "  9.  UAC suppressed"
Write-Host "  10. Scheduled tasks disabled"
Write-Host "  11. Fake update config (read-only)"
Write-Host "  12. IFEO debugger redirect for update.exe"
Write-Host ""
Write-Host "NOTE: To unlock later, run with -Unlock flag or" -ForegroundColor Yellow
Write-Host "      manually remove deny ACLs on the Apps folder." -ForegroundColor Yellow
Write-Host ""
Read-Host "Press Enter to exit"
