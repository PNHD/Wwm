#!/usr/bin/env python3
import base64, hashlib, json, os, re, subprocess
from pathlib import Path
from PIL import Image

ROOT=Path('fixtures/owner-gfn-center-hud')
PROV=ROOT/'provenance.json'
INDEX=ROOT/'transport-index.json'
REPORT=Path('owner-center-hud-canonicalization.json')
START='15a001b4227aea6f266f666528c009ef88c87183'
PROTECTED={
 'vision-sync.js':'58b5a1babf6a12b944f9b745b8bf7f7df573bf9b',
 'dashen-tile-cache.js':'9388960a8bff53a9cfc7471372af144b7a28c34f',
 'tools/build_dashen_visual_cache.py':'1a227d06ae41660ea3e3b832e7f1921cc507c0d7',
}

def sha256(b): return hashlib.sha256(b).hexdigest()
def git_blob_sha1(b): return hashlib.sha1(f'blob {len(b)}\0'.encode()+b).hexdigest()
def sh(*args): return subprocess.check_output(args,text=True).strip()

def verify_guards():
 if subprocess.run(['git','merge-base','--is-ancestor',START,'HEAD']).returncode:
  raise SystemExit('authoritative starting HEAD is not an ancestor of setup HEAD')
 for path,want in PROTECTED.items():
  got=sh('git','hash-object',path)
  if got!=want: raise SystemExit(f'protected blob mismatch {path}: {got}')
 text=Path('vision-sync.js').read_text(errors='replace')
 checks={
  'structuralGate0.58':r'(?is)structur[a-zA-Z0-9_]*.{0,120}?0\.58',
  'intensityGate0.42':r'(?is)intens[a-zA-Z0-9_]*.{0,120}?0\.42',
  'coarseBeam8':r'(?is)(?:coarse.{0,40}?beam|beam.{0,40}?coarse).{0,120}?\b8\b',
 }
 for name,pat in checks.items():
  if not re.search(pat,text): raise SystemExit(f'production guard value not found: {name}')
 return {'startingHead':START,'setupHead':sh('git','rev-parse','HEAD'),'protectedBlobSha1':PROTECTED,'structuralGate':0.58,'intensityGate':0.42,'coarseBeam':8}

def fetch_git_blob(repo,oid):
 env=dict(os.environ); env['GH_TOKEN']=os.environ['GITHUB_TOKEN']
 payload=subprocess.check_output(['gh','api',f'repos/{repo}/git/blobs/{oid}'],env=env,text=True)
 obj=json.loads(payload)
 raw=base64.b64decode(obj['content'].replace('\n',''),validate=True)
 if obj.get('sha')!=oid or git_blob_sha1(raw)!=oid:
  raise SystemExit(f'transport Git blob integrity mismatch {oid}')
 return raw

def main():
 repo=os.environ['GITHUB_REPOSITORY']
 prov=json.loads(PROV.read_text())
 index=json.loads(INDEX.read_text())
 guards=verify_guards()
 rows=[]
 for item in prov['fixtures']:
  fid=item['id']; oids=index['fixtures'][fid]
  carrier=b''.join(fetch_git_blob(repo,oid) for oid in oids)
  try: encoded=carrier.decode('ascii')
  except UnicodeDecodeError: raise SystemExit(f'{fid}: carrier not ASCII')
  raw=base64.b64decode(encoded,validate=True)
  webp_sha=sha256(raw)
  if webp_sha!=item['webpSha256']: raise SystemExit(f'{fid}: WebP SHA mismatch {webp_sha}')
  blobsha=git_blob_sha1(raw)
  if blobsha!=item['expectedCanonicalGitBlobSha1']: raise SystemExit(f'{fid}: canonical Git blob SHA mismatch {blobsha}')
  dst=ROOT/item['file']; dst.write_bytes(raw)
  with Image.open(dst) as im:
   im.load()
   if im.size!=(270,270): raise SystemExit(f'{fid}: dimensions {im.size}')
   if im.mode!='RGB': raise SystemExit(f'{fid}: mode {im.mode}')
   rgb=im.tobytes()
  if len(rgb)!=218700: raise SystemExit(f'{fid}: RGB byte length {len(rgb)}')
  rgbsha=sha256(rgb)
  if rgbsha!=item['rgb8Sha256']: raise SystemExit(f'{fid}: RGB8 SHA mismatch {rgbsha}')
  rgba=bytearray(len(rgb)//3*4)
  rgba[0::4]=rgb[0::3]; rgba[1::4]=rgb[1::3]; rgba[2::4]=rgb[2::3]; rgba[3::4]=b'\xff'*(len(rgb)//3)
  rgbasha=sha256(rgba)
  if rgbasha!=item['taskPromptRgba255CompatibilitySha256']: raise SystemExit(f'{fid}: task-prompt compatibility hash mismatch {rgbasha}')
  rows.append({'id':fid,'path':str(dst),'transportBlobSha1':oids,'webpSha256':webp_sha,'rgb8Sha256':rgbsha,'taskPromptRgba255CompatibilitySha256':rgbasha,'gitBlobSha1':blobsha,'size':[270,270],'mode':'RGB','evaluation':item['evaluation']})
 report={'schema':'wwmsync-owner-center-hud-canonicalization-v1','guards':guards,'fixtures':rows,'pixelHashNomenclature':'task values are RGBA255-compatible; provenance RGB8 values are true 3-channel decoded bytes','status':'PASS'}
 REPORT.write_text(json.dumps(report,indent=2,sort_keys=True)+'\n')
 print(REPORT.read_text())
if __name__=='__main__': main()
