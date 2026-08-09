[CmdletBinding()]
param(
  [string]$LauncherExe = 'E:\wwm\Win32\deploy\launcher.exe',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v7.json')
)

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v7.
# Static/read-only analysis of the launcher binary only.
# No process-memory reads, injection, packet capture, active network probes,
# pipe connects/writes, registry writes, credential collection, or game-file writes.

$Needles = @(
  'wwm_launcher_server','wwm_launcher_mutex','onNewConnection','newConnection',
  'QLocalServer','QLocalSocket','connectToServer','disconnectFromServer','waitForConnected',
  'waitForReadyRead','readyRead','readAll','readLine','bytesAvailable','writeData','write',
  'QIODevice','QDataStream','QByteArray','QJsonDocument','QJsonObject','QJsonValue',
  'QCoreApplication','arguments','argv','commandLine','command','cmdline','parameter','params',
  'QUrl','openUrl','scheme','protocol','deeplink','deepLink','url','URL',
  'startGame','launchGame','gamePath','game_path','wwm.exe','h72','map','personal','pcEntry',
  'qmlMain.cpp','HexMessiahLauncherOversea'
)

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s=[string]$Text
  if ($env:USERPROFILE) { $s=$s.Replace($env:USERPROFILE,'<USERPROFILE>') }
  if ($env:USERNAME) { $s=$s -replace [regex]::Escape($env:USERNAME),'<USER>' }
  $s=$s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)=\S+','$1=<REDACTED>'
  $s=$s -replace '(?i)([?&](?:token|access_token|refresh_token|sessionid|ticket|code)=)[^&\s]+','$1<REDACTED>'
  $s=$s -replace '[A-Fa-f0-9]{40,}','<LONG_HEX>'
  $s=$s -replace '[A-Za-z0-9_-]{64,}','<LONG_TOKEN>'
  return $s
}

function Clean-Text([string]$Text) {
  if ($null -eq $Text) { return '' }
  $s=$Text -replace '[^\x20-\x7E]',' '
  $s=$s -replace '\s+',' '
  return Protect-Text $s.Trim()
}

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 14 | Set-Content -Path $OutputPath -Encoding UTF8
}

function Find-StringHits([string]$Text,[string]$Needle,[string]$EncodingName,[int]$ByteScale=1,[int]$MaxHits=20) {
  $hits=@()
  if ([string]::IsNullOrEmpty($Text) -or [string]::IsNullOrEmpty($Needle)) { return $hits }
  $from=0
  while ($from -lt $Text.Length -and $hits.Count -lt $MaxHits) {
    $idx=$Text.IndexOf($Needle,$from,[StringComparison]::Ordinal)
    if ($idx -lt 0) { break }
    $start=[Math]::Max(0,$idx-256)
    $len=[Math]::Min(768,$Text.Length-$start)
    $hits += [ordered]@{
      needle=$Needle
      encoding=$EncodingName
      offset=[int64]($idx*$ByteScale)
      context=(Clean-Text $Text.Substring($start,$len))
    }
    $from=$idx+[Math]::Max(1,$Needle.Length)
  }
  return $hits
}

function Get-AsciiStrings([byte[]]$Bytes,[int]$Start,[int]$Length,[int]$MinLen=4,[int]$MaxStrings=600) {
  $out=@()
  $end=[Math]::Min($Bytes.Length,$Start+$Length)
  $i=[Math]::Max(0,$Start)
  while ($i -lt $end -and $out.Count -lt $MaxStrings) {
    if ($Bytes[$i] -ge 32 -and $Bytes[$i] -le 126) {
      $s=$i
      while ($i -lt $end -and $Bytes[$i] -ge 32 -and $Bytes[$i] -le 126) { $i++ }
      $len=$i-$s
      if ($len -ge $MinLen) {
        $text=[Text.Encoding]::ASCII.GetString($Bytes,$s,$len)
        $out += [ordered]@{ offset=[int64]$s; text=(Protect-Text $text) }
      }
    } else { $i++ }
  }
  return $out
}

$seed=[ordered]@{
  schema='wwmsync-native-diagnostic-v7'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  launcherExe=Protect-Text $LauncherExe
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; staticFileRead=$true
  }
  launcher=$null
  exactHits=@()
  pipeNeighborhood=@()
  summary=$null
}
Write-Json $seed
Write-Host 'WWMSync launcher IPC contract diagnostic v7 (READ-ONLY)' -ForegroundColor Cyan

if (-not (Test-Path -LiteralPath $LauncherExe -PathType Leaf)) {
  $seed.status='error'
  $seed.summary=[ordered]@{ error='launcher_not_found' }
  Write-Json $seed
  throw "Launcher not found: $LauncherExe"
}

$item=Get-Item -LiteralPath $LauncherExe
$sha=$null; try { $sha=(Get-FileHash -Algorithm SHA256 -LiteralPath $LauncherExe).Hash } catch {}
$seed.launcher=[ordered]@{ path=Protect-Text $LauncherExe; length=[int64]$item.Length; sha256=$sha }
Write-Json $seed

$bytes=[IO.File]::ReadAllBytes($LauncherExe)
$ascii=[Text.Encoding]::ASCII.GetString($bytes)
$utf16=[Text.Encoding]::Unicode.GetString($bytes)

$allHits=@()
foreach($needle in $Needles) {
  $allHits += @(Find-StringHits $ascii $needle 'ascii' 1 20)
  $allHits += @(Find-StringHits $utf16 $needle 'utf16le' 2 20)
}
$seed.exactHits=@($allHits | Sort-Object offset,needle)
Write-Json $seed

$pipeHit=@($seed.exactHits | Where-Object { $_.needle -eq 'wwm_launcher_server' } | Sort-Object offset | Select-Object -First 1)
if ($pipeHit.Count -gt 0) {
  $center=[int64]$pipeHit[0].offset
  $start=[Math]::Max(0,[int]($center-65536))
  $length=[Math]::Min(131072,$bytes.Length-$start)
  $seed.pipeNeighborhood=@(Get-AsciiStrings $bytes $start $length 4 800)
}

$interesting=@($seed.exactHits | Where-Object {
  $_.needle -in @(
    'wwm_launcher_server','wwm_launcher_mutex','onNewConnection','newConnection',
    'QLocalServer','QLocalSocket','connectToServer','disconnectFromServer','waitForConnected',
    'waitForReadyRead','readyRead','readAll','readLine','bytesAvailable','writeData',
    'QDataStream','QByteArray','QJsonDocument','QJsonObject','QCoreApplication','arguments','argv',
    'commandLine','command','cmdline','QUrl','openUrl','scheme','deeplink','deepLink','startGame',
    'launchGame','wwm.exe','pcEntry','qmlMain.cpp','HexMessiahLauncherOversea'
  )
})

$seed.status='complete'
$seed.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
$seed.summary=[ordered]@{
  totalExactHits=$seed.exactHits.Count
  interestingHits=$interesting.Count
  pipeHits=@($seed.exactHits | Where-Object {$_.needle -eq 'wwm_launcher_server'}).Count
  localServerHits=@($seed.exactHits | Where-Object {$_.needle -eq 'QLocalServer'}).Count
  localSocketHits=@($seed.exactHits | Where-Object {$_.needle -eq 'QLocalSocket'}).Count
  readHits=@($seed.exactHits | Where-Object {$_.needle -in @('readAll','readLine','readyRead','waitForReadyRead')}).Count
  writeHits=@($seed.exactHits | Where-Object {$_.needle -in @('write','writeData')}).Count
  argumentHits=@($seed.exactHits | Where-Object {$_.needle -in @('arguments','argv','commandLine','command','cmdline','parameter','params')}).Count
  urlHits=@($seed.exactHits | Where-Object {$_.needle -in @('QUrl','openUrl','scheme','protocol','deeplink','deepLink','url','URL')}).Count
  neighborhoodStrings=$seed.pipeNeighborhood.Count
}
Write-Json $seed
Write-Host "Complete. exact=$($seed.summary.totalExactHits) interesting=$($seed.summary.interestingHits) pipe=$($seed.summary.pipeHits) localServer=$($seed.summary.localServerHits) localSocket=$($seed.summary.localSocketHits) read=$($seed.summary.readHits) args=$($seed.summary.argumentHits)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
