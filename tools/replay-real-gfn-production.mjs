#!/usr/bin/env node
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

const EXPECTED_ARCHIVE_SHA256 = 'aa14ce0e703d0af5c4c86946f2932b465f8a7fd529001cd1900b3b99b501a216';
const EXPECTED_FIXTURE = 'wwmsync-gfn-motion-20260810-143835.zip';
const argv = process.argv.slice(2);
const arg = name => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : null; };
const siteDir = path.resolve(arg('--site') || 'replay-site');
const fixtureDir = path.resolve(arg('--fixture') || 'real-fixture');
const archivePath = path.resolve(arg('--archive') || EXPECTED_FIXTURE);
const reportPath = path.resolve(arg('--report') || 'replay-output/wwmsync-real-gfn-production-replay.json');
const visualDir = path.resolve(arg('--visual-dir') || 'replay-output/visuals');

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha256 = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const variance = values => values.length ? values.reduce((s, v) => s + (v - values.reduce((a, b) => a + b, 0) / values.length) ** 2, 0) / values.length : null;
const circularVarianceDeg = values => {
  if (!values.length) return null;
  const r = Math.PI / 180;
  const c = values.reduce((s, v) => s + Math.cos(v * r), 0) / values.length;
  const q = values.reduce((s, v) => s + Math.sin(v * r), 0) / values.length;
  return 1 - Math.hypot(c, q);
};
const ensureDir = p => fs.mkdirSync(p, { recursive: true });
const mime = p => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' }[path.extname(p).toLowerCase()] || 'application/octet-stream');

function parseFixture() {
  if (!fs.existsSync(archivePath)) throw new Error(`fixture archive missing: ${archivePath}`);
  const archiveSha256 = sha256(archivePath);
  if (archiveSha256 !== EXPECTED_ARCHIVE_SHA256) throw new Error(`fixture SHA-256 mismatch: ${archiveSha256}`);
  const capturePath = path.join(fixtureDir, 'capture.json');
  if (!fs.existsSync(capturePath)) throw new Error('capture.json missing');
  const capture = JSON.parse(fs.readFileSync(capturePath, 'utf8'));
  if (capture.status !== 'complete') throw new Error(`fixture status is ${capture.status}`);
  if (capture.frameCount !== 40 || capture.fps !== 5 || capture.intervalMs !== 200) throw new Error('unexpected fixture timing contract');
  if (capture.screen?.width !== 2048 || capture.screen?.height !== 864) throw new Error('unexpected source dimensions');
  const frames = capture.frames || [];
  if (frames.length !== 40) throw new Error(`expected 40 frame records, got ${frames.length}`);
  for (const item of frames) {
    if (!item.minimap || !fs.existsSync(path.join(fixtureDir, item.minimap))) throw new Error(`missing minimap frame ${item.minimap}`);
  }
  return { capture, frames, archiveSha256 };
}

function startServer() {
  const roots = { '/fixture/': fixtureDir, '/': siteDir };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const prefix = url.pathname.startsWith('/fixture/') ? '/fixture/' : '/';
    const rel = decodeURIComponent(url.pathname.slice(prefix.length)) || (prefix === '/' ? 'index.html' : 'capture.json');
    const root = roots[prefix];
    const file = path.resolve(root, rel);
    if (!file.startsWith(path.resolve(root) + path.sep) && file !== path.resolve(root)) { res.writeHead(403).end(); return; }
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'content-type': mime(file), 'cache-control': 'no-store' });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port })));
}

function classifyFailure(events, finalVision) {
  const regs = events.filter(e => e.type === 'registration');
  const confirms = events.filter(e => e.type === 'confirmation');
  const matrices = events.filter(e => e.type === 'matrix');
  const applies = events.filter(e => e.type === 'apply');
  const applied = applies.filter(e => e.detail.ok);
  if (!regs.length) return { code: 'A', label: 'no structural candidates', reason: 'no-production-registration-observed' };
  if (regs.some(e => e.detail.reason === 'target-out-of-global-bounds')) return { code: 'B', label: 'candidates exist but wrong region', reason: 'target-out-of-global-bounds' };
  if (regs.some(e => e.detail.coarse && !e.detail.fine)) return { code: 'C', label: 'coarse works, fine fails', reason: regs.find(e => e.detail.coarse && !e.detail.fine)?.detail.reason || 'no-fine-match' };
  const fineRejected = regs.find(e => e.detail.fine && e.detail.reason);
  if (fineRejected) return { code: 'D', label: 'fine works, matchGate rejects', reason: fineRejected.detail.reason };
  const confirmRejected = confirms.find(e => !e.detail.ok);
  if (confirmRejected && !applied.length) return { code: 'E', label: 'confirmation rejects', reason: `confirm-mismatch d=${confirmRejected.detail.distance} a=${confirmRejected.detail.angle}` };
  const applyRejected = applies.find(e => !e.detail.ok);
  if (applyRejected) return { code: 'F', label: 'accepted fix cannot bridge to WWMSync', reason: applyRejected.detail.reason || 'apply-failed' };
  if (applied.length && finalVision?.motionCalibration !== 'absolute-matrix') return { code: 'G', label: 'AUTO matrix fails', reason: 'lock-applied-without-absolute-matrix' };
  const firstApply = applied[0];
  if (firstApply) {
    const periodic = regs.filter(e => e.detail.trigger === 'interval' && e.detail.startedAt > firstApply.detail.startedAt);
    const periodicApplied = applies.filter(e => e.detail.trigger === 'interval' && e.detail.startedAt > firstApply.detail.startedAt && e.detail.ok);
    if (periodic.length && !periodicApplied.length) return { code: 'H', label: 'periodic reacquisition fails', reason: periodic[0].detail.reason || 'periodic-no-correction' };
  }
  const first = regs[0];
  if (!first.detail.coarse) return { code: 'A', label: 'no structural candidates', reason: first.detail.reason || 'no-coarse-match' };
  return { code: 'D', label: 'fine works, matchGate rejects', reason: first.detail.reason || 'not-locked' };
}

function saveDataUrl(dataUrl, file) {
  if (!dataUrl) return null;
  const m = /^data:image\/png;base64,(.+)$/.exec(dataUrl);
  if (!m) throw new Error('unexpected visualization data URL');
  ensureDir(path.dirname(file));
  fs.writeFileSync(file, Buffer.from(m[1], 'base64'));
  return file;
}

const { capture, frames, archiveSha256 } = parseFixture();
ensureDir(path.dirname(reportPath));
ensureDir(visualDir);
const { server, port } = await startServer();
const executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome';
let browser;
let report;
try {
  browser = await chromium.launch({ headless: true, executablePath, args: ['--disable-dev-shm-usage', '--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on('console', msg => { if (msg.type() === 'error') console.error('[browser]', msg.text()); });
  await page.goto(`http://127.0.0.1:${port}/index.html`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__WWMSYNC_VISION_BRIDGE__ && window.__WWMSYNC_VISION_TEST__ && window.__WWMSYNC_ABSOLUTE_DIAGNOSTICS__ && window.__WWMSYNC_REAL_REPLAY_VISUALIZE__, null, { timeout: 60_000 });

  const cold = await page.evaluate(() => {
    window.__WWMSYNC_VISION_TEST__.setViewport(1.35, -1.45, 8);
    const v = window.__WWMSYNC_VISION_BRIDGE__.state();
    return { hasAnchor: v.hasAnchor, hasMarker: v.hasMarker, markerLatLng: v.markerLatLng, mapZoom: v.mapZoom };
  });
  if (cold.hasAnchor || cold.hasMarker || cold.markerLatLng) throw new Error(`cold-state violation: ${JSON.stringify(cold)}`);

  await page.evaluate(({ width, height }) => {
    window.__WWMSYNC_REAL_REPLAY_EVENTS__ = [];
    for (const type of ['registration', 'confirmation', 'matrix', 'apply']) {
      window.addEventListener(`wwmsync:real-replay:${type}`, e => window.__WWMSYNC_REAL_REPLAY_EVENTS__.push({ type, detail: e.detail }));
    }
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: false }); ctx.fillStyle = '#202020'; ctx.fillRect(0, 0, width, height);
    const stream = canvas.captureStream(0); const track = stream.getVideoTracks()[0];
    window.__WWMSYNC_REAL_REPLAY_SCREEN__ = { canvas, ctx, stream, track };
    const media = navigator.mediaDevices || {};
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { ...media, getDisplayMedia: async () => stream } });
  }, capture.screen);

  const drawFrame = async index => page.evaluate(async ({ index, name, width, height }) => {
    const r = window.__WWMSYNC_REAL_REPLAY_SCREEN__;
    const img = new Image(); img.decoding = 'sync'; img.src = `/fixture/${name}`; await img.decode();
    r.ctx.fillStyle = '#202020'; r.ctx.fillRect(0, 0, width, height);
    r.ctx.drawImage(img, 0, 0);
    window.__WWMSYNC_REAL_REPLAY_FRAME__ = index;
    r.track.requestFrame?.();
  }, { index, name: frames[index - 1].minimap, width: capture.screen.width, height: capture.screen.height });

  await drawFrame(1);
  const startWall = Date.now();
  await page.locator('#visionStartButton').click();
  await page.waitForFunction(() => window.__WWMSYNC_VISION_BRIDGE__.state().active, null, { timeout: 10_000 });
  const start = Date.now();
  const perFrame = [];
  for (let i = 1; i <= frames.length; i++) {
    if (i > 1) {
      const due = start + (i - 1) * capture.intervalMs;
      const wait = due - Date.now(); if (wait > 0) await sleep(wait);
      await drawFrame(i);
    }
    const snapshotDue = start + (i - 1) * capture.intervalMs + Math.min(160, capture.intervalMs - 20);
    const waitSnapshot = snapshotDue - Date.now(); if (waitSnapshot > 0) await sleep(waitSnapshot);
    const snap = await page.evaluate(() => ({ vision: window.__WWMSYNC_VISION_DIAGNOSTICS__(), absolute: window.__WWMSYNC_ABSOLUTE_DIAGNOSTICS__() }));
    perFrame.push({ frame: i, fixtureTimeMs: (i - 1) * capture.intervalMs, source: frames[i - 1].minimap, snapshot: snap });
  }

  // Let any registration that captured one of the 40 frames finish, but do not advance or loop the fixture.
  let lastEventCount = -1, stableSince = Date.now();
  const settleDeadline = Date.now() + 45_000;
  while (Date.now() < settleDeadline) {
    const count = await page.evaluate(() => window.__WWMSYNC_REAL_REPLAY_EVENTS__.length);
    if (count !== lastEventCount) { lastEventCount = count; stableSince = Date.now(); }
    if (Date.now() - stableSince >= 1500) break;
    await sleep(250);
  }

  const runtime = await page.evaluate(() => ({ events: window.__WWMSYNC_REAL_REPLAY_EVENTS__, vision: window.__WWMSYNC_VISION_DIAGNOSTICS__(), absolute: window.__WWMSYNC_ABSOLUTE_DIAGNOSTICS__(), bridge: window.__WWMSYNC_VISION_BRIDGE__.state(), hardening: window.__WWMSYNC_VISION_HARDENING__ }));
  const events = runtime.events.map(e => ({ ...e, fixtureTimeMs: Number.isInteger(e.detail.frame) ? (e.detail.frame - 1) * capture.intervalMs : null, wallElapsedMs: (e.detail.startedAt || e.detail.at || start) - start }));
  for (const frame of perFrame) frame.events = events.filter(e => e.detail.frame === frame.frame);

  const regs = events.filter(e => e.type === 'registration');
  const confirms = events.filter(e => e.type === 'confirmation');
  const applies = events.filter(e => e.type === 'apply');
  const successfulApplies = applies.filter(e => e.detail.ok);
  const firstGlobal = regs.find(e => e.detail.modeBefore === 'global' || e.detail.modeBefore === 'idle') || null;
  const firstCandidate = regs.find(e => !e.detail.reason && e.detail.target) || null;
  const firstProductionLock = successfulApplies[0] || null;
  const candidateBeforeLock = firstProductionLock ? [...regs].reverse().find(e => e.detail.startedAt <= firstProductionLock.detail.startedAt && !e.detail.reason && e.detail.target) : null;
  const confirmationForLock = firstProductionLock ? [...confirms].reverse().find(e => e.detail.startedAt <= firstProductionLock.detail.startedAt && e.detail.ok) : null;
  const confirmationIndependent = !!(candidateBeforeLock && confirmationForLock && candidateBeforeLock.detail.frame !== confirmationForLock.detail.frame);
  const validLocks = successfulApplies.filter(app => {
    const confirm = [...confirms].reverse().find(e => e.detail.startedAt <= app.detail.startedAt && e.detail.ok);
    const cand = [...regs].reverse().find(e => e.detail.startedAt <= app.detail.startedAt && !e.detail.reason && e.detail.target);
    return !!(confirm && cand && confirm.detail.frame !== cand.detail.frame);
  });
  const validFixturePass = validLocks.length > 0 && runtime.vision.motionCalibration === 'absolute-matrix' && runtime.vision.hasMarker;

  const fixX = successfulApplies.map(e => e.detail.fine?.globalX).filter(Number.isFinite);
  const fixY = successfulApplies.map(e => e.detail.fine?.globalY).filter(Number.isFinite);
  const rotations = successfulApplies.map(e => e.detail.fine?.angle).filter(Number.isFinite);
  const jumps = [];
  for (let i = 1; i < successfulApplies.length; i++) {
    const a = successfulApplies[i - 1].detail.fine, b = successfulApplies[i].detail.fine;
    if (Number.isFinite(a?.globalX) && Number.isFinite(b?.globalX)) {
      const d = Math.hypot(b.globalX - a.globalX, b.globalY - a.globalY);
      if (d > 150) jumps.push({ fromFix: i, toFix: i + 1, planarDistance: d, threshold: 150 });
    }
  }
  const firstLockStart = firstProductionLock?.detail.startedAt ?? Infinity;
  const periodicRegs = regs.filter(e => e.detail.trigger === 'interval' && e.detail.startedAt > firstLockStart && e.detail.frame <= 40);
  const periodicApplies = successfulApplies.filter(e => e.detail.trigger === 'interval' && e.detail.startedAt > firstLockStart && e.detail.frame <= 40);
  const failure = validFixturePass ? null : classifyFailure(events, runtime.vision);

  const visuals = [];
  if (!validFixturePass) {
    const visualFrame = firstGlobal?.detail.frame || 1;
    const visual = await page.evaluate(async ({ frameName }) => {
      const img = new Image(); img.src = `/fixture/${frameName}`; await img.decode();
      const c = document.createElement('canvas'); c.width = 192; c.height = 192;
      c.getContext('2d', { alpha: false }).drawImage(img, 0, 0, 216, 216, 0, 0, 192, 192);
      return window.__WWMSYNC_REAL_REPLAY_VISUALIZE__(c, 1, 3);
    }, { frameName: frames[visualFrame - 1].minimap });
    if (visual?.normalized) visuals.push({ kind: 'normalized', path: saveDataUrl(visual.normalized, path.join(visualDir, `frame-${String(visualFrame).padStart(3, '0')}-normalized.png`)) });
    for (const item of visual?.candidates || []) {
      const base = `frame-${String(visualFrame).padStart(3, '0')}-candidate-${item.rank}`;
      visuals.push({ kind: 'tile-patch', rank: item.rank, candidate: item.candidate, path: saveDataUrl(item.patch, path.join(visualDir, `${base}-tile.png`)) });
      visuals.push({ kind: 'edge-overlay', rank: item.rank, candidate: item.candidate, path: saveDataUrl(item.overlay, path.join(visualDir, `${base}-edges.png`)) });
    }
  }

  report = {
    schema: 'wwmsync-real-gfn-production-replay-v2',
    generatedAtUtc: new Date().toISOString(),
    fixture: { name: EXPECTED_FIXTURE, archiveSha256, expectedArchiveSha256: EXPECTED_ARCHIVE_SHA256, sourceDimensions: capture.screen, capturedMinimapRoi: capture.minimapRoi, fps: capture.fps, intervalMs: capture.intervalMs, frameCount: capture.frameCount, durationSeconds: capture.durationSeconds },
    contract: { coldState: cold, defaultRoiSettings: true, manualAnchor: false, injectedAbsoluteFix: false, manualSearchSeed: false, productionCaptureLoop: true, productSourceInstrumentedOnlyInReplayCopy: true, matcherGatesChanged: false },
    acceptance: { synthetic: 'PASS', realGfnFixture: validFixturePass ? 'PASS' : 'FAIL', realLocalFixture: 'UNAVAILABLE', realLiveE2E: 'PENDING', exactPassLabel: validFixturePass ? 'REAL GFN FIXTURE PASS' : null },
    sequence: {
      firstAttemptedGlobalSearch: firstGlobal ? { frame: firstGlobal.detail.frame, fixtureTimeMs: firstGlobal.fixtureTimeMs, wallElapsedMs: firstGlobal.wallElapsedMs } : null,
      firstCandidate: firstCandidate ? { frame: firstCandidate.detail.frame, fixtureTimeMs: firstCandidate.fixtureTimeMs, wallElapsedMs: firstCandidate.wallElapsedMs, target: firstCandidate.detail.target, coarse: firstCandidate.detail.coarse, fine: firstCandidate.detail.fine } : null,
      firstAcceptedAbsoluteLock: firstProductionLock ? { frame: firstProductionLock.detail.frame, fixtureTimeMs: firstProductionLock.fixtureTimeMs, wallElapsedMs: firstProductionLock.wallElapsedMs, target: firstProductionLock.detail.target, confirmationIndependent } : null,
      firstFixtureValidLock: validLocks[0] ? { frame: validLocks[0].detail.frame, fixtureTimeMs: validLocks[0].fixtureTimeMs, wallElapsedMs: validLocks[0].wallElapsedMs, target: validLocks[0].detail.target } : null,
      absoluteFixes: successfulApplies.length,
      positionVarianceFinePixels: { x: variance(fixX), y: variance(fixY) },
      rotationCircularVariance: circularVarianceDeg(rotations),
      rotationsDeg: rotations,
      falseJumps: jumps,
      relocalizations: Math.max(0, successfulApplies.length - 1),
      acceptedMotionFrames: runtime.vision.accepted,
      heldMotionFrames: runtime.vision.held,
      periodicReacquisition: { attemptsWithinFixture: periodicRegs.length, successfulCorrectionsWithinFixture: periodicApplies.length, failuresWithinFixture: periodicRegs.filter(e => e.detail.reason).map(e => ({ frame: e.detail.frame, reason: e.detail.reason })) },
      failureStage: failure
    },
    frames: perFrame.map(frame => {
      const reg = frame.events.find(e => e.type === 'registration')?.detail || null;
      const conf = frame.events.find(e => e.type === 'confirmation')?.detail || null;
      const apply = frame.events.find(e => e.type === 'apply')?.detail || null;
      const matrix = frame.events.find(e => e.type === 'matrix')?.detail || null;
      const v = frame.snapshot.vision;
      return {
        frame: frame.frame, fixtureTimeMs: frame.fixtureTimeMs, source: frame.source,
        coarseScore: reg?.coarse?.score ?? null,
        fineScore: reg?.fine?.score ?? null,
        structuralScore: reg?.fine?.scaleScore ?? reg?.coarse?.scaleScore ?? null,
        ncc: reg?.fine?.intensityNcc ?? reg?.coarse?.intensityNcc ?? null,
        separation: reg?.fine?.beamMargin ?? reg?.fine?.margin ?? reg?.coarse?.margin ?? null,
        ambiguity: reg?.fine?.beamMargin != null ? { beamMargin: reg.fine.beamMargin, ambiguousUnderProductionGate: reg.fine.beamMargin < 0.010 } : null,
        rotationDeg: reg?.fine?.angle ?? reg?.coarse?.angle ?? null,
        candidatePlanarPosition: reg?.fine ? { x: reg.fine.globalX, y: reg.fine.globalY } : null,
        candidateAbsolutePosition: reg?.target ?? null,
        gateReason: reg?.reason || null,
        confirmation: conf ? { ok: conf.ok, distance: conf.distance, angle: conf.angle, scale: conf.scale } : null,
        absoluteLock: !!apply?.ok,
        absolutePosition: apply?.ok ? apply.target : frame.snapshot.absolute.absolute,
        autoMatrix: apply?.ok ? apply.vision?.motionCalibration === 'absolute-matrix' : v.motionCalibration === 'absolute-matrix',
        motionMatrix: apply?.motionMatrix ?? matrix?.matrix ?? v.motionMatrix ?? null,
        rawOpticalFlowDelta: { dx: v.rawDx, dy: v.rawDy },
        correctedOpticalFlowDelta: { dx: v.correctedDx, dy: v.correctedDy },
        markerDelta: { lat: v.markerDeltaLat, lng: v.markerDeltaLng },
        periodicReacquisition: reg?.trigger === 'interval' ? { result: reg.reason ? 'FAIL' : (apply?.ok ? 'PASS' : 'CANDIDATE'), reason: reg.reason || null } : null,
        holdReason: v.holdReason,
        alternatives: reg?.alternatives || []
      };
    }),
    events,
    final: { vision: runtime.vision, absolute: runtime.absolute, bridge: runtime.bridge, hardening: runtime.hardening },
    failureVisualizations: visuals
  };
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ report: reportPath, realGfnFixture: report.acceptance.realGfnFixture, firstLock: report.sequence.firstAcceptedAbsoluteLock, failureStage: report.sequence.failureStage, productCodeChanged: false }, null, 2));
  if (!validFixturePass) process.exitCode = 2;
} finally {
  if (browser) await browser.close();
  server.close();
}
