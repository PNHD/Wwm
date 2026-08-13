#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const args=process.argv.slice(2);
const core=fileURLToPath(new URL('./replay-owner-gfn-controls-core.mjs',import.meta.url));
const run=spawnSync(process.execPath,[core,...args],{stdio:'inherit',env:process.env});
if(run.error)throw run.error;
if(run.status!==0)process.exit(run.status??1);
const i=args.indexOf('--output');
const outputDir=path.resolve(i>=0?args[i+1]:'owner-gfn-output');
const files=fs.readdirSync(outputDir).filter(n=>fs.statSync(path.join(outputDir,n)).isFile()).sort();
const lines=files.map(name=>{
  const digest=crypto.createHash('sha256').update(fs.readFileSync(path.join(outputDir,name))).digest('hex');
  return `${digest}  ${name}`;
});
fs.writeFileSync(path.join(outputDir,'SHA256SUMS'),lines.join('\n')+'\n');
