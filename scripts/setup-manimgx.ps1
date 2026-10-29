param([string]$BuildPython = 'C:\Python314\python.exe')
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$runtime = Join-Path $project '.runtime\manimgx-portable'
$archive = Join-Path $project '.runtime\python-3.14.0-embed-amd64.zip'
if (!(Test-Path -LiteralPath $BuildPython)) { throw 'Python 3.14 with pip is required to build the bundled runtime. Pass -BuildPython with its full path. End users do not need Python.' }
New-Item -ItemType Directory -Force -Path $runtime | Out-Null
if (!(Test-Path -LiteralPath $archive)) { Invoke-WebRequest 'https://www.python.org/ftp/python/3.14.0/python-3.14.0-embed-amd64.zip' -OutFile $archive }
Expand-Archive -LiteralPath $archive -DestinationPath $runtime -Force
[IO.File]::WriteAllText((Join-Path $runtime 'python314._pth'), "python314.zip`n.`nLib/site-packages`nimport site`n")
& $BuildPython -m pip install --upgrade --target (Join-Path $runtime 'Lib\site-packages') -r (Join-Path $project 'runtime\manimgx-requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'ManimGX package installation failed.' }
& (Join-Path $runtime 'python.exe') -I -m manimgx --version
if ($LASTEXITCODE -ne 0) { throw 'The bundled animation runtime did not pass its version check.' }
Write-Output 'Portable ManimGX runtime is ready for desktop packaging.'
