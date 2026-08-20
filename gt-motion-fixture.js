/* Developer-only UI for ?gt-motion-fixture=1. It observes the capture bridge only. */
(()=>{
'use strict';
const Core=window.WWMSyncGroundTruthFixtureCore;
const params=new URLSearchParams(location.search),enabled=params.get('gt-motion-fixture')==='1',appCommitSha=params.get('app-commit')||'';
if(!enabled||!Core)return;
const panel=document.getElementById('gtMotionFixturePanel'); if(!panel)return; panel.hidden=false;
const el=Object.fromEntries(['gtStart','gtRecord','gtStop','gtNext','gtExport','gtStatus','gtRun','gtCount'].map(id=>[id,document.getElementById(id)]));
const recorder=new Core.FixtureRecorder(); let timer=0,busy=false,mapHandler=null;
const now=()=>({captureTimestampEpochMs:Date.now(),monotonicTimestampMs:performance.now()});
function bridge(){return window.__WWMSYNC_VISION_BRIDGE__}
function setStatus(message){el.gtStatus.textContent=message; const run=recorder.activeRun;el.gtRun.textContent=run?run.label:'Complete';el.gtCount.textContent=run?`${run.frames.length}/${Core.MAX_FRAMES_PER_RUN} frames`:'';el.gtStart.disabled=!!run?.recording;el.gtRecord.disabled=!run?.startAnchor||!!run?.recording;el.gtStop.disabled=!run?.recording;el.gtNext.disabled=!run?.endAnchor||recorder.activeIndex===2;el.gtExport.disabled=!recorder.complete()}
function activeMap(){return bridge()?.map?.()||null}
function manualAnchor(latlng){const map=activeMap();if(!map)throw new Error('WWMSync map is still loading.');const referenceZoom=bridge().state().referenceZoom;const p=map.project(latlng,referenceZoom);return{lat:latlng.lat,lng:latlng.lng,projected:{x:p.x,y:p.y},projection:{kind:'Leaflet.project',crs:map.options.crs?.code||'Leaflet-default',referenceZoom,coordinateUnit:'projected map pixels at reference zoom'},timestampEpochMs:Date.now()}}
function arm(which){const map=activeMap();if(!map){setStatus('Wait for the WWMSync map, then select the manual anchor.');return;}if(mapHandler)map.off('click',mapHandler);setStatus(`Click the actual ${which} position on the WWMSync map.`);mapHandler=event=>{map.off('click',mapHandler);mapHandler=null;try{if(which==='start')recorder.selectStart(manualAnchor(event.latlng));else recorder.selectEnd(manualAnchor(event.latlng));setStatus(which==='start'?'Start anchor saved. Start Vision Sync capture, then start recording.':'End anchor saved. Choose Next run, or export after SPRINT.')}catch(error){setStatus(error.message)}};map.on('click',mapHandler)}
async function blobBytes(canvas){const blob=await new Promise((resolve,reject)=>canvas.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed.')),'image/png'));return new Uint8Array(await blob.arrayBuffer())}
async function tick(){if(busy||!recorder.activeRun?.recording)return;busy=true;try{const raw=bridge()?.captureRawRoi?.();if(!raw){setStatus('Capture is unavailable. Start Vision Sync and share the game window.');return;}const stamp=now(),result=await recorder.recordFrame({imageBytes:await blobBytes(raw.canvas),captureTimestampEpochMs:stamp.captureTimestampEpochMs,monotonicTimestampMs:stamp.monotonicTimestampMs,sourceVideoTimestampMs:raw.sourceVideoTimestampMs,roi:raw.roi,sourceCaptureWidth:raw.sourceCaptureWidth,sourceCaptureHeight:raw.sourceCaptureHeight});if(result.reason==='duration-limit'){stop('duration-limit');setStatus('60 second limit reached; evidence kept. Click the actual end position on the map.')}else setStatus('Recording raw ROI PNG frames. Stay still about 2 seconds at both bookends.')}catch(error){setStatus(`Capture error: ${error.message}`)}finally{busy=false}}
function stop(reason='user'){if(timer){clearInterval(timer);timer=0}if(recorder.activeRun?.recording){const stamp=now();recorder.stop({...stamp,reason});arm('end')}setStatus('Recording stopped. Click the actual end position on the map.')}
async function download(){try{if(!/^[0-9a-f]{40}$/i.test(appCommitSha))throw new Error('Open acquisition mode with the exact 40-character app-commit SHA.');const result=await recorder.export({appCommitSha,branch:'feat/wwmsync-gt-motion-fixture-acquisition',browserUserAgent:navigator.userAgent,devicePixelRatio:window.devicePixelRatio,screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight}});const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/zip'}));const link=document.createElement('a');link.href=url;link.download=result.filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setStatus('Fixture exported. Hashes are in manifest.json and each run.json.')}catch(error){setStatus(error.message)}}
el.gtStart.addEventListener('click',()=>arm('start'));el.gtRecord.addEventListener('click',()=>{try{const capture=bridge()?.captureMetadata?.();if(!capture)throw new Error('Start Vision Sync capture first.');recorder.start({...now(),captureMetadata:{sourceDimensions:{width:capture.sourceCaptureWidth,height:capture.sourceCaptureHeight},displaySurface:capture.displaySurface}});timer=setInterval(()=>void tick(),Core.NOMINAL_CAPTURE_INTERVAL_MS);void tick();setStatus('Recording. Remain stationary for about 2 seconds, traverse, then remain stationary for about 2 seconds.')}catch(error){setStatus(error.message)}});el.gtStop.addEventListener('click',()=>stop());el.gtNext.addEventListener('click',()=>{try{recorder.nextRun();setStatus('Next run: select its actual start position.')}catch(error){setStatus(error.message)}});el.gtExport.addEventListener('click',()=>void download());window.addEventListener('wwmsync:vision:map-unloaded',()=>{if(mapHandler)mapHandler=null});setStatus(/^[0-9a-f]{40}$/i.test(appCommitSha)?'Developer acquisition mode. For each run: select actual start, record with stationary bookends, then select actual end.':'Developer acquisition mode requires ?app-commit=<exact 40-character SHA> for export provenance.');
})();

/* Developer-only high-rate (20 Hz) WALK-only acquisition UI for ?gt-motion-fixture=1&gt-highrate=1.
 * Capture-only: raw ROI canvases are stored in memory and PNG-encoded only after recording stops, so
 * PNG compression never sits on the 50ms capture-critical path. No vision-sync estimation runs here. */
(()=>{
'use strict';
const Core=window.WWMSyncGroundTruthFixtureCore;
const params=new URLSearchParams(location.search);
const enabled=params.get('gt-motion-fixture')==='1'&&params.get('gt-highrate')==='1';
const appCommitSha=params.get('app-commit')||'';
if(!enabled||!Core)return;
const ordinaryPanel=document.getElementById('gtMotionFixturePanel'); if(ordinaryPanel)ordinaryPanel.hidden=true;
const panel=document.getElementById('gtHighRateMotionPanel'); if(!panel)return; panel.hidden=false;
const el=Object.fromEntries(['gtHrStart','gtHrRecord','gtHrStop','gtHrExport','gtHrStatus','gtHrPhase','gtHrCount'].map(id=>[id,document.getElementById(id)]));
const INTERVAL_MS=Core.HIGHRATE_NOMINAL_INTERVAL_MS,PREROLL_MS=Core.HIGHRATE_PREROLL_MS,POSTROLL_MS=Core.HIGHRATE_POSTROLL_MS,MAX_SAMPLES=Core.HIGHRATE_MAX_SAMPLES;
function bridge(){return window.__WWMSYNC_VISION_BRIDGE__}
function activeMap(){return bridge()?.map?.()||null}
function manualAnchor(latlng){const map=activeMap();if(!map)throw new Error('WWMSync map is still loading.');const referenceZoom=bridge().state().referenceZoom;const p=map.project(latlng,referenceZoom);return{lat:latlng.lat,lng:latlng.lng,projected:{x:p.x,y:p.y},projection:{kind:'Leaflet.project',crs:map.options.crs?.code||'Leaflet-default',referenceZoom,coordinateUnit:'projected map pixels at reference zoom'},timestampEpochMs:Date.now()}}

let recorder=null,mapHandler=null,timer=0,tickIndex=0,captureStartMonotonicMs=0,stopRequestedMonotonicMs=null,encoding=false;
// A brand-new recorder instance per "Select start" click is the strict-reset contract: it makes it
// structurally impossible for frames, hashes, timestamps, tick index, or a stale end anchor from an
// aborted/completed run to leak into the next one (Core also defensively resets on selectStart()).
function newRecorder(){recorder=new Core.HighRateWalkRecorder();tickIndex=0;stopRequestedMonotonicMs=null}
newRecorder();

function phaseFor(nowMs){if(stopRequestedMonotonicMs!=null)return'postroll';if(nowMs-captureStartMonotonicMs<PREROLL_MS)return'preroll';return'walk'}
function phaseLabel(phase){return phase==='preroll'?'Pre-roll (stand still)':phase==='postroll'?'Post-roll (stand still)':'WALK'}
function currentPhaseLabel(){if(recorder.recording)return phaseLabel(phaseFor(performance.now()));if(recorder.canExport())return'Complete';if(recorder.startAnchor)return'Ready';return'Idle'}

function setStatus(message){
  if(message!=null)el.gtHrStatus.textContent=message;
  el.gtHrCount.textContent=`${recorder.frames.length}/${MAX_SAMPLES} frames`;
  el.gtHrPhase.textContent=currentPhaseLabel();
  el.gtHrStart.disabled=!!recorder.recording;
  el.gtHrRecord.disabled=!recorder.startAnchor||!!recorder.recording;
  el.gtHrStop.disabled=!recorder.recording||stopRequestedMonotonicMs!=null;
  el.gtHrExport.disabled=!recorder.canExport()||encoding;
}

function arm(which){
  const map=activeMap();
  if(!map){setStatus('Wait for the WWMSync map, then select the manual anchor.');return}
  if(mapHandler)map.off('click',mapHandler);
  setStatus(`Click the actual ${which} position on the WWMSync map.`);
  mapHandler=event=>{
    map.off('click',mapHandler);mapHandler=null;
    try{
      if(which==='start'){newRecorder();recorder.selectStart(manualAnchor(event.latlng));setStatus('Start anchor saved. Start Vision Sync capture, then start the high-rate WALK capture.')}
      else{recorder.selectEnd(manualAnchor(event.latlng));setStatus('End anchor saved. Export the fixture, or select start again to record a new WALK.')}
    }catch(error){setStatus(error.message)}
  };
  map.on('click',mapHandler);
}

function finish(reason,message){
  if(timer){clearTimeout(timer);timer=0}
  if(recorder.recording)recorder.stop({captureTimestampEpochMs:Date.now(),monotonicTimestampMs:performance.now(),reason});
  arm('end');
  setStatus(message);
}

function scheduleNext(){
  const targetMs=captureStartMonotonicMs+tickIndex*INTERVAL_MS;
  timer=setTimeout(()=>void tick(),Math.max(0,targetMs-performance.now()));
}

// Absolute monotonic tick schedule: target = captureStart + tickIndex * 50ms, recomputed from the fixed
// origin every tick (not "sleep 50ms after the previous capture"), so jitter never accumulates as drift.
async function tick(){
  if(!recorder.recording)return;
  const targetTimestampMs=captureStartMonotonicMs+tickIndex*INTERVAL_MS;
  const thisTick=tickIndex;tickIndex++;
  const tickStartMonotonicMs=performance.now();
  try{
    const raw=bridge()?.captureRawRoi?.();
    if(!raw){finish('capture-unavailable','Capture is unavailable. Start Vision Sync and share the game window. Click the actual end position to keep any captured frames.');return}
    const tickCompleteMonotonicMs=performance.now();
    const phase=phaseFor(tickCompleteMonotonicMs);
    const result=recorder.recordFrame({tickIndex:thisTick,targetTimestampMs,tickStartMonotonicMs,tickCompleteMonotonicMs,captureTimestampEpochMs:Date.now(),sourceVideoTimestampMs:raw.sourceVideoTimestampMs,roi:raw.roi,sourceCaptureWidth:raw.sourceCaptureWidth,sourceCaptureHeight:raw.sourceCaptureHeight,phase,raw:raw.canvas});
    if(result.reason==='duration-limit'||result.reason==='sample-limit'){finish(result.reason,'Capture limit reached; evidence kept. Click the actual end position on the map.');return}
  }catch(error){finish('capture-error',`Capture error: ${error.message}. Frames captured so far were kept; export or select start again.`);return}
  if(stopRequestedMonotonicMs!=null&&performance.now()-stopRequestedMonotonicMs>=POSTROLL_MS){finish('postroll-complete','Recording stopped. Click the actual end position on the map.');return}
  setStatus(null);
  scheduleNext();
}

el.gtHrStart.addEventListener('click',()=>arm('start'));
el.gtHrRecord.addEventListener('click',()=>{
  try{
    const capture=bridge()?.captureMetadata?.();
    if(!capture)throw new Error('Start Vision Sync capture first.');
    captureStartMonotonicMs=performance.now();tickIndex=0;stopRequestedMonotonicMs=null;
    recorder.start({captureTimestampEpochMs:Date.now(),monotonicTimestampMs:captureStartMonotonicMs,captureMetadata:{sourceDimensions:{width:capture.sourceCaptureWidth,height:capture.sourceCaptureHeight},displaySurface:capture.displaySurface}});
    setStatus('Recording. Stand still for the first 2 seconds, then walk normally.');
    scheduleNext();
  }catch(error){setStatus(error.message)}
});
el.gtHrStop.addEventListener('click',()=>{
  if(!recorder.recording||stopRequestedMonotonicMs!=null)return;
  stopRequestedMonotonicMs=performance.now();
  setStatus('Stopping. Stand still for about 2 more seconds…');
});
el.gtHrExport.addEventListener('click',()=>void exportFixture());

async function exportFixture(){
  if(encoding)return;
  try{
    if(!/^[0-9a-f]{40}$/i.test(appCommitSha))throw new Error('Open acquisition mode with the exact 40-character app-commit SHA.');
    encoding=true;setStatus(`Encoding ${recorder.frames.length} frames…`);
    const encodedFrames=[];
    for(const frame of recorder.frames){
      const blob=await new Promise((resolve,reject)=>frame.raw.toBlob(value=>value?resolve(value):reject(new Error('PNG encoding failed.')),'image/png'));
      encodedFrames.push({index:frame.index,pngBytes:new Uint8Array(await blob.arrayBuffer())});
    }
    const result=await recorder.export({appCommitSha,branch:'feat/wwmsync-highrate-gt-capture',browserUserAgent:navigator.userAgent,devicePixelRatio:window.devicePixelRatio,screen:{width:screen.width,height:screen.height,availWidth:screen.availWidth,availHeight:screen.availHeight}},encodedFrames);
    const url=URL.createObjectURL(new Blob([result.bytes],{type:'application/zip'}));
    const link=document.createElement('a');link.href=url;link.download=result.filename;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
    encoding=false;
    setStatus('Fixture exported. Hashes are in manifest.json and run.json.');
  }catch(error){encoding=false;setStatus(error.message)}
}

window.addEventListener('wwmsync:vision:map-unloaded',()=>{if(mapHandler)mapHandler=null});
setStatus(/^[0-9a-f]{40}$/i.test(appCommitSha)?'Developer high-rate acquisition mode. Select the actual start position, record one WALK, then select the actual end position.':'Developer high-rate acquisition mode requires ?app-commit=<exact 40-character SHA> for export provenance.');
})();
