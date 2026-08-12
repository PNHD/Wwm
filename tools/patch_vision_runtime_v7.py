from pathlib import Path

path=Path('vision-sync.js')
text=path.read_text('utf-8')
old="const loadNumber=(key,fallback,min,max)=>{const v=Number(localStorage.getItem(key));return Number.isFinite(v)?clamp(v,min,max):fallback};"
new="const loadNumber=(key,fallback,min,max)=>{const raw=localStorage.getItem(key);if(raw===null||raw==='')return fallback;const v=Number(raw);return Number.isFinite(v)?clamp(v,min,max):fallback};"
if old not in text:
    raise SystemExit('loadNumber target not found')
text=text.replace(old,new,1)
old_announce="function announceRoiChange(reason){state.previous=null;state.holdReason=reason;window.dispatchEvent(new CustomEvent('wwmsync:vision:roi-ready',{detail:{reason}}));metrics()}"
new_announce="function announceRoiChange(reason){state.previous=null;state.holdReason=reason;if(state.motionMatrix){if(state.marker){state.marker.remove();state.marker=null}state.anchorPoint=null;state.anchorLatLng=null;state.tracking=false;state.accumX=0;state.accumY=0;state.motionMatrix=null;state.absoluteSource=null;state.markerDeltaLat=0;state.markerDeltaLng=0;setStatus('ready','ready')}window.dispatchEvent(new CustomEvent('wwmsync:vision:roi-ready',{detail:{reason}}));metrics()}"
if old_announce not in text:
    raise SystemExit('announceRoiChange target not found')
text=text.replace(old_announce,new_announce,1)
text=text.replace("const CONTRACT='ANCHOR_FREE_STRUCTURAL_V6';","const CONTRACT='ANCHOR_FREE_STRUCTURAL_V7';",1)
path.write_text(text,'utf-8')
