import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const start = appSource.indexOf('function connectBridge(');
const end = appSource.indexOf('\nfunction connectionFailed', start);
assert.ok(start >= 0 && end > start, 'the production bridge connection function is available');
const connectionSource = appSource.slice(start, end);
function productionFunction(startMarker, endMarker) {
  const first = appSource.indexOf(startMarker), last = appSource.indexOf(endMarker, first);
  assert.ok(first >= 0 && last > first, `${startMarker} is available`);
  return appSource.slice(first, last);
}
const switchSource = productionFunction('function switchSensor(', '\nasync function verifyBackend');
const finishSource = productionFunction('function finishRecord(', '\nfunction saveRecording');
const interruptSource = productionFunction('function interruptRecord(', '\nfunction useDemo');
const interruptionMarkerSource = productionFunction('function markInterruption(', '\nfunction chartStatus');
const dataSource = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const engine = await import(`data:text/javascript;base64,${Buffer.from(dataSource).toString('base64')}`);

function frame(overrides = {}) {
  return {
    status: 'streaming', source: 'serial-ild1900',
    info: { model: 'ILD1900-10', range_mm: 10, smr_mm: 20, unit: 'mm' },
    dist_from_face_mm: 25, n: 40, current_valid: true, state_flags: { led: 'green' },
    ...overrides,
  };
}

function harness() {
  engine.useSensor('ild1900');
  const values = [], updates = [], renders = [], failures = [], events = [];
  let interruptions = 0, clock = 0;
  const rt = { bridgeUrl: 'ws://localhost:8000/ws/stream', record: null, socket: null, window: 30, points: [], elapsed: 0, breaks: [], channelBreak: false };
  const snapshot = () => ({ led: { ...rt.led }, invalidSignal: rt.invalidSignal });
  class TestSocket { close() {} }
  const context = vm.createContext({
    rt, URL, WebSocket: TestSocket, state: engine.createInitialState(), dialogType: '',
    SENSOR: engine.SENSOR,
    clone: structuredClone,
    rangeText: () => `${engine.SENSOR.rangeStart}–${engine.SENSOR.rangeEnd} ${engine.SENSOR.unit}`,
    matchesBackendSensor: engine.matchesBackendSensor,
    parseBridgeSample: engine.parseBridgeSample,
    bridgeLedState: engine.bridgeLedState,
    sensorFromStatus: engine.sensorFromStatus,
    useSensor: engine.useSensor,
    adoptSensor: engine.adoptSensor,
    profile: () => context.state.profiles.find(p => p.id === context.state.activeProfileId) || context.state.profiles[0],
    persist() { events.push({ type: 'persist', profileUnit: context.state.profiles[0].unit }); },
    reportIncident() {},
    resolveIncident(key) { rt.activeErrorKeys?.delete(key); },
    $: () => null,
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => clock += 40 },
    closeDialog() { context.dialogType = ''; },
    toast() {},
    announce() {},
    render() { renders.push(snapshot()); },
    updateLive() { updates.push(snapshot()); },
    addValue(value, { led, elapsed }) {
      values.push(value); rt.value = value; rt.led = led;
      rt.points.push({ t: elapsed, value, unit: engine.SENSOR.unit });
    },
    disconnectSocket() { rt.socket?.close(); rt.socket = null; },
    connectionFailed(message) { failures.push(message); },
    verifyBackend() { throw new Error('identified native frames must not require another request'); },
    refreshBackend() { throw new Error('streaming frames must not trigger source discovery'); },
  });
  vm.runInContext([finishSource, interruptSource, interruptionMarkerSource, switchSource, connectionSource].join('\n'), context);
  const interrupt = vm.runInContext('interruptRecord', context);
  context.interruptRecord = () => {
    interruptions++;
    events.push({ type: 'interrupt', profileUnit: context.state.profiles[0].unit });
    interrupt();
  };
  vm.runInContext('connectBridge(true)', context);
  return {
    rt, values, updates, renders, failures, events,
    get state() { return context.state; },
    get interruptions() { return interruptions; },
    send: payload => rt.socket.onmessage({ data: JSON.stringify(payload) }),
  };
}

test('invalid frames keep updating sensor LEDs without repeatedly interrupting the recording', async () => {
  const h = harness();
  await h.send(frame());
  h.rt.record = { source: 'sensor', points: [{ value: 25 }], startElapsed: 0 };
  const invalid = { dist_from_face_mm: null, n: 0, current_valid: false, last_error: { text: 'no peak/edge' } };

  await h.send(frame({ ...invalid, state_flags: { led: 'red' } }));
  assert.equal(h.rt.invalidSignal, true);
  assert.deepEqual(h.rt.led, { state: 'red', output: 'green' });
  assert.equal(h.interruptions, 1);
  const rendersAfterError = h.renders.length;

  await h.send(frame({ ...invalid, state_flags: { led: 'off' } }));
  assert.equal(h.rt.connected, true, 'invalid measurements still belong to an active serial stream');
  assert.deepEqual(h.rt.led, { state: 'off', output: 'green' });
  assert.deepEqual(h.updates.at(-1).led, { state: 'off', output: 'green' });
  assert.equal(h.renders.length, rendersAfterError, 'only the changed LED presentation needs updating');
  assert.equal(h.interruptions, 1, 'later invalid frames must not interrupt the same recording again');
  assert.deepEqual(h.values, [25], 'invalid frames never add a stale distance to the plot');
  assert.deepEqual(h.failures, []);
});

test('native thermometer frames adopt Celsius before parsing and finish old distance recordings in millimetres', async () => {
  const h = harness();
  try {
    await h.send(frame());
    const oldModel = engine.SENSOR.model;
    h.rt.elapsed = 8;
    h.rt.paused = true;
    h.rt.zeroOffset = 25;
    h.rt.record = {
      source: 'sensor', sensor: oldModel,
      points: [{ t: 0, value: 25 }, { t: 1, value: 25.001 }], startElapsed: 2,
    };
    await h.send({
      status: 'streaming', source: 'thermo-uc', unit: '°C',
      info: { model: 'UC-SF22-S3', unit: '°C', range_min: -50, range_max: 900 },
      dist_from_face_mm: null, raw_value: 31.85, value: 1.85, n: 50, current_valid: true,
      state_flags: null, output: 'green',
    });

    assert.equal(engine.SENSOR.id, 'thermo_uc');
    assert.equal(engine.SENSOR.unit, '°C');
    assert.ok(h.state.profiles.every(p => p.unit === '°C'));
    assert.deepEqual(h.values, [25, 31.85], 'the native absolute temperature is used instead of the tared value');
    assert.equal(h.rt.value, 31.85);
    assert.equal(h.rt.paused, false, 'a new family must not inherit a paused distance display');
    assert.equal(h.rt.zeroOffset, 0);
    assert.equal(h.rt.points.length, 1, 'temperature points start a new chart');
    assert.equal(h.rt.points[0].unit, '°C');
    assert.deepEqual(h.rt.led, { state: 'unknown', output: 'unknown' });
    assert.deepEqual(h.events.slice(0, 2), [
      { type: 'interrupt', profileUnit: 'mm' },
      { type: 'persist', profileUnit: '°C' },
    ]);
    assert.equal(h.interruptions, 1);
    assert.equal(h.rt.record, null);
    assert.equal(h.rt.unsaved.sensor, oldModel);
    assert.equal(h.rt.unsaved.interrupted, true);
    assert.equal(engine.unitOf(h.rt.unsaved), 'mm', 'old recording profiles are captured before adopting Celsius');
    assert.equal(h.rt.unsaved.duration, 6);
    assert.deepEqual(h.failures, []);
  } finally {
    engine.useSensor('ild1900');
  }
});

test('legacy thermal bridge frames with null distance ranges adopt the thermometer without inventing LEDs', async () => {
  const h = harness();
  try {
    await h.send({
      value: 29.4, unit: '°C', sensor: 'UC-SF22-S3', source: 'thermo-uc',
      range_start: null, range_end: null, range: null,
      state: 'red', output: 'green', current_valid: true,
    });
    assert.equal(engine.SENSOR.id, 'thermo_uc');
    assert.equal(engine.SENSOR.unit, '°C');
    assert.equal(h.state.sensorId, 'thermo_uc');
    assert.deepEqual(h.values, [29.4]);
    assert.deepEqual(h.rt.led, { state: 'unknown', output: 'unknown' });
    assert.equal(h.rt.invalidSignal, false);
    assert.deepEqual(h.failures, []);
  } finally {
    engine.useSensor('ild1900');
  }
});

test('pausing distance display keeps live LED state updates active', async () => {
  const h = harness();
  await h.send(frame());
  h.rt.paused = true;

  await h.send(frame({ dist_from_face_mm: 25.002, state_flags: { led: 'yellow' } }));
  assert.equal(h.rt.paused, true);
  assert.equal(h.rt.invalidSignal, false);
  assert.equal(h.rt.value, 25, 'the displayed distance remains paused');
  assert.deepEqual(h.values, [25], 'paused frames do not extend the measurement plot');
  assert.deepEqual(h.rt.led, { state: 'yellow', output: 'green' });
  assert.deepEqual(h.updates.at(-1).led, { state: 'yellow', output: 'green' });
  assert.equal(h.interruptions, 0);
  assert.deepEqual(h.failures, []);
});

test('native distance and slope use frame spacing regardless of browser delivery time', async () => {
  const h = harness();
  await h.send(frame({t: 10000, dist_from_face_mm: 25}));
  await h.send(frame({t: 10000.125, dist_from_face_mm: 25.25}));
  await h.send(frame({t: 10000.125, dist_from_face_mm: 25.25}));
  await h.send(frame({t: 10000.5, dist_from_face_mm: 26}));
  assert.deepEqual(Array.from(h.rt.points, point => point.t), [0, 0.125, 0.5]);
  assert.deepEqual(h.values, [25, 25.25, 26]);
});
