[CmdletBinding()]
param(
    [string]$RootPath = "",
    [string]$RootPattern = 'P:\*\*\AIkaifa\AI total editing\test',
    [string]$ProjectRoot = $PSScriptRoot,
    [switch]$SkipDistribute,
    [int]$Parallel = 3
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
$WorkingRoot = $env:WORKING_ROOT
$AssetLibrary = $env:ASSET_LIBRARY

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
        if ($relative) { $candidatePaths += $relative }
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
    param([Parameter(Mandatory)][string]$Pattern)
    $resolvedPaths = @(Resolve-Path -Path $Pattern -ErrorAction SilentlyContinue)
    if ($resolvedPaths.Count -eq 0) { throw "No path matched: $Pattern" }
    if ($resolvedPaths.Count -gt 1) { throw ("Multiple paths matched: {0}" -f ($resolvedPaths -join "`n")) }
    return $resolvedPaths[0].Path
}

function Invoke-Step {
    param([string]$Name, [string]$Command, [string[]]$Arguments)
    Write-Host ("  -> {0}..." -f $Name) -ForegroundColor Gray
    $prevEAP = $ErrorActionPreference
    $ErrorActionPreference = "SilentlyContinue"
    $errOutput = & $Command @Arguments 2>&1 | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }
    $code = $LASTEXITCODE
    $ErrorActionPreference = $prevEAP
    if ($code -ne 0) {
        Write-Host ("  [FAIL] {0}" -f $Name) -ForegroundColor Red
        if ($errOutput) {
            foreach ($line in $errOutput) {
                Write-Host ("  [ERR] {0}" -f $line) -ForegroundColor Red
            }
        }
        return $false
    }
    return $true
}

function Send-DraftToEditor {
    param([string]$CaseDir, [string]$RootDir, [string]$OutDir)

    $editor = Get-EditorFromPath -CasePath $CaseDir -RootPath $RootDir
    if (-not $editor) { return }

    $targetDrafts = $EditorTargets[$editor]
    $caseName = Split-Path $CaseDir -Leaf
    $draftFolderName = "${caseName}_draft"
    $localDraft = Join-Path $OutDir $draftFolderName

    if (-not (Test-Path -LiteralPath $localDraft)) { return }

    $remoteDraft = Join-Path $targetDrafts $draftFolderName
    try {
        if (Test-Path -LiteralPath $remoteDraft) {
            Remove-Item -LiteralPath $remoteDraft -Recurse -Force
        }
        Copy-Item -LiteralPath $localDraft -Destination $remoteDraft -Recurse -Force
        Write-Host ("  -> sent to {0}" -f $editor) -ForegroundColor Magenta
    } catch {
        Write-Host ("  [WARN] send failed: {0}" -f $_.Exception.Message) -ForegroundColor Yellow
    }
}

# ── Resolve paths ──

foreach ($cmd in @("npm.cmd", "npx.cmd")) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
        throw "Required command not found: $cmd"
    }
}

$resolvedProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$root = if ($RootPath) { (Resolve-Path -LiteralPath $RootPath).Path } else { Resolve-SinglePath $RootPattern }

$assetIndex = ""
if ($AssetLibrary) {
    $libIndex = Join-Path $AssetLibrary "asset_index.json"
    if (Test-Path -LiteralPath $libIndex) { $assetIndex = $libIndex }
}
if (-not $assetIndex) {
    $localIndex = Join-Path $resolvedProjectRoot "asset_index.json"
    if (Test-Path -LiteralPath $localIndex) { $assetIndex = $localIndex }
}

# ── Discover cases ──

$caseFiles = @(
    Get-ChildItem -LiteralPath $root -Recurse -File -Filter "*.mp4" |
        Where-Object { $_.FullName -notmatch '\\out\\' }
)
$cases = @($caseFiles | ForEach-Object { $_.DirectoryName } | Sort-Object -Unique)

if ($cases.Count -eq 0) {
    Write-Host ("No cases found under {0}" -f $root) -ForegroundColor Yellow
    exit 0
}

# Build case info list
$caseInfos = @()
foreach ($dir in $cases) {
    $mp4Files = @(Get-ChildItem -LiteralPath $dir -File -Filter "*.mp4" | Sort-Object Name)
    $docxFiles = @(Get-ChildItem -LiteralPath $dir -File -Filter "*.docx" | Sort-Object Name)
    if ($mp4Files.Count -eq 0) { continue }

    $mp4 = $mp4Files[0].FullName
    $docx = if ($docxFiles.Count -gt 0) { $docxFiles[0].FullName } else { "" }

    if ($WorkingRoot) {
        $datePart = Split-Path $root -Leaf
        $relative = $dir.Substring($root.Length).TrimStart('\', '/')
        $out = Join-Path $WorkingRoot (Join-Path $datePart (Join-Path $relative "out"))
    } else {
        $out = Join-Path $dir "out"
    }

    $caseInfos += @{ Dir = $dir; Mp4 = $mp4; Docx = $docx; Out = $out }
}

$total = $caseInfos.Count
Write-Host ("Found {0} cases" -f $total) -ForegroundColor Cyan

# ── Phase 1: ASR transcription (serial, GPU-bound) ──

Write-Host ""
Write-Host "=== Phase 1: ASR transcription (serial) ===" -ForegroundColor Yellow

$needsProcessing = @()
$skippedCount = 0
$i = 0

Push-Location -LiteralPath $resolvedProjectRoot
try {
    foreach ($info in $caseInfos) {
        $i++
        $out = $info.Out
        $mp4 = $info.Mp4
        $overlayPath = Join-Path $out "overlay.mp4"
        $srtPath = Join-Path $out "subtitles.srt"
        $transcriptRaw = Join-Path $out "transcript_raw.json"

        New-Item -ItemType Directory -Path $out -Force | Out-Null

        # Check if fully done (overlay + srt + draft)
        $caseName = Split-Path $info.Dir -Leaf
        $draftPath = Join-Path $out "${caseName}_draft"
        $draftJson = Join-Path $draftPath "draft_content.json"
        $hasDraft = Test-Path -LiteralPath $draftJson

        if ((Test-Path -LiteralPath $overlayPath) -and (Test-Path -LiteralPath $srtPath) -and $hasDraft) {
            Write-Host ("[{0}/{1}] {2} - skip (done)" -f $i, $total, $info.Dir) -ForegroundColor DarkGray
            if (-not $SkipDistribute) {
                Send-DraftToEditor -CaseDir $info.Dir -RootDir $root -OutDir $out
            }
            $skippedCount++
            continue
        }

        $needsProcessing += $info

        # ASR already done
        if (Test-Path -LiteralPath $transcriptRaw) {
            Write-Host ("[{0}/{1}] {2} - ASR exists" -f $i, $total, $info.Dir) -ForegroundColor DarkGray
            continue
        }

        # Run ASR using $PythonExe directly
        Write-Host ""
        Write-Host ("[{0}/{1}] {2}" -f $i, $total, $info.Dir) -ForegroundColor Cyan
        $asrArgs = @(
            "scripts/transcribe-qwen.py",
            "--audio", $mp4,
            "--output-dir", $out
        )
        if (-not (Invoke-Step -Name "ASR" -Command $PythonExe -Arguments $asrArgs)) {
            Write-Host "  [WARN] ASR failed, will retry in analyze" -ForegroundColor Yellow
        }
    }
} finally {
    Pop-Location
}

if ($needsProcessing.Count -eq 0) {
    Write-Host ""
    Write-Host ("All {0} cases already done. skipped={1}" -f $total, $skippedCount) -ForegroundColor Green
    exit 0
}

# ── Phase 2: analyze + render + post (parallel) ──

Write-Host ""
Write-Host ("=== Phase 2: analyze + render + post ({0} cases, {1} parallel) ===" -f $needsProcessing.Count, $Parallel) -ForegroundColor Yellow

$caseScript = {
    param($CaseInfo, $ProjectRoot, $PythonExe, $AssetIndex, $Root, $EditorTargets, $SkipDistribute)

    Set-StrictMode -Version Latest
    $ErrorActionPreference = "Stop"
    Set-Location -LiteralPath $ProjectRoot

    $dir = $CaseInfo.Dir
    $mp4 = $CaseInfo.Mp4
    $out = $CaseInfo.Out

    $log = [System.Collections.ArrayList]::new()
    $status = "done"

    function Log($msg, $color) { [void]$log.Add(@{ msg = $msg; color = $color }) }

    function RunStep($name, $command, $arguments) {
        Log ("  -> {0}..." -f $name) "Gray"
        $prevEAP = $ErrorActionPreference
        $ErrorActionPreference = "SilentlyContinue"
        $errOutput = & $command @arguments 2>&1 | Where-Object { $_ -is [System.Management.Automation.ErrorRecord] }
        $code = $LASTEXITCODE
        $ErrorActionPreference = $prevEAP
        if ($code -ne 0 -and $errOutput) {
            foreach ($line in $errOutput) {
                Log ("  [ERR] {0}" -f $line) "Red"
            }
        }
        return $code
    }

    $blueprintPath = Join-Path $out "blueprint.json"
    $timingPath = Join-Path $out "timing_map.json"
    $overlayPath = Join-Path $out "overlay.mp4"
    $srtPath = Join-Path $out "subtitles.srt"

    # Analyze (ASR already done in Phase 1, this just does LLM calls)
    if (Test-Path -LiteralPath $blueprintPath) {
        Log "  analyze: exists, skip" "DarkGray"
    } else {
        $analyzeArgs = @("run", "analyze", "--", "--audio", $mp4)
        if ($CaseInfo.Docx) { $analyzeArgs += @("--script", $CaseInfo.Docx) }
        $analyzeArgs += @("-o", $blueprintPath, "--transcribe-qwen", "--force-align-qwen")
        $code = RunStep "analyze" "npm.cmd" $analyzeArgs
        if ($code -ne 0) {
            Log "  [FAIL] analyze failed" "Red"
            return @{ Status = "failed"; Log = $log }
        }
    }

    # Timing
    if (Test-Path -LiteralPath $timingPath) {
        Log "  timing: exists, skip" "DarkGray"
    } else {
        $timingArgs = @("run", "timing:direct", "--", "--input", $mp4, "-b", $blueprintPath, "-o", $timingPath)
        $code = RunStep "timing" "npm.cmd" $timingArgs
        if ($code -ne 0) {
            Log "  [FAIL] timing failed" "Red"
            return @{ Status = "failed"; Log = $log }
        }
    }

    # Render
    if (Test-Path -LiteralPath $overlayPath) {
        Log "  render: exists, skip" "DarkGray"
    } else {
        $renderArgs = @("run", "render", "--", "-b", $blueprintPath, "-t", $timingPath, "--source-video", $mp4, "-o", $overlayPath)
        $code = RunStep "render" "npm.cmd" $renderArgs
        if ($code -ne 0) {
            Log "  [FAIL] render failed" "Red"
            return @{ Status = "failed"; Log = $log }
        }
    }

    # SRT
    if (Test-Path -LiteralPath $srtPath) {
        Log "  srt: exists, skip" "DarkGray"
    } else {
        $srtArgs = @("tsx", "src/renderer/export-srt.ts", "-b", $blueprintPath, "-t", $timingPath, "-o", $srtPath)
        $code = RunStep "srt" "npx.cmd" $srtArgs
        if ($code -ne 0) {
            Log "  [FAIL] srt failed" "Red"
            return @{ Status = "failed"; Log = $log }
        }
    }

    if (-not (Test-Path -LiteralPath $overlayPath)) {
        Log "  [FAIL] overlay.mp4 missing" "Red"
        return @{ Status = "failed"; Log = $log }
    }

    # Split overlay
    $code = RunStep "split overlay" $PythonExe @("scripts/split-overlay-by-scene.py", $out)
    if ($code -ne 0) { Log "  [WARN] split skipped" "Yellow" }

    # JianYing draft
    $draftArgs = @("scripts/generate-jianying-draft.py", $out)
    if ($AssetIndex) { $draftArgs += @("--asset-index", $AssetIndex) }
    $code = RunStep "jianying draft" $PythonExe $draftArgs
    if ($code -ne 0) { Log "  [WARN] draft failed" "Yellow" }

    # Distribute
    if (-not $SkipDistribute) {
        $editorName = $null
        if ($dir.StartsWith($Root, [System.StringComparison]::OrdinalIgnoreCase)) {
            $relative = $dir.Substring($Root.Length).TrimStart('\', '/')
            $segments = $relative -split '[\\/]'
            foreach ($seg in $segments) {
                if ($EditorTargets.ContainsKey($seg.ToLower())) {
                    $editorName = $seg.ToLower()
                    break
                }
            }
        }
        if ($editorName) {
            $targetDrafts = $EditorTargets[$editorName]
            $caseName = Split-Path $dir -Leaf
            $draftFolderName = "${caseName}_draft"
            $localDraft = Join-Path $out $draftFolderName
            if (Test-Path -LiteralPath $localDraft) {
                $remoteDraft = Join-Path $targetDrafts $draftFolderName
                try {
                    if (Test-Path -LiteralPath $remoteDraft) {
                        Remove-Item -LiteralPath $remoteDraft -Recurse -Force
                    }
                    Copy-Item -LiteralPath $localDraft -Destination $remoteDraft -Recurse -Force
                    Log ("  -> sent to {0}" -f $editorName) "Magenta"
                } catch {
                    Log ("  [WARN] send failed: {0}" -f $_.Exception.Message) "Yellow"
                }
            }
        }
    }

    Log "  [DONE]" "Green"
    return @{ Status = $status; Log = $log }
}

# Run parallel jobs
$activeJobs = @{}
$completedCount = 0
$failedCount = 0
$caseQueue = [System.Collections.Queue]::new($needsProcessing)
$caseIndex = 0

while ($caseQueue.Count -gt 0 -or $activeJobs.Count -gt 0) {
    # Launch new jobs
    while ($caseQueue.Count -gt 0 -and $activeJobs.Count -lt $Parallel) {
        $info = $caseQueue.Dequeue()
        $caseIndex++
        $label = "[{0}/{1}] {2}" -f $caseIndex, $needsProcessing.Count, $info.Dir
        Write-Host ""
        Write-Host ("START {0}" -f $label) -ForegroundColor Cyan

        $job = Start-Job -ScriptBlock $caseScript -ArgumentList @(
            $info, $resolvedProjectRoot, $PythonExe, $assetIndex,
            $root, $EditorTargets, [bool]$SkipDistribute
        )
        $activeJobs[$job.Id] = @{ Job = $job; Label = $label }
    }

    # Wait for any job to finish
    if ($activeJobs.Count -gt 0) {
        $jobs = $activeJobs.Values | ForEach-Object { $_.Job }
        $finished = $jobs | Wait-Job -Any
        foreach ($done in $finished) {
            $entry = $activeJobs[$done.Id]
            $result = Receive-Job -Job $done

            Write-Host ""
            Write-Host ("FINISH {0}" -f $entry.Label) -ForegroundColor Cyan
            if ($result.Log) {
                foreach ($line in $result.Log) {
                    Write-Host $line.msg -ForegroundColor $line.color
                }
            }

            if ($result.Status -eq "failed") { $failedCount++ } else { $completedCount++ }

            Remove-Job -Job $done
            $activeJobs.Remove($done.Id)
        }
    }
}

Write-Host ""
Write-Host ("Batch finished. total={0} completed={1} failed={2}" -f $total, $completedCount, $failedCount) -ForegroundColor Cyan

if ($failedCount -gt 0) { exit 1 }
