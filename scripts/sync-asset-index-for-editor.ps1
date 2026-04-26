param(
  [Parameter(Mandatory = $true)]
  [string]$TargetDir,

  [string]$SourceAssetRoot = $env:ASSET_INDEX_SOURCE_ROOT,

  [string]$TargetAssetRoot = $env:ASSET_DRAFT_ROOT,

  [switch]$RewriteOnly,

  [switch]$Full
)

$ErrorActionPreference = "Stop"

$repoRoot = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$sourceDir = Join-Path $repoRoot "scripts\asset_index"
$destDir = Join-Path $TargetDir "scripts\asset_index"

New-Item -ItemType Directory -Force -Path $destDir | Out-Null

$required = @(
  "visual_segments_cbj58_5000_plus_zh_chronic.jsonl",
  "visual_segment_embeddings_cbj58_5000_plus_zh_chronic.npy",
  "visual_segment_embeddings_cbj58_5000_plus_zh_chronic.keys.json"
)

$fullExtra = @(
  "atoms.jsonl",
  "atoms_zh_chronic.jsonl",
  "visual_atoms_cbj58_related_5000.jsonl",
  "visual_atoms_zh_chronic.jsonl",
  "visual_atom_embeddings_cbj58_related_5000.npy",
  "visual_atom_embeddings_cbj58_related_5000.keys.json",
  "visual_atom_embeddings_zh_chronic_3709.npy",
  "visual_atom_embeddings_zh_chronic_3709.keys.json"
)

$files = @($required)
if ($Full) {
  $files += $fullExtra
}

function Convert-ToIndexPath {
  param([Parameter(Mandatory = $true)][string]$PathValue)
  return ($PathValue -replace '\\', '/').TrimEnd('/')
}

function Rewrite-JsonlMp4Root {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$SourceRoot,
    [Parameter(Mandatory = $true)][string]$TargetRoot
  )

  $sourcePrefix = Convert-ToIndexPath $SourceRoot
  $targetPrefix = Convert-ToIndexPath $TargetRoot
  $tmp = "$Path.tmp"
  $rewritten = 0

  $reader = [System.IO.StreamReader]::new($Path, [System.Text.Encoding]::UTF8)
  $writer = [System.IO.StreamWriter]::new($tmp, $false, [System.Text.UTF8Encoding]::new($false))
  try {
    while (($line = $reader.ReadLine()) -ne $null) {
      if ([string]::IsNullOrWhiteSpace($line)) {
        $writer.WriteLine($line)
        continue
      }
      $row = $line | ConvertFrom-Json
      if ($row.PSObject.Properties.Name -contains "mp4_path" -and $row.mp4_path) {
        $mp4Path = Convert-ToIndexPath ([string]$row.mp4_path)
        $sameRoot = $mp4Path.Equals($sourcePrefix, [System.StringComparison]::OrdinalIgnoreCase)
        $underRoot = $mp4Path.StartsWith("$sourcePrefix/", [System.StringComparison]::OrdinalIgnoreCase)
        if ($sameRoot -or $underRoot) {
          $suffix = $mp4Path.Substring($sourcePrefix.Length).TrimStart('/')
          $row.mp4_path = if ($suffix) { "$targetPrefix/$suffix" } else { $targetPrefix }
          $rewritten++
        }
      }
      $writer.WriteLine(($row | ConvertTo-Json -Compress -Depth 20))
    }
  } finally {
    $reader.Close()
    $writer.Close()
  }

  Move-Item -LiteralPath $tmp -Destination $Path -Force
  Write-Host ("rewrote mp4_path in {0}: {1} rows" -f (Split-Path -Leaf $Path), $rewritten)
}

foreach ($name in $files) {
  $src = Join-Path $sourceDir $name
  $dst = Join-Path $destDir $name
  if ($RewriteOnly) {
    if (-not (Test-Path -LiteralPath $dst)) {
      throw "Missing target asset index file: $dst"
    }
    Write-Host ("found {0}" -f $name)
  } else {
    if (-not (Test-Path -LiteralPath $src)) {
      throw "Missing required asset index file: $src"
    }
    Copy-Item -LiteralPath $src -Destination $dst -Force
    $item = Get-Item -LiteralPath $dst
    Write-Host ("copied {0} ({1:n1} MB)" -f $name, ($item.Length / 1MB))
  }
}

if ($TargetAssetRoot) {
  if (-not $SourceAssetRoot) {
    throw "SourceAssetRoot is required when rewriting mp4_path. Pass -SourceAssetRoot or set ASSET_INDEX_SOURCE_ROOT."
  }
  foreach ($name in $files) {
    if ($name.EndsWith(".jsonl", [System.StringComparison]::OrdinalIgnoreCase)) {
      Rewrite-JsonlMp4Root `
        -Path (Join-Path $destDir $name) `
        -SourceRoot $SourceAssetRoot `
        -TargetRoot $TargetAssetRoot
    }
  }
}

Write-Host ""
Write-Host "Asset index copied to: $destDir"
if ($TargetAssetRoot) {
  Write-Host "Index mp4_path root rewritten to: $TargetAssetRoot"
} else {
  Write-Host "Reminder: source mp4 paths in the index currently point to $SourceAssetRoot"
  Write-Host "Use -TargetAssetRoot if the editing server stores assets elsewhere."
}
