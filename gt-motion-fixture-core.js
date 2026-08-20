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
      // Central directory file header is a fixed 46-byte record (APPNOTE 4.3.12): version-made-by,
      // version-needed, flags, method, mod-time, mod-date, crc32, comp/uncomp size, name/extra/comment
      // length, disk-start, internal-attrs, external-attrs(4), local-header-offset. A prior version of
      // this writer omitted mod-date and truncated external-attrs to 2 bytes, shifting every later field
      // by 4 bytes and breaking standard unzip tools even though this module's own reader tolerated it.
      const centralHeader = new Uint8Array([0x50,0x4b,0x01,0x02,20,0,20,0,0,0,0,0,0,0,33,0,...u32(crc),...u32(data.length),...u32(data.length),...u16(name.length),0,0,0,0,0,0,0,0,...u32(0),...u32(offset)]);
      central.push(centralHeader, name);
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

  // High-rate (20 Hz) WALK-only acquisition mode. Capture-only: this module records raw ROI evidence
  // and does not run vision-sync feature extraction, correlation, or tracker estimation.
  const HIGHRATE_NOMINAL_INTERVAL_MS = 50;
  const HIGHRATE_MAX_DURATION_MS = 24000;
  const HIGHRATE_MAX_SAMPLES = 480;
  const HIGHRATE_PREROLL_MS = 2000;
  const HIGHRATE_POSTROLL_MS = 2000;
  const HIGHRATE_PHASES = Object.freeze(['preroll', 'walk', 'postroll']);

  function percentile(sortedValues, p) {
    if (!sortedValues.length) return null;
    return sortedValues[Math.min(sortedValues.length - 1, Math.max(0, Math.ceil(p * sortedValues.length) - 1))];
  }
  function stats(values) {
    if (!values.length) return { minMs: null, medianMs: null, meanMs: null, p95Ms: null, maxMs: null };
    const sorted = [...values].sort((a, b) => a - b);
    return { minMs: sorted[0], maxMs: sorted[sorted.length - 1], meanMs: values.reduce((a, b) => a + b, 0) / values.length, medianMs: percentile(sorted, 0.5), p95Ms: percentile(sorted, 0.95) };
  }
  function duplicateSourceFrameStats(hashesInOrder) {
    let duplicateCount = 0; const duplicateIndices = [];
    for (let i = 1; i < hashesInOrder.length; i++) if (hashesInOrder[i] === hashesInOrder[i - 1]) { duplicateCount++; duplicateIndices.push(i); }
    return { duplicateCount, duplicateRate: hashesInOrder.length ? duplicateCount / hashesInOrder.length : 0, duplicateIndices };
  }

  class HighRateWalkRecorder {
    constructor(options = {}) {
      this.nominalIntervalMs = options.nominalIntervalMs || HIGHRATE_NOMINAL_INTERVAL_MS;
      this.maxDurationMs = options.maxDurationMs || HIGHRATE_MAX_DURATION_MS;
      this.maxSamples = options.maxSamples || HIGHRATE_MAX_SAMPLES;
      this._resetSession();
    }
    // Full session reset. Called on construction and on every selectStart() so an aborted or completed
    // recording can never leak frames, hashes, timestamps, tick index, or anchor/provenance state into
    // the next run; callers should also just construct a fresh recorder per new capture for defense in depth.
    _resetSession() {
      this.startAnchor = null; this.endAnchor = null; this.recording = false;
      this.frames = []; this.lastTickIndex = -1;
      this.captureStartTimestampEpochMs = null; this.captureStartMonotonicMs = null;
      this.captureEndTimestampEpochMs = null; this.captureEndMonotonicMs = null;
      this.stopReason = null; this.captureMetadata = null;
    }
    selectStart(value) { if (this.recording) throw new Error('Stop recording before selecting a start anchor.'); this._resetSession(); this.startAnchor = anchor(value); return this.startAnchor; }
    start(meta) {
      if (!this.startAnchor) throw new Error('Select the manual start anchor first.');
      if (this.recording) throw new Error('Recording already started.');
      this.frames = []; this.lastTickIndex = -1; this.recording = true;
      this.captureStartTimestampEpochMs = finite(meta.captureTimestampEpochMs, 'captureStartTimestampEpochMs');
      this.captureStartMonotonicMs = finite(meta.monotonicTimestampMs, 'captureStartMonotonicMs');
      this.captureMetadata = clone(meta.captureMetadata || {});
      return this;
    }
    stop(meta) {
      if (!this.recording) throw new Error('No active recording.');
      this.recording = false;
      this.captureEndTimestampEpochMs = finite(meta.captureTimestampEpochMs, 'captureEndTimestampEpochMs');
      this.captureEndMonotonicMs = finite(meta.monotonicTimestampMs, 'captureEndMonotonicMs');
      this.stopReason = meta.reason || 'user';
      return this;
    }
    selectEnd(value) { if (this.recording) throw new Error('Stop recording before selecting an end anchor.'); if (!this.startAnchor) throw new Error('Select start anchor first.'); this.endAnchor = anchor(value); return this.endAnchor; }
    canExport() { return !!(this.startAnchor && this.endAnchor && this.frames.length && !this.recording); }
    // Absolute monotonic tick schedule: caller computes targetTimestampMs = captureStart + tickIndex * interval
    // and must supply a strictly increasing tickIndex per call (missed ticks may create gaps but never reorder).
    recordFrame(input) {
      if (!this.recording) return { recorded: false, reason: 'not-recording' };
      const tickIndex = Math.trunc(finite(input.tickIndex, 'tickIndex'));
      if (tickIndex <= this.lastTickIndex) throw new Error('Tick index must be strictly increasing.');
      const tickCompleteMonotonicMs = finite(input.tickCompleteMonotonicMs, 'tickCompleteMonotonicMs');
      const elapsed = tickCompleteMonotonicMs - this.captureStartMonotonicMs;
      if (this.frames.length >= this.maxSamples) return { recorded: false, reason: 'sample-limit' };
      if (elapsed > this.maxDurationMs) return { recorded: false, reason: 'duration-limit' };
      const prior = this.frames.at(-1);
      if (prior && tickCompleteMonotonicMs <= prior.tickCompleteMonotonicMs) throw new Error('Frame capture-complete timestamps must be strictly monotonic.');
      if (!HIGHRATE_PHASES.includes(input.phase)) throw new Error(`phase must be one of ${HIGHRATE_PHASES.join('/')}.`);
      const targetTimestampMs = finite(input.targetTimestampMs, 'targetTimestampMs');
      const tickStartMonotonicMs = finite(input.tickStartMonotonicMs, 'tickStartMonotonicMs');
      const index = this.frames.length;
      const frame = {
        index, file: `frame-${String(index).padStart(4, '0')}.png`, tickIndex,
        targetTimestampMs, latenessMs: tickStartMonotonicMs - targetTimestampMs,
        tickStartMonotonicMs, tickCompleteMonotonicMs,
        captureTimestampEpochMs: finite(input.captureTimestampEpochMs, 'captureTimestampEpochMs'),
        sourceVideoTimestampMs: input.sourceVideoTimestampMs == null ? null : finite(input.sourceVideoTimestampMs, 'sourceVideoTimestampMs'),
        roi: roiGeometry(input.roi),
        sourceCaptureWidth: finite(input.sourceCaptureWidth, 'sourceCaptureWidth'),
        sourceCaptureHeight: finite(input.sourceCaptureHeight, 'sourceCaptureHeight'),
        phase: input.phase, raw: input.raw
      };
      this.lastTickIndex = tickIndex; this.frames.push(frame);
      return { recorded: true, frame };
    }
    // Re-checked immediately before export so a corrupted in-memory sequence blocks export with an
    // actionable error instead of silently reordering or discarding evidence.
    validateMonotonic() {
      for (let i = 1; i < this.frames.length; i++) {
        if (this.frames[i].tickCompleteMonotonicMs <= this.frames[i - 1].tickCompleteMonotonicMs) throw new Error(`Recorded frame sequence is not ordered by capture timestamp at index ${i}.`);
        if (this.frames[i].tickIndex <= this.frames[i - 1].tickIndex) throw new Error(`Recorded frame sequence does not have a strictly increasing sample index at index ${i}.`);
      }
    }
    async export(identity = {}, encodedFrames) {
      if (!this.canExport()) throw new Error('Select a start anchor, record a WALK, and select an end anchor before export.');
      this.validateMonotonic();
      if (!Array.isArray(encodedFrames) || encodedFrames.length !== this.frames.length) throw new Error('Every captured frame must be PNG-encoded before export.');
      const entries = []; const frameManifests = []; const hashesInOrder = [];
      for (let i = 0; i < this.frames.length; i++) {
        const frame = this.frames[i]; const encoded = encodedFrames[i];
        if (encoded.index !== frame.index) throw new Error('Encoded frame order does not match the recorded frame sequence.');
        const pngBytes = bytes(encoded.pngBytes); const sha = await sha256(pngBytes);
        hashesInOrder.push(sha);
        entries.push({ name: `frames/${frame.file}`, bytes: pngBytes, sha256: sha });
        frameManifests.push({ index: frame.index, file: frame.file, tickIndex: frame.tickIndex, phase: frame.phase, targetTimestampMs: frame.targetTimestampMs, latenessMs: frame.latenessMs, tickStartMonotonicMs: frame.tickStartMonotonicMs, tickCompleteMonotonicMs: frame.tickCompleteMonotonicMs, captureTimestampEpochMs: frame.captureTimestampEpochMs, sourceVideoTimestampMs: frame.sourceVideoTimestampMs, roi: frame.roi, sourceCaptureWidth: frame.sourceCaptureWidth, sourceCaptureHeight: frame.sourceCaptureHeight, sha256: sha });
      }
      const duplicates = duplicateSourceFrameStats(hashesInOrder);
      const intervalValues = []; for (let i = 1; i < this.frames.length; i++) intervalValues.push(this.frames[i].tickCompleteMonotonicMs - this.frames[i - 1].tickCompleteMonotonicMs);
      const latenessValues = this.frames.map(frame => frame.latenessMs);
      const captureIntervalMs = stats(intervalValues), captureLatenessMs = stats(latenessValues);
      const gapsOver100msCount = intervalValues.filter(v => v > 100).length, gapsOver150msCount = intervalValues.filter(v => v > 150).length;
      const truth = groundTruth(this.startAnchor, this.endAnchor);
      const runData = {
        schema: 'wwmsync-ground-truth-motion-hires-run-v1', label: 'WALK',
        startAnchor: this.startAnchor, endAnchor: this.endAnchor, groundTruth: truth,
        captureStartTimestampEpochMs: this.captureStartTimestampEpochMs, captureStartMonotonicMs: this.captureStartMonotonicMs,
        captureEndTimestampEpochMs: this.captureEndTimestampEpochMs, captureEndMonotonicMs: this.captureEndMonotonicMs,
        durationMs: this.captureEndMonotonicMs - this.captureStartMonotonicMs, stopReason: this.stopReason,
        nominalCaptureIntervalMs: this.nominalIntervalMs, targetCaptureHz: 1000 / this.nominalIntervalMs,
        prerollMs: HIGHRATE_PREROLL_MS, postrollMs: HIGHRATE_POSTROLL_MS,
        frameCount: this.frames.length, sourceDimensions: (this.captureMetadata && this.captureMetadata.sourceDimensions) || null,
        roiGeometry: this.frames[0].roi, mapProjectionContract: this.startAnchor.projection,
        absoluteLocalization: false, trackerUsedForTruth: false, walkOutcomeUsedForTransform: false,
        scaleFittedFromWalk: false, orientationFittedFromWalk: false,
        actualCaptureIntervalMs: captureIntervalMs, captureLatenessMs, gapsOver100msCount, gapsOver150msCount,
        duplicateSourceFrameCount: duplicates.duplicateCount, duplicateSourceFrameRate: duplicates.duplicateRate, duplicateSourceFrameIndices: duplicates.duplicateIndices,
        frames: frameManifests
      };
      const json = JSON.stringify(runData, null, 2) + '\n'; const jsonBytes = encoder.encode(json); const jsonHash = await sha256(jsonBytes);
      entries.push({ name: 'run.json', bytes: jsonBytes, sha256: jsonHash });
      const aggregate = await sha256(entries.map(entry => `${entry.name}:${entry.sha256}`).sort().join('\n'));
      const manifest = {
        schema: 'wwmsync-ground-truth-motion-hires-v1', taskId: 'WWMSYNC-M1-HRGT1',
        groundTruthContract: 'GroundTruthVector = manual end projected coordinate - manual start projected coordinate. Tracker output is diagnostic only.',
        label: 'WALK', nominalCaptureIntervalMs: this.nominalIntervalMs, targetCaptureHz: 1000 / this.nominalIntervalMs,
        maxDurationMs: this.maxDurationMs, maxSamples: this.maxSamples, mode: 'gt-motion-fixture=1&gt-highrate=1',
        appCommitSha: identity.appCommitSha || 'UNAVAILABLE_STATIC_BUILD', branch: identity.branch || 'UNAVAILABLE_STATIC_BUILD',
        browserUserAgent: identity.browserUserAgent || null, devicePixelRatio: identity.devicePixelRatio || null, screen: identity.screen || null,
        absoluteLocalization: false, trackerUsedForTruth: false, walkOutcomeUsedForTransform: false, scaleFittedFromWalk: false, orientationFittedFromWalk: false,
        frameCount: this.frames.length, duplicateSourceFrameCount: duplicates.duplicateCount,
        actualCaptureIntervalMs: captureIntervalMs, captureLatenessMs, gapsOver100msCount, gapsOver150msCount,
        runJsonSha256: jsonHash, aggregateEntriesSha256: aggregate
      };
      const manifestBytes = encoder.encode(JSON.stringify(manifest, null, 2) + '\n');
      entries.unshift({ name: 'manifest.json', bytes: manifestBytes, sha256: await sha256(manifestBytes) });
      const zipBytes = storedZip(entries);
      return { filename: 'wwmsync-ground-truth-motion-hires-v1.zip', bytes: zipBytes, manifest, runData, entries: entries.map(({ name, sha256 }) => ({ name, sha256 })) };
    }
  }

  const api = { RUN_LABELS, NOMINAL_CAPTURE_INTERVAL_MS, MAX_DURATION_MS, MAX_FRAMES_PER_RUN, README, anchor, groundTruth, roiGeometry, pairDt, sha256, storedZip, FixtureRecorder, HIGHRATE_NOMINAL_INTERVAL_MS, HIGHRATE_MAX_DURATION_MS, HIGHRATE_MAX_SAMPLES, HIGHRATE_PREROLL_MS, HIGHRATE_POSTROLL_MS, HIGHRATE_PHASES, stats, duplicateSourceFrameStats, HighRateWalkRecorder };
  root.WWMSyncGroundTruthFixtureCore = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof globalThis === 'undefined' ? this : globalThis);
