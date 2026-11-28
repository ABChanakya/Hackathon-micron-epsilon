import { chartData } from './recordings.mjs';
import { DEMO_DATASETS, DEMO_RATE, demoWindow } from './demo.mjs';
import { createLiveView } from './live-view.mjs';

const byId = (id) => document.getElementById(id);
const root = document.documentElement;
const plot = byId('plot');
const canvas = byId('trace');
const axisLabels = [...byId('y-labels').children];
const picker = byId('dataset');
const number = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
const clock = () => performance.now() / 1_000;
const speechSupported = 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

let activeDataset = DEMO_DATASETS[0];
let openedAt = clock();
let pausedAt = null;
let voiceEnabled = false;

function formatTime(seconds) {
  const whole = Math.floor(seconds);
  const minutes = String(Math.floor(whole / 60)).padStart(2, '0');
  const remaining = String(whole % 60).padStart(2, '0');
  return minutes + ':' + remaining;
}

function speak(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'de-DE';
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function drawChart() {
  if (byId('recorded-view').hidden) return;
  const elapsed = pausedAt ?? clock() - openedAt;
  const window = demoWindow(activeDataset, elapsed);
  const pad = Math.max((window.max - window.min) * .3, .012);
  const scale = { low: window.min - pad, high: window.max + pad };
  axisLabels.forEach((label, index) => {
    label.textContent = number.format(scale.high - (scale.high - scale.low) * index / 4);
  });
  byId('chart-start').textContent = formatTime(window.start);
  byId('chart-mid').textContent = formatTime(window.start + window.duration / 2);
  byId('chart-end').textContent = formatTime(window.start + window.duration);
  byId('demo-reading').textContent = number.format(window.samples.at(-1).value);
  paintChart(canvas, plot, window, scale, activeDataset);
}

function showDataset() {
  byId('source-summary').textContent = 'Demodaten · ' + activeDataset.model;
  byId('demo-unit').textContent = activeDataset.unit;
  byId('demo-source').textContent = DEMO_RATE + ' simulierte Messwerte pro Sekunde';
  updatePauseButton();
  drawChart();
}

function updatePauseButton() {
  const paused = pausedAt !== null;
  byId('demo-pause-label').textContent = paused ? 'Fortsetzen' : 'Anzeige pausieren';
  byId('pause-icon').toggleAttribute('hidden', paused);
  byId('resume-icon').toggleAttribute('hidden', !paused);
  byId('demo-state').textContent = paused ? 'Anzeige pausiert' : 'Demoanzeige';
  byId('demo-state').dataset.state = paused ? 'paused' : 'valid';
}

for (const dataset of DEMO_DATASETS) picker.add(new Option(dataset.name, dataset.id));
picker.addEventListener('change', () => {
  const dataset = DEMO_DATASETS.find(({ id }) => id === picker.value);
  if (!dataset || dataset === activeDataset) return;
  activeDataset = dataset;
  openedAt = clock();
  pausedAt = null;
  showDataset();
});

byId('demo-pause').addEventListener('click', () => {
  pausedAt = pausedAt === null ? clock() - openedAt : null;
  updatePauseButton();
  drawChart();
});

setInterval(() => {
  if (pausedAt === null) drawChart();
}, 1_000 / DEMO_RATE);

function paintChart(canvas, plot, recording, scale, limits) {
  const { width, height } = plot.getBoundingClientRect();
  if (!width || !height) return;

  const ratio = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const context = canvas.getContext('2d');
  context.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);

  const style = getComputedStyle(root);
  const x = (time) => (time - (recording.start ?? 0)) / recording.duration * width;
  const y = (value) => (scale.high - value) / (scale.high - scale.low) * height;
  const { segments, gaps } = chartData(recording, Math.max(1, Math.floor(width)));

  context.strokeStyle = style.getPropertyValue('--grid');
  context.beginPath();
  const divisions = limits ? 8 : 4;
  for (let index = 0; index <= divisions; index++) {
    const fraction = index / divisions;
    context.moveTo(fraction * width, 0);
    context.lineTo(fraction * width, height);
  }
  const levels = limits ? [.5, height / 4, height / 2, height * .75, height - .5]
    : [.5, height / 2, height - .5];
  for (const level of levels) {
    context.moveTo(0, level);
    context.lineTo(width, level);
  }
  context.stroke();

  if (limits) {
    const top = y(limits.upper);
    const bottom = y(limits.lower);
    context.fillStyle = style.getPropertyValue('--chart-band');
    context.globalCompositeOperation = 'destination-over';
    context.fillRect(0, top, width, bottom - top);
    context.globalCompositeOperation = 'source-over';
    context.strokeStyle = style.getPropertyValue('--chart-limit');
    context.lineWidth = .7;
    context.setLineDash([4, 5]);
    context.beginPath();
    for (const level of [top, bottom]) {
      context.moveTo(0, level);
      context.lineTo(width, level);
    }
    context.stroke();
    context.setLineDash([]);
  }

  for (const gap of gaps) {
    const start = x(gap.start);
    const gapWidth = Math.max(1, x(gap.end) - start);
    context.fillStyle = style.getPropertyValue('--error-tint');
    context.fillRect(start, 0, gapWidth, height);
    context.strokeStyle = style.getPropertyValue('--error');
    context.setLineDash([3, 3]);
    context.beginPath();
    context.moveTo(start, height - 2);
    context.lineTo(start + gapWidth, height - 2);
    context.stroke();
    context.setLineDash([]);
  }

  context.strokeStyle = style.getPropertyValue('--accent');
  context.fillStyle = context.strokeStyle;
  context.lineWidth = limits ? 1.65 : 1.35;
  context.lineJoin = 'round';
  context.beginPath();
  for (const segment of segments) {
    const first = segment[0];
    if (segment.length === 1) {
      context.fillRect(Math.min(x(first.time), width - 1.5), y(first.value), 1.5, 1.5);
      continue;
    }
    context.moveTo(x(first.time), y(first.value));
    for (const point of segment.slice(1)) context.lineTo(x(point.time), y(point.value));
  }
  context.stroke();
}

const liveView = createLiveView({
  paintChart,
  speakStatus: (message) => { if (voiceEnabled) speak(message); },
});

function selectView(live) {
  byId('view-live').setAttribute('aria-pressed', String(live));
  byId('view-recorded').setAttribute('aria-pressed', String(!live));
  byId('recorded-view').hidden = live;
  byId('source-summary').hidden = live;
  byId('live-view').hidden = !live;
  if (live) liveView.start();
  else {
    liveView.stop();
    drawChart();
  }
}
byId('view-live').addEventListener('click', () => selectView(true));
byId('view-recorded').addEventListener('click', () => selectView(false));

const preferenceKey = 'micro-epsilon-mobile-display';
function readPreferences() {
  try {
    return JSON.parse(localStorage.getItem(preferenceKey)) ?? {};
  } catch {
    return {};
  }
}

function updateDisplay() {
  const fontSize = byId('font-size').value;
  const theme = byId('theme').value;
  root.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]').content =
    getComputedStyle(root).getPropertyValue('--surface').trim();
  const colorSafe = byId('color-safe').checked;
  root.dataset.size = fontSize;
  root.toggleAttribute('data-color-safe', colorSafe);
  try {
    localStorage.setItem(preferenceKey, JSON.stringify({ fontSize, colorSafe, theme }));
  } catch {
    // Display preferences also work when storage is disabled.
  }
  drawChart();
  liveView.redraw();
}

const preferences = readPreferences();
byId('theme').value = preferences.theme === 'dark' ? 'dark' : 'light';
byId('theme').addEventListener('change', updateDisplay);
if (['standard', 'large', 'largest'].includes(preferences.fontSize)) {
  byId('font-size').value = preferences.fontSize;
}
byId('color-safe').checked = preferences.colorSafe === true;
byId('font-size').addEventListener('change', updateDisplay);
byId('color-safe').addEventListener('change', updateDisplay);
updateDisplay();

const speech = byId('speech');
speech.disabled = !speechSupported;
byId('speech-unavailable').hidden = speechSupported;
speech.addEventListener('change', () => {
  voiceEnabled = speechSupported && speech.checked;
  if (voiceEnabled) {
    speak('Sprachausgabe aktiviert.');
  } else if (speechSupported) {
    window.speechSynthesis.cancel();
  }
});

byId('open-settings').addEventListener('click', () => byId('settings-dialog').showModal());
byId('open-help').addEventListener('click', () => byId('help-dialog').showModal());

const chartOnly = matchMedia('(orientation: landscape) and (max-height: 500px) and (max-width: 1100px)');
chartOnly.addEventListener('change', ({ matches }) => {
  if (matches) document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
});

new ResizeObserver(() => drawChart()).observe(plot);
window.addEventListener('resize', () => drawChart());
showDataset();
