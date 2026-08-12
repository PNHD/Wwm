from pathlib import Path
import re

path=Path('vision-sync.js')
text=path.read_text('utf-8')
text=text.replace("const CONTRACT='ANCHOR_FREE_STRUCTURAL_V8';","const CONTRACT='ANCHOR_FREE_STRUCTURAL_V9';")

old_norm="function normalizedGrayOnly(canvas){const w=canvas.width,h=canvas.height,rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,raw=new Float32Array(w*h),sample=[];for(let i=0,p=0;i<raw.length;i++,p+=4){raw[i]=rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114;if(i%43===0)sample.push(raw[i])}const p10=percentile(sample,.10),p90=percentile(sample,.90),range=Math.max(18,p90-p10),gray=new Float32Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=clamp((raw[i]-p10)/range,0,1);return{w,h,gray,contrast:range/255}}"
new_norm="function normalizedGrayOnly(canvas){const w=canvas.width,h=canvas.height,rgba=canvas.getContext('2d',{willReadFrequently:true}).getImageData(0,0,w,h).data,rawGray=new Float32Array(w*h),sample=[];for(let i=0,p=0;i<rawGray.length;i++,p+=4){const v=(rgba[p]*.299+rgba[p+1]*.587+rgba[p+2]*.114)/255;rawGray[i]=v;if(i%43===0)sample.push(v)}const p10=percentile(sample,.10),p90=percentile(sample,.90);return{w,h,gray:rawGray,rawGray,contrast:Math.max(0,p90-p10)}}"
if old_norm not in text:
    raise SystemExit('normalizedGrayOnly target not found')
text=text.replace(old_norm,new_norm,1)

# structuralField gets a raw, unclipped luminance plane in addition to percentile-normalized channels.
needle="const p10=percentile(sample,.10),p90=percentile(sample,.90),range=Math.max(18,p90-p10),gray=new Float32Array(w*h);for(let i=0;i<gray.length;i++)gray[i]=clamp((raw[i]-p10)/range,0,1);const blur="
repl="const p10=percentile(sample,.10),p90=percentile(sample,.90),range=Math.max(18,p90-p10),gray=new Float32Array(w*h),rawGray=new Float32Array(w*h);for(let i=0;i<gray.length;i++){gray[i]=clamp((raw[i]-p10)/range,0,1);rawGray[i]=raw[i]/255}const blur="
if needle not in text:
    raise SystemExit('structuralField gray target not found')
text=text.replace(needle,repl,1)
text=text.replace("return{w,h,gray,high,edge,ridge,flat,coast,cos2,sin2,edgeP,ridgeP,contrast:range/255}","return{w,h,gray,rawGray,high,edge,ridge,flat,coast,cos2,sin2,edgeP,ridgeP,contrast:range/255}",1)

# Raw luminance is used only for local-mean/local-variance correlation. Edge/coast channels remain percentile normalized.
text=text.replace("if(!source?.gray||!field?.gray||radius<=0)return{score:-1,ncc:-1,count:0};const mx=(source.w-1)/2,my=(source.h-1)/2,a=rad(angle),c=Math.cos(a),s=Math.sin(a),sv=[],rv=[];", "if(!(source?.rawGray||source?.gray)||!(field?.rawGray||field?.gray)||radius<=0)return{score:-1,ncc:-1,count:0};const sg=source.rawGray||source.gray,fg=field.rawGray||field.gray,mx=(source.w-1)/2,my=(source.h-1)/2,a=rad(angle),c=Math.cos(a),s=Math.sin(a),sv=[],rv=[];",1)
text=text.replace("sv.push(source.gray[Math.round(y)*source.w+Math.round(x)]);rv.push(bilinear(field.gray,field.w,field.h,p.x,p.y))", "sv.push(sg[Math.round(y)*source.w+Math.round(x)]);rv.push(bilinear(fg,field.w,field.h,p.x,p.y))",1)

# Make the scale-aware structural gradient/high-pass comparison use the same unclipped luminance plane.
old_head="function scaleAwareStructuralScore(source,field,cx,cy,radius,angle,step=3){if(!source?.gray||!field?.gray||radius<=0)return{score:-1,gradient:-1,topology:-1,edgeF1:0,negative:0,count:0};const mx="
new_head="function scaleAwareStructuralScore(source,field,cx,cy,radius,angle,step=3){if(!(source?.rawGray||source?.gray)||!(field?.rawGray||field?.gray)||radius<=0)return{score:-1,gradient:-1,topology:-1,edgeF1:0,negative:0,count:0};const sg=source.rawGray||source.gray,fg=field.rawGray||field.gray,mx="
if old_head not in text:
    raise SystemExit('scaleAware head target not found')
text=text.replace(old_head,new_head,1)
# Replace only within scaleAware line; file is minified one-function-per-line.
lines=text.splitlines()
for idx,line in enumerate(lines):
    if line.startswith('function scaleAwareStructuralScore('):
        line=line.replace('source.gray[','sg[').replace('field.gray,field.w,field.h','fg,field.w,field.h')
        lines[idx]=line
        break
else:
    raise SystemExit('scaleAware line missing')
text='\n'.join(lines)+'\n'

# Self-test reports actual sample counts so zero-variance vs geometry failures stay distinguishable.
lines=text.splitlines()
for idx,line in enumerate(lines):
    if line.startswith("async function selfTest(profile='gfn')"):
        line=line.replace("intensityNcc:truthRecall.ncc,", "intensityNcc:truthRecall.ncc,intensityCount:truthRecall.count,structuralCount:truthStructural.count,")
        line=line.replace("inverseIntensityNcc:truthRecallInv.ncc,", "inverseIntensityNcc:truthRecallInv.ncc,inverseIntensityCount:truthRecallInv.count,")
        lines[idx]=line
        break
else:
    raise SystemExit('selfTest line missing')
text='\n'.join(lines)+'\n'
path.write_text(text,'utf-8')
