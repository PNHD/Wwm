from pathlib import Path
import re

path=Path('vision-sync.js')
text=path.read_text('utf-8')
text=text.replace("const CONTRACT='ANCHOR_FREE_STRUCTURAL_V10';","const CONTRACT='ANCHOR_FREE_STRUCTURAL_V11';")

refiner=r'''function photometricSubpixelRefine(source,field,seed){if(!source||!field||!seed)return seed;const floor=Math.max(.50,(seed.scaleScore??.58)-.10);let best={...seed};const run=(center,span,step,rfs,das,sampleStep)=>{const photo=[];for(let y=center.y-span;y<=center.y+span+1e-6;y+=step)for(let x=center.x-span;x<=center.x+span+1e-6;x+=step)for(const rf of rfs)for(const da of das){const radius=center.radius*rf,angle=angleNorm(center.angle+da),recall=warpIntensityNccFast(source,field,x,y,radius,angle,sampleStep);if(recall.score>=0)pushTop(photo,{x,y,radius,angle,score:recall.score,intensityScore:recall.score,intensityNcc:recall.ncc},48)}let accepted=null;for(const item of photo){const structural=scaleAwareStructuralScore(source,field,item.x,item.y,item.radius,item.angle,3);if(structural.score<floor)continue;item.scaleScore=structural.score;item.rankScore=.88*item.intensityScore+.12*item.scaleScore;if(!accepted||item.rankScore>accepted.rankScore)accepted=item}return accepted||center};best=run(best,10,2,[.97,1,1.03],[-3,0,3],3);best=run(best,2.5,.5,[.985,1,1.015],[-1.5,0,1.5],2);const structural=scaleAwareStructuralScore(source,field,best.x,best.y,best.radius,best.angle,2),recall=warpIntensityNccFast(source,field,best.x,best.y,best.radius,best.angle,2);return{...best,score:structural.score,scaleScore:structural.score,intensityScore:recall.score,intensityNcc:recall.ncc,subpixelRefined:true}}
'''
if 'function photometricSubpixelRefine(' not in text:
    text=text.replace('async function fineMatch(',refiner+'async function fineMatch(',1)

lines=text.splitlines()
for idx,line in enumerate(lines):
    if line.startswith('async function fineMatch('):
        old="if(ref.length)best=ref[0];const all=(ref.length?ref:top),second=all.find(x=>x!==best&&Math.hypot(x.x-best.x,x.y-best.y)>=Math.max(22,best.radius*.10)),margin=second?(best.rankScore??best.scaleScore)-(second.rankScore??second.scaleScore):(best.rankScore??best.scaleScore),globalX=best.x+fine.minX*256,globalY=best.y+fine.minY*256;return{...best,score:best.scaleScore??best.score,globalX,globalY,margin,fieldGrid:fine,scaleFromCoarse:scale}"
        new="if(ref.length)best=ref[0];const all=(ref.length?ref:top),basinBest=best,second=all.find(x=>x!==basinBest&&Math.hypot(x.x-basinBest.x,x.y-basinBest.y)>=Math.max(22,basinBest.radius*.10)),margin=second?(basinBest.rankScore??basinBest.scaleScore)-(second.rankScore??second.scaleScore):(basinBest.rankScore??basinBest.scaleScore);if(srcField)best=photometricSubpixelRefine(srcField,fine.field,basinBest);const globalX=best.x+fine.minX*256,globalY=best.y+fine.minY*256;return{...best,score:best.scaleScore??best.score,globalX,globalY,margin,fieldGrid:fine,scaleFromCoarse:scale}"
        if old not in line:
            raise SystemExit('fineMatch tail target not found')
        lines[idx]=line.replace(old,new,1)
        break
else:
    raise SystemExit('fineMatch line not found')
text='\n'.join(lines)+'\n'

# Surface whether the accepted fine result went through the subpixel stage.
lines=text.splitlines()
for idx,line in enumerate(lines):
    if line.startswith("async function selfTest(profile='gfn')"):
        line=line.replace("verifyScore:fine?.verifyScore??-1,margin:", "verifyScore:fine?.verifyScore??-1,subpixelRefined:!!fine?.subpixelRefined,margin:")
        lines[idx]=line
        break
text='\n'.join(lines)+'\n'
path.write_text(text,'utf-8')
