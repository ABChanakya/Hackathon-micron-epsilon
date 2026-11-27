export const SENSOR = Object.freeze({
  model: 'optoNCDT 1420-25', rangeStart: 25, rangeEnd: 50, range: 25,
  rates: [250, 500, 1000, 2000, 4000, 8000], interface: 'RS422 · IF2001/USB',
});

const STORAGE_KEY = 'micro-epsilon-monitor-v1';
export const DISPLAY_RATE = 5;
export const generateId = (prefix = 'item') => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`}`;
const clone = value => structuredClone(value);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = value => Math.round(value * 1e6) / 1e6;

export function formatDuration(seconds) {
  const s = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(s / 60);
  return `${String(minutes).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

export function makeDemoPoints(duration = 60, offset = 0, phase = 0, target = 37.5) {
  const count = Math.max(0, Math.floor(duration * DISPLAY_RATE));
  return Array.from({ length: count + 1 }, (_, i) => {
    const t = i / DISPLAY_RATE;
    const signal = Math.sin(t * 1.23 + phase) * 0.011 + Math.sin(t * 4.7 + phase) * 0.003 + Math.sin(t * 0.31) * 0.004;
    return { t, value: round(target + offset + signal) };
  });
}

function makeProfile(id, name, description, target, tolerance, rate) {
  return {
    id, name, description, target, lower: round(target - tolerance), upper: round(target + tolerance),
    rate, unit: 'mm', window: 30, learnedLower: round(target - tolerance), learnedUpper: round(target + tolerance),
    version: 1, history: [], learning: true,
  };
}

export function createInitialState() {
  const profiles = [
    makeProfile('distance', 'Abstand prüfen', 'Abstand zu einer Oberfläche überwachen.', 37.5, 0.05, 2000),
    makeProfile('runout', 'Rundlauf beobachten', 'Kleine Bewegungen und Schwankungen vergleichen.', 37.5, 0.1, 4000),
    makeProfile('position', 'Position kontrollieren', 'Wiederkehrende Bauteilpositionen prüfen.', 38, 0.15, 1000),
  ];
  const now = Date.now();
  const recordings = [
    { name: 'Abstand · Referenz', duration: 60, offset: 0, phase: 0, ago: 3600000,
      markers: [{ id: 'reference-marker', t: 14.2, note: 'Referenzposition erreicht' }] },
    { name: 'Abstand · Versuch 02', duration: 60, offset: 0.009, phase: 0.35, ago: 1800000,
      markers: [{ id: 'part-marker', t: 18.4, note: 'Bauteil gewechselt' }, { id: 'heat-marker', t: 39.2, note: 'Erwärmung gestartet' }] },
    { name: 'Position · Kontrolllauf', duration: 45, offset: 0.003, phase: 1.3, ago: 900000,
      markers: [{ id: 'position-marker', t: 12, note: 'Position bestätigt' }], profileIndex: 2 },
  ].map((seed, index) => {
    const profile = clone(profiles[seed.profileIndex ?? 0]);
    return {
      id: `demo-run-${index + 1}`, name: seed.name, createdAt: new Date(now - seed.ago).toISOString(),
      duration: seed.duration, source: 'demo', sensor: SENSOR.model, profile,
      points: makeDemoPoints(seed.duration, seed.offset, seed.phase, profile.target), markers: seed.markers,
      feedback: [], parameterHistory: [], storage: 'Browser · lokal', displayRate: DISPLAY_RATE,
    };
  });
  return { profiles, activeProfileId: profiles[0].id, recordings,
    settings: { rate: 2000, averaging: 4, output: 'rs422' }, setupComplete: false };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createInitialState();
    const state = JSON.parse(raw);
    if (!Array.isArray(state.profiles) || !state.profiles.length || !Array.isArray(state.recordings) ||
        !state.profiles.some(profile => profile.id === state.activeProfileId)) throw new Error('invalid state');
    return state;
  } catch {
    throw new Error('Die lokalen Daten konnten nicht gelesen werden. Prüfe die Browser-Speichereinstellungen.');
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    throw new Error('Speichern fehlgeschlagen. Der lokale Browser-Speicher ist voll oder nicht verfügbar. Exportiere deine Messung und versuche es erneut.');
  }
  return state;
}

export function acceptFeedback(profile, value, accepted, note = '', t = 0) {
  if (!finite(value)) throw new Error('Der Messwert ist ungültig.');
  const next = clone(profile);
  const previousLower = next.learnedLower ?? next.lower;
  const previousUpper = next.learnedUpper ?? next.upper;
  if (accepted && next.learning) {
    next.learnedLower = round(Math.max(SENSOR.rangeStart, Math.min(previousLower, value - 0.005)));
    next.learnedUpper = round(Math.min(SENSOR.rangeEnd, Math.max(previousUpper, value + 0.005)));
  } else {
    next.learnedLower = previousLower;
    next.learnedUpper = previousUpper;
  }
  const changed = next.learnedLower !== previousLower || next.learnedUpper !== previousUpper;
  if (changed) next.version += 1;
  const event = {
    id: generateId('feedback'), type: 'feedback', t, value, accepted: Boolean(accepted), note: String(note),
    at: new Date().toISOString(), version: next.version, previousLower, previousUpper,
    nextLower: next.learnedLower, nextUpper: next.learnedUpper, changed,
    reason: accepted ? (next.learning ? 'Messwert als akzeptabel bewertet.' : 'Bewertung gespeichert; Lernen ist pausiert.') : 'Messwert als nicht akzeptabel bewertet.',
  };
  next.history = [...(next.history ?? []), clone(event)];
  return { profile: next, event };
}

function adjustmentEvent(profile, type, lower, upper, reason, targetId) {
  const next = clone(profile);
  const previousLower = next.learnedLower ?? next.lower;
  const previousUpper = next.learnedUpper ?? next.upper;
  const changed = lower !== previousLower || upper !== previousUpper;
  next.learnedLower = lower;
  next.learnedUpper = upper;
  if (changed) next.version += 1;
  next.history = [...(next.history ?? []), {
    id: generateId(type), type, at: new Date().toISOString(), version: next.version,
    previousLower, previousUpper, nextLower: lower, nextUpper: upper, changed, reason,
    ...(targetId ? { targetId } : {}),
  }];
  return next;
}

export function undoLearning(profile) {
  const history = profile.history ?? [];
  // Editing the specification starts a new learning baseline; undo must stay in it.
  const baseline = history.findLastIndex(item => item.type === 'profile');
  const current = history.slice(baseline + 1);
  const reverted = new Set(current.filter(item => item.type === 'undo').map(item => item.targetId));
  const last = [...current].reverse().find(item => item.changed && ['feedback', 'reset'].includes(item.type) && !reverted.has(item.id));
  if (!last) return clone(profile);
  return adjustmentEvent(profile, 'undo', last.previousLower, last.previousUpper, 'Letzte Lernanpassung rückgängig gemacht.', last.id);
}

export function resetLearning(profile) {
  return adjustmentEvent(profile, 'reset', profile.lower, profile.upper, 'Lernschwellen auf die ursprünglichen Profilgrenzen zurückgesetzt.');
}

export function statistics(points) {
  const values = points.map(point => point.value).filter(finite);
  if (!values.length) return { count: 0, min: null, max: null, mean: null, span: null, standardDeviation: null };
  const min = values.reduce((a, b) => Math.min(a, b), Infinity);
  const max = values.reduce((a, b) => Math.max(a, b), -Infinity);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / values.length;
  return { count: values.length, min, max, mean, span: max - min, standardDeviation: Math.sqrt(variance) };
}

export function slicePoints(recording, start = 0, end = recording.duration) {
  if (!finite(start) || !finite(end) || start < 0 || end > recording.duration || end <= start) {
    throw new Error('Wähle einen gültigen Zeitraum innerhalb der Aufzeichnung.');
  }
  return recording.points.filter(point => point.t >= start && point.t <= end && finite(point.value));
}

function safeFilename(name) {
  return String(name).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'Messung';
}

function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return { filename };
}

export function exportRecordingCSV(recording) {
  const cell = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const offset = recording.zeroOffset ?? 0;
  const rows = [['type', 'time_s', 'raw_distance_mm', 'display_distance_mm', 'note', 'accepted', 'parameter_version']];
  for (const point of recording.points) rows.push(['measurement', point.t, point.value, round(point.value - offset), '', '', point.version ?? recording.profileAtStart?.version ?? recording.profile.version]);
  for (const marker of recording.markers ?? []) rows.push(['marker', marker.t, '', '', marker.note, '', '']);
  for (const event of recording.feedback ?? []) rows.push(['feedback', event.t, event.value, round(event.value - offset), event.note, event.accepted, event.version]);
  const metadata = `# ${recording.name}\n# Sensor: ${recording.sensor}\n# Quelle: ${recording.source === 'demo' ? 'Demo' : recording.source}\n# Darstellung: ${recording.displayRate ?? DISPLAY_RATE} Werte/s; Profil-Messrate: ${recording.profile.rate} Hz\n# Anzeige-Nullpunkt: ${offset} mm; raw_distance_mm bleibt unverändert\n`;
  const csv = '\uFEFF' + metadata + rows.map(row => row.map(cell).join(',')).join('\r\n');
  return download(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `${safeFilename(recording.name)}.csv`);
}

export function exportReportPDF(recording, { start = 0, end = recording.duration } = {}) {
  const points = slicePoints(recording, Number(start), Number(end));
  if (!points.length) throw new Error('Im ausgewählten Zeitraum sind keine Messwerte vorhanden.');
  const PDF = globalThis.jspdf?.jsPDF;
  if (!PDF) throw new Error('Der PDF-Export ist noch nicht geladen. Bitte erneut versuchen.');
  const doc = new PDF({ unit: 'mm', format: 'a4', compress: true });
  const p = recording.profileAtStart ?? recording.profile;
  const learningAt = time => {
    const snapshot = { lower: p.learnedLower ?? p.lower, upper: p.learnedUpper ?? p.upper, version: p.version };
    for (const event of recording.parameterHistory ?? []) {
      const appliedT = event.appliedT ?? event.t;
      if (finite(appliedT) && appliedT <= time && event.changed !== false) {
        snapshot.lower = event.nextLower;
        snapshot.upper = event.nextUpper;
        snapshot.version = event.version;
      }
    }
    return snapshot;
  };
  const initialLearning = learningAt(Number(start));
  const finalLearning = learningAt(Number(end));
  const summary = statistics(points);
  const ink = [36, 31, 45];
  const muted = [101, 88, 111];
  const copper = [158, 68, 41];
  const paper = [246, 244, 242];
  const corridor = [232, 230, 233];
  const rule = [209, 204, 213];
  const text = (value, x, y, size = 10, color = ink, options) => {
    doc.setFontSize(size);
    doc.setTextColor(...color);
    doc.text(String(value), x, y, options);
  };
  const decimal = value => Number(value).toLocaleString('de-DE', { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const mm = value => `${decimal(value)} mm`;
  doc.setFont('helvetica', 'bold');
  text('MICRO-EPSILON / SENSOR MONITOR', 18, 18, 9, muted);
  doc.setDrawColor(...rule);
  doc.setLineWidth(0.25);
  doc.line(18, 23, 192, 23);
  doc.setDrawColor(...copper);
  doc.setLineWidth(0.65);
  doc.line(18, 23, 42, 23);
  text('Messbericht', 18, 36, 24);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(12);
  const nameLines = doc.splitTextToSize(recording.name, 174);
  nameLines.forEach((line, index) => text(line, 18, 43 + index * 5, 12));
  const nameExtra = (nameLines.length - 1) * 5;
  text(`${recording.sensor}  |  ${new Date(recording.createdAt).toLocaleString('de-DE')}`, 18, 51 + nameExtra, 9, muted);
  doc.setFontSize(9);
  const profileLines = doc.splitTextToSize(`Zeitraum: ${formatDuration(start)} - ${formatDuration(end)}  |  Profil: ${p.name}`, 174);
  profileLines.forEach((line, index) => text(line, 18, 58 + nameExtra + index * 4, 9, muted));
  const headerExtra = nameExtra + (profileLines.length - 1) * 4;
  const isDemo = recording.source === 'demo';
  const source = isDemo ? 'Demo · simulierte Messwerte' : recording.source === 'sensor' ? 'Sensor · Messbrücke' : recording.source;
  text(`Quelle: ${source}`, 18, 65 + headerExtra, 9, isDemo ? copper : muted);

  const x = 30, y = 78 + headerExtra, width = 160, height = 60;
  const low = Math.min(summary.min, p.lower, initialLearning.lower, finalLearning.lower);
  const high = Math.max(summary.max, p.upper, initialLearning.upper, finalLearning.upper);
  const padding = Math.max((high - low) * 0.18, 0.01);
  const ymin = low - padding, ymax = high + padding;
  const px = time => x + ((time - start) / (end - start)) * width;
  const py = value => y + height - ((value - ymin) / (ymax - ymin)) * height;
  doc.setFillColor(...paper);
  doc.rect(x, y, width, height, 'F');
  doc.setFillColor(...corridor);
  doc.rect(x, py(p.upper), width, py(p.lower) - py(p.upper), 'F');
  doc.setDrawColor(...rule);
  doc.setLineWidth(0.2);
  for (let tick = 0; tick <= 4; tick++) {
    const value = ymin + (ymax - ymin) * tick / 4;
    const tickY = py(value);
    doc.line(x, tickY, x + width, tickY);
    text(decimal(value), x - 2.5, tickY + 0.85, 7, muted, { align: 'right' });
  }
  doc.setDrawColor(...muted);
  doc.setLineDashPattern([1, 1], 0);
  for (const value of [p.lower, p.target, p.upper]) {
    doc.line(x, py(value), x + width, py(value));
  }
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(...copper);
  doc.setLineWidth(0.45);
  if (points.length === 1) {
    doc.setFillColor(...copper);
    doc.circle(px(points[0].t), py(points[0].value), 0.6, 'F');
  }
  for (let i = 1; i < points.length; i++) doc.line(px(points[i - 1].t), py(points[i - 1].value), px(points[i].t), py(points[i].value));
  text(formatDuration(start), x, y + height + 6, 8, muted);
  text(formatDuration(end), x + width, y + height + 6, 8, muted, { align: 'right' });
  text('Abstand / mm', x, y - 4, 8, muted);
  text('Messwert', x + width, y - 4, 8, copper, { align: 'right' });

  let cursor = 153 + headerExtra;
  const line = (label, value) => { text(label, 18, cursor, 9, muted); text(value, 83, cursor, 9); cursor += 6; };
  line('Sollwert / Sollgrenzen', `${mm(p.target)}  /  ${mm(p.lower)} - ${mm(p.upper)}`);
  line('Auswertungsgrenzen zu Beginn', `${mm(initialLearning.lower)} - ${mm(initialLearning.upper)}  (Version ${initialLearning.version})`);
  if (finalLearning.version !== initialLearning.version) {
    line('Auswertungsgrenzen am Ende', `${mm(finalLearning.lower)} - ${mm(finalLearning.upper)}  (Version ${finalLearning.version})`);
  }
  line('Profilrate / Einheit', `${p.rate} Hz / ${p.unit ?? 'mm'}`);
  if (recording.zeroOffset) line('Anzeige-Nullpunkt', `${mm(recording.zeroOffset)} (Bericht mit Absolutwerten)`);
  line('Minimum / Maximum', `${mm(summary.min)} / ${mm(summary.max)}`);
  line('Mittelwert / Spannweite', `${mm(summary.mean)} / ${mm(summary.span)}`);
  line('Messwerte im Zeitraum', `${summary.count} (${recording.displayRate ?? DISPLAY_RATE} angezeigte Werte/s)`);

  const ensureSpace = amount => { if (cursor + amount > 274) { doc.addPage(); cursor = 23; } };
  const paragraph = (value, color = ink) => {
    const lines = doc.splitTextToSize(String(value), 174);
    for (const part of lines) { ensureSpace(5); text(part, 18, cursor, 9, color); cursor += 5; }
    cursor += 2;
  };
  const section = title => {
    ensureSpace(22);
    doc.setDrawColor(...rule);
    doc.setLineWidth(0.2);
    doc.line(18, cursor, 192, cursor);
    cursor += 5;
    doc.setFont('helvetica', 'bold');
    text(title, 18, cursor, 10);
    doc.setFont('helvetica', 'normal');
    cursor += 6;
  };
  section('Notizen');
  const markers = (recording.markers ?? []).filter(item => item.t >= start && item.t <= end);
  markers.length ? markers.forEach(item => paragraph(`${formatDuration(item.t)} - ${item.note}`)) : paragraph('Keine Notizen in diesem Zeitraum.', muted);
  section('Bewertungen');
  const feedback = (recording.feedback ?? []).filter(item => item.t >= start && item.t <= end);
  feedback.length ? feedback.forEach(item => paragraph(`${formatDuration(item.t)} - ${mm(item.value)} - ${item.accepted ? 'Akzeptabel' : 'Nicht akzeptabel'}${item.note ? ': ' + item.note : ''}`)) : paragraph('Keine Bewertungen im gewählten Zeitraum.', muted);
  section('Parameteränderungen');
  const changes = (recording.parameterHistory ?? []).filter(item => {
    const appliedT = item.appliedT ?? item.t;
    return finite(appliedT) && appliedT >= start && appliedT <= end;
  });
  changes.length ? changes.forEach(item => paragraph(`${formatDuration(item.appliedT ?? item.t)} - Version ${item.version}: ${mm(item.previousLower)} / ${mm(item.previousUpper)} -> ${mm(item.nextLower)} / ${mm(item.nextUpper)}. ${item.reason ?? ''}`)) : paragraph('Keine Parameteränderungen im gewählten Zeitraum.', muted);
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page++) {
    doc.setPage(page);
    doc.setDrawColor(...rule);
    doc.setLineWidth(0.2);
    doc.line(18, 282, 192, 282);
    text('MICRO-EPSILON / MESSBERICHT', 18, 287, 8, muted);
    text(`${page} / ${pages}`, 192, 287, 8, muted, { align: 'right' });
  }
  const filename = `${safeFilename(recording.name)}-Messbericht.pdf`;
  doc.save(filename);
  return { filename };
}
