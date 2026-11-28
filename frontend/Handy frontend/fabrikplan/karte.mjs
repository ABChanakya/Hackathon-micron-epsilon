const width = 1400;
const height = 505;
const zoomLevels = [1, 1.6, 2.55, 3.8, 5];
const splitZoom = zoomLevels[2];
const detailZoom = zoomLevels[3];
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

export function mountFactoryPlan(parent, { selectSensor }) {
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
          <div class="factory-zoom" role="group" aria-label="Kartenzoom">
            <button type="button" data-zoom="out" aria-label="Verkleinern">−</button>
            <output aria-label="Kartenzoom">100 %</output>
            <button type="button" data-zoom="in" aria-label="Vergrößern">+</button>
            <button type="button" data-zoom="reset">Gesamtansicht</button>
          </div>
        </div>
        <div class="factory-map" role="group" aria-label="Hallenplan und Sensorpunkte" aria-describedby="factory-hint" tabindex="0">
          <img class="factory-floor" alt="" draggable="false">
          <svg class="factory-links" aria-hidden="true"></svg>
          <div class="factory-markers"></div>
        </div>
        <p class="detail-meta factory-hint" id="factory-hint">Gruppensymbol antippen zum Hineinzoomen. Karte ziehen oder per Pfeiltasten verschieben.</p>
      </section>
    </div>`;
  const find = (selector) => section.querySelector(selector);
  const toggle = find('.factory-toggle');
  const content = find('.factory-content');
  const viewport = find('.factory-map');
  const floor = find('.factory-floor');
  const links = find('.factory-links');
  const markers = find('.factory-markers');
  const zoomOutput = find('output');
  const zoomOut = find('[data-zoom="out"]');
  const zoomIn = find('[data-zoom="in"]');
  const camera = { zoom: 1, x: width / 2, y: height / 2 };
  const groupButtons = [];
  const sensorButtons = [];
  const pointers = new Map();
  let active = null;
  let didDrag = false;
  let gesture;
  let modelRenderer;

  function clearSelection() {
    active?.setAttribute('aria-pressed', 'false');
    active = null;
  }

  for (const station of stations) {
    const paired = station.heads > 1;
    if (paired) {
      const group = marker(markers, station.name + ' · 2 Sensoren, Hallenbereich vergrößern', (event) => {
        if (didDrag && event.detail !== 0) return;
        camera.x = station.x;
        camera.y = station.y - 40;
        camera.zoom = splitZoom;
        render();
        sensorButtons.find(item => item.station === station).button.focus({ preventScroll: true });
      });
      group.querySelector('.factory-symbol').append('2');
      groupButtons.push({ button: group, x: station.x, y: station.y - 40 });
    }
    for (let index = 0; index < station.heads; index++) {
      const suffix = paired ? (index === 0 ? 'A' : 'B') : '';
      const sensor = { ...station, suffix };
      const label = [station.name, station.model, suffix && 'Messkopf ' + suffix, station.quantity].filter(Boolean).join(' · ');
      const button = marker(markers, label, (event) => {
        if (didDrag && event.detail !== 0) return;
        clearSelection();
        active = button;
        button.setAttribute('aria-pressed', 'true');
        selectSensor(sensor);
      });
      button.setAttribute('aria-pressed', 'false');
      button.setAttribute('aria-controls', 'recorded-view');
      const symbol = button.querySelector('.factory-symbol');
      const preview = document.createElement('img');
      preview.className = 'factory-model';
      preview.alt = '';
      preview.draggable = false;
      preview.hidden = true;
      symbol.prepend(preview);
      if (suffix) {
        const head = document.createElement('span');
        head.className = 'factory-head-letter';
        head.textContent = suffix;
        symbol.append(head);
      }
      const name = document.createElement('span');
      name.className = 'factory-marker-name';
      name.textContent = station.model;
      const info = document.createElement('span');
      info.className = 'factory-marker-info';
      info.textContent = station.name + ' · ' + station.quantity;
      button.append(name, info);
      const line = document.createElementNS(svgNS, 'line');
      const dot = document.createElementNS(svgNS, 'circle');
      dot.setAttribute('r', '3');
      links.append(line, dot);
      sensorButtons.push({ station, button, line, dot, paired, preview, angle: index,
        x: station.x + (paired ? (index === 0 ? -70 : 70) : 0),
        y: station.y - (paired && index === 0 ? 104 : 42),
        targetX: station.x + (paired ? (index === 0 ? -7 : 7) : 0) });
    }
  }

  function dimensions() {
    const w = viewport.clientWidth;
    const h = viewport.clientHeight;
    return { w, h, ratio: Math.min(w / width, h / height) * camera.zoom };
  }

  async function showModel(item) {
    if (item.modelRequested) return;
    item.modelRequested = true;
    try {
      modelRenderer ??= import('./modellansicht.mjs');
      const { sensorPreview } = await modelRenderer;
      item.preview.src = sensorPreview(item.station.mesh, item.angle);
      item.preview.hidden = false;
      item.button.toggleAttribute('data-has-model', true);
    } catch (error) {
      console.warn('Sensorvorschau konnte nicht geladen werden.', error);
    }
  }

  function render() {
    const { w, h, ratio } = dimensions();
    if (!ratio) return;
    const bound = (center, visible, size) => visible >= size ? size / 2
      : Math.max(visible / 2, Math.min(size - visible / 2, center));
    camera.x = bound(camera.x, w / ratio, width);
    camera.y = bound(camera.y, h / ratio, height);
    const left = w / 2 - camera.x * ratio;
    const top = h / 2 - camera.y * ratio;
    const px = x => left + x * ratio;
    const py = y => top + y * ratio;
    floor.style.width = width * ratio + 'px';
    floor.style.height = height * ratio + 'px';
    floor.style.transform = 'translate(' + left + 'px,' + top + 'px)';
    const split = camera.zoom >= splitZoom - .001;
    markers.dataset.level = camera.zoom >= detailZoom - .001 ? '2' : split ? '1' : '0';
    zoomOutput.value = Math.round(camera.zoom * 100) + ' %';
    zoomOut.setAttribute('aria-disabled', String(camera.zoom <= 1));
    zoomIn.setAttribute('aria-disabled', String(camera.zoom >= zoomLevels.at(-1)));

    function position(item, enabled) {
      const x = px(item.x), y = py(item.y);
      const visible = enabled && x >= 21 && x <= w - 21 && y >= 21 && y <= h - 21;
      item.button.hidden = !visible;
      item.button.style.left = x + 'px';
      item.button.style.top = y + 'px';
      return visible;
    }
    for (const group of groupButtons) position(group, !split);
    for (const item of sensorButtons) {
      const visible = position(item, split || !item.paired);
      if (visible && split) showModel(item);
      item.line.style.display = item.dot.style.display = visible ? '' : 'none';
      item.line.setAttribute('x1', px(item.x));
      item.line.setAttribute('y1', py(item.y));
      item.line.setAttribute('x2', px(item.targetX));
      item.line.setAttribute('y2', py(item.station.y));
      item.dot.setAttribute('cx', px(item.targetX));
      item.dot.setAttribute('cy', py(item.station.y));
    }
  }

  function stepZoom(increase) {
    const levels = increase ? zoomLevels : [...zoomLevels].reverse();
    const next = levels.find(zoom => increase ? zoom > camera.zoom + .001 : zoom < camera.zoom - .001);
    if (next) { camera.zoom = next; render(); }
  }

  zoomIn.addEventListener('click', () => stepZoom(true));
  zoomOut.addEventListener('click', () => stepZoom(false));
  find('[data-zoom="reset"]').addEventListener('click', () => {
    Object.assign(camera, { zoom: 1, x: width / 2, y: height / 2 });
    render();
  });
  viewport.addEventListener('keydown', (event) => {
    if (event.key === '+' || event.key === '-' || event.key === '−') {
      event.preventDefault();
      stepZoom(event.key === '+');
      return;
    }
    const offsets = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    const offset = offsets[event.key];
    if (!offset || camera.zoom === 1) return;
    event.preventDefault();
    const { ratio } = dimensions();
    camera.x += offset[0] * 55 / ratio;
    camera.y += offset[1] * 55 / ratio;
    render();
    if (document.activeElement.hidden) viewport.focus({ preventScroll: true });
  });

  function measureGesture() {
    const [first, second] = pointers.values();
    if (!first) return null;
    return second ? { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2,
      distance: Math.max(1, Math.hypot(first.x - second.x, first.y - second.y)) }
      : { x: first.x, y: first.y, distance: 0 };
  }
  function localPoint(event) {
    const bounds = viewport.getBoundingClientRect();
    return { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
  }
  viewport.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || pointers.size >= 2) return;
    if (!pointers.size) didDrag = false;
    pointers.set(event.pointerId, localPoint(event));
    gesture = measureGesture();
    if (pointers.size === 2) didDrag = true;
  });
  viewport.addEventListener('pointermove', (event) => {
    if (!pointers.has(event.pointerId)) return;
    pointers.set(event.pointerId, localPoint(event));
    const next = measureGesture();
    if (!didDrag && Math.hypot(next.x - gesture.x, next.y - gesture.y) < 6) return;
    didDrag = true;
    viewport.setPointerCapture(event.pointerId);
    viewport.toggleAttribute('data-panning', true);
    const before = dimensions();
    const worldX = camera.x + (gesture.x - before.w / 2) / before.ratio;
    const worldY = camera.y + (gesture.y - before.h / 2) / before.ratio;
    if (next.distance) {
      camera.zoom = Math.max(1, Math.min(zoomLevels.at(-1), camera.zoom * next.distance / gesture.distance));
    }
    const after = dimensions();
    camera.x = worldX - (next.x - after.w / 2) / after.ratio;
    camera.y = worldY - (next.y - after.h / 2) / after.ratio;
    gesture = next;
    render();
  });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture', 'pointerleave']) {
    viewport.addEventListener(type, (event) => {
      if (type === 'pointerleave' && viewport.hasPointerCapture(event.pointerId)) return;
      if (type === 'lostpointercapture' && event.target !== viewport) return;
      if (!pointers.delete(event.pointerId)) return;
      gesture = measureGesture();
      if (!gesture) viewport.removeAttribute('data-panning');
    });
  }
  toggle.addEventListener('click', () => {
    const open = content.hidden;
    content.hidden = !open;
    toggle.setAttribute('aria-expanded', String(open));
    toggle.firstElementChild.textContent = open ? 'Fabrikplan ausblenden' : 'Fabrikplan anzeigen';
    if (open) {
      if (!floor.getAttribute('src')) floor.src = new URL('./grundriss.svg', import.meta.url);
      render();
    }
  });
  parent.append(section);
  new ResizeObserver(render).observe(viewport);
  return clearSelection;
}
