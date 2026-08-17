#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

const argv=process.argv.slice(2);
const arg=(name,fallback=null)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:fallback};
const siteDir=path.resolve(arg('--site','fusion-site'));
const freezePath=path.resolve(arg('--freeze'));
const configPath=path.resolve(arg('--config'));
const outDir=path.resolve(arg('--output','fusion-render'));
const controlId=arg('--control');
if(!arg('--freeze')||!arg('--config')||!controlId)throw new Error('missing required arguments');
fs.mkdirSync(outDir,{recursive:true});
const freeze=JSON.parse(fs.readFileSync(freezePath));
const config=JSON.parse(fs.readFileSync(configPath));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const mime=p=>({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[path.extname(p).toLowerCase()]||'application/octet-stream');

function serve(){return new Promise(resolve=>{const root=path.resolve(siteDir),s=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1))||'index.html',file=path.resolve(root,rel);if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return}res.writeHead(200,{'content-type':mime(file),'cache-control':'no-store'});fs.createReadStream(file).pipe(res)});s.listen(0,'127.0.0.1',()=>resolve({s,port:s.address().port}))})}

async function canonicalQueryRgb(page,control){return page.evaluate(async c=>{const img=new Image();img.decoding='sync';img.src='/'+c.image;await img.decode();const cv=document.createElement('canvas');cv.width=192;cv.height=192;const ctx=cv.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';if(c.sourceCropSize!=null)ctx.drawImage(img,0,0,c.sourceCropSize,c.sourceCropSize,0,0,192,192);else ctx.drawImage(img,0,0,img.naturalWidth,img.naturalHeight,0,0,192,192);const rgba=ctx.getImageData(0,0,192,192).data,rgb=new Uint8Array(192*192*3);for(let si=0,di=0;si<rgba.length;si+=4){rgb[di++]=rgba[si];rgb[di++]=rgba[si+1];rgb[di++]=rgba[si+2]}let bin='';for(let i=0;i<rgb.length;i+=0x8000)bin+=String.fromCharCode(...rgb.subarray(i,i+0x8000));return{rgbB64:btoa(bin),meta:{sourceNatural:[img.naturalWidth,img.naturalHeight],sourceCropSize:c.sourceCropSize??null,destination:[192,192],alpha:false,imageSmoothingEnabled:ctx.imageSmoothingEnabled,imageSmoothingQuality:ctx.imageSmoothingQuality,devicePixelRatio}}},control)}

const poses=[];for(const angleDeltaDeg of[-15,0,15])for(const radiusFactor of[.9,1,1.1])for(const xOffsetPx of[-8,0,8])for(const yOffsetPx of[-8,0,8])poses.push({angleDeltaDeg,radiusFactor,xOffsetPx,yOffsetPx});
if(poses.length!==81)throw new Error('pose grid arithmetic failure');
const lockedIndex=poses.findIndex(p=>p.angleDeltaDeg===0&&p.radiusFactor===1&&p.xOffsetPx===0&&p.yOffsetPx===0);if(lockedIndex<0)throw new Error('locked pose missing');
const poseEqual=(a,b)=>['angleDeltaDeg','radiusFactor','xOffsetPx','yOffsetPx','x','y','radius','angle'].every(k=>Math.abs(a[k]-b[k])<1e-12);

const output={schema:'wwmsync-final-complementary-fusion-v1-render-manifest-v1',status:'RUNNING',controlId,head:process.env.GITHUB_SHA||null,productionChange:'NO',poseGrid:{angleDeltaDeg:[-15,0,15],radiusFactor:[.9,1,1.1],xOffsetPx:[-8,0,8],yOffsetPx:[-8,0,8],count:81,lockedIndex},samePoseInvariant:true};
let srv,browser;
try{
  if(freeze.verdict!=='VF0 — V2 CANDIDATE FREEZE COMPLETE')throw new Error('freeze verdict not VF0');
  const control=config.controls.find(x=>x.id===controlId),frozen=freeze.controls[controlId];if(!control||!frozen)throw new Error('unknown frozen control '+controlId);
  ({s:srv,port:output.port}=await serve());browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--disable-dev-shm-usage','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});await page.goto('http://127.0.0.1:'+output.port+'/index.html',{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__WWMSYNC_FINAL_FUSION_V1__&&window.__WWMSYNC_LEARNED_V1_RENDER__&&window.__WWMSYNC_V2_DESCRIPTOR_AUDIT__,null,{timeout:60000});
  output.runtime=await page.evaluate(()=>({userAgent:navigator.userAgent,devicePixelRatio,finalContract:window.__WWMSYNC_FINAL_FUSION_V1__.contract,learnedContract:window.__WWMSYNC_LEARNED_V1_RENDER__.contract,v2Contract:window.__WWMSYNC_V2_DESCRIPTOR_AUDIT__.contract}));
  if(output.runtime.devicePixelRatio!==1)throw new Error('DPR mismatch');output.conformance=await page.evaluate(()=>window.__WWMSYNC_FINAL_FUSION_V1__.conformance());if(!output.conformance?.ok)throw new Error('fusion conformance failed');
  const q=await canonicalQueryRgb(page,control),qbuf=Buffer.from(q.rgbB64,'base64'),qsha=sha(qbuf);if(qbuf.length!==192*192*3)throw new Error('query byte size mismatch');if(qsha!==frozen.input.workCanvasRgb8Sha256)throw new Error('query work-canvas hash mismatch '+qsha+' != '+frozen.input.workCanvasRgb8Sha256);fs.writeFileSync(path.join(outDir,'query.rgb'),qbuf);output.query={...q.meta,rgb8Sha256:qsha,expectedRgb8Sha256:frozen.input.workCanvasRgb8Sha256,byteSize:qbuf.length};
  const candidates=[{...frozen.gt,role:'GT',classification:'GT'},...frozen.top8.map(x=>({...x,role:'WRONG',classification:x.classification}))];if(candidates.length!==9||frozen.top8.length!==8||frozen.top8.some(x=>x.classification!=='WRONG'))throw new Error('candidate population mismatch');
  const packPath=path.join(outDir,'references.rgbpack');fs.writeFileSync(packPath,Buffer.alloc(0));let offset=0;output.candidates=[];
  for(const base of candidates){
    const d2=await page.evaluate(async({rgbB64,mapId,base,poses})=>window.__WWMSYNC_FINAL_FUSION_V1__.d2Batch(rgbB64,mapId,base,poses),{rgbB64:q.rgbB64,mapId:control.mapId,base,poses});if(d2.rows.length!==81)throw new Error(base.candidateId+' D2 pose count');
    const learnedRows=[];for(let start=0;start<poses.length;start+=9){const specs=poses.slice(start,start+9),batch=await page.evaluate(async({mapId,base,specs})=>window.__WWMSYNC_LEARNED_V1_RENDER__.renderBatch(mapId,base,specs),{mapId:control.mapId,base,specs});if(batch.rows.length!==specs.length)throw new Error(base.candidateId+' learned render count');learnedRows.push(...batch.rows)}
    if(learnedRows.length!==81)throw new Error(base.candidateId+' learned pose count');const rows=[];
    for(let i=0;i<81;i++){const lr=learnedRows[i],dr=d2.rows[i];if(!poseEqual(lr.pose,dr.pose))throw new Error(base.candidateId+' same-pose mismatch '+i);const buf=Buffer.from(lr.rgbB64,'base64');if(buf.length!==192*192*3)throw new Error(base.candidateId+' reference byte size mismatch');fs.appendFileSync(packPath,buf);rows.push({pose:lr.pose,d2Pose:dr.pose,d2Score:dr.score,d2Coverage:dr.coverage,offset,byteSize:buf.length,rgb8Sha256:sha(buf)});offset+=buf.length}
    output.candidates.push({candidateId:base.candidateId,role:base.role,classification:base.classification,productionRank:base.productionRank??null,base:{x:base.x,y:base.y,angle:base.angle,radius:base.radius},poses:rows,d2Source:d2.source});console.log(JSON.stringify({controlId,candidateId:base.candidateId,poses:rows.length,packBytes:offset}));
  }
  const pack=fs.readFileSync(packPath);if(pack.length!==9*81*192*192*3)throw new Error('reference pack size mismatch');output.referencePack={path:'references.rgbpack',byteSize:pack.length,sha256:sha(pack),candidateCount:9,posesPerCandidate:81,totalImages:729};
  const gt=output.candidates[0],spec=[poses[lockedIndex]],r1=await page.evaluate(async({rgbB64,mapId,base,spec})=>window.__WWMSYNC_FINAL_FUSION_V1__.d2Batch(rgbB64,mapId,base,spec),{rgbB64:q.rgbB64,mapId:control.mapId,base:gt.base,spec}),r2=await page.evaluate(async({rgbB64,mapId,base,spec})=>window.__WWMSYNC_FINAL_FUSION_V1__.d2Batch(rgbB64,mapId,base,spec),{rgbB64:q.rgbB64,mapId:control.mapId,base:gt.base,spec});if(r1.rows[0].score!==r2.rows[0].score||!poseEqual(r1.rows[0].pose,r2.rows[0].pose))throw new Error('D2 repeat determinism failed');output.repeatDeterminism={candidateId:gt.candidateId,pose:spec[0],first:r1.rows[0].score,second:r2.rows[0].score,bitwiseNumberEqual:true};
  output.control={name:frozen.name,role:frozen.role,region:frozen.region,mapId:frozen.mapId};output.status='PASS';
}catch(err){output.status='FAIL';output.error=String(err?.stack||err);process.exitCode=1}finally{if(browser)await browser.close().catch(()=>{});if(srv)await new Promise(resolve=>srv.close(resolve));fs.writeFileSync(path.join(outDir,'render-manifest.json'),JSON.stringify(output,null,2)+'\n');fs.writeFileSync(path.join(outDir,'render.status.txt'),'STATUS='+output.status+'\nCONTROL='+controlId+'\nPRODUCTION_CHANGE=NO\n');console.log(JSON.stringify({status:output.status,controlId,error:output.error||null}))}
