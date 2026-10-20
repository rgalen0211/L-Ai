# The r9 LOCAL end-to-end harness (NEXT-CONNECT 102). LOCAL ONLY: a throwaway Postgres, the real node function code under Deno, the maker-r9-node app, a loopback stand-in for Storage.
# Nothing here touches the live project, a live account, or the network beyond 127.0.0.1.
#
#   powershell -ExecutionPolicy Bypass -File run.ps1 -DbRepo <L-Ai checkout at r9-node-draft> -Engine <Ryagram checkout> -Python <python with pgserver + psycopg> -Temp <folder on D:>
#                                                    [-AppRepo <L-Ai checkout at maker-r9-node; default: the repo this script sits in>] [-YamlShim <folder with a yaml package, if the python has none>]
# It PRINTS each repo's HEAD and REFUSES to run if any is dirty, so a pass names exact heads. The temp folder must be on D: (the storage rule); the run uses about 50 MB of it and cleans up after itself.
param(
  [string]$DbRepo = $env:R9E2E_DB_REPO, [string]$Engine = $env:R9E2E_ENGINE, [string]$AppRepo = $env:R9E2E_APP_REPO,
  [string]$Python = $env:R9E2E_PYTHON, [string]$Temp = $env:R9E2E_TEMP, [string]$YamlShim = $env:R9E2E_YAML_SHIM, [switch]$Help)
$ErrorActionPreference = 'Stop'
if ($Help -or -not $DbRepo -or -not $Engine -or -not $Python -or -not $Temp) { Get-Content $PSCommandPath -TotalCount 9 | Write-Host; exit 2 }
if ($Temp -notmatch '^[dD]:') { Write-Error "-Temp must be on D: (storage rule), not '$Temp'."; exit 2 }
New-Item -ItemType Directory -Force -Path $Temp | Out-Null
$env:TEMP = $Temp; $env:TMP = $Temp; $env:TMPDIR = $Temp
$env:NO_PROXY = '127.0.0.1,localhost'
$env:R9E2E_DB_REPO = $DbRepo; $env:R9E2E_ENGINE = $Engine
if ($AppRepo) { $env:R9E2E_APP_REPO = $AppRepo } else { Remove-Item Env:R9E2E_APP_REPO -ErrorAction SilentlyContinue }
if ($YamlShim) { $env:PYTHONPATH = $YamlShim }       # a python without PyYAML cannot import the worker's validator
$free = (Get-PSDrive ($Temp.Substring(0,1))).Free / 1GB
if ($free -lt 10) { Write-Error "The temp drive has only $([math]::Round($free,1)) GB free; the harness needs about 1 GB and refuses to start under 10 GB."; exit 2 }
& $Python "$PSScriptRoot\e2e.py"
exit $LASTEXITCODE
