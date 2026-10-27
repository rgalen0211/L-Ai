# The compilation RIDE (NEXT-CONNECT 116). LOCAL ONLY: a throwaway Postgres, the node function under Deno, the maker, the real engine with ffmpeg on small synthetic clips. Nothing live, no credit, no network beyond 127.0.0.1.
#
#   powershell -ExecutionPolicy Bypass -File run.ps1 -DbRepo <this L-Ai checkout> -Engine <Ryagram checkout with the heads under test> -Python <python with pgserver + psycopg + numpy> -Temp <folder on D:> [-YamlShim <dir>] [-KeepGoing]
# It PRINTS each repo's HEAD and REFUSES to run if any is dirty. Without -KeepGoing it stops at the first broken step; with it the report lists every broken step.
param(
  [string]$DbRepo = $env:R9E2E_DB_REPO, [string]$Engine = $env:R9E2E_ENGINE, [string]$Python = $env:R9E2E_PYTHON, [string]$Temp = $env:R9E2E_TEMP,
  [string]$YamlShim = $env:R9E2E_YAML_SHIM, [string]$Json = $env:RIDE_JSON, [ValidateSet('ride','delivery')][string]$Check = 'ride', [switch]$KeepGoing, [switch]$Help)
$ErrorActionPreference = 'Stop'
if ($Help -or -not $DbRepo -or -not $Engine -or -not $Python -or -not $Temp) { Get-Content $PSCommandPath -TotalCount 6 | Write-Host; exit 2 }
if ($Temp -notmatch '^[dD]:') { Write-Error "-Temp must be on D: (storage rule), not '$Temp'."; exit 2 }
New-Item -ItemType Directory -Force -Path $Temp | Out-Null
$env:TEMP = $Temp; $env:TMP = $Temp; $env:TMPDIR = $Temp
$env:NO_PROXY = '127.0.0.1,localhost'
$env:R9E2E_DB_REPO = $DbRepo; $env:R9E2E_ENGINE = $Engine; Remove-Item Env:R9E2E_APP_REPO -ErrorAction SilentlyContinue
if ($Json) { $env:RIDE_JSON = $Json }
if ($YamlShim) { $env:PYTHONPATH = $YamlShim }
$free = (Get-PSDrive ($Temp.Substring(0,1))).Free / 1GB
if ($free -lt 10) { Write-Error "The temp drive has only $([math]::Round($free,1)) GB free; the ride refuses to start under 10 GB."; exit 2 }
$extra = @(); if ($KeepGoing) { $extra += '--keep-going' }
$script = if ($Check -eq 'delivery') { 'delivery_sql_check.py' } else { 'ride.py' }
& $Python "$PSScriptRoot\$script" @extra
exit $LASTEXITCODE
