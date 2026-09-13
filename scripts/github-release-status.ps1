$ErrorActionPreference = 'Stop'
$env:GIT_TERMINAL_PROMPT = '0'
$env:GCM_INTERACTIVE = 'never'
# Reuse Git's existing GitHub credential only for api.github.com. Never print it.
$taskLines = "protocol=https`nhost=github.com`n`n" | git credential fill
if ($LASTEXITCODE -ne 0) { throw 'GitHub credential unavailable' }
$taskCredential = @{}
foreach ($taskLine in $taskLines) {
  $taskParts = $taskLine.Split('=', 2)
  if ($taskParts.Count -eq 2) { $taskCredential[$taskParts[0]] = $taskParts[1] }
}
try {
  $taskHeaders = @{ Authorization = "Bearer $($taskCredential.password)"; Accept = 'application/vnd.github+json' }
  $taskSecrets = Invoke-RestMethod 'https://api.github.com/repos/orestispic/scenario-app/actions/secrets' -Headers $taskHeaders
  $taskRuns = Invoke-RestMethod 'https://api.github.com/repos/orestispic/scenario-app/actions/runs?per_page=3' -Headers $taskHeaders
  [ordered]@{
    updaterKeyConfigured = $taskSecrets.secrets.name -contains 'TAURI_SIGNING_PRIVATE_KEY'
    updaterPasswordConfigured = $taskSecrets.secrets.name -contains 'TAURI_SIGNING_PRIVATE_KEY_PASSWORD'
    runs = @($taskRuns.workflow_runs | Select-Object id, head_sha, status, conclusion, html_url)
  } | ConvertTo-Json -Depth 4
} finally {
  $taskHeaders = $null; $taskCredential.Clear(); $taskLines = $null
}
