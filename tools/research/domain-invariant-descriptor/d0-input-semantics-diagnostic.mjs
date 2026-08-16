#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : fallback;
};
const site = path.resolve(arg('--site', 'descriptor-site'));
const controlsPath = path.resolve(arg('--controls', 'descriptor-input/d0-controls.json'));
const outPath = path.resolve(arg('--output', 'descriptor-output/d0-input-semantics.json'));
const controls = JSON.parse(fs.readFileSync(controlsPath, 'utf8'));
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const mime = p => ({
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.webp': 'image/webp', '.json': 'application/json'
}[path.extname(p).toLowerCase()] || 'application/octet-stream');

function startServer() {
  return new Promise(resolve => {
    const s = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const rel = decodeURIComponent(u.pathname.slice(1)) || 'index.html';
      const root = path.resolve(site);
      const f = path.resolve(site, rel);
      if ((!f.startsWith(root + path.sep) && f !== root) || !fs.existsSync(f)) {
        res.writeHead(404).end(); return;
      }
      res.writeHead(200, { 'content-type': mime(f), 'cache-control': 'no-store' });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, '127.0.0.1', () => resolve(s));
  });
}

const modes = [
  { id: 'browser-default', kind: 'browser', smoothingEnabled: null, smoothingQuality: null },
  { id: 'browser-low', kind: 'browser', smoothingEnabled: true, smoothingQuality: 'low' },
  { id: 'browser-medium', kind: 'browser', smoothingEnabled: true, smoothingQuality: 'medium' },
  { id: 'browser-high', kind: 'browser', smoothingEnabled: true, smoothingQuality: 'high' },
  { id: 'browser-nearest', kind: 'browser', smoothingEnabled: false, smoothingQuality: null },
  ...controls.precomputedModes.map(id => ({ id, kind: 'precomputed' }))
];

const server = await startServer();
let browser;
try {
  browser = await chromium.launch({
    headless: true,
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    args: ['--disable-dev-shm-usage', '--no-sandbox']
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[d0 pageerror]', e.message));
  const resp = await page.goto(`http://127.0.0.1:${server.address().port}/index.html`, {
    waitUntil: 'domcontentloaded', timeout: 60000
  });
  if (!resp?.ok()) throw new Error(`site HTTP ${resp?.status()}`);
  await page.waitForFunction(() => window.__WWMSYNC_DOMAIN_DESCRIPTOR_AUDIT__, null, { timeout: 60000 });

  const results = [];
  for (const c of controls.controls) {
    for (const mode of modes) {
      const result = await page.evaluate(async ({ c, mode }) => {
        const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
        const sha = async bytes => hex(await crypto.subtle.digest('SHA-256', bytes));
        const load = async src => { const img = new Image(); img.decoding = 'sync'; img.src = src; await img.decode(); return img; };
        const source = mode.kind === 'precomputed'
          ? `/controls/variants/${c.id}--${mode.id}.png`
          : `/${c.image}`;
        const img = await load(source);
        const cv = document.createElement('canvas'); cv.width = 192; cv.height = 192;
        const ctx = cv.getContext('2d', { alpha: false });
        if (mode.kind === 'browser') {
          if (mode.smoothingEnabled !== null) ctx.imageSmoothingEnabled = mode.smoothingEnabled;
          if (mode.smoothingQuality !== null) ctx.imageSmoothingQuality = mode.smoothingQuality;
          ctx.drawImage(img, 0, 0, img.width, img.height, 0, 0, 192, 192);
        } else {
          if (img.width !== 192 || img.height !== 192) throw new Error(`${mode.id}: precomputed image not 192x192`);
          ctx.drawImage(img, 0, 0);
        }
        const rgba192 = ctx.getImageData(0, 0, 192, 192).data;
        const rgb192 = new Uint8Array(192 * 192 * 3);
        for (let i = 0, j = 0; i < rgba192.length; i += 4) { rgb192[j++] = rgba192[i]; rgb192[j++] = rgba192[i+1]; rgb192[j++] = rgba192[i+2]; }
        const png192 = Uint8Array.from(atob(cv.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0));

        const c80 = document.createElement('canvas'); c80.width = 80; c80.height = 80;
        const x80 = c80.getContext('2d', { alpha: false });
        x80.imageSmoothingEnabled = true; x80.imageSmoothingQuality = 'high';
        x80.drawImage(cv, 0, 0, 80, 80);
        const rgba80 = x80.getImageData(0, 0, 80, 80).data;
        const rgb80 = new Uint8Array(80 * 80 * 3);
        for (let i = 0, j = 0; i < rgba80.length; i += 4) { rgb80[j++] = rgba80[i]; rgb80[j++] = rgba80[i+1]; rgb80[j++] = rgba80[i+2]; }
        const png80 = Uint8Array.from(atob(c80.toDataURL('image/png').split(',')[1]), ch => ch.charCodeAt(0));

        // D0-only API. This does not invoke D1-D4 descriptor evaluation.
        const d0 = await window.__WWMSYNC_DOMAIN_DESCRIPTOR_AUDIT__.recoverLocalGt(
          cv, c.mapId, { x: c.expected[0], y: c.expected[1] }
        );
        return {
          input: { src: source, decodedWidth: img.width, decodedHeight: img.height },
          canvas: {
            width: 192, height: 192,
            imageSmoothingEnabled: ctx.imageSmoothingEnabled,
            imageSmoothingQuality: ctx.imageSmoothingQuality,
            sha256: {
              rgba192: await sha(rgba192.buffer), rgb192: await sha(rgb192.buffer), png192: await sha(png192.buffer),
              rgba80: await sha(rgba80.buffer), rgb80: await sha(rgb80.buffer), png80: await sha(png80.buffer)
            }
          },
          d0
        };
      }, { c, mode });
      const target = c.target;
      const delta = {
        scaleAwareStructure: result.d0.scaleAwareStructure - target.scaleAwareStructure,
        intensityNcc: result.d0.intensityNcc - target.intensityNcc,
        productionCombined: result.d0.productionCombined - target.productionCombined,
        angle: Math.min(Math.abs(result.d0.angle - target.angle) % 360, 360 - (Math.abs(result.d0.angle - target.angle) % 360)),
        radius: result.d0.radius - target.radius
      };
      const pass = Math.abs(delta.scaleAwareStructure) <= 1e-6 && Math.abs(delta.intensityNcc) <= 1e-6 &&
        Math.abs(delta.productionCombined) <= 1e-6 && Math.abs(delta.angle) <= 1e-6 && Math.abs(delta.radius) <= 1e-6;
      results.push({ control: c.id, mode: mode.id, target, ...result, delta, pass });
      console.log(JSON.stringify({ control: c.id, mode: mode.id, d0: result.d0, delta, pass, hashes: result.canvas.sha256 }));
    }
  }
  const knownRoiSha = controls.knownRoiSha || {};
  const hashMatches = [];
  for (const r of results) for (const [stage, hash] of Object.entries(r.canvas.sha256)) {
    const expected = knownRoiSha[r.control] || [];
    const idx = expected.indexOf(hash);
    if (idx >= 0) hashMatches.push({ control: r.control, mode: r.mode, stage, hash, historicalRoiShaIndex: idx });
  }
  fs.writeFileSync(outPath, JSON.stringify({
    schema: 'wwmsync-d0-input-semantics-diagnostic-v1',
    descriptorOutcomesExecuted: false,
    d0OnlyApi: 'recoverLocalGt',
    controls: controls.controls,
    modes,
    results,
    historicalRoiSha: knownRoiSha,
    historicalRoiShaMatches: hashMatches
  }, null, 2) + '\n');
} finally {
  if (browser) await browser.close();
  await new Promise(resolve => server.close(resolve));
}
