#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv=process.argv.slice(2);const arg=(name,fallback=null)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:fallback};
const siteDir=path.resolve(arg('--site','control-site'));
const imageRel=arg('--image','public-hud/steam-general-shrine-1-roi.png');
const groundTruthPath=path.resolve(arg('--ground-truth','public-hud-output/steam-general-shrine-ground-truth.json'));
const reportPath=path.resolve(arg('--report','public-hud-output/steam-general-shrine-matcher.json'));
const mapId=Number(arg('--map-id','1'));
const gt=JSON.parse(fs.readFileSync(groundTruthPath,'utf8').replace(/^\uFEFF/,''));
const expected={x:Number(gt.expected?.dashenZ5?.[0]),y:Number(gt.expected?.dashenZ5?.[1])};
const tolerance=Number(gt.expected?.uncertaintyRadiusZ5Px);
if(!Number.isFinite(expected.x)||!Number.isFinite(expected.y)||!Number.isFinite(tolerance)||tolerance<=0)throw new Error('valid expected Dashen z5 coordinate and uncertainty radius required');
const mime=p=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(p).toLowerCase()]||'application/octet-stream');
function startServer(){return new Promise(resolve=>{const s=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1'),rel=decodeURIComponent(u.pathname.slice(1))||'index.html',root=path.resolve(siteDir),file=path.resolve(siteDir,rel);if((!file.startsWith(root+path.sep)&&file!==root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(file.startsWith(root)?404:403).end();return}res.writeHead(200,{'content-type':mime(file),'cache-control':'no-store'});fs.createReadStream(file).pipe(res)});s.listen(0,'127.0.0.1',()=>resolve({s,port:s.address().port}))})}
const dist=c=>Math.hypot(Number(c?.x)-expected.x,Number(c?.y)-expected.y);
const {s,port}=await startServer();let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--disable-dev-shm-usage','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>console.error('[hud-control pageerror]',e.message));page.on('console',m=>{if(m.type()==='error')console.error('[hud-control console]',m.text())});
  const response=await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'domcontentloaded',timeout:60000});if(!response?.ok())throw new Error(`HUD control site HTTP ${response?.status()}`);
  await page.waitForFunction(()=>window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__,null,{timeout:60000});
  const global=await page.evaluate(async({imageRel,mapId})=>{window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset();const img=new Image();img.decoding='sync';img.src='/'+imageRel;await img.decode();const c=document.createElement('canvas');c.width=192;c.height=192;c.getContext('2d',{alpha:false}).drawImage(img,0,0,192,192);return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.globalProbe(c,mapId,8)},{imageRel,mapId});
  const candidates=(global?.candidates||[]).map((c,index)=>({...c,rank:c.rank??index+1,expectedDistanceFinePx:dist(c)}));
  const expectedCandidates=candidates.filter(c=>c.expectedDistanceFinePx<=tolerance).sort((a,b)=>a.expectedDistanceFinePx-b.expectedDistanceFinePx);
  const expectedBasin=expectedCandidates[0]||null;
  const expectedRank=expectedBasin?.rank??null;
  const falseOutranks=expectedBasin?candidates.some(c=>Number(c.rank)<Number(expectedRank)&&c.expectedDistanceFinePx>tolerance):candidates.length>0;
  const local=[];
  for(const radius of[32,48,64,80,96,112])for(let angle=0;angle<360;angle+=30){
    const fixed=await page.evaluate(async({imageRel,mapId,expected,radius,angle})=>{const img=new Image();img.decoding='sync';img.src='/'+imageRel;await img.decode();const c=document.createElement('canvas');c.width=192;c.height=192;c.getContext('2d',{alpha:false}).drawImage(img,0,0,192,192);return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.scoreFixed(c,{x:expected.x,y:expected.y,radius,angle,coarseScore:.60,beamMargin:1},mapId,'public-hud-known-coordinate')},{imageRel,mapId,expected,radius,angle});
    local.push({radius,scale:radius/40,angle,coarseScore:fixed?.coarseScore??null,rawStructuralScore:fixed?.rawStructuralScore??null,scaleScore:fixed?.scaleScore??null,intensityScore:fixed?.intensityScore??null,intensityNcc:fixed?.intensityNcc??null,combinedScore:fixed?.combinedScore??null,edgeAgreement:fixed?.edgeAgreement??null,positiveEdgeScore:fixed?.positiveEdgeScore??null,negativeQuietScore:fixed?.negativeQuietScore??null,featureCount:fixed?.featureCount??null,normalizedContrast:fixed?.normalizedContrast??null,matchGateAccepted:fixed?.matchGateAccepted??false,matchGateReason:fixed?.matchGateReason??null});
  }
  local.sort((a,b)=>(b.combinedScore??-1)-(a.combinedScore??-1));
  const classification=!expectedBasin?'HUD-FAIL':expectedBasin.matchGateAccepted?'HUD-PASS':'HUD-WEAK';
  const report={schema:'wwmsync-public-hud-production-control-v1',generatedAtUtc:new Date().toISOString(),control:gt.control,source:gt.source,lineage:gt.lineage,groundTruth:gt.groundTruth,expected:{...gt.expected,toleranceFinePx:tolerance},roi:gt.roi,scope:{productionVisionSourceChanged:false,productionCacheChanged:false,productionGateChanged:false,structuralGate:.58,globalBoundsBypassed:false,replayInstrumentationOnly:true,classificationRule:'PASS requires expected known-coordinate basin in production global TOP-K and that basin must pass unchanged matchGate. Fixed-coordinate sweep is diagnostic only.'},global:{coarse:global?.coarse||null,fine:global?.fine||null,info:global?.info||null,candidates},expectedBasin:{classification,rank:expectedRank,distanceFinePx:expectedBasin?.expectedDistanceFinePx??null,candidate:expectedBasin,falseBasinOutranksExpected:falseOutranks},localKnownCoordinateDiagnostic:{notAcceptanceEvidence:true,best:local[0]||null,sweep:local},classification};
  fs.mkdirSync(path.dirname(reportPath),{recursive:true});fs.writeFileSync(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({classification,expectedBasin:report.expectedBasin,global:report.global,bestLocal:report.localKnownCoordinateDiagnostic.best},null,2));
}finally{if(browser)await browser.close();await new Promise(r=>s.close(r))}
