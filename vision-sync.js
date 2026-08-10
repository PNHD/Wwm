(()=>{
'use strict';
const SCALE_KEY='wwmsync:vision-scale';
const ROI_KEY='wwmsync:vision-roi';
const SAMPLE_MS=250;
const WORK=192;
const TEXT={
  vi:{title:'GFN Vision Sync',intro:'Chia sẻ cửa sổ GeForce NOW. WWMSync chỉ đọc pixel minimap cục bộ trong tab này; không upload video, không đọc memory/process/file/packet và không cần PowerShell companion.',start:'Bắt đầu Vision Sync',stop:'Dừng',roiHint:'ROI mặc định ở minimap góc trên-trái. Bấm đúng tâm minimap trong preview nếu cần chỉnh.',anchor:'Đặt vị trí hiện tại trên map',anchorHint:'Bấm nút rồi click đúng vị trí nhân vật hiện tại trên WWMSync map một lần.',confidence:'Tin cậy',accepted:'Frame nhận',held:'Frame giữ',advanced:'Tinh chỉnh',roiSize:'Kích thước ROI',scale:'Tỉ lệ di chuyển',off:'Vision Sync đang tắt.',ready:'Đã nhận screen capture. Kiểm tra ROI rồi đặt anchor trên map.',clickMap:'Click vị trí hiện tại của nhân vật trên map.',tracking:'Đang theo dõi minimap.',hold:'Đang giữ vị trí vì frame có độ tin cậy thấp.',unsupported:'Trình duyệt này không hỗ trợ screen capture cần thiết.',denied:'Screen capture bị hủy hoặc không được cấp quyền.',ended:'Screen capture đã kết thúc.',anchorSet:'Anchor đã đặt. Vision Sync đang theo dõi.',roiSelected:'Đã cập nhật vùng minimap.'},
  en:{title:'GFN Vision Sync',intro:'Share the GeForce NOW window. WWMSync reads minimap pixels locally in this tab only; it does not upload video, read game memory/process/files/packets, or require a PowerShell companion.',start:'Start Vision Sync',stop:'Stop',roiHint:'The default ROI targets the upper-left minimap. Click the minimap center in the preview if it needs adjustment.',anchor:'Set current position on map',anchorHint:'Press the button, then click your character’s current position on the WWMSync map once.',confidence:'Confidence',accepted:'Accepted',held:'Held',advanced:'Tuning',roiSize:'ROI size',scale:'Movement scale',off:'Vision Sync is off.',ready:'Screen capture is ready. Check the ROI, then set the map anchor.',clickMap:'Click your current character position on the map.',tracking:'Tracking the minimap.',hold:'Holding position because the current frame has low confidence.',unsupported:'This browser does not support the required screen capture API.',denied:'Screen capture was cancelled or permission was not granted.',ended:'Screen capture ended.',anchorSet:'Anchor set. Vision Sync is tracking.',roiSelected:'Minimap region updated.'}
};
const clamp=(v,min,max)=>Math.max(min,Math.min(max,v));
const loadNumber=(key,fallback,min,max)=>{const v=Number(localStorage.getItem(key));return Number.isFinite(v)?clamp(v,min,max):fallback};
const state={stream:null,video:null,previewRaf:0,timer:0,workCanvas:null,workCtx:null,roiX:null,roiY:null,roiFraction:loadNumber(ROI_KEY,.2,.12,.34),scale:loadNumber(SCALE_KEY,1,.25,6),previous:null,tracking:false,anchorPoint:null,referenceZoom:13,marker:null,mapClickHandler:null,accumX:0,accumY:0,accepted:0,held:0,lowFrames:0,confidence:0,statusKind:'off',statusKey:'off'};
let mapRef=null;
const ids=['visionStartButton','visionStopButton','visionAnchorButton','visionBadge','visionStatus','visionPreview','visionSetup','visionConfidence','visionAccepted','visionHeld','visionRoiSize','visionRoiValue','visionScale','visionScaleValue','sidebar'];
const el=Object.fromEntries(ids.map(id=>[id,document.getElementById(id)]));
const lang=()=>document.documentElement.lang==='en'||document.getElementById('languageSelect')?.value==='en'?'en':'vi';
const tx=key=>TEXT[lang()][key]||TEXT.en[key]||key;
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
  el.visionConfidence.textContent=`${Math.round(clamp(state.confidence,0,1)*100)}%`;
  el.visionAccepted.textContent=String(state.accepted);el.visionHeld.textContent=String(state.held);
  el.visionRoiValue.textContent=`${Math.round(state.roiFraction*100)}%`;el.visionScaleValue.textContent=`${state.scale.toFixed(2)}×`;
}
function localize(){
  document.querySelectorAll('[data-vision-i18n]').forEach(node=>node.textContent=tx(node.dataset.visionI18n));
  setStatus(state.statusKind,state.statusKey);metrics();
}
function refresh(){
  const active=!!state.stream;
  el.visionStartButton.disabled=active;el.visionStopButton.disabled=!active;el.visionAnchorButton.disabled=!active||!mapRef;
  el.visionSetup.classList.toggle('hidden',!active);el.visionRoiSize.value=String(state.roiFraction);el.visionScale.value=String(state.scale);metrics();
}
function clearMapClick(){
  if(state.mapClickHandler&&mapRef)mapRef.off('click',state.mapClickHandler);
  state.mapClickHandler=null;el.visionAnchorButton.classList.remove('armed');
}
function resetAnchor(){
  clearMapClick();if(state.marker){state.marker.remove();state.marker=null}
  state.anchorPoint=null;state.previous=null;state.tracking=false;state.accumX=0;state.accumY=0;
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
    state.referenceZoom=Number.isFinite(map.getMaxZoom())?map.getMaxZoom():13;state.anchorPoint=map.project(event.latlng,state.referenceZoom);
    state.accumX=0;state.accumY=0;state.previous=null;state.tracking=true;state.accepted=0;state.held=0;state.lowFrames=0;state.confidence=0;
    markerAt(event.latlng);setStatus('tracking','anchorSet');metrics();
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
  state.roiX=clamp((event.clientX-rect.left)/rect.width,0,1)*state.video.videoWidth;state.roiY=clamp((event.clientY-rect.top)/rect.height,0,1)*state.video.videoHeight;state.previous=null;
  setStatus(state.tracking?'tracking':'ready',state.tracking?'tracking':'roiSelected');
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
  return{dx,dy,confidence,accepted:best.score>=.82&&current.energy>=5.5&&Math.hypot(dx,dy)<=5.5};
}
function moveMarker(dx,dy,sourceScale){
  if(!state.anchorPoint||!state.marker||!mapRef)return;const px=(-dx)*sourceScale*state.scale,py=(-dy)*sourceScale*state.scale;state.accumX+=px;state.accumY+=py;
  const point=window.L.point(state.anchorPoint.x+state.accumX,state.anchorPoint.y+state.accumY),latlng=mapRef.unproject(point,state.referenceZoom),bounds=mapRef.options.maxBounds;
  if(bounds&&!bounds.contains(latlng)){state.accumX-=px;state.accumY-=py;return}state.marker.setLatLng(latlng);
}
function sample(){
  if(!state.tracking||!state.stream)return;const current=features();if(!current)return;if(!state.previous){state.previous=current;return}
  const motion=estimate(state.previous,current);state.confidence=motion.confidence;
  if(motion.accepted){moveMarker(motion.dx,motion.dy,current.sourceScale);state.accepted++;state.lowFrames=0;state.previous=current;setStatus('tracking','tracking')}
  else{state.held++;state.lowFrames++;setStatus('hold','hold');if(state.lowFrames>=3){state.previous=current;state.lowFrames=0}}
  metrics();
}
async function start(){
  if(state.stream)return;if(!navigator.mediaDevices?.getDisplayMedia){setStatus('error','unsupported');return}
  try{
    const stream=await navigator.mediaDevices.getDisplayMedia({video:true,audio:false}),video=document.createElement('video');video.muted=true;video.playsInline=true;video.srcObject=stream;await video.play();
    if(!video.videoWidth)await new Promise(resolve=>video.addEventListener('loadedmetadata',resolve,{once:true}));
    state.stream=stream;state.video=video;state.previous=null;state.tracking=false;state.accepted=0;state.held=0;state.confidence=0;state.roiX=video.videoWidth*.14;state.roiY=video.videoHeight*.17;
    stream.getVideoTracks()[0]?.addEventListener('ended',()=>stop('ended'),{once:true});state.previewRaf=requestAnimationFrame(preview);state.timer=setInterval(sample,SAMPLE_MS);refresh();setStatus('ready','ready');
  }catch(error){console.warn('[WWMSync] Vision capture',error);setStatus('error',error?.name==='NotAllowedError'?'denied':'unsupported')}
}
function stop(reason='user'){
  clearMapClick();if(state.timer)clearInterval(state.timer);state.timer=0;if(state.previewRaf)cancelAnimationFrame(state.previewRaf);state.previewRaf=0;
  const stream=state.stream;state.stream=null;if(stream)for(const track of stream.getTracks())if(track.readyState!=='ended')track.stop();if(state.video){state.video.srcObject=null;state.video=null}
  if(state.marker){state.marker.remove();state.marker=null}state.previous=null;state.tracking=false;state.anchorPoint=null;state.accumX=0;state.accumY=0;state.confidence=0;refresh();setStatus('off',reason==='ended'?'ended':'off');
}
el.visionStartButton.addEventListener('click',()=>void start());el.visionStopButton.addEventListener('click',()=>stop('user'));el.visionAnchorButton.addEventListener('click',requestAnchor);el.visionPreview.addEventListener('click',selectRoi);
el.visionRoiSize.addEventListener('input',()=>{state.roiFraction=clamp(Number(el.visionRoiSize.value),.12,.34);localStorage.setItem(ROI_KEY,String(state.roiFraction));state.previous=null;metrics()});
el.visionScale.addEventListener('input',()=>{state.scale=clamp(Number(el.visionScale.value),.25,6);localStorage.setItem(SCALE_KEY,String(state.scale));metrics()});
document.getElementById('languageSelect')?.addEventListener('change',()=>queueMicrotask(localize));new MutationObserver(localize).observe(document.documentElement,{attributes:true,attributeFilter:['lang']});window.addEventListener('beforeunload',()=>{if(state.stream)stop('user')});
refresh();localize();
})();
