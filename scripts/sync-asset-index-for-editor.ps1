param(
  [Parameter(Mandatory = $true)]
  [string]$TargetDir,

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

foreach ($name in $files) {
  $src = Join-Path $sourceDir $name
  if (-not (Test-Path -LiteralPath $src)) {
    throw "Missing required asset index file: $src"
  }
  Copy-Item -LiteralPath $src -Destination (Join-Path $destDir $name) -Force
  $item = Get-Item -LiteralPath (Join-Path $destDir $name)
  Write-Host ("copied {0} ({1:n1} MB)" -f $name, ($item.Length / 1MB))
}

Write-Host ""
Write-Host "Asset index copied to: $destDir"
Write-Host "Reminder: source mp4 paths in the index currently point to E:\nucleus download\totel nucleus video\..."
Write-Host "The editing server must have that same path, or the mp4_path values need to be rewritten before draft generation."
