#!/usr/bin/env python3
"""Replay-only reference-domain / map-truth audit for WWMSync."""
from __future__ import annotations
import argparse, hashlib, html.parser, json, math, re, statistics, time, urllib.parse, urllib.request
from pathlib import Path
import cv2
import numpy as np

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
CFG_URL='https://inf-act.ds.163.com/v1/act-web/pageConf/commonAppConfig'; CFG_ID='6764d83bbd3f414f635443a5'
MAP_INFO_URL='https://inf.ds.163.com/v1/web/game-map/map-info/get'; POINT_URL='https://inf.ds.163.com/v1/web/game-map/point/list-by-sub-types'; MAP_ID='676d48a37d299d0811946ff1'
OFFICIAL_MAP='https://www.wherewindsmeetgame.com/map/'
POSITIVE_PAGES=['https://ol.3dmgame.com/gl/293382.html','https://www.9game.cn/yyslskfsjwx/10759407.html']
RENDERER_CONTROL='https://i.17173cdn.com/2fhnvk/YWxqaGBf/cms3/NDlSGRbsdbxbfet.jpg'
GLOBAL_BOUNDS=(-2.8,0.0,0.0,2.8)
BRIDGES={'Qinghe':[[-.0008571998713959525,3.105598492965692e-10],[2.2578244634162414e-10,-.0008384564733202777],[-2.5356030330799597,-1.1167063806874027]],'Kaifeng':[[-.0006786008932376111,3.202127447520522e-10],[-5.090606415136117e-10,-.0006518996758809071],[-1.0806951387375319,.5453954425180498]]}
SUB1={'calMeter':1024/1008,'realMeter':256/19456,'xOffset':12095.6875,'yOffset':12095.6875}

def request(url,data=None,timeout=20):
    headers={'User-Agent':UA,'Accept':'*/*'}; body=None
    if data is not None: body=json.dumps(data,ensure_ascii=False).encode(); headers['Content-Type']='application/json;charset=UTF-8'
    with urllib.request.urlopen(urllib.request.Request(url,data=body,headers=headers),timeout=timeout) as r: return r.status,r.headers.get('Content-Type',''),r.read(8_000_000)
def fetch_json(url,data):
    st,ct,b=request(url,data); return {'status':st,'contentType':ct,'sha256':hashlib.sha256(b).hexdigest(),'bytes':len(b),'json':json.loads(b.decode('utf8','replace'))}
def iter_dicts(v):
    if isinstance(v,dict):
        yield v
        for x in v.values(): yield from iter_dicts(x)
    elif isinstance(v,list):
        for x in v: yield from iter_dicts(x)
def item(result,name): return next((x for x in result.get('itemList',[]) if x.get('name')==name),None)
def parse_ext(x,default):
    try: return json.loads(x.get('ext') or json.dumps(default))
    except Exception: return default
def subtype1_pixel(x,y,z):
    f=SUB1['realMeter']*SUB1['calMeter']; return (-x+SUB1['xOffset'])*f*(2**z),(y+SUB1['yOffset'])*f*(2**z)
def bridge_global(x,y,b): return x*b[0][0]+y*b[1][0]+b[2][0],x*b[0][1]+y*b[1][1]+b[2][1]
def in_global(lng,lat):
    a,b,c,d=GLOBAL_BOUNDS; return a<=lng<=b and c<=lat<=d
def load_image(path): return cv2.imread(str(path),cv2.IMREAD_COLOR)
def annulus_mask(h,w):
    yy,xx=np.ogrid[:h,:w]; cx=(w-1)/2; cy=(h-1)/2; r=np.sqrt((xx-cx)**2+(yy-cy)**2); return ((r>=min(h,w)*.12)&(r<=min(h,w)*.44)).astype(np.uint8)*255
def js(a,b):
    a=np.asarray(a,np.float64); b=np.asarray(b,np.float64); a=a/max(1e-12,a.sum()); b=b/max(1e-12,b.sum()); m=.5*(a+b)
    def kl(x,y): q=x>0; return float(np.sum(x[q]*np.log2(x[q]/np.maximum(y[q],1e-12))))
    return .5*kl(a,m)+.5*kl(b,m)
def descriptor(img,mask=None):
    if img is None: return None
    img=cv2.resize(img,(192,192),interpolation=cv2.INTER_AREA); mask=mask if mask is not None else annulus_mask(192,192); hsv=cv2.cvtColor(img,cv2.COLOR_BGR2HSV); gray=cv2.cvtColor(img,cv2.COLOR_BGR2GRAY)
    h=cv2.calcHist([hsv],[0],mask,[18],[0,180]).ravel(); s=cv2.calcHist([hsv],[1],mask,[12],[0,256]).ravel(); g=cv2.calcHist([gray],[0],mask,[16],[0,256]).ravel()
    h/=max(1,h.sum()); s/=max(1,s.sum()); g/=max(1,g.sum())
    gx=cv2.Sobel(gray,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(gray,cv2.CV_32F,0,1,ksize=3); mag=cv2.magnitude(gx,gy); ang=cv2.phase(gx,gy,angleInDegrees=True)%180; valid=mask>0; threshold=float(np.percentile(mag[valid],72)); edge=(mag>=max(8,threshold))&valid
    oh=np.histogram(ang[edge],bins=12,range=(0,180))[0].astype(float); oh/=max(1,oh.sum()); vals=gray[valid].astype(np.float32); hg=np.histogram(vals,bins=32,range=(0,256))[0].astype(float); p=hg/max(1,hg.sum()); p=p[p>0]; entropy=float(-(p*np.log2(p)).sum())/5
    f=np.fft.rfft2(gray.astype(np.float32)-float(gray.mean())); power=np.abs(f)**2; hh,ww=power.shape; yy,xx=np.ogrid[:hh,:ww]; rr=np.sqrt((yy/max(1,hh))**2+(xx/max(1,ww))**2); low=float(power[(rr>.02)&(rr<.16)].mean()); high=float(power[(rr>.22)&(rr<.55)].mean()); hf=math.log1p(high/max(1e-6,low)); kp=cv2.ORB_create(nfeatures=800,fastThreshold=10).detect(gray,mask)[0] or []
    scalars=np.array([float(hsv[:,:,1][valid].mean()/255),float(gray[valid].std()/128),float(edge.sum()/max(1,valid.sum())),entropy,hf,min(1,len(kp)/300)],np.float32); vec=np.concatenate([h,s,g,oh,scalars]).astype(np.float32)
    return {'vec':vec,'h':h,'s':s,'g':g,'orient':oh,'edgeDensity':float(scalars[2]),'entropy':entropy,'hfRatio':hf,'orbDensity':float(scalars[-1])}
def family_summary(rows,fixture_desc):
    vec=np.stack([r['vec'] for r in rows]); fvec=np.mean(np.stack([r['vec'] for r in fixture_desc]),axis=0); center=np.median(vec,axis=0); scale=np.maximum(np.median(np.abs(vec-center),axis=0)*1.4826,.025); d=np.sqrt(np.mean(((vec-center)/scale)**2,axis=1)); fd=float(np.sqrt(np.mean(((fvec-center)/scale)**2))); p90=float(np.quantile(d,.9)); ratio=fd/max(.1,p90)
    agg=lambda k,rs: np.mean(np.stack([r[k] for r in rs]),axis=0); fh,fs,fg,fo=[agg(k,fixture_desc) for k in ['h','s','g','orient']]; rh,rs,rg,ro=[agg(k,rows) for k in ['h','s','g','orient']]
    return {'samples':len(rows),'robustDescriptorDistance':fd,'withinFamilyP90':p90,'distanceRatioToWithinP90':ratio,'jsHue':js(fh,rh),'jsSaturation':js(fs,rs),'jsLuminance':js(fg,rg),'jsOrientation':js(fo,ro),'fixtureEdgeDensity':statistics.mean(r['edgeDensity'] for r in fixture_desc),'referenceEdgeDensity':statistics.mean(r['edgeDensity'] for r in rows),'fixtureEntropy':statistics.mean(r['entropy'] for r in fixture_desc),'referenceEntropy':statistics.mean(r['entropy'] for r in rows),'fixtureHighFrequencyRatio':statistics.mean(r['hfRatio'] for r in fixture_desc),'referenceHighFrequencyRatio':statistics.mean(r['hfRatio'] for r in rows),'screeningVerdict':'PLAUSIBLE-SAME-DOMAIN' if ratio<=2.5 else ('WEAK/INCONCLUSIVE' if ratio<=4 else 'DOMAIN-MISMATCH-LIKELY')}
def build_z3(cache):
    c=np.zeros((2048,2048,3),np.uint8)
    for y in range(8):
        for x in range(8):
            im=load_image(cache/'main'/'3'/f'{x}_{y}.png');
            if im is None: raise RuntimeError(f'missing z3 {x}_{y}')
            c[y*256:(y+1)*256,x*256:(x+1)*256]=im
    return c
class ImgParser(html.parser.HTMLParser):
    def __init__(self): super().__init__(); self.urls=[]
    def handle_starttag(self,tag,attrs):
        if tag.lower()!='img': return
        a=dict(attrs)
        for k in ('data-original','data-src','data-lazy-src','src'):
            if a.get(k): self.urls.append(a[k]); break
def download_page_images(page,out,limit=35):
    rec={'page':page,'status':None,'images':[]}
    try:
        st,ct,b=request(page); rec['status']=st; p=ImgParser(); p.feed(b.decode('utf8','replace')); seen=[]
        for u in p.urls:
            u=urllib.parse.urljoin(page,u)
            if u.startswith('data:') or u in seen: continue
            seen.append(u)
        for u in seen[:limit]:
            try:
                st,cct,data=request(u,timeout=12); im=cv2.imdecode(np.frombuffer(data,np.uint8),cv2.IMREAD_COLOR)
                if im is None or min(im.shape[:2])<180 or len(data)<20000: continue
                dst=out/f'control-{len(rec["images"]):02d}.jpg'; cv2.imwrite(str(dst),im); rec['images'].append({'url':u,'path':str(dst),'bytes':len(data),'width':int(im.shape[1]),'height':int(im.shape[0])})
            except Exception: pass
    except Exception as e: rec['error']=f'{type(e).__name__}: {e}'
    return rec
def register_control(im,atlas,expected):
    scale=min(1.0,1600/max(im.shape[:2])); src=cv2.resize(im,None,fx=scale,fy=scale,interpolation=cv2.INTER_AREA) if scale<1 else im; g1=cv2.cvtColor(src,cv2.COLOR_BGR2GRAY); g2=cv2.cvtColor(atlas,cv2.COLOR_BGR2GRAY); sift=cv2.SIFT_create(nfeatures=8000,contrastThreshold=.02,edgeThreshold=16); k1,d1=sift.detectAndCompute(g1,None); k2,d2=sift.detectAndCompute(g2,None)
    if d1 is None or d2 is None: return {'registered':False,'reason':'no-descriptors'}
    pairs=cv2.BFMatcher(cv2.NORM_L2).knnMatch(d1,d2,k=2); good=[a for a,b in pairs if a.distance<.72*b.distance]
    if len(good)<10: return {'registered':False,'good':len(good),'reason':'insufficient-ratio-matches'}
    a=np.float32([k1[m.queryIdx].pt for m in good]).reshape(-1,1,2); b=np.float32([k2[m.trainIdx].pt for m in good]).reshape(-1,1,2); H,mask=cv2.findHomography(a,b,cv2.RANSAC,5.0,maxIters=6000,confidence=.999)
    if H is None or mask is None: return {'registered':False,'good':len(good),'reason':'homography-failed'}
    inliers=int(mask.sum()); ratio=inliers/max(1,len(good)); h,w=src.shape[:2]; corners=np.float32([[[0,0]],[[w,0]],[[w,h]],[[0,h]]]); poly=cv2.perspectiveTransform(corners,H).reshape(-1,2); inside=cv2.pointPolygonTest(poly.astype(np.float32),(float(expected[0]),float(expected[1])),False)>=0; center=cv2.perspectiveTransform(np.float32([[[w/2,h/2]]]),H)[0,0]
    return {'registered':inliers>=12 and ratio>=.25,'good':len(good),'inliers':inliers,'inlierRatio':ratio,'expectedPoiInsideRegisteredImage':bool(inside),'registeredImageCenterToExpectedPoiPx':float(np.linalg.norm(center-np.asarray(expected))),'mappedImagePolygonZ3':poly.tolist(),'expectedPoiZ3':[float(expected[0]),float(expected[1])],'scaleApplied':scale}
def discover_official_sources():
    report={'page':OFFICIAL_MAP,'status':None,'scripts':[],'networkStrings':[]}
    try:
        st,ct,b=request(OFFICIAL_MAP); report['status']=st; text=b.decode('utf8','replace'); scripts=[urllib.parse.urljoin(OFFICIAL_MAP,u) for u in re.findall(r'<script[^>]+src=["\']([^"\']+)',text,re.I)]; strings=set(re.findall(r'https?://[^"\'\s)<>]+',text))
        for u in scripts[:24]:
            row={'url':u}
            try:
                sct,sctype,sb=request(u,timeout=15); row.update({'status':sct,'contentType':sctype,'bytes':len(sb),'sha256':hashlib.sha256(sb).hexdigest()}); txt=sb.decode('utf8','replace')
                for q in re.findall(r'https?://[^"\'\s)<>]+',txt):
                    if any(k in q.lower() for k in ('map','tile','easebar','netease','163.com','166.net')): strings.add(q[:500])
            except Exception as e: row['error']=f'{type(e).__name__}: {e}'
            report['scripts'].append(row)
        report['networkStrings']=sorted(strings)[:120]
    except Exception as e: report['error']=f'{type(e).__name__}: {e}'
    return report

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--fixture',type=Path,required=True); ap.add_argument('--cache',type=Path,required=True); ap.add_argument('--expanded-invariant',type=Path,required=True); ap.add_argument('--report',type=Path,required=True); ap.add_argument('--work-dir',type=Path,required=True); args=ap.parse_args(); args.work_dir.mkdir(parents=True,exist_ok=True); args.report.parent.mkdir(parents=True,exist_ok=True)
    capture=json.loads((args.fixture/'capture.json').read_text('utf8-sig')); frames=capture.get('frames',[])
    if len(frames)!=40: raise RuntimeError(f'expected 40 frames got {len(frames)}')
    frame_desc=[]
    for f in frames:
        name=f.get('minimap') or f.get('minimapFile') or f.get('cropFile'); im=load_image(args.fixture/name)
        if im is None: raise RuntimeError(f'missing fixture image {name}')
        frame_desc.append(descriptor(im[:216,:216]))
    cfg=fetch_json(CFG_URL,{'id':CFG_ID}); mapinfo=fetch_json(MAP_INFO_URL,{'appKey':'h72'}); points=fetch_json(POINT_URL,{'mapId':MAP_ID,'subTypes':['1','2'],'mapZone':'map12'}); result=cfg['json'].get('result',{}); map_cfg=parse_ext(item(result,'地图信息') or {},{}); subtype_map=parse_ext(item(result,'subType与一级区域映射') or {},{}); planes=item(result,'多位面素材配置') or {'itemList':[]}; plane_rows=[]
    for layer in planes.get('itemList',[]):
        mats=parse_ext(layer,[]); plane_rows.append({'layer':layer.get('name'),'count':len(mats),'mapSubTypes':sorted({str(m.get('mapSubType')) for m in mats if m.get('mapSubType') is not None}),'sources':[m.get('img') for m in mats if m.get('img')]})
    poi=[]
    for r in iter_dicts(points['json']):
        try: st=int(r.get('mapSubType',r.get('subType'))); x=float(r['x']); y=float(r['y'])
        except Exception: continue
        if st==1: poi.append((x,y,r.get('name') or r.get('title') or ''))
    unique={(x,y):name for x,y,name in poi}; cover={'subtype1UniqueCoordinatePoints':len(unique),'boundedFineCache':{'z':5,'minX':12,'maxX':28,'minY':9,'maxY':24},'regions':{}}; xmin=1e9;xmax=-1e9;ymin=1e9;ymax=-1e9; cache_count=0
    for (x,y),name in unique.items():
        px,py=subtype1_pixel(x,y,5); tx,ty=px/256,py/256; xmin=min(xmin,tx);xmax=max(xmax,tx);ymin=min(ymin,ty);ymax=max(ymax,ty); cache_count+=int(12<=tx<29 and 9<=ty<25)
    cover['publicPoiTileSpanZ5']={'minX':xmin,'maxX':xmax,'minY':ymin,'maxY':ymax}; cover['pointsInsideBoundedFineCache']=cache_count; cover['pointsOutsideBoundedFineCache']=len(unique)-cache_count; union=set()
    for name,b in BRIDGES.items():
        ids=set(); bounded=set()
        for xy in unique:
            lng,lat=bridge_global(*xy,b)
            if in_global(lng,lat):
                ids.add(xy); px,py=subtype1_pixel(*xy,5); tx,ty=px/256,py/256
                if 12<=tx<29 and 9<=ty<25: bounded.add(xy)
        union|=ids; cover['regions'][name]={'pointsInsideProductionGlobalBounds':len(ids),'ofThoseInsideBoundedFineCache':len(bounded),'insideBoundsButMissingFineCache':len(ids-bounded)}
    cover['unionProductionGlobalBounds']={'points':len(union),'fractionOfCurrentPublicSubtype1Points':len(union)/max(1,len(unique)),'pointsOutsideUnion':len(unique)-len(union)}
    fam={}; coords_main=[(x,y) for y in range(1,32,4) for x in range(1,32,4)]; coords_small=[(x,y) for y in range(8) for x in range(8)]
    for family,coords in [('main',coords_main),('sub3',coords_small),('sub4',coords_small)]:
        rows=[descriptor(im) for x,y in coords if (im:=load_image(args.cache/family/'5'/f'{x}_{y}.png')) is not None]; fam[family]=family_summary(rows,frame_desc) if rows else {'samples':0,'screeningVerdict':'UNAVAILABLE'}
    ranked=sorted([(v.get('distanceRatioToWithinP90',999),k) for k,v in fam.items()]); domain={'methods':['HSV/luminance histogram JS divergence','edge density','edge-orientation histogram','FFT high-frequency ratio','entropy','ORB keypoint-density diagnostic','robust standardized descriptor distribution'],'note':'Screening only; not an absolute-localization score and not a production gate.','families':fam,'closestPublicRasterFamilyByRobustDistribution':ranked[0][1] if ranked else None,'currentMainPlausibility':fam.get('main',{}).get('screeningVerdict')}
    atlas=build_z3(args.cache); expected_world=next(((x,y) for (x,y),name in unique.items() if name=='将军祠'),None); positive={'expectedControl':'将军祠 / General Shrine','expectedWorld':list(expected_world) if expected_world else None,'sourcePages':POSITIVE_PAGES,'attempts':[],'pass':False}
    if expected_world:
        expected=subtype1_pixel(*expected_world,3); pdir=args.work_dir/'positive'; pdir.mkdir(exist_ok=True)
        for page in POSITIVE_PAGES:
            rec=download_page_images(page,pdir); attempt={'page':page,'fetch':{k:v for k,v in rec.items() if k!='images'},'images':[]}; positive['attempts'].append(attempt)
            for imeta in rec.get('images',[]):
                reg=register_control(load_image(imeta['path']),atlas,expected); attempt['images'].append({**{k:v for k,v in imeta.items() if k!='path'},**reg}); positive['pass'] |= bool(reg.get('registered') and reg.get('expectedPoiInsideRegisteredImage'))
        positive['verdict']='PASS-KNOWN-LOCATION-PUBLIC-GAME-MAP-RENDERER' if positive['pass'] else 'NO-KNOWN-LOCATION-CONTROL-REGISTERED'; positive['limitation']='Proves public Dashen atlas agreement with an independently published in-game map rendering around a known location; does not alone prove HUD minimap artwork/LOD identity.'
    else: positive['verdict']='EXPECTED-POI-NOT-FOUND'
    try:
        st,ct,b=request(RENDERER_CONTROL); im=cv2.imdecode(np.frombuffer(b,np.uint8),cv2.IMREAD_COLOR); rr=register_control(im,atlas,(1024,1024)) if im is not None else {'registered':False}; positive['unanchoredRendererSample']={'url':RENDERER_CONTROL,'status':st,'registeredSomewhere':rr.get('registered',False),'good':rr.get('good'),'inliers':rr.get('inliers')}
    except Exception as e: positive['unanchoredRendererSample']={'url':RENDERER_CONTROL,'error':str(e)}
    official=discover_official_sources(); expanded=json.loads(args.expanded_invariant.read_text('utf8')); ev={'candidateRecallVerdict':expanded.get('candidateRecallVerdict'),'exactRemainingFailureStage':expanded.get('exactRemainingFailureStage'),'productChangeJustified':expanded.get('productChangeJustified'),'best':None}
    if expanded.get('sequenceRankedTopK'):
        b=expanded['sequenceRankedTopK'][0]; ev['best']={'candidate':b.get('candidate'),'sequenceScore':b.get('sequenceScore'),'consistency':{k:b.get('consistency',{}).get(k) for k in ['samePhysicalBasinStable','meanDirectionCosine','endpointDisplacementError','endpointErrorRatio','angleStability','scaleStability']}}
    if ev['candidateRecallVerdict']=='TRUE-LIKE-CANDIDATE-SURFACED': decision='CASE-COVERAGE-CANDIDATE-SURFACED'; remaining='expanded-reference-domain-candidate-requires-production-independent-validation'
    elif not positive.get('pass'): decision='CASE-B-OR-D-POSITIVE-CONTROL-NOT-PROVEN'; remaining='reference-domain-positive-control'
    elif fam.get('main',{}).get('screeningVerdict')=='DOMAIN-MISMATCH-LIKELY': decision='CASE-D-HUD-MINIMAP-DOMAIN-MISMATCH-LIKELY'; remaining='hud-minimap-to-public-raster-domain-correspondence'
    else: decision='CASE-A-REFERENCE-RENDERER-CONTROL-PASSES-BUT-FIXTURE-STILL-NO-TRUE-LIKE'; remaining='reference-domain-hud-minimap-or-region-lineage-discrimination'
    report={'schema':'wwmsync-reference-domain-truth-audit-v1','generatedAtUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'scope':{'replayOnly':True,'productionSourceChanged':False,'productionGateChanged':False,'structuralGate':0.58,'newProductionMatcher':False},'fixture':{'frameCount':len(frames),'fps':capture.get('fps'),'intervalMs':capture.get('intervalMs')},'publicSources':{'dashenConfig':{'url':CFG_URL,'request':{'id':CFG_ID},'status':cfg['status'],'sha256':cfg['sha256'],'updateTime':result.get('updateTime')},'dashenMapInfo':{'url':MAP_INFO_URL,'request':{'appKey':'h72'},'status':mapinfo['status'],'sha256':mapinfo['sha256']},'dashenPointCatalog':{'url':POINT_URL,'mapId':MAP_ID,'mapZone':'map12','subTypes':['1','2'],'status':points['status'],'sha256':points['sha256']},'officialGlobalInteractiveMap':official,'positiveControlPages':POSITIVE_PAGES},'referenceInventory':{'mapConfig':map_cfg,'subTypeToZone':subtype_map,'multiPlaneMaterials':plane_rows},'coverage':cover,'domainSimilarity':domain,'positiveControl':positive,'expandedFullMainReplay':ev,'decision':decision,'exactRemainingFailureStage':remaining,'productionChangeJustified':ev['candidateRecallVerdict']=='TRUE-LIKE-CANDIDATE-SURFACED','liveTestingJustified':False,'acceptance':{'SYNTHETIC':'PASS','REAL_GFN':'FAIL','REAL_LOCAL':'UNAVAILABLE','LIVE_E2E':'PENDING / NOT JUSTIFIED'}}
    args.report.write_text(json.dumps(report,ensure_ascii=False,indent=2),'utf8'); print(json.dumps({'decision':decision,'exactRemainingFailureStage':remaining,'coverage':cover['unionProductionGlobalBounds'],'domainMain':fam.get('main'),'positiveControl':{'pass':positive.get('pass'),'verdict':positive.get('verdict')},'expandedFullMainReplay':ev,'productionChangeJustified':report['productionChangeJustified'],'liveTestingJustified':False},ensure_ascii=False,indent=2))
if __name__=='__main__': main()
