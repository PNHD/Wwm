#!/usr/bin/env python3
"""Build known-location replay crops from an independently published in-game map screenshot.

The full screenshot is registered to the current Dashen z3 atlas using SIFT/RANSAC.
That independent homography is then used only to choose crop windows centered on a
known Dashen POI. Production matcher scoring is performed later by the browser
replay; this script does not alter or emulate matcher gates.
"""
from __future__ import annotations
import argparse, hashlib, json
from pathlib import Path
import cv2
import numpy as np

SUB1={'calMeter':1024/1008,'realMeter':256/19456,'xOffset':12095.6875,'yOffset':12095.6875}

def subtype1_pixel(x,y,z):
    f=SUB1['realMeter']*SUB1['calMeter']
    return (-x+SUB1['xOffset'])*f*(2**z),(y+SUB1['yOffset'])*f*(2**z)

def atlas_z3(cache:Path):
    out=np.zeros((2048,2048,3),np.uint8)
    for y in range(8):
        for x in range(8):
            p=cache/'main'/'3'/f'{x}_{y}.png'; im=cv2.imread(str(p),cv2.IMREAD_COLOR)
            if im is None: raise RuntimeError(f'missing Dashen z3 tile: {p}')
            out[y*256:(y+1)*256,x*256:(x+1)*256]=im
    return out

def register(source,atlas):
    scale=min(1.0,1600/max(source.shape[:2]))
    work=cv2.resize(source,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA) if scale<1 else source
    a=cv2.cvtColor(work,cv2.COLOR_BGR2GRAY); b=cv2.cvtColor(atlas,cv2.COLOR_BGR2GRAY)
    sift=cv2.SIFT_create(nfeatures=10000,contrastThreshold=.02,edgeThreshold=16)
    ka,da=sift.detectAndCompute(a,None); kb,db=sift.detectAndCompute(b,None)
    if da is None or db is None: raise RuntimeError('positive control: no SIFT descriptors')
    pairs=cv2.BFMatcher(cv2.NORM_L2).knnMatch(da,db,k=2); good=[m for m,n in pairs if m.distance<.72*n.distance]
    if len(good)<12: raise RuntimeError(f'positive control: only {len(good)} SIFT ratio matches')
    src=np.float32([ka[m.queryIdx].pt for m in good]).reshape(-1,1,2); dst=np.float32([kb[m.trainIdx].pt for m in good]).reshape(-1,1,2)
    H,mask=cv2.findHomography(src,dst,cv2.RANSAC,5.0,maxIters=8000,confidence=.999)
    if H is None or mask is None: raise RuntimeError('positive control: homography failed')
    inliers=int(mask.sum()); ratio=inliers/max(1,len(good))
    if inliers<20 or ratio<.25: raise RuntimeError(f'positive control: weak homography {inliers}/{len(good)} ({ratio:.3f})')
    return work,H,scale,len(ka),len(kb),len(good),inliers,ratio

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--cache',type=Path,required=True); ap.add_argument('--image',type=Path,required=True); ap.add_argument('--out-dir',type=Path,required=True); ap.add_argument('--report',type=Path,required=True); ap.add_argument('--world-x',type=float,required=True); ap.add_argument('--world-y',type=float,required=True); ap.add_argument('--source-url',required=True); ap.add_argument('--source-page',required=True); args=ap.parse_args()
    args.out_dir.mkdir(parents=True,exist_ok=True); args.report.parent.mkdir(parents=True,exist_ok=True)
    raw=args.image.read_bytes(); source=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
    if source is None: raise RuntimeError('positive control image decode failed')
    atlas=atlas_z3(args.cache); work,H,scale,k1,k2,good,inliers,ratio=register(source,atlas)
    expected_z3=np.asarray(subtype1_pixel(args.world_x,args.world_y,3),np.float32); expected_z5=expected_z3*4
    inv=np.linalg.inv(H); work_point=cv2.perspectiveTransform(expected_z3.reshape(1,1,2),inv)[0,0]; original=work_point/scale
    mapped=cv2.perspectiveTransform(np.float32([[[original[0]*scale,original[1]*scale]]]),H)[0,0]
    roundtrip=float(np.linalg.norm(mapped-expected_z3))
    crops=[]; h,w=source.shape[:2]
    for size in (192,256,320,384):
        half=size/2; x0=max(0,min(w-size,int(round(original[0]-half)))); y0=max(0,min(h-size,int(round(original[1]-half)))); crop=source[y0:y0+size,x0:x0+size]
        if crop.shape[0]!=size or crop.shape[1]!=size: continue
        name=f'general-shrine-{size}.png'; cv2.imwrite(str(args.out_dir/name),crop)
        crops.append({'file':name,'sourceSize':size,'x0':x0,'y0':y0,'centerSource':[x0+size/2,y0+size/2]})
    report={'schema':'wwmsync-reference-positive-control-source-v1','control':'General Shrine / 将军祠','source':{'page':args.source_page,'image':args.source_url,'imageSha256':hashlib.sha256(raw).hexdigest(),'imageBytes':len(raw),'width':w,'height':h},'expected':{'world':[args.world_x,args.world_y],'dashenZ3':expected_z3.tolist(),'dashenZ5':expected_z5.tolist()},'independentRegistration':{'method':'SIFT ratio test + RANSAC homography, full published in-game map screenshot -> current Dashen z3','sourceKeypoints':k1,'atlasKeypoints':k2,'ratioMatches':good,'inliers':inliers,'inlierRatio':ratio,'sourceResizeScale':scale,'expectedPointInSource':original.tolist(),'expectedRoundTripErrorZ3Px':roundtrip},'crops':crops,'productionMatcherUsedHere':False,'purpose':'The following browser replay runs the unchanged production global matcher diagnostic on these known-location crops.'}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps(report,ensure_ascii=False,indent=2))
if __name__=='__main__': main()
