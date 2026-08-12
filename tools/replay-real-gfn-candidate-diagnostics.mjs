#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const siteDir = path.resolve(arg('--site') || 'replay-site');
const fixtureDir = path.resolve(arg('--fixture') || 'real-fixture');
const productionReportPath = path.resolve(arg('--production-report') || 'replay-output/wwmsync-real-gfn-production-replay.json');
const reportPath = path.resolve(arg('--report') || 'replay-output/wwmsync-real-gfn-candidate-diagnostics.json');
const visualDir = path.resolve(arg('--visual-dir') || 'replay-output/candidate-visuals');

const parseJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const ensureDir = p => fs.mkdirSync(p, { recursive: true });
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const variance = a => { const m = mean(a); return m == null ? null : mean(a.map(v => (v - m) ** 2)); };
const std = a => { const v = variance(a); return v == null ? null : Math.sqrt(v); };
const hypot = (x, y) => Math.hypot(Number(x) || 0, Number(y) || 0);
const angleDelta = (a, b) => Math.abs((((a - b) + 540) % 360) - 180);
const quantile = (values, q) => { const a = values.filter(Number.isFinite).sort((x, y) => x - y); if (!a.length) return null; const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p); return lo === hi ? a[lo] : a[lo] * (hi - p) + a[hi] * (p - lo); };
const stats = values => { const a = values.filter(Number.isFinite); return { n: a.length, min: a.length ? Math.min(...a) : null, p10: quantile(a, .10), median: quantile(a, .50), mean: mean(a), p90: quantile(a, .90), max: a.length ? Math.max(...a) : null, std: std(a) }; };
const pearson = (a, b) => { const pairs = a.map((x, i) => [x, b[i]]).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)); if (pairs.length < 3) return null; const ma = mean(pairs.map(p => p[0])), mb = mean(pairs.map(p => p[1])); let ab = 0, aa = 0, bb = 0; for (const [x, y] of pairs) { const dx = x - ma, dy = y - mb; ab += dx * dy; aa += dx * dx; bb += dy * dy; } return aa > 0 && bb > 0 ? ab / Math.sqrt(aa * bb) : null; };
const mime = p => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(p).toLowerCase()] || 'application/octet-stream');

function startServer() {
  const roots = { '/fixture/': fixtureDir, '/': siteDir };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = url.pathname.startsWith('/fixture/') ? '/fixture/' : '/';
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || (prefix === '/' ? 'index.html' : 'capture.json');
    const root = roots[prefix], rootAbs = path.resolve(root), file = path.resolve(root, rel);
    if ((!file.startsWith(rootAbs + path.sep) && file !== rootAbs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(file.startsWith(rootAbs) ? 404 : 403).end(); return; }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' }); fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function saveDataUrl(dataUrl, file) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl); if (!m) throw new Error('unexpected visualization data URL');
  ensureDir(path.dirname(file)); fs.writeFileSync(file, Buffer.from(m[1], 'base64')); return file;
}

function distribution(records, key) { return stats(records.map(r => r?.[key])); }
function sep(trueRecords, negativeRecords, key) {
  const t = trueRecords.map(r => r?.[key]).filter(Number.isFinite), n = negativeRecords.map(r => r?.[key]).filter(Number.isFinite);
  return { true: stats(t), hardNegatives: stats(n), conservativeGap: t.length && n.length ? quantile(t, .10) - quantile(n, .90) : null, meanGap: t.length && n.length ? mean(t) - mean(n) : null };
}

const capture = parseJson(path.join(fixtureDir, 'capture.json'));
const frames = (capture.frames || []).map(x => ({ ...x, minimap: x.minimap || x.minimapFile || x.cropFile }));
if (frames.length !== 40) throw new Error(`expected 40 frames, got ${frames.length}`);
const production = parseJson(productionReportPath);
const globalFrames = (production.frames || []).filter(f => Array.isArray(f.alternatives) && f.alternatives.length);
if (!globalFrames.length) throw new Error('production report has no replay alternatives; diagnostic instrumentation did not capture TOP-K');
const firstGlobal = globalFrames[0], seed0 = firstGlobal.alternatives[0];
if (!seed0 || !Number.isFinite(seed0.x) || !Number.isFinite(seed0.y) || !Number.isFinite(seed0.radius)) throw new Error('first global TOP-1 seed incomplete');

ensureDir(path.dirname(reportPath)); ensureDir(visualDir);
const { server, port } = await startServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[candidate diag pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[candidate diag console]', m.text()); });
  const response = await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`diagnostic site HTTP ${response?.status()}`);
  await page.waitForFunction(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__ && window.__WWMSYNC_VISION_TEST__, null, { timeout: 60_000 });
  await page.evaluate(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset());

  const evalFrame = async (index, seed, resetFlow = false) => page.evaluate(async ({ name, seed, resetFlow }) => {
    const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode();
    const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192);
    const d = window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__;
    const track = await d.track(c, seed, 1, 'primary'); const flow = d.flow(c, resetFlow); return { track, flow };
  }, { name: frames[index - 1].minimap, seed, resetFlow });

  const tracked = [];
  let seed = { ...seed0 };
  for (let i = 1; i <= frames.length; i++) {
    const out = await evalFrame(i, seed, i === 1);
    if (!out?.track) throw new Error(`candidate tracking failed at frame ${i}`);
    tracked.push({ frame: i, fixtureTimeMs: (i - 1) * capture.intervalMs, source: frames[i - 1].minimap, ...out.track, opticalFlow: out.flow });
    seed = { ...seed, x: out.track.globalX, y: out.track.globalY, radius: out.track.radius, angle: out.track.angle };
  }

  const stepComparisons = [];
  let predX = 0, predY = 0, actualX = 0, actualY = 0;
  const cumulative = [{ frame: 1, actualX: 0, actualY: 0, predictedX: 0, predictedY: 0 }];
  for (let i = 1; i < tracked.length; i++) {
    const prev = tracked[i - 1], cur = tracked[i], flow = cur.opticalFlow || {}, adx = cur.globalX - prev.globalX, ady = cur.globalY - prev.globalY;
    const rad = (prev.angle || 0) * Math.PI / 180, c = Math.cos(rad), s = Math.sin(rad), scale = (prev.radius || seed0.radius) / 96, playerX = -(Number(flow.dx) || 0), playerY = -(Number(flow.dy) || 0), pdx = (playerX * c - playerY * s) * scale, pdy = (playerX * s + playerY * c) * scale;
    const am = hypot(adx, ady), pm = hypot(pdx, pdy), cosine = am > .05 && pm > .05 ? (adx * pdx + ady * pdy) / (am * pm) : null;
    actualX += adx; actualY += ady; predX += pdx; predY += pdy;
    cumulative.push({ frame: cur.frame, actualX, actualY, predictedX: predX, predictedY: predY });
    stepComparisons.push({ frame: cur.frame, actual: { dx: adx, dy: ady, magnitude: am }, predictedFromOpticalFlow: { dx: pdx, dy: pdy, magnitude: pm }, cosine, flow: { dx: flow.dx ?? null, dy: flow.dy ?? null, score: flow.score ?? null, accepted: !!flow.accepted, reason: flow.reason ?? null, representation: flow.representation ?? null } });
  }
  const validCosines = stepComparisons.filter(x => Number.isFinite(x.cosine) && (x.flow.score == null || x.flow.score >= .65)).map(x => x.cosine);
  const endpointError = hypot(actualX - predX, actualY - predY);
  const flowConsistency = {
    validStepCount: validCosines.length, meanDirectionCosine: mean(validCosines), medianDirectionCosine: quantile(validCosines, .50),
    actualEndDisplacement: { dx: actualX, dy: actualY, magnitude: hypot(actualX, actualY) }, predictedEndDisplacement: { dx: predX, dy: predY, magnitude: hypot(predX, predY) }, endpointError,
    xCorrelation: pearson(cumulative.map(x => x.actualX), cumulative.map(x => x.predictedX)), yCorrelation: pearson(cumulative.map(x => x.actualY), cumulative.map(x => x.predictedY)),
    stepActualMagnitude: stats(stepComparisons.map(x => x.actual.magnitude)), stepPredictedMagnitude: stats(stepComparisons.map(x => x.predictedFromOpticalFlow.magnitude))
  };

  const firstPos = tracked[0], trackAngles = tracked.map(x => x.angle), trackRadii = tracked.map(x => x.radius), stepDistances = stepComparisons.map(x => x.actual.magnitude);
  const positionCluster = { maxDistanceFromFrame1: Math.max(...tracked.map(x => hypot(x.globalX - firstPos.globalX, x.globalY - firstPos.globalY))), stepDistance: stats(stepDistances), xRange: Math.max(...tracked.map(x => x.globalX)) - Math.min(...tracked.map(x => x.globalX)), yRange: Math.max(...tracked.map(x => x.globalY)) - Math.min(...tracked.map(x => x.globalY)) };
  const angleStability = { meanDeg: mean(trackAngles), stdDegLinear: std(trackAngles.map(a => { let d = ((a - trackAngles[0] + 540) % 360) - 180; return d; })), maxDeltaFromStartDeg: Math.max(...trackAngles.map(a => angleDelta(a, trackAngles[0]))) };
  const scaleStability = { radius: stats(trackRadii), logStd: std(trackRadii.map(r => Math.log(r))), maxRelativeDeltaFromStart: Math.max(...trackRadii.map(r => Math.abs(r / trackRadii[0] - 1))) };

  const globalRecurrence = globalFrames.slice(1).map(g => {
    const t = tracked[g.frame - 1]; const ranked = (g.alternatives || []).map(c => ({ ...c, distanceToTrackedBasin: hypot(c.x - t.globalX, c.y - t.globalY), angleDeltaToTracked: angleDelta(c.angle, t.angle), scaleLogDeltaToTracked: Math.abs(Math.log((c.radius || 1) / (t.radius || 1))) })).sort((a, b) => a.distanceToTrackedBasin - b.distanceToTrackedBasin); const nearest = ranked[0] || null;
    return { frame: g.frame, fixtureTimeMs: g.fixtureTimeMs, globalWinner: g.alternatives?.[0] || null, nearestTrackedBasinCandidate: nearest, sameBasin: !!nearest && nearest.distanceToTrackedBasin <= 120 && nearest.angleDeltaToTracked <= 25 && nearest.scaleLogDeltaToTracked <= .20 };
  });
  const sameBasinRecurrenceRate = globalRecurrence.length ? globalRecurrence.filter(x => x.sameBasin).length / globalRecurrence.length : null;

  const firstFrameCanvasScore = async (candidate, key) => page.evaluate(async ({ name, candidate, key }) => {
    const img = new Image(); img.src = `/fixture/${name}`; await img.decode(); const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192); return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.scoreFixed(c, candidate, 1, key);
  }, { name: frames[0].minimap, candidate, key });

  const generatedNegatives = [
    ['nearby+x', { ...seed0, x: seed0.x + 140 }], ['nearby-x', { ...seed0, x: seed0.x - 140 }], ['nearby+y', { ...seed0, y: seed0.y + 140 }], ['nearby-y', { ...seed0, y: seed0.y - 140 }],
    ['wrong-rotation+45', { ...seed0, angle: (seed0.angle + 45) % 360 }], ['wrong-rotation+90', { ...seed0, angle: (seed0.angle + 90) % 360 }],
    ['wrong-scale-0.82', { ...seed0, radius: seed0.radius * .82 }], ['wrong-scale-1.18', { ...seed0, radius: seed0.radius * 1.18 }]
  ];
  const generatedNegativeScores = [];
  for (const [kind, candidate] of generatedNegatives) generatedNegativeScores.push({ kind, sourceFrame: 1, candidate, ...(await firstFrameCanvasScore(candidate, `neg:${kind}`)) });
  const beamNegatives = globalFrames.flatMap(g => (g.alternatives || []).slice(1).map(c => ({ kind: 'neighboring-structural-basin', sourceFrame: g.frame, ...c })));
  const hardNegatives = [...beamNegatives, ...generatedNegativeScores];
  const hypothesisFrames = [1, 10, 20, 30, 40].map(i => ({ kind: 'tracked-hypothesis', sourceFrame: i, ...tracked[i - 1] }));
  const separation = {
    scaleAwareStructure: sep(hypothesisFrames, hardNegatives, 'scaleScore'),
    ncc: sep(hypothesisFrames, hardNegatives, 'intensityNcc'),
    combinedScore: sep(hypothesisFrames, hardNegatives, 'combinedScore'),
    beamMargin: sep(globalFrames.map(g => g.alternatives?.[0]).filter(Boolean), beamNegatives, 'beamMargin')
  };

  const ablation = await page.evaluate(async ({ name, candidate }) => {
    const img = new Image(); img.src = `/fixture/${name}`; await img.decode(); const c = document.createElement('canvas'); c.width = 192; c.height = 192; c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192); return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.ablate(c, candidate, 1);
  }, { name: frames[0].minimap, candidate: seed0 });
  const bestDelta = kind => Math.max(...(ablation.variants || []).filter(v => v.kind === kind).map(v => Number(v.delta) || 0), 0);
  const structuralLossBreakdown = {
    baseline: ablation.baseline,
    normalizedContrast: ablation.normalizedContrast, featureCount: ablation.featureCount,
    translucentWorldBackground: { proxy: 'high-pass phase vs raw scale-aware', phaseScore: ablation.phaseScore, baselineScore: ablation.baseline.score, delta: ablation.phaseScore - ablation.baseline.score },
    circularMinimapEdgeMask: { bestOuterMaskGain: bestDelta('outer-mask') },
    centerPlayerHudContamination: { bestInnerMaskGain: bestDelta('inner-mask') },
    terrainEdgePolarity: { signAgreement: ablation.baseline.sign, topology: ablation.baseline.topology },
    roadWaterLineThickness: { bestEdgeOffsetGain: bestDelta('edge-offset'), bestWideContextGain: bestDelta('wide-context') },
    rasterScaleMismatch: { bestRadiusScaleGain: bestDelta('radius-scale') },
    antialiasingCompressionGfnBlur: { bestSourceBlurGain: bestDelta('source-blur-px') },
    rotationInterpolation: { bestRotationOffsetGain: bestDelta('rotation-offset-deg') },
    annulusWeighting: { bestInnerMaskGain: bestDelta('inner-mask'), bestOuterMaskGain: bestDelta('outer-mask') },
    supportingScores: { denseScore: ablation.denseScore, contourScore: ablation.contourScore, contourRecall: ablation.contourRecall, contourPrecision: ablation.contourPrecision, intensityScore: ablation.intensityScore, intensityNcc: ablation.intensityNcc },
    variants: ablation.variants
  };

  const visualRecords = [];
  for (const c of firstGlobal.alternatives.slice(0, 3)) {
    const visual = await page.evaluate(async ({ name, candidate }) => {
      const img = new Image(); img.src = `/fixture/${name}`; await img.decode(); const cv = document.createElement('canvas'); cv.width = 192; cv.height = 192; cv.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192); return window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.visualize(cv, candidate, 1);
    }, { name: frames[firstGlobal.frame - 1].minimap, candidate: c });
    const rank = c.rank || firstGlobal.alternatives.indexOf(c) + 1, base = `frame-${String(firstGlobal.frame).padStart(3, '0')}-candidate-${rank}`;
    if (rank === 1 && visual.normalized) visualRecords.push({ frame: firstGlobal.frame, rank, kind: 'normalized-real-minimap', path: saveDataUrl(visual.normalized, path.join(visualDir, `frame-${String(firstGlobal.frame).padStart(3, '0')}-normalized-real-minimap.png`)) });
    for (const [kind, data] of [['dashen-patch', visual.patch], ['source-structural-edges', visual.sourceEdges], ['candidate-structural-edges', visual.candidateEdges], ['overlay-alignment', visual.overlay], ['positive-negative-evidence', visual.evidence], ['disagreement-regions', visual.disagreement]]) visualRecords.push({ frame: firstGlobal.frame, rank, kind, path: saveDataUrl(data, path.join(visualDir, `${base}-${kind}.png`)), candidate: c });
  }

  const structureGap = separation.scaleAwareStructure.conservativeGap, combinedGap = separation.combinedScore.conservativeGap, flowCos = flowConsistency.meanDirectionCosine;
  const laterNearest = globalRecurrence.map(x => x.nearestTrackedBasinCandidate).filter(Boolean), stronglyDifferentGlobal = laterNearest.length && laterNearest.every(x => x.distanceToTrackedBasin > 250 || x.angleDeltaToTracked > 45);
  let verdict = 'AMBIGUOUS';
  if ((sameBasinRecurrenceRate == null || sameBasinRecurrenceRate >= .75) && Number.isFinite(flowCos) && flowCos >= .55 && Number.isFinite(structureGap) && structureGap > 0 && Number.isFinite(combinedGap) && combinedGap > 0) verdict = 'TRUE-LIKE';
  else if ((sameBasinRecurrenceRate === 0 || stronglyDifferentGlobal) && ((Number.isFinite(flowCos) && flowCos < .25) || (Number.isFinite(combinedGap) && combinedGap <= 0))) verdict = 'FALSE-LIKE';

  const report = {
    schema: 'wwmsync-real-gfn-candidate-diagnostics-v1', generatedAtUtc: new Date().toISOString(), productionReport: path.basename(productionReportPath),
    fixture: { frameCount: capture.frameCount, fps: capture.fps, intervalMs: capture.intervalMs, sourceDimensions: capture.screen, capturedMinimapRoi: capture.minimapRoi },
    candidateConsistencyVerdict: verdict,
    globalSearchFrames: globalFrames.map(g => ({ frame: g.frame, fixtureTimeMs: g.fixtureTimeMs, gateReason: g.gateReason, coarseScore: g.coarseScore, fineScore: g.fineScore, beamMargin: g.separation, candidates: g.alternatives })),
    consistency: { positionCluster, angleStability, scaleStability, sameBasinRecurrenceRate, globalRecurrence, flowConsistency, stepComparisons, trackedSequence: tracked },
    hardNegativeCalibration: { hypothesisSamples: hypothesisFrames, hardNegatives, separation },
    structuralScoreBreakdown: structuralLossBreakdown,
    visualDiagnostics: visualRecords,
    decision: { productionGateLowered: false, productMatcherChanged: false, reason: verdict === 'TRUE-LIKE' ? 'Evidence may justify a representation/scoring improvement, but this diagnostic commit intentionally changes no product matcher.' : verdict === 'FALSE-LIKE' ? 'Rejected candidate is not demonstrated as the same physical location; keep Stage D and improve candidate generation/ranking before any gate change.' : 'Evidence does not safely separate the hypothesis from hard negatives; keep Stage D unchanged.' },
    liveTestingJustified: false
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: reportPath, verdict, globalSearchFrames: globalFrames.map(x => x.frame), sameBasinRecurrenceRate, flowMeanCosine: flowCos, structuralConservativeGap: structureGap, combinedConservativeGap: combinedGap, liveTestingJustified: false }, null, 2));
} finally {
  if (browser) await browser.close(); server.close();
}
