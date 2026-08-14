#!/usr/bin/env node
import fs from 'node:fs';
const target=process.argv[2];
if(!target) throw new Error('usage: node tools/instrument-candidate-recall-fine-cache.mjs <site/vision-sync.js>');
let src=fs.readFileSync(target,'utf8');
const anchor='window.__WWMSYNC_CANDIDATE_RECALL_FORENSIC__={trace:__rclTrace};';
if(!src.includes(anchor)) throw new Error('candidate recall forensic hook missing');
const patch=String.raw`
const __rclFineFromUncached=__rclFineFrom;
const __rclFineMemo=new WeakMap();
__rclFineFrom=async function(info,cfg,atlas,candidate){
  if(!candidate)return null;
  if(__rclFineMemo.has(candidate))return await __rclFineMemo.get(candidate);
  const pending=__rclFineFromUncached(info,cfg,atlas,candidate);
  __rclFineMemo.set(candidate,pending);
  return await pending;
};
`;
src=src.replace(anchor,patch+'\n'+anchor);
fs.writeFileSync(target,src);
console.log(JSON.stringify({target,patched:true,kind:'replay-only-fine-memoization'}));