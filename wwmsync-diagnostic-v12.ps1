[CmdletBinding()]
param(
  [string]$DbPath = 'E:\wwm\wwm_lite\LocalData\LocalDB\db_mp',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v12.json'),
  [ValidateRange(0,30)][int]$AutoPhaseSeconds = 0,
  [ValidateRange(2,30)][int]$StillSeconds = 8
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v12.
# Correlates read-only SQLite row-content hashes with one controlled collection
# event and one map-open/close control event. Final output contains only row
# identity metadata + content length/hash for changed rows; BLOB content is
# never exported. No process memory, packet capture, pipe access, or DB writes.

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s=[string]$Text
  if ($env:USERPROFILE) { $s=$s.Replace($env:USERPROFILE,'<USERPROFILE>') }
  if ($env:USERNAME) { $s=$s -replace [regex]::Escape($env:USERNAME),'<USER>' }
  $s=$s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)[=:]\s*[^\s,;\}\]]+','$1=<REDACTED>'
  $s=$s -replace '(?i)([?&](?:token|access_token|refresh_token|sessionid|ticket|code)=)[^&\s]+','$1<REDACTED>'
  $s=$s -replace '[A-Fa-f0-9]{48,}','<LONG_HEX>'
  $s=$s -replace '[A-Za-z0-9_\-]{80,}','<LONG_TOKEN>'
  if ($s.Length -gt 320) { $s=$s.Substring(0,320) }
  return $s
}

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 20 | Set-Content -Path $OutputPath -Encoding UTF8
}

if(-not (Test-Path -LiteralPath $DbPath -PathType Leaf)){throw "db_mp not found: $DbPath"}

$pyCmd=$null
$pyPrefix=@()
if(Get-Command py -ErrorAction SilentlyContinue){
  $pyCmd=(Get-Command py).Source
  $pyPrefix=@('-3')
} elseif(Get-Command python -ErrorAction SilentlyContinue){
  $pyCmd=(Get-Command python).Source
} elseif(Get-Command python3 -ErrorAction SilentlyContinue){
  $pyCmd=(Get-Command python3).Source
}
if(-not $pyCmd){throw 'Python 3 is required for v12 because db_mp is SQLite and must be opened read-only.'}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v12'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  dbPath=Protect-Text $DbPath
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; databaseWrite=$false; sqliteReadOnly=$true; sqliteQueryOnly=$true;
    blobContentReadForHash=$true; blobContentExport=$false; unrestrictedRowDump=$false
  }
  config=[ordered]@{ stillSeconds=$StillSeconds; autoPhaseSeconds=$AutoPhaseSeconds }
  snapshots=@()
  stillDelta=@()
  collectDelta=@()
  mapDelta=@()
  collectExclusiveRows=@()
  interestingCollectExclusiveRows=@()
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync db_mp row-delta correlation v12 (READ-ONLY)' -ForegroundColor Cyan

$tmpPy=Join-Path $env:TEMP ('wwmsync-v12-' + [Guid]::NewGuid().ToString('N') + '.py')
$python=@'
import hashlib, json, os, sqlite3, sys
from urllib.parse import quote

db_path, out_path = sys.argv[1], sys.argv[2]
uri = 'file:' + quote(os.path.abspath(db_path).replace('\\','/'), safe='/:') + '?mode=ro'
con = sqlite3.connect(uri, uri=True, timeout=3.0)
con.row_factory = sqlite3.Row
con.execute('PRAGMA query_only=ON')
query_only = bool(int(con.execute('PRAGMA query_only').fetchone()[0]))

def as_bytes(v):
    if v is None: return b''
    if isinstance(v, bytes): return v
    if isinstance(v, memoryview): return v.tobytes()
    if isinstance(v, str): return v.encode('utf-8','replace')
    return str(v).encode('utf-8','replace')

def clean(v):
    if v is None: return None
    s=str(v)
    s=''.join(ch if 32 <= ord(ch) < 127 else ' ' for ch in s)
    return ' '.join(s.split())[:320]

rows=[]
for r in con.execute('SELECT id,key,scope,content FROM localdb ORDER BY id'):
    b=as_bytes(r['content'])
    rows.append({
      'id': clean(r['id']),
      'key': clean(r['key']),
      'scope': clean(r['scope']),
      'contentLength': len(b),
      'contentSha256': hashlib.sha256(b).hexdigest().upper()
    })
con.close()
st=os.stat(db_path)
out={
  'queryOnly': query_only,
  'rowCount': len(rows),
  'fileLength': int(st.st_size),
  'lastWriteUtcNs': int(st.st_mtime_ns),
  'rows': rows
}
with open(out_path,'w',encoding='utf-8') as f:
    json.dump(out,f,ensure_ascii=False,separators=(',',':'))
'@
Set-Content -LiteralPath $tmpPy -Value $python -Encoding UTF8

function Take-Snapshot([string]$Name) {
  $tmpOut=Join-Path $env:TEMP ('wwmsync-v12-snap-' + [Guid]::NewGuid().ToString('N') + '.json')
  try {
    $args=@(); $args += $pyPrefix; $args += @($tmpPy,$DbPath,$tmpOut)
    & $pyCmd @args
    if($LASTEXITCODE -ne 0){throw "Python SQLite snapshot failed with code $LASTEXITCODE"}
    if(-not (Test-Path -LiteralPath $tmpOut)){throw 'SQLite snapshot did not produce JSON.'}
    $p=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
    return [pscustomobject]@{
      name=$Name
      atUtc=[DateTime]::UtcNow.ToString('o')
      queryOnly=[bool]$p.queryOnly
      rowCount=[int]$p.rowCount
      fileLength=[int64]$p.fileLength
      lastWriteUtcNs=[int64]$p.lastWriteUtcNs
      rows=@($p.rows)
    }
  } finally {
    Remove-Item -LiteralPath $tmpOut -Force -ErrorAction SilentlyContinue
  }
}

function Row-Map($Snapshot) {
  $m=@{}
  foreach($r in @($Snapshot.rows)){
    if($null -ne $r.id){$m[[string]$r.id]=$r}
  }
  return $m
}

function Compare-Snapshots($Before,$After,[string]$Phase) {
  $a=Row-Map $Before; $b=Row-Map $After
  $ids=@($a.Keys + $b.Keys | Sort-Object -Unique)
  $out=@()
  foreach($id in $ids){
    $br=$a[$id]; $ar=$b[$id]
    $kind=$null
    if($null -eq $br){$kind='added'}
    elseif($null -eq $ar){$kind='removed'}
    elseif(([string]$br.contentSha256 -ne [string]$ar.contentSha256) -or
           ([int64]$br.contentLength -ne [int64]$ar.contentLength) -or
           ([string]$br.key -ne [string]$ar.key) -or
           ([string]$br.scope -ne [string]$ar.scope)){$kind='changed'}
    if($kind){
      $r=if($null -ne $ar){$ar}else{$br}
      $label=([string]$r.id + ' ' + [string]$r.key + ' ' + [string]$r.scope)
      $interesting=($label -match '(?i)map|collect|collection|finish|finished|treasure|point|spot|explore|scene|position|coord|waypoint|teleport|hujian')
      $out += [pscustomobject]@{
        phase=$Phase
        kind=$kind
        id=Protect-Text ([string]$r.id)
        key=Protect-Text ([string]$r.key)
        scope=Protect-Text ([string]$r.scope)
        interesting=[bool]$interesting
        beforeLength=if($br){[int64]$br.contentLength}else{$null}
        afterLength=if($ar){[int64]$ar.contentLength}else{$null}
        beforeSha256=if($br){[string]$br.contentSha256}else{$null}
        afterSha256=if($ar){[string]$ar.contentSha256}else{$null}
      }
    }
  }
  return @($out)
}

try {
  Write-Host "PHASE 0: baseline snapshot, then remain idle for $StillSeconds seconds." -ForegroundColor Yellow
  $s0=Take-Snapshot 'baseline_start'
  Start-Sleep -Seconds $StillSeconds
  $s1=Take-Snapshot 'baseline_still'
  $state.stillDelta=@(Compare-Snapshots $s0 $s1 'still')
  Write-Host "Idle/background changed rows: $($state.stillDelta.Count)" -ForegroundColor DarkGray

  if($AutoPhaseSeconds -gt 0){
    Write-Host "AUTO PHASE: waiting $AutoPhaseSeconds seconds for collection fixture/event." -ForegroundColor Yellow
    Start-Sleep -Seconds $AutoPhaseSeconds
  } else {
    Write-Host ''
    Write-Host 'PHASE 1: In the game, collect exactly ONE previously-uncollected MAP collectible.' -ForegroundColor Yellow
    Write-Host 'Do not open the map during this phase. Return here immediately after collecting it.'
    [void](Read-Host 'Press ENTER only after the collectible has been collected')
  }
  $s2=Take-Snapshot 'after_collect'
  $state.collectDelta=@(Compare-Snapshots $s1 $s2 'collect')
  Write-Host "Collection-phase changed rows: $($state.collectDelta.Count)" -ForegroundColor Cyan

  if($AutoPhaseSeconds -gt 0){
    Write-Host "AUTO PHASE: waiting $AutoPhaseSeconds seconds for map-control fixture/event." -ForegroundColor Yellow
    Start-Sleep -Seconds $AutoPhaseSeconds
  } else {
    Write-Host ''
    Write-Host 'PHASE 2 CONTROL: Open the in-game map once, then close it. Do nothing else.' -ForegroundColor Yellow
    [void](Read-Host 'Press ENTER after the map has been opened and closed')
  }
  $s3=Take-Snapshot 'after_map_control'
  $state.mapDelta=@(Compare-Snapshots $s2 $s3 'map_control')

  $noiseIds=@{}
  foreach($r in @($state.stillDelta)){$noiseIds[[string]$r.id]=$true}
  foreach($r in @($state.mapDelta)){$noiseIds[[string]$r.id]=$true}
  $exclusive=@()
  foreach($r in @($state.collectDelta)){
    if(-not $noiseIds.ContainsKey([string]$r.id)){$exclusive += $r}
  }
  $state.collectExclusiveRows=@($exclusive)
  $state.interestingCollectExclusiveRows=@($exclusive | Where-Object {$_.interesting})

  $state.snapshots=@(
    [ordered]@{name=$s0.name;atUtc=$s0.atUtc;queryOnly=$s0.queryOnly;rowCount=$s0.rowCount;fileLength=$s0.fileLength;lastWriteUtcNs=$s0.lastWriteUtcNs},
    [ordered]@{name=$s1.name;atUtc=$s1.atUtc;queryOnly=$s1.queryOnly;rowCount=$s1.rowCount;fileLength=$s1.fileLength;lastWriteUtcNs=$s1.lastWriteUtcNs},
    [ordered]@{name=$s2.name;atUtc=$s2.atUtc;queryOnly=$s2.queryOnly;rowCount=$s2.rowCount;fileLength=$s2.fileLength;lastWriteUtcNs=$s2.lastWriteUtcNs},
    [ordered]@{name=$s3.name;atUtc=$s3.atUtc;queryOnly=$s3.queryOnly;rowCount=$s3.rowCount;fileLength=$s3.fileLength;lastWriteUtcNs=$s3.lastWriteUtcNs}
  )

  $state.status='complete'
  $state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  $state.summary=[ordered]@{
    queryOnlyAll=(@($state.snapshots | Where-Object {-not $_.queryOnly}).Count -eq 0)
    baselineRows=[int]$s1.rowCount
    stillChangedRows=$state.stillDelta.Count
    collectChangedRows=$state.collectDelta.Count
    mapControlChangedRows=$state.mapDelta.Count
    collectExclusiveRowCount=$state.collectExclusiveRows.Count
    interestingCollectExclusiveRowCount=$state.interestingCollectExclusiveRows.Count
    collectInterestingRowCount=@($state.collectDelta | Where-Object {$_.interesting}).Count
  }
  Write-Json $state
  Write-Host ''
  Write-Host "Complete. still=$($state.summary.stillChangedRows) collect=$($state.summary.collectChangedRows) map=$($state.summary.mapControlChangedRows) exclusive=$($state.summary.collectExclusiveRowCount) interestingExclusive=$($state.summary.interestingCollectExclusiveRowCount)" -ForegroundColor Green
  Write-Host "Output: $OutputPath"
} finally {
  Remove-Item -LiteralPath $tmpPy -Force -ErrorAction SilentlyContinue
}
