# The r9 LOCAL end-to-end harness (NEXT-CONNECT 102). LOCAL ONLY: a throwaway Postgres on D:, the real node function code under Deno, the maker-r9-node app, a loopback stand-in for Storage.
# Nothing here touches the live project, a live account, or the network beyond 127.0.0.1.   Usage:  powershell -ExecutionPolicy Bypass -File D:\Ryagram-scratch\CONNECT\r9-e2e\run.ps1
$ErrorActionPreference = 'Stop'
$env:TEMP = 'D:\Ryagram-scratch\CONNECT\temp'
$env:TMP = $env:TEMP
$env:TMPDIR = $env:TEMP
$env:NO_PROXY = '127.0.0.1,localhost'
$env:PYTHONPATH = 'D:\Ryagram-scratch\CC1\pyshim-yaml'     # pgvenv2 has no PyYAML, which the worker's validator imports (see the memory note pgvenv-needs-yaml-shim)
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null
$free = (Get-PSDrive D).Free / 1GB
if ($free -lt 10) { Write-Error "D: has only $([math]::Round($free,1)) GB free; the harness needs about 1 GB and refuses to start under 10 GB."; exit 2 }
& 'D:\Ryagram-scratch\WEB\pgvenv2\Scripts\python.exe' "$PSScriptRoot\e2e.py" @args
exit $LASTEXITCODE
