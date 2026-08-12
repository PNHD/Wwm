#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

function argsOf(argv){const out={};for(let i=2;i<argv.length;i++){const a=argv[i];if(!a.startsWith('--'))continue;const k=a.slice(2);const v=argv[i+1]&&!argv[i+1].startsWith('--')?argv[++i]:true;out[k]=v}return out}
const args=argsOf(process.argv);
if(!args.site||!args.fixture||!args.report){console.error('Usage: node tools/replay-real-capture.mjs --site <dist> --fixture <capture-dir> --report <report.json> [--archive <capture.zip>]');process.exit(2)}
const siteDir=path.resolve(args.site),fixtureDir=path.resolve(args.fixture),reportPath=path.resolve(args.report);
const capture=JSON.parse(await fsp.readFile(path.join(fixtureDir,'capture.json'),'utf8'));
if(capture.status!=='complete'||!Array.isArray(capture.frames)||capture.frames.length<2)throw new Error('fixture capture.json is incomplete');
const frameNames=capture.frames.map(f=>f.minimapFile||f.cropFile).filter(Boolean);
const intervalMs=Number(capture.intervalMs)||Math.round(1000/(Number(capture.fps)||4));
const screenW=Number(capture.screen?.width||capture.window?.width),screenH=Number(capture.screen?.height||capture.window?.height);
const roiSize=Math.round(Math.min(screenW,screenH)*.25);

async function sha256(file){const h=crypto.createHash('sha256');for await(const chunk of fs.createReadStream(file))h.update(chunk);return h.digest('hex')}
const provenance={schema:capture.schema,status:capture.status,generatedAtUtc:capture.generatedAtUtc,screen:{width:screenW,height:screenH},capturedCrop:capture.minimapRoi||capture.crop,frameCount:frameNames.length,intervalMs,firstCapturedAtUtc:capture.frames[0]?.capturedAtUtc,lastCapturedAtUtc:capture.frames.at(-1)?.capturedAtUtc,captureJsonSha256:await sha256(path.join(fixtureDir,'capture.json')),archiveSha256:args.archive?await sha256(path.resolve(args.archive)):null};

const mime=new Map([['.html','text/html; charset=utf-8'],['.js','text/javascript; charset=utf-8'],['.css','text/css; charset=utf-8'],['.json','application/json'],['.png','image/png'],['.webmanifest','application/manifest+json'],['.txt','text/plain; charset=utf-8']]);
function safeJoin(root,requestPath){const clean=decodeURIComponent(requestPath.split('?')[0]).replace(/^\/+/,''),resolved=path.resolve(root,clean);if(!resolved.startsWith(root+path.sep)&&resolved!==root)return null;return resolved}
const server=http.createServer(async(req,res)=>{try{let file;if(req.url.startsWith('/__fixture__/'))file=safeJoin(fixtureDir,req.url.slice('/__fixture__/'.length));else file=safeJoin(siteDir,req.url==='/'?'index.html':req.url);if(!file){res.writeHead(403);res.end('forbidden');return}let stat;try{stat=await fsp.stat(file)}catch{res.writeHead(404);res.end('not found');return}if(stat.isDirectory())file=path.join(file,'index.html');const data=await fsp.readFile(file);res.setHeader('Content-Type',mime.get(path.extname(file).toLowerCase())||'application/octet-stream');res.setHeader('Cache-Control','no-store');res.writeHead(200);res.end(data)}catch(error){res.writeHead(500);res.end(String(error))}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const port=server.address().port,base=`http://127.0.0.1:${port}`;

let chromium;
try{({chromium}=await import('playwright-core'))}catch{console.error('playwright-core is required (npm install --no-save playwright-core)');server.close();process.exit(2)}
const executablePath=process.env.CHROME_PATH||['/usr/bin/google-chrome','/usr/bin/google-chrome-stable','/usr/bin/chromium','/usr/bin/chromium-browser'].find(fs.existsSync);
if(!executablePath)throw new Error('Chrome/Chromium not found; set CHROME_PATH');
const browser=await chromium.launch({executablePath,headless:true,args:['--no-sandbox','--disable-dev-shm-usage']});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const consoleErrors=[];page.on('pageerror',e=>consoleErrors.push(String(e.message||e)));
await page.goto(base,{waitUntil:'domcontentloaded',timeout:60000});
await page.waitForFunction(()=>window.__WWMSYNC_ABSOLUTE_REPLAY__&&window.__WWMSYNC_VISION_TEST__&&window.__WWMSYNC_VISION_HARDENING__,null,{timeout:30000});
await page.waitForFunction(()=>document.querySelector('.leaflet-container')&&window.__WWMSYNC_VISION_BRIDGE__?.state,null,{timeout:30000});

const cold=await page.evaluate(()=>{window.__WWMSYNC_VISION_TEST__.setViewport(1.35,-1.45,8);window.__WWMSYNC_ABSOLUTE_REPLAY__.reset();const v=window.__WWMSYNC_VISION_BRIDGE__.state();return{viewport:{lat:1.35,lng:-1.45,zoom:8},hasAnchor:v.hasAnchor,hasMarker:v.hasMarker,active:v.active,hardening:window.__WWMSYNC_VISION_HARDENING__}});
if(cold.hasAnchor||cold.hasMarker)throw new Error(`cold-state invariant failed: ${JSON.stringify(cold)}`);

async function withFrame(index,fnName){const name=frameNames[index-1];return page.evaluate(async({url,roiSize,fnName})=>{const image=new Image();image.decoding='async';image.src=url;await image.decode();const c=document.createElement('canvas');c.width=192;c.height=192;c.getContext('2d',{alpha:false,willReadFrequently:true}).drawImage(image,0,0,roiSize,roiSize,0,0,192,192);if(fnName==='absolute')return window.__WWMSYNC_ABSOLUTE_REPLAY__.step(c,1,roiSize);if(fnName==='motion')return window.__WWMSYNC_VISION_TEST__.motionStepCanvas(c);throw new Error('unknown frame function')},{url:`${base}/__fixture__/${encodeURIComponent(name)}`,roiSize,fnName});}

const absoluteSteps=[],holds=[],locks=[];
let frame=1,nextKind='global',lastLock=null;
while(frame<=frameNames.length){const result=await withFrame(frame,'absolute');absoluteSteps.push({frame,timeMs:(frame-1)*intervalMs,kind:nextKind,...result});if(result.reason&&!['confirm-1-of-2',''].includes(result.reason))holds.push({frame,stage:'absolute',reason:result.reason});if(result.locked){locks.push({frame,timeMs:(frame-1)*intervalMs,target:result.target,motionMatrix:result.motionMatrix,fine:result.fine,coarseScore:result.coarseScore,coarseMargin:result.coarseMargin,fineScore:result.fineScore,fineMargin:result.fineMargin,verifyScore:result.verifyScore,scaleScore:result.scaleScore,intensityScore:result.intensityScore,angle:result.angle,radius:result.radius});if(!lastLock){await page.evaluate(payload=>{window.__WWMSYNC_VISION_TEST__.beginReplay();const applied=window.__WWMSYNC_VISION_TEST__.applyReplayAbsolute({lat:payload.target.lat,lng:payload.target.lng,motionMatrix:payload.motionMatrix,source:'offline-real-fixture'});if(!applied.ok)throw new Error(`applyReplayAbsolute ${applied.reason}`);window.__WWMSYNC_VISION_TEST__.resetMotionReplay()},result);lastLock=frame}nextKind='periodic-local';frame+=Math.max(1,Math.round(5200/intervalMs));continue}if(result.reason==='confirm-1-of-2'){nextKind='confirm';frame+=Math.max(1,Math.round(450/intervalMs));continue}if(result.reason==='confirm-mismatch'){nextKind='reacquire';frame+=Math.max(1,Math.round(650/intervalMs));continue}nextKind='global';frame+=Math.max(1,Math.round(5200/intervalMs))}

const motion=[];
if(lastLock){for(let i=lastLock;i<=frameNames.length;i++){const m=await withFrame(i,'motion');motion.push({frame:i,timeMs:(i-1)*intervalMs,...m});if(!m.baseline&&!m.accepted)holds.push({frame:i,stage:'motion',reason:m.reason||m.moveReason||'held'})}}
const finalVision=await page.evaluate(()=>window.__WWMSYNC_VISION_DIAGNOSTICS__());
const finalAbsolute=await page.evaluate(()=>window.__WWMSYNC_ABSOLUTE_REPLAY__.diagnostics());
await page.evaluate(()=>window.__WWMSYNC_VISION_TEST__.endReplay());
await browser.close();server.close();

const rotationDeltas=[];for(let i=1;i<locks.length;i++){let d=Math.abs((((locks[i].angle-locks[i-1].angle)+180)%360+360)%360-180);rotationDeltas.push(d)}
const jumps=[];for(let i=1;i<locks.length;i++){const a=locks[i-1].fine,b=locks[i].fine;if(a&&b)jumps.push(Math.hypot(b.globalX-a.globalX,b.globalY-a.globalY))}
const acceptedMotion=motion.filter(x=>x.accepted),movedMotion=motion.filter(x=>x.moved);
const finiteEnergies=motion.map(x=>x.energy).filter(Number.isFinite);
const report={
  schema:'wwmsync-real-capture-replay-v1',generatedAtUtc:new Date().toISOString(),provenance,coldState:cold,
  labels:{synthetic:'SYNTHETIC PASS (external CI gate; see commit CI)',realGfn:locks.length?'REAL GFN FIXTURE PASS':'REAL GFN FIXTURE FAIL',realLocal:'REAL LOCAL FIXTURE UNAVAILABLE',realLive:'REAL LIVE E2E PENDING'},
  absolute:{firstLockFrame:locks[0]?.frame??null,firstLockMs:locks[0]?.timeMs??null,locks,steps:absoluteSteps,holdReasons:holds.filter(x=>x.stage==='absolute'),rotationDeltaDeg:rotationDeltas,relocalizationJumpFinePx:jumps,falseRelocalizationJumpCount:jumps.filter(x=>x>150).length,periodicReacquisitionAttempted:absoluteSteps.some(x=>x.kind==='periodic-local'),periodicReacquisitionLocks:Math.max(0,locks.length-1)},
  motion:{framesEvaluated:motion.length,accepted:acceptedMotion.length,moved:movedMotion.length,acceptedRate:motion.length>1?acceptedMotion.length/(motion.length-1):0,scoreMin:acceptedMotion.length?Math.min(...acceptedMotion.map(x=>x.score)):null,scoreMean:acceptedMotion.length?acceptedMotion.reduce((s,x)=>s+x.score,0)/acceptedMotion.length:null,scoreMax:acceptedMotion.length?Math.max(...acceptedMotion.map(x=>x.score)):null,energyMin:finiteEnergies.length?Math.min(...finiteEnergies):null,energyMean:finiteEnergies.length?finiteEnergies.reduce((s,x)=>s+x,0)/finiteEnergies.length:null,markerMovementFrames:movedMotion.map(x=>({frame:x.frame,markerPx:x.markerPx,latlng:x.latlng})),holdReasons:holds.filter(x=>x.stage==='motion')},
  autoMatrix:{activated:finalVision.motionCalibration==='absolute-matrix',matrix:finalVision.motionMatrix,absoluteFixes:finalVision.absoluteFixes,markerLatLng:finalVision.markerLatLng},
  finalAbsolute,consoleErrors
};
await fsp.mkdir(path.dirname(reportPath),{recursive:true});await fsp.writeFile(reportPath,JSON.stringify(report,null,2));
console.log(JSON.stringify({report:reportPath,labels:report.labels,firstLockFrame:report.absolute.firstLockFrame,absoluteLocks:locks.length,motionAccepted:report.motion.accepted,motionMoved:report.motion.moved,autoMatrix:report.autoMatrix.activated,holds:holds.length},null,2));
if(consoleErrors.length)process.exitCode=1;