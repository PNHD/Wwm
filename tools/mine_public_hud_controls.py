#!/usr/bin/env python3
"""Replay/CI-only public HUD source miner for the H1/H2/H3 discrimination audit."""
from __future__ import annotations
import argparse, hashlib, json, urllib.request
from pathlib import Path
import cv2, numpy as np

UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131 Safari/537.36'
POINT_URL='https://inf.ds.163.com/v1/web/game-map/point/list-by-sub-types'
MAP_ID='676d48a37d299d0811946ff1'
SOURCES=[
 {'id':'steam-general-shrine-1','page':'https://steamcommunity.com/app/3564740/discussions/0/816973559978006971/','image':'https://images.steamusercontent.com/ugc/10569571512717672614/71F9D2DBF4526171F082F9D0330C177057F2E5C4/','published':'2026-01-16','lineage':'Steam Global PC','landmark':'General Shrine / Fang Xu arena scaffolding','provenance':'Author states they just ran to General Shrine to test; image 1 of four is normal gameplay.'},
 {'id':'nerd-guide-life-a','page':'https://nerdschalk.com/a-guide-to-life-walkthrough-where-winds-meet/','image':'https://nerdschalk.com/content/images/2025/12/image-460-1-1.png','published':'2025-12-04','lineage':'Global PC, exact storefront unknown','landmark':'Grand Imperial Temple Boundary Stone','provenance':'Step 1 pair beside text stating Xu Ziyi is next to Grand Imperial Temple Boundary Stone.'},
 {'id':'nerd-guide-life-b','page':'https://nerdschalk.com/a-guide-to-life-walkthrough-where-winds-meet/','image':'https://nerdschalk.com/content/images/2025/12/image-462-1.png','published':'2025-12-04','lineage':'Global PC, exact storefront unknown','landmark':'Grand Imperial Temple Boundary Stone','provenance':'Step 1 pair beside text stating Xu Ziyi is next to Grand Imperial Temple Boundary Stone.'},
 {'id':'nerd-savory-location','page':'https://nerdschalk.com/a-savory-revelation-wandering-tale-where-winds-meet/','image':'https://cdn.nerdschalk.com/wp-content/uploads/2025/12/chrome_ELfpSOC8Lg-1.jpg','published':'2025-12-01','lineage':'Global PC, exact storefront unknown','landmark':'Peace Bell Tower','provenance':'Location image immediately under text identifying Peace Bell Tower, Moonveil Mountain, Qinghe.'},
 {'id':'nerd-savory-step1','page':'https://nerdschalk.com/a-savory-revelation-wandering-tale-where-winds-meet/','image':'https://cdn.nerdschalk.com/wp-content/uploads/2025/12/chrome_bq4zUE7iZv.jpg','published':'2025-12-01','lineage':'Global PC, exact storefront unknown','landmark':'Peace Bell Tower / Cai Cai','provenance':'Step 1 screenshot immediately under Find Cai Cai at Peace Bell Tower.'},
 {'id':'nerd-savory-hunter-a','page':'https://nerdschalk.com/a-savory-revelation-wandering-tale-where-winds-meet/','image':'https://cdn.nerdschalk.com/wp-content/uploads/2025/12/chrome_ZNvMlzwwuq-1.jpg','published':'2025-12-01','lineage':'Global PC, exact storefront unknown','landmark':'Peace Bell Tower / Hunter','provenance':'Step 3 pair under Return to Peace Bell Tower and speak with the Hunter.'},
 {'id':'nerd-savory-hunter-b','page':'https://nerdschalk.com/a-savory-revelation-wandering-tale-where-winds-meet/','image':'https://cdn.nerdschalk.com/wp-content/uploads/2025/12/chrome_sltFIyP1dD-1.jpg','published':'2025-12-01','lineage':'Global PC, exact storefront unknown','landmark':'Peace Bell Tower / Hunter','provenance':'Step 3 pair under Return to Peace Bell Tower and speak with the Hunter.'},
]

def request(url, data=None, timeout=30):
    headers={'User-Agent':UA,'Accept':'*/*'}; body=None
    if data is not None:
        body=json.dumps(data,ensure_ascii=False).encode(); headers['Content-Type']='application/json;charset=UTF-8'
    req=urllib.request.Request(url,data=body,headers=headers)
    with urllib.request.urlopen(req,timeout=timeout) as r: return r.status,r.headers.get('Content-Type',''),r.read(20_000_000)

def main():
    ap=argparse.ArgumentParser(); ap.add_argument('--out-dir',type=Path,required=True); args=ap.parse_args(); out=args.out_dir; out.mkdir(parents=True,exist_ok=True)
    report={'schema':'wwmsync-public-hud-mining-v1','scope':{'productionChanged':False,'structuralGate':0.58,'roiSemantics':'default production ROI: unit=min(width,height); size=unit*0.25; center=(unit*0.125,unit*0.125), hence source origin (0,0)'},'sources':[]}
    ok=0
    for src in SOURCES:
        row=dict(src)
        try:
            status,ct,raw=request(src['image']); row.update(httpStatus=status,contentType=ct,bytes=len(raw),sha256=hashlib.sha256(raw).hexdigest())
            im=cv2.imdecode(np.frombuffer(raw,np.uint8),cv2.IMREAD_COLOR)
            if im is None: raise RuntimeError('image decode failed')
            h,w=im.shape[:2]; unit=min(w,h); size=unit*.25; size_i=max(1,int(round(size)))
            raw_path=out/f"{src['id']}-raw.png"; roi_path=out/f"{src['id']}-roi.png"
            cv2.imwrite(str(raw_path),im); cv2.imwrite(str(roi_path),im[:size_i,:size_i])
            row.update(width=w,height=h,productionDefaultRoi={'x':0.0,'y':0.0,'size':size,'integerInspectionCropSize':size_i},rawFile=raw_path.name,roiFile=roi_path.name)
            ok+=1
        except Exception as e: row['error']=f'{type(e).__name__}: {e}'
        report['sources'].append(row)
    try:
        status,ct,raw=request(POINT_URL,{'mapId':MAP_ID,'subTypes':['1','2'],'mapZone':'map12'})
        points=json.loads(raw.decode('utf-8','replace')); (out/'dashen-points.json').write_text(json.dumps(points,ensure_ascii=False,indent=2),encoding='utf-8')
        report['dashenPointQuery']={'url':POINT_URL,'mapId':MAP_ID,'subTypes':['1','2'],'mapZone':'map12','httpStatus':status,'contentType':ct,'bytes':len(raw),'sha256':hashlib.sha256(raw).hexdigest(),'file':'dashen-points.json'}
    except Exception as e: report['dashenPointQuery']={'error':f'{type(e).__name__}: {e}'}
    (out/'public-hud-mining.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'downloaded':ok,'total':len(SOURCES),'dashenPointQuery':report['dashenPointQuery']},ensure_ascii=False,indent=2))
    if ok<1: raise SystemExit('no public HUD candidate image downloaded')
if __name__=='__main__': main()
