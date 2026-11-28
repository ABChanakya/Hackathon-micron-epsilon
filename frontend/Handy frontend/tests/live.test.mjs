import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { liveSample, sensorState } from '../live-data.mjs';

const file = (name) => readFile(new URL('../recordings/' + name, import.meta.url), 'utf8');
const meta = JSON.parse(await file('rec_20261127_203320.json'));
const rows = (await file('rec_20261127_203320.csv')).trim().split(/\r?\n/).slice(1);
const sensor = sensorState({ status: 'streaming', source: meta.source, info: meta.info });

test('PC measurement identifies live hardware, playback, simulator and disconnection', () => {
  assert.equal(sensor.model, meta.info.model);
  assert.equal(sensor.unit, meta.info.unit);
  assert.equal(sensor.sourceLabel, 'Sensor');
  assert.equal(sensorState({ status: 'streaming', source: 'sim', info: meta.info }).sourceLabel, 'Simulator');
  assert.equal(sensorState({ status: 'streaming', source: 'replay', info: meta.info }).sourceLabel, 'Wiedergabe');
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

test('device check rejects unverified sources and inconsistent origins', () => {
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

test('the phone rejects out-of-range and red-LED values like the PC and uses absolute raw temperature', () => {
  const info = {model:'ILD1900-10', unit:'mm', smr_mm:20, range_mm:10};
  const distance = {status:'streaming', source:'serial-ild1900', info, t:1.2, current_valid:true, dist_from_face_mm:42, n:10};
  assert.equal(liveSample(distance, sensorState(distance)).value, null);
  assert.equal(liveSample({...distance, dist_from_face_mm:25, state_flags:{led:'red'}}, sensorState(distance)).value, null);
  const temp = {...distance, source:'thermo-uc', info:{model:'UCSF22-S3',unit:'°C',range_min:-50,range_max:900},
    value:2, raw_value:37.42, state_flags:{led:'red'}};
  assert.equal(liveSample(temp, sensorState(temp)).value, 37.42);
  assert.equal(liveSample({...temp, raw_value:999}, sensorState(temp)).value, null);
});
