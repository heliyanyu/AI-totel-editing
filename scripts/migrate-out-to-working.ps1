param(
    [string]$DateFolder = "260407",
    [string]$SourceRoot = "P:\团队空间\公司通用\AIkaifa\AI total editing",
    [string]$DestRoot = "D:\AI editing\working files"
)

$sourceDir = Join-Path $SourceRoot $DateFolder
$destDir = Join-Path $DestRoot $DateFolder

if (-not (Test-Path -LiteralPath $sourceDir)) {
    Write-Host "Source not found: $sourceDir" -ForegroundColor Red
    exit 1
}

$outDirs = @(Get-ChildItem -LiteralPath $sourceDir -Recurse -Directory -Filter "out")
Write-Host "Found $($outDirs.Count) out/ directories to migrate" -ForegroundColor Cyan

$copied = 0
$skipped = 0

foreach ($outDir in $outDirs) {
    # Get relative path: guojie\tiantao\tiantao KP010\out
    $relative = $outDir.FullName.Substring($sourceDir.Length).TrimStart('\', '/')
    $destPath = Join-Path $destDir $relative

    if (Test-Path -LiteralPath $destPath) {
        $existingFiles = @(Get-ChildItem -LiteralPath $destPath -File).Count
        if ($existingFiles -gt 0) {
            Write-Host "  skip (exists, $existingFiles files): $relative" -ForegroundColor DarkGray
            $skipped++
            continue
        }
    }

    New-Item -ItemType Directory -Path $destPath -Force | Out-Null
    Copy-Item -LiteralPath $outDir.FullName -Destination (Split-Path $destPath -Parent) -Recurse -Force
    $fileCount = @(Get-ChildItem -LiteralPath $destPath -File -Recurse).Count
    Write-Host "  copied ($fileCount files): $relative" -ForegroundColor Green
    $copied++
}

Write-Host ""
Write-Host "Done. copied=$copied skipped=$skipped" -ForegroundColor Cyan
