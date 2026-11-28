import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import {assistantText} from '../dist/assistant-i18n.js';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const end = source.indexOf("document.addEventListener('click'");
assert.ok(end > 0, 'application view functions precede browser event registration');
const views = source.slice(0, end).replace(/^import .*;\n/gm, '');
const data = await readFile(new URL('../dist/data.js', import.meta.url), 'utf8');
const engine = await import(`data:text/javascript;base64,${Buffer.from(data).toString('base64')}`);

function viewContext() {
  const context = vm.createContext({
    ...engine, loadState: engine.createInitialState, structuredClone, getLocale: () => 'de-DE', getLanguage: () => 'de', assistantText,
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

test('assistant snapshots retain source and profile identity without sharing mutable state', () => {
  engine.useSensor('ild1900');
  const context = viewContext();
  vm.runInContext("rt.mode='demo';rt.connected=true;rt.value=25.012;rt.zeroOffset=.01", context);
  const snapshot = vm.runInContext('assistantContext()', context);
  assert.equal(snapshot.source, 'demo');
  assert.equal(snapshot.sensor.unit, 'mm');
  assert.equal(snapshot.valid, true);
  assert.equal(snapshot.zeroOffset, .01);
  const original = vm.runInContext('profile().upper', context);
  snapshot.profile.upper = 29;
  assert.equal(vm.runInContext('profile().upper', context), original);
  vm.runInContext("rt.mode='bridge';rt.backendReplay='Recorded trial';rt.invalidSignal=true", context);
  const replay = vm.runInContext('assistantContext()', context);
  assert.equal(replay.source, 'replay');
  assert.equal(replay.valid, false);
  assert.equal(vm.runInContext('assistantError().code', context), 'INVALID_SIGNAL');
});

test('assistant chart summaries match the visible window and displayed zero offset', () => {
  engine.useSensor('ild1900');
  const context = viewContext();
  vm.runInContext(`rt.elapsed=100;rt.window=10;rt.zeroOffset=25;
    rt.points=[{t:80,value:29},{t:90,value:25},{t:95,value:25.02},{t:99,value:25.1},{t:100,value:NaN},{t:110,value:21}]`, context);
  const summary = vm.runInContext('assistantChartSummary()', context);
  assert.equal(summary.count, 3);
  assert.equal(summary.min, 0);
  assert.ok(Math.abs(summary.max - .1) < 1e-9);
  assert.equal(summary.outside, 1);
  assert.equal(summary.duration, 10);
  assert.ok(Math.abs(summary.trend - .1) < 1e-9);
  assert.equal(vm.runInContext('rt.points[0].value', context), 29);
});

test('deviation alarm offers one-shot and repeating modes and stops after recovery', () => {
  engine.useSensor('ild1900');
  const context = viewContext();
  let tones = 0, nextTimer = 0, clearedTimer = null, scheduled;
  context.playAlertSound = () => { tones++; };
  context.setInterval = callback => { scheduled = callback; return ++nextTimer; };
  context.clearInterval = timer => { clearedTimer = timer; };
  context.localStorage = { setItem() {} };
  context.toast = () => {};
  vm.runInContext("rt.activeErrorKeys.add('deviation')", context);

  const html = vm.runInContext('errorCenter()', context);
  assert.match(html, /Einmal piepen/);
  assert.match(html, /Wiederholen, bis der Wert stabil ist/);
  vm.runInContext("setDeviationAlarmMode('single')", context);
  assert.equal(vm.runInContext('rt.deviationAlarmTimer', context), null);
  vm.runInContext("setDeviationAlarmMode('repeat')", context);
  assert.equal(tones, 1, 'repeat mode sounds immediately');
  assert.equal(vm.runInContext('rt.deviationAlarmTimer', context), 1);
  scheduled();
  assert.equal(tones, 2, 'repeat mode continues sounding while the deviation remains active');
  vm.runInContext("resolveIncident('deviation')", context);
  assert.equal(clearedTimer, 1, 'the alarm timer stops after the value returns within limits');
  assert.equal(vm.runInContext('rt.deviationAlarmTimer', context), null);
});

test('the 3D sensor view is only offered when the device check calls for it', () => {
  const context = viewContext();
  engine.useSensor('ild1900');
  const has3d = () => vm.runInContext('has3d()', context);
  assert.equal(has3d(), true, 'a distance sensor without backend info keeps its 3D view');
  vm.runInContext("rt.backendStatus={device:{verified:true,ui:{sensor_3d:true}}}", context);
  assert.equal(has3d(), true);
  assert.match(vm.runInContext('monitor()', context), /id="mini-viewer"/);
  vm.runInContext("rt.backendStatus={device:{verified:false,ui:null}}", context);
  assert.equal(has3d(), false, 'an unverified device gets no 3D view');
  assert.doesNotMatch(vm.runInContext('monitor()', context), /id="mini-viewer"/);
  vm.runInContext("rt.backendStatus={device:{verified:true,ui:{sensor_3d:false}}}", context);
  assert.equal(has3d(), false);
  engine.useSensor('thermo_uc');
  vm.runInContext("rt.backendStatus=null", context);
  assert.equal(has3d(), false, 'the thermometer never gets the 3D sensor');
  engine.useSensor('ild1900');
});

test('the recording controls and the toast helper are defined (a merge once dropped them)', () => {
  const context = viewContext();
  for (const name of ['startRecord', 'finishRecord', 'saveRecording', 'stopRecord', 'toast', 'setProfile', 'fitLimitsToTraining']) {
    assert.equal(vm.runInContext(`typeof ${name}`, context), 'function', name);
  }
  engine.useSensor('ild1900');
  assert.match(vm.runInContext("openDialog.toString()", context), /record-class/);
});
