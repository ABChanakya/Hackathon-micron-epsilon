import test from 'node:test';
import assert from 'node:assert/strict';
import { createFactorySim, gridLayout, worstAlarm } from '../fabrikplan/fabrik-sim.mjs';

test('the module grid keeps the order of the plan: right stays right, top stays top', () => {
  const plan = [
    { name: 'bottom left', x: 100, y: 400 }, { name: 'top right', x: 1200, y: 80 },
    { name: 'top left', x: 120, y: 90 }, { name: 'middle', x: 650, y: 300 },
  ];
  const { cells, cols, rows } = gridLayout(plan);
  const at = name => cells.find(cell => cell.item.name === name);
  assert.equal(at('top left').row, 0);
  assert.equal(at('top right').row, 0);
  assert.equal(at('bottom left').row, at('middle').row + 1);
  assert.equal(at('top left').col, at('bottom left').col, 'close x positions share a column');
  assert.ok(at('top right').col > at('middle').col && at('middle').col > at('top left').col);
  assert.equal(cols, 3);
  assert.equal(rows, 3);
});

test('the three stations of the fictional plan form one row of three boxes in plan order', () => {
  const { cells, cols, rows } = gridLayout([{ n: 'Material', x: 407, y: 328 }, { n: 'Bearbeitung', x: 662, y: 328 }, { n: 'QK', x: 1053, y: 328 }]);
  assert.deepEqual(cells.map(cell => [cell.item.n, cell.row, cell.col]), [['Material', 0, 0], ['Bearbeitung', 0, 1], ['QK', 0, 2]]);
  assert.deepEqual([cols, rows], [3, 1]);
});

test('two modules at the same place sit side by side instead of on top of each other', () => {
  const { cells } = gridLayout([{ x: 100, y: 100 }, { x: 105, y: 102 }]);
  assert.notEqual(cells[0].col, cells[1].col);
});

test('a simulated fault spikes the value out of its limits, blinks while active and stays latched until acknowledged', () => {
  const sim = createFactorySim([{ key: 'a', unit: 'mm' }, { key: 't', unit: '°C' }]);
  const state = (time, key) => sim.read(time).find(r => r.key === key);
  assert.equal(state(10, 'a').alarm, 'ok');
  assert.equal(state(10, 't').alarm, 'ok');
  const key = sim.injectFault(20);
  assert.equal(key, 'a', 'faults walk through the sensors in turn');
  const spike = state(22, 'a');
  assert.equal(spike.alarm, 'active');
  assert.ok(spike.value > spike.upper, 'the value spikes above the upper limit');
  sim.acknowledge('a');
  assert.equal(state(22.5, 'a').alarm, 'active', 'an active alarm cannot be acknowledged away');
  assert.equal(state(30, 'a').alarm, 'latched', 'after the spike the alarm stays until someone acknowledges it');
  sim.acknowledge('a');
  assert.equal(state(31, 'a').alarm, 'ok');
  assert.equal(sim.injectFault(40), 't');
  assert.equal(state(42, 't').alarm, 'active', 'the thermometer spikes too');
  assert.ok(state(42, 't').value > 25.5);
});

test('a module shows its worst sensor', () => {
  assert.equal(worstAlarm(['ok', 'latched']), 'latched');
  assert.equal(worstAlarm(['latched', 'active', 'ok']), 'active');
  assert.equal(worstAlarm(['ok', 'ok']), 'ok');
});
