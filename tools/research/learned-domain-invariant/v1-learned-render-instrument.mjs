#!/usr/bin/env node
import fs from 'node:fs';

const target=process.argv[2];
if(!target) throw new Error('usage: node v1-learned-render-instrument.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const anchor='window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;window.__WWMSYNC_ABSOLUTE_DRAW_TEST_CAPTURE__=drawTestCapture;';
const first=src.indexOf(anchor);
if(first<0||src.indexOf(anchor,first+anchor.length)>=0) throw new Error('production diagnostic export anchor missing/not unique');

const code=String.raw`
const __lrV1N=192;
function __lrV1BilinearRgb(rgba,w,h,x,y,ch){
  if(x<0||y<0||x>w-1||y>h-1)throw new Error('learned-v1 reference sample outside fetched tile grid');
  const x0=Math.floor(x),y0=Math.floor(y),x1=Math.min(w-1,x0+1),y1=Math.min(h-1,y0+1),fx=x-x0,fy=y-y0;
  const a=rgba[(y0*w+x0)*4+ch]*(1-fx)+rgba[(y0*w+x1)*4+ch]*fx;
  const b=rgba[(y1*w+x0)*4+ch]*(1-fx)+rgba[(y1*w+x1)*4+ch]*fx;
  return Math.max(0,Math.min(255,Math.round(a*(1-fy)+b*fy)));
}
function __lrV1Pose(base,p){return{x:base.x+p.xOffsetPx,y:base.y+p.yOffsetPx,radius:base.radius*p.radiusFactor,angle:angleNorm(base.angle+p.angleDeltaDeg),angleDeltaDeg:p.angleDeltaDeg,radiusFactor:p.radiusFactor,xOffsetPx:p.xOffsetPx,yOffsetPx:p.yOffsetPx}}
function __lrV1RenderOne(rgba,w,h,cx,cy,radius,angle){
  const n=__lrV1N,mid=(n-1)/2,den=n/2,a=rad(angle),c=Math.cos(a),s=Math.sin(a),out=new Uint8Array(n*n*3);let q=0;
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    const nx=(x-mid)/den,ny=(y-mid)/den,rx=cx+(nx*c-ny*s)*radius,ry=cy+(nx*s+ny*c)*radius;
    out[q++]=__lrV1BilinearRgb(rgba,w,h,rx,ry,0);out[q++]=__lrV1BilinearRgb(rgba,w,h,rx,ry,1);out[q++]=__lrV1BilinearRgb(rgba,w,h,rx,ry,2);
  }
  let bin='';for(let i=0;i<out.length;i+=0x8000)bin+=String.fromCharCode(...out.subarray(i,i+0x8000));return btoa(bin);
}
async function __lrV1RenderBatch(mapId,base,poses){
  if(!base||!Array.isArray(poses)||!poses.length)throw new Error('learned-v1 render input missing');
  const cfg=MAPS[Number(mapId)];if(!cfg)throw new Error('learned-v1 unknown map');
  const maxRadius=Math.max(24,base.radius*1.12),grid=await fineFieldAround(cfg,base.x,base.y,maxRadius,64),ctx=grid.canvas.getContext('2d',{willReadFrequently:true}),rgba=ctx.getImageData(0,0,grid.canvas.width,grid.canvas.height).data;
  const rows=[];
  for(const spec of poses){
    const p=__lrV1Pose(base,spec),cx=p.x-grid.minX*256,cy=p.y-grid.minY*256;
    rows.push({pose:p,rgbB64:__lrV1RenderOne(rgba,grid.canvas.width,grid.canvas.height,cx,cy,p.radius,p.angle)});
  }
  return{rows,grid:{z:grid.z,minX:grid.minX,minY:grid.minY,maxX:grid.maxX,maxY:grid.maxY,width:grid.canvas.width,height:grid.canvas.height}};
}
function __lrV1Conformance(){
  const rgba=new Uint8ClampedArray([0,10,20,255,100,110,120,255,200,210,220,255,255,250,245,255]);
  const got=__lrV1BilinearRgb(rgba,2,2,.5,.5,0);if(got!==139)throw new Error('learned-v1 RGB bilinear conformance '+got);
  const base={x:100,y:200,radius:40,angle:350},spec={angleDeltaDeg:15,radiusFactor:1.1,xOffsetPx:8,yOffsetPx:-8},p=__lrV1Pose(base,spec);
  if(p.x!==108||p.y!==192||Math.abs(p.radius-44)>1e-12||p.angle!==5)throw new Error('learned-v1 pose conformance');
  return{ok:true,workSize:__lrV1N,bilinearCenterRed:got,pose:p};
}
window.__WWMSYNC_LEARNED_V1_RENDER__={
  contract:{version:'LEARNED_DOMAIN_INVARIANT_V1_RENDER_1',workSize:192,fineZoom:FINE_Z,pixelCenterMid:95.5,normalizationDenominator:96,sampling:'raw RGB8 bilinear then round',poseSymmetric:true},
  conformance:__lrV1Conformance,
  renderBatch:__lrV1RenderBatch
};
`;
src=src.slice(0,first)+code+'\n'+src.slice(first);
fs.writeFileSync(target,src);
console.log(JSON.stringify({status:'PASS',target,contract:'LEARNED_DOMAIN_INVARIANT_V1_RENDER_1'}));
