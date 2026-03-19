param(
    [Parameter(Mandatory = $true)]
    [string[]]$CaseRoots,
    [Parameter(Mandatory = $true)]
    [string]$OutputRoot,
    [string]$ReportPath = ""
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem

function Format-TimeLabel {
    param([double]$Seconds)

    $total = [Math]::Max(0, $Seconds)
    $minutes = [int][Math]::Floor($total / 60)
    $secs = $total - ($minutes * 60)
    return ("{0:D2}:{1}" -f $minutes, $secs.ToString("00.00", [System.Globalization.CultureInfo]::InvariantCulture))
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

function Get-DocxPlainText {
    param([string]$DocxPath)

    $zip = [System.IO.Compression.ZipFile]::OpenRead($DocxPath)
    try {
        $entry = $zip.Entries | Where-Object { $_.FullName -eq 'word/document.xml' }
        if (-not $entry) {
            return ""
        }
        $reader = New-Object System.IO.StreamReader($entry.Open())
        try {
            $xml = $reader.ReadToEnd()
        } finally {
            $reader.Close()
        }
    } finally {
        $zip.Dispose()
    }

    $text = [regex]::Replace($xml, '<[^>]+>', '')
    $text = [System.Net.WebUtility]::HtmlDecode($text)
    $text = $text -replace '\s+', ''
    return $text
}

function Test-Overlap {
    param(
        [double]$StartA,
        [double]$EndA,
        [double]$StartB,
        [double]$EndB
    )

    return ($StartA -lt $EndB -and $EndA -gt $StartB)
}

function Get-TranscriptExcerpt {
    param(
        $Transcript,
        [double]$Start,
        [double]$End
    )

    return (($Transcript.words | Where-Object { $_.start -lt $End -and $_.end -gt $Start } | ForEach-Object { $_.text }) -join '')
}

function Get-DocxSnippet {
    param(
        [string]$DocText,
        [string[]]$Candidates
    )

    foreach ($candidate in ($Candidates | Where-Object { $_ -and $_.Length -ge 4 } | Sort-Object Length -Descending -Unique)) {
        $idx = $DocText.IndexOf($candidate)
        if ($idx -ge 0) {
            $start = [Math]::Max(0, $idx - 20)
            $length = [Math]::Min(90, $DocText.Length - $start)
            return [PSCustomObject]@{
                MatchedBy = $candidate
                Snippet = $DocText.Substring($start, $length)
            }
        }
    }

    return $null
}

if (-not $ReportPath) {
    $ReportPath = Join-Path $OutputRoot 'step1-asr-suspects.md'
}

$sections = New-Object System.Collections.Generic.List[string]
$sections.Add('# Step1 疑似 ASR 异常报告')
$sections.Add('')
$sections.Add("生成时间：$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$sections.Add('')
$sections.Add('判定原则：优先抓 `口误/应为` 类 discard，以及与 `ambiguousSpans` 重叠的可疑片段。这份报告是“疑似 ASR 错导致 Step1 异常”的排查清单，不是最终定论。')
$sections.Add('')

for ($index = 0; $index -lt $CaseRoots.Count; $index++) {
    $caseRoot = Resolve-Path $CaseRoots[$index]
    $caseName = Split-Path $caseRoot -Leaf
    $caseOutput = Join-Path $OutputRoot ("case{0:D2}" -f ($index + 1))
    $step1Path = Join-Path $caseOutput 'step1_cleaned.json'
    $hintPath = Join-Path $caseOutput 'step1_hints.json'
    $transcriptPath = Join-Path $caseOutput 'transcript.json'
    $docx = Get-OnlyDocx -CaseRoot $caseRoot
    $docText = Get-DocxPlainText -DocxPath $docx.FullName

    if (-not (Test-Path $step1Path)) {
        throw "缺少 step1_cleaned.json: $step1Path"
    }
    if (-not (Test-Path $hintPath)) {
        throw "缺少 step1_hints.json: $hintPath"
    }
    if (-not (Test-Path $transcriptPath)) {
        throw "缺少 transcript.json: $transcriptPath"
    }

    $step1 = Get-Content -LiteralPath $step1Path -Raw -Encoding utf8 | ConvertFrom-Json
    $hints = Get-Content -LiteralPath $hintPath -Raw -Encoding utf8 | ConvertFrom-Json
    $transcript = Get-Content -LiteralPath $transcriptPath -Raw -Encoding utf8 | ConvertFrom-Json

    $atoms = @($step1.atoms)
    $ambiguousSpans = @($hints.ambiguousSpans)
    $usedIndexes = New-Object 'System.Collections.Generic.HashSet[int]'
    $suspects = New-Object System.Collections.Generic.List[object]

    for ($i = 0; $i -lt $atoms.Count; $i++) {
        if ($usedIndexes.Contains($i)) {
            continue
        }

        $atom = $atoms[$i]
        if ($atom.status -ne 'discard') {
            continue
        }

        $reason = [string]$atom.reason
        $reasonHit = $reason -match '应为|口误|识别|转录|听写'
        $overlaps = @($ambiguousSpans | Where-Object {
            Test-Overlap -StartA ([double]$atom.time.s) -EndA ([double]$atom.time.e) -StartB ([double]$_.start) -EndB ([double]$_.end)
        })

        $mediumHit = ($reason -match '口误|识别|转录|听写') -and $overlaps.Count -gt 0
        $highHit = $reason -match '应为'

        if (-not $highHit -and -not $mediumHit) {
            continue
        }

        $group = New-Object System.Collections.Generic.List[object]
        if ($i -gt 0) {
            $prev = $atoms[$i - 1]
            if (([double]$atom.time.s) - ([double]$prev.time.e) -le 0.35) {
                $group.Add($prev)
                $usedIndexes.Add($i - 1) | Out-Null
            }
        }

        $group.Add($atom)
        $usedIndexes.Add($i) | Out-Null

        if ($i + 1 -lt $atoms.Count) {
            $next = $atoms[$i + 1]
            if (([double]$next.time.s) - ([double]$atom.time.e) -le 0.35) {
                $group.Add($next)
                $usedIndexes.Add($i + 1) | Out-Null
            }
        }

        $groupStart = ($group | ForEach-Object { [double]$_.time.s } | Measure-Object -Minimum).Minimum
        $groupEnd = ($group | ForEach-Object { [double]$_.time.e } | Measure-Object -Maximum).Maximum
        $transcriptExcerpt = Get-TranscriptExcerpt -Transcript $transcript -Start ($groupStart - 0.5) -End ($groupEnd + 0.8)
        $atomSummary = ($group | ForEach-Object {
            $label = if ($_.status -eq 'discard') { 'discard' } else { 'keep' }
            "#$($_.id) [$label] $($_.text)"
        }) -join ' / '
        $hintText = ($overlaps | ForEach-Object { $_.text }) -join ' || '

        $candidates = @(
            ($group | ForEach-Object { [string]$_.text }),
            $transcriptExcerpt
        ) | Where-Object { $_ }
        $docMatch = Get-DocxSnippet -DocText $docText -Candidates $candidates

        $confidence = if ($highHit) { '高' } else { '中' }

        $suspects.Add([PSCustomObject]@{
            TimeRange = "$(Format-TimeLabel([double]$groupStart)) - $(Format-TimeLabel([double]$groupEnd))"
            Confidence = $confidence
            Atoms = $atomSummary
            Reason = if ($reason) { $reason } else { '无显式原因' }
            TranscriptExcerpt = $transcriptExcerpt
            HintText = if ($hintText) { $hintText } else { '无' }
            DocMatch = $docMatch
        })
    }

    $sections.Add("## $caseName")
    $sections.Add('')
    $sections.Add('- 文案：`' + $docx.FullName + '`')
    $sections.Add('- 输出目录：`' + (Resolve-Path $caseOutput) + '`')
    $sections.Add('- 疑似 ASR 异常数：' + $suspects.Count)
    $sections.Add('')

    if ($suspects.Count -eq 0) {
        $sections.Add('- 暂未命中高置信的 ASR 疑似异常。')
        $sections.Add('')
        continue
    }

    for ($j = 0; $j -lt $suspects.Count; $j++) {
        $suspect = $suspects[$j]
        $sections.Add("### $($caseName) / suspect $($j + 1)")
        $sections.Add('')
        $sections.Add('- 时间：' + $suspect.TimeRange)
        $sections.Add('- 置信度：' + $suspect.Confidence)
        $sections.Add('- Step1 处理：' + $suspect.Atoms)
        $sections.Add('- discard 原因：' + $suspect.Reason)
        $sections.Add('')
        $sections.Add('**transcript 片段**')
        $sections.Add('')
        $sections.Add('```text')
        $sections.Add($suspect.TranscriptExcerpt)
        $sections.Add('```')
        $sections.Add('')
        $sections.Add('**step1 hint 片段**')
        $sections.Add('')
        $sections.Add('```text')
        $sections.Add($suspect.HintText)
        $sections.Add('```')
        $sections.Add('')
        if ($suspect.DocMatch) {
            $sections.Add('**文案对照片段**')
            $sections.Add('')
            $sections.Add('- 命中文本：`' + $suspect.DocMatch.MatchedBy + '`')
            $sections.Add('```text')
            $sections.Add($suspect.DocMatch.Snippet)
            $sections.Add('```')
            $sections.Add('')
        }
    }
}

Set-Content -LiteralPath $ReportPath -Value ($sections -join "`r`n") -Encoding utf8
Write-Host "Report: $ReportPath" -ForegroundColor Green



