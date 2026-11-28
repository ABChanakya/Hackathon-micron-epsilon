// Factory plan: zoomed out it is the floor plan with the modules on it; zoomed in (+, pinch, Ctrl + wheel, or a tap on
// a group) it becomes a grid of module boxes that keeps each module's place on the plan (top right stays top right).
// A module whose sensor is out of its limits blinks red on the plan and in the grid. "Fehler simulieren" makes one
// sensor spike, for demos and tests. With a real sensor connected to the measuring server, one module shows its live
// values (LIVE) and its alarm is the server's. The floor plan follows the page's light or dark colour scheme.
import { createFactorySim, gridLayout, worstAlarm } from './fabrik-sim.mjs';

const width = 1400;
const height = 505;
const opticalModel = 'optoNCDT ILD1900-10';
const stations = [
  { name: 'Materialbereitstellung', nameKey: 'materialStation', position: 'Zuführband', positionKey: 'materialPosition', quantity: 'Abstand zur Werkstückoberseite', quantityKey: 'quantityDistance',
    model: opticalModel, mesh: 'opto', unit: 'mm', x: 407, y: 328, heads: 2, demoId: 'desktop-distance' },
  { name: 'Mechanische Bearbeitung', nameKey: 'machiningStation', position: 'Auslauf der Bearbeitungslinie', positionKey: 'machiningPosition', quantity: 'Oberflächentemperatur', quantityKey: 'quantityTemperature',
    model: 'thermoMETER UC', mesh: 'uc', unit: '°C', x: 662, y: 328, heads: 1 },
  { name: 'Qualitätskontrolle', nameKey: 'qualityStation', position: 'Prüfstand', positionKey: 'qualityPosition', quantity: 'Bauteilhöhe', quantityKey: 'quantityHeight',
    model: opticalModel, mesh: 'opto', unit: 'mm', x: 1053, y: 328, heads: 2, demoId: 'desktop-distance' },
];
const svgNS = 'http://www.w3.org/2000/svg';
const chevron = '<svg class="control-icon" aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="m6 9 6 6 6-6"/></svg>';
const sensorIcon = '<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="4" y="4" width="16" height="11" rx="2"/><path d="M12 15v5m-3 0h6M8 9h2m4 0h2"/></svg>';
const clock = () => performance.now() / 1000;
let planSequence = 0;
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

// Options: selectSensor(sensor) when a sensor is chosen (sensor.live for the one a real sensor drives), onAlarm({ key,
// label, active, text }) when a simulated module starts or stops an alarm (the live one is reported by the monitor itself).
export function mountFactoryPlan(parent, { selectSensor = () => {}, onAlarm = () => {}, expanded = false, controlsId = 'recorded-view', language = '', text } = {}) {
  let disposed = false;
  const instance = ++planSequence;
  const contentId = 'factory-content-' + instance, titleId = 'factory-title-' + instance, hintId = 'factory-hint-' + instance;
  const formats = new Map();
  const t = (key, values = {}, fallback = key) => text ? text(key, values) : fallback.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ''));
  const stationName = station => t(station.nameKey, {}, station.name);
  const quantity = station => t(station.quantityKey, {}, station.quantity);
  const headName = head => [stationName(head.station), head.station.model, head.suffix && t('sensorHead', { head: head.suffix }, 'Messkopf {head}'), quantity(head.station)].filter(Boolean).join(' · ');
  const alarmText = state => t(({ ok: 'stateOk', active: 'stateActive', latched: 'stateLatched' })[state], {}, ({ ok: 'In Ordnung', active: 'Alarm', latched: 'Alarm vorbei · quittieren' })[state]);
  const format = (value, digits) => {
    const selected = language || document.documentElement.lang || 'de';
    const locale = selected === 'pirate' ? 'en' : selected;
    const key = locale + ':' + digits;
    if (!formats.has(key)) formats.set(key, new Intl.NumberFormat(locale, { minimumFractionDigits: digits, maximumFractionDigits: digits }));
    return formats.get(key).format(value);
  };
  const section = document.createElement('section');
  section.className = 'factory-section';
  section.setAttribute('aria-label', t('buildingPlan', {}, 'Gebäudeplan'));
  if (text) section.setAttribute('data-i18n-skip', '');
  section.innerHTML = `
    <button class="factory-toggle" type="button" aria-expanded="${expanded}" aria-controls="${contentId}">
      <span data-factory-text="showPlan">Gebäudeplan anzeigen</span>${chevron}
    </button>
    <div class="factory-content" id="${contentId}" ${expanded ? '' : 'hidden'}>
      <section class="detail-panel factory-panel" aria-labelledby="${titleId}">
        <div class="factory-toolbar">
          <div><h2 id="${titleId}" data-factory-text="buildingPlan">Gebäudeplan</h2><p class="factory-plan-note" data-factory-text="planNote">Fiktiver Gebäudeplan. Es wurde kein echter Gebäudeplan hochgeladen.</p></div>
          <div class="factory-zoom" role="group" aria-label="Ansicht" data-factory-label="viewLabel">
            <button type="button" data-zoom="out" aria-label="Herauszoomen: Gebäudeplan" data-factory-label="zoomOut">−</button>
            <button type="button" data-view="map" aria-pressed="true" data-factory-text="map">Plan</button>
            <button type="button" data-view="grid" aria-pressed="false" data-factory-text="modules">Module</button>
            <button type="button" data-zoom="in" aria-label="Hineinzoomen: Module" data-factory-label="zoomIn">+</button>
          </div>
        </div>
        <div class="factory-actions">
          <button type="button" class="factory-fault" data-fault data-factory-text="simulateFault">Fehler simulieren</button>
          <label class="factory-size"><span data-factory-text="tileSize">Kachelgröße</span>
            <select data-tiles><option value="s" data-factory-text="small">Klein</option><option value="m" selected data-factory-text="medium">Mittel</option><option value="l" data-factory-text="large">Groß</option></select>
          </label>
          <p class="factory-simulation" data-factory-text="simulatedValues">Simulierte Modulwerte · keine Live-Sensordaten</p><p class="factory-alarm" role="status" aria-live="polite" data-state="ok">Alle Module in Ordnung.</p>
        </div>
        <div class="factory-map" role="group" aria-label="Gebäudeplan und Module" data-factory-label="mapLabel" aria-describedby="${hintId}" tabindex="0">
          <img class="factory-floor" alt="" draggable="false">
          <svg class="factory-links" aria-hidden="true"></svg>
          <div class="factory-markers"></div>
        </div>
        <div class="factory-grid" role="group" aria-label="Module nach ihrer Lage im Gebäude" data-factory-label="gridLabel" aria-describedby="${hintId}" tabindex="0" hidden></div>
        <p class="detail-meta factory-hint" id="${hintId}" data-factory-text="interactionHint">Hineinzoomen (+, zwei Finger oder Strg + Mausrad) zeigt die Module an ihrer Position im Gebäude. Herauszoomen zeigt den Plan. Simulierte Alarme werden hervorgehoben.</p>
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

  // ---- floor plan in the page's colour scheme ------------------------------------------------------
  // The plan is an SVG image, so it cannot inherit the page's colours. In the light scheme a recoloured copy is shown.
  const floorSvg = new URL('./grundriss.svg', import.meta.url);
  const lightFloorColors = new Map([
    ['#151d26', '#f6f8fa'], ['#2a3642', '#dce3e9'], ['#263543', '#e5ebf0'],
    ['#243342', '#d9e2e9'], ['#273747', '#e4eaf0'], ['#394b5c', '#d1dce4'],
    ['#415163', '#b9c7d1'], ['#657986', '#71899a'], ['#65798d', '#71899a'],
    ['#657e963d', '#52687955'], ['#768da0', '#71899a'], ['#8395a6', '#71899a'],
    ['#8fa4b7', '#60798d'], ['#9eafbf', '#60798d'], ['#b0c1d1', '#526879'],
    ['#9eb8d055', '#52687944'], ['#e9edf1', '#18212a'], ['#c1cfdb', '#405260'],
    ['#b6c8d9', '#405260'],
  ]);
  let floorSource = null, floorUrl = null, themeObserver = null;
  const lightScheme = () => globalThis.document?.documentElement?.dataset?.theme !== 'dark';
  async function showFloor() {
    if (disposed) return;
    if (!floor.getAttribute('src')) floor.src = floorSvg;              // shown at once; recoloured below when light
    if (typeof fetch !== 'function' || typeof Blob !== 'function' || !globalThis.URL?.createObjectURL) return;
    try {
      floorSource ??= fetch(floorSvg).then(response => response.ok ? response.text() : Promise.reject(new Error(String(response.status))));
      let svg = await floorSource;
      if (disposed) return;
      if (floorUrl) { URL.revokeObjectURL(floorUrl); floorUrl = null; }
      if (!lightScheme()) { floor.src = floorSvg; return; }
      for (const [from, to] of lightFloorColors) svg = svg.replaceAll(from, to);
      floorUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
      floor.src = floorUrl;
    } catch {
      floorSource = null;                                               // keep the original plan; try again next time
    }
  }
  if (typeof MutationObserver === 'function' && globalThis.document?.documentElement) {
    themeObserver = new MutationObserver(() => { if (floor.getAttribute('src')) showFloor(); });
    themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  }

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

  function choose(head) {
    if (disposed) return;
    for (const item of selectable) item.setAttribute('aria-pressed', String(item.dataset.sensorKey === head.key));
    selectSensor(head.key === liveKey
      ? { ...head.sensor, key: head.key, source: 'live', live: true }
      : { ...head.sensor, key: head.key, source: 'demo', simulated: true });
  }

  // ---- plan (zoomed out) ------------------------------------------------------------------------
  const mapMarkers = [];    // { station, heads: [keys], button }
  for (const station of stations) {
    const own = heads.filter(head => head.station === station);
    if (own.length > 1) {
      const group = marker(markers, t('sensorGroup', { station: stationName(station), count: own.length }, '{station} · {count} Sensoren, als Module anzeigen'),
        () => showGrid(station));
      group.querySelector('.factory-symbol').append(String(own.length));
      mapMarkers.push({ station, keys: own.map(head => head.key), button: group, x: station.x, y: station.y - 40 });
    } else {
      const head = own[0];
      const button = marker(markers, head.label, () => choose(head, button));
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', controlsId);
      button.dataset.sensorKey = head.key;
      selectable.push(button);
      const line = document.createElementNS(svgNS, 'line');
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('r', '3');
      links.append(line, dot);
      mapMarkers.push({ station, keys: [head.key], button, line, dot, x: station.x, y: station.y - 42 });
    }
  }

  function renderMap() {
    if (disposed) return;
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
      <button type="button" class="factory-ack" data-factory-text="acknowledgeAlarm" hidden>Alarm quittieren</button>`;
    box.querySelector('h3').textContent = station.name;
    box.querySelector('.factory-module-place').textContent = station.position;
    const list = box.querySelector('.factory-module-sensors');
    const own = heads.filter(head => head.station === station);
    for (const head of own) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'factory-tile';
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', controlsId);
      button.dataset.sensorKey = head.key;
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
      if (disposed) return;
      for (const tile of tilesByKey.values()) {
        if (tile.model.src) continue;
        tile.model.src = sensorPreview(tile.head.station.mesh, tile.head.index);
        tile.model.hidden = false;
      }
    } catch (error) {
      if (!disposed) console.warn(t('sensorPreviewError', {}, 'Sensorvorschau konnte nicht geladen werden.'), error);
    }
  }

  // ---- switching between plan and grid ---------------------------------------------------------
  function setMode(next, focusStation, focus = true) {
    if (disposed) return;
    mode = next;
    viewport.hidden = next !== 'map';
    grid.hidden = next !== 'grid';
    for (const button of section.querySelectorAll('[data-view]')) button.setAttribute('aria-pressed', String(button.dataset.view === next));
    find('[data-zoom="out"]').setAttribute('aria-disabled', String(next === 'map'));
    find('[data-zoom="in"]').setAttribute('aria-disabled', String(next === 'grid'));
    if (next === 'grid') {
      loadModels();
      const target = modules.find(module => module.station === focusStation);
      if (focus) (target?.box.querySelector('.factory-tile') ?? grid).focus({ preventScroll: true });
    } else {
      renderMap();
      if (focus) viewport.focus({ preventScroll: true });
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
  try { const stored = localStorage.getItem(tileSizeKey); tiles.value = ['s', 'm', 'l'].includes(stored) ? stored : 'm'; } catch { tiles.value = 'm'; }
  grid.dataset.size = tiles.value;
  tiles.addEventListener('change', () => {
    grid.dataset.size = tiles.value;
    try { localStorage.setItem(tileSizeKey, tiles.value); } catch { /* storage may be blocked */ }
  });

  // ---- live demo values and alarms -------------------------------------------------------------
  const seen = new Map();   // key -> last alarm state, to announce only changes
  function update() {
    if (disposed) return;
    const readings = sim.read(clock());
    const byKey = new Map(readings.map(r => [r.key, r]));
    const active = [];
    for (const r of readings) {
      const tile = tilesByKey.get(r.key);
      const head = tile.head;
      const shown = r.value === null ? '—' : format(r.value, r.digits);
      tile.value.textContent = shown;
      tile.button.dataset.alarm = r.alarm;
      tile.state.textContent = alarmText(r.alarm) + (r.live && r.reason ? ' · ' + r.reason : '');
      if (tile.live.hidden === Boolean(r.live)) {
        tile.live.hidden = !r.live;
        tile.button.setAttribute('aria-label', r.live ? t('liveSensor', { sensor: headName(head) }, '{sensor} · Live-Werte des angeschlossenen Sensors')
          : t('simulatedSensor', { sensor: headName(head) }, '{sensor} · simulierte Werte'));
      }
      if (r.alarm === 'active') active.push(r);
      const limits = { sensor: headName(head), value: shown, unit: r.unit, lower: format(r.lower, r.digits), upper: format(r.upper, r.digits) };
      if (!r.live && (r.alarm === 'active') !== (seen.get(r.key) === 'active')) {
        onAlarm({ key: r.key, label: headName(head), active: r.alarm === 'active',
          text: t('alarmValue', limits, 'Alarm: {sensor}: {value} {unit} (Grenzen {lower}–{upper} {unit})') });
      }
      if (r.alarm === 'active' && seen.get(r.key) !== 'active') {
        status.textContent = r.live
          ? t('liveAlarm', { sensor: headName(head), value: shown, unit: r.value === null ? '' : r.unit }, 'Alarm (live): {sensor}: {value} {unit}').trim() + (r.reason ? ' · ' + r.reason : '')
          : t('alarmValue', limits, 'Alarm: {sensor}: {value} {unit} (Grenzen {lower}–{upper} {unit})');
      }
      seen.set(r.key, r.alarm);
    }
    for (const module of modules) {
      const state = worstAlarm(module.keys.map(key => byKey.get(key).alarm));
      module.box.dataset.alarm = state;
      module.chip.dataset.state = state;
      module.chip.textContent = alarmText(state);
      module.ack.hidden = state !== 'latched';
    }
    for (const item of mapMarkers) item.button.dataset.alarm = worstAlarm(item.keys.map(key => byKey.get(key).alarm));
    const open = readings.filter(r => r.alarm !== 'ok').length;
    status.dataset.state = active.length ? 'active' : open ? 'latched' : 'ok';
    if (!active.length) {
      const text = open ? t(open === 1 ? 'pendingOne' : 'pendingMany', { count: open }, open === 1 ? '{count} Alarm zu quittieren (in der Modulansicht).' : '{count} Alarme zu quittieren (in der Modulansicht).') : t('allOk', {}, 'Alle Module in Ordnung.');
      if (status.textContent !== text) status.textContent = text;
    }
  }
  find('[data-fault]').addEventListener('click', () => {
    if (disposed) return;
    const key = sim.injectFault(clock());
    update();
    const head = heads.find(h => h.key === key);
    status.textContent = t('faultSimulated', { sensor: headName(head) }, 'Fehler simuliert: {sensor}.');
  });
  const timer = setInterval(() => { if (!content.hidden) { pollLive(); update(); } }, 200);

  // ---- live sensor --------------------------------------------------------------------------------
  // When the measuring server has a verified, live sensor, it drives one module of the plan: the ILD1900 is
  // "Qualitätskontrolle · Messkopf A", the thermoMETER "Mechanische Bearbeitung". Its alarm is the server's: the AI
  // flags something (or recognises a taught anomaly) or there is no valid reading.
  const liveHead = { ild1900: 'Qualitätskontrolle|A', thermo_uc: 'Mechanische Bearbeitung|' };
  const reasonKeys = { mean: 'reasonMean', std: 'reasonStd', p2p: 'reasonP2p', slope: 'reasonSlope', jitter: 'reasonJitter',
    err_frac: 'reasonErrFrac', intensity: 'reasonIntensity', no_match: 'reasonNoMatch' };
  const reasonSource = { reasonMean: 'Messwert verschoben', reasonStd: 'Rauschen erhöht', reasonP2p: 'Schwankung erhöht',
    reasonSlope: 'Ungewöhnlicher Verlauf', reasonJitter: 'Unruhiges Signal', reasonErrFrac: 'Ungültige Messwerte',
    reasonIntensity: 'Signalstärke verändert', reasonNoMatch: 'Passt zu keinen bekannten Daten', reasonOther: 'Auffälligkeit' };
  const simulationNote = find('[data-factory-text="simulatedValues"], [data-factory-text="simulatedWithLive"]');
  let liveSeen = 0, polling = false, lastPoll = -Infinity;
  async function pollLive() {
    const now = clock();
    if (disposed || polling || typeof fetch !== 'function' || now - lastPoll < 0.4) return;
    polling = true; lastPoll = now;
    try {
      const response = await fetch(new URL('/api/latest', import.meta.url), { cache: 'no-store' });
      const frame = response.ok ? await response.json() : null;
      if (disposed) return;
      const device = frame?.device;
      const key = frame?.status === 'streaming' && device?.live && device.verified ? liveHead[device.family] ?? null : null;
      if (liveKey && liveKey !== key) sim.setLive(liveKey, null);
      if (key) {
        const ml = frame.ml || {};
        const known = ml.known?.label_note;
        const invalid = frame.current_valid === false;
        const alarm = invalid || ml.state === 'alert';
        const reasonKey = reasonKeys[ml.reason] ?? 'reasonOther';
        const reason = invalid ? (frame.last_error?.text || t('noValidValue', {}, 'Kein gültiger Messwert'))
          : alarm ? t('aiAlarm', {}, 'KI-Alarm') + ' · ' + (known ? t('knownAnomaly', {}, 'Bekannte Anomalie') + ' · ' + known : t(reasonKey, {}, reasonSource[reasonKey]))
          : ml.state === 'learning' ? t('aiLearning', {}, 'KI lernt') : t('aiWatching', {}, 'KI überwacht');
        const value = device.unit === '°C' ? frame.raw_value : frame.dist_from_face_mm;
        sim.setLive(key, { value: Number.isFinite(value) && !invalid ? value : null, alarm, reason });
        liveSeen = now;
      }
      if (key !== liveKey && simulationNote) {
        simulationNote.dataset.factoryText = key ? 'simulatedWithLive' : 'simulatedValues';
        simulationNote.dataset.factorySource = key ? 'Simulierte Modulwerte · das LIVE-Modul zeigt den angeschlossenen Sensor'
          : 'Simulierte Modulwerte · keine Live-Sensordaten';
        simulationNote.textContent = t(simulationNote.dataset.factoryText, {}, simulationNote.dataset.factorySource);
      }
      liveKey = key;
    } catch {
      if (liveKey && clock() - liveSeen > 3) { sim.setLive(liveKey, null); liveKey = null; }
    } finally {
      polling = false;
    }
  }

  // ---- open / close ----------------------------------------------------------------------------
  toggle.addEventListener('click', () => {
    const open = content.hidden;
    content.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.firstElementChild.textContent = t(open ? 'hidePlan' : 'showPlan', {}, open ? 'Gebäudeplan ausblenden' : 'Gebäudeplan anzeigen');
    if (open) {
      showFloor();
      setMode(mode, null, false);            // opening the plan does not take the keyboard focus
    }
  });
  function localize() {
    section.setAttribute('aria-label', t('buildingPlan', {}, 'Gebäudeplan'));
    for (const node of section.querySelectorAll('[data-factory-text]')) {
      node.dataset.factorySource ??= node.textContent;
      node.textContent = t(node.dataset.factoryText, {}, node.dataset.factorySource);
    }
    toggle.firstElementChild.textContent = t(content.hidden ? 'showPlan' : 'hidePlan', {}, content.hidden ? 'Gebäudeplan anzeigen' : 'Gebäudeplan ausblenden');
    for (const node of section.querySelectorAll('[data-factory-label]')) {
      node.dataset.factoryLabelSource ??= node.getAttribute('aria-label');
      node.setAttribute('aria-label', t(node.dataset.factoryLabel, {}, node.dataset.factoryLabelSource));
    }
    for (const module of modules) {
      module.box.setAttribute('aria-label', stationName(module.station));
      module.box.querySelector('h3').textContent = stationName(module.station);
      module.box.querySelector('.factory-module-place').textContent = t(module.station.positionKey, {}, module.station.position);
    }
    for (const tile of tilesByKey.values()) {
      tile.button.setAttribute('aria-label', tile.head.key === liveKey ? t('liveSensor', { sensor: headName(tile.head) }, '{sensor} · Live-Werte des angeschlossenen Sensors')
        : t('simulatedSensor', { sensor: headName(tile.head) }, '{sensor} · simulierte Werte'));
      tile.button.querySelector('.factory-tile-name').textContent = tile.head.suffix ? t('headLabel', { model: tile.head.station.model, head: tile.head.suffix }, '{model} · Messkopf {head}') : tile.head.station.model;
      tile.button.querySelector('.factory-tile-quantity').textContent = quantity(tile.head.station);
    }
    for (const item of mapMarkers) item.button.setAttribute('aria-label', item.keys.length > 1 ? t('sensorGroup', { station: stationName(item.station), count: item.keys.length }, '{station} · {count} Sensoren, als Module anzeigen') : t('simulatedSensor', { sensor: headName(heads.find(head => head.key === item.keys[0])) }, '{sensor} · simulierte Werte'));
  }
  parent.append(section);
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (mode === 'map') renderMap(); }) : null;
  observer?.observe(viewport);
  localize();
  if (expanded) { showFloor(); setMode('map', null, false); }
  const clearSelection = () => { for (const item of selectable) item.setAttribute('aria-pressed', 'false'); };
  clearSelection.refresh = (options = {}) => {
    if (disposed) return;
    language = options.language ?? language; text = options.text ?? text;
    localize(); seen.clear(); update(); renderMap();
  };
  clearSelection.destroy = () => {
    if (disposed) return;
    disposed = true; clearInterval(timer); observer?.disconnect(); themeObserver?.disconnect(); section.remove();
    if (floorUrl) URL.revokeObjectURL(floorUrl);
  };
  return clearSelection;
}
