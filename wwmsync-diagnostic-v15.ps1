[CmdletBinding()]
param(
  [string]$GameRoot = 'E:\wwm\wwm_lite',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v15.json')
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native diagnostic v15
# PURPOSE: inventory the complete installed game tree to identify opaque game
# archive/package formats that v14's extension-based scan could not target.
# READ-ONLY: file metadata plus the first 32 bytes of each file for format magic.
# No process memory, injection, packet capture, pipe access, network, registry
# writes, database writes, or game-file writes.

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s=[string]$Text
  if ($env:USERPROFILE) { $s=$s.Replace($env:USERPROFILE,'<USERPROFILE>') }
  if ($env:USERNAME) { $s=$s -replace [regex]::Escape($env:USERNAME),'<USER>' }
  return $s
}

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 16 | Set-Content -Path $OutputPath -Encoding UTF8
}

if(-not (Test-Path -LiteralPath $GameRoot -PathType Container)){throw "Game root not found: $GameRoot"}

$pyCmd=$null
$pyPrefix=@()
if(Get-Command py -ErrorAction SilentlyContinue){ $pyCmd=(Get-Command py).Source; $pyPrefix=@('-3') }
elseif(Get-Command python -ErrorAction SilentlyContinue){ $pyCmd=(Get-Command python).Source }
elseif(Get-Command python3 -ErrorAction SilentlyContinue){ $pyCmd=(Get-Command python3).Source }
if(-not $pyCmd){throw 'Python 3 is required for v15 inventory.'}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v15'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  gameRoot=Protect-Text $GameRoot
  safety=[ordered]@{
    fileMetadataRead=$true; first32BytesRead=$true;
    fullFileContentRead=$false; memoryRead=$false; processHandleRead=$false;
    injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false;
    registryWrite=$false; gameFileWrite=$false; databaseWrite=$false
  }
  result=$null
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync full game package inventory v15 (READ-ONLY)' -ForegroundColor Cyan

$tmpPy=Join-Path $env:TEMP ('wwmsync-v15-' + [Guid]::NewGuid().ToString('N') + '.py')
$tmpOut=Join-Path $env:TEMP ('wwmsync-v15-' + [Guid]::NewGuid().ToString('N') + '.json')
$python=@'
import collections, json, os, re, sys

root,out_path=sys.argv[1],sys.argv[2]

# Only format classification from the first 32 bytes. Unknown signatures are
# deliberately preserved as short hex so the next pass can target the actual
# package format without dumping file contents.
def classify_magic(b):
    if b.startswith(b'MZ'): return 'PE'
    if b.startswith(b'\x7fELF'): return 'ELF'
    if b.startswith(b'PK\x03\x04') or b.startswith(b'PK\x05\x06') or b.startswith(b'PK\x07\x08'): return 'ZIP'
    if b.startswith(b'7z\xbc\xaf\x27\x1c'): return '7Z'
    if b.startswith(b'Rar!\x1a\x07'): return 'RAR'
    if b.startswith(b'\x1f\x8b'): return 'GZIP'
    if b.startswith(b'BZh'): return 'BZIP2'
    if b.startswith(b'\xfd7zXZ\x00'): return 'XZ'
    if b.startswith(b'SQLite format 3\x00'): return 'SQLITE3'
    if b.startswith(b'\x89PNG\r\n\x1a\n'): return 'PNG'
    if b.startswith(b'\xff\xd8\xff'): return 'JPEG'
    if b.startswith(b'RIFF') and len(b)>=12 and b[8:12]==b'WEBP': return 'WEBP'
    if b.startswith(b'RIFF') and len(b)>=12 and b[8:12]==b'WAVE': return 'WAV'
    if len(b)>=12 and b[4:8]==b'ftyp': return 'ISO-BMFF'
    if b.startswith(b'OggS'): return 'OGG'
    if b.startswith(b'fLaC'): return 'FLAC'
    if b.startswith(b'UnityFS'): return 'UNITYFS'
    if b.startswith(b'UnityRaw'): return 'UNITYRAW'
    if b.startswith(b'UnityWeb'): return 'UNITYWEB'
    return 'UNKNOWN'

path_hint=re.compile(r'(?i)(content|asset|resource|package|pack|patch|script|lua|logic|client|rpc|message|notify|social|friend|map|game)')
files=[]; ext_stats=collections.defaultdict(lambda:{'count':0,'bytes':0}); magic_stats=collections.Counter(); dir_stats=collections.defaultdict(lambda:{'count':0,'bytes':0}); errors=[]
for base,dirs,names in os.walk(root):
    dirs[:] = [d for d in dirs if d.lower() not in {'screenshots','screenshot','captures','recordings','crashes','crashdump','crashdumps'}]
    for name in names:
        path=os.path.join(base,name)
        rel=os.path.relpath(path,root).replace('\\','/')
        ext=os.path.splitext(name)[1].lower() or '<none>'
        try:
            size=os.path.getsize(path)
            with open(path,'rb') as f: head=f.read(32)
        except Exception as e:
            if len(errors)<200: errors.append({'path':rel,'error':type(e).__name__+': '+str(e)[:180]})
            continue
        magic=classify_magic(head)
        top=rel.split('/',1)[0] if '/' in rel else '<root>'
        ext_stats[ext]['count']+=1; ext_stats[ext]['bytes']+=size
        magic_stats[magic]+=1
        dir_stats[top]['count']+=1; dir_stats[top]['bytes']+=size
        files.append({
            'path':rel,'name':name,'extension':ext,'size':size,'magic':magic,
            'headHex':head[:16].hex().upper(),
            'pathHint':bool(path_hint.search(rel))
        })

files.sort(key=lambda x:(-x['size'],x['path'].lower()))
ext_rows=[{'extension':k,'count':v['count'],'bytes':v['bytes']} for k,v in ext_stats.items()]
ext_rows.sort(key=lambda x:(-x['bytes'],-x['count'],x['extension']))
magic_rows=[{'magic':k,'count':v} for k,v in magic_stats.items()]
magic_rows.sort(key=lambda x:(-x['count'],x['magic']))
dir_rows=[{'topDir':k,'count':v['count'],'bytes':v['bytes']} for k,v in dir_stats.items()]
dir_rows.sort(key=lambda x:(-x['bytes'],x['topDir']))

opaque=[x for x in files if x['magic']=='UNKNOWN' and (x['size']>=1024*1024 or x['pathHint'])]
package_ext_hint=re.compile(r'(?i)^\.(pak|pkg|npk|cpk|vpk|obb|bundle|archive|res|resource|dat|data|bin|blk|pack|patch|pck|zip)$')
package_candidates=[x for x in files if x['magic'] in {'ZIP','7Z','RAR','GZIP','BZIP2','XZ','UNITYFS','UNITYRAW','UNITYWEB'} or package_ext_hint.match(x['extension']) or (x['magic']=='UNKNOWN' and x['size']>=8*1024*1024)]

out={
  'files':files,
  'extensionStats':ext_rows,
  'magicStats':magic_rows,
  'topDirectoryStats':dir_rows,
  'opaqueCandidates':opaque[:1000],
  'packageCandidates':package_candidates[:1000],
  'errors':errors,
  'summary':{
    'fileCount':len(files),
    'totalBytes':sum(x['size'] for x in files),
    'uniqueExtensionCount':len(ext_rows),
    'unknownMagicCount':magic_stats.get('UNKNOWN',0),
    'opaqueCandidateCount':len(opaque),
    'packageCandidateCount':len(package_candidates),
    'largestFile':files[0] if files else None
  }
}
with open(out_path,'w',encoding='utf-8') as f: json.dump(out,f,ensure_ascii=False,indent=2)
'@

try {
  Set-Content -LiteralPath $tmpPy -Value $python -Encoding UTF8
  $args=@(); $args += $pyPrefix; $args += @($tmpPy,$GameRoot,$tmpOut)
  & $pyCmd @args
  if($LASTEXITCODE -ne 0){throw "Python inventory exited with code $LASTEXITCODE"}
  if(-not (Test-Path -LiteralPath $tmpOut)){throw 'Inventory did not produce JSON.'}
  $probe=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
  $state.result=$probe
  $state.status='complete'
  $state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  $state.summary=[ordered]@{
    fileCount=[int]$probe.summary.fileCount
    totalBytes=[long]$probe.summary.totalBytes
    uniqueExtensionCount=[int]$probe.summary.uniqueExtensionCount
    unknownMagicCount=[int]$probe.summary.unknownMagicCount
    opaqueCandidateCount=[int]$probe.summary.opaqueCandidateCount
    packageCandidateCount=[int]$probe.summary.packageCandidateCount
    largestFile=$probe.summary.largestFile
  }
  Write-Json $state
  Write-Host "Complete. files=$($state.summary.fileCount) extensions=$($state.summary.uniqueExtensionCount) opaque=$($state.summary.opaqueCandidateCount) packageCandidates=$($state.summary.packageCandidateCount)" -ForegroundColor Green
  if($state.summary.largestFile){ Write-Host "Largest: $($state.summary.largestFile.path) ($($state.summary.largestFile.size) bytes) magic=$($state.summary.largestFile.magic)" }
  Write-Host "Output: $OutputPath"
} finally {
  Remove-Item -LiteralPath $tmpPy,$tmpOut -Force -ErrorAction SilentlyContinue
}
