$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Split-Path $PSScriptRoot -Parent))
$base=Join-Path $root '.next\standalone'
$links=@(Get-ChildItem -LiteralPath $base -Recurse -Force | Where-Object LinkType -eq 'SymbolicLink')
foreach($link in $links){
 $target=$link.Target
 if([IO.Path]::IsPathRooted($target)){$resolved=[IO.Path]::GetFullPath($target)}else{$resolved=[IO.Path]::GetFullPath([IO.Path]::Combine([IO.Path]::GetDirectoryName($link.FullName),$target))}
 if(!$resolved.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)){throw 'Link outside project'}
 if(!(Test-Path -LiteralPath $resolved)){throw "Missing dependency: $resolved"}
 $isdir=Test-Path -LiteralPath $resolved -PathType Container
 if($link.Attributes -band [IO.FileAttributes]::Directory){[IO.Directory]::Delete($link.FullName,$false)}else{[IO.File]::Delete($link.FullName)}
 if($isdir){New-Item -ItemType Junction -Path $link.FullName -Target $resolved | Out-Null}else{Copy-Item -LiteralPath $resolved -Destination $link.FullName}
}
Copy-Item -LiteralPath "$root\.next\static" -Destination "$base\.next\static" -Recurse -Force
if(Test-Path -LiteralPath "$base\.env"){Remove-Item -LiteralPath "$base\.env"}
Write-Output 'Windows build prepared.'


