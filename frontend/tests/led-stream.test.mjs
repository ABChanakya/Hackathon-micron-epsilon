import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const appSource = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const start = appSource.indexOf('function connectBridge(');
const end = appSource.indexOf('\nfunction connectionFailed', start);
assert.ok(start >= 0 && end > start, 'the production bridge connection function is available');
const connectionSource = appSource.slice(start, end);
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
  const values = [], updates = [], renders = [], failures = [];
  let interruptions = 0, clock = 0;
  const rt = { bridgeUrl: 'ws://localhost:8000/ws/stream', record: null, socket: null };
  const snapshot = () => ({ led: { ...rt.led }, invalidSignal: rt.invalidSignal });
  class TestSocket { close() {} }
  const context = vm.createContext({
    rt, URL, WebSocket: TestSocket,
    SENSOR: engine.SENSOR,
    physicalRange: '20–30 mm',
    matchesBackendSensor: engine.matchesBackendSensor,
    parseBridgeSample: engine.parseBridgeSample,
    bridgeLedState: engine.bridgeLedState,
    $: () => null,
    setTimeout: () => 1,
    clearTimeout() {},
    performance: { now: () => clock += 40 },
    closeDialog() {},
    toast() {},
    render() { renders.push(snapshot()); },
    updateLive() { updates.push(snapshot()); },
    addValue(value, { led }) { values.push(value); rt.value = value; rt.led = led; },
    interruptRecord() { interruptions++; rt.record = null; },
    disconnectSocket() { rt.socket?.close(); rt.socket = null; },
    connectionFailed(message) { failures.push(message); },
    verifyBackend() { throw new Error('identified native frames must not require another request'); },
    refreshBackend() { throw new Error('streaming frames must not trigger source discovery'); },
  });
  vm.runInContext(connectionSource, context);
  vm.runInContext('connectBridge(true)', context);
  return {
    rt, values, updates, renders, failures,
    get interruptions() { return interruptions; },
    send: payload => rt.socket.onmessage({ data: JSON.stringify(payload) }),
  };
}

test('invalid frames keep updating sensor LEDs without repeatedly interrupting the recording', async () => {
  const h = harness();
  await h.send(frame());
  h.rt.record = { points: [{ value: 25 }] };
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
