/*
 * Ground-truth fixture primitives. This module deliberately contains no tracker,
 * calibration, or map-motion logic. SHA-256 uses Web Crypto's documented
 * SubtleCrypto.digest API: https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest
 */
(function (root) {
  'use strict';
  const RUN_LABELS = Object.freeze(['WALK', 'RUN', 'SPRINT']);
  const NOMINAL_CAPTURE_INTERVAL_MS = 200;
  const MAX_DURATION_MS = 60000;
  const MAX_FRAMES_PER_RUN = Math.ceil(MAX_DURATION_MS / NOMINAL_CAPTURE_INTERVAL_MS);
  const README = 'WWMSync ground-truth relative-motion fixture.\n\nGROUND TRUTH IS MANUAL START/END MAP ANCHORS.\nTRACKER OUTPUT IS DIAGNOSTIC ONLY.\n\nEach run has independently selected anchors. Frames are raw minimap ROI PNGs captured before feature extraction, correlation, annulus masking, or tracker integration.\n';

  const encoder = new TextEncoder();
  const clone = value => JSON.parse(JSON.stringify(value));
  const bytes = value => value instanceof Uint8Array ? value : new Uint8Array(value);
  const hex = buffer => Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join('');
  async function sha256(value) {
    const input = typeof value === 'string' ? encoder.encode(value) : bytes(value);
    if (!root.crypto?.subtle) throw new Error('SHA-256 requires Web Crypto in a secure context.');
    return hex(await root.crypto.subtle.digest('SHA-256', input));
  }
  function finite(value, name) {
    const n = Number(value);
    if (!Number.isFinite(n)) throw new Error(`${name} must be finite.`);
    return n;
  }
  function anchor(input) {
    if (!input || !input.projected || !input.projection) throw new Error('Manual anchor requires projected coordinate and projection contract.');
    return Object.freeze({
      source: 'manual-map-click',
      lat: finite(input.lat, 'anchor.lat'), lng: finite(input.lng, 'anchor.lng'),
      projected: { x: finite(input.projected.x, 'anchor.projected.x'), y: finite(input.projected.y, 'anchor.projected.y') },
      projection: clone(input.projection), timestampEpochMs: finite(input.timestampEpochMs, 'anchor.timestampEpochMs')
    });
  }
  function groundTruth(startAnchor, endAnchor) {
    return Object.freeze({
      dx: endAnchor.projected.x - startAnchor.projected.x,
      dy: endAnchor.projected.y - startAnchor.projected.y,
      magnitude: Math.hypot(endAnchor.projected.x - startAnchor.projected.x, endAnchor.projected.y - startAnchor.projected.y)
    });
  }
  function roiGeometry(input) {
    if (!input) throw new Error('ROI geometry is required.');
    const x = finite(input.x, 'roi.x'), y = finite(input.y, 'roi.y');
    const width = finite(input.width, 'roi.width'), height = finite(input.height, 'roi.height');
    if (width <= 0 || height <= 0) throw new Error('ROI dimensions must be positive.');
    if (x === 0 && y === 0 && width === 216 && height === 216) throw new Error('The historical top-left 216x216 forensic crop is forbidden.');
    const centerX = Number.isFinite(input.centerX) ? Number(input.centerX) : x + width / 2;
    const centerY = Number.isFinite(input.centerY) ? Number(input.centerY) : y + height / 2;
    return Object.freeze({
      x, y, width, height, centerX, centerY,
      radius: Math.min(width, height) / 2,
      shape: 'square-containing-inscribed-disc',
      fullMinimapDiscCapture: true,
      runtimeCaptureGeometry: true
    });
  }
  function pairDt(frames) {
    const values = [];
    for (let i = 1; i < frames.length; i++) values.push(frames[i].monotonicTimestampMs - frames[i - 1].monotonicTimestampMs);
    return { valuesMs: values, minMs: values.length ? Math.min(...values) : null, maxMs: values.length ? Math.max(...values) : null, meanMs: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null };
  }
  function u16(value) { return [value & 255, (value >>> 8) & 255]; }
  function u32(value) { return [value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255]; }
  function crc32(data) {
    let crc = 0xffffffff;
    for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    return (crc ^ 0xffffffff) >>> 0;
  }
  function storedZip(entries) {
    let offset = 0; const local = [], central = [];
    for (const entry of entries) {
      const name = encoder.encode(entry.name), data = bytes(entry.bytes), crc = crc32(data);
      const header = new Uint8Array([0x50,0x4b,0x03,0x04,20,0,0,0,0,0,0,0,33,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0]);
      local.push(header, name, data);
      central.push(new Uint8Array([0x50,0x4b,0x01,0x02,20,0,20,0,0,0,0,0,33,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,0,0,...u32(offset)]), name);
      offset += header.length + name.length + data.length;
    }
    const centralSize = central.reduce((size, item) => size + item.length, 0);
    const end = new Uint8Array([0x50,0x4b,0x05,0x06,0,0,0,0,...u16(entries.length),...u16(entries.length),...u32(centralSize),...u32(offset),0,0]);
    const output = new Uint8Array(offset + centralSize + end.length); let cursor = 0;
    for (const item of [...local, ...central, end]) { output.set(item, cursor); cursor += item.length; }
    return output;
  }
  class FixtureRecorder {
    constructor(options = {}) {
      this.maxDurationMs = options.maxDurationMs || MAX_DURATION_MS;
      this.maxFrames = options.maxFrames || MAX_FRAMES_PER_RUN;
      this.runs = RUN_LABELS.map((label, index) => ({ runId: `run-${label.toLowerCase()}`, label, index, startAnchor: null, endAnchor: null, frames: [], recording: false, captureStartTimestampEpochMs: null, captureEndTimestampEpochMs: null, stopReason: null, diagnosticPrediction: [] }));
      this.activeIndex = 0;
    }
    get activeRun() { return this.runs[this.activeIndex]; }
    selectStart(value) { if (this.activeRun.recording) throw new Error('Stop recording before selecting a start anchor.'); this.activeRun.startAnchor = anchor(value); return this.activeRun.startAnchor; }
    start(meta) {
      const run = this.activeRun;
      if (!run.startAnchor) throw new Error('Select the manual start anchor first.');
      if (run.recording) throw new Error('Recording already started.');
      run.recording = true; run.captureStartTimestampEpochMs = finite(meta.captureTimestampEpochMs, 'captureStartTimestampEpochMs'); run.captureStartMonotonicMs = finite(meta.monotonicTimestampMs, 'captureStartMonotonicMs'); run.captureMetadata = clone(meta.captureMetadata || {}); return run;
    }
    stop(meta) {
      const run = this.activeRun; if (!run.recording) throw new Error('No active recording.');
      run.recording = false; run.captureEndTimestampEpochMs = finite(meta.captureTimestampEpochMs, 'captureEndTimestampEpochMs'); run.captureEndMonotonicMs = finite(meta.monotonicTimestampMs, 'captureEndMonotonicMs'); run.stopReason = meta.reason || 'user'; return run;
    }
    selectEnd(value) { const run = this.activeRun; if (run.recording) throw new Error('Stop recording before selecting an end anchor.'); if (!run.startAnchor) throw new Error('Select start anchor first.'); run.endAnchor = anchor(value); return run.endAnchor; }
    nextRun() { if (!this.activeRun.endAnchor) throw new Error('Select the current run end anchor first.'); if (this.activeIndex >= this.runs.length - 1) throw new Error('All required runs are already selected.'); this.activeIndex++; return this.activeRun; }
    recordDiagnostic(prediction) { if (this.activeRun.recording) this.activeRun.diagnosticPrediction.push(clone(prediction)); }
    async recordFrame(input) {
      const run = this.activeRun; if (!run.recording) return { recorded: false, reason: 'not-recording' };
      const monotonicTimestampMs = finite(input.monotonicTimestampMs, 'monotonicTimestampMs');
      const elapsed = monotonicTimestampMs - run.captureStartMonotonicMs;
      if (elapsed > this.maxDurationMs || run.frames.length >= this.maxFrames) return { recorded: false, reason: 'duration-limit' };
      const prior = run.frames.at(-1); if (prior && monotonicTimestampMs <= prior.monotonicTimestampMs) throw new Error('Frame timestamps must be strictly monotonic.');
      const imageBytes = bytes(input.imageBytes); const index = run.frames.length;
      const frame = { index, file: `frame-${String(index).padStart(4, '0')}.png`, captureTimestampEpochMs: finite(input.captureTimestampEpochMs, 'captureTimestampEpochMs'), monotonicTimestampMs, sourceVideoTimestampMs: input.sourceVideoTimestampMs == null ? null : finite(input.sourceVideoTimestampMs, 'sourceVideoTimestampMs'), roi: roiGeometry(input.roi), sourceCaptureWidth: finite(input.sourceCaptureWidth, 'sourceCaptureWidth'), sourceCaptureHeight: finite(input.sourceCaptureHeight, 'sourceCaptureHeight'), bytes: imageBytes, sha256: await sha256(imageBytes) };
      run.frames.push(frame); return { recorded: true, frame };
    }
    complete() { return this.runs.every(run => run.startAnchor && run.endAnchor && run.frames.length && !run.recording); }
    async export(identity = {}) {
      if (!this.complete()) throw new Error('Exactly three completed WALK, RUN, SPRINT runs are required before export.');
      const entries = []; const runManifests = [];
      for (const run of this.runs) {
        const truth = groundTruth(run.startAnchor, run.endAnchor);
        const data = { schema: 'wwmsync-ground-truth-motion-run-v1', runId: run.runId, label: run.label, startAnchor: run.startAnchor, endAnchor: run.endAnchor, groundTruth: truth, captureStartTimestampEpochMs: run.captureStartTimestampEpochMs, captureEndTimestampEpochMs: run.captureEndTimestampEpochMs, durationMs: run.captureEndMonotonicMs - run.captureStartMonotonicMs, frameCount: run.frames.length, nominalCaptureIntervalMs: NOMINAL_CAPTURE_INTERVAL_MS, actualPairDt: pairDt(run.frames), sourceDimensions: run.captureMetadata.sourceDimensions, roiGeometry: run.frames[0].roi, mapProjectionContract: run.startAnchor.projection, absoluteLocalization: false, diagnosticPrediction: run.diagnosticPrediction, frames: run.frames.map(frame => ({ index: frame.index, file: frame.file, captureTimestampEpochMs: frame.captureTimestampEpochMs, monotonicTimestampMs: frame.monotonicTimestampMs, sourceVideoTimestampMs: frame.sourceVideoTimestampMs, roi: frame.roi, sourceCaptureWidth: frame.sourceCaptureWidth, sourceCaptureHeight: frame.sourceCaptureHeight, sha256: frame.sha256 })) };
        const json = JSON.stringify(data, null, 2) + '\n'; const jsonBytes = encoder.encode(json); const jsonHash = await sha256(jsonBytes);
        for (const frame of run.frames) entries.push({ name: `${run.runId}/${frame.file}`, bytes: frame.bytes, sha256: frame.sha256 });
        entries.push({ name: `${run.runId}/run.json`, bytes: jsonBytes, sha256: jsonHash });
        runManifests.push({ runId: run.runId, label: run.label, runJsonSha256: jsonHash, frameHashes: data.frames.map(frame => ({ file: frame.file, sha256: frame.sha256 })) });
      }
      const aggregate = await sha256(entries.map(entry => `${entry.name}:${entry.sha256}`).sort().join('\n'));
      const manifest = { schema: 'wwmsync-ground-truth-motion-v1', taskId: 'WWMSYNC-GT-MOTION-FIXTURE-V1', groundTruthContract: 'GroundTruthVector = manual end projected coordinate - manual start projected coordinate. Tracker output is diagnostic only.', requiredRunLabels: RUN_LABELS, nominalCaptureIntervalMs: NOMINAL_CAPTURE_INTERVAL_MS, maxDurationMs: this.maxDurationMs, maxFramesPerRun: this.maxFrames, appCommitSha: identity.appCommitSha || 'UNAVAILABLE_STATIC_BUILD', branch: identity.branch || 'UNAVAILABLE_STATIC_BUILD', browserUserAgent: identity.browserUserAgent || null, devicePixelRatio: identity.devicePixelRatio || null, screen: identity.screen || null, absoluteLocalization: false, aggregateEntriesSha256: aggregate, runs: runManifests };
      const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2) + '\n'); entries.unshift({ name: 'manifest.json', bytes: manifestBytes, sha256: await sha256(manifestBytes) }); entries.push({ name: 'README.txt', bytes: encoder.encode(README), sha256: await sha256(README) });
      const zipBytes = storedZip(entries); return { filename: 'wwmsync-ground-truth-motion-v1.zip', bytes: zipBytes, manifest, entries: entries.map(({ name, sha256 }) => ({ name, sha256 })) };
    }
  }
  const api = { RUN_LABELS, NOMINAL_CAPTURE_INTERVAL_MS, MAX_DURATION_MS, MAX_FRAMES_PER_RUN, README, anchor, groundTruth, roiGeometry, pairDt, sha256, storedZip, FixtureRecorder };
  root.WWMSyncGroundTruthFixtureCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
