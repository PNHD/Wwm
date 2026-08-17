#!/usr/bin/env node
import fs from 'node:fs';

const target=process.argv[2];
if(!target) throw new Error('usage: node v2-candidate-freeze-instrument.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');

function replaceUnique(needle,replacement,label){
  const first=src.indexOf(needle);
  if(first<0) throw new Error(`${label} missing`);
  if(src.indexOf(needle,first+needle.length)>=0) throw new Error(`${label} not unique`);
  src=src.slice(0,first)+replacement+src.slice(first+needle.length);
}

// The workflow intentionally applies the established replay-only instrumentation first.
// Accept that exact post-replay shape; this v2 layer only exposes complete D0 geometry/metrics.
const postReplayFine='finals.push({fine:{...fine,scaleScore:structural.score,intensityScore:recall.score,intensityNcc:recall.ncc,intensityCount:recall.count,structuralDetail:structural},hypothesis,verify,combined})';
if(!src.includes(postReplayFine)) throw new Error('post-replay production globalMatch fine-result anchor missing');

const postReplayAlt='alternatives:finals.map(item=>({x:item.fine.globalX,y:item.fine.globalY,radius:item.fine.radius,angle:item.fine.angle,scaleScore:item.fine.scaleScore,intensityScore:item.fine.intensityScore,intensityNcc:item.fine.intensityNcc??null,combinedScore:item.combined}))';
const newAlt='alternatives:finals.map((item,index)=>({x:item.fine.globalX,y:item.fine.globalY,angle:item.fine.angle,radius:item.fine.radius,scale:item.fine.radius/(ROI_N/2),scaleAwareStructure:item.fine.scaleScore,intensityNcc:item.fine.intensityNcc,intensityScore:item.fine.intensityScore,productionCombined:item.combined,productionRank:index+1}))';
replaceUnique(postReplayAlt,newAlt,'post-replay production globalMatch alternatives anchor');

const anchor='window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;window.__WWMSYNC_ABSOLUTE_DRAW_TEST_CAPTURE__=drawTestCapture;';
if(!src.includes(anchor)) throw new Error('production diagnostic export anchor missing');
const code=String.raw`
async function __v2CandidateGlobalSearch(canvas,mapId){
  const cfg=MAPS[Number(mapId)],info=roiSamples(canvas),result=await globalMatch(info,cfg);
  if(!result||!result.fine)return{error:'no-final',coarse:!!result?.coarse,alternatives:result?.alternatives||[]};
  return{
    winner:{x:result.fine.globalX,y:result.fine.globalY,angle:result.fine.angle,radius:result.fine.radius,scale:result.fine.radius/(ROI_N/2),scaleAwareStructure:result.fine.scaleScore,intensityNcc:result.fine.intensityNcc,intensityScore:result.fine.intensityScore,productionCombined:result.fine.combinedScore},
    alternatives:result.alternatives||[]
  };
}
async function __v2CandidateD0At(canvas,mapId,candidate){
  const cfg=MAPS[Number(mapId)],info=roiSamples(canvas),grid=await fineFieldAround(cfg,candidate.x,candidate.y,Math.max(24,candidate.radius*1.12),48),cx=candidate.x-grid.minX*256,cy=candidate.y-grid.minY*256;
  const structural=scaleAwareStructuralScore(info.field,grid.field,cx,cy,candidate.radius,candidate.angle,2),recall=warpIntensityNccFast(info.field,grid.field,cx,cy,candidate.radius,candidate.angle,2),combined=.92*Math.max(0,structural.score)+.08*Math.max(0,recall.score);
  return{x:candidate.x,y:candidate.y,angle:candidate.angle,radius:candidate.radius,scale:candidate.radius/(ROI_N/2),scaleAwareStructure:structural.score,intensityNcc:recall.ncc,intensityScore:recall.score,productionCombined:combined};
}
window.__WWMSYNC_V2_CANDIDATE_FREEZE__={globalSearch:__v2CandidateGlobalSearch,scoreD0At:__v2CandidateD0At};
`;
replaceUnique(anchor,code+'\n'+anchor,'production diagnostic export anchor');
fs.writeFileSync(target,src);
console.log(JSON.stringify({target,injected:true,kind:'v2-candidate-freeze-d0-only',inputShape:'post-real-replay-instrumentation',rankingChanged:false,thresholdChanged:false}));
