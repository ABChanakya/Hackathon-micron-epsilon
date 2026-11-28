import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import * as engine from '../dist/data.js';
import { buildSlopeSeries } from '../dist/measurement-series.js';
import { assistantText } from '../dist/assistant-i18n.js';

const source = await readFile(new URL('../dist/app.js', import.meta.url), 'utf8');
const views = source.slice(0, source.indexOf("document.addEventListener('click'")).replace(/^import .*;\n/gm, '');

function chart() {
  const paths = [], fills = [], labels = [];
  let path = [];
  const ctx = {
    scale() {}, clearRect() {}, save() {}, restore() {}, rect() {}, clip() {}, setLineDash() {}, arc() {}, fill() {},
    fillText(text, x, y) { labels.push({ text, x, y }); },
    fillRect(...args) { fills.push(args); },
    beginPath() { path = []; }, moveTo(x, y) { path.push(['M', x, y]); }, lineTo(x, y) { path.push(['L', x, y]); },
    stroke() { paths.push({ color: this.strokeStyle, path }); },
  };
  return {
    paths, fills, labels, width: 0, height: 0, size: { width: 650, height: 180 },
    getBoundingClientRect() { return this.size; }, getContext() { return ctx; },
  };
}

function harness() {
  engine.useSensor('ild1900');
  const elements = new Map([
    ['#live-chart', chart()], ['#slope-chart', chart()], ['#slope-value', {}], ['#slope-empty', {}],
    ['#slope-current', { removeAttribute(name) { delete this[name]; } }],
  ]);
  const context = vm.createContext({
    ...engine, buildSlopeSeries, assistantText, loadState: engine.createInitialState, structuredClone,
    getLocale: () => 'de-DE', getLanguage: () => 'de', applyTranslations() {},
    location: { protocol: 'http:', hostname: 'localhost', host: 'localhost:8000', port: '8000' },
    performance: { now: () => context.now }, now: 0, theme: 'light', devicePixelRatio: 1,
    document: { querySelector: selector => elements.get(selector) || null, querySelectorAll: () => [] },
    getComputedStyle: () => ({ getPropertyValue: key => `${context.theme}:${key}` }),
    clearTimeout() {},
  });
  vm.runInContext(views, context);
  return { context, elements, run: code => vm.runInContext(code, context) };
}

test('the slope graph sits after the measurement chart and exposes its unit and current value accessibly', () => {
  const h = harness();
  const html = h.run('monitor()');
  assert.ok(html.indexOf('id="slope-chart"') > html.indexOf('id="live-chart"'));
  assert.match(html, /id="slope-chart" role="img" aria-label="Slope-Diagramm: Änderung pro Sekunde über Zeit" aria-describedby="slope-description slope-current"/);
  assert.match(html, /id="slope-description">Trend über 1 s/);
  assert.match(html, /Aktueller Slope/);
  assert.match(html, /id="slope-value" data-i18n-skip>— mm\/s/);
  try {
    engine.useSensor('thermo_uc');
    assert.match(h.run('slopeChart()'), /— °C\/s/);
  } finally { engine.useSensor('ild1900'); }
});

test('slope and measurement charts share each selected time window and redraw at the current size and theme', () => {
  const h = harness();
  h.run('rt.connected=true;rt.elapsed=120;rt.points=Array.from({length:601},(_,i)=>({t:i/5,value:25+i/5000}));');
  for (const seconds of [10, 30, 60]) {
    h.run(`rt.window=${seconds};drawCharts()`);
    const primary = h.elements.get('#live-chart')._plot;
    const slope = h.elements.get('#slope-chart')._plot;
    assert.equal(slope.start, 120 - seconds);
    assert.equal(slope.end, 120);
    assert.equal(slope.start, primary.start);
    assert.equal(slope.end, primary.end);
    assert.equal(h.elements.get('#slope-empty').hidden, true);
    assert.equal(h.elements.get('#slope-value').textContent, '+0,001 mm/s');
  }
  const canvas = h.elements.get('#slope-chart');
  canvas.size = { width: 320, height: 160 };
  h.context.theme = 'dark';
  h.run('drawCharts()');
  assert.equal(canvas.width, 320);
  assert.equal(canvas.height, 160);
  assert.ok(canvas.paths.some(path => path.color === 'dark:--chart-signal'));
});

test('slope canvas splits null gaps and shows a zero reference without distance tolerance bands', () => {
  const h = harness();
  h.run("drawChart(document.querySelector('#slope-chart'),{points:[{t:0,value:1},{t:1,value:2},{t:2,value:null},{t:3,value:-1},{t:4,value:-2}],profile:{unit:'mm/s'},start:0,end:4,limits:false,includeZero:true})");
  const canvas = h.elements.get('#slope-chart');
  const signal = canvas.paths.find(path => path.color === 'light:--chart-signal');
  assert.deepEqual(signal.path.map(operation => operation[0]), ['M', 'L', 'M', 'L']);
  assert.equal(canvas.fills.length, 0);
  assert.equal(canvas.paths.filter(path => path.color === 'light:--chart-limit').length, 1);
});

test('slope empty states distinguish disconnected, insufficient and invalid readings', () => {
  const h = harness();
  h.run('drawCharts()');
  assert.equal(h.elements.get('#slope-empty').textContent, 'Warte auf Messwerte');
  h.run('rt.connected=true;rt.points=[{t:0,value:25}];drawCharts()');
  assert.equal(h.elements.get('#slope-empty').textContent, 'Noch nicht genügend Messwerte');
  h.run('rt.invalidSignal=true;drawCharts()');
  assert.equal(h.elements.get('#slope-empty').textContent, 'Keine gültigen Messwerte');
  assert.equal(h.elements.get('#slope-value').textContent, '— mm/s');
});

test('slope labels normalize rounded zero without changing measurement or trend precision', () => {
  const h = harness();
  for (const rate of [-0.0004, 0.0004, -0.0006, 0.0006]) {
    h.context.testSlopeRate = rate;
    h.run('rt.connected=true;rt.elapsed=1;rt.points=[{t:0,value:25},{t:1,value:25+testSlopeRate}];drawCharts()');
    const slopeLabels = h.elements.get('#slope-chart').labels;
    assert.ok(slopeLabels.some(label => label.text === '0,000'));
    assert.ok(slopeLabels.every(label => label.text !== '-0,000' && label.text !== '+0,000'));
    const text = h.elements.get('#slope-value').textContent;
    assert.equal(text, Math.abs(rate) < 0.0005 ? '0,000 mm/s' : rate > 0 ? '+0,001 mm/s' : '-0,001 mm/s');
    assert.ok(Math.abs(h.run('buildSlopeSeries(rt.points).points.at(-1).value') - rate) < 1e-12);
  }
  h.run('rt.points.push({t:1.2,value:25,breakBefore:true});rt.elapsed=1.2;drawCharts()');
  assert.equal(h.elements.get('#slope-value').textContent, '— mm/s');
});

test('a connection failure marks the next recorded point as a new slope segment without a false sample', () => {
  const h = harness();
  h.run('render=()=>{};updateLive=()=>{};drawCharts=()=>{};rt.mode="bridge";rt.bridgeStart=0;rt.connected=false;addValue(25)');
  h.run('connectionFailed("test");');
  h.context.now = 200;
  h.run('rt.connected=true;addValue(25.01)');
  assert.equal(h.run('rt.points.length'), 2);
  assert.equal(h.run('rt.points[1].breakBefore'), true);
  assert.equal(h.run('rt.channelBreak'), false);
  assert.equal(h.run('buildSlopeSeries(rt.points).available'), false);
  h.context.now = 400;
  h.run('addValue(25.02)');
  assert.equal(h.run('rt.points[2].breakBefore'), undefined);
  assert.ok(Math.abs(h.run('buildSlopeSeries(rt.points).points.at(-1).value') - 0.05) < 1e-10);
});
