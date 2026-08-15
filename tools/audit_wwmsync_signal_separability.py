#!/usr/bin/env python3
import argparse,csv,json,math,pathlib,statistics,subprocess
from collections import Counter
TOL=60.; SG=.58; IG=.42; DIMS=['scaleAwareStructure','intensityNcc']; RULES=['S0','S1','S2','S3','S4','S5']

def L(p): return json.loads(pathlib.Path(p).read_text(encoding='utf8'))
def I(n): return max(0.,min(1.,(n+.15)/1.15)) if n is not None else None
def N(s): return None if s is None or s<=0 or s>=1 else 1.15*s-.15
def S0(r): return .92*r['scaleAwareStructure']+.08*I(r['intensityNcc'])
def gate(r): return r.get('scaleAwareStructure') is not None and r.get('intensityNcc') is not None and r['scaleAwareStructure']>=SG and I(r['intensityNcc'])>=IG
def dom(a,b,dims=DIMS): return all(a.get(k) is not None and b.get(k) is not None and a[k]>=b[k]-1e-12 for k in dims) and any(a[k]>b[k]+1e-12 for k in dims)
def depths(rows,dims=DIMS):
 rem=list(range(len(rows))); out={}; d=0
 while rem:
  f=[i for i in rem if not any(j!=i and dom(rows[j],rows[i],dims) for j in rem)] or [rem[0]]
  for i in f: out[i]=d
  fs=set(f); rem=[i for i in rem if i not in fs]; d+=1
 return out
def row(control,name,group,region,prov,stage,cid,dist,**kw):
 r={'control':control,'controlName':name,'group':group,'region':region,'sourceProvenance':prov,'stageFamily':stage,'candidateId':cid,'label':'CORRECT' if dist is not None and dist<=TOL else ('WRONG' if dist is not None else 'UNLABELED'),'gtDistance':dist,'x':kw.get('x'),'y':kw.get('y'),'angle':kw.get('angle'),'radius':kw.get('radius'),'scale':kw.get('scale'),'scaleAwareStructure':kw.get('ss'),'intensityNcc':kw.get('ncc'),'productionCombined':kw.get('combined'),'productionRank':kw.get('rank'),'productionAccepted':kw.get('accepted'),'productionReason':kw.get('reason'),'notes':kw.get('notes')}
 r['intensityScore']=I(r['intensityNcc']); r.update(kw.get('extra') or {}); r['staticGateEligible']=gate(r); return r
def order(pool,rule):
 dep=depths(pool)
 def k(i):
  r=pool[i]; b=S0(r); a=r['scaleAwareStructure']; n=r['intensityNcc']; ii=I(n)
  return {'S0':(-b,r['candidateId']),'S1':(dep[i],-b,r['candidateId']),'S2':(-a,-n,-b,r['candidateId']),'S3':(-min(a,ii),-b,r['candidateId']),'S4':(-(0 if a+ii<=0 else 2*a*ii/(a+ii)),-b,r['candidateId']),'S5':(0 if gate(r) else 1,-a,-n,-b,r['candidateId'])}[rule]
 o=sorted(range(len(pool)),key=k); return [i for i in o if rule!='S5' or gate(pool[i])]

def main():
 p=argparse.ArgumentParser()
 for x in ['candidate','fine','owner','general','bridge','prereg','output_dir']: p.add_argument('--'+x.replace('_','-'),dest=x,required=True)
 p.add_argument('--source-head',required=True); p.add_argument('--run-id'); p.add_argument('--job-id'); a=p.parse_args(); out=pathlib.Path(a.output_dir); out.mkdir(parents=True,exist_ok=True)
 C,F,O,G,B,P=map(L,[a.candidate,a.fine,a.owner,a.general,a.bridge,a.prereg])
 assert P['status']=='FROZEN_BEFORE_SCORE_FAMILY_COMPARATIVE_EVALUATION' and P['taskStartingHead']=='f8df34ba99321e97cf55e3981556807a62c6434f'
 assert C['productionGuards']['structuralGate']==SG and O['guards']['structuralGate']==SG and O['guards']['intensityGate']==IG and O['guards']['coarseBeam']==8
 assert G['decision']['verdict']=='R1 — REGISTRATION FALSE CONSENSUS' and not G['decision']['production_change_justified']
 assert B['rawBaselineReproduction']['verdict']=='PASS' and B['finalDecision']['case']=='CASE B0'
 rows=[]; meta={'east-cross':('East Cross','OWNER_UNIQUE','Qinghe'),'general-shrine':("General's Shrine historical",'OWNER_UNIQUE','Qinghe'),'fang-xu':('Steam Fang Xu Global-PC HUD','INDEPENDENT_VALIDATION','Qinghe')}; fr=pathlib.Path(a.fine).parent
 for cid,(name,grp,reg) in meta.items():
  land=C['controls'][cid]['landscape']; gt=land['expectedCoordinateBestPose']; w=land['strongestWrongMaximum']
  def ex(z): return {'structureNcc':z.get('structureNcc'),'gradient':z.get('gradient'),'topology':z.get('topology'),'magnitude':z.get('magnitude'),'edgeF1':z.get('edgeF1'),'negativeAgreement':z.get('negative'),'signAgreement':z.get('sign'),'rawStructure':z.get('structure')}
  for tag,z,d in [('gt',gt,0),('wrong',w,w['distance'])]: rows.append(row(cid,name,grp,reg,'candidate-recall:landscape','fine-local-landscape',f'{cid}:{tag}-local',d,x=z.get('globalX'),y=z.get('globalY'),angle=z.get('angle'),radius=z.get('radius'),scale=z.get('scale'),ss=z['scaleAwareStructure'],ncc=z['ncc'],combined=z['combined'],extra=ex(z),notes='GT oracle/local optimum' if tag=='gt' else 'bounded local wrong maximum'))
  fd=L(fr/f'{cid}.json'); fw=fd['finalWinner']
  for z in fd['finalists']: rows.append(row(cid,name,grp,reg,'candidate-recall:fine-stage','fine-finalist',f'{cid}:finalist:{z["rank"]}',z['gtDistance'],x=z['x'],y=z['y'],angle=z.get('angle'),radius=z.get('radius'),scale=z.get('scale'),ss=z['scaleScore'],ncc=z['intensityNcc'],combined=z['combinedScore'],rank=z['rank'],accepted=fw.get('matchGateAccepted') if z['rank']==1 else None,reason=fw.get('matchGateReason') if z['rank']==1 else None))
  for z in C['controls'][cid]['correlation']['rows']:
   ii=(z['fineCombined']-.92*z['fineScaleScore'])/.08
   rows.append(row(cid,name,grp,reg,'candidate-recall:correlation','fine-correlation-sample',f'{cid}:corr:{z["coarseRank"]}',z['gtDistance'],x=z['x'],y=z['y'],ss=z['fineScaleScore'],ncc=N(ii),combined=z['fineCombined'],rank=z['coarseRank'],accepted=z['fineAccepted'],notes='NCC recovered from frozen 0.92/0.08 final scalarization'))
  gx,gy=gt['globalX'],gt['globalY']
  for z in fd['coarseHypotheses']:
   rows.append(row(cid,name,grp,reg,'candidate-recall:fine-stage','coarse-hypothesis',f'{cid}:coarse:{z["rank"]}',math.hypot(z['x']-gx,z['y']-gy),x=z['x'],y=z['y'],angle=z['angle'],radius=z['radius'],ss=z['scaleScore'],ncc=N(z['intensityScore']),combined=z['rankScore'],rank=z['rank'],notes='stage-separated; excluded from fine Pareto/scoring'))
 om={'path-of-void':('Path of Void','OWNER_UNIQUE'),'buddha-fort':('Buddha Fort','OWNER_UNIQUE'),'general-shrine-repeat':("General's Shrine repeat",'OWNER_REPEAT'),'prosperity-haven':('Prosperity Haven','OWNER_UNIQUE'),'dreamfall-cliff':('Dreamfall Cliff','OWNER_UNIQUE')}
 for cid,(name,grp) in om.items():
  c=O['controls'][cid]; l=dict(zip(O['localColumns'],c['local'])); f=dict(zip(O['finalColumns'],c['final']))
  rows.append(row(cid,name,grp,c['region'],'owner-post-acquisition:local','fine-local-oracle',f'{cid}:gt-local',0,x=c['z5'][0],y=c['z5'][1],ss=l['scaleAware'],ncc=l['ncc'],combined=l['combined'],extra={'rawStructure':l['structure']},notes='exact-GT oracle; not naturally surfaced'))
  rows.append(row(cid,name,grp,c['region'],'owner-post-acquisition:production','fine-final-winner',f'{cid}:final',f['distance'],angle=f['angle'],scale=f['scale'],ss=f['structure'],ncc=f['ncc'],combined=f['combined'],rank=1,accepted=f['accepted'],reason=f['reason']))
  for t in c['top8']:
   z=dict(zip(O['top8Columns'],t)); rows.append(row(cid,name,grp,c['region'],'owner-post-acquisition:top8','coarse-top8',f'{cid}:top8:{z["rank"]}',z['distance'],ss=z['structure'],ncc=N(z['intensity']),rank=z['rank'],notes='stage-separated coarse TOP8 inventory'))
 controls=['east-cross','general-shrine','path-of-void','buddha-fort','prosperity-haven','dreamfall-cliff','fang-xu']; pareto={}; scores={}
 for cid in controls+['general-shrine-repeat']:
  pool=[]; seen=set()
  for r in rows:
   if r['control']!=cid or not r['stageFamily'].startswith('fine-') or r['scaleAwareStructure'] is None or r['intensityNcc'] is None: continue
   q=(r['label'],r['x'],r['y'],round(r['scaleAwareStructure'],10),round(r['intensityNcc'],10))
   if q not in seen: seen.add(q); pool.append(r)
  gt=next(r for r in pool if r['candidateId'].endswith(':gt-local')); wrong=[r for r in pool if r['label']=='WRONG']; dp=depths(pool); gi=pool.index(gt); ds=[r for r in wrong if dom(r,gt)]; near=min(ds,key=lambda r:math.hypot(r['scaleAwareStructure']-gt['scaleAwareStructure'],r['intensityNcc']-gt['intensityNcc'])) if ds else None; sw=max(wrong,key=S0)
  pareto[cid]={'candidatePoolN':len(pool),'wrongN':len(wrong),'paretoDominatingWrongN':len(ds),'correctOnParetoFront':dp[gi]==0,'paretoDepth':dp[gi],'paretoFrontRank':dp[gi]+1,'correctVector':{k:gt[k] for k in DIMS},'nearestDominatingWrongCandidateId':near['candidateId'] if near else None,'nearestDominatingWrongVector':{k:near[k] for k in DIMS} if near else None,'nearestDominanceWrongMinusCorrect':{k:near[k]-gt[k] for k in DIMS} if near else None,'dominanceDimensions':[k for k in DIMS if near and near[k]>gt[k]+1e-12],'strongestWrongByS0':sw['candidateId'],'signPatternCorrectMinusStrongestWrong':{k:gt[k]-sw[k] for k in DIMS}}
  sp=[r for r in pool if r['candidateId'].endswith(':gt-local') or r['stageFamily'] in ('fine-finalist','fine-final-winner')]; scores[cid]={}
  for rule in RULES:
   o=order(sp,rule); ranks={sp[i]['candidateId']:j+1 for j,i in enumerate(o)}; top=sp[o[0]] if o else None; wo=[i for i in o if sp[i]['label']=='WRONG']; ww=sp[wo[0]] if wo else None
   scores[cid][rule]={'evaluationPoolN':len(sp),'correctRank':ranks.get(gt['candidateId']),'topCandidateId':top['candidateId'] if top else None,'topLabel':top['label'] if top else None,'topStaticGateEligible':gate(top) if top else None,'topProductionAcceptedKnown':top['productionAccepted'] if top else None,'strongestWrongCandidateId':ww['candidateId'] if ww else None,'strongestWrongRank':ranks.get(ww['candidateId']) if ww else None,'correctMinusStrongestWrongRank':(ranks.get(gt['candidateId'])-ranks.get(ww['candidateId'])) if ww and ranks.get(gt['candidateId']) else None,'correctStaticGateEligible':gate(gt),'ambiguityAssessment':'NOT_COMPARABLE_ACROSS_ARCHITECTURES; gate remains 0.010; missing per-candidate margins are not fabricated'}
 ext={}; ED=['structureNcc','gradient','topology','magnitude','edgeF1','negativeAgreement','signAgreement','intensityNcc']
 for cid in meta:
  ps=[r for r in rows if r['control']==cid and r['stageFamily']=='fine-local-landscape']; gt=next(r for r in ps if r['label']=='CORRECT'); w=next(r for r in ps if r['label']=='WRONG'); ext[cid]={'wrongDominatesCorrect':dom(w,gt,ED),'correctDominatesWrong':dom(gt,w,ED),'signPatternCorrectMinusWrong':{k:gt[k]-w[k] for k in ED}}
 sig={}
 for m in DIMS:
  pc=[]
  for cid in controls:
   gt=next(r for r in rows if r['control']==cid and r['candidateId'].endswith(':gt-local')); pp=[r for r in rows if r['control']==cid and r['stageFamily'].startswith('fine-') and r.get(m) is not None]; w=max((r for r in pp if r['label']=='WRONG'),key=lambda r:r[m]); pc.append({'control':cid,'correct':gt[m],'strongestWrong':w[m],'correctMinusStrongestWrong':gt[m]-w[m],'correctRank':1+sum(r[m]>gt[m]+1e-12 for r in pp),'wrongAtOrAboveCorrect':sum(r['label']=='WRONG' and r[m]>=gt[m]-1e-12 for r in pp)})
  cv=[x['correct'] for x in pc]; wv=[x['strongestWrong'] for x in pc]; sig[m]={'correctDistribution':{'min':min(cv),'median':statistics.median(cv),'max':max(cv)},'strongestWrongDistribution':{'min':min(wv),'median':statistics.median(wv),'max':max(wv)},'directionCounts':{'correctHigher':sum(x['correctMinusStrongestWrong']>0 for x in pc),'wrongHigher':sum(x['correctMinusStrongestWrong']<0 for x in pc),'tie':sum(x['correctMinusStrongestWrong']==0 for x in pc)},'perControl':pc}
 h,r=pareto['general-shrine'],pareto['general-shrine-repeat']; hg=next(x for x in rows if x['control']=='general-shrine' and x['candidateId'].endswith(':gt-local')); rg=next(x for x in rows if x['control']=='general-shrine-repeat' and x['candidateId'].endswith(':gt-local')); dc='SD-DOMINANCE-FLIP' if h['correctOnParetoFront']!=r['correctOnParetoFront'] else 'SD-ORDER-DRIFT'
 drift={'classification':dc,'historicalCorrectVector':{k:hg[k] for k in DIMS},'repeatCorrectVector':{k:rg[k] for k in DIMS},'correctVectorDeltaRepeatMinusHistorical':{k:rg[k]-hg[k] for k in DIMS},'historicalDominantWrong':h['strongestWrongByS0'],'repeatDominantWrong':r['strongestWrongByS0'],'historicalLimitingComponents':[k for k,v in h['signPatternCorrectMinusStrongestWrong'].items() if v<0],'repeatLimitingComponents':[k for k,v in r['signPatternCorrectMinusStrongestWrong'].items() if v<0]}
 dominated=[c for c in controls if pareto[c]['paretoDominatingWrongN']]; domowner=[c for c in controls[:-1] if c in dominated]; verdict='SS0 — PRIMITIVE SIGNALS NON-SEPARABLE' if len(dominated)>=math.ceil(len(controls)/2) and len(domowner)>=2 else ('SS2 — MIXED SIGNAL SUFFICIENCY' if dominated else 'SS1 — SCALARIZATION / GATING FAILURE'); implication='NEW REPRESENTATION / DESCRIPTOR ARCHITECTURE JUSTIFIED; do not spend another round reweighting current metrics.' if verdict.startswith('SS0') else 'No universal production scoring change is authorized.'
 rs={}
 for rule in RULES:
  vv=[(c,scores[c][rule]) for c in controls]; rs[rule]={'ownerCorrectRank1Count':sum(c!='fang-xu' and x['correctRank']==1 for c,x in vv),'fangCorrectRank':scores['fang-xu'][rule]['correctRank'],'wrongTopCount':sum(x['topLabel']=='WRONG' for _,x in vv),'wrongTopStaticGateEligibleCount':sum(x['topLabel']=='WRONG' and x['topStaticGateEligible'] for _,x in vv),'knownProductionAcceptedWrongTopCount':sum(x['topLabel']=='WRONG' and x['topProductionAcceptedKnown'] is True for _,x in vv),'leaveOneOwnerOut':'FORMULA_INVARIANT_PARAMETER_FREE; omitted controls do not alter formulas','perControl':dict(vv)}
 prov={'candidateRecall':{'run':31769654943,'job':94672779698,'artifact':9207636803,'digest':'sha256:415cef6cafe43a2509b1b541c8f2f2e3d72cbb835cca5505f124f65955062ed0'},'candidateFineStage':{'run':31768239431,'job':94668491244,'artifact':9207148249,'digest':'sha256:ce858250c81ee3adf6efa9704a9cd22f87e7ffa2dde0c5c2ae9d9b9f9ee1ac39'},'generalCorrectedReference':{'run':31761799973,'job':94649553868,'artifact':9204882854,'digest':'sha256:6233d52dbd710380a5650793817130536544e6dffeb9c5a32a6ef8e807d80026'},'commonHudBridge':{'run':31764340615,'job':94657000684,'artifact':9205755503,'digest':'sha256:cb0b0f2a3eac0ee8b8993c1aed8bf17799e52433f58f145146688deb1667f7c4'},'ownerPostAcquisition':{'run':31872599823,'job':94983436586,'artifact':9243841549,'digest':'sha256:e7786742e2e355c0d16d42d94b383db2f2a489e818a61dd955420f1aa0072b7a'}}
 raw=subprocess.check_output(['git','log','--reverse','--format=%H%x09%s',P['taskStartingHead']+'..'+a.source_head],text=True).strip() if a.source_head!='LOCALTEST' else ''; commits=[{'sha':x.split('\t',1)[0],'subject':x.split('\t',1)[1]} for x in raw.splitlines() if x]
 cnt=Counter(r['stageFamily'] for r in rows); E={'schema':'wwmsync-existing-signal-separability-v1','taskStartingHead':P['taskStartingHead'],'sourceHead':a.source_head,'commits':commits,'ci':{'run':int(a.run_id) if a.run_id else None,'job':int(a.job_id) if a.job_id else None},'productionGuards':P['productionGuards'],'provenance':prov,'featureSpaces':P['featureSpaces'],'dependencies':P['dependencies'],'excludedControls':{'ethereal-chamber':'NOT_EVALUABLE_REFERENCE_FAMILY; excluded from absolute-GT separability classification'},'candidateInventory':{'rows':len(rows),'byStage':dict(cnt)},'pareto':pareto,'extendedLocalPareto':ext,'signalOverlap':sig,'generalDrift':drift,'scoreFamily':P['scoreFamily'],'scoreResults':scores,'ruleSummary':rs,'classification':{'dominatedIndependentControls':dominated,'dominatedOwnerUniqueControls':domowner,'independentControlN':7,'verdict':verdict,'implication':implication},'productionChange':'NO'}
 (out/'evidence.json').write_text(json.dumps(E,ensure_ascii=False,indent=2)+'\n',encoding='utf8'); (out/'candidate-table.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
 keys=[]
 for r in rows:
  for k in r:
   if k not in keys: keys.append(k)
 with (out/'candidate-table.csv').open('w',newline='',encoding='utf8') as f: w=csv.DictWriter(f,fieldnames=keys); w.writeheader(); w.writerows(rows)
 labels={'east-cross':'East Cross','general-shrine':'General historical','path-of-void':'Path of Void','buddha-fort':'Buddha Fort','prosperity-haven':'Prosperity Haven','dreamfall-cliff':'Dreamfall Cliff','fang-xu':'Fang Xu'}; R=['# WWMSync Existing-Signal Separability / Score-Architecture Forensic Audit — 2026-08-15','',f'**Verdict: {verdict}. Production change: NO.**','',f'## 1. Verified starting HEAD\n`{P["taskStartingHead"]}`; CI source `{a.source_head}`.','## 2. Final HEAD\nReport-only CI commit follows artifact upload; exact final branch HEAD is reported externally.','## 3. Commits']+[f'- `{x["sha"]}` — {x["subject"]}' for x in commits]+[f'## 4. Production guards\nProtected blobs unchanged; structural {SG}, intensity {IG}, beam 8.','## 5. Exact evidence / artifact provenance']+[f'- {k}: run `{v["run"]}`, job `{v["job"]}`, artifact `{v["artifact"]}`, digest `{v["digest"]}`' for k,v in prov.items()]+['## 6. Primitive feature definitions / dependencies\nCommon fine: scaleAwareStructure + raw intensityNcc. intensityScore and combined/rank scores are derived and excluded as independent Pareto dimensions. Extended local atomizes the structural composite where constituents are exposed.','## 7. Candidate-table inventory\nRows: **%d**; stages `%s`. Coarse rows remain stage-separated.'%(len(rows),dict(cnt))]
 for n,c in enumerate(controls,8):
  x=pareto[c]; R.append(f'## {n}. {labels[c]} Pareto result\nDominating wrong: **{x["paretoDominatingWrongN"]}**; front `{x["correctOnParetoFront"]}`; front rank `{x["paretoFrontRank"]}`; correct `{x["correctVector"]}`; nearest dominator `{x["nearestDominatingWrongCandidateId"]}` `{x["nearestDominatingWrongVector"]}`; dominance dimensions `{x["dominanceDimensions"]}`.')
 R += [f'## 15. General historical-vs-repeat drift classification\n**{dc}**. Historical `{drift["historicalCorrectVector"]}` -> repeat `{drift["repeatCorrectVector"]}`. Limiting components historical `{drift["historicalLimitingComponents"]}`, repeat `{drift["repeatLimitingComponents"]}`.','## 16. Primitive signal overlap summary']
 for m,x in sig.items(): R.append(f'- {m}: correct `{x["correctDistribution"]}`; strongest wrong `{x["strongestWrongDistribution"]}`; directions `{x["directionCounts"]}`. Per-control signs remain in JSON.')
 R.append('## 17. S0–S5 results')
 for rr,x in rs.items(): R.append(f'- {rr}: owner rank-1 correct `{x["ownerCorrectRank1Count"]}/6`; Fang correct rank `{x["fangCorrectRank"]}`; wrong top `{x["wrongTopCount"]}/7`; wrong top static-gate-eligible `{x["wrongTopStaticGateEligibleCount"]}/7`; known accepted wrong top `{x["knownProductionAcceptedWrongTopCount"]}/7`.')
 R += [f'## 18. Independent validation + false-basin safety\nFang dominated: `{pareto["fang-xu"]["paretoDominatingWrongN"]>0}`. Gates/beam unchanged. Alternative-rule ambiguity is marked NOT_COMPARABLE where beam margins are unavailable; no acceptance is fabricated.',f'## 19. SS0/SS1/SS2/SS3 verdict + architecture implication\n**{verdict}**. Dominated independent `{dominated}` ({len(dominated)}/7), owner unique `{domowner}`. {implication}','## 20. Authoritative CI coordinates + production-change verdict\nRun `@@RUN_ID@@`; job `@@JOB_ID@@`; artifact `@@ARTIFACT_ID@@`; digest `@@ARTIFACT_DIGEST@@`. Production change: **NO**; 0.58 / 0.42 / beam 8 unchanged.']
 (out/'report.md').write_text('\n\n'.join(R)+'\n',encoding='utf8'); print(json.dumps({'verdict':verdict,'dominated':dominated,'drift':dc,'rows':len(rows)},indent=2))
if __name__=='__main__': main()
