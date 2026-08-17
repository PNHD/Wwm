#!/usr/bin/env node
import fs from 'node:fs';

const target=process.argv[2];
if(!target) throw new Error('usage: node v2-descriptor-outcome-instrument.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const anchor='window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;window.__WWMSYNC_ABSOLUTE_DRAW_TEST_CAPTURE__=drawTestCapture;';
const first=src.indexOf(anchor);
if(first<0||src.indexOf(anchor,first+anchor.length)>=0) throw new Error('production diagnostic export anchor missing/not unique');

const code=String.raw`
const __v2dN=ROI_N;
function __v2dSupportMask(valid=null){
  const n=__v2dN,m=(n-1)/2,out=new Uint8Array(n*n);
  for(let y=3;y<n-3;y++)for(let x=3;x<n-3;x++){
    const rr=Math.hypot((x-m)/(n/2),(y-m)/(n/2));
    if(rr>=.20&&rr<=.78&&(!valid||valid[y*n+x]))out[y*n+x]=1;
  }
  return out;
}
function __v2dReflect101(i,n){while(i<0||i>=n){if(i<0)i=-i;else i=2*n-2-i}return i}
function __v2dSobel(gray){
  const n=__v2dN,gx=new Float32Array(n*n),gy=new Float32Array(n*n),mag=new Float32Array(n*n),bin=new Uint8Array(n*n);
  const kx=[-1,0,1,-2,0,2,-1,0,1],ky=[-1,-2,-1,0,0,0,1,2,1];
  for(let y=0;y<n;y++)for(let x=0;x<n;x++){
    let sx=0,sy=0,q=0;
    for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++,q++){
      const xx=__v2dReflect101(x+dx,n),yy=__v2dReflect101(y+dy,n),v=gray[yy*n+xx];sx+=v*kx[q];sy+=v*ky[q];
    }
    const i=y*n+x,m=Math.hypot(sx,sy);gx[i]=sx;gy[i]=sy;mag[i]=m;
    let th=Math.atan2(sy,sx);th=((th%Math.PI)+Math.PI)%Math.PI;bin[i]=Math.min(7,Math.max(0,Math.floor(th/Math.PI*8)));
  }
  return{gx,gy,mag,bin};
}
function __v2dPercentile(arr,p){if(!arr.length)return 0;const a=Array.from(arr).sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))]}
function __v2dSupportValues(arr,support){const out=[];for(let i=0;i<arr.length;i++)if(support[i])out.push(arr[i]);return out}
function __v2dPop24(v){v=v-((v>>>1)&0x55555555);v=(v&0x33333333)+((v>>>2)&0x33333333);return(((v+(v>>>4))&0x0F0F0F0F)*0x01010101)>>>24}
function __v2dCensus(gray,support){
  const n=__v2dN,a=new Uint32Array(n*n),b=new Uint32Array(n*n),valid=new Uint8Array(n*n);let centers=0;
  for(let y=3;y<n-3;y++)for(let x=3;x<n-3;x++){
    const i=y*n+x;if(!support[i])continue;let ok=true,lo=0,hi=0,bit=0;
    for(let dy=-3;dy<=3&&ok;dy++)for(let dx=-3;dx<=3;dx++){
      if(dx===0&&dy===0)continue;const j=(y+dy)*n+(x+dx);if(!support[j]){ok=false;break}
      if(gray[j]>=gray[i]){if(bit<24)lo|=(1<<bit);else hi|=(1<<(bit-24))}bit++;
    }
    if(ok){a[i]=lo>>>0;b[i]=hi>>>0;valid[i]=1;centers++}
  }
  return{a,b,valid,centers};
}
function __v2dD1(src,ref,support,srcPre=null){
  const s=srcPre||__v2dCensus(src,support),r=__v2dCensus(ref,support);let eq=0,count=0;
  for(let i=0;i<s.valid.length;i++)if(s.valid[i]&&r.valid[i]){eq+=48-__v2dPop24((s.a[i]^r.a[i])>>>0)-__v2dPop24((s.b[i]^r.b[i])>>>0);count++}
  return{score:count?eq/(48*count):null,coverage:{validCenters:count,sourceCenters:s.centers,referenceCenters:r.centers}};
}
function __v2dD2(src,ref,support,srcSobel=null,srcP90=null){
  const s=srcSobel||__v2dSobel(src),r=__v2dSobel(ref),sp=srcP90??__v2dPercentile(__v2dSupportValues(s.mag,support),.90),rp=__v2dPercentile(__v2dSupportValues(r.mag,support),.90),sd=Math.max(sp,1e-6),rd=Math.max(rp,1e-6);let sum=0,wSum=0,count=0;
  for(let i=0;i<support.length;i++)if(support[i]){const sm=Math.min(1,s.mag[i]/sd),rm=Math.min(1,r.mag[i]/rd),w=Math.min(sm,rm);if(w<=0)continue;const d=Math.abs(s.bin[i]-r.bin[i]),cd=Math.min(d,8-d),agree=1-cd/4;sum+=w*agree;wSum+=w;count++}
  return{score:wSum>1e-6?sum/wSum:null,coverage:{weightSum:wSum,pixels:count,sourceP90:sp,referenceP90:rp},sobel:r};
}
function __v2dEdges(sobel,support,p=.85){const t=__v2dPercentile(__v2dSupportValues(sobel.mag,support),p),mask=new Uint8Array(support.length),pts=[];for(let i=0;i<mask.length;i++)if(support[i]&&sobel.mag[i]>=t){mask[i]=1;pts.push(i)}return{threshold:t,mask,pts}}
function __v2dDirected(aPts,bMask,cap=6){if(!aPts.length)return null;const n=__v2dN,c2=cap*cap;let sum=0;for(const idx of aPts){const x=idx%n,y=(idx/n)|0;let best=c2;for(let dy=-cap;dy<=cap;dy++){const yy=y+dy;if(yy<0||yy>=n)continue;for(let dx=-cap;dx<=cap;dx++){const d2=dx*dx+dy*dy;if(d2>=best)continue;const xx=x+dx;if(xx<0||xx>=n)continue;if(bMask[yy*n+xx])best=d2}}sum+=Math.min(cap,Math.sqrt(best))/cap}return sum/aPts.length}
function __v2dChamferFromEdges(se,re,minCount){if(se.pts.length<minCount||re.pts.length<minCount)return{score:null,coverage:{sourceCount:se.pts.length,referenceCount:re.pts.length}};const a=__v2dDirected(se.pts,re.mask,6),b=__v2dDirected(re.pts,se.mask,6);return{score:1-.5*(a+b),coverage:{sourceCount:se.pts.length,referenceCount:re.pts.length,directedSourceToReference:a,directedReferenceToSource:b}}}
function __v2dCrossClose(mask){const n=__v2dN,d=new Uint8Array(mask.length),e=new Uint8Array(mask.length),dirs=[[0,0],[-1,0],[1,0],[0,-1],[0,1]];for(let y=0;y<n;y++)for(let x=0;x<n;x++){let on=0;for(const[dx,dy]of dirs){const xx=x+dx,yy=y+dy;if(xx>=0&&yy>=0&&xx<n&&yy<n&&mask[yy*n+xx]){on=1;break}}d[y*n+x]=on}for(let y=0;y<n;y++)for(let x=0;x<n;x++){let on=1;for(const[dx,dy]of dirs){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=n||yy>=n||!d[yy*n+xx]){on=0;break}}e[y*n+x]=on}return e}
function __v2dThin(input){const n=__v2dN,a=new Uint8Array(input);let iterations=0,converged=false;const N=(x,y,k)=>{const pts=[[0,-1],[1,-1],[1,0],[1,1],[0,1],[-1,1],[-1,0],[-1,-1]],p=pts[k],xx=x+p[0],yy=y+p[1];return xx>=0&&yy>=0&&xx<n&&yy<n?a[yy*n+xx]:0};for(iterations=0;iterations<128;iterations++){
    let changed=false;
    for(let sub=0;sub<2;sub++){
      const del=[];
      for(let y=1;y<n-1;y++)for(let x=1;x<n-1;x++){const i=y*n+x;if(!a[i])continue;const p=[];for(let k=0;k<8;k++)p.push(N(x,y,k));const B=p.reduce((q,v)=>q+v,0);if(B<2||B>6)continue;let A=0;for(let k=0;k<8;k++)if(!p[k]&&p[(k+1)%8])A++;if(A!==1)continue;if(sub===0){if(p[0]*p[2]*p[4]||p[2]*p[4]*p[6])continue}else{if(p[0]*p[2]*p[6]||p[0]*p[4]*p[6])continue}del.push(i)}
      if(del.length){changed=true;for(const i of del)a[i]=0}
    }
    if(!changed){converged=true;break}
  }
  const pts=[];for(let i=0;i<a.length;i++)if(a[i])pts.push(i);return{mask:a,pts,iterations:converged?iterations+1:128,converged};
}
function __v2dFeatures(gray,support){const sobel=__v2dSobel(gray),p90=__v2dPercentile(__v2dSupportValues(sobel.mag,support),.90),census=__v2dCensus(gray,support),edges=__v2dEdges(sobel,support,.85),thin=__v2dThin(__v2dCrossClose(edges.mask));return{sobel,p90,census,edges,thin}}
function __v2dScoreAll(src,ref,support,pre){
  const d1=__v2dD1(src,ref,support,pre.census),d2=__v2dD2(src,ref,support,pre.sobel,pre.p90),re=__v2dEdges(d2.sobel,support,.85),d3=__v2dChamferFromEdges(pre.edges,re,16),rt=__v2dThin(__v2dCrossClose(re.mask)),d4=__v2dChamferFromEdges({mask:pre.thin.mask,pts:pre.thin.pts},{mask:rt.mask,pts:rt.pts},12);
  d4.coverage.sourceIterations=pre.thin.iterations;d4.coverage.referenceIterations=rt.iterations;d4.coverage.sourceConverged=pre.thin.converged;d4.coverage.referenceConverged=rt.converged;
  return{D1:d1,D2:{score:d2.score,coverage:d2.coverage},D3:d3,D4:d4};
}
function __v2dAligned(field,cx,cy,radius,angle){const n=__v2dN,m=(n-1)/2,a=rad(angle),c=Math.cos(a),s=Math.sin(a),out=new Float32Array(n*n),valid=new Uint8Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const nx=(x-m)/(n/2),ny=(y-m)/(n/2),rx=cx+(nx*c-ny*s)*radius,ry=cy+(nx*s+ny*c)*radius,i=y*n+x;if(rx>=0&&ry>=0&&rx<=field.w-1&&ry<=field.h-1){out[i]=bilinear(field.rawGray||field.gray,field.w,field.h,rx,ry);valid[i]=1}}return{gray:out,valid}}
async function __v2dEvaluate(canvas,mapId,candidate){
  const cfg=MAPS[Number(mapId)],source=roiSamples(canvas).field.rawGray,n=__v2dN,baseSupport=__v2dSupportMask(),pre=__v2dFeatures(source,baseSupport),grid=await fineFieldAround(cfg,candidate.x,candidate.y,Math.max(24,candidate.radius*1.12),48),baseX=candidate.x-grid.minX*256,baseY=candidate.y-grid.minY*256;
  const pose={angleDeltaDeg:[-15,0,15],radiusFactor:[.9,1,1.1],xOffsetPx:[-8,0,8],yOffsetPx:[-8,0,8]};
  const lockedAligned=__v2dAligned(grid.field,baseX,baseY,candidate.radius,candidate.angle),lockedSupport=__v2dSupportMask(lockedAligned.valid),locked=__v2dScoreAll(source,lockedAligned.gray,lockedSupport,pre),best={D1:null,D2:null,D3:null,D4:null};let evaluated=0;
  for(const da of pose.angleDeltaDeg)for(const rf of pose.radiusFactor)for(const ox of pose.xOffsetPx)for(const oy of pose.yOffsetPx){
    const p={angleDeltaDeg:da,radiusFactor:rf,xOffsetPx:ox,yOffsetPx:oy,angle:angleNorm(candidate.angle+da),radius:candidate.radius*rf,x:candidate.x+ox,y:candidate.y+oy};
    const al=__v2dAligned(grid.field,baseX+ox,baseY+oy,p.radius,p.angle),support=__v2dSupportMask(al.valid),scores=__v2dScoreAll(source,al.gray,support,pre);evaluated++;
    for(const id of ['D1','D2','D3','D4']){const s=scores[id].score;if(s==null)continue;if(!best[id]||s>best[id].score)best[id]={score:s,pose:p,coverage:scores[id].coverage}}
  }
  return{locked,best81:best,posesEvaluated:evaluated,source:{supportPixels:baseSupport.reduce((a,b)=>a+b,0),edgeCount:pre.edges.pts.length,skeletonCount:pre.thin.pts.length,skeletonIterations:pre.thin.iterations,skeletonConverged:pre.thin.converged}};
}
function __v2dConformance(){
  const n=__v2dN,support=__v2dSupportMask();
  const constant=new Float32Array(n*n);constant.fill(.5);const ramp=new Float32Array(n*n);for(let y=0;y<n;y++)for(let x=0;x<n;x++)ramp[y*n+x]=x/(n-1);
  const lum=(.299*255+.587*0+.114*0)/255;if(Math.abs(lum-.299)>1e-12)throw new Error('conformance luminance');
  if(__v2dReflect101(-1,n)!==1||__v2dReflect101(n,n)!==n-2)throw new Error('conformance reflect101');
  if(__v2dPercentile([0,1,2,3,4],.90)!==3)throw new Error('conformance percentile floor rule');
  const cs=__v2dSobel(constant);if(Math.max(...cs.mag)>1e-6)throw new Error('conformance constant sobel');
  const pre=__v2dFeatures(ramp,support),same=__v2dScoreAll(ramp,ramp,support,pre);if(Math.abs(same.D1.score-1)>1e-12)throw new Error('conformance D1 identity');if(Math.abs(same.D2.score-1)>1e-6)throw new Error('conformance D2 identity');if(Math.abs(same.D3.score-1)>1e-12)throw new Error('conformance D3 identity');if(Math.abs(same.D4.score-1)>1e-12)throw new Error('conformance D4 identity');
  const zeroD2=__v2dD2(constant,constant,support);if(zeroD2.score!==null)throw new Error('conformance D2 null weight');
  const thin=__v2dThin(__v2dCrossClose(pre.edges.mask));if(!thin.converged||thin.iterations>128)throw new Error('conformance thinning convergence');
  return{ok:true,n,supportPixels:support.reduce((a,b)=>a+b,0),d1Identity:same.D1.score,d2Identity:same.D2.score,d3Identity:same.D3.score,d4Identity:same.D4.score,d2ZeroWeightNull:zeroD2.score===null,reflect101:[__v2dReflect101(-1,n),__v2dReflect101(n,n)],percentile90:__v2dPercentile([0,1,2,3,4],.90),skeletonIterations:thin.iterations};
}
window.__WWMSYNC_V2_DESCRIPTOR_AUDIT__={evaluate:__v2dEvaluate,conformance:__v2dConformance,contract:{canonicalN:ROI_N,luminance:'Y=(0.299*R+0.587*G+0.114*B)/255',support:'0.20<=r<=0.78; fixed 3px border',poseCount:81,D5:false}};
`;
src=src.slice(0,first)+code+'\n'+src.slice(first);
fs.writeFileSync(target,src);
console.log(JSON.stringify({target,injected:true,kind:'descriptor-v2-outcomes',productionRankingChanged:false,thresholdChanged:false,beamChanged:false}));
