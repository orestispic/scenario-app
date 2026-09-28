$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$projectRoot = Split-Path $PSScriptRoot -Parent
$audioRoot = Join-Path $projectRoot 'src-tauri/audio-runtime'
$downloadRoot = Join-Path $projectRoot 'outputs/audio-build'
New-Item -ItemType Directory -Force -Path $audioRoot,$downloadRoot | Out-Null
function Get-VerifiedArchive($url, $name, $hash) {
    $file = Join-Path $downloadRoot $name
    if (!(Test-Path $file)) { Invoke-WebRequest $url -OutFile $file }
    $stream = [System.IO.File]::OpenRead($file)
    try { $actual = [BitConverter]::ToString([System.Security.Cryptography.SHA256]::Create().ComputeHash($stream)).Replace('-', '') } finally { $stream.Dispose() }
    if ($actual -ne $hash) { throw "Archive invalide : $name" }
    return $file
}
if (!(Test-Path (Join-Path $audioRoot 'onnxruntime.dll'))) {
    $archive = Get-VerifiedArchive 'https://github.com/microsoft/onnxruntime/releases/download/v1.22.0/onnxruntime-win-x64-1.22.0.zip' 'onnxruntime.zip' '174C616EFC0271194488642A72F1A514E01487DA4DFE84C49296D66E40EBE0DA'
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    if (!(Test-Path (Join-Path $downloadRoot 'onnxruntime-win-x64-1.22.0'))) { [System.IO.Compression.ZipFile]::ExtractToDirectory($archive, $downloadRoot) }
    $ortRoot = Join-Path $downloadRoot 'onnxruntime-win-x64-1.22.0'
    Copy-Item (Join-Path $ortRoot 'lib/*.dll') $audioRoot
    Copy-Item (Join-Path $ortRoot 'LICENSE') (Join-Path $audioRoot 'ONNX-RUNTIME-LICENSE.txt')
    Copy-Item (Join-Path $ortRoot 'ThirdPartyNotices.txt') $audioRoot
}
if (!(Test-Path (Join-Path $audioRoot 'espeak/espeak-ng.exe'))) {
    $archive = Get-VerifiedArchive 'https://github.com/espeak-ng/espeak-ng/releases/download/1.52.0/espeak-ng.msi' 'espeak-ng.msi' '7F673C709EA5DD579D3B5EBB98688CC575328A6AB7438D2BC405B88CEDAEAFB9'
    # Administrative extraction into the build directory; no system installation.
    $extractRoot = Join-Path $downloadRoot 'espeak-extracted'
    $arguments = '/a "' + $archive + '" /qn TARGETDIR="' + $extractRoot + '"'
    $process = Start-Process msiexec.exe -ArgumentList $arguments -Wait -PassThru -WindowStyle Hidden
    if ($process.ExitCode -ne 0) { throw "Extraction eSpeak échouée : $($process.ExitCode)" }
    $exe = Get-ChildItem $extractRoot -Filter espeak-ng.exe -Recurse | Select-Object -First 1
    if (!$exe) { throw 'Exécutable eSpeak absent de la distribution officielle.' }
    Copy-Item $exe.Directory.FullName (Join-Path $audioRoot 'espeak') -Recurse
}
# Distribute the exact upstream source together with the separate GPL executable.
$sourceArchive = Get-VerifiedArchive 'https://github.com/espeak-ng/espeak-ng/archive/refs/tags/1.52.0.zip' 'espeak-ng-1.52.0-source.zip' 'B4517592E3CBC43703BB1C782702EAFB98097659E0B7E96E69C32EE32AE5003A'
Copy-Item $sourceArchive (Join-Path $audioRoot 'espeak-ng-1.52.0-source.zip') -Force
Copy-Item (Join-Path $projectRoot 'licenses/audio/GPL-3.0.txt') (Join-Path $audioRoot 'espeak/COPYING.txt') -Force
Write-Output 'Moteurs audio Windows x64 prêts. Aucun modèle vocal téléchargé.'
