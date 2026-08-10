(()=>{
'use strict';
const SCALE_KEY='wwmsync:vision-scale';
const ROI_KEY='wwmsync:vision-roi';
const ORIENTATION_KEY='wwmsync:vision-orientation';
const SAMPLE_MS=250;
const WORK=192;
const MIN_MARKER_PX=.05;
const TEXT={
  vi:{title:'GFN Vision Sync',intro:'Chia sẻ cửa sổ GeForce NOW. WWMSync chỉ đọc pixel minimap cục bộ trong tab này; không upload video, không đọc memory/process/file/packet và không cần PowerShell companion.',start:'Bắt đầu Vision Sync',stop:'Dừng',roiHint:'ROI mặc định ở minimap góc trên-trái. Bấm đúng tâm minimap trong preview nếu cần chỉnh.',anchor:'Đặt vị trí hiện tại trên map',anchorHint:'Bấm nút rồi click đúng vị trí nhân vật hiện tại trên WWMSync map một lần.',confidence:'Tin cậy',accepted:'Frame có marker delta',held:'Frame giữ',advanced:'Tinh chỉnh',roiSize:'Kích thước ROI',scale:'Tỉ lệ di chuyển',orientation:'Bù hướng minimap',diagnostics:'Motion diagnostics',rawDelta:'Raw terrain dx/dy',correctedDelta:'Corrected player dx/dy',cumulative:'Cumulative displacement',markerDelta:'Marker Δ lat/lng',diagConfidence:'Confidence',holdReason:'HOLD reason',off:'Vision Sync đang tắt.',ready:'Đã nhận screen capture. Kiểm tra ROI rồi đặt anchor trên map.',clickMap:'Click vị trí hiện tại của nhân vật trên map.',tracking:'Đang theo dõi minimap và cập nhật marker.',hold:'Đang giữ marker; xem HOLD reason bên dưới.',unsupported:'Trình duyệt này không hỗ trợ screen capture cần thiết.',denied:'Screen capture bị hủy hoặc không được cấp quyền.',ended:'Screen capture đã kết thúc.',anchorSet:'Anchor đã đặt. Vision Sync đang theo dõi.',roiSelected:'Đã cập nhật vùng minimap.'},
  en:{title:'GFN Vision Sync',intro:'Share the GeForce NOW window. WWMSync reads minimap pixels locally in this tab only; it does not upload video, read game memory/process/files/packets, or require a PowerShell companion.',start:'Start Vision Sync',stop:'Stop',roiHint:'The default ROI targets the upper-left minimap. Click the minimap center in the preview if it needs adjustment.',anchor:'Set current position on map',anchorHint:'Press the button, then click your character’s current position on the WWMSync map once.',confidence:'Confidence',accepted:'Frames with marker delta',held:'Held',advanced:'Tuning',roiSize:'ROI size',scale:'Movement scale',orientation:'Minimap orientation',diagnostics:'Motion diagnostics',rawDelta:'Raw terrain dx/dy',correctedDelta:'Corrected player dx/dy',cumulative:'Cumulative displacement',markerDelta:'Marker Δ lat/lng',diagConfidence:'Confidence',holdReason:'HOLD reason',off:'Vision Sync is off.',ready:'Screen capture is ready. Check the ROI, then set the map anchor.',clickMap:'Click your current character position on the map.',tracking:'Tracking the minimap and updating the marker.',hold:'Holding the marker; see HOLD reason below.',unsupported:'This browser does not support the required screen capture API.',denied:'Screen capture was cancelled or permission was not granted.',ended:'Screen capture ended.',anchorSet:'Anchor set. Vision Sync is tracking.',roiSelected:'Minimap region updated.'}
};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const loadNumber=(key,fallback,min,max)=>{const v=Number(localStorage.getItem(key));return Number.isFinite(v)?clamp(v,min,max):fallback};
const state={
  stream:null,video:null,previewRaf:0,timer:0,workCanvas:null,workCtx:null,
  roiX:null,roiY:null,roiFraction:loadNumber(ROI_KEY,.2,.12,.34),scale:loadNumber(SCALE_KEY,1,.25,6),orientation:loadNumber(ORIENTATION_KEY,0,-180,180),
  previous:null,tracking:false,anchorPoint:null,anchorLatLng:null,referenceZoom:11,marker:null,mapClickHandler:null,
  accumX:0,accumY:0,accepted:0,held:0,lowFrames:0,confidence:0,statusKind:'off',statusKey:'off',
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
  if(el.visionScaleValue)el.visionScaleValue.textContent=`${state.scale.toFixed(2)}×`;
  if(el.visionOrientationValue)el.visionOrientationValue.textContent=`${Math.round(state.orientation)}°`;
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
  state.anchorPoint=null;state.anchorLatLng=null;state.previous=null;state.tracking=false;state.accumX=0;state.accumY=0;resetMotionDiagnostics('anchor-reset');
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
    state.accumX=0;state.accumY=0;state.previous=null;state.tracking=true;state.accepted=0;state.held=0;state.lowFrames=0;state.confidence=0;
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
    state.stream=stream;state.video=video;state.previous=null;state.tracking=false;state.accepted=0;state.held=0;state.confidence=0;state.roiX=video.videoWidth*.14;state.roiY=video.videoHeight*.17;resetMotionDiagnostics('capture-ready');
    stream.getVideoTracks()[0]?.addEventListener('ended',()=>stop('ended'),{once:true});state.previewRaf=requestAnimationFrame(preview);state.timer=setInterval(sample,SAMPLE_MS);refresh();setStatus('ready','ready');
  }catch(error){console.warn('[WWMSync] Vision capture',error);setStatus('error',error?.name==='NotAllowedError'?'denied':'unsupported')}
}
function stop(reason='user'){
  clearMapClick();if(state.timer)clearInterval(state.timer);state.timer=0;if(state.previewRaf)cancelAnimationFrame(state.previewRaf);state.previewRaf=0;
  const stream=state.stream;state.stream=null;if(stream)for(const track of stream.getTracks())if(track.readyState!=='ended')track.stop();if(state.video){state.video.srcObject=null;state.video=null}
  if(state.marker){state.marker.remove();state.marker=null}state.previous=null;state.tracking=false;state.anchorPoint=null;state.anchorLatLng=null;state.accumX=0;state.accumY=0;state.confidence=0;resetMotionDiagnostics(reason==='ended'?'capture-ended':'stopped');refresh();setStatus('off',reason==='ended'?'ended':'off');
}
window.__WWMSYNC_VISION_DIAGNOSTICS__=()=>({rawDx:state.rawDx,rawDy:state.rawDy,correctedDx:state.correctedDx,correctedDy:state.correctedDy,accumX:state.accumX,accumY:state.accumY,markerDeltaLat:state.markerDeltaLat,markerDeltaLng:state.markerDeltaLng,confidence:state.confidence,holdReason:state.holdReason,accepted:state.accepted,held:state.held,referenceZoom:state.referenceZoom,orientation:state.orientation,markerLatLng:state.marker?.getLatLng?.()||null});
el.visionStartButton.addEventListener('click',()=>void start());el.visionStopButton.addEventListener('click',()=>stop('user'));el.visionAnchorButton.addEventListener('click',requestAnchor);el.visionPreview.addEventListener('click',selectRoi);
el.visionRoiSize.addEventListener('input',()=>{state.roiFraction=clamp(Number(el.visionRoiSize.value),.12,.34);localStorage.setItem(ROI_KEY,String(state.roiFraction));state.previous=null;state.holdReason='roi-baseline-reset';metrics()});
el.visionScale.addEventListener('input',()=>{state.scale=clamp(Number(el.visionScale.value),.25,6);localStorage.setItem(SCALE_KEY,String(state.scale));metrics()});
el.visionOrientation?.addEventListener('input',()=>{state.orientation=clamp(Number(el.visionOrientation.value),-180,180);localStorage.setItem(ORIENTATION_KEY,String(state.orientation));metrics()});
document.getElementById('languageSelect')?.addEventListener('change',()=>queueMicrotask(localize));new MutationObserver(localize).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});window.addEventListener('beforeunload',()=>{if(state.stream)stop('user')});
refresh();localize();
})();
