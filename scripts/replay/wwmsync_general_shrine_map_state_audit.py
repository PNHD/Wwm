#!/usr/bin/env python3
"""Replay/CI-only General Shrine map-state/reference discrepancy audit.

Bounded to SIFT + classical registration/structure diagnostics against already-pinned
owner and first-party/reference controls. Never imports or edits production matcher,
cache, preprocessing, or the production 0.58 structural gate.
"""
from __future__ import annotations
import argparse, hashlib, json, math
from pathlib import Path
from typing import Any
import cv2
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as sk_ssim

GT_WORLD=[-1966.7646484375,-3002.78784179687]
GT_Z5=np.array([6015.017126148705,3889.360588972433],np.float64)
GT_Z3=GT_Z5/4.0
PRODUCTION_GATE=0.58
FIXTURE_SHA='73e275661e94a843807c5cae3c526e4fe23e5d4b7800104364bd36cc1d05bbba'
FULLMAP_SHA='7a4e3c0443a6d56df62dc2a709af9d41396ab76b22d3e9e8d7cc466cd8bb2404'
OLD_SCREEN=np.array([1140.736,248.544],np.float64)
ORIG_BOX=np.array([526.,77.,1755.,615.],np.float64)
ORIG_ANCHOR_LOCAL=np.array([615.3446327683616,176.3050847457627],np.float64)
RECON_BOX=np.array([526.,77.,1755.,611.],np.float64)

def sha(p:Path)->str:
 h=hashlib.sha256();h.update(p.read_bytes());return h.hexdigest()
def read(p:Path,gray=False):
 a=np.fromfile(str(p),np.uint8);im=cv2.imdecode(a,cv2.IMREAD_GRAYSCALE if gray else cv2.IMREAD_COLOR)
 if im is None: raise RuntimeError(f'cannot decode {p}')
 return im
def fixture_anchor(screen:np.ndarray,box:np.ndarray,dims=(320.,140.))->np.ndarray:
 return np.array([(screen[0]-box[0])/(box[2]-box[0])*dims[0],(screen[1]-box[1])/(box[3]-box[1])*dims[1]],np.float64)
def alt_screen()->np.ndarray:return ORIG_BOX[:2]+ORIG_ANCHOR_LOCAL

def assemble(cache:Path,family:str,z:int):
 d=cache/family/str(z); fs=list(d.glob('*.png'))
 if not fs:return None
 xy=[tuple(map(int,p.stem.split('_'))) for p in fs]; xs=[x for x,y in xy];ys=[y for x,y in xy]
 x0,x1,y0,y1=min(xs),max(xs),min(ys),max(ys); tile=256
 out=np.zeros(((y1-y0+1)*tile,(x1-x0+1)*tile,3),np.uint8); present=np.zeros(out.shape[:2],np.uint8)
 for p,(x,y) in zip(fs,xy):
  im=read(p); h,w=im.shape[:2]; yy=(y-y0)*tile;xx=(x-x0)*tile;out[yy:yy+h,xx:xx+w]=im;present[yy:yy+h,xx:xx+w]=255
 return {'image':out,'mask':present,'origin':np.array([x0*tile,y0*tile],np.float64),'tile_range':[x0,x1,y0,y1],'files':len(fs)}
def local(view,gt,r):
 im=view['image'];ms=view['mask'];q=gt-view['origin'];x,y=q
 x0=max(0,int(round(x-r)));y0=max(0,int(round(y-r)));x1=min(im.shape[1],int(round(x+r)));y1=min(im.shape[0],int(round(y+r)))
 return im[y0:y1,x0:x1].copy(),ms[y0:y1,x0:x1].copy(),view['origin']+np.array([x0,y0],float)

def sift_pairs(a,b,ratio=.75,mutual=False,nfeatures=8000):
 ga=cv2.cvtColor(a,cv2.COLOR_BGR2GRAY) if a.ndim==3 else a; gb=cv2.cvtColor(b,cv2.COLOR_BGR2GRAY) if b.ndim==3 else b
 s=cv2.SIFT_create(nfeatures=nfeatures,contrastThreshold=.015,edgeThreshold=12)
 ka,da=s.detectAndCompute(ga,None); kb,db=s.detectAndCompute(gb,None)
 if da is None or db is None:return ka,kb,np.empty((0,2),np.float32),np.empty((0,2),np.float32),0
 bf=cv2.BFMatcher(cv2.NORM_L2); ab=bf.knnMatch(da,db,k=2); good=[m for m,n in ab if m.distance<ratio*n.distance]
 if mutual:
  ba=bf.knnMatch(db,da,k=2); back={(m.queryIdx,m.trainIdx) for m,n in ba if m.distance<ratio*n.distance}
  good=[m for m in good if (m.trainIdx,m.queryIdx) in back]
 pa=np.float32([ka[m.queryIdx].pt for m in good]);pb=np.float32([kb[m.trainIdx].pt for m in good])
 return ka,kb,pa,pb,len(good)

def apply(T,p):
 p=np.asarray(p,float).reshape(-1,2)
 if T.shape==(2,3):return p@T[:,:2].T+T[:,2]
 q=np.c_[p,np.ones(len(p))]@T.T;return q[:,:2]/q[:,2:3]
def jacobian(T,p):
 if T.shape==(2,3):return T[:,:2]
 x,y=map(float,p);h=T;d=h[2,0]*x+h[2,1]*y+h[2,2];nx=h[0,0]*x+h[0,1]*y+h[0,2];ny=h[1,0]*x+h[1,1]*y+h[1,2]
 return np.array([[(h[0,0]*d-nx*h[2,0])/d**2,(h[0,1]*d-nx*h[2,1])/d**2],[(h[1,0]*d-ny*h[2,0])/d**2,(h[1,1]*d-ny*h[2,1])/d**2]],float)
def fit(kind,pa,pb,anchor=None,dst_origin=None,gt=None,src_shape=None,dst_shape=None):
 if len(pa)<4:return {'model':kind,'ok':False,'reason':'insufficient_matches','matches':len(pa)}
 if kind=='similarity':T,mask=cv2.estimateAffinePartial2D(pa,pb,method=cv2.RANSAC,ransacReprojThreshold=4,maxIters=10000,confidence=.999,refineIters=20)
 elif kind=='affine':T,mask=cv2.estimateAffine2D(pa,pb,method=cv2.RANSAC,ransacReprojThreshold=4,maxIters=10000,confidence=.999,refineIters=20)
 else:T,mask=cv2.findHomography(pa,pb,cv2.RANSAC,4,maxIters=10000,confidence=.999)
 if T is None or mask is None:return {'model':kind,'ok':False,'reason':'fit_failed','matches':len(pa)}
 ins=mask.ravel().astype(bool);n=int(ins.sum());pred=apply(T,pa[ins]);err=np.linalg.norm(pred-pb[ins],axis=1)
 cent=np.mean(pa[ins],axis=0) if n else np.array([0.,0.]);J=jacobian(T,cent);sv=np.linalg.svd(J,compute_uv=False);det=float(np.linalg.det(J));cond=float(sv[0]/max(sv[-1],1e-12));rot=float(math.degrees(math.atan2(J[1,0],J[0,0])))
 def hullfrac(pts,shape):
  if shape is None or len(pts)<3:return 0.
  return float(cv2.contourArea(cv2.convexHull(pts.astype(np.float32)))/(shape[0]*shape[1]))
 quads=0
 if src_shape and n:
  h,w=src_shape[:2];q=((pa[ins,0]>=w/2).astype(int)+2*(pa[ins,1]>=h/2).astype(int));quads=len(set(q.tolist()))
 proj=float(np.linalg.norm(T[2,:2])) if T.shape==(3,3) else 0.
 plausible=bool(n>=6 and cond<6 and abs(det)>1e-5 and det>0 and (kind!='homography' or proj<.02))
 out={'model':kind,'ok':True,'matches':len(pa),'inliers':n,'inlier_ratio':n/max(1,len(pa)),'median_reprojection_error':float(np.median(err)) if n else None,'condition':cond,'determinant':det,'singular_values':sv.tolist(),'rotation_deg':rot,'projective_norm':proj,'source_hull_fraction':hullfrac(pa[ins],src_shape),'dest_hull_fraction':hullfrac(pb[ins],dst_shape),'source_quadrants':quads,'physically_plausible':plausible,'transform':np.asarray(T).tolist()}
 if anchor is not None:
  m=apply(T,np.array(anchor).reshape(1,2))[0];out['mapped_anchor_local']=m.tolist()
  if dst_origin is not None:
   mg=m+np.asarray(dst_origin);out['mapped_anchor_global']=mg.tolist()
   if gt is not None:out['anchor_residual']=float(np.linalg.norm(mg-np.asarray(gt)))
 return out

def models(a,b,anchor=None,dst_origin=None,gt=None,mutual=False):
 ka,kb,pa,pb,n=sift_pairs(a,b,mutual=mutual)
 return {'source_features':len(ka),'dest_features':len(kb),'ratio_matches':n,'mutual':mutual,'models':[fit(k,pa,pb,anchor,dst_origin,gt,a.shape,b.shape) for k in ['similarity','affine','homography']]}
def best_model(diag):
 ok=[m for m in diag['models'] if m.get('ok') and m.get('physically_plausible')]
 if not ok:return None
 return sorted(ok,key=lambda x:(x.get('anchor_residual',1e99),-x['inliers'],x['condition']))[0]
def warp_metrics(src,dst,T):
 if T is None:return None
 h,w=dst.shape[:2];ones=np.full(src.shape[:2],255,np.uint8)
 if np.asarray(T).shape==(2,3):wi=cv2.warpAffine(src,np.asarray(T,float),(w,h));wm=cv2.warpAffine(ones,np.asarray(T,float),(w,h))
 else:wi=cv2.warpPerspective(src,np.asarray(T,float),(w,h));wm=cv2.warpPerspective(ones,np.asarray(T,float),(w,h))
 mask=wm>200
 if mask.sum()<1000:return None
 a=cv2.cvtColor(wi,cv2.COLOR_BGR2GRAY).astype(float);b=cv2.cvtColor(dst,cv2.COLOR_BGR2GRAY).astype(float);va=a[mask];vb=b[mask];ncc=float(np.corrcoef(va,vb)[0,1]) if va.std()>1e-6 and vb.std()>1e-6 else 0.
 ys,xs=np.where(mask);x0,x1=xs.min(),xs.max()+1;y0,y1=ys.min(),ys.max()+1;aa=a[y0:y1,x0:x1].astype(np.uint8);bb=b[y0:y1,x0:x1].astype(np.uint8);mm=mask[y0:y1,x0:x1]
 aa2=aa.copy();bb2=bb.copy();fill=int(np.median(bb[mm]));aa2[~mm]=fill;bb2[~mm]=fill
 ss=float(sk_ssim(aa2,bb2,data_range=255))
 ea=cv2.Canny(aa,50,120);eb=cv2.Canny(bb,50,120);dt=cv2.distanceTransform((eb==0).astype(np.uint8),cv2.DIST_L2,3);edge=float((dt[(ea>0)&mm]<=2).mean()) if np.any((ea>0)&mm) else 0.
 return {'overlap_pixels':int(mask.sum()),'ncc':ncc,'ssim':ss,'edge_agreement_2px':edge}
def run_local(owner,view,gt,anchor,z):
 rows=[]
 for r in ([96,128,160,192,256,384,512] if z==5 else [64,96,128,160,192,256,384]):
  crop,mask,origin=local(view,gt,r)
  if crop.shape[0]<100 or crop.shape[1]<100:continue
  d=models(owner,crop,anchor,origin,gt,False);dm=models(owner,crop,anchor,origin,gt,True)
  for label,x in [('ratio',d),('mutual',dm)]:
   bm=best_model(x);met=None
   if bm:met=warp_metrics(owner,crop,np.asarray(bm['transform']))
   rows.append({'radius':r,'check':label,'origin':origin.tolist(),'diagnostic':x,'best':bm,'appearance':met})
 return rows
def choose(rows):
 cand=[]
 for row in rows:
  b=row['best']
  if b:cand.append((b.get('anchor_residual',1e99),-b['inliers'],b['condition'],row))
 return sorted(cand,key=lambda x:x[:3])[0][3] if cand else None

def main(args):
 out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
 owner=read(Path(args.owner_map)); assert sha(Path(args.owner_map))==FIXTURE_SHA
 control=read(Path(args.fullmap_source)); assert sha(Path(args.fullmap_source))==FULLMAP_SHA
 prior=json.loads(Path(args.prior_audit).read_text());prov=json.loads(Path(args.owner_provenance).read_text());ctrlmeta=json.loads(Path(args.fullmap_meta).read_text());reftruth=json.loads(Path(args.reference_truth).read_text());rev=json.loads(Path(args.revision_probe).read_text())
 fixed=fixture_anchor(OLD_SCREEN,RECON_BOX);alt_s=alt_screen();alt=fixture_anchor(alt_s,ORIG_BOX)
 anchor_a=np.array(ctrlmeta['independentRegistration']['expectedPointInSource'],float)
 views={}
 for fam in ['main','sub4']:
  for z in [3,5]:
   v=assemble(Path(args.reference_cache),fam,z)
   if v:views[f'{fam}_z{z}']=v
 z5=views['main_z5'];z3=views['main_z3']
 local_fixed={5:run_local(owner,z5,GT_Z5,fixed,5),3:run_local(owner,z3,GT_Z3,fixed,3)}
 local_alt={5:run_local(owner,z5,GT_Z5,alt,5),3:run_local(owner,z3,GT_Z3,alt,3)}
 best_fixed={z:choose(local_fixed[z]) for z in [3,5]};best_alt={z:choose(local_alt[z]) for z in [3,5]}
 ac=models(control,z3['image'],anchor_a,z3['origin'],GT_Z3,False);acm=models(control,z3['image'],anchor_a,z3['origin'],GT_Z3,True)
 ab=models(control,owner,anchor_a,np.array([0.,0.]),fixed,False);abm=models(control,owner,anchor_a,np.array([0.,0.]),fixed,True)
 acb=best_model(acm) or best_model(ac);abb=best_model(abm) or best_model(ab)
 old=prior['locations']['general_shrine']['feature_registration_raw'];oldT=np.array(old['transform'],float);J=jacobian(oldT,np.array(prior['locations']['general_shrine']['anchor']['map_roi_anchor'],float));sv=np.linalg.svd(J,compute_uv=False);old_cond=float(sv[0]/max(sv[-1],1e-12));old_det=float(np.linalg.det(J));old_proj=float(np.linalg.norm(oldT[2,:2]));old_false=bool(old_cond>6 or old_det<=0 or old_proj>=.02 or old['target_residual_z5_px']>300)
 def summary(row):
  if not row:return None
  b=row['best'];return {'radius':row['radius'],'check':row['check'],'best_model':b['model'],'matches':row['diagnostic']['ratio_matches'],'inliers':b['inliers'],'inlier_ratio':b['inlier_ratio'],'residual':b.get('anchor_residual'),'condition':b['condition'],'rotation_deg':b['rotation_deg'],'scale':float(np.mean(b['singular_values'])),'appearance':row['appearance']}
 sfix={str(z):summary(best_fixed[z]) for z in [3,5]};salt={str(z):summary(best_alt[z]) for z in [3,5]}
 strong=[]
 for z,row in best_alt.items():
  if row and row['best']:
   b=row['best'];lim=80 if z==5 else 20
   strong.append(b['inliers']>=8 and b.get('anchor_residual',1e9)<=lim and b['source_quadrants']>=2 and b['source_hull_fraction']>=.01)
 local_strong=any(strong)
 anchor_resolves=False
 if best_fixed[5] and best_alt[5]:
  rf=best_fixed[5]['best'].get('anchor_residual',1e9);ra=best_alt[5]['best'].get('anchor_residual',1e9);anchor_resolves=(rf>200 and ra<=80)
 ac_strong=bool(acb and acb['inliers']>=15 and acb.get('anchor_residual',1e9)<=25)
 ab_strong=bool(abb and abb['inliers']>=10 and abb.get('anchor_residual',1e9)<=12)
 main_cfg=reftruth.get('expandedCache',{}).get('families',{}).get('main',{})
 map_state={'semantic_expected':'main / mapSubType 1 / map12 (General Shrine GT catalog lineage)','available_cache_families':sorted({k.split('_')[0] for k in views}), 'main_config':main_cfg,'sub4_role':'legitimate first-party alternate family control, but metadata does not place General Shrine GT on sub4; no arbitrary coordinate remap attempted'}
 available=rev.get('availableVersions',{});revision={'available_versions':available,'pinned_main_version':rev.get('pinnedMainVersion'),'latest_fully_available_main_version':rev.get('latestFullyAvailableMainVersion'),'newer_main_revision_exists':rev.get('newerMainRevisionExists')}
 if anchor_resolves:verdict='R3 — ANCHOR INTERPRETATION'
 elif local_strong and old_false:verdict='R1 — REGISTRATION FALSE CONSENSUS'
 else:verdict='R5 — UNRESOLVED'
 if best_alt[3] and best_alt[5]:
  b3=best_alt[3]['best'];b5=best_alt[5]['best'];r3=b3.get('anchor_residual',1e9);r5=b5.get('anchor_residual',1e9)
  sc3=np.mean(b3['singular_values']);sc5=np.mean(b5['singular_values']);ratio=sc5/max(sc3,1e-9)
  if r3<=20 and r5>160 and 3.0<=ratio<=5.2 and b3['inliers']>=10:verdict='R2 — LEGITIMATE MAP STATE / ZOOM / LOD DIFFERENCE'
 if verdict.startswith('R5') and ac_strong and not local_strong and not ab_strong:
  drift='materially viable but not proven: A↔C strong, B lacks an anchored strong match to C or A under bounded models'
 else:drift='not established'
 d3_change=verdict.startswith('R1') and local_strong and ac_strong
 bridge=bool(d3_change);native=verdict.startswith(('R4','R5'))
 report={'schema':'wwmsync-general-shrine-map-state-audit-v1','production':{'structural_gate':PRODUCTION_GATE,'modified':False},'gt':{'world':GT_WORLD,'z5':GT_Z5.tolist(),'z3':GT_Z3.tolist(),'frozen':True},'provenance':{'owner_fixture':{'sha256':FIXTURE_SHA,'path':args.owner_map},'prior_audit':{'run':31759922863,'job':94643881101,'artifact':9204236942,'digest':'sha256:ddafa809bee15cbe7da2c0f7e8d3354ca9a4e834022e6fb7d13cb643d4762793'},'fullmap_control':{'run':31598370762,'job':94119357278,'artifact':9142179590,'digest':'sha256:10d9c47254d25fc9158e7cb72e04876562220a5f3f45f33f24de540d1b6eec90','source_sha256':FULLMAP_SHA},'revision_probe':{'run':31593244283,'job':94102732342,'artifact':9140048276,'digest':'sha256:c32347318fa7a6cb7d1a9b48846fe4c675f75b74d93985627b9fb3d2e73a5ecc'}},'anchor_audit':{'prior_screen':OLD_SCREEN.tolist(),'original_provenance_screen':alt_s.tolist(),'screen_delta':(alt_s-OLD_SCREEN).tolist(),'screen_delta_norm_px':float(np.linalg.norm(alt_s-OLD_SCREEN)),'prior_fixture_anchor':fixed.tolist(),'alternative_fixture_anchor':alt.tolist(),'semantic_note':'Tracked ROI itself does not retain enough surrounding tooltip UI to independently re-read the landmark label; General Shrine identity is retained from validated owner provenance, not re-derived from matching.','fixed_best':sfix,'alternative_best':salt,'anchor_alone_resolves':anchor_resolves},'old_registration_assessment':{'prior':old,'local_jacobian':J.tolist(),'singular_values':sv.tolist(),'condition':old_cond,'determinant':old_det,'projective_norm':old_proj,'false_consensus':old_false},'local_registration':{'fixed':{str(z):local_fixed[z] for z in [3,5]},'alternative':{str(z):local_alt[z] for z in [3,5]},'strong_expected_neighborhood_support':local_strong},'zoom_lod':{'z3':salt['3'],'z5':salt['5'],'same_physical_gt':True},'map_state':map_state,'revision_style':revision,'three_way':{'A_fullmap_to_C_dashen':{'ratio':ac,'mutual':acm,'best':acb,'strong':ac_strong},'A_fullmap_to_B_owner':{'ratio':ab,'mutual':abm,'best':abb,'strong':ab_strong},'B_owner_to_C_dashen':{'z3':salt['3'],'z5':salt['5'],'strong':local_strong}},'east_contrast':{'east_prior':prior['locations']['east_cross'].get('worldmap_metrics'),'general_prior':prior['locations']['general_shrine'].get('worldmap_metrics'),'causal_note':'East had substantially denser and less quiet feature support in the same audit, making global consensus more stable; this is a diagnostic contrast, not a tuning target.'},'decision':{'verdict':verdict,'old_homography_false_consensus':old_false,'reference_content_drift':drift,'prior_D3_changes':d3_change,'H1_implication':'strengthened to replay-bridge-eligible' if d3_change else 'not upgraded beyond mixed/insufficient General map evidence','H2_implication':'weakened' if d3_change else 'remains materially viable where General discrepancy is unresolved','common_bridge_research_justified':bridge,'native_pc_required':native,'production_change_justified':False}}
 (out/'audit.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
 md=[];add=md.append;add('# General Shrine map-state / reference-discrepancy audit\n');add(f'- Verdict: **{verdict}**');add(f'- Frozen GT z5: `{GT_Z5.tolist()}`; production gate `{PRODUCTION_GATE}` unchanged; production modified: **NO**.');add(f"- Prior homography false-consensus assessment: **{old_false}** (condition `{old_cond:.3f}`, det `{old_det:.6g}`, projective norm `{old_proj:.6g}`, prior GT residual `{old['target_residual_z5_px']:.3f}` z5 px).");add(f'- Anchor: prior `{OLD_SCREEN.tolist()}`, provenance alternative `{alt_s.tolist()}`, delta `{np.linalg.norm(alt_s-OLD_SCREEN):.3f}` screen px; anchor-only resolution: **{anchor_resolves}**.');add('\n## Local expected-neighborhood')
 for z in [3,5]:add(f"- z{z} fixed: `{json.dumps(sfix[str(z)],ensure_ascii=False)}`\n- z{z} provenance-anchor: `{json.dumps(salt[str(z)],ensure_ascii=False)}`")
 add(f'- Strong anchored local support: **{local_strong}**.');add('\n## Three-way A/B/C')
 def short(b):
  if not b:return 'none'
  return f"{b['model']}, inliers={b['inliers']}/{b['matches']}, residual={b.get('anchor_residual')}, cond={b['condition']:.3f}, rot={b['rotation_deg']:.2f}°"
 add(f"- A prior FULL-MAP → C Dashen: **{'strong' if ac_strong else 'not strong'}**; {short(acb)}");add(f"- A prior FULL-MAP → B owner GFN map: **{'strong' if ab_strong else 'not strong'}**; {short(abb)}");add(f"- B owner GFN map → C Dashen expected neighborhood: **{'strong' if local_strong else 'not strong'}**.");add('\n## Zoom / layer / revision');add(f"- z3/z5 are treated as one physical GT pyramid, never independent GT. z3={json.dumps(salt['3'])}; z5={json.dumps(salt['5'])}.");add(f"- Map state: `{map_state['semantic_expected']}`. sub4 is only a legitimate alternate-family negative control; no arbitrary coordinate remap was attempted.");add(f"- Revision probe: main available `{available.get('main')}`, pinned/latest `{revision['pinned_main_version']}/{revision['latest_fully_available_main_version']}`, newer main revision: `{revision['newer_main_revision_exists']}`.");add('\n## Decision implications')
 for k,v in report['decision'].items():add(f'- {k}: `{v}`')
 add('\n## Acceptance\nReplay/CI-only diagnostic. No production matcher/cache/preprocessing edits. Structural gate `0.58` unchanged.');(out/'report.md').write_text('\n'.join(md)+'\n',encoding='utf-8');print(json.dumps({'verdict':verdict,'oldFalseConsensus':old_false,'localStrong':local_strong,'acStrong':ac_strong,'abStrong':ab_strong,'anchorResolves':anchor_resolves,'D3Changes':d3_change,'bridge':bridge,'nativePcRequired':native},indent=2))
if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--owner-map',required=True);p.add_argument('--reference-cache',required=True);p.add_argument('--prior-audit',required=True);p.add_argument('--owner-provenance',required=True);p.add_argument('--fullmap-source',required=True);p.add_argument('--fullmap-meta',required=True);p.add_argument('--reference-truth',required=True);p.add_argument('--revision-probe',required=True);p.add_argument('--output',required=True);main(p.parse_args())
