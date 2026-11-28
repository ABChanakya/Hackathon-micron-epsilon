import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSlopeSeries } from '../dist/measurement-series.js';

const values = series => series.points.filter(point => point.value !== null).map(point => point.value);
const close = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-10, `${actual} != ${expected}`);

test('trend retains positive, negative and constant signs in measurement units per second', () => {
  for (const rate of [2.5, -3, 0]) {
    const points = [0, 0.2, 0.55, 0.9].map(t => ({ t, value: 25 + rate * t }));
    const slope = buildSlopeSeries(points);
    assert.equal(slope.unit, 'mm/s');
    assert.equal(slope.available, true);
    for (const value of values(slope)) close(value, rate);
    assert.equal(slope.points[0].value, null);
  }
});

test('regression handles irregular sampling and uses the whole trailing window', () => {
  const slope = buildSlopeSeries([{ t: 0, value: 0 }, { t: 0.2, value: 1 }, { t: 0.9, value: 0.9 }]);
  const times = [0, 0.2, 0.9], readings = [0, 1, 0.9];
  const meanT = times.reduce((a, b) => a + b) / 3;
  const meanV = readings.reduce((a, b) => a + b) / 3;
  const expected = times.reduce((sum, t, i) => sum + (t - meanT) * (readings[i] - meanV), 0) /
    times.reduce((sum, t) => sum + (t - meanT) ** 2, 0);
  close(slope.points.at(-1).value, expected);
  assert.notEqual(slope.points.at(-1).value, (0.9 - 1) / (0.9 - 0.2));
});

test('slope is invariant to tare and supports temperature units', () => {
  const points = [{ t: 0, value: 100 }, { t: 0.5, value: 102 }, { t: 1, value: 104 }];
  const untared = buildSlopeSeries(points, { sensorUnit: '°C' });
  const tared = buildSlopeSeries(points, { sensorUnit: '°C', zeroOffset: 100 });
  assert.deepEqual(tared, untared);
  assert.equal(tared.unit, '°C/s');
  close(tared.points.at(-1).value, 4);
});

test('a slope needs at least two distinct timestamps', () => {
  for (const points of [[], [{ t: 0, value: 1 }], [{ t: 0, value: 1 }, { t: 0, value: 2 }]]) {
    assert.equal(buildSlopeSeries(points).available, false);
  }
});

test('the trailing regression forgets older movement', () => {
  const slope = buildSlopeSeries([
    { t: 0, value: 0 }, { t: 0.5, value: 100 }, { t: 1.5, value: 103 }, { t: 2, value: 104 },
  ]);
  close(slope.points.find(point => point.t === 1.5).value, 3);
  close(slope.points.at(-1).value, 2);
});

test('invalid samples and long gaps split paths and reset regression', () => {
  const points = [
    { t: 0, value: 0 }, { t: 0.2, value: 1 },
    { t: 0.3, value: null },
    { t: 0.4, value: 20 }, { t: 0.6, value: 21 },
    { t: 3, value: 100 }, { t: 3.2, value: 101 },
  ];
  const slope = buildSlopeSeries(points);
  assert.equal(slope.points.find(point => point.t === 0.4).value, null);
  assert.ok(slope.points.filter(point => point.t === 3).every(point => point.value === null));
  for (const value of values(slope)) close(value, 5);
});

test('breakBefore separates regression segments without inserting a false jump', () => {
  const points = [
    { t: 0, value: 0, breakBefore: true },
    { t: 0.2, value: 1 },
    { t: 0.4, value: 100, breakBefore: true },
    { t: 0.6, value: 101 },
  ];
  const slope = buildSlopeSeries(points);
  for (const value of values(slope)) close(value, 5);
  assert.ok(slope.points.filter(point => point.t === 0.4).every(point => point.value === null));
});

test('quality flags and malformed timestamps cannot connect a stale segment', () => {
  for (const bad of [{ valid: false }, { current_valid: false }, { connected: false }, { error: 'signal' }, { value: NaN }]) {
    const result = buildSlopeSeries([{ t: 0, value: 1 }, { t: 0.1, value: 2, ...bad }, { t: 0.2, value: 100 }, { t: 0.3, value: 101 }]);
    close(values(result).at(-1), 10);
    assert.equal(result.points.find(point => point.t === 0.2).value, null);
  }
  const result = buildSlopeSeries([{ t: 0, value: 1 }, { t: NaN, value: 2 }, { t: 0.2, value: 100 }]);
  assert.equal(result.available, false);
});

test('disconnected or currently invalid streams expose no stale graph values', () => {
  const points = [{ t: 0, value: 1 }, { t: 0.2, value: 2 }];
  for (const options of [{ connected: false }, { valid: false }]) {
    const slope = buildSlopeSeries(points, options);
    assert.deepEqual(slope.points, []);
    assert.equal(slope.available, false);
  }
});

test('the visible time range excludes old values but can warm up its first slope', () => {
  const points = [0, 0.5, 1, 1.5, 2].map(t => ({ t, value: 20 + 2 * t }));
  const slope = buildSlopeSeries(points, { start: 1, end: 1.5 });
  assert.deepEqual(slope.points.map(point => point.t), [1, 1.5]);
  for (const value of values(slope)) close(value, 2);
});

test('building the slope series does not mutate recordings', () => {
  const points = [{ t: 0, value: 1 }, { t: 0.2, value: 2 }];
  const original = structuredClone(points);
  buildSlopeSeries(points, { start: 0.1, zeroOffset: 50 });
  assert.deepEqual(points, original);
});
