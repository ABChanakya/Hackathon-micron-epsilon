// Factory plan: zoomed out it is the floor plan with the modules on it; zoomed in (+, pinch, Ctrl + wheel, or a tap on
// a group) it becomes a grid of module boxes that keeps each module's place on the plan (top right stays top right).
// A module whose sensor is out of its limits blinks red on the plan and in the grid. "Fehler simulieren" makes one
// sensor spike, for demos and tests.
import { createFactorySim, gridLayout, worstAlarm } from './fabrik-sim.mjs';

const width = 1400;
const height = 505;
const opticalModel = 'optoNCDT ILD1900-10';
const stations = [
  { name: 'Materialbereitstellung', position: 'Zuführband', quantity: 'Abstand zur Werkstückoberseite',
    model: opticalModel, mesh: 'opto', unit: 'mm', x: 407, y: 328, heads: 2, demoId: 'desktop-distance' },
  { name: 'Mechanische Bearbeitung', position: 'Auslauf der Bearbeitungslinie', quantity: 'Oberflächentemperatur',
    model: 'thermoMETER UC', mesh: 'uc', unit: '°C', x: 662, y: 328, heads: 1 },
  { name: 'Qualitätskontrolle', position: 'Prüfstand', quantity: 'Bauteilhöhe',
    model: opticalModel, mesh: 'opto', unit: 'mm', x: 1053, y: 328, heads: 2, demoId: 'desktop-distance' },
];
const svgNS = 'http://www.w3.org/2000/svg';
const chevron = '<svg class="control-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9 6 6 6-6"/></svg>';
const sensorIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="11" rx="2"/><path d="M12 15v5m-3 0h6M8 9h2m4 0h2"/></svg>';
const clock = () => performance.now() / 1000;
const formats = {};
const format = (value, digits) => (formats[digits] ??= new Intl.NumberFormat('de-DE',
  { minimumFractionDigits: digits, maximumFractionDigits: digits })).format(value);
const alarmText = { ok: 'In Ordnung', active: 'Alarm', latched: 'Alarm vorbei · quittieren' };
const tileSizeKey = 'micro-epsilon-factory-tiles';

function marker(markers, text, activate) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'factory-marker';
  button.setAttribute('aria-label', text);
  button.innerHTML = '<span class="factory-symbol" aria-hidden="true">' + sensorIcon + '</span>';
  button.addEventListener('click', activate);
  markers.append(button);
  return button;
}

// Used by the phone view and the desktop monitor. Options: selectSensor(sensor) when a sensor is chosen (sensor.live
// for the one a real sensor drives), onAlarm({ key, label, active, text }) when a simulated module starts or stops an
// alarm (the live one is reported by the monitor itself), open: show the plan expanded.
export function mountFactoryPlan(parent, { selectSensor, onAlarm = () => {}, open: startOpen = false }) {
  const section = document.createElement('section');
  section.className = 'factory-section';
  section.setAttribute('aria-label', 'Fabrikplan');
  section.innerHTML = `
    <button class="factory-toggle" type="button" aria-expanded="false" aria-controls="factory-content">
      <span>Fabrikplan anzeigen</span>${chevron}
    </button>
    <div class="factory-content" id="factory-content" hidden>
      <section class="detail-panel factory-panel" aria-labelledby="factory-title">
        <div class="factory-toolbar">
          <h2 id="factory-title">Fiktiver Fabrikplan</h2>
          <div class="factory-zoom" role="group" aria-label="Ansicht">
            <button type="button" data-zoom="out" aria-label="Herauszoomen: Hallenplan">−</button>
            <button type="button" data-view="map" aria-pressed="true">Plan</button>
            <button type="button" data-view="grid" aria-pressed="false">Module</button>
            <button type="button" data-zoom="in" aria-label="Hineinzoomen: Module">+</button>
          </div>
        </div>
        <div class="factory-actions">
          <button type="button" class="factory-fault" data-fault>Fehler simulieren</button>
          <label class="factory-size">Kachelgröße
            <select data-tiles><option value="s">Klein</option><option value="m" selected>Mittel</option><option value="l">Groß</option></select>
          </label>
          <p class="factory-alarm" role="status" aria-live="polite" data-state="ok">Alle Module in Ordnung.</p>
        </div>
        <div class="factory-map" role="group" aria-label="Hallenplan und Module" aria-describedby="factory-hint" tabindex="0">
          <img class="factory-floor" alt="" draggable="false">
          <svg class="factory-links" aria-hidden="true"></svg>
          <div class="factory-markers"></div>
        </div>
        <div class="factory-grid" role="group" aria-label="Module nach ihrer Lage in der Halle" aria-describedby="factory-hint" tabindex="0" hidden></div>
        <p class="detail-meta factory-hint" id="factory-hint">Hineinzoomen (+, zwei Finger oder Strg + Mausrad) zeigt die Module als Kacheln in ihrer Lage in der Halle. Herauszoomen zeigt wieder den Plan. Ein Modul im Alarm blinkt rot.</p>
      </section>
    </div>`;
  const find = (selector) => section.querySelector(selector);
  const toggle = find('.factory-toggle');
  const content = find('.factory-content');
  const viewport = find('.factory-map');
  const floor = find('.factory-floor');
  const links = find('.factory-links');
  const markers = find('.factory-markers');
  const grid = find('.factory-grid');
  const status = find('.factory-alarm');
  const tiles = find('[data-tiles]');
  let mode = 'map';
  let modelRenderer;
  const selectable = [];   // every button that selects a sensor (map and grid), for aria-pressed
  let liveKey = null;      // the head a real, live sensor drives (see "live sensor" below)

  // ---- sensors -------------------------------------------------------------------------------
  const heads = [];
  for (const station of stations) {
    for (let index = 0; index < station.heads; index++) {
      const suffix = station.heads > 1 ? (index === 0 ? 'A' : 'B') : '';
      heads.push({ key: station.name + '|' + suffix, station, suffix, index, unit: station.unit,
        sensor: { ...station, suffix },
        label: [station.name, station.model, suffix && 'Messkopf ' + suffix, station.quantity].filter(Boolean).join(' · ') });
    }
  }
  const sim = createFactorySim(heads);

  function choose(head, button) {
    for (const item of selectable) item.setAttribute('aria-pressed', String(item === button));
    // the module the real sensor drives opens the live readings, not a recorded demo
    selectSensor(head.key === liveKey ? { ...head.sensor, live: true } : head.sensor);
  }

  // ---- plan (zoomed out) ------------------------------------------------------------------------
  const mapMarkers = [];    // { station, heads: [keys], button }
  for (const station of stations) {
    const own = heads.filter(head => head.station === station);
    if (own.length > 1) {
      const group = marker(markers, station.name + ' · ' + own.length + ' Sensoren, als Module anzeigen',
        () => showGrid(station));
      group.querySelector('.factory-symbol').append(String(own.length));
      mapMarkers.push({ station, keys: own.map(head => head.key), button: group, x: station.x, y: station.y - 40 });
    } else {
      const head = own[0];
      const button = marker(markers, head.label, () => choose(head, button));
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', 'recorded-view');
      selectable.push(button);
      const line = document.createElementNS(svgNS, 'line');
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('r', '3');
      links.append(line, dot);
      mapMarkers.push({ station, keys: [head.key], button, line, dot, x: station.x, y: station.y - 42 });
    }
  }

  function renderMap() {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    const ratio = Math.min(w / width, h / height);
    if (!ratio) return;
    const left = (w - width * ratio) / 2, top = (h - height * ratio) / 2;
    const px = x => left + x * ratio, py = y => top + y * ratio;
    floor.style.width = width * ratio + 'px';
    floor.style.height = height * ratio + 'px';
    floor.style.transform = 'translate(' + left + 'px,' + top + 'px)';
    for (const item of mapMarkers) {
      item.button.style.left = px(item.x) + 'px';
      item.button.style.top = py(item.y) + 'px';
      if (item.line) {
        item.line.setAttribute('x1', px(item.x)); item.line.setAttribute('y1', py(item.y));
        item.line.setAttribute('x2', px(item.station.x)); item.line.setAttribute('y2', py(item.station.y));
        item.dot.setAttribute('cx', px(item.station.x)); item.dot.setAttribute('cy', py(item.station.y));
      }
    }
  }

  // ---- module grid (zoomed in) ------------------------------------------------------------------
  const layout = gridLayout(stations.map(station => ({ x: station.x, y: station.y, station })));
  grid.style.setProperty('--cols', layout.cols);
  grid.style.setProperty('--rows', layout.rows);
  const modules = [];       // { station, box, chip, ack, keys }
  const tilesByKey = new Map();
  for (const { item, col, row } of layout.cells) {
    const { station } = item;
    const box = document.createElement('section');
    box.className = 'factory-module';
    box.style.gridColumn = String(col + 1);
    box.style.gridRow = String(row + 1);
    box.setAttribute('aria-label', station.name);
    box.innerHTML = `<header><div><h3></h3><p class="factory-module-place"></p></div><span class="factory-chip" data-state="ok">In Ordnung</span></header>
      <div class="factory-module-sensors"></div>
      <button type="button" class="factory-ack" hidden>Alarm quittieren</button>`;
    box.querySelector('h3').textContent = station.name;
    box.querySelector('.factory-module-place').textContent = station.position;
    const list = box.querySelector('.factory-module-sensors');
    const own = heads.filter(head => head.station === station);
    for (const head of own) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'factory-tile';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', 'recorded-view');
      button.innerHTML = `<img class="factory-tile-model" alt="" hidden><span class="factory-tile-name"></span>
        <span class="factory-tile-quantity"></span><span class="factory-tile-value"><b>—</b> <small></small></span>
        <span class="factory-tile-state">In Ordnung</span><span class="factory-live" hidden>LIVE</span>`;
      button.querySelector('.factory-tile-name').textContent = station.model + (head.suffix ? ' · Messkopf ' + head.suffix : '');
      button.querySelector('.factory-tile-quantity').textContent = station.quantity;
      button.querySelector('small').textContent = station.unit;
      button.addEventListener('click', () => choose(head, button));
      selectable.push(button);
      list.append(button);
      tilesByKey.set(head.key, { button, value: button.querySelector('b'), state: button.querySelector('.factory-tile-state'),
        model: button.querySelector('.factory-tile-model'), live: button.querySelector('.factory-live'), head });
    }
    const ack = box.querySelector('.factory-ack');
    ack.addEventListener('click', () => { for (const head of own) sim.acknowledge(head.key); update(); });
    grid.append(box);
    modules.push({ station, box, chip: box.querySelector('.factory-chip'), ack, keys: own.map(head => head.key) });
  }

  async function loadModels() {
    try {
      modelRenderer ??= import('./modellansicht.mjs');
      const { sensorPreview } = await modelRenderer;
      for (const tile of tilesByKey.values()) {
        if (tile.model.src) continue;
        tile.model.src = sensorPreview(tile.head.station.mesh, tile.head.index);
        tile.model.hidden = false;
      }
    } catch (error) {
      console.warn('Sensorvorschau konnte nicht geladen werden.', error);
    }
  }

  // ---- switching between plan and grid ---------------------------------------------------------
  function setMode(next, focusStation, moveFocus = true) {
    mode = next;
    viewport.hidden = next !== 'map';
    grid.hidden = next !== 'grid';
    for (const button of section.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === next));
    find('[data-zoom="out"]').setAttribute('aria-disabled', String(next === 'map'));
    find('[data-zoom="in"]').setAttribute('aria-disabled', String(next === 'grid'));
    if (next === 'grid') {
      loadModels();
      const target = modules.find(module => module.station === focusStation);
      if (moveFocus) (target?.box.querySelector('.factory-tile') ?? grid).focus({ preventScroll: true });
    } else {
      renderMap();
      if (moveFocus) viewport.focus({ preventScroll: true });
    }
    update();
  }
  const showGrid = (station) => setMode('grid', station);
  find('[data-zoom="in"]').addEventListener('click', () => setMode('grid'));
  find('[data-zoom="out"]').addEventListener('click', () => setMode('map'));
  for (const button of section.querySelectorAll('[data-view]')) button.addEventListener('click', () => setMode(button.dataset.view));
  for (const surface of [viewport, grid]) {
    surface.addEventListener('keydown', (event) => {
      if (event.key === '+') { event.preventDefault(); setMode('grid'); }
      if (event.key === '-' || event.key === '−') { event.preventDefault(); setMode('map'); }
    });
    surface.addEventListener('wheel', (event) => {      // trackpad pinch and Ctrl + wheel
      if (!event.ctrlKey) return;
      event.preventDefault();
      setMode(event.deltaY < 0 ? 'grid' : 'map');
    }, { passive: false });
    const pointers = new Map();
    let startDistance = 0;
    surface.addEventListener('pointerdown', (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size === 2) {
        const [a, b] = pointers.values();
        startDistance = Math.hypot(a.x - b.x, a.y - b.y);
      }
    });
    surface.addEventListener('pointermove', (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size !== 2 || !startDistance) return;
      const [a, b] = pointers.values();
      const scale = Math.hypot(a.x - b.x, a.y - b.y) / startDistance;
      if (scale > 1.25 && mode === 'map') { startDistance = 0; setMode('grid'); }
      if (scale < 0.8 && mode === 'grid') { startDistance = 0; setMode('map'); }
    });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      surface.addEventListener(type, (event) => { pointers.delete(event.pointerId); if (pointers.size < 2) startDistance = 0; });
    }
  }

  // ---- tile size ("anpassbar") ------------------------------------------------------------------
  try { tiles.value = localStorage.getItem(tileSizeKey) || 'm'; } catch { /* storage may be blocked */ }
  grid.dataset.size = tiles.value;
  tiles.addEventListener('change', () => {
    grid.dataset.size = tiles.value;
    try { localStorage.setItem(tileSizeKey, tiles.value); } catch { /* storage may be blocked */ }
  });

  // ---- live demo values and alarms -------------------------------------------------------------
  const seen = new Map();   // key -> last alarm state, to announce only changes
  function update() {
    const readings = sim.read(clock());
    const byKey = new Map(readings.map(r => [r.key, r]));
    const active = [];
    for (const r of readings) {
      const tile = tilesByKey.get(r.key);
      tile.value.textContent = r.value === null ? '—' : format(r.value, r.digits);
      tile.button.dataset.alarm = r.alarm;
      tile.state.textContent = alarmText[r.alarm] + (r.live && r.reason ? ' · ' + r.reason : '');
      tile.live.hidden = !r.live;
      if (r.alarm === 'active') active.push(r);
      if (!r.live && (r.alarm === 'active') !== (seen.get(r.key) === 'active')) {
        onAlarm({ key: r.key, label: tile.head.label, active: r.alarm === 'active',
          text: tile.head.label + ': ' + format(r.value, r.digits) + ' ' + r.unit
            + ' (Grenzen ' + format(r.lower, r.digits) + '–' + format(r.upper, r.digits) + ' ' + r.unit + ')' });
      }
      if (r.alarm === 'active' && seen.get(r.key) !== 'active') {
        const head = tile.head;
        status.textContent = r.live
          ? 'Alarm (live): ' + head.label + ': ' + (r.value === null ? '—' : format(r.value, r.digits) + ' ' + r.unit) + ' · ' + r.reason
          : 'Alarm: ' + head.label + ': ' + format(r.value, r.digits) + ' ' + r.unit
            + ' (Grenzen ' + format(r.lower, r.digits) + '–' + format(r.upper, r.digits) + ' ' + r.unit + ')';
      }
      seen.set(r.key, r.alarm);
    }
    for (const module of modules) {
      const state = worstAlarm(module.keys.map(key => byKey.get(key).alarm));
      module.box.dataset.alarm = state;
      module.chip.dataset.state = state;
      module.chip.textContent = alarmText[state];
      module.ack.hidden = state !== 'latched';
    }
    for (const item of mapMarkers) item.button.dataset.alarm = worstAlarm(item.keys.map(key => byKey.get(key).alarm));
    const open = readings.filter(r => r.alarm !== 'ok').length;
    status.dataset.state = active.length ? 'active' : open ? 'latched' : 'ok';
    if (!active.length) {
      const text = open ? open + (open === 1 ? ' Alarm' : ' Alarme') + ' zu quittieren (in der Modulansicht).' : 'Alle Module in Ordnung.';
      if (status.textContent !== text) status.textContent = text;
    }
  }
  find('[data-fault]').addEventListener('click', () => {
    const key = sim.injectFault(clock());
    update();
    const head = heads.find(h => h.key === key);
    status.textContent = 'Fehler simuliert: ' + head.label + '.';
  });
  setInterval(() => { if (!content.hidden) update(); }, 200);

  // ---- live sensor --------------------------------------------------------------------------------
  // When the measuring server has a verified, live sensor, it drives one module of the plan: the ILD1900 is
  // "Qualitätskontrolle · Messkopf A", the thermoMETER "Mechanische Bearbeitung". Its alarm is the server's: the AI
  // flags something (or recognises a taught anomaly) or there is no valid reading.
  const liveHead = { ild1900: 'Qualitätskontrolle|A', thermo_uc: 'Mechanische Bearbeitung|' };
  const reasons = { mean: 'Messwert verschoben', std: 'Rauschen erhöht', p2p: 'Schwankung erhöht', slope: 'Ungewöhnlicher Verlauf',
    jitter: 'Unruhiges Signal', err_frac: 'Ungültige Messwerte', intensity: 'Signalstärke verändert', no_match: 'Passt zu keinen bekannten Daten' };
  let liveSeen = 0, polling = false;
  async function pollLive() {
    if (content.hidden || polling) return;
    polling = true;
    try {
      const response = await fetch('/api/latest', { cache: 'no-store' });
      const frame = response.ok ? await response.json() : null;
      const device = frame?.device;
      const key = frame?.status === 'streaming' && device?.live && device.verified ? liveHead[device.family] : null;
      if (liveKey && liveKey !== key) sim.setLive(liveKey, null);
      if (key) {
        const ml = frame.ml || {};
        const known = ml.known?.label_note;
        const invalid = frame.current_valid === false;
        const alarm = invalid || ml.state === 'alert';
        const reason = invalid ? (frame.last_error?.text || 'Kein gültiger Messwert')
          : alarm ? 'KI: ' + (known ? 'Bekannte Anomalie · ' + known : reasons[ml.reason] || 'Auffälligkeit')
          : ml.state === 'learning' ? 'KI lernt' : 'KI überwacht';
        const value = device.unit === '°C' ? frame.raw_value : frame.dist_from_face_mm;
        sim.setLive(key, { value: Number.isFinite(value) && !invalid ? value : null, alarm, reason });
        liveSeen = performance.now();
      }
      liveKey = key;
    } catch {
      if (liveKey && performance.now() - liveSeen > 3000) { sim.setLive(liveKey, null); liveKey = null; }
    } finally {
      polling = false;
    }
  }
  setInterval(pollLive, 400);

  // ---- open / close ----------------------------------------------------------------------------
  toggle.addEventListener('click', () => {
    const open = content.hidden;
    content.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.firstElementChild.textContent = open ? 'Fabrikplan ausblenden' : 'Fabrikplan anzeigen';
    if (open) {
      if (!floor.getAttribute('src')) floor.src = new URL('./grundriss.svg', import.meta.url);
      setMode(mode, null, false);            // opening the plan does not take the keyboard focus
    }
  });
  parent.append(section);
  new ResizeObserver(() => { if (mode === 'map') renderMap(); }).observe(viewport);
  if (startOpen) toggle.click();
  return () => { for (const item of selectable) item.setAttribute('aria-pressed', 'false'); };
}
