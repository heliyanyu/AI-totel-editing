[CmdletBinding()]
param(
    [string]$RootPath = "",
    [string]$RootPattern = 'P:\*\*\AIkaifa\AI total editing\260402',
    [string]$ProjectRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Force UTF-8 so Node.js Chinese output displays correctly
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
chcp 65001 | Out-Null

$env:HF_HUB_OFFLINE = "1"

function Resolve-SinglePath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Pattern
    )

    $resolvedPaths = @(Resolve-Path -Path $Pattern -ErrorAction SilentlyContinue)

    if ($resolvedPaths.Count -eq 0) {
        throw "No path matched pattern: $Pattern"
    }

    if ($resolvedPaths.Count -gt 1) {
        $allPaths = $resolvedPaths | ForEach-Object { $_.Path }
        throw ("Multiple paths matched pattern: {0}`n{1}" -f $Pattern, ($allPaths -join "`n"))
    }

    return $resolvedPaths[0].Path
}

function Invoke-CheckedStep {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$Name,

        [Parameter(Mandatory = $true)]
        [string]$Command,

        [Parameter(Mandatory = $true)]
        [string[]]$Arguments,

        [Parameter(Mandatory = $true)]
        [string]$FailureMessage
    )

    Write-Host ("  -> {0}..." -f $Name) -ForegroundColor Gray
    & $Command @Arguments | Out-Host

    if ($LASTEXITCODE -ne 0) {
        Write-Host ("  [FAIL] {0}" -f $FailureMessage) -ForegroundColor Red
        return $false
    }

    return $true
}

foreach ($requiredCommand in @("npm.cmd", "npx.cmd")) {
    if (-not (Get-Command $requiredCommand -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $requiredCommand"
    }
}

$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$root = if ($RootPath) {
    (Resolve-Path -LiteralPath $RootPath).Path
} else {
    Resolve-SinglePath -Pattern $RootPattern
}

Push-Location -LiteralPath $resolvedProjectRoot

try {
    $caseFiles = @(
        Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.mp4" |
            Where-Object { $_.Directory.Name -ne "out" }
    )

    $cases = @(
        $caseFiles |
            ForEach-Object { $_.DirectoryName } |
            Sort-Object -Unique
    )

    if ($cases.Count -eq 0) {
        Write-Host ("No cases found under {0}" -f $root) -ForegroundColor Yellow
        return
    }

    $total = $cases.Count
    $completedCount = 0
    $skippedCount = 0
    $failedCount = 0
    $i = 0

    foreach ($dir in $cases) {
        $i++

        $mp4Files = @(Get-ChildItem -LiteralPath $dir -File -Filter "*.mp4" | Sort-Object Name)
        $docxFiles = @(Get-ChildItem -LiteralPath $dir -File -Filter "*.docx" | Sort-Object Name)

        Write-Host ""
        Write-Host ("[{0}/{1}] {2}" -f $i, $total, $dir) -ForegroundColor Cyan

        if ($mp4Files.Count -eq 0) {
            Write-Host "  [FAIL] no source mp4 found" -ForegroundColor Red
            $failedCount++
            continue
        }

        $mp4 = $mp4Files[0].FullName
        $docx = if ($docxFiles.Count -gt 0) { $docxFiles[0].FullName } else { $null }

        $out = Join-Path $dir "out"
        $blueprintPath = Join-Path $out "blueprint.json"
        $timingPath = Join-Path $out "timing_map.json"
        $overlayPath = Join-Path $out "overlay.mp4"
        $srtPath = Join-Path $out "subtitles.srt"

        New-Item -ItemType Directory -Path $out -Force | Out-Null

        if ((Test-Path -LiteralPath $overlayPath) -and (Test-Path -LiteralPath $srtPath)) {
            Write-Host "  already done, skip" -ForegroundColor Yellow
            $skippedCount++
            continue
        }

        if (Test-Path -LiteralPath $blueprintPath) {
            Write-Host "  analyze: blueprint.json exists, skip" -ForegroundColor DarkGray
        } else {
            $analyzeArgs = @("run", "analyze", "--", "--audio", $mp4)
            if ($docx) {
                $analyzeArgs += @("--script", $docx)
            }
            $analyzeArgs += @("-o", $blueprintPath, "--transcribe-qwen", "--force-align-qwen")

            if (-not (Invoke-CheckedStep -Name "analyze" -Command "npm.cmd" -Arguments $analyzeArgs -FailureMessage "analyze failed; skipping case")) {
                $failedCount++
                continue
            }
        }

        if (Test-Path -LiteralPath $timingPath) {
            Write-Host "  timing: timing_map.json exists, skip" -ForegroundColor DarkGray
        } else {
            $timingArgs = @(
                "run",
                "timing:direct",
                "--",
                "--input",
                $mp4,
                "-b",
                $blueprintPath,
                "-o",
                $timingPath
            )

            if (-not (Invoke-CheckedStep -Name "timing" -Command "npm.cmd" -Arguments $timingArgs -FailureMessage "timing failed; skipping case")) {
                $failedCount++
                continue
            }
        }

        if (Test-Path -LiteralPath $overlayPath) {
            Write-Host "  render: overlay.mp4 exists, skip" -ForegroundColor DarkGray
        } else {
            $renderArgs = @(
                "run",
                "render",
                "--",
                "-b",
                $blueprintPath,
                "-t",
                $timingPath,
                "--source-video",
                $mp4,
                "-o",
                $overlayPath
            )

            if (-not (Invoke-CheckedStep -Name "render" -Command "npm.cmd" -Arguments $renderArgs -FailureMessage "render failed; skipping case")) {
                $failedCount++
                continue
            }
        }

        if (Test-Path -LiteralPath $srtPath) {
            Write-Host "  srt: subtitles.srt exists, skip" -ForegroundColor DarkGray
        } else {
            $srtArgs = @(
                "tsx",
                "src/renderer/export-srt.ts",
                "-b",
                $blueprintPath,
                "-t",
                $timingPath,
                "-o",
                $srtPath
            )

            if (-not (Invoke-CheckedStep -Name "srt" -Command "npx.cmd" -Arguments $srtArgs -FailureMessage "srt failed; skipping case")) {
                $failedCount++
                continue
            }
        }

        if (-not (Test-Path -LiteralPath $overlayPath)) {
            Write-Host "  [FAIL] overlay.mp4 missing" -ForegroundColor Red
            $failedCount++
            continue
        }

        # Generate JianYing draft
        $draftArgs = @(
            "scripts/generate-jianying-draft.py",
            $out
        )

        if (-not (Invoke-CheckedStep -Name "jianying draft" -Command "F:/miniconda3/envs/agent/python.exe" -Arguments $draftArgs -FailureMessage "jianying draft failed (non-fatal)")) {
            Write-Host "  [WARN] jianying draft skipped" -ForegroundColor Yellow
        }

        Write-Host "  [DONE]" -ForegroundColor Green
        $completedCount++
    }

    Write-Host ""
    Write-Host ("Batch finished. total={0} completed={1} skipped={2} failed={3}" -f $total, $completedCount, $skippedCount, $failedCount) -ForegroundColor Cyan
}
finally {
    Pop-Location
}

if ($failedCount -gt 0) {
    exit 1
}
