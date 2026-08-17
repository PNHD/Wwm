#!/usr/bin/env python3
import argparse, json, math, pathlib, statistics, sys

ap=argparse.ArgumentParser();ap.add_argument('--root',required=True);ap.add_argument('--freeze',required=True);ap.add_argument('--prereg',required=True);ap.add_argument('--original-prereg',required=True);ap.add_argument('--output',required=True);args=ap.parse_args()
root=pathlib.Path(args.root);out=pathlib.Path(args.output);out.mkdir(parents=True,exist_ok=True)
freeze=json.load(open(args.freeze));v2=json.load(open(args.prereg));old=json.load(open(args.original_prereg))
owner=v2['controls']['ownerUnique'];repeat=v2['controls']['sameLocationDrift'];fang=v2['controls']['independentValidation'];required=owner+[repeat,fang]
files={}
for p in root.rglob('*.json'):
    try:d=json.load(open(p))
    except Exception:continue
    if d.get('schema')=='wwmsync-descriptor-v2-control-outcome-v1': files[d['controlId']]=d
missing=[c for c in required if c not in files]
if missing: raise SystemExit('missing control outputs: '+','.join(missing))
for cid,d in files.items():
    assert d['status']=='PASS',(cid,d.get('error'))
    assert d['candidateIds']==[freeze['controls'][cid]['gt']['candidateId']]+[x['candidateId'] for x in freeze['controls'][cid]['top8']]
    assert d['conformance']['ok'] is True and d['runtime']['contract']['poseCount']==81 and d['runtime']['contract']['D5'] is False


def finite(v): return isinstance(v,(int,float)) and math.isfinite(v)
def drift_class(h,r):
    if finite(h) and finite(r) and h>0 and r>0: return 'DR-STABLE' if abs(h-r)<=old['drift']['materialMarginChangeAbs'] else 'DR-PARTIAL'
    if finite(h) and finite(r) and h<0 and r<0: return 'DR-WRONG-STABLE'
    return 'DR-FLIP'

def stage_summary(desc,stage):
    margins={cid:files[cid]['descriptors'][desc][stage]['margin'] for cid in owner}
    positive=[cid for cid,v in margins.items() if finite(v) and v>0];ties=[cid for cid,v in margins.items() if finite(v) and v==0];negative=[cid for cid,v in margins.items() if finite(v) and v<0]
    vals=[v for v in margins.values() if finite(v)]
    q=[cid for cid in positive if freeze['controls'][cid]['region']=='Qinghe'];k=[cid for cid in positive if freeze['controls'][cid]['region']=='Kaifeng']
    return {'margins':margins,'positiveCount':len(positive),'ties':len(ties),'negativeCount':len(negative),'positiveControls':positive,'qinghePositiveCount':len(q),'kaifengPositiveCount':len(k),'medianMargin':statistics.median(vals) if vals else None,'worstMargin':min(vals) if vals else None}

summary={'schema':'wwmsync-descriptor-v2-final-evidence-v1','status':'PASS','startingLiveHead':'ddabe5f40670eae7286e98d17eebf6ceca17adb0','head':None,'vf0':{'verdict':freeze['verdict'],'candidateRunHead':freeze['candidateRunHead'],'preregCommit':freeze['preregCommit'],'preregBlobSha1':freeze['preregBlobSha1']},'productionChange':'NO','implementationConformance':{},'controls':files,'descriptors':{},'localSurvivors':[],'retrieval':{'status':'PENDING'},'stress40Frame':{'status':'PENDING'},'RD':'PENDING'}
heads={d['head'] for d in files.values()};summary['head']=next(iter(heads)) if len(heads)==1 else sorted(heads)
for cid,d in files.items(): summary['implementationConformance'][cid]=d['conformance']

for desc in ['D1','D2','D3','D4']:
    locked=stage_summary(desc,'locked');pose=stage_summary(desc,'pose81')
    hL=files['general-shrine']['descriptors'][desc]['locked']['margin'];rL=files[repeat]['descriptors'][desc]['locked']['margin'];hP=files['general-shrine']['descriptors'][desc]['pose81']['margin'];rP=files[repeat]['descriptors'][desc]['pose81']['margin']
    drift={'locked':{'historicalMargin':hL,'repeatMargin':rL,'class':drift_class(hL,rL)},'pose81':{'historicalMargin':hP,'repeatMargin':rP,'class':drift_class(hP,rP)}}
    fangL=files[fang]['descriptors'][desc]['locked'];fangP=files[fang]['descriptors'][desc]['pose81'];fang_ok=bool(fangL['positive'] and fangP['positive'])
    clauses={
      'ownerLockedAtLeast4of6':locked['positiveCount']>=4,
      'ownerPose81AtLeast4of6':pose['positiveCount']>=4,
      'lockedIncludesQingheAndKaifeng':locked['qinghePositiveCount']>=1 and locked['kaifengPositiveCount']>=1,
      'pose81IncludesQingheAndKaifeng':pose['qinghePositiveCount']>=1 and pose['kaifengPositiveCount']>=1,
      'fangLockedPreferred':bool(fangL['positive']),
      'fangPose81Preferred':bool(fangP['positive']),
      'generalLockedDriftSafe':drift['locked']['class'] in ('DR-STABLE','DR-PARTIAL'),
      'generalPose81DriftSafe':drift['pose81']['class'] in ('DR-STABLE','DR-PARTIAL'),
      'productionGatesOrBeamChanged':False,
      'descriptorDependentCandidateSelection':False
    }
    local_pass=all(v for k,v in clauses.items() if k not in ('productionGatesOrBeamChanged','descriptorDependentCandidateSelection')) and not clauses['productionGatesOrBeamChanged'] and not clauses['descriptorDependentCandidateSelection']
    entry={'lockedOwner':locked,'pose81Owner':pose,'generalDrift':drift,'fang':{'locked':fangL,'pose81':fangP,'bothPreferred':fang_ok},'survivorClauses':clauses,'localSurvivor':local_pass}
    summary['descriptors'][desc]=entry
    if local_pass: summary['localSurvivors'].append(desc)

if summary['localSurvivors']:
    summary['status']='RETRIEVAL_REQUIRED';summary['retrieval']={'status':'REQUIRED','descriptors':summary['localSurvivors'],'reason':'local survivor clauses passed; exact prereg retrieval proxy must execute'};summary['stress40Frame']={'status':'BLOCKED_ON_RETRIEVAL'};summary['RD']='PENDING_RETRIEVAL'
else:
    summary['retrieval']={'status':'SKIPPED_NO_LOCAL_SURVIVORS','descriptors':[]};summary['stress40Frame']={'status':'SKIPPED_NO_RETRIEVAL_SAFE_SURVIVORS','fixtureSha256':old['stress40Frame']['sha256']}
    material=[]
    for d,e in summary['descriptors'].items():
        if max(e['lockedOwner']['positiveCount'],e['pose81Owner']['positiveCount'])>=4 or e['fang']['bothPreferred']: material.append(d)
    if material:
        summary['RD']='V2-RD2';summary['rdReason']='Partial representation rescue exists, but no descriptor passes the complete common local survivor protocol.';summary['materialSubsetDescriptors']=material
    else:
        summary['RD']='V2-RD0';summary['rdReason']='D1-D4 do not create a common safe separation and no descriptor reaches the preregistered material subset proxy.';summary['materialSubsetDescriptors']=[]

json.dump(summary,open(out/'descriptor-v2-final-evidence.json','w'),indent=2,sort_keys=True);open(out/'descriptor-v2-final-evidence.json','a').write('\n')
lines=['# WWMSync Descriptor Audit V2 — Final Evidence','',f"Status: **{summary['status']}**",f"V2 RD: **{summary['RD']}**",f"Production change: **NO**",'',f"VF0: {summary['vf0']['verdict']}",'','## Descriptor summary','', '| Descriptor | Locked owner +/6 | 81-pose owner +/6 | Fang locked/81 | General drift locked/81 | Local survivor |','|---|---:|---:|---|---|---|']
for d,e in summary['descriptors'].items():
    lines.append(f"| {d} | {e['lockedOwner']['positiveCount']}/6 | {e['pose81Owner']['positiveCount']}/6 | {e['fang']['locked']['positive']}/{e['fang']['pose81']['positive']} | {e['generalDrift']['locked']['class']} / {e['generalDrift']['pose81']['class']} | {e['localSurvivor']} |")
lines+=['','## Survivor clauses','']
for d,e in summary['descriptors'].items():
    lines.append(f"### {d}")
    for k,v in e['survivorClauses'].items(): lines.append(f"- {k}: {v}")
    lines.append('')
lines+=['## Conditional phases','',f"Retrieval: {summary['retrieval']['status']}",f"40-frame stress: {summary['stress40Frame']['status']}",'', '## Architecture implication','']
if summary['RD']=='V2-RD0': lines.append('Stop handcrafted structural descriptor iteration. A learned known-GT representation audit is justified. No production task is justified.')
elif summary['RD']=='V2-RD2': lines.append('Representation failure is heterogeneous. A separately preregistered fusion or learned domain-invariant representation audit is justified. No production task is justified.')
else: lines.append('Pending conditional retrieval safety before any final architecture implication.')
open(out/'descriptor-v2-final-report.md','w').write('\n'.join(lines)+'\n')
print(json.dumps({'status':summary['status'],'RD':summary['RD'],'localSurvivors':summary['localSurvivors']}))
if summary['localSurvivors']: sys.exit(2)
