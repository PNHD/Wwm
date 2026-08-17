#!/usr/bin/env node
import fs from 'node:fs';
const target=process.argv[2];
if(!target)throw new Error('usage: node d0-baseline-instrument.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const anchor='window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;window.__WWMSYNC_ABSOLUTE_DRAW_TEST_CAPTURE__=drawTestCapture;';
if(!src.includes(anchor))throw new Error('D0 baseline anchor missing');
const code=String.raw`
function __blD0(source,field,cx,cy,radius,angle){const s=scaleAwareStructuralScore(source,field,cx,cy,radius,angle,2),r=warpIntensityNccFast(source,field,cx,cy,radius,angle,2),combined=.92*Math.max(0,s.score)+.08*Math.max(0,r.score);return{scaleAwareStructure:s.score,intensityNcc:r.ncc,intensityScore:r.score,productionCombined:combined,angle,scale:radius/(ROI_N/2),radius}}
async function __blGrid(cfg,cand,search=48){const grid=await fineFieldAround(cfg,cand.x,cand.y,Math.max(24,cand.radius*1.12),search);return{grid,cx:cand.x-grid.minX*256,cy:cand.y-grid.minY*256}}
async function __blScoreCandidates(canvas,mapId,candidates){const cfg=MAPS[Number(mapId)],info=roiSamples(canvas),out=[];for(const cand of candidates){const g=await __blGrid(cfg,cand,48),d=__blD0(info.field,g.grid.field,g.cx,g.cy,cand.radius,cand.angle);out.push({id:cand.id,x:cand.x,y:cand.y,gtDistance:cand.gtDistance??null,...d})}return out}
async function __blRecoverFine(canvas,mapId,all36=true){const cfg=MAPS[Number(mapId)],info=roiSamples(canvas),coarse=await coarseMatch(info,cfg);if(!coarse)return{error:'no-coarse'};const hs=(coarse.hypotheses||[coarse]),limit=all36?hs.length:Math.min(COARSE_BEAM,hs.length),corr=[];for(let i=0;i<limit;i++){const h=hs[i],fine=await fineMatch(info.samples,cfg,{...h,atlas:coarse.atlas},230,12,info.field);if(!fine){corr.push({coarseRank:i+1,error:'no-fine'});continue}const d0=__blD0(info.field,fine.fieldGrid.field,fine.x,fine.y,fine.radius,fine.angle);corr.push({coarseRank:i+1,x:fine.globalX,y:fine.globalY,gtDistance:null,angle:fine.angle,radius:fine.radius,scale:fine.radius/(ROI_N/2),...d0})}const finalists=corr.slice(0,Math.min(COARSE_BEAM,corr.length)).filter(x=>!x.error).sort((a,b)=>b.productionCombined-a.productionCombined).map((x,i)=>({...x,finalistRank:i+1}));return{corr,finalists}}
async function __blRecoverLocalGt(canvas,mapId,expected){const cfg=MAPS[Number(mapId)],info=roiSamples(canvas),g=await fineFieldAround(cfg,expected.x,expected.y,96,150),cx=expected.x-g.minX*256,cy=expected.y-g.minY*256,radii=[32,48,64,80,96,112],angles=Array.from({length:12},(_,i)=>i*30);let best=null;const score=(radius,angle)=>{const d=__blD0(info.field,g.field,cx,cy,radius,angle);return{...d,x:expected.x,y:expected.y,gtDistance:0}};for(const r of radii)for(const a of angles){const z=score(r,a);if(!best||z.productionCombined>best.productionCombined)best=z}return best}
async function __blRecoverOwner(canvas,mapId,expected){const gt=await __blRecoverLocalGt(canvas,mapId,expected),fine=await __blRecoverFine(canvas,mapId,false),final=fine.finalists[0]||null;if(final)final.gtDistance=Math.hypot(final.x-expected.x,final.y-expected.y);return{gt,final}}
window.__WWMSYNC_D0_BASELINE__={scoreCandidates:__blScoreCandidates,recoverFine:__blRecoverFine,recoverLocalGt:__blRecoverLocalGt,recoverOwner:__blRecoverOwner};
`;
src=src.replace(anchor,code+'\n'+anchor);
fs.writeFileSync(target,src);
console.log(JSON.stringify({target,injected:true,kind:'d0-browser-baseline-only'}));
