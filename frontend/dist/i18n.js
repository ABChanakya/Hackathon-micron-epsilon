import english from './locales/en.js?v=ui-review-3';
import cockpitCopy from './locales/cockpit-copy.js?v=ui-review-3';
import settingsCopy from './locales/settings-copy.js?v=ui-review-3';
import mobileCopy from './locales/mobile-copy.js?v=ui-review-3';
import coverageCopy from './locales/coverage-copy.js?v=ui-review-3';
import recordingsCopy from './locales/recordings-copy.js?v=recordings-1';

// Shared with the presentation page, so following either link retains the chosen language.
const STORAGE_KEY = 'landing-lang';
export const LANGUAGES = Object.freeze([
  { code: 'de', name: 'Deutsch', locale: 'de-DE' },
  { code: 'en', name: 'English', locale: 'en-GB' },
  { code: 'fr', name: 'Français', locale: 'fr-FR' },
  { code: 'es', name: 'Español', locale: 'es-ES' },
  { code: 'it', name: 'Italiano', locale: 'it-IT' },
  { code: 'cs', name: 'Čeština', locale: 'cs-CZ' },
  { code: 'zh', name: '中文', locale: 'zh-CN' },
  { code: 'ja', name: '日本語', locale: 'ja-JP' },
  { code: 'ko', name: '한국어', locale: 'ko-KR' },
  { code: 'pirate', name: 'Pirate', locale: 'en-GB' },
]);
const supported = code => LANGUAGES.some(language => language.code === code);
const storedLanguage = () => {
  try {
    const selected = new URLSearchParams(globalThis.location?.search || '').get('lang');
    if (supported(selected)) {
      globalThis.localStorage?.setItem(STORAGE_KEY, selected);
      return selected;
    }
    const code = globalThis.localStorage?.getItem(STORAGE_KEY);
    return supported(code) ? code : 'de';
  } catch { return 'de'; }
};
let language = storedLanguage();
export const revisionMessages = code => ({...cockpitCopy[code], ...settingsCopy[code], ...mobileCopy[code], ...coverageCopy[code], ...recordingsCopy[code]});
const dictionaries = new Map([['en', {...english, ...revisionMessages('en')}]]);
const loading = new Map();
const compiled = new Map();
const textSources = new WeakMap();
const attributeSources = new WeakMap();
const attributes = ['aria-label', 'aria-description', 'title', 'placeholder', 'alt'];
const excluded = [
  '[data-i18n-skip]', '[translate="no"]', '[contenteditable]:not([contenteditable="false"])',
  'script', 'style', 'code', 'pre',
  '.run-name', '.run-profile', '.marker-chip', '.report-note', '.sensor-model', '.brand-sub',
  '#profile-select option', '#live-port option', '[data-field="language"] option', '#setting-language option',
].join(',');

export const getLanguage = () => language;
export const getLocale = (code = language) => LANGUAGES.find(item => item.code === code)?.locale || 'de-DE';

async function loadLanguage(code) {
  if (code === 'de' || dictionaries.has(code)) return;
  if (!loading.has(code)) {
    loading.set(code, import(`./locales/${code}.js?v=ui-review-3`).then(module => {
      dictionaries.set(code, {...module.default, ...revisionMessages(code)});
      compiled.delete(code);
    }).catch(() => {
      // Existing labels remain usable if an optional locale cannot be fetched.
    }).finally(() => loading.delete(code)));
  }
  await loading.get(code);
}

const escapePattern = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function phrases(code) {
  const dictionary = dictionaries.get(code) || english;
  const cached = compiled.get(code);
  if (cached?.dictionary === dictionary) return cached;
  const messages = { ...english, ...revisionMessages('en'), ...dictionary };
  const templates = Object.keys(messages).filter(key => key.includes('{')).map(key => {
    const names = [], parts = [];
    let cursor = 0;
    for (const match of key.matchAll(/\{(\w+)\}/g)) {
      parts.push(escapePattern(key.slice(cursor, match.index)), '(.*?)');
      names.push(match[1]);
      cursor = match.index + match[0].length;
    }
    parts.push(escapePattern(key.slice(cursor)));
    return { key, names, pattern: new RegExp(`^${parts.join('')}$`, 'u') };
  }).sort((a, b) => b.key.replace(/\{\w+\}/g, '').length - a.key.replace(/\{\w+\}/g, '').length);
  const result = { dictionary, messages, templates };
  compiled.set(code, result);
  return result;
}

/** Translate UI copy; placeholders such as names, models, numbers and units retain their original values. */
export function translateText(value, code = language, depth = 0) {
  const text = String(value ?? '');
  if (code === 'de' || !supported(code) || !text.trim() || depth > 3) return text;
  const leading = text.match(/^\s*/)[0], trailing = text.match(/\s*$/)[0], source = text.trim();
  if (!/[A-Za-zÄÖÜäöüß]/.test(source)) return text;
  const { messages, templates } = phrases(code);
  let translated = Object.hasOwn(messages, source) ? messages[source] : null;
  if (translated === null) {
    for (const template of templates) {
      const match = source.match(template.pattern);
      if (!match) continue;
      const values = Object.fromEntries(template.names.map((name, index) => [name, match[index + 1]]));
      translated = messages[template.key].replace(/\{(\w+)\}/g, (_, name) => {
        const captured = values[name] ?? '';
        return ['status', 'color', 'reason', 'page', 'quantity'].includes(name) ? translateText(captured, code, depth + 1) : captured;
      });
      break;
    }
  }
  if (translated === null) translated = source;
  return leading + translated + trailing;
}

function isExcluded(node) {
  const element = node.nodeType === 1 ? node : node.parentElement;
  return Boolean(element?.closest?.(excluded));
}

function sourceFor(cache, key, value) {
  let entry = cache.get(key);
  // The application may replace a dynamic status with new German source text.
  if (!entry || value !== entry.last) {
    entry = { source: value, last: value };
    cache.set(key, entry);
  }
  return entry;
}

/** Translate text and accessibility copy only. Input values, user content and technical code stay intact. */
export function applyTranslations(root = globalThis.document) {
  if (!root) return;
  function visit(node) {
    if (isExcluded(node)) return;
    if (node.nodeType === 3) {
      if (['INPUT', 'TEXTAREA'].includes(node.parentElement?.tagName)) return;
      const entry = sourceFor(textSources, node, node.nodeValue || '');
      const next = translateText(entry.source);
      entry.last = next;
      if (node.nodeValue !== next) node.nodeValue = next;
      return;
    }
    if (node.nodeType === 1) {
      let values = attributeSources.get(node);
      if (!values) { values = new Map(); attributeSources.set(node, values); }
      for (const name of attributes) {
        const value = node.getAttribute(name);
        if (value === null) continue;
        const entry = sourceFor(values, name, value), next = translateText(entry.source);
        entry.last = next;
        if (value !== next) node.setAttribute(name, next);
      }
      if (['INPUT', 'TEXTAREA'].includes(node.tagName)) return;
    }
    for (const child of Array.from(node.childNodes || [])) visit(child);
  }
  visit(root);
  const html = globalThis.document?.documentElement;
  if (html) html.lang = language === 'pirate' ? 'en' : language;
  // This one controlled setting mirrors cross-tab preferences; other form values stay untouched.
  for (const picker of globalThis.document?.querySelectorAll?.('#language-select, #setting-language, select[data-field="language"]') || []) {
    if (picker.tagName === 'SELECT' && picker.value !== language) picker.value = language;
  }
}

/** The code is selected synchronously; awaiting also waits for a non-English locale to load. */
export async function setLanguage(code) {
  if (!supported(code)) return false;
  language = code;
  try { globalThis.localStorage?.setItem(STORAGE_KEY, code); } catch {}
  // A language handed over by another origin must not override a later choice on reload.
  try {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.has('lang')) {
      url.searchParams.set('lang', code);
      globalThis.history?.replaceState(globalThis.history.state, '', url);
    }
  } catch {}
  applyTranslations();
  await loadLanguage(code);
  if (language === code) applyTranslations();
  return true;
}

let observer = null, stop = null;
/** Observe rendered pages, dialogs, status text, toasts and the page title without changing application state. */
export function startTranslations() {
  if (!globalThis.document) return () => {};
  if (observer) { applyTranslations(); return stop; }
  applyTranslations();
  loadLanguage(language).then(() => applyTranslations());
  const pending = new Set();
  let queued = false;
  const schedule = node => {
    pending.add(node);
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      for (const target of pending) applyTranslations(target);
      pending.clear();
    });
  };
  if (globalThis.MutationObserver) {
    observer = new MutationObserver(records => {
      for (const record of records) {
        if (record.type === 'childList') for (const child of record.addedNodes) schedule(child);
        else schedule(record.target);
      }
    });
    observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: attributes });
  }
  const onStorage = event => {
    if (event.key !== STORAGE_KEY) return;
    language = supported(event.newValue) ? event.newValue : 'de';
    applyTranslations();
    loadLanguage(language).then(() => applyTranslations());
  };
  globalThis.addEventListener?.('storage', onStorage);
  stop = () => {
    observer?.disconnect(); observer = null;
    globalThis.removeEventListener?.('storage', onStorage);
  };
  return stop;
}
