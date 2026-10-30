param([switch]$Install)
$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$proofRoot = Join-Path $projectRoot 'work\updater-proof'
$installDir = [IO.Path]::GetFullPath((Join-Path $proofRoot 'install\Learning Studio Update Test'))
if (-not $installDir.StartsWith($proofRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Test installation escaped the proof directory.' }
$testGuid = '35901a9c-9833-4d47-8f6a-1039b00f13d9'
$profile = Join-Path $env:APPDATA 'Learning Studio Update Test'
$testExecutable = Join-Path $installDir 'Learning Studio Update Test.exe'
$personalExecutable = 'C:\Program Files\Learning Studio\Learning Studio.exe'
function PersonalSnapshot {
  $processes = @(Get-CimInstance Win32_Process -Filter "Name='Learning Studio.exe'" | Where-Object { $_.ExecutablePath -eq $personalExecutable } | ForEach-Object { [PSCustomObject]@{ pid = $_.ProcessId; parent = $_.ParentProcessId; path = $_.ExecutablePath } } | Sort-Object pid)
  $files = @($personalExecutable, 'C:\Program Files\Learning Studio\resources\app.asar') | Where-Object { Test-Path -LiteralPath $_ } | ForEach-Object { [PSCustomObject]@{ path = $_; sha256 = (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash } }
  return [PSCustomObject]@{ processes = $processes; files = @($files) }
}
$registryKeys = @()
foreach ($hive in @('HKCU:', 'HKLM:')) {
  foreach ($prefix in @('Software', 'Software\WOW6432Node')) {
    $registryKeys += "$hive\$prefix\$testGuid"
    $registryKeys += "$hive\$prefix\Microsoft\Windows\CurrentVersion\Uninstall\$testGuid"
  }
}
foreach ($key in $registryKeys) { if (Test-Path -LiteralPath $key) { throw "Existing rehearsal registration requires review: $key" } }
if ((Test-Path -LiteralPath $profile) -or (Test-Path -LiteralPath $installDir)) { throw 'Existing rehearsal profile or installation requires review. Nothing was changed.' }
if (Get-Process -Name 'Learning Studio Update Test' -ErrorAction SilentlyContinue) { throw 'A rehearsal app is already running.' }
foreach ($variant in @('old', 'new')) {
  $receipt = Get-Content -LiteralPath (Join-Path $proofRoot "$variant\verified.json") -Raw | ConvertFrom-Json
  if ($receipt.identity.appId -ne 'com.synapse.learningstudio.updatetest' -or $receipt.identity.productName -ne 'Learning Studio Update Test' -or $receipt.guid -ne $testGuid -or $receipt.compilerChecks -lt 2) { throw 'Installer namespace verification is missing.' }
  if ((Get-FileHash -LiteralPath $receipt.installer -Algorithm SHA256).Hash -ne $receipt.installerSha256) { throw 'Verified installer bytes changed.' }
}
$old = Get-Content -LiteralPath (Join-Path $proofRoot 'old\verified.json') -Raw | ConvertFrom-Json
$before = PersonalSnapshot
$before | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $proofRoot 'personal-before.json') -Encoding utf8
if (-not $Install) { [PSCustomObject]@{ installer = $old.installer; target = $installDir; profile = $profile; checks = 'passed'; installerExecuted = $false } | ConvertTo-Json; exit 0 }
$arguments = @('/S', '/currentuser', "/D=$installDir")
$installer = Start-Process -FilePath $old.installer -ArgumentList $arguments -WindowStyle Hidden -PassThru -Wait
if ($installer.ExitCode -ne 0) { throw "Isolated installer failed with exit code $($installer.ExitCode)." }
if (-not (Test-Path -LiteralPath $testExecutable)) { throw 'Isolated installer did not create the exact expected executable.' }
$after = PersonalSnapshot
if (($before | ConvertTo-Json -Depth 6 -Compress) -ne ($after | ConvertTo-Json -Depth 6 -Compress)) { throw 'Personal process or application snapshot changed. Stop the rehearsal and review.' }
New-Item -ItemType Directory -Path (Join-Path $profile 'data\chats') -Force | Out-Null
$settings = @{ version = 1; general = @{ autoUpdate = $false }; models = @{ strong = @{ model = @{ provider = 'openai'; id = 'gpt-5' }; thinkingLevel = 'medium' } }; upgradeProof = 'synthetic-provider-preferences-preserve-me' }
$lesson = @{ version = 1; id = 'chat_upgrade_proof'; title = 'Synthetic saved lesson for update verification'; createdAt = '2026-10-30T00:00:00.000Z'; updatedAt = '2026-10-30T00:00:00.000Z'; messages = @(@{ id = 'msg_upgrade_proof'; role = 'user'; content = 'Preserve this synthetic lesson: the derivative of x squared is two x.'; timestamp = 1793318400000 }); settings = @{ model = @{ provider = 'openai'; id = 'gpt-5' }; thinkingLevel = 'medium' } }
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path $profile 'data\settings.json'), ($settings | ConvertTo-Json -Depth 8), $utf8)
[IO.File]::WriteAllText((Join-Path $profile 'data\chats\chat_upgrade_proof.json'), ($lesson | ConvertTo-Json -Depth 8), $utf8)
$saved = @('data\settings.json', 'data\chats\chat_upgrade_proof.json') | ForEach-Object { [PSCustomObject]@{ relativePath = $_; sha256 = (Get-FileHash -LiteralPath (Join-Path $profile $_) -Algorithm SHA256).Hash } }
[PSCustomObject]@{ installedAt = [DateTime]::UtcNow.ToString('o'); version = '0.5.0'; target = $installDir; executable = $testExecutable; profile = $profile; installerExitCode = $installer.ExitCode; syntheticFiles = @($saved); personalSnapshotUnchanged = $true } | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $proofRoot 'initial-install.json') -Encoding utf8
Write-Output 'Isolated 0.5.0 installed and synthetic preferences/lesson saved. Personal app snapshot unchanged. No app launched.'
