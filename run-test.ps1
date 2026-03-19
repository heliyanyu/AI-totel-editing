param(
    [switch]$Force,
    [int]$Step = 0,
    [string]$ScriptPath = "",
    [string]$Model = "claude-opus-4-6",
    [ValidateSet("source_direct", "cut_video")]
    [string]$RenderMode = "source_direct"
)

$ErrorActionPreference = "Stop"
$video = "test\demo01.mp4"
$out = "output\demo01"

if (-not $ScriptPath) {
    $base = [System.IO.Path]::ChangeExtension($video, $null)
    foreach ($ext in @(".docx", ".txt", ".md")) {
        $candidate = "$base$ext"
        if (Test-Path $candidate) {
            $ScriptPath = $candidate
            break
        }
    }
}

Write-Host "`n=== Pipeline E2E Test ===" -ForegroundColor Cyan
Write-Host "Render mode: $RenderMode" -ForegroundColor Cyan

$key = [System.Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
if (-not $key) { Write-Host "ERROR: ANTHROPIC_API_KEY not set" -ForegroundColor Red; exit 1 }
$env:ANTHROPIC_API_KEY = $key
Write-Host "API Key: OK (len=$($key.Length))" -ForegroundColor Green

if (-not (Test-Path $video)) { Write-Host "ERROR: $video not found" -ForegroundColor Red; exit 1 }
Write-Host "Input: $video" -ForegroundColor Green
if ($ScriptPath) {
    Write-Host "Script: $ScriptPath" -ForegroundColor Green
}

New-Item -ItemType Directory -Force -Path $out | Out-Null

if ($Force) {
    Write-Host "Cleaning output..." -ForegroundColor Magenta
    Get-ChildItem $out -Force |
        Where-Object { $_.Name -ne "transcript.json" } |
        Remove-Item -Recurse -Force -Confirm:$false -ErrorAction SilentlyContinue
}
if ($Step -eq 2) {
    @(
        "blueprint.json",
        "step1_result.json",
        "step1_cleaned.json",
        "step1_hints.json",
        "transcript_plain.txt",
        "script_plain.txt",
        "transcript_review.json",
        "reviewed_transcript.json",
        "reviewed_transcript.txt",
        "llm-step1-raw-0.txt",
        "llm-step1-parsed-0.json",
        "llm-step2-raw-0.txt",
        "llm-step2-parsed-0.json"
    ) | ForEach-Object {
        Remove-Item (Join-Path $out $_) -ErrorAction SilentlyContinue
    }
}
if ($Step -eq 3) {
    @("timing_map.json", "timing_clips_debug.json", "cut_video.mp4", "result.mp4") | ForEach-Object {
        Remove-Item (Join-Path $out $_) -ErrorAction SilentlyContinue
    }
}
if ($Step -eq 4) {
    Remove-Item (Join-Path $out "result.mp4") -ErrorAction SilentlyContinue
}

Write-Host ""
$t1 = Join-Path $out "transcript.json"
if (($Step -eq 0 -or $Step -eq 1) -and -not (Test-Path $t1)) {
    Write-Host "[Step 1] Transcribing..." -ForegroundColor Yellow
    python src\transcribe\index.py $video -o $t1
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED" -ForegroundColor Red; exit 1 }
    Write-Host "Step 1 done" -ForegroundColor Green
} else {
    Write-Host "[Step 1] Skip (transcript exists)" -ForegroundColor DarkGray
}

Write-Host ""
$bp = Join-Path $out "blueprint.json"
if (($Step -eq 0 -or $Step -eq 2) -and -not (Test-Path $bp)) {
    Write-Host "[Step 2] LLM Analyze ($Model)..." -ForegroundColor Yellow
    $analyzeArgs = @("tsx", "src\analyze\index.ts", "--transcript", $t1, "-o", $bp, "--model", $Model)
    if ($ScriptPath) {
        $analyzeArgs += @("--script", $ScriptPath)
    }
    npx @analyzeArgs
    if ($LASTEXITCODE -ne 0) {
        Write-Host "FAILED - check debug files:" -ForegroundColor Red
        Write-Host "  Step 1 raw:       $(Join-Path $out 'llm-step1-raw-0.txt')" -ForegroundColor Yellow
        Write-Host "  Step 1 parsed:    $(Join-Path $out 'llm-step1-parsed-0.json')" -ForegroundColor Yellow
        Write-Host "  Step 2 raw:       $(Join-Path $out 'llm-step2-raw-0.txt')" -ForegroundColor Yellow
        Write-Host "  Step 2 parsed:    $(Join-Path $out 'llm-step2-parsed-0.json')" -ForegroundColor Yellow
        exit 1
    }
    Write-Host "Step 2 done" -ForegroundColor Green
} else {
    Write-Host "[Step 2] Skip (blueprint exists)" -ForegroundColor DarkGray
}

Write-Host ""
$timingMap = Join-Path $out "timing_map.json"
$debugPlan = Join-Path $out "timing_clips_debug.json"
$cv = Join-Path $out "cut_video.mp4"
if ($RenderMode -eq "source_direct") {
    if (($Step -eq 0 -or $Step -eq 3) -and -not (Test-Path $timingMap)) {
        if (-not (Test-Path $bp)) { Write-Host "Need blueprint.json first!" -ForegroundColor Red; exit 1 }
        Write-Host "[Step 3] Building source_direct timing map..." -ForegroundColor Yellow
        npx tsx src\timing\build-direct-timing-map.ts --input $video --blueprint $bp -o $timingMap
        if ($LASTEXITCODE -ne 0) { Write-Host "FAILED" -ForegroundColor Red; exit 1 }
        Write-Host "Step 3 done" -ForegroundColor Green
    } else {
        Write-Host "[Step 3] Skip (timing_map exists)" -ForegroundColor DarkGray
    }
} else {
    if (($Step -eq 0 -or $Step -eq 3) -and -not (Test-Path $cv)) {
        if (-not (Test-Path $bp)) { Write-Host "Need blueprint.json first!" -ForegroundColor Red; exit 1 }
        Write-Host "[Step 3] Cutting video..." -ForegroundColor Yellow
        npx tsx src\cut\index.ts --input $video --blueprint $bp -o $out
        if ($LASTEXITCODE -ne 0) { Write-Host "FAILED" -ForegroundColor Red; exit 1 }
        Write-Host "Step 3 done" -ForegroundColor Green
    } else {
        Write-Host "[Step 3] Skip (cut_video exists)" -ForegroundColor DarkGray
    }
}

Write-Host ""
$result = Join-Path $out "result.mp4"
if (($Step -eq 0 -or $Step -eq 4) -and -not (Test-Path $result)) {
    if (-not (Test-Path $bp) -or -not (Test-Path $timingMap)) {
        Write-Host "Need blueprint.json and timing_map.json first!" -ForegroundColor Red
        exit 1
    }
    Write-Host "[Step 4] Rendering final video..." -ForegroundColor Yellow
    if ($RenderMode -eq "source_direct") {
        npx tsx src\renderer\render.ts --blueprint $bp --timing-map $timingMap --source-video $video -o $result
    } else {
        npx tsx src\renderer\render.ts --blueprint $bp --timing-map $timingMap --cut-video $cv -o $result
    }
    if ($LASTEXITCODE -ne 0) { Write-Host "FAILED" -ForegroundColor Red; exit 1 }
    Write-Host "Step 4 done" -ForegroundColor Green
} else {
    Write-Host "[Step 4] Skip (result exists)" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "=== Output Files ===" -ForegroundColor Cyan
$files = @(
    "transcript.json",
    "step1_result.json",
    "step1_cleaned.json",
    "blueprint.json",
    "step1_hints.json",
    "transcript_plain.txt",
    "script_plain.txt",
    "transcript_review.json",
    "reviewed_transcript.json",
    "reviewed_transcript.txt",
    "llm-step1-raw-0.txt",
    "llm-step1-parsed-0.json",
    "llm-step2-raw-0.txt",
    "llm-step2-parsed-0.json",
    "timing_map.json",
    "timing_clips_debug.json",
    "cut_video.mp4",
    "result.mp4"
)
foreach ($f in $files) {
    $p = Join-Path $out $f
    if (Test-Path $p) {
        $sz = (Get-Item $p).Length
        $label = if ($sz -gt 1MB) { "{0:F1} MB" -f ($sz/1MB) } elseif ($sz -gt 1KB) { "{0:F1} KB" -f ($sz/1KB) } else { "$sz B" }
        Write-Host "  OK  $f ($label)" -ForegroundColor Green
    } else {
        Write-Host "  --  $f" -ForegroundColor DarkGray
    }
}
Write-Host ""
