$ErrorActionPreference = 'Stop'
$stateRoot = Join-Path $env:USERPROFILE '.codex\video-bot'
foreach ($name in @('runner', 'studio-watcher')) {
  $lockFile = Join-Path $stateRoot ($name + '.lock')
  if (!(Test-Path -LiteralPath $lockFile)) { continue }
  $record = Get-Content -LiteralPath $lockFile -Raw | ConvertFrom-Json
  $processRecord = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + [int]$record.pid)
  if ($processRecord) {
    $expected = if ($name -eq 'runner') { 'cli\.mjs["\s]+start' } else { 'studio-watcher\.mjs' }
    if ($processRecord.Name -ne 'node.exe' -or $processRecord.CommandLine -notmatch $expected) {
      Write-Warning ('PID không thuộc ' + $name + '; giữ khóa để kiểm tra.')
      continue
    }
    Stop-Process -Id ([int]$record.pid) -Force
    Write-Host ('Đã dừng ' + $name)
  }
  Remove-Item -LiteralPath $lockFile -Force
}
