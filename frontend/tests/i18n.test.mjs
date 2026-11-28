import test from 'node:test';
import assert from 'node:assert/strict';
import * as i18n from '../dist/i18n.js';
import english from '../dist/locales/en.js';

class TextNode {
  nodeType = 3;
  constructor(value) { this.nodeValue = value; }
}
class Element {
  nodeType = 1;
  childNodes = [];
  constructor(tag, attrs = {}, ...children) {
    this.tagName = tag.toUpperCase(); this.attrs = { ...attrs };
    for (const child of children) this.append(typeof child === 'string' ? new TextNode(child) : child);
  }
  append(child) { child.parentElement = this; this.childNodes.push(child); }
  getAttribute(name) { return Object.hasOwn(this.attrs, name) ? this.attrs[name] : null; }
  setAttribute(name, value) { this.attrs[name] = value; }
  matches(selector) {
    const not = selector.match(/:not\(([^)]+)\)/);
    if (not) return this.matches(selector.replace(not[0], '')) && !this.matches(not[1]);
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) return this.matches(parts.at(-1)) && Boolean(this.parentElement?.closest(parts.slice(0, -1).join(' ')));
    if (selector[0] === '.') return (this.attrs.class || '').split(' ').includes(selector.slice(1));
    if (selector[0] === '#') return this.attrs.id === selector.slice(1);
    const attribute = selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);
    if (attribute) return Object.hasOwn(this.attrs, attribute[1]) && (attribute[2] === undefined || this.attrs[attribute[1]] === attribute[2]);
    return this.tagName === selector.toUpperCase();
  }
  closest(selectors) {
    for (let node = this; node; node = node.parentElement) {
      if (selectors.split(',').some(selector => node.matches(selector.trim()))) return node;
    }
    return null;
  }
}
function documentWith(...children) {
  const title = new Element('title', {}, 'Einstellungen · Micro-Epsilon');
  const html = new Element('html', {}, new Element('head', {}, title), new Element('body', {}, ...children));
  return { nodeType: 9, childNodes: [html], documentElement: html, titleNode: title.childNodes[0] };
}

test('all presentation languages have a corresponding monitor locale', () => {
  assert.deepEqual(i18n.LANGUAGES.map(item => item.code), ['de', 'en', 'fr', 'es', 'it', 'cs', 'zh', 'ja', 'ko', 'pirate']);
  assert.equal(i18n.getLocale('zh'), 'zh-CN');
  assert.equal(i18n.getLocale('pirate'), 'en-GB');
});

test('every translated locale covers all UI messages and preserves named placeholders', async () => {
  const keys = Object.keys(english).sort();
  const placeholders = value => [...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]).sort();
  for (const { code } of i18n.LANGUAGES.filter(item => item.code !== 'de')) {
    const dictionary = (await import(`../dist/locales/${code}.js`)).default;
    assert.deepEqual(Object.keys(dictionary).sort(), keys, `${code} covers every canonical UI message`);
    for (const key of keys) {
      assert.equal(typeof dictionary[key], 'string', `${code}: ${key}`);
      assert.ok(dictionary[key].trim(), `${code}: ${key} is not empty`);
      assert.deepEqual(placeholders(dictionary[key]), placeholders(key), `${code}: ${key} preserves its data placeholders`);
    }
  }
});

test('language selection reads and persists the shared presentation preference', async () => {
  const values = new Map([['landing-lang', 'en']]);
  globalThis.localStorage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) };
  try {
    const fresh = await import(`../dist/i18n.js?test=shared-preference`);
    assert.equal(fresh.getLanguage(), 'en');
    assert.equal(fresh.getLocale(), 'en-GB');
    assert.equal(await fresh.setLanguage('de'), true);
    assert.equal(values.get('landing-lang'), 'de');
    assert.equal(await fresh.setLanguage('unsupported'), false);
    assert.equal(fresh.getLanguage(), 'de');
    assert.equal(values.get('landing-lang'), 'de');
  } finally { delete globalThis.localStorage; }
});

test('dynamic UI text translates without rewriting names, technical identifiers or units', () => {
  assert.equal(i18n.translateText('Hauptnavigation', 'en'), 'Main navigation');
  assert.equal(i18n.translateText(' 23 Messpunkte ', 'en'), ' 23 samples ');
  assert.equal(i18n.translateText('2 Messungen ausgewählt', 'en'), '2 recordings selected');
  assert.equal(i18n.translateText('Profil „Mein Messplatz 20 mm“ geladen.', 'en'), 'Profile “Mein Messplatz 20 mm” loaded.');
  assert.equal(i18n.translateText('Mein Messplatz auswählen', 'en'), 'Select Mein Messplatz');
  assert.equal(i18n.translateText('State-LED: Grün. Das Objekt liegt im Messbereich des Sensors.', 'en'),
    "State LED: Green. The object is within the sensor's measuring range.");
  assert.equal(i18n.translateText('Messbereich -50–900 °C', 'en'), 'Measuring range -50–900 °C');
  assert.equal(i18n.translateText('UC-SF22-S3 · 31,85 °C', 'en'), 'UC-SF22-S3 · 31,85 °C');
  assert.equal(i18n.translateText('Unmapped custom text', 'en'), 'Unmapped custom text');
});

test('DOM translation is reversible and leaves user content and form values intact', async () => {
  const heading = new Element('h1', { title: 'Einstellungen öffnen' }, 'Einstellungen');
  const input = new Element('input', { placeholder: 'Messung suchen …', 'aria-label': 'Aufzeichnungen durchsuchen' });
  input.value = 'Einstellungen';
  const note = new Element('textarea', { placeholder: 'Optionale Begründung …' }, 'Meine Aufzeichnungen');
  const custom = new Element('span', { 'data-i18n-skip': '' }, 'Aufzeichnungen');
  const namedRecording = new Element('span', { class: 'run-name' }, 'Messplatz');
  const code = new Element('code', {}, 'Messung');
  const doc = documentWith(heading, input, note, custom, namedRecording, code);
  globalThis.document = doc;
  try {
    await i18n.setLanguage('en');
    assert.equal(heading.childNodes[0].nodeValue, 'Settings');
    assert.equal(heading.getAttribute('title'), 'Open settings');
    assert.equal(input.getAttribute('placeholder'), 'Search recordings …');
    assert.equal(input.getAttribute('aria-label'), 'Search recordings');
    assert.equal(input.value, 'Einstellungen');
    assert.equal(note.childNodes[0].nodeValue, 'Meine Aufzeichnungen');
    assert.equal(custom.childNodes[0].nodeValue, 'Aufzeichnungen');
    assert.equal(namedRecording.childNodes[0].nodeValue, 'Messplatz');
    assert.equal(code.childNodes[0].nodeValue, 'Messung');
    assert.equal(doc.titleNode.nodeValue, 'Settings · Micro-Epsilon');
    i18n.applyTranslations(doc);
    assert.equal(heading.childNodes[0].nodeValue, 'Settings', 'repeated calls do not treat English output as new German source');
    await i18n.setLanguage('de');
    assert.equal(heading.childNodes[0].nodeValue, 'Einstellungen');
    assert.equal(heading.getAttribute('title'), 'Einstellungen öffnen');
    assert.equal(input.getAttribute('placeholder'), 'Messung suchen …');
    assert.equal(doc.titleNode.nodeValue, 'Einstellungen · Micro-Epsilon');
    assert.equal(doc.documentElement.lang, 'de');
  } finally {
    await i18n.setLanguage('de');
    delete globalThis.document;
  }
});

test('the same rendered page switches between all ten languages and back to German', async () => {
  const heading = new Element('h1', {}, 'Einstellungen');
  const status = new Element('span', {}, '15 Messpunkte');
  const custom = new Element('p', { 'data-i18n-skip': '' }, 'Meine Einstellungen 25 mm');
  const doc = documentWith(heading, status, custom);
  globalThis.document = doc;
  try {
    for (const { code } of i18n.LANGUAGES) {
      await i18n.setLanguage(code);
      assert.equal(i18n.getLanguage(), code);
      assert.equal(heading.childNodes[0].nodeValue, i18n.translateText('Einstellungen', code));
      assert.equal(status.childNodes[0].nodeValue, i18n.translateText('15 Messpunkte', code));
      assert.ok(status.childNodes[0].nodeValue.includes('15'));
      assert.equal(i18n.translateText('Sensor Cockpit · Micro-Epsilon', code), 'Sensor Cockpit · Micro-Epsilon',
        `${code} preserves the complete brand name inside a page title`);
      assert.equal(custom.childNodes[0].nodeValue, 'Meine Einstellungen 25 mm');
      assert.equal(doc.documentElement.lang, code === 'pirate' ? 'en' : code);
    }
    await i18n.setLanguage('de');
    assert.equal(heading.childNodes[0].nodeValue, 'Einstellungen');
    assert.equal(status.childNodes[0].nodeValue, '15 Messpunkte');
  } finally {
    await i18n.setLanguage('de');
    delete globalThis.document;
  }
});

test('observed status changes and newly rendered dialogs translate from their new source', async () => {
  const status = new Element('span', {}, 'Nicht verbunden');
  const doc = documentWith(status);
  let callback, observed = false, disconnected = false;
  globalThis.document = doc;
  globalThis.MutationObserver = class {
    constructor(fn) { callback = fn; }
    observe() { observed = true; }
    disconnect() { disconnected = true; }
  };
  let stop;
  try {
    await i18n.setLanguage('en');
    stop = i18n.startTranslations();
    assert.equal(observed, true);
    assert.equal(status.childNodes[0].nodeValue, 'Not connected');
    status.childNodes[0].nodeValue = 'Kein gültiger Messwert';
    callback([{ type: 'characterData', target: status.childNodes[0] }]);
    await new Promise(queueMicrotask);
    assert.equal(status.childNodes[0].nodeValue, 'No valid reading');
    const dialog = new Element('div', {}, new Element('button', {}, 'Schließen'));
    doc.childNodes[0].childNodes[1].append(dialog);
    callback([{ type: 'childList', addedNodes: [dialog] }]);
    await new Promise(queueMicrotask);
    assert.equal(dialog.childNodes[0].childNodes[0].nodeValue, 'Close');
    await i18n.setLanguage('de');
    assert.equal(status.childNodes[0].nodeValue, 'Kein gültiger Messwert');
  } finally {
    stop?.();
    assert.equal(disconnected, true);
    delete globalThis.MutationObserver;
    delete globalThis.document;
    await i18n.setLanguage('de');
  }
});

test('cross-tab language changes synchronize the picker without discarding edited form values', async () => {
  await i18n.setLanguage('fr');
  await i18n.setLanguage('en');
  const heading = new Element('h1', {}, 'Einstellungen');
  const picker = new Element('select', { id: 'language-select', 'data-i18n-skip': '' });
  picker.value = 'en';
  const profileName = new Element('input', { id: 'profile-name' });
  profileName.value = 'Mein neues Messprofil';
  const target = new Element('input', { type: 'number' });
  target.value = '25.25';
  const notes = new Element('textarea');
  notes.value = 'Noch nicht gespeicherte Notiz';
  const doc = documentWith(heading, picker, profileName, target, notes);
  doc.querySelectorAll = selector => selector.includes('#language-select') ? [picker] : [];
  const listeners = new Map();
  globalThis.document = doc;
  globalThis.addEventListener = (name, listener) => listeners.set(name, listener);
  globalThis.removeEventListener = name => listeners.delete(name);
  let stop;
  try {
    stop = i18n.startTranslations();
    listeners.get('storage')({ key: 'landing-lang', newValue: 'fr' });
    await new Promise(queueMicrotask);
    assert.equal(i18n.getLanguage(), 'fr');
    assert.equal(picker.value, 'fr');
    assert.equal(heading.childNodes[0].nodeValue, i18n.translateText('Einstellungen', 'fr'));
    assert.equal(profileName.value, 'Mein neues Messprofil');
    assert.equal(target.value, '25.25');
    assert.equal(notes.value, 'Noch nicht gespeicherte Notiz');
    listeners.get('storage')({ key: 'landing-lang', newValue: 'de' });
    assert.equal(picker.value, 'de');
    assert.equal(heading.childNodes[0].nodeValue, 'Einstellungen');
  } finally {
    stop?.();
    delete globalThis.document;
    delete globalThis.addEventListener;
    delete globalThis.removeEventListener;
    await i18n.setLanguage('de');
  }
});
