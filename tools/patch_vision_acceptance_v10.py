from pathlib import Path
import re

path=Path('vision-sync.js')
text=path.read_text('utf-8')
text=text.replace("const CONTRACT='ANCHOR_FREE_STRUCTURAL_V9';","const CONTRACT='ANCHOR_FREE_STRUCTURAL_V10';")

old="window.__WWMSYNC_VISION_TEST__={setViewport:(lat,lng,zoom)=>{if(!mapRef)return false;mapRef.setView([lat,lng],zoom,{animate:false});return true},reset:()=>{resetTracking('test-reset');return true}};"
new="window.__WWMSYNC_VISION_TEST__={setViewport:(lat,lng,zoom)=>{if(!mapRef)return false;mapRef.setView([lat,lng],zoom,{animate:false});return true},injectMarkerDrift:(dx=40,dy=30)=>{if(!mapRef||!state.marker)return false;const before=state.marker.getLatLng(),p=mapRef.project(before,state.referenceZoom),after=mapRef.unproject(window.L.point(p.x+Number(dx),p.y+Number(dy)),state.referenceZoom);state.marker.setLatLng(after);state.holdReason='test-marker-drift';metrics();return{before,after}},reset:()=>{resetTracking('test-reset');return true}};"
if old not in text:
    raise SystemExit('VISION_TEST target not found')
text=text.replace(old,new,1)

old_draw="async function drawTestCapture(canvas,profile='gfn',shiftX=0,shiftY=0){if(!(canvas instanceof HTMLCanvasElement))throw new Error('canvas-required');const synth=await syntheticRoi(profile,shiftX,shiftY),ctx=canvas.getContext('2d',{alpha:false}),w=canvas.width,h=canvas.height,size=Math.min(w,h)*.20,cx=w*.14,cy=h*.17;ctx.fillStyle='#202020';ctx.fillRect(0,0,w,h);ctx.drawImage(synth.canvas,cx-size/2,cy-size/2,size,size);return{profile,expected:synth.expected,size,cx,cy}}"
new_draw="async function drawTestCapture(canvas,profile='gfn',shiftX=0,shiftY=0){if(!(canvas instanceof HTMLCanvasElement))throw new Error('canvas-required');const synth=await syntheticRoi(profile,shiftX,shiftY),ctx=canvas.getContext('2d',{alpha:false}),w=canvas.width,h=canvas.height,size=Math.min(w,h)*.20,cx=w*.14,cy=h*.17,atlas=await coarseAtlas(MAPS[1]),expectedGlobal=pixelToGlobal(synth.expected.x*atlas.factor,synth.expected.y*atlas.factor,COARSE_Z,MAPS[1]);ctx.fillStyle='#202020';ctx.fillRect(0,0,w,h);ctx.drawImage(synth.canvas,cx-size/2,cy-size/2,size,size);return{profile,expected:synth.expected,expectedGlobal,size,cx,cy,shiftX,shiftY}}"
if old_draw not in text:
    raise SystemExit('drawTestCapture target not found')
text=text.replace(old_draw,new_draw,1)
path.write_text(text,'utf-8')
