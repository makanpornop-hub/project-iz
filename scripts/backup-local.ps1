$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$folder=Join-Path $root ('backups\'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $folder -Force | Out-Null
$acl=Get-Acl $folder
$acl.SetAccessRuleProtection($true,$false)
$acl.SetAccessRule([Security.AccessControl.FileSystemAccessRule]::new([Security.Principal.WindowsIdentity]::GetCurrent().User,'FullControl','ContainerInherit,ObjectInherit','None','Allow'))
Set-Acl $folder $acl
try {
  & "$PSScriptRoot\local.ps1" stop
  & "$root\.runtime\pgsql\bin\pg_ctl.exe" start -D "$root\.data\postgres" -l "$root\.logs\postgres.log" -w
  if($LASTEXITCODE -ne 0){throw 'Database start failed'}
  $line=Get-Content "$root\.env" | Where-Object {$_ -match '^POSTGRES_PASSWORD='}
  $env:PGPASSWORD=$line.Substring('POSTGRES_PASSWORD='.Length)
  & "$root\.runtime\pgsql\bin\pg_dump.exe" -h 127.0.0.1 -U iz -d iz -Fc -f "$folder\database.dump"
  if($LASTEXITCODE -ne 0){throw 'Database backup failed'}
  Copy-Item -LiteralPath "$root\.data\objects" -Destination "$folder\objects" -Recurse
  Copy-Item -LiteralPath "$root\.env" -Destination "$folder\.env"
  'Complete local database and object storage backup. Keep private.' | Set-Content "$folder\COMPLETE.txt"
  Write-Output "Backup saved: $folder"
} finally {
  $env:PGPASSWORD=$null
  & "$PSScriptRoot\local.ps1" start -NoBrowser
}
