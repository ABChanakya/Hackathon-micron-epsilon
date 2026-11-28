import { sensorState, liveSample } from './live-data.mjs?v=phone-pc-1';

const windowSeconds = 15;
const pollDelay = 400;
const staleAfter = 2_000;

async function readJson(path, signal) {
  const response = await fetch(path, { signal, cache: 'no-store' });
  if (!response.ok) throw new Error('Backend unavailable');
  return response.json();
}

export function createLiveView({
  paintChart, buildSlopeSeries, openStream, speakStatus, translate = text => text,
  locale = () => 'de-DE', onStatus = () => {},
}) {
  const byId = id => document.getElementById(id);
  const reading = byId('live-reading');
  const unit = byId('live-unit');
  const statusText = byId('live-state');
  const modelText = byId('live-model');
  const sourceText = byId('live-source');
  const note = byId('live-notice');
  const history = byId('live-history');
  const actions = byId('connection-actions');
  const chart = byId('live-chart');
  const slopeChart = byId('live-slope-chart');
  const slopeValue = byId('live-slope-value');
  const formats = new Map();
  let active;
  let sensorKey;
  let sensor;
  let samples = [];
  let observedAt = -Infinity;
  let lastValidAt = 0;
  let breakPending = false;
  let lastDraw = -Infinity;
  let currentStatus = {label: 'Verbinde mit dem Messserver …', state: 'loading', detail: ''};

  function format(value, digits) {
    const lang = locale();
    const key = lang + digits;
    if (!formats.has(key)) formats.set(key, new Intl.NumberFormat(lang, {minimumFractionDigits: digits, maximumFractionDigits: digits}));
    return formats.get(key).format(value);
  }

  function setText(el, value) {
    if (el.textContent !== value) el.textContent = value;
  }

  function showHistory() {
    const historical = currentStatus.state !== 'valid' && samples.length > 0;
    history.hidden = !historical || !lastValidAt;
    if (!history.hidden) {
      const time = new Date(lastValidAt).toLocaleTimeString(locale(), {hour: '2-digit', minute: '2-digit', second: '2-digit'});
      setText(history, translate('Letzte gültige Messung empfangen: {time}', {time}));
    }
    chart.dataset.historical = slopeChart.dataset.historical = String(historical);
  }

  function drawSeries(prefix, points, slope = false) {
    const values = points.flatMap(point => Number.isFinite(point.value) ? [point.value] : []);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const middle = slope ? 0 : (min + max) / 2;
    const span = slope ? Math.max(Math.abs(min), Math.abs(max)) * 1.16 : (max - min) * .58;
    const radius = Math.max(.01, span);
    const high = middle + radius, low = middle - radius;
    const digits = !slope && sensor?.unit === '°C' ? 2 : 3;
    const labels = byId(prefix + '-axis').children;
    [high, middle, low].forEach((value, index) => setText(labels[index], values.length ? format(value, digits) : '—'));
    paintChart(byId(prefix + '-trace'), byId(prefix + '-plot'), {samples: points, duration: windowSeconds}, {high, low});
  }

  function redraw() {
    if (chart.hidden || !samples.length) return;
    const start = samples.at(-1).time - windowSeconds;
    drawSeries('live', samples.map(({time, value}) => ({time: time - start, value})));
    drawSeries('live-slope', samples.map(({time, slope}) => ({time: time - start, value: slope})), true);
    lastDraw = performance.now();
  }

  function showStatus(label, state, detail = '') {
    const sourceLabel = sensor?.sourceLabel || 'PC-Messung';
    const changed = label !== currentStatus.label || state !== currentStatus.state ||
      detail !== currentStatus.detail || sourceLabel !== currentStatus.sourceLabel;
    currentStatus = {label, state, detail, sourceLabel};
    const translated = translate(label);
    setText(statusText, translated);
    if (statusText.dataset.state !== state && ['invalid', 'unavailable'].includes(state)) speakStatus(translated + '.');
    statusText.dataset.state = state;
    setText(sourceText, translate(sourceLabel));
    setText(note, translate(detail));
    note.hidden = !detail;
    actions.hidden = state === 'valid';
    showHistory();
    if (changed) onStatus(currentStatus);
  }

  function showReadings(sample) {
    const unitName = sensor?.unit || '';
    setText(reading, Number.isFinite(sample?.value) ? format(sample.value, unitName === '°C' ? 2 : 3) : '—');
    let slope = sample?.slope;
    if (Number.isFinite(slope) && Math.abs(slope) < .0005) slope = 0;
    const formatted = Number.isFinite(slope) ? (slope > 0 ? '+' : '') + format(slope, 3) : '—';
    setText(slopeValue, unitName ? formatted + ' ' + unitName + '/s' : formatted);
  }

  function unavailable(label, detail, state = 'unavailable') {
    breakPending = true;
    showReadings(null);
    if (!sensor) {
      setText(unit, '');
      setText(modelText, translate('Live-Messung'));
    }
    chart.hidden = slopeChart.hidden = !samples.length;
    showStatus(label, state, detail);
    redraw();
  }

  function record(sample) {
    const previous = samples.at(-1);
    if (previous && sample.time <= previous.time) {
      if (previous.time === sample.time) return;
      samples = [];
      lastValidAt = 0;
    } else if (previous && (breakPending || sample.time - previous.time > 1) && previous.value !== null) {
      samples.push({time: Math.min(previous.time + .1, (sample.time + previous.time) / 2), value: null, slope: null});
    }
    breakPending = false;
    samples.push(sample);
    samples = samples.filter(point => point.time >= sample.time - windowSeconds);
    sample.slope = null;
    if (sample.value !== null) {
      lastValidAt = Date.now();
      const recent = samples.filter(point => point.time >= sample.time - 1).map(point => ({t: point.time, value: point.value}));
      const series = buildSlopeSeries(recent, {start: sample.time, end: sample.time, sensorUnit: sensor.unit});
      sample.slope = series.points.at(-1)?.value ?? null;
    }
    observedAt = performance.now();
  }

  function update(status, frame) {
    const next = sensorState(status);
    if (!next.model) {
      unavailable(next.label, next.detail ?? 'Verbinde den Sensor in der PC-Ansicht.', next.state);
      return;
    }
    const key = [next.source, next.model, next.serial, next.unit].join('/');
    if (sensorKey !== key) {
      samples = [];
      lastValidAt = 0;
      lastDraw = observedAt = -Infinity;
      breakPending = false;
      sensorKey = key;
    }
    sensor = next;
    setText(modelText, sensor.model);
    setText(unit, sensor.unit);
    setText(byId('live-chart-unit'), translate(sensor.unit === '°C' ? 'Temperatur' : 'Abstand ab Sensorfront') + ' · ' + sensor.unit);

    const sample = liveSample(frame, sensor);
    if (sample) record(sample);
    if (!sample || performance.now() - observedAt > staleAfter || breakPending) {
      unavailable('Warte auf neue Messdaten', '', 'loading');
      return;
    }
    const latest = samples.at(-1);
    showReadings(latest);
    const wasValid = currentStatus.state === 'valid';
    if (latest.value === null) showStatus(latest.error ?? 'Kein gültiger Messwert', 'invalid');
    else showStatus(sensor.origin === 'replay' ? 'Wiedergabe läuft' : 'Messung läuft', 'valid');
    chart.hidden = slopeChart.hidden = false;
    byId('live-gap').hidden = !samples.some(point => point.value === null);
    if (wasValid !== (currentStatus.state === 'valid') || performance.now() - lastDraw >= 100) redraw();
  }

  function connectStream(session) {
    if (!openStream || session.socket || performance.now() < session.retryAt) return;
    session.retryAt = performance.now() + 3_000;
    try { session.socket = openStream(); } catch { return; }
    const socket = session.socket;
    if (!socket) return;
    socket.onmessage = event => {
      if (active !== session || session.socket !== socket) return;
      let frame;
      try { frame = JSON.parse(event.data); } catch { return; }
      if (!frame?.status) return;
      session.revision++;
      session.streamAt = performance.now();
      update(frame, frame);
    };
    socket.onerror = () => socket.close();
    socket.onclose = () => {
      if (active !== session || session.socket !== socket) return;
      session.socket = null;
      session.streamAt = -Infinity;
      session.retryAt = performance.now() + 3_000;
    };
  }

  async function poll(session) {
    if (active !== session) return;
    connectStream(session);
    if (performance.now() - session.streamAt >= pollDelay * 2) {
      const revision = session.revision;
      const request = new AbortController();
      session.request = request;
      const timeout = setTimeout(() => request.abort(), staleAfter);
      try {
        const [status, frame] = await Promise.all([
          readJson('/api/status', request.signal),
          readJson('/api/latest', request.signal),
        ]);
        if (active === session && revision === session.revision) update(status, frame);
      } catch {
        if (active === session && revision === session.revision) {
          unavailable('Messserver nicht erreichbar', 'Prüfe den Messserver am Rechner und die Netzwerkverbindung.');
        }
      } finally {
        clearTimeout(timeout);
        session.request = null;
      }
    }
    if (active === session) session.timer = setTimeout(() => poll(session), pollDelay);
  }

  new ResizeObserver(redraw).observe(byId('live-plot'));
  return {
    start() {
      if (active) return;
      active = {socket: null, request: null, timer: null, revision: 0, streamAt: -Infinity, retryAt: -Infinity};
      unavailable('Verbinde mit dem Messserver …', '', 'loading');
      poll(active);
    },
    stop() {
      const session = active;
      if (!session) return;
      active = null;
      clearTimeout(session.timer);
      session.request?.abort();
      session.socket?.close();
    },
    redraw,
    refreshLanguage() {
      showStatus(currentStatus.label, currentStatus.state, currentStatus.detail);
      if (sensor) setText(byId('live-chart-unit'), translate(sensor.unit === '°C' ? 'Temperatur' : 'Abstand ab Sensorfront') + ' · ' + sensor.unit);
      showReadings(currentStatus.state === 'valid' ? samples.at(-1) : null);
      redraw();
    },
  };
}
