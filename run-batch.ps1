[CmdletBinding()]
param(
    [string]$RootPath = "",
    [string]$ProjectRoot = "",
    [int]$Parallel = 1,
    [switch]$SkipDistribute,
    [switch]$UseLegacyStep2,
    [switch]$UseFallbackVuBuilder,
    [switch]$Force,
    [string]$DeepSeekModel = "",
    [string]$VuCutterModel = "",
    [string]$VuPlannerModel = "",
    [string]$RenderConcurrency = "8",
    [string]$AsrPythonPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
$OutputEncoding = [System.Text.UTF8Encoding]::new()

$ScriptRootDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not $ProjectRoot) { $ProjectRoot = $ScriptRootDir }
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

function Import-DotEnv {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return }
    Get-Content -LiteralPath $Path | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+?)\s*$') {
            $name = $Matches[1]
            $value = $Matches[2].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($name, $value)
        }
    }
}

Import-DotEnv (Join-Path $ProjectRoot ".env")
$PythonExe = if ($env:PYTHON_PATH) { $env:PYTHON_PATH } else { "python" }
if (-not $DeepSeekModel) {
    $DeepSeekModel = if ($env:DEEPSEEK_MODEL) { $env:DEEPSEEK_MODEL } else { "deepseek-v4-flash" }
}
if (-not $VuCutterModel) {
    $VuCutterModel = if ($env:DEEPSEEK_VU_CUTTER_MODEL) { $env:DEEPSEEK_VU_CUTTER_MODEL } else { "deepseek-v4-pro" }
}
if (-not $VuPlannerModel) {
    $VuPlannerModel = if ($env:DEEPSEEK_VU_PLANNER_MODEL) { $env:DEEPSEEK_VU_PLANNER_MODEL } else { "deepseek-v4-pro" }
}

function Test-PythonModule {
    param([string]$Python, [string]$Module)
    if (-not $Python) { return $false }
    try {
        & $Python -c "import $Module" *> $null
        return ($LASTEXITCODE -eq 0)
    } catch {
        return $false
    }
}

$asrCandidates = @()
if ($AsrPythonPath) { $asrCandidates += $AsrPythonPath }
if ($env:ASR_PYTHON_PATH) { $asrCandidates += $env:ASR_PYTHON_PATH }
$asrCandidates += @(
    "C:\Python310\python.exe",
    "C:\Python310\python3.10.exe",
    $PythonExe
)

$AsrPythonExe = ""
foreach ($candidate in ($asrCandidates | Where-Object { $_ } | Select-Object -Unique)) {
    if (Test-PythonModule $candidate "qwen_asr") {
        $AsrPythonExe = $candidate
        break
    }
}

$QwenAsrAvailable = $false
if ($AsrPythonExe) { $QwenAsrAvailable = $true }

$EditorTargets = @{
    "wangchen"     = "\\192.168.0.14\JianyingPro Drafts"
    "zhangnan"     = "\\192.168.0.6\JianyingPro Drafts"
    "xiyuting"     = "\\192.168.0.113\JianyingPro Drafts"
    "wangningjuan" = "\\BF-202507221612\JianyingPro Drafts"
    "zhouqi"       = "\\192.168.0.109\JianyingPro Drafts"
    "guojie"       = "\\192.168.0.78\JianyingPro Drafts"
    "wangchenglu"  = "\\192.168.0.115\JianyingPro Drafts"
}

function Disable-QuickEdit {
    $code = @'
using System;
using System.Runtime.InteropServices;
public class ConsoleMode {
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern IntPtr GetStdHandle(int h);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool GetConsoleMode(IntPtr h, out uint m);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetConsoleMode(IntPtr h, uint m);
    public static void DisableQuickEdit() {
        IntPtr h = GetStdHandle(-10);
        uint m; GetConsoleMode(h, out m);
        m &= ~(uint)0x0040;
        SetConsoleMode(h, m);
    }
}
'@
    try {
        Add-Type -TypeDefinition $code -ErrorAction SilentlyContinue
        [ConsoleMode]::DisableQuickEdit()
    } catch {}
}

function Resolve-DefaultRoot {
    $base = "P:\团队空间\公司通用\AIkaifa\AI total editing"
    if (-not (Test-Path -LiteralPath $base)) {
        throw "Default batch root not found: $base"
    }
    $candidates = Get-ChildItem -LiteralPath $base -Directory |
        Where-Object { $_.Name -match '^\d{6}$' } |
        Sort-Object Name -Descending
    if ($candidates.Count -eq 0) {
        throw "No date folders found under $base"
    }
    return $candidates[0].FullName
}

function Get-EditorFromPath {
    param([string]$CasePath)
    foreach ($segment in ($CasePath -split '[\\/]')) {
        $key = $segment.ToLower()
        if ($EditorTargets.ContainsKey($key)) { return $key }
    }
    return $null
}

function Invoke-Step {
    param(
        [string]$Name,
        [string]$Command,
        [string[]]$Arguments,
        [string]$WorkingDirectory = $ProjectRoot
    )
    Write-Host ("  -> {0}" -f $Name) -ForegroundColor Gray
    Push-Location -LiteralPath $WorkingDirectory
    try {
        & $Command @Arguments
        $code = $LASTEXITCODE
    } finally {
        Pop-Location
    }
    if ($null -ne $code -and $code -ne 0) {
        throw "Step failed ($code): $Name"
    }
}

function Test-Done {
    param([string]$Path)
    return ((-not $Force) -and (Test-Path -LiteralPath $Path))
}

function Discover-Cases {
    param([string]$Root)
    $rootItem = Get-Item -LiteralPath $Root
    $caseDirs = @()
    if ($rootItem.PSIsContainer) {
        $directMp4 = @(Get-ChildItem -LiteralPath $Root -File -Filter "*.mp4" | Where-Object { $_.FullName -notmatch '\\out\\' })
        if ($directMp4.Count -gt 0) {
            $caseDirs = @($Root)
        } else {
            $caseDirs = @(Get-ChildItem -LiteralPath $Root -Recurse -File -Filter "*.mp4" |
                Where-Object { $_.FullName -notmatch '\\out\\' } |
                ForEach-Object { $_.DirectoryName } |
                Sort-Object -Unique)
        }
    } else {
        throw "RootPath must be a directory: $Root"
    }

    $cases = @()
    foreach ($dir in $caseDirs) {
        $mp4 = @(Get-ChildItem -LiteralPath $dir -File -Filter "*.mp4" | Sort-Object Name | Select-Object -First 1)
        if ($mp4.Count -eq 0) { continue }
        $docx = @(Get-ChildItem -LiteralPath $dir -File -Filter "*.docx" | Sort-Object Name | Select-Object -First 1)
        $cases += [pscustomobject]@{
            Dir = $dir
            Mp4 = $mp4[0].FullName
            Docx = if ($docx.Count -gt 0) { $docx[0].FullName } else { "" }
            Out = Join-Path $dir "out"
            Name = Split-Path $dir -Leaf
        }
    }
    return $cases
}

function Copy-DraftToEditor {
    param([pscustomobject]$Case, [string]$DraftDir)
    if ($SkipDistribute) { return }
    $editor = Get-EditorFromPath $Case.Dir
    if (-not $editor) { return }
    $targetRoot = $EditorTargets[$editor]
    if (-not (Test-Path -LiteralPath $targetRoot)) {
        Write-Host ("  [WARN] editor target unavailable: {0}" -f $targetRoot) -ForegroundColor Yellow
        return
    }
    $dest = Join-Path $targetRoot (Split-Path $DraftDir -Leaf)
    if (Test-Path -LiteralPath $dest) {
        Remove-Item -LiteralPath $dest -Recurse -Force
    }
    Copy-Item -LiteralPath $DraftDir -Destination $dest -Recurse -Force
    Write-Host ("  -> sent to {0}: {1}" -f $editor, $dest) -ForegroundColor Magenta
}

function Invoke-Case {
    param([pscustomobject]$Case)

    $out = $Case.Out
    New-Item -ItemType Directory -Force -Path $out | Out-Null

    $transcriptRaw = Join-Path $out "transcript_raw.json"
    $blueprint = Join-Path $out "blueprint.json"
    $timing = Join-Path $out "timing_map.json"
    $overlay = Join-Path $out "overlay.mp4"
    $srt = Join-Path $out "subtitles.srt"
    $progressFull = Join-Path $out "overlay_progress_bar_full.mp4"
    $progress = Join-Path $out "overlay_progress_bar.mp4"
    $vuFile = Join-Path $out "visual_units.auto.json"
    $labelsFile = Join-Path $out "progress_nav_labels.json"
    $vuCutReport = Join-Path $out "vu_cut_report.json"
    $vuJobs = Join-Path $out "vu_render_jobs.json"
    $vuPlans = Join-Path $out "vu_plans.deepseek.json"
    $vuVideoDir = Join-Path $out "vu_overlays"
    $draftName = "$($Case.Name)_draft"
    $draftDir = Join-Path $out $draftName

    Write-Host ""
    Write-Host ("=== {0} ===" -f $Case.Dir) -ForegroundColor Cyan
    $useQwenForCase = $QwenAsrAvailable

    if (-not (Test-Done $transcriptRaw)) {
        if ($useQwenForCase) {
            $args = @("scripts/transcribe-qwen.py", "--audio", $Case.Mp4, "--output-dir", $out)
            if ($Case.Docx) { $args += @("--docx", $Case.Docx) }
            try {
                Invoke-Step "ASR transcription" $AsrPythonExe $args
            } catch {
                if ($Case.Docx) {
                    Write-Host ("  [WARN] qwen_asr failed; falling back to docx transcript: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
                    $useQwenForCase = $false
                    Invoke-Step "fallback transcript" $PythonExe @("scripts/transcribe-docx-fallback.py", "--audio", $Case.Mp4, "--docx", $Case.Docx, "--output-dir", $out)
                } else {
                    throw
                }
            }
        } elseif ($Case.Docx) {
            Write-Host "  [WARN] qwen_asr unavailable; using docx fallback transcript" -ForegroundColor Yellow
            Invoke-Step "fallback transcript" $PythonExe @("scripts/transcribe-docx-fallback.py", "--audio", $Case.Mp4, "--docx", $Case.Docx, "--output-dir", $out)
        } else {
            throw "qwen_asr unavailable and no docx fallback exists."
        }
    } else {
        Write-Host "  ASR: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $blueprint)) {
        $args = @("run", "analyze", "--", "--audio", $Case.Mp4, "-o", $blueprint)
        if ($useQwenForCase) {
            $args += @(
                "--transcribe-qwen",
                "--transcribe-python", $AsrPythonExe,
                "--force-align-qwen",
                "--force-align-python", $AsrPythonExe
            )
        } else {
            $args += @("--transcript", $transcriptRaw)
        }
        if ($Case.Docx) { $args += @("--script", $Case.Docx) }
        if (-not $UseLegacyStep2) { $args += "--skip-step2" }
        Invoke-Step "analyze blueprint" "npm.cmd" $args
    } else {
        Write-Host "  blueprint: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $timing)) {
        Invoke-Step "timing map" "npm.cmd" @("run", "timing:direct", "--", "--input", $Case.Mp4, "-b", $blueprint, "-o", $timing)
    } else {
        Write-Host "  timing: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $overlay)) {
        Invoke-Step "base render artifacts" "npm.cmd" @("run", "render", "--", "-b", $blueprint, "-t", $timing, "--source-video", $Case.Mp4, "-o", $overlay, "--concurrency", $RenderConcurrency)
    } else {
        Write-Host "  base render: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $srt)) {
        Invoke-Step "export subtitles" "npx.cmd" @("tsx", "src/renderer/export-srt.ts", "-b", $blueprint, "-t", $timing, "-o", $srt)
    } else {
        Write-Host "  subtitles: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $vuFile)) {
        if ($UseFallbackVuBuilder) {
            Invoke-Step "build visual units (fallback)" "npm.cmd" @("run", "vu:from-blueprint", "--", "-b", $blueprint, "-t", $timing, "-o", $vuFile, "--source", $Case.Dir)
        } else {
            Invoke-Step "DeepSeek VU cutter" "npm.cmd" @(
                "run", "vu:cut", "--",
                "-b", $blueprint,
                "-t", $timing,
                "-o", $vuFile,
                "--labels-output", $labelsFile,
                "--report", $vuCutReport,
                "--source", $Case.Dir,
                "--model", $VuCutterModel
            )
        }
    } else {
        Write-Host "  visual units: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $progress)) {
        Invoke-Step "progress bar full render" $PythonExe @("scripts/render_progress_bar.py", $out, "-o", $progressFull)
        Invoke-Step "progress bar crop" "ffmpeg" @("-y", "-hide_banner", "-loglevel", "error", "-i", $progressFull, "-vf", "crop=1080:180:0:40", "-pix_fmt", "yuv420p", "-an", $progress)
    } else {
        Write-Host "  progress: exists, skip" -ForegroundColor DarkGray
    }

    $navManifest = Join-Path (Join-Path $out "nav_scenes") "overlay_navigation_manifest.json"
    if (-not (Test-Done $navManifest)) {
        Invoke-Step "navigation render" $PythonExe @("scripts/render_navigation.py", $out)
    } else {
        Write-Host "  navigation: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $vuJobs)) {
        Invoke-Step "build VU render jobs" "npm.cmd" @("run", "vu:jobs", "--", "--input", $vuFile, "--output", $vuJobs)
    } else {
        Write-Host "  VU jobs: exists, skip" -ForegroundColor DarkGray
    }

    if (-not (Test-Done $vuPlans)) {
        Invoke-Step "DeepSeek VU planning" "npm.cmd" @("run", "vu:plan", "--", "--input", $vuJobs, "--output", $vuPlans, "--model", $VuPlannerModel)
    } else {
        Write-Host "  VU plans: exists, skip" -ForegroundColor DarkGray
    }

    $existingVuVideos = @(Get-ChildItem -LiteralPath $vuVideoDir -Filter "*.mp4" -ErrorAction SilentlyContinue)
    if ($Force -or $existingVuVideos.Count -eq 0) {
        New-Item -ItemType Directory -Force -Path $vuVideoDir | Out-Null
        Invoke-Step "render VU overlays" "npm.cmd" @("run", "vu:render", "--", "--jobs", $vuJobs, "--plans", $vuPlans, "--output-dir", $vuVideoDir, "--concurrency", $RenderConcurrency)
    } else {
        Write-Host "  VU overlays: exists, skip" -ForegroundColor DarkGray
    }

    $draftJson = Join-Path $draftDir "draft_content.json"
    if (-not (Test-Done $draftJson)) {
        Invoke-Step "Jianying draft" $PythonExe @(
            "scripts/generate-vu-overlay-jianying-draft.py",
            "--case-out", $out,
            "--vu-file", $vuFile,
            "--vu-video-dir", $vuVideoDir,
            "--target", $out,
            "--draft-name", $draftName
        )
    } else {
        Write-Host "  draft: exists, skip" -ForegroundColor DarkGray
    }

    Copy-DraftToEditor $Case $draftDir
    Write-Host ("  [DONE] draft: {0}" -f $draftDir) -ForegroundColor Green
}

Disable-QuickEdit
$env:HF_HUB_OFFLINE = "1"

foreach ($cmd in @("npm.cmd", "npx.cmd", "ffmpeg")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $cmd"
    }
}

$root = if ($RootPath) { (Resolve-Path -LiteralPath $RootPath).Path } else { Resolve-DefaultRoot }
$cases = @(Discover-Cases $root)
if ($cases.Count -eq 0) {
    Write-Host ("No cases found under {0}" -f $root) -ForegroundColor Yellow
    exit 0
}

Write-Host ("Project: {0}" -f $ProjectRoot) -ForegroundColor Cyan
Write-Host ("Root: {0}" -f $root) -ForegroundColor Cyan
Write-Host ("Cases: {0}; Step2={1}; VUCutter={2}; VUPlanner={3}; QwenASR={4}; AsrPython={5}" -f $cases.Count, ($(if ($UseLegacyStep2) { "legacy" } else { "skipped" })), ($(if ($UseFallbackVuBuilder) { "fallback" } else { $VuCutterModel })), $VuPlannerModel, $QwenAsrAvailable, ($(if ($AsrPythonExe) { $AsrPythonExe } else { "-" }))) -ForegroundColor Cyan
if ($Parallel -gt 1) {
    Write-Host "Parallel is currently accepted for compatibility; VU E2E runs serially to avoid GPU/API contention." -ForegroundColor Yellow
}

$failed = 0
foreach ($case in $cases) {
    try {
        Invoke-Case $case
    } catch {
        $failed++
        Write-Host ("  [FAIL] {0}" -f $_.Exception.Message) -ForegroundColor Red
    }
}

Write-Host ""
Write-Host ("Batch finished. total={0} failed={1}" -f $cases.Count, $failed) -ForegroundColor Cyan
if ($failed -gt 0) { exit 1 }
