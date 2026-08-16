#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv=process.argv.slice(2), arg=(n,d=null)=>{const i=argv.indexOf(n);return i>=0?argv[i+1]:d};
const site=path.resolve(arg('--site','descriptor-site'));
const controls=JSON.parse(fs.readFileSync(path.resolve(arg('--controls','descriptor-input/d0-controls.json')),'utf8'));
const out=path.resolve(arg('--output','descriptor-output/d0-canonical-semantics.json'));
fs.mkdirSync(path.dirname(out),{recursive:true});
const mime=p=>({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css','.png':'image/png','.webp':'image/webp','.json':'application/json'}[path.extname(p).toLowerCase()]||'application/octet-stream');
const server=await new Promise(resolve=>{const s=http.createServer((req,res)=>{const u=new URL(req.url,'http://127.0.0.1'),rel=decodeURIComponent(u.pathname.slice(1))||'index.html',root=path.resolve(site),f=path.resolve(site,rel);if((!f.startsWith(root+path.sep)&&f!==root)||!fs.existsSync(f)){res.writeHead(404).end();return}res.writeHead(200,{'content-type':mime(f),'cache-control':'no-store'});fs.createReadStream(f).pipe(res)});s.listen(0,'127.0.0.1',()=>resolve(s))});
let browser;
try{
  browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_BIN||'/usr/bin/google-chrome',args:['--disable-dev-shm-usage','--no-sandbox']});
  const page=await browser.newPage({viewport:{width:1280,height:900}});
  page.on('pageerror',e=>console.error('[d0 canonical pageerror]',e.message));
  const resp=await page.goto(`http://127.0.0.1:${server.address().port}/index.html`,{waitUntil:'domcontentloaded',timeout:60000});
  if(!resp?.ok())throw new Error(`site HTTP ${resp?.status()}`);
  await page.waitForFunction(()=>window.__WWMSYNC_DOMAIN_DESCRIPTOR_AUDIT__,null,{timeout:60000});
  const canonicalModes=controls.canonicalModes||['production-high','default','low','medium','nearest'];
  const results=[];
  for(const c of controls.controls){
    for(const canonicalMode of canonicalModes){
      const r=await page.evaluate(async({c,canonicalMode})=>{
        const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
        const sha=async b=>hex(await crypto.subtle.digest('SHA-256',b));
        const img=new Image();img.decoding='sync';img.src='/'+c.image;await img.decode();
        const srcCv=document.createElement('canvas');srcCv.width=img.width;srcCv.height=img.height;const sx=srcCv.getContext('2d',{alpha:false});sx.drawImage(img,0,0);
        const srcRgba=sx.getImageData(0,0,srcCv.width,srcCv.height).data;
        const srcRgb=new Uint8Array(srcCv.width*srcCv.height*3);for(let i=0,j=0;i<srcRgba.length;i+=4){srcRgb[j++]=srcRgba[i];srcRgb[j++]=srcRgba[i+1];srcRgb[j++]=srcRgba[i+2]}
        const srcPng=Uint8Array.from(atob(srcCv.toDataURL('image/png').split(',')[1]),ch=>ch.charCodeAt(0));
        const cv=document.createElement('canvas');cv.width=192;cv.height=192;const ctx=cv.getContext('2d',{alpha:false});ctx.drawImage(img,0,0,img.width,img.height,0,0,192,192);
        const rgba=ctx.getImageData(0,0,192,192).data;const rgb=new Uint8Array(192*192*3);for(let i=0,j=0;i<rgba.length;i+=4){rgb[j++]=rgba[i];rgb[j++]=rgba[i+1];rgb[j++]=rgba[i+2]}
        const png=Uint8Array.from(atob(cv.toDataURL('image/png').split(',')[1]),ch=>ch.charCodeAt(0));
        window.__WWMSYNC_D0_CANONICAL_MODE__=canonicalMode;
        const d0=await window.__WWMSYNC_DOMAIN_DESCRIPTOR_AUDIT__.recoverLocalGt(cv,c.mapId,{x:c.expected[0],y:c.expected[1]});
        return {decoded:[img.width,img.height],hashes:{sourceRgba:await sha(srcRgba.buffer),sourceRgb:await sha(srcRgb.buffer),sourcePng:await sha(srcPng.buffer),workRgba:await sha(rgba.buffer),workRgb:await sha(rgb.buffer),workPng:await sha(png.buffer)},d0};
      },{c,canonicalMode});
      const t=c.target,d={scaleAwareStructure:r.d0.scaleAwareStructure-t.scaleAwareStructure,intensityNcc:r.d0.intensityNcc-t.intensityNcc,productionCombined:r.d0.productionCombined-t.productionCombined,angle:Math.min(Math.abs(r.d0.angle-t.angle)%360,360-(Math.abs(r.d0.angle-t.angle)%360)),radius:r.d0.radius-t.radius};
      const pass=Math.abs(d.scaleAwareStructure)<=1e-6&&Math.abs(d.intensityNcc)<=1e-6&&Math.abs(d.productionCombined)<=1e-6&&Math.abs(d.angle)<=1e-6&&Math.abs(d.radius)<=1e-6;
      results.push({control:c.id,canonicalMode,target:t,...r,delta:d,pass});
      console.log(JSON.stringify({control:c.id,canonicalMode,d0:r.d0,delta:d,pass,hashes:r.hashes}));
    }
  }
  const matches=[];for(const r of results)for(const [stage,h] of Object.entries(r.hashes)){const xs=controls.knownRoiSha?.[r.control]||[];const i=xs.indexOf(h);if(i>=0)matches.push({control:r.control,canonicalMode:r.canonicalMode,stage,hash:h,historicalRoiShaIndex:i})}
  fs.writeFileSync(out,JSON.stringify({schema:'wwmsync-d0-canonical-semantics-diagnostic-v1',descriptorOutcomesExecuted:false,d0OnlyApi:'recoverLocalGt',canonicalModes,results,historicalRoiShaMatches:matches},null,2)+'\n');
}finally{if(browser)await browser.close();await new Promise(r=>server.close(r))}
