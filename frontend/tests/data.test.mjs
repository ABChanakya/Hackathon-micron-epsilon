import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const engine = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

test('demo profiles and readings match the selected sensor range', () => {
  const state = engine.createInitialState();
  assert.equal(engine.SENSOR.model, 'optoNCDT 1900-10');
  assert.deepEqual([engine.SENSOR.rangeStart, engine.SENSOR.rangeEnd], [20, 30]);
  assert.ok(engine.SENSOR.rates.includes(10000));
  assert.equal(state.profiles.length, 3);
  for (const p of state.profiles) {
    assert.ok(p.lower >= engine.SENSOR.rangeStart);
    assert.ok(p.upper <= engine.SENSOR.rangeEnd);
    assert.ok(engine.SENSOR.rates.includes(p.rate));
  }
  for (const recording of state.recordings) {
    assert.equal(recording.source, 'demo');
    assert.equal(recording.sensor, engine.SENSOR.model);
    assert.equal(recording.points.length, recording.duration * 5 + 1);
    assert.ok(recording.points.every(p => p.value >= engine.SENSOR.rangeStart && p.value <= engine.SENSOR.rangeEnd));
  }
});

test('accepted feedback adapts future evaluation without changing specs or mutating input', () => {
  const original = engine.createInitialState().profiles[0];
  const before = structuredClone(original);
  const { profile, event } = engine.acceptFeedback(original, 25.07, true, 'Bauteil in Ordnung', 3.2);
  assert.deepEqual(original, before);
  assert.equal(profile.lower, before.lower);
  assert.equal(profile.upper, before.upper);
  assert.equal(profile.learnedUpper, 25.075);
  assert.equal(profile.version, 2);
  assert.equal(event.t, 3.2);
  assert.equal(profile.history.length, 1);
  assert.equal(event.nextUpper, 25.075);
});

test('rejected feedback and paused learning retain the detection corridor', () => {
  const p = engine.createInitialState().profiles[0];
  const rejected = engine.acceptFeedback(p, 25.07, false).profile;
  assert.equal(rejected.learnedUpper, p.upper);
  assert.equal(rejected.version, 1);
  assert.equal(rejected.history[0].accepted, false);
  const paused = engine.acceptFeedback({ ...p, learning: false }, 25.07, true).profile;
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
  const learned = engine.acceptFeedback(p, 25.07, true).profile;
  const second = engine.acceptFeedback(learned, 25.1, true).profile;
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

test('the sensor change keeps historical 1420 readings and initializes valid 1900 profiles', () => {
  const legacyProfile = {
    ...engine.createInitialState().profiles[0], target: 37.5,
    lower: 37.45, upper: 37.55, learnedLower: 37.45, learnedUpper: 37.58,
  };
  const originalRecording = {
    id: 'old-measurement', name: '1420-Prüflauf', source: 'bridge',
    sensor: 'optoNCDT 1420-25', duration: 1, profile: legacyProfile,
    points: [{ t: 0, value: 37.502, version: 1 }, { t: 1, value: 37.55, version: 2 }],
  };
  const store = new Map([['micro-epsilon-monitor-v1', JSON.stringify({
    profiles: [legacyProfile], activeProfileId: legacyProfile.id, recordings: [originalRecording],
    settings: { rate: 2000, averaging: 4, output: 'rs422' }, setupComplete: true,
  })]]);
  globalThis.localStorage = {
    getItem: key => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, value),
  };
  try {
    const migrated = engine.loadState();
    const currentProfile = migrated.profiles.find(profile => profile.id === migrated.activeProfileId);
    assert.ok(currentProfile);
    assert.ok(currentProfile.lower >= 20 && currentProfile.upper <= 30);
    assert.deepEqual(migrated.recordings.find(recording => recording.id === originalRecording.id), originalRecording);
    currentProfile.name = 'Werkstückabstand';
    engine.saveState(migrated);
    const reloaded = engine.loadState();
    const reloadedProfile = reloaded.profiles.find(profile => profile.id === reloaded.activeProfileId);
    assert.equal(reloadedProfile.name, 'Werkstückabstand');
    assert.deepEqual(reloaded.recordings, migrated.recordings);
  } finally {
    delete globalThis.localStorage;
  }
});

test('undo cannot cross a manually changed specification baseline', () => {
  const original = engine.createInitialState().profiles[0];
  const learned = engine.acceptFeedback(original, 25.07, true).profile;
  const edited = { ...learned, target: 25.5, lower: 25.4, upper: 25.6, learnedLower: 25.4, learnedUpper: 25.6, version: 3,
    history: [...learned.history, { id: 'manual-edit', type: 'profile', changed: true, previousLower: learned.learnedLower, previousUpper: learned.learnedUpper }] };
  const unchanged = engine.undoLearning(edited);
  assert.equal(unchanged.learnedLower, 25.4);
  assert.equal(unchanged.learnedUpper, 25.6);
  assert.equal(unchanged.history.length, edited.history.length);
  const later = engine.acceptFeedback(edited, 25.62, true).profile;
  const undone = engine.undoLearning(later);
  assert.equal(undone.learnedUpper, 25.6);
});

test('CSV preserves each point version and absolute data when zeroing display', async () => {
  const recording = engine.createInitialState().recordings[0];
  recording.points = [{ t: 0, value: 25.001, version: 1 }, { t: 0.2, value: 25.009, version: 2 }];
  recording.zeroOffset = 25.0;
  recording.profile.version = 3;
  let captured;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  globalThis.document = { createElement() { return { click() {}, remove() {} }; }, body: { append() {} } };
  URL.createObjectURL = blob => { captured = blob; return 'blob:test'; };
  URL.revokeObjectURL = () => {};
  try {
    engine.exportRecordingCSV(recording);
    const csv = await captured.text();
    assert.match(csv, /"measurement","0","25.001","0.001","","","1"/);
    assert.match(csv, /"measurement","0.2","25.009","0.009","","","2"/);
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
  const result = engine.acceptFeedback(recording.profile, 25.07, true, 'Spätere Lernanpassung', 10);
  recording.profile = result.profile;
  recording.parameterHistory = [{ ...result.event, t: 10, appliedT: 40 }];
  recording.zeroOffset = 25.0;
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
    recording.source = 'replay';
    captured = [];
    engine.exportReportPDF(recording, { start: 0, end: 20 });
    assert.match(captured.join(' '), /Quelle: Wiedergabe.*gespeicherte Messwerte/);
    assert.doesNotMatch(captured.join(' '), /Quelle: Sensor/);
  } finally { delete globalThis.jspdf; }
});

test('the simple bridge accepts millimetres and rejects an explicitly different sensor', () => {
  const frame = { value: 25.125, unit: 'mm', state: 'green', output: 'red' };
  const sample = { value: 25.125, led: { state: 'green', output: 'red' } };
  assert.deepEqual(engine.parseBridgeSample(frame), sample);
  assert.deepEqual(engine.parseBridgeSample({ ...frame, sensor: 'optoNCDT 1900-10' }), sample);
  assert.deepEqual(engine.parseBridgeSample({ ...frame, sensor: 'optoNCDT 1420-25' }), { error: 'model' });
  assert.equal(engine.parseBridgeSample({ ...frame, unit: 'inch' }), null);
  assert.deepEqual(engine.parseBridgeSample({ ...frame, value: 30.01 }), { error: 'range' });
  assert.deepEqual(engine.parseBridgeSample({ value: 20, unit: 'mm' }), {
    value: 20, led: { state: 'unknown', output: 'unknown' },
  });
});

test('the repository backend sends an absolute distance and can retain a stale reading during a signal error', () => {
  const frame = {
    status: 'streaming', t: 3508.4, n: 1850, value: 4.25, dist_from_face_mm: 24.75,
    tare_mm: 0.5, state_flags: { led: 'green' },
  };
  assert.deepEqual(engine.parseBridgeSample(frame), { error: 'unverified' });
  assert.deepEqual(engine.parseBridgeSample(frame, true), {
    value: 24.75, led: { state: 'green', output: 'unknown' },
  });
  for (const led of ['red', 'off']) {
    assert.deepEqual(engine.parseBridgeSample({ ...frame, state_flags: { led } }, true), { error: 'signal' });
  }
  assert.deepEqual(engine.parseBridgeSample({ ...frame, n: 0 }, true), { error: 'signal' });
  assert.deepEqual(engine.parseBridgeSample({ ...frame, dist_from_face_mm: null }, true), { error: 'signal' });
  assert.deepEqual(engine.parseBridgeSample({ ...frame, dist_from_face_mm: 19.99 }, true), { error: 'range' });
  assert.equal(engine.parseBridgeSample({ hello: 'unrelated' }, true), null);
  // real backend frames also carry the raw 18-bit status word in `state`; the LED must come from state_flags
  assert.deepEqual(engine.parseBridgeSample({ ...frame, state: 65792, state_flags: { led: 'yellow' } }, true), {
    value: 24.75, led: { state: 'yellow', output: 'unknown' },
  });
});

test('only live backend status for the 10 mm ILD1900 can identify the input sensor', () => {
  const status = {
    status: 'streaming', source: 'serial-ild1900',
    info: { model: 'ILD1900', range_mm: 10, smr_mm: 20, unit: 'mm' },
  };
  assert.equal(engine.matchesBackendSensor(status), true);
  assert.equal(engine.matchesBackendSensor({ ...status, info: { ...status.info, model: 'ILD1900-10' } }), true);
  assert.equal(engine.matchesBackendSensor({ ...status, info: { ...status.info, model: 'ILD1420-10' } }), false);
  assert.equal(engine.matchesBackendSensor({ ...status, info: { ...status.info, model: 'ILD1900-25', range_mm: 25, smr_mm: 25 } }), false);
  assert.equal(engine.matchesBackendSensor({ ...status, info: { ...status.info, smr_mm: 25 } }), false);
  assert.equal(engine.matchesBackendSensor({ ...status, info: { ...status.info, unit: 'inch' } }), false);
  assert.equal(engine.matchesBackendSensor({ ...status, source: 'replay' }), true);
});

test('native frames verify their current model and range without trusting a previous source', () => {
  const frame = {
    status: 'streaming', source: 'serial-ild1900', n: 120,
    info: { model: 'ILD1900', range_mm: 10, smr_mm: 20, unit: 'mm' },
    dist_from_face_mm: 25.123, current_valid: true, state_flags: { led: 'green' },
  };
  assert.deepEqual(engine.parseBridgeSample(frame), {
    value: 25.123, led: { state: 'green', output: 'green' },
  });
  assert.deepEqual(engine.parseBridgeSample({ ...frame, source: 'replay' }), {
    value: 25.123, led: { state: 'green', output: 'unknown' },
  });
  for (const info of [
    { ...frame.info, model: 'ILD1420-50', range_mm: 50, smr_mm: 35 },
    { ...frame.info, range_mm: 25 },
    { ...frame.info, smr_mm: 25 },
    { ...frame.info, unit: 'inch' },
    null,
  ]) {
    assert.deepEqual(engine.parseBridgeSample({ ...frame, info }, true), { error: 'model' });
  }
  assert.deepEqual(engine.parseBridgeSample({ ...frame, sensor: 'ILD1420-50' }, true), { error: 'model' });
});

test('the project bridge identifies generic ILD1900 models by the full measuring window', () => {
  const frame = {
    sensor: 'ILD1900', value: 25.123, unit: 'mm', state: 'green', output: 'green',
    range_start: 20, range_end: 30, range: 10,
  };
  assert.deepEqual(engine.parseBridgeSample(frame), {
    value: 25.123, led: { state: 'green', output: 'green' },
  });
  assert.deepEqual(engine.parseBridgeSample({ sensor: 'ILD1900', value: 25, unit: 'mm' }), { error: 'unverified' });
  assert.deepEqual(engine.parseBridgeSample({ sensor: 'ILD1900', value: 25, unit: 'mm' }, true), {
    value: 25, led: { state: 'unknown', output: 'unknown' },
  });
  for (const wrong of [{ range_start: 25 }, { range_end: 35 }, { range: 25 }, { sensor: 'ILD1420-50' }]) {
    assert.deepEqual(engine.parseBridgeSample({ ...frame, ...wrong }, true), { error: 'model' });
  }
  assert.deepEqual(engine.parseBridgeSample({ ...frame, sensor: 'ILD1900-10', range_start: 35 }), { error: 'model' });
});

test('invalid live frames never display the backend retained last good reading', () => {
  const frame = {
    status: 'streaming', source: 'serial-ild1900', n: 120,
    info: { model: 'ILD1900-10', range_mm: 10, smr_mm: 20, unit: 'mm' },
    dist_from_face_mm: 25.123, current_valid: false, state_flags: null,
  };
  assert.deepEqual(engine.parseBridgeSample(frame), { error: 'signal' });
  for (const invalid of [
    { value: null },
    { value: 25, current_valid: false },
    { value: 25, state: 'red' },
    { value: 25, state: 'off' },
    { value: 25, error: 'no peak/edge' },
  ]) {
    assert.deepEqual(engine.parseBridgeSample({ unit: 'mm', sensor: 'ILD1900-10', ...invalid }), { error: 'signal' });
  }
});

test('invalid native measurements retain independent State and Output LEDs', () => {
  const frame = {
    status: 'streaming', source: 'serial-ild1900', n: 0,
    info: { model: 'ILD1900-10', range_mm: 10, smr_mm: 20, unit: 'mm' },
    dist_from_face_mm: null, current_valid: false, state: 131332, state_flags: { led: 'red' },
  };
  assert.deepEqual(engine.bridgeLedState(frame), { state: 'red', output: 'green' });
  assert.deepEqual(engine.parseBridgeSample(frame), { error: 'signal' });
  const laserOff = { ...frame, state_flags: { led: 'off' } };
  assert.deepEqual(engine.bridgeLedState(laserOff), { state: 'off', output: 'green' });
  assert.deepEqual(engine.parseBridgeSample(laserOff), { error: 'signal' });
});

test('declared Output LEDs override serial inference including unknown and off', () => {
  const frame = { dist_from_face_mm: 25, source: 'serial-ild1900', state_flags: { led: 'green' } };
  for (const output of ['green', 'yellow', 'red', 'off', 'unknown']) {
    assert.deepEqual(engine.bridgeLedState({ ...frame, output }), { state: 'green', output });
  }
  for (const output of [null, undefined, 'invalid']) {
    assert.deepEqual(engine.bridgeLedState({ ...frame, output }), { state: 'green', output: 'unknown' });
  }
  assert.deepEqual(engine.bridgeLedState({ ...frame, source: 'replay' }), { state: 'green', output: 'unknown' });
});

test('native raw numeric status is not interpreted as an LED colour', () => {
  const frame = { dist_from_face_mm: 25, source: 'serial-ild1900', state: 65792 };
  assert.deepEqual(engine.bridgeLedState(frame), { state: 'unknown', output: 'green' });
  assert.deepEqual(engine.bridgeLedState({ ...frame, state_flags: { led: 'yellow' } }), {
    state: 'yellow', output: 'green',
  });
  assert.deepEqual(engine.bridgeLedState({ unit: 'mm', value: null, state: 'red', output: 'green' }), {
    state: 'red', output: 'green',
  });
});
