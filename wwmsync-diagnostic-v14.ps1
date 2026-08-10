[CmdletBinding()]
param(
  [string]$GameRoot = 'E:\wwm\wwm_lite',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v14.json'),
  [ValidateRange(16,1024)][int]$MaxFileMB = 256
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

# WWMSync native diagnostic v14
# PURPOSE: locate static game-side strings/files that could implement the
# remote client-method / approval receiver used by GFN-compatible sync.
# READ-ONLY: walks file metadata and reads candidate files from disk only.
# No game process memory, injection, packet capture, pipe access, network,
# registry writes, or game-file writes.

function Protect-Text([string]$Text) {
  if ($null -eq $Text) { return $null }
  $s=[string]$Text
  if ($env:USERPROFILE) { $s=$s.Replace($env:USERPROFILE,'<USERPROFILE>') }
  if ($env:USERNAME) { $s=$s -replace [regex]::Escape($env:USERNAME),'<USER>' }
  $s=$s -replace '(?i)(token|ticket|session|password|passwd|secret|authorization)[=:]\s*[^\s,;\}\]]+','$1=<REDACTED>'
  $s=$s -replace '[A-Fa-f0-9]{48,}','<LONG_HEX>'
  $s=$s -replace '[A-Za-z0-9_\-]{80,}','<LONG_TOKEN>'
  if ($s.Length -gt 700) { $s=$s.Substring(0,700) }
  return $s
}

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if ($parent -and -not (Test-Path $parent)) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $Object | ConvertTo-Json -Depth 20 | Set-Content -Path $OutputPath -Encoding UTF8
}

if(-not (Test-Path -LiteralPath $GameRoot -PathType Container)){throw "Game root not found: $GameRoot"}

$pyCmd=$null
$pyPrefix=@()
if(Get-Command py -ErrorAction SilentlyContinue){ $pyCmd=(Get-Command py).Source; $pyPrefix=@('-3') }
elseif(Get-Command python -ErrorAction SilentlyContinue){ $pyCmd=(Get-Command python).Source }
elseif(Get-Command python3 -ErrorAction SilentlyContinue){ $pyCmd=(Get-Command python3).Source }
if(-not $pyCmd){throw 'Python 3 is required for v14 static file scanning.'}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v14'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  gameRoot=Protect-Text $GameRoot
  safety=[ordered]@{
    staticFileRead=$true; fileMetadataRead=$true;
    memoryRead=$false; processHandleRead=$false; injection=$false;
    packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false;
    registryWrite=$false; gameFileWrite=$false; databaseWrite=$false
  }
  config=[ordered]@{ maxFileMB=$MaxFileMB }
  result=$null
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync remote-method receiver static diagnostic v14 (READ-ONLY)' -ForegroundColor Cyan

$tmpPy=Join-Path $env:TEMP ('wwmsync-v14-' + [Guid]::NewGuid().ToString('N') + '.py')
$tmpOut=Join-Path $env:TEMP ('wwmsync-v14-' + [Guid]::NewGuid().ToString('N') + '.json')
$python=@'
import hashlib, json, mmap, os, re, sys

root, out_path, max_mb = sys.argv[1], sys.argv[2], int(sys.argv[3])
max_bytes=max_mb*1024*1024

# High-signal literals from the known GFN protocol plus generic names commonly
# used by legitimate server->client RPC/approval bridges. No auth secrets.
primary=[
 'start_game_sync','call_client_method','invokeClientMethod','client_method',
 'game_sync','waiting_for_approval','Permission denied',
 'Only receive messages from friends','relayServerId','connectionKey',
 'wwmmapsync','gamePosition'
]
secondary=[
 'remote_method','remoteMethod','remote_call','remoteCall','invoke_client',
 'client_rpc','clientRpc','server_to_client','serverToClient','rpc_callback',
 'rpcCallback','confirm_request','permission_request','client_notify',
 'clientNotify','notification_request','friend_message','friendMessage'
]
needles=primary+secondary

text_ext={'.lua','.luac','.py','.js','.json','.xml','.cfg','.conf','.ini','.txt','.toml','.yaml','.yml','.proto','.csv','.data','.bytes','.manifest','.list','.log'}
binary_ext={'.exe','.dll','.so','.bin','.dat','.data','.bytes','.pak','.pkg','.bundle','.res','.resource','.archive','.idx','.index','.db'}
name_hint=re.compile(r'(?i)(lua|script|rpc|client|server|net|network|message|notify|social|friend|chat|web|sdk|protocol|map)')
archive_ext={'.pak','.pkg','.bundle','.archive','.res','.resource'}

candidates=[]; skipped_large=[]; archive_inventory=[]; total_files=0
for base,dirs,files in os.walk(root):
    # Avoid user-generated screenshots/video captures and crash dumps.
    dirs[:] = [d for d in dirs if d.lower() not in {'screenshots','screenshot','captures','recordings','crashes','crashdump','crashdumps'}]
    for name in files:
        total_files += 1
        path=os.path.join(base,name)
        ext=os.path.splitext(name)[1].lower()
        try: size=os.path.getsize(path)
        except OSError: continue
        rel=os.path.relpath(path,root).replace('\\','/')
        if ext in archive_ext:
            archive_inventory.append({'path':rel,'size':size})
        is_candidate=(ext in text_ext or ext in binary_ext or bool(name_hint.search(name)))
        if not is_candidate: continue
        if size>max_bytes:
            skipped_large.append({'path':rel,'size':size,'extension':ext})
            continue
        candidates.append((path,rel,size,ext,ext in text_ext))

# Cap protects against unexpectedly huge installations while keeping a useful inventory.
candidates.sort(key=lambda x:(0 if x[4] else 1,x[2],x[1].lower()))
scan_candidates=candidates[:12000]

hits=[]; errors=[]; scanned=0

def clean_context(raw):
    s=''.join(chr(b) if 32 <= b < 127 else ' ' for b in raw)
    s=re.sub(r'\s+',' ',s).strip()
    s=re.sub(r'(?i)(token|ticket|session|password|passwd|secret|authorization)[=:]\s*[^\s,;}&\]]+',r'\1=<REDACTED>',s)
    s=re.sub(r'[A-Fa-f0-9]{48,}','<LONG_HEX>',s)
    s=re.sub(r'[A-Za-z0-9_\-]{80,}','<LONG_TOKEN>',s)
    return s[:700]

for path,rel,size,ext,is_text in scan_candidates:
    try:
        with open(path,'rb') as f:
            if size==0: scanned+=1; continue
            with mmap.mmap(f.fileno(),0,access=mmap.ACCESS_READ) as mm:
                file_hits=0
                # Generic secondary terms are useful in script/config files only;
                # binaries are searched only for the high-signal protocol literals.
                terms=needles if is_text else primary
                for needle in terms:
                    for enc,label in ((needle.encode('utf-8'),'ascii'),(needle.encode('utf-16le'),'utf16le')):
                        start=0; per_term=0
                        while per_term<6:
                            idx=mm.find(enc,start)
                            if idx<0: break
                            lo=max(0,idx-260); hi=min(size,idx+len(enc)+520)
                            ctx=clean_context(mm[lo:hi])
                            hits.append({'path':rel,'size':size,'extension':ext,'needle':needle,'encoding':label,'offset':idx,'context':ctx})
                            file_hits+=1; per_term+=1
                            start=idx+max(1,len(enc))
                            if len(hits)>=500: break
                        if len(hits)>=500: break
                    if len(hits)>=500: break
            scanned+=1
        if len(hits)>=500: break
    except Exception as e:
        if len(errors)<100: errors.append({'path':rel,'error':type(e).__name__+': '+str(e)[:220]})

files_with_hits=sorted(set(h['path'] for h in hits))
primary_hit_count=sum(1 for h in hits if h['needle'] in primary)
secondary_hit_count=len(hits)-primary_hit_count
out={
 'totalFilesSeen':total_files,
 'candidateFiles':len(candidates),
 'scannedFiles':scanned,
 'candidateCapApplied':len(candidates)>len(scan_candidates),
 'skippedLargeFiles':skipped_large[:500],
 'archiveInventory':archive_inventory[:1000],
 'hits':hits,
 'errors':errors,
 'summary':{
   'filesWithHits':len(files_with_hits),
   'hitFiles':files_with_hits,
   'totalHits':len(hits),
   'primaryHits':primary_hit_count,
   'secondaryHits':secondary_hit_count,
   'skippedLargeCount':len(skipped_large),
   'archiveCount':len(archive_inventory),
   'hitNeedles':sorted(set(h['needle'] for h in hits))
 }
}
with open(out_path,'w',encoding='utf-8') as f: json.dump(out,f,ensure_ascii=False,indent=2)
'@

try {
  Set-Content -LiteralPath $tmpPy -Value $python -Encoding UTF8
  $args=@(); $args += $pyPrefix; $args += @($tmpPy,$GameRoot,$tmpOut,[string]$MaxFileMB)
  & $pyCmd @args
  if($LASTEXITCODE -ne 0){throw "Python static scan exited with code $LASTEXITCODE"}
  if(-not (Test-Path -LiteralPath $tmpOut)){throw 'Static scan did not produce JSON.'}
  $probe=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
  $state.result=$probe
  $state.status='complete'
  $state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  $state.summary=[ordered]@{
    totalFilesSeen=[int]$probe.totalFilesSeen
    candidateFiles=[int]$probe.candidateFiles
    scannedFiles=[int]$probe.scannedFiles
    filesWithHits=[int]$probe.summary.filesWithHits
    totalHits=[int]$probe.summary.totalHits
    primaryHits=[int]$probe.summary.primaryHits
    secondaryHits=[int]$probe.summary.secondaryHits
    skippedLargeCount=[int]$probe.summary.skippedLargeCount
    archiveCount=[int]$probe.summary.archiveCount
    hitNeedles=@($probe.summary.hitNeedles)
    hitFiles=@($probe.summary.hitFiles)
  }
  Write-Json $state
  Write-Host "Complete. candidates=$($state.summary.candidateFiles) scanned=$($state.summary.scannedFiles) hits=$($state.summary.totalHits) primary=$($state.summary.primaryHits) skippedLarge=$($state.summary.skippedLargeCount)" -ForegroundColor Green
  Write-Host "Output: $OutputPath"
} finally {
  Remove-Item -LiteralPath $tmpPy,$tmpOut -Force -ErrorAction SilentlyContinue
}
