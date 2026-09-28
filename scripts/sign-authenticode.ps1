param([string]$Path, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
# Provision a CA-issued code-signing certificate/private key in CurrentUser/My
# through the chosen secure signing provider. Never put a PFX/password in Git.
$taskThumbprint = $env:SENARIO_SIGNING_CERTIFICATE_THUMBPRINT
if ($taskThumbprint -notmatch '^[A-Fa-f0-9]{40}$') { throw 'Configure SENARIO_SIGNING_CERTIFICATE_THUMBPRINT with the commercial certificate thumbprint.' }
$taskCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$taskThumbprint"
if (!$taskCertificate.HasPrivateKey -or $taskCertificate.NotAfter -le (Get-Date) -or $taskCertificate.NotBefore -gt (Get-Date)) { throw 'A current certificate with its private key is required.' }
$taskCodeSigning = $taskCertificate.Extensions | Where-Object { $_ -is [System.Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' }
if (!$taskCodeSigning) { throw 'A code-signing certificate is required.' }
if ($taskCertificate.Subject -eq $taskCertificate.Issuer) { throw 'Self-signed certificates are not accepted for commercial release.' }
$taskTimestamp = $env:SENARIO_SIGNING_TIMESTAMP_URL
if (!$taskTimestamp -or ![Uri]::IsWellFormedUriString($taskTimestamp, [UriKind]::Absolute) -or ([Uri]$taskTimestamp).Scheme -notin @('http','https')) { throw 'Configure the RFC3161 timestamp URL supplied by the certificate authority.' }
$taskSignTool = (Get-Command signtool.exe -ErrorAction SilentlyContinue).Source
if (!$taskSignTool) {
    $taskSignTool = Get-ChildItem -Path "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName
}
if (!$taskSignTool) { throw 'Install the Windows SDK signing tools in the isolated build environment.' }
if ($CheckOnly) { Write-Output 'Signing prerequisites present; no artifact was signed.'; return }
if (!$Path) { throw 'A binary path is required.' }
$taskBinary = (Resolve-Path -LiteralPath $Path).Path
& $taskSignTool sign /sha1 $taskThumbprint /s My /fd SHA256 /tr $taskTimestamp /td SHA256 $taskBinary
if ($LASTEXITCODE -ne 0) { throw 'Authenticode signing failed.' }
& (Join-Path $PSScriptRoot 'verify-authenticode.ps1') -Installer $taskBinary -ExpectedThumbprint $taskThumbprint -RequireTimestamp
