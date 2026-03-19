param(
  [string[]]$JobDirs = @(),
  [string]$Output = "output\stability_regression_report.md"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

if ($JobDirs.Count -eq 0) {
  $JobDirs = @(
    'output\demo01_20260315_163735',
    'output\demo01_20260315_154934',
    'output\demo01_20260315_151414',
    'output\demo01_20260308_024518',
    'output\3179cc2fca3e27948795d9c48d50636b_raw_20260315_172615'
  )
}

function Read-JsonOrNull([string]$Path) {
  if (-not (Test-Path -LiteralPath $Path)) { return $null }
  return Get-Content -LiteralPath $Path -Raw -Encoding utf8 | ConvertFrom-Json
}

$rows = foreach ($job in $JobDirs) {
  $jobPath = Resolve-Path -LiteralPath $job -ErrorAction Stop
  $jobDir = $jobPath.Path

  $manifest = Read-JsonOrNull (Join-Path $jobDir 'job_manifest.json')
  $timingValidation = Read-JsonOrNull (Join-Path $jobDir 'timing_validation_report.json')
  $timingMap = Read-JsonOrNull (Join-Path $jobDir 'timing_map.json')
  $blueprint = Read-JsonOrNull (Join-Path $jobDir 'blueprint.json')

  $renderMode = if ($manifest -and $manifest.renderMode) { $manifest.renderMode } elseif ($timingMap -and ($timingMap.PSObject.Properties.Name -contains 'mode') -and $timingMap.mode) { $timingMap.mode } else { 'cut_video' }
  $resultPath = if ($manifest -and $manifest.resultPath) { [string]$manifest.resultPath } else { Join-Path $jobDir 'result.mp4' }
  $sourceVideoPath = if ($manifest) { [string]$manifest.sourceVideoPath } else { $null }
  $cutVideoPath = if ($manifest -and $manifest.cutVideoPath) { [string]$manifest.cutVideoPath } else { Join-Path $jobDir 'cut_video.mp4' }

  [pscustomobject]@{
    Job = Split-Path $jobDir -Leaf
    JobDir = $jobDir
    RenderMode = $renderMode
    Scenes = if ($blueprint) { @($blueprint.scenes).Count } else { 0 }
    Segments = if ($blueprint) { @($blueprint.scenes | ForEach-Object { $_.logic_segments }).Count } else { 0 }
    Clips = if ($timingMap -and ($timingMap.PSObject.Properties.Name -contains 'clips') -and $timingMap.clips) { @($timingMap.clips).Count } else { 0 }
    TimingErrors = if ($timingValidation) { [int]$timingValidation.summary.error_count } else { -1 }
    TimingWarnings = if ($timingValidation) { [int]$timingValidation.summary.warn_count } else { -1 }
    TimingHealthy = if ($timingValidation) { ([int]$timingValidation.summary.error_count -eq 0) } else { $false }
    SourceVideoExists = if ($sourceVideoPath) { Test-Path -LiteralPath $sourceVideoPath } else { $false }
    CutVideoExists = if ($cutVideoPath) { Test-Path -LiteralPath $cutVideoPath } else { $false }
    ResultExists = Test-Path -LiteralPath $resultPath
    BlueprintFinalExists = Test-Path -LiteralPath (Join-Path $jobDir 'blueprint_final.json')
    HasManifest = Test-Path -LiteralPath (Join-Path $jobDir 'job_manifest.json')
    HasReviewState = Test-Path -LiteralPath (Join-Path $jobDir 'review_state.json')
  }
}

$sourceDirectCount = @($rows | Where-Object { $_.RenderMode -eq 'source_direct' }).Count
$healthyCount = @($rows | Where-Object { $_.TimingHealthy }).Count
$resultCount = @($rows | Where-Object { $_.ResultExists }).Count

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add('# Stability Regression Report')
$lines.Add('')
$lines.Add("- Generated: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')")
$lines.Add("- Jobs checked: $($rows.Count)")
$lines.Add("- source_direct jobs: $sourceDirectCount")
$lines.Add("- Timing healthy jobs: $healthyCount")
$lines.Add("- Jobs with result target present: $resultCount")
$lines.Add('')
$lines.Add('| Job | Mode | Scenes | Segments | Clips | Timing | Source | Cut | Result | Final |')
$lines.Add('| --- | --- | ---: | ---: | ---: | --- | --- | --- | --- | --- |')
foreach ($row in $rows) {
  $timingCell = if ($row.TimingErrors -lt 0) { 'missing' } else { "E$($row.TimingErrors) / W$($row.TimingWarnings)" }
  $lines.Add("| $($row.Job) | $($row.RenderMode) | $($row.Scenes) | $($row.Segments) | $($row.Clips) | $timingCell | $($row.SourceVideoExists) | $($row.CutVideoExists) | $($row.ResultExists) | $($row.BlueprintFinalExists) |")
}
$lines.Add('')
$lines.Add('## Notes')
foreach ($row in $rows) {
  $notes = @()
  if (-not $row.HasManifest) { $notes += 'missing manifest' }
  if (-not $row.HasReviewState) { $notes += 'missing review_state' }
  if (-not $row.ResultExists) { $notes += 'no final result file at target path' }
  if ($row.TimingErrors -gt 0) { $notes += 'timing has blocking errors' }
  if ($row.TimingWarnings -gt 0) { $notes += 'timing has warnings' }
  if ($notes.Count -eq 0) { $notes += 'ok' }
  $lines.Add("- **$($row.Job)**: $($notes -join '; ')")
}

$outPath = Join-Path (Get-Location) $Output
$outDir = Split-Path -Parent $outPath
if (-not (Test-Path -LiteralPath $outDir)) {
  New-Item -ItemType Directory -Path $outDir | Out-Null
}
[System.IO.File]::WriteAllLines($outPath, $lines, (New-Object System.Text.UTF8Encoding($false)))
Write-Host "Report written: $outPath"