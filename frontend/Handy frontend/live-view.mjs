import { sensorState, liveSample } from './live-data.mjs';

const windowSeconds = 15;
const pollDelay = 400;
const displayNumber = new Intl.NumberFormat('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });

async function readJson(path, signal) {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Backend unavailable');
  return response.json();
}

export function createLiveView({ paintChart, speakStatus }) {
  const byId = (id) => document.getElementById(id);
  const reading = byId('live-reading');
  const unit = byId('live-unit');
  const statusText = byId('live-state');
  const modelText = byId('live-model');
  const note = byId('live-notice');
  const chart = byId('live-chart');
  const canvas = byId('live-trace');
  const plot = byId('live-plot');
  const axisLabels = [...byId('live-axis').children];

  let controller;
  let timer;
  let sensorKey;
  let samples = [];
  let observedAt = 0;

  function redraw() {
    if (chart.hidden || !samples.length) return;
    const firstTime = samples.at(-1).time - windowSeconds;
    const visible = samples.map(({ time, value }) => ({ time: time - firstTime, value }));
    const values = visible.flatMap(({ value }) => value === null ? [] : [value]);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const middle = (min + max) / 2;
    const radius = Math.max(.01, (max - min) * .58);
    [middle + radius, middle, middle - radius].forEach((value, index) => {
      axisLabels[index].textContent = values.length ? displayNumber.format(value) : '—';
    });
    paintChart(canvas, plot, { samples: visible, duration: windowSeconds },
      { high: middle + radius, low: middle - radius });
  }

  function showStatus(label, state, detail = '') {
    if (statusText.textContent !== label) statusText.textContent = label;
    if (statusText.dataset.state !== state && ['invalid', 'unavailable'].includes(state)) speakStatus(label + '.');
    statusText.dataset.state = state;
    if (note.textContent !== detail) note.textContent = detail;
    note.hidden = !detail;
  }

  function unavailable(label, detail, state = 'unavailable') {
    reading.textContent = '—';
    unit.textContent = '';
    modelText.textContent = 'Live-Messung';
    chart.hidden = true;
    samples = [];
    sensorKey = undefined;
    showStatus(label, state, detail);
  }

  function update(status, frame) {
    const sensor = sensorState(status);
    if (!sensor.model) {
      unavailable(sensor.label, sensor.detail ?? 'Verbinde den Sensor in der PC-Ansicht.', sensor.state);
      return;
    }

    const key = [sensor.source, sensor.model, sensor.serial, sensor.unit].join('/');
    if (sensorKey !== key) {
      sensorKey = key;
      samples = [];
    }
    modelText.textContent = sensor.model;
    unit.textContent = sensor.unit;
    byId('live-chart-unit').textContent = ((sensor.measures ?? (sensor.unit === '°C' ? 'temperature' : 'distance')) === 'temperature' ? 'Temperatur' : 'Abstand ab Sensorfront') + ' · ' + sensor.unit;
    const sample = liveSample(frame, sensor);
    const previous = samples.at(-1);

    if (sample && sample.time !== previous?.time) {
      if (previous && sample.time < previous.time) samples = [];
      if (previous && sample.time - previous.time > 1.5 && previous.value !== null) {
        samples.push({ time: previous.time + .4, value: null });
      }
      samples.push(sample);
      samples = samples.filter(({ time }) => time >= sample.time - windowSeconds);
      observedAt = performance.now();
    }

    if (!sample || performance.now() - observedAt > 2_000) {
      reading.textContent = '—';
      showStatus('Warte auf neue Messdaten', 'loading');
      chart.hidden = !samples.length;
      redraw();
      return;
    }

    reading.textContent = sample.value === null ? '—' : displayNumber.format(sample.value);
    if (sample.value === null) showStatus(sample.error ?? 'Kein gültiger Messwert', 'invalid');
    else showStatus('Liveanzeige', 'valid');
    chart.hidden = false;
    byId('live-gap').hidden = !samples.some(({ value }) => value === null);
    redraw();
  }

  async function poll(session) {
    if (controller !== session) return;
    try {
      const [status, frame] = await Promise.all([
        readJson('/api/status', session.signal),
        readJson('/api/latest', session.signal),
      ]);
      if (controller === session) update(status, frame);
    } catch {
      if (controller === session) {
        unavailable('Messserver nicht erreichbar', 'Starte serve.py und prüfe den Sensorserver am Rechner.');
      }
    }
    if (controller === session) timer = setTimeout(() => poll(session), pollDelay);
  }

  new ResizeObserver(redraw).observe(plot);
  return {
    start() {
      if (controller) return;
      controller = new AbortController();
      showStatus('Verbinde mit dem Messserver …', 'loading');
      poll(controller);
    },
    stop() {
      controller?.abort();
      controller = undefined;
      clearTimeout(timer);
    },
    redraw,
  };
}
