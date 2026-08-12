#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv=process.argv.slice(2); const arg=name=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:null};
const siteDir=path.resolve(arg('--site')||'control-site');
const sourceReportPath=path.resolve(arg('--control-report')||'reference-audit-output/positive-control-source.json');
const reportPath=path.resolve(arg('--report')||'reference-audit-output/positive-control-matcher.json');
const source=JSON.parse(fs.readFileSync(sourceReportPath,'utf8').replace(/^\uFEFF/,''));
const expected={x:Number(source.expected?.dashenZ5?.[0]),y:Number(source.expected?.dashenZ5?.[1])};
if(!Number.isFinite(expected.x)||!Number.isFinite(expected.y))throw new Error('positive control expected Dashen z5 coordinate missing');
const mime=p=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(p).toLowerCase()]||'application/octet-stream');
function server(){return new Promise(resolve=>{const s=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1'),rel=decodeURIComponent(u.pathname.slice(1))||'index.html',root=path.resolve(siteDir),file=path.resolve(siteDir,rel);if((!file.startsWith(root+path.sep)&&file!==root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(file.startsWith(root)?404:403).end();return}res.writeHead(200,{'content-type':mime(file),'cache-control':'no-store'});fs.createReadStream(file).pipe(res)});s.listen(0,'127.0.0.1',()=>resolve({s,port:s.address().port}))})}
const distance=c=>Math.hypot(Number(c?.x)-expected.x,Number(c?.y)-expected.y);
const {s,port}=await server(); let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--disable-dev-shm-usage','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}}); page.on('pageerror',e=>console.error('[positive-control pageerror]',e.message)); page.on('console',m=>{if(m.type()==='error')console.error('[positive-control console]',m.text())});
  const response=await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'domcontentloaded',timeout:60000}); if(!response?.ok())throw new Error(`positive-control site HTTP ${response?.status()}`);
  await page.waitForFunction(()=>window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__,null,{timeout:60000});
  const probes=[];
  for(const crop of source.crops||[]){
    const url=`/positive-control/${crop.file}`;
    const global=await page.evaluate(async url=>{window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset();const img=new Image();img.decoding='sync';img.src=url;await img.decode();const c=document.createElement('canvas');c.width=192;c.height=192;c.getContext('2d',{alpha:false}).drawImage(img,0,0,192,192);return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.globalProbe(c,1,8)},url);
    const candidates=(global?.candidates||[]).map(c=>({...c,expectedDistanceFinePx:Math.hypot(Number(c.x)-expected.x,Number(c.y)-expected.y)}));
    const closest=candidates.slice().sort((a,b)=>a.expectedDistanceFinePx-b.expectedDistanceFinePx)[0]||null;
    probes.push({crop,global:{coarse:global?.coarse||null,fine:global?.fine||null,info:global?.info||null},candidates,closest,expectedInTopK:!!closest&&closest.expectedDistanceFinePx<=120});
  }
  const local=[];
  for(const radius of [32,40,48,56,64,72,80])for(const angle of [0,90,180,270]){
    const fixed=await page.evaluate(async ({expected,radius,angle})=>{const img=new Image();img.decoding='sync';img.src='/positive-control/general-shrine-256.png';await img.decode();const c=document.createElement('canvas');c.width=192;c.height=192;c.getContext('2d',{alpha:false}).drawImage(img,0,0,192,192);return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.scoreFixed(c,{x:expected.x,y:expected.y,radius,angle,coarseScore:.60,beamMargin:1},1,`positive:${radius}`)}, {expected,radius,angle});
    local.push({radius,scale:radius/40,angle,scaleScore:fixed?.scaleScore??null,intensityScore:fixed?.intensityScore??null,intensityNcc:fixed?.intensityNcc??null,combinedScore:fixed?.combinedScore??null,matchGateAccepted:fixed?.matchGateAccepted??false,matchGateReason:fixed?.matchGateReason??null});
  }
  local.sort((a,b)=>(b.combinedScore??-1)-(a.combinedScore??-1));
  const topKHits=probes.filter(p=>p.expectedInTopK); const bestTopK=topKHits.slice().sort((a,b)=>a.closest.expectedDistanceFinePx-b.closest.expectedDistanceFinePx)[0]||null; const bestLocal=local[0]||null;
  const exactMatcherPass=topKHits.length>0;
  const report={schema:'wwmsync-reference-positive-control-matcher-v1',generatedAtUtc:new Date().toISOString(),control:source.control,source:source.source,independentRegistration:source.independentRegistration,expected:{...source.expected,toleranceFinePx:120},scope:{productionVisionSourceChanged:false,productionGateChanged:false,structuralGate:.58,globalBoundsBypassed:false,replayInstrumentationOnly:true},probes,localKnownCoordinateSweep:local,verdict:exactMatcherPass?'PASS-EXPECTED-LOCATION-IN-PRODUCTION-GLOBAL-TOP-K':'FAIL-EXPECTED-LOCATION-NOT-IN-PRODUCTION-GLOBAL-TOP-K',bestTopKHit:bestTopK?{crop:bestTopK.crop,rank:bestTopK.closest.rank,distanceFinePx:bestTopK.closest.expectedDistanceFinePx,candidate:bestTopK.closest}:null,bestKnownCoordinateScore:bestLocal,productionReferencePipelinePositiveControlPass:exactMatcherPass};
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));console.log(JSON.stringify({verdict:report.verdict,independentRegistration:{inliers:source.independentRegistration?.inliers,inlierRatio:source.independentRegistration?.inlierRatio},bestTopKHit:report.bestTopKHit,bestKnownCoordinateScore:bestLocal},null,2));
}finally{if(browser)await browser.close();await new Promise(r=>s.close(r))}
