#!/usr/bin/env python3
"""Replay/CI-only descriptive comparison between a normal PC HUD control and the exact GFN fixture.

This tool does not alter matcher inputs, scores, gates, or production code. It intentionally
refuses to make an H2 causal claim when the normal-PC control did not itself pass global recall.
"""
from __future__ import annotations
import argparse, json, math
from pathlib import Path
import cv2, numpy as np


def read_image(path: Path):
    im=cv2.imread(str(path),cv2.IMREAD_COLOR)
    if im is None: raise RuntimeError(f'cannot decode image: {path}')
    return im

def work_canvas(im, crop_size: int):
    h,w=im.shape[:2]
    n=min(crop_size,h,w)
    roi=im[:n,:n]
    return cv2.resize(roi,(192,192),interpolation=cv2.INTER_AREA)

def percentile(a,q): return float(np.percentile(a,q))

def blockiness(gray, block=8):
    g=gray.astype(np.float32)
    vd=np.abs(g[:,1:]-g[:,:-1]); hd=np.abs(g[1:,:]-g[:-1,:])
    v_idx=np.arange(1,g.shape[1]); h_idx=np.arange(1,g.shape[0])
    vb=vd[:,(v_idx%block)==0]; vi=vd[:,(v_idx%block)!=0]
    hb=hd[(h_idx%block)==0,:]; hi=hd[(h_idx%block)!=0,:]
    boundary=float(np.mean(np.concatenate([vb.ravel(),hb.ravel()])))
    interior=float(np.mean(np.concatenate([vi.ravel(),hi.ravel()])))
    return {'boundaryMean':boundary,'interiorMean':interior,'excess':boundary-interior,'ratio':boundary/max(interior,1e-6)}

def hough_circle(gray):
    blur=cv2.medianBlur(gray,5)
    circles=cv2.HoughCircles(blur,cv2.HOUGH_GRADIENT,dp=1.1,minDist=48,param1=90,param2=30,minRadius=45,maxRadius=94)
    if circles is None: return None
    x,y,r=max(circles[0],key=lambda c:c[2])
    return {'center':[float(x),float(y)],'radiusPx':float(r),'radiusFraction':float(r/192)}

def metrics(im):
    gray=cv2.cvtColor(im,cv2.COLOR_BGR2GRAY)
    ycc=cv2.cvtColor(im,cv2.COLOR_BGR2YCrCb).astype(np.float32)
    hsv=cv2.cvtColor(im,cv2.COLOR_BGR2HSV).astype(np.float32)
    g=gray.astype(np.float32)/255.0
    lap=cv2.Laplacian(g,cv2.CV_32F,ksize=3)
    sx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3); sy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3); mag=np.hypot(sx,sy)
    strong=mag>=np.percentile(mag,85)
    halo=float(np.mean(np.abs(lap)[strong])/max(np.mean(mag[strong]),1e-6)) if np.any(strong) else None
    cr=ycc[:,:,1]-128; cb=ycc[:,:,2]-128; chroma=np.hypot(cr,cb)
    yy,xx=np.ogrid[:192,:192]; rr=np.hypot(xx-96,yy-96)
    center=rr<=34; ann=(rr>=45)&(rr<=82)
    edge_thr=np.percentile(mag,75)
    center_edge=float(np.mean(mag[center]>=edge_thr)); ann_edge=float(np.mean(mag[ann]>=edge_thr))
    # zero-crossing density is a weak ringing/scaling signature, not a codec identifier.
    s=np.sign(lap); zc=((s[:,1:]*s[:,:-1])<0).mean()*.5+((s[1:,:]*s[:-1,:])<0).mean()*.5
    return {
      'dimensions':[192,192],
      'luminance':{'mean':float(g.mean()),'std':float(g.std()),'p10':percentile(g,10),'p50':percentile(g,50),'p90':percentile(g,90),'p90MinusP10':percentile(g,90)-percentile(g,10)},
      'spatialFrequency':{'laplacianVariance':float(lap.var()),'sobelMean':float(mag.mean()),'sobelP90':percentile(mag,90),'edgeDensityP75':float(np.mean(mag>=edge_thr))},
      'compression8x8Proxy':blockiness(gray,8),
      'chroma':{'meanMagnitude':float(chroma.mean()),'p90Magnitude':percentile(chroma,90),'meanSaturation255':float(hsv[:,:,1].mean())},
      'scalingSharpeningProxies':{'laplacianZeroCrossingDensity':float(zc),'strongEdgeHaloRatio':halo},
      'iconMaskingProxy':{'centerEdgeDensity':center_edge,'annulusEdgeDensity':ann_edge,'centerToAnnulusRatio':center_edge/max(ann_edge,1e-6)},
      'effectiveCircleEstimate':hough_circle(gray),
    }

def ratio(gfn,pc):
    out={}
    pairs=[
      ('luminance.std',gfn['luminance']['std'],pc['luminance']['std']),
      ('luminance.rangeP10P90',gfn['luminance']['p90MinusP10'],pc['luminance']['p90MinusP10']),
      ('spatialFrequency.laplacianVariance',gfn['spatialFrequency']['laplacianVariance'],pc['spatialFrequency']['laplacianVariance']),
      ('spatialFrequency.sobelMean',gfn['spatialFrequency']['sobelMean'],pc['spatialFrequency']['sobelMean']),
      ('compression8x8Proxy.ratio',gfn['compression8x8Proxy']['ratio'],pc['compression8x8Proxy']['ratio']),
      ('chroma.meanMagnitude',gfn['chroma']['meanMagnitude'],pc['chroma']['meanMagnitude']),
      ('chroma.meanSaturation255',gfn['chroma']['meanSaturation255'],pc['chroma']['meanSaturation255']),
      ('scalingSharpeningProxies.strongEdgeHaloRatio',gfn['scalingSharpeningProxies']['strongEdgeHaloRatio'],pc['scalingSharpeningProxies']['strongEdgeHaloRatio']),
    ]
    for k,a,b in pairs: out[k]=None if a is None or not b else float(a/b)
    return out

def find_frames(fixture: Path):
    cap_paths=list(fixture.rglob('capture.json'))
    if len(cap_paths)!=1: raise RuntimeError(f'expected exactly one capture.json, got {len(cap_paths)}')
    cap_path=cap_paths[0]; cap=json.loads(cap_path.read_text(encoding='utf-8-sig'))
    frames=[]
    for item in cap.get('frames',[]):
        rel=item.get('minimap') or item.get('minimapFile') or item.get('cropFile')
        if not rel: continue
        p=cap_path.parent/rel
        if p.exists(): frames.append(p)
    if len(frames)!=40: raise RuntimeError(f'expected 40 fixture frames, got {len(frames)}')
    return cap,frames

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--pc-roi',type=Path,required=True); ap.add_argument('--pc-matcher',type=Path,required=True); ap.add_argument('--gfn-fixture',type=Path,required=True); ap.add_argument('--report',type=Path,required=True); args=ap.parse_args()
    matcher=json.loads(args.pc_matcher.read_text(encoding='utf-8'))
    pc_class=matcher.get('classification')
    pc=work_canvas(read_image(args.pc_roi),270); pc_m=metrics(pc)
    cap,frames=find_frames(args.gfn_fixture)
    gfn_imgs=[work_canvas(read_image(p),216) for p in frames]
    gfn_ms=[metrics(x) for x in gfn_imgs]
    def aggregate(path):
        vals=[]
        for m in gfn_ms:
            v=m
            for k in path: v=v[k]
            if isinstance(v,(int,float)) and math.isfinite(v): vals.append(float(v))
        return {'median':float(np.median(vals)),'p10':float(np.percentile(vals,10)),'p90':float(np.percentile(vals,90))} if vals else None
    representative={
      'luminance':{k:aggregate(['luminance',k])['median'] for k in ['mean','std','p10','p50','p90','p90MinusP10']},
      'spatialFrequency':{k:aggregate(['spatialFrequency',k])['median'] for k in ['laplacianVariance','sobelMean','sobelP90','edgeDensityP75']},
      'compression8x8Proxy':{k:aggregate(['compression8x8Proxy',k])['median'] for k in ['boundaryMean','interiorMean','excess','ratio']},
      'chroma':{k:aggregate(['chroma',k])['median'] for k in ['meanMagnitude','p90Magnitude','meanSaturation255']},
      'scalingSharpeningProxies':{k:aggregate(['scalingSharpeningProxies',k])['median'] for k in ['laplacianZeroCrossingDensity','strongEdgeHaloRatio']},
      'iconMaskingProxy':{k:aggregate(['iconMaskingProxy',k])['median'] for k in ['centerEdgeDensity','annulusEdgeDensity','centerToAnnulusRatio']},
      'effectiveCircleEstimate':None,
    }
    circles=[m['effectiveCircleEstimate'] for m in gfn_ms if m.get('effectiveCircleEstimate')]
    if circles:
        representative['effectiveCircleEstimate']={'radiusPxMedian':float(np.median([c['radiusPx'] for c in circles])),'radiusPxP10':float(np.percentile([c['radiusPx'] for c in circles],10)),'radiusPxP90':float(np.percentile([c['radiusPx'] for c in circles],90)),'detections':len(circles)}
    diffs=[]; temporal_block=[]
    for a,b in zip(gfn_imgs,gfn_imgs[1:]):
        ga=cv2.cvtColor(a,cv2.COLOR_BGR2GRAY).astype(np.float32); gb=cv2.cvtColor(b,cv2.COLOR_BGR2GRAY).astype(np.float32); d=np.abs(gb-ga); diffs.append(float(d.mean())); temporal_block.append(blockiness(np.clip(d,0,255).astype(np.uint8),8)['excess'])
    temp={'meanAbsoluteFrameDeltaMedian':float(np.median(diffs)),'meanAbsoluteFrameDeltaP90':float(np.percentile(diffs,90)),'temporalResidual8x8BoundaryExcessMedian':float(np.median(temporal_block)),'note':'Contains real player/camera/minimap motion as well as stream/capture artifacts; it is not a codec-only estimate.'}
    rep_for_ratio={**representative}
    report={
      'schema':'wwmsync-hud-capture-domain-comparison-v1',
      'scope':{'productionChanged':False,'matcherChanged':False,'gateChanged':False,'structuralGate':0.58,'comparisonRole':'descriptive domain characterization only'},
      'pcControl':{'classification':pc_class,'sourceWorkCanvas':'raw production semantic ROI 270x270 resized to 192x192','metrics':pc_m},
      'gfnFixture':{'frameCount':len(frames),'sourceScreen':cap.get('screen'),'sourceWorkCanvas':'each captured minimap frame placed at source origin; unchanged production semantic crop 216x216 resized to 192x192','medianMetrics':representative,'temporal':temp},
      'gfnToPcRatios':ratio(rep_for_ratio,pc_m),
      'representationQuestions':{
        'effectiveMinimapRadius':'Hough estimate reported when a stable circular border is detectable; descriptive only.',
        'localSpatialFrequency':'Sobel/Laplacian statistics reported.',
        'compressionBlocking':'8x8 boundary excess proxy reported; cannot uniquely identify H.264 vs H.265.',
        'edgeAttenuation':'Compare Sobel/Laplacian GFN-to-PC ratios.',
        'contrastGamma':'Luminance distribution reported; no display transfer-function ground truth, so gamma itself is not identified.',
        'chromaLoss':'YCbCr chroma magnitude and HSV saturation reported.',
        'scalingKernelSharpening':'Zero-crossing and strong-edge halo proxies reported; kernel family itself is not identified.',
        'temporalCompression':'Temporal residual proxy reported with motion confound explicitly retained.',
        'iconMasking':'Center-vs-annulus edge-density proxy reported; semantic icon masks are not inferred.',
        'hudOpacityBackgroundBlend':'UNRESOLVED without paired clean scene/reference rendering.'
      },
      'causalInterpretation':{
        'h2TestableFromThisPair':pc_class=='HUD-PASS',
        'controlledDegradationJustified':pc_class=='HUD-PASS',
        'normalizationJustified':False,
        'reason':'Controlled GFN degradation requires at least one known-location normal-PC HUD-PASS. This control is '+str(pc_class)+', so B-vs-C differences cannot establish GFN as the cause of recall failure.'
      }
    }
    args.report.parent.mkdir(parents=True,exist_ok=True); args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'pcClassification':pc_class,'gfnFrames':len(frames),'gfnToPcRatios':report['gfnToPcRatios'],'causalInterpretation':report['causalInterpretation']},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
