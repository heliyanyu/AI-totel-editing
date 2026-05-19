param(
    [int]$Shards = 2,
    [int]$BatchWordLimit = 900,
    [int]$BatchFileLimit = 2,
    [int]$TimeoutSeconds = 180,
    [int]$MaxAttempts = 2,
    [string]$PythonExe = "python",
    [string]$Model = "gpt-5.4",
    [int]$Limit = 0
)

$ErrorActionPreference = "Stop"

$root = "F:\AI total editing\editing V1"
$scriptPath = Join-Path $root "scripts\segment-assets-codex-ranges.py"
$logDir = Join-Path $root "scripts\logs\codex-segmentation"
$stopFile = Join-Path $logDir "codex-segmentation.stop"

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
if (Test-Path -LiteralPath $stopFile) {
    Remove-Item -LiteralPath $stopFile -Force
}

$started = @()
for ($shard = 0; $shard -lt $Shards; $shard++) {
    $stdoutPath = Join-Path $logDir ("shard-{0}.out.log" -f $shard)
    $stderrPath = Join-Path $logDir ("shard-{0}.err.log" -f $shard)

    foreach ($path in @($stdoutPath, $stderrPath)) {
        if (Test-Path -LiteralPath $path) {
            Remove-Item -LiteralPath $path -Force
        }
    }

    $argList = @(
        "-u",
        "-X", "utf8",
        ('"{0}"' -f $scriptPath),
        "--model", $Model,
        "--batch-word-limit", "$BatchWordLimit",
        "--batch-file-limit", "$BatchFileLimit",
        "--timeout-seconds", "$TimeoutSeconds",
        "--max-attempts", "$MaxAttempts",
        "--total-shards", "$Shards",
        "--shard", "$shard",
        "--stop-file", ('"{0}"' -f $stopFile)
    )
    if ($Limit -gt 0) {
        $argList += @("--limit", "$Limit")
    }

    $proc = Start-Process `
        -FilePath $PythonExe `
        -ArgumentList $argList `
        -WorkingDirectory $root `
        -RedirectStandardOutput $stdoutPath `
        -RedirectStandardError $stderrPath `
        -PassThru

    $started += [pscustomobject]@{
        Shard = $shard
        PID = $proc.Id
        Stdout = $stdoutPath
        Stderr = $stderrPath
    }
}

$started | Format-Table -AutoSize
Write-Host ""
Write-Host "Stop file:" $stopFile
Write-Host "Tail logs with:"
Write-Host "  Get-Content -Wait '$logDir\\shard-0.out.log'"
