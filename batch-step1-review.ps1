param(
    [Parameter(Mandatory = $true)]
    [string[]]$CaseRoots,
    [string]$OutputRoot = "",
    [string]$ReportPath = "",
    [string]$Model = "claude-opus-4-6",
    [switch]$SkipTranscribe,
    [switch]$SkipAnalyze
)

$ErrorActionPreference = "Stop"
$env:PYTHONUTF8 = "1"
$env:PYTHONIOENCODING = "utf-8"

function Format-TimeLabel {
    param([double]$Seconds)

    $total = [Math]::Max(0, $Seconds)
    $minutes = [int][Math]::Floor($total / 60)
    $secs = $total - ($minutes * 60)
    return ("{0:D2}:{1}" -f $minutes, $secs.ToString("00.00", [System.Globalization.CultureInfo]::InvariantCulture))
}

function Get-PreferredMp4 {
    param(
        [string]$CaseRoot,
        [string]$CaseName
    )

    $mp4s = Get-ChildItem -Path $CaseRoot -File -Filter *.mp4 | Sort-Object Length -Descending
    if ($mp4s.Count -eq 0) {
        throw "目录缺少 mp4: $CaseRoot"
    }
    if ($mp4s.Count -eq 1) {
        return $mp4s[0]
    }

    $firstToken = ($CaseName -split '\s+')[0]
    if ($firstToken) {
        $preferred = $mp4s | Where-Object { $_.BaseName -like "*$firstToken*" } | Select-Object -First 1
        if ($preferred) {
            return $preferred
        }
    }

    $nonTimestamp = $mp4s | Where-Object { $_.BaseName -notmatch '^\d{8}-\d{6}$' }
    if ($nonTimestamp) {
        return ($nonTimestamp | Select-Object -First 1)
    }

    return $mp4s[0]
}

function Get-OnlyDocx {
    param([string]$CaseRoot)

    $docxs = Get-ChildItem -Path $CaseRoot -File -Filter *.docx | Sort-Object Name
    if ($docxs.Count -eq 0) {
        throw "目录缺少 docx: $CaseRoot"
    }
    if ($docxs.Count -gt 1) {
        throw "目录存在多个 docx，当前脚本无法自动判断: $CaseRoot"
    }
    return $docxs[0]
}

function Get-KeepOnlyText {
    param($Atoms)

    return (($Atoms | Where-Object { $_.status -eq "keep" } | ForEach-Object { $_.text }) -join "")
}

function Get-MarkedTranscript {
    param($Atoms)

    $scene = 0
    $logic = 0
    $lines = New-Object System.Collections.Generic.List[string]

    foreach ($atom in $Atoms) {
        if ($null -eq $atom.boundary -and $lines.Count -eq 0) {
            $scene = 1
            $logic = 1
            $lines.Add("[S$scene-L$logic] ")
        } elseif ($atom.boundary -eq "scene") {
            $scene++
            $logic = 1
            $lines.Add("[S$scene-L$logic] ")
        } elseif ($atom.boundary -eq "logic") {
            if ($scene -eq 0) {
                $scene = 1
            }
            $logic++
            $lines.Add("[S$scene-L$logic] ")
        }

        if ($lines.Count -eq 0) {
            $scene = 1
            $logic = 1
            $lines.Add("[S$scene-L$logic] ")
        }

        $suffix = if ($atom.status -eq "discard") { "~~$($atom.text)~~" } else { [string]$atom.text }
        $lines[$lines.Count - 1] += $suffix
    }

    return ($lines -join "`n`n")
}

function Get-DiscardListMarkdown {
    param($Atoms)

    $discardAtoms = $Atoms | Where-Object { $_.status -eq "discard" }
    if (-not $discardAtoms) {
        return "- 无"
    }

    $lines = foreach ($atom in $discardAtoms) {
        $start = Format-TimeLabel([double]$atom.time.s)
        $end = Format-TimeLabel([double]$atom.time.e)
        $reason = if ($atom.reason) { $atom.reason } else { "未提供原因" }
        "- $start - $end `"$($atom.text)`" : $reason"
    }
    return ($lines -join "`n")
}

function Ensure-ApiKey {
    $key = [System.Environment]::GetEnvironmentVariable("ANTHROPIC_API_KEY", "User")
    if (-not $key) {
        throw "ANTHROPIC_API_KEY 未设置"
    }
    $env:ANTHROPIC_API_KEY = $key
}

if (-not $OutputRoot) {
    $stamp = Get-Date -Format "yyyyMMdd_HHmmss"
    $OutputRoot = Join-Path "output" "batch_step1_review_$stamp"
}

New-Item -ItemType Directory -Force -Path $OutputRoot | Out-Null

if (-not $ReportPath) {
    $ReportPath = Join-Path $OutputRoot "step1-review-report.md"
}

Ensure-ApiKey

$sections = New-Object System.Collections.Generic.List[string]
$sections.Add("# Step1 多视频清洗标记报告")
$sections.Add("")
$sections.Add("生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$sections.Add("")
$sections.Add('标记规则：普通文本 = 保留；`~~删除文本~~` = Step1 清洗后删除。')
$sections.Add("")

for ($index = 0; $index -lt $CaseRoots.Count; $index++) {
    $caseRoot = Resolve-Path $CaseRoots[$index]
    $caseName = Split-Path $caseRoot -Leaf
    $video = Get-PreferredMp4 -CaseRoot $caseRoot -CaseName $caseName
    $docx = Get-OnlyDocx -CaseRoot $caseRoot
    $caseOutput = Join-Path $OutputRoot ("case{0:D2}" -f ($index + 1))
    New-Item -ItemType Directory -Force -Path $caseOutput | Out-Null

    $transcriptPath = Join-Path $caseOutput "transcript.json"
    $blueprintPath = Join-Path $caseOutput "blueprint.json"
    $step1CleanedPath = Join-Path $caseOutput "step1_cleaned.json"

    Write-Host ""
    Write-Host "=== [$($index + 1)/$($CaseRoots.Count)] $caseName ===" -ForegroundColor Cyan
    Write-Host "Video : $($video.FullName)" -ForegroundColor DarkGray
    Write-Host "Script: $($docx.FullName)" -ForegroundColor DarkGray

    if (-not $SkipTranscribe -and -not (Test-Path $transcriptPath)) {
        Write-Host "Transcribing..." -ForegroundColor Yellow
        & python "src\transcribe\index.py" $video.FullName -o $transcriptPath
        if ($LASTEXITCODE -ne 0) {
            throw "转录失败: $($video.FullName)"
        }
    }

    if (-not $SkipAnalyze -and -not (Test-Path $step1CleanedPath)) {
        Write-Host "Analyzing..." -ForegroundColor Yellow
        & cmd /c npx tsx src\analyze\index.ts --transcript $transcriptPath --script $docx.FullName -o $blueprintPath --model $Model
        if ($LASTEXITCODE -ne 0) {
            throw "分析失败: $($video.FullName)"
        }
    }

    if (-not (Test-Path $step1CleanedPath)) {
        throw "缺少 step1_cleaned.json: $step1CleanedPath"
    }

    $step1Cleaned = Get-Content -Path $step1CleanedPath -Raw -Encoding utf8 | ConvertFrom-Json
    $atoms = @($step1Cleaned.atoms)
    $keepCount = @($atoms | Where-Object { $_.status -eq "keep" }).Count
    $discardCount = @($atoms | Where-Object { $_.status -eq "discard" }).Count
    $keepText = Get-KeepOnlyText -Atoms $atoms
    $markedText = Get-MarkedTranscript -Atoms $atoms
    $discardMarkdown = Get-DiscardListMarkdown -Atoms $atoms

    $sections.Add("## $caseName")
    $sections.Add("")
    $sections.Add('- 视频：`' + $video.FullName + '`')
    $sections.Add('- 文案：`' + $docx.FullName + '`')
    $sections.Add('- 输出目录：`' + (Resolve-Path $caseOutput) + '`')
    $sections.Add("- 统计：$keepCount keep / $discardCount discard / $($atoms.Count) total")
    $sections.Add("")
    $sections.Add("### 清洗后口播")
    $sections.Add("")
    $sections.Add('```text')
    $sections.Add($keepText)
    $sections.Add('```')
    $sections.Add("")
    $sections.Add("### 标记版")
    $sections.Add("")
    $sections.Add('```md')
    $sections.Add($markedText)
    $sections.Add('```')
    $sections.Add("")
    $sections.Add("### 删除清单")
    $sections.Add("")
    $sections.Add($discardMarkdown)
    $sections.Add("")
}

Set-Content -Path $ReportPath -Value ($sections -join "`r`n") -Encoding utf8
Write-Host ""
Write-Host "Report: $(Resolve-Path $ReportPath)" -ForegroundColor Green



