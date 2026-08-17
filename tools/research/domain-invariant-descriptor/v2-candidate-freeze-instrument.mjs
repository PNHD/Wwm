#!/usr/bin/env node
import fs from 'node:fs';

const target=process.argv[2];
if(!target) throw new Error('usage: node v2-candidate-freeze-instrument.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const oldFine='finals.push({fine:{...fine,scaleScore:structural.score,intensityScore:recall.score,structuralDetail:structural},hypothesis,verify,combined})';
const newFine='finals.push({fine:{...fine,scaleScore:structural.score,intensityScore:recall.score,intensityNcc:recall.ncc,structuralDetail:structural},hypothesis,verify,combined})';
if(!src.includes(oldFine)) throw new Error('production globalMatch fine-result anchor missing');
src=src.replace(oldFine,newFine);
const oldAlt='alternatives:finals.map(item=>({x:item.fine.globalX,y:item.fine.globalY,angle:item.fine.angle,scaleScore:item.fine.scaleScore,intensityScore:item.fine.intensityScore,combinedScore:item.combined}))';
const newAlt='alternatives:finals.map((item,index)=>({x:item.fine.globalX,y:item.fine.globalY,angle:item.fine.angle,radius:item.fine.radius,scale:item.fine.radius/(ROI_N/2),scaleAwareStructure:item.fine.scaleScore,intensityNcc:item.fine.intensityNcc,intensityScore:item.fine.intensityScore,productionCombined:item.combined,productionRank:index+1}))';
if(!src.includes(oldAlt)) throw new Error('production globalMatch alternatives anchor missing');
src=src.replace(oldAlt,newAlt);
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
src=src.replace(anchor,code+'\n'+anchor);
fs.writeFileSync(target,src);
console.log(JSON.stringify({target,injected:true,kind:'v2-candidate-freeze-d0-only',rankingChanged:false,thresholdChanged:false}));
