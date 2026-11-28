import {factoryText} from './factory-copy.js?v=building-plan-1';

const stylesheets = new Map();
function sharedStyles(url) {
  if (!stylesheets.has(url)) {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = url; link.dataset.factoryShared = '';
    stylesheets.set(url, new Promise((resolve, reject) => {
      link.onload = resolve;
      link.onerror = () => { stylesheets.delete(url); link.remove(); reject(new Error('Factory styles unavailable')); };
      document.head.append(link);
    }));
  }
  return stylesheets.get(url);
}

export function createDesktopFactoryPlan(host, {language = 'de', baseUrl, onSelect = () => {}} = {}) {
  let disposed = false, plan = null, selected = null, failed = false;
  const t = (key, values) => factoryText(key, values, language);
  let origin;
  try { origin = new URL(baseUrl || location.origin, location.href); }
  catch { origin = new URL(location.origin); }
  if (origin.protocol === 'ws:') origin.protocol = 'http:';
  if (origin.protocol === 'wss:') origin.protocol = 'https:';
  const assetOrigin = ['http:', 'https:'].includes(origin.protocol) ? origin.origin : location.origin;
  const container = document.createElement('div'), selection = document.createElement('section');
  container.className = 'desktop-factory-content'; selection.className = 'factory-selection'; selection.hidden = true;
  const selectionId = (host.id || 'desktop-factory') + '-selection'; selection.id = selectionId;
  host.classList.add('desktop-factory'); host.setAttribute('data-i18n-skip', '');
  host.append(container, selection);

  function message(error = false) {
    container.replaceChildren();
    const text = document.createElement('p'); text.className = error ? 'factory-load-error' : 'factory-loading';
    text.textContent = t(error ? 'loadError' : 'planLoading'); text.setAttribute('role', error ? 'alert' : 'status');
    container.append(text);
    if (error) {
      const link = document.createElement('a'); link.className = 'btn compact'; link.href = new URL('/handy/', assetOrigin).href;
      link.textContent = t('openPhone'); container.append(link);
    }
  }
  function showSelection() {
    selection.replaceChildren(); selection.hidden = !selected;
    if (!selected) return;
    const heading = document.createElement('h3'); heading.textContent = t('selectedSensor');
    const name = document.createElement('strong'); name.className = 'factory-selected-name';
    name.textContent = selected.suffix ? t('headLabel', {model: selected.model, head: selected.suffix}) : selected.model;
    const locationText = document.createElement('p');
    locationText.textContent = t('location') + ': ' + t(selected.nameKey) + ' · ' + t(selected.positionKey);
    const unit = document.createElement('p'); unit.textContent = t('unitLabel') + ': ' + selected.unit;
    const note = document.createElement('p'); note.className = 'factory-selection-note'; note.textContent = t('simulationNote');
    selection.setAttribute('aria-label', t('selectedSensor')); selection.append(heading, name, locationText, unit, note);
  }
  message();
  const ready = Promise.all([
    import(new URL('/handy/fabrikplan/karte.mjs', assetOrigin).href),
    sharedStyles(new URL('/handy/fabrikplan/fabrikplan.css', assetOrigin).href),
  ]).then(([module]) => {
    if (disposed || !host.isConnected) return false;
    container.replaceChildren();
    plan = module.mountFactoryPlan(container, {expanded: true, controlsId: selectionId, language, text: t,
      selectSensor(sensor) {
        if (disposed) return;
        selected = {...sensor, source: 'demo', simulated: true}; showSelection(); onSelect({...selected});
      }});
    return true;
  }).catch(() => {
    if (disposed || !host.isConnected) return false;
    failed = true; message(true); return false;
  });
  return {
    ready,
    refresh(options = {}) {
      if (disposed) return;
      language = options.language ?? language;
      if (plan) plan.refresh?.({language, text: t}); else message(failed);
      showSelection();
    },
    destroy() {
      if (disposed) return;
      disposed = true; plan?.destroy?.(); container.remove(); selection.remove(); host.classList.remove('desktop-factory');
    },
  };
}
