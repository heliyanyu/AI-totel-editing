[CmdletBinding()]
param(
    [string]$RootPath = "",
    [string]$RootPattern = 'P:\*\*\AIkaifa\AI total editing\test',
    [string]$ProjectRoot = $PSScriptRoot
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$env:HF_HUB_OFFLINE = "1"

# Load .env file for machine-specific config
$envFile = Join-Path $PSScriptRoot ".env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)$') {
            [System.Environment]::SetEnvironmentVariable($Matches[1], $Matches[2])
        }
    }
}

$PythonExe = if ($env:PYTHON_PATH) { $env:PYTHON_PATH } else { "python" }
$WorkingRoot = $env:WORKING_ROOT   # e.g. Z:\AI editing\working files
$AssetLibrary = $env:ASSET_LIBRARY # e.g. Z:\AI editing\asset library

# Editor name -> JianYing Drafts UNC path
$EditorTargets = @{
    "wangchen"     = "\\192.168.0.66\JianyingPro Drafts"
    "zhangnan"     = "\\192.168.0.6\JianyingPro Drafts"
    "xiyuting"     = "\\192.168.0.38\JianyingPro Drafts"
    "wangningjuan" = "\\192.168.0.3\JianyingPro Drafts"
    "zhouqi"       = "\\192.168.0.26\JianyingPro Drafts"
    "guojie"       = "\\192.168.0.78\JianyingPro Drafts"
    "wangchenglu"  = "\\192.168.0.8\JianyingPro Drafts"
}

function Get-EditorFromPath {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$CasePath,
        [Parameter(Mandatory = $true)]
        [string]$RootPath
    )

    $candidatePaths = @()

    if ($CasePath.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
        $relative = $CasePath.Substring($RootPath.Length).TrimStart('\', '/')
        if ($relative) {
            $candidatePaths += $relative
        }
    }

    $candidatePaths += $CasePath

    foreach ($candidatePath in $candidatePaths) {
        $segments = $candidatePath -split '[\\/]'
        foreach ($segment in $segments) {
            $editorName = $segment.ToLower()
            if ($EditorTargets.ContainsKey($editorName)) {
                return $editorName
            }
        }
    }

    return $null
}

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
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    & $Command @Arguments *> $null
    $stepExitCode = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP

    if ($stepExitCode -ne 0) {
        Write-Host ("  [FAIL] {0}" -f $FailureMessage) -ForegroundColor Red
        return $false
    }

    return $true
}

function Send-DraftToEditor {
    [CmdletBinding()]
    param(
        [Parameter(Mandatory = $true)]
        [string]$CaseDir,

        [Parameter(Mandatory = $true)]
        [string]$RootDir,

        [Parameter(Mandatory = $true)]
        [string]$OutDir
    )

    $editor = Get-EditorFromPath -CasePath $CaseDir -RootPath $RootDir
    if (-not $editor) {
        Write-Host "  [WARN] unknown editor, draft not distributed" -ForegroundColor Yellow
        return
    }

    $targetDrafts = $EditorTargets[$editor]
    $caseName = Split-Path $CaseDir -Leaf
    $draftFolderName = "${caseName}_draft"
    $localDraft = Join-Path $OutDir $draftFolderName

    if (-not (Test-Path -LiteralPath $localDraft)) {
        Write-Host ("  [WARN] local draft missing, skip distribute: {0}" -f $localDraft) -ForegroundColor Yellow
        return
    }

    $remoteDraft = Join-Path $targetDrafts $draftFolderName
    try {
        if (Test-Path -LiteralPath $remoteDraft) {
            Remove-Item -LiteralPath $remoteDraft -Recurse -Force
        }
        Copy-Item -LiteralPath $localDraft -Destination $remoteDraft -Recurse -Force
        Write-Host ("  -> sent to {0} ({1})" -f $editor, $targetDrafts) -ForegroundColor Magenta
    } catch {
        Write-Host ("  [WARN] failed to send to {0}: {1}" -f $editor, $_.Exception.Message) -ForegroundColor Yellow
    }
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
            Where-Object { $_.FullName -notmatch '\\out\\' }
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

        # Mirror P-drive structure onto working drive (SSD)
        # P:\...\260403\wangchen\某病例 -> Z:\AI editing\working files\260403\wangchen\某病例\out
        if ($WorkingRoot) {
            $datePart = Split-Path $root -Leaf
            $relative = $dir.Substring($root.Length).TrimStart('\', '/')
            $out = Join-Path $WorkingRoot (Join-Path $datePart (Join-Path $relative "out"))
        } else {
            $out = Join-Path $dir "out"
        }

        $blueprintPath = Join-Path $out "blueprint.json"
        $timingPath = Join-Path $out "timing_map.json"
        $overlayPath = Join-Path $out "overlay.mp4"
        $srtPath = Join-Path $out "subtitles.srt"

        New-Item -ItemType Directory -Path $out -Force | Out-Null

        if ((Test-Path -LiteralPath $overlayPath) -and (Test-Path -LiteralPath $srtPath)) {
            Write-Host "  already done, skip" -ForegroundColor Yellow
            Send-DraftToEditor -CaseDir $dir -RootDir $root -OutDir $out
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

        # Split overlay into per-scene clips
        $splitArgs = @(
            "scripts/split-overlay-by-scene.py",
            $out
        )

        if (-not (Invoke-CheckedStep -Name "split overlay" -Command "$PythonExe" -Arguments $splitArgs -FailureMessage "split overlay failed (non-fatal)")) {
            Write-Host "  [WARN] overlay split skipped" -ForegroundColor Yellow
        }

        # Generate JianYing draft
        $draftArgs = @(
            "scripts/generate-jianying-draft.py",
            $out
        )
        # Try asset index from asset library, fall back to project root
        $assetIndex = $null
        if ($AssetLibrary) {
            $libIndex = Join-Path $AssetLibrary "asset_index.json"
            if (Test-Path -LiteralPath $libIndex) { $assetIndex = $libIndex }
        }
        if (-not $assetIndex) {
            $localIndex = Join-Path $resolvedProjectRoot "asset_index.json"
            if (Test-Path -LiteralPath $localIndex) { $assetIndex = $localIndex }
        }
        if ($assetIndex) {
            $draftArgs += @("--asset-index", $assetIndex)
        }

        if (-not (Invoke-CheckedStep -Name "jianying draft" -Command "$PythonExe" -Arguments $draftArgs -FailureMessage "jianying draft failed (non-fatal)")) {
            Write-Host "  [WARN] jianying draft skipped" -ForegroundColor Yellow
        }

        # Distribute draft to editor's JianYing
        Send-DraftToEditor -CaseDir $dir -RootDir $root -OutDir $out

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
