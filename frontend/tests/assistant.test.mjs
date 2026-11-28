import test from 'node:test';
import assert from 'node:assert/strict';
import { askQuestion, explainError, explainChart, parseParameterCommand, checkProposal } from '../dist/assistant.js';

const context = () => ({
  sensor: { id: 'ild1900', model: 'optoNCDT 1900-10', unit: 'mm', rangeStart: 20, rangeEnd: 30 },
  source: 'demo', connected: true, valid: true, value: 25.01, window: 30, zeroOffset: 0,
  profile: { id: 'distance', name: 'Mein Profil', version: 3, target: 25, lower: 24.95, upper: 25.05, learnedLower: 24.94, learnedUpper: 25.06 },
});

test('all mock calls stay local and preserve the supplied context', async () => {
  const originalFetch = globalThis.fetch;
  let requests = 0;
  globalThis.fetch = () => { requests++; throw new Error('network access'); };
  try {
    const current = context(), before = structuredClone(current);
    const question = await askQuestion('Welchen Messbereich hat der Sensor?', current);
    const error = await explainError({ code: 'SIGNAL_INVALID', message: 'Ungültig' }, current);
    const chart = await explainChart({ count: 3, min: 25, max: 25.02, mean: 25.01, trend: 0, outside: 0, duration: 10 }, current);
    const command = await parseParameterCommand('Setze die obere Sollgrenze auf 25,1 mm', current);
    assert.equal(requests, 0);
    assert.deepEqual(current, before);
    assert.equal(question.topic, 'range');
    assert.equal(error.topic, 'signal');
    assert.equal(chart.topic, 'stable');
    assert.equal(command.status, 'proposal');
    question.context.profile.name = 'changed';
    assert.equal(current.profile.name, before.profile.name);
  } finally { globalThis.fetch = originalFetch; }
});

test('answers retain live/demo/replay provenance and never expose a retained invalid value as current', async () => {
  for (const source of ['live', 'demo', 'replay']) {
    const current = { ...context(), source, valid: false };
    for (const response of [await askQuestion('Was bedeutet State-LED?', current), await explainError({}, current)]) {
      assert.equal(response.context.source, source);
      assert.equal(response.context.value, null);
    }
  }
  assert.equal((await explainError({}, { ...context(), connected: false })).topic, 'connection');
  assert.equal((await explainError({ code: 'OUTSIDE_TOLERANCE' }, context())).topic, 'tolerance');
});

test('chart fixtures describe supplied statistics and distinguish empty, trend and boundary cases', async () => {
  for (const summary of [{}, { count: 0 }, { count: 5, min: 3, max: 1, mean: 2 }]) {
    const response = await explainChart(summary, context());
    assert.equal(response.topic, 'empty');
    assert.deepEqual([response.summary.min, response.summary.max, response.summary.mean, response.summary.trend], [null, null, null, null]);
  }
  const series = { count: 15, min: 24.9, max: 25.2, mean: 25.05, trend: 0.2, outside: 0, duration: 3 };
  assert.equal((await explainChart(series, context())).topic, 'rising');
  assert.equal((await explainChart({ ...series, trend: -0.2 }, context())).topic, 'falling');
  const outside = await explainChart({ ...series, outside: 2 }, context());
  assert.equal(outside.topic, 'outside');
  assert.equal(outside.summary.outside, 2);
  assert.equal(outside.summary.duration, 3);
});

test('German decimal commands produce a preview with an explicit target and original value', async () => {
  const current = context();
  const upper = await parseParameterCommand('Setze die obere Toleranzgrenze beim optoNCDT 1900-10 auf 25,10 mm.', current);
  assert.equal(upper.status, 'proposal');
  assert.deepEqual({ ...upper.proposal, id: 'id' }, {
    id: 'id', scope: 'profile', sensorId: 'ild1900', profileId: 'distance', expectedVersion: 3,
    parameterName: 'upper', oldValue: 25.05, newValue: 25.1, unit: 'mm',
  });
  assert.deepEqual(checkProposal(upper.proposal, current), { valid: true, reasonCode: 'ready' });
  assert.equal((await parseParameterCommand('Untere Sollgrenze auf 24.9', current)).proposal.parameterName, 'lower');
  assert.equal((await parseParameterCommand('Sollwert auf 25,01 mm', current)).proposal.newValue, 25.01);
});

test('temperature previews support negative values without accepting distance units', async () => {
  const current = context();
  current.sensor = { id: 'thermo_uc', model: 'thermoMETER UC-SF22-S3', unit: '°C', rangeStart: -50, rangeEnd: 900 };
  current.profile = { id: 'temperature', name: 'Kühlung', version: 1, target: -10, lower: -20, upper: 10 };
  const response = await parseParameterCommand('Setze die untere Grenze beim thermoMETER UC-SF22-S3 auf -25,5 °C', current);
  assert.equal(response.status, 'proposal');
  assert.equal(response.proposal.newValue, -25.5);
  assert.equal((await parseParameterCommand('Sollwert auf -5 mm', current)).reasonCode, 'unit_mismatch');
  assert.equal((await parseParameterCommand('Sollwert beim thermoMETER UC-SF11-S3 auf -5 °C', current)).reasonCode, 'sensor_mismatch');
});

test('localized upper-limit examples work in all ten presentation languages', async () => {
  const examples = [
    'Setze die obere Sollgrenze auf 25,1 mm.',
    'Set the upper limit to 25.1 mm.',
    'Règle la limite de consigne supérieure sur 25,1 mm.',
    'Establece el límite de referencia superior en 25,1 mm.',
    'Imposta il limite superiore a 25,1 mm.',
    'Nastav horní mez na 25,1 mm.',
    '将上限设为 25.1 mm。',
    '上限を 25.1 mm に設定してください。',
    '상한을 25.1 mm로 설정하세요.',
    'Set the upper limit to 25.1 mm, matey.',
  ];
  for (const request of examples) {
    const response = await parseParameterCommand(request, context());
    assert.equal(response.status, 'proposal', request);
    assert.equal(response.proposal.newValue, 25.1, request);
  }
});

test('the translated UI command examples are accepted by the mock contract', async () => {
  const { assistantMessages, assistantText } = await import('../dist/assistant-i18n.js');
  for (const language of Object.keys(assistantMessages)) {
    const request = assistantText('commandExample', { value: '25.100', unit: 'mm' }, language);
    const response = await parseParameterCommand(request, context());
    assert.equal(response.status, 'proposal', `${language}: ${request}`);
  }
});

test('unsupported sensors, parameters, units and ambiguous requests never yield a proposal', async () => {
  const cases = [
    ['', 'empty_request'],
    ['Setze die obere Grenze beim optoNCDT 1420 auf 25,1 mm', 'sensor_mismatch'],
    ['Setze die obere Grenze beim ILD1900-50 auf 25,1 mm', 'sensor_mismatch'],
    ['Setze den Sollwert beim thermoMETER auf 25 mm', 'sensor_mismatch'],
    ['Setze die Messrate auf 4000 Hz', 'unsupported_parameter'],
    ['Setze die obere und untere Grenze auf 25 mm', 'ambiguous_parameter'],
    ['Setze obere Sollgrenze auf 25,1 oder 25,2 mm', 'ambiguous_value'],
    ['Erhöhe die obere Grenze um 0,1 mm', 'ambiguous_value'],
    ['Setze obere Sollgrenze', 'missing_value'],
    ['Sollwert auf 25 °C', 'unit_mismatch'],
    ['Sollwert auf 25 cm', 'unit_mismatch'],
    ['Sollwert auf 25cm', 'unit_mismatch'],
    ['Setze irgendeinen Wert auf 25', 'unsupported_parameter'],
  ];
  for (const [request, reason] of cases) {
    const response = await parseParameterCommand(request, context());
    assert.equal(response.reasonCode, reason, request);
    assert.equal(response.proposal, undefined, request);
  }
});

test('physical bounds and valid profile ordering are enforced before offering a preview', async () => {
  for (const [request, expected] of [
    ['Sollwert auf 19,9 mm', 'out_of_range'],
    ['Obere Sollgrenze auf 31 mm', 'out_of_range'],
    ['Untere Sollgrenze auf 25,1 mm', 'invalid_limits'],
    ['Obere Sollgrenze auf 24,99 mm', 'invalid_limits'],
    ['Sollwert auf 25,1 mm', 'invalid_limits'],
  ]) assert.equal((await parseParameterCommand(request, context())).reasonCode, expected, request);
  assert.equal((await parseParameterCommand('Sollwert auf 25 mm', {})).reasonCode, 'missing_context');
});

test('confirmation rejects changed sensor, profile, version, value, malformed proposals and invalid limits', async () => {
  const current = context(), { proposal } = await parseParameterCommand('Obere Sollgrenze auf 25,1 mm', current);
  const changed = delta => ({ ...current, ...delta });
  assert.equal(checkProposal(proposal, changed({ sensor: { ...current.sensor, id: 'thermo_uc' } })).reasonCode, 'sensor_mismatch');
  assert.equal(checkProposal(proposal, changed({ profile: { ...current.profile, id: 'other' } })).reasonCode, 'profile_mismatch');
  assert.equal(checkProposal(proposal, changed({ profile: { ...current.profile, version: 4 } })).reasonCode, 'stale_profile');
  assert.equal(checkProposal(proposal, changed({ profile: { ...current.profile, upper: 25.07 } })).reasonCode, 'stale_value');
  assert.equal(checkProposal({ ...proposal, unit: '°C' }, current).reasonCode, 'unit_mismatch');
  assert.equal(checkProposal({ ...proposal, parameterName: 'rate' }, current).reasonCode, 'unsupported_parameter');
  assert.equal(checkProposal({ ...proposal, newValue: Infinity }, current).reasonCode, 'invalid_value');
  assert.equal(checkProposal({ ...proposal, newValue: 24.9 }, current).reasonCode, 'invalid_limits');
  assert.equal(checkProposal(proposal, context()).valid, true);
  assert.equal(current.profile.upper, 25.05, 'confirmation validation never changes the profile');
});
