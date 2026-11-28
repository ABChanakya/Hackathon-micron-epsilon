import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const end = source.indexOf("document.addEventListener('click'");
assert.ok(end > 0, 'application view functions precede browser event registration');
const views = source.slice(0, end).replace(/^import .*;\n/gm, '');
const data = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const engine = await import(`data:text/javascript;base64,${Buffer.from(data).toString('base64')}`);

function viewContext() {
  const context = vm.createContext({
    ...engine, loadState: engine.createInitialState, structuredClone,
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:8000', port: '8000' },
    performance: { now: () => 0 },
  });
  vm.runInContext(views, context);
  return context;
}

test('distance view keeps the upgraded model and independently labelled LEDs', () => {
  engine.useSensor('ild1900');
  const html = vm.runInContext('monitor()', viewContext());
  assert.match(html, /id="mini-viewer"/);
  assert.match(html, /class="led-indicator"/);
  assert.match(html, /State-LED: Unbekannt/);
  assert.match(html, /Abstand zum Objekt/);
  assert.match(html, /class="reading-unit">mm/);
});

test('temperature view uses Celsius without a distance model or fictional LEDs', () => {
  try {
    engine.useSensor('thermo_uc');
    const html = vm.runInContext('monitor()', viewContext());
    assert.match(html, /Objekttemperatur/);
    assert.match(html, /class="reading-unit">°C/);
    assert.match(html, /thermoMETER UC-SF22-S3/);
    assert.doesNotMatch(html, /id="mini-viewer"|class="device-leds"|Vergrößern/);
  } finally {
    engine.useSensor('ild1900');
  }
});

test('archives keep millimetre precision and cannot be compared against Celsius curves', () => {
  engine.useSensor('ild1900');
  const distance = engine.createInitialState().recordings[0];
  distance.profile.target = 25.001;
  try {
    engine.useSensor('thermo_uc');
    const temperature = engine.createInitialState().recordings[0];
    const context = viewContext();
    context.distance = distance;
    context.temperature = temperature;
    const report = vm.runInContext('reportView(distance)', context);
    assert.match(report, /25,001 mm/);
    assert.doesNotMatch(report, /°C/);
    const comparison = vm.runInContext("rt.analysis='compare'; analysisView([distance,temperature])", context);
    assert.match(comparison, /unterschiedliche Einheiten/);
    assert.doesNotMatch(comparison, /id="analysis-chart"/);
  } finally {
    engine.useSensor('ild1900');
  }
});
