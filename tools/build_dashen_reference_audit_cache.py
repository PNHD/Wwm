#!/usr/bin/env python3
"""Build a replay-only full Dashen main-raster cache for reference-domain auditing.

Unlike tools/build_dashen_visual_cache.py this diagnostic intentionally covers the
complete currently configured main z5 grid. It is never shipped by production.
"""
from __future__ import annotations
import argparse, concurrent.futures, hashlib, json, time, urllib.request
from pathlib import Path

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
MAIN='https://img.166.net/canonical/h72/tilemap/v15.0/{z}/{x}_{y}.png?imageView&v=1'
SUB3='https://img.166.net/canonical/h72/tilemap/subType3/v2/{z}/{x}_{y}.png?imageView&v=1'
SUB4='https://img.166.net/canonical/h72/tilemap/subType4/v2/{z}/{x}_{y}.png?imageView&v=1'
FAMILIES={'main':MAIN,'sub3':SUB3,'sub4':SUB4}
RANGES={('main',3):(0,7,0,7),('main',5):(0,31,0,31),('sub3',3):(0,1,0,1),('sub3',5):(0,7,0,7),('sub4',3):(0,1,0,1),('sub4',5):(0,7,0,7)}

def fetch(root,family,z,x,y):
    url=FAMILIES[family].format(z=z,x=x,y=y); dst=root/family/str(z)/f'{x}_{y}.png'; dst.parent.mkdir(parents=True,exist_ok=True)
    last=''
    for attempt in range(3):
        try:
            req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'image/png,image/*;q=.8,*/*;q=.5','Cache-Control':'no-cache'})
            with urllib.request.urlopen(req,timeout=12) as r:
                data=r.read(2_000_000); ct=r.headers.get('Content-Type',''); status=r.status
            if status!=200 or not data or not ct.lower().startswith('image/'):
                raise RuntimeError(f'HTTP {status} {ct} {len(data)}')
            dst.write_bytes(data)
            return {'family':family,'z':z,'x':x,'y':y,'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest(),'source':url}
        except Exception as e:
            last=f'{type(e).__name__}: {e}'; time.sleep(.25*(attempt+1))
    raise RuntimeError(f'{family} z{z} {x}_{y}: {last}')

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('output',type=Path); ap.add_argument('--workers',type=int,default=24); args=ap.parse_args(); root=args.output; root.mkdir(parents=True,exist_ok=True)
    jobs=[(f,z,x,y) for (f,z),(a,b,c,d) in RANGES.items() for y in range(c,d+1) for x in range(a,b+1)]
    rows=[]; errors=[]
    with concurrent.futures.ThreadPoolExecutor(max_workers=max(1,min(32,args.workers))) as pool:
        fut={pool.submit(fetch,root,*j):j for j in jobs}
        for future in concurrent.futures.as_completed(fut):
            try: rows.append(future.result())
            except Exception as e: errors.append({'tile':fut[future],'error':str(e)})
    rows.sort(key=lambda r:(r['family'],r['z'],r['y'],r['x']))
    manifest={'schema':'wwmsync-reference-domain-expanded-cache-v1','replayOnly':True,'productionResourceChanged':False,'families':FAMILIES,'ranges':[{'family':f,'z':z,'minX':b[0],'maxX':b[1],'minY':b[2],'maxY':b[3]} for (f,z),b in sorted(RANGES.items())],'tilesExpected':len(jobs),'tilesFetched':len(rows),'bytes':sum(r['bytes'] for r in rows),'errors':errors,'tiles':rows}
    (root/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),'utf8')
    print(json.dumps({k:v for k,v in manifest.items() if k!='tiles'},ensure_ascii=False,indent=2))
    return 2 if errors or len(rows)!=len(jobs) else 0
if __name__=='__main__': raise SystemExit(main())
