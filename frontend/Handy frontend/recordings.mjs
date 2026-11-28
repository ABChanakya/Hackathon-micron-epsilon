const materials = [
  ['white plastic', 'Weißer Kunststoff', '202609', '202622'],
  ['paper-black-and-white', 'Schwarz-weißes Papier', '203309', '203320'],
  ['black-metal', 'Schwarzes Metall', '203446', '203458'],
  ['white-stairs-plastic', 'Weißer Stufenkunststoff', '203713', '203725'],
  ['grey-stairs', 'Graues Stufenprofil', '203903', '203915'],
  ['Metal-stairs', 'Metall-Stufenprofil', '204002', '204014'],
];

const materialNames = new Map(materials.map(([key, name]) => [key, name]));

export const DEMO_RECORDINGS = materials.flatMap(([, fallbackName, median, unfiltered]) => [
  { file: 'rec_20261127_' + median, fallbackName, averaging: 'Median 9' },
  { file: 'rec_20261127_' + unfiltered, fallbackName, averaging: 'Ohne Mittelung' },
]);

export const RECORDINGS = [
  { id: 'plastic', ...DEMO_RECORDINGS[0] },
  { id: 'paper', ...DEMO_RECORDINGS[3] },
];

const errorDetails = new Map([
  ['1', 'Wert unter der Skalierungsgrenze'],
  ['2', 'Wert über der Skalierungsgrenze'],
  ['3', 'Zu viele Daten für die Übertragung'],
  ['4', 'Kein Messsignal erkannt'],
  ['5', 'Messsignal vor dem Messbereich'],
  ['6', 'Messsignal hinter dem Messbereich'],
  ['7', 'Messwert konnte nicht berechnet werden'],
  ['8', 'Sensorfehler'],
  ['9', 'Messsignal zu breit'],
  ['10', 'Laser ausgeschaltet'],
]);

export function describeError(code) {
  return errorDetails.get(code) ?? (code ? 'Messwert ungültig (Code ' + code + ')' : 'Messwert fehlt');
}

export function parseRecording(csv, meta) {
  const material = typeof meta?.notes === 'string'
    ? meta.notes.match(/(?:^|;)\s*material:\s*([^;]+)/i)?.[1].trim()
    : undefined;
  if (!meta?.info?.model || meta.info.unit !== 'mm'
      || !Number.isFinite(meta.info.smr_mm) || !material
      || !Number.isInteger(meta.samples) || !Number.isInteger(meta.errors)) {
    throw new Error('Metadaten fehlen oder passen nicht zum Aufzeichnungsformat.');
  }

  // The versioned ILD1900 files have unquoted numeric fields. dist_mm starts
  // at the measuring range. Use the metadata offset for distance from the face.
  const [heading, ...lines] = csv.trimEnd().split(/\r?\n/);
  const columns = heading.replace(/^\uFEFF/, '').split(',');
  // The recorded sensor clock is monotonic across USB batches.
  const timeColumn = columns.indexOf('sensor_ts_ms');
  const valueColumn = columns.indexOf('dist_mm');
  const errorColumn = columns.indexOf('error_code');
  if ([timeColumn, valueColumn, errorColumn].includes(-1) || lines.length !== meta.samples) {
    throw new Error('Die CSV-Datei enthält nicht die erwarteten Messzeilen.');
  }

  let firstTime;
  let min = Infinity;
  let max = -Infinity;
  let invalidCount = 0;
  const samples = lines.map((line, index) => {
    const fields = line.split(',');
    const rawTime = Number(fields[timeColumn]);
    if (fields.length !== columns.length || !fields[timeColumn].trim()
        || !Number.isFinite(rawTime)) {
      throw new Error('Ungültiges CSV-Format in Zeile ' + (index + 2) + '.');
    }
    firstTime ??= rawTime;
    const code = fields[errorColumn].trim();
    const rawValue = fields[valueColumn].trim();
    const value = !code && rawValue && Number.isFinite(Number(rawValue))
      ? Number(rawValue) + meta.info.smr_mm
      : null;
    if (value === null) {
      invalidCount += 1;
    } else {
      min = Math.min(min, value);
      max = Math.max(max, value);
    }
    return { time: (rawTime - firstTime) / 1_000, value, code };
  });
  const duration = samples.at(-1)?.time;
  if (!duration || samples.some((sample, index) => index > 0 && sample.time < samples[index - 1].time)
      || invalidCount !== meta.errors) {
    throw new Error('Zeitstempel oder Fehleranzahl stimmen nicht mit der Aufzeichnung überein.');
  }

  return {
    material: materialNames.get(material) ?? material,
    model: meta.info.model,
    serial: meta.info.serial,
    unit: meta.info.unit,
    samples,
    duration,
    invalidCount,
    min: Number.isFinite(min) ? min : null,
    max: Number.isFinite(max) ? max : null,
  };
}

async function readFile(url, read, request) {
  let response;
  try {
    response = await request(url);
  } catch {
    throw new Error(url.pathname.split('/').at(-1) + ' konnte nicht geladen werden.');
  }
  const fileName = url.pathname.split('/').at(-1);
  if (response.status === 404) throw new Error('Datei fehlt: ' + fileName + '.');
  if (!response.ok) throw new Error(fileName + ' konnte nicht geladen werden (HTTP ' + response.status + ').');
  try {
    return await read(response);
  } catch {
    throw new Error(fileName + ' konnte nicht gelesen werden.');
  }
}

export async function loadRecording(source, request = fetch) {
  const base = new URL('./recordings/' + source.file, import.meta.url).href;
  const [csv, metadata] = await Promise.all([
    readFile(new URL(base + '.csv'), response => response.text(), request),
    readFile(new URL(base + '.json'), response => response.json(), request),
  ]);
  return parseRecording(csv, metadata);
}

function sampleIndexAt(samples, time) {
  let lower = 0;
  let upper = samples.length - 1;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (samples[middle].time <= time) lower = middle;
    else upper = middle - 1;
  }
  return lower;
}

export function sampleAt(samples, time) {
  return samples[sampleIndexAt(samples, time)];
}

export function recordingWindow(recording, time, seconds) {
  const start = Math.max(0, time - seconds);
  const end = sampleIndexAt(recording.samples, time) + 1;
  let first = sampleIndexAt(recording.samples, start);
  if (recording.samples[first].time < start) first++;
  return {
    start,
    duration: seconds,
    endOfData: time,
    samples: recording.samples.slice(first, end),
  };
}

// Draw the extrema in each pixel column, in timestamp order. Separate every
// valid run so even short errors cannot be bridged by the downsampling.
export function chartData(recording, columns) {
  const { start = 0, duration, endOfData = start + duration } = recording;
  const segments = [];
  const gaps = [];
  let segment;
  let gap;
  let bucket;

  function flush() {
    if (!bucket) return;
    const { low, high } = bucket;
    if (low === high) segment.push(low);
    else if (low.time <= high.time) segment.push(low, high);
    else segment.push(high, low);
    bucket = null;
  }

  for (const sample of recording.samples) {
    if (sample.value === null) {
      flush();
      segment = null;
      if (!gap) {
        gap = { start: sample.time, end: endOfData };
        gaps.push(gap);
      }
      continue;
    }
    if (gap) {
      gap.end = sample.time;
      gap = null;
    }
    if (!segment) {
      segment = [];
      segments.push(segment);
    }
    const column = Math.min(columns - 1, Math.floor((sample.time - start) / duration * columns));
    if (bucket?.column !== column) {
      flush();
      bucket = { column, low: sample, high: sample };
    } else {
      if (sample.value < bucket.low.value) bucket.low = sample;
      if (sample.value > bucket.high.value) bucket.high = sample;
    }
  }
  flush();
  return { segments, gaps };
}

export class Playback {
  constructor(recording, { speed = 1, loop = true } = {}) {
    this.recording = recording;
    this.speed = speed;
    this.loop = loop;
    this.offset = 0;
    this.startedAt = null;
  }

  frame(now) {
    const elapsed = this.offset + (this.startedAt === null ? 0 : (now - this.startedAt) * this.speed);
    const { duration, samples } = this.recording;
    const ended = !this.loop && elapsed >= duration;
    const time = this.loop ? elapsed % duration : Math.min(duration, elapsed);
    return { time, sample: sampleAt(samples, time), ended, playing: this.startedAt !== null && !ended };
  }

  start(now) {
    const frame = this.frame(now);
    if (frame.playing) return;
    if (frame.ended) this.offset = 0;
    this.startedAt = now;
  }

  pause(now) {
    this.offset = this.frame(now).time;
    this.startedAt = null;
  }

  restart(now) {
    this.offset = 0;
    this.startedAt = now;
  }

  configure({ speed, loop }, now) {
    const frame = this.frame(now);
    this.offset = frame.time;
    this.startedAt = frame.playing ? now : null;
    this.speed = speed;
    this.loop = loop;
  }
}
