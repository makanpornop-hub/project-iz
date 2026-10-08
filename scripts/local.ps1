param([ValidateSet('start','stop','status')][string]$Action='start', [switch]$NoBrowser, [switch]$ServicesOnly)
$controlMutex=[Threading.Mutex]::new($false,'Local\ProjectIzServiceControl')
if(!$controlMutex.WaitOne(0)){ $controlMutex.Dispose(); throw 'Project Iz is already starting or stopping. Please wait.' }
try {
$ErrorActionPreference='Stop'
$root=Split-Path $PSScriptRoot -Parent
Set-Location -LiteralPath $root
$node=Join-Path $root '.runtime\node.exe'
$pg=Join-Path $root '.runtime\pgsql\bin\pg_ctl.exe'
$statePath=Join-Path $root '.runtime\processes.json'
$state=@{}
if(Test-Path $statePath) { $saved=Get-Content $statePath -Raw | ConvertFrom-Json -DateKind String; foreach($item in $saved.PSObject.Properties) { $state[$item.Name]=@{id=$item.Value.id;path=$item.Value.path;started=$item.Value.started} } }
function Save-State { $state | ConvertTo-Json | Set-Content $statePath }
function Running($name) {
  if(!$state.ContainsKey($name)) { return $false }
  $p=Get-Process -Id $state[$name].id -ErrorAction SilentlyContinue
  return $p -and $p.Path -eq $state[$name].path -and $p.StartTime.ToUniversalTime().ToString('o') -eq $state[$name].started
}
function Launch($name,$exe,$arguments) {
  if(Running $name) { return }
  $p=Start-Process -FilePath $exe -ArgumentList $arguments -WorkingDirectory $root -WindowStyle Hidden -RedirectStandardOutput "$root\.logs\$name.log" -RedirectStandardError "$root\.logs\$name.error.log" -PassThru
  $state[$name]=@{id=$p.Id;path=$exe;started=$p.StartTime.ToUniversalTime().ToString('o')}; Save-State
}
function Wait-Port($port) {
  for($i=0;$i -lt 90;$i++) {
    $client=[Net.Sockets.TcpClient]::new()
    try { $client.Connect('127.0.0.1',$port); return } catch { Start-Sleep -Milliseconds 1000 } finally { $client.Dispose() }
  }
  throw "Service on port $port did not start. See .logs."
}
if($Action -eq 'stop') {
  foreach($name in @('web','worker','telegram','freshclam','clamav','mail','storage')) {
    if(Running $name) { Stop-Process -Id $state[$name].id -ErrorAction SilentlyContinue }
    $state.Remove($name)
  }
  & $pg stop -D "$root\.data\postgres" -m fast -w
  Save-State
  Write-Output 'Project Iz stopped.'; exit
}
if($Action -eq 'status') {
  foreach($name in @('web','worker','telegram','clamav','mail','storage')) { Write-Output "$name : $(Running $name)" }
  & $pg status -D "$root\.data\postgres"
  exit
}
foreach($line in Get-Content "$root\.env") {
  if($line -match '^([A-Z][A-Z0-9_]*)=(.*)$') { [Environment]::SetEnvironmentVariable($Matches[1],$Matches[2],'Process') }
}
& $pg status -D "$root\.data\postgres" *> $null
if($LASTEXITCODE -ne 0) {
  & $pg start -D "$root\.data\postgres" -l "$root\.logs\postgres.log" -w
  if($LASTEXITCODE -ne 0) { throw 'PostgreSQL failed to start' }
}
$env:MINIO_ROOT_USER=$env:S3_ACCESS_KEY_ID; $env:MINIO_ROOT_PASSWORD=$env:S3_SECRET_ACCESS_KEY
Launch 'storage' "$root\.runtime\minio.exe" "server `"$root\.data\objects`" --address 127.0.0.1:9000 --console-address 127.0.0.1:9001"
Launch 'mail' "$root\.runtime\mailpit\mailpit.exe" "--listen 127.0.0.1:8025 --smtp 127.0.0.1:1025 --database `"$root\.data\mail.db`""
Launch 'clamav' "$root\.runtime\clamav\clamav-1.4.6.win.x64\clamd.exe" "--config-file=`"$root\.runtime\clamd.conf`""
Launch 'freshclam' "$root\.runtime\clamav\clamav-1.4.6.win.x64\freshclam.exe" "--daemon --quiet --config-file=`"$root\.runtime\freshclam.conf`""
Wait-Port 5432; Wait-Port 9000; Wait-Port 1025; Wait-Port 3310
if($ServicesOnly) { Write-Output 'Local services ready.'; exit }
$env:NODE_ENV='production'; $env:HOSTNAME='127.0.0.1'; $env:PORT='3000'
Launch 'worker' $node '--import tsx scripts/worker.ts'
if($env:TELEGRAM_BOT_TOKEN) { Launch 'telegram' $node '--import tsx scripts/telegram-poll.ts' }
Launch 'web' $node '.next/standalone/server.js'
Wait-Port 3000
Write-Output 'Project Iz: http://localhost:3000'
if(!$NoBrowser) { Start-Process 'http://localhost:3000' }

} finally { $controlMutex.ReleaseMutex(); $controlMutex.Dispose() }
