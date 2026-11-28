import test from 'node:test';
import assert from 'node:assert/strict';
import { DEMO_DATASETS, DEMO_RATE, demoWindow } from '../demo.mjs';
import { DISPLAY_RATE, makeDemoPoints, createInitialState } from '../../dist/data.js';

test('the only mobile demo uses the standard desktop sensor and demo signal', () => {
  assert.equal(DEMO_DATASETS.length, 1);
  assert.equal(DEMO_RATE, DISPLAY_RATE);
  const dataset = DEMO_DATASETS[0];
  const desktop = createInitialState();
  assert.equal(dataset.model, desktop.sensorModel);
  assert.equal(dataset.unit, desktop.profiles[0].unit);
  assert.equal(dataset.lower, desktop.profiles[0].lower);
  assert.equal(dataset.upper, desktop.profiles[0].upper);
  const chart = demoWindow(dataset, 73.6);
  const points = makeDemoPoints(73.6).filter(({ t }) => t >= chart.start);
  assert.deepEqual(chart.samples, points.map(({ t, value }) => ({ time: t, value })));
});

test('the demo starts with a 30-second axis and slides forward without looping', () => {
  const dataset = DEMO_DATASETS[0];
  const initial = demoWindow(dataset, 0);
  assert.equal(initial.start, 0);
  assert.equal(initial.duration, 30);
  assert.deepEqual(initial.samples, [{ time: 0, value: 25 }]);

  const filling = demoWindow(dataset, 10.3);
  assert.equal(filling.start, 0);
  assert.equal(filling.samples.at(-1).time, 10.2);

  const rolling = demoWindow(dataset, 35);
  assert.equal(rolling.start, 5);
  assert.equal(rolling.duration, 30);
  assert.equal(rolling.samples[0].time, 5);
  assert.equal(rolling.samples.at(-1).time, 35);

  const resumed = demoWindow(dataset, 125.1);
  assert.equal(resumed.start, 95.1);
  assert.equal(resumed.samples[0].time, 95.2);
  assert.equal(resumed.samples.at(-1).time, 125);
});
