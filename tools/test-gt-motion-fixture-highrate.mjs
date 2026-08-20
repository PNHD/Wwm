import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import Core from '../gt-motion-fixture-core.js';

const projection = { kind: 'Leaflet.project', crs: 'EPSG:3857', referenceZoom: 11 };
const anchorInput = (x, y, t = 1000) => ({ lat: 1, lng: 2, projected: { x, y }, projection, timestampEpochMs: t });
const roi = { x: 10, y: 12, width: 270, height: 270 };
const png = (tag = 0) => new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, tag, 0, 0, 0]);

function newRecorder(options) {
  const r = new Core.HighRateWalkRecorder(options);
  r.selectStart(anchorInput(0, 0));
  return r;
}

// tickIndex n maps to the absolute schedule target = captureStart + n * interval, matching the UI's scheduler.
function tickInput(recorder, n, overrides = {}) {
  const target = recorder.captureStartMonotonicMs + n * recorder.nominalIntervalMs;
  return {
    tickIndex: n, targetTimestampMs: target, tickStartMonotonicMs: target, tickCompleteMonotonicMs: target + 2,
    captureTimestampEpochMs: Date.now(), sourceVideoTimestampMs: target,
    roi, sourceCaptureWidth: 1920, sourceCaptureHeight: 1080, phase: n < 2 ? 'preroll' : 'walk',
    raw: null, ...overrides
  };
}

async function completedRecorder(options, frameCount = 5) {
  const r = newRecorder(options);
  r.start({ captureTimestampEpochMs: 1000, monotonicTimestampMs: 1000, captureMetadata: { sourceDimensions: { width: 1920, height: 1080 } } });
  const encodedFrames = [];
  for (let i = 0; i < frameCount; i++) {
    const result = r.recordFrame(tickInput(r, i));
    assert.equal(result.recorded, true, `frame ${i} should record`);
    encodedFrames.push({ index: i, pngBytes: png(i) });
  }
  r.stop({ captureTimestampEpochMs: 2000, monotonicTimestampMs: 1000 + frameCount * 50, reason: 'user' });
  r.selectEnd(anchorInput(3, 4, 2100));
  return { r, encodedFrames };
}

// --- Standard-spec ZIP reader, written independently of gt-motion-fixture-core.js's writer, to catch
// central-directory regressions that only a real unzip tool would notice (fixed offsets, not tolerant parsing). ---
function crc32Of(data) {
  let crc = 0xffffffff;
  for (const byte of data) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
function readU16(view, offset) { return view.getUint16(offset, true); }
function readU32(view, offset) { return view.getUint32(offset, true); }
function parseStandardZip(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0; i--) if (readU32(view, i) === 0x06054b50) { eocd = i; break; }
  assert.ok(eocd >= 0, 'End of central directory record not found');
  const entryCount = readU16(view, eocd + 10);
  const centralDirOffset = readU32(view, eocd + 16);
  const entries = [];
  let cursor = centralDirOffset;
  for (let i = 0; i < entryCount; i++) {
    assert.equal(readU32(view, cursor), 0x02014b50, `central directory entry ${i} has a bad signature`);
    const crc32 = readU32(view, cursor + 16);
    const compressedSize = readU32(view, cursor + 20);
    const uncompressedSize = readU32(view, cursor + 24);
    const nameLength = readU16(view, cursor + 28);
    const extraLength = readU16(view, cursor + 30);
    const commentLength = readU16(view, cursor + 32);
    const localHeaderOffset = readU32(view, cursor + 42);
    const name = new TextDecoder().decode(bytes.slice(cursor + 46, cursor + 46 + nameLength));
    assert.equal(readU32(view, localHeaderOffset), 0x04034b50, `local header for ${name} has a bad signature`);
    const localNameLength = readU16(view, localHeaderOffset + 26);
    const localExtraLength = readU16(view, localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const data = bytes.slice(dataStart, dataStart + compressedSize);
    assert.equal(data.length, uncompressedSize, `${name} stored size mismatch`);
    assert.equal(crc32Of(data), crc32 >>> 0, `${name} CRC-32 mismatch`);
    entries.push({ name, crc32, size: uncompressedSize, data });
    cursor += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

test('storedZip produces a spec-conformant central directory (regression for the padding bug)', () => {
  const entries = Core.storedZip([
    { name: 'a.txt', bytes: new TextEncoder().encode('hello') },
    { name: 'dir/b.txt', bytes: new TextEncoder().encode('world!!') }
  ]);
  const parsed = parseStandardZip(entries);
  assert.deepEqual(parsed.map(e => e.name), ['a.txt', 'dir/b.txt']);
  assert.equal(new TextDecoder().decode(parsed[0].data), 'hello');
  assert.equal(new TextDecoder().decode(parsed[1].data), 'world!!');
});

test('developer query gate: gt-highrate requires gt-motion-fixture=1 and is a distinct mode', async () => {
  const ui = await readFile(new URL('../gt-motion-fixture.js', import.meta.url), 'utf8');
  assert.match(ui, /gt-highrate/);
  assert.match(ui, /params\.get\('gt-motion-fixture'\)==='1'&&params\.get\('gt-highrate'\)==='1'/);
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /gtHighRateMotionPanel[^>]*hidden/);
});

test('ordinary mode is unaffected: WALK/RUN/SPRINT contract and existing gating are unchanged', async () => {
  assert.deepEqual(Core.RUN_LABELS, ['WALK', 'RUN', 'SPRINT']);
  const ui = await readFile(new URL('../gt-motion-fixture.js', import.meta.url), 'utf8');
  assert.match(ui, /enabled=params\.get\('gt-motion-fixture'\)==='1',appCommitSha=params\.get\('app-commit'\)\|\|'';/);
  assert.match(ui, /el\.gtNext\.addEventListener/);
});

test('high-rate mode is WALK-only: no RUN/SPRINT progression API', () => {
  const r = new Core.HighRateWalkRecorder();
  assert.equal(typeof r.nextRun, 'undefined');
  assert.equal(r.canExport(), false);
});

test('strict state reset: selecting a new start clears frames, end anchor, and tick index', async () => {
  const { r } = await completedRecorder();
  assert.equal(r.frames.length, 5);
  assert.ok(r.endAnchor);
  r.selectStart(anchorInput(9, 9));
  assert.equal(r.frames.length, 0);
  assert.equal(r.endAnchor, null);
  assert.equal(r.lastTickIndex, -1);
});

test('stale end anchor is rejected: a fresh recorder never satisfies the export gate', () => {
  const r = new Core.HighRateWalkRecorder();
  assert.equal(r.canExport(), false);
  assert.throws(() => r.selectEnd(anchorInput(1, 1)), /Select start anchor first/);
});

test('max sample and duration bounds are enforced without discarding saved evidence', () => {
  const r = newRecorder({ maxSamples: 2, maxDurationMs: 1000 });
  r.start({ captureTimestampEpochMs: 1, monotonicTimestampMs: 1, captureMetadata: {} });
  assert.equal(r.recordFrame(tickInput(r, 0)).recorded, true);
  assert.equal(r.recordFrame(tickInput(r, 1)).recorded, true);
  assert.equal(r.recordFrame(tickInput(r, 2)).reason, 'sample-limit');
  assert.equal(r.frames.length, 2);

  const r2 = newRecorder({ maxDurationMs: 60 });
  r2.start({ captureTimestampEpochMs: 1, monotonicTimestampMs: 0, captureMetadata: {} });
  assert.equal(r2.recordFrame(tickInput(r2, 0)).recorded, true);
  assert.equal(r2.recordFrame({ ...tickInput(r2, 1), tickCompleteMonotonicMs: 5000 }).reason, 'duration-limit');
  assert.equal(r2.frames.length, 1);
});

test('nominal schedule is absolute (captureStart + n * 50ms), and lateness is measured against it', () => {
  const r = newRecorder();
  r.start({ captureTimestampEpochMs: 1, monotonicTimestampMs: 10000, captureMetadata: {} });
  const late = r.recordFrame({ ...tickInput(r, 3), tickStartMonotonicMs: r.captureStartMonotonicMs + 3 * 50 + 12 });
  assert.equal(late.frame.targetTimestampMs, 10000 + 3 * 50);
  assert.equal(late.frame.latenessMs, 12);
  assert.throws(() => r.recordFrame(tickInput(r, 3)), /Tick index must be strictly increasing/);
});

test('export validates monotonic order and blocks with an actionable error on corruption', async () => {
  const { r, encodedFrames } = await completedRecorder();
  r.frames[2] = { ...r.frames[2], tickCompleteMonotonicMs: r.frames[0].tickCompleteMonotonicMs };
  await assert.rejects(() => r.export({ appCommitSha: 'a'.repeat(40) }, encodedFrames), /not ordered by capture timestamp/);
});

test('duplicate source frames are detected from identical encoded bytes and never silently dropped', async () => {
  const { r, encodedFrames } = await completedRecorder(undefined, 4);
  encodedFrames[2].pngBytes = encodedFrames[1].pngBytes;
  const result = await r.export({ appCommitSha: 'a'.repeat(40) }, encodedFrames);
  assert.equal(result.manifest.duplicateSourceFrameCount, 1);
  assert.deepEqual(result.runData.duplicateSourceFrameIndices, [2]);
  assert.equal(result.runData.frames.length, 4, 'duplicates are kept in the archive, not discarded');
});

test('provenance flags mark the fixture as evidence, not a fit', async () => {
  const { r, encodedFrames } = await completedRecorder();
  const result = await r.export({ appCommitSha: 'a'.repeat(40), branch: 'test' }, encodedFrames);
  for (const target of [result.manifest, result.runData]) {
    assert.equal(target.trackerUsedForTruth, false);
    assert.equal(target.walkOutcomeUsedForTransform, false);
    assert.equal(target.scaleFittedFromWalk, false);
    assert.equal(target.orientationFittedFromWalk, false);
    assert.equal(target.absoluteLocalization, false);
  }
});

test('exported filename, structure, standard-zip integrity, and manifest/frame hash consistency', async () => {
  const { r, encodedFrames } = await completedRecorder();
  const result = await r.export({ appCommitSha: 'a'.repeat(40), branch: 'test' }, encodedFrames);
  assert.equal(result.filename, 'wwmsync-ground-truth-motion-hires-v1.zip');
  const parsed = parseStandardZip(result.bytes);
  const names = parsed.map(e => e.name).sort();
  assert.deepEqual(names, ['frames/frame-0000.png', 'frames/frame-0001.png', 'frames/frame-0002.png', 'frames/frame-0003.png', 'frames/frame-0004.png', 'manifest.json', 'run.json']);
  for (const frame of result.runData.frames) {
    const entry = parsed.find(e => e.name === `frames/${frame.file}`);
    assert.ok(entry, `${frame.file} present in archive`);
    assert.equal(crc32Of(entry.data) >>> 0, entry.crc32 >>> 0);
    const expectedSha = await Core.sha256(entry.data);
    assert.equal(frame.sha256, expectedSha);
  }
});
