# Runs exclusively on an ephemeral GitHub Windows runner, never on a user's PC.
param(
  [Parameter(Mandatory=$true)][string]$Installer,
  [string]$PreviousInstaller,
  [string]$PreviousVersion,
  [string]$PreviousSha256,
  [switch]$AllowUnsignedBaselineForTesting,
  [switch]$RequireUpgradeAndRollback
)
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or !$env:RUNNER_TEMP -or $env:RUNNER_ENVIRONMENT -ne 'github-hosted') { throw 'An isolated GitHub Actions runner is required (GitHub-hosted only).' }
if ($AllowUnsignedBaselineForTesting -and $RequireUpgradeAndRollback) { throw 'The commercial release gate cannot use an unsigned test baseline.' }
if ($AllowUnsignedBaselineForTesting -and (!$PreviousInstaller -or $PreviousSha256 -notmatch '^[a-fA-F0-9]{64}$')) { throw 'An explicit test baseline and its SHA-256 are required.' }
if ($RequireUpgradeAndRollback -and (!$PreviousInstaller -or !$PreviousVersion)) { throw 'A verified previous production installer and version are required to prove upgrade and rollback.' }
if ([bool]$PreviousInstaller -ne [bool]$PreviousVersion) { throw 'Supply both PreviousInstaller and PreviousVersion.' }
$taskCandidate = (Resolve-Path -LiteralPath $Installer).Path
if ($PreviousInstaller) {
  $PreviousInstaller = (Resolve-Path -LiteralPath $PreviousInstaller).Path
  if ($PreviousSha256 -and (Get-FileHash -LiteralPath $PreviousInstaller -Algorithm SHA256).Hash -ne $PreviousSha256) { throw 'Previous installer SHA-256 mismatch.' }
  if ($AllowUnsignedBaselineForTesting) {
    Write-Output 'TEST ONLY: unsigned historical baseline with verified SHA-256; this does not approve commercial release.'
  } else {
    & (Join-Path $PSScriptRoot 'verify-authenticode.ps1') -Installer $PreviousInstaller -RequireTimestamp
  }
}
$taskRoot = Join-Path $env:RUNNER_TEMP 'senario-phase14'
New-Item -ItemType Directory -Path $taskRoot -Force | Out-Null
$taskInstall = Join-Path $env:LOCALAPPDATA 'senario'
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
  if ($taskVersion -notmatch ('^' + [regex]::Escape($Expected) + '(?:\.0)?$')) { throw "Unexpected executable version: $taskVersion" }
}
function Verify-Resources {
  foreach ($taskRelative in @('scenario-file-icon.ico','THIRD_PARTY_NOTICES','THIRD_PARTY_NOTICES_AUDIO.txt','audio-runtime/onnxruntime.dll','audio-runtime/espeak/espeak-ng.exe','audio-runtime/espeak/COPYING.txt','audio-runtime/espeak-ng-1.52.0-source.zip')) {
    if (!(Test-Path -LiteralPath (Join-Path $taskInstall $taskRelative) -PathType Leaf)) { throw "Missing installed resource: $taskRelative" }
  }
  $taskIcon = (Get-Item -LiteralPath 'HKCU:\Software\Classes\ScenarioApp.Project\DefaultIcon').GetValue('')
  if ($taskIcon -ne ('"' + (Join-Path $taskInstall 'scenario-file-icon.ico') + '",0')) { throw 'The .scenario icon does not point to the installed resource.' }
}
try {
  # The historical public artifacts were private-beta builds with a different
  # product identifier and install directory. They are not a valid upgrade
  # source for the production application. Validate the production installer
  # itself, then prove that uninstall/reinstall preserves the external document
  # and the OS-vault identity.
  if ($PreviousInstaller) {
    if ([version]$PreviousVersion -ge [version]$taskExpectedVersion) { throw 'The baseline must be older than the candidate.' }
    Install-Senario $PreviousInstaller
    Verify-Version $PreviousVersion
    node scripts/phase14-native-e2e.mjs seed
    if ($LASTEXITCODE -ne 0) { throw 'Previous native app seed failed' }
  }
  Install-Senario $taskCandidate
  Verify-Version $taskExpectedVersion
  Verify-Resources
  $taskNativeMode = if ($PreviousInstaller) { 'verify' } else { 'seed' }
  node scripts/phase14-native-e2e.mjs $taskNativeMode
  if ($LASTEXITCODE -ne 0) { throw 'Production native app seed failed' }
  $taskVaultSeeded = $true
  Test-Vault 'seed'
  # User documents live outside the installation; use a synthetic sentinel only.
  $taskDocument = Join-Path $taskRoot 'preserved.scenario'
  [IO.File]::WriteAllText($taskDocument, '{"formatVersion":1,"title":"Phase 14","content":{"type":"doc","content":[]}}')
  $taskBefore = (Get-FileHash -LiteralPath $taskDocument -Algorithm SHA256).Hash
  $taskUninstallProcess = Start-Process -FilePath $taskUninstaller -ArgumentList '/S' -PassThru -WindowStyle Hidden
  if (!$taskUninstallProcess.WaitForExit(120000)) { throw 'Uninstall timeout' }
  $taskDeadline = [DateTime]::UtcNow.AddSeconds(60)
  while ((Test-Path -LiteralPath $taskExe) -and [DateTime]::UtcNow -lt $taskDeadline) { Start-Sleep -Milliseconds 500 }
  if (Test-Path -LiteralPath $taskExe) { throw 'Uninstall did not remove the binary' }
  Test-Vault 'verify'
  Install-Senario $taskCandidate
  Verify-Version $taskExpectedVersion
  Verify-Resources
  node scripts/phase14-native-e2e.mjs reinstalled
  if ($LASTEXITCODE -ne 0) { throw 'Reinstalled native app test failed' }
  Test-Vault 'verify'
  if ((Get-FileHash -LiteralPath $taskDocument -Algorithm SHA256).Hash -ne $taskBefore) { throw 'Document changed during reinstall' }
  if ($PreviousInstaller) {
    Install-Senario $PreviousInstaller
    Verify-Version $PreviousVersion
    Test-Vault 'verify'
    node scripts/phase14-native-e2e.mjs verify
    if ($LASTEXITCODE -ne 0) { throw 'Rollback native app test failed' }
    if ((Get-FileHash -LiteralPath $taskDocument -Algorithm SHA256).Hash -ne $taskBefore) { throw 'Document changed during rollback' }
    Install-Senario $taskCandidate
    Verify-Version $taskExpectedVersion
    Write-Output 'PASS: previous-version installer upgrade and rollback. Tauri network update remains a separate test.'
  } else { Write-Output 'NOT TESTED: upgrade from a previous version, rollback and Tauri network update.' }
  Write-Output "PASS: production $taskExpectedVersion installation, uninstall, reinstall, system-vault identity and refresh token preserved, document unchanged."
} finally { if ($taskVaultSeeded) { Test-Vault 'cleanup' } }
