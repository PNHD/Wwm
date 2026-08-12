#!/usr/bin/env node
import fs from 'node:fs';
const target=process.argv[2];
if(!target)throw new Error('usage: node tools/instrument-real-gfn-expanded-domain.mjs <replay-site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const needle="function inGlobalBounds(t){return!!t&&t.lng>=GLOBAL_BOUNDS.lngMin&&t.lng<=GLOBAL_BOUNDS.lngMax&&t.lat>=GLOBAL_BOUNDS.latMin&&t.lat<=GLOBAL_BOUNDS.latMax}";
const replacement="function inGlobalBounds(t){return!!t}/* REPLAY-ONLY: full current Dashen main domain; production GLOBAL_BOUNDS unchanged */";
const first=src.indexOf(needle);
if(first<0)throw new Error('expanded-domain instrumentation target missing');
if(src.indexOf(needle,first+needle.length)>=0)throw new Error('expanded-domain instrumentation target not unique');
src=src.slice(0,first)+replacement+src.slice(first+needle.length);
src += "\nwindow.__WWMSYNC_REFERENCE_DOMAIN_EXPANDED__={enabled:true,scope:'replay-only-full-dashen-main',productionBoundsChanged:false};\n";
fs.writeFileSync(target,src);
console.log(JSON.stringify({instrumented:target,replayOnly:true,productionSourceUnchanged:true,globalBoundsBypassedInReplayCopy:true,gateChanged:false}));
