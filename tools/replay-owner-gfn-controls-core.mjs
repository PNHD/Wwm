#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv=process.argv.slice(2);
const arg=(name,fallback=null)=>{const i=argv.indexOf(name);return i>=0?argv[i+1]:fallback};
const siteDir=path.resolve(arg('--site','owner-gfn-site'));
const metadataPath=path.resolve(arg('--metadata','fixtures/owner-gfn-controls/metadata.json'));
const outputDir=path.resolve(arg('--output','owner-gfn-output'));
const topK=Number(arg('--top-k','8'));
const metadata=JSON.parse(fs.readFileSync(metadataPath,'utf8').replace(/^\uFEFF/,''));
const mime=p=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml'}[path.extname(p).toLowerCase()]||'application/octet-stream');
function startServer(){return new Promise(resolve=>{const s=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1'),rel=decodeURIComponent(u.pathname.slice(1))||'index.html',root=path.resolve(siteDir),file=path.resolve(siteDir,rel);if((!file.startsWith(root+path.sep)&&file!==root)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(file.startsWith(root)?404:403).end();return}res.writeHead(200,{'content-type':mime(file),'cache-control':'no-store'});fs.createReadStream(file).pipe(res)});s.listen(0,'127.0.0.1',()=>resolve({s,port:s.address().port}))})}
const dist=(c,e)=>Math.hypot(Number(c?.x)-e.x,Number(c?.y)-e.y);
const cleanCandidate=(c,index,expected)=>({...c,rank:c.rank??index+1,expectedDistanceFinePx:dist(c,expected)});
const gateClass=(expectedBasin,hasCandidates)=>{
  if(!expectedBasin)return hasCandidates?'FAIL_EXPECTED_BASIN_NOT_SURFACED':'FAIL_NO_GLOBAL_CANDIDATES';
  return expectedBasin.matchGateAccepted?'PASS':'FAIL_EXPECTED_BASIN_GATE';
};
const radii=[32,48,64,80,96,112];
const coarseAngles=Array.from({length:12},(_,i)=>i*30);

fs.mkdirSync(outputDir,{recursive:true});
const {s,port}=await startServer();let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--disable-dev-shm-usage','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',e=>console.error('[owner-gfn pageerror]',e.message));
  page.on('console',m=>{if(m.type()==='error')console.error('[owner-gfn console]',m.text())});
  const response=await page.goto(`http://127.0.0.1:${port}/index.html`,{waitUntil:'domcontentloaded',timeout:60000});
  if(!response?.ok())throw new Error(`owner GFN replay site HTTP ${response?.status()}`);
  await page.waitForFunction(()=>window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__,null,{timeout:60000});

  const reports=[];
  for(const control of metadata.controls){
    const expected={x:Number(control.groundTruth.dashenZ5[0]),y:Number(control.groundTruth.dashenZ5[1])};
    const tolerance=Number(control.groundTruth.uncertaintyRadiusZ5Px);
    if(!Number.isFinite(expected.x)||!Number.isFinite(expected.y)||!Number.isFinite(tolerance)||tolerance<=0)throw new Error(`invalid GT for ${control.id}`);
    const imageRel=control.roi.inspectionFixture.replace(/^fixtures\/owner-gfn-controls\//,'owner-gfn/');
    const sourceWidth=Number(control.provenance.gameplayAttachment.dimensions[0]);
    const sourceHeight=Number(control.provenance.gameplayAttachment.dimensions[1]);
    const semanticSize=Math.min(sourceWidth,sourceHeight)*Number(control.roi.roiFraction);

    const global=await page.evaluate(async({imageRel,mapId,semanticSize,topK})=>{
      window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset();
      const img=new Image();img.decoding='sync';img.src='/'+imageRel;await img.decode();
      const c=document.createElement('canvas');c.width=192;c.height=192;
      c.getContext('2d',{alpha:false}).drawImage(img,0,0,semanticSize,semanticSize,0,0,192,192);
      const probe=await window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.globalProbe(c,mapId,topK);
      return{probe,roiPng:c.toDataURL('image/png')};
    },{imageRel,mapId:Number(control.mapId),semanticSize,topK});
    const png=Buffer.from(global.roiPng.replace(/^data:image\/png;base64,/,''),'base64');
    fs.writeFileSync(path.join(outputDir,`${control.id}-roi-192.png`),png);

    const candidates=(global.probe?.candidates||[]).map((c,index)=>cleanCandidate(c,index,expected));
    const expectedCandidates=candidates.filter(c=>c.expectedDistanceFinePx<=tolerance).sort((a,b)=>Number(a.rank)-Number(b.rank)||a.expectedDistanceFinePx-b.expectedDistanceFinePx);
    const expectedBasin=expectedCandidates[0]||null;
    const expectedRank=expectedBasin?.rank??null;
    const falseOutranks=expectedBasin?candidates.some(c=>Number(c.rank)<Number(expectedRank)&&c.expectedDistanceFinePx>tolerance):candidates.length>0;
    const classification=gateClass(expectedBasin,candidates.length>0);

    const local=[];
    if(classification!=='PASS'){
      for(const radius of radii)for(const angle of coarseAngles){
        const fixed=await page.evaluate(async({imageRel,mapId,semanticSize,expected,radius,angle,key})=>{
          const img=new Image();img.decoding='sync';img.src='/'+imageRel;await img.decode();
          const c=document.createElement('canvas');c.width=192;c.height=192;
          c.getContext('2d',{alpha:false}).drawImage(img,0,0,semanticSize,semanticSize,0,0,192,192);
          return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.scoreFixed(c,{x:expected.x,y:expected.y,radius,angle,coarseScore:.60,beamMargin:1},mapId,key);
        },{imageRel,mapId:Number(control.mapId),semanticSize,expected,radius,angle,key:`owner-gfn:${control.id}`});
        local.push({stage:'coarse',radius,scale:radius/40,angle,coarseScore:fixed?.coarseScore??null,rawStructuralScore:fixed?.rawStructuralScore??null,scaleScore:fixed?.scaleScore??null,intensityScore:fixed?.intensityScore??null,intensityNcc:fixed?.intensityNcc??null,combinedScore:fixed?.combinedScore??null,edgeAgreement:fixed?.edgeAgreement??null,positiveEdgeScore:fixed?.positiveEdgeScore??null,negativeQuietScore:fixed?.negativeQuietScore??null,featureCount:fixed?.featureCount??null,normalizedContrast:fixed?.normalizedContrast??null,matchGateAccepted:fixed?.matchGateAccepted??false,matchGateReason:fixed?.matchGateReason??null});
      }
      local.sort((a,b)=>(b.combinedScore??-1)-(a.combinedScore??-1));
      const seed=local[0];
      if(seed){
        const refR=[];for(let r=Math.max(24,seed.radius-16);r<=Math.min(128,seed.radius+16)+1e-9;r+=4)refR.push(r);
        const refA=[];for(let d=-15;d<=15+1e-9;d+=2.5)refA.push((seed.angle+d+360)%360);
        for(const radius of refR)for(const angle of refA){
          const fixed=await page.evaluate(async({imageRel,mapId,semanticSize,expected,radius,angle,key})=>{
            const img=new Image();img.decoding='sync';img.src='/'+imageRel;await img.decode();
            const c=document.createElement('canvas');c.width=192;c.height=192;
            c.getContext('2d',{alpha:false}).drawImage(img,0,0,semanticSize,semanticSize,0,0,192,192);
            return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.scoreFixed(c,{x:expected.x,y:expected.y,radius,angle,coarseScore:.60,beamMargin:1},mapId,key);
          },{imageRel,mapId:Number(control.mapId),semanticSize,expected,radius,angle,key:`owner-gfn:${control.id}`});
          local.push({stage:'refine',radius,scale:radius/40,angle,coarseScore:fixed?.coarseScore??null,rawStructuralScore:fixed?.rawStructuralScore??null,scaleScore:fixed?.scaleScore??null,intensityScore:fixed?.intensityScore??null,intensityNcc:fixed?.intensityNcc??null,combinedScore:fixed?.combinedScore??null,edgeAgreement:fixed?.edgeAgreement??null,positiveEdgeScore:fixed?.positiveEdgeScore??null,negativeQuietScore:fixed?.negativeQuietScore??null,featureCount:fixed?.featureCount??null,normalizedContrast:fixed?.normalizedContrast??null,matchGateAccepted:fixed?.matchGateAccepted??false,matchGateReason:fixed?.matchGateReason??null});
        }
        local.sort((a,b)=>(b.combinedScore??-1)-(a.combinedScore??-1));
      }
    }

    const report={
      schema:'wwmsync-owner-known-location-gfn-control-v1',
      generatedAtUtc:new Date().toISOString(),
      control:{id:control.id,name:control.name,captureDomain:metadata.captureDomain},
      provenance:control.provenance,
      groundTruth:control.groundTruth,
      roi:{...control.roi,sourceAttachmentDimensions:[sourceWidth,sourceHeight],semanticSize,matcherInput:[192,192],matcherInputFile:`${control.id}-roi-192.png`,matcherInputSha256:null},
      scope:{productionBaselineHead:metadata.productionBaselineHead,productionVisionSourceChanged:false,productionCacheChanged:false,productionPreprocessingChanged:false,productionGateChanged:false,structuralGate:.58,replayInstrumentationOnly:true,classificationRule:'PASS requires expected independently known basin in production global TOP-K and that expected basin itself passes unchanged matchGate. Fixed known-coordinate local sweep is diagnostic only.'},
      global:{coarse:global.probe?.coarse||null,fine:global.probe?.fine||null,info:global.probe?.info||null,candidates},
      expectedBasin:{classification,rank:expectedRank,distanceFinePx:expectedBasin?.expectedDistanceFinePx??null,candidate:expectedBasin,falseBasinOutranksExpected:falseOutranks},
      localKnownCoordinateDiagnostic:{notAcceptanceEvidence:true,ran:classification!=='PASS',best:local[0]||null,sweep:local},
      classification
    };
    fs.writeFileSync(path.join(outputDir,`${control.id}-matcher.json`),JSON.stringify(report,null,2));
    reports.push(report);
    console.log(JSON.stringify({id:control.id,classification,expectedBasin:report.expectedBasin,global:{coarse:report.global.coarse,fine:report.global.fine,info:report.global.info},bestLocal:report.localKnownCoordinateDiagnostic.best},null,2));
  }
  fs.writeFileSync(path.join(outputDir,'summary.json'),JSON.stringify({schema:'wwmsync-owner-gfn-controls-summary-v1',generatedAtUtc:new Date().toISOString(),baseline:metadata.productionBaselineHead,structuralGate:.58,controls:reports.map(r=>({id:r.control.id,name:r.control.name,classification:r.classification,expectedBasin:r.expectedBasin,bestLocal:r.localKnownCoordinateDiagnostic.best,roi:r.roi,groundTruth:r.groundTruth}))},null,2));
}finally{if(browser)await browser.close();await new Promise(r=>s.close(r))}
