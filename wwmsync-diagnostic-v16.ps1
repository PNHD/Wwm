[CmdletBinding()]
param(
  [string]$GameRoot = 'E:\wwm\wwm_lite',
  [string]$OutputPath = (Join-Path $env:USERPROFILE 'Downloads\wwmsync-diagnostic-v16.json')
)

$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'

function Write-Json($Object) {
  $parent=Split-Path -Parent $OutputPath
  if($parent -and -not (Test-Path $parent)){New-Item -ItemType Directory -Force -Path $parent | Out-Null}
  $Object | ConvertTo-Json -Depth 24 | Set-Content -LiteralPath $OutputPath -Encoding UTF8
}

if(-not (Test-Path -LiteralPath $GameRoot -PathType Container)){throw "Game root not found: $GameRoot"}
$patchDir=Join-Path $GameRoot 'LocalData\Patch'
if(-not (Test-Path -LiteralPath $patchDir -PathType Container)){throw "Patch directory not found: $patchDir"}

$pyCmd=$null; $pyPrefix=@()
if(Get-Command py -ErrorAction SilentlyContinue){$pyCmd=(Get-Command py).Source;$pyPrefix=@('-3')}
elseif(Get-Command python -ErrorAction SilentlyContinue){$pyCmd=(Get-Command python).Source}
elseif(Get-Command python3 -ErrorAction SilentlyContinue){$pyCmd=(Get-Command python3).Source}
if(-not $pyCmd){throw 'Python 3 is required for v16.'}

$state=[ordered]@{
  schema='wwmsync-native-diagnostic-v16'
  status='running'
  generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  gameRoot=$GameRoot
  safety=[ordered]@{
    staticFileRead=$true; sqliteReadOnly=$true; sqliteQueryOnly=$true;
    archiveContentWrite=$false; extractionWrite=$false;
    memoryRead=$false; processHandleRead=$false; injection=$false;
    packetCapture=$false; activeNetworkProbe=$false;
    pipeConnect=$false; pipeWrite=$false; credentialCollection=$false;
    registryWrite=$false; gameFileWrite=$false; databaseWrite=$false
  }
  result=$null
  summary=$null
}
Write-Json $state
Write-Host 'WWMSync LuaText archive/index diagnostic v16 (READ-ONLY)' -ForegroundColor Cyan

$tmpPy=Join-Path $env:TEMP ('wwmsync-v16-' + [guid]::NewGuid().ToString('N') + '.py')
$tmpOut=Join-Path $env:TEMP ('wwmsync-v16-' + [guid]::NewGuid().ToString('N') + '.json')
$python=@'
import glob, json, os, re, sqlite3, struct, sys

root, patch_dir, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

def rel(p): return os.path.relpath(p,root).replace('\\','/')
def head_hex(p,n=64):
    try:
        with open(p,'rb') as f:return f.read(n).hex().upper()
    except Exception:return None

def scan_markers(path):
    markers={b'LuaT':[],b'EZST':[],b'ZZZ4':[],bytes.fromhex('28B52FFD'):[]}
    carry=b''; base=0; total=0
    with open(path,'rb') as f:
        while True:
            chunk=f.read(4*1024*1024)
            if not chunk: break
            data=carry+chunk
            data_base=base-len(carry)
            for key in markers:
                start=0
                while True:
                    i=data.find(key,start)
                    if i<0:break
                    off=data_base+i
                    if not markers[key] or markers[key][-1]!=off:
                        markers[key].append(off)
                    start=i+1
            carry=data[-16:]
            base+=len(chunk); total+=len(chunk)
    return total, {'LuaT':markers[b'LuaT'],'EZST':markers[b'EZST'],'ZZZ4':markers[b'ZZZ4'],'ZSTD':markers[bytes.fromhex('28B52FFD')]}

def parse_info(path,mpk_size):
    b=open(path,'rb').read()
    if len(b)<8:return {'path':rel(path),'error':'too_short'}
    ver,count=struct.unpack_from('<II',b,0)
    exact=(len(b)==8+count*20+16)
    max_entries=min(count,max(0,(len(b)-8)//20))
    recs=[]
    fields=[[] for _ in range(5)]
    for i in range(max_entries):
        vals=struct.unpack_from('<IIIII',b,8+i*20)
        for k,v in enumerate(vals): fields[k].append(v)
        if i<12: recs.append({'index':i,'u32':list(vals)})
    heur=[]
    for k,vals in enumerate(fields):
        if not vals: continue
        mono=sum(1 for a,c in zip(vals,vals[1:]) if c>=a)/max(1,len(vals)-1)
        within=sum(1 for v in vals if v<=mpk_size)/len(vals) if mpk_size else 0
        zero=sum(1 for v in vals if v==0)/len(vals)
        heur.append({'field':k,'min':min(vals),'max':max(vals),'unique':len(set(vals)),'nondecreasingRatio':round(mono,6),'withinMpkRatio':round(within,6),'zeroRatio':round(zero,6)})
    return {'path':rel(path),'size':len(b),'version':ver,'entryCount':count,'exact20ByteLayoutPlus16Footer':exact,'firstRecords':recs,'fieldHeuristics':heur,'footerHex':b[-16:].hex().upper() if len(b)>=16 else None}

def analyze_record_boundaries(path, lua_offsets):
    out={'tested':0,'lengthPlus4MatchesNext':0,'lengthMatchesNext':0,'samples':[]}
    if len(lua_offsets)<1:return out
    with open(path,'rb') as f:
        starts=[x-7 for x in lua_offsets if x>=7]
        for i,s in enumerate(starts[:200]):
            if s<0:continue
            f.seek(s); h=f.read(20)
            if len(h)<4:continue
            length=struct.unpack_from('<I',h,0)[0]
            nxt=starts[i+1] if i+1<len(starts) else None
            m4=(nxt is not None and s+4+length==nxt)
            m0=(nxt is not None and s+length==nxt)
            out['tested']+=1
            out['lengthPlus4MatchesNext']+=1 if m4 else 0
            out['lengthMatchesNext']+=1 if m0 else 0
            if len(out['samples'])<12:
                out['samples'].append({'entryStart':s,'luaTOffset':s+7,'lengthU32':length,'nextEntryStart':nxt,'headHex':h.hex().upper(),'plus4Match':m4,'directMatch':m0})
    return out

lt_infos=sorted(glob.glob(os.path.join(patch_dir,'LT*.mpkinfo')),key=lambda p:int(re.search(r'LT(\d+)',os.path.basename(p),re.I).group(1)))
lt_pairs=[]; total_luat=0; total_index=0; exact_layout=0; boundary_plus4=0; boundary_direct=0; boundary_tested=0
for info in lt_infos:
    stem=os.path.splitext(info)[0]
    mpk=stem+'.mpk'
    mpk_size=os.path.getsize(mpk) if os.path.exists(mpk) else 0
    info_data=parse_info(info,mpk_size)
    marker_data=None; boundary=None
    if os.path.exists(mpk):
        size,markers=scan_markers(mpk)
        marker_data={'size':size,'counts':{k:len(v) for k,v in markers.items()},'firstOffsets':{k:v[:40] for k,v in markers.items()}}
        boundary=analyze_record_boundaries(mpk,markers['LuaT'])
        total_luat+=len(markers['LuaT'])
        boundary_plus4+=boundary['lengthPlus4MatchesNext']; boundary_direct+=boundary['lengthMatchesNext']; boundary_tested+=boundary['tested']
    total_index+=int(info_data.get('entryCount') or 0)
    if info_data.get('exact20ByteLayoutPlus16Footer'):exact_layout+=1
    lt_pairs.append({'mpk':rel(mpk) if os.path.exists(mpk) else None,'mpkHeadHex':head_hex(mpk,64) if os.path.exists(mpk) else None,'mpkinfo':info_data,'markers':marker_data,'boundaryProbe':boundary})

# Read-only SQLite metadata/index inspection.
db_path=os.path.join(patch_dir,'Patch.mpkdb')
db={'exists':os.path.exists(db_path),'tables':[],'targetRows':[],'queryOnly':None}
if os.path.exists(db_path):
    uri='file:'+db_path.replace('\\','/')+'?mode=ro'
    con=sqlite3.connect(uri,uri=True)
    try:
        con.execute('PRAGMA query_only=ON')
        db['queryOnly']=bool(con.execute('PRAGMA query_only').fetchone()[0])
        tables=[r[0] for r in con.execute("select name from sqlite_master where type='table' and name not like 'sqlite_%' order by name")]
        needles=['lua','luatext','script','lt1','lt11','lt21','.lua','client','remote','rpc','notify','friend','sync','map']
        for t in tables:
            cols=con.execute('pragma table_info("'+t.replace('"','""')+'")').fetchall()
            try: count=con.execute('select count(*) from "'+t.replace('"','""')+'"').fetchone()[0]
            except Exception: count=None
            meta={'name':t,'rowCount':count,'columns':[{'name':c[1],'type':c[2],'pk':c[5]} for c in cols]}
            db['tables'].append(meta)
            text_cols=[c[1] for c in cols if (c[2] or '').upper() in ('TEXT','VARCHAR','CHAR','CLOB','')]
            for col in text_cols[:10]:
                qcol='"'+col.replace('"','""')+'"'; qt='"'+t.replace('"','""')+'"'
                for needle in needles:
                    if len(db['targetRows'])>=300:break
                    try:
                        rows=con.execute(f"select rowid,{qcol} from {qt} where lower(cast({qcol} as text)) like ? limit 8",('%'+needle+'%',)).fetchall()
                    except Exception: rows=[]
                    for rowid,val in rows:
                        s=str(val)
                        if len(s)>220:s=s[:220]
                        rec={'table':t,'column':col,'needle':needle,'rowid':rowid,'value':s}
                        if rec not in db['targetRows']:db['targetRows'].append(rec)
    finally: con.close()

extras=[]
for name in ['Other/lua_zstd.dict','LuaText/patch/patch_patcher.lua','Other/lua_config.json']:
    p=os.path.join(patch_dir,*name.split('/'))
    if os.path.exists(p):extras.append({'path':rel(p),'size':os.path.getsize(p),'headHex':head_hex(p,96)})

out={
 'ltPairs':lt_pairs,
 'patchDb':db,
 'extras':extras,
 'summary':{
   'ltPairCount':len(lt_pairs),
   'exactIndexLayoutCount':exact_layout,
   'totalIndexedEntries':total_index,
   'totalLuaTMarkers':total_luat,
   'luaTToIndexRatio':round(total_luat/total_index,6) if total_index else None,
   'boundaryTests':boundary_tested,
   'lengthPlus4BoundaryMatches':boundary_plus4,
   'lengthDirectBoundaryMatches':boundary_direct,
   'patchDbTableCount':len(db['tables']),
   'patchDbTargetRowCount':len(db['targetRows']),
   'patchDbQueryOnly':db['queryOnly']
 }
}
with open(out_path,'w',encoding='utf-8') as f:json.dump(out,f,ensure_ascii=False,indent=2)
'@

try {
  Set-Content -LiteralPath $tmpPy -Value $python -Encoding UTF8
  $args=@();$args+=$pyPrefix;$args+=@($tmpPy,$GameRoot,$patchDir,$tmpOut)
  & $pyCmd @args
  if($LASTEXITCODE -ne 0){throw "Python v16 exited with code $LASTEXITCODE"}
  $probe=Get-Content -LiteralPath $tmpOut -Raw | ConvertFrom-Json
  $state.result=$probe
  $state.status='complete'
  $state.generatedAtUtc=[DateTime]::UtcNow.ToString('o')
  $state.summary=$probe.summary
  Write-Json $state
  Write-Host "Complete. LT pairs=$($state.summary.ltPairCount) indexed=$($state.summary.totalIndexedEntries) LuaT=$($state.summary.totalLuaTMarkers) DB tables=$($state.summary.patchDbTableCount)" -ForegroundColor Green
  Write-Host "Output: $OutputPath"
} finally {
  Remove-Item -LiteralPath $tmpPy,$tmpOut -Force -ErrorAction SilentlyContinue
}
