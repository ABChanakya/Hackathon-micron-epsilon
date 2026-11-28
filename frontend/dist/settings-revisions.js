/** In-memory form drafts. Saved application and server state remain their own source of truth. */
export function createSettingsDraftStore() {
  const entries = new Map();
  const copy = value => structuredClone(value);
  const equal = (a, b) => Object.keys(a).length === Object.keys(b).length && Object.keys(a).every(key => Object.hasOwn(b, key) && a[key] === b[key]);
  return {
    ensure(key, saved) {
      const entry = entries.get(key);
      if (!entry || equal(entry.saved, entry.value)) entries.set(key, { saved: copy(saved), value: copy(saved) });
      return copy(entries.get(key).value);
    },
    set(key, value) { const entry = entries.get(key); if (entry) entry.value = copy(value); },
    value(key) { return entries.has(key) ? copy(entries.get(key).value) : null; },
    dirty(key) { const entry = entries.get(key); return Boolean(entry && !equal(entry.saved, entry.value)); },
    anyDirty() { return [...entries.keys()].some(key => this.dirty(key)); },
    discard(key) { const entry = entries.get(key); if (entry) entry.value = copy(entry.saved); },
    clear(key) { entries.delete(key); },
    clearAll() { entries.clear(); },
  };
}

export function readSettingsForm(form) {
  return Object.fromEntries([...form.elements].filter(input => input.name && !['submit', 'button'].includes(input.type)).map(input => [input.name, input.type === 'checkbox' ? input.checked : input.value]));
}

export function restoreSettingsForm(form, values) {
  if (!values) return;
  for (const input of form.elements) {
    if (!input.name || !Object.hasOwn(values, input.name)) continue;
    if (input.type === 'checkbox') { if (input.checked !== values[input.name]) input.checked = values[input.name]; }
    else if (input.value !== values[input.name]) input.value = values[input.name];
  }
}

const number = value => String(value ?? '').trim() === '' ? NaN : Number(String(value).trim().replace(',', '.'));
export function validateProfileFields(values, sensor) {
  const errors = {};
  const lower = number(values.lower), upper = number(values.upper), target = number(values.target);
  if (!String(values.name || '').trim()) errors.name = 'Bitte gib einen Profilnamen ein.';
  for (const [key, value] of Object.entries({ lower, upper, target })) {
    if (!Number.isFinite(value)) errors[key] = 'Bitte gib eine gültige Zahl ein.';
    else if (value < sensor.rangeStart || value > sensor.rangeEnd) errors[key] = 'Der Wert liegt außerhalb des Messbereichs.';
  }
  if (Number.isFinite(lower) && Number.isFinite(upper) && lower >= upper) {
    errors.lower = 'Die untere Grenze muss kleiner als die obere Grenze sein.';
    errors.upper = errors.lower;
  } else if (Number.isFinite(target) && Number.isFinite(lower) && Number.isFinite(upper) && (target < lower || target > upper)) {
    errors.target = 'Der Sollwert muss zwischen den Sollgrenzen liegen.';
  }
  if (!sensor.rates.includes(number(values.rate))) errors.rate = 'Bitte wähle eine gültige Profilrate.';
  return { errors, value: { ...values, name: String(values.name || '').trim(), description: String(values.description || '').trim(), lower, upper, target, rate: number(values.rate) } };
}

export function validateProfileSettings(values, sensor) {
  const errors = {};
  const rate = number(values.rate), window = number(values.window);
  if (!sensor.rates.includes(rate)) errors.rate = 'Bitte wähle eine gültige Profilrate.';
  if (![10, 30, 60].includes(window)) errors.window = 'Bitte wähle ein gültiges Diagrammfenster.';
  return { errors, value: { rate, window } };
}

export function validateConnectionSettings(values) {
  const bridgeUrl = String(values.bridgeUrl || '').trim();
  try { const url = new URL(bridgeUrl); if (!['ws:', 'wss:'].includes(url.protocol) || !url.hostname) throw new Error(); }
  catch { return { errors: { bridgeUrl: 'Bitte gib eine gültige WebSocket-Adresse mit ws:// oder wss:// ein.' } }; }
  return { errors: {}, value: { bridgeUrl } };
}

// Mirrors backend/anomaly.py LIMITS; the backend still validates every submitted configuration.
export const ML_FIELD_LIMITS = Object.freeze({ sensitivity: [1.5, 100], consecutive: [1, 50], window_s: [.1, 10], warmup_s: [1, 600], cooldown_s: [0, 600], match_radius: [.1, 50], error_fraction: [1, 100] });
export function validateMlSettings(values) {
  const errors = {}, value = { enabled: Boolean(values.enabled), learn_online: Boolean(values.learn_online) };
  for (const [key, [min, max]] of Object.entries(ML_FIELD_LIMITS)) {
    const n = number(values[key]);
    if (!Number.isFinite(n) || n < min || n > max || key === 'consecutive' && !Number.isInteger(n)) errors[key] = key === 'consecutive' ? 'Bitte gib eine ganze Zahl im angegebenen Bereich ein.' : 'Bitte gib eine Zahl im angegebenen Bereich ein.';
    value[key] = key === 'error_fraction' ? n / 100 : n;
  }
  for (const key of ['reject_z', 'hard_min', 'hard_max']) {
    const raw = String(values[key] ?? '').trim();
    value[key] = raw === '' ? null : number(raw);
    if (raw !== '' && !Number.isFinite(value[key])) errors[key] = 'Bitte gib eine gültige Zahl ein.';
  }
  if (value.hard_min !== null && value.hard_max !== null && value.hard_min >= value.hard_max) errors.hard_min = errors.hard_max = 'Die untere Grenze muss kleiner als die obere Grenze sein.';
  if (value.reject_z !== null && value.reject_z <= value.sensitivity) errors.reject_z = 'Die Verwerfschwelle muss über der Meldeschwelle liegen.';
  value.error_file = String(values.error_file || '').trim();
  if (!value.error_file.endsWith('.jsonl')) errors.error_file = 'Die Fehlerdatei muss auf .jsonl enden.';
  return { errors, value };
}

export function mlSettingsValues(config) {
  const values = Object.fromEntries(Object.entries(config).map(([key, value]) => [key, typeof value === 'boolean' ? value : value === null ? '' : String(value)]));
  values.error_fraction = String(Math.round(config.error_fraction * 100));
  return values;
}

export function mlOperatingState(status) {
  if (!status) return 'Messserver nicht erreichbar';
  return { off: 'Erkennung ausgeschaltet', idle: 'Wartet auf Sensordaten', learning: 'Lernt den Normalzustand', watching: 'Überwacht das Signal', alert: 'Auffälligkeit erkannt', error: 'Ungültige Daten verworfen' }[status.state] || 'Wartet auf Sensordaten';
}

export function mlEventTime(value, locale = 'de-DE') {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT/.test(value)) return '—';
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
}
