import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveSample, sensorState } from '../live-data.mjs';

const file = (name) => readFile(new URL('../recordings/' + name, import.meta.url), 'utf8');
const meta = JSON.parse(await file('rec_20261127_203320.json'));
const rows = (await file('rec_20261127_203320.csv')).trim().split(/\r?\n/).slice(1);
const sensor = sensorState({ status: 'streaming', source: meta.source, info: meta.info });

test('live display distinguishes real hardware, playback, simulation and disconnected sensors', () => {
  assert.equal(sensor.model, meta.info.model);
  assert.equal(sensor.unit, meta.info.unit);
  for (const source of ['sim', 'replay']) {
    assert.equal(sensorState({ status: 'streaming', source, info: meta.info }).state, 'unavailable');
  }
  assert.equal(sensorState({ status: 'disconnected' }).label, 'Kein Sensor verbunden');
  assert.equal(sensorState({ status: 'error', error: 'Timeout' }).detail, 'Timeout');
});

test('live frames use the recorded absolute distance and clear stale distances on sensor errors', () => {
  const [t, , distance] = rows[0].split(',');
  const invalid = rows.find((row) => row.split(',')[3] === '4').split(',');
  const frame = {
    t: Number(t),
    status: 'streaming',
    source: meta.source,
    info: meta.info,
    dist_from_face_mm: Number(distance) + meta.info.smr_mm,
    current_valid: true,
  };
  assert.equal(liveSample(frame, sensor).value, 25.643005);
  assert.equal(liveSample({ ...frame, source: 'replay' }, sensor), null);
  assert.deepEqual(liveSample({
    ...frame, t: Number(invalid[0]), current_valid: false, last_error: { code: Number(invalid[3]) },
  }, sensor), { time: Number(invalid[0]), value: null, error: 'Kein Messsignal erkannt' });
});

test('device check: only verified, live, known devices reach the measurement elements', () => {
  const device = { family: 'ild1900', measures: 'distance', unit: 'mm', origin: 'hardware', live: true, verified: true, problems: [] };
  const status = { status: 'streaming', source: 'serial-ild1900', info: { model: 'ILD1900-10', unit: 'mm', serial: '1' }, device };
  const ok = sensorState(status);
  assert.equal(ok.family, 'ild1900');
  assert.equal(sensorState({ ...status, device: { ...device, verified: false, problems: ['unknown device model: Foo'] } }).label, 'Unbekanntes Gerät');
  assert.equal(sensorState({ ...status, device: { ...device, live: false, origin: 'replay' } }).state, 'unavailable');
  const frame = { source: 'serial-ild1900', status: 'streaming', t: 1, current_valid: true, dist_from_face_mm: 25, unit: 'mm', info: status.info, device };
  assert.equal(liveSample(frame, ok).value, 25);
  assert.equal(liveSample({ ...frame, device: { ...device, family: 'thermo_uc' } }, ok), null);
  assert.equal(liveSample({ ...frame, device: { ...device, verified: false } }, ok), null);
});
