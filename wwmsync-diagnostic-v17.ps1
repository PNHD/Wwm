[CmdletBinding()]
param(
  [string]$GameRoot = 'E:\wwm\wwm_lite',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v17.json')
)

$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'

# WWMSync native diagnostic v17
# PURPOSE: use LT*.mpkinfo active records to scan only active LuaText entries.
# READ-ONLY: static file reads only. No process memory, injection, packet capture,
# pipe/network access, credential collection, extraction, or game-file writes.

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if($parent -and -not (Test-Path $parent)){New-Item -ItemType Directory -Force -Path $parent | Out-Null}
  $Object | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

if(-not (Test-Path -LiteralPath $GameRoot -PathType Container)){throw "Game root not found: $GameRoot"}
$patch=Join-Path $GameRoot 'LocalData\Patch'
if(-not (Test-Path -LiteralPath $patch -PathType Container)){throw "Patch directory not found: $patch"}

$py=$null;$prefix=@()
if(Get-Command py -ErrorAction SilentlyContinue){$py=(Get-Command py).Source;$prefix=@('-3')}
elseif(Get-Command python -ErrorAction SilentlyContinue){$py=(Get-Command python).Source}
elseif(Get-Command python3 -ErrorAction SilentlyContinue){$py=(Get-Command python3).Source}
if(-not $py){throw 'Python 3 is required.'}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v17'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  gameRoot=$GameRoot
  safety=[ordered]@{
    staticFileRead=$true; indexedEntryRead=$true;
    extractionWrite=$false; memoryRead=$false; processHandleRead=$false;
    injection=$false; packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false;
    registryWrite=$false; gameFileWrite=$false; databaseWrite=$false
  }
  result=$null
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync active LuaText index scan v17 (READ-ONLY)' -ForegroundColor Cyan

$tmpPy=Join-Path $env:TEMP ('wwmsync-v17-'+[Guid]::NewGuid().ToString('N')+'.py')
$tmpOut=Join-Path $env:TEMP ('wwmsync-v17-'+[Guid]::NewGuid().ToString('N')+'.json')
$code=@'
import glob, json, os, re, struct, sys
patch,out_path=sys.argv[1],sys.argv[2]

primary=[
 'start_game_sync','call_client_method','invokeClientMethod','client_method',
 'connectionKey','relayServerId','waiting_for_approval','game_sync',
 'wwmmapsync','gamePosition','GET_GAME_STATE'
]
secondary=[
 'remote_method','remoteMethod','remote_call','remoteCall','invoke_client',
 'client_rpc','clientRpc','server_to_client','serverToClient','rpc_callback',
 'rpcCallback','confirm_request','permission_request','client_notify',
 'clientNotify','notification_request','friend_message','friendMessage',
 'WebSocket','websocket','wss://','game_state','gameState','position',
 'relay','approval','permission','notify','notification'
]
needles=primary+secondary
path_words=re.compile(r'(?i)(rpc|sync|relay|client|server|network|net/|web|socket|friend|notify|message|map|sdk|protocol|remote|game_state|position)')

def printable_strings(b,minlen=6):
    out=[]
    for m in re.finditer(rb'[\x20-\x7e]{%d,}'%minlen,b):
        s=m.group().decode('ascii','replace')
        if len(s)>240:s=s[:240]
        out.append(s)
        if len(out)>=24:break
    return out

def context_for(b,idx,n):
    lo=max(0,idx-180);hi=min(len(b),idx+n+360)
    raw=b[lo:hi]
    s=''.join(chr(x) if 32<=x<127 else ' ' for x in raw)
    s=re.sub(r'\s+',' ',s).strip()
    s=re.sub(r'(?i)(token|ticket|session|password|passwd|secret|authorization)[=:]\s*[^\s,;}&\]]+',r'\1=<REDACTED>',s)
    s=re.sub(r'[A-Fa-f0-9]{48,}','<LONG_HEX>',s)
    s=re.sub(r'[A-Za-z0-9_\-]{80,}','<LONG_TOKEN>',s)
    return s[:700]

pairs=[]; hits=[]; suspicious=[]; errors=[]
total_active=0; in_bounds=0; luat7=0; luat_near=0; scanned_bytes=0
pack_ids=set(); first_heads=[]

for info_path in sorted(glob.glob(os.path.join(patch,'LT*.mpkinfo'))):
    mpk_path=info_path[:-4]  # strip 'info'
    if not os.path.isfile(mpk_path):continue
    name=os.path.basename(mpk_path)
    try:
        info=open(info_path,'rb').read()
        if len(info)<8:continue
        ver,count=struct.unpack_from('<II',info,0)
        exact=(len(info)==8+count*20+16)
        if not exact:
            pairs.append({'mpk':name,'version':ver,'entryCount':count,'exactLayout':False})
            continue
        records=[struct.unpack_from('<IIIII',info,8+i*20) for i in range(count)]
        size=os.path.getsize(mpk_path)
        p_active=0;p_bounds=0;p_luat7=0;p_near=0;p_hits=0;p_susp=0
        with open(mpk_path,'rb') as f:
            for idx,(h0,h1,off,length,packid) in enumerate(records):
                total_active+=1;p_active+=1;pack_ids.add(packid)
                if off>size or length>size or off+length>size:
                    if len(errors)<100:errors.append({'mpk':name,'index':idx,'error':'record-out-of-bounds','offset':off,'length':length,'mpkSize':size})
                    continue
                in_bounds+=1;p_bounds+=1
                f.seek(off); data=f.read(length)
                scanned_bytes+=len(data)
                if len(data)>=11 and data[7:11]==b'LuaT':
                    luat7+=1;p_luat7+=1
                elif b'LuaT' in data[:32]:
                    luat_near+=1;p_near+=1
                head=data[:768]
                strings=printable_strings(head)
                pathish=[s for s in strings if path_words.search(s)]
                if pathish and len(suspicious)<600:
                    suspicious.append({'mpk':name,'index':idx,'offset':off,'length':length,'packId':packid,'hash0':h0,'hash1':h1,'strings':pathish[:8]})
                    p_susp+=1
                if len(first_heads)<40:
                    first_heads.append({'mpk':name,'index':idx,'offset':off,'length':length,'packId':packid,'headHex':data[:48].hex().upper(),'strings':strings[:8]})
                for needle in needles:
                    nb=needle.encode('ascii')
                    start=0; per=0
                    while per<4:
                        pos=data.find(nb,start)
                        if pos<0:break
                        hits.append({'mpk':name,'index':idx,'offset':off,'length':length,'packId':packid,'hash0':h0,'hash1':h1,'needle':needle,'entryOffset':pos,'context':context_for(data,pos,len(nb))})
                        p_hits+=1;per+=1;start=pos+len(nb)
                        if len(hits)>=1200:break
                    if len(hits)>=1200:break
                if len(hits)>=1200:break
        pairs.append({'mpk':name,'version':ver,'entryCount':count,'exactLayout':True,'mpkSize':size,'inBounds':p_bounds,'luaTAtPlus7':p_luat7,'luaTNearHead':p_near,'hitCount':p_hits,'suspiciousHeadCount':p_susp})
        if len(hits)>=1200:break
    except Exception as e:
        if len(errors)<100:errors.append({'mpk':name,'error':type(e).__name__+': '+str(e)[:300]})

primary_hits=sum(1 for h in hits if h['needle'] in primary)
secondary_hits=len(hits)-primary_hits
hit_entries=len(set((h['mpk'],h['index']) for h in hits))
out={
 'pairs':pairs,
 'hits':hits,
 'suspiciousHeads':suspicious,
 'sampleHeads':first_heads,
 'errors':errors,
 'summary':{
   'ltPairCount':len(pairs),
   'activeEntries':total_active,
   'inBoundsEntries':in_bounds,
   'luaTAtPlus7Entries':luat7,
   'luaTNearHeadEntries':luat_near,
   'luaTAtPlus7Ratio':round(luat7/in_bounds,6) if in_bounds else 0,
   'scannedEntryBytes':scanned_bytes,
   'hitCount':len(hits),
   'hitEntryCount':hit_entries,
   'primaryHitCount':primary_hits,
   'secondaryHitCount':secondary_hits,
   'hitNeedles':sorted(set(h['needle'] for h in hits)),
   'suspiciousHeadCount':len(suspicious),
   'packIds':sorted(pack_ids),
   'errorCount':len(errors)
 }
}
with open(out_path,'w',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
'@

try {
  Set-Content -LiteralPath $tmpPy -Value $code -Encoding UTF8
  $args=@();$args+=$prefix;$args+=@($tmpPy,$patch,$tmpOut)
  & $py @args
  if($LASTEXITCODE -ne 0){throw "Python scan exited with code $LASTEXITCODE"}
  $probe=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
  $state.result=$probe
  $state.status='complete'
  $state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  $state.summary=$probe.summary
  Write-Json $state
  Write-Host "Complete. active=$($state.summary.activeEntries) inBounds=$($state.summary.inBoundsEntries) LuaT+7=$($state.summary.luaTAtPlus7Entries) hits=$($state.summary.hitCount) primary=$($state.summary.primaryHitCount)" -ForegroundColor Green
  Write-Host "Output: $OutputPath"
} finally {
  Remove-Item -LiteralPath $tmpPy,$tmpOut -Force -ErrorAction SilentlyContinue
}
