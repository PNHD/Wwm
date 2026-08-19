#!/usr/bin/env node
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';

const args=Object.fromEntries(process.argv.slice(2).reduce((a,v,i,x)=>v.startsWith('--')?(a.push([v.slice(2),x[i+1]]),a):a,[]));
if(!args.site||!args.fixture||!args.report)throw new Error('Usage: --site <dir> --fixture <dir> --report <file>');
const site=path.resolve(args.site),fixture=path.resolve(args.fixture),report=path.resolve(args.report);
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json','.png':'image/png'};
const safe=(root,u)=>{const p=path.resolve(root,decodeURIComponent(u.split('?')[0]).replace(/^\/+/,''));return p===root||p.startsWith(root+path.sep)?p:null};
const server=http.createServer(async(req,res)=>{try{const root=req.url.startsWith('/__fixture__/')?fixture:site;const part=req.url.startsWith('/__fixture__/')?req.url.slice(13):(req.url==='/'?'index.html':req.url);const file=safe(root,part);if(!file)throw new Error('forbidden');const data=await fs.readFile(file);res.writeHead(200,{'content-type':mime[path.extname(file)]||'application/octet-stream','cache-control':'no-store'});res.end(data)}catch{res.writeHead(404);res.end('not found')}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try{
  const {chromium}=await import('playwright-core');
  browser=await chromium.launch({executablePath:process.env.CHROME_BIN,headless:true,args:['--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1440,height:900}}),base=`http://127.0.0.1:${server.address().port}`;
  await page.addInitScript(()=>localStorage.setItem('wwmsync:lang','en'));
  await page.route('https://s2.easebar.com/**',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{maps:[{id:1,name:'Qinghe'}],categories:[]}})}));
  await page.route('**/data/map/**',route=>route.fulfill({status:200,contentType:'image/png',body:Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=','base64')}));
  await page.goto(base,{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.__WWMSYNC_VISION_TEST__?.featureCanvas&&window.__WWMSYNC_VISION_TEST__?.estimatePair,{timeout:30000});
  const capture=JSON.parse((await fs.readFile(path.join(fixture,'capture.json'),'utf8')).replace(/^\uFEFF/,''));
  const names=capture.frames.map(f=>f.minimapFile||f.cropFile);
  const results=await page.evaluate(async({names,base})=>{const t=window.__WWMSYNC_VISION_TEST__,load=async name=>{const im=new Image();im.src=`${base}/__fixture__/${encodeURIComponent(name)}`;await im.decode();const c=document.createElement('canvas');c.width=c.height=216;c.getContext('2d',{alpha:false}).drawImage(im,0,0,216,216);return t.featureCanvas(c)},fields=await Promise.all(names.map(load)),n=t.constants.WORK,mean=(key)=>{const x=new Float32Array(n*n);for(const f of fields)for(let i=0;i<x.length;i++)x[i]+=f[key][i]/fields.length;return x},template={data:mean('data'),rawData:mean('rawData')},energy=(data)=>Math.sqrt(data.reduce((s,v)=>s+v*v,0)/data.length),shift=(data,dx,dy)=>{const out=new Float32Array(data.length);for(let y=0;y<n;y++)for(let x=0;x<n;x++){const sx=x-dx,sy=y-dy,i=y*n+x;out[i]=sx>=0&&sx<n&&sy>=0&&sy<n?data[sy*n+sx]:0}return out},source=fields[19],make=(dx,dy)=>{const aData=new Float32Array(n*n),aRaw=new Float32Array(n*n),bData=new Float32Array(n*n),bRaw=new Float32Array(n*n);const sd=source.data,sr=source.rawData,td=template.data,tr=template.rawData,moveD=shift(sd.map((v,i)=>v-td[i]),dx,dy),moveR=shift(sr.map((v,i)=>v-tr[i]),dx,dy);for(let i=0;i<aData.length;i++){aData[i]=td[i]+sd[i]-td[i];aRaw[i]=tr[i]+sr[i]-tr[i];bData[i]=td[i]+moveD[i];bRaw[i]=tr[i]+moveR[i]}return{previous:{data:aData,rawData:aRaw,energy:energy(aData),rawEnergy:energy(aRaw),sourceScale:216/192},current:{data:bData,rawData:bRaw,energy:energy(bData),rawEnergy:energy(bRaw),sourceScale:216/192}}};return[1,2,3,4,6,8,10].map(dx=>{const p=make(dx,0),r=t.estimatePair(p.previous,p.current),estimated=Math.hypot(r.dx||0,r.dy||0);return{expectedWorkPx:dx,estimatedDx:r.dx,estimatedDy:r.dy,estimatedMagnitude:estimated,gain:estimated/dx,score:r.score,accepted:r.accepted,reason:r.reason}})},{names,base});
  const redObserved=results.some(r=>r.gain<.85);
  const output={schema:'wwmsync-m1-2-static-held-red-baseline-v1',runtime:(await page.evaluate(()=>window.__WWMSYNC_VISION_HARDENING__)),construction:'40-frame temporal mean static template; frame-20 residual translated while template held; all values work px',requiredMinimumGain:.85,results,redObserved};
  await fs.mkdir(path.dirname(report),{recursive:true});await fs.writeFile(report,JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
  if(redObserved&&!process.env.M1_2_RECORD_ONLY)process.exitCode=1;
}finally{await browser?.close();server.close()}
