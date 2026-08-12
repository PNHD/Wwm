#!/usr/bin/env python3
"""Replay/CI-only same-ID mirror recovery after direct YouTube bot blocking."""
from __future__ import annotations
import argparse, hashlib, json, math, re, subprocess, urllib.request
from pathlib import Path
from typing import Any
import cv2, numpy as np

VIDEOS=[
 {'id':'SsHeUoAcIP0','title':'Exploring Kaifeng 100% (Part 1)','embed':'https://notes.qoo-app.com/note/4000108'},
 {'id':'NOfdjOdFQ58','title':'Exploring Kaifeng 100% (Part 2)','embed':'https://notes.qoo-app.com/note/4007766'},
]
INVIDIOUS=['https://inv.nadeko.net','https://invidious.nerdvpn.de','https://yt.chocolatemoo53.com','https://invidious.tiekoetter.com']
PIPED=['https://pipedapi.kavin.rocks']
UA='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/151 Safari/537.36'

def get(url:str,timeout:int=30,limit:int=50_000_000)->tuple[int,str,bytes]:
 req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'})
 with urllib.request.urlopen(req,timeout=timeout) as r:return r.status,r.headers.get('Content-Type',''),r.read(limit)

def sha(b:bytes)->str:return hashlib.sha256(b).hexdigest()
def sha_file(p:Path)->str:
 h=hashlib.sha256()
 with p.open('rb') as f:
  for c in iter(lambda:f.read(1024*1024),b''):h.update(c)
 return h.hexdigest()

def download(url:str,path:Path,timeout:int=90,max_bytes:int=900_000_000)->dict[str,Any]:
 req=urllib.request.Request(url,headers={'User-Agent':UA,'Accept':'*/*'});total=0;h=hashlib.sha256()
 with urllib.request.urlopen(req,timeout=timeout) as r,path.open('wb') as f:
  status=r.status;ct=r.headers.get('Content-Type','');cl=r.headers.get('Content-Length')
  while True:
   c=r.read(1024*1024)
   if not c:break
   total+=len(c)
   if total>max_bytes:raise RuntimeError(f'media exceeds {max_bytes} bytes')
   f.write(c);h.update(c)
 return {'httpStatus':status,'contentType':ct,'contentLength':cl,'bytes':total,'sha256':h.hexdigest()}

def probe(path:Path)->dict[str,Any]:
 p=subprocess.run(['ffprobe','-v','error','-show_entries','format=duration,format_name:stream=codec_type,codec_name,width,height,pix_fmt','-of','json',str(path)],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True);return json.loads(p.stdout)

def hval(v:Any)->int:
 try:return int(v or 0)
 except:return 0

def invidious_streams(js:dict[str,Any])->list[dict[str,Any]]:
 out=[]
 for s in js.get('formatStreams') or []:x=dict(s);x['_kind']='formatStreams';out.append(x)
 for s in js.get('adaptiveFormats') or []:
  if str(s.get('type') or '').startswith('video/'):x=dict(s);x['_kind']='adaptiveFormats';out.append(x)
 return out

def pick_stream(streams:list[dict[str,Any]])->dict[str,Any]|None:
 usable=[]
 for s in streams:
  url=s.get('url');hh=hval(s.get('height'))
  if not hh:
   m=re.search(r'(\d{3,4})p',str(s.get('qualityLabel') or s.get('quality') or ''));hh=int(m.group(1)) if m else 0
  if url and 360<=hh<=1080:usable.append((abs(hh-720),-hh,s))
 if not usable:return None
 usable.sort(key=lambda x:(x[0],x[1]));return usable[0][2]

def piped_streams(js:dict[str,Any])->list[dict[str,Any]]:return [dict(s,_kind='videoStreams') for s in (js.get('videoStreams') or []) if s.get('url')]
def fmt(sec:float)->str:s=max(0,int(round(sec)));return f'{s//3600:02d}:{(s%3600)//60:02d}:{s%60:02d}'

def sample(video:Path,out:Path,vid:str,duration:float,step:float=20)->dict[str,Any]:
 d=out/f'{vid}-samples';d.mkdir(parents=True,exist_ok=True);cap=cv2.VideoCapture(str(video));frames=[]
 if not cap.isOpened():raise RuntimeError('OpenCV could not open recovered media')
 for t in np.arange(0,max(duration,0),step):
  cap.set(cv2.CAP_PROP_POS_MSEC,float(t)*1000);ok,fr=cap.read()
  if not ok or fr is None:continue
  h,w=fr.shape[:2];tw=960;th=max(1,round(h*tw/w));fr=cv2.resize(fr,(tw,th),interpolation=cv2.INTER_AREA);label=f'{vid} {fmt(float(t))}';cv2.putText(fr,label,(16,34),cv2.FONT_HERSHEY_SIMPLEX,.9,(255,255,255),3,cv2.LINE_AA);cv2.putText(fr,label,(16,34),cv2.FONT_HERSHEY_SIMPLEX,.9,(0,0,0),1,cv2.LINE_AA);frames.append((float(t),fr))
 cap.release();pages=[]
 for pi in range(math.ceil(len(frames)/9)):
  g=frames[pi*9:(pi+1)*9]
  if not g:break
  fh,fw=g[0][1].shape[:2];sh=np.zeros((fh*3,fw*3,3),np.uint8);sh[:]=24
  for i,(_,fr) in enumerate(g):r,c=divmod(i,3);sh[r*fh:(r+1)*fh,c*fw:(c+1)*fw]=fr
  p=d/f'sheet-{pi+1:03d}.jpg';cv2.imwrite(str(p),sh,[int(cv2.IMWRITE_JPEG_QUALITY),80]);pages.append(p.name)
 idx=[{'timeSec':round(t,3),'time':fmt(t),'sheet':f'sheet-{i//9+1:03d}.jpg','cell':i%9} for i,(t,_) in enumerate(frames)];(d/'index.json').write_text(json.dumps(idx,indent=2),encoding='utf-8');return {'frameCount':len(frames),'sheetCount':len(pages),'sampleStepSec':step,'directory':d.name}

def main()->int:
 ap=argparse.ArgumentParser();ap.add_argument('--out-dir',type=Path,required=True);ap.add_argument('--work-dir',type=Path,required=True);args=ap.parse_args();out=args.out_dir;work=args.work_dir;out.mkdir(parents=True,exist_ok=True);work.mkdir(parents=True,exist_ok=True)
 report={'schema':'wwmsync-east-cross-provenance-mirror-recovery-v1','scope':{'productionChanged':False,'matcherInvoked':False,'sameYoutubeIdsOnly':[v['id'] for v in VIDEOS],'officialInvidiousList':'https://docs.invidious.io/instances/','officialPipedDocs':'https://docs.piped.video/docs/api-documentation/','structuralGate':0.58},'videos':[]};success=0
 for v in VIDEOS:
  row={**v,'indexedEmbedAttempt':None,'mirrorAttempts':[],'retrieved':None}
  try:
   st,ct,b=get(v['embed'],30,5_000_000);text=b.decode('utf-8','replace');row['indexedEmbedAttempt']={'url':v['embed'],'httpStatus':st,'contentType':ct,'bytes':len(b),'sha256':sha(b),'containsVideoId':v['id'] in text,'containsExpectedTitle':v['title'].lower() in text.lower(),'mediaBytesRecovered':False}
  except Exception as e:row['indexedEmbedAttempt']={'url':v['embed'],'error':f'{type(e).__name__}: {e}','mediaBytesRecovered':False}
  chosen=None
  for base in INVIDIOUS:
   api=f'{base}/api/v1/videos/{v["id"]}';att={'kind':'invidious-official-list','base':base,'api':api}
   try:
    st,ct,b=get(api,35,20_000_000);att.update(httpStatus=st,contentType=ct,responseBytes=len(b),responseSha256=sha(b));js=json.loads(b.decode('utf-8','replace'));att['resolved']={'videoId':js.get('videoId'),'title':js.get('title'),'author':js.get('author'),'lengthSeconds':js.get('lengthSeconds')};streams=invidious_streams(js);att['streamCount']=len(streams);s=pick_stream(streams);att['selectedStream']={k:s.get(k) for k in ['quality','qualityLabel','height','type','container','itag','_kind']} if s else None
    if s and js.get('videoId')==v['id']:
     p=work/f'{v["id"]}-invidious.bin';dl=download(s['url'],p);att['download']=dl;chosen=(p,att,js)
   except Exception as e:att['error']=f'{type(e).__name__}: {e}'
   row['mirrorAttempts'].append(att)
   if chosen:break
  if not chosen:
   for base in PIPED:
    api=f'{base}/streams/{v["id"]}';att={'kind':'piped-official-api','base':base,'api':api}
    try:
     st,ct,b=get(api,35,20_000_000);att.update(httpStatus=st,contentType=ct,responseBytes=len(b),responseSha256=sha(b));js=json.loads(b.decode('utf-8','replace'));att['resolved']={'title':js.get('title'),'uploader':js.get('uploader'),'duration':js.get('duration')};streams=piped_streams(js);att['streamCount']=len(streams);s=pick_stream(streams);att['selectedStream']={k:s.get(k) for k in ['quality','height','format','mimeType','videoOnly','_kind']} if s else None
     if s:
      p=work/f'{v["id"]}-piped.bin';dl=download(s['url'],p);att['download']=dl;chosen=(p,att,js)
    except Exception as e:att['error']=f'{type(e).__name__}: {e}'
    row['mirrorAttempts'].append(att)
    if chosen:break
  if chosen:
   p,att,js=chosen
   try:
    pr=probe(p);vs=next((s for s in pr.get('streams',[]) if s.get('codec_type')=='video'),{});dur=float((pr.get('format') or {}).get('duration') or js.get('lengthSeconds') or js.get('duration') or 0);row['retrieved']={'method':att['kind'],'base':att['base'],'sourceVideoId':v['id'],'file':p.name,'bytes':p.stat().st_size,'sha256':sha_file(p),'container':(pr.get('format') or {}).get('format_name'),'durationSec':dur,'codec':vs.get('codec_name'),'width':vs.get('width'),'height':vs.get('height'),'pixelFormat':vs.get('pix_fmt')};row['sampling']=sample(p,out,v['id'],dur);success+=1
   except Exception as e:row['retrievalValidationError']=f'{type(e).__name__}: {e}'
  report['videos'].append(row)
 report['retrievedCount']=success;report['classification']='PUBLIC-MIRROR-BYTES-RECOVERED' if success else 'PUBLIC-MIRROR-RETRIEVAL-FAILED';(out/'east-cross-public-mirror-recovery.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8');print(json.dumps({'classification':report['classification'],'retrievedCount':success,'videos':[{'id':v['id'],'indexedEmbedAttempt':v['indexedEmbedAttempt'],'retrieved':v['retrieved'],'attempts':[{k:a.get(k) for k in ['kind','base','httpStatus','resolved','streamCount','selectedStream','error']} for a in v['mirrorAttempts']]} for v in report['videos']]},ensure_ascii=False,indent=2));return 0
if __name__=='__main__':raise SystemExit(main())
