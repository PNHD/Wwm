[CmdletBinding()]
param(
  [string]$DbPath = 'E:\wwm\wwm_lite\LocalData\LocalDB\db_mp',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v10.json')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v10.
# Static/read-only inspection of db_mp and sibling LocalDB metadata.
# Exports only file metadata, magic/header summary, and short redacted contexts
# around map/state-related keywords. No process memory, network/pipe access,
# credential collection, or game/database writes.

$Needles = @(
  'gamePosition','playerPosition','player_pos','rolePosition','role_pos','position',
  'coordinate','coordinates','coord','mapId','map_id','mapPoint','map_point',
  'pointId','point_id','finished','finish','collect','collection','collected',
  'explore','exploration','sceneId','scene_id','worldId','world_id','treasure',
  'waypoint','teleport','latitude','longitude'
)

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s=[string]$Text
  if ($env:USERPROFILE) { $s=$s.Replace($env:USERPROFILE,'<USERPROFILE>') }
  if ($env:USERNAME) { $s=$s -replace [regex]::Escape($env:USERNAME),'<USER>' }
  $s=$s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)[=:]\s*[^\s,;\}\]]+','$1=<REDACTED>'
  $s=$s -replace '(?i)([?&](?:token|access_token|refresh_token|sessionid|ticket|code)=)[^&\s]+','$1<REDACTED>'
  $s=$s -replace '[A-Fa-f0-9]{48,}','<LONG_HEX>'
  $s=$s -replace '[A-Za-z0-9_\-]{80,}','<LONG_TOKEN>'
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

function Bytes-ToHex([byte[]]$Bytes,[int]$Count) {
  $n=[Math]::Min($Count,$Bytes.Length)
  if($n -le 0){return ''}
  return ([BitConverter]::ToString($Bytes,0,$n)).Replace('-','')
}

function Count-BytePattern([byte[]]$Bytes,[byte[]]$Pattern) {
  if($Pattern.Length -eq 0 -or $Bytes.Length -lt $Pattern.Length){return 0}
  $count=0
  for($i=0;$i -le $Bytes.Length-$Pattern.Length;$i++){
    $ok=$true
    for($j=0;$j -lt $Pattern.Length;$j++){
      if($Bytes[$i+$j] -ne $Pattern[$j]){$ok=$false;break}
    }
    if($ok){$count++;$i += ($Pattern.Length-1)}
  }
  return $count
}

function Find-TextHits([string]$Text,[string]$Needle,[string]$EncodingName,[int]$ByteScale,[int]$MaxHits=12) {
  $out=@()
  if([string]::IsNullOrEmpty($Text)){return $out}
  $from=0
  while($from -lt $Text.Length -and $out.Count -lt $MaxHits){
    $idx=$Text.IndexOf($Needle,$from,[StringComparison]::OrdinalIgnoreCase)
    if($idx -lt 0){break}
    $start=[Math]::Max(0,$idx-160)
    $len=[Math]::Min(480,$Text.Length-$start)
    $out += [ordered]@{
      needle=$Needle
      encoding=$EncodingName
      offset=[int64]($idx*$ByteScale)
      context=(Clean-Text $Text.Substring($start,$len))
    }
    $from=$idx+[Math]::Max(1,$Needle.Length)
  }
  return $out
}

if(-not (Test-Path -LiteralPath $DbPath -PathType Leaf)){throw "db_mp not found: $DbPath"}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v10'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  dbPath=Protect-Text $DbPath
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; databaseWrite=$false; fileContentRead=$true; fileContentExport=$false;
    shortRedactedContextExport=$true
  }
  file=$null
  localDbSiblings=@()
  formatSignals=$null
  keywordHits=@()
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync db_mp static schema diagnostic v10 (READ-ONLY)' -ForegroundColor Cyan

$item=Get-Item -LiteralPath $DbPath
$sha=$null
try{$sha=(Get-FileHash -LiteralPath $DbPath -Algorithm SHA256).Hash}catch{}
$bytes=[IO.File]::ReadAllBytes($DbPath)
$headCount=[Math]::Min(128,$bytes.Length)
$headAscii=''
if($headCount -gt 0){$headAscii=Clean-Text ([Text.Encoding]::ASCII.GetString($bytes,0,$headCount))}
$state.file=[ordered]@{
  length=[int64]$item.Length
  lastWriteUtc=$item.LastWriteTimeUtc.ToString('o')
  sha256=$sha
  headerHex=(Bytes-ToHex $bytes 64)
  headerAscii=$headAscii
}

$dir=Split-Path -Parent $DbPath
if(Test-Path -LiteralPath $dir){
  $state.localDbSiblings=@(Get-ChildItem -LiteralPath $dir -File | Sort-Object Name | ForEach-Object {
    [ordered]@{ name=$_.Name; length=[int64]$_.Length; lastWriteUtc=$_.LastWriteTimeUtc.ToString('o') }
  })
}
Write-Json $state

$sqliteMagic=[Text.Encoding]::ASCII.GetBytes('SQLite format 3')
$levelMagic=[Text.Encoding]::ASCII.GetBytes('MANIFEST-')
$lmdbMagic=[byte[]](0xDE,0xC0,0xEF,0xBE)
$state.formatSignals=[ordered]@{
  sqliteHeader=([Text.Encoding]::ASCII.GetString($bytes,0,[Math]::Min(16,$bytes.Length))).StartsWith('SQLite format 3')
  sqliteMagicOccurrences=(Count-BytePattern $bytes $sqliteMagic)
  levelManifestTextOccurrences=(Count-BytePattern $bytes $levelMagic)
  lmdbMagicLittleEndianOccurrences=(Count-BytePattern $bytes $lmdbMagic)
  startsWithZip=($bytes.Length -ge 4 -and $bytes[0] -eq 0x50 -and $bytes[1] -eq 0x4B)
  startsWithGzip=($bytes.Length -ge 2 -and $bytes[0] -eq 0x1F -and $bytes[1] -eq 0x8B)
  startsWithZstd=($bytes.Length -ge 4 -and $bytes[0] -eq 0x28 -and $bytes[1] -eq 0xB5 -and $bytes[2] -eq 0x2F -and $bytes[3] -eq 0xFD)
}
Write-Json $state

$ascii=[Text.Encoding]::ASCII.GetString($bytes)
$utf16=[Text.Encoding]::Unicode.GetString($bytes)
$hits=@()
foreach($needle in $Needles){
  $hits += @(Find-TextHits $ascii $needle 'ascii' 1 12)
  $hits += @(Find-TextHits $utf16 $needle 'utf16le' 2 12)
}
$state.keywordHits=@($hits | Sort-Object offset,needle)

$state.status='complete'
$state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
$state.summary=[ordered]@{
  siblingFiles=$state.localDbSiblings.Count
  keywordHits=$state.keywordHits.Count
  distinctNeedles=@($state.keywordHits | Select-Object -ExpandProperty needle -Unique)
  formatSignalCount=@(
    $state.formatSignals.sqliteHeader,
    ($state.formatSignals.sqliteMagicOccurrences -gt 0),
    ($state.formatSignals.levelManifestTextOccurrences -gt 0),
    ($state.formatSignals.lmdbMagicLittleEndianOccurrences -gt 0),
    $state.formatSignals.startsWithZip,
    $state.formatSignals.startsWithGzip,
    $state.formatSignals.startsWithZstd
  ).Where({$_ -eq $true}).Count
}
Write-Json $state
Write-Host "Complete. siblings=$($state.summary.siblingFiles) keywordHits=$($state.summary.keywordHits) formatSignals=$($state.summary.formatSignalCount)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
