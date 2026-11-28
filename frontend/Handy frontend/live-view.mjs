import { sensorState, liveSample } from './live-data.mjs';

const windowSeconds = 15;
const pollDelay = 400;

async function readJson(path, signal) {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Backend unavailable');
  return response.json();
}

export function createLiveView({paintChart, speakStatus, translate = text => text, locale = () => 'de-DE', onStatus = () => {}}) {
  const displayNumber = {format: value => new Intl.NumberFormat(locale(), {minimumFractionDigits: 3, maximumFractionDigits: 3}).format(value)};
  const byId = (id) => document.getElementById(id);
  const reading = byId('live-reading');
  const unit = byId('live-unit');
  const statusText = byId('live-state');
  const modelText = byId('live-model');
  const note = byId('live-notice');
  const chart = byId('live-chart');
  const history = byId('live-history');
  const actions = byId('connection-actions');
  const canvas = byId('live-trace');
  const plot = byId('live-plot');
  const axisLabels = [...byId('live-axis').children];

  let controller;
  let timer;
  let sensorKey;
  let samples = [];
  let observedAt = 0;
  let lastValidAt = 0;
  let currentStatus = {label: 'Verbinde mit dem Messserver …', state: 'loading', detail: ''};

  function showHistory() {
    const historical = currentStatus.state !== 'valid' && samples.length > 0;
    history.hidden = !historical || !lastValidAt;
    if (!history.hidden) history.textContent = translate('Letzte gültige Messung empfangen: {time}', {time: new Date(lastValidAt).toLocaleTimeString(locale(), {hour: '2-digit', minute: '2-digit', second: '2-digit'})});
    chart.dataset.historical = String(historical);
  }

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
    currentStatus = {label, state, detail};
    const translated = translate(label);
    if (statusText.textContent !== translated) statusText.textContent = translated;
    if (statusText.dataset.state !== state && ['invalid', 'unavailable'].includes(state)) speakStatus(translated + '.');
    statusText.dataset.state = state;
    const translatedDetail = translate(detail);
    if (note.textContent !== translatedDetail) note.textContent = translatedDetail;
    note.hidden = !detail;
    actions.hidden = state === 'valid';
    showHistory();
    onStatus(currentStatus);
  }

  function unavailable(label, detail, state = 'unavailable') {
    reading.textContent = '—';
    if (!samples.length) {
      unit.textContent = '';
      modelText.textContent = translate('Live-Messung');
    }
    chart.hidden = !samples.length;
    sensorKey = undefined;
    showStatus(label, state, detail);
    redraw();
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
      lastValidAt = 0;
    }
    modelText.textContent = sensor.model;
    unit.textContent = sensor.unit;
    byId('live-chart-unit').textContent = ((sensor.measures ?? (sensor.unit === '°C' ? 'temperature' : 'distance')) === 'temperature' ? translate('Temperatur') : translate('Abstand ab Sensorfront')) + ' · ' + sensor.unit;
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
      if (sample.value !== null) lastValidAt = Date.now();
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
        unavailable('Messserver nicht erreichbar', 'Prüfe den Messserver am Rechner und die Netzwerkverbindung.');
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
    refreshLanguage() {
      showStatus(currentStatus.label, currentStatus.state, currentStatus.detail);
      if (currentStatus.state === 'valid' && samples.at(-1)?.value !== null) reading.textContent = displayNumber.format(samples.at(-1).value);
      redraw();
    },
  };
}
