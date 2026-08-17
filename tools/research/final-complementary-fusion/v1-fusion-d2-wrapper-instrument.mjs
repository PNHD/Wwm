#!/usr/bin/env node
import fs from 'node:fs';

const target=process.argv[2];
if(!target) throw new Error('usage: node v1-fusion-d2-wrapper-instrument.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const anchor='window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;window.__WWMSYNC_ABSOLUTE_DRAW_TEST_CAPTURE__=drawTestCapture;';
const first=src.indexOf(anchor);
if(first<0||src.indexOf(anchor,first+anchor.length)>=0) throw new Error('production diagnostic export anchor missing/not unique');

const code=String.raw`
function __faV1CanvasFromRgbB64(rgbB64){
  const raw=atob(rgbB64);if(raw.length!==192*192*3)throw new Error('fusion query RGB byte length '+raw.length);
  const cv=document.createElement('canvas');cv.width=192;cv.height=192;const ctx=cv.getContext('2d',{alpha:false});
  const im=ctx.createImageData(192,192);for(let si=0,di=0;si<raw.length;si+=3,di+=4){im.data[di]=raw.charCodeAt(si);im.data[di+1]=raw.charCodeAt(si+1);im.data[di+2]=raw.charCodeAt(si+2);im.data[di+3]=255}ctx.putImageData(im,0,0);return cv;
}
function __faV1PoseEqual(a,b){return a.angleDeltaDeg===b.angleDeltaDeg&&a.radiusFactor===b.radiusFactor&&a.xOffsetPx===b.xOffsetPx&&a.yOffsetPx===b.yOffsetPx&&Math.abs(a.x-b.x)<1e-12&&Math.abs(a.y-b.y)<1e-12&&Math.abs(a.radius-b.radius)<1e-12&&Math.abs(a.angle-b.angle)<1e-12}
async function __faV1D2Batch(rgbB64,mapId,base,poses){
  if(!Array.isArray(poses)||!poses.length)throw new Error('fusion D2 poses missing');
  const cv=__faV1CanvasFromRgbB64(rgbB64),cfg=MAPS[Number(mapId)];if(!cfg)throw new Error('fusion D2 unknown map');
  const source=roiSamples(cv).field.rawGray,baseSupport=__v2dSupportMask(),pre=__v2dFeatures(source,baseSupport);
  const grid=await fineFieldAround(cfg,base.x,base.y,Math.max(24,base.radius*1.12),48),baseX=base.x-grid.minX*256,baseY=base.y-grid.minY*256;
  const rows=[];
  for(const spec of poses){
    const p=__lrV1Pose(base,spec),al=__v2dAligned(grid.field,baseX+spec.xOffsetPx,baseY+spec.yOffsetPx,p.radius,p.angle),support=__v2dSupportMask(al.valid),d2=__v2dD2(source,al.gray,support,pre.sobel,pre.p90);
    if(d2.score==null||!Number.isFinite(d2.score))throw new Error('fusion D2 non-finite/null');
    rows.push({pose:p,score:d2.score,coverage:d2.coverage});
  }
  return{rows,source:{supportPixels:baseSupport.reduce((a,b)=>a+b,0),sourceP90:pre.p90},grid:{z:grid.z,minX:grid.minX,minY:grid.minY,maxX:grid.maxX,maxY:grid.maxY,width:grid.canvas.width,height:grid.canvas.height}};
}
function __faV1Conformance(){
  if(!window.__WWMSYNC_V2_DESCRIPTOR_AUDIT__||!window.__WWMSYNC_LEARNED_V1_RENDER__)throw new Error('frozen component instruments missing');
  const v2=window.__WWMSYNC_V2_DESCRIPTOR_AUDIT__.conformance(),lr=window.__WWMSYNC_LEARNED_V1_RENDER__.conformance();
  if(!v2.ok||!lr.ok)throw new Error('component conformance failed');
  const f1=.5*.2+.5*.8,f2=.5*.2+.5*.5,f3=(.2+.8+.5)/3;
  if(Math.abs(f1-.5)>1e-12||Math.abs(f2-.35)>1e-12||Math.abs(f3-.5)>1e-12)throw new Error('fusion arithmetic conformance');
  const p=__lrV1Pose({x:10,y:20,radius:30,angle:350},{angleDeltaDeg:15,radiusFactor:1.1,xOffsetPx:8,yOffsetPx:-8});
  if(!__faV1PoseEqual(p,{x:18,y:12,radius:33,angle:5,angleDeltaDeg:15,radiusFactor:1.1,xOffsetPx:8,yOffsetPx:-8}))throw new Error('same-pose conformance');
  return{ok:true,v2,learnedRender:lr,formula:{F1:f1,F2:f2,F3:f3},samePose:true};
}
window.__WWMSYNC_FINAL_FUSION_V1__={contract:{version:'FINAL_COMPLEMENTARY_FUSION_V1_D2_WRAPPER_1',samePose:true,D2:'exact injected Descriptor V2 implementation',scoreNormalization:false,weightSweep:false},conformance:__faV1Conformance,d2Batch:__faV1D2Batch,poseEqual:__faV1PoseEqual};
`;
src=src.slice(0,first)+code+'\n'+src.slice(first);
fs.writeFileSync(target,src);
console.log(JSON.stringify({status:'PASS',target,contract:'FINAL_COMPLEMENTARY_FUSION_V1_D2_WRAPPER_1',productionRankingChanged:false,thresholdChanged:false,beamChanged:false}));
