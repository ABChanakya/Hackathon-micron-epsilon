import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const engine = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('demo profiles and readings match the selected sensor range', () => {
  const state = engine.createInitialState();
  assert.equal(state.profiles.length, 3);
  for (const p of state.profiles) {
    assert.ok(p.lower >= engine.SENSOR.rangeStart);
    assert.ok(p.upper <= engine.SENSOR.rangeEnd);
    assert.ok(engine.SENSOR.rates.includes(p.rate));
  }
  for (const recording of state.recordings) {
    assert.equal(recording.source, 'demo');
    assert.equal(recording.points.length, recording.duration * 5 + 1);
    assert.ok(recording.points.every(p => p.value >= engine.SENSOR.rangeStart && p.value <= engine.SENSOR.rangeEnd));
  }
});

test('accepted feedback adapts future evaluation without changing specs or mutating input', () => {
  const original = engine.createInitialState().profiles[0];
  const before = structuredClone(original);
  const { profile, event } = engine.acceptFeedback(original, 37.57, true, 'Bauteil in Ordnung', 3.2);
  assert.deepEqual(original, before);
  assert.equal(profile.lower, before.lower);
  assert.equal(profile.upper, before.upper);
  assert.equal(profile.learnedUpper, 37.575);
  assert.equal(profile.version, 2);
  assert.equal(event.t, 3.2);
  assert.equal(profile.history.length, 1);
  assert.equal(event.nextUpper, 37.575);
});

test('rejected feedback and paused learning retain the detection corridor', () => {
  const p = engine.createInitialState().profiles[0];
  const rejected = engine.acceptFeedback(p, 37.57, false).profile;
  assert.equal(rejected.learnedUpper, p.upper);
  assert.equal(rejected.version, 1);
  assert.equal(rejected.history[0].accepted, false);
  const paused = engine.acceptFeedback({ ...p, learning: false }, 37.57, true).profile;
  assert.equal(paused.learnedUpper, p.upper);
  assert.equal(paused.history[0].changed, false);
});

test('learning remains bounded by physical sensor range', () => {
  const p = engine.createInitialState().profiles[0];
  const high = engine.acceptFeedback(p, 500, true).profile;
  assert.equal(high.learnedUpper, engine.SENSOR.rangeEnd);
  const low = engine.acceptFeedback(p, -50, true).profile;
  assert.equal(low.learnedLower, engine.SENSOR.rangeStart);
});

test('undo and reset preserve an auditable history', () => {
  const p = engine.createInitialState().profiles[0];
  const learned = engine.acceptFeedback(p, 37.57, true).profile;
  const second = engine.acceptFeedback(learned, 37.6, true).profile;
  const undone = engine.undoLearning(second);
  assert.equal(undone.learnedUpper, learned.learnedUpper);
  assert.equal(undone.history.length, 3);
  const twice = engine.undoLearning(undone);
  assert.equal(twice.learnedUpper, p.upper);
  const reset = engine.resetLearning(second);
  assert.equal(reset.learnedLower, p.lower);
  assert.equal(reset.learnedUpper, p.upper);
  assert.equal(reset.history.at(-1).type, 'reset');
});

test('selected report window validates limits and includes only matching data', () => {
  const recording = engine.createInitialState().recordings[0];
  const points = engine.slicePoints(recording, 10, 20);
  assert.equal(points.length, 51);
  assert.equal(points[0].t, 10);
  assert.equal(points.at(-1).t, 20);
  for (const args of [[20, 10], [-1, 10], [0, 61], [NaN, 10]]) {
    assert.throws(() => engine.slicePoints(recording, ...args));
  }
});

test('statistics and duration support empty data and long runs', () => {
  assert.equal(engine.statistics([]).mean, null);
  assert.equal(engine.statistics([{value: 1}, {value: 3}]).mean, 2);
  assert.equal(engine.formatDuration(3661), '61:01');
});

test('storage failures remain visible rather than reporting success', () => {
  globalThis.localStorage = { getItem() { return '{broken'; }, setItem() { throw new Error('QuotaExceeded'); } };
  assert.throws(() => engine.loadState(), /nicht gelesen/);
  assert.throws(() => engine.saveState({}), /Speichern fehlgeschlagen/);
  delete globalThis.localStorage;
});

test('undo cannot cross a manually changed specification baseline', () => {
  const original = engine.createInitialState().profiles[0];
  const learned = engine.acceptFeedback(original, 37.57, true).profile;
  const edited = { ...learned, target: 38, lower: 37.9, upper: 38.1, learnedLower: 37.9, learnedUpper: 38.1, version: 3,
    history: [...learned.history, { id: 'manual-edit', type: 'profile', changed: true, previousLower: learned.learnedLower, previousUpper: learned.learnedUpper }] };
  const unchanged = engine.undoLearning(edited);
  assert.equal(unchanged.learnedLower, 37.9);
  assert.equal(unchanged.learnedUpper, 38.1);
  assert.equal(unchanged.history.length, edited.history.length);
  const later = engine.acceptFeedback(edited, 38.12, true).profile;
  const undone = engine.undoLearning(later);
  assert.equal(undone.learnedUpper, 38.1);
});

test('CSV preserves each point version and absolute data when zeroing display', async () => {
  const recording = engine.createInitialState().recordings[0];
  recording.points = [{ t: 0, value: 37.501, version: 1 }, { t: 0.2, value: 37.509, version: 2 }];
  recording.zeroOffset = 37.5;
  recording.profile.version = 3;
  let captured;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  globalThis.document = { createElement() { return { click() {}, remove() {} }; }, body: { append() {} } };
  URL.createObjectURL = blob => { captured = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    engine.exportRecordingCSV(recording);
    const csv = await captured.text();
    assert.match(csv, /"measurement","0","37.501","0.001","","","1"/);
    assert.match(csv, /"measurement","0.2","37.509","0.009","","","2"/);
  } finally {
    URL.createObjectURL = originalCreate;
    URL.revokeObjectURL = originalRevoke;
    delete globalThis.document;
  }
});

test('real PDF export uses selected-window learning state and application time', async () => {
  const vendor = await readFile(new URL('../dist/vendor/jspdf.umd.min.js', import.meta.url), 'utf8');
  const commonjs = { exports: {} };
  vm.runInNewContext(vendor, { module: commonjs, exports: commonjs.exports, require: createRequire(import.meta.url), console, process,
    Buffer, setTimeout, clearTimeout, atob, btoa, TextEncoder, TextDecoder, Blob });
  const JsPDF = commonjs.exports.jsPDF;
  assert.equal(typeof JsPDF, 'function');
  const recording = engine.createInitialState().recordings[0];
  recording.profileAtStart = structuredClone(recording.profile);
  const result = engine.acceptFeedback(recording.profile, 37.57, true, 'Spätere Lernanpassung', 10);
  recording.profile = result.profile;
  recording.parameterHistory = [{ ...result.event, t: 10, appliedT: 40 }];
  recording.zeroOffset = 37.5;
  let captured = [], pdfBytes;
  globalThis.jspdf = { jsPDF: function (...args) {
    const doc = new JsPDF(...args);
    const originalText = doc.text.bind(doc);
    doc.text = (text, ...rest) => { captured.push(String(text)); return originalText(text, ...rest); };
    doc.save = () => { pdfBytes = Buffer.from(doc.output('arraybuffer')); };
    return doc;
  } };
  try {
    engine.exportReportPDF(recording, { start: 0, end: 20 });
    assert.ok(captured.some(text => /Version 1/.test(text)));
    assert.ok(!captured.some(text => /Version 2/.test(text)));
    assert.ok(captured.some(text => text.includes('Keine Parameteränderungen')));
    assert.equal(pdfBytes.subarray(0, 4).toString(), '%PDF');
    assert.ok(pdfBytes.length > 5000);
    captured = [];
    engine.exportReportPDF(recording, { start: 40, end: 60 });
    assert.ok(captured.some(text => /Version 2/.test(text)));
    assert.match(captured.join(' '), /00:40 - Version 2/);
  } finally { delete globalThis.jspdf; }
});
