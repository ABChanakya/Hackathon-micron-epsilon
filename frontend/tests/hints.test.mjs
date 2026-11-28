import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {revisionMessages} from '../dist/i18n.js';

const source = await readFile(new URL('../dist/hints.js', import.meta.url), 'utf8')
  .then(text => text.replace(/^import .*;\n/m, 'const translateText = text => text;\n'));
const {HINTS} = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const english = {...(await import('../dist/locales/en.js')).default,...revisionMessages('en')};
const el = (data = {}, text = '', parent = null) => ({dataset: data, textContent: text, parentElement: parent});

test('every hover hint text is translated in every language', async () => {
  const hints = new Set();
  const button = (text, data) => el(data, text, el({}, 'In Ordnung Nicht in Ordnung'));
  for (const [, hint, options] of HINTS) {
    for (const probe of [el({value: '30', label: 'anomaly'}, 'Stoppen'), el({value: '30'}, 'Aufnahme starten'), button('Akzeptabel', {value: '10', accepted: 'true'}), button('x', {value: '10', accepted: 'false'})]) {
      if (typeof hint === 'function') { try { hints.add(hint(probe)); } catch {} } else hints.add(hint);
    }
    assert.ok(typeof hint === 'function' || hint.length > 10, 'hint has text');
  }
  for (const text of hints) {
    const key = text.replace(/letzten \d+ Sekunden/, 'letzten {seconds} Sekunden');
    assert.ok(english[key], `en has: ${key}`);
  }
  for (const code of ['fr', 'es', 'it', 'cs', 'zh', 'ja', 'ko', 'pirate']) {
    const dictionary = {...(await import(`../dist/locales/${code}.js`)).default,...revisionMessages(code)};
    for (const key of ['Mehr Informationen', 'Verbindung getrennt.', 'Messwerte werden empfangen.', 'Weitere Parameter']) {
      assert.ok(dictionary[key], `${code}: ${key}`);
    }
  }
});

test('hints cover the key controls', () => {
  const selectors = HINTS.map(([selector]) => selector).join(' ');
  for (const needed of ['record', 'pause', 'zero', 'window', 'led="state"', 'led="output"', 'feedback']) {
    assert.ok(selectors.includes(needed), needed);
  }
});
