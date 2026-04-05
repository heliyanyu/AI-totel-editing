<#
.SYNOPSIS
    Lock JianYing 5.9 - prevent auto update
.DESCRIPTION
    Right-click this file -> Run with PowerShell (requires admin)
#>

#Requires -RunAsAdministrator

$ErrorActionPreference = "Stop"
$appRoot = "$env:LOCALAPPDATA\JianyingPro\Apps"

Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  JianYing 5.9 Anti-Update Lock Script" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 0. Check JianYing is closed
$jyProc = Get-Process -Name "JianyingPro" -ErrorAction SilentlyContinue
if ($jyProc) {
    Write-Host "[!] Please close JianYing first!" -ForegroundColor Red
    Read-Host "Press Enter to exit"
    exit 1
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

# 4. Set Apps directory to deny write
try {
    $acl = Get-Acl $appRoot
    $denyRule = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $env:USERNAME,
        [System.Security.AccessControl.FileSystemRights]::Write,
        ([System.Security.AccessControl.InheritanceFlags]::ContainerInherit -bor [System.Security.AccessControl.InheritanceFlags]::ObjectInherit),
        [System.Security.AccessControl.PropagationFlags]::None,
        [System.Security.AccessControl.AccessControlType]::Deny
    )
    $acl.AddAccessRule($denyRule)
    Set-Acl $appRoot $acl
    Write-Host "[OK] Apps directory set to deny-write" -ForegroundColor Green
}
catch {
    Write-Host "[WARN] Failed to set directory permissions: $_" -ForegroundColor Yellow
}

# 5. Clean update cache
$cachePaths = @(
    "$env:LOCALAPPDATA\JianyingPro\User Data\Config\updateInfo",
    "$env:LOCALAPPDATA\JianyingPro\User Data\Cache\TemplateUpgrade"
)
foreach ($p in $cachePaths) {
    if (Test-Path $p) {
        Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host "[OK] Cleaned cache: $(Split-Path $p -Leaf)" -ForegroundColor Green
    }
}
$updateInfoDir = "$env:LOCALAPPDATA\JianyingPro\User Data\Config\updateInfo"
New-Item -ItemType Directory -Path $updateInfoDir -Force | Out-Null
try {
    $acl2 = Get-Acl $updateInfoDir
    $denyRule2 = New-Object System.Security.AccessControl.FileSystemAccessRule(
        $env:USERNAME,
        [System.Security.AccessControl.FileSystemRights]::Write,
        [System.Security.AccessControl.AccessControlType]::Deny
    )
    $acl2.AddAccessRule($denyRule2)
    Set-Acl $updateInfoDir $acl2
    Write-Host "[OK] updateInfo directory locked" -ForegroundColor Green
}
catch {
    Write-Host "[WARN] Failed to lock updateInfo: $_" -ForegroundColor Yellow
}

# 6. Firewall: block update executables outbound
$fwRules = @(
    @{ Name = "JianYing-Block-update"; Exe = (Join-Path $ver59 "update.exe.disabled") },
    @{ Name = "JianYing-Block-DiffUpgrade"; Exe = (Join-Path $ver59 "JianyingPro-DiffUpgrade.exe.disabled") }
)
foreach ($rule in $fwRules) {
    Remove-NetFirewallRule -DisplayName $rule.Name -ErrorAction SilentlyContinue
    New-NetFirewallRule -DisplayName $rule.Name -Direction Outbound -Action Block -Program $rule.Exe -Profile Any -Enabled True | Out-Null
    Write-Host "[OK] Firewall rule: $($rule.Name)" -ForegroundColor Green
}

# 7. Block update domains in hosts
$hostsPath = "$env:SystemRoot\System32\drivers\etc\hosts"
$blockDomains = @(
    "lf-package-cdn.jianying.com",
    "lf-package.jianying.com",
    "lf-cdn-tos.jianying.com"
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

# 8. Suppress UAC prompt (run as invoker, no elevation)
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

# 9. Disable scheduled tasks
$tasks = Get-ScheduledTask | Where-Object {
    $_.TaskName -match 'jianying|JianyingPro|lveditor|bytedance'
}
foreach ($task in $tasks) {
    Disable-ScheduledTask -TaskName $task.TaskName -ErrorAction SilentlyContinue | Out-Null
    Write-Host "[OK] Disabled task: $($task.TaskName)" -ForegroundColor Green
}

# Done
Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "  Lock complete! Open JianYing to verify" -ForegroundColor Green
Write-Host "  version shows 5.9.x" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Measures applied:" -ForegroundColor Cyan
Write-Host "  1. Deleted higher version folders"
Write-Host "  2. Update exe renamed + folder placeholder"
Write-Host "  3. Apps directory deny-write"
Write-Host "  4. Update cache cleaned + locked"
Write-Host "  5. Firewall blocks update exe outbound"
Write-Host "  6. Hosts blocks update download domains"
Write-Host "  7. Scheduled tasks disabled"
Write-Host ""
Read-Host "Press Enter to exit"
