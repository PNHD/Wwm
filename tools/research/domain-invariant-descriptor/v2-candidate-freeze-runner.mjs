#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

const argv=process.argv.slice(2);
const arg=(n,d=null)=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:d};
const siteDir=path.resolve(arg('--site','v2-site'));
const preregPath=path.resolve(arg('--prereg'));
const configPath=path.resolve(arg('--config'));
const outDir=path.resolve(arg('--output','v2-output'));
const refManifestPath=path.resolve(arg('--reference-manifest'));
if(!arg('--prereg')||!arg('--config')||!arg('--reference-manifest')) throw new Error('missing required arguments');
fs.mkdirSync(outDir,{recursive:true});
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const prereg=JSON.parse(fs.readFileSync(preregPath,'utf8'));
const config=JSON.parse(fs.readFileSync(configPath,'utf8'));
const referenceManifestSha256=sha(fs.readFileSync(refManifestPath));
const mime=p=>({'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.png':'image/png','.webp':'image/webp','.jpg':'image/jpeg','.jpeg':'image/jpeg'}[path.extname(p).toLowerCase()]||'application/octet-stream');
function server(){return new Promise(resolve=>{const root=path.resolve(siteDir);const s=http.createServer((req,res)=>{const rel=decodeURIComponent(new URL(req.url,'http://x').pathname.slice(1))||'index.html',f=path.resolve(root,rel);if(!f.startsWith(root)||!fs.existsSync(f)||!fs.statSync(f).isFile()){res.writeHead(404).end();return}res.writeHead(200,{'content-type':mime(f),'cache-control':'no-store'});fs.createReadStream(f).pipe(res)});s.listen(0,'127.0.0.1',()=>resolve({s,port:s.address().port}))})}
function stableCandidateId(controlId,rank,c){const payload=JSON.stringify([controlId,rank,c.x,c.y,c.angle,c.radius]);return `${controlId}:v2-top:${rank}:${sha(Buffer.from(payload)).slice(0,20)}`}
function paretoDominates(a,b){return a.scaleAwareStructure>=b.scaleAwareStructure&&a.intensityNcc>=b.intensityNcc&&(a.scaleAwareStructure>b.scaleAwareStructure||a.intensityNcc>b.intensityNcc)}
function hashes(data){const png=Buffer.from(data.dataUrl.split(',')[1],'base64'),rgba=Buffer.from(data.rgbaB64,'base64'),rgb=Buffer.alloc(192*192*3);for(let si=0,di=0;si<rgba.length;si+=4){rgb[di++]=rgba[si];rgb[di++]=rgba[si+1];rgb[di++]=rgba[si+2]}return{pngSha256:sha(png),rgba8Sha256:sha(rgba),rgb8Sha256:sha(rgb),pngBytes:png.length,rgbaBytes:rgba.length,rgbBytes:rgb.length}}
async function canvasData(page,c){return page.evaluate(async c=>{const img=new Image();img.decoding='sync';img.src='/'+c.image;await img.decode();const cv=document.createElement('canvas');cv.width=192;cv.height=192;const ctx=cv.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';if(c.sourceCropSize!=null)ctx.drawImage(img,0,0,c.sourceCropSize,c.sourceCropSize,0,0,192,192);else ctx.drawImage(img,0,0,img.naturalWidth,img.naturalHeight,0,0,192,192);const d=ctx.getImageData(0,0,192,192),u=d.data;let bin='';for(let i=0;i<u.length;i+=0x8000)bin+=String.fromCharCode(...u.subarray(i,i+0x8000));return{dataUrl:cv.toDataURL('image/png'),rgbaB64:btoa(bin),meta:{sourceNatural:[img.naturalWidth,img.naturalHeight],sourceCropSize:c.sourceCropSize??null,destination:[192,192],alpha:false,imageSmoothingEnabled:ctx.imageSmoothingEnabled,imageSmoothingQuality:ctx.imageSmoothingQuality,devicePixelRatio,readback:{constructor:u.constructor.name,length:u.length,colorSpace:d.colorSpace??null,pixelFormat:d.pixelFormat??null}}}},c)}
async function withCanvas(page,c,data,fn,values=[]){return page.evaluate(async({c,data,fn,values})=>{const img=new Image();img.src=data;await img.decode();const cv=document.createElement('canvas');cv.width=192;cv.height=192;const ctx=cv.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,0,0);return window.__WWMSYNC_V2_CANDIDATE_FREEZE__[fn](cv,c.mapId,...values)}, {c,data:data.dataUrl,fn,values})}
const output={
  schema:'wwmsync-descriptor-v2-candidate-replicate-v1',
  status:'RUNNING',
  replicate:Number(process.env.V2_REPLICATE||0),
  head:process.env.GITHUB_SHA||null,
  preregCommit:process.env.V2_PREREG_COMMIT||null,
  preregBlobSha1:process.env.V2_PREREG_BLOB||null,
  descriptorOutcomesInspected:false,
  D1D4Opened:false,
  RD:'PENDING',
  productionChange:'NO',
  reference:{lineage:prereg.canonicalBrowserRuntime.referenceCacheLineage,manifestSha256:referenceManifestSha256},
  runtime:{runner:'ubuntu-24.04',imageOS:process.env.ImageOS||process.env.IMAGE_OS||'unknown',imageVersion:process.env.ImageVersion||process.env.IMAGE_VERSION||'unknown',chromeVersion:process.env.V2_CHROME_VERSION||'unknown',playwrightCoreVersion:process.env.V2_PLAYWRIGHT_VERSION||'unknown'},
  controls:{}
};
let srv,browser;
try{
  ({s:srv,port:output.runtime.port}=await server());
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--disable-dev-shm-usage','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900},deviceScaleFactor:1});
  await page.goto(`http://127.0.0.1:${output.runtime.port}/index.html`,{waitUntil:'domcontentloaded',timeout:60000});
  await page.waitForFunction(()=>window.__WWMSYNC_V2_CANDIDATE_FREEZE__,null,{timeout:60000});
  output.runtime.browser=await page.evaluate(()=>{const cv=document.createElement('canvas'),ctx=cv.getContext('2d',{alpha:false});ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';const d=ctx.getImageData(0,0,1,1);return{userAgent:navigator.userAgent,devicePixelRatio,canvas:{alpha:false,imageSmoothingEnabled:ctx.imageSmoothingEnabled,imageSmoothingQuality:ctx.imageSmoothingQuality,attributes:ctx.getContextAttributes?.()||null},readback:{constructor:d.data.constructor.name,colorSpace:d.colorSpace??null,pixelFormat:d.pixelFormat??null}}});
  if(output.runtime.browser.devicePixelRatio!==1) throw new Error(`runtime DPR ${output.runtime.browser.devicePixelRatio} != 1`);
  if(output.runtime.browser.canvas.imageSmoothingEnabled!==true||output.runtime.browser.canvas.imageSmoothingQuality!=='high') throw new Error('canonical canvas smoothing mismatch');
  for(const c of config.controls){
    const gt=prereg.groundTruthCandidates[c.id];
    if(!gt||gt.geometryComplete!==true||![gt.x,gt.y,gt.angle,gt.radius,gt.scale].every(Number.isFinite)) throw new Error(`VF2_SOURCE_GT:${c.id}: incomplete GT geometry`);
    const sourcePath=path.join(siteDir,c.image),sourceBytes=fs.readFileSync(sourcePath),sourceSha256=sha(sourceBytes),pInput=prereg.inputs[c.id];
    if(pInput?.sourceSha256&&sourceSha256!==pInput.sourceSha256) throw new Error(`VF2_SOURCE_GT:${c.id}: source hash ${sourceSha256} != ${pInput.sourceSha256}`);
    const rendered=await canvasData(page,c),work=hashes(rendered);
    if(pInput?.workCanvasRgb8Sha256&&work.rgb8Sha256!==pInput.workCanvasRgb8Sha256) throw new Error(`VF2_SOURCE_GT:${c.id}: work RGB hash ${work.rgb8Sha256} != ${pInput.workCanvasRgb8Sha256}`);
    const gtD0=await withCanvas(page,c,rendered,'scoreD0At',[gt]);
    const search=await withCanvas(page,c,rendered,'globalSearch',[]);
    if(search?.error) throw new Error(`VF1_SEARCH:${c.id}: ${search.error}`);
    const alternatives=search?.alternatives||[];
    if(alternatives.length!==8) throw new Error(`VF1_SEARCH:${c.id}: complete final TOP-8 required, got ${alternatives.length}`);
    const top8=alternatives.map((z,i)=>{
      for(const k of ['x','y','angle','radius','scale','scaleAwareStructure','intensityNcc','productionCombined']) if(!Number.isFinite(z[k])) throw new Error(`VF1_SEARCH:${c.id}: rank ${i+1} missing ${k}`);
      const rank=i+1,dist=Math.hypot(z.x-gt.x,z.y-gt.y),classification=dist<=96?'NEAR_GT':'WRONG';
      return{candidateId:stableCandidateId(c.id,rank,z),productionRank:rank,x:z.x,y:z.y,angle:z.angle,radius:z.radius,scale:z.scale,gtDistancePx:dist,classification,scaleAwareStructure:z.scaleAwareStructure,intensityNcc:z.intensityNcc,intensityScore:z.intensityScore,productionCombined:z.productionCombined,inputHash:work.rgb8Sha256,referenceLineage:output.reference.lineage};
    });
    const w=search.winner,t=top8[0];
    if(!w||w.x!==t.x||w.y!==t.y||w.angle!==t.angle||w.radius!==t.radius||w.productionCombined!==t.productionCombined) throw new Error(`VF1_SEARCH:${c.id}: production winner not represented by TOP-8 rank 1`);
    const frozenGt={candidateId:`${c.id}:gt`,role:'GT',x:gt.x,y:gt.y,angle:gt.angle,radius:gt.radius,scale:gt.scale,gtDistancePx:0,scaleAwareStructure:gtD0.scaleAwareStructure,intensityNcc:gtD0.intensityNcc,intensityScore:gtD0.intensityScore,productionCombined:gtD0.productionCombined,inputHash:work.rgb8Sha256,referenceLineage:output.reference.lineage};
    for(const z of top8) z.d0ParetoDominatesGt=z.classification==='WRONG'&&paretoDominates(z,frozenGt);
    output.controls[c.id]={name:c.name,role:c.role,region:c.region,mapId:c.mapId,input:{sourcePath:c.image,sourceSha256,workCanvasPngSha256:work.pngSha256,workCanvasRgba8Sha256:work.rgba8Sha256,workCanvasRgb8Sha256:work.rgb8Sha256,sourceNatural:rendered.meta.sourceNatural,sourceCropSize:rendered.meta.sourceCropSize,canvas:rendered.meta},gt:frozenGt,top8,wrongCandidateIds:top8.filter(x=>x.classification==='WRONG').map(x=>x.candidateId),nearGtCandidateIds:top8.filter(x=>x.classification==='NEAR_GT').map(x=>x.candidateId),productionWinnerCandidateId:top8[0].candidateId};
  }
  output.status='PASS';
  output.verdictCandidate='VF0';
} catch(err){
  output.status='FAIL';
  output.error=String(err?.stack||err);
  output.verdictCandidate=String(err?.message||err).startsWith('VF2_SOURCE_GT:')?'VF2':'VF1';
  process.exitCode=1;
} finally {
  if(browser) await browser.close().catch(()=>{});
  if(srv) await new Promise(r=>srv.close(r));
  fs.writeFileSync(path.join(outDir,'candidate-run.json'),JSON.stringify(output,null,2)+'\n');
  fs.writeFileSync(path.join(outDir,'status.txt'),`STATUS=${output.status}\nVERDICT_CANDIDATE=${output.verdictCandidate||'UNKNOWN'}\nDESCRIPTOR_OUTCOMES_INSPECTED=NO\nD1_D4_OPENED=NO\nRD=PENDING\nPRODUCTION_CHANGE=NO\n`);
  console.log(JSON.stringify({status:output.status,replicate:output.replicate,verdictCandidate:output.verdictCandidate,controls:Object.keys(output.controls),error:output.error||null}));
}
