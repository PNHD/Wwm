(()=>{
'use strict';
const SCALE_KEY='wwmsync:vision-scale';
const ROI_KEY='wwmsync:vision-roi';
const ORIENTATION_KEY='wwmsync:vision-orientation';
const SAMPLE_MS=250;
const WORK=192;
const MIN_MARKER_PX=.05;
const TEXT={
  vi:{title:'GFN Vision Sync',intro:'Chia sẻ cửa sổ GeForce NOW. WWMSync chỉ đọc pixel minimap cục bộ trong tab này; không upload video, không đọc memory/process/file/packet và không cần PowerShell companion.',start:'Bắt đầu Vision Sync',stop:'Dừng',roiHint:'ROI mặc định ở minimap góc trên-trái. Bấm đúng tâm minimap trong preview nếu cần chỉnh.',anchor:'Đặt vị trí hiện tại trên map',anchorHint:'Bấm nút rồi click đúng vị trí nhân vật hiện tại trên WWMSync map một lần.',confidence:'Tin cậy',accepted:'Frame có marker delta',held:'Frame giữ',advanced:'Tinh chỉnh',roiSize:'Kích thước ROI',scale:'Tỉ lệ di chuyển',orientation:'Bù hướng minimap',diagnostics:'Motion diagnostics',rawDelta:'Raw terrain dx/dy',correctedDelta:'Corrected player dx/dy',cumulative:'Cumulative displacement',markerDelta:'Marker Δ lat/lng',diagConfidence:'Confidence',holdReason:'HOLD reason',off:'Vision Sync đang tắt.',ready:'Đã nhận screen capture. Hệ thống sẽ thử định vị tuyệt đối; manual anchor vẫn là fallback.',clickMap:'Click vị trí hiện tại của nhân vật trên map.',tracking:'Đang theo dõi minimap và cập nhật marker.',hold:'Đang giữ marker; xem HOLD reason bên dưới.',unsupported:'Trình duyệt này không hỗ trợ screen capture cần thiết.',denied:'Screen capture bị hủy hoặc không được cấp quyền.',ended:'Screen capture đã kết thúc.',anchorSet:'Anchor đã đặt. Vision Sync đang theo dõi.',roiSelected:'Đã cập nhật vùng minimap.'},
  en:{title:'GFN Vision Sync',intro:'Share the GeForce NOW window. WWMSync reads minimap pixels locally in this tab only; it does not upload video, read game memory/process/files/packets, or require a PowerShell companion.',start:'Start Vision Sync',stop:'Stop',roiHint:'The default ROI targets the upper-left minimap. Click the minimap center in the preview if it needs adjustment.',anchor:'Set current position on map',anchorHint:'Press the button, then click your character’s current position on the WWMSync map once.',confidence:'Confidence',accepted:'Frames with marker delta',held:'Held',advanced:'Tuning',roiSize:'ROI size',scale:'Movement scale',orientation:'Minimap orientation',diagnostics:'Motion diagnostics',rawDelta:'Raw terrain dx/dy',correctedDelta:'Corrected player dx/dy',cumulative:'Cumulative displacement',markerDelta:'Marker Δ lat/lng',diagConfidence:'Confidence',holdReason:'HOLD reason',off:'Vision Sync is off.',ready:'Screen capture is ready. Absolute localization will be attempted; manual anchor remains a fallback.',clickMap:'Click your current character position on the map.',tracking:'Tracking the minimap and updating the marker.',hold:'Holding the marker; see HOLD reason below.',unsupported:'This browser does not support the required screen capture API.',denied:'Screen capture was cancelled or permission was not granted.',ended:'Screen capture ended.',anchorSet:'Anchor set. Vision Sync is tracking.',roiSelected:'Minimap region updated.'}
};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const loadNumber=(key,fallback,min,max)=>{const v=Number(localStorage.getItem(key));return Number.isFinite(v)?clamp(v,min,max):fallback};
const state={
  stream:null,video:null,previewRaf:0,timer:0,workCanvas:null,workCtx:null,
  roiX:null,roiY:null,roiFraction:loadNumber(ROI_KEY,.2,.12,.34),scale:loadNumber(SCALE_KEY,1,.25,6),orientation:loadNumber(ORIENTATION_KEY,0,-180,180),motionMatrix:null,
  previous:null,tracking:false,anchorPoint:null,anchorLatLng:null,referenceZoom:11,marker:null,mapClickHandler:null,
  accumX:0,accumY:0,accepted:0,held:0,lowFrames:0,confidence:0,statusKind:'off',statusKey:'off',absoluteFixes:0,lastAbsoluteAt:0,
  rawDx:0,rawDy:0,correctedDx:0,correctedDy:0,markerDeltaLat:0,markerDeltaLng:0,holdReason:'—',lastScore:0,lastEnergy:0
};
let mapRef=null;
const ids=['visionStartButton','visionStopButton','visionAnchorButton','visionBadge','visionStatus','visionPreview','visionSetup','visionConfidence','visionAccepted','visionHeld','visionRoiSize','visionRoiValue','visionScale','visionScaleValue','visionOrientation','visionOrientationValue','visionRawDelta','visionCorrectedDelta','visionCumulative','visionMarkerDelta','visionDiagnosticConfidence','visionHoldReason','sidebar'];
const el=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
const lang=()=>document.documentElement.lang==='en'||document.getElementById('languageSelect')?.value==='en'?'en':'vi';
const tx=key=>TEXT[lang()][key]||TEXT.en[key]||key;
const fmt=v=>Number.isFinite(v)?`${v>=0?'+':''}${v.toFixed(3)}`:'—';
function setStatus(kind,key){
  state.statusKind=kind;state.statusKey=key;
  if(!el.visionBadge||!el.visionStatus)return;
  const labels={off:'OFF',ready:'READY',tracking:'TRACKING',hold:'HOLD',error:'ERROR'};
  el.visionBadge.textContent=labels[kind]||kind.toUpperCase();
  el.visionBadge.className=`status-badge ${kind==='tracking'?'good':kind==='ready'||kind==='hold'?'warn':kind==='error'?'bad':''}`.trim();
  el.visionStatus.textContent=tx(key);
  el.visionStatus.className=`vision-status ${kind==='tracking'?'good':kind==='ready'||kind==='hold'?'warn':kind==='error'?'error':''}`.trim();
}
function metrics(){
  if(el.visionConfidence)el.visionConfidence.textContent=`${Math.round(clamp(state.confidence,0,1)*100)}%`;
  if(el.visionAccepted)el.visionAccepted.textContent=String(state.accepted);
  if(el.visionHeld)el.visionHeld.textContent=String(state.held);
  if(el.visionRoiValue)el.visionRoiValue.textContent=`${Math.round(state.roiFraction*100)}%`;
  if(el.visionScaleValue)el.visionScaleValue.textContent=state.motionMatrix?'AUTO':`${state.scale.toFixed(2)}×`;
  if(el.visionOrientationValue)el.visionOrientationValue.textContent=state.motionMatrix?'AUTO':`${Math.round(state.orientation)}°`;
  if(el.visionRawDelta)el.visionRawDelta.textContent=`${fmt(state.rawDx)}, ${fmt(state.rawDy)} work px`;
  if(el.visionCorrectedDelta)el.visionCorrectedDelta.textContent=`${fmt(state.correctedDx)}, ${fmt(state.correctedDy)} map px`;
  if(el.visionCumulative)el.visionCumulative.textContent=`${fmt(state.accumX)}, ${fmt(state.accumY)} map px`;
  if(el.visionMarkerDelta)el.visionMarkerDelta.textContent=`${fmt(state.markerDeltaLat)}, ${fmt(state.markerDeltaLng)}`;
  if(el.visionDiagnosticConfidence)el.visionDiagnosticConfidence.textContent=`${Math.round(clamp(state.confidence,0,1)*100)}% · corr ${state.lastScore.toFixed(3)} · energy ${state.lastEnergy.toFixed(2)}`;
  if(el.visionHoldReason)el.visionHoldReason.textContent=state.holdReason||'—';
}
function localize(){
  document.querySelectorAll('[data-vision-i18n]').forEach(node=>node.textContent=tx(node.dataset.visionI18n));
  setStatus(state.statusKind,state.statusKey);metrics();
}
function refresh(){
  const active=!!state.stream;
  el.visionStartButton.disabled=active;el.visionStopButton.disabled=!active;el.visionAnchorButton.disabled=!active||!mapRef;
  el.visionSetup.classList.toggle('hidden',!active);
  el.visionRoiSize.value=String(state.roiFraction);el.visionScale.value=String(state.scale);
  if(el.visionOrientation)el.visionOrientation.value=String(state.orientation);
  metrics();
}
function clearMapClick(){
  if(state.mapClickHandler&&mapRef)mapRef.off('click',state.mapClickHandler);
  state.mapClickHandler=null;el.visionAnchorButton.classList.remove('armed');
}
function resetMotionDiagnostics(reason='—'){
  state.rawDx=0;state.rawDy=0;state.correctedDx=0;state.correctedDy=0;state.markerDeltaLat=0;state.markerDeltaLng=0;state.holdReason=reason;state.lastScore=0;state.lastEnergy=0;
}
function resetAnchor(){
  clearMapClick();if(state.marker){state.marker.remove();state.marker=null}
  state.anchorPoint=null;state.anchorLatLng=null;state.previous=null;state.tracking=false;state.accumX=0;state.accumY=0;state.motionMatrix=null;resetMotionDiagnostics('anchor-reset');
  if(state.stream)setStatus('ready','ready');refresh();
}
function attachMap(map){
  mapRef=map;map.once('unload',()=>{if(mapRef===map){resetAnchor();mapRef=null;refresh()}});refresh();
}
if(window.L?.map){
  const original=window.L.map;
  window.L.map=function(...args){const map=original.apply(this,args);attachMap(map);return map};
}
function markerAt(latlng){
  if(state.marker)state.marker.remove();
  const icon=window.L.divIcon({className:'vision-player-marker-wrap',html:'<div class="vision-player-marker"><span></span></div>',iconSize:[24,24],iconAnchor:[12,12]});
  state.marker=window.L.marker(latlng,{icon,interactive:false,zIndexOffset:1200}).addTo(mapRef);
}
function requestAnchor(){
  if(!state.stream||!mapRef)return;clearMapClick();el.visionAnchorButton.classList.add('armed');setStatus('ready','clickMap');
  if(innerWidth<=800)el.sidebar?.classList.remove('open');
  const map=mapRef;const handler=event=>{
    map.off('click',handler);state.mapClickHandler=null;el.visionAnchorButton.classList.remove('armed');
    state.referenceZoom=Number.isFinite(map.getZoom())?map.getZoom():11;
    state.anchorLatLng=window.L.latLng(event.latlng.lat,event.latlng.lng);
    state.anchorPoint=map.project(state.anchorLatLng,state.referenceZoom);
    state.accumX=0;state.accumY=0;state.previous=null;state.tracking=true;state.accepted=0;state.held=0;state.lowFrames=0;state.confidence=0;state.motionMatrix=null;
    resetMotionDiagnostics('waiting-baseline');markerAt(state.anchorLatLng);setStatus('tracking','anchorSet');metrics();
  };
  state.mapClickHandler=handler;map.on('click',handler);
}
function roi(video){
  const size=Math.min(video.videoWidth,video.videoHeight)*state.roiFraction,half=size/2;
  const cx=clamp(state.roiX??video.videoWidth*.14,half,video.videoWidth-half),cy=clamp(state.roiY??video.videoHeight*.17,half,video.videoHeight-half);
  state.roiX=cx;state.roiY=cy;return{x:cx-half,y:cy-half,size};
}
function preview(){
  const video=state.video,canvas=el.visionPreview;if(!video||!state.stream)return;
  const width=360,height=Math.max(160,Math.round(width*video.videoHeight/video.videoWidth));if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height}
  const ctx=canvas.getContext('2d',{alpha:false});ctx.drawImage(video,0,0,width,height);
  const r=roi(video),sx=width/video.videoWidth,sy=height/video.videoHeight;ctx.save();ctx.strokeStyle='#f2cc7a';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.strokeRect(r.x*sx,r.y*sy,r.size*sx,r.size*sy);ctx.restore();
  state.previewRaf=requestAnimationFrame(preview);
}
function selectRoi(event){
  if(!state.video||!state.stream)return;const rect=el.visionPreview.getBoundingClientRect();
  state.roiX=clamp((event.clientX-rect.left)/rect.width,0,1)*state.video.videoWidth;state.roiY=clamp((event.clientY-rect.top)/rect.height,0,1)*state.video.videoHeight;state.previous=null;state.holdReason='roi-baseline-reset';
  setStatus(state.tracking?'tracking':'ready',state.tracking?'tracking':'roiSelected');metrics();
}
function features(){
  const video=state.video;if(!video?.videoWidth)return null;
  if(!state.workCanvas){state.workCanvas=document.createElement('canvas');state.workCanvas.width=WORK;state.workCanvas.height=WORK;state.workCtx=state.workCanvas.getContext('2d',{willReadFrequently:true})}
  const r=roi(video),ctx=state.workCtx,n=WORK;ctx.drawImage(video,r.x,r.y,r.size,r.size,0,0,n,n);
  const rgba=ctx.getImageData(0,0,n,n).data,gray=new Float32Array(n*n),feature=new Float32Array(n*n);
  for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114;
  const c=(n-1)/2,inner2=(n*.13)**2,outer2=(n*.43)**2;let energy=0,count=0;
  for(let y=2;y<n-2;y++)for(let x=2;x<n-2;x++){
    const rx=x-c,ry=y-c,r2=rx*rx+ry*ry;if(r2<inner2||r2>outer2)continue;
    const i=y*n+x,gx=gray[i+1]-gray[i-1],gy=gray[i+n]-gray[i-n],v=gx+gy*.7;feature[i]=v;energy+=v*v;count++;
  }
  return{data:feature,energy:count?Math.sqrt(energy/count):0,sourceScale:r.size/n};
}
function correlation(a,b,n,dx,dy){
  const c=(n-1)/2,inner2=(n*.15)**2,outer2=(n*.41)**2,margin=10;let ab=0,a2=0,b2=0,count=0;
  for(let y=margin;y<n-margin;y+=2){const yy=y+dy;if(yy<margin||yy>=n-margin)continue;for(let x=margin;x<n-margin;x+=2){
    const xx=x+dx;if(xx<margin||xx>=n-margin)continue;const rx=x-c,ry=y-c,rr=rx*rx+ry*ry;if(rr<inner2||rr>outer2)continue;
    const rxx=xx-c,ryy=yy-c,rr2=rxx*rxx+ryy*ryy;if(rr2<inner2||rr2>outer2)continue;const av=a[y*n+x],bv=b[yy*n+xx];ab+=av*bv;a2+=av*av;b2+=bv*bv;count++;
  }}
  return count>200&&a2>1&&b2>1?ab/Math.sqrt(a2*b2):-1;
}
function refine(neg,center,pos){const d=neg-2*center+pos;return !Number.isFinite(d)||Math.abs(d)<1e-6?0:clamp(.5*(neg-pos)/d,-.5,.5)}
function estimate(previous,current){
  const max=7,scores=new Map();let best={score:-1,dx:0,dy:0},second=-1;
  for(let dy=-max;dy<=max;dy++)for(let dx=-max;dx<=max;dx++){
    const score=correlation(previous.data,current.data,WORK,dx,dy);scores.set(`${dx},${dy}`,score);if(score>best.score){second=best.score;best={score,dx,dy}}else if(score>second)second=score;
  }
  const get=(dx,dy)=>scores.get(`${dx},${dy}`)??best.score;
  const dx=best.dx+(Math.abs(best.dx)<max?refine(get(best.dx-1,best.dy),best.score,get(best.dx+1,best.dy)):0);
  const dy=best.dy+(Math.abs(best.dy)<max?refine(get(best.dx,best.dy-1),best.score,get(best.dx,best.dy+1)):0);
  const texture=clamp((current.energy-4)/22,0,1),corr=clamp((best.score-.68)/.32,0,1),sharp=clamp((best.score-second)/.025,0,1),confidence=corr*.78+texture*.17+sharp*.05;
  const magnitude=Math.hypot(dx,dy);
  let reason='';
  if(best.score<.82)reason=`low-correlation (${best.score.toFixed(3)})`;
  else if(current.energy<5.5)reason=`low-texture (${current.energy.toFixed(2)})`;
  else if(magnitude>5.5)reason=`motion-outlier (${magnitude.toFixed(2)} work px)`;
  return{dx,dy,confidence,score:best.score,energy:current.energy,accepted:!reason,reason};
}
function correctedDelta(dx,dy,sourceScale){
  const playerX=(-dx)*sourceScale,playerY=(-dy)*sourceScale;
  if(state.motionMatrix){const[m00,m01,m10,m11]=state.motionMatrix;return{x:m00*playerX+m01*playerY,y:m10*playerX+m11*playerY}}
  const radians=state.orientation*Math.PI/180,c=Math.cos(radians),s=Math.sin(radians);
  return{x:(playerX*c-playerY*s)*state.scale,y:(playerX*s+playerY*c)*state.scale};
}
function moveMarker(dx,dy,sourceScale){
  if(!state.anchorPoint||!state.marker||!mapRef)return{moved:false,reason:'missing-anchor-or-marker'};
  const corrected=correctedDelta(dx,dy,sourceScale);state.correctedDx=corrected.x;state.correctedDy=corrected.y;
  if(Math.hypot(corrected.x,corrected.y)<MIN_MARKER_PX)return{moved:false,reason:'no-motion'};
  const nextAccumX=state.accumX+corrected.x,nextAccumY=state.accumY+corrected.y;
  const point=window.L.point(state.anchorPoint.x+nextAccumX,state.anchorPoint.y+nextAccumY),latlng=mapRef.unproject(point,state.referenceZoom),bounds=mapRef.options.maxBounds;
  if(bounds&&!bounds.contains(latlng))return{moved:false,reason:'out-of-map-bounds'};
  const before=state.marker.getLatLng();
  state.marker.setLatLng(latlng);
  const actual=state.marker.getLatLng();
  const beforePoint=mapRef.project(before,state.referenceZoom),afterPoint=mapRef.project(actual,state.referenceZoom);
  const markerPx=Math.hypot(afterPoint.x-beforePoint.x,afterPoint.y-beforePoint.y);
  state.markerDeltaLat=actual.lat-before.lat;state.markerDeltaLng=actual.lng-before.lng;
  if(markerPx<MIN_MARKER_PX){state.marker.setLatLng(before);state.markerDeltaLat=0;state.markerDeltaLng=0;return{moved:false,reason:'marker-no-delta'};}
  state.accumX=nextAccumX;state.accumY=nextAccumY;
  return{moved:true,reason:'—',latlng:actual,markerPx};
}
function sample(){
  if(!state.tracking||!state.stream)return;
  const current=features();if(!current)return;
  state.lastEnergy=current.energy;
  if(!state.previous){state.previous=current;state.holdReason='waiting-baseline';metrics();return}
  const motion=estimate(state.previous,current);state.confidence=motion.confidence;state.rawDx=motion.dx;state.rawDy=motion.dy;state.lastScore=motion.score;state.lastEnergy=motion.energy;state.markerDeltaLat=0;state.markerDeltaLng=0;
  if(!motion.accepted){
    state.correctedDx=0;state.correctedDy=0;state.held++;state.lowFrames++;state.holdReason=motion.reason;setStatus('hold','hold');
    if(state.lowFrames>=3){state.previous=current;state.lowFrames=0}
  }else{
    const result=moveMarker(motion.dx,motion.dy,current.sourceScale);
    state.previous=current;state.lowFrames=0;
    if(result.moved){state.accepted++;state.holdReason='—';setStatus('tracking','tracking')}
    else{state.held++;state.holdReason=result.reason;setStatus('hold','hold')}
  }
  metrics();
}
async function start(){
  if(state.stream)return;if(!navigator.mediaDevices?.getDisplayMedia){setStatus('error','unsupported');return}
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}),video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;await video.play();
    if(!video.videoWidth)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
    state.stream=stream;state.video=video;state.previous=null;state.tracking=false;state.accepted=0;state.held=0;state.confidence=0;state.motionMatrix=null;state.absoluteFixes=0;state.lastAbsoluteAt=0;state.roiX=video.videoWidth*.14;state.roiY=video.videoHeight*.17;resetMotionDiagnostics('capture-ready');
    stream.getVideoTracks()[0]?.addEventListener('ended',()=>stop('ended'),{once:true});state.previewRaf=requestAnimationFrame(preview);state.timer=setInterval(sample,SAMPLE_MS);refresh();setStatus('ready','ready');
  }catch(error){console.warn('[WWMSync] Vision capture',error);setStatus('error',error?.name==='NotAllowedError'?'denied':'unsupported')}
}
function stop(reason='user'){
  clearMapClick();if(state.timer)clearInterval(state.timer);state.timer=0;if(state.previewRaf)cancelAnimationFrame(state.previewRaf);state.previewRaf=0;
  const stream=state.stream;state.stream=null;if(stream)for(const track of stream.getTracks())if(track.readyState!=='ended')track.stop();if(state.video){state.video.srcObject=null;state.video=null}
  if(state.marker){state.marker.remove();state.marker=null}state.previous=null;state.tracking=false;state.anchorPoint=null;state.anchorLatLng=null;state.accumX=0;state.accumY=0;state.confidence=0;state.motionMatrix=null;resetMotionDiagnostics(reason==='ended'?'capture-ended':'stopped');refresh();setStatus('off',reason==='ended'?'ended':'off');
}
function captureRoiCanvas(size=WORK){
  if(!state.stream||!state.video?.videoWidth)return null;const n=clamp(Math.round(Number(size)||WORK),64,384),r=roi(state.video),canvas=document.createElement('canvas');canvas.width=n;canvas.height=n;canvas.getContext('2d',{alpha:false,willReadFrequently:true}).drawImage(state.video,r.x,r.y,r.size,r.size,0,0,n,n);return canvas;
}
function applyAbsoluteFix(payload={}){
  if(!state.stream||!mapRef)return{ok:false,reason:'capture-or-map-unavailable'};
  const lat=Number(payload.lat),lng=Number(payload.lng);if(!Number.isFinite(lat)||!Number.isFinite(lng))return{ok:false,reason:'invalid-latlng'};
  const latlng=window.L.latLng(lat,lng),bounds=mapRef.options.maxBounds;if(bounds&&!bounds.contains(latlng))return{ok:false,reason:'out-of-map-bounds'};
  clearMapClick();if(!state.anchorPoint)state.referenceZoom=Number.isFinite(mapRef.getZoom())?mapRef.getZoom():11;
  const before=state.marker?.getLatLng?.()||null;
  state.anchorLatLng=latlng;state.anchorPoint=mapRef.project(latlng,state.referenceZoom);state.accumX=0;state.accumY=0;state.previous=null;state.tracking=true;state.lowFrames=0;state.confidence=0;
  const matrix=Array.isArray(payload.motionMatrix)?payload.motionMatrix.map(Number):null;state.motionMatrix=matrix?.length===4&&matrix.every(Number.isFinite)?matrix:null;
  markerAt(latlng);state.absoluteFixes++;state.lastAbsoluteAt=Date.now();resetMotionDiagnostics(`absolute-fix:${payload.source||'visual'}`);
  if(before){state.markerDeltaLat=latlng.lat-before.lat;state.markerDeltaLng=latlng.lng-before.lng}
  setStatus('tracking','tracking');metrics();return{ok:true,latlng,referenceZoom:state.referenceZoom,motionMatrix:state.motionMatrix};
}
window.__WWMSYNC_VISION_BRIDGE__={
  captureRoi:captureRoiCanvas,
  state:()=>{const r=state.video?.videoWidth?roi(state.video):null;return{active:!!state.stream,tracking:state.tracking,roi:r?{x:r.x,y:r.y,size:r.size}:null,referenceZoom:state.referenceZoom,mapZoom:mapRef?.getZoom?.()??null,markerLatLng:state.marker?.getLatLng?.()||null,motionCalibration:state.motionMatrix?'absolute-matrix':'manual'}},
  project:(lat,lng,zoom=state.referenceZoom)=>mapRef?mapRef.project(window.L.latLng(lat,lng),zoom):null,
  contains:(lat,lng)=>!!mapRef&&(!mapRef.options.maxBounds||mapRef.options.maxBounds.contains(window.L.latLng(lat,lng))),
  applyAbsoluteFix
};
window.__WWMSYNC_VISION_DIAGNOSTICS__=()=>({rawDx:state.rawDx,rawDy:state.rawDy,correctedDx:state.correctedDx,correctedDy:state.correctedDy,accumX:state.accumX,accumY:state.accumY,markerDeltaLat:state.markerDeltaLat,markerDeltaLng:state.markerDeltaLng,confidence:state.confidence,holdReason:state.holdReason,accepted:state.accepted,held:state.held,referenceZoom:state.referenceZoom,orientation:state.orientation,motionCalibration:state.motionMatrix?'absolute-matrix':'manual',motionMatrix:state.motionMatrix,absoluteFixes:state.absoluteFixes,lastAbsoluteAt:state.lastAbsoluteAt,markerLatLng:state.marker?.getLatLng?.()||null});
el.visionStartButton.addEventListener('click',()=>void start());el.visionStopButton.addEventListener('click',()=>stop('user'));el.visionAnchorButton.addEventListener('click',requestAnchor);el.visionPreview.addEventListener('click',selectRoi);
el.visionRoiSize.addEventListener('input',()=>{state.roiFraction=clamp(Number(el.visionRoiSize.value),.12,.34);localStorage.setItem(ROI_KEY,String(state.roiFraction));state.previous=null;state.holdReason='roi-baseline-reset';metrics()});
el.visionScale.addEventListener('input',()=>{state.scale=clamp(Number(el.visionScale.value),.25,6);state.motionMatrix=null;localStorage.setItem(SCALE_KEY,String(state.scale));metrics()});
el.visionOrientation?.addEventListener('input',()=>{state.orientation=clamp(Number(el.visionOrientation.value),-180,180);state.motionMatrix=null;localStorage.setItem(ORIENTATION_KEY,String(state.orientation));metrics()});
document.getElementById('languageSelect')?.addEventListener('change',()=>queueMicrotask(localize));new MutationObserver(localize).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});window.addEventListener('beforeunload',()=>{if(state.stream)stop('user')});
refresh();localize();
})();

(()=>{
'use strict';
const VISION=window.__WWMSYNC_VISION_BRIDGE__;
if(!VISION)return;
const MAIN_TILE='https://img.166.net/canonical/h72/tilemap/v15.0/{z}/{x}_{y}.png?imageView&v=1';
const SUB4_TILE='https://img.166.net/canonical/h72/tilemap/subType4/v2/{z}/{x}_{y}.png?imageView&v=1';
const GLOBAL_BOUNDS={lngMin:-2.8,lngMax:0,latMin:0,latMax:2.8};
const DASHEN={
  1:{calMeter:1024/1008,realMeter:256/19456,xOffset:12095.6875,yOffset:12095.6875,xArrow:-1,yArrow:1,isXHorizontal:false},
  2:{calMeter:1024/1008,realMeter:256/19456,xOffset:2015.89583,yOffset:2015.8302,xArrow:-1,yArrow:1,isXHorizontal:false},
  4:{calMeter:1024/1008,realMeter:.015625,xOffset:2128,yOffset:4156,xArrow:-1,yArrow:1,isXHorizontal:false}
};
const MAPS={
  1:{name:'Qinghe',subtype:1,width:32768,tile:MAIN_TILE,geometryOk:true,bridge:[[-.0008571998713959525,3.105598492965692e-10],[2.2578244634162414e-10,-.0008384564733202777],[-2.5356030330799597,-1.1167063806874027]],p95:5.885351935873201e-6},
  2:{name:'Kaifeng',subtype:1,width:32768,tile:MAIN_TILE,geometryOk:true,bridge:[[-.0006786008932376111,3.202127447520522e-10],[-5.090606415136117e-10,-.0006518996758809071],[-1.0806951387375319,.5453954425180498]],p95:5.658995209442366e-6},
  3:{name:'Hexi',subtype:2,width:32768,tile:MAIN_TILE,geometryOk:false,bridge:[[-.0004418098354879717,-4.683316418019453e-7],[1.9615559186680637e-7,-.00044227024902754146],[-2.327163272561875,2.2942238497371226]],p95:.002151840429952529},
  4:{name:'Kaifeng Palace',subtype:4,width:8192,tile:SUB4_TILE,geometryOk:true,bridge:[[-.0018805015482138414,-4.2098541037416125e-9],[-4.85819355610425e-10,-.0018007017851145606],[-.8635958719320187,-2.492606921960836]],p95:5.344759512047002e-6}
};
const CHECK_MS=6500,COARSE_Z=3,FINE_Z=5,ROI_N=72,SAMPLES=36,NEGATIVE_SAMPLES=20,COARSE_BEAM=24;
const tileCache=new Map(),atlasCache=new Map();
const state={busy:false,lastMapId:null,mode:'idle',status:'OFF',reason:'capture-inactive',coarseScore:0,coarseMargin:0,fineScore:0,fineMargin:0,angle:0,radius:0,absolute:null,pending:null,last:null,localFailures:0,fixes:0,lastRunAt:0,lastError:null};
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const rad=d=>d*Math.PI/180;
const angleNorm=d=>((d%360)+360)%360;
const angleDiff=(a,b)=>Math.abs(((a-b+180)%360+360)%360-180);
function currentMapId(){return Number(document.getElementById('mapSelect')?.value)||1}
function setDiag(status,reason='—'){state.status=status;state.reason=reason;renderDiag()}
function installDiag(){
  if(document.getElementById('visionAbsoluteDiagnostics'))return;
  const motion=document.querySelector('.vision-diagnostics');if(!motion)return;
  const box=document.createElement('div');box.id='visionAbsoluteDiagnostics';box.className='vision-diagnostics';box.setAttribute('aria-live','polite');
  box.innerHTML='<div class="vision-diagnostics-head"><strong>Absolute localization</strong><small>PROTOTYPE</small></div><div class="vision-diagnostic-row"><span>Status</span><code id="visionAbsoluteStatus">OFF</code></div><div class="vision-diagnostic-row"><span>Registration</span><code id="visionAbsoluteMatch">—</code></div><div class="vision-diagnostic-row"><span>Absolute position</span><code id="visionAbsolutePosition">—</code></div><div class="vision-diagnostic-row hold"><span>Gate / correction</span><code id="visionAbsoluteReason">capture-inactive</code></div>';
  motion.insertAdjacentElement('afterend',box);renderDiag();
}
function renderDiag(){
  const s=document.getElementById('visionAbsoluteStatus'),m=document.getElementById('visionAbsoluteMatch'),p=document.getElementById('visionAbsolutePosition'),r=document.getElementById('visionAbsoluteReason');
  if(s)s.textContent=state.status;
  if(m)m.textContent=`coarse ${state.coarseScore.toFixed(3)}/${state.coarseMargin.toFixed(3)} · fine ${state.fineScore.toFixed(3)}/${state.fineMargin.toFixed(3)} · ${Math.round(state.angle)}°`;
  if(p)p.textContent=state.absolute?`${state.absolute.lat.toFixed(6)}, ${state.absolute.lng.toFixed(6)} · fixes ${state.fixes}`:'—';
  if(r)r.textContent=state.reason||'—';
}
function inverseDashen(lat,lng,subtype){
  const c=DASHEN[subtype],f=c.realMeter*c.calMeter;if(!c)return null;
  const rr=c.isXHorizontal?lat:lng,qq=c.isXHorizontal?lng:lat;
  return{x:(rr/f-c.xOffset)/c.xArrow,y:(qq/f-c.yOffset)/c.yArrow};
}
function dashToGlobal(lat,lng,cfg){
  const w=inverseDashen(lat,lng,cfg.subtype);if(!w)return null;const b=cfg.bridge;
  const globalLng=w.x*b[0][0]+w.y*b[1][0]+b[2][0],globalLat=w.x*b[0][1]+w.y*b[1][1]+b[2][1];
  return{lat:globalLat,lng:globalLng,worldX:w.x,worldY:w.y,dashLat:lat,dashLng:lng};
}
function pixelToGlobal(px,py,z,cfg){return dashToGlobal(py/(2**z),px/(2**z),cfg)}
function inGlobalBounds(t){return !!t&&t.lng>=GLOBAL_BOUNDS.lngMin&&t.lng<=GLOBAL_BOUNDS.lngMax&&t.lat>=GLOBAL_BOUNDS.latMin&&t.lat<=GLOBAL_BOUNDS.latMax}
function tileUrl(cfg,z,x,y){return cfg.tile.replace('{z}',String(z)).replace('{x}',String(x)).replace('{y}',String(y))}
function loadTile(cfg,z,x,y){
  const url=tileUrl(cfg,z,x,y);if(tileCache.has(url))return tileCache.get(url);
  const promise=new Promise((resolve,reject)=>{const img=new Image();img.crossOrigin='anonymous';img.decoding='async';img.onload=()=>resolve(img);img.onerror=()=>reject(new Error(`tile-load ${z}/${x}/${y}`));img.src=url});tileCache.set(url,promise);return promise;
}
function tileCount(cfg,z){return Math.round(cfg.width/32768*(2**z))}
async function loadTileGrid(cfg,z,minX,minY,maxX,maxY){
  const n=tileCount(cfg,z);minX=clamp(minX,0,n-1);minY=clamp(minY,0,n-1);maxX=clamp(maxX,0,n-1);maxY=clamp(maxY,0,n-1);
  const canvas=document.createElement('canvas');canvas.width=(maxX-minX+1)*256;canvas.height=(maxY-minY+1)*256;const ctx=canvas.getContext('2d',{alpha:false});ctx.fillStyle='#111';ctx.fillRect(0,0,canvas.width,canvas.height);
  const jobs=[];for(let y=minY;y<=maxY;y++)for(let x=minX;x<=maxX;x++)jobs.push([x,y]);
  for(let i=0;i<jobs.length;i+=8){await Promise.all(jobs.slice(i,i+8).map(async([x,y])=>{try{const img=await loadTile(cfg,z,x,y);ctx.drawImage(img,(x-minX)*256,(y-minY)*256,256,256)}catch(error){console.warn('[WWMSync absolute]',error.message)}}));await sleep(0)}
  return{canvas,minX,minY,maxX,maxY,z};
}
async function coarseAtlas(cfg){
  const key=`${cfg.tile}|${COARSE_Z}`;if(atlasCache.has(key))return atlasCache.get(key);
  const promise=(async()=>{const n=tileCount(cfg,COARSE_Z),grid=await loadTileGrid(cfg,COARSE_Z,0,0,n-1,n-1),factor=cfg.width===32768?4:2,small=document.createElement('canvas');small.width=Math.round(grid.canvas.width/factor);small.height=Math.round(grid.canvas.height/factor);small.getContext('2d',{alpha:false}).drawImage(grid.canvas,0,0,small.width,small.height);return{...grid,full:grid.canvas,small,factor,field:gradientField(small)}})();atlasCache.set(key,promise);return promise;
}
function gradientField(canvas){
  const w=canvas.width,h=canvas.height,rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,gray=new Float32Array(w*h),mag=new Float32Array(w*h),cos2=new Float32Array(w*h),sin2=new Float32Array(w*h),sample=[];
  for(let i=0,p=0;i<gray.length;i++,p+=4)gray[i]=rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114;
  for(let y=1;y<h-1;y++)for(let x=1;x<w-1;x++){const i=y*w+x,gx=gray[i+1]-gray[i-1],gy=gray[i+w]-gray[i-w],m=Math.hypot(gx,gy),a=Math.atan2(gy,gx)*2;mag[i]=m;cos2[i]=Math.cos(a);sin2[i]=Math.sin(a);if((x+y*3)%23===0)sample.push(m)}
  sample.sort((a,b)=>a-b);const p90=sample[Math.floor(sample.length*.9)]||1;return{w,h,gray,mag,cos2,sin2,p90};
}
function roiSamples(canvas){
  const c=document.createElement('canvas');c.width=ROI_N;c.height=ROI_N;c.getContext('2d',{alpha:false}).drawImage(canvas,0,0,ROI_N,ROI_N);const f=gradientField(c),mid=(ROI_N-1)/2,candidates=[],quiet=[],verify=[];
  for(let y=2;y<ROI_N-2;y++)for(let x=2;x<ROI_N-2;x++){const nx=(x-mid)/(ROI_N/2),ny=(y-mid)/(ROI_N/2),rr=Math.hypot(nx,ny);if(rr<.20||rr>.78)continue;const i=y*ROI_N+x,m=f.mag[i],theta=.5*Math.atan2(f.sin2[i],f.cos2[i]);if((x+y)%3===0)verify.push({nx,ny,gray:f.gray[i],strength:clamp(m/f.p90,0,1),c2:f.cos2[i],s2:f.sin2[i]});if(m>=Math.max(5,f.p90*.42))candidates.push({x,y,nx,ny,mag:m,theta});else if(m<=Math.max(3,f.p90*.20))quiet.push({x,y,nx,ny,mag:m,theta,negative:true})}
  candidates.sort((a,b)=>b.mag-a.mag);const picked=[];for(const s of candidates){if(picked.every(p=>Math.hypot(p.x-s.x,p.y-s.y)>4)){picked.push(s);if(picked.length>=SAMPLES)break}}
  const top=picked[0]?.mag||1;for(const s of picked)s.weight=clamp(s.mag/top,.25,1);
  quiet.sort((a,b)=>a.mag-b.mag);const negative=[];for(const s of quiet){if(picked.every(p=>Math.hypot(p.x-s.x,p.y-s.y)>3)&&negative.every(p=>Math.hypot(p.x-s.x,p.y-s.y)>5)){s.weight=.38;negative.push(s);if(negative.length>=NEGATIVE_SAMPLES)break}}
  return{samples:picked.concat(negative),verifySamples:verify,positiveCount:picked.length,negativeCount:negative.length,texture:f.p90};
}
function template(samples,radius,angle){
  const a=rad(angle),c=Math.cos(a),s=Math.sin(a);return samples.map(p=>{const rx=p.nx*c-p.ny*s,ry=p.nx*s+p.ny*c,e=p.theta+a;return{dx:rx*radius,dy:ry*radius,c2:Math.cos(2*e),s2:Math.sin(2*e),weight:p.weight,negative:!!p.negative}})
}
function scoreAt(field,cx,cy,tpl){
  let sum=0,weight=0,covered=0;for(const p of tpl){const x=Math.round(cx+p.dx),y=Math.round(cy+p.dy);if(x<1||y<1||x>=field.w-1||y>=field.h-1)continue;const i=y*field.w+x,strength=clamp(field.mag[i]/field.p90,0,1);if(p.negative){sum+=p.weight*(1-strength);weight+=p.weight;covered++;continue}const align=.5+.5*(field.cos2[i]*p.c2+field.sin2[i]*p.s2);sum+=p.weight*strength*align;weight+=p.weight;covered++}
  return covered>=Math.ceil(tpl.length*.82)&&weight?sum/weight:-1;
}
function pushTop(top,item,limit=28){if(item.score<0)return;top.push(item);top.sort((a,b)=>b.score-a.score);if(top.length>limit)top.length=limit}
function distinctMargin(top,best,minDistance){const second=top.find(x=>x!==best&&Math.hypot(x.x-best.x,x.y-best.y)>=minDistance);return{second,margin:second?best.score-second.score:best.score}}
async function coarseMatch(samples,cfg){
  const atlas=await coarseAtlas(cfg),field=atlas.field,stride=cfg.width===32768?8:5,radii=cfg.width===32768?[6,9,13,18,25,34]:[5,8,12,17,24],angles=[0,45,90,135,180,225,270,315],templates=[];
  for(const r of radii)for(const a of angles)templates.push({radius:r,angle:a,tpl:template(samples,r,a)});
  const topByRadius=new Map(radii.map(r=>[r,[]]));
  for(let y=stride;y<field.h-stride;y+=stride){
    for(let x=stride;x<field.w-stride;x+=stride){
      const target=pixelToGlobal(x*atlas.factor,y*atlas.factor,COARSE_Z,cfg);if(!inGlobalBounds(target))continue;
      for(const r of radii){
        let scaleBest=null;
        for(const t of templates){if(t.radius!==r)continue;const score=scoreAt(field,x,y,t.tpl);if(!scaleBest||score>scaleBest.score)scaleBest={x,y,radius:t.radius,angle:t.angle,score}}
        if(scaleBest)pushTop(topByRadius.get(r),scaleBest,48);
      }
    }
    if(y%(stride*5)===0)await sleep(0);
  }
  const top=[...topByRadius.values()].flat().sort((a,b)=>b.score-a.score);
  if(!top.length)return null;
  const seeds=[];
  const perRadius=new Map();
  for(const item of top){
    const used=perRadius.get(item.radius) || 0;if(used>=4)continue;
    if(seeds.every(seed=>Math.hypot(item.x-seed.x,item.y-seed.y)>=Math.max(18,Math.min(item.radius,seed.radius)*.6)||Math.abs(Math.log(item.radius/seed.radius))>=.18)){
      seeds.push(item);perRadius.set(item.radius,used+1);if(seeds.length>=24)break;
    }
  }
  const hypotheses=[];
  for(const seed of seeds){
    const refineTop=[];
    for(let y=seed.y-stride*1.5;y<=seed.y+stride*1.5;y+=2)for(let x=seed.x-stride*1.5;x<=seed.x+stride*1.5;x+=2){
      const target=pixelToGlobal(x*atlas.factor,y*atlas.factor,COARSE_Z,cfg);if(!inGlobalBounds(target))continue;
      for(const rf of [.82,.91,1,1.09,1.18])for(const da of [-22.5,-15,-7.5,0,7.5,15,22.5]){
        const radius=seed.radius*rf,angle=angleNorm(seed.angle+da),score=scoreAt(field,x,y,template(samples,radius,angle));pushTop(refineTop,{x,y,radius,angle,score},20);
      }
    }
    const best=refineTop[0]||seed;hypotheses.push({...best,rawScore:seed.score});await sleep(0);
  }
  hypotheses.sort((a,b)=>b.score-a.score);
  const best=hypotheses[0],dm=distinctMargin(hypotheses,best,Math.max(20,best.radius*.65));
  return{...best,margin:dm.margin,atlas,hypotheses};
}
async function fineFieldAround(cfg,centerX,centerY,radius,search=120){
  const half=radius*1.18+search+40,minX=Math.floor((centerX-half)/256),maxX=Math.floor((centerX+half)/256),minY=Math.floor((centerY-half)/256),maxY=Math.floor((centerY+half)/256),grid=await loadTileGrid(cfg,FINE_Z,minX,minY,maxX,maxY);return{...grid,field:gradientField(grid.canvas),centerLocalX:centerX-grid.minX*256,centerLocalY:centerY-grid.minY*256};
}
async function fineMatch(samples,cfg,pred,search=120,step=8){
  const atlasFactor=pred.atlas?.factor??(cfg.width===32768?4:2),scale=atlasFactor*(2**(FINE_Z-COARSE_Z)),centerX=pred.x*scale,centerY=pred.y*scale,radius=pred.radius*scale,fine=await fineFieldAround(cfg,centerX,centerY,radius,search),top=[];
  const angleSteps=[-15,-10,-5,0,5,10,15],radiusSteps=[.86,.93,1,1.07,1.14];
  for(let y=fine.centerLocalY-search;y<=fine.centerLocalY+search;y+=step){for(let x=fine.centerLocalX-search;x<=fine.centerLocalX+search;x+=step){for(const rf of radiusSteps)for(const da of angleSteps){const rr=radius*rf,aa=angleNorm(pred.angle+da),score=scoreAt(fine.field,x,y,template(samples,rr,aa));pushTop(top,{x,y,radius:rr,angle:aa,score},30)}}await sleep(0)}
  if(!top.length)return null;let best=top[0],dm=distinctMargin(top,best,Math.max(24,best.radius*.12)),ref=[];
  for(let y=best.y-12;y<=best.y+12;y+=2)for(let x=best.x-12;x<=best.x+12;x+=2)for(const rf of [.94,.97,1,1.03,1.06])for(const da of [-5,-2.5,0,2.5,5]){const rr=best.radius*rf,aa=angleNorm(best.angle+da),score=scoreAt(fine.field,x,y,template(samples,rr,aa));pushTop(ref,{x,y,radius:rr,angle:aa,score},20)}
  if(ref.length)best=ref[0];const globalX=best.x+fine.minX*256,globalY=best.y+fine.minY*256;return{...best,globalX,globalY,margin:dm.margin,fieldGrid:fine,scaleFromCoarse:scale};
}
function verifyAt(field,cx,cy,radius,angle,samples){
  if(!samples?.length)return{structure:-1,ncc:-1};const a=rad(angle),c=Math.cos(a),sn=Math.sin(a),ca=Math.cos(2*a),sa=Math.sin(2*a);let sum=0,weight=0,covered=0,n=0,sumS=0,sumR=0,sumSS=0,sumRR=0,sumSR=0;
  for(const p of samples){
    const rx=p.nx*c-p.ny*sn,ry=p.nx*sn+p.ny*c,x=Math.round(cx+rx*radius),y=Math.round(cy+ry*radius);if(x<1||y<1||x>=field.w-1||y>=field.h-1)continue;
    const i=y*field.w+x,ref=clamp(field.mag[i]/field.p90,0,1),src=p.strength,strengthSimilarity=1-Math.min(1,Math.abs(ref-src)*1.25),rc2=p.c2*ca-p.s2*sa,rs2=p.s2*ca+p.c2*sa,orient=.5+.5*(field.cos2[i]*rc2+field.sin2[i]*rs2),joint=Math.min(ref,src),quiet=1-Math.max(ref,src),structure=joint*orient+quiet,w=.45+.55*Math.max(ref,src),sg=p.gray,rg=field.gray[i];
    sum+=w*(.68*strengthSimilarity+.32*structure);weight+=w;covered++;n++;sumS+=sg;sumR+=rg;sumSS+=sg*sg;sumRR+=rg*rg;sumSR+=sg*rg;
  }
  if(covered<Math.ceil(samples.length*.82)||!weight||n<24)return{structure:-1,ncc:-1};
  const num=n*sumSR-sumS*sumR,den=Math.sqrt(Math.max(1e-9,(n*sumSS-sumS*sumS)*(n*sumRR-sumR*sumR))),corr=clamp(num/den,-1,1);
  return{structure:sum/weight,ncc:.5+.5*corr,corr};
}
async function globalMatch(info,cfg){
  const samples=info.samples,coarseSearch=await coarseMatch(samples,cfg);if(!coarseSearch)return{coarse:null,fine:null};
  const finals=[];
  for(const hypothesis of (coarseSearch.hypotheses||[coarseSearch]).slice(0,COARSE_BEAM)){
    if(hypothesis.score<coarseSearch.score-.16)continue;
    const fine=await fineMatch(samples,cfg,{...hypothesis,atlas:coarseSearch.atlas},220,12);
    if(fine){const verification=verifyAt(fine.fieldGrid.field,fine.x,fine.y,fine.radius,fine.angle,info.verifySamples),verifyScore=verification.structure,nccScore=verification.ncc,combined=.20*fine.score+.35*verifyScore+.45*nccScore;finals.push({fine,hypothesis,verifyScore,nccScore,combined})}await sleep(0);
  }
  if(!finals.length)return{coarse:coarseSearch,fine:null};
  finals.sort((a,b)=>b.combined-a.combined);
  const winner=finals[0],second=finals.find(item=>Math.hypot(item.fine.globalX-winner.fine.globalX,item.fine.globalY-winner.fine.globalY)>=Math.max(96,winner.fine.radius*.35)),verificationMargin=second?winner.combined-second.combined:winner.combined;
  const fine={...winner.fine,localMargin:winner.fine.margin,beamMargin:verificationMargin,verificationMargin,verifyScore:winner.verifyScore,nccScore:winner.nccScore,combinedScore:winner.combined,margin:Math.min(winner.fine.margin,verificationMargin)};
  const coarse={...winner.hypothesis,margin:coarseSearch.margin,atlas:coarseSearch.atlas,beamResolved:true};
  return{coarse,fine,alternatives:finals.map(item=>({x:item.fine.globalX,y:item.fine.globalY,angle:item.fine.angle,edgeScore:item.fine.score,verifyScore:item.verifyScore,nccScore:item.nccScore,combinedScore:item.combined}))};
}
async function localFineMatch(samples,cfg,last,search=160){
  const pred={x:last.globalX/last.scaleFromCoarse,y:last.globalY/last.scaleFromCoarse,radius:last.radius/last.scaleFromCoarse,angle:last.angle,atlas:{factor:last.scaleFromCoarse/(2**(FINE_Z-COARSE_Z))}};return fineMatch(samples,cfg,pred,search)
}
function motionMatrixFor(match,cfg,roiSize,target){
  const v=VISION.state(),z=v.referenceZoom??11,p0=VISION.project(target.lat,target.lng,z),tx=pixelToGlobal(match.globalX+1,match.globalY,FINE_Z,cfg),ty=pixelToGlobal(match.globalX,match.globalY+1,FINE_Z,cfg),px=tx&&VISION.project(tx.lat,tx.lng,z),py=ty&&VISION.project(ty.lat,ty.lng,z);if(!p0||!px||!py)return null;
  const j00=px.x-p0.x,j10=px.y-p0.y,j01=py.x-p0.x,j11=py.y-p0.y,k=match.radius/(roiSize/2),a=rad(match.angle),c=Math.cos(a),s=Math.sin(a);
  return[(j00*c+j01*s)*k,(-j00*s+j01*c)*k,(j10*c+j11*s)*k,(-j10*s+j11*c)*k];
}
function matchGate(coarse,fine,roiInfo,cfg){
  if(!coarse)return'no-coarse-match';if(coarse.score<.38)return`coarse-score ${coarse.score.toFixed(3)}`;if(coarse.margin<.012&&!coarse.beamResolved)return`coarse-ambiguous ${coarse.margin.toFixed(3)}`;
  if(!fine)return'no-fine-match';if(fine.score<.50)return`fine-score ${fine.score.toFixed(3)}`;if(Number.isFinite(fine.verifyScore)&&fine.verifyScore<.56)return`verify-score ${fine.verifyScore.toFixed(3)}`;if(Number.isFinite(fine.nccScore)&&fine.nccScore<.52)return`ncc-score ${fine.nccScore.toFixed(3)}`;if(Number.isFinite(fine.verificationMargin)&&fine.verificationMargin<.018)return`verify-ambiguous ${fine.verificationMargin.toFixed(3)}`;if(fine.margin<.018)return`fine-ambiguous ${fine.margin.toFixed(3)}`;if(roiInfo.texture<8)return`low-roi-texture ${roiInfo.texture.toFixed(1)}`;if(!cfg.geometryOk)return`geometry-residual p95=${cfg.p95.toFixed(6)}`;return'';
}
async function registerFrame(cfg,mapId){
  const roiCanvas=VISION.captureRoi(192);if(!roiCanvas)return{reason:'capture-frame-unavailable'};const info=roiSamples(roiCanvas);if((info.positiveCount??info.samples.length)<24)return{reason:`insufficient-features ${info.positiveCount??info.samples.length}`,info};
  let coarse=null,fine=null;
  if(state.mode==='local'&&state.last){fine=await localFineMatch(info.samples,cfg,state.last,170);if(fine){coarse={score:state.coarseScore,margin:state.coarseMargin,beamResolved:true}}}
  else if(state.mode==='confirm'&&state.pending?.match){fine=await localFineMatch(info.samples,cfg,state.pending.match,150);coarse={score:state.pending.coarseScore,margin:state.pending.coarseMargin,beamResolved:true}}
  else{const global=await globalMatch(info,cfg);coarse=global.coarse;fine=global.fine}
  if(coarse){state.coarseScore=coarse.score;state.coarseMargin=coarse.margin||0}if(fine){state.fineScore=fine.score;state.fineMargin=fine.margin||0;state.angle=fine.angle;state.radius=fine.radius}
  const reason=matchGate(coarse,fine,info,cfg);if(reason)return{reason,coarse,fine,info};
  const target=pixelToGlobal(fine.globalX,fine.globalY,FINE_Z,cfg);if(!target||!inGlobalBounds(target)||!VISION.contains(target.lat,target.lng))return{reason:'target-out-of-map-bounds',coarse,fine,info};
  return{reason:'',coarse,fine,info,target,mapId};
}
function confirmDistance(a,b){return Math.hypot(a.globalX-b.globalX,a.globalY-b.globalY)}
async function tick(){
  if(state.busy)return;installDiag();const vs=VISION.state();if(!vs.active){state.mode='idle';state.pending=null;state.last=null;setDiag('OFF','capture-inactive');return}
  const mapId=currentMapId(),cfg=MAPS[mapId];if(!cfg){setDiag('HOLD','unsupported-map');return}
  if(state.lastMapId!==mapId){state.lastMapId=mapId;state.mode='global';state.pending=null;state.last=null;state.localFailures=0}
  state.busy=true;state.lastRunAt=Date.now();setDiag(state.mode==='local'?'LOCAL FIX':'SEARCH','registering public map raster');
  try{
    const result=await registerFrame(cfg,mapId);if(result.reason){if(state.mode==='local'){state.localFailures++;if(state.localFailures>=3){state.mode='global';state.last=null;state.pending=null}}setDiag('HOLD',result.reason);return}
    state.absolute=result.target;
    if(state.mode==='global'||state.mode==='idle'){
      state.pending={match:{...result.fine,coarseScore:result.coarse.score,coarseMargin:result.coarse.margin},coarseScore:result.coarse.score,coarseMargin:result.coarse.margin,target:result.target,at:Date.now()};state.mode='confirm';setDiag('CONFIRM 1/2','high-confidence candidate; waiting second independent frame');return;
    }
    if(state.mode==='confirm'){
      if(!state.pending?.match||confirmDistance(state.pending.match,result.fine)>180){state.pending={match:{...result.fine,coarseScore:state.coarseScore,coarseMargin:state.coarseMargin},coarseScore:state.coarseScore,coarseMargin:state.coarseMargin,target:result.target,at:Date.now()};setDiag('CONFIRM 1/2','candidate moved beyond confirmation gate');return}
    }
    const roiSize=vs.roi?.size||192,matrix=motionMatrixFor(result.fine,cfg,roiSize,result.target),applied=VISION.applyAbsoluteFix({lat:result.target.lat,lng:result.target.lng,motionMatrix:matrix,source:'dashen-registration'});
    if(!applied.ok){setDiag('HOLD',`apply-failed ${applied.reason}`);return}
    state.last={...result.fine,scaleFromCoarse:result.fine.scaleFromCoarse};state.pending=null;state.mode='local';state.localFailures=0;state.fixes++;state.absolute=result.target;setDiag('ABS FIX',matrix?'marker corrected · optical flow auto-calibrated':'marker corrected · manual motion calibration fallback');
  }catch(error){state.lastError=String(error?.message||error);state.mode=state.last?'local':'global';setDiag('HOLD',`registration-error ${state.lastError}`);console.warn('[WWMSync absolute]',error)}finally{state.busy=false}
}
async function selfTest(){
  const cfg=MAPS[1],atlas=await coarseAtlas(cfg),candidates=[];for(let y=60;y<atlas.small.height-60;y+=20)for(let x=60;x<atlas.small.width-60;x+=20){const t=pixelToGlobal(x*atlas.factor,y*atlas.factor,COARSE_Z,cfg);if(inGlobalBounds(t))candidates.push({x,y})}if(!candidates.length)return{ok:false,reason:'no-valid-center'};
  const center=candidates[Math.floor(candidates.length/2)],radius=18,angle=37,fullX=center.x*atlas.factor,fullY=center.y*atlas.factor,k=radius*atlas.factor/96,c=document.createElement('canvas');c.width=192;c.height=192;const ctx=c.getContext('2d',{alpha:false});ctx.fillStyle='#111';ctx.fillRect(0,0,192,192);ctx.save();ctx.translate(96,96);ctx.rotate(-rad(angle));ctx.scale(1/k,1/k);ctx.translate(-fullX,-fullY);ctx.drawImage(atlas.full,0,0);ctx.restore();
  const info=roiSamples(c),match=await globalMatch(info,cfg),fine=match.fine,coarse=match.coarse,scale=fine?.scaleFromCoarse||1,actual=fine?{x:fine.globalX/scale,y:fine.globalY/scale,radius:fine.radius/scale,angle:fine.angle}:null,error=actual?Math.hypot(actual.x-center.x,actual.y-center.y):Infinity,rotationError=actual?Math.min(angleDiff(actual.angle,angle),angleDiff(angleNorm(actual.angle+180),angle)):Infinity;
  return{ok:!!actual&&error<=8&&rotationError<=25,error,rotationError,score:fine?.score??-1,verifyScore:fine?.verifyScore??-1,nccScore:fine?.nccScore??-1,combinedScore:fine?.combinedScore??-1,margin:fine?.margin??0,localMargin:fine?.localMargin??0,beamMargin:fine?.beamMargin??0,coarseScore:coarse?.score??-1,coarseMargin:coarse?.margin??0,expected:center,actual,features:info.samples.length,verifyFeatures:info.verifySamples.length,positiveFeatures:info.positiveCount??0,negativeFeatures:info.negativeCount??0,alternatives:match.alternatives??[]};
}
window.__WWMSYNC_ABSOLUTE_DIAGNOSTICS__=()=>({mode:state.mode,status:state.status,reason:state.reason,coarseScore:state.coarseScore,coarseMargin:state.coarseMargin,fineScore:state.fineScore,fineMargin:state.fineMargin,angle:state.angle,radius:state.radius,absolute:state.absolute,fixes:state.fixes,lastRunAt:state.lastRunAt,lastError:state.lastError,mapId:state.lastMapId,geometryEnabled:state.lastMapId?MAPS[state.lastMapId]?.geometryOk:null});
window.__WWMSYNC_ABSOLUTE_SELFTEST__=selfTest;
installDiag();setInterval(()=>void tick(),CHECK_MS);setTimeout(()=>void tick(),1500);document.getElementById('mapSelect')?.addEventListener('change',()=>{state.mode='global';state.pending=null;state.last=null;state.lastMapId=null;setTimeout(()=>void tick(),250)});
})();
