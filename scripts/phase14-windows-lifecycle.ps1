# Runs exclusively on an ephemeral GitHub Windows runner, never on a user's PC.
param([Parameter(Mandatory=$true)][string]$Installer)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or !$env:RUNNER_TEMP) { throw 'An isolated GitHub Actions runner is required.' }
$taskRoot = Join-Path $env:RUNNER_TEMP 'senario-phase14'
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$taskInstall = Join-Path $env:LOCALAPPDATA 'senario Beta'
$taskExe = Join-Path $taskInstall 'scenario-app.exe'
$taskUninstaller = Join-Path $taskInstall 'uninstall.exe'
if (Test-Path -LiteralPath $taskExe) { throw 'The runner already has Senario installed.' }
$env:SENARIO_TEST_VAULT_SCOPE = 'phase14-test-' + [guid]::NewGuid().ToString()
$taskVaultSeeded = $false
$taskExpectedVersion = (Get-Content src-tauri/tauri.conf.json -Raw | ConvertFrom-Json).version
function Test-Vault([string]$Mode) {
  $env:SENARIO_TEST_VAULT_MODE = $Mode
  cargo test --manifest-path src-tauri/Cargo.toml native_device_lifecycle -- --ignored --nocapture
  if ($LASTEXITCODE -ne 0) { throw "Native vault lifecycle failed: $Mode" }
}
function Install-Senario([string]$Path) {
  $taskProcess = Start-Process -FilePath $Path -ArgumentList '/S' -PassThru -WindowStyle Hidden
  if (!$taskProcess.WaitForExit(120000)) { throw 'Installer timeout' }
  if ($taskProcess.ExitCode -ne 0 -or !(Test-Path -LiteralPath $taskExe)) { throw 'Installation failed' }
}
function Verify-Version([string]$Expected) {
  $taskVersion = (Get-Item -LiteralPath $taskExe).VersionInfo.ProductVersion
  if ($taskVersion -notlike "$Expected*") { throw "Unexpected executable version: $taskVersion" }
}
try {
  $taskOldInstaller = Join-Path $taskRoot 'Scenario-0.1.11.exe'
  Invoke-WebRequest 'https://github.com/orestispic/scenario-app/releases/download/v0.1.11/Scenario-Setup.exe' -OutFile $taskOldInstaller
  Install-Senario $taskOldInstaller
  Verify-Version '0.1.11'
  node scripts/phase14-native-e2e.mjs seed
  if ($LASTEXITCODE -ne 0) { throw 'Legacy native app test failed' }
  $taskVaultSeeded = $true
  Test-Vault 'seed'
  # User documents live outside the installation; use a synthetic sentinel only.
  $taskDocument = Join-Path $taskRoot 'preserved.scenario'
  [IO.File]::WriteAllText($taskDocument, '{"formatVersion":1,"title":"Phase 14","content":{"type":"doc","content":[]}}')
  $taskBefore = (Get-FileHash -LiteralPath $taskDocument -Algorithm SHA256).Hash
  Install-Senario (Resolve-Path -LiteralPath $Installer).Path
  Verify-Version $taskExpectedVersion
  node scripts/phase14-native-e2e.mjs verify
  if ($LASTEXITCODE -ne 0) { throw 'Updated native app test failed' }
  Test-Vault 'verify'
  if ((Get-FileHash -LiteralPath $taskDocument -Algorithm SHA256).Hash -ne $taskBefore) { throw 'Document changed during update' }
  $taskUninstallProcess = Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
  if (!$taskUninstallProcess.WaitForExit(120000)) { throw 'Uninstall timeout' }
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(60)
  while ((Test-Path -LiteralPath $taskExe) -and [DateTime]::UtcNow -lt $taskDeadline) { Start-Sleep -Milliseconds 500 }
  if (Test-Path -LiteralPath $taskExe) { throw 'Uninstall did not remove the binary' }
  Test-Vault 'verify'
  Install-Senario (Resolve-Path -LiteralPath $Installer).Path
  Verify-Version $taskExpectedVersion
  node scripts/phase14-native-e2e.mjs reinstalled
  if ($LASTEXITCODE -ne 0) { throw 'Reinstalled native app test failed' }
  Test-Vault 'verify'
  if ((Get-FileHash -LiteralPath $taskDocument -Algorithm SHA256).Hash -ne $taskBefore) { throw 'Document changed during reinstall' }
  Write-Output "PASS: clean 0.1.11 installation, upgrade to $taskExpectedVersion, uninstall, reinstall, system-vault identity and refresh token preserved, document unchanged."
} finally { if ($taskVaultSeeded) { Test-Vault 'cleanup' } }
