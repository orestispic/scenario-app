param([switch]$RequireSigned)
$ErrorActionPreference = 'Stop'
$taskRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$taskPackage = Get-Content -LiteralPath (Join-Path $taskRoot 'package.json') -Raw | ConvertFrom-Json
$taskInstaller = Join-Path $taskRoot "src-tauri\target\release\bundle\nsis\senario Beta_$($taskPackage.version)_x64-setup.exe"
$taskResolved = (Resolve-Path -LiteralPath $taskInstaller).Path
if (-not $taskResolved.StartsWith($taskRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Installer outside worktree' }
$taskSignature = Get-AuthenticodeSignature -LiteralPath $taskResolved
$taskHash = Get-FileHash -LiteralPath $taskResolved -Algorithm SHA256
[ordered]@{
  product = 'senario Beta'
  version = $taskPackage.version
  filename = [IO.Path]::GetFileName($taskResolved)
  sha256 = $taskHash.Hash.ToLowerInvariant()
  bytes = (Get-Item -LiteralPath $taskResolved).Length
  authenticode = [string]$taskSignature.Status
  certificateThumbprint = $taskSignature.SignerCertificate.Thumbprint
  publicReleaseApproved = $false
} | ConvertTo-Json
if ($RequireSigned -and $taskSignature.Status -ne 'Valid') {
  Write-Error 'PUBLICATION BLOCKED: valid Windows signature missing.'
  exit 2
}
