#!/usr/bin/env python3
"""Replay/CI-only same-session GFN world-map ↔ HUD differential audit.

Consumes immutable owner-control artifacts, independent GT, and the current Dashen
reference/cache. It never imports or modifies production matcher/cache/preprocessing.
Production structural gate 0.58 is context only; research scores are not substitutes.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import subprocess
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable, Optional

import cv2
import numpy as np
from PIL import Image
from skimage.metrics import structural_similarity as ssim

EXPECTED_START_HEAD = "f199258d4abdebe8f3ae75d99b56442ef76e1e38"
AUTHORITATIVE_HUD_RUN = 31666927302
AUTHORITATIVE_HUD_ARTIFACT = 9168284675
PRODUCTION_STRUCTURAL_GATE = 0.58
LOCATIONS: dict[str, dict[str, Any]] = {
    "east_cross": {"label":"East Cross Street","pointId":20212,"world":[-107.941,-1227.2615],"z5":[5219.931321637427,4648.817136173768],"map_anchor_norm":[0.500,0.505]},
    "general_shrine": {"label":"General's Shrine","pointId":None,"world":[-1966.7646484375,-3002.78784179687],"z5":[6015.017126148705,3889.360588972433],"map_anchor_norm":[0.557,0.288]},
}
AUTHORITATIVE_HUD = {
    "east_cross":{"global":"FAIL","expected_basin_top8":False,"fixed_coordinate_full_acceptance":"FAIL","best_scale_aware_structure":0.530224,"source_run":AUTHORITATIVE_HUD_RUN},
    "general_shrine":{"global":"FAIL","expected_basin_top8":False,"fixed_coordinate_full_acceptance":"FAIL","structural_signal":0.5996,"matchGate":"FAIL candidate-recall/intensity","source_run":AUTHORITATIVE_HUD_RUN},
}
IMAGE_EXTS={".png",".jpg",".jpeg",".webp",".bmp",".tif",".tiff"}


def sha256_file(path:Path)->str:
    h=hashlib.sha256()
    with path.open("rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
    return h.hexdigest()


def safe_rel(path:Path,roots:Iterable[Path])->str:
    for root in roots:
        try:return str(path.resolve().relative_to(root.resolve()))
        except Exception:pass
    return str(path)


def read_cv(path:Path)->np.ndarray:
    data=np.fromfile(str(path),dtype=np.uint8);im=cv2.imdecode(data,cv2.IMREAD_COLOR)
    if im is None:raise ValueError(f"cannot decode {path}")
    return im


def image_meta(path:Path)->dict[str,Any]:
    with Image.open(path) as im:w,h=im.size;mode=im.mode
    return {"path":str(path),"width":w,"height":h,"mode":mode,"bytes":path.stat().st_size,"sha256":sha256_file(path)}


def iter_images(roots:Iterable[Path])->Iterable[Path]:
    seen=set()
    for root in roots:
        if not root.exists():continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in IMAGE_EXTS and p not in seen:seen.add(p);yield p


def basic_visual_stats(im:np.ndarray)->dict[str,float]:
    h,w=im.shape[:2];sample=im
    if max(h,w)>800:
        k=800/max(h,w);sample=cv2.resize(im,None,fx=k,fy=k,interpolation=cv2.INTER_AREA)
    hsv=cv2.cvtColor(sample,cv2.COLOR_BGR2HSV);gray=cv2.cvtColor(sample,cv2.COLOR_BGR2GRAY);edges=cv2.Canny(gray,50,120)
    hue=hsv[...,0];sat=hsv[...,1]/255.;val=hsv[...,2]/255.
    return {"sat_mean":float(sat.mean()),"edge_density":float((edges>0).mean()),"warm_fraction":float(((hue<25)&(sat>.25)&(val>.2)).mean()),"green_fraction":float(((hue>=28)&(hue<=85)&(sat>.18)&(val>.15)).mean())}


def path_token_score(path:Path,tokens:Iterable[str])->float:
    s=str(path).lower().replace("_"," ").replace("-"," ");score=sum(2. for t in tokens if t in s)
    if any(t in s for t in ("input","owner","source","recovery","fixture")):score+=2
    if any(t in s for t in ("diagnostic","overlay","warped","crop","report","output")):score-=3
    return score


def identify_owner_sources(roots:list[Path])->dict[str,Path]:
    by_hash={}
    for p in iter_images(roots):
        try:
            with Image.open(p) as im:w,h=im.size
            aspect=w/max(h,1)
            if w<1500 or h<650 or not 2.15<=aspect<=2.55:continue
            sh=sha256_file(p)
            if sh in by_hash:
                if path_token_score(p,["input","owner","source"])>path_token_score(Path(by_hash[sh]["path"]),["input","owner","source"]):by_hash[sh]["path"]=str(p)
                continue
            by_hash[sh]={"path":str(p),"sha":sh,"w":w,"h":h,**basic_visual_stats(read_cv(p))}
        except Exception:continue
    candidates=list(by_hash.values())
    if len(candidates)<4:raise RuntimeError(f"need four full-screen owner sources; found {len(candidates)}")
    def loc_score(c,loc):
        return path_token_score(Path(c["path"]),["east","cross","fairground","kaifeng"] if loc=="east_cross" else ["general","shrine","jiang","qinghe"])
    def role_score(c,role):
        p=Path(c["path"]);s=str(p).lower()
        if role=="map":
            q=path_token_score(p,["world map","worldmap","map screen","full map","map"])+max(0,.20-c["sat_mean"])*20
            if any(t in s for t in ("gameplay","hud","minimap")):q-=4
            return q
        q=path_token_score(p,["gameplay","hud","minimap","play"])+max(0,c["sat_mean"]-.12)*12
        if "worldmap" in s or "world map" in s:q-=4
        return q
    assignment={};used=set()
    for loc in LOCATIONS:
        for role in ("map","hud"):
            ranked=sorted(candidates,key=lambda c:loc_score(c,loc)+role_score(c,role),reverse=True)
            if ranked and loc_score(ranked[0],loc)>=2 and role_score(ranked[0],role)>=1 and ranked[0]["sha"] not in used:
                assignment[f"{loc}_{role}"]=Path(ranked[0]["path"]);used.add(ranked[0]["sha"])
    remaining=[c for c in candidates if c["sha"] not in used]
    missing=[l for l in LOCATIONS if f"{l}_map" not in assignment]
    if missing:
        pool=sorted(remaining,key=lambda c:(c["sat_mean"],-c["edge_density"]))[:max(2,len(missing))]
        if len(missing)==2 and len(pool)>=2:
            east=max(pool,key=lambda c:c["edge_density"]);general=min(pool,key=lambda c:c["edge_density"])
            for loc,c in (("east_cross",east),("general_shrine",general)):assignment[f"{loc}_map"]=Path(c["path"]);used.add(c["sha"])
        else:
            for loc in missing:
                avail=[c for c in pool if c["sha"] not in used]
                if avail:c=avail[0];assignment[f"{loc}_map"]=Path(c["path"]);used.add(c["sha"])
    remaining=[c for c in candidates if c["sha"] not in used];missing=[l for l in LOCATIONS if f"{l}_hud" not in assignment]
    if len(missing)==2 and len(remaining)>=2:
        east=max(remaining,key=lambda c:2*c["warm_fraction"]+c["edge_density"]-.5*c["green_fraction"]);rem=[c for c in remaining if c["sha"]!=east["sha"]];general=max(rem,key=lambda c:1.5*c["green_fraction"]-.4*c["warm_fraction"])
        assignment["east_cross_hud"]=Path(east["path"]);assignment["general_shrine_hud"]=Path(general["path"]);used|={east["sha"],general["sha"]}
    required={f"{l}_{r}" for l in LOCATIONS for r in ("map","hud")}
    if set(assignment)!=required or len({sha256_file(p) for p in assignment.values()})!=4:raise RuntimeError(f"ambiguous owner assignment {assignment}")
    return assignment


def refine_gold_anchor(im:np.ndarray,loc:str)->tuple[float,float,dict[str,Any]]:
    h,w=im.shape[:2];nx,ny=LOCATIONS[loc]["map_anchor_norm"];x0,y0=nx*w,ny*h;hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV)
    ya,yb=max(0,int(y0-.09*h)),min(h,int(y0+.09*h));xa,xb=max(0,int(x0-.09*w)),min(w,int(x0+.09*w));sub=hsv[ya:yb,xa:xb]
    mask=((sub[...,0]>=5)&(sub[...,0]<=35)&(sub[...,1]>=35)&(sub[...,2]>=100)).astype(np.uint8)*255;mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
    n,lab,st,cent=cv2.connectedComponentsWithStats(mask);choices=[]
    for i in range(1,n):
        a=int(st[i,cv2.CC_STAT_AREA])
        if 6<=a<=1800:
            cx,cy=float(cent[i][0]+xa),float(cent[i][1]+ya);d=math.hypot((cx-x0)/w,(cy-y0)/h);choices.append((d,-a,cx,cy,a))
    if choices:
        choices.sort();d,_,cx,cy,a=choices[0]
        if d<=.055:return cx,cy,{"method":"nearby-gold-component","distance_norm":d,"component_area":a,"initial":[x0,y0]}
    return x0,y0,{"method":"fixed-visible-anchor","initial":[x0,y0]}


def map_roi(im,anchor):
    h,w=im.shape[:2];x,y=anchor;x0=max(0,int(x-.30*w));x1=min(w,int(x+.30*w));y0=max(int(.09*h),int(y-.34*h));y1=min(int(.94*h),int(y+.42*h));return im[y0:y1,x0:x1],(x0,y0,x1,y1),(x-x0,y-y0)


def hud_roi(im):
    h,w=im.shape[:2]
    if w>=1200 and h>=650:s=max(160,int(round(h*.25)));roi=im[:s,:s].copy();cx,cy,r=.35*s,.34*s,.335*s
    else:s=min(h,w);roi=im[:s,:s].copy();cx,cy,r=.5*s,.5*s,.47*s
    yy,xx=np.ogrid[:roi.shape[0],:roi.shape[1]];mask=((xx-cx)**2+(yy-cy)**2<=r*r).astype(np.uint8)*255
    return roi,mask,{"crop_size":int(s),"circle_center":[float(cx),float(cy)],"circle_radius":float(r)}


def auto_icon_mask(im,valid):
    hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV);sat,val=hsv[...,1],hsv[...,2];bad=(((sat>95)&(val>90))|((val>242)&(sat<45))).astype(np.uint8)*255;n,lab,st,_=cv2.connectedComponentsWithStats(bad);keep=np.zeros_like(bad);total=bad.size
    for i in range(1,n):
        a=st[i,cv2.CC_STAT_AREA]
        if 2<=a<=max(250,int(total*.02)):keep[lab==i]=255
    keep=cv2.dilate(keep,np.ones((3,3),np.uint8));return cv2.bitwise_and(valid,cv2.bitwise_not(keep))


def entropy8(gray,mask):
    vals=gray[mask>0];hist=np.bincount(vals,minlength=256).astype(float);hist/=max(1,hist.sum());nz=hist[hist>0];return float(-(nz*np.log2(nz)).sum())


def domain_metrics(im,mask=None):
    gray=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
    if mask is None:mask=np.full(gray.shape,255,np.uint8)
    valid=mask>0;vals=gray[valid].astype(np.float32);gx=cv2.Sobel(gray,cv2.CV_32F,1,0,3);gy=cv2.Sobel(gray,cv2.CV_32F,0,1,3);mag=cv2.magnitude(gx,gy);ang=cv2.phase(gx,gy,angleInDegrees=True)%180;med=float(np.median(vals));lo=max(15,int(.55*med));hi=min(240,max(lo+20,int(1.35*med)));edges=cv2.Canny(gray,lo,hi);edges[~valid]=0
    hist=[];weights=mag[valid];angles=ang[valid]
    for a0 in range(0,180,22):hist.append(float(weights[(angles>=a0)&(angles<min(180,a0+22))].sum()))
    hs=sum(hist) or 1;hist=[v/hs for v in hist];lap=cv2.Laplacian(gray,cv2.CV_32F);hf=float(np.var(lap[valid])/(np.var(vals)+1e-6));quiet=float((mag[valid]<18).mean());hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV);overlay=float(((hsv[...,1]>95)&(hsv[...,2]>90)&valid).sum()/max(1,valid.sum()));sift=cv2.SIFT_create(nfeatures=2500,contrastThreshold=.02,edgeThreshold=12);kps=sift.detect(gray,mask);ys,xs=np.nonzero(valid);radial=[]
    if len(xs):
        cx,cy=float(xs.mean()),float(ys.mean());Y,X=np.indices(gray.shape);rr=np.sqrt((X-cx)**2+(Y-cy)**2);rmax=float(rr[valid].max()) or 1
        for i in range(4):ring=valid&(rr>=i*rmax/4)&(rr<(i+1)*rmax/4);radial.append(float((edges[ring]>0).mean()) if ring.any() else 0)
    return {"luminance_mean":float(vals.mean()/255),"contrast_std":float(vals.std()/255),"entropy_bits":entropy8(gray,mask),"edge_density":float((edges[valid]>0).mean()),"orientation_histogram_8":hist,"high_frequency_energy_norm":hf,"quiet_space_occupancy":quiet,"obvious_overlay_occupancy":overlay,"sift_features":len(kps),"features_per_kpx":float(len(kps)/(max(1,valid.sum())/1000)),"radial_edge_density_quartiles":radial}

@dataclass
class ReferenceView:
    path:str;image:np.ndarray;origin_x:float;origin_y:float;sha256:str;provenance_score:float;provenance_reason:str
    def local(self,gt,radius=900):
        x,y=float(gt[0])-self.origin_x,float(gt[1])-self.origin_y;h,w=self.image.shape[:2];x0=max(0,int(x-radius));y0=max(0,int(y-radius));x1=min(w,int(x+radius));y1=min(h,int(y+radius))
        if x1-x0<256 or y1-y0<256:return self.image.copy(),(self.origin_x,self.origin_y)
        return self.image[y0:y1,x0:x1].copy(),(self.origin_x+x0,self.origin_y+y0)


def reference_candidate_score(path,w,h,loc):
    s=str(path).lower();score=0;why=[]
    for tok,val in (("dashen",8),("reference",5),("atlas",5),("cache",3),("tile",2),("expected",3),("z5",4),("map",1)):
        if tok in s:score+=val;why.append(tok)
    if loc=="east_cross" and any(t in s for t in ("east","cross","20212")):score+=4;why.append("east-location")
    if loc=="general_shrine" and any(t in s for t in ("general","shrine")):score+=4;why.append("general-location")
    if any(t in s for t in ("owner","gameplay","hud","worldmap","world-map","screenshot")):score-=8;why.append("source-penalty")
    if w>=6800 and h>=5200:score+=10;why.append("z5-sized-atlas")
    elif w>=1000 and h>=1000:score+=2;why.append("large-patch")
    return score,",".join(why)


def build_tile_mosaic(roots,loc,gt,source_hashes,outdir):
    dirs={}
    for root in roots:
        if not root.exists():continue
        for p in root.rglob("*"):
            if p.is_file() and p.suffix.lower() in IMAGE_EXTS and any(t in str(p).lower() for t in ("dashen","tile","cache","atlas","reference")):dirs.setdefault(p.parent,[]).append(p)
    for d,files in sorted(dirs.items(),key=lambda kv:len(kv[1]),reverse=True):
        if len(files)<9:continue
        ts=None
        for p in files[:20]:
            try:
                im=read_cv(p);h,w=im.shape[:2]
                if w==h and w in (128,256,512):ts=w;break
            except Exception:pass
        if not ts:continue
        tx,ty=int(gt[0]//ts),int(gt[1]//ts);mapping={}
        for p in files:
            nums=[int(x) for x in re.findall(r"(?<!\d)(\d+)(?!\d)",str(p.relative_to(d)))]
            if len(nums)<2:continue
            for a,b in ((nums[-2],nums[-1]),(nums[-1],nums[-2])):
                if abs(a-tx)<=4 and abs(b-ty)<=4:mapping[(a,b)]=p;break
        if sum((x,y) in mapping for x in range(tx-1,tx+2) for y in range(ty-1,ty+2))<6:continue
        xs=range(tx-3,tx+4);ys=range(ty-3,ty+4);canvas=np.full((7*ts,7*ts,3),127,np.uint8)
        for j,y in enumerate(ys):
            for i,x in enumerate(xs):
                p=mapping.get((x,y))
                if p:
                    tile=read_cv(p)
                    if tile.shape[:2]!=(ts,ts):tile=cv2.resize(tile,(ts,ts))
                    canvas[j*ts:(j+1)*ts,i*ts:(i+1)*ts]=tile
        out=outdir/f"{loc}_dashen_tile_mosaic.png";cv2.imwrite(str(out),canvas);return ReferenceView(str(out),canvas,(tx-3)*ts,(ty-3)*ts,sha256_file(out),12,"tile-cache 7x7 mosaic")
    return None


def choose_reference(roots,loc,source_hashes,outdir):
    gt=tuple(LOCATIONS[loc]["z5"]);cand=[]
    for p in iter_images(roots):
        try:
            sh=sha256_file(p)
            if sh in source_hashes:continue
            with Image.open(p) as im:w,h=im.size
            score,why=reference_candidate_score(p,w,h,loc)
            if score<=0:continue
            if w>gt[0]+500 and h>gt[1]+500 and w>=3000 and h>=3000:cand.append((score,p,0.,0.,why))
            elif w>=500 and h>=500 and ((loc=="east_cross" and any(t in str(p).lower() for t in ("east","cross","20212"))) or (loc=="general_shrine" and any(t in str(p).lower() for t in ("general","shrine")))) and any(t in str(p).lower() for t in ("expected","reference","dashen")):cand.append((score,p,gt[0]-w/2,gt[1]-h/2,why+",gt-centered-explicit-patch"))
        except Exception:continue
    if cand:
        cand.sort(key=lambda x:(x[0],Path(x[1]).stat().st_size),reverse=True);score,p,ox,oy,why=cand[0];im=read_cv(Path(p));return ReferenceView(str(p),im,float(ox),float(oy),sha256_file(Path(p)),float(score),why)
    m=build_tile_mosaic(roots,loc,gt,source_hashes,outdir)
    if m:return m
    raise RuntimeError(f"no defensible current Dashen reference/cache for {loc}")


def prep_gray(im,clahe=False,blur=0.):
    g=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY) if im.ndim==3 else im.copy()
    if clahe:g=cv2.createCLAHE(2.,(8,8)).apply(g)
    if blur>0:g=cv2.GaussianBlur(g,(0,0),blur)
    return g


def feature_registration(src,ref,src_anchor,ref_origin,gt,mask_icons=False):
    gs,gr=prep_gray(src,True),prep_gray(ref,True);smask=np.full(gs.shape,255,np.uint8)
    if mask_icons:smask=auto_icon_mask(src,smask)
    sift=cv2.SIFT_create(nfeatures=8000,contrastThreshold=.012,edgeThreshold=14,sigma=1.2);k1,d1=sift.detectAndCompute(gs,smask);k2,d2=sift.detectAndCompute(gr,None);out={"source_features":len(k1),"reference_features":len(k2),"ratio_matches":0,"ransac_inliers":0,"inlier_ratio":0.,"transform":None,"median_reprojection_error":None,"target_residual_z5_px":None,"model":None}
    if d1 is None or d2 is None or len(k1)<4 or len(k2)<4:return out
    good=[m for m,n in cv2.BFMatcher(cv2.NORM_L2).knnMatch(d1,d2,k=2) if m.distance<.72*n.distance];out["ratio_matches"]=len(good)
    if len(good)<4:return out
    a=np.float32([k1[m.queryIdx].pt for m in good]);b=np.float32([k2[m.trainIdx].pt for m in good]);H,hm=cv2.findHomography(a,b,cv2.RANSAC,5.,maxIters=10000,confidence=.999);A,am=cv2.estimateAffinePartial2D(a,b,method=cv2.RANSAC,ransacReprojThreshold=4.,maxIters=10000,confidence=.999,refineIters=20);choices=[]
    if H is not None and hm is not None:
        pred=cv2.perspectiveTransform(a.reshape(-1,1,2),H).reshape(-1,2);ins=hm.ravel().astype(bool);err=np.linalg.norm(pred-b,axis=1);choices.append((int(ins.sum()),float(np.median(err[ins])) if ins.any() else 999.,"homography",H))
    if A is not None and am is not None:
        pred=a@A[:,:2].T+A[:,2];ins=am.ravel().astype(bool);err=np.linalg.norm(pred-b,axis=1);choices.append((int(ins.sum()),float(np.median(err[ins])) if ins.any() else 999.,"affine-partial",A))
    if not choices:return out
    choices.sort(key=lambda z:(z[0],-z[1],1 if z[2]=="affine-partial" else 0),reverse=True);nin,med,model,T=choices[0];pt=np.array([[[src_anchor[0],src_anchor[1]]]],np.float32);q=cv2.perspectiveTransform(pt,T)[0,0] if model=="homography" else np.array(src_anchor)@T[:,:2].T+T[:,2];qabs=np.array([q[0]+ref_origin[0],q[1]+ref_origin[1]]);res=float(np.linalg.norm(qabs-np.array(gt)));out.update({"ransac_inliers":nin,"inlier_ratio":float(nin/max(1,len(good))),"transform":T.tolist(),"median_reprojection_error":med,"target_residual_z5_px":res,"mapped_target_z5":qabs.tolist(),"model":model});return out


def center_crop(img,center,size):
    h,w=img.shape[:2];half=size//2;cx,cy=center;x0=int(round(cx-half));y0=int(round(cy-half));x1=x0+size;y1=y0+size;pl=max(0,-x0);pt=max(0,-y0);pr=max(0,x1-w);pb=max(0,y1-h);x0=max(0,x0);y0=max(0,y0);x1=min(w,x1);y1=min(h,y1);sub=img[y0:y1,x0:x1]
    return cv2.copyMakeBorder(sub,pt,pb,pl,pr,cv2.BORDER_REFLECT_101) if any((pl,pt,pr,pb)) else sub


def warp_center(gray,out_size,scale,angle):
    h,w=gray.shape[:2];c=(w/2,h/2);M=cv2.getRotationMatrix2D(c,angle,scale);M[0,2]+=out_size/2-c[0];M[1,2]+=out_size/2-c[1];return cv2.warpAffine(gray,M,(out_size,out_size),flags=cv2.INTER_LINEAR,borderMode=cv2.BORDER_REFLECT_101)


def edge_similarity(a,b,mask=None):
    if a.shape!=b.shape:b=cv2.resize(b,(a.shape[1],a.shape[0]),interpolation=cv2.INTER_AREA)
    if mask is None:mask=np.full(a.shape,255,np.uint8)
    valid=mask>0;aa=cv2.createCLAHE(2.,(8,8)).apply(a);bb=cv2.createCLAHE(2.,(8,8)).apply(b);ea=cv2.Canny(aa,45,110);eb=cv2.Canny(bb,45,110);ea[~valid]=0;eb[~valid]=0;da=cv2.distanceTransform((ea==0).astype(np.uint8),cv2.DIST_L2,3);db=cv2.distanceTransform((eb==0).astype(np.uint8),cv2.DIST_L2,3);ap=(ea>0)&valid;bp=(eb>0)&valid;aga=float((db[ap]<=2.5).mean()) if ap.any() else 0.;agb=float((da[bp]<=2.5).mean()) if bp.any() else 0.;agree=.5*(aga+agb);ca=float(np.clip(db[ap],0,10).mean()/10) if ap.any() else 1.;cb=float(np.clip(da[bp],0,10).mean()/10) if bp.any() else 1.;ch=1-.5*(ca+cb);va=aa[valid].astype(float);vb=bb[valid].astype(float);ncc=float(np.corrcoef(va,vb)[0,1]) if va.std()>1e-6 and vb.std()>1e-6 else 0.;sv=float(ssim(aa,bb,data_range=255));score=float(.5*agree+.3*ch+.1*max(0,ncc)+.1*max(0,sv));return {"score":score,"edge_agreement":agree,"chamfer":ch,"ncc":ncc,"ssim":sv}


def anchored_sweep(src_roi,src_anchor,ref_view,gt,out_size=384):
    sp=center_crop(src_roi,src_anchor,640);sg=prep_gray(sp);rx,ry=gt[0]-ref_view.origin_x,gt[1]-ref_view.origin_y;rg=prep_gray(center_crop(ref_view.image,(rx,ry),out_size));best=None
    for s in np.exp(np.linspace(math.log(.28),math.log(2.8),22)):
        for a in list(np.arange(-15,16,3))+[90,180,270]:
            sim=edge_similarity(warp_center(sg,out_size,float(s),float(a)),rg);rec=(sim["score"],float(s),float(a),sim)
            if best is None or rec[0]>best[0]:best=rec
    _,bs,ba,bsim=best;frozen=warp_center(sg,out_size,bs,ba);neg=[]
    for dx,dy in ((-700,0),(700,0),(0,-700),(0,700),(-500,-500),(500,-500),(-500,500),(500,500)):neg.append(edge_similarity(frozen,prep_gray(center_crop(ref_view.image,(rx+dx,ry+dy),out_size)))["score"])
    return {"best_scale":bs,"best_angle_deg":ba,"expected":bsim,"negative_scores":neg,"expected_percentile":float((np.array(neg)<bsim["score"]).mean()*100),"margin_vs_best_negative":float(bsim["score"]-max(neg))}


def classify_map_reference(feat,sweep):
    robust=feat.get("ransac_inliers",0)>=10 and feat.get("inlier_ratio",0)>=.20 and (feat.get("median_reprojection_error") or 999)<=6 and (feat.get("target_residual_z5_px") or 1e9)<=90;anch=sweep["expected_percentile"]>=87.5 and sweep["margin_vs_best_negative"]>=.025 and sweep["expected"]["edge_agreement"]>=.34
    if robust and anch:return "MAP-REFERENCE-STRONG"
    if robust or anch or (feat.get("ransac_inliers",0)>=6 and sweep["expected_percentile"]>=75):return "MAP-REFERENCE-WEAK"
    return "MAP-REFERENCE-FAIL"


def transform_search(source,target,mask,scales,angles,shifts):
    tg=prep_gray(target,True);out=tg.shape[0];sg=prep_gray(source,True);best=None
    for s in scales:
        for a in angles:
            base=warp_center(sg,out,float(s),float(a))
            for dx in shifts:
                for dy in shifts:
                    M=np.float32([[1,0,dx],[0,1,dy]]);w=cv2.warpAffine(base,M,(out,out),borderMode=cv2.BORDER_REFLECT_101);sim=edge_similarity(w,tg,mask);rec=(sim["score"],float(s),float(a),int(dx),int(dy),sim)
                    if best is None or rec[0]>best[0]:best=rec
    score,s,a,dx,dy,sim=best;return {"score":score,"scale_source_to_hud":s,"angle_deg":a,"dx":dx,"dy":dy,"metrics":sim}


def direct_map_hud(map_im,map_anchor,hud_im,hud_mask):
    mp=center_crop(map_im,map_anchor,720);coarse=transform_search(mp,hud_im,hud_mask,np.exp(np.linspace(math.log(.18),math.log(1.8),15)),range(0,360,15),(-10,0,10));s0,a0=coarse["scale_source_to_hud"],coarse["angle_deg"];fine=transform_search(mp,hud_im,hud_mask,np.linspace(max(.08,s0*.82),s0*1.18,9),[(a0+d)%360 for d in range(-8,9,2)],(-6,-3,0,3,6));null=[]
    for ox,oy in ((-300,0),(300,0),(0,-300),(0,300)):null.append(transform_search(center_crop(map_im,(map_anchor[0]+ox,map_anchor[1]+oy),720),hud_im,hud_mask,[fine["scale_source_to_hud"]],[fine["angle_deg"]],[fine["dx"],fine["dy"]])["score"])
    fine["null_scores"]=null;fine["margin_vs_best_null"]=float(fine["score"]-max(null));fine["coherent"]=bool(fine["metrics"]["edge_agreement"]>=.28 and fine["margin_vs_best_null"]>=.015);return fine


def hud_reference_search(ref_view,gt,hud,mask):
    rx,ry=gt[0]-ref_view.origin_x,gt[1]-ref_view.origin_y;rp=center_crop(ref_view.image,(rx,ry),900);coarse=transform_search(rp,hud,mask,np.exp(np.linspace(math.log(.08),math.log(1.25),18)),range(0,360,15),(-10,0,10));s0,a0=coarse["scale_source_to_hud"],coarse["angle_deg"];fine=transform_search(rp,hud,mask,np.linspace(max(.04,s0*.85),s0*1.15,9),[(a0+d)%360 for d in range(-8,9,2)],(-6,-3,0,3,6));fine["z5_pixels_per_hud_pixel"]=float(1/max(fine["scale_source_to_hud"],1e-9));null=[]
    for dx,dy in ((-700,0),(700,0),(0,-700),(0,700),(-500,-500),(500,500)):null.append(transform_search(center_crop(ref_view.image,(rx+dx,ry+dy),900),hud,mask,[fine["scale_source_to_hud"]],[fine["angle_deg"]],[fine["dx"],fine["dy"]])["score"])
    fine["null_scores"]=null;fine["margin_vs_best_null"]=float(fine["score"]-max(null));return fine


def common_bridge(results):
    if any(results[l]["map_classification"]!="MAP-REFERENCE-STRONG" for l in LOCATIONS) or any(not results[l]["direct_hud_worldmap"]["coherent"] for l in LOCATIONS):return None
    scales=[results[l]["hud_dashen_raw"]["z5_pixels_per_hud_pixel"] for l in LOCATIONS];med=float(np.median(scales));cv=float(np.std(scales)/(np.mean(scales)+1e-9))
    if cv>.25:return None
    return {"name":"GFN-HUD-COMMON-EDGE-RADIAL-v1","calibration_role":"two owner controls establish a common representation hypothesis; they are not independent validation","frozen_z5_pixels_per_hud_pixel":med,"scale_cv":cv,"radial_mask":"fixed normalized HUD circle from screen geometry","icon_mask":"deterministic obvious colored/small bright UI exclusion","luminance":"grayscale + CLAHE clipLimit=2 tileGrid=8x8","detail_band":"Gaussian sigma=0.8 before Canny; same everywhere","edge_domain":"Canny 45/110 + tolerant bidirectional edge geometry","rotation":"bounded nuisance-pose search; not per-location learned correction","translation":"bounded ±6 HUD pixels; not a global-location optimizer"}


def bridged_local(ref_view,gt,hud,rawmask,bridge):
    clean=auto_icon_mask(hud,rawmask);scale=1/bridge["frozen_z5_pixels_per_hud_pixel"];rx,ry=gt[0]-ref_view.origin_x,gt[1]-ref_view.origin_y;rp=cv2.GaussianBlur(center_crop(ref_view.image,(rx,ry),900),(0,0),.8);hh=cv2.GaussianBlur(hud,(0,0),.8);best=transform_search(rp,hh,clean,[scale],range(0,360,5),(-6,0,6));a0=best["angle_deg"];fine=transform_search(rp,hh,clean,[scale],[(a0+d)%360 for d in range(-4,5)],(-6,-3,0,3,6));fine["valid_mask_fraction"]=float((clean>0).mean());return fine


def scan_text_for_fang_gt(roots):
    pats=[re.compile(r"Fang\s*Xu.{0,160}?z5.{0,80}?([0-9]{3,5}(?:\.[0-9]+)?)[^0-9]+([0-9]{3,5}(?:\.[0-9]+)?)",re.I|re.S),re.compile(r"z5.{0,80}?([0-9]{3,5}(?:\.[0-9]+)?)[^0-9]+([0-9]{3,5}(?:\.[0-9]+)?).{0,160}?Fang\s*Xu",re.I|re.S)]
    for root in roots:
        if not root.exists():continue
        for p in root.rglob("*"):
            if not p.is_file() or p.suffix.lower() not in {".md",".txt",".json",".log",".csv"}:continue
            try:t=p.read_text(errors="ignore")
            except Exception:continue
            if "fang" not in t.lower():continue
            for pat in pats:
                m=pat.search(t)
                if m:
                    x,y=float(m.group(1)),float(m.group(2))
                    if 0<x<20000 and 0<y<20000:return x,y
    return None


def find_fang_source(roots,source_hashes):
    ranked=[]
    for p in iter_images(roots):
        if "fang" not in str(p).lower():continue
        try:
            if sha256_file(p) in source_hashes:continue
            h,w=read_cv(p).shape[:2];score=path_token_score(p,["fang","hud","gameplay","source","steam"])+(2 if w>=500 and h>=300 else 0);ranked.append((score,p))
        except Exception:continue
    return max(ranked,key=lambda x:x[0])[1] if ranked else None


def find_motion_zip(roots):
    exact="wwmsync-gfn-motion-20260810-143835.zip"
    for root in roots:
        if root.exists():
            xs=list(root.rglob(exact))
            if xs:return xs[0]
    return None


def fixture_frames(path,out):
    out.mkdir(parents=True,exist_ok=True)
    with zipfile.ZipFile(path) as z:z.extractall(out)
    imgs=[p for p in out.rglob("*") if p.suffix.lower() in IMAGE_EXTS];imgs.sort(key=lambda p:[int(x) if x.isdigit() else x for x in re.split(r"(\d+)",p.name)]);return imgs


def global_bridge_probe(atlas,frames,bridge,max_frames=40):
    ah,aw=atlas.image.shape[:2]
    if atlas.origin_x!=0 or atlas.origin_y!=0 or aw<5000 or ah<4000:return {"status":"NOT_RUN_REFERENCE_IS_LOCAL_PATCH","frames":0}
    refedge=cv2.Canny(prep_gray(atlas.image,True,.8),45,110);down=.18;refsmall=cv2.resize(refedge,None,fx=down,fy=down,interpolation=cv2.INTER_AREA);zpp=bridge["frozen_z5_pixels_per_hud_pixel"];records=[]
    for i,p in enumerate(frames[:max_frames]):
        im=read_cv(p);roi,mask,_=hud_roi(im);clean=auto_icon_mask(roi,mask);e=cv2.Canny(prep_gray(roi,True,.8),45,110);e[clean==0]=0;tp=max(24,int(round(e.shape[0]*zpp*down)));base=cv2.resize(e,(tp,tp),interpolation=cv2.INTER_AREA);peaks=[]
        for ang in range(0,360,30):
            rot=warp_center(base,tp,1.,float(ang))
            if rot.shape[0]>=refsmall.shape[0] or rot.shape[1]>=refsmall.shape[1]:continue
            r=cv2.matchTemplate(refsmall,rot,cv2.TM_CCOEFF_NORMED);rr=r.copy()
            for _ in range(3):
                _,v,_,loc=cv2.minMaxLoc(rr);x,y=loc;peaks.append((float(v),float((x+tp/2)/down),float((y+tp/2)/down),ang));cv2.circle(rr,(x,y),max(5,tp//2),-1.,-1)
        peaks=sorted(peaks,reverse=True)[:8];records.append({"frame":i+1,"top8":[{"score":v,"z5":[x,y],"angle":a} for v,x,y,a in peaks]})
    centers=[r["top8"][0]["z5"] for r in records if r["top8"]];st=None
    if len(centers)>=3:
        arr=np.array(centers);med=np.median(arr,axis=0);d=np.linalg.norm(arr-med,axis=1);st={"median_z5":med.tolist(),"median_distance_px":float(np.median(d)),"p90_distance_px":float(np.percentile(d,90)),"frames":len(centers)}
    return {"status":"RESEARCH_ONLY_NO_GROUND_TRUTH_ACCEPTANCE","frames":len(records),"top1_stability":st,"records":records}


def write_overlay(src,ref,path):
    a=cv2.resize(src,(512,512));b=cv2.resize(ref,(512,512));ea=cv2.Canny(prep_gray(a),45,110);eb=cv2.Canny(prep_gray(b),45,110);rgb=np.zeros((512,512,3),np.uint8);rgb[...,1]=ea;rgb[...,2]=eb;cv2.imwrite(str(path),rgb)


def verify_repo_base(repo,expected):
    def run(*args):return subprocess.check_output(args,cwd=repo,text=True).strip()
    head=run("git","rev-parse","HEAD");revs=run("git","rev-list","--first-parent","--reverse",f"{expected}..{head}").splitlines();first=revs[0] if revs else None;parent=run("git","rev-parse",f"{first}^") if first else head;changed=run("git","diff","--name-only",f"{expected}..{head}").splitlines() if head!=expected else [];allowed={"scripts/replay/wwmsync_same_session_gfn_diff_audit.py",".github/workflows/wwmsync-same-session-gfn-diff-audit.yml"};unexpected=[p for p in changed if p not in allowed];return {"expected_start_head":expected,"workflow_head":head,"first_audit_commit":first,"first_audit_parent":parent,"changed_before_ci_report":changed,"unexpected_paths":unexpected,"verified":parent==expected and not unexpected}


def generate_report(data):
    lines=[];add=lines.append;add("# WWMSync — Same-session GFN world-map ↔ HUD differential audit");add("");add("> Replay/CI-only research. Production matcher/cache/preprocessing are untouched. Production structural gate remains **0.58**. Research scores are diagnostic, not production matchGate substitutes.");add("");v=data["repo_verification"];add("## 1. Verified starting HEAD");add(f"- Expected / verified audit parent: `{v['expected_start_head']}`");add(f"- Workflow implementation HEAD: `{v['workflow_head']}`");add(f"- First audit commit parent: `{v['first_audit_parent']}`");add(f"- Verification: **{'PASS' if v['verified'] else 'FAIL'}**");add("");add("## 2–4. Commits and exact source provenance");add("- Implementation commits are the first-parent commits between the verified start and workflow HEAD; generated report commit is appended by CI after artifact upload.")
    for key,m in data["sources"].items():add(f"- **{key}** — `{m['width']}×{m['height']}`, {m['bytes']} bytes, SHA-256 `{m['sha256']}`; recovered path `{m['relative_path']}`")
    add(f"- Reused authoritative HUD run `{AUTHORITATIVE_HUD_RUN}`, artifact `{AUTHORITATIVE_HUD_ARTIFACT}`; HUD verdicts are not rerun.");add("")
    for loc,num in (("east_cross",5),("general_shrine",6)):
        r=data["locations"][loc];f=r["feature_registration_raw"];s=r["anchored_sweep"];add(f"## {num}. {LOCATIONS[loc]['label']} world-map → Dashen registration");add(f"- Independent GT z5 `{LOCATIONS[loc]['z5']}`"+(f", pointId `{LOCATIONS[loc]['pointId']}`" if LOCATIONS[loc]['pointId'] else ""));add(f"- Reference `{r['reference']['path']}`, SHA-256 `{r['reference']['sha256']}`, origin `{r['reference']['origin']}`, provenance `{r['reference']['provenance_reason']}`.");add(f"- Features source/reference **{f['source_features']} / {f['reference_features']}**; ratio matches **{f['ratio_matches']}**; RANSAC inliers **{f['ransac_inliers']}**; inlier ratio **{f['inlier_ratio']:.3f}**.");add(f"- Model `{f['model']}`; transform `{json.dumps(f['transform'],separators=(',',':'))}`; median reprojection `{f['median_reprojection_error']}` px; selected-marker→independent-GT residual `{f['target_residual_z5_px']}` z5 px.");add(f"- Expected-area diagnostic structure `{s['expected']['score']:.4f}`, edge `{s['expected']['edge_agreement']:.4f}`, SSIM `{s['expected']['ssim']:.4f}`, wrong-neighborhood percentile `{s['expected_percentile']:.1f}`, margin `{s['margin_vs_best_negative']:.4f}`.");add(f"- **{r['map_classification']}**");add("")
    add("## 7. MAP-REFERENCE classifications");[add(f"- {LOCATIONS[l]['label']}: **{data['locations'][l]['map_classification']}**") for l in LOCATIONS];add("");add("## 8. World-map vs HUD domain metrics")
    for loc in LOCATIONS:
        r=data["locations"][loc];wm,hm,hc=r["worldmap_metrics"],r["hud_metrics_raw"],r["hud_metrics_masked"];add(f"### {LOCATIONS[loc]['label']}");add(f"- world-map raw: edge `{wm['edge_density']:.4f}`, luminance `{wm['luminance_mean']:.4f}`, contrast `{wm['contrast_std']:.4f}`, entropy `{wm['entropy_bits']:.3f}`, HF `{wm['high_frequency_energy_norm']:.3f}`, quiet `{wm['quiet_space_occupancy']:.3f}`, features/kpx `{wm['features_per_kpx']:.3f}`.");add(f"- HUD raw: edge `{hm['edge_density']:.4f}`, luminance `{hm['luminance_mean']:.4f}`, contrast `{hm['contrast_std']:.4f}`, entropy `{hm['entropy_bits']:.3f}`, HF `{hm['high_frequency_energy_norm']:.3f}`, quiet `{hm['quiet_space_occupancy']:.3f}`, overlay `{hm['obvious_overlay_occupancy']:.3f}`.");add(f"- HUD diagnostic masked: edge `{hc['edge_density']:.4f}`, contrast `{hc['contrast_std']:.4f}`, entropy `{hc['entropy_bits']:.3f}`, HF `{hc['high_frequency_energy_norm']:.3f}`, quiet `{hc['quiet_space_occupancy']:.3f}`.");add(f"- orientation map `{[round(x,3) for x in wm['orientation_histogram_8']]}` vs HUD `{[round(x,3) for x in hm['orientation_histogram_8']]}`; radial HUD edge `{[round(x,4) for x in hm['radial_edge_density_quartiles']]}`; geometry `{r['hud_geometry']}`.")
    add("");add("## 9. Direct HUD ↔ owner world-map local relation")
    for loc in LOCATIONS:
        d=data["locations"][loc]["direct_hud_worldmap"];add(f"- **{LOCATIONS[loc]['label']}** coherent=`{d['coherent']}`; scale `{d['scale_source_to_hud']:.4f}`, rotation `{d['angle_deg']:.1f}°`, shift ({d['dx']},{d['dy']}), edge `{d['metrics']['edge_agreement']:.4f}`, score `{d['score']:.4f}`, null margin `{d['margin_vs_best_null']:.4f}`.")
    add("");bridge=data.get("bridge");add("## 10. Common representation difference");add((f"**YES — `{bridge['name']}` frozen for replay-only research.** Common z5/HUD scale `{bridge['frozen_z5_pixels_per_hud_pixel']:.4f}`, CV `{bridge['scale_cv']:.4f}`; deterministic radial/icon mask + common contrast/detail-band + edge domain; no per-location score multiplier." if bridge else "**NO.** Predeclared cross-location coherence/scale-consistency conditions were not met; Phase 4 was not built."));add("");add("## 11–12. Frozen bridge experiment / cross-control results")
    if bridge:
        for loc in LOCATIONS:
            b=data["locations"][loc]["bridge_local"];add(f"- {LOCATIONS[loc]['label']} (calibration consistency, not independent validation): score `{b['score']:.4f}`, edge `{b['metrics']['edge_agreement']:.4f}`, angle `{b['angle_deg']:.1f}°`, mask-valid `{b['valid_mask_fraction']:.3f}`.")
        add(f"- Steam Fang Xu: `{json.dumps(data.get('fang_xu_bridge'),ensure_ascii=False)}`");mf=data.get("motion_fixture_bridge");add(f"- 40-frame GFN fixture: `{mf.get('status') if mf else 'NOT_FOUND'}`, frames `{mf.get('frames') if mf else 0}`, top-1 stability `{json.dumps(mf.get('top1_stability') if mf else None)}`. No true-location acceptance without independent sequence GT.")
    else:add("Not justified; no bridge was tuned or run.")
    add("");add("## 13. Impact on Steam Fang Xu");add(data.get("fang_xu_summary","No bridge justified; prior Fang Xu control remains unchanged."));add("");add("## 14. Impact on exact real 40-frame GFN fixture");add(data.get("motion_summary","No bridge justified; authoritative production fixture verdict remains FAIL."));add("");add("## 15–18. Decision");add(f"- **{data['decision']}**");add(f"- **H1/H2:** {data['h1_h2']}");add("- **Production change justified: NO.** Gate `0.58`, production matcher/cache/preprocessing unchanged.");add(f"- **Native-PC acquisition:** {data['native_pc']}");add("");add("## 19. Authoritative CI");add("CI metadata is appended after successful artifact upload: run/job/artifact/digest are written by the workflow and committed with this report.");add("");add("## 20. Final acceptance");add(f"**{data['final_acceptance']}**");add("");add("### Guardrails");add("- No threshold lowering or score inflation; research scores remain separate from production matchGate.");add("- No production matcher/cache/preprocessing changes; no ORB/XFeat/DINO/LoFTR global research; no false-basin optimization.");add("- Owner controls calibrate a common bridge only if both agree; they are not claimed as independent validation.");return "\n".join(lines)+"\n"


def append_ci(report,args):
    text=report.read_text();marker="CI metadata is appended after successful artifact upload: run/job/artifact/digest are written by the workflow and committed with this report.";repl=f"- Run: `{args.run_id}`\n- Job: `{args.job_id}`\n- Artifact: `{args.artifact_id}` (`{args.artifact_name}`)\n- Artifact digest: `{args.artifact_digest}`\n- Evidence-bundle SHA-256: `{args.bundle_sha256}`";report.write_text(text.replace(marker,repl))


def main():
    ap=argparse.ArgumentParser();ap.add_argument("--repo",type=Path,default=Path("."));ap.add_argument("--inputs",type=Path);ap.add_argument("--aux",type=Path);ap.add_argument("--out",type=Path);ap.add_argument("--expected-start",default=EXPECTED_START_HEAD);ap.add_argument("--append-ci",type=Path);ap.add_argument("--run-id");ap.add_argument("--job-id");ap.add_argument("--artifact-id");ap.add_argument("--artifact-name",default="wwmsync-same-session-gfn-differential-audit");ap.add_argument("--artifact-digest");ap.add_argument("--bundle-sha256");args=ap.parse_args()
    if args.append_ci:append_ci(args.append_ci,args);return 0
    if not args.inputs or not args.out:ap.error("--inputs and --out required")
    repo=args.repo.resolve();roots=[args.inputs.resolve()]+([args.aux.resolve()] if args.aux else [])+[repo];out=args.out.resolve();out.mkdir(parents=True,exist_ok=True);verification=verify_repo_base(repo,args.expected_start)
    if not verification["verified"]:raise RuntimeError(f"starting HEAD verification failed {verification}")
    sources=identify_owner_sources([args.inputs.resolve()]);source_hashes={sha256_file(p) for p in sources.values()};source_report={};loc_results={};refs={}
    for key,p in sources.items():m=image_meta(p);m["relative_path"]=safe_rel(p,roots);source_report[key]=m
    for loc in LOCATIONS:
        mapim=read_cv(sources[f"{loc}_map"]);hudfull=read_cv(sources[f"{loc}_hud"]);ax,ay,ainfo=refine_gold_anchor(mapim,loc);mroi,box,ra=map_roi(mapim,(ax,ay));hud,hmask,hgeom=hud_roi(hudfull);clean=auto_icon_mask(hud,hmask);ref=choose_reference(roots,loc,source_hashes,out);refs[loc]=ref;local_ref,origin=ref.local(tuple(LOCATIONS[loc]["z5"]),900);feat=feature_registration(mroi,local_ref,ra,origin,tuple(LOCATIONS[loc]["z5"]),False);fmask=feature_registration(mroi,local_ref,ra,origin,tuple(LOCATIONS[loc]["z5"]),True);class_feat=fmask if fmask.get("ransac_inliers",0)>feat.get("ransac_inliers",0) and fmask.get("target_residual_z5_px") is not None else feat;sweep=anchored_sweep(mroi,ra,ref,tuple(LOCATIONS[loc]["z5"]));cls=classify_map_reference(class_feat,sweep);direct=direct_map_hud(mroi,ra,hud,hmask);hdraw=hud_reference_search(ref,tuple(LOCATIONS[loc]["z5"]),hud,hmask);loc_results[loc]={"anchor":{"screen_xy":[ax,ay],"info":ainfo,"map_roi_box":box,"map_roi_anchor":ra},"reference":{"path":safe_rel(Path(ref.path),roots+[out]),"sha256":ref.sha256,"origin":[ref.origin_x,ref.origin_y],"provenance_score":ref.provenance_score,"provenance_reason":ref.provenance_reason,"dimensions":[ref.image.shape[1],ref.image.shape[0]]},"feature_registration_raw":feat,"feature_registration_masked_diagnostic":fmask,"anchored_sweep":sweep,"map_classification":cls,"worldmap_metrics":domain_metrics(mroi),"hud_metrics_raw":domain_metrics(hud,hmask),"hud_metrics_masked":domain_metrics(hud,clean),"hud_geometry":hgeom,"direct_hud_worldmap":direct,"hud_dashen_raw":hdraw,"authoritative_hud":AUTHORITATIVE_HUD[loc]};rp,_=ref.local(tuple(LOCATIONS[loc]["z5"]),400);write_overlay(center_crop(mroi,ra,500),center_crop(rp,(rp.shape[1]/2,rp.shape[0]/2),500),out/f"{loc}_worldmap_vs_dashen_edges.png")
    data={"repo_verification":verification,"sources":source_report,"locations":loc_results};bridge=common_bridge(loc_results);data["bridge"]=bridge
    if all(loc_results[l]["map_classification"]=="MAP-REFERENCE-STRONG" for l in LOCATIONS):decision="D1 — STRONG H1 EVIDENCE";h1h2="Both same-GFN world-map controls preserve the independently expected Dashen neighborhoods while both authoritative same-session HUD controls fail. GFN/capture alone cannot reasonably explain the entire failure; HUD representation/LOD/masking/zoom/candidate-recall becomes the primary architecture hypothesis. H2 is reduced, not mathematically eliminated.";native="NOT REQUIRED as the next causal-triage prerequisite; still valuable/required as independent cross-client evidence before any production representation change is accepted."
    elif all(loc_results[l]["map_classification"]!="MAP-REFERENCE-STRONG" for l in LOCATIONS):decision="D2 — CAPTURE/REFERENCE INFORMATION LOSS";h1h2="The owner GFN world-map controls do not both establish strong Dashen geometry, so capture/reference information loss remains viable. A HUD-specific bridge is not justified.";native="YES — native-PC same-location capture is the next required discriminating evidence."
    else:decision="D3 — MIXED";h1h2="One location is strong while the other is not; map state/layer/zoom/location differences must be resolved before choosing H1 or H2. Contradictory controls are not averaged.";native="DEFER until the mixed map-state/layer/zoom discrepancy is exhausted; if unresolved, YES for same-location discrimination."
    data["decision"],data["h1_h2"],data["native_pc"]=decision,h1h2,native
    if bridge:
        for loc in LOCATIONS:
            hud,hmask,_=hud_roi(read_cv(sources[f"{loc}_hud"]));loc_results[loc]["bridge_local"]=bridged_local(refs[loc],tuple(LOCATIONS[loc]["z5"]),hud,hmask,bridge)
        fang=find_fang_source(roots,source_hashes);fgt=scan_text_for_fang_gt(roots)
        if fang and fgt:
            try:
                fh,fm,_=hud_roi(read_cv(fang));fr=next((r for r in refs.values() if 450<fgt[0]-r.origin_x<r.image.shape[1]-450 and 450<fgt[1]-r.origin_y<r.image.shape[0]-450),None)
                if fr is None:fr=choose_reference(roots,"east_cross",source_hashes,out)
                fb=bridged_local(fr,fgt,fh,fm,bridge);data["fang_xu_bridge"]={"status":"RUN","source":safe_rel(fang,roots),"source_sha256":sha256_file(fang),"gt_z5":fgt,"result":fb};data["fang_xu_summary"]="Frozen bridge applied to recovered independent Steam Fang Xu without re-tuning; this is the independent cross-control check."
            except Exception as e:data["fang_xu_bridge"]={"status":"RECOVERED_BUT_TEST_FAILED","error":repr(e)};data["fang_xu_summary"]="Fang Xu recovered but frozen bridge execution failed; no positive generalization claim."
        else:data["fang_xu_bridge"]={"status":"NOT_RECOVERED_FROM_AVAILABLE_AUTHORITATIVE_ARTIFACTS","source_found":bool(fang),"gt_found":bool(fgt)};data["fang_xu_summary"]="Available artifacts did not expose both Fang Xu source and independent z5 GT; prior authoritative Fang Xu result remains unchanged and no bridge benefit is claimed."
        motion=find_motion_zip(roots)
        if motion:
            expected="aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216";actual=sha256_file(motion)
            if actual==expected:
                frames=fixture_frames(motion,out/"motion_frames");atlas=max(refs.values(),key=lambda r:r.image.shape[0]*r.image.shape[1]);mp=global_bridge_probe(atlas,frames,bridge,40);mp["fixture_sha256"]=actual;mp["fixture_path"]=safe_rel(motion,roots);data["motion_fixture_bridge"]=mp;data["motion_summary"]="Exact SHA-verified 40-frame fixture probed with frozen research bridge. Candidate stability is diagnostic only; without independent absolute sequence GT it cannot convert authoritative production FAIL into true-match acceptance."
            else:data["motion_fixture_bridge"]={"status":"FOUND_SHA_MISMATCH","sha256":actual,"expected":expected};data["motion_summary"]="Motion ZIP failed immutable SHA and was not used; authoritative production result remains FAIL."
        else:data["motion_fixture_bridge"]={"status":"NOT_RECOVERED"};data["motion_summary"]="Exact 40-frame fixture was not recovered; no bridge impact claimed and authoritative production result remains FAIL."
    data["final_acceptance"]="AUDIT COMPLETE — "+decision.split(" — ")[0]+("; COMMON REPLAY-ONLY BRIDGE FROZEN FOR RESEARCH; PRODUCTION CHANGE NOT JUSTIFIED" if bridge else "; NO COMMON BRIDGE JUSTIFIED; PRODUCTION CHANGE NOT JUSTIFIED");(out/"audit.json").write_text(json.dumps(data,indent=2,ensure_ascii=False,default=str));(out/"source_provenance.json").write_text(json.dumps(source_report,indent=2,ensure_ascii=False));(out/"final_report.md").write_text(generate_report(data));return 0

if __name__=="__main__":raise SystemExit(main())
