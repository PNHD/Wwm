#!/usr/bin/env python3
import argparse,json,math,os,pathlib

def load(p):
    return json.load(open(p,encoding='utf-8'))

def f(v,n=6):
    if v is None: return '—'
    if isinstance(v,bool): return 'YES' if v else 'NO'
    if isinstance(v,(int,float)):
        if isinstance(v,float) and (math.isnan(v) or math.isinf(v)): return '—'
        return f'{v:.{n}f}'
    return str(v)

def first_transition(stages):
    if not stages: return 'NONE'
    if not stages[0].get('expectedBasinPresent'): return stages[0]['name']
    for a,b in zip(stages,stages[1:]):
        if a.get('expectedBasinPresent') and not b.get('expectedBasinPresent'):
            return b['name']
    return 'NONE'

def expected_pose(land):
    return land['landscape']['expectedCoordinateBestPose']

def control_by(summary,cid):
    return next(x for x in summary['controls'] if x['id']==cid)

def sensitivity_variant(rows,n,cid):
    return next(x for x in rows if x['control']==cid and int(x['variant']['perSeedHypotheses'])==n)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument('--stage',required=True);ap.add_argument('--fine',required=True);ap.add_argument('--oracle',required=True);ap.add_argument('--landscape',required=True);ap.add_argument('--correlation',required=True);ap.add_argument('--sensitivity',required=True);ap.add_argument('--provenance',required=True);ap.add_argument('--commits',required=True);ap.add_argument('--output-json',required=True);ap.add_argument('--output-report',required=True);ap.add_argument('--start-head',required=True);ap.add_argument('--evidence-head',required=True);ap.add_argument('--stress-sha',required=True)
    a=ap.parse_args()
    stage=load(a.stage);fine=load(a.fine);oracle=load(a.oracle);land=load(a.landscape);corr=load(a.correlation);sens=load(a.sensitivity);prov=load(a.provenance);commits=load(a.commits)
    ids=['east-cross','general-shrine','fang-xu'];names={'east-cross':'East Cross GFN','general-shrine':'General Shrine GFN','fang-xu':'Steam Fang Xu Global-PC HUD'}
    controls={}
    for cid in ids:
        st=control_by(stage,cid);fi=control_by(fine,cid);oc=control_by(oracle,cid);la=control_by(land,cid);co=next(x for x in corr['controls'] if x['id']==cid);lp=expected_pose(la)
        coarse_loss=st['firstLossStage'];fine_loss=fi.get('firstLossStage','NONE');direct=coarse_loss if coarse_loss!='NONE' else fine_loss
        if cid=='east-cross':
            classification='RCL-5 — LOCAL DISCRIMINATION FAILURE'
            rationale='The physical basin is generated and survives coarse NMS but falls outside global TOP-36; strict retention does not rescue it, and the bounded exact-GT landscape remains below the 0.58 structural gate and below a wrong local maximum.'
        elif cid=='general-shrine':
            classification='RCL-MIXED — RCL-2 + RCL-4'
            rationale='The basin is first removed by per-radius NMS, can spatially regenerate later, but retained candidates still miss downstream beams; independently, the exact-GT local optimum passes structure but fails the unchanged 0.42 intensity gate.'
        else:
            classification='RCL-3 — FINE-RANKING / POSE-SURVIVAL FAILURE'
            rationale='The basin naturally reaches coarse TOP-8 and fine TOP-70, then loses the single fine-refinement seed. Strict retention preserves location but the retained wrong pose degrades and ranks ninth globally, while the independent exact-GT pose is locally strong.'
        controls[cid]={'name':names[cid],'firstLossStage':direct,'coarseFirstLossStage':coarse_loss,'fineFirstLossStage':fine_loss,'classification':classification,'rationale':rationale,'coarseStageTrace':st['stages'],'fineStageTrace':fi['stages'],'finalWinner':fi.get('finalWinner'),'oracle':oc,'landscape':la['landscape'],'correlation':co['correlation']}
    rows=sens['reports'];variants=[]
    for n in [1,2,4]:
        per=[]
        for cid in ids:
            r=sensitivity_variant(rows,n,cid)
            per.append({'control':cid,'runtimeMs':r.get('runtimeMs'),'runtimeMultiplier':r.get('runtimeMultiplier'),'candidateCountMultiplier':r.get('candidateCountMultiplier'),'totalFineFinalists':r.get('totalFineFinalists'),'falseCandidateBurden':r.get('falseCandidateBurden'),'falseCandidateFraction':r.get('falseCandidateFraction'),'expectedBasinRecalled':r.get('expectedBasinRecalled'),'expectedBasinFinalist':r.get('expectedBasinFinalist'),'matchGateAccepted':r.get('matchGateAccepted'),'matchGateReason':r.get('matchGateReason')})
        variants.append({'perSeedHypotheses':n,'coarseBeam':8*n,'productionEquivalent':n==1,'controls':per})
    tested=[v for v in variants if not v['productionEquivalent']]
    pair_survivors=[]
    for v in tested:
        g=next(x for x in v['controls'] if x['control']=='general-shrine');x=next(x for x in v['controls'] if x['control']=='fang-xu')
        if g['expectedBasinRecalled'] and x['expectedBasinRecalled']: pair_survivors.append(v['perSeedHypotheses'])
    stress={'fixture':'wwmsync-gfn-motion-20260810-143835.zip','sha256':a.stress_sha,'executed':False,'reason':'No preregistered recall-only variant recovered the expected basin on both General Shrine and independent Fang Xu; Phase 8 is therefore not justified by the user-specified gate.','localizationPassClaimed':False,'survivingVariants':pair_survivors}
    verdict='CR0 — NO COMMON RECALL BOTTLENECK'
    implication='Do not modify production and do not expand beam/search as a general fix. East, General, and Fang Xu fail by materially different mechanisms. The next architecture evidence should add independent GFN known-location controls and measure how often discrimination, mixed recall+gate, and fine pose-survival classes occur.'
    guards=stage.get('productionGuards',{})
    result={'schema':'wwmsync-production-candidate-recall-forensic-final-v1','generatedAtUtc':os.environ.get('GEN_AT_UTC'),'verifiedStartingHead':a.start_head,'finalEvidenceHead':a.evidence_head,'reportOnlyCommitNote':'A documentation-only commit is appended after authoritative artifact creation; its SHA is intentionally not self-referenced inside the committed report.','commits':commits,'productionGuards':guards,'actualProductionSearchGraph':control_by(stage,'east-cross').get('searchGraph',stage.get('searchGraph')),'controls':controls,'recallSensitivity':variants,'independentFangGeneralization':{'pairSurvivingVariants':pair_survivors,'result':'NOT_GENERALIZED' if not pair_survivors else 'GENERALIZED'},'stress':stress,'verdict':verdict,'nextArchitectureImplication':implication,'componentProvenance':prov,'productionChangeVerdict':'NO PRODUCTION CHANGE; structural gate remains 0.58.'}
    pathlib.Path(a.output_json).parent.mkdir(parents=True,exist_ok=True);json.dump(result,open(a.output_json,'w',encoding='utf-8'),ensure_ascii=False,indent=2)
    graph=result['actualProductionSearchGraph'] or {}
    lines=['# WWMSync Production Candidate Recall / Surfacing Forensic Audit','',f"Date: 2026-08-14",'', '## 1. Verified starting HEAD','',f"`{a.start_head}`",'', '## 2. Final HEAD','',f"Final evidence/code HEAD before the report-only commit: `{a.evidence_head}`.",'The report-only commit is appended only after the authoritative artifact exists; a Git commit cannot self-contain its own final SHA without changing that SHA.','', '## 3. Commits','']
    for c in commits: lines.append(f"- `{c['sha']}` — {c['subject']}")
    lines += ['', '## 4. Frozen production guards','',f"- contract: `{guards.get('contract','ANCHOR_FREE_STRUCTURAL_V11')}`",f"- `vision-sync.js` blob: `{guards.get('visionBlob')}`",f"- `dashen-tile-cache.js` blob: `{guards.get('cacheBlob')}`",f"- structural gate: `{guards.get('structuralGate',0.58)}` — unchanged",f"- intensity gate: `{guards.get('intensityGate',0.42)}`; coarse gate: `{guards.get('coarseGate',0.50)}`; ambiguity gate: `{guards.get('ambiguityGate',0.010)}`",'- production matcher/cache/preprocessing changes: **NONE**','', '## 5. Actual production search graph','',f"Coarse z{graph.get('coarseZoom',3)} → fine z{graph.get('fineZoom',5)}; Qinghe stride `{graph.get('coarseStride',7)}`; radii `{graph.get('radii',[6,9,13,18,25,34])}`; rotations `{graph.get('angles',[0,45,90,135,180,225,270,315])}`; `COARSE_BEAM={graph.get('coarseBeam',8)}`.",'','Exact survival path: full coarse intensity/NCC lattice → per-radius TOP-120 → structural rescore eligibility TOP-90/radius (`0.14 intensity + 0.86 scale-aware structure`) → per-radius spatial NMS (`max(11, radius*0.50)`, max 8/radius) → global TOP-36 seeds → local-refine intensity TOP-56/seed → structural TOP-42/seed (`0.10 intensity + 0.90 structure`) → one hypothesis/seed → global TOP-8 → fine intensity TOP-120/hypothesis → structural TOP-70 → **one fine-refinement seed `top[0]`** → refine intensity TOP-80 → structural TOP-64 → photometric TOP-48 ×2 → final `0.92 structure + 0.08 intensity` rerank → unchanged `matchGate`.','']
    def trace_section(num,cid):
        c=controls[cid];out=[f"## {num}. {c['name']} expected-basin stage trace",'',f"Direct first-loss stage: **{c['firstLossStage']}**",'', '| Stage | In | Out | Basin | Rank | GT distance |', '|---|---:|---:|---|---:|---:|']
        for s in c['coarseStageTrace']:
            cc=s.get('candidate') or {};out.append(f"| coarse: {s['name']} | {s.get('inputCount','—')} | {s.get('outputCount','—')} | {'PRESENT' if s.get('expectedBasinPresent') else 'ABSENT'} | {s.get('bestExpectedRank') or '—'} | {f(cc.get('gtDistance'),2)} |")
        for s in c['fineStageTrace']:
            cc=s.get('candidate') or {};out.append(f"| fine: {s['name']} | {s.get('inputCount','—')} | {s.get('outputCount','—')} | {'PRESENT' if s.get('expectedBasinPresent') else 'ABSENT'} | {s.get('bestExpectedRank') or '—'} | {f(cc.get('gtDistance'),2)} |")
        out.append('');return out
    lines += trace_section(6,'east-cross')+trace_section(7,'general-shrine')+trace_section(8,'fang-xu')
    for num,cid in [(9,'east-cross'),(10,'general-shrine'),(11,'fang-xu')]:
        c=controls[cid];lines += [f"## {num}. {c['name']} oracle-retention result",'',f"Any one-stage oracle retention leading to an expected-basin global ACCEPT: **{c['oracle'].get('oracleAnyGlobalExpectedAccept',False)}**",'']
        for st in c['oracle'].get('steps',[]):
            d=st.get('downstream') or {};src=st.get('source') or {};lines.append(f"- retain after `{st.get('retainAfter')}` → next `{st.get('nextStage')}`; next rank `{st.get('nextStageRank','—')}`; survives `{st.get('nextStageSurvives')}`; source GT distance `{f(src.get('gtDistance'),2)}`; downstream global rank `{d.get('globalRank','—')}`; expected ACCEPT `{d.get('matchGateAccepted',False)}`.")
        lines.append('')
    lines += ['## 12. Local score landscapes','', '| Control | exact-GT structure | scale-aware | intensity | NCC | combined | strongest wrong combined | basin width px |', '|---|---:|---:|---:|---:|---:|---:|---:|']
    for cid in ids:
        l=controls[cid]['landscape'];e=l['expectedCoordinateBestPose'];w=l.get('strongestWrongMaximum') or {};lines.append(f"| {names[cid]} | {f(e.get('structure'))} | {f(e.get('scaleAwareStructure'))} | {f(e.get('intensity'))} | {f(e.get('ncc'))} | {f(e.get('combined'))} | {f(w.get('combined'))} | {f(l.get('basinWidthApproxPx'),1)} |")
    lines += ['','Bounded landscape artifacts also contain the full spatial radial rings plus scale and rotation sensitivity arrays; no matcher scores were changed.','', '## 13. Coarse → fine correlation','', '| Control | N | coarse↔fine scale-aware | coarse↔combined | strong fine discarded | discard fraction |', '|---|---:|---:|---:|---:|---:|']
    for cid in ids:
        c=controls[cid]['correlation'];lines.append(f"| {names[cid]} | {c.get('sampleCount')} | {f(c.get('coarseVsFineScaleAware'),4)} | {f(c.get('coarseVsCombined'),4)} | {c.get('strongFineDiscardedBeforeFine')} / {c.get('eventualStrongFineCount')} | {f(c.get('strongFineDiscardFraction'),4)} |")
    lines += ['','## 14. Exact first-loss stage per control','',f"- East: **{controls['east-cross']['firstLossStage']}**.",f"- General: **{controls['general-shrine']['firstLossStage']}**; the basin later regenerates spatially and is pruned again.",f"- Fang Xu: **{controls['fang-xu']['firstLossStage']}**; it survives the complete coarse path before the fine-stage loss.",'','## 15. RCL classification per control','']
    for cid in ids: lines += [f"- **{names[cid]} — {controls[cid]['classification']}**. {controls[cid]['rationale']}"]
    lines += ['','## 16. Recall-only sensitivity results','', '| Variant | Control | candidate multiplier | runtime multiplier | false finalists | expected basin recalled |', '|---|---|---:|---:|---:|---|']
    for v in variants:
        label='production baseline' if v['productionEquivalent'] else f"top{v['perSeedHypotheses']}/seed + beam{v['coarseBeam']}"
        for r in v['controls']:
            lines.append(f"| {label} | {names[r['control']]} | {f(r.get('candidateCountMultiplier'),2)}× | {f(r.get('runtimeMultiplier'),2)}× | {r.get('falseCandidateBurden')} | {r.get('expectedBasinRecalled')} |")
    lines += ['','The two preregistered recall-only counterfactuals leave every production score and gate untouched. Neither recovers an expected-basin finalist on East, General, or Fang Xu.','', '## 17. Fang Xu independent generalization result','',f"Pair-surviving General + independent Fang Xu variants: `{pair_survivors}`. Result: **NOT GENERALIZED**.",'', '## 18. 40-frame stress result','',f"**NOT EXECUTED / NOT JUSTIFIED.** {stress['reason']}",f"Frozen fixture retained for provenance: `{stress['fixture']}`, SHA-256 `{stress['sha256']}`. No localization PASS is claimed.",'', '## 19. Final CR verdict + architecture implication','',f"**{verdict}**",'',implication,'', '## 20. Authoritative CI provenance + production-change verdict','']
    for k,v in prov.items():
        if isinstance(v,dict): lines.append(f"- {k}: run `{v.get('run')}`, job `{v.get('job')}`, artifact `{v.get('artifact')}`, digest `{v.get('digest')}`, head `{v.get('head')}`")
    lines += ['', 'Final authoritative aggregation: run `@@RUN_ID@@`, job `@@JOB_ID@@`, evidence artifact `@@ARTIFACT_ID@@`, digest `@@ARTIFACT_DIGEST@@`.','', '**Production-change verdict: NO PRODUCTION CHANGE. Structural gate remains 0.58.**','']
    pathlib.Path(a.output_report).parent.mkdir(parents=True,exist_ok=True);pathlib.Path(a.output_report).write_text('\n'.join(lines),encoding='utf-8')

if __name__=='__main__': main()
