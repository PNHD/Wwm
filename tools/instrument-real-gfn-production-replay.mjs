#!/usr/bin/env node
import fs from 'node:fs';

const target = process.argv[2];
if (!target) throw new Error('usage: node tools/instrument-real-gfn-production-replay.mjs <replay-site/vision-sync.js>');
let src = fs.readFileSync(target, 'utf8');

function replaceOnce(needle, replacement, label) {
  const first = src.indexOf(needle);
  if (first < 0) throw new Error(`instrumentation target missing: ${label}`);
  if (src.indexOf(needle, first + needle.length) >= 0) throw new Error(`instrumentation target not unique: ${label}`);
  src = src.slice(0, first) + replacement + src.slice(first + needle.length);
}

// Diagnostic-only: preserve NCC alongside the already-gated intensity score.
replaceOnce(
  'fine:{...fine,scaleScore:structural.score,intensityScore:recall.score,structuralDetail:structural}',
  'fine:{...fine,scaleScore:structural.score,intensityScore:recall.score,intensityNcc:recall.ncc,intensityCount:recall.count,structuralDetail:structural}',
  'global winner NCC'
);
replaceOnce(
  'alternatives:finals.map(item=>({x:item.fine.globalX,y:item.fine.globalY,angle:item.fine.angle,scaleScore:item.fine.scaleScore,intensityScore:item.fine.intensityScore,combinedScore:item.combined}))',
  'alternatives:finals.map(item=>({x:item.fine.globalX,y:item.fine.globalY,radius:item.fine.radius,angle:item.fine.angle,scaleScore:item.fine.scaleScore,intensityScore:item.fine.intensityScore,intensityNcc:item.fine.intensityNcc??null,combinedScore:item.combined}))',
  'global alternatives detail'
);

// Keep the latest global beam only in the replay copy. It never participates in ranking/gating.
replaceOnce(
  "async function registerFrame(cfg,mapId,overrideCanvas=null){const roiCanvas=overrideCanvas||VISION.captureRoi(192);",
  "async function registerFrame(cfg,mapId,overrideCanvas=null){window.__WWMSYNC_REAL_REPLAY_LAST_ALTERNATIVES__=[];const roiCanvas=overrideCanvas||VISION.captureRoi(192);",
  'registerFrame trace reset'
);
replaceOnce(
  'else{state.globalSearches++;const global=await globalMatch(info,cfg);coarse=global.coarse;fine=global.fine}',
  'else{state.globalSearches++;const global=await globalMatch(info,cfg);coarse=global.coarse;fine=global.fine;window.__WWMSYNC_REAL_REPLAY_LAST_ALTERNATIVES__=global.alternatives||[]}',
  'global alternatives capture'
);

const registrationNeedle = 'const result=await registerFrame(cfg,mapId);';
const registrationTrace = `${registrationNeedle}window.dispatchEvent(new CustomEvent('wwmsync:real-replay:registration',{detail:{frame:window.__WWMSYNC_REAL_REPLAY_FRAME__??null,at:Date.now(),trigger,modeBefore:state.mode,reason:result.reason||'',coarse:result.coarse?{score:result.coarse.score??null,margin:result.coarse.margin??null,x:result.coarse.x??null,y:result.coarse.y??null,radius:result.coarse.radius??null,angle:result.coarse.angle??null,scaleScore:result.coarse.scaleScore??null,intensityScore:result.coarse.intensityScore??null,intensityNcc:result.coarse.intensityNcc??null}:null,fine:result.fine?{score:result.fine.score??null,margin:result.fine.margin??null,localMargin:result.fine.localMargin??null,beamMargin:result.fine.beamMargin??null,globalX:result.fine.globalX??null,globalY:result.fine.globalY??null,radius:result.fine.radius??null,angle:result.fine.angle??null,scaleScore:result.fine.scaleScore??null,intensityScore:result.fine.intensityScore??null,intensityNcc:result.fine.intensityNcc??null,verifyScore:result.fine.verifyScore??null,topologyScore:result.fine.topologyScore??null,combinedScore:result.fine.combinedScore??null}:null,target:result.target?{lat:result.target.lat,lng:result.target.lng}:null,info:{positiveCount:result.info?.positiveCount??0,negativeCount:result.info?.negativeCount??0,contrast:result.info?.contrast??0},alternatives:(window.__WWMSYNC_REAL_REPLAY_LAST_ALTERNATIVES__||[]).slice(0,5)}}}));`;
replaceOnce(registrationNeedle, registrationTrace, 'production registration trace');

const confirmationNeedle = "const gate=state.pending?.match?confirmationGate(state.pending.match,result.fine):{ok:false,distance:Infinity,angle:Infinity,scale:Infinity};";
const confirmationTrace = `${confirmationNeedle}window.dispatchEvent(new CustomEvent('wwmsync:real-replay:confirmation',{detail:{frame:window.__WWMSYNC_REAL_REPLAY_FRAME__??null,at:Date.now(),trigger,ok:gate.ok,distance:gate.distance,angle:gate.angle,scale:gate.scale}}));`;
replaceOnce(confirmationNeedle, confirmationTrace, 'production confirmation trace');

const matrixNeedle = 'const roiSize=vs.roi?.size||192,matrix=motionMatrixFor(result.fine,cfg,roiSize,result.target);';
const matrixTrace = `${matrixNeedle}window.dispatchEvent(new CustomEvent('wwmsync:real-replay:matrix',{detail:{frame:window.__WWMSYNC_REAL_REPLAY_FRAME__??null,at:Date.now(),trigger,available:!!matrix,matrix:matrix||null,target:result.target?{lat:result.target.lat,lng:result.target.lng}:null,fine:{globalX:result.fine?.globalX??null,globalY:result.fine?.globalY??null,angle:result.fine?.angle??null,radius:result.fine?.radius??null}}}));`;
replaceOnce(matrixNeedle, matrixTrace, 'production matrix trace');

const applyNeedle = "const applied=VISION.applyAbsoluteFix({lat:result.target.lat,lng:result.target.lng,motionMatrix:matrix,source:'structural-global-registration'});";
const applyTrace = `${applyNeedle}window.dispatchEvent(new CustomEvent('wwmsync:real-replay:apply',{detail:{frame:window.__WWMSYNC_REAL_REPLAY_FRAME__??null,at:Date.now(),trigger,ok:!!applied.ok,reason:applied.reason||'',target:{lat:result.target.lat,lng:result.target.lng},motionMatrix:matrix,vision:VISION.state(),fine:{globalX:result.fine?.globalX??null,globalY:result.fine?.globalY??null,angle:result.fine?.angle??null,radius:result.fine?.radius??null}}}));`;
replaceOnce(applyNeedle, applyTrace, 'production apply trace');

// Replay-only failure visualizer. It reuses the same normalization/global matcher and is invoked only after acceptance has already failed.
const visualizerNeedle = 'window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;window.__WWMSYNC_ABSOLUTE_DRAW_TEST_CAPTURE__=drawTestCapture;';
const visualizer = `window.__WWMSYNC_REAL_REPLAY_VISUALIZE__=async(canvas,mapId=1,maxCandidates=3)=>{const cfg=MAPS[Number(mapId)];if(!cfg||!(canvas instanceof HTMLCanvasElement))return null;const info=roiSamples(canvas),global=await globalMatch(info,cfg),atlas=global.coarse?.atlas||await coarseAtlas(cfg),candidates=(global.alternatives||[]).slice(0,Math.max(1,Math.min(3,Number(maxCandidates)||3))),make=(w=192,h=192)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c},normalized=make(),nctx=normalized.getContext('2d'),img=nctx.createImageData(192,192);for(let i=0;i<192*192;i++){const v=Math.max(0,Math.min(255,Math.round((info.field.gray?.[i]??0)*255)));img.data[i*4]=v;img.data[i*4+1]=v;img.data[i*4+2]=v;img.data[i*4+3]=255}nctx.putImageData(img,0,0);const outputs=[];for(let rank=0;rank<candidates.length;rank++){const c=candidates[rank],patch=make(),pctx=patch.getContext('2d'),scale=2**(FINE_Z-COARSE_Z),cx=c.x/scale,cy=c.y/scale,r=Math.max(18,(c.radius||80)/scale*1.7);pctx.fillStyle='#111';pctx.fillRect(0,0,192,192);pctx.drawImage(atlas.full,cx-r,cy-r,r*2,r*2,0,0,192,192);pctx.fillStyle='rgba(0,0,0,.72)';pctx.fillRect(0,0,192,30);pctx.fillStyle='#fff';pctx.font='12px sans-serif';pctx.fillText('#'+(rank+1)+' S '+Number(c.scaleScore??-1).toFixed(3)+' NCC '+Number(c.intensityNcc??c.intensityScore??-1).toFixed(3),6,18);const overlay=make(),o=overlay.getContext('2d'),edge=info.field.edge,ep=info.field.edgeP||1;o.drawImage(patch,0,0);o.globalAlpha=.65;o.fillStyle='#00ffff';for(let y=2;y<190;y+=2)for(let x=2;x<190;x+=2){const e=edge?.[y*192+x]??0;if(e/ep>.55)o.fillRect(x,y,2,2)}o.globalAlpha=1;outputs.push({rank:rank+1,candidate:c,patch:patch.toDataURL('image/png'),overlay:overlay.toDataURL('image/png')})}return{normalized:normalized.toDataURL('image/png'),coarse:global.coarse?{score:global.coarse.score,margin:global.coarse.margin}:null,fine:global.fine?{score:global.fine.score,scaleScore:global.fine.scaleScore,intensityScore:global.fine.intensityScore,intensityNcc:global.fine.intensityNcc??null,beamMargin:global.fine.beamMargin,globalX:global.fine.globalX,globalY:global.fine.globalY,angle:global.fine.angle,radius:global.fine.radius}:null,candidates:outputs}};${visualizerNeedle}`;
replaceOnce(visualizerNeedle, visualizer, 'failure visualizer hook');

fs.writeFileSync(target, src);
console.log(JSON.stringify({ instrumented: target, productSourceUnchanged: true, gatesChanged: false }));
