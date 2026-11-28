import test from 'node:test';
import assert from 'node:assert/strict';
import { assistantMessages, assistantText } from '../dist/assistant-i18n.js';

const languages = ['de', 'en', 'fr', 'es', 'it', 'cs', 'zh', 'ja', 'ko', 'pirate'];
const placeholders = text => [...text.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();

test('the assistant preview covers the same ten presentation languages without missing messages', () => {
  assert.deepEqual(Object.keys(assistantMessages), languages);
  const canonical = Object.keys(assistantMessages.de).sort();
  assert.equal(canonical.length, 111);
  for (const language of languages) {
    assert.deepEqual(Object.keys(assistantMessages[language]).sort(), canonical, language);
    for (const [key, value] of Object.entries(assistantMessages[language])) {
      assert.equal(typeof value, 'string', `${language}.${key}`);
      assert.ok(value.trim(), `${language}.${key} is not empty`);
      assert.deepEqual(placeholders(value), placeholders(assistantMessages.de[key]), `${language}.${key}`);
    }
  }
});

test('interpolation keeps names, units and supplied number formatting intact in every language', () => {
  const values = { model: 'Mein Sensor {Sondername}', start: '-50,00', end: '900,00', unit: '°C' };
  for (const language of languages) {
    const text = assistantText('rangeAnswer', values, language);
    for (const value of Object.values(values)) assert.ok(text.includes(value), `${language}: ${value}`);
    assert.ok(!text.includes('{model}'), language);
    assert.equal(assistantText('samples', { count: 0, duration: '0,0' }, language).includes('0,0'), true);
  }
  assert.deepEqual(values, { model: 'Mein Sensor {Sondername}', start: '-50,00', end: '900,00', unit: '°C' });
});

test('unsupported languages fall back to German and missing interpolation values stay visible', () => {
  assert.equal(assistantText('title'), 'Assistent');
  assert.equal(assistantText('title', {}, 'unsupported'), 'Assistent');
  assert.equal(assistantText('missing-message', {}, 'en'), 'missing-message');
  assert.equal(assistantText('commandExample', { value: '25,100' }, 'de'),
    'Setze die obere Sollgrenze auf 25,100 {unit}.');
  assert.equal(assistantText('commandExample', { value: 0, unit: '°C' }, 'en'),
    'Set the upper specification limit to 0 °C.');
});
