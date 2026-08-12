#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const siteDir = path.resolve(arg('--site') || 'replay-site');
const fixtureDir = path.resolve(arg('--fixture') || 'real-fixture');
const candidatesPath = path.resolve(arg('--candidates') || 'replay-output/wwmsync-real-gfn-dinov2-sequence-hypotheses.json');
const priorSequencePath = path.resolve(arg('--prior-sequence') || 'replay-output/wwmsync-real-gfn-dinov2-sequence-hypotheses-sequence.json');
const reportPath = path.resolve(arg('--report') || 'replay-output/wwmsync-real-gfn-joint-flow-pose.json');
const mapId = Number(arg('--map-id') || 1);

const parseJson = p => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : null;
const quantile = (values, q) => {
  const a = values.filter(Number.isFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const p = (a.length - 1) * q, lo = Math.floor(p), hi = Math.ceil(p);
  return lo === hi ? a[lo] : a[lo] * (hi - p) + a[hi] * (p - lo);
};
const std = a => { const m = mean(a); return a.length && m != null ? Math.sqrt(mean(a.map(v => (v - m) ** 2))) : null; };
const hypot = (x, y) => Math.hypot(Number(x) || 0, Number(y) || 0);
const angleDelta = (a, b) => Math.abs((((Number(a) - Number(b)) + 540) % 360) - 180);
const angleNorm = a => ((a % 360) + 360) % 360;
const mime = p => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(p).toLowerCase()] || 'application/octet-stream');

function startServer() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    let root, rel;
    if (url.pathname.startsWith('/fixture/')) {
      root = fixtureDir;
      rel = decodeURIComponent(url.pathname.slice('/fixture/'.length)) || 'capture.json';
    } else {
      root = siteDir;
      rel = decodeURIComponent(url.pathname.slice(1)) || 'index.html';
    }
    const rootAbs = path.resolve(root), file = path.resolve(root, rel);
    if ((!file.startsWith(rootAbs + path.sep) && file !== rootAbs) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.writeHead(file.startsWith(rootAbs) ? 404 : 403).end();
      return;
    }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function robustObjective(rows) {
  const combined = rows.map(r => r?.combinedScore).filter(Number.isFinite);
  const structural = rows.map(r => r?.scaleScore).filter(Number.isFinite);
  const ncc = rows.map(r => r?.intensityNcc).filter(Number.isFinite);
  const edges = rows.map(r => r?.edgeAgreement).filter(Number.isFinite);
  const structuralPassCount = structural.filter(v => v >= .58).length;
  if (!combined.length) return { objective: -1, frameCount: 0, structuralPassCount: 0 };
  const m = mean(combined), med = quantile(combined, .5), p25 = quantile(combined, .25), sd = std(combined) || 0;
  const objective = .50 * med + .30 * p25 + .20 * m - .025 * sd;
  return {
    objective,
    frameCount: combined.length,
    combined: { mean: m, median: med, p25, min: Math.min(...combined), max: Math.max(...combined), std: sd },
    structural: { mean: mean(structural), median: quantile(structural, .5), p25: quantile(structural, .25), min: Math.min(...structural), max: Math.max(...structural) },
    ncc: { mean: mean(ncc), median: quantile(ncc, .5), p25: quantile(ncc, .25) },
    edgeAgreement: { mean: mean(edges), median: quantile(edges, .5), p25: quantile(edges, .25) },
    structuralPassCount,
    structuralPassFraction: structural.length ? structuralPassCount / structural.length : 0,
  };
}

function chooseSeeds(generated, prior) {
  const byRank = new Map((generated.candidates || []).map(c => [Number(c.rank), c]));
  const chosen = new Map();
  const add = c => { if (c && Number.isFinite(Number(c.rank))) chosen.set(Number(c.rank), c); };
  (generated.candidates || []).slice(0, 20).forEach(add);
  (prior.sequenceRankedTopK || []).slice(0, 24).forEach(h => add(byRank.get(Number(h.candidate?.rank)) || h.candidate));
  const bestPerDino = new Map();
  for (const c of generated.candidates || []) {
    const d = Number(c.dinoRank);
    if (!Number.isFinite(d)) continue;
    if (!bestPerDino.has(d) || Number(c.generatorScore || 0) > Number(bestPerDino.get(d).generatorScore || 0)) bestPerDino.set(d, c);
  }
  [...bestPerDino.values()].forEach(add);
  return [...chosen.values()].sort((a, b) => Number(b.generatorScore || 0) - Number(a.generatorScore || 0)).slice(0, 48);
}

function distinctTop(rows, limit = 8) {
  const out = [];
  for (const r of rows) {
    const c = r.pose;
    if (out.some(p => hypot(c.x - p.pose.x, c.y - p.pose.y) < 100 && angleDelta(c.angle, p.pose.angle) < 24 && Math.abs(Math.log(c.radius / p.pose.radius)) < .20)) continue;
    out.push(r);
    if (out.length >= limit) break;
  }
  return out;
}

const capture = parseJson(path.join(fixtureDir, 'capture.json'));
const frames = (capture.frames || []).map((x, i) => ({ ...x, index: i, minimap: x.minimap || x.minimapFile || x.cropFile }));
if (frames.length !== 40 || frames.some(f => !f.minimap)) throw new Error(`expected exact 40-frame fixture with minimap paths, got ${frames.length}`);
const generated = parseJson(candidatesPath);
const prior = parseJson(priorSequencePath);
const seeds = chooseSeeds(generated, prior);
if (!seeds.length) throw new Error('no learned candidate seeds supplied');

const selectedEight = [0, 4, 9, 14, 19, 24, 29, 39];
const selectedCoarse = [0, 9, 19, 29, 39];
const { server, port } = await startServer();
let browser;
try {
  browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome', args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.on('pageerror', e => console.error('[joint-flow pageerror]', e.message));
  page.on('console', m => { if (m.type() === 'error') console.error('[joint-flow console]', m.text()); });
  const response = await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  if (!response?.ok()) throw new Error(`diagnostic site HTTP ${response?.status()}`);
  await page.waitForFunction(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__, null, { timeout: 60_000 });
  await page.evaluate(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset());

  // Load all raw minimap canvases once, matching production replay crop semantics exactly.
  await page.evaluate(async frameNames => {
    window.__WWMSYNC_JOINT_CANVASES__ = [];
    for (const name of frameNames) {
      const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode();
      const c = document.createElement('canvas'); c.width = 192; c.height = 192;
      c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192);
      window.__WWMSYNC_JOINT_CANVASES__.push(c);
    }
    return window.__WWMSYNC_JOINT_CANVASES__.length;
  }, frames.map(f => f.minimap));

  // Reuse the production optical-flow estimator and accumulate source-coordinate player displacement.
  const flows = [];
  await page.evaluate(() => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.reset());
  for (let i = 0; i < 40; i++) {
    const flow = await page.evaluate(({ i, reset }) => window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__.flow(window.__WWMSYNC_JOINT_CANVASES__[i], reset), { i, reset: i === 0 });
    flows.push(flow || { accepted: false, dx: 0, dy: 0, score: null, reason: 'unavailable' });
  }
  const cumulative = [{ sx: 0, sy: 0, acceptedSteps: 0 }];
  for (let i = 1; i < 40; i++) {
    const prev = cumulative[i - 1], f = flows[i] || {};
    cumulative.push({
      sx: prev.sx + (f.accepted ? -(Number(f.dx) || 0) : 0),
      sy: prev.sy + (f.accepted ? -(Number(f.dy) || 0) : 0),
      acceptedSteps: prev.acceptedSteps + (f.accepted ? 1 : 0),
    });
  }

  const evaluatePose = async (pose, frameIndices, mode, key) => {
    return page.evaluate(async ({ pose, frameIndices, mode, key, cumulative, mapId }) => {
      const diag = window.__WWMSYNC_REAL_GFN_CANDIDATE_DIAG__;
      const out = [];
      const a = Number(pose.angle || 0) * Math.PI / 180, c = Math.cos(a), s = Math.sin(a), scale = Number(pose.radius || 96) / 96;
      for (const frameIndex of frameIndices) {
        const v = cumulative[frameIndex] || { sx: 0, sy: 0 };
        let dx = 0, dy = 0;
        if (mode !== 'static') {
          let wx = (v.sx * c - v.sy * s) * scale;
          let wy = (v.sx * s + v.sy * c) * scale;
          if (mode === 'reverse') { wx = -wx; wy = -wy; }
          if (mode === 'orthogonal') { const t = wx; wx = -wy; wy = t; }
          dx = wx; dy = wy;
        }
        const candidate = { x: Number(pose.x) + dx, y: Number(pose.y) + dy, radius: Number(pose.radius), angle: Number(pose.angle), beamMargin: 1, coarseScore: .60 };
        const score = await diag.scoreFixed(window.__WWMSYNC_JOINT_CANVASES__[frameIndex], candidate, mapId, key);
        out.push({ frame: frameIndex + 1, predictedDx: dx, predictedDy: dy, ...score });
      }
      return out;
    }, { pose, frameIndices, mode, key, cumulative, mapId });
  };

  const baselineRows = [];
  for (const seed of seeds) {
    const pose = { x: Number(seed.x), y: Number(seed.y), radius: Number(seed.radius), angle: angleNorm(Number(seed.angle)) };
    const key = `joint-seed-${seed.rank}`;
    const scores = await evaluatePose(pose, selectedEight, 'flow', key);
    baselineRows.push({ seedRank: seed.rank, dinoRank: seed.dinoRank ?? null, seed, pose, scores, metrics: robustObjective(scores) });
  }
  baselineRows.sort((a, b) => b.metrics.objective - a.metrics.objective);

  // Search only the strongest direct flow-conditioned seeds, plus the strongest prior trajectory seeds.
  const searchSeeds = [];
  const seenRanks = new Set();
  const addSearch = row => { if (row && !seenRanks.has(Number(row.seedRank))) { seenRanks.add(Number(row.seedRank)); searchSeeds.push(row); } };
  baselineRows.slice(0, 12).forEach(addSearch);
  for (const h of (prior.sequenceRankedTopK || []).slice(0, 8)) addSearch(baselineRows.find(r => Number(r.seedRank) === Number(h.candidate?.rank)));
  searchSeeds.splice(16);

  const coarseResults = [];
  for (const row of searchSeeds) {
    const seed = row.pose;
    let best = null;
    for (const dy of [-18, 0, 18]) for (const dx of [-18, 0, 18]) for (const da of [-12, 0, 12]) {
      const pose = { x: seed.x + dx, y: seed.y + dy, radius: seed.radius, angle: angleNorm(seed.angle + da) };
      const scores = await evaluatePose(pose, selectedCoarse, 'flow', `joint-coarse-${row.seedRank}`);
      const metrics = robustObjective(scores);
      const candidate = { seedRank: row.seedRank, dinoRank: row.dinoRank, seed: row.seed, pose, scores, metrics };
      if (!best || metrics.objective > best.metrics.objective) best = candidate;
    }
    coarseResults.push(best);
  }
  coarseResults.sort((a, b) => b.metrics.objective - a.metrics.objective);
  const coarseDistinct = distinctTop(coarseResults, 8);

  const finals = [];
  for (const row of coarseDistinct) {
    let best = null;
    const center = row.pose;
    for (const dy of [-6, 0, 6]) for (const dx of [-6, 0, 6]) for (const da of [-4, 0, 4]) for (const rf of [.975, 1, 1.025]) {
      const pose = { x: center.x + dx, y: center.y + dy, radius: center.radius * rf, angle: angleNorm(center.angle + da) };
      const scores = await evaluatePose(pose, selectedEight, 'flow', `joint-fine-${row.seedRank}`);
      const metrics = robustObjective(scores);
      const candidate = { seedRank: row.seedRank, dinoRank: row.dinoRank, seed: row.seed, pose, flowScores: scores, flowMetrics: metrics };
      if (!best || metrics.objective > best.flowMetrics.objective) best = candidate;
    }
    const staticScores = await evaluatePose(best.pose, selectedEight, 'static', `joint-control-${row.seedRank}`);
    const reverseScores = await evaluatePose(best.pose, selectedEight, 'reverse', `joint-control-${row.seedRank}`);
    const orthogonalScores = await evaluatePose(best.pose, selectedEight, 'orthogonal', `joint-control-${row.seedRank}`);
    best.staticScores = staticScores; best.staticMetrics = robustObjective(staticScores);
    best.reverseScores = reverseScores; best.reverseMetrics = robustObjective(reverseScores);
    best.orthogonalScores = orthogonalScores; best.orthogonalMetrics = robustObjective(orthogonalScores);
    best.motionControlMax = Math.max(best.staticMetrics.objective, best.reverseMetrics.objective, best.orthogonalMetrics.objective);
    best.motionControlMargin = best.flowMetrics.objective - best.motionControlMax;
    best.earlyMetrics = robustObjective(best.flowScores.filter(r => r.frame <= 20));
    best.lateMetrics = robustObjective(best.flowScores.filter(r => r.frame >= 20));
    finals.push(best);
  }
  finals.sort((a, b) => b.flowMetrics.objective - a.flowMetrics.objective);
  const distinctFinals = distinctTop(finals.map(x => ({ ...x, metrics: x.flowMetrics })), 8);
  const best = finals[0] || null;
  const secondDistinct = distinctFinals.find(x => x !== best) || null;
  const separation = best && secondDistinct ? best.flowMetrics.objective - secondDistinct.flowMetrics.objective : null;

  const structuralEvidence = !!best && best.flowMetrics.structuralPassCount >= 5 && (best.flowMetrics.structural.median ?? -1) >= .58;
  const motionEvidence = !!best && best.motionControlMargin >= .005;
  const temporalEvidence = !!best && (best.earlyMetrics.structuralPassCount >= 2) && (best.lateMetrics.structuralPassCount >= 2);
  const separationEvidence = separation == null || separation >= .005;
  const trueLike = structuralEvidence && motionEvidence && temporalEvidence && separationEvidence;

  const report = {
    schema: 'wwmsync-real-gfn-joint-flow-pose-v1',
    generatedAtUtc: new Date().toISOString(),
    scope: {
      replayOnly: true,
      productRuntimeChanged: false,
      productionGateLowered: false,
      knownFalseCandidateOptimized: false,
      goal: 'test one absolute pose against the production optical-flow trajectory across independent raw frames without framewise candidate tracking',
    },
    fixture: { frameCount: 40, evaluationFrames1Based: selectedEight.map(i => i + 1), coarseFrames1Based: selectedCoarse.map(i => i + 1) },
    sourceCandidates: {
      generatorSchema: generated.schema,
      priorSequenceSchema: prior.schema,
      generatorCandidateCount: generated.candidates?.length || 0,
      seedCount: seeds.length,
      searchSeedCount: searchSeeds.length,
      seedRanks: seeds.map(c => c.rank),
      searchSeedRanks: searchSeeds.map(r => r.seedRank),
    },
    opticalFlow: {
      acceptedSteps: flows.filter(f => f?.accepted).length,
      rejectedSteps: flows.filter(f => !f?.accepted && !f?.baseline).length,
      cumulativeSourcePlayerDisplacement: cumulative.at(-1),
      semantics: 'player source displacement = -terrain dx/dy; world displacement = rotate(angle) * radius/96',
    },
    search: {
      baseline: 'all selected learned seeds scored directly at flow-predicted positions',
      coarse: { positionOffsetsPx: [-18, 0, 18], angleOffsetsDeg: [-12, 0, 12], radiusFactors: [1], frames: selectedCoarse.map(i => i + 1) },
      fine: { positionOffsetsPx: [-6, 0, 6], angleOffsetsDeg: [-4, 0, 4], radiusFactors: [.975, 1, 1.025], frames: selectedEight.map(i => i + 1) },
      controls: ['static', 'reverse-flow', 'orthogonal-flow'],
    },
    acceptance: {
      reusesProductionStructuralGate: .58,
      minimumStructuralPassFrames: 5,
      minimumMotionControlMargin: .005,
      minimumDistinctBasinSeparation: .005,
      requireEarlyAndLateStructuralSupport: true,
      structuralEvidence,
      motionEvidence,
      temporalEvidence,
      separationEvidence,
    },
    baselineTop: baselineRows.slice(0, 16),
    coarseTop: coarseResults.slice(0, 16),
    finals,
    hardNegativeSeparation: {
      distinctFinalCount: distinctFinals.length,
      bestObjective: best?.flowMetrics?.objective ?? null,
      secondDistinctObjective: secondDistinct?.flowMetrics?.objective ?? null,
      positiveSeparation: separation,
    },
    jointPoseVerdict: trueLike ? 'TRUE-LIKE-JOINT-POSE-SURFACED' : 'NO-TRUE-LIKE-JOINT-POSE',
    exactRemainingFailureStage: trueLike ? 'production-integration-not-applied-diagnostic-only' : 'motion-constrained-joint-absolute-localization',
    bestJointPose: best,
    productChangeJustified: trueLike,
    liveTestingJustified: false,
    recommendation: trueLike
      ? 'Joint motion-constrained evidence surfaced a basin that passes the unchanged 0.58 structural gate on a majority of independent frames and beats static/reversed/orthogonal controls. Next replay step is production-suitable integration behind the existing absolute localization gates; do not live-test yet.'
      : 'Do not modify production runtime. The learned recurrent basins still fail a motion-constrained multi-frame absolute-pose test under the unchanged structural gate and hard-negative controls.',
  };
  fs.mkdirSync(path.dirname(reportPath), { recursive: true });
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    report: reportPath,
    jointPoseVerdict: report.jointPoseVerdict,
    exactRemainingFailureStage: report.exactRemainingFailureStage,
    opticalFlow: report.opticalFlow,
    acceptance: report.acceptance,
    hardNegativeSeparation: report.hardNegativeSeparation,
    best: best ? {
      seedRank: best.seedRank,
      dinoRank: best.dinoRank,
      pose: best.pose,
      flowObjective: best.flowMetrics.objective,
      structuralMedian: best.flowMetrics.structural?.median,
      structuralP25: best.flowMetrics.structural?.p25,
      structuralPassCount: best.flowMetrics.structuralPassCount,
      staticObjective: best.staticMetrics.objective,
      reverseObjective: best.reverseMetrics.objective,
      orthogonalObjective: best.orthogonalMetrics.objective,
      motionControlMargin: best.motionControlMargin,
      earlyStructuralPassCount: best.earlyMetrics.structuralPassCount,
      lateStructuralPassCount: best.lateMetrics.structuralPassCount,
    } : null,
    productChangeJustified: report.productChangeJustified,
    liveTestingJustified: report.liveTestingJustified,
  }, null, 2));
} finally {
  if (browser) await browser.close();
  server.close();
}
