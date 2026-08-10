[CmdletBinding()]
param(
  [string]$DbPath = 'E:\wwm\wwm_lite\LocalData\LocalDB\db_mp',
  [string]$CandidateKey = 'red_list_cache_10000Bag',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v13.json'),
  [ValidateRange(0,30)][int]$AutoPhaseSeconds = 0
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v13.
# Read-only candidate-row BLOB diff around exactly one map collectible event.
# It exports exact BLOB bytes ONLY for the explicitly selected CandidateKey,
# capped at 4096 bytes, plus hashes for all rows so unrelated DB changes remain
# visible. No process memory, packet capture, pipe access, credentials, or DB writes.

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
  $Object | ConvertTo-Json -Depth 24 | Set-Content -Path $OutputPath -Encoding UTF8
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
if(-not $pyCmd){throw 'Python 3 is required for v13 because db_mp is SQLite and must be opened read-only.'}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v13'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  dbPath=Protect-Text $DbPath
  candidateKey=Protect-Text $CandidateKey
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; databaseWrite=$false; sqliteReadOnly=$true; sqliteQueryOnly=$true;
    allRowContentHashOnly=$true; candidateBlobContentRead=$true; candidateBlobContentExport=$true;
    candidateBlobExportMaxBytes=4096; unrestrictedRowDump=$false
  }
  before=$null
  after=$null
  changedRows=@()
  candidateDiffs=@()
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync candidate BLOB diff v13 (READ-ONLY)' -ForegroundColor Cyan
Write-Host "Candidate key: $CandidateKey"

$tmpPy=Join-Path $env:TEMP ('wwmsync-v13-' + [Guid]::NewGuid().ToString('N') + '.py')
$python=@'
import hashlib, json, os, sqlite3, sys
from urllib.parse import quote

db_path, candidate_key, out_path = sys.argv[1], sys.argv[2], sys.argv[3]
MAX_EXPORT = 4096
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

def ascii_preview(b):
    return ''.join(chr(x) if 32 <= x < 127 else '.' for x in b[:256])

rows=[]
candidates=[]
for r in con.execute('SELECT id,key,scope,content FROM localdb ORDER BY id'):
    b=as_bytes(r['content'])
    item={
      'id': clean(r['id']),
      'key': clean(r['key']),
      'scope': clean(r['scope']),
      'contentLength': len(b),
      'contentSha256': hashlib.sha256(b).hexdigest().upper()
    }
    rows.append(item)
    if str(r['key']) == candidate_key:
      exp=b[:MAX_EXPORT]
      candidates.append({
        **item,
        'contentExportTruncated': len(b) > MAX_EXPORT,
        'contentHex': exp.hex().upper(),
        'contentAscii': ascii_preview(exp)
      })
con.close()
st=os.stat(db_path)
out={
  'queryOnly': query_only,
  'rowCount': len(rows),
  'fileLength': int(st.st_size),
  'lastWriteUtcNs': int(st.st_mtime_ns),
  'rows': rows,
  'candidates': candidates
}
with open(out_path,'w',encoding='utf-8') as f:
    json.dump(out,f,ensure_ascii=False,separators=(',',':'))
'@
Set-Content -LiteralPath $tmpPy -Value $python -Encoding UTF8

function Take-Snapshot([string]$Name) {
  $tmpOut=Join-Path $env:TEMP ('wwmsync-v13-snap-' + [Guid]::NewGuid().ToString('N') + '.json')
  try {
    $args=@(); $args += $pyPrefix; $args += @($tmpPy,$DbPath,$CandidateKey,$tmpOut)
    & $pyCmd @args
    if($LASTEXITCODE -ne 0){throw "Python SQLite snapshot failed with code $LASTEXITCODE"}
    if(-not (Test-Path -LiteralPath $tmpOut)){throw 'SQLite snapshot did not produce JSON.'}
    $p=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
    return [pscustomobject]@{
      name=$Name; atUtc=[DateTime]::UtcNow.ToString('o'); queryOnly=[bool]$p.queryOnly;
      rowCount=[int]$p.rowCount; fileLength=[int64]$p.fileLength; lastWriteUtcNs=[int64]$p.lastWriteUtcNs;
      rows=@($p.rows); candidates=@($p.candidates)
    }
  } finally {
    Remove-Item -LiteralPath $tmpOut -Force -ErrorAction SilentlyContinue
  }
}

function Row-Map($Rows) {
  $m=@{}
  foreach($r in @($Rows)){ if($null -ne $r.id){$m[[string]$r.id]=$r} }
  return $m
}

function Compare-AllRows($Before,$After) {
  $a=Row-Map $Before.rows; $b=Row-Map $After.rows
  $ids=@($a.Keys + $b.Keys | Sort-Object -Unique)
  $out=@()
  foreach($id in $ids){
    $br=$a[$id]; $ar=$b[$id]; $kind=$null
    if($null -eq $br){$kind='added'}
    elseif($null -eq $ar){$kind='removed'}
    elseif(([string]$br.contentSha256 -ne [string]$ar.contentSha256) -or ([int64]$br.contentLength -ne [int64]$ar.contentLength)){$kind='changed'}
    if($kind){
      $r=if($ar){$ar}else{$br}
      $out += [pscustomobject]@{
        kind=$kind; id=Protect-Text ([string]$r.id); key=Protect-Text ([string]$r.key); scope=Protect-Text ([string]$r.scope);
        beforeLength=if($br){[int64]$br.contentLength}else{$null}; afterLength=if($ar){[int64]$ar.contentLength}else{$null};
        beforeSha256=if($br){[string]$br.contentSha256}else{$null}; afterSha256=if($ar){[string]$ar.contentSha256}else{$null}
      }
    }
  }
  return @($out)
}

function Hex-ToBytes([string]$Hex) {
  if([string]::IsNullOrEmpty($Hex)){return [byte[]]@()}
  $n=[int]($Hex.Length/2); $b=New-Object byte[] $n
  for($i=0;$i -lt $n;$i++){$b[$i]=[Convert]::ToByte($Hex.Substring($i*2,2),16)}
  return $b
}
function Bytes-ToHex([byte[]]$Bytes,[int]$Start,[int]$Length) {
  if($Length -le 0){return ''}
  $slice=New-Object byte[] $Length
  [Array]::Copy($Bytes,$Start,$slice,0,$Length)
  return ([BitConverter]::ToString($slice)).Replace('-','')
}
function Diff-Candidate($BeforeRow,$AfterRow) {
  $bb=Hex-ToBytes ([string]$BeforeRow.contentHex); $ab=Hex-ToBytes ([string]$AfterRow.contentHex)
  $min=[Math]::Min($bb.Length,$ab.Length)
  $prefix=0
  while($prefix -lt $min -and $bb[$prefix] -eq $ab[$prefix]){$prefix++}
  $suffix=0
  while($suffix -lt ($min-$prefix) -and $bb[$bb.Length-1-$suffix] -eq $ab[$ab.Length-1-$suffix]){$suffix++}
  $bChanged=[Math]::Max(0,$bb.Length-$prefix-$suffix)
  $aChanged=[Math]::Max(0,$ab.Length-$prefix-$suffix)
  $isAppend=($ab.Length -ge $bb.Length -and $prefix -eq $bb.Length)
  return [pscustomobject]@{
    id=Protect-Text ([string]$AfterRow.id); key=Protect-Text ([string]$AfterRow.key); scope=Protect-Text ([string]$AfterRow.scope);
    beforeLength=[int]$BeforeRow.contentLength; afterLength=[int]$AfterRow.contentLength;
    beforeSha256=[string]$BeforeRow.contentSha256; afterSha256=[string]$AfterRow.contentSha256;
    beforeHex=[string]$BeforeRow.contentHex; afterHex=[string]$AfterRow.contentHex;
    beforeAscii=[string]$BeforeRow.contentAscii; afterAscii=[string]$AfterRow.contentAscii;
    commonPrefixBytes=$prefix; commonSuffixBytes=$suffix;
    changedBeforeHex=(Bytes-ToHex $bb $prefix $bChanged); changedAfterHex=(Bytes-ToHex $ab $prefix $aChanged);
    appendOnly=[bool]$isAppend; appendedBytes=if($isAppend){$ab.Length-$bb.Length}else{$null};
    appendedHex=if($isAppend){Bytes-ToHex $ab $bb.Length ($ab.Length-$bb.Length)}else{$null}
  }
}

try {
  $s0=Take-Snapshot 'before_collect'
  if(@($s0.candidates).Count -eq 0){throw "Candidate key not found in localdb: $CandidateKey"}
  Write-Host "Baseline captured. candidateRows=$(@($s0.candidates).Count) totalRows=$($s0.rowCount)" -ForegroundColor Green

  if($AutoPhaseSeconds -gt 0){
    Write-Host "AUTO PHASE: waiting $AutoPhaseSeconds seconds for fixture/event." -ForegroundColor Yellow
    Start-Sleep -Seconds $AutoPhaseSeconds
  } else {
    Write-Host ''
    Write-Host 'PHASE: collect exactly ONE previously-uncollected MAP collectible.' -ForegroundColor Yellow
    Write-Host 'Do not open the map and do not intentionally pick up any unrelated item.'
    [void](Read-Host 'Press ENTER immediately after the collectible has been collected')
  }

  $s1=Take-Snapshot 'after_collect'
  $state.changedRows=@(Compare-AllRows $s0 $s1)

  $beforeMap=Row-Map $s0.candidates; $afterMap=Row-Map $s1.candidates
  $diffs=@()
  foreach($id in @($beforeMap.Keys + $afterMap.Keys | Sort-Object -Unique)){
    $br=$beforeMap[$id]; $ar=$afterMap[$id]
    if($br -and $ar -and (([string]$br.contentSha256 -ne [string]$ar.contentSha256) -or ([int]$br.contentLength -ne [int]$ar.contentLength))){
      $diffs += Diff-Candidate $br $ar
    }
  }
  $state.candidateDiffs=@($diffs)
  $state.before=[ordered]@{atUtc=$s0.atUtc;queryOnly=$s0.queryOnly;rowCount=$s0.rowCount;fileLength=$s0.fileLength;lastWriteUtcNs=$s0.lastWriteUtcNs;candidateRows=@($s0.candidates)}
  $state.after=[ordered]@{atUtc=$s1.atUtc;queryOnly=$s1.queryOnly;rowCount=$s1.rowCount;fileLength=$s1.fileLength;lastWriteUtcNs=$s1.lastWriteUtcNs;candidateRows=@($s1.candidates)}
  $state.status='complete'
  $state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  $state.summary=[ordered]@{
    queryOnlyAll=([bool]$s0.queryOnly -and [bool]$s1.queryOnly)
    baselineRows=[int]$s0.rowCount
    changedRowCount=$state.changedRows.Count
    candidateRowCount=@($s0.candidates).Count
    candidateChangedCount=$state.candidateDiffs.Count
    otherChangedRowCount=@($state.changedRows | Where-Object {$_.key -ne $CandidateKey}).Count
    appendOnlyCandidateCount=@($state.candidateDiffs | Where-Object {$_.appendOnly}).Count
    appendedByteCounts=@($state.candidateDiffs | Where-Object {$_.appendOnly} | ForEach-Object {$_.appendedBytes})
  }
  Write-Json $state
  Write-Host ''
  Write-Host "Complete. changedRows=$($state.summary.changedRowCount) candidateChanged=$($state.summary.candidateChangedCount) otherChanged=$($state.summary.otherChangedRowCount) appendOnly=$($state.summary.appendOnlyCandidateCount)" -ForegroundColor Green
  Write-Host "Output: $OutputPath"
} finally {
  Remove-Item -LiteralPath $tmpPy -Force -ErrorAction SilentlyContinue
}
