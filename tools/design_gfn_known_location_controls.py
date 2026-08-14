#!/usr/bin/env python3
import argparse, hashlib, json, math, re, time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import cv2
import numpy as np
import requests

DASHEN_MAP_ID = '676d48a37d299d0811946ff1'
DASHEN_CATALOG_URL = 'https://inf.ds.163.com/v1/web/game-map/point/list-by-sub-types'
GLOBAL_CATALOG = 'https://s2.easebar.com/39f12eda6b86452b/api/map/points?mapId={map_id}&lang={lang}'
TILE_URL = 'https://img.166.net/canonical/h72/tilemap/v15.0/5/{x}_{y}.png?imageView&v=1'
REFERENCE_FAMILY = 'dashen-main-v15-z5'
WORLD_TO_Z5_FACTOR = (256.0 / 19456.0) * (1024.0 / 1008.0) * 32.0
BRIDGES = {
    1: np.array([[-0.0008571998713959525, 3.105598492965692e-10],
                 [2.2578244634162414e-10, -0.0008384564733202777],
                 [-2.5356030330799597, -1.1167063806874027]], dtype=np.float64),
    2: np.array([[-0.0006786008932376111, 3.202127447520522e-10],
                 [-5.090606415136117e-10, -0.0006518996758809071],
                 [-1.0806951387375319, 0.5453954425180498]], dtype=np.float64),
}
REGION = {1: 'Qinghe', 2: 'Kaifeng'}
EXISTING = {
    'east-cross': {'name': 'East Cross Street', 'pointId': '20212', 'map': 2, 'z5': (5219.931321637427, 4648.817136173768)},
    'general-shrine': {'name': "General's Shrine", 'pointId': '20102', 'map': 1, 'z5': (6015.017126148705, 3889.360588972433)},
    'fang-xu': {'name': 'Steam Fang Xu Global-PC HUD', 'pointId': None, 'map': 1, 'z5': (5983.1277673350005, 3862.4348370927314)},
}
WATER_RE = re.compile(r'(lake|river|shore|strand|pond|canal|crossing|pier|harbor|spring|stream|ferry|sea|water|湖|河|浦|渡|潭|海|岸|川|津|渠|江|溪|泉|水)', re.I)
URBAN_RE = re.compile(r'(temple|street|village|town|market|prefecture|gate|avenue|bazaar|hall|manor|station|academy|granary|fort|寺|街|村|镇|市|府|门|坊|驿|馆|院|仓|城|寨)', re.I)


def sha256_bytes(b): return hashlib.sha256(b).hexdigest()
def canonical_json(obj): return json.dumps(obj, ensure_ascii=False, sort_keys=True, separators=(',', ':')).encode('utf-8')
def gc(v): return int(str(v), 8) / 1e5


def request_bytes(session, method, url, **kwargs):
    err = None
    for attempt in range(4):
        try:
            r = session.request(method, url, timeout=(10, 45), **kwargs)
            r.raise_for_status()
            return r.content
        except Exception as e:
            err = e
            time.sleep(1.5 * (attempt + 1))
    raise RuntimeError(f'fetch failed: {url}: {err}')


def fetch_catalogs(out):
    s = requests.Session()
    s.headers.update({'User-Agent': 'Mozilla/5.0 AppleWebKit/537.36 Chrome/131 Safari/537.36'})
    raw = {}
    payload = {'mapId': DASHEN_MAP_ID, 'subTypes': ['1', '2'], 'mapZone': 'map12'}
    raw['dashen-map12.json'] = request_bytes(s, 'POST', DASHEN_CATALOG_URL, json=payload, headers={'Content-Type':'application/json;charset=UTF-8'})
    for mid in (1,2):
        for lang in ('zh-CN','en-US'):
            raw[f'global-map-{mid}-{lang}.json'] = request_bytes(s, 'GET', GLOBAL_CATALOG.format(map_id=mid, lang=lang))
    catdir = out/'catalogs'; catdir.mkdir(parents=True, exist_ok=True)
    provenance = {'dashenMapId':DASHEN_MAP_ID,'dashenCatalogUrl':DASHEN_CATALOG_URL,'globalCatalogUrlTemplate':GLOBAL_CATALOG,'tileUrlTemplate':TILE_URL,'referenceFamily':REFERENCE_FAMILY,'catalogs':{}}
    parsed = {}
    for name,b in raw.items():
        (catdir/name).write_bytes(b)
        provenance['catalogs'][name] = {'sha256':sha256_bytes(b),'bytes':len(b)}
        parsed[name] = json.loads(b.decode('utf-8'))
    return parsed, provenance


def global_boundary_points(j):
    out=[]
    for parent in j.get('data',{}).get('categories',[]):
        for cat in parent.get('childCategories',[]):
            if int(cat.get('id',-1)) == 3:
                out.extend(cat.get('pointList',[]))
    return out


def z5_from_world(x,y):
    return ((-x + 12095.6875)*WORLD_TO_Z5_FACTOR, (y + 12095.6875)*WORLD_TO_Z5_FACTOR)


def build_pool(parsed):
    dash = parsed['dashen-map12.json'].get('result',[])
    dash = [d for d in dash if str(d.get('mapSubType'))=='1' and str(d.get('layer','0'))=='0' and '2' in [str(x) for x in d.get('series',[])]]
    di=defaultdict(list)
    for d in dash:
        name=str(d.get('name','')).strip()
        if name: di[name].append(d)
    pool=[]; rejected=[]
    for mid in (1,2):
        zh=global_boundary_points(parsed[f'global-map-{mid}-zh-CN.json'])
        en=global_boundary_points(parsed[f'global-map-{mid}-en-US.json'])
        zi=defaultdict(list)
        for p in zh:
            name=str(p.get('name','')).strip()
            if name: zi[name].append(p)
        eni={str(p.get('id')):p for p in en}
        B=BRIDGES[mid]
        for name, glist in zi.items():
            if len(glist)!=1 or len(di.get(name,[]))!=1: continue
            d=di[name][0]; g=glist[0]
            try:
                world=np.array([float(d['x']),float(d['y']),1.0])
                pred=world@B
                actual=np.array([gc(g['lng']),gc(g['lat'])])
                residual=float(np.linalg.norm(pred-actual))
            except Exception:
                continue
            if residual > 5e-5:
                rejected.append({'pointId':str(d.get('pointId')),'name':name,'reason':'lineage-residual','residual':residual})
                continue
            ep=eni.get(str(g.get('id')))
            if not ep:
                rejected.append({'pointId':str(d.get('pointId')),'name':name,'reason':'missing-en-lineage'})
                continue
            zx,zy=z5_from_world(float(d['x']),float(d['y']))
            pool.append({
                'pointId':str(d['pointId']), 'canonicalName':name, 'englishName':str(ep.get('name') or '').strip() or None,
                'mapRegion':REGION[mid], 'globalMapId':mid, 'mapId':str(d.get('mapId') or DASHEN_MAP_ID), 'mapSubType':str(d.get('mapSubType')),
                'worldX':float(d['x']), 'worldY':float(d['y']), 'z5X':zx, 'z5Y':zy, 'expectedReferenceFamily':REFERENCE_FAMILY,
                'lineage':{'globalPointId':str(g['id']),'globalChineseName':str(g['name']),'globalEnglishName':str(ep.get('name') or ''),'bridgeResidual':residual}
            })
    byid=defaultdict(list)
    for r in pool: byid[r['pointId']].append(r)
    unique=[]
    for pid,rs in byid.items():
        if len(rs)==1: unique.append(rs[0])
        else: rejected.append({'pointId':pid,'name':rs[0]['canonicalName'],'reason':'multi-map-lineage'})
    unique.sort(key=lambda r:(r['globalMapId'],r['pointId']))
    lineage_count=len(unique)
    eligible=[]
    for r in unique:
        if r['pointId'] in {EXISTING['east-cross']['pointId'],EXISTING['general-shrine']['pointId']}:
            r['exclusion']='existing-owner-control'; continue
        too_close=[]
        for eid,e in EXISTING.items():
            if r['globalMapId']==e['map']:
                dist=math.hypot(r['z5X']-e['z5'][0],r['z5Y']-e['z5'][1])
                if dist < 320.0: too_close.append({'id':eid,'distanceZ5':dist})
        if too_close:
            r['exclusion']='existing-control-neighborhood'; r['existingDistances']=too_close; continue
        eligible.append(r)
    return unique, eligible, rejected, lineage_count


def tile_xy_for_patch(cx,cy,half=128):
    xs=range(max(0,int(math.floor((cx-half)/256))), min(31,int(math.floor((cx+half-1)/256)))+1)
    ys=range(max(0,int(math.floor((cy-half)/256))), min(31,int(math.floor((cy+half-1)/256)))+1)
    return {(x,y) for y in ys for x in xs}


def fetch_tiles(out, centers):
    needed=set()
    for cx,cy in centers: needed |= tile_xy_for_patch(cx,cy)
    tdir=out/'tiles-z5'; tdir.mkdir(parents=True,exist_ok=True)
    def one(xy):
        x,y=xy; p=tdir/f'{x}_{y}.png'
        if p.exists() and p.stat().st_size>100: return xy,sha256_bytes(p.read_bytes())
        s=requests.Session(); s.headers.update({'User-Agent':'Mozilla/5.0 AppleWebKit/537.36 Chrome/131 Safari/537.36'})
        b=request_bytes(s,'GET',TILE_URL.format(x=x,y=y))
        arr=np.frombuffer(b,np.uint8); im=cv2.imdecode(arr,cv2.IMREAD_COLOR)
        if im is None or im.shape[0]!=256 or im.shape[1]!=256: raise RuntimeError(f'invalid tile {x},{y}')
        p.write_bytes(b); return xy,sha256_bytes(b)
    hashes={}
    with ThreadPoolExecutor(max_workers=16) as ex:
        fut={ex.submit(one,xy):xy for xy in sorted(needed)}
        for f in as_completed(fut):
            xy,h=f.result(); hashes[f'{xy[0]}_{xy[1]}']=h
    return tdir, hashes


def crop_patch(tdir,cx,cy,size=256):
    half=size//2; x0=int(round(cx))-half; y0=int(round(cy))-half
    canvas=np.zeros((size,size,3),np.uint8)
    for ty in range(math.floor(y0/256), math.floor((y0+size-1)/256)+1):
        for tx in range(math.floor(x0/256), math.floor((x0+size-1)/256)+1):
            if tx<0 or ty<0 or tx>31 or ty>31: continue
            im=cv2.imread(str(tdir/f'{tx}_{ty}.png'),cv2.IMREAD_COLOR)
            if im is None: raise RuntimeError(f'missing tile {tx}_{ty}')
            sx0=max(x0,tx*256); sy0=max(y0,ty*256); sx1=min(x0+size,(tx+1)*256); sy1=min(y0+size,(ty+1)*256)
            canvas[sy0-y0:sy1-y0,sx0-x0:sx1-x0]=im[sy0-ty*256:sy1-ty*256,sx0-tx*256:sx1-tx*256]
    return canvas


def entropy_norm(gray):
    hist=cv2.calcHist([gray],[0],None,[256],[0,256]).ravel(); p=hist/hist.sum(); p=p[p>0]
    return float(-(p*np.log2(p)).sum()/8.0)


def hog_descriptor(gray):
    g=cv2.resize(gray,(128,128),interpolation=cv2.INTER_AREA).astype(np.float32)/255.0
    gx=cv2.Sobel(g,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(g,cv2.CV_32F,0,1,ksize=3)
    mag=cv2.magnitude(gx,gy); ang=(cv2.phase(gx,gy,angleInDegrees=True)%180.0)
    feats=[]
    for cy in range(4):
        for cx in range(4):
            m=mag[cy*32:(cy+1)*32,cx*32:(cx+1)*32]; a=ang[cy*32:(cy+1)*32,cx*32:(cx+1)*32]
            h=np.zeros(8,np.float32); bins=np.floor(a/22.5).astype(np.int32)%8
            for b in range(8): h[b]=float(m[bins==b].sum())
            h=h/(float(np.linalg.norm(h))+1e-8); feats.extend(h.tolist())
    v=np.array(feats,np.float32); v/=float(np.linalg.norm(v)+1e-8); return v


def morphology(patch):
    gray=cv2.cvtColor(patch,cv2.COLOR_BGR2GRAY); blur=cv2.GaussianBlur(gray,(3,3),0)
    gx=cv2.Sobel(blur,cv2.CV_32F,1,0,ksize=3); gy=cv2.Sobel(blur,cv2.CV_32F,0,1,ksize=3)
    mag=cv2.magnitude(gx,gy); ang=(cv2.phase(gx,gy,angleInDegrees=True)%180.0)
    med=float(np.median(gray)); lo=max(0,int(0.66*med)); hi=min(255,int(1.33*med)+1)
    edges=cv2.Canny(blur,lo,hi); edge_density=float((edges>0).mean())
    kp=cv2.ORB_create(nfeatures=600,fastThreshold=12).detect(gray,None); feature_density=min(1.0,len(kp)/450.0)
    quiet=float((mag<18.0).mean()); mask=mag>30.0; hist=np.zeros(12,np.float64)
    bins=np.floor(ang[mask]/15.0).astype(np.int32)%12; weights=mag[mask]
    for b in range(12): hist[b]=float(weights[bins==b].sum())
    if hist.sum()>0:
        p=hist/hist.sum(); pp=p[p>0]; orient=float(-(pp*np.log2(pp)).sum()/math.log2(12.0))
    else: orient=0.0
    lines=cv2.HoughLinesP(edges,1,np.pi/180,threshold=40,minLineLength=18,maxLineGap=6); line_len=0.0
    if lines is not None:
        for l in lines[:,0,:]: line_len += math.hypot(float(l[2]-l[0]),float(l[3]-l[1]))
    line_density=min(1.0,line_len/(256.0*256.0*0.35))
    yy,xx=np.indices(gray.shape); rr=np.hypot(xx-127.5,yy-127.5); vals=[]
    for a,b in [(0,32),(32,64),(64,96),(96,128)]:
        m=(rr>=a)&(rr<b); vals.append(float((edges[m]>0).mean()) if m.any() else 0.0)
    radial=min(1.0,float(np.std(vals)/(np.mean(vals)+1e-6)))
    base=edges.astype(np.float32)/255.0; base=(base-base.mean())/(base.std()+1e-6); corrs=[]
    for dy,dx in [(0,32),(0,48),(0,64),(32,0),(48,0),(64,0),(32,32),(32,-32),(48,48),(48,-48),(64,64),(64,-64)]:
        y0=max(0,dy); y1=min(256,256+dy); x0=max(0,dx); x1=min(256,256+dx)
        a=base[y0:y1,x0:x1]; b=base[y0-dy:y1-dy,x0-dx:x1-dx]
        if a.size>1000: corrs.append(float(np.mean(a*b)))
    repet=float(np.clip((max(corrs) if corrs else 0.0),0.0,1.0))
    return {'edgeDensity':edge_density,'featureDensity':feature_density,'entropy':entropy_norm(gray),'quietSpaceOccupancy':quiet,'orientationEntropy':orient,'lineDensity':line_density,'radialEdgeImbalance':radial,'localSelfSimilarity':repet}, hog_descriptor(gray)


def percentile_rank(vals, x):
    a=np.asarray(vals,float); return float((np.sum(a < x)+0.5*np.sum(a==x))/len(a)) if len(a) else 0.5


def eligible_after_distance(selected, cand):
    for s in selected:
        if cand['globalMapId']==s['globalMapId'] and math.hypot(cand['z5X']-s['z5X'],cand['z5Y']-s['z5Y'])<360.0: return False
        if float(np.dot(cand['_desc'],s['_desc']))>0.965: return False
    return True


def select_controls(cands):
    keys=['edgeDensity','featureDensity','entropy','quietSpaceOccupancy','orientationEntropy','lineDensity','radialEdgeImbalance','localSelfSimilarity','nearestNeighborAmbiguity','wrongNeighborhoodAmbiguity','structuralUniqueness']
    values={k:[c['morphology'][k] for c in cands] for k in keys}
    for c in cands: c['_p']={k:percentile_rank(values[k],c['morphology'][k]) for k in keys}
    def unique_score(c):
        p=c['_p']; return .48*p['structuralUniqueness']+.18*p['orientationEntropy']+.14*p['edgeDensity']+.12*p['featureDensity']+.08*p['entropy']
    def urban_score(c):
        p=c['_p']; sem=1.0 if URBAN_RE.search((c.get('englishName') or '')+' '+c['canonicalName']) else 0.0
        return .26*(1-abs(p['edgeDensity']-.68))+.24*(1-abs(p['featureDensity']-.68))+.22*(1-abs(p['lineDensity']-.65))+.18*(1-abs(p['entropy']-.65))+.10*sem
    def water_score(c):
        p=c['_p']; coherent=1-p['orientationEntropy']; return .28*p['quietSpaceOccupancy']+.22*p['radialEdgeImbalance']+.18*coherent+.12*p['edgeDensity']+.20
    def quiet_score(c):
        p=c['_p']; return .38*p['quietSpaceOccupancy']+.22*(1-p['edgeDensity'])+.18*(1-p['featureDensity'])+.14*(1-p['entropy'])+.08*(1-p['lineDensity'])
    def repeat_score(c):
        p=c['_p']; amb=max(p['nearestNeighborAmbiguity'],p['wrongNeighborhoodAmbiguity']); return .44*amb+.30*p['localSelfSimilarity']+.14*(1-p['structuralUniqueness'])+.12*p['edgeDensity']
    selected=[]
    def pick(score_fn, filt=lambda c:True):
        ids={s['pointId'] for s in selected}; opts=[c for c in cands if c['pointId'] not in ids and filt(c) and eligible_after_distance(selected,c)]
        if not opts: raise RuntimeError('selection stratum exhausted under frozen diversity constraints')
        return max(opts,key=lambda c:(score_fn(c),-int(re.sub(r'\D','',c['pointId']) or 0)))
    c1=pick(unique_score); c1['_stratum']='high-uniqueness / structurally distinctive'; c1['_score']=unique_score(c1); selected.append(c1)
    other=2 if c1['globalMapId']==1 else 1
    c2=pick(unique_score,lambda c:c['globalMapId']==other); c2['_stratum']='high-uniqueness / different region-context'; c2['_score']=unique_score(c2); selected.append(c2)
    c3=pick(urban_score); c3['_stratum']='moderate-density urban'; c3['_score']=urban_score(c3); selected.append(c3)
    water=lambda c: bool(WATER_RE.search((c.get('englishName') or '')+' '+c['canonicalName']))
    c4=pick(water_score,water); c4['_stratum']='water / strong boundary geometry'; c4['_score']=water_score(c4); selected.append(c4)
    c5=pick(quiet_score); c5['_stratum']='quiet / sparse geometry'; c5['_score']=quiet_score(c5); selected.append(c5)
    c6=pick(repeat_score); c6['_stratum']='repetitive / ambiguous geometry'; c6['_score']=repeat_score(c6); selected.append(c6)
    return selected


def nearest_landmark(c, allc):
    same=[x for x in allc if x['globalMapId']==c['globalMapId'] and x['pointId']!=c['pointId']]
    if not same:return None
    n=min(same,key=lambda x:math.hypot(c['z5X']-x['z5X'],c['z5Y']-x['z5Y']))
    return {'name':n.get('englishName') or n['canonicalName'],'canonicalName':n['canonicalName'],'pointId':n['pointId'],'distanceZ5':round(math.hypot(c['z5X']-n['z5X'],c['z5Y']-n['z5Y']),3)}


def clean_control(c, idx, allc):
    return {'controlId':f'GFN-KL-{idx:02d}','pointId':c['pointId'],'canonicalName':c['canonicalName'],'englishName':c.get('englishName'),'mapRegion':c['mapRegion'],'mapId':c['mapId'],'globalMapId':c['globalMapId'],'mapSubType':c['mapSubType'],'world':{'x':c['worldX'],'y':c['worldY']},'z5':{'x':c['z5X'],'y':c['z5Y']},'expectedReferenceFamily':c['expectedReferenceFamily'],'morphology':{k:round(float(v),8) for k,v in c['morphology'].items()},'stratum':c['_stratum'],'selectionScore':round(float(c['_score']),8),'rationale':None,'lineage':c['lineage'],'nearbyLandmark':nearest_landmark(c,allc)}


def make_rationale(ctrl):
    m=ctrl['morphology']; s=ctrl['stratum']
    if s.startswith('high-uniqueness'): return f"Selected pre-acquisition for high structural uniqueness ({m['structuralUniqueness']:.3f}) with edge/feature support ({m['edgeDensity']:.3f}/{m['featureDensity']:.3f}); lineage is independent of matcher output."
    if s.startswith('moderate-density urban'): return f"Selected as an urban/building-density proxy with edge {m['edgeDensity']:.3f}, line {m['lineDensity']:.3f}, feature {m['featureDensity']:.3f}; intended to test dense local discrimination without choosing the absolute densest patch."
    if s.startswith('water'): return f"Catalog identity is water/boundary-associated and reference patch combines quiet occupancy {m['quietSpaceOccupancy']:.3f} with boundary imbalance {m['radialEdgeImbalance']:.3f}; intended to expose shoreline/boundary behavior."
    if s.startswith('quiet'): return f"Selected from the sparse tail: quiet occupancy {m['quietSpaceOccupancy']:.3f}, edge {m['edgeDensity']:.3f}, feature {m['featureDensity']:.3f}; intended to stress low-information recall and gating."
    return f"Selected from the ambiguity tail: self-similarity {m['localSelfSimilarity']:.3f}, nearest-teleport ambiguity {m['nearestNeighborAmbiguity']:.3f}, wrong-neighborhood ambiguity {m['wrongNeighborhoodAmbiguity']:.3f}; intended to stress repetitive/symmetric confusion."


def acquisition_order(controls):
    order=[]
    for mid in (1,2):
        rem=[c for c in controls if c['globalMapId']==mid]
        if not rem: continue
        cur=min(rem,key=lambda c:c['controlId']); rem.remove(cur); order.append(cur['controlId'])
        while rem:
            nxt=min(rem,key=lambda c:math.hypot(c['z5']['x']-cur['z5']['x'],c['z5']['y']-cur['z5']['y']))
            rem.remove(nxt); order.append(nxt['controlId']); cur=nxt
    return order


def diversity_matrix(controls, selected_raw):
    byid={c['pointId']:c for c in selected_raw}; rows=[]
    for a in controls:
        row=[]
        for b in controls:
            ra,rb=byid[a['pointId']],byid[b['pointId']]; sim=float(np.dot(ra['_desc'],rb['_desc'])); same=a['globalMapId']==b['globalMapId']
            dist=math.hypot(a['z5']['x']-b['z5']['x'],a['z5']['y']-b['z5']['y']) if same else None
            row.append({'controlId':b['controlId'],'descriptorCosine':round(sim,6),'sameRegion':same,'z5Distance':round(dist,3) if dist is not None else None})
        rows.append({'controlId':a['controlId'],'comparisons':row})
    return rows


def manifest_sha_payload(manifest):
    x=json.loads(json.dumps(manifest)); x.pop('manifestSha256',None); return sha256_bytes(canonical_json(x))


def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--output-dir',required=True); ap.add_argument('--frozen-manifest'); args=ap.parse_args()
    out=Path(args.output_dir); out.mkdir(parents=True,exist_ok=True)
    parsed,prov=fetch_catalogs(out); lineage,eligible,rejected,lineage_count=build_pool(parsed)
    wrong_centers=[(float(x),float(y)) for y in range(512,7681,768) for x in range(512,7681,768)]
    centers=[(c['z5X'],c['z5Y']) for c in eligible]+wrong_centers; tdir,tile_hashes=fetch_tiles(out,centers)
    prov['tileCount']=len(tile_hashes); prov['tileSetSha256']=sha256_bytes(canonical_json(tile_hashes)); prov['tiles']=tile_hashes
    for c in eligible:
        m,d=morphology(crop_patch(tdir,c['z5X'],c['z5Y'])); c['morphology']=m; c['_desc']=d
    wrong_desc=[]
    for cx,cy in wrong_centers:
        _,d=morphology(crop_patch(tdir,cx,cy)); wrong_desc.append(((cx,cy),d))
    for i,c in enumerate(eligible):
        nn=max((float(np.dot(c['_desc'],o['_desc'])) for j,o in enumerate(eligible) if i!=j),default=0.0)
        wa=max((float(np.dot(c['_desc'],d)) for (xy,d) in wrong_desc if math.hypot(c['z5X']-xy[0],c['z5Y']-xy[1])>=384.0),default=0.0)
        c['morphology']['nearestNeighborAmbiguity']=float(np.clip(nn,0,1)); c['morphology']['wrongNeighborhoodAmbiguity']=float(np.clip(wa,0,1)); c['morphology']['structuralUniqueness']=float(np.clip(1-max(nn,wa),0,1))
    selected=select_controls(eligible); controls=[clean_control(c,i+1,lineage) for i,c in enumerate(selected)]
    for c in controls: c['rationale']=make_rationale(c)
    order=acquisition_order(controls)
    manifest={
        'schema':'wwmsync-gfn-known-location-control-set-v1','status':'FROZEN_PRE_ACQUISITION','designedAtUtc':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),
        'sourceCatalogProvenance':prov,
        'candidatePool':{'lineageEligibleBeforeExistingExclusions':lineage_count,'eligibleAfterExistingControlNeighborhoodExclusions':len(eligible),'rejectedLineageRecords':len(rejected)},
        'morphologyDefinition':{'patch':'256x256 centered on independently computed Dashen main z5 coordinate','edgeDensity':'Canny edge occupancy','featureDensity':'ORB keypoint count normalized/clipped at 450','entropy':'8-bit grayscale Shannon entropy / 8','quietSpaceOccupancy':'fraction Sobel magnitude < 18','orientationEntropy':'12-bin magnitude-weighted gradient orientation entropy / log2(12)','lineDensity':'Hough segment length normalized by patch area','radialEdgeImbalance':'CV of edge density across four radial annuli, clipped [0,1]','localSelfSimilarity':'maximum normalized translated edge autocorrelation over fixed 32/48/64 px shifts','nearestNeighborAmbiguity':'maximum cosine similarity of 4x4x8 HOG-like descriptor to another eligible teleport neighborhood','wrongNeighborhoodAmbiguity':'maximum cosine similarity to deterministic z5 grid wrong neighborhoods >=384 px away','structuralUniqueness':'1 - max(nearestNeighborAmbiguity, wrongNeighborhoodAmbiguity)'},
        'selectionRule':{'preAcquisition':True,'lineageResidualMax':5e-5,'existingControlExclusionRadiusZ5':320,'selectedSameRegionMinDistanceZ5':360,'selectedDescriptorMaxCosine':0.965,'control1':'maximize bounded high-uniqueness composite','control2':'same composite but force other Qinghe/Kaifeng region','control3':'moderate-density urban composite with catalog-semantic urban tie support','control4':'water/boundary composite restricted to catalog water/boundary identity','control5':'maximize quiet/sparse composite','control6':'maximize repetitiveness/ambiguity composite','antiSwap':'point IDs and metrics freeze before any new owner recording; later HUD outcomes may not alter selection'},
        'controls':controls,'frozenAcquisitionOrder':order,
        'existingControlsNotCountedAsNew':[{'id':k,**v} for k,v in EXISTING.items()],
        'futureClassificationProtocol':['RCL-1','RCL-2','RCL-3','RCL-4','RCL-5','RCL-MIXED'],
        'sampleSizePlan':{'newOwnerControls':6,'existingOwnerControls':2,'ownerGfnKnownLocationN':8,'fangXuIndependentNonOwnerControlCountedInN':False,'perClassReporting':['count/8','Wilson 95% interval (descriptive only)','morphology association','occurrence across multiple morphology strata'],'populationPrevalenceClaimAllowed':False},
        'architectureDecisionRules':{'A1':'If a common recall/pose-survival class appears across multiple new independent controls and materially dominates other mechanisms, a bounded architecture round targeting that class becomes justified.','A2':'If RCL-5 dominates across diverse controls, candidate beam/search changes are deprioritized and representation/scoring architecture becomes primary.','A3':'If structurally correct basins frequently survive but fail a consistent secondary acceptance signal, investigate that signal causally; do not lower gates automatically.','A4':'If multiple failure classes remain common with no dominant mechanism, do not seek a universal one-knob fix; next architecture must explicitly support heterogeneous failure modes.'},
        'recordingProtocol':['Open world map','Visibly select the frozen teleport point','Leave selection visible about 1 second','Teleport','Close world map','Do not move','Wait until HUD/minimap settles','Remain stationary about 2-3 seconds','Proceed to next frozen location'],
        'guardrails':{'matcherExperiments':False,'structuralGate':0.58,'visionSyncModified':False,'dashenTileCacheModified':False,'dashenVisualCacheBuilderModified':False,'resolutionFixed':False,'gfnGraphics':'high preferred','oneContinuousOriginalRecordingSufficient':True}
    }
    manifest['morphologyDiversityMatrix']=diversity_matrix(controls,selected); manifest['manifestSha256']=manifest_sha_payload(manifest)
    pool_out=[]
    for c in eligible:
        d={k:v for k,v in c.items() if not k.startswith('_')}; d['morphology']={k:round(float(v),8) for k,v in c['morphology'].items()}; pool_out.append(d)
    (out/'candidate-pool.json').write_text(json.dumps({'lineage':lineage,'eligible':pool_out,'rejected':rejected},ensure_ascii=False,indent=2),encoding='utf8')
    (out/'source-provenance.json').write_text(json.dumps(prov,ensure_ascii=False,indent=2),encoding='utf8')
    (out/'selection-manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')
    lines=['# GFN known-location control set design','','Status: FROZEN_PRE_ACQUISITION','',f"Lineage-eligible before exclusions: {lineage_count}",f"Eligible after existing-control neighborhood exclusions: {len(eligible)}",'', '## Selected controls']
    for c in controls:
        lines += ['',f"### {c['controlId']} — {c['englishName'] or c['canonicalName']}",f"- pointId: `{c['pointId']}`",f"- canonical: `{c['canonicalName']}`",f"- region: {c['mapRegion']}",f"- world: ({c['world']['x']}, {c['world']['y']})",f"- z5: ({c['z5']['x']}, {c['z5']['y']})",f"- stratum: {c['stratum']}",f"- rationale: {c['rationale']}"]
    lines += ['', '## Frozen acquisition order', '', ' → '.join(order), '', f"Manifest semantic SHA-256: `{manifest['manifestSha256']}`"]
    (out/'selection-report.md').write_text('\n'.join(lines)+'\n',encoding='utf8')
    if args.frozen_manifest:
        frozen=json.loads(Path(args.frozen_manifest).read_text(encoding='utf8'))
        keys=['schema','status','sourceCatalogProvenance','candidatePool','morphologyDefinition','selectionRule','controls','frozenAcquisitionOrder','futureClassificationProtocol','sampleSizePlan','architectureDecisionRules','recordingProtocol','guardrails','morphologyDiversityMatrix']
        for k in keys:
            if frozen.get(k)!=manifest.get(k): raise SystemExit(f'FROZEN_MANIFEST_MISMATCH:{k}')
        if frozen.get('manifestSha256')!=manifest_sha_payload(frozen): raise SystemExit('FROZEN_MANIFEST_SEMANTIC_SHA_INVALID')
        (out/'frozen-validation.json').write_text(json.dumps({'status':'PASS','frozenManifest':args.frozen_manifest,'frozenManifestSha256':frozen['manifestSha256'],'scientificFieldsMatch':True},indent=2),encoding='utf8')
    print(json.dumps({'lineageEligible':lineage_count,'eligibleAfterExclusions':len(eligible),'selected':[{'controlId':c['controlId'],'pointId':c['pointId'],'name':c['englishName'],'canonicalName':c['canonicalName'],'region':c['mapRegion'],'stratum':c['stratum'],'z5':c['z5'],'morphology':c['morphology']} for c in controls],'frozenAcquisitionOrder':order,'manifestSha256':manifest['manifestSha256']},ensure_ascii=False,indent=2))

if __name__=='__main__': main()
