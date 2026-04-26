[CmdletBinding()]
param(
    [string]$RootPath = "",
    [string]$RootPattern = 'P:\*\*\AIkaifa\AI total editing\test',
    [string]$ProjectRoot = "",
    [switch]$SkipDistribute,
    [int]$Parallel = 3,
    [switch]$SkipAssetMatching,
    [string]$VisualSegments = "",
    [string]$VisualSegmentEmbeddings = "",
    [string]$VisualSegmentKeys = "",
    [string]$VisualNeedProvider = "anthropic",
    [string]$VisualNeedModel = "claude-sonnet-4-6",
    [int]$VisualNeedBatchSize = 6,
    [int]$VisualNeedConcurrency = 8,
    [string]$RerankProvider = "anthropic",
    [string]$RerankModel = "claude-sonnet-4-6",
    [int]$RerankConcurrency = 2,
    [int]$RagTopK = 60,
    [switch]$AllowRagFallback
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

# Disable QuickEdit mode to prevent accidental clicks from freezing the console
$QuickEditCode = @'
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
        m &= ~(uint)0x0040; // ENABLE_QUICK_EDIT_MODE
        SetConsoleMode(h, m);
    }
}
'@
try {
    Add-Type -TypeDefinition $QuickEditCode -ErrorAction SilentlyContinue
    [ConsoleMode]::DisableQuickEdit()
} catch {}

$env:HF_HUB_OFFLINE = "1"

$ScriptRootDir = if ($PSScriptRoot) { $PSScriptRoot } else { (Get-Location).Path }
if (-not $ProjectRoot) { $ProjectRoot = $ScriptRootDir }

# Load .env file for machine-specific config
$envFile = Join-Path $ScriptRootDir ".env"
if (Test-Path -LiteralPath $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match '^\s*([A-Z_]+)\s*=\s*(.+)$') {
            $envValue = $Matches[2].Trim().Trim('"').Trim("'")
            [System.Environment]::SetEnvironmentVariable($Matches[1], $envValue)
        }
    }
}

$PythonExe = if ($env:PYTHON_PATH) { $env:PYTHON_PATH } else { "python" }
$WorkingRoot = $env:WORKING_ROOT

# Editor name -> JianYing Drafts UNC path
$EditorTargets = @{
    "wangchen"     = "\\192.168.0.14\JianyingPro Drafts"
    "zhangnan"     = "\\192.168.0.6\JianyingPro Drafts"
    "xiyuting"     = "\\192.168.0.113\JianyingPro Drafts"
    "wangningjuan" = "\\BF-202507221612\JianyingPro Drafts"
    "zhouqi"       = "\\192.168.0.109\JianyingPro Drafts"
    "guojie"       = "\\192.168.0.78\JianyingPro Drafts"
    "wangchenglu"  = "\\192.168.0.115\JianyingPro Drafts"
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

    $localDraftJson = Join-Path $localDraft "draft_content.json"
    if (-not (Test-Path -LiteralPath $localDraftJson)) { return }

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

$defaultAssetIndexDir = Join-Path $resolvedProjectRoot "scripts\asset_index"
if (-not $VisualSegments) {
    $VisualSegments = Join-Path $defaultAssetIndexDir "visual_segments_cbj58_5000_plus_zh_chronic.jsonl"
}
if (-not $VisualSegmentEmbeddings) {
    $VisualSegmentEmbeddings = Join-Path $defaultAssetIndexDir "visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy"
}
if (-not $VisualSegmentKeys) {
    $VisualSegmentKeys = Join-Path $defaultAssetIndexDir "visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json"
}

$assetMatchingEnabled = -not [bool]$SkipAssetMatching
if ($assetMatchingEnabled) {
    foreach ($requiredAssetPath in @($VisualSegments, $VisualSegmentEmbeddings, $VisualSegmentKeys)) {
        if (-not (Test-Path -LiteralPath $requiredAssetPath)) {
            Write-Host ("[WARN] visual asset index missing, skip asset matching: {0}" -f $requiredAssetPath) -ForegroundColor Yellow
            $assetMatchingEnabled = $false
            break
        }
    }
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
        if ($info.Docx) { $asrArgs += @("--docx", $info.Docx) }
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
    param(
        $CaseInfo,
        $ProjectRoot,
        $PythonExe,
        $Root,
        $EditorTargets,
        $SkipDistribute,
        $AssetMatchingEnabled,
        $VisualSegments,
        $VisualSegmentEmbeddings,
        $VisualSegmentKeys,
        $VisualNeedProvider,
        $VisualNeedModel,
        $VisualNeedBatchSize,
        $VisualNeedConcurrency,
        $RerankProvider,
        $RerankModel,
        $RerankConcurrency,
        $RagTopK,
        $AllowRagFallback
    )

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

    # Python renders (progress_bar + navigation) — CPU only, no GPU needed
    $visualPlanPath = Join-Path $out "visual_plan.json"
    if (Test-Path -LiteralPath $visualPlanPath) {
        $pbPath = Join-Path $out "overlay_progress_bar.mp4"
        if (-not (Test-Path -LiteralPath $pbPath)) {
            $code = RunStep "progress_bar" $PythonExe @("scripts/render_progress_bar.py", $out)
            if ($code -ne 0) { Log "  [WARN] progress_bar render failed" "Yellow" }
        } else {
            Log "  progress_bar: exists, skip" "DarkGray"
        }

        $navManifest = Join-Path (Join-Path $out "nav_scenes") "overlay_navigation_manifest.json"
        if (-not (Test-Path -LiteralPath $navManifest)) {
            $code = RunStep "navigation" $PythonExe @("scripts/render_navigation.py", $out)
            if ($code -ne 0) { Log "  [WARN] navigation render failed" "Yellow" }
        } else {
            Log "  navigation: exists, skip" "DarkGray"
        }
    } else {
        Log "  [WARN] visual_plan.json missing, skip Python renders" "Yellow"
    }

    # Split overlay
    $code = RunStep "split overlay" $PythonExe @("scripts/split-overlay-by-scene.py", $out)
    if ($code -ne 0) { Log "  [WARN] split skipped" "Yellow" }

    # Visual asset matching: blueprint -> visual needs -> visual beats -> RAG -> LLM rerank
    $matchFile = $null
    if ($AssetMatchingEnabled) {
        $visualNeedsPath = Join-Path $out "visual_needs.json"
        $visualBeatsPath = Join-Path $out "visual_beats.json"
        $ragMatchesPath = Join-Path $out "asset_matches_rag.json"
        $feedbackMatchesPath = Join-Path $out "asset_matches_rag_feedback.json"
        $rerankedMatchesPath = Join-Path $out "asset_matches_visual_reranked.json"
        $feedbackPath = Join-Path (Join-Path $ProjectRoot "scripts\asset_index") "asset_feedback.jsonl"

        if (-not (Test-Path -LiteralPath $visualNeedsPath)) {
            $code = RunStep "visual needs" $PythonExe @(
                "scripts/infer_blueprint_visual_needs.py",
                "--bp", $blueprintPath,
                "--out", $visualNeedsPath,
                "--provider", $VisualNeedProvider,
                "--model", $VisualNeedModel,
                "--batch-size", "$VisualNeedBatchSize",
                "--concurrency", "$VisualNeedConcurrency"
            )
            if ($code -ne 0) { Log "  [WARN] visual needs failed" "Yellow" }
        } else {
            Log "  visual needs: exists, skip" "DarkGray"
        }

        if ((Test-Path -LiteralPath $visualNeedsPath) -and -not (Test-Path -LiteralPath $visualBeatsPath)) {
            $code = RunStep "visual beats" $PythonExe @(
                "scripts/infer_blueprint_visual_beats.py",
                "--bp", $blueprintPath,
                "--timing-map", $timingPath,
                "--visual-needs", $visualNeedsPath,
                "--out", $visualBeatsPath,
                "--max-beats-per-seg", "3",
                "--min-sec-per-beat", "2.4"
            )
            if ($code -ne 0) { Log "  [WARN] visual beats failed" "Yellow" }
        } elseif (Test-Path -LiteralPath $visualBeatsPath) {
            Log "  visual beats: exists, skip" "DarkGray"
        }

        if ((Test-Path -LiteralPath $visualBeatsPath) -and -not (Test-Path -LiteralPath $ragMatchesPath)) {
            $code = RunStep "asset RAG" $PythonExe @(
                "scripts/match_visual_beats_to_segments.py",
                "--visual-beats", $visualBeatsPath,
                "--visual-segments", $VisualSegments,
                "--emb", $VisualSegmentEmbeddings,
                "--keys", $VisualSegmentKeys,
                "--out", $ragMatchesPath,
                "--top-k", "$RagTopK",
                "--min-confidence", "0.45",
                "--min-score", "0.0"
            )
            if ($code -ne 0) { Log "  [WARN] asset RAG failed" "Yellow" }
        } elseif (Test-Path -LiteralPath $ragMatchesPath) {
            Log "  asset RAG: exists, skip" "DarkGray"
        }

        $rerankInputPath = $ragMatchesPath
        if ((Test-Path -LiteralPath $ragMatchesPath) -and (Test-Path -LiteralPath $feedbackPath)) {
            if (-not (Test-Path -LiteralPath $feedbackMatchesPath)) {
                $code = RunStep "asset feedback" $PythonExe @(
                    "scripts/asset_feedback.py",
                    "apply",
                    "--matches", $ragMatchesPath,
                    "--feedback", $feedbackPath,
                    "--out", $feedbackMatchesPath,
                    "--drop-rejected-candidates"
                )
                if ($code -eq 0) {
                    $rerankInputPath = $feedbackMatchesPath
                } else {
                    Log "  [WARN] asset feedback apply failed" "Yellow"
                }
            } else {
                Log "  asset feedback: exists, skip" "DarkGray"
                $rerankInputPath = $feedbackMatchesPath
            }
        }

        if ((Test-Path -LiteralPath $rerankInputPath) -and -not (Test-Path -LiteralPath $rerankedMatchesPath)) {
            $code = RunStep "asset rerank" $PythonExe @(
                "scripts/rerank_visual_matches_llm.py",
                "--matches", $rerankInputPath,
                "--out", $rerankedMatchesPath,
                "--provider", $RerankProvider,
                "--model", $RerankModel,
                "--top-candidates", "12",
                "--batch-size", "3",
                "--concurrency", "$RerankConcurrency",
                "--min-fit-score", "0.72"
            )
            if ($code -ne 0) { Log "  [WARN] asset rerank failed" "Yellow" }
        } elseif (Test-Path -LiteralPath $rerankedMatchesPath) {
            Log "  asset rerank: exists, skip" "DarkGray"
        }

        if (Test-Path -LiteralPath $rerankedMatchesPath) {
            $matchFile = $rerankedMatchesPath
        } elseif ($AllowRagFallback -and (Test-Path -LiteralPath $feedbackMatchesPath)) {
            $matchFile = $feedbackMatchesPath
        } elseif ($AllowRagFallback -and (Test-Path -LiteralPath $ragMatchesPath)) {
            $matchFile = $ragMatchesPath
        }
    } else {
        Log "  asset matching: disabled or index missing" "Yellow"
    }

    # JianYing draft
    if (-not $matchFile) {
        $matchCandidates = @("asset_matches_visual_reranked.json")
        if ($AllowRagFallback) {
            $matchCandidates += @(
                "asset_matches_rag_feedback.json",
                "asset_matches_rag.json"
            )
        }
        $matchCandidates += @(
            "asset_matches_atom_v3.json",
            "asset_matches_atom_v2.json",
            "asset_matches_atom.json",
            "asset_matches_v3.json",
            "asset_matches_v2.json",
            "asset_matches_atoms.json",
            "asset_matches.json"
        )
        foreach ($name in $matchCandidates) {
            $candidate = Join-Path $out $name
            if (Test-Path -LiteralPath $candidate) {
                $matchFile = $candidate
                break
            }
        }
    }

    if ($matchFile) {
        $caseName = Split-Path $dir -Leaf
        $draftArgs = @(
            "scripts/generate-draft-from-matches.py",
            $out,
            "--matches", $matchFile,
            "--draft-name", "${caseName}_draft",
            "--min-fit-score", "0.72",
            "--max-exact-clip-reuse", "1",
            "--max-asset-file-reuse", "3",
            "--max-asset-basename-reuse", "3",
            "--min-asset-speed", "1.35",
            "--max-asset-speed", "4.0",
            "--max-asset-source-duration", "10.0"
        )
        $code = RunStep "jianying matched draft" $PythonExe $draftArgs
    } else {
        $draftArgs = @("scripts/generate-jianying-draft.py", $out)
        $code = RunStep "jianying draft" $PythonExe $draftArgs
    }
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
            $localDraftJson = Join-Path $localDraft "draft_content.json"
            if ((Test-Path -LiteralPath $localDraft) -and (Test-Path -LiteralPath $localDraftJson)) {
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
            $info,
            $resolvedProjectRoot,
            $PythonExe,
            $root,
            $EditorTargets,
            [bool]$SkipDistribute,
            $assetMatchingEnabled,
            $VisualSegments,
            $VisualSegmentEmbeddings,
            $VisualSegmentKeys,
            $VisualNeedProvider,
            $VisualNeedModel,
            $VisualNeedBatchSize,
            $VisualNeedConcurrency,
            $RerankProvider,
            $RerankModel,
            $RerankConcurrency,
            $RagTopK,
            [bool]$AllowRagFallback
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
