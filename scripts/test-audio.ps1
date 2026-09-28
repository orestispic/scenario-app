$ErrorActionPreference='Stop'
$projectRoot=Split-Path $PSScriptRoot -Parent
$testModels=Join-Path $projectRoot 'outputs/audio-test-models'
New-Item -ItemType Directory -Force -Path $testModels | Out-Null
$revision='1939ad2a8e416c0acfeecc08a694d14ef25f2231'
$assets=@(
  @('onnx/model_quantized.onnx','model.onnx','fbae9257e1e05ffc727e951ef9b9c98418e6d79f1c9b6b13bd59f5c9028a1478'),
  @('voices/ff_siwis.bin','ff_siwis.bin','a35f5675ad08948e326ae75fd0ea16ba5d0042e4f76b5f3d1df77d0a48c54861')
)
foreach($asset in $assets) {
  $target=Join-Path $testModels $asset[1]
  if(!(Test-Path $target)) {Invoke-WebRequest "https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX/resolve/$revision/$($asset[0])" -OutFile $target}
  if((Get-FileHash $target -Algorithm SHA256).Hash -ne $asset[2]){throw 'Empreinte de modèle incorrecte.'}
}
$previousTestDirectory=$env:SENARIO_AUDIO_TEST_DIR
$env:SENARIO_AUDIO_TEST_DIR=$testModels
Push-Location (Join-Path $projectRoot 'src-tauri')
try {& "$env:USERPROFILE/.cargo/bin/cargo.exe" test --lib audio::tests::real_french_synthesis_and_cache -- --ignored --nocapture; if($LASTEXITCODE -ne 0){throw 'Test audio réel échoué.'}} finally {Pop-Location; $env:SENARIO_AUDIO_TEST_DIR=$previousTestDirectory}
