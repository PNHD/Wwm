#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const siteDir = path.resolve(arg('--site') || 'replay-site');
const fixtureDir = path.resolve(arg('--fixture') || 'real-fixture');
const reportPath = path.resolve(arg('--report') || 'replay-output/wwmsync-real-gfn-temporal-mosaic.json');
const visualDir = path.resolve(arg('--visual-dir') || 'replay-output/temporal-mosaic-visuals');
const TOP_K = Math.max(3, Math.min(8, Number(arg('--top-k')) || 8));
const OBSERVATION_SIZES = [1, 5, 10, 20, 40];
const EXPECTED_SHA = 'aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216';
const WORK = 192;
const CAPTURED_MINIMAP = 216;
const SOURCE_PER_WORK = CAPTURED_MINIMAP / WORK;

const parseJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const ensureDir = p => fs.mkdirSync(p, { recursive: true });
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const quantile = (values, q) => { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return lo === hi ? a[lo] : a[lo] * (hi - p) + a[hi] * (p - lo); };
const stats = values => { const a = values.filter(Number.isFinite); const m = mean(a); return { n: a.length, min: a.length ? Math.min(...a) : null, p10: quantile(a, .10), median: quantile(a, .50), mean: m, p90: quantile(a, .90), max: a.length ? Math.max(...a) : null, std: a.length && m != null ? Math.sqrt(mean(a.map(v => (v - m) ** 2))) : null }; };
const hypot = (x, y) => Math.hypot(Number(x) || 0, Number(y) || 0);
const angleDelta = (a, b) => Math.abs((((Number(a) - Number(b)) + 540) % 360) - 180);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cosine = (ax, ay, bx, by) => { const am = hypot(ax, ay), bm = hypot(bx, by); return am > .05 && bm > .05 ? clamp((ax * bx + ay * by) / (am * bm), -1, 1) : null; };
const mime = p => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(p).toLowerCase()] || 'application/octet-stream');

function startServer() {
  const roots = { '/fixture/': fixtureDir, '/': siteDir };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = url.pathname.startsWith('/fixture/') ? '/fixture/' : '/';
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || (prefix === '/' ? 'index.html' : 'capture.json');
    const root = roots[prefix], rootAbs = path.resolve(root), file = path.resolve(root, rel);
    if ((!file.startsWith(rootAbs + path.sep) && file !== rootAbs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(file.startsWith(rootAbs) ? 404 : 403).end(); return; }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function saveDataUrl(dataUrl, file) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('unexpected PNG data URL');
  ensureDir(path.dirname(file)); fs.writeFileSync(file, Buffer.from(m[1], 'base64')); return file;
}

function scoreTrackAgainstFlow(sequence, flows) {
  const steps = [];
  let actualX = 0, actualY = 0, predictedX = 0, predictedY = 0;
  const residuals = [];
  for (let i = 1; i < sequence.length; i++) {
    const prev = sequence[i - 1], cur = sequence[i], flow = flows[i] || {};
    const adx = cur.globalX - prev.globalX, ady = cur.globalY - prev.globalY;
    let pdx = 0, pdy = 0;
    if (flow.accepted) {
      const r = (Number(prev.angle) || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), scale = (Number(prev.radius) || 96) / 96;
      const playerX = -(Number(flow.dx) || 0), playerY = -(Number(flow.dy) || 0);
      pdx = (playerX * c - playerY * s) * scale;
      pdy = (playerX * s + playerY * c) * scale;
      predictedX += pdx; predictedY += pdy;
    }
    actualX += adx; actualY += ady;
    const residual = hypot(actualX - predictedX, actualY - predictedY);
    residuals.push(residual);
    steps.push({ frame: i + 1, actual: { dx: adx, dy: ady, magnitude: hypot(adx, ady) }, predictedFromAcceptedFlow: { dx: pdx, dy: pdy, magnitude: hypot(pdx, pdy) }, cumulative: { actualX, actualY, predictedX, predictedY, residual }, directionCosine: flow.accepted ? cosine(adx, ady, pdx, pdy) : null, flow: { dx: flow.dx ?? null, dy: flow.dy ?? null, score: flow.score ?? null, accepted: !!flow.accepted, reason: flow.reason ?? null, representation: flow.representation ?? null } });
  }
  const validCos = steps.filter(s => s.flow.accepted && Number.isFinite(s.directionCosine) && s.actual.magnitude > .05 && s.predictedFromAcceptedFlow.magnitude > .05).map(s => s.directionCosine);
  const predMag = hypot(predictedX, predictedY), actualMag = hypot(actualX, actualY), endpointError = hypot(actualX - predictedX, actualY - predictedY);
  const angles = sequence.map(s => Number(s.angle)).filter(Number.isFinite), radii = sequence.map(s => Number(s.radius)).filter(r => Number.isFinite(r) && r > 0);
  const angleMax = angles.length ? Math.max(...angles.map(a => angleDelta(a, angles[0]))) : null;
  const scaleMax = radii.length ? Math.max(...radii.map(r => Math.abs(r / radii[0] - 1))) : null;
  const directionMean = mean(validCos), endpointCos = cosine(actualX, actualY, predictedX, predictedY);
  const endpointFit = Math.exp(-endpointError / Math.max(18, predMag || actualMag || 18));
  const residualFit = Math.exp(-(quantile(residuals, .50) || 0) / Math.max(18, (predMag || actualMag || 18) * .55));
  const angleFit = Number.isFinite(angleMax) ? Math.exp(-angleMax / 25) : 0;
  const scaleFit = Number.isFinite(scaleMax) ? Math.exp(-scaleMax / .15) : 0;
  const stable = validCos.length >= Math.max(1, Math.floor((sequence.length - 1) * .30)) && Number.isFinite(directionMean) && directionMean >= .50 && endpointError <= Math.max(24, predMag * .80) && (angleMax ?? 999) <= 25 && (scaleMax ?? 999) <= .20;
  return {
    validAcceptedFlowStepCount: validCos.length,
    acceptedFlowStepCount: steps.filter(s => s.flow.accepted).length,
    meanDirectionCosine: directionMean,
    medianDirectionCosine: quantile(validCos, .50),
    endpointDirectionCosine: endpointCos,
    actualEndDisplacement: { dx: actualX, dy: actualY, magnitude: actualMag },
    predictedEndDisplacementFromAcceptedFlow: { dx: predictedX, dy: predictedY, magnitude: predMag },
    endpointDisplacementError: endpointError,
    endpointErrorRatio: predMag > 1 ? endpointError / predMag : null,
    cumulativeResidual: stats(residuals),
    angleStability: { maxDeltaFromStartDeg: angleMax, values: angles },
    scaleStability: { maxRelativeDeltaFromStart: scaleMax, radius: stats(radii) },
    samePhysicalBasinStable: stable,
    fits: { endpointFit, residualFit, angleFit, scaleFit },
    steps
  };
}

function sequenceScore(candidate, consistency) {
  const combined = clamp(Number(candidate.combinedScore) || 0, 0, 1);
  const structure = clamp(Number(candidate.scaleScore) || 0, 0, 1);
  const topology = clamp(Number(candidate.topology) || 0, 0, 1);
  const polarity = clamp(Number(candidate.terrainPolarity) || 0, 0, 1);
  const dir = Number.isFinite(consistency.meanDirectionCosine) ? (consistency.meanDirectionCosine + 1) / 2 : 0;
  const raw = .25 * combined + .20 * structure + .10 * topology + .05 * polarity + .15 * dir + .10 * consistency.fits.endpointFit + .07 * consistency.fits.residualFit + .04 * consistency.fits.angleFit + .04 * consistency.fits.scaleFit;
  return clamp(raw, 0, 1);
}

const capture = parseJson(path.join(fixtureDir, 'capture.json'));
const frames = (capture.frames || []).map(x => ({ ...x, minimap: x.minimap || x.minimapFile || x.cropFile }));
if (frames.length !== 40) throw new Error(`expected exact 40-frame fixture, got ${frames.length}`);
if (Number(capture.intervalMs) !== 200) throw new Error(`expected 200ms fixture interval, got ${capture.intervalMs}`);
ensureDir(path.dirname(reportPath)); ensureDir(visualDir);

const { server, port } = await startServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[temporal mosaic pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[temporal mosaic console]', m.text()); });
  const response = await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`diagnostic site HTTP ${response?.status()}`);
  await page.waitForFunction(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__ && window.__WWMSYNC_VISION_TEST__, null, { timeout: 60_000 });
  await page.evaluate(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset());

  const flows = [];
  const centers = [{ x: 0, y: 0 }];
  let cumulativeTerrainX = 0, cumulativeTerrainY = 0;
  for (let i = 0; i < frames.length; i++) {
    const flow = await page.evaluate(async ({ name, reset }) => {
      const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode();
      const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192);
      return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.flow(c, reset);
    }, { name: frames[i].minimap, reset: i === 0 });
    flows.push(flow || { baseline: i === 0, dx: 0, dy: 0, accepted: false, reason: 'flow-unavailable' });
    if (i > 0 && flow?.accepted) { cumulativeTerrainX += Number(flow.dx) || 0; cumulativeTerrainY += Number(flow.dy) || 0; }
    if (i > 0) centers.push({ x: -cumulativeTerrainX, y: -cumulativeTerrainY });
  }

  const acceptedFlowSteps = flows.slice(1).filter(f => f?.accepted);
  const centerXs = centers.map(p => p.x), centerYs = centers.map(p => p.y);
  const flowIntegration = {
    signSemantics: 'terrain dx/dy from production estimator; player/world-frame center translation = -terrain dx/dy',
    acceptedSteps: acceptedFlowSteps.length,
    rejectedSteps: 39 - acceptedFlowSteps.length,
    terrainCumulativeWorkPx: { dx: cumulativeTerrainX, dy: cumulativeTerrainY, magnitude: hypot(cumulativeTerrainX, cumulativeTerrainY) },
    worldAlignedCenterCumulativeWorkPx: { dx: -cumulativeTerrainX, dy: -cumulativeTerrainY, magnitude: hypot(cumulativeTerrainX, cumulativeTerrainY) },
    centerPathSpanWorkPx: { x: Math.max(...centerXs) - Math.min(...centerXs), y: Math.max(...centerYs) - Math.min(...centerYs) },
    centerPathSpanSourceMinimapPx: { x: (Math.max(...centerXs) - Math.min(...centerXs)) * SOURCE_PER_WORK, y: (Math.max(...centerYs) - Math.min(...centerYs)) * SOURCE_PER_WORK },
    steps: flows.map((f, i) => ({ frame: i + 1, centerWorkPx: centers[i], terrain: f }))
  };

  const observations = [];
  for (const count of OBSERVATION_SIZES) {
    const mosaic = await page.evaluate(async ({ names, centers, count, topK }) => {
      const clamp01 = v => Math.max(0, Math.min(1, v));
      const percentile = (values, p) => { if (!values.length) return 0; const a = values.slice().sort((x, y) => x - y), idx = Math.max(0, Math.min(a.length - 1, Math.floor((a.length - 1) * p))); return a[idx]; };
      const work = 192, half = work / 2, inner = half * .19, outer = half * .80, padding = 10;
      const usedCenters = centers.slice(0, count), minCX = Math.min(...usedCenters.map(p => p.x)), maxCX = Math.max(...usedCenters.map(p => p.x)), minCY = Math.min(...usedCenters.map(p => p.y)), maxCY = Math.max(...usedCenters.map(p => p.y));
      const footprintW = maxCX - minCX + outer * 2, footprintH = maxCY - minCY + outer * 2, side = Math.max(96, Math.ceil(Math.max(footprintW, footprintH) + padding * 2));
      const baseX = side / 2 - (minCX + maxCX) / 2, baseY = side / 2 - (minCY + maxCY) / 2, len = side * side;
      const sum = new Float32Array(len), sumSq = new Float32Array(len), minV = new Float32Array(len), maxV = new Float32Array(len), gradSum = new Float32Array(len), polaritySum = new Float32Array(len), polarityAbs = new Float32Array(len);
      minV.fill(2); maxV.fill(-1); const support = new Uint16Array(len), edgeHits = new Uint16Array(len), quietHits = new Uint16Array(len);
      const loaded = [];
      for (let fi = 0; fi < count; fi++) {
        const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${names[fi]}`; await img.decode();
        const c = document.createElement('canvas'); c.width = work; c.height = work; const x = c.getContext('2d', { alpha: false, willReadFrequently: true }); x.drawImage(img, 0, 0, 216, 216, 0, 0, work, work);
        const rgba = x.getImageData(0, 0, work, work).data, gray = new Float32Array(work * work), grads = [], grad = new Float32Array(work * work), high = new Float32Array(work * work);
        for (let i = 0, p = 0; i < gray.length; i++, p += 4) gray[i] = (rgba[p] * .299 + rgba[p + 1] * .587 + rgba[p + 2] * .114) / 255;
        for (let y = 6; y < work - 6; y++) for (let xx = 6; xx < work - 6; xx++) {
          const dx = xx - half, dy = y - half, rr = Math.hypot(dx, dy); if (rr < inner || rr > outer) continue;
          const i = y * work + xx, gx = gray[i + 2] - gray[i - 2], gy = gray[i + 2 * work] - gray[i - 2 * work], gm = Math.hypot(gx, gy), local = gray[i] - (gray[i - 5] + gray[i + 5] + gray[i - 5 * work] + gray[i + 5 * work]) * .25;
          grad[i] = gm; high[i] = local; grads.push(gm);
        }
        const edgeT = Math.max(.025, percentile(grads, .72)), quietT = Math.min(edgeT * .45, percentile(grads, .32));
        loaded.push({ gray, grad, high, edgeT, quietT });
      }
      for (let fi = 0; fi < count; fi++) {
        const { gray, grad, high, edgeT, quietT } = loaded[fi], center = usedCenters[fi], ox = baseX + center.x - half, oy = baseY + center.y - half;
        for (let y = 6; y < work - 6; y++) for (let xx = 6; xx < work - 6; xx++) {
          const dx = xx - half, dy = y - half, rr = Math.hypot(dx, dy); if (rr < inner || rr > outer) continue;
          const mx = Math.round(ox + xx), my = Math.round(oy + y); if (mx < 0 || my < 0 || mx >= side || my >= side) continue;
          const si = y * work + xx, mi = my * side + mx, v = gray[si], g = grad[si], hp = high[si];
          sum[mi] += v; sumSq[mi] += v * v; support[mi]++; if (v < minV[mi]) minV[mi] = v; if (v > maxV[mi]) maxV[mi] = v; gradSum[mi] += g;
          if (g >= edgeT) edgeHits[mi]++; if (g <= quietT) quietHits[mi]++;
          const pw = Math.min(1, Math.abs(hp) / .10); polaritySum[mi] += Math.sign(hp) * pw; polarityAbs[mi] += pw;
        }
      }
      const robust = new Float32Array(len), gradient = new Float32Array(len), positive = new Float32Array(len), quiet = new Float32Array(len), polarity = new Float32Array(len), variance = new Float32Array(len), variances = [], gradients = [];
      let supportPixels = 0, minSX = side, maxSX = -1, minSY = side, maxSY = -1;
      for (let i = 0; i < len; i++) if (support[i]) {
        supportPixels++; const n = support[i], avg = sum[i] / n; robust[i] = n >= 3 ? (sum[i] - minV[i] - maxV[i]) / (n - 2) : avg; gradient[i] = gradSum[i] / n; positive[i] = edgeHits[i] / n; quiet[i] = quietHits[i] / n; variance[i] = Math.max(0, sumSq[i] / n - avg * avg); if (n >= 2) variances.push(variance[i]); gradients.push(gradient[i]); polarity[i] = polarityAbs[i] > .001 ? polaritySum[i] / polarityAbs[i] : 0;
        const x = i % side, y = Math.floor(i / side); minSX = Math.min(minSX, x); maxSX = Math.max(maxSX, x); minSY = Math.min(minSY, y); maxSY = Math.max(maxSY, y);
      }
      const vLo = percentile(variances, .55), vHi = Math.max(vLo + 1e-5, percentile(variances, .90)), gHi = Math.max(.01, percentile(gradients, .92));
      const combined = new Float32Array(len), varianceNorm = new Float32Array(len), polarityView = new Float32Array(len), gradView = new Float32Array(len);
      for (let i = 0; i < len; i++) {
        if (!support[i]) { combined[i] = robust[i] = positive[i] = gradient[i] = varianceNorm[i] = .5; quiet[i] = .5; polarityView[i] = .5; continue; }
        const stability = support[i] < 2 ? .72 : 1 - clamp01((variance[i] - vLo) / (vHi - vLo)), supportWeight = clamp01(support[i] / Math.min(5, count));
        const edgeConfidence = Math.abs(polarity[i]) * positive[i], stableLum = .5 + (robust[i] - .5) * (.35 + .65 * stability), edgeTerm = polarity[i] * edgeConfidence;
        combined[i] = clamp01(.5 + (stableLum - .5) * supportWeight + .09 * edgeTerm * stability);
        varianceNorm[i] = clamp01(variance[i] / vHi); polarityView[i] = clamp01(.5 + .5 * polarity[i] * positive[i]); gradView[i] = clamp01(gradient[i] / gHi);
      }
      const make = arr => { const c = document.createElement('canvas'); c.width = side; c.height = side; const x = c.getContext('2d', { alpha: false }), im = x.createImageData(side, side); for (let i = 0; i < len; i++) { const v = Math.round(clamp01(arr[i]) * 255); im.data[i * 4] = v; im.data[i * 4 + 1] = v; im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; } x.putImageData(im, 0, 0); return c; };
      const canvases = { robustLuminance: make(robust), gradientMagnitude: make(gradView), positiveEdgeOccupancy: make(positive), quietNegativeSpaceOccupancy: make(quiet), signedEdgePolarityConfidence: make(polarityView), temporalVarianceMask: make(varianceNorm), combinedStructural: make(combined) };
      const probe = await window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.globalProbe(canvases.combinedStructural, 1, topK);
      return {
        count, sideWorkPx: side,
        coverage: { supportPixelCountWork: supportPixels, supportBoundsWorkPx: { x: minSX, y: minSY, width: maxSX >= minSX ? maxSX - minSX + 1 : 0, height: maxSY >= minSY ? maxSY - minSY + 1 : 0 }, centerPathSpanWorkPx: { x: maxCX - minCX, y: maxCY - minCY }, outerMaskRadiusWorkPx: outer, varianceThresholds: { stableMedianLike: vLo, unstableP90: vHi }, gradientP92: gHi },
        representations: Object.fromEntries(Object.entries(canvases).map(([k, c]) => [k, c.toDataURL('image/png')])),
        probe
      };
    }, { names: frames.map(f => f.minimap), centers, count, topK: TOP_K });

    const saved = {};
    for (const [kind, data] of Object.entries(mosaic.representations || {})) {
      const file = path.join(visualDir, `${String(count).padStart(2, '0')}-frames-${kind}.png`);
      saved[kind] = saveDataUrl(data, file);
    }
    const candidates = (mosaic.probe?.candidates || []).slice(0, TOP_K);
    if (!candidates.length) throw new Error(`temporal mosaic ${count} frames produced no global candidates`);

    const hypotheses = [];
    for (const candidate of candidates) {
      const sequence = [];
      let dynamic = { ...candidate };
      const key = `mosaic-${count}-rank-${candidate.rank || candidates.indexOf(candidate) + 1}`;
      for (let i = 0; i < count; i++) {
        const tracked = await page.evaluate(async ({ name, seed, key }) => {
          const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode();
          const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192);
          return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.track(c, seed, 1, key);
        }, { name: frames[i].minimap, seed: dynamic, key });
        if (!tracked) throw new Error(`mosaic candidate tracking failed count=${count} rank=${candidate.rank} frame=${i + 1}`);
        sequence.push({ frame: i + 1, ...tracked }); dynamic = { ...dynamic, x: tracked.globalX, y: tracked.globalY, radius: tracked.radius, angle: tracked.angle };
      }
      const consistency = scoreTrackAgainstFlow(sequence, flows.slice(0, count));
      const seqScore = sequenceScore(candidate, consistency);
      hypotheses.push({ candidate, sequenceScore: seqScore, consistency, basinAnchor: sequence[0] ? { x: sequence[0].globalX, y: sequence[0].globalY, angle: sequence[0].angle, radius: sequence[0].radius } : null, trackedSequence: sequence });
    }
    hypotheses.sort((a, b) => b.sequenceScore - a.sequenceScore);
    const best = hypotheses[0];
    observations.push({
      frameCount: count,
      fixtureDurationMs: (count - 1) * Number(capture.intervalMs || 200),
      coverage: { ...mosaic.coverage, supportBoundsSourceMinimapPx: { width: mosaic.coverage.supportBoundsWorkPx.width * SOURCE_PER_WORK, height: mosaic.coverage.supportBoundsWorkPx.height * SOURCE_PER_WORK }, centerPathSpanSourceMinimapPx: { x: mosaic.coverage.centerPathSpanWorkPx.x * SOURCE_PER_WORK, y: mosaic.coverage.centerPathSpanWorkPx.y * SOURCE_PER_WORK } },
      visuals: saved,
      topKRaw: candidates,
      topKSequenceRanked: hypotheses,
      bestSequenceHypothesis: best
    });
  }

  const bestBySize = observations.map(o => ({ frameCount: o.frameCount, ...o.bestSequenceHypothesis }));
  const recurrence = [];
  for (let i = 1; i < bestBySize.length; i++) {
    const a = bestBySize[i - 1], b = bestBySize[i], aa = a.basinAnchor, bb = b.basinAnchor;
    const distance = aa && bb ? hypot(bb.x - aa.x, bb.y - aa.y) : null, ad = aa && bb ? angleDelta(bb.angle, aa.angle) : null, sd = aa && bb ? Math.abs(Math.log((bb.radius || 1) / (aa.radius || 1))) : null;
    recurrence.push({ fromFrames: a.frameCount, toFrames: b.frameCount, basinAnchorDistance: distance, angleDeltaDeg: ad, scaleLogDelta: sd, samePhysicalBasin: Number.isFinite(distance) && distance <= 120 && ad <= 25 && sd <= .20 });
  }
  const lateRecurrence = recurrence.filter(r => r.toFrames >= 10), lateRecurrenceRate = lateRecurrence.length ? lateRecurrence.filter(r => r.samePhysicalBasin).length / lateRecurrence.length : null;

  const full = observations.find(o => o.frameCount === 40), fullBest = full.bestSequenceHypothesis;
  const naturalNegatives = full.topKSequenceRanked.slice(1).filter(h => {
    if (!h.basinAnchor || !fullBest.basinAnchor) return true;
    return hypot(h.basinAnchor.x - fullBest.basinAnchor.x, h.basinAnchor.y - fullBest.basinAnchor.y) > 120 || angleDelta(h.basinAnchor.angle, fullBest.basinAnchor.angle) > 25 || Math.abs(Math.log((h.basinAnchor.radius || 1) / (fullBest.basinAnchor.radius || 1))) > .20;
  }).map(h => ({ kind: 'visually-similar-terrain-elsewhere-or-neighbor-basin', ...h }));

  const generatedSpecs = [
    ['neighboring-basin+x', { x: 140, y: 0, angle: 0, scale: 1 }], ['neighboring-basin-x', { x: -140, y: 0, angle: 0, scale: 1 }],
    ['neighboring-basin+y', { x: 0, y: 140, angle: 0, scale: 1 }], ['neighboring-basin-y', { x: 0, y: -140, angle: 0, scale: 1 }],
    ['wrong-rotation+45', { x: 0, y: 0, angle: 45, scale: 1 }], ['wrong-rotation+90', { x: 0, y: 0, angle: 90, scale: 1 }],
    ['wrong-scale-0.82', { x: 0, y: 0, angle: 0, scale: .82 }], ['wrong-scale-1.18', { x: 0, y: 0, angle: 0, scale: 1.18 }]
  ];
  const generatedNegatives = [];
  const base = fullBest.candidate;
  for (const [kind, spec] of generatedSpecs) {
    let dynamic = { ...base, x: base.x + spec.x, y: base.y + spec.y, angle: ((base.angle + spec.angle) % 360 + 360) % 360, radius: base.radius * spec.scale };
    const seq = [], key = `hard-negative:${kind}`;
    for (let i = 0; i < 40; i++) {
      const tracked = await page.evaluate(async ({ name, seed, key }) => {
        const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode(); const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192);
        return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.track(c, seed, 1, key);
      }, { name: frames[i].minimap, seed: dynamic, key });
      if (!tracked) break; seq.push({ frame: i + 1, ...tracked }); dynamic = { ...dynamic, x: tracked.globalX, y: tracked.globalY, radius: tracked.radius, angle: tracked.angle };
    }
    if (seq.length === 40) {
      const candidate = { ...base, ...seq[0], x: seq[0].globalX, y: seq[0].globalY, radius: seq[0].radius, angle: seq[0].angle, combinedScore: seq[0].combinedScore, scaleScore: seq[0].scaleScore, topology: seq[0].topology, terrainPolarity: seq[0].terrainPolarity };
      const consistency = scoreTrackAgainstFlow(seq, flows), seqScore = sequenceScore(candidate, consistency);
      generatedNegatives.push({ kind, candidate, sequenceScore: seqScore, consistency, basinAnchor: { x: seq[0].globalX, y: seq[0].globalY, angle: seq[0].angle, radius: seq[0].radius } });
    }
  }

  const hardNegatives = [...naturalNegatives, ...generatedNegatives];
  const negativeScores = hardNegatives.map(h => h.sequenceScore).filter(Number.isFinite), maxNegative = negativeScores.length ? Math.max(...negativeScores) : null, sequenceSeparation = Number.isFinite(maxNegative) ? fullBest.sequenceScore - maxNegative : null;
  const topologyNear = naturalNegatives.filter(h => Math.abs((h.candidate?.topology ?? 0) - (fullBest.candidate?.topology ?? 0)) <= .08).map(h => h.candidate);
  const edgeNear = naturalNegatives.filter(h => Math.abs((h.candidate?.positiveEdgeScore ?? 0) - (fullBest.candidate?.positiveEdgeScore ?? 0)) <= .08).map(h => h.candidate);
  const structureNear = naturalNegatives.filter(h => Math.abs((h.candidate?.scaleScore ?? 0) - (fullBest.candidate?.scaleScore ?? 0)) <= .04).map(h => h.candidate);

  const c = fullBest.consistency, positiveSeparation = Number.isFinite(sequenceSeparation) && sequenceSeparation > 0;
  const trueLike = c.samePhysicalBasinStable && (c.meanDirectionCosine ?? -1) >= .55 && (c.endpointErrorRatio == null || c.endpointErrorRatio <= .75) && (lateRecurrenceRate ?? 0) >= .66 && positiveSeparation && fullBest.sequenceScore >= .52;
  const recallVerdict = trueLike ? 'TRUE-LIKE-CANDIDATE-SURFACED' : 'NO-TRUE-LIKE-CANDIDATE';
  const failureStage = trueLike ? 'production-integration-not-applied-diagnostic-only' : 'candidate-generation-temporal-mosaic-top-k';

  const report = {
    schema: 'wwmsync-real-gfn-temporal-mosaic-v1',
    generatedAtUtc: new Date().toISOString(),
    fixture: { basename: 'wwmsync-gfn-motion-20260810-143835.zip', sha256: EXPECTED_SHA, frameCount: frames.length, fps: capture.fps, intervalMs: capture.intervalMs, sourceDimensions: capture.screen, capturedMinimapRoi: capture.minimapRoi, replayWorkCanvas: { width: WORK, height: WORK, sourceCrop: CAPTURED_MINIMAP } },
    architecture: { productionRuntimeChanged: false, productionGateLowered: false, structuralGate: .58, scope: 'replay-only temporal mosaic candidate-generation experiment', frameAlignment: 'integrated accepted production optical flow', worldAlignmentSign: 'frame center += (-terrain dx, -terrain dy)', genericMasksOnly: true },
    flowIntegration,
    representations: ['robust-luminance-trimmed-mean', 'gradient-magnitude-accumulation', 'positive-edge-occupancy', 'quiet-negative-space-occupancy', 'signed-edge-polarity-confidence', 'temporal-variance-mask', 'combined-variance-suppressed-structural'],
    observations,
    topKEvolution: observations.map(o => ({ frameCount: o.frameCount, coverage: o.coverage, rawCandidates: o.topKRaw, sequenceRanked: o.topKSequenceRanked.map(h => ({ candidate: h.candidate, sequenceScore: h.sequenceScore, basinAnchor: h.basinAnchor, consistency: { samePhysicalBasinStable: h.consistency.samePhysicalBasinStable, meanDirectionCosine: h.consistency.meanDirectionCosine, endpointDirectionCosine: h.consistency.endpointDirectionCosine, endpointDisplacementError: h.consistency.endpointDisplacementError, endpointErrorRatio: h.consistency.endpointErrorRatio, angleStability: h.consistency.angleStability, scaleStability: h.consistency.scaleStability, cumulativeResidual: h.consistency.cumulativeResidual } })) })),
    crossObservationBasinStability: { transitions: recurrence, lateRecurrenceRate },
    hardNegativeCalibration: { hardNegatives, maxHardNegativeSequenceScore: maxNegative, bestSequenceScore: fullBest.sequenceScore, positiveSequenceSeparation: sequenceSeparation, topologySimilarNegatives: topologyNear, roadEdgePatternSimilarNegatives: edgeNear, structureSimilarNegatives: structureNear },
    trueCandidateRecallVerdict: recallVerdict,
    exactRemainingFailureStage: failureStage,
    productChangeJustified: trueLike,
    productChangeRecommendation: trueLike ? 'Integrate a short temporal mosaic before global absolute search, preserving existing single-frame gates and requiring sequence-level positive separation before accepting lock.' : 'Do not modify production runtime. Temporal mosaic still failed to surface a sequence-consistent positively-separated TRUE-LIKE candidate; next work is invariant structural indexing / candidate recall.',
    realGfnFixtureAcceptance: { status: 'FAIL', reason: trueLike ? 'Diagnostic evidence may justify product integration, but no production absolute lock/AUTO matrix was applied in this replay-only run.' : 'No TRUE-LIKE candidate surfaced from the full 40-frame temporal mosaic.' },
    liveTestingJustified: false
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: reportPath, recallVerdict, failureStage, acceptedFlowSteps: flowIntegration.acceptedSteps, fullCoverageSourceMinimapPx: full.coverage.supportBoundsSourceMinimapPx, bestSequenceScore: fullBest.sequenceScore, hardNegativeMax: maxNegative, sequenceSeparation, flowMeanCosine: c.meanDirectionCosine, endpointErrorRatio: c.endpointErrorRatio, lateRecurrenceRate, productChangeJustified: trueLike, realGfnFixture: 'FAIL', liveTestingJustified: false }, null, 2));
} finally {
  if (browser) await browser.close();
  server.close();
}
