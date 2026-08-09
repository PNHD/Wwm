[CmdletBinding()]
param(
  [string]$DbPath = 'E:\wwm\wwm_lite\LocalData\LocalDB\db_mp',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v11.json')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native bridge diagnostic v11.
# Read-only SQLite schema/key inspection for db_mp.
# Uses Python's standard sqlite3 module when available and opens the DB with
# mode=ro + PRAGMA query_only=ON. It exports schema metadata and only short,
# redacted TEXT values that match map/state-related keywords. It never writes
# to the game DB, reads process memory, connects to pipes, or captures packets.

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

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 18 | Set-Content -Path $OutputPath -Encoding UTF8
}

if(-not (Test-Path -LiteralPath $DbPath -PathType Leaf)){throw "db_mp not found: $DbPath"}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v11'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  dbPath=Protect-Text $DbPath
  safety=[ordered]@{
    memoryRead=$false; injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false; registryWrite=$false;
    gameFileWrite=$false; databaseWrite=$false; sqliteReadOnly=$true; sqliteQueryOnly=$true;
    schemaMetadataExport=$true; keywordFilteredRowExport=$true; unrestrictedRowDump=$false
  }
  engine=$null
  pythonCommand=$null
  sqlite=$null
  fallback=$null
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync db_mp SQLite schema diagnostic v11 (READ-ONLY)' -ForegroundColor Cyan

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

if($pyCmd){
  $tmpPy=Join-Path $env:TEMP ('wwmsync-v11-' + [Guid]::NewGuid().ToString('N') + '.py')
  $tmpOut=Join-Path $env:TEMP ('wwmsync-v11-' + [Guid]::NewGuid().ToString('N') + '.json')
  $python=@'
import json, os, re, sqlite3, sys
from urllib.parse import quote

db_path, out_path = sys.argv[1], sys.argv[2]
needles = ['map','collect','collection','finish','finished','explore','treasure','position','coordinate','coord','scene','point','waypoint','teleport']

def redact(v):
    s = '' if v is None else str(v)
    s = re.sub(r'(?i)(token|ticket|session|password|passwd|secret|authorization)[=:]\s*[^\s,;}\]]+', r'\1=<REDACTED>', s)
    s = re.sub(r'(?i)([?&](?:token|access_token|refresh_token|sessionid|ticket|code)=)[^&\s]+', r'\1<REDACTED>', s)
    s = re.sub(r'[A-Fa-f0-9]{48,}', '<LONG_HEX>', s)
    s = re.sub(r'[A-Za-z0-9_\-]{80,}', '<LONG_TOKEN>', s)
    s = ''.join(ch if 32 <= ord(ch) < 127 else ' ' for ch in s)
    s = re.sub(r'\s+', ' ', s).strip()
    return s[:240]

def qi(name):
    return '"' + str(name).replace('"','""') + '"'

uri = 'file:' + quote(os.path.abspath(db_path).replace('\\','/'), safe='/:') + '?mode=ro'
con = sqlite3.connect(uri, uri=True, timeout=2.0)
con.row_factory = sqlite3.Row
con.execute('PRAGMA query_only=ON')
query_only = int(con.execute('PRAGMA query_only').fetchone()[0])
user_version = int(con.execute('PRAGMA user_version').fetchone()[0])
page_size = int(con.execute('PRAGMA page_size').fetchone()[0])
page_count = int(con.execute('PRAGMA page_count').fetchone()[0])

objects=[]
tables=[]
keyword_rows=[]
rows = con.execute("SELECT type,name,tbl_name,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY type,name").fetchall()
for r in rows:
    objects.append({'type':r['type'],'name':r['name'],'table':r['tbl_name'],'sql':redact(r['sql']) if r['sql'] else None})

for r in rows:
    if r['type'] != 'table':
        continue
    t = r['name']
    cols = con.execute('PRAGMA table_info(%s)' % qi(t)).fetchall()
    colinfo=[]
    text_candidates=[]
    for c in cols:
        typ=(c['type'] or '').upper()
        info={'cid':int(c['cid']),'name':c['name'],'type':c['type'],'notNull':bool(c['notnull']),'pk':int(c['pk'])}
        colinfo.append(info)
        if ('CHAR' in typ or 'CLOB' in typ or 'TEXT' in typ or typ == ''):
            text_candidates.append(c['name'])
    try:
        row_count=int(con.execute('SELECT COUNT(*) FROM %s' % qi(t)).fetchone()[0])
    except Exception:
        row_count=None
    tables.append({'name':t,'rowCount':row_count,'columns':colinfo})

    # Only keyword-filtered text; no unrestricted row/sample dump.
    for col in text_candidates:
        qcol=qi(col)
        clauses=[]
        params=[]
        for n in needles:
            clauses.append('lower(CAST(%s AS TEXT)) LIKE ?' % qcol)
            params.append('%%%s%%' % n)
        sql='SELECT DISTINCT substr(CAST(%s AS TEXT),1,240) AS v FROM %s WHERE %s LIMIT 80' % (qcol, qi(t), ' OR '.join(clauses))
        try:
            for rr in con.execute(sql, params):
                val=redact(rr['v'])
                if not val:
                    continue
                keyword_rows.append({'table':t,'column':col,'value':val})
                if len(keyword_rows) >= 400:
                    break
        except Exception:
            pass
        if len(keyword_rows) >= 400:
            break
    if len(keyword_rows) >= 400:
        break

con.close()

# De-duplicate while preserving order.
seen=set(); uniq=[]
for r in keyword_rows:
    k=(r['table'],r['column'],r['value'])
    if k in seen: continue
    seen.add(k); uniq.append(r)

out={
  'queryOnly': bool(query_only),
  'userVersion': user_version,
  'pageSize': page_size,
  'pageCount': page_count,
  'objects': objects,
  'tables': tables,
  'keywordRows': uniq,
  'summary': {
    'objectCount': len(objects),
    'tableCount': len(tables),
    'keywordRowCount': len(uniq),
    'keywordTables': sorted(set(x['table'] for x in uniq)),
    'keywordColumns': sorted(set(x['column'] for x in uniq))
  }
}
with open(out_path,'w',encoding='utf-8') as f:
    json.dump(out,f,ensure_ascii=False,indent=2)
'@
  try {
    Set-Content -LiteralPath $tmpPy -Value $python -Encoding UTF8
    $args=@()
    $args += $pyPrefix
    $args += @($tmpPy,$DbPath,$tmpOut)
    & $pyCmd @args
    if($LASTEXITCODE -ne 0){throw "Python sqlite probe exited with code $LASTEXITCODE"}
    if(-not (Test-Path -LiteralPath $tmpOut)){throw 'Python sqlite probe did not produce JSON.'}
    $probe=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
    $state.engine='python-sqlite3'
    $state.pythonCommand=(Split-Path -Leaf $pyCmd)
    $state.sqlite=$probe
  } finally {
    Remove-Item -LiteralPath $tmpPy,$tmpOut -Force -ErrorAction SilentlyContinue
  }
} else {
  # Fallback: static extraction of CREATE TABLE / INDEX strings only.
  $bytes=[IO.File]::ReadAllBytes($DbPath)
  $ascii=[Text.Encoding]::ASCII.GetString($bytes)
  $matches=@([regex]::Matches($ascii,'(?is)CREATE\s+(?:TABLE|INDEX|VIEW)\s+.{0,1200}?(?:\x00|$)'))
  $schemas=@()
  foreach($m in $matches | Select-Object -First 120){
    $s=Protect-Text (($m.Value -replace '[^\x20-\x7E]',' ') -replace '\s+',' ')
    if($s.Length -gt 500){$s=$s.Substring(0,500)}
    $schemas += $s
  }
  $state.engine='static-fallback'
  $state.fallback=[ordered]@{ reason='No py/python/python3 command found'; schemaStrings=@($schemas); schemaStringCount=$schemas.Count }
}

$state.status='complete'
$state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
if($state.sqlite){
  $state.summary=[ordered]@{
    engine=$state.engine
    queryOnly=[bool]$state.sqlite.queryOnly
    tableCount=[int]$state.sqlite.summary.tableCount
    objectCount=[int]$state.sqlite.summary.objectCount
    keywordRowCount=[int]$state.sqlite.summary.keywordRowCount
    keywordTables=@($state.sqlite.summary.keywordTables)
    keywordColumns=@($state.sqlite.summary.keywordColumns)
  }
} else {
  $state.summary=[ordered]@{ engine=$state.engine; queryOnly=$null; tableCount=$null; objectCount=$null; keywordRowCount=$null; keywordTables=@(); keywordColumns=@() }
}
Write-Json $state
Write-Host "Complete. engine=$($state.summary.engine) tables=$($state.summary.tableCount) keywordRows=$($state.summary.keywordRowCount)" -ForegroundColor Green
Write-Host "Output: $OutputPath"
