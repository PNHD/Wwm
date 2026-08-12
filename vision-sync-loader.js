(()=>{
'use strict';

const SOURCE_URL='/vision-sync.js';
const xhr=new XMLHttpRequest();
xhr.open('GET',SOURCE_URL,false);
xhr.send(null);
if(xhr.status<200||xhr.status>=300||!xhr.responseText){
  throw new Error(`WWMSync Vision source load failed: HTTP ${xhr.status}`);
}
let source=xhr.responseText;
const applied=[];

function replaceOne(pattern,replacement,label){
  const before=source;
  source=source.replace(pattern,replacement);
  if(source===before)throw new Error(`WWMSync Vision hardening signature missing: ${label}`);
  applied.push(label);
}
function replaceAllChecked(search,replacement,label,minCount=1){
  const count=source.split(search).length-1;
  if(count<minCount)throw new Error(`WWMSync Vision hardening signature missing: ${label} (${count})`);
  source=source.split(search).join(replacement);
  applied.push(`${label}:${count}`);
}

// Shared capture geometry: the game minimap occupies the top-left quarter of the
// shorter capture dimension. This is resolution/aspect-ratio normalization only;
// GFN and local client continue through the same localization semantics.
replaceOne(
  "roiFraction:loadNumber(ROI_KEY,.2,.12,.34)",
  "roiFraction:loadNumber(ROI_KEY,.25,.12,.34)",
  'default-roi-fraction'
);
replaceOne(
  /function roi\(video\)\{[\s\S]*?\}\nfunction preview/,
  "function roi(video){const unit=Math.min(video.videoWidth,video.videoHeight),size=unit*state.roiFraction,half=size/2,defaultCenter=unit*.125,cx=clamp(state.roiX??defaultCenter,half,video.videoWidth-half),cy=clamp(state.roiY??defaultCenter,half,video.videoHeight-half);state.roiX=cx;state.roiY=cy;return{x:cx-half,y:cy-half,size}}\nfunction preview",
  'source-agnostic-roi-geometry'
);
replaceOne(
  "state.roiX=video.videoWidth*.14;state.roiY=video.videoHeight*.17;resetMotionDiagnostics('capture-ready')",
  "{const unit=Math.min(video.videoWidth,video.videoHeight);state.roiX=unit*.125;state.roiY=unit*.125}resetMotionDiagnostics('capture-ready')",
  'capture-start-roi-center'
);

// Real WWM minimaps are translucent: raw gradients otherwise lock onto the 3D
// scene visible below the overlay. Normalize the bright, stable map layer with an
// adaptive per-frame percentile, then apply a small Gaussian blur before the same
// existing gradient/correlation gates. No score threshold is relaxed.
const motionFeaturePatch=`function visionPercentile(values,p){if(!values.length)return 0;const a=Array.from(values).sort((x,y)=>x-y);return a[Math.min(a.length-1,Math.max(0,Math.floor((a.length-1)*p)))]}
function visionGaussianBlur(gray,n){const weights=[.027630550638898826,.0662822452863612,.1238315368057753,.18017382291138087,.20416368871516755,.18017382291138087,.1238315368057753,.0662822452863612,.027630550638898826],tmp=new Float32Array(gray.length),out=new Float32Array(gray.length);for(let y=0;y<n;y++)for(let x=0;x<n;x++){let sum=0;for(let k=-4;k<=4;k++)sum+=gray[y*n+clamp(x+k,0,n-1)]*weights[k+4];tmp[y*n+x]=sum}for(let y=0;y<n;y++)for(let x=0;x<n;x++){let sum=0;for(let k=-4;k<=4;k++)sum+=tmp[clamp(y+k,0,n-1)*n+x]*weights[k+4];out[y*n+x]=sum}return out}
function featureFromWorkCanvas(sourceScale){const ctx=state.workCtx,n=WORK,rgba=ctx.getImageData(0,0,n,n).data,gray=new Float32Array(n*n),sample=[],feature=new Float32Array(n*n),c=(n-1)/2,inner2=(n*.13)**2,outer2=(n*.43)**2;for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114;for(let y=2;y<n-2;y++)for(let x=2;x<n-2;x++){const rx=x-c,ry=y-c,r2=rx*rx+ry*ry;if(r2>=inner2&&r2<=outer2)sample.push(gray[y*n+x])}const threshold=clamp(visionPercentile(sample,.96),150,195),signal=new Float32Array(n*n);for(let i=0;i<signal.length;i++)signal[i]=clamp((gray[i]-threshold)/25,0,1)*255;const stable=visionGaussianBlur(signal,n);let energy=0,count=0;for(let y=2;y<n-2;y++)for(let x=2;x<n-2;x++){const rx=x-c,ry=y-c,r2=rx*rx+ry*ry;if(r2<inner2||r2>outer2)continue;const i=y*n+x,gx=stable[i+1]-stable[i-1],gy=stable[i+n]-stable[i-n],v=gx+gy*.7;feature[i]=v;energy+=v*v;count++}return{data:feature,energy:count?Math.sqrt(energy/count):0,sourceScale,normalization:{kind:'adaptive-translucent-map',threshold}}}
function ensureWorkCanvas(){if(!state.workCanvas){state.workCanvas=document.createElement('canvas');state.workCanvas.width=WORK;state.workCanvas.height=WORK;state.workCtx=state.workCanvas.getContext('2d',{willReadFrequently:true})}}
function featuresFromCanvas(canvas){if(!(canvas instanceof HTMLCanvasElement))return null;ensureWorkCanvas();const ctx=state.workCtx,n=WORK;ctx.clearRect(0,0,n,n);ctx.drawImage(canvas,0,0,canvas.width,canvas.height,0,0,n,n);return featureFromWorkCanvas(canvas.width/n)}
function features(){const video=state.video;if(!video?.videoWidth)return null;ensureWorkCanvas();const r=roi(video),ctx=state.workCtx,n=WORK;ctx.clearRect(0,0,n,n);ctx.drawImage(video,r.x,r.y,r.size,r.size,0,0,n,n);return featureFromWorkCanvas(r.size/n)}
function correlation`;
replaceOne(/function features\(\)\{[\s\S]*?\}\nfunction correlation/,motionFeaturePatch,'translucent-minimap-motion-normalization');

// Partial structural reranking must never compare a reranked structural candidate
// against an unscored raw-recall candidate. Unscored entries stay outside the
// decision set instead of inheriting their raw score as a structural rank.
replaceAllChecked(
  "(b.rankScore??b.score)-(a.rankScore??a.score)",
  "(b.rankScore??-Infinity)-(a.rankScore??-Infinity)",
  'structural-rerank-only',
  4
);

// Keep synthetic capture geometry aligned with the shipping default so browser
// E2E continues to test the production path rather than the retired ROI layout.
replaceOne(
  "size=Math.min(w,h)*.20,cx=w*.14,cy=h*.17",
  "size=Math.min(w,h)*.25,cx=Math.min(w,h)*.125,cy=Math.min(w,h)*.125",
  'synthetic-capture-roi-geometry'
);

// Allow the offline fixture harness to use exactly the same production matcher
// and motion functions. These hooks do not alter live state unless explicitly
// called by a test harness.
replaceOne(
  "async function registerFrame(cfg,mapId){const roiCanvas=VISION.captureRoi(192);",
  "async function registerFrame(cfg,mapId,overrideCanvas=null){const roiCanvas=overrideCanvas||VISION.captureRoi(192);",
  'register-frame-override-canvas'
);
replaceOne(
  "window.__WWMSYNC_VISION_TEST__={setViewport:",
  "window.__WWMSYNC_VISION_TEST__={featureCanvas:featuresFromCanvas,estimatePair:estimate,moveMarker:(dx,dy,sourceScale)=>moveMarker(Number(dx),Number(dy),Number(sourceScale)),resetMotionReplay:()=>{state.previous=null;return true},motionStepCanvas:canvas=>{const current=featuresFromCanvas(canvas);if(!current)return{accepted:false,reason:'feature-unavailable'};if(!state.previous){state.previous=current;return{accepted:false,baseline:true,reason:'waiting-baseline',energy:current.energy,sourceScale:current.sourceScale,normalization:current.normalization}}const motion=estimate(state.previous,current);state.previous=current;let moved=null;if(motion.accepted&&state.tracking)moved=moveMarker(motion.dx,motion.dy,current.sourceScale);return{...motion,sourceScale:current.sourceScale,normalization:current.normalization,moved:moved?.moved||false,moveReason:moved?.reason||null,markerPx:moved?.markerPx||0,latlng:moved?.latlng||null}},beginReplay:()=>{if(!state.stream)state.stream={getTracks:()=>[]};return true},applyReplayAbsolute:payload=>applyAbsoluteFix(payload),endReplay:()=>{if(state.stream&&!state.video)state.stream=null;resetTracking('replay-end');return true},setViewport:",
  'motion-replay-hooks'
);

const absoluteReplayPatch=`window.__WWMSYNC_ABSOLUTE_REPLAY__={
  reset:()=>{state.busy=false;state.lastMapId=null;state.mode='global';state.status='SEARCH';state.reason='fixture-reset';state.stage='coarse-global';state.pending=null;state.last=null;state.localFailures=0;state.fixes=0;state.absolute=null;state.coarseScore=0;state.coarseMargin=0;state.fineScore=0;state.fineMargin=0;state.verifyScore=0;state.topologyScore=0;state.scaleScore=0;state.intensityScore=0;state.angle=0;state.radius=0;state.globalSearches=0;state.firstSearchAt=0;state.searchStartedWithoutAnchor=true;state.searchStartedWithoutMarker=true;state.viewportAtSearch={fixture:true};return true},
  step:async(canvas,mapId=1,roiSize=216)=>{const cfg=MAPS[Number(mapId)];if(!cfg)return{locked:false,reason:'unsupported-map'};if(!(canvas instanceof HTMLCanvasElement))return{locked:false,reason:'canvas-required'};if(state.mode==='idle')state.mode='global';const result=await registerFrame(cfg,Number(mapId),canvas);const snapshot=()=>({mode:state.mode,coarseScore:state.coarseScore,coarseMargin:state.coarseMargin,fineScore:state.fineScore,fineMargin:state.fineMargin,verifyScore:state.verifyScore,scaleScore:state.scaleScore,intensityScore:state.intensityScore,angle:state.angle,radius:state.radius,fixes:state.fixes});if(result.reason){if(state.mode==='local'){state.localFailures++;if(state.localFailures>=2){state.mode='global';state.last=null;state.pending=null}}return{locked:false,reason:result.reason,...snapshot(),coarse:result.coarse||null,fine:result.fine||null,info:{positiveCount:result.info?.positiveCount??0,negativeCount:result.info?.negativeCount??0,contrast:result.info?.contrast??0}}}if(state.mode==='global'||state.mode==='idle'){state.pending={match:{...result.fine,coarseScore:result.coarse.score,coarseMargin:result.coarse.margin},coarseScore:result.coarse.score,coarseMargin:result.coarse.margin,target:result.target};state.mode='confirm';return{locked:false,reason:'confirm-1-of-2',target:result.target,...snapshot()}}if(state.mode==='confirm'){const gate=state.pending?.match?confirmationGate(state.pending.match,result.fine):{ok:false,distance:Infinity,angle:Infinity,scale:Infinity};if(!gate.ok){state.mode='global';state.pending=null;return{locked:false,reason:'confirm-mismatch',confirmation:gate,...snapshot()}}}const matrix=motionMatrixFor(result.fine,cfg,Number(roiSize)||216,result.target);if(!matrix){state.mode='global';state.pending=null;return{locked:false,reason:'absolute-matrix-unavailable',...snapshot()}}state.last={...result.fine,scaleFromCoarse:result.fine.scaleFromCoarse};state.pending=null;state.mode='local';state.localFailures=0;state.fixes++;state.absolute=result.target;return{locked:true,reason:'',target:result.target,motionMatrix:matrix,...snapshot(),fine:{globalX:result.fine.globalX,globalY:result.fine.globalY,angle:result.fine.angle,radius:result.fine.radius,scaleScore:result.fine.scaleScore,intensityScore:result.fine.intensityScore,beamMargin:result.fine.beamMargin,margin:result.fine.margin,verifyScore:result.fine.verifyScore,topologyScore:result.fine.topologyScore}}},
  diagnostics:()=>({mode:state.mode,coarseScore:state.coarseScore,coarseMargin:state.coarseMargin,fineScore:state.fineScore,fineMargin:state.fineMargin,verifyScore:state.verifyScore,scaleScore:state.scaleScore,intensityScore:state.intensityScore,angle:state.angle,radius:state.radius,fixes:state.fixes,absolute:state.absolute,localFailures:state.localFailures})
};
window.__WWMSYNC_ABSOLUTE_DIAGNOSTICS__=`;
replaceOne("window.__WWMSYNC_ABSOLUTE_DIAGNOSTICS__=",absoluteReplayPatch,'absolute-replay-hooks');

source+=`\n//# sourceURL=vision-sync.hardened.js\n`;
(0,eval)(source);
window.__WWMSYNC_VISION_HARDENING__={version:'REAL_FIXTURE_V1',sourceUrl:SOURCE_URL,applied};
})();