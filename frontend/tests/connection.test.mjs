import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const start = source.indexOf('async function connectSensor(){');
const end = source.indexOf('\nconst nextTheme', start);
assert.ok(start >= 0 && end > start, 'the production sensor connection function is available');
const connectionSource = source.slice(start, end);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function harness(request) {
  const calls = [], attachments = [], failures = [];
  const rt = { mode: 'bridge', bridgeUrl: 'ws://localhost:8000/ws/stream', connecting: false, record: null };
  const context = vm.createContext({
    rt,
    $: selector => selector === '#live-port' ? { value: '/dev/test-sensor' } : null,
    render() {},
    backendRequest(path, options, address) {
      calls.push({ path, options, address });
      return request(path, options, address);
    },
    connectBridge() { attachments.push(rt.bridgeUrl); },
    connectionFailed(message) { failures.push(message); },
  });
  vm.runInContext(connectionSource, context);
  return { rt, calls, attachments, failures, connect: vm.runInContext('connectSensor', context) };
}

for (const change of ['mode', 'address']) {
  test(`a pending status request cannot reconnect after changing ${change}`, async () => {
    const status = deferred();
    const h = harness(() => status.promise);
    const pending = h.connect();
    if (change === 'mode') h.rt.mode = 'demo';
    else h.rt.bridgeUrl = 'ws://other-host:8000/ws/stream';
    status.resolve({ status: 'disconnected' });
    await pending;
    assert.equal(h.calls.length, 1, 'the superseded request must not open a sensor');
    assert.equal(h.calls[0].address, 'ws://localhost:8000/ws/stream');
    assert.equal(h.attachments.length, 0);
    assert.equal(h.failures.length, 0);
    assert.equal(h.rt.connecting, false);
  });

  test(`a pending sensor connection cannot attach after changing ${change}`, async () => {
    const connected = deferred();
    const started = deferred();
    const h = harness(path => {
      if (path === '/api/status') return Promise.resolve({ status: 'disconnected' });
      started.resolve();
      return connected.promise;
    });
    const pending = h.connect();
    await started.promise;
    if (change === 'mode') h.rt.mode = 'demo';
    else h.rt.bridgeUrl = 'ws://other-host:8000/ws/stream';
    connected.resolve({ status: 'streaming' });
    await pending;
    assert.equal(h.calls.length, 2);
    assert.ok(h.calls.every(call => call.address === 'ws://localhost:8000/ws/stream'));
    assert.equal(h.attachments.length, 0);
    assert.equal(h.failures.length, 0);
    assert.equal(h.rt.connecting, false);
  });
}

test('connecting a sensor posts the selected port and then attaches to its stream', async () => {
  const h = harness(path => Promise.resolve({ status: path === '/api/status' ? 'disconnected' : 'streaming' }));
  await h.connect();
  assert.deepEqual(h.calls.map(call => call.path), ['/api/status', '/api/connect']);
  const open = h.calls[1];
  assert.equal(open.options.method, 'POST');
  assert.equal(open.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(open.options.body), { sensor: 'ILD-serial', port: '/dev/test-sensor' });
  assert.ok(h.calls.every(call => call.address === 'ws://localhost:8000/ws/stream'));
  assert.deepEqual(h.attachments, ['ws://localhost:8000/ws/stream']);
  assert.equal(h.rt.connecting, false);
  assert.equal(h.failures.length, 0);
});

test('an existing stream is attached without replacing its sensor source', async () => {
  const h = harness(() => Promise.resolve({ status: 'streaming' }));
  await h.connect();
  assert.deepEqual(h.calls.map(call => call.path), ['/api/status']);
  assert.deepEqual(h.attachments, ['ws://localhost:8000/ws/stream']);
  assert.equal(h.failures.length, 0);
});
