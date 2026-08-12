#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const siteDir = path.resolve(arg('--site') || 'replay-site');
const fixtureDir = path.resolve(arg('--fixture') || 'real-fixture');
const observationPath = path.resolve(arg('--observation') || 'replay-output/temporal-mosaic-visuals/40-frames-combinedStructural.png');
const reportPath = path.resolve(arg('--report') || 'replay-output/wwmsync-real-gfn-invariant-index.json');
const TOP_K = Math.max(3, Math.min(8, Number(arg('--top-k')) || 8));

const parseJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const quantile = (values, q) => { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return lo === hi ? a[lo] : a[lo] * (hi - p) + a[hi] * (p - lo); };
const stats = values => { const a = values.filter(Number.isFinite), m = mean(a); return { n: a.length, min: a.length ? Math.min(...a) : null, median: quantile(a, .5), mean: m, p90: quantile(a, .9), max: a.length ? Math.max(...a) : null, std: a.length && m != null ? Math.sqrt(mean(a.map(v => (v - m) ** 2))) : null }; };
const hypot = (x, y) => Math.hypot(Number(x) || 0, Number(y) || 0);
const angleDelta = (a, b) => Math.abs((((Number(a) - Number(b)) + 540) % 360) - 180);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cosine = (ax, ay, bx, by) => { const am = hypot(ax, ay), bm = hypot(bx, by); return am > .05 && bm > .05 ? clamp((ax * bx + ay * by) / (am * bm), -1, 1) : null; };
const mime = p => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(p).toLowerCase()] || 'application/octet-stream');

function startServer() {
  const observationDir = path.dirname(observationPath), observationName = path.basename(observationPath);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1'); let root, rel;
    if (url.pathname.startsWith('/fixture/')) { root = fixtureDir; rel = decodeURIComponent(url.pathname.slice('/fixture/'.length)) || 'capture.json'; }
    else if (url.pathname === '/observation.png') { root = observationDir; rel = observationName; }
    else { root = siteDir; rel = decodeURIComponent(url.pathname.slice(1)) || 'index.html'; }
    const rootAbs = path.resolve(root), file = path.resolve(root, rel);
    if ((!file.startsWith(rootAbs + path.sep) && file !== rootAbs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(file.startsWith(rootAbs) ? 404 : 403).end(); return; }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function scoreTrackAgainstFlow(sequence, flows) {
  let actualX = 0, actualY = 0, predX = 0, predY = 0; const residuals = [], cosines = [], steps = [];
  for (let i = 1; i < sequence.length; i++) {
    const prev = sequence[i - 1], cur = sequence[i], flow = flows[i] || {}, adx = cur.globalX - prev.globalX, ady = cur.globalY - prev.globalY;
    let pdx = 0, pdy = 0;
    if (flow.accepted) {
      const r = (Number(prev.angle) || 0) * Math.PI / 180, c = Math.cos(r), s = Math.sin(r), scale = (Number(prev.radius) || 96) / 96;
      const playerX = -(Number(flow.dx) || 0), playerY = -(Number(flow.dy) || 0);
      pdx = (playerX * c - playerY * s) * scale; pdy = (playerX * s + playerY * c) * scale; predX += pdx; predY += pdy;
    }
    actualX += adx; actualY += ady; const dc = flow.accepted ? cosine(adx, ady, pdx, pdy) : null;
    if (Number.isFinite(dc) && hypot(adx, ady) > .05 && hypot(pdx, pdy) > .05) cosines.push(dc);
    const residual = hypot(actualX - predX, actualY - predY); residuals.push(residual); steps.push({ frame: i + 1, actual: { dx: adx, dy: ady }, predicted: { dx: pdx, dy: pdy }, directionCosine: dc, residual, flowAccepted: !!flow.accepted, flowScore: flow.score ?? null });
  }
  const predMag = hypot(predX, predY), endpointError = hypot(actualX - predX, actualY - predY), angles = sequence.map(s => s.angle).filter(Number.isFinite), radii = sequence.map(s => s.radius).filter(r => Number.isFinite(r) && r > 0), angleMax = angles.length ? Math.max(...angles.map(a => angleDelta(a, angles[0]))) : null, scaleMax = radii.length ? Math.max(...radii.map(r => Math.abs(r / radii[0] - 1))) : null;
  const meanCos = mean(cosines), endpointRatio = predMag > 1 ? endpointError / predMag : null;
  const stable = cosines.length >= 10 && (meanCos ?? -1) >= .55 && (endpointRatio == null || endpointRatio <= .75) && (angleMax ?? 999) <= 25 && (scaleMax ?? 999) <= .20;
  return { validDirectionSteps: cosines.length, meanDirectionCosine: meanCos, medianDirectionCosine: quantile(cosines, .5), endpointDirectionCosine: cosine(actualX, actualY, predX, predY), actualEndDisplacement: { dx: actualX, dy: actualY, magnitude: hypot(actualX, actualY) }, predictedEndDisplacement: { dx: predX, dy: predY, magnitude: predMag }, endpointDisplacementError: endpointError, endpointErrorRatio: endpointRatio, residual: stats(residuals), angleStability: { maxDeltaFromStartDeg: angleMax }, scaleStability: { maxRelativeDeltaFromStart: scaleMax }, samePhysicalBasinStable: stable, steps };
}

function sequenceScore(candidate, c) {
  const dir = Number.isFinite(c.meanDirectionCosine) ? (c.meanDirectionCosine + 1) / 2 : 0, endpointFit = Math.exp(-c.endpointDisplacementError / Math.max(18, c.predictedEndDisplacement.magnitude || 18)), angleFit = Math.exp(-(c.angleStability.maxDeltaFromStartDeg ?? 180) / 25), scaleFit = Math.exp(-(c.scaleStability.maxRelativeDeltaFromStart ?? 1) / .15);
  return clamp(.24 * (candidate.combined || 0) + .18 * (candidate.structure || 0) + .08 * (candidate.topology || 0) + .08 * (candidate.invariantScore || 0) + .20 * dir + .12 * endpointFit + .05 * angleFit + .05 * scaleFit, 0, 1);
}

if (!fs.existsSync(observationPath)) throw new Error(`missing temporal mosaic observation: ${observationPath}`);
const capture = parseJson(path.join(fixtureDir, 'capture.json'));
const frames = (capture.frames || []).map(x => ({ ...x, minimap: x.minimap || x.minimapFile || x.cropFile }));
if (frames.length !== 40) throw new Error(`expected 40 frames, got ${frames.length}`);
fs.mkdirSync(path.dirname(reportPath), { recursive: true });

const { server, port } = await startServer(); let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[invariant index pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[invariant index console]', m.text()); });
  const response = await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`diagnostic site HTTP ${response?.status()}`);
  await page.waitForFunction(() => window.__WWMSYNC_REAL_GFN_INVARIANT_INDEX__ && window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__, null, { timeout: 60_000 });
  await page.evaluate(() => { window.__WWMSYNC_REAL_GFN_INVARIANT_INDEX__.reset(); window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset(); });

  const search = await page.evaluate(async topK => {
    const img = new Image(); img.decoding = 'sync'; img.src = '/observation.png'; await img.decode(); const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0); return window.__WWMSYNC_REAL_GFN_INVARIANT_INDEX__.search(c, 1, topK);
  }, TOP_K);
  if (!search?.candidates?.length) throw new Error('invariant structural index produced no refined candidates');

  const flows = [];
  await page.evaluate(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset());
  for (let i = 0; i < 40; i++) {
    const flow = await page.evaluate(async ({ name, reset }) => { const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode(); const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192); return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.flow(c, reset); }, { name: frames[i].minimap, reset: i === 0 });
    flows.push(flow || { accepted: false, dx: 0, dy: 0, reason: 'flow-unavailable' });
  }

  const hypotheses = [];
  for (const candidate of search.candidates.slice(0, TOP_K)) {
    let seed = { x: candidate.x, y: candidate.y, radius: candidate.radius, angle: candidate.angle }, sequence = [], key = `invariant-${candidate.rank}`;
    for (let i = 0; i < 40; i++) {
      const tracked = await page.evaluate(async ({ name, seed, key }) => { const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode(); const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192); return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.track(c, seed, 1, key); }, { name: frames[i].minimap, seed, key });
      if (!tracked) throw new Error(`invariant candidate rank ${candidate.rank} tracking failed frame ${i + 1}`);
      sequence.push({ frame: i + 1, ...tracked }); seed = { x: tracked.globalX, y: tracked.globalY, radius: tracked.radius, angle: tracked.angle };
    }
    const consistency = scoreTrackAgainstFlow(sequence, flows), score = sequenceScore(candidate, consistency);
    hypotheses.push({ candidate, sequenceScore: score, consistency, basinAnchor: { x: sequence[0].globalX, y: sequence[0].globalY, radius: sequence[0].radius, angle: sequence[0].angle }, trackedSequence: sequence });
  }
  hypotheses.sort((a, b) => b.sequenceScore - a.sequenceScore);
  const best = hypotheses[0], distinctNegatives = hypotheses.slice(1).filter(h => hypot(h.basinAnchor.x - best.basinAnchor.x, h.basinAnchor.y - best.basinAnchor.y) > 120 || angleDelta(h.basinAnchor.angle, best.basinAnchor.angle) > 25 || Math.abs(Math.log((h.basinAnchor.radius || 1) / (best.basinAnchor.radius || 1))) > .20), maxNegative = distinctNegatives.length ? Math.max(...distinctNegatives.map(h => h.sequenceScore)) : null, separation = Number.isFinite(maxNegative) ? best.sequenceScore - maxNegative : null;
  const trueLike = best.consistency.samePhysicalBasinStable && Number.isFinite(separation) && separation > 0 && best.sequenceScore >= .55;
  const report = {
    schema: 'wwmsync-real-gfn-invariant-index-replay-v1', generatedAtUtc: new Date().toISOString(), fixture: { frameCount: frames.length, fps: capture.fps, intervalMs: capture.intervalMs },
    scope: { replayOnly: true, productRuntimeChanged: false, productionGateLowered: false, knownFalseCandidateOptimized: false },
    invariantIndex: search.index, sourceDescriptor: search.source, coarseTop: search.coarseTop,
    refinedTopK: search.candidates,
    sequenceRankedTopK: hypotheses,
    hardNegativeSeparation: { distinctNegativeCount: distinctNegatives.length, bestSequenceScore: best.sequenceScore, maxDistinctNegativeSequenceScore: maxNegative, positiveSeparation: separation },
    candidateRecallVerdict: trueLike ? 'TRUE-LIKE-CANDIDATE-SURFACED' : 'NO-TRUE-LIKE-CANDIDATE',
    exactRemainingFailureStage: trueLike ? 'production-integration-not-applied-diagnostic-only' : 'invariant-structural-index-candidate-recall',
    productChangeJustified: trueLike,
    productChangeRecommendation: trueLike ? 'Evidence supports evaluating invariant structural indexing as the global candidate-recall front-end before the unchanged fine matcher and gates.' : 'Do not modify production runtime. Even invariant structural candidate recall did not yield a sequence-consistent, positively-separated TRUE-LIKE basin on the exact real GFN fixture.',
    realGfnFixtureAcceptance: { status: 'FAIL', reason: trueLike ? 'Candidate recall diagnostic succeeded but no production absolute lock/AUTO matrix/periodic correction was applied.' : 'No TRUE-LIKE candidate surfaced after temporal mosaic plus invariant structural indexing.' },
    liveTestingJustified: false
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: reportPath, indexEntries: search.index.entryCount, descriptorDimensions: search.index.descriptorDimensions, candidateRecallVerdict: report.candidateRecallVerdict, best: { rank: best.candidate.rank, x: best.candidate.x, y: best.candidate.y, angle: best.candidate.angle, radius: best.candidate.radius, invariantScore: best.candidate.invariantScore, structure: best.candidate.structure, topology: best.candidate.topology, ncc: best.candidate.ncc, combined: best.candidate.combined, sequenceScore: best.sequenceScore, directionCosine: best.consistency.meanDirectionCosine, endpointErrorRatio: best.consistency.endpointErrorRatio, angleMaxDelta: best.consistency.angleStability.maxDeltaFromStartDeg, scaleMaxRelativeDelta: best.consistency.scaleStability.maxRelativeDeltaFromStart, stable: best.consistency.samePhysicalBasinStable }, hardNegativeSeparation: separation, productChangeJustified: trueLike, realGfnFixture: 'FAIL', liveTestingJustified: false }, null, 2));
} finally { if (browser) await browser.close(); server.close(); }
