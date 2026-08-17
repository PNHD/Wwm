#!/usr/bin/env python3
import argparse, hashlib, json, pathlib, sys

p=argparse.ArgumentParser(); p.add_argument('--root',required=True); p.add_argument('--output',required=True); a=p.parse_args()
root=pathlib.Path(a.root); out=pathlib.Path(a.output); out.mkdir(parents=True,exist_ok=True)
files=sorted(root.rglob('candidate-run.json'))
runs=[]
for f in files:
    try: runs.append((f,json.loads(f.read_text())))
    except Exception as e: runs.append((f,{'status':'FAIL','verdictCandidate':'VF1','error':f'parse: {e}','controls':{}}))
result={'schema':'wwmsync-descriptor-v2-repeatability-v1','replicatesFound':len(runs),'requiredReplicates':3,'toleranceAbs':1e-6,'descriptorOutcomesInspected':False,'D1D4Opened':False,'RD':'PENDING','productionChange':'NO','replicates':[],'controlVariation':{},'verdict':None,'reasons':[]}
for f,r in runs: result['replicates'].append({'path':str(f),'replicate':r.get('replicate'),'status':r.get('status'),'head':r.get('head'),'runtime':r.get('runtime'),'reference':r.get('reference'),'error':r.get('error')})
if len(runs)!=3: result['reasons'].append(f'expected 3 replicates, found {len(runs)}')
if any(r.get('status')!='PASS' for _,r in runs):
    result['reasons'].append('one or more independent candidate replicates failed')
    result['verdict']='VF2' if any(r.get('verdictCandidate')=='VF2' for _,r in runs) else 'VF1'
else:
    heads={r['head'] for _,r in runs}; prereg={r.get('preregCommit') for _,r in runs}; blobs={r.get('preregBlobSha1') for _,r in runs}
    if len(heads)!=1: result['reasons'].append(f'code/input state head differs: {sorted(heads)}')
    if len(prereg)!=1 or len(blobs)!=1: result['reasons'].append('prereg identity differs across replicates')
    def rkey(r):
        rt=r['runtime']; b=rt['browser']; c=b['canvas']; rd=b['readback']
        return (rt['imageOS'],rt['imageVersion'],rt['chromeVersion'],rt['playwrightCoreVersion'],b['userAgent'],b['devicePixelRatio'],c['alpha'],c['imageSmoothingEnabled'],c['imageSmoothingQuality'],rd['constructor'],rd.get('colorSpace'),rd.get('pixelFormat'))
    runtime_keys={rkey(r) for _,r in runs}
    if len(runtime_keys)!=1: result['reasons'].append('canonical browser runtime differs across replicates')
    refs={json.dumps(r['reference'],sort_keys=True) for _,r in runs}
    if len(refs)!=1: result['reasons'].append('reference lineage/manifest differs across replicates')
    controls=[set(r['controls']) for _,r in runs]
    if any(s!=controls[0] for s in controls[1:]): result['reasons'].append('control population differs across replicates')
    common=sorted(set.intersection(*controls)) if controls else []
    geom_fields=['x','y','angle','radius','scale','gtDistancePx']; d0_fields=['scaleAwareStructure','intensityNcc','productionCombined']
    global_max={k:0.0 for k in geom_fields+d0_fields}
    for cid in common:
        cs=[r['controls'][cid] for _,r in runs]; cv={'inputHashesEqual':True,'gtGeometryEqual':True,'top8IdsOrderEqual':True,'maxAbsVariation':{k:0.0 for k in geom_fields+d0_fields}}
        input_keys=[(c['input']['sourceSha256'],c['input']['workCanvasPngSha256'],c['input']['workCanvasRgba8Sha256'],c['input']['workCanvasRgb8Sha256']) for c in cs]
        if len(set(input_keys))!=1: cv['inputHashesEqual']=False; result['reasons'].append(f'{cid}: input hashes differ')
        gt_geom=[tuple(c['gt'][k] for k in ['x','y','angle','radius','scale']) for c in cs]
        if len(set(gt_geom))!=1: cv['gtGeometryEqual']=False; result['reasons'].append(f'{cid}: GT geometry differs')
        ids=[[z['candidateId'] for z in c['top8']] for c in cs]
        if any(len(x)!=8 for x in ids): result['reasons'].append(f'{cid}: final TOP-8 population incomplete')
        if len({tuple(x) for x in ids})!=1: cv['top8IdsOrderEqual']=False; result['reasons'].append(f'{cid}: candidate IDs/order differ')
        def observe(vals,field,label):
            nums=[float(v[field]) for v in vals]; delta=max(nums)-min(nums); cv['maxAbsVariation'][field]=max(cv['maxAbsVariation'][field],delta); global_max[field]=max(global_max[field],delta)
            if delta>1e-6: result['reasons'].append(f'{cid}: {label} {field} variation {delta:.17g} exceeds 1e-6')
        for k in geom_fields+d0_fields: observe([c['gt'] for c in cs],k,'GT')
        for rank in range(min(len(c['top8']) for c in cs)):
            vals=[c['top8'][rank] for c in cs]
            for k in geom_fields+d0_fields: observe(vals,k,f'rank {rank+1}')
        result['controlVariation'][cid]=cv
    result['maxAbsVariation']=global_max
    result['verdict']='VF0' if not result['reasons'] else 'VF1'

(out/'repeatability-evidence.json').write_text(json.dumps(result,indent=2)+'\n')
if result['verdict']=='VF0':
    base=runs[0][1]
    payload={'schema':'wwmsync-descriptor-v2-candidate-freeze-payload-v1','verdict':'VF0','candidateRunHead':base['head'],'preregCommit':base['preregCommit'],'preregBlobSha1':base['preregBlobSha1'],'runtime':base['runtime'],'reference':base['reference'],'controls':base['controls'],'repeatability':result,'descriptorOutcomesInspected':False,'D1D4Opened':False,'RD':'PENDING','productionChange':'NO'}
    payload_text=json.dumps(payload,indent=2)+'\n'; (out/'candidate-freeze-payload.json').write_text(payload_text)
    (out/'candidate-freeze-payload.sha256').write_text(hashlib.sha256(payload_text.encode()).hexdigest()+'  candidate-freeze-payload.json\n')
print(json.dumps({'verdict':result['verdict'],'reasons':result['reasons'],'maxAbsVariation':result.get('maxAbsVariation')}))
sys.exit(0 if result['verdict']=='VF0' else 1)
