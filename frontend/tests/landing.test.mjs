import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../../scrollcraft/builds/landing/page.js', import.meta.url), 'utf8');
const prefix = source.slice(0, source.indexOf('  var fmt ='));

function addresses(url) {
  const context = vm.createContext({
    location: new URL(url), navigator: {language: 'de'}, URL, URLSearchParams,
    localStorage: {getItem: () => 'de', setItem() {}},
    window: {LANDING_DATA: {}, LANDING_I18N: {de: {}}, addEventListener() {}},
  });
  vm.runInContext(prefix + 'globalThis.addresses = {ws: WS_URL, monitor: MONITOR_URL};})();', context);
  return {...context.addresses};
}

test('landing links preserve the unified origin, standalone fallback and explicit overrides', () => {
  assert.deepEqual(addresses('http://127.0.0.1:8000/pitch/'), {
    ws: 'ws://127.0.0.1:8000/ws/bridge', monitor: '/',
  });
  assert.deepEqual(addresses('https://sensors.example/pitch/'), {
    ws: 'wss://sensors.example/ws/bridge', monitor: '/',
  });
  assert.deepEqual(addresses('http://localhost:4173/index.html'), {
    ws: 'ws://localhost:8000/ws/bridge', monitor: 'http://localhost:8000/',
  });
  assert.deepEqual(addresses('http://localhost:4173/?ws=ws%3A%2F%2Flocalhost%3A8765%2Fstream&monitor=%2Fcustom'), {
    ws: 'ws://localhost:8765/stream', monitor: '/custom',
  });
});
