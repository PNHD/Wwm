#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function argsOf(argv){const out={};for(let i=2;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--'))continue;const k=a.slice(2);const v=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;out[k]=v}return out}
const args=argsOf(process.argv);
if(!args.site||!args.fixture||!args.report){console.error('Usage: node tools/replay-m1-manual-relative.mjs --site <site> --fixture <capture-dir> --report <report.json> [--archive <fixture.zip>]');process.exit(2)}
const siteDir=path.resolve(args.site),fixtureDir=path.resolve(args.fixture),reportPath=path.resolve(args.report),runtimePath=path.join(siteDir,'vision-sync.js');
const runtimeSource=await fsp.readFile(runtimePath,'utf8');
for(const forbidden of ['ANCHOR_FREE_STRUCTURAL','applyAbsoluteFix','__WWMSYNC_ABSOLUTE_REPLAY__'])if(runtimeSource.includes(forbidden))throw new Error(`absolute matcher leakage in M1 runtime: ${forbidden}`);
for(const required of ['M1_MANUAL_RELATIVE_V1',"implementation:'EXISTING_REUSED'",'best.score<.82','energy<5.5','magnitude>5.5'])if(!runtimeSource.includes(required))throw new Error(`M1 runtime invariant missing: ${required}`);

const capture=JSON.parse(await fsp.readFile(path.join(fixtureDir,'capture.json'),'utf8'));
if(capture.status!=='complete'||!Array.isArray(capture.frames)||capture.frames.length!==40)throw new Error(`expected complete 40-frame fixture, got ${capture.frames?.length}`);
const frameNames=capture.frames.map(f=>f.minimapFile||f.cropFile).filter(Boolean);
if(frameNames.length!==40)throw new Error(`expected 40 frame files, got ${frameNames.length}`);
const screenW=Number(capture.screen?.width||capture.window?.width),screenH=Number(capture.screen?.height||capture.window?.height),roiSize=Math.round(Math.min(screenW,screenH)*.25);
if(!(roiSize>0))throw new Error('fixture screen dimensions unavailable');
async function sha256(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex')}
const archiveSha256=args.archive?await sha256(path.resolve(args.archive)):null;
const expectedFixtureSha='aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216';
if(archiveSha256&&archiveSha256!==expectedFixtureSha)throw new Error(`fixture SHA mismatch ${archiveSha256}`);

const mime=new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json'],['.png','image/png'],['.jpg','image/jpeg'],['.jpeg','image/jpeg'],['.webp','image/webp'],['.webmanifest','application/manifest+json'],['.txt','text/plain; charset=utf-8']]);
function safeJoin(root,requestPath){const clean=decodeURIComponent(requestPath.split('?')[0]).replace(/^\/+/,''),resolved=path.resolve(root,clean);if(!resolved.startsWith(root+path.sep)&&resolved!==root)return null;return resolved}
const server=http.createServer(async(req,res)=>{try{let file;if(req.url.startsWith('/__fixture__/'))file=safeJoin(fixtureDir,req.url.slice('/__fixture__/'.length));else file=safeJoin(siteDir,req.url==='/'?'index.html':req.url);if(!file){res.writeHead(403);res.end('forbidden');return}let stat;try{stat=await fsp.stat(file)}catch{res.writeHead(404);res.end('not found');return}if(stat.isDirectory())file=path.join(file,'index.html');const data=await fsp.readFile(file);res.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.writeHead(200);res.end(data)}catch(error){res.writeHead(500);res.end(String(error))}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,base=`http://127.0.0.1:${port}`;

let chromium;
try{({chromium}=await import('playwright-core'))}catch{server.close();throw new Error('playwright-core is required')}
const executablePath=process.env.CHROME_BIN||process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
if(!executablePath){server.close();throw new Error('Chrome/Chromium not found')}
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
await page.addInitScript(()=>localStorage.setItem('wwmsync:lang','en'));
await page.route('https://s2.easebar.com/**',async route=>{const url=route.request().url();if(url.includes('/api/map/list'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{maps:[{id:1,name:'Qinghe'}]}})});if(url.includes('/api/map/points'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{categories:[]}})});return route.fulfill({status:404,body:'not mocked'})});
const pixel=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64');
await page.route('**/data/map/**',route=>route.fulfill({status:200,contentType:'image/png',body:pixel}));
const pageErrors=[];page.on('pageerror',error=>pageErrors.push(String(error.message||error)));
await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForFunction(()=>window.__WWMSYNC_VISION_TEST__&&window.__WWMSYNC_VISION_BRIDGE__?.state&&window.__WWMSYNC_VISION_HARDENING__?.version==='M1_MANUAL_RELATIVE_V1',null,{timeout:30000});
await page.waitForFunction(()=>document.querySelector('.leaflet-container')&&window.__WWMSYNC_VISION_TEST__.mapCenter(),null,{timeout:30000});

const runtimeContract=await page.evaluate(()=>({hardening:window.__WWMSYNC_VISION_HARDENING__,absoluteReplayType:typeof window.__WWMSYNC_ABSOLUTE_REPLAY__,absoluteFixType:typeof window.__WWMSYNC_VISION_BRIDGE__.applyAbsoluteFix,initial:window.__WWMSYNC_VISION_TEST__.state(),constants:window.__WWMSYNC_VISION_TEST__.constants}));
if(runtimeContract.absoluteReplayType!=='undefined'||runtimeContract.absoluteFixType!=='undefined'||runtimeContract.hardening.absoluteLocalization!==false)throw new Error(`absolute runtime contract violated: ${JSON.stringify(runtimeContract)}`);
const ZERO_RAW_EPS=runtimeContract.constants.ZERO_RAW_EPSILON,ZERO_CUM_EPS=runtimeContract.constants.ZERO_CUMULATIVE_EPSILON,MIN_MARKER_PX=runtimeContract.constants.MIN_MARKER_PX;
if(ZERO_RAW_EPS!==0.05||ZERO_CUM_EPS!==0.25)throw new Error('zero-motion epsilon changed after preregistration');

async function fixtureFrame(index){const name=frameNames[index-1];return page.evaluate(async({url,roiSize})=>{const image=new Image();image.decoding='async';image.src=url;await image.decode();const c=document.createElement('canvas');c.width=roiSize;c.height=roiSize;c.getContext('2d',{alpha:false,willReadFrequently:true}).drawImage(image,0,0,roiSize,roiSize,0,0,roiSize,roiSize);return window.__WWMSYNC_VISION_TEST__.motionStepCanvas(c)},{url:`${base}/__fixture__/${encodeURIComponent(name)}`,roiSize});}
async function syntheticCanvas(shiftX=0,shiftY=0){return page.evaluate(({shiftX,shiftY})=>{const n=216,base=document.createElement('canvas');base.width=n;base.height=n;const x=base.getContext('2d',{alpha:false});x.fillStyle='#101010';x.fillRect(0,0,n,n);let seed=0x12345678;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};for(let i=0;i<850;i++){const px=8+Math.floor(rand()*(n-16)),py=8+Math.floor(rand()*(n-16)),v=170+Math.floor(rand()*85),sz=1+Math.floor(rand()*3);x.fillStyle=`rgb(${v},${v},${v})`;x.fillRect(px,py,sz,sz)}x.strokeStyle='#f0f0f0';x.lineWidth=2;for(let i=0;i<12;i++){x.beginPath();x.moveTo(18+i*13,22);x.lineTo(40+i*11,190);x.stroke()}if(!shiftX&&!shiftY)return base;const shifted=document.createElement('canvas');shifted.width=n;shifted.height=n;const s=shifted.getContext('2d',{alpha:false});s.fillStyle='#101010';s.fillRect(0,0,n,n);s.drawImage(base,shiftX,shiftY);return shifted},{shiftX,shiftY});}
async function syntheticPair(dx,dy,seedLat=1.4,seedLng=-1.4){await page.evaluate(({seedLat,seedLng})=>{const t=window.__WWMSYNC_VISION_TEST__;t.setTuning(1,0);t.setManualSeed(seedLat,seedLng,1700000000000);t.resetMotionReference()},{seedLat,seedLng});const baseCanvas=await syntheticCanvas(0,0);/* handle cannot cross evaluate; rebuild inside helper calls below */return page.evaluate(async({dx,dy})=>{const make=(sx=0,sy=0)=>{const n=216,base=document.createElement('canvas');base.width=n;base.height=n;const x=base.getContext('2d',{alpha:false});x.fillStyle='#101010';x.fillRect(0,0,n,n);let seed=0x12345678;const rand=()=>{seed=(1664525*seed+1013904223)>>>0;return seed/4294967296};for(let i=0;i<850;i++){const px=8+Math.floor(rand()*(n-16)),py=8+Math.floor(rand()*(n-16)),v=170+Math.floor(rand()*85),sz=1+Math.floor(rand()*3);x.fillStyle=`rgb(${v},${v},${v})`;x.fillRect(px,py,sz,sz)}x.strokeStyle='#f0f0f0';x.lineWidth=2;for(let i=0;i<12;i++){x.beginPath();x.moveTo(18+i*13,22);x.lineTo(40+i*11,190);x.stroke()}if(!sx&&!sy)return base;const shifted=document.createElement('canvas');shifted.width=n;shifted.height=n;const s=shifted.getContext('2d',{alpha:false});s.fillStyle='#101010';s.fillRect(0,0,n,n);s.drawImage(base,sx,sy);return shifted};const t=window.__WWMSYNC_VISION_TEST__,baseline=t.motionStepCanvas(make()),step=t.motionStepCanvas(make(dx,dy)),state=t.state();return{baseline,step,state}},{dx,dy});}

// UI regression: actual Set current position mode + map click.
await page.evaluate(()=>{const t=window.__WWMSYNC_VISION_TEST__;t.beginReplay();t.setViewport(1.4,-1.4,11)});
await page.waitForFunction(()=>!document.getElementById('visionAnchorButton').disabled);
const initialLabel=(await page.locator('#visionAnchorButton').innerText()).trim();
if(initialLabel!=='Set current position')throw new Error(`unexpected initial seed label: ${initialLabel}`);
const expectedCenter=await page.evaluate(()=>{const c=window.__WWMSYNC_VISION_TEST__.mapContainerCenterLatLng();return{lat:c.lat,lng:c.lng}});
await page.locator('#visionAnchorButton').click();
const mapBox=await page.locator('#map').boundingBox();if(!mapBox)throw new Error('map box unavailable');
await page.mouse.click(mapBox.x+mapBox.width/2,mapBox.y+mapBox.height/2);
await page.waitForFunction(()=>window.__WWMSYNC_VISION_TEST__.state().hasSeed);
const seededUi=await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.state());
const seedError=Math.hypot(seededUi.markerLatLng.lat-expectedCenter.lat,seededUi.markerLatLng.lng-expectedCenter.lng);
if(seedError>1e-8)throw new Error(`UI seed not at clicked center: ${seedError}`);
const resyncLabel=(await page.locator('#visionAnchorButton').innerText()).trim();if(resyncLabel!=='Re-sync position')throw new Error(`unexpected re-sync label: ${resyncLabel}`);

// Frozen zero-motion control: identical deterministic ROI, repeated.
await page.evaluate(()=>{const t=window.__WWMSYNC_VISION_TEST__;t.setManualSeed(1.4,-1.4,1700000000000);t.setTuning(1,0);t.resetMotionReference()});
const zeroResults=[];
for(let i=0;i<10;i++)zeroResults.push(await page.evaluate(()=>{const make=()=>{const n=216,c=document.createElement('canvas');c.width=n;c.height=n;const x=c.getContext('2d',{alpha:false});x.fillStyle='#111';x.fillRect(0,0,n,n);for(let k=0;k<500;k++){const px=10+(k*37)%196,py=10+(k*71)%196,v=180+(k*29)%75;x.fillStyle=`rgb(${v},${v},${v})`;x.fillRect(px,py,2+(k%2),2+(k%3))}return c};return window.__WWMSYNC_VISION_TEST__.motionStepCanvas(make())}));
const zeroMeasured=zeroResults.filter(x=>!x.baseline),zeroRawMax=Math.max(0,...zeroMeasured.map(x=>Math.hypot(x.dx||0,x.dy||0))),zeroFinal=await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.state()),zeroCum=Math.hypot(zeroFinal.trackingState.cumulativeDx,zeroFinal.trackingState.cumulativeDy);
const zeroPass=zeroRawMax<=ZERO_RAW_EPS&&zeroCum<=ZERO_CUM_EPS;
if(!zeroPass)throw new Error(`zero-motion drift: rawMax=${zeroRawMax} cumulative=${zeroCum}`);

// Sign/reversal control. In a player-centered minimap, terrain image translation and
// player map displacement have opposite signs. Leaflet projected +x=east/right,
// +y=south/down, so image +Y must move marker north (negative map y).
const signCases=[{name:'image +X',dx:3,dy:0,rawAxis:'dx',rawSign:1,mapAxis:'x',mapSign:-1},{name:'image -X',dx:-3,dy:0,rawAxis:'dx',rawSign:-1,mapAxis:'x',mapSign:1},{name:'image +Y',dx:0,dy:3,rawAxis:'dy',rawSign:1,mapAxis:'y',mapSign:-1},{name:'image -Y',dx:0,dy:-3,rawAxis:'dy',rawSign:-1,mapAxis:'y',mapSign:1}],signResults=[];
for(const c of signCases){const r=await syntheticPair(c.dx,c.dy);const raw=c.rawAxis==='dx'?r.step.dx:r.step.dy,mapDelta=c.mapAxis==='x'?r.step.convertedDx:r.step.convertedDy,passed=r.step.accepted&&r.step.moved&&Math.sign(raw)===c.rawSign&&Math.sign(mapDelta)===c.mapSign;signResults.push({...c,rawDx:r.step.dx,rawDy:r.step.dy,convertedDx:r.step.convertedDx,convertedDy:r.step.convertedDy,confidence:r.step.confidence,score:r.step.score,passed});if(!passed)throw new Error(`sign control failed ${c.name}: ${JSON.stringify(signResults.at(-1))}`)}

async function realReplay(runLabel){await page.evaluate(()=>{const t=window.__WWMSYNC_VISION_TEST__;t.setTuning(1,0);t.setManualSeed(1.4,-1.4,1700000000000);t.resetMotionReference()});const rows=[];for(let i=1;i<=40;i++){const r=await fixtureFrame(i),s=await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.state());rows.push({frame:i,rawDx:r.dx??0,rawDy:r.dy??0,accepted:!!r.accepted,baseline:!!r.baseline,confidence:r.confidence??0,score:r.score??null,energy:r.energy??null,representation:r.representation??null,moveAccepted:!!r.moved,moveReason:r.moveReason??r.reason??null,convertedMapDx:r.convertedDx??0,convertedMapDy:r.convertedDy??0,cumulativeMapDx:s.trackingState.cumulativeDx,cumulativeMapDy:s.trackingState.cumulativeDy,currentMapX:s.trackingState.currentMapX,currentMapY:s.trackingState.currentMapY,status:s.trackingState.status,markerLat:s.markerLatLng?.lat??null,markerLng:s.markerLatLng?.lng??null})}const final=await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.state()),moved=rows.filter(x=>x.moveAccepted),accepted=rows.filter(x=>x.accepted&&!x.baseline),net=Math.hypot(final.trackingState.cumulativeDx,final.trackingState.cumulativeDy),pathLength=moved.reduce((sum,x)=>sum+Math.hypot(x.convertedMapDx,x.convertedMapDy),0),netPathRatio=pathLength?net/pathLength:0,maxAcceptedRaw=Math.max(0,...accepted.map(x=>Math.hypot(x.rawDx,x.rawDy))),materiallyMoved=net>MIN_MARKER_PX,coherent=netPathRatio>=0.5&&maxAcceptedRaw<=5.5+1e-9;return{runLabel,seed:{lat:1.4,lng:-1.4,mapX:final.manualSeed.mapX,mapY:final.manualSeed.mapY},frames:rows,summary:{acceptedPairs:accepted.length,movedFrames:moved.length,netMapDisplacement:net,pathLength,netPathRatio,maxAcceptedRaw,cumulativeMapDx:final.trackingState.cumulativeDx,cumulativeMapDy:final.trackingState.cumulativeDy,finalMapX:final.trackingState.currentMapX,finalMapY:final.trackingState.currentMapY,finalLat:final.markerLatLng.lat,finalLng:final.markerLatLng.lng,materiallyMoved,coherent,status:final.trackingState.status}}}
const replayA=await realReplay('A'),replayB=await realReplay('B');
const canonical=r=>JSON.stringify(r.frames.map(x=>[x.frame,+x.rawDx.toFixed(9),+x.rawDy.toFixed(9),x.accepted,+x.confidence.toFixed(9),+x.convertedMapDx.toFixed(9),+x.convertedMapDy.toFixed(9),+x.cumulativeMapDx.toFixed(9),+x.cumulativeMapDy.toFixed(9),x.status]));
const deterministic=canonical(replayA)===canonical(replayB)&&Math.abs(replayA.summary.finalMapX-replayB.summary.finalMapX)<1e-9&&Math.abs(replayA.summary.finalMapY-replayB.summary.finalMapY)<1e-9;
if(!replayA.summary.materiallyMoved||replayA.summary.movedFrames<1)throw new Error(`real replay marker did not move: ${JSON.stringify(replayA.summary)}`);
if(!replayA.summary.coherent)throw new Error(`real replay is not directionally coherent: ${JSON.stringify(replayA.summary)}`);
if(!deterministic)throw new Error('real replay is not deterministic across repeated execution');

// Re-sync regression: old cumulative must clear, marker jumps exactly to new seed,
// first post-reseed frame is baseline, then relative motion resumes from that seed.
const beforeResync=await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.state());
await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.setViewport(1.55,-1.25,11));
const newExpected=await page.evaluate(()=>{const c=window.__WWMSYNC_VISION_TEST__.mapContainerCenterLatLng();return{lat:c.lat,lng:c.lng}});
await page.locator('#visionAnchorButton').click();
const mapBox2=await page.locator('#map').boundingBox();await page.mouse.click(mapBox2.x+mapBox2.width/2,mapBox2.y+mapBox2.height/2);
await page.waitForFunction(({lat,lng})=>{const s=window.__WWMSYNC_VISION_TEST__.state();return s.hasSeed&&Math.abs(s.markerLatLng.lat-lat)<1e-8&&Math.abs(s.markerLatLng.lng-lng)<1e-8},{lat:newExpected.lat,lng:newExpected.lng});
const afterReseed=await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.state());
if(Math.hypot(afterReseed.trackingState.cumulativeDx,afterReseed.trackingState.cumulativeDy)>1e-12)throw new Error('re-sync did not clear cumulative displacement');
const postResync=await syntheticPair(3,0,newExpected.lat,newExpected.lng);
if(!postResync.baseline.baseline||!postResync.step.accepted||!postResync.step.moved)throw new Error(`tracking did not resume after re-sync: ${JSON.stringify(postResync)}`);
const afterResume=postResync.state;

const uiPass=initialLabel==='Set current position'&&resyncLabel==='Re-sync position'&&seedError<=1e-8&&afterReseed.hasSeed&&postResync.step.moved;
const absoluteUnused=runtimeContract.absoluteReplayType==='undefined'&&runtimeContract.absoluteFixType==='undefined'&&runtimeContract.hardening.absoluteLocalization===false;
const pass=zeroPass&&signResults.every(x=>x.passed)&&replayA.summary.materiallyMoved&&replayA.summary.coherent&&deterministic&&uiPass&&absoluteUnused&&pageErrors.length===0;
const report={schema:'wwmsync-m1-manual-relative-v1',generatedAtUtc:new Date().toISOString(),verdict:pass?'M1-PASS':'M1-FAIL',motionSource:'EXISTING_REUSED',fixture:{name:'wwmsync-gfn-motion-20260810-143835.zip',archiveSha256,expectedArchiveSha256:expectedFixtureSha,frameCount:40,fps:Number(capture.fps)||5,intervalMs:Number(capture.intervalMs)||200,sourceDimensions:{width:screenW,height:screenH},replayRoiSize:roiSize},coordinateSemantics:{imageX:'right-positive',imageY:'down-positive',terrainToPlayer:'player = -terrain displacement',mapProjectedX:'east/right-positive',mapProjectedY:'south/down-positive',referenceZoom:runtimeContract.constants.TRACKING_REFERENCE_ZOOM,orientationSource:'manual supported control only',scaleSource:'existing manual movement scale; default 1',absoluteZ5:'not used by M1 relative marker integration'},runtimeContract,zeroMotion:{epsilonRawWorkPx:ZERO_RAW_EPS,epsilonCumulativeMapPx:ZERO_CUM_EPS,maxRawMagnitude:zeroRawMax,cumulativeMapMovement:zeroCum,pass:zeroPass},signControl:{cases:signResults,pass:signResults.every(x=>x.passed)},realReplay:{runA:replayA,runB:{summary:replayB.summary},deterministic},uiIntegration:{initialLabel,resyncLabel,initialSeedExpected:expectedCenter,initialSeedState:seededUi,seedError,beforeResync,newSeedExpected:newExpected,afterReseed,postResync:{baseline:postResync.baseline,step:postResync.step,state:afterResume},pass:uiPass},absoluteMatcher:{used:false,callable:false,globalReplayExposed:false,sourceForbiddenTokensAbsent:true,pass:absoluteUnused},pageErrors};
await fsp.mkdir(path.dirname(reportPath),{recursive:true});await fsp.writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({verdict:report.verdict,motionSource:report.motionSource,zeroMotion:report.zeroMotion,signControl:report.signControl.cases.map(x=>({name:x.name,passed:x.passed,rawDx:x.rawDx,rawDy:x.rawDy,convertedDx:x.convertedDx,convertedDy:x.convertedDy})),realReplay:replayA.summary,deterministic,uiPass,absoluteUnused,pageErrors},null,2));
await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.endReplay());
await browser.close();server.close();
if(!pass)process.exitCode=1;
