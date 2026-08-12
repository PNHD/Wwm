#!/usr/bin/env python3
"""Replay/CI-only recovery of byte-verifiable BustinNutz public video controls."""
from __future__ import annotations
import argparse, hashlib, json, math, re, shutil, subprocess, sys
from pathlib import Path
from typing import Any
import cv2, numpy as np

VIDEOS=[
 {'id':'SsHeUoAcIP0','expectedTitle':'Exploring Kaifeng 100% (Part 1)','url':'https://www.youtube.com/watch?v=SsHeUoAcIP0','indexedEmbed':'https://notes.qoo-app.com/note/4000108'},
 {'id':'NOfdjOdFQ58','expectedTitle':'Exploring Kaifeng 100% (Part 2)','url':'https://www.youtube.com/watch?v=NOfdjOdFQ58','indexedEmbed':'https://notes.qoo-app.com/note/4007766'},
]
METHODS=[
 ('youtube-default',[]),
 ('youtube-web',['--extractor-args','youtube:player_client=web']),
 ('youtube-tv-embedded',['--extractor-args','youtube:player_client=tv_embedded']),
 ('youtube-android-vr',['--extractor-args','youtube:player_client=android_vr']),
]
FMT='bv*[height<=1080]+ba/b[height<=1080]/bv*[height<=720]+ba/b[height<=720]/b'

def run(cmd:list[str],timeout:int=900)->dict[str,Any]:
 p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout); out=p.stdout or ''
 return {'exitCode':p.returncode,'output':out[-12000:]}

def sha256(path:Path)->str:
 h=hashlib.sha256()
 with path.open('rb') as f:
  for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
 return h.hexdigest()

def ffprobe(path:Path)->dict[str,Any]:
 cmd=['ffprobe','-v','error','-show_entries','format=duration,format_name,size:stream=index,codec_type,codec_name,width,height,avg_frame_rate,pix_fmt','-of','json',str(path)]
 p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True); return json.loads(p.stdout)

def pick_downloaded(work:Path,video_id:str)->Path|None:
 cand=[p for p in work.glob(f'{video_id}.*') if p.suffix.lower() in {'.mp4','.mkv','.webm','.mov'} and p.is_file()]
 return max(cand,key=lambda p:p.stat().st_size) if cand else None

def parse_vtt_timestamps(work:Path,video_id:str)->list[dict[str,Any]]:
 hits=[]; pats=[re.compile(x,re.I) for x in [r'east\s+cross',r'boundary\s+stone',r'fairgrounds']]
 for p in sorted(work.glob(f'{video_id}*.vtt')):
  lines=p.read_text(encoding='utf-8',errors='replace').splitlines(); current=None; textbuf=[]
  def flush():
   nonlocal textbuf,current
   if current and textbuf:
    txt=' '.join(textbuf)
    if any(rx.search(txt) for rx in pats): hits.append({'file':p.name,'start':current[0],'end':current[1],'text':txt[:500]})
   textbuf=[]
  for line in lines:
   m=re.match(r'(?:(\d+):)?(\d{2}):(\d{2}\.\d{3})\s+-->\s+(?:(\d+):)?(\d{2}):(\d{2}\.\d{3})',line)
   if m:
    flush(); h1=int(m.group(1) or 0); m1=int(m.group(2)); s1=float(m.group(3)); h2=int(m.group(4) or 0); m2=int(m.group(5)); s2=float(m.group(6)); current=(h1*3600+m1*60+s1,h2*3600+m2*60+s2)
   elif line and not line.startswith(('WEBVTT','Kind:','Language:')) and '<' not in line[:2]: textbuf.append(re.sub(r'<[^>]+>','',line))
  flush()
 uniq=[]; seen=set()
 for h in hits:
  key=(h['file'],round(h['start'],1),h['text'][:100])
  if key not in seen: seen.add(key); uniq.append(h)
 return uniq[:100]

def fmt_ts(sec:float)->str:
 sec=max(0,int(round(sec))); return f'{sec//3600:02d}:{(sec%3600)//60:02d}:{sec%60:02d}'

def sample_video(video:Path,out:Path,video_id:str,duration:float,subtitle_hits:list[dict[str,Any]],step:float)->dict[str,Any]:
 sample_dir=out/f'{video_id}-samples'; sample_dir.mkdir(parents=True,exist_ok=True)
 times=set(np.arange(0,max(0.0,duration),step).tolist())
 for h in subtitle_hits:
  c=(float(h['start'])+float(h['end']))/2.0
  for d in (-30,-20,-10,-5,0,5,10,20,30):
   t=c+d
   if 0<=t<duration: times.add(t)
 times=sorted(times); cap=cv2.VideoCapture(str(video))
 if not cap.isOpened(): raise RuntimeError(f'OpenCV could not open {video}')
 frames=[]
 for t in times:
  cap.set(cv2.CAP_PROP_POS_MSEC,float(t)*1000.0); ok,frame=cap.read()
  if not ok or frame is None: continue
  h,w=frame.shape[:2]; tw=960; th=max(1,int(round(h*tw/w))); frame=cv2.resize(frame,(tw,th),interpolation=cv2.INTER_AREA)
  label=f'{video_id} {fmt_ts(t)}'; cv2.putText(frame,label,(16,34),cv2.FONT_HERSHEY_SIMPLEX,.9,(255,255,255),3,cv2.LINE_AA); cv2.putText(frame,label,(16,34),cv2.FONT_HERSHEY_SIMPLEX,.9,(0,0,0),1,cv2.LINE_AA); frames.append((t,frame))
 cap.release(); pages=[]
 for pi in range(math.ceil(len(frames)/9)):
  group=frames[pi*9:(pi+1)*9]
  if not group: break
  fh,fw=group[0][1].shape[:2]; sheet=np.zeros((fh*3,fw*3,3),dtype=np.uint8); sheet[:]=24
  for i,(_,frame) in enumerate(group):
   r,c=divmod(i,3); sheet[r*fh:(r+1)*fh,c*fw:(c+1)*fw]=frame
  path=sample_dir/f'sheet-{pi+1:03d}.jpg'; cv2.imwrite(str(path),sheet,[int(cv2.IMWRITE_JPEG_QUALITY),80]); pages.append(path.name)
 index=[{'timeSec':round(t,3),'time':fmt_ts(t),'sheet':f'sheet-{i//9+1:03d}.jpg','cell':i%9} for i,(t,_) in enumerate(frames)]
 (sample_dir/'index.json').write_text(json.dumps(index,indent=2),encoding='utf-8')
 return {'sampleStepSec':step,'frameCount':len(frames),'sheetCount':len(pages),'directory':sample_dir.name,'index':f'{sample_dir.name}/index.json'}

def main()->int:
 ap=argparse.ArgumentParser(); ap.add_argument('--out-dir',type=Path,required=True); ap.add_argument('--work-dir',type=Path,required=True); ap.add_argument('--sample-step',type=float,default=20.0); args=ap.parse_args(); out=args.out_dir; work=args.work_dir; out.mkdir(parents=True,exist_ok=True); work.mkdir(parents=True,exist_ok=True)
 report={'schema':'wwmsync-east-cross-public-video-recovery-v1','scope':{'productionChanged':False,'matcherInvoked':False,'structuralGate':0.58,'target':'East Cross Street Boundary Stone','targetDashenZ5':[5219.931321637427,4648.817136173768],'videoLeadsOnly':[v['id'] for v in VIDEOS]},'tooling':{},'videos':[]}
 report['tooling']['ytDlpVersion']=run([sys.executable,'-m','yt_dlp','--version'],60); report['tooling']['ffmpegVersion']=run(['ffmpeg','-version'],60); successes=0
 for v in VIDEOS:
  row={**v,'attempts':[]}; meta_path=out/f"{v['id']}-metadata.json"; meta_res=run([sys.executable,'-m','yt_dlp','--dump-single-json','--skip-download','--no-warnings',v['url']],180); row['metadataAttempt']=meta_res
  if meta_res['exitCode']==0:
   try:
    meta=json.loads(meta_res['output'].splitlines()[-1]); meta_path.write_text(json.dumps(meta,ensure_ascii=False,indent=2),encoding='utf-8'); row['resolvedMetadata']={'id':meta.get('id'),'title':meta.get('title'),'webpageUrl':meta.get('webpage_url'),'duration':meta.get('duration'),'uploader':meta.get('uploader'),'channel':meta.get('channel'),'uploadDate':meta.get('upload_date'),'chapters':meta.get('chapters')}
   except Exception as e: row['metadataParseError']=f'{type(e).__name__}: {e}'
  for method,extra in METHODS:
   for p in work.glob(f"{v['id']}.*"):
    if p.suffix.lower() in {'.part','.ytdl','.mp4','.mkv','.webm','.mov'}:
     try:p.unlink()
     except OSError:pass
   cmd=[sys.executable,'-m','yt_dlp','--no-playlist','--no-warnings','--newline','--retries','2','--fragment-retries','2','--socket-timeout','20','--write-info-json','--write-auto-subs','--write-subs','--sub-langs','en.*,en','--sub-format','vtt','--merge-output-format','mp4','-f',FMT,'-o',str(work/'%(id)s.%(ext)s'),*extra,v['url']]
   res=run(cmd,1200); media=pick_downloaded(work,v['id']); att={'method':method,'sourceUrl':v['url'],'exitCode':res['exitCode'],'logTail':res['output']}
   if media: att.update(mediaFile=media.name,mediaBytes=media.stat().st_size)
   row['attempts'].append(att)
   if media and media.stat().st_size>1_000_000: break
  media=pick_downloaded(work,v['id'])
  if media and media.stat().st_size>1_000_000:
   successes+=1; probe=ffprobe(media); streams=probe.get('streams') or []; vst=next((s for s in streams if s.get('codec_type')=='video'),{}); ast=next((s for s in streams if s.get('codec_type')=='audio'),{}); duration=float((probe.get('format') or {}).get('duration') or row.get('resolvedMetadata',{}).get('duration') or 0)
   row['retrieved']={'file':media.name,'sha256':sha256(media),'bytes':media.stat().st_size,'container':(probe.get('format') or {}).get('format_name'),'durationSec':duration,'videoCodec':vst.get('codec_name'),'width':vst.get('width'),'height':vst.get('height'),'pixelFormat':vst.get('pix_fmt'),'audioCodec':ast.get('codec_name')}; hits=parse_vtt_timestamps(work,v['id']); row['subtitleKeywordHits']=hits; row['sampling']=sample_video(media,out,v['id'],duration,hits,args.sample_step)
   for p in work.glob(f"{v['id']}*"):
    if p.suffix.lower() in {'.json','.vtt'}: shutil.copy2(p,out/p.name)
  else:
   row['retrieved']=None; row['indexedEmbedEvidence']={'url':v['indexedEmbed'],'sameVideoId':v['id'],'mediaBytesRecovered':False}
  report['videos'].append(row)
 report['retrievedCount']=successes; report['classification']='PUBLIC-VIDEO-BYTES-RECOVERED' if successes else 'PUBLIC-VIDEO-RETRIEVAL-FAILED'; (out/'east-cross-public-video-recovery.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8'); print(json.dumps({'classification':report['classification'],'retrievedCount':successes,'videos':[{'id':x['id'],'retrieved':x['retrieved'],'subtitleKeywordHits':x.get('subtitleKeywordHits',[])[:8],'sampling':x.get('sampling')} for x in report['videos']]},ensure_ascii=False,indent=2)); return 0
if __name__=='__main__': raise SystemExit(main())
