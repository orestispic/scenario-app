param([Parameter(Mandatory = $true)][string]$Installer, [string]$ExpectedThumbprint = $env:SENARIO_SIGNING_CERTIFICATE_THUMBPRINT, [switch]$RequireTimestamp)
$ErrorActionPreference = 'Stop'
$taskInstaller = (Resolve-Path -LiteralPath $Installer).Path
$taskSignature = Get-AuthenticodeSignature -LiteralPath $taskInstaller
if ($taskSignature.Status -ne 'Valid' -or $null -eq $taskSignature.SignerCertificate) {
    throw 'La signature Authenticode de cet installateur est absente ou invalide.'
}
if ($ExpectedThumbprint -and $taskSignature.SignerCertificate.Thumbprint -ne $ExpectedThumbprint) {
    throw 'La signature Authenticode ne correspond pas au certificat éditeur attendu.'
}
if ($RequireTimestamp -and $null -eq $taskSignature.TimeStamperCertificate) {
    throw "La signature Authenticode ne comporte pas d'horodatage vérifiable."
}
Write-Output "Signature Authenticode valide : $($taskSignature.SignerCertificate.Thumbprint)"
